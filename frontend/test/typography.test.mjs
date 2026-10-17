import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const source = new URL('../src/', import.meta.url);

test('only Inter Regular and Bold font files are imported', () => {
  const main = readFileSync(new URL('main.tsx', source), 'utf8');
  assert.deepEqual([...main.matchAll(/@fontsource\/inter\/latin-(\d+)\.css/g)].map(m => m[1]), ['400', '700']);
});

test('page styles use only regular and bold numeric weights', () => {
  for (const name of readdirSync(source).filter(name => name.endsWith('.css'))) {
    const css = readFileSync(new URL(name, source), 'utf8');
    for (const match of css.matchAll(/font-weight:\s*(\d+)/g)) {
      assert.ok(['400', '700'].includes(match[1]), `${name}: unsupported weight ${match[1]}`);
    }
  }
});

test('Smart Soil uses the shared page heading without a duplicate banner', () => {
  const page = readFileSync(new URL('SmartSoilPage.tsx', source), 'utf8');
  assert.doesNotMatch(page, /smart-soil-eyebrow|Monitoring kondisi & acuan tanaman/);
});
