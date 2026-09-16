// Shared helpers for the node-webgl test suite.
import assert from 'node:assert/strict';
import { createCanvas, init, getDisplayInfo } from '../src/index.ts';

export type AnyGL = any;

/** GL error code -> name, for readable assertion messages. */
export function glErrorName(code: number): string {
  switch (code) {
    case 0: return 'NO_ERROR';
    case 0x0500: return 'INVALID_ENUM';
    case 0x0501: return 'INVALID_VALUE';
    case 0x0502: return 'INVALID_OPERATION';
    case 0x0505: return 'OUT_OF_MEMORY';
    case 0x0506: return 'INVALID_FRAMEBUFFER_OPERATION';
    case 0x9242: return 'CONTEXT_LOST_WEBGL';
    default: return `0x${code.toString(16)}`;
  }
}

/**
 * Creates a context of the given version.
 * Antialiasing defaults to OFF here so pixel reads are exact; pass `{ antialias: true }` to test MSAA.
 */
export function makeGL(version: 1 | 2 = 2, width = 16, height = 16, attrs: Record<string, unknown> = {}): AnyGL {
  const canvas = createCanvas(width, height);
  const gl = canvas.getContext(version === 1 ? 'webgl' : 'webgl2', { antialias: false, ...attrs });
  if (!gl) throw new Error(`failed to create a WebGL ${version} context`);
  return gl;
}

/** Frees the GPU resources of a context created with makeGL(). */
export function dispose(gl: AnyGL): void {
  (gl?.canvas as { dispose?(): void } | null)?.dispose?.();
}

/** Compiles a shader, throwing with the info log on failure. */
export function shader(gl: AnyGL, type: number, source: string): any {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile failed:\n${log}\n--- source ---\n${source}`);
  }
  return s;
}

/** Compiles + links a program, throwing with the info log on failure. */
export function program(gl: AnyGL, vsSource: string, fsSource: string, beforeLink?: (p: any) => void): any {
  const vs = shader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = shader(gl, gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  beforeLink?.(p);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`program link failed:\n${log}`);
  }
  return p;
}

/** Full-viewport 2-triangle strip through `attribName` (defaults to a_position). */
export function drawFullscreenQuad(gl: AnyGL, prog: any, attribName = 'a_position'): void {
  const loc = gl.getAttribLocation(prog, attribName);
  assert.ok(loc >= 0, `attribute ${attribName} not found in program`);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(prog);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(loc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
}

/** Reads one RGBA8 pixel in GL coordinates (origin bottom-left). */
export function readPixel(gl: AnyGL, x = 0, y = 0): number[] {
  const px = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Array.from(px);
}

/** Reads a w*h RGBA8 block in GL coordinates (bottom row first). */
export function readPixels(gl: AnyGL, x: number, y: number, w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

export function assertPixel(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 2, message = ''): void {
  const a = Array.from(actual);
  const e = Array.from(expected);
  const ok = e.length === a.length && e.every((v, i) => Math.abs(a[i] - v) <= tolerance);
  assert.ok(ok, `${message ? message + ': ' : ''}pixel [${a.join(', ')}] != expected [${e.join(', ')}] (tolerance ${tolerance})`);
}

export function assertNoError(gl: AnyGL, message = ''): void {
  const err = gl.getError();
  assert.equal(err, 0, `${message ? message + ': ' : ''}expected NO_ERROR, got ${glErrorName(err)}`);
}

export function assertError(gl: AnyGL, expected: number, message = ''): void {
  const err = gl.getError();
  assert.equal(err, expected, `${message ? message + ': ' : ''}expected ${glErrorName(expected)}, got ${glErrorName(err)}`);
}

/** Drains pending errors so a later assertNoError() is meaningful. */
export function clearErrors(gl: AnyGL): void {
  for (let i = 0; i < 32 && gl.getError() !== 0; i++);
}

// --- GLSL sources -------------------------------------------------------------

/** GLSL ES 1.00 (WebGL 1). */
export const GLSL100 = {
  vsQuad: `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`,
  fsSolid: `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`,
  fsTexture: `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_tex, v_uv); }`,
};

/** GLSL ES 3.00 (WebGL 2). */
export const GLSL300 = {
  vsQuad: `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`,
  fsSolid: `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`,
  fsTexture: `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, v_uv); }`,
};

/** Version-appropriate solid-color program plus its u_color location. */
export function solidProgram(gl: AnyGL, isGL2: boolean): { prog: any; color: any } {
  const src = isGL2 ? GLSL300 : GLSL100;
  const prog = program(gl, src.vsQuad, src.fsSolid);
  return { prog, color: gl.getUniformLocation(prog, 'u_color') };
}

/** Version-appropriate textured program plus its u_tex location. */
export function textureProgram(gl: AnyGL, isGL2: boolean): { prog: any; tex: any } {
  const src = isGL2 ? GLSL300 : GLSL100;
  const prog = program(gl, src.vsQuad, src.fsTexture);
  return { prog, tex: gl.getUniformLocation(prog, 'u_tex') };
}

/** Fills the current draw buffer with a solid color via a shader (not glClear). */
export function shadeSolid(gl: AnyGL, isGL2: boolean, rgba: number[]): void {
  const { prog, color } = solidProgram(gl, isGL2);
  gl.useProgram(prog);
  gl.uniform4f(color, rgba[0], rgba[1], rgba[2], rgba[3]);
  drawFullscreenQuad(gl, prog);
  gl.useProgram(null);
  gl.deleteProgram(prog);
}

/** True when the EGL implementation is ANGLE (WebGL-compatibility validation, requestable extensions). */
export function isANGLE(): boolean {
  init();
  return getDisplayInfo()?.angle ?? true;
}
