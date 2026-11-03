import express from 'express';
import { unifiedAiDashboardSchema } from '@spff/contracts';
import { createAiDispatchReadinessController } from './controllers/aiDispatchReadinessController.js';
import { createAiCommandPreparationController } from './controllers/aiCommandPreparationController.js';

// Independent preview process. NEVER mount the operational SPFF router here:
// that router exposes mutation, actuator and login endpoints.
if (process.env.SPFF_AI_STAGING !== 'true') {
  throw new Error('AI preview requires explicit SPFF_AI_STAGING=true');
}
const port = Number(process.env.AI_PREVIEW_API_PORT ?? 5002);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Invalid staging API port');
}
const pythonPort = Number(process.env.AI_PREVIEW_PYTHON_PORT ?? 5011);
if (!Number.isInteger(pythonPort) || pythonPort < 1024 || pythonPort > 65535) {
  throw new Error('Invalid staging Python port');
}

const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    success: true, data: { service: 'spff-ai-preview', status: 'alive', can_dispatch: false },
    message: 'Isolated AI preview API',
  });
});
app.get('/api/unified-ai/dashboard', async (_req, res) => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`http://127.0.0.1:${pythonPort}/dashboard/summary`, {
      method: 'GET', signal: abort.signal, redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Python AI staging belum siap atau belum memiliki keputusan sumber asli.',
      });
      return;
    }
    const parsed = unifiedAiDashboardSchema.safeParse(await response.json());
    if (!parsed.success) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Respons Python AI staging tidak cocok dengan shared contract.',
      });
      return;
    }
    res.set('Cache-Control', 'no-store').json({
      success: true, data: parsed.data, message: 'Staging SHADOW read-only.',
    });
  } catch {
    res.set('Cache-Control', 'no-store').status(503).json({
      success: false, data: null,
      message: 'Python AI staging tidak dapat dihubungi.',
    });
  } finally {
    clearTimeout(timeout);
  }
});
// Same fail-closed preflight as the authenticated operational API, but only
// available on loopback in this isolated preview process (no login here).
// The preview shares the validated Python port; it never creates a command.
app.get('/api/unified-ai/dispatch-readiness', createAiDispatchReadinessController(pythonPort));
// Blocked draft with no executable payload; localhost-only GET.
app.get('/api/unified-ai/command-preparation', createAiCommandPreparationController(pythonPort));
// No authentication, actuator, evaluation, MQTT, registration or write routes.
// This process must remain localhost-only behind an SSH tunnel.
app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, message: 'Preview only.' });
});
app.listen(port, '127.0.0.1', () => {
  console.log(`AI preview read-only API on http://127.0.0.1:${port}`);
});
