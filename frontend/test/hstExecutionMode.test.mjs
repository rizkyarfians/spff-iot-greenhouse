import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewShadow } from '../src/hstExecutionMode.ts';

test('HST TEST_REAL cannot activate the shadow approval action', () => {
  assert.equal(canReviewShadow({mode:'TEST_REAL',previewOnly:false,status:'WAITING_APPROVAL',remainingG:50000}),false);
  assert.equal(canReviewShadow({mode:'SHADOW',previewOnly:false,status:'WAITING_APPROVAL',remainingG:50000}),true);
  assert.equal(canReviewShadow({mode:'SHADOW',previewOnly:false,status:'REQUIRES_REVIEW',remainingG:50000}),false);
  assert.equal(canReviewShadow({mode:'SHADOW',previewOnly:false,status:'WAITING_APPROVAL',remainingG:null}),false);
  assert.equal(canReviewShadow({mode:'SHADOW',previewOnly:true,status:'WAITING_APPROVAL',remainingG:50000}),false);
});
