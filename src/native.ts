import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeGL, Ptr } from './native-api.ts';

export interface DisplayInfo {
  /** ANGLE backend actually in use: "metal", "gl", "d3d11", "vulkan", "swiftshader", ... */
  backend: string;
  vendor: string;
  version: string;
  extensions: string;
  surfaceless: boolean;
  /** True when libEGL/libGLESv2 were loaded at runtime instead of the statically linked ANGLE. */
  dynamic: boolean;
  /** True when the EGL implementation is ANGLE (WebGL-compatibility validation available). */
  angle: boolean;
}

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8, straight (non-premultiplied) alpha, top row first. */
  data: Uint8Array;
  hasAlpha: boolean;
}

export interface NativeContextOptions {
  major: number;
  minor?: number;
  webgl?: boolean;
  robustness?: boolean;
  robustResourceInit?: boolean;
  extensionsEnabled?: boolean;
  powerPreference?: 'default' | 'low-power' | 'high-performance';
}

export interface NativeCore {
  init(options?: { backend?: string }): DisplayInfo;
  createContext(options: NativeContextOptions): number;
  makeCurrent(handle: number): boolean;
  destroyContext(handle: number): void;
  getBufferSubData(target: number, srcByteOffset: number, dst: Ptr, dstByteOffset: number, byteLength: number): boolean;
  loadedFunctions(): string[];
  hasProc(name: string): boolean;
  decodeImage?(bytes: ArrayBufferView | ArrayBuffer): DecodedImage;
  encodeImage?(width: number, height: number, rgba: Uint8Array, mime: string, quality: number): Uint8Array;
}

export type Native = NativeGL & NativeCore;

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let native: Native | null = null;
let display: DisplayInfo | null = null;
let loadedFns: Set<string> | null = null;

export interface InitOptions {
  /** Force an ANGLE backend. Defaults to the platform's native API (Metal / D3D11 / Vulkan), overridable with NODE_WEBGL_BACKEND. */
  backend?: 'default' | 'metal' | 'gl' | 'gles' | 'vulkan' | 'swiftshader' | 'd3d11' | 'null';
}

/** Loads the addon (prebuilt or locally compiled). */
export function loadNative(): Native {
  if (native) return native;
  const gypBuild = require('node-gyp-build') as (dir: string) => Native;
  native = gypBuild(packageRoot);
  return native;
}

/** Initializes the EGL display. Called automatically by the first context; call it early to pick a backend. */
export function init(options: InitOptions = {}): DisplayInfo {
  const n = loadNative();
  if (!display) display = n.init(options);
  return display;
}

export function getDisplayInfo(): DisplayInfo | null {
  return display;
}

/** True when the GL entry point resolved in this ANGLE build (extension availability probing). */
export function hasNativeFunction(glName: string): boolean {
  if (!loadedFns) loadedFns = new Set(loadNative().loadedFunctions());
  return loadedFns.has(glName);
}

/** Resets the cached loaded-function set (after the first context loads the GL table). */
export function refreshNativeFunctions(): void {
  loadedFns = null;
}
