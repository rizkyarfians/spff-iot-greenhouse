import type { Request, Response, NextFunction } from 'express';

export function advisoryAiOnly(_req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    code: 'AI_ADVISORY_ONLY',
    message: 'AI hanya menampilkan estimasi. Gunakan jadwal HST atau Kontrol Perangkat untuk pompa.',
  });
}

export function advisoryAiControl(req: Request, res: Response, next: NextFunction) {
  if (req.body?.operation === 'stop') return next();
  return advisoryAiOnly(req, res);
}

export function advisoryPumpPolicy(req: Request, res: Response, next: NextFunction) {
  const path = req.path.replace(/\/+$/, '');
  if (req.method === 'PUT' && path === '/unified-ai/hst/mode') return advisoryAiOnly(req, res);
  if (req.method === 'POST' && [
    '/unified-ai/hst/approvals', '/unified-ai/hst/dose-volume/approvals',
    '/unified-ai/hst/real-sessions', '/adaptive-fertigation/sessions', '/fertigation/pulse-sessions',
  ].includes(path)) return advisoryAiOnly(req, res);
  if (req.method === 'POST' && /^\/adaptive-fertigation\/sessions\/[^/]+\/control$/.test(path)) {
    return advisoryAiControl(req, res, next);
  }
  return next();
}
