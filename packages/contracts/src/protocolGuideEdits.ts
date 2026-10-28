import {z} from 'zod';
export const protocolGuideSaveSchema=z.object({
 sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),expectedRevision:z.number().int().min(0),
 changes:z.array(z.object({address:z.string().regex(/^[A-P][1-9]\d{0,3}$/),value:z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()])}).strict()).min(1).max(600),
 note:z.string().trim().max(500).default(''),
}).strict().refine(input=>new Set(input.changes.map(change=>change.address)).size===input.changes.length,'Sel perubahan tidak boleh duplikat.');
export type ProtocolGuideSave=z.infer<typeof protocolGuideSaveSchema>;
export type GuideEditValue=string|number|boolean|null;
export type ProtocolGuideState={cropId:string;sourceSha256:string;revision:number;overrides:Record<string,GuideEditValue>;updatedBy:string|null;updatedAt:string|null};
export type ProtocolGuideRevision={revision:number;actor:string;savedAt:string;note:string;changes:{address:string;before:GuideEditValue;after:GuideEditValue}[]};
