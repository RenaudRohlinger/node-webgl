// Fixed-function state: blending, masks, culling, primitives, stencil ops, caps and hints.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeGL, dispose, program, drawFullscreenQuad, readPixel, readPixels, assertPixel, assertNoError, clearErrors, GLSL100, GLSL300 } from './helpers.ts';
import { getDisplayInfo } from '../src/index.ts';

const INVALID_ENUM = 0x0500;

const VS3 = `#version 300 es
in vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }`;
const FS3 = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`;

/** Draws a triangle strip / fan / line / point list from raw NDC vec3 data. */
function drawPrim(gl: any, prog: any, mode: number, verts: number[], color: number[], count?: number): void {
  gl.useProgram(prog);
  gl.uniform4f(gl.getUniformLocation(prog, 'u_color'), color[0], color[1], color[2], color[3]);
  const loc = gl.getAttribLocation(prog, 'a_position');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(mode, 0, count ?? verts.length / 3);
  gl.disableVertexAttribArray(loc);
  gl.deleteBuffer(buf);
}

const FULL_QUAD = [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0];

/** Clears to `dst`, draws a full-screen `src` quad and returns the resulting centre pixel. */
function blendPixel(gl: any, prog: any, dst: number[], src: number[]): number[] {
  gl.clearColor(dst[0], dst[1], dst[2], dst[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawPrim(gl, prog, gl.TRIANGLE_STRIP, FULL_QUAD, src);
  return readPixel(gl, 8, 8);
}

describe('blending', () => {
  test('blendFunc(ONE, ONE) adds source and destination', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.enable(gl.BLEND);
    assert.equal(gl.isEnabled(gl.BLEND), true);
    gl.blendFunc(gl.ONE, gl.ONE);
    assert.equal(gl.getParameter(gl.BLEND_SRC_RGB), gl.ONE);
    assert.equal(gl.getParameter(gl.BLEND_DST_RGB), gl.ONE);
    assertPixel(blendPixel(gl, p, [0.25, 0.25, 0.25, 1], [0.25, 0.5, 0, 0]), [128, 191, 64, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });

  test('blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) composites', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // rgb = 1*0.5 + 0*0.5 = 0.5 ; a = 0.5*0.5 + 1*0.5 = 0.75
    assertPixel(blendPixel(gl, p, [0, 0, 0, 1], [1, 0, 0, 0.5]), [128, 0, 0, 191], 2);
    dispose(gl);
  });

  test('blendFuncSeparate splits rgb and alpha', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ZERO, gl.ONE);
    assert.equal(gl.getParameter(gl.BLEND_SRC_RGB), gl.ONE);
    assert.equal(gl.getParameter(gl.BLEND_DST_RGB), gl.ZERO);
    assert.equal(gl.getParameter(gl.BLEND_SRC_ALPHA), gl.ZERO);
    assert.equal(gl.getParameter(gl.BLEND_DST_ALPHA), gl.ONE);
    // rgb = src, alpha = dst
    assertPixel(blendPixel(gl, p, [0, 0, 0, 1], [1, 0, 0, 0.25]), [255, 0, 0, 255], 2);
    dispose(gl);
  });

  test('blendEquation FUNC_REVERSE_SUBTRACT, MIN and MAX', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB), gl.FUNC_REVERSE_SUBTRACT);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_ALPHA), gl.FUNC_REVERSE_SUBTRACT);
    // dst - src = 0.75 - 0.25 = 0.5
    assertPixel(blendPixel(gl, p, [0.75, 0.75, 0.75, 1], [0.25, 0.25, 0.25, 0]), [128, 128, 128, 255], 2);

    gl.blendEquationSeparate(gl.MIN, gl.FUNC_ADD);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB), gl.MIN);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_ALPHA), gl.FUNC_ADD);
    assertPixel(blendPixel(gl, p, [0.25, 0.75, 0.5, 1], [0.5, 0.5, 0.5, 0]), [64, 128, 128, 255], 2, 'MIN');

    gl.blendEquation(gl.MAX);
    assertPixel(blendPixel(gl, p, [0.25, 0.75, 0.5, 1], [0.5, 0.5, 0.5, 1]), [128, 191, 128, 255], 2, 'MAX');

    gl.blendEquation(gl.FUNC_ADD);
    assertNoError(gl);
    dispose(gl);
  });

  test('EXT_blend_minmax gives MIN/MAX on WebGL 1', (t) => {
    const gl = makeGL(1, 16, 16);
    const ext = gl.getExtension('EXT_blend_minmax');
    if (!ext) return void t.skip('EXT_blend_minmax unavailable');
    assert.equal(ext.MIN_EXT, 0x8007);
    assert.equal(ext.MAX_EXT, 0x8008);
    const p = program(gl, `
