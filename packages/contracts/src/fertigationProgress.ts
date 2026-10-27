export type FertigationProgressMetric = {
 key:string; label:string; unit:'µS/cm'|'%'; value:number|null; target:number|null;
 remaining:number|null; percent:number|null; minimum:number|null; high:number|null;
};
export type FertigationProgress = {
 deviceId:string; evaluatedAt:string; day:string; telemetryAt:string|null; telemetryFresh:boolean;soilEcBasis:'latest'|'stable_mean';
 recipeId:string|null; cropName:string|null; hst:number|null; ruleAppliesToday:boolean;
 executionEnabled:boolean; profileArmed:boolean; liquidControlEnabled:boolean;
 status:'satisfied'|'needs_action'|'waiting'|'running'|'blocked'|'disabled'|'unavailable';
 reason:string; nextPulseOnMs:number|null;
 soilEc:FertigationProgressMetric; liquidEc:FertigationProgressMetric;
 waterTank:FertigationProgressMetric; fertilizerTank:FertigationProgressMetric;
 dailyOnMs:number; dailyLimitMs:number|null;soilEcToleranceUsCm:number|null;
};

/** Compare a measured concentration/level with a reference, never infer delivered volume. */
export function fertigationProgressMetric(key:string,label:string,unit:'µS/cm'|'%',
 value:number|null,target:number|null,minimum:number|null=null,high:number|null=null):FertigationProgressMetric {
 const actual=value!==null&&Number.isFinite(value)&&value>=0?value:null;
 const reference=target!==null&&Number.isFinite(target)&&target>0?target:null;
 return {key,label,unit,value:actual,target:reference,minimum,high,
  remaining:actual!==null&&reference!==null?Math.max(0,reference-actual):null,
  percent:actual!==null&&reference!==null?Math.min(100,Math.max(0,actual/reference*100)):null};
}
