import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TRUST_PROXY_AUTH = 'true';
const { requireOperator, requestActor } = await import('../lib/middleware/operatorAuth.js');

function responseCapture() {
  const captured = { statusCode: 200, body: null };
  return {
    captured,
    response: {
      locals: {},
      status(code) { captured.statusCode = code; return this; },
      json(body) { captured.body = body; return this; },
    },
  };
}

test('production mutation auth rejects request without reverse-proxy identity', () => {
  const req = { get: () => undefined, body: { requestedBy: 'spoofed-browser-user' } };
  const { response, captured } = responseCapture();
  let nextCalled = false;
  requireOperator(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(captured.statusCode, 401);
  assert.equal(captured.body.success, false);
});

test('trusted proxy identity is accepted and overrides browser requestedBy', () => {
  const req = {
    get: (name) => name.toLowerCase() === 'x-spff-user' ? 'greenhouse-operator' : undefined,
    body: { requestedBy: 'spoofed-browser-user' },
  };
  const { response, captured } = responseCapture();
  let nextCalled = false;
  requireOperator(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(captured.statusCode, 200);
  assert.equal(requestActor(req), 'greenhouse-operator');
});
