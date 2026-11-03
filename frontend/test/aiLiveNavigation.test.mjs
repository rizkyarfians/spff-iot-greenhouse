import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

test('AI LIVE is a dedicated left-sidebar route with a distinct page title', () => {
  assert.match(read('pageConfig.ts'), /\| 'ai-live'/);
  assert.match(read('pageConfig.ts'), /'ai-live': 'AI LIVE'/);
  assert.match(read('App.tsx'), /key:'ai-live',icon:ShieldAlert,label:'AI LIVE'/);
  assert.match(read('SecondaryPages.tsx'), /page === 'ai-live'.*<AiLivePage \/>/);
});

test('read-only AI recommendations are separate from the AI ACC controls', () => {
  assert.doesNotMatch(read('UnifiedAiNeedsPage.tsx'), /AiOperatorAccPanel/);
  assert.match(read('AiLivePage.tsx'), /<AiOperatorAccPanel report=\{report\}\s*\/>/);
  assert.match(read('AiLivePage.tsx'), /setReport\(null\)/);
});

test('AI LIVE page does not publish pump commands when opened', () => {
  const page = read('AiLivePage.tsx');
  assert.doesNotMatch(page, /startAiAccWaterTrial|publishCommand|updateActuator/);
  assert.match(page, /fetchUnifiedAiDashboard/);
});
