import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

// Loopback-only smoke test: no auth/session or actuator/command routes are mounted.
// Python AI may be unavailable on test machines; 503 is a valid fail-closed result.
async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Missing port');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Preview process exited during startup');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch { /* Child is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('Preview did not become healthy on loopback');
}

test('isolated preview exposes read-only readiness but no actuator routes', { timeout: 25000 }, async () => {
  const port = await freeLoopbackPort();
  const child = spawn(process.execPath, ['functions/lib/aiPreviewLocal.js'], {
    cwd: process.cwd(),
    env: { ...process.env, SPFF_AI_STAGING: 'true', AI_PREVIEW_API_PORT: String(port), AI_PREVIEW_PYTHON_PORT: '5011' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const base = 'http://127.0.0.1:' + port;
    await waitForHealth(base + '/api/health', child);
    const preview = await fetch(base + '/api/unified-ai/dispatch-readiness', { signal: AbortSignal.timeout(15000) });
    assert.ok([200, 503].includes(preview.status), 'Readiness route missing: ' + preview.status);
    const body = await preview.json();
    if (preview.status === 200) {
      assert.equal(body.data.stage, 'READ_ONLY_PREFLIGHT');
      assert.equal(body.data.canDispatch, false);
      assert.equal(body.data.commandCreated, false);
      assert.equal(body.data.sourceMode, 'SHADOW_MODE');
    } else {
      assert.equal(body.success, false);
      assert.equal(body.data, null);
    }
    const preparation = await fetch(base + '/api/unified-ai/command-preparation', {
      signal: AbortSignal.timeout(15000),
    });
    assert.ok([200, 503].includes(preparation.status), 'Preparation route missing: ' + preparation.status);
    const prepBody = await preparation.json();
    if (preparation.status === 200) {
      assert.equal(prepBody.data.stage, 'NON_EXECUTABLE_PREPARATION');
      assert.equal(prepBody.data.canDispatch, false);
      assert.equal(prepBody.data.commandCreated, false);
      assert.equal(prepBody.data.command.commandId, null);
      assert.equal(prepBody.data.command.targetId, null);
      assert.equal(prepBody.data.executablePayload, null);
    } else {
      assert.equal(prepBody.success, false);
    }
    const writePreparation = await fetch(base + '/api/unified-ai/command-preparation', {
      method: 'POST', signal: AbortSignal.timeout(1000),
    });
    assert.equal(writePreparation.status, 404, 'Preparation must not accept POST');
    const pumpRoute = await fetch(base + '/api/pumps', { signal: AbortSignal.timeout(1000) });
    assert.equal(pumpRoute.status, 404, 'Actuator routes must not exist in preview');
    const commandRoute = await fetch(base + '/api/pumps/water', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true }),
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(commandRoute.status, 404, 'Actuator mutation route must not exist');
  } catch (error) {
    throw new Error(String(error) + (stderr ? '\nPreview stderr: ' + stderr : ''));
  } finally {
    child.kill('SIGTERM');
  }
});
