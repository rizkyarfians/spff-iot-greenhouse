import {z} from 'zod';
import type {GuideActivity} from './guidePrograms.js';
export const guideEcProfileSchema=z.object({
 expectedProgramRevision:z.number().int().positive(),expectedProfileRevision:z.number().int().nonnegative(),activityId:z.string().regex(/^row-\d+$/),
 sourceReference:z.string().trim().min(5).max(1000),referenceWaterEcMsCm:z.number().finite().min(0).max(20),
 temperatureCompensated25C:z.literal(true),mixtureVerified:z.literal(true),
 points:z.array(z.object({concentrationGPerL:z.number().finite().min(0).max(1000),ecMsCm:z.number().finite().min(0).max(100)}).strict()).min(2).max(30),
}).strict().superRefine((v,ctx)=>{
 if(v.points[0]?.concentrationGPerL!==0||Math.abs((v.points[0]?.ecMsCm??-1)-v.referenceWaterEcMsCm)>1e-6)ctx.addIssue({code:'custom',message:'Titik pertama harus 0 g/L dengan EC air acuan.'});
 for(let i=1;i<v.points.length;i++)if(v.points[i].concentrationGPerL<=v.points[i-1].concentrationGPerL||v.points[i].ecMsCm<v.points[i-1].ecMsCm)ctx.addIssue({code:'custom',message:'Konsentrasi harus berurutan naik dan EC tidak menurun.'});
 if(v.points.at(-1)!.ecMsCm<=v.referenceWaterEcMsCm)ctx.addIssue({code:'custom',message:'Kurva harus memiliki kenaikan EC terukur.'});
});
export type GuideEcProfileInput=z.infer<typeof guideEcProfileSchema>;
export type GuideEcProfile=Omit<GuideEcProfileInput,'expectedProgramRevision'|'expectedProfileRevision'|'activityId'>&{recipeKey:string;revision:number;updatedBy:string;updatedAt:string};
export type GuideEcConversion={activityId:string;status:'ready'|'blocked';reason:string;recipeKey:string|null;concentrationGPerL:number|null;targetEcMsCm:number|null;profile:GuideEcProfile|null;automaticExecutionEnabled:false};
/** Recipe identity includes every product and its mass fraction (10 significant digits), not just NPK or total kg. */
export function guideEcRecipe(activity:GuideActivity):{key:string;concentrationGPerL:number}|null {
 if(!activity.waterL||activity.waterL<=0||activity.warnings.length||!activity.requirements.length)return null;
 const products=new Map<string,number>();
 for(const r of activity.requirements){
  if(r.amount===null||!Number.isFinite(r.amount)||r.amount<=0||!['g','kg'].includes(r.unit)||r.warnings.length)return null;
  if(r.waterL!==null&&r.waterL>0&&Math.abs(r.waterL-activity.waterL)>Math.max(1e-6,activity.waterL*1e-6))return null;
  const name=r.product.trim().toLowerCase();if(!name)return null;
  products.set(name,(products.get(name)??0)+r.amount*(r.unit==='kg'?1000:1));
 }
 const total=[...products.values()].reduce((a,b)=>a+b,0);
 const recipe=[...products.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([product,mass])=>({product,fraction:Number((mass/total).toPrecision(10))}));
 return {key:JSON.stringify(recipe),concentrationGPerL:total/activity.waterL};
}
/** Linear interpolation inside validated measured points only. EC targets are solution EC at 25 C. */
export function convertGuideEc(concentration:number,waterEc:number,profile:GuideEcProfile):number|null {
 if(!Number.isFinite(concentration)||concentration<0||!Number.isFinite(waterEc)||waterEc<0||waterEc>20)return null;
 const validation=guideEcProfileSchema.safeParse({sourceReference:profile.sourceReference,referenceWaterEcMsCm:profile.referenceWaterEcMsCm,temperatureCompensated25C:profile.temperatureCompensated25C,mixtureVerified:profile.mixtureVerified,points:profile.points,expectedProgramRevision:1,expectedProfileRevision:profile.revision,activityId:'row-1'});
 // Validate the profile shape without persistence metadata.
 if(!validation.success)return null;
 const points=profile.points;if(concentration<points[0].concentrationGPerL||concentration>points.at(-1)!.concentrationGPerL)return null;
 for(let i=1;i<points.length;i++)if(concentration<=points[i].concentrationGPerL){
  const a=points[i-1],b=points[i],ec=a.ecMsCm+(b.ecMsCm-a.ecMsCm)*(concentration-a.concentrationGPerL)/(b.concentrationGPerL-a.concentrationGPerL);
  const target=waterEc+(ec-profile.referenceWaterEcMsCm);
  return Number.isFinite(target)&&target>=0&&target<=100?target:null;
 }
 return null;
}
