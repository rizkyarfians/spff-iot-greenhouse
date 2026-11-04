import assert from 'node:assert/strict';
import test from 'node:test';
import { localAiPort, localAiUrl } from '../lib/services/localAiEndpoint.js';

test('operational AI defaults to production loopback 5010', () => {
  const saved = process.env.AI_LOCAL_PORT;
  try {
    delete process.env.AI_LOCAL_PORT;
    assert.equal(localAiPort(), 5010);
    assert.equal(localAiUrl('/hst/proposals'), 'http://127.0.0.1:5010/hst/proposals');
    assert.equal(localAiUrl('/dashboard/summary'), 'http://127.0.0.1:5010/dashboard/summary');
  } finally {
    if (saved === undefined) delete process.env.AI_LOCAL_PORT;
    else process.env.AI_LOCAL_PORT = saved;
  }
});

test('operational AI rejects invalid port configuration', () => {
  const saved = process.env.AI_LOCAL_PORT;
  try {
    for (const bad of ['5011/path', 'http://example.com', '22', '65536', '5010.5']) {
      process.env.AI_LOCAL_PORT = bad;
      assert.throws(() => localAiPort());
    }
  } finally {
    if (saved === undefined) delete process.env.AI_LOCAL_PORT;
    else process.env.AI_LOCAL_PORT = saved;
  }
});
