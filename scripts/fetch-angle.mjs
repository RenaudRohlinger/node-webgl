#!/usr/bin/env node
// Downloads the prebuilt static ANGLE libraries for this platform into angle/lib/<platform>-<arch>/.
// Source: https://github.com/godotengine/godot-angle-static (Chromium's ANGLE, Metal on macOS, D3D11 on Windows).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANGLE_TAG = process.env.NODE_WEBGL_ANGLE_TAG || 'chromium/7578';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;

const ASSETS = {
  'darwin-arm64': { asset: 'godot-angle-static-arm64-macos-release.zip', suffix: '.macos.arm64.a', ext: '.a' },
  'darwin-x64': { asset: 'godot-angle-static-x86_64-macos-release.zip', suffix: '.macos.x86_64.a', ext: '.a' },
  'win32-x64': { asset: 'godot-angle-static-x86_64-msvc-release.zip', suffix: '.windows.x86_64.lib', ext: '.lib' },
  'win32-arm64': { asset: 'godot-angle-static-arm64-msvc-release.zip', suffix: '.windows.arm64.lib', ext: '.lib' },
};

const key = `${platform}-${arch}`;
const target = join(root, 'angle/lib', key);
const versionFile = join(target, 'VERSION');

if (platform === 'linux') {
  console.log(`[node-webgl] ${key}: no static ANGLE build available; the addon will load libEGL.so/libGLESv2.so at runtime\n` +
    `             (ANGLE from a Chromium/Electron install, or Mesa via NODE_WEBGL_LIBEGL / NODE_WEBGL_LIBGLESV2).`);
  process.exit(0);
}
const spec = ASSETS[key];
if (!spec) {
  console.error(`[node-webgl] no prebuilt ANGLE for ${key}`);
  process.exit(1);
}
if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === ANGLE_TAG) {
  console.log(`[node-webgl] ANGLE ${ANGLE_TAG} already present in angle/lib/${key}`);
  process.exit(0);
}

const url = `https://github.com/godotengine/godot-angle-static/releases/download/${encodeURIComponent(ANGLE_TAG)}/${spec.asset}`;
console.log(`[node-webgl] downloading ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) { console.error(`[node-webgl] download failed: ${res.status} ${res.statusText}`); process.exit(1); }
const zip = Buffer.from(await res.arrayBuffer());
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const zipPath = join(target, 'angle.zip');
writeFileSync(zipPath, zip);
try {
  execFileSync('tar', ['-xf', zipPath, '-C', target], { stdio: 'inherit' }); // bsdtar (macOS, Windows 10+) unzips
} catch {
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', target], { stdio: 'inherit' });
}
rmSync(zipPath);
// Normalize names: libEGL.a, libGLESv2.a, libANGLE.a (or .lib on Windows).
for (const f of readdirSync(target)) {
  const m = /^lib(EGL|GLES|ANGLE)\./.exec(f);
  if (!m) continue;
  const base = m[1] === 'GLES' ? 'libGLESv2' : `lib${m[1]}`;
  renameSync(join(target, f), join(target, base + spec.ext));
}
writeFileSync(versionFile, ANGLE_TAG + '\n');
console.log(`[node-webgl] ANGLE ${ANGLE_TAG} installed in angle/lib/${key}: ${readdirSync(target).join(', ')}`);
