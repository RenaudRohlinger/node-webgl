// WebGL 2 only: transform feedback, queries, sync objects, indexed state and GLSL ES 3.00 features.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLQuery, WebGLSync, WebGLTransformFeedback, WebGLActiveInfo } from '../src/index.ts';
import { makeGL, dispose, program, shader, drawFullscreenQuad, readPixel, assertPixel, assertNoError, clearErrors, GLSL300 } from './helpers.ts';

const INVALID_ENUM = 0x0500;
const INVALID_VALUE = 0x0501;
const INVALID_OPERATION = 0x0502;
const TIMEOUT_IGNORED = -1;

const FS_NOOP = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`;

/** Links a program with transform-feedback varyings declared before linking. */
function tfProgram(gl: any, vs: string, varyings: string[], mode: number): any {
  return program(gl, vs, FS_NOOP, (p) => gl.transformFeedbackVaryings(p, varyings, mode));
}

const VS_TF = `#version 300 es
in float a_in;
out float v_double;
out float v_triple;
void main() {
  v_double = a_in * 2.0;
  v_triple = a_in * 3.0;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`;

function inputBuffer(gl: any, p: any, values: number[]): void {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'a_in');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
}

describe('transform feedback', () => {
  test('INTERLEAVED_ATTRIBS captures both varyings into one buffer', () => {
    const gl = makeGL(2, 8, 8);
    const p = tfProgram(gl, VS_TF, ['v_double', 'v_triple'], gl.INTERLEAVED_ATTRIBS);
    assert.equal(gl.getProgramParameter(p, gl.TRANSFORM_FEEDBACK_VARYINGS), 2);
    assert.equal(gl.getProgramParameter(p, gl.TRANSFORM_FEEDBACK_BUFFER_MODE), gl.INTERLEAVED_ATTRIBS);

    const v0 = gl.getTransformFeedbackVarying(p, 0);
    assert.ok(v0 instanceof WebGLActiveInfo);
    assert.equal(v0.name, 'v_double');
    assert.equal(v0.type, gl.FLOAT);
    assert.equal(v0.size, 1);
    assert.equal(gl.getTransformFeedbackVarying(p, 1).name, 'v_triple');
    assert.equal(gl.getTransformFeedbackVarying(p, 9), null);
    assert.equal(gl.getError(), INVALID_VALUE);

    gl.useProgram(p);
    inputBuffer(gl, p, [1, 2, 3]);

    const out = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 6 * 4, gl.STATIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    assert.equal(gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, 0), out);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE), true);
    gl.drawArrays(gl.POINTS, 0, 3);
    gl.endTransformFeedback();
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE), false);
    gl.disable(gl.RASTERIZER_DISCARD);
    assertNoError(gl, 'transform feedback pass');

    const got = new Float32Array(6);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, got);
    assert.deepEqual(Array.from(got), [2, 3, 4, 6, 6, 9], 'interleaved (2x, 3x) per vertex');
    assertNoError(gl);
    dispose(gl);
  });

  test('SEPARATE_ATTRIBS captures into two buffers', () => {
    const gl = makeGL(2, 8, 8);
    assert.ok(gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS) >= 2);
    const p = tfProgram(gl, VS_TF, ['v_double', 'v_triple'], gl.SEPARATE_ATTRIBS);
    assert.equal(gl.getProgramParameter(p, gl.TRANSFORM_FEEDBACK_BUFFER_MODE), gl.SEPARATE_ATTRIBS);
    gl.useProgram(p);
    inputBuffer(gl, p, [1, 2, 3]);

    const bufs = [gl.createBuffer(), gl.createBuffer()];
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, bufs[i]);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 3 * 4, gl.STATIC_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, bufs[i]);
    }

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, 3);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    assertNoError(gl);

    const a = new Float32Array(3), b = new Float32Array(3);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, bufs[0]);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, a);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, bufs[1]);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b);
    assert.deepEqual(Array.from(a), [2, 4, 6]);
    assert.deepEqual(Array.from(b), [3, 6, 9]);
    dispose(gl);
  });

  test('TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN counts the captured primitives', () => {
    const gl = makeGL(2, 8, 8);
    const p = tfProgram(gl, VS_TF, ['v_double'], gl.INTERLEAVED_ATTRIBS);
    gl.useProgram(p);
    inputBuffer(gl, p, [1, 2, 3, 4]);
    const out = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 4 * 4, gl.STATIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);

    const q = gl.createQuery();
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginQuery(gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, q);
    assert.equal(gl.getQuery(gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, gl.CURRENT_QUERY), q);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, 4);
    gl.endTransformFeedback();
    gl.endQuery(gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.finish();

    assert.equal(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE), true);
    assert.equal(gl.getQueryParameter(q, gl.QUERY_RESULT), 4);
    assertNoError(gl);
    dispose(gl);
  });

  test('pause / resume skips the draws in between', () => {
    const gl = makeGL(2, 8, 8);
    const p = tfProgram(gl, VS_TF, ['v_double'], gl.INTERLEAVED_ATTRIBS);
    gl.useProgram(p);
    inputBuffer(gl, p, [1, 2, 3]);
    const out = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, new Float32Array([-1, -1, -1]), gl.STATIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, 1);          // captures 1*2
    gl.pauseTransformFeedback();
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_PAUSED), true);
    gl.drawArrays(gl.POINTS, 1, 1);          // not captured
    gl.resumeTransformFeedback();
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_PAUSED), false);
    gl.drawArrays(gl.POINTS, 2, 1);          // captures 3*2
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    assertNoError(gl, 'paused transform feedback');

    const got = new Float32Array(3);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, got);
    assert.deepEqual(Array.from(got.subarray(0, 2)), [2, 6], 'only the unpaused draws were captured');
    dispose(gl);
  });

  test('transform feedback objects', () => {
    const gl = makeGL(2, 8, 8);
    const tf = gl.createTransformFeedback();
    assert.ok(tf instanceof WebGLTransformFeedback);
    assert.equal(gl.isTransformFeedback(tf), false, 'not a transform feedback object until bound');
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    assert.equal(gl.isTransformFeedback(tf), true);
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING), tf);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING), null);
    gl.deleteTransformFeedback(tf);
    assert.equal(gl.isTransformFeedback(tf), false);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('occlusion queries', () => {
  test('ANY_SAMPLES_PASSED reflects whether fragments were drawn', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 0, 0, 1);

    const q = gl.createQuery();
    assert.ok(q instanceof WebGLQuery);
    assert.equal(gl.isQuery(q), false, 'not a query until begun');
    gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
    assert.equal(gl.isQuery(q), true);
    drawFullscreenQuad(gl, p);
    gl.endQuery(gl.ANY_SAMPLES_PASSED);
    assert.equal(gl.getQuery(gl.ANY_SAMPLES_PASSED, gl.CURRENT_QUERY), null, 'no query is current after endQuery');
    gl.finish();

    let available = false;
    for (let i = 0; i < 1000 && !available; i++) available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
    assert.equal(typeof available, 'boolean');
    assert.equal(available, true, 'the result became available after finish()');
    const passed = gl.getQueryParameter(q, gl.QUERY_RESULT);
    assert.equal(typeof passed, 'number');
    assert.ok(passed > 0, 'a full-screen quad passes the occlusion test');

    // nothing drawn -> no samples
    const q2 = gl.createQuery();
    gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q2);
    gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
    gl.finish();
    available = false;
    for (let i = 0; i < 1000 && !available; i++) available = gl.getQueryParameter(q2, gl.QUERY_RESULT_AVAILABLE);
    assert.equal(gl.getQueryParameter(q2, gl.QUERY_RESULT), 0, 'nothing was rasterised');

    gl.getQueryParameter(q, 0x1234);
    assert.equal(gl.getError(), INVALID_ENUM);
    gl.deleteQuery(q);
    assert.equal(gl.isQuery(q), false);
    clearErrors(gl);
    dispose(gl);
  });

  test('a scissored-out draw records no samples', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 1, 0, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 0, 0);
    const q = gl.createQuery();
    gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
    drawFullscreenQuad(gl, p);
    gl.endQuery(gl.ANY_SAMPLES_PASSED);
    gl.disable(gl.SCISSOR_TEST);
    gl.finish();
    let available = false;
    for (let i = 0; i < 1000 && !available; i++) available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
    assert.equal(gl.getQueryParameter(q, gl.QUERY_RESULT), 0);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('sync objects', () => {
  test('fenceSync / clientWaitSync / getSyncParameter / waitSync', () => {
    const gl = makeGL(2, 16, 16);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    assert.ok(sync instanceof WebGLSync);
    assert.equal(gl.isSync(sync), true);
    assert.equal(gl.getSyncParameter(sync, gl.OBJECT_TYPE), gl.SYNC_FENCE);
    assert.equal(gl.getSyncParameter(sync, gl.SYNC_CONDITION), gl.SYNC_GPU_COMMANDS_COMPLETE);
    assert.equal(gl.getSyncParameter(sync, gl.SYNC_FLAGS), 0);
    const before = gl.getSyncParameter(sync, gl.SYNC_STATUS);
    assert.ok(before === gl.SIGNALED || before === gl.UNSIGNALED, `SYNC_STATUS = ${before}`);

    gl.finish();
    const r = gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
    assert.ok(r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED,
      `clientWaitSync returned 0x${r.toString(16)}`);
    assert.equal(gl.getSyncParameter(sync, gl.SYNC_STATUS), gl.SIGNALED);

    // a blocking wait with the maximum allowed timeout also succeeds
    const r2 = gl.clientWaitSync(sync, 0, gl.getParameter(gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL));
    assert.ok(r2 === gl.ALREADY_SIGNALED || r2 === gl.CONDITION_SATISFIED);

    gl.waitSync(sync, 0, TIMEOUT_IGNORED);
    assertNoError(gl, 'waitSync with TIMEOUT_IGNORED');

    gl.getSyncParameter(sync, 0x1234);
    assert.equal(gl.getError(), INVALID_ENUM);

    gl.deleteSync(sync);
    assert.equal(gl.isSync(sync), false);
    clearErrors(gl);
    dispose(gl);
  });

  test('clientWaitSync / waitSync reject out-of-range timeouts', () => {
    const gl = makeGL(2, 8, 8);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    const max = gl.getParameter(gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL);
    assert.equal(max, 1e9);
    assert.equal(gl.clientWaitSync(sync, 0, max + 1), gl.WAIT_FAILED);
    assert.equal(gl.getError(), INVALID_OPERATION, 'timeout above MAX_CLIENT_WAIT_TIMEOUT_WEBGL');
    gl.waitSync(sync, 0, 1000);
    assert.equal(gl.getError(), INVALID_VALUE, 'waitSync only accepts TIMEOUT_IGNORED');
    gl.deleteSync(sync);
    dispose(gl);
  });

  test('a sync signals after real GPU work', () => {
    const gl = makeGL(2, 64, 64);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 0, 1, 1);
    for (let i = 0; i < 20; i++) drawFullscreenQuad(gl, p);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    let status = gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 1e9);
    assert.ok(status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED,
      `blocking clientWaitSync returned 0x${status.toString(16)}`);
    assertPixel(readPixel(gl, 32, 32), [0, 0, 255, 255], 2, 'the drawing completed');
    gl.deleteSync(sync);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('indexed and internal-format state', () => {
  test('getIndexedParameter for UBO and transform feedback bindings', () => {
    const gl = makeGL(2, 8, 8);
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    const align = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
    gl.bufferData(gl.UNIFORM_BUFFER, align + 64, gl.STATIC_DRAW);
    gl.bindBufferRange(gl.UNIFORM_BUFFER, 1, ubo, align, 32);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 1), ubo);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_START, 1), align);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE, 1), 32);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0), null, 'unbound index');

    const tfb = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, tfb);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 64, gl.STATIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfb);
    assert.equal(gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, 0), tfb);
    assert.equal(gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_SIZE, 0), 0, 'bindBufferBase reports size 0');

    assert.equal(gl.getIndexedParameter(0x1234, 0), null);
    assert.equal(gl.getError(), INVALID_ENUM);
    assertNoError(gl);
    dispose(gl);
  });

  test('getInternalformatParameter(RENDERBUFFER, RGBA8, SAMPLES)', () => {
    const gl = makeGL(2, 8, 8);
    const samples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
    assert.ok(samples instanceof Int32Array);
    assert.ok(samples.length >= 1, 'at least one multisample count is supported');
    assert.ok(samples[0] >= samples[samples.length - 1], 'sample counts are returned in descending order');
    assert.ok(samples[0] >= 4, `max samples for RGBA8 = ${samples[0]}`);
    assert.ok(samples[0] <= gl.getParameter(gl.MAX_SAMPLES));

    const depth = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, gl.SAMPLES);
    assert.ok(depth instanceof Int32Array && depth.length >= 1);

    assert.equal(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, 0x1234), null);
    assert.equal(gl.getError(), INVALID_ENUM);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('GLSL ES 3.00 features', () => {
  test('gl_VertexID with flat interpolation', () => {
    const gl = makeGL(2, 4, 1);
    const p = program(gl, `#version 300 es
flat out int v_id;
void main() {
  v_id = gl_VertexID;
  gl_PointSize = 1.0;
  gl_Position = vec4((float(gl_VertexID) + 0.5) / 2.0 - 1.0, 0.0, 0.0, 1.0);
}`, `#version 300 es
precision mediump float;
flat in int v_id;
out vec4 fragColor;
void main() { fragColor = vec4(float(v_id) / 3.0, 0.0, 0.0, 1.0); }`);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.drawArrays(gl.POINTS, 0, 4);
    assertNoError(gl, 'drawArrays with no attributes (gl_VertexID only)');
    for (let i = 0; i < 4; i++) {
      assertPixel(readPixel(gl, i, 0), [Math.round(i * 255 / 3), 0, 0, 255], 2, `gl_VertexID ${i}`);
    }
    dispose(gl);
  });

  test('gl_InstanceID drives instanced points', () => {
    const gl = makeGL(2, 4, 1);
    const p = program(gl, `#version 300 es
flat out int v_id;
void main() {
  v_id = gl_InstanceID;
  gl_PointSize = 1.0;
  gl_Position = vec4((float(gl_InstanceID) + 0.5) / 2.0 - 1.0, 0.0, 0.0, 1.0);
}`, `#version 300 es
precision mediump float;
flat in int v_id;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, float(v_id) / 3.0, 0.0, 1.0); }`);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.drawArraysInstanced(gl.POINTS, 0, 1, 4);
    assertNoError(gl);
    for (let i = 0; i < 4; i++) {
      assertPixel(readPixel(gl, i, 0), [0, Math.round(i * 255 / 3), 0, 255], 2, `gl_InstanceID ${i}`);
    }
    dispose(gl);
  });

  test('integer vertex attributes through vertexAttribIPointer', () => {
    const gl = makeGL(2, 4, 1);
    const p = program(gl, `#version 300 es
