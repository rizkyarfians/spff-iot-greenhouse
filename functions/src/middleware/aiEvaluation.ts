import type { Request, Response, NextFunction } from 'express';

/** A maintenance switch; does not alter device control or saved rules. */
export function requireAiEvaluationEnabled(_req: Request, res: Response, next: NextFunction) {
  if ((process.env.AI_EVALUATION_ENABLED ?? 'true').trim().toLowerCase() === 'true') {
    next();
    return;
  }
  res.set('Cache-Control', 'no-store').status(503).json({
    success: false,
    data: null,
    code: 'AI_EVALUATION_DISABLED',
    message: 'Evaluasi AI sedang dinonaktifkan sementara.',
  });
}
