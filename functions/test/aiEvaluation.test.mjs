import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAiEvaluationEnabled } from '../lib/middleware/aiEvaluation.js';

test('AI maintenance switch stops evaluation before downstream handlers', () => {
  const previous = process.env.AI_EVALUATION_ENABLED;
  try {
    for (const value of ['false', 'FALSE', '0', '']) {
      process.env.AI_EVALUATION_ENABLED = value;
      let continued = false;
      const response = {
        set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
        status(code) { assert.equal(code, 503); return this; },
        json(body) { assert.equal(body.code, 'AI_EVALUATION_DISABLED'); },
      };
      requireAiEvaluationEnabled({}, response, () => { continued = true; });
      assert.equal(continued, false);
    }
    for (const value of [undefined, 'true']) {
      if (value === undefined) delete process.env.AI_EVALUATION_ENABLED;
      else process.env.AI_EVALUATION_ENABLED = value;
      let continued = false;
      requireAiEvaluationEnabled({}, {}, () => { continued = true; });
      assert.equal(continued, true);
    }
  } finally {
    if (previous === undefined) delete process.env.AI_EVALUATION_ENABLED;
    else process.env.AI_EVALUATION_ENABLED = previous;
  }
});
