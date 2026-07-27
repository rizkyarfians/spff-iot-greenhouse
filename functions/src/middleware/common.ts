import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

export const logger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`));
  next();
};
export const delay = async (_req: Request, _res: Response, next: NextFunction) => {
  const ms = Math.max(0, Math.min(Number(process.env.API_DELAY_MS ?? 350), 2000));
  await new Promise((resolve) => setTimeout(resolve, ms)); next();
};
export const notFound = (req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.method} ${req.path} tidak ditemukan.`, errors: [] });
};
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  void _next;
  console.error(error);
  res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.', errors: [] });
};
