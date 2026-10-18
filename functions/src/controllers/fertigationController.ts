import type { Request, Response, NextFunction } from 'express';
import { fertigationSimulationInputSchema } from '@spff/contracts';
import { getFertigationRecipe, getRecentFertigationSessions } from '../services/fertigationRepository.js';
import { simulateFertigation } from '../services/fertigationRules.js';

export async function simulateFertigationController(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = fertigationSimulationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, message: 'Input simulasi tidak valid.', errors: parsed.error.issues.map(issue => issue.path.join('.')) });
      return;
    }
    const recipe = await getFertigationRecipe(parsed.data.recipeId);
    if (!recipe) {
      res.status(404).json({ success: false, data: null, message: 'Resep tidak ditemukan.', errors: ['recipeId'] });
      return;
    }
    const decision = simulateFertigation(recipe, parsed.data);
    res.set('Cache-Control', 'no-store').json({
      success: true, data: decision, message: 'Simulasi saja. Tidak mengirim command MQTT maupun mengubah status pompa.',
    });
  } catch (error) { next(error); }
}

export async function getFertigationSessionsController(req: Request, res: Response, next: NextFunction) {
  try {
    const deviceId = req.query.deviceId;
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(deviceId)) {
      res.status(400).json({ success: false, data: null, message: 'deviceId tidak valid.', errors: ['deviceId'] });
      return;
    }
    const sessions = await getRecentFertigationSessions(deviceId);
    res.set('Cache-Control', 'no-store').json({ success: true, data: sessions, message: 'Riwayat sesi yang benar-benar diterima dari perangkat.' });
  } catch (error) { next(error); }
}
