// Framebuffer objects, renderbuffers, attachment queries, depth/stencil, MRT, blits and clearBuffer*.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLFramebuffer, WebGLRenderbuffer, WebGLTexture } from '../src/index.ts';
import { makeGL, dispose, program, drawFullscreenQuad, readPixel, assertPixel, assertNoError, clearErrors, GLSL100, GLSL300, isANGLE } from './helpers.ts';

const INVALID_OPERATION = 0x0502;
const FRAMEBUFFER_DEFAULT = 0x8218;

const VS3 = `#version 300 es
in vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }`;
const FS3 = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`;
const VS1 = `
attribute vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }`;
const FS1 = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`;

/** Draws an axis-aligned quad in NDC at depth z with the given solid color. */
function drawQuad(gl: any, prog: any, color: number[], x0 = -1, y0 = -1, x1 = 1, y1 = 1, z = 0): void {
  gl.useProgram(prog);
  gl.uniform4f(gl.getUniformLocation(prog, 'u_color'), color[0], color[1], color[2], color[3]);
  const loc = gl.getAttribLocation(prog, 'a_position');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, z, x1, y0, z, x0, y1, z, x1, y1, z]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(loc);
  gl.deleteBuffer(buf);
}

function colorTexture(gl: any, w: number, h: number, internal?: number, format?: number, type?: number): any {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal ?? gl.RGBA, w, h, 0, format ?? gl.RGBA, type ?? gl.UNSIGNED_BYTE, null);
  return t;
}

describe('framebuffer objects', () => {
  test('render into a color texture and read it back', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    assert.ok(fb instanceof WebGLFramebuffer);
    assert.equal(gl.isFramebuffer(fb), false, 'not a framebuffer until bound');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    assert.equal(gl.isFramebuffer(fb), true);
    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    gl.viewport(0, 0, 8, 8);
    gl.clearColor(0, 0.5, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [0, 128, 255, 255], 2, 'FBO clear');

    // the canvas is untouched
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 16, 16);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 0, 0], 0, 'the default framebuffer was not written');

    // ...and the texture can then be sampled
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsTexture);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), [0, 128, 255, 255], 2, 'the rendered texture samples back');
    assertNoError(gl);
    dispose(gl);
  });

  test('incomplete framebuffers report a status', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT,
      'an FBO with no attachments is incomplete');

    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    // an unrenderable format is incomplete
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, 8, 8, 0, gl.RGB, gl.FLOAT, null);
    assert.notEqual(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE,
      'RGB32F is not a color-renderable format');
    clearErrors(gl);
    dispose(gl);
  });

  test('WebGL 1 reports FRAMEBUFFER_INCOMPLETE_DIMENSIONS for mismatched attachments', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(1, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 4, 4);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS);
    clearErrors(gl);
    dispose(gl);
  });

  test('framebufferTexture2D / framebufferRenderbuffer on the default framebuffer raise INVALID_OPERATION', () => {
    const gl = makeGL(2, 16, 16);
    const tex = colorTexture(gl, 8, 8);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.getError(), INVALID_OPERATION);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 8, 8);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    assert.equal(gl.getError(), INVALID_OPERATION);
    dispose(gl);
  });

  test('deleting the bound framebuffer restores the default one', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), fb);

    gl.deleteFramebuffer(fb);
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null, 'the default framebuffer is bound again');
    assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), null);
    assert.equal(gl.isFramebuffer(fb), false);

    gl.viewport(0, 0, 16, 16);
    gl.clearColor(1, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 255, 255], 0, 'drawing lands on the canvas again');
    assertNoError(gl);
    dispose(gl);
  });
});

