import type { Request, Response, NextFunction } from 'express';
import { fertigationPlannerIdentitySchema, fertigationPlannerMutationSchema } from '@spff/contracts';
import { buildServerFertigationPlan, getPlannerProfile, savePlannerProfile } from '../services/fertigationPlannerRepository.js';
import { requestActor } from '../middleware/operatorAuth.js';

export async function getFertigationPlannerProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const input = fertigationPlannerIdentitySchema.safeParse(req.query);
    if (!input.success) { res.status(400).json({ success: false, message: 'deviceId dan recipeId tidak valid.' }); return; }
    res.set('Cache-Control', 'no-store').json({ success: true, data: await getPlannerProfile(input.data.deviceId, input.data.recipeId) });
  } catch (error) { next(error); }
}
export async function putFertigationPlannerProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const input = fertigationPlannerMutationSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ success: false, message: 'Profil planner tidak valid.', errors: input.error.issues.map(i => i.path.join('.')) }); return; }
    res.set('Cache-Control', 'no-store').json({ success: true, data: await savePlannerProfile(input.data, requestActor(req)), message: 'Profil planner tersimpan. Tidak mengirim perintah pompa.' });
  } catch (error) { next(error); }
}
export async function postFertigationPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const input = fertigationPlannerIdentitySchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ success: false, message: 'Hanya deviceId dan recipeId yang diterima; sensor dibaca dari PostgreSQL.' }); return; }
    res.set('Cache-Control', 'no-store').json({ success: true, data: await buildServerFertigationPlan(input.data.deviceId, input.data.recipeId), message: 'Rencana adaptif server; belum dieksekusi perangkat.' });
  } catch (error) { next(error); }
}