in ivec2 a_i;
flat out int v_v;
void main() {
  v_v = a_i.y;
  gl_PointSize = 1.0;
  gl_Position = vec4((float(a_i.x) + 0.5) / 2.0 - 1.0, 0.0, 0.0, 1.0);
}`, `#version 300 es
precision mediump float;
flat in int v_v;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, float(v_v) / 255.0, 1.0); }`);
    gl.useProgram(p);
    const loc = gl.getAttribLocation(p, 'a_i');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Int32Array([0, 51, 1, 102, 2, 153, 3, 204]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribIPointer(loc, 2, gl.INT, 0, 0);
    assert.equal(gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_INTEGER), true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, 4);
    assertNoError(gl);
    for (let i = 0; i < 4; i++) {
      assertPixel(readPixel(gl, i, 0), [0, 0, 51 * (i + 1), 255], 2, `integer attribute ${i}`);
    }
    dispose(gl);
  });

  test('textureSize and texelFetch', () => {
    const gl = makeGL(2, 8, 8);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // 4x2 with texel (1,0) = green
    const data = new Uint8Array(4 * 2 * 4);
    data.set([0, 255, 0, 255], 1 * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
out vec4 fragColor;
void main() {
  ivec2 sz = textureSize(u_tex, 0);
  vec4 t = texelFetch(u_tex, ivec2(1, 0), 0);
  fragColor = vec4(float(sz.x) / 255.0, float(sz.y) / 255.0, t.g, 1.0);
}`);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 4, 4), [4, 2, 255, 255], 2, 'textureSize -> (4,2), texelFetch(1,0) -> green');
    assertNoError(gl);
    dispose(gl);
  });

  test('std140 uniform block layout is introspectable', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
layout(std140) uniform Block {
  float a;      // offset 0
  vec3 b;       // offset 16
  mat4 c;       // offset 32
  float d[2];   // offset 96, array stride 16
};
out vec4 fragColor;
void main() { fragColor = vec4(a, b.x, c[0][0], d[1]); }`);
    const idx = gl.getUniformBlockIndex(p, 'Block');
    assert.notEqual(idx, gl.INVALID_INDEX);
    const names = ['a', 'b', 'c', 'd[0]'];
    const indices = gl.getUniformIndices(p, names);
    const offsets = gl.getActiveUniforms(p, indices, gl.UNIFORM_OFFSET);
    assert.deepEqual(offsets, [0, 16, 32, 96], 'std140 offsets');
    const arrayStride = gl.getActiveUniforms(p, indices, gl.UNIFORM_ARRAY_STRIDE);
    assert.equal(arrayStride[3], 16, 'std140 array stride for float[2]');
    const matrixStride = gl.getActiveUniforms(p, indices, gl.UNIFORM_MATRIX_STRIDE);
    assert.equal(matrixStride[2], 16, 'std140 matrix stride for mat4');
    const blockIndices = gl.getActiveUniforms(p, indices, gl.UNIFORM_BLOCK_INDEX);
    assert.deepEqual(blockIndices, [idx, idx, idx, idx]);
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_DATA_SIZE), 128);
    assertNoError(gl);
    dispose(gl);
  });

  test('MRT through layout(location = N) outputs', () => {
    const gl = makeGL(2, 8, 8);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const texes = [0, 1, 2].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    });
    texes.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main() {
  o0 = vec4(1.0, 0.0, 0.0, 1.0);
  o1 = vec4(0.0, 1.0, 0.0, 1.0);
  o2 = vec4(0.0, 0.0, 1.0, 1.0);
}`);
    gl.viewport(0, 0, 4, 4);
    gl.useProgram(p);
    drawFullscreenQuad(gl, p);
    const expected = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    for (let i = 0; i < 3; i++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      assertPixel(readPixel(gl, 2, 2), expected[i], 2, `attachment ${i}`);
    }
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WebGL 2 extensions', () => {
  test('EXT_disjoint_timer_query_webgl2 measures elapsed GPU time', (t) => {
    const gl = makeGL(2, 64, 64);
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return void t.skip('EXT_disjoint_timer_query_webgl2 unavailable');
    assert.equal(ext.TIME_ELAPSED_EXT, 0x88bf);
    assert.equal(ext.TIMESTAMP_EXT, 0x8e28);
    assert.equal(typeof gl.getParameter(ext.GPU_DISJOINT_EXT), 'boolean');

    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 1, 1, 1);

    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < 10; i++) drawFullscreenQuad(gl, p);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.finish();
    let available = false;
    for (let i = 0; i < 10000 && !available; i++) available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
    if (!available) return void t.skip('the timer query never became available');
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    assert.equal(typeof ns, 'number');
    assert.ok(ns >= 0, `TIME_ELAPSED_EXT = ${ns} ns`);
    clearErrors(gl);
    dispose(gl);
  });

  test('OES_draw_buffers_indexed blends per draw buffer', (t) => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('OES_draw_buffers_indexed');
    if (!ext) return void t.skip('OES_draw_buffers_indexed unavailable');

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const texes = [0, 1].map(() => {
      const t2 = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t2);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t2;
    });
    texes.forEach((tx, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tx, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, 4, 4);

    // start both attachments at 0.5 grey
    gl.clearBufferfv(gl.COLOR, 0, [0.5, 0.5, 0.5, 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 0.5, 1]);

    // additive blending on buffer 0 only
    ext.enableiOES(gl.BLEND, 0);
    ext.blendFunciOES(0, gl.ONE, gl.ONE);
    assert.equal(gl.getIndexedParameter(gl.BLEND_SRC_RGB, 0), gl.ONE);
    assert.equal(gl.getIndexedParameter(gl.BLEND_DST_RGB, 0), gl.ONE);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() { o0 = vec4(0.25, 0.0, 0.0, 0.0); o1 = vec4(0.25, 0.0, 0.0, 0.0); }`);
    gl.useProgram(p);
    drawFullscreenQuad(gl, p);
    assertNoError(gl, 'indexed blend draw');

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    assertPixel(readPixel(gl, 2, 2), [191, 128, 128, 255], 3, 'buffer 0 blended additively');
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    assertPixel(readPixel(gl, 2, 2), [64, 0, 0, 0], 3, 'buffer 1 was overwritten (blending disabled)');

    ext.colorMaskiOES(1, true, false, false, true);
    assert.deepEqual(gl.getIndexedParameter(gl.COLOR_WRITEMASK, 1), [true, false, false, true]);
    ext.disableiOES(gl.BLEND, 0);
    ext.colorMaskiOES(1, true, true, true, true);
    assertNoError(gl);
    dispose(gl);
  });
});