describe('renderbuffers', () => {
  test('WebGL 1 renderbuffer formats', () => {
    const gl = makeGL(1, 16, 16);
    const rb = gl.createRenderbuffer();
    assert.ok(rb instanceof WebGLRenderbuffer);
    assert.equal(gl.isRenderbuffer(rb), false);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    assert.equal(gl.isRenderbuffer(rb), true);
    assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), rb);

    for (const fmt of ['RGBA4', 'RGB565', 'RGB5_A1', 'DEPTH_COMPONENT16', 'STENCIL_INDEX8', 'DEPTH_STENCIL'] as const) {
      gl.renderbufferStorage(gl.RENDERBUFFER, (gl as any)[fmt], 8, 4);
      assertNoError(gl, `renderbufferStorage(${fmt})`);
      assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH), 8, fmt);
      assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_HEIGHT), 4, fmt);
      assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT), (gl as any)[fmt],
        `${fmt} reads back its own internal format`);
    }
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_DEPTH_SIZE), 24);
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_STENCIL_SIZE), 8);

    // WebGL 1 rejects sized color formats it does not know
    gl.renderbufferStorage(gl.RENDERBUFFER, 0x8058 /* RGBA8 */, 8, 8);
    assert.equal(gl.getError(), 0x0500, 'RGBA8 is not a WebGL 1 renderbuffer format');
    dispose(gl);
  });

  test('WebGL 2 sized renderbuffer formats and a color render target', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 8, 8);
    assertNoError(gl);
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT), gl.RGBA8);
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_RED_SIZE), 8);
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES), 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);

    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 8, 8);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    gl.viewport(0, 0, 8, 8);
    gl.clearColor(0.25, 0.75, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [64, 191, 128, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('getFramebufferAttachmentParameter', () => {
  test('texture and renderbuffer attachments report identity and type', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.TEXTURE);
    const name = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
    assert.equal(name, tex, 'OBJECT_NAME returns the WebGLTexture itself');
    assert.ok(name instanceof WebGLTexture);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL), 0);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE), 0);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE), 8);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE), gl.UNSIGNED_NORMALIZED);

    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 8, 8);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.RENDERBUFFER);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), rb);

    // detaching reports NONE
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), null);
    assertNoError(gl);
    dispose(gl);
  });

  test('WebGL 2 default framebuffer reports FRAMEBUFFER_DEFAULT for BACK / DEPTH / STENCIL', () => {
    const gl = makeGL(2, 16, 16, { depth: true, stencil: true });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const a of ['BACK', 'DEPTH', 'STENCIL'] as const) {
      assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, (gl as any)[a], gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE),
        FRAMEBUFFER_DEFAULT, `${a} is a default-framebuffer attachment`);
    }
    assert.ok(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.BACK, gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE) >= 8);
    assert.ok(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE) >= 16);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.STENCIL, gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE), 8);
    // OBJECT_NAME is not meaningful for the default framebuffer
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.BACK, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), null);
    assert.equal(gl.getError(), 0x0500);
    dispose(gl);
  });

  test('a stencil-less default framebuffer reports NONE for STENCIL', () => {
    const gl = makeGL(2, 8, 8, { depth: false, stencil: false });
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.STENCIL, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
    assertNoError(gl);
    dispose(gl);
  });

  test('WebGL 1 rejects default-framebuffer attachment queries', () => {
    const gl = makeGL(1, 8, 8);
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), null);
    assert.equal(gl.getError(), INVALID_OPERATION);
    dispose(gl);
  });
});

