// Buffers, vertex attributes, VAOs, instancing, index types and pixel buffer objects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLBuffer, WebGLVertexArrayObject } from '../src/index.ts';
import { makeGL, dispose, program, readPixel, assertPixel, assertNoError, clearErrors, glErrorName, GLSL100, GLSL300 } from './helpers.ts';

const INVALID_VALUE = 0x0501;
const INVALID_OPERATION = 0x0502;

describe('bufferData / bufferSubData', () => {
  test('all three WebGL 1 overloads', () => {
    const gl = makeGL(1, 8, 8);
    const buf = gl.createBuffer();
    assert.ok(buf instanceof WebGLBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);

    // (target, size, usage)
    gl.bufferData(gl.ARRAY_BUFFER, 64, gl.STATIC_DRAW);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 64);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE), gl.STATIC_DRAW);

    // (target, ArrayBuffer, usage)
    const ab = new ArrayBuffer(24);
    new Float32Array(ab).set([1, 2, 3, 4, 5, 6]);
    gl.bufferData(gl.ARRAY_BUFFER, ab, gl.DYNAMIC_DRAW);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 24);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE), gl.DYNAMIC_DRAW);

    // (target, ArrayBufferView, usage)
    gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array([1, 2, 3, 4]), gl.STREAM_DRAW);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 8);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE), gl.STREAM_DRAW);

    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.ARRAY_BUFFER), null);
    assert.equal(gl.getError(), 0x0500, 'an unknown buffer pname raises INVALID_ENUM');

    // the WebGL 2 srcOffset overload is not available on WebGL 1
    assert.throws(() => gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(4), gl.STATIC_DRAW, 1), TypeError);
    dispose(gl);
  });

  test('WebGL 2 srcOffset / length overloads', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const src = new Float32Array([0, 0, 1, 2, 3, 4, 9, 9]);

    gl.bufferData(gl.ARRAY_BUFFER, src, gl.STATIC_DRAW, 2, 4);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 16);
    const out = new Float32Array(4);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
    assert.deepEqual(Array.from(out), [1, 2, 3, 4]);

    // length omitted = to the end
    gl.bufferData(gl.ARRAY_BUFFER, src, gl.STATIC_DRAW, 6);
    assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 8);

    // out-of-range
    gl.bufferData(gl.ARRAY_BUFFER, src, gl.STATIC_DRAW, 6, 4);
    assert.equal(gl.getError(), INVALID_VALUE);

    // bufferSubData with srcOffset
    gl.bufferData(gl.ARRAY_BUFFER, 32, gl.STATIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 8, src, 2, 4);
    const out2 = new Float32Array(8);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out2);
    assert.deepEqual(Array.from(out2.subarray(2, 6)), [1, 2, 3, 4]);
    assertNoError(gl);
    dispose(gl);
  });

  test('bufferSubData writes at a byte offset', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.STATIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 16, new Float32Array([7, 8]));
    const out = new Float32Array(8);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
    assert.deepEqual(Array.from(out), [0, 0, 0, 0, 7, 8, 0, 0]);
    assertNoError(gl);
    dispose(gl);
  });

  test('getBufferSubData with dstOffset / length and range checks', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 2, 3, 4]), gl.STATIC_DRAW);

    const dst = new Float32Array(6).fill(-1);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 4, dst, 2, 2);
    assert.deepEqual(Array.from(dst), [-1, -1, 2, 3, -1, -1]);

    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, dst, 0, 99);
    assert.equal(gl.getError(), INVALID_VALUE, 'reading past the destination raises INVALID_VALUE');
    gl.getBufferSubData(gl.ARRAY_BUFFER, 12, new Float32Array(4));
    assert.equal(gl.getError(), INVALID_VALUE, 'reading past the buffer raises INVALID_VALUE');
    assert.throws(() => gl.getBufferSubData(gl.ARRAY_BUFFER, 0, [1, 2] as any), TypeError);
    dispose(gl);
  });

  test('copyBufferSubData moves bytes between buffers', () => {
    const gl = makeGL(2, 8, 8);
    const src = gl.createBuffer();
    const dst = gl.createBuffer();
    gl.bindBuffer(gl.COPY_READ_BUFFER, src);
    gl.bufferData(gl.COPY_READ_BUFFER, new Float32Array([1, 2, 3, 4]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, dst);
    gl.bufferData(gl.COPY_WRITE_BUFFER, 16, gl.STATIC_DRAW);
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 4, 0, 8);
    const out = new Float32Array(4);
    gl.getBufferSubData(gl.COPY_WRITE_BUFFER, 0, out);
    assert.deepEqual(Array.from(out), [2, 3, 0, 0]);
    assert.equal(gl.getParameter(gl.COPY_READ_BUFFER_BINDING), src);
    assert.equal(gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING), dst);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('vertex attributes', () => {
  test('vertexAttribPointer state is readable through getVertexAttrib', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);

    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.SHORT, true, 20, 8);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_SIZE), 3);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_TYPE), gl.SHORT);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED), true);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_STRIDE), 20);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), buf, 'object identity');
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_INTEGER), false);
    assert.equal(gl.getVertexAttribOffset(1, gl.VERTEX_ATTRIB_ARRAY_POINTER), 8);

    gl.disableVertexAttribArray(1);
    assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false);

    assert.equal(gl.getVertexAttrib(1, 0x1234), null);
    assert.equal(gl.getError(), 0x0500);
    assertNoError(gl);
    dispose(gl);
  });

  test('vertexAttribIPointer reports VERTEX_ATTRIB_ARRAY_INTEGER', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, 64, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.INT, 16, 0);
    assert.equal(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_INTEGER), true);
    assert.equal(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_TYPE), gl.INT);
    assert.equal(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_SIZE), 4);
    assertNoError(gl);
    dispose(gl);
  });

  test('current attribute values: vertexAttrib*f(v) -> Float32Array(4)', () => {
    const gl = makeGL(1, 8, 8);
    const def = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
    assert.ok(def instanceof Float32Array);
    assert.equal(def.length, 4);
    assert.deepEqual(Array.from(def), [0, 0, 0, 1], 'the default current value is (0,0,0,1)');

    gl.vertexAttrib4f(0, 1, 2, 3, 4);
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [1, 2, 3, 4]);
    gl.vertexAttrib1f(0, 9);
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [9, 0, 0, 1]);
    gl.vertexAttrib2f(0, 5, 6);
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [5, 6, 0, 1]);
    gl.vertexAttrib3f(0, 7, 8, 9);
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [7, 8, 9, 1]);
    gl.vertexAttrib4fv(0, new Float32Array([0.5, 0.25, 0.125, 1]));
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [0.5, 0.25, 0.125, 1]);
    gl.vertexAttrib3fv(0, [1, 1, 1]);
    assert.deepEqual(Array.from(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB)), [1, 1, 1, 1]);

    gl.vertexAttrib4fv(0, [1, 2]);
    assert.equal(gl.getError(), INVALID_VALUE, 'a too-short list raises INVALID_VALUE');
    dispose(gl);
  });

  test('vertexAttribI4i / I4ui report Int32Array / Uint32Array', () => {
    const gl = makeGL(2, 8, 8);
    gl.vertexAttribI4i(1, -1, 2, -3, 4);
    const i = gl.getVertexAttrib(1, gl.CURRENT_VERTEX_ATTRIB);
    assert.ok(i instanceof Int32Array, 'after vertexAttribI4i the current value is an Int32Array');
    assert.deepEqual(Array.from(i), [-1, 2, -3, 4]);

    gl.vertexAttribI4ui(2, 1, 2, 3, 4000000000);
    const u = gl.getVertexAttrib(2, gl.CURRENT_VERTEX_ATTRIB);
    assert.ok(u instanceof Uint32Array, 'after vertexAttribI4ui the current value is a Uint32Array');
    assert.deepEqual(Array.from(u), [1, 2, 3, 4000000000]);

    gl.vertexAttribI4iv(3, new Int32Array([9, 8, 7, 6]));
    assert.deepEqual(Array.from(gl.getVertexAttrib(3, gl.CURRENT_VERTEX_ATTRIB)), [9, 8, 7, 6]);
    gl.vertexAttribI4uiv(4, [1, 1, 1, 1]);
    assert.deepEqual(Array.from(gl.getVertexAttrib(4, gl.CURRENT_VERTEX_ATTRIB)), [1, 1, 1, 1]);

    // a float setter switches the reported type back
    gl.vertexAttrib4f(1, 1, 0, 0, 1);
    assert.ok(gl.getVertexAttrib(1, gl.CURRENT_VERTEX_ATTRIB) instanceof Float32Array);

    gl.vertexAttribI4iv(3, [1, 2]);
    assert.equal(gl.getError(), INVALID_VALUE);
    dispose(gl);
  });

  test('a constant vertex attribute feeds the shader', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, `#version 300 es
in vec2 a_position;
in vec4 a_color;
out vec4 v_color;
void main() { v_color = a_color; gl_Position = vec4(a_position, 0.0, 1.0); }`, `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }`);
    gl.useProgram(p);
    const colorLoc = gl.getAttribLocation(p, 'a_color');
    gl.vertexAttrib4f(colorLoc, 0, 0, 1, 1);

    const posLoc = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    assertPixel(readPixel(gl, 4, 4), [0, 0, 255, 255]);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('vertex array objects', () => {
  function vaoIsolation(gl: any, api: {
    create(): any; delete(v: any): void; bind(v: any): void; is(v: any): boolean;
  }): void {
    const vao = api.create();
    assert.ok(vao instanceof WebGLVertexArrayObject);
    assert.equal(api.is(vao), false, 'not a VAO until bound');
    api.bind(vao);
    assert.equal(api.is(vao), true);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true);

    api.bind(null);
    assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false,
      'the default VAO keeps its own attribute state');
    assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), null);

    api.bind(vao);
    assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true, 'rebinding restores the state');
    assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), buf);

    api.bind(null);
    api.delete(vao);
    assert.equal(api.is(vao), false);
    assertNoError(gl);
  }

  test('WebGL 2 core VAOs isolate attribute state', () => {
    const gl = makeGL(2, 8, 8);
    vaoIsolation(gl, {
      create: () => gl.createVertexArray(),
      delete: (v) => gl.deleteVertexArray(v),
      bind: (v) => gl.bindVertexArray(v),
      is: (v) => gl.isVertexArray(v),
    });
    dispose(gl);
  });

  test('OES_vertex_array_object on WebGL 1 isolates attribute state', (t) => {
    const gl = makeGL(1, 8, 8);
    const ext = gl.getExtension('OES_vertex_array_object');
    assert.ok(ext, 'OES_vertex_array_object is always available here');
    assert.equal(ext.VERTEX_ARRAY_BINDING_OES, 0x85b5);
    vaoIsolation(gl, {
      create: () => ext.createVertexArrayOES(),
      delete: (v) => ext.deleteVertexArrayOES(v),
      bind: (v) => ext.bindVertexArrayOES(v),
      is: (v) => ext.isVertexArrayOES(v),
    });
    assertNoError(gl);
    dispose(gl);
  });

  // KNOWN LIBRARY BUG: 0x85B5 is listed in WEBGL2_ONLY_PNAMES, so getParameter() rejects it on a
  // WebGL 1 context even when OES_vertex_array_object is enabled (the raw glGetIntegerv works).
  test('getParameter(VERTEX_ARRAY_BINDING_OES) works on WebGL 1 with the extension', () => {
    const gl = makeGL(1, 8, 8);
    const ext = gl.getExtension('OES_vertex_array_object');
    const vao = ext.createVertexArrayOES();
    ext.bindVertexArrayOES(vao);
    const got = gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES);
    const err = gl.getError();
    assert.equal(err, 0, `getParameter(VERTEX_ARRAY_BINDING_OES) raised ${glErrorName(err)}`);
    assert.ok(got === vao, `VERTEX_ARRAY_BINDING_OES returned ${got === null ? 'null' : 'a different object'} instead of the bound VAO`);
    ext.bindVertexArrayOES(null);
    assert.equal(gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES), null);
    assertNoError(gl);
    dispose(gl);
  });
});

