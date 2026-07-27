import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await cp(resolve(root, 'frontend', 'dist'), output, { recursive: true });
await mkdir(resolve(output, 'server'), { recursive: true });
await cp(resolve(root, 'sites', 'worker.mjs'), resolve(output, 'server', 'index.js'));
