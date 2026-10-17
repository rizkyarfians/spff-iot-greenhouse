import test from 'node:test';
import assert from 'node:assert/strict';
import { modeNotice } from '../src/modeNotice.ts';

const request = { mode: 'automatic', revision: 60 };
test('saving on server does not imply hardware applied', () => {
  assert.equal(modeNotice(request, null).tone, 'pending');
  assert.equal(modeNotice(request, { revision: 60, acknowledgedRevision: 59, acknowledgementStatus: 'applied', appliedMode: 'automatic' }).tone, 'pending');
});
test('only matching revision and mode confirm success', () => {
  const ack = { revision: 60, acknowledgedRevision: 60, acknowledgementStatus: 'applied', appliedMode: 'automatic' };
  assert.equal(modeNotice(request, ack).tone, 'success');
  assert.equal(modeNotice(request, { ...ack, appliedMode: 'manual' }).tone, 'pending');
  assert.equal(modeNotice(request, { ...ack, acknowledgementStatus: 'rejected' }).tone, 'error');
  assert.equal(modeNotice(request, { ...ack, revision: 61 }).tone, 'pending');
});
