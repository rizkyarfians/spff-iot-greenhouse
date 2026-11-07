import { z } from 'zod';

export const ecDoseProfileInputSchema=z.object({
  product:z.string().trim().min(1).max(120),
  coefficient:z.number().finite().positive().max(10000000),
  calibrationReference:z.string().trim().max(500).default(''),
  validated:z.boolean().default(false),
  expectedRevision:z.number().int().min(0),
}).strict().refine(v=>!v.validated||v.calibrationReference.length>0,
  'Isi referensi kalibrasi sebelum memakai hasil untuk menyelesaikan fase.');

export type EcDoseProfileInput=z.infer<typeof ecDoseProfileInputSchema>;
export type EcDoseProfile={product:string;coefficient:number;calibrationReference:string;validated:boolean;revision:number};
export type EcDoseSettings={deviceId:string;profile:EcDoseProfile|null;baseline:{ecUsCm:number;recordedAt:string}|null};
