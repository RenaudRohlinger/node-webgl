#!/usr/bin/env node
// npm install hook: use the shipped prebuilt binary when there is one, otherwise fetch ANGLE and compile.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

try {
  const gypBuild = require('node-gyp-build');
  const prebuilt = gypBuild.path(root);
  console.log(`[node-webgl] using prebuilt binary ${prebuilt}`);
  process.exit(0);
} catch {
  // no prebuild for this platform/runtime: build from source
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, [join(root, 'scripts/fetch-angle.mjs')]);
run('node-gyp', ['rebuild']);