describe('depth and stencil', () => {
  test('depth testing works and the depth texture can be sampled (WebGL 2)', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    const depth = colorTexture(gl, 16, 16, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    assertNoError(gl, 'DEPTH_COMPONENT24 texture attachment');

    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    const p = program(gl, VS3, FS3);
    drawQuad(gl, p, [1, 0, 0, 1], -1, -1, 1, 1, 0.0);   // z = 0 -> window depth 0.5
    drawQuad(gl, p, [0, 1, 0, 1], -1, -1, 0, 1, 0.5);   // behind: rejected
    drawQuad(gl, p, [0, 0, 1, 1], 0, -1, 1, 1, -0.5);   // in front: accepted on the right half
    assertPixel(readPixel(gl, 4, 8), [255, 0, 0, 255], 2, 'the further quad was depth-rejected');
    assertPixel(readPixel(gl, 12, 8), [0, 0, 255, 255], 2, 'the nearer quad won');
    gl.disable(gl.DEPTH_TEST);

    // sample the depth texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 16, 16);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depth);
    const dp = program(gl, GLSL300.vsQuad, `#version 300 es
precision highp float;
uniform highp sampler2D u_depth;
in vec2 v_uv;
out vec4 fragColor;
void main() { float d = texture(u_depth, v_uv).r; fragColor = vec4(d, d, d, 1.0); }`);
    gl.useProgram(dp);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_depth'), 0);
    drawFullscreenQuad(gl, dp);
    assertPixel(readPixel(gl, 4, 8), [128, 128, 128, 255], 3, 'left half stored window depth 0.5');
    assertPixel(readPixel(gl, 12, 8), [64, 64, 64, 255], 3, 'right half stored window depth 0.25');
    assertNoError(gl);
    dispose(gl);
  });

  test('WEBGL_depth_texture on WebGL 1', (t) => {
    const gl = makeGL(1, 16, 16);
    const ext = gl.getExtension('WEBGL_depth_texture');
    if (!ext) return void t.skip('WEBGL_depth_texture unavailable');
    assert.equal(ext.UNSIGNED_INT_24_8_WEBGL, 0x84fa);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    const depth = colorTexture(gl, 16, 16, gl.DEPTH_COMPONENT, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    assertNoError(gl, 'DEPTH_COMPONENT texture attachment');

    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const p = program(gl, VS1, FS1);
    drawQuad(gl, p, [1, 0, 0, 1], -1, -1, 1, 1, 0.0);
    drawQuad(gl, p, [0, 1, 0, 1], -1, -1, 1, 1, 0.5);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 2, 'the further quad is rejected');
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, depth);
    const dp = program(gl, GLSL100.vsQuad, `
precision mediump float;
uniform sampler2D u_depth;
varying vec2 v_uv;
void main() { float d = texture2D(u_depth, v_uv).r; gl_FragColor = vec4(d, d, d, 1.0); }`);
    gl.useProgram(dp);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_depth'), 0);
    drawFullscreenQuad(gl, dp);
    assertPixel(readPixel(gl, 8, 8), [128, 128, 128, 255], 3, 'depth texture holds 0.5');
    assertNoError(gl);
    dispose(gl);
  });

  test('stencil testing masks drawing', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    const ds = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, ds);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 16, 16);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    const p = program(gl, VS3, FS3);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
    drawQuad(gl, p, [1, 1, 1, 1], -1, -1, 0, 1);       // stamp stencil=1 on the left half
    gl.colorMask(true, true, true, true);

    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    drawQuad(gl, p, [0, 1, 0, 1], -1, -1, 1, 1);       // only the stencilled half is painted
    assertPixel(readPixel(gl, 4, 8), [0, 255, 0, 255], 2, 'stencil == 1 passes');
    assertPixel(readPixel(gl, 12, 8), [0, 0, 0, 255], 2, 'stencil == 0 fails');

    assert.equal(gl.getParameter(gl.STENCIL_FUNC), gl.EQUAL);
    assert.equal(gl.getParameter(gl.STENCIL_REF), 1);
    assert.equal(gl.getParameter(gl.STENCIL_VALUE_MASK), 0xff);
    gl.disable(gl.STENCIL_TEST);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('multiple render targets', () => {
  test('WebGL 2 drawBuffers writes two attachments', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const t0 = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
    const t1 = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.COLOR_ATTACHMENT0);
    assert.equal(gl.getParameter(gl.DRAW_BUFFER1), gl.COLOR_ATTACHMENT1);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() { o0 = vec4(1.0, 0.0, 0.0, 1.0); o1 = vec4(0.0, 0.0, 1.0, 1.0); }`);
    gl.viewport(0, 0, 8, 8);
    gl.useProgram(p);
    drawFullscreenQuad(gl, p);

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255], 2, 'attachment 0');
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    assertPixel(readPixel(gl, 4, 4), [0, 0, 255, 255], 2, 'attachment 1');
    assert.equal(gl.getParameter(gl.READ_BUFFER), gl.COLOR_ATTACHMENT1);
    assertNoError(gl);
    dispose(gl);
  });

  test('WEBGL_draw_buffers on WebGL 1', (t) => {
    const gl = makeGL(1, 16, 16);
    const ext = gl.getExtension('WEBGL_draw_buffers');
    if (!ext) return void t.skip('WEBGL_draw_buffers unavailable');

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const t0 = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, t0, 0);
    const t1 = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, t1, 0);
    ext.drawBuffersWEBGL([ext.COLOR_ATTACHMENT0_WEBGL, ext.COLOR_ATTACHMENT1_WEBGL]);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    const p = program(gl, GLSL100.vsQuad, `#extension GL_EXT_draw_buffers : require
precision mediump float;
void main() {
  gl_FragData[0] = vec4(1.0, 1.0, 0.0, 1.0);
  gl_FragData[1] = vec4(0.0, 1.0, 1.0, 1.0);
}`);
    gl.viewport(0, 0, 8, 8);
    gl.useProgram(p);
    drawFullscreenQuad(gl, p);
    assertNoError(gl, 'MRT draw');
    assertPixel(readPixel(gl, 4, 4), [255, 255, 0, 255], 2, 'attachment 0 through the default read buffer');

    // WebGL 1 has no readBuffer: re-attach t1 as attachment 0 in a second FBO to read it
    const fb2 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    assertPixel(readPixel(gl, 4, 4), [0, 255, 255, 255], 2, 'attachment 1');
    assertNoError(gl);
    dispose(gl);
  });

  test('readBuffer(BACK) and drawBuffers([BACK]) on the default framebuffer', () => {
    const gl = makeGL(2, 16, 16);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readBuffer(gl.BACK);
    assertNoError(gl, 'readBuffer(BACK)');
    assert.equal(gl.getParameter(gl.READ_BUFFER), gl.BACK);
    gl.drawBuffers([gl.BACK]);
    assertNoError(gl, 'drawBuffers([BACK])');
    assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.BACK);

    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0);

    // drawBuffers([NONE]) suppresses colour writes
    gl.drawBuffers([gl.NONE]);
    assertNoError(gl);
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0, 'writes are dropped with DRAW_BUFFER0 = NONE');
    gl.drawBuffers([gl.BACK]);

    // anything else is invalid on the default framebuffer
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    assert.equal(gl.getError(), INVALID_OPERATION);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    assert.equal(gl.getError(), INVALID_OPERATION);
    dispose(gl);
  });
});

describe('blits and multisampling', () => {
  test('blitFramebuffer copies an FBO onto the canvas', () => {
    const gl = makeGL(2, 16, 16);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    assertNoError(gl, 'blit FBO -> default');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    assertPixel(readPixel(gl, 8, 8), [0, 255, 255, 255], 2);
    dispose(gl);
  });

  test('blit from the antialiased default framebuffer to an FBO and back', () => {
    const gl = makeGL(2, 16, 16, { antialias: true });
    assert.ok(gl.getParameter(gl.SAMPLES) > 0, 'this test needs MSAA');
    gl.clearColor(1, 0.5, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    assertNoError(gl, 'blit MSAA default -> FBO');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    assertPixel(readPixel(gl, 8, 8), [255, 128, 0, 255], 2, 'the resolved canvas content arrived in the FBO');

    // ES 3.0 forbids blitting *into* a multisampled draw framebuffer, and the antialiased
    // default framebuffer is exactly that.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    assert.equal(gl.getError(), INVALID_OPERATION, 'blitting into the MSAA default framebuffer is invalid');
    dispose(gl);
  });

  test('blit an FBO back onto a non-antialiased default framebuffer', () => {
    const gl = makeGL(2, 16, 16, { antialias: false });
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    assertNoError(gl, 'blit FBO -> default');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 255, 255], 2, 'the canvas shows the blitted color');

    // a scaled blit with LINEAR filtering also works
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, 8, 8, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    assertNoError(gl, 'scaled LINEAR blit');
    dispose(gl);
  });

  test('renderbufferStorageMultisample + resolve blit', () => {
    const gl = makeGL(2, 16, 16);
    const samples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
    assert.ok(samples instanceof Int32Array, 'getInternalformatParameter returns an Int32Array');
    assert.ok(samples.length > 0 && samples[0] > 1, `supported sample counts: ${Array.from(samples)}`);

    const msFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
    const msRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, 16, 16);
    assertNoError(gl, 'renderbufferStorageMultisample');
    assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES), 4);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msRb);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0.5, 0, 0.25, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const resolveFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFb);
    const tex = colorTexture(gl, 16, 16);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFb);
    gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    assertNoError(gl, 'resolve blit');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolveFb);
    assertPixel(readPixel(gl, 8, 8), [128, 0, 64, 255], 2);
    dispose(gl);
  });

  test('invalidateFramebuffer and invalidateSubFramebuffer do not error', () => {
    const gl = makeGL(2, 16, 16);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR]);
    assertNoError(gl, 'invalidate default COLOR');
    gl.invalidateSubFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH], 0, 0, 4, 4);
    assertNoError(gl, 'invalidateSub default DEPTH');

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 8, 8);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
    assertNoError(gl, 'invalidate an FBO attachment');
    dispose(gl);
  });
});

describe('float render targets', () => {
  test('EXT_color_buffer_float renders to RGBA32F and reads FLOAT pixels', (t) => {
    const gl = makeGL(2, 16, 16);
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) return void t.skip('EXT_color_buffer_float unavailable');

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = colorTexture(gl, 8, 8, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'RGBA32F is color-renderable');
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE), gl.FLOAT);

    gl.viewport(0, 0, 8, 8);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 2.5, -1.25, 100, 1);
    drawFullscreenQuad(gl, p);
    assertNoError(gl, 'render to RGBA32F');

    const px = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    assertNoError(gl, 'readPixels RGBA/FLOAT');
    assert.ok(Math.abs(px[0] - 2.5) < 1e-4, `r = ${px[0]}`);
    assert.ok(Math.abs(px[1] + 1.25) < 1e-4, `g = ${px[1]}`);
    assert.ok(Math.abs(px[2] - 100) < 1e-3, `b = ${px[2]}`);
    assert.equal(px[3], 1);

    // clearBufferfv also works on a float target
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([7, 8, 9, 1]));
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    assert.deepEqual(Array.from(px), [7, 8, 9, 1]);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('scissor and clearBuffer*', () => {
  test('the scissor box limits clears and draws', () => {
    const gl = makeGL(2, 16, 16);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assert.equal(gl.isEnabled(gl.SCISSOR_TEST), false);
    gl.enable(gl.SCISSOR_TEST);
    assert.equal(gl.isEnabled(gl.SCISSOR_TEST), true);
    gl.scissor(4, 4, 8, 8);
    assert.deepEqual(Array.from(gl.getParameter(gl.SCISSOR_BOX)), [4, 4, 8, 8]);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0, 'inside the scissor box');
    assertPixel(readPixel(gl, 1, 1), [0, 0, 0, 255], 0, 'outside the scissor box');

    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 0, 1, 1);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 255, 255], 0, 'draws are scissored too');
    assertPixel(readPixel(gl, 1, 1), [0, 0, 0, 255], 0);
    gl.disable(gl.SCISSOR_TEST);
    assertNoError(gl);
    dispose(gl);
  });

  test('clearBufferfv / iv / uiv / fi', () => {
    const gl = makeGL(2, 16, 16);
    gl.clearBufferfv(gl.COLOR, 0, [0.25, 0.5, 0.75, 1]);
    assertNoError(gl, 'clearBufferfv on the default framebuffer');
    assertPixel(readPixel(gl, 8, 8), [64, 128, 191, 255], 2);

    gl.clearBufferfv(gl.COLOR, 0, [1, 1, 1]);
    assert.equal(gl.getError(), 0x0501, 'COLOR needs four components');

    // integer attachments
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const ti = colorTexture(gl, 4, 4, gl.RGBA32I, gl.RGBA_INTEGER, gl.INT);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ti, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    gl.viewport(0, 0, 4, 4);
    gl.clearBufferiv(gl.COLOR, 0, new Int32Array([-5, 6, -7, 8]));
    assertNoError(gl, 'clearBufferiv');
    const gotI = new Int32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.INT, gotI);
    assert.deepEqual(Array.from(gotI), [-5, 6, -7, 8]);

    const tu = colorTexture(gl, 4, 4, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tu, 0);
    gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([1, 2, 3, 4]));
    assertNoError(gl, 'clearBufferuiv');
    const gotU = new Uint32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, gotU);
    assert.deepEqual(Array.from(gotU), [1, 2, 3, 4]);

    // depth/stencil
    const ds = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, ds);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 4, 4);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds);
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 0.5, 3);
    assertNoError(gl, 'clearBufferfi');
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    assertNoError(gl, 'clearBufferfv(DEPTH)');
    gl.clearBufferiv(gl.STENCIL, 0, [0]);
    assertNoError(gl, 'clearBufferiv(STENCIL)');
    dispose(gl);
  });
});
