// three r186 requires WebGL2, so this one skips three.js entirely and drives raw WebGL 1:
// ANGLE_instanced_arrays + OES_vertex_array_object draw an instanced textured quad (OES_texture_float
// source) into a WEBGL_draw_buffers 2-attachment framebuffer, then both attachments are read back
// with gl.readPixels and composited into one PNG.
import { createWebGLContext, encodeImage } from '../../src/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'webgl1-fallback';
const FBW = 256, FBH = 256;
const t0 = performance.now();

const gl = createWebGLContext(FBW, FBH, { version: 1 });
const instArrays = gl.getExtension('ANGLE_instanced_arrays');
const vaoExt = gl.getExtension('OES_vertex_array_object');
const texFloat = gl.getExtension('OES_texture_float');
const drawBufs = gl.getExtension('WEBGL_draw_buffers');
for (const [name, ext] of [['ANGLE_instanced_arrays', instArrays], ['OES_vertex_array_object', vaoExt], ['OES_texture_float', texFloat], ['WEBGL_draw_buffers', drawBufs]]) {
  if (!ext) throw new Error(`${NAME}: required extension ${name} is not available`);
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${NAME}: shader compile failed: ${gl.getShaderInfoLog(s)}`);
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, `
  attribute vec2 aPos, aUv, aOffset;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = aUv;
    vColor = aColor;
    gl_Position = vec4(aPos * 0.19 + aOffset, 0.0, 1.0);
  }
`));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
  #extension GL_EXT_draw_buffers : require
  precision mediump float;
  varying vec2 vUv;
  varying vec3 vColor;
  uniform sampler2D uTex;
  void main() {
    vec4 texColor = texture2D(uTex, vUv);
    gl_FragData[0] = vec4(texColor.rgb * vColor, 1.0);
    gl_FragData[1] = vec4(1.0 - texColor.rgb * vColor, 1.0);
  }
`));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${NAME}: program link failed: ${gl.getProgramInfoLog(program)}`);
gl.useProgram(program);

// a 4x4 float-texture checkerboard, uploaded via OES_texture_float.
const TS = 4;
const texel = new Float32Array(TS * TS * 4);
for (let i = 0; i < TS * TS; i++) { const v = (i + Math.floor(i / TS)) % 2 ? 1.0 : 0.35; texel.set([v, v, v, 1], i * 4); }
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TS, TS, 0, gl.RGBA, gl.FLOAT, texel);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// geometry + per-instance attributes, captured in a VAO.
const GRID = 4, COUNT = GRID * GRID;
const quad = new Float32Array([-.5, -.5, 0, 0, .5, -.5, 1, 0, .5, .5, 1, 1, -.5, -.5, 0, 0, .5, .5, 1, 1, -.5, .5, 0, 1]);
const offsets = new Float32Array(COUNT * 2);
const colors = new Float32Array(COUNT * 3);
for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
  const i = y * GRID + x;
  offsets.set([-0.7 + (x / (GRID - 1)) * 1.4, -0.7 + (y / (GRID - 1)) * 1.4], i * 2);
  const hue = i / COUNT, k = (n) => (n + hue * 6) % 6;
  const f = (n) => Math.max(0, Math.min(1, Math.min(k(n), 4 - k(n), 1)));
  colors.set([f(5), f(3), f(1)], i * 3);
}
const vao = vaoExt.createVertexArrayOES();
vaoExt.bindVertexArrayOES(vao);
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(program, 'aPos'), aUv = gl.getAttribLocation(program, 'aUv');
gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
const offsetBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf);
gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
const aOffset = gl.getAttribLocation(program, 'aOffset');
gl.enableVertexAttribArray(aOffset); gl.vertexAttribPointer(aOffset, 2, gl.FLOAT, false, 0, 0);
instArrays.vertexAttribDivisorANGLE(aOffset, 1);
const colorBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
const aColor = gl.getAttribLocation(program, 'aColor');
gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);
instArrays.vertexAttribDivisorANGLE(aColor, 1);
vaoExt.bindVertexArrayOES(null);

// a 2-attachment framebuffer.
function targetTexture() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FBW, FBH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}
const tex0 = targetTexture(), tex1 = targetTexture();
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBufs.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, tex0, 0);
gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBufs.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, tex1, 0);
drawBufs.drawBuffersWEBGL([drawBufs.COLOR_ATTACHMENT0_WEBGL, drawBufs.COLOR_ATTACHMENT1_WEBGL]);
if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`${NAME}: MRT framebuffer incomplete`);

gl.viewport(0, 0, FBW, FBH);
gl.clearColor(0.08, 0.09, 0.11, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
vaoExt.bindVertexArrayOES(vao);
instArrays.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, COUNT);
vaoExt.bindVertexArrayOES(null);

function readAttachment(tex) {
  const readFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, readFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const data = new Uint8Array(FBW * FBH * 4);
  gl.readPixels(0, 0, FBW, FBH, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.deleteFramebuffer(readFbo);
  return data;
}
const data0 = readAttachment(tex0);
const data1 = readAttachment(tex1);

// sanity checks: the center of a known instance (index [1,1]) in each attachment, plus the gap
// between instances (background). Pixel coords are derived from that instance's own clip-space
// offset, since with an even GRID no instance sits exactly at the frame's center.
function px(data, x, y) { const i = (y * FBW + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
const bgA = px(data0, 2, 2);
if (!(Math.abs(bgA[0] - 20) < 15 && Math.abs(bgA[1] - 23) < 15)) throw new Error(`${NAME}: expected clear color background in attachment0, got ${bgA}`);
const sampleInstance = 1 * GRID + 1;
const instX = Math.round((offsets[sampleInstance * 2] * 0.5 + 0.5) * FBW);
const instY = Math.round((offsets[sampleInstance * 2 + 1] * 0.5 + 0.5) * FBH);
const centerA = px(data0, instX, instY);
const centerB = px(data1, instX, instY);
if (centerA.slice(0, 3).every((v) => v < 10)) throw new Error(`${NAME}: expected a lit instance at attachment0 center, got ${centerA}`);
const diff = Math.abs(centerA[0] - centerB[0]) + Math.abs(centerA[1] - centerB[1]) + Math.abs(centerA[2] - centerB[2]);
if (diff < 60) throw new Error(`${NAME}: expected attachment0/attachment1 to differ (color vs. inverted color), got ${centerA} vs ${centerB}`);
const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

// compose both attachments side by side (readPixels is bottom-origin; flip rows for a top-down PNG).
const combined = new Uint8Array(FBW * 2 * FBH * 4);
for (let y = 0; y < FBH; y++) {
  const srcY = FBH - 1 - y;
  combined.set(data0.subarray(srcY * FBW * 4, (srcY + 1) * FBW * 4), (y * FBW * 2) * 4);
  combined.set(data1.subarray(srcY * FBW * 4, (srcY + 1) * FBW * 4), (y * FBW * 2 + FBW) * 4);
}
writeFileSync(new URL('../out/webgl1-fallback.png', import.meta.url), encodeImage(FBW * 2, FBH, combined, 'image/png'));
gl.canvas?.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${FBW * 2}x${FBH}`);
