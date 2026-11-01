import type {Request, Response} from 'express';
import {unifiedAiDashboardSchema} from '@spff/contracts';

// Only the machine-local, separately sandboxed SHADOW engine is contacted.
// Never accept browser-provided URLs, paths, or credentials.
const LOCAL_AI = 'http://127.0.0.1:5010/dashboard/summary';

export async function getUnifiedAiDashboard(
  req: Request, res: Response,
): Promise<void> {
  // Query-only arithmetic input; never forwarded to control endpoints.
  const supplied = req.query.stock_concentration_g_l;
  let concentration: number | null = null;
  if (supplied !== undefined) {
    if (typeof supplied !== 'string' || !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(supplied)) {
      res.status(400).json({success:false, data:null, message:'Konsentrasi stok tidak valid.'});
      return;
    }
    concentration = Number(supplied);
    if (!Number.isFinite(concentration) || concentration < 0.000001 || concentration > 1_000_000) {
      res.status(400).json({success:false, data:null, message:'Konsentrasi stok di luar batas.'});
      return;
    }
  }
  const extra = new URLSearchParams();
  if (concentration !== null) extra.set('stock_concentration_g_l', String(concentration));
  const rawWater = req.query.planned_water_l;
  if (rawWater !== undefined) {
    if (typeof rawWater !== 'string' ||
        !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(rawWater)) {
      res.status(400).json({success: false, data: null, message: 'Volume air tidak valid.'});
      return;
    }
    const water = Number(rawWater);
    if (!Number.isFinite(water) || water <= 0 || water > 1_000_000) {
      res.status(400).json({success: false, data: null, message: 'Volume air di luar batas.'});
      return;
    }
    const programId = req.query.selected_program_id;
    const activityId = req.query.selected_activity_id;
    if (typeof programId !== 'string' || programId.length < 1 || programId.length > 200 ||
        typeof activityId !== 'string' || activityId.length > 50 ||
        !/^row-[0-9]+$/.test(activityId)) {
      res.status(400).json({success: false, data: null, message: 'Kegiatan untuk volume air tidak valid.'});
      return;
    }
    extra.set('planned_water_l', String(water));
    extra.set('selected_program_id', programId);
    extra.set('selected_activity_id', activityId);
  }
  const url = LOCAL_AI + (extra.size ? '?' + extra.toString() : '');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2500);
  try {
    const response = await fetch(url, {
      method: 'GET', signal: abort.signal,
      headers: {Accept: 'application/json'},
      redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Unified AI belum tersedia. Periksa service Python dan polling data.',
      });
      return;
    }
    const payload: unknown = await response.json();
    const parsed = unifiedAiDashboardSchema.safeParse(payload);
    if (!parsed.success) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Format laporan Unified AI belum kompatibel.',
      });
      return;
    }
    res.set('Cache-Control', 'no-store').json({
      success: true, data: parsed.data,
      message: 'Laporan SHADOW Unified AI dari PostgreSQL lokal.',
    });
  } catch {
    res.set('Cache-Control', 'no-store').status(503).json({
      success: false, data: null,
      message: 'Tidak dapat membaca service Unified AI lokal.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
