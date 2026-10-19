import type { Request, Response, NextFunction } from 'express';
import {
  fertigationSimulationInputSchema, fertigationLiveEvaluationInputSchema,
  fertigationRecipeMutationSchema, fertigationRecipeUpdateSchema, fertigationRecipeApprovalSchema,
} from '@spff/contracts';
import {
  createFertigationRecipe, updateFertigationRecipe, approveFertigationRecipe,
  listFertigationRecipes, loadSiteFertigationSnapshot, recordFertigationEvaluation,
  getFertigationRecipe, getRecentFertigationSessions,
} from '../services/fertigationRepository.js';
import { simulateFertigation } from '../services/fertigationRules.js';
import { evaluateSiteFertigation } from '../services/fertigationLiveEvaluation.js';
import { requestActor } from '../middleware/operatorAuth.js';

export async function simulateFertigationController(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = fertigationSimulationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, message: 'Input simulasi tidak valid.', errors: parsed.error.issues.map(issue => issue.path.join('.')) });
      return;
    }
    const recipe = await getFertigationRecipe(parsed.data.recipeId);
    if (!recipe) {
      res.status(404).json({ success: false, data: null, message: 'Program Fertigasi tidak ditemukan.', errors: ['recipeId'] });
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

export async function listRecipesController(_req: Request,res:Response,next:NextFunction) {
  try { res.json({success:true,data:await listFertigationRecipes(),message:'Daftar Program Fertigasi.'}); }
  catch(error){next(error);}
}
export async function createRecipeController(req:Request,res:Response,next:NextFunction) {
  try {
    const p=fertigationRecipeMutationSchema.safeParse(req.body);
    if(!p.success){res.status(400).json({success:false,data:null,message:'Data Program Fertigasi tidak valid.',errors:p.error.issues.map(x=>x.path.join('.'))});return;}
    res.status(201).json({success:true,data:await createFertigationRecipe(p.data,requestActor(req)),message:'Program Fertigasi berhasil dibuat sebagai draf. Program belum dapat digunakan sebelum disetujui.'});
  }catch(error){next(error);}
}
export async function updateRecipeController(req:Request,res:Response,next:NextFunction) {
  try {
    const p=fertigationRecipeUpdateSchema.safeParse(req.body);
    const recipeId=req.params.id;
    if(!p.success||typeof recipeId!=='string'||!/^[0-9a-f-]{36}$/i.test(recipeId)){res.status(400).json({success:false,data:null,message:'Permintaan perubahan Program Fertigasi tidak valid.'});return;}
    const result=await updateFertigationRecipe(recipeId,p.data,requestActor(req));
    if(!result){res.status(409).json({success:false,data:null,message:'Program Fertigasi tidak ditemukan atau versinya sudah berubah.'});return;}
    res.json({success:true,data:result,message:'Program Fertigasi diperbarui. Status persetujuan kembali menjadi draf.'});
  }catch(error){next(error);}
}
export async function approveRecipeController(req:Request,res:Response,next:NextFunction) {
  try{
    const p=fertigationRecipeApprovalSchema.safeParse(req.body);
    const recipeId=req.params.id;
    if(!p.success||typeof recipeId!=='string'||!/^[0-9a-f-]{36}$/i.test(recipeId)){res.status(400).json({success:false,data:null,message:'Persetujuan Program Fertigasi tidak valid.'});return;}
    const result=await approveFertigationRecipe(recipeId,p.data.expectedRevision,p.data.approvalReference,requestActor(req));
    if(!result){res.status(409).json({success:false,data:null,message:'Program Fertigasi tidak ditemukan atau versinya sudah berubah.'});return;}
    res.json({success:true,data:result,message:'Persetujuan Program Fertigasi berhasil dicatat.'});
  }catch(error){next(error);}
}
export async function evaluateLiveRecipeController(req:Request,res:Response,next:NextFunction) {
  try{
    const p=fertigationLiveEvaluationInputSchema.safeParse(req.body);
    if(!p.success){res.status(400).json({success:false,data:null,message:'ID Program Fertigasi atau perangkat tidak valid.'});return;}
    const recipe=await getFertigationRecipe(p.data.recipeId);
    if(!recipe){res.status(404).json({success:false,data:null,message:'Program Fertigasi tidak ditemukan.'});return;}
    const snapshot=await loadSiteFertigationSnapshot(p.data.deviceId);
    const decision=evaluateSiteFertigation(recipe,p.data.deviceId,snapshot);
    await recordFertigationEvaluation(recipe.recipeId,p.data.deviceId,requestActor(req),snapshot.telemetryRecordedAt,snapshot.deviceRecordedAt,decision);
    res.set('Cache-Control','no-store').json({success:true,data:decision,message:'Evaluasi berdasarkan PostgreSQL site; tidak mengirim command pompa.'});
  }catch(error){next(error);}
}