attribute vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }`, `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(ext.MAX_EXT);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB), ext.MAX_EXT);
    assertPixel(blendPixel(gl, p, [0.25, 0.75, 0.5, 1], [0.5, 0.5, 0.5, 1]), [128, 191, 128, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });

  test('blendColor feeds CONSTANT_COLOR', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.enable(gl.BLEND);
    gl.blendColor(0.5, 0.5, 0.5, 1);
    assert.deepEqual(Array.from(gl.getParameter(gl.BLEND_COLOR)), [0.5, 0.5, 0.5, 1]);
    gl.blendFunc(gl.CONSTANT_COLOR, gl.ZERO);
    assertPixel(blendPixel(gl, p, [0, 0, 0, 1], [1, 1, 0, 1]), [128, 128, 0, 255], 2);
    gl.blendFunc(gl.ONE_MINUS_CONSTANT_ALPHA, gl.ZERO);
    assertPixel(blendPixel(gl, p, [0, 0, 0, 1], [1, 1, 0, 1]), [0, 0, 0, 0], 2, '1 - constant alpha = 0');
    dispose(gl);
  });
});

describe('write masks', () => {
  test('colorMask gates channels for clears and draws', () => {
    const gl = makeGL(2, 16, 16);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.colorMask(true, false, false, true);
    assert.deepEqual(gl.getParameter(gl.COLOR_WRITEMASK), [true, false, false, true]);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0, 'only red survived the clear');

    const p = program(gl, VS3, FS3);
    gl.colorMask(false, true, false, true);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 1, 1, 1]);
    assertPixel(readPixel(gl, 8, 8), [255, 255, 0, 255], 0, 'the draw only added green');
    gl.colorMask(true, true, true, true);
    assertNoError(gl);
    dispose(gl);
  });

  test('depthMask(false) keeps the depth buffer unchanged', () => {
    const gl = makeGL(2, 16, 16, { depth: true });
    const p = program(gl, VS3, FS3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.depthMask(false);
    assert.equal(gl.getParameter(gl.DEPTH_WRITEMASK), false);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, [-1, -1, -0.5, 1, -1, -0.5, -1, 1, -0.5, 1, 1, -0.5], [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 2, 'the near quad was drawn');
    // depth was not written, so a farther quad still passes LESS against the cleared 1.0
    drawPrim(gl, p, gl.TRIANGLE_STRIP, [-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5, 1, 1, 0.5], [0, 1, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [0, 255, 0, 255], 2, 'the farther quad passes because depth was masked');

    gl.depthMask(true);
    assert.equal(gl.getParameter(gl.DEPTH_WRITEMASK), true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, [-1, -1, -0.5, 1, -1, -0.5, -1, 1, -0.5, 1, 1, -0.5], [1, 0, 0, 1]);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, [-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5, 1, 1, 0.5], [0, 1, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 2, 'with depth writes on, the farther quad is rejected');
    gl.disable(gl.DEPTH_TEST);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('culling', () => {
  test('cullFace and frontFace decide which winding survives', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    // counter-clockwise triangle covering the whole viewport
    const ccw = [-1, -1, 0, 3, -1, 0, -1, 3, 0];
    const clear = () => { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); };

    assert.equal(gl.isEnabled(gl.CULL_FACE), false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    assert.equal(gl.getParameter(gl.CULL_FACE_MODE), gl.BACK);
    assert.equal(gl.getParameter(gl.FRONT_FACE), gl.CCW);
    clear();
    drawPrim(gl, p, gl.TRIANGLES, ccw, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255], 2, 'CCW triangle is front-facing by default');

    gl.frontFace(gl.CW);
    assert.equal(gl.getParameter(gl.FRONT_FACE), gl.CW);
    clear();
    drawPrim(gl, p, gl.TRIANGLES, ccw, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 4, 4), [0, 0, 0, 255], 2, 'the same triangle is now back-facing and culled');

    gl.cullFace(gl.FRONT);
    clear();
    drawPrim(gl, p, gl.TRIANGLES, ccw, [0, 1, 0, 1]);
    assertPixel(readPixel(gl, 4, 4), [0, 255, 0, 255], 2, 'culling FRONT lets it through again');

    gl.cullFace(gl.FRONT_AND_BACK);
    clear();
    drawPrim(gl, p, gl.TRIANGLES, ccw, [0, 0, 1, 1]);
    assertPixel(readPixel(gl, 4, 4), [0, 0, 0, 255], 2, 'FRONT_AND_BACK culls everything');

    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    assertNoError(gl);
    dispose(gl);
  });

  test('polygonOffset state round-trips', () => {
    const gl = makeGL(2, 8, 8);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    assert.equal(gl.isEnabled(gl.POLYGON_OFFSET_FILL), true);
    gl.polygonOffset(1.5, 2);
    assert.equal(gl.getParameter(gl.POLYGON_OFFSET_FACTOR), 1.5);
    assert.equal(gl.getParameter(gl.POLYGON_OFFSET_UNITS), 2);
    const p = program(gl, VS3, FS3);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 1, 1, 1]);
    assertNoError(gl, 'drawing with polygon offset enabled');
    gl.disable(gl.POLYGON_OFFSET_FILL);
    dispose(gl);
  });
});

