import { once } from 'node:events';
import type { Request, Response } from 'express';
import type { ApiDatalogExportEvent } from '@spff/contracts';
import { configuredSiteId, pool } from '../services/postgresRepository.js';
import { parseDatalogExportFilter, readDatalogExport } from '../services/datalogExport.js';

// Keep connections available for monitoring/control while exports are running.
let activeExports = 0;
const maxActiveExports = 2;

export async function getDatalogExport(req: Request, res: Response) {
  const filter = parseDatalogExportFilter(req.query);
  if (!filter) {
    res.status(400).json({ success: false, message: 'Filter ekspor tidak valid. Pilih rentang maksimal 31 hari.' });
    return;
  }
  if (activeExports >= maxActiveExports) {
    res.set('Retry-After', '10').status(503).json({ success: false, message: 'Ekspor sedang penuh. Coba lagi sebentar.' });
    return;
  }

  activeExports += 1;
  const controller = new AbortController();
  const disconnected = () => controller.abort();
  res.once('close', disconnected);
  const timeout = setTimeout(() => controller.abort(new Error('export_timeout')), 5 * 60_000);
  const write = async (event: ApiDatalogExportEvent) => {
    controller.signal.throwIfAborted();
    if (!res.write(`${JSON.stringify(event)}\n`)) {
      await once(res, 'drain', { signal: controller.signal });
    }
  };

  try {
    res.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    res.flushHeaders();
    await write({ type: 'start' });
    let rowCount = 0;
    for await (const items of readDatalogExport(pool, configuredSiteId, filter, controller.signal)) {
      await write({ type: 'batch', items });
      rowCount += items.length;
    }
    await write({ type: 'complete', rowCount });
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) console.error('[datalog-export] failed', error);
    if (!res.destroyed && !res.writableEnded) {
      const event: ApiDatalogExportEvent = {
        type: 'error',
        message: controller.signal.aborted
          ? 'Ekspor terlalu lama. Persempit rentang waktu lalu coba lagi.'
          : 'Ekspor terputus. File belum disimpan; silakan coba lagi.',
      };
      res.end(`${JSON.stringify(event)}\n`);
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', disconnected);
    activeExports -= 1;
  }
}