// 4 instanced columns, 4 px each, on a 16x1 viewport.
const INSTANCE_OFFSETS = new Float32Array([-1, -0.5, 0, 0.5]);
const INSTANCE_COLORS = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
const QUAD = new Float32Array([0, -1, 0.5, -1, 0, 1, 0.5, 1]);
const EXPECTED = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];

const VS_INST_300 = `#version 300 es
in vec2 a_position;
in float a_offset;
in vec3 a_color;
out vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_position.x + a_offset, a_position.y, 0.0, 1.0);
}`;
const FS_INST_300 = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 fragColor;
void main() { fragColor = vec4(v_color, 1.0); }`;
const VS_INST_100 = `
attribute vec2 a_position;
attribute float a_offset;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_position.x + a_offset, a_position.y, 0.0, 1.0);
}`;
const FS_INST_100 = `
precision mediump float;
varying vec3 v_color;
void main() { gl_FragColor = vec4(v_color, 1.0); }`;

function setupInstanced(gl: any, p: any, divisor: (i: number, d: number) => void): void {
  gl.useProgram(p);
  const pos = gl.getAttribLocation(p, 'a_position');
  const off = gl.getAttribLocation(p, 'a_offset');
  const col = gl.getAttribLocation(p, 'a_color');

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const offBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
  gl.bufferData(gl.ARRAY_BUFFER, INSTANCE_OFFSETS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(off);
  gl.vertexAttribPointer(off, 1, gl.FLOAT, false, 0, 0);
  divisor(off, 1);

  const colBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.bufferData(gl.ARRAY_BUFFER, INSTANCE_COLORS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(col);
  gl.vertexAttribPointer(col, 3, gl.FLOAT, false, 0, 0);
  divisor(col, 1);
}

function assertInstancedColumns(gl: any): void {
  for (let i = 0; i < 4; i++) {
    assertPixel(readPixel(gl, i * 4 + 2, 0), EXPECTED[i], 2, `instance ${i}`);
  }
}

describe('instancing', () => {
  test('WebGL 2 drawArraysInstanced renders 4 instances at different offsets', () => {
    const gl = makeGL(2, 16, 1);
    const p = program(gl, VS_INST_300, FS_INST_300);
    setupInstanced(gl, p, (i, d) => gl.vertexAttribDivisor(i, d));
    assert.equal(gl.getVertexAttrib(gl.getAttribLocation(p, 'a_offset'), gl.VERTEX_ATTRIB_ARRAY_DIVISOR), 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 4);
    assertInstancedColumns(gl);
    assertNoError(gl);
    dispose(gl);
  });

  test('WebGL 2 drawElementsInstanced renders the same thing', () => {
    const gl = makeGL(2, 16, 1);
    const p = program(gl, VS_INST_300, FS_INST_300);
    setupInstanced(gl, p, (i, d) => gl.vertexAttribDivisor(i, d));
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, 4);
    assertInstancedColumns(gl);
    assertNoError(gl);
    dispose(gl);
  });

  test('ANGLE_instanced_arrays on WebGL 1', () => {
    const gl = makeGL(1, 16, 1);
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    assert.ok(ext, 'ANGLE_instanced_arrays is always available here');
    assert.equal(ext.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE, 0x88fe);
    const p = program(gl, VS_INST_100, FS_INST_100);
    setupInstanced(gl, p, (i, d) => ext.vertexAttribDivisorANGLE(i, d));
    assert.equal(gl.getVertexAttrib(gl.getAttribLocation(p, 'a_offset'), ext.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE), 1);
    ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, 4);
    assertInstancedColumns(gl);

    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    ext.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, 4);
    assertInstancedColumns(gl);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('index types & draw variants', () => {
  test('drawElements with UNSIGNED_INT works on WebGL 2', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 0, 1, 1);
    const pos = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 255, 255]);
    assertNoError(gl);

    // drawRangeElements covers the same indices
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawRangeElements(gl.TRIANGLES, 0, 3, 6, gl.UNSIGNED_INT, 0);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 255, 255]);
    assertNoError(gl);
    dispose(gl);
  });

  test('OES_element_index_uint enables UNSIGNED_INT indices on WebGL 1', () => {
    const gl = makeGL(1, 8, 8);
    const ext = gl.getExtension('OES_element_index_uint');
    assert.ok(ext, 'OES_element_index_uint is always available here');
    const p = program(gl, GLSL100.vsQuad, GLSL100.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 1, 1, 1);
    const pos = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    assertPixel(readPixel(gl, 4, 4), [0, 255, 255, 255]);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('pixel buffer objects (WebGL 2)', () => {
  test('PIXEL_PACK_BUFFER receives readPixels output', () => {
    const gl = makeGL(2, 4, 4);
    gl.clearColor(1, 0.5, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 4 * 4 * 4, gl.STREAM_READ);
    assert.equal(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), pbo);
    gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    assertNoError(gl, 'readPixels into a PBO');

    const out = new Uint8Array(4 * 4 * 4);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    assertPixel(Array.from(out.subarray(0, 4)), [255, 128, 0, 255], 2);
    assertPixel(Array.from(out.subarray(out.length - 4)), [255, 128, 0, 255], 2);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

    // the canvas still reads back correctly with the PBO unbound
    assertPixel(readPixel(gl, 0, 0), [255, 128, 0, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });

  test('PIXEL_UNPACK_BUFFER feeds texImage2D at an offset', () => {
    const gl = makeGL(2, 8, 8);
    // 2x2 RGBA texture preceded by 16 padding bytes
    const bytes = new Uint8Array(16 + 16);
    bytes.set([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255,
    ], 16);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_UNPACK_BUFFER, bytes, gl.STATIC_DRAW);
    assert.equal(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING), pbo);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, 16);
    assertNoError(gl, 'texImage2D from a PBO offset');
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);

    const p = program(gl, GLSL300.vsQuad, GLSL300.fsTexture);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    const posLoc = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // texture row 0 (red, green) is the bottom row in GL coordinates
    assertPixel(readPixel(gl, 2, 2), [255, 0, 0, 255], 2, 'texel (0,0)');
    assertPixel(readPixel(gl, 6, 2), [0, 255, 0, 255], 2, 'texel (1,0)');
    assertPixel(readPixel(gl, 2, 6), [0, 0, 255, 255], 2, 'texel (0,1)');
    assertPixel(readPixel(gl, 6, 6), [255, 255, 0, 255], 2, 'texel (1,1)');
    assertNoError(gl);
    dispose(gl);
  });

  test('flipY/premultiply are rejected for PBO uploads', () => {
    const gl = makeGL(2, 8, 8);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_UNPACK_BUFFER, 64, gl.STATIC_DRAW);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    assert.equal(gl.getError(), INVALID_OPERATION, 'UNPACK_FLIP_Y_WEBGL cannot apply to a PBO source');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    clearErrors(gl);
    dispose(gl);
  });
});