describe('viewport and primitives', () => {
  test('viewport limits where geometry lands', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, 8, 16);
    assert.deepEqual(Array.from(gl.getParameter(gl.VIEWPORT)), [0, 0, 8, 16]);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 4, 8), [255, 0, 0, 255], 0, 'inside the viewport');
    assertPixel(readPixel(gl, 12, 8), [0, 0, 0, 255], 0, 'outside the viewport');
    gl.viewport(0, 0, 16, 16);
    assertNoError(gl);
    dispose(gl);
  });

  test('POINTS honour gl_PointSize', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, `#version 300 es
in vec3 a_position;
void main() { gl_PointSize = 8.0; gl_Position = vec4(a_position, 1.0); }`, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.POINTS, [0, 0, 0], [1, 1, 0, 1], 1);
    assertNoError(gl, 'drawArrays(POINTS)');
    assertPixel(readPixel(gl, 8, 8), [255, 255, 0, 255], 2, 'the point covers the centre');
    assertPixel(readPixel(gl, 1, 1), [0, 0, 0, 255], 0, 'the corner is untouched');
    assertPixel(readPixel(gl, 8, 1), [0, 0, 0, 255], 0, 'an 8px point does not reach the bottom edge');
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    assert.ok(range[1] >= 8, `ALIASED_POINT_SIZE_RANGE = ${Array.from(range)}`);
    dispose(gl);
  });

  test('LINES and LINE_STRIP rasterise', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.lineWidth(1);
    assert.equal(gl.getParameter(gl.LINE_WIDTH), 1);
    drawPrim(gl, p, gl.LINES, [-1, 0, 0, 1, 0, 0], [0, 1, 1, 1]);
    assertNoError(gl, 'drawArrays(LINES)');
    const col = readPixels(gl, 8, 0, 1, 16);
    let lit = 0;
    for (let y = 0; y < 16; y++) if (col[y * 4 + 1] > 128) lit++;
    assert.ok(lit >= 1 && lit <= 2, `a 1px horizontal line lit ${lit} rows of the column`);
    assertPixel(readPixel(gl, 8, 0), [0, 0, 0, 255], 0, 'the bottom row is untouched');

    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.LINE_STRIP, [-1, -0.9, 0, 1, -0.9, 0, 1, 0.9, 0], [1, 0, 1, 1]);
    assertNoError(gl, 'drawArrays(LINE_STRIP)');
    const all = readPixels(gl, 0, 0, 16, 16);
    let painted = 0;
    for (let i = 0; i < 16 * 16; i++) if (all[i * 4] > 128) painted++;
    assert.ok(painted > 10, `LINE_STRIP painted ${painted} pixels`);
    dispose(gl);
  });

  test('TRIANGLE_STRIP and TRIANGLE_FAN cover the viewport', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0, 'TRIANGLE_STRIP');

    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.TRIANGLE_FAN, [0, 0, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0], [0, 1, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [0, 255, 0, 255], 0, 'TRIANGLE_FAN centre');
    assertPixel(readPixel(gl, 2, 2), [0, 255, 0, 255], 0, 'TRIANGLE_FAN corner');

    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.LINE_LOOP, [-0.9, -0.9, 0, 0.9, -0.9, 0, 0.9, 0.9, 0, -0.9, 0.9, 0], [0, 0, 1, 1]);
    assertNoError(gl, 'drawArrays(LINE_LOOP)');
    dispose(gl);
  });

  test('RASTERIZER_DISCARD suppresses fragments (WebGL 2)', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, VS3, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.RASTERIZER_DISCARD);
    assert.equal(gl.getParameter(gl.RASTERIZER_DISCARD), true);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 0, 255], 0, 'nothing was rasterised');
    gl.disable(gl.RASTERIZER_DISCARD);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 0, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('stencil operations', () => {
  test('INCR / DECR / INVERT update the stencil buffer', () => {
    const gl = makeGL(2, 16, 16, { stencil: true });
    const p = program(gl, VS3, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    assert.equal(gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS), gl.INCR);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 1, 1, 1]);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 1, 1, 1]);
    gl.colorMask(true, true, true, true);

    gl.stencilFunc(gl.EQUAL, 2, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [0, 1, 0, 1]);
    assertPixel(readPixel(gl, 8, 8), [0, 255, 0, 255], 2, 'two INCRs left stencil == 2');

    // DECR back to 1
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [1, 1, 1, 1]);
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.TRIANGLE_STRIP, FULL_QUAD, [0, 0, 1, 1]);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 255, 255], 2, 'DECR brought stencil back to 1');

    // separate faces and masks
    gl.stencilFuncSeparate(gl.FRONT, gl.NOTEQUAL, 7, 0x0f);
    assert.equal(gl.getParameter(gl.STENCIL_FUNC), gl.NOTEQUAL);
    assert.equal(gl.getParameter(gl.STENCIL_REF), 7);
    assert.equal(gl.getParameter(gl.STENCIL_VALUE_MASK), 0x0f);
    gl.stencilOpSeparate(gl.BACK, gl.INVERT, gl.INVERT, gl.INVERT);
    assert.equal(gl.getParameter(gl.STENCIL_BACK_FAIL), gl.INVERT);
    gl.stencilMask(0xf0);
    assert.equal(gl.getParameter(gl.STENCIL_WRITEMASK), 0xf0);
    gl.stencilMaskSeparate(gl.BACK, 0x0f);
    assert.equal(gl.getParameter(gl.STENCIL_BACK_WRITEMASK), 0x0f);
    gl.stencilMask(0xff);
    gl.stencilMaskSeparate(gl.BACK, 0xff);

    gl.disable(gl.STENCIL_TEST);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('capabilities, hints and flushes', () => {
  test('isEnabled reports every capability and the defaults', () => {
    const gl = makeGL(2, 8, 8, { stencil: true });
    const caps = ['BLEND', 'CULL_FACE', 'DEPTH_TEST', 'DITHER', 'POLYGON_OFFSET_FILL',
      'SAMPLE_ALPHA_TO_COVERAGE', 'SAMPLE_COVERAGE', 'SCISSOR_TEST', 'STENCIL_TEST', 'RASTERIZER_DISCARD'] as const;
    for (const cap of caps) {
      const expected = cap === 'DITHER';
      assert.equal(gl.isEnabled((gl as any)[cap]), expected, `${cap} default`);
      assert.equal(gl.getParameter((gl as any)[cap]), expected, `getParameter(${cap}) matches isEnabled`);
    }
    for (const cap of caps) {
      gl.enable((gl as any)[cap]);
      assert.equal(gl.isEnabled((gl as any)[cap]), true, `${cap} after enable`);
      gl.disable((gl as any)[cap]);
      assert.equal(gl.isEnabled((gl as any)[cap]), false, `${cap} after disable`);
    }
    gl.enable(gl.DITHER);
    assertNoError(gl);
    dispose(gl);
  });

  test('enable/disable/isEnabled with a bad cap raise INVALID_ENUM', () => {
    const gl = makeGL(2, 8, 8);
    gl.enable(gl.TRIANGLES);
    assert.equal(gl.getError(), INVALID_ENUM, 'enable(TRIANGLES)');
    gl.disable(0x1234);
    assert.equal(gl.getError(), INVALID_ENUM, 'disable(0x1234)');
    assert.equal(gl.isEnabled(0x1234), false);
    assert.equal(gl.getError(), INVALID_ENUM, 'isEnabled(0x1234)');
    dispose(gl);
  });

  test('WebGL 1 rejects RASTERIZER_DISCARD', () => {
    const gl = makeGL(1, 8, 8);
    assert.equal((gl as any).RASTERIZER_DISCARD, undefined, 'the constant is WebGL 2 only');
    gl.enable(0x8c89 /* RASTERIZER_DISCARD */);
    assert.equal(gl.getError(), INVALID_ENUM);
    dispose(gl);
  });

  test('sampleCoverage state', () => {
    const gl = makeGL(2, 8, 8, { antialias: true });
    gl.enable(gl.SAMPLE_COVERAGE);
    assert.equal(gl.isEnabled(gl.SAMPLE_COVERAGE), true);
    gl.sampleCoverage(0.5, true);
    assert.equal(gl.getParameter(gl.SAMPLE_COVERAGE_VALUE), 0.5);
    assert.equal(gl.getParameter(gl.SAMPLE_COVERAGE_INVERT), true);
    gl.sampleCoverage(1, false);
    assert.equal(gl.getParameter(gl.SAMPLE_COVERAGE_VALUE), 1);
    assert.equal(gl.getParameter(gl.SAMPLE_COVERAGE_INVERT), false);
    gl.disable(gl.SAMPLE_COVERAGE);
    assertNoError(gl);
    dispose(gl);
  });

  test('dither can be turned off', () => {
    const gl = makeGL(2, 8, 8);
    assert.equal(gl.isEnabled(gl.DITHER), true);
    gl.disable(gl.DITHER);
    assert.equal(gl.isEnabled(gl.DITHER), false);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255], 0);
    gl.enable(gl.DITHER);
    assertNoError(gl);
    dispose(gl);
  });

  test('hint sets GENERATE_MIPMAP_HINT', () => {
    const gl = makeGL(2, 8, 8);
    assert.equal(gl.getParameter(gl.GENERATE_MIPMAP_HINT), gl.DONT_CARE);
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.NICEST);
    assert.equal(gl.getParameter(gl.GENERATE_MIPMAP_HINT), gl.NICEST);
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.FASTEST);
    assert.equal(gl.getParameter(gl.GENERATE_MIPMAP_HINT), gl.FASTEST);
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.DONT_CARE);
    gl.hint(0x1234, gl.NICEST);
    assert.equal(gl.getError(), INVALID_ENUM);
    dispose(gl);
  });

  test('depthRange, depthFunc, clearDepth and clearStencil round-trip', () => {
    const gl = makeGL(2, 8, 8, { stencil: true });
    gl.depthRange(0.25, 0.75);
    assert.deepEqual(Array.from(gl.getParameter(gl.DEPTH_RANGE)), [0.25, 0.75]);
    gl.depthFunc(gl.GEQUAL);
    assert.equal(gl.getParameter(gl.DEPTH_FUNC), gl.GEQUAL);
    gl.clearDepth(0.5);
    assert.equal(gl.getParameter(gl.DEPTH_CLEAR_VALUE), 0.5);
    gl.clearStencil(5);
    assert.equal(gl.getParameter(gl.STENCIL_CLEAR_VALUE), 5);
    gl.clearColor(0.1, 0.2, 0.3, 0.4);
    const c = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    assert.ok(Math.abs(c[0] - 0.1) < 1e-6 && Math.abs(c[3] - 0.4) < 1e-6);
    assertNoError(gl);
    dispose(gl);
  });

  test('finish and flush are no-ops that leave the buffer intact', () => {
    const gl = makeGL(2, 8, 8);
    gl.clearColor(0, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.flush();
    assertNoError(gl, 'flush');
    gl.finish();
    assertNoError(gl, 'finish');
    assertPixel(readPixel(gl, 4, 4), [0, 255, 255, 255], 0);
    dispose(gl);
  });

  test('WebGL 1 solid drawing and clear state still behave', () => {
    const gl = makeGL(1, 16, 16);
    const p = program(gl, GLSL100.vsQuad, GLSL100.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0.5, 0, 1, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 8, 16);
    drawFullscreenQuad(gl, p);
    gl.disable(gl.SCISSOR_TEST);
    assertPixel(readPixel(gl, 4, 8), [128, 0, 255, 255], 2);
    assertPixel(readPixel(gl, 12, 8), [0, 0, 0, 0], 0);
    clearErrors(gl);
    dispose(gl);
  });
});

