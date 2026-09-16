// Runs every examples/three/*.mjs script as its own child process (so a crash or a leaked GPU
// context in one example can't affect another), sequentially, and reports timing + pass/fail.
// Exit code is 1 if any example failed. Usage: `node examples/run-all.mjs` (or `npm run examples`).
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examplesDir = new URL('./three/', import.meta.url);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

const files = readdirSync(examplesDir).filter((f) => f.endsWith('.mjs')).sort();
if (files.length === 0) {
  console.error('run-all: no examples found in examples/three/');
  process.exit(1);
}

const results = [];
for (const file of files) {
  const name = file.replace(/\.mjs$/, '');
  const path = fileURLToPath(new URL(file, examplesDir));
  const t0 = performance.now();
  const proc = spawnSync(process.execPath, [path], { encoding: 'utf8' });
  const ms = performance.now() - t0;
  const ok = proc.status === 0;
  results.push({ name, ok, ms });

  const stdout = (proc.stdout ?? '').trim();
  if (stdout) process.stdout.write(stdout.split('\n').map((l) => `  ${l}`).join('\n') + '\n');
  if (!ok) {
    const stderr = (proc.stderr ?? proc.error?.message ?? '').trim();
    if (stderr) process.stderr.write(stderr.split('\n').map((l) => `  ${l}`).join('\n') + '\n');
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(20)} ${ms.toFixed(0)}ms`);
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

console.log('-'.repeat(40));
console.log(`${results.length} examples, ${passed} passed, ${failed} failed, ${totalMs.toFixed(0)}ms total`);
if (failed > 0) {
  console.log('failed:', results.filter((r) => !r.ok).map((r) => r.name).join(', '));
}

process.exit(failed > 0 ? 1 : 0);
