import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('AI operator ACC firmware preflight fails closed and requires STOP on faults', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spff-ai-session-policy-'));
  try {
    execFileSync('g++', [
      '-std=c++11', '-Wall', '-Wextra', '-Werror',
      '-I', resolve('firmware/ai-session-staging'),
      resolve('firmware/test/ai-session-safety-policy.cpp'),
      '-o', join(directory, 'test'),
    ], { stdio: 'pipe' });
    execFileSync(join(directory, 'test'), [], { stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
