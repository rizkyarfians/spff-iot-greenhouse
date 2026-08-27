import test from 'node:test';
import assert from 'node:assert/strict';

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

test('operator authorization rejects a request without an authenticated session', () => {
  const req = { body: { requestedBy: 'spoofed-browser-user' } };
  const { response, captured } = responseCapture();
  let nextCalled = false;
  requireOperator(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(captured.statusCode, 401);
  assert.equal(captured.body.success, false);
});

test('authenticated operator session is accepted and overrides browser requestedBy', () => {
  const req = {
    auth: {
      id: 'user-01',
      username: 'greenhouse-operator',
      displayName: 'Greenhouse Operator',
      role: 'operator',
      sessionId: 'session-01',
      csrfHash: 'csrf-hash',
    },
    body: { requestedBy: 'spoofed-browser-user' },
  };
  const { response, captured } = responseCapture();
  let nextCalled = false;
  requireOperator(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(captured.statusCode, 200);
  assert.equal(requestActor(req), 'greenhouse-operator');
});