describe('desktop OpenGL (Mesa without ANGLE)', () => {
  test('wide points centred outside the viewport are dropped, as in a browser', (t) => {
    if (getDisplayInfo()?.api !== 'gl') return t.skip('needs a desktop OpenGL context');
    // Mesa's ES contexts clip wide points after widening them (a sprite whose centre is off-screen still shows
    // its visible part); its desktop contexts, which Chrome's ANGLE drives on Linux, drop the whole point.
    const gl = makeGL(2, 16, 16);
    const p = program(gl, `#version 300 es
in vec3 a_position;
void main() { gl_PointSize = 8.0; gl_Position = vec4(a_position, 1.0); }`, FS3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPrim(gl, p, gl.POINTS, [-1 - 2 / 16, 0, 0], [1, 1, 0, 1], 1); // centre one pixel past the left edge
    assertNoError(gl, 'drawArrays(POINTS)');
    assertPixel(readPixel(gl, 0, 8), [0, 0, 0, 255], 0, 'no sliver of the point along the edge');
    assertPixel(readPixel(gl, 2, 8), [0, 0, 0, 255], 0, 'no sliver of the point along the edge');
    drawPrim(gl, p, gl.POINTS, [-1 + 2 / 16, 0, 0], [1, 1, 0, 1], 1); // centre one pixel inside
    assertPixel(readPixel(gl, 0, 8), [255, 255, 0, 255], 2, 'a point centred inside reaches the edge');
    dispose(gl);
  });
});
