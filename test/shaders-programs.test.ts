// Shader compilation, program linking, introspection and the whole uniform API.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLActiveInfo, WebGLShader, WebGLShaderPrecisionFormat, WebGLUniformLocation } from '../src/index.ts';
import { makeGL, dispose, program, shader, drawFullscreenQuad, readPixel, assertPixel, assertNoError, clearErrors, GLSL100, GLSL300 } from './helpers.ts';

const INVALID_OPERATION = 0x0502;
const INVALID_VALUE = 0x0501;

const VS100 = GLSL100.vsQuad;
const VS300 = GLSL300.vsQuad;

/** Fragment shader touching one uniform of (almost) every type. */
const FS100_KITCHEN = `
precision mediump float;
uniform float uF;
uniform vec2 uV2;
uniform vec3 uV3;
uniform vec4 uV4;
uniform int uI;
uniform ivec2 uI2;
uniform ivec3 uI3;
uniform ivec4 uI4;
uniform bool uB;
uniform bvec3 uB3;
uniform mat2 uM2;
uniform mat3 uM3;
uniform mat4 uM4;
uniform sampler2D uS;
uniform float uArr[4];
void main() {
  float s = uF + uV2.x + uV3.y + uV4.z + float(uI) + float(uI2.x) + float(uI3.y) + float(uI4.w);
  s += uB ? 1.0 : 0.0;
  s += uB3.z ? 1.0 : 0.0;
  s += uM2[0][0] + uM3[1][1] + uM4[2][2];
  s += uArr[0] + uArr[1] + uArr[2] + uArr[3];
  gl_FragColor = texture2D(uS, vec2(0.5)) * 0.001 + vec4(s * 0.001, 0.0, 0.0, 1.0);
}`;

const FS300_KITCHEN = `#version 300 es
precision mediump float;
uniform float uF;
uniform vec4 uV4;
uniform int uI;
uniform bool uB;
uniform uint uU;
uniform uvec2 uU2;
uniform uvec3 uU3;
uniform uvec4 uU4;
uniform mat2 uM2;
uniform mat2x3 uM23;
uniform mat3x2 uM32;
uniform mat2x4 uM24;
uniform mat4x2 uM42;
uniform mat3x4 uM34;
uniform mat4x3 uM43;
uniform sampler2D uS;
out vec4 fragColor;
void main() {
  float s = uF + uV4.x + float(uI) + (uB ? 1.0 : 0.0) + float(uU) + float(uU2.x) + float(uU3.y) + float(uU4.w);
  s += uM2[0][0] + uM23[0][0] + uM32[0][0] + uM24[0][0] + uM42[0][0] + uM34[0][0] + uM43[0][0];
  fragColor = texture(uS, vec2(0.5)) * 0.001 + vec4(s * 0.001, 0.0, 0.0, 1.0);
}`;

describe('shader compilation', () => {
  test('a good shader compiles and reports its source and type', () => {
    const gl = makeGL(2, 8, 8);
    const vs = gl.createShader(gl.VERTEX_SHADER);
    assert.ok(vs instanceof WebGLShader);
    gl.shaderSource(vs, VS300);
    assert.equal(gl.getShaderSource(vs), VS300, 'getShaderSource returns the exact source');
    gl.compileShader(vs);
    assert.equal(gl.getShaderParameter(vs, gl.COMPILE_STATUS), true);
    assert.equal(gl.getShaderParameter(vs, gl.SHADER_TYPE), gl.VERTEX_SHADER);
    assert.equal(gl.getShaderParameter(vs, gl.DELETE_STATUS), false);
    assert.equal(typeof gl.getShaderInfoLog(vs), 'string');
    assertNoError(gl);
    dispose(gl);
  });

  test('a broken shader fails with a non-empty info log', () => {
    const gl = makeGL(2, 8, 8);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, '#version 300 es\nprecision mediump float;\nout vec4 c;\nvoid main() { c = nope(1.0); }\n');
    gl.compileShader(fs);
    assert.equal(gl.getShaderParameter(fs, gl.COMPILE_STATUS), false, 'a call to an undefined function must not compile');
    const log = gl.getShaderInfoLog(fs);
    assert.equal(typeof log, 'string');
    assert.ok(log.length > 0, 'the info log describes the error');
    assert.match(log, /ERROR|error/);
    assertNoError(gl, 'a compile failure is not a GL error');
    dispose(gl);
  });

  test('createShader with a bad type raises INVALID_ENUM', () => {
    const gl = makeGL(2, 8, 8);
    assert.equal(gl.createShader(gl.TRIANGLES), null);
    assert.equal(gl.getError(), 0x0500);
    dispose(gl);
  });

  test('getShaderPrecisionFormat reports usable ranges', () => {
    const gl = makeGL(2, 8, 8);
    const hi = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    assert.ok(hi instanceof WebGLShaderPrecisionFormat);
    assert.equal(typeof hi.rangeMin, 'number');
    assert.equal(typeof hi.rangeMax, 'number');
    assert.equal(typeof hi.precision, 'number');
    assert.ok(hi.rangeMin >= 0 && hi.rangeMax >= 0, 'ranges are log2 magnitudes (non-negative)');
    assert.ok(hi.precision > 0, 'highp float has mantissa bits');

    const medInt = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.MEDIUM_INT);
    assert.ok(medInt.rangeMax > 0);
    assert.equal(medInt.precision, 0, 'integer precision formats report precision 0');
    assertNoError(gl);
    dispose(gl);
  });
});

describe('program linking & introspection', () => {
  test('link succeeds and exposes attached shaders', () => {
    const gl = makeGL(2, 8, 8);
    const vs = shader(gl, gl.VERTEX_SHADER, VS300);
    const fs = shader(gl, gl.FRAGMENT_SHADER, GLSL300.fsSolid);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    assert.equal(gl.getProgramParameter(p, gl.ATTACHED_SHADERS), 2);
    gl.linkProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true);
    assert.equal(gl.getProgramParameter(p, gl.DELETE_STATUS), false);

    const attached = gl.getAttachedShaders(p);
    assert.ok(Array.isArray(attached));
    assert.equal(attached.length, 2);
    assert.ok(attached.includes(vs) && attached.includes(fs), 'getAttachedShaders returns the same JS objects');

    gl.validateProgram(p);
    assert.equal(typeof gl.getProgramParameter(p, gl.VALIDATE_STATUS), 'boolean');
    assert.equal(typeof gl.getProgramInfoLog(p), 'string');

    gl.detachShader(p, vs);
    assert.equal(gl.getProgramParameter(p, gl.ATTACHED_SHADERS), 1);
    assertNoError(gl);
    dispose(gl);
  });

  test('a link failure produces a non-empty info log', () => {
    const gl = makeGL(2, 8, 8);
    const vs = shader(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 a_position;
out vec3 v_bad;
void main() { v_bad = vec3(a_position, 0.0); gl_Position = vec4(a_position, 0.0, 1.0); }`);
    const fs = shader(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float;
in vec2 v_bad;
out vec4 c;
void main() { c = vec4(v_bad, 0.0, 1.0); }`);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), false, 'mismatched varying types must not link');
    const log = gl.getProgramInfoLog(p);
    assert.ok(log.length > 0, 'the program info log describes the link error');
    assertNoError(gl);
    dispose(gl);
  });

  test('getActiveAttrib / getAttribLocation / bindAttribLocation', () => {
    const gl = makeGL(2, 8, 8);
    const vs = `#version 300 es
in vec2 a_position;
in vec3 a_color;
out vec3 v_color;
void main() { v_color = a_color; gl_Position = vec4(a_position, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 c;
void main() { c = vec4(v_color, 1.0); }`;

    const p = program(gl, vs, fs);
    assert.equal(gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES), 2);
    const infos: any[] = [];
    for (let i = 0; i < 2; i++) {
      const info = gl.getActiveAttrib(p, i);
      assert.ok(info instanceof WebGLActiveInfo);
      infos.push(info);
    }
    const byName = new Map(infos.map((i) => [i.name, i]));
    assert.equal(byName.get('a_position').type, gl.FLOAT_VEC2);
    assert.equal(byName.get('a_position').size, 1);
    assert.equal(byName.get('a_color').type, gl.FLOAT_VEC3);
    assert.ok(gl.getAttribLocation(p, 'a_position') >= 0);
    assert.equal(gl.getAttribLocation(p, 'nope'), -1);

    // out-of-range index
    assert.equal(gl.getActiveAttrib(p, 99), null);
    assert.equal(gl.getError(), INVALID_VALUE);

    // bindAttribLocation forces the index on the next link
    const p2 = program(gl, vs, fs, (prog) => {
      gl.bindAttribLocation(prog, 3, 'a_position');
      gl.bindAttribLocation(prog, 1, 'a_color');
    });
    assert.equal(gl.getAttribLocation(p2, 'a_position'), 3);
    assert.equal(gl.getAttribLocation(p2, 'a_color'), 1);
    assertNoError(gl);
    dispose(gl);
  });

  test('getActiveUniform reports names, types and array sizes', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, FS100_KITCHEN);
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    assert.ok(count >= 15, `expected >= 15 active uniforms, got ${count}`);
    const byName = new Map<string, any>();
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      byName.set(info.name.replace(/\[0\]$/, ''), info);
    }
    assert.equal(byName.get('uF').type, gl.FLOAT);
    assert.equal(byName.get('uV3').type, gl.FLOAT_VEC3);
    assert.equal(byName.get('uI4').type, gl.INT_VEC4);
    assert.equal(byName.get('uB3').type, gl.BOOL_VEC3);
    assert.equal(byName.get('uM3').type, gl.FLOAT_MAT3);
    assert.equal(byName.get('uS').type, gl.SAMPLER_2D);
    assert.equal(byName.get('uArr').type, gl.FLOAT);
    assert.equal(byName.get('uArr').size, 4, 'array uniforms report their length');
    assert.equal(byName.get('uF').size, 1);
    assertNoError(gl);
    dispose(gl);
  });

  test('getUniformLocation handles arrays and unknown names', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, FS100_KITCHEN);
    const base = gl.getUniformLocation(p, 'uArr');
    const el0 = gl.getUniformLocation(p, 'uArr[0]');
    const el2 = gl.getUniformLocation(p, 'uArr[2]');
    assert.ok(base instanceof WebGLUniformLocation);
    assert.ok(el0 instanceof WebGLUniformLocation);
    assert.ok(el2 instanceof WebGLUniformLocation);
    assert.notEqual(base, el0, 'each call returns a fresh WebGLUniformLocation object');
    assert.equal(gl.getUniformLocation(p, 'nope'), null);
    assert.equal(gl.getUniformLocation(p, 'uArr[9]'), null, 'out-of-range array elements have no location');

    gl.useProgram(p);
    gl.uniform1f(el0, 1.5);
    gl.uniform1f(el2, 3.5);
    assert.equal(gl.getUniform(p, el0), 1.5);
    assert.equal(gl.getUniform(p, el2), 3.5, 'uArr[2] is addressed independently');
    assertNoError(gl);
    dispose(gl);
  });
});

describe('uniform setters and getUniform round-trips (WebGL 1)', () => {
  test('scalar / vector / matrix / bool / sampler uniforms round-trip', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, FS100_KITCHEN);
    gl.useProgram(p);
    const loc = (n: string) => gl.getUniformLocation(p, n);

    gl.uniform1f(loc('uF'), 0.5);
    assert.equal(gl.getUniform(p, loc('uF')), 0.5);
    gl.uniform2f(loc('uV2'), 1, 2);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uV2'))), [1, 2]);
    gl.uniform3f(loc('uV3'), 1, 2, 3);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uV3'))), [1, 2, 3]);
    gl.uniform4f(loc('uV4'), 1, 2, 3, 4);
    const v4 = gl.getUniform(p, loc('uV4'));
    assert.ok(v4 instanceof Float32Array, 'vec4 uniforms read back as Float32Array');
    assert.deepEqual(Array.from(v4), [1, 2, 3, 4]);

    gl.uniform1i(loc('uI'), 7);
    assert.equal(gl.getUniform(p, loc('uI')), 7);
    gl.uniform2i(loc('uI2'), 1, 2);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uI2'))), [1, 2]);
    gl.uniform3i(loc('uI3'), 1, 2, 3);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uI3'))), [1, 2, 3]);
    gl.uniform4i(loc('uI4'), 1, 2, 3, 4);
    const i4 = gl.getUniform(p, loc('uI4'));
    assert.ok(i4 instanceof Int32Array, 'ivec4 uniforms read back as Int32Array');
    assert.deepEqual(Array.from(i4), [1, 2, 3, 4]);

    // fv / iv variants, plain arrays as well as typed arrays
    gl.uniform1fv(loc('uF'), [2.5]);
    assert.equal(gl.getUniform(p, loc('uF')), 2.5);
    gl.uniform2fv(loc('uV2'), new Float32Array([9, 8]));
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uV2'))), [9, 8]);
    gl.uniform3fv(loc('uV3'), [4, 5, 6]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uV3'))), [4, 5, 6]);
    gl.uniform4fv(loc('uV4'), [4, 5, 6, 7]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uV4'))), [4, 5, 6, 7]);
    gl.uniform1iv(loc('uI'), [11]);
    assert.equal(gl.getUniform(p, loc('uI')), 11);
    gl.uniform2iv(loc('uI2'), new Int32Array([5, 6]));
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uI2'))), [5, 6]);
    gl.uniform3iv(loc('uI3'), [7, 8, 9]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uI3'))), [7, 8, 9]);
    gl.uniform4iv(loc('uI4'), [1, 1, 2, 3]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uI4'))), [1, 1, 2, 3]);

    // bool / bvec read back as JS booleans
    gl.uniform1i(loc('uB'), 1);
    assert.equal(gl.getUniform(p, loc('uB')), true);
    gl.uniform1i(loc('uB'), 0);
    assert.equal(gl.getUniform(p, loc('uB')), false);
    gl.uniform3i(loc('uB3'), 1, 0, 1);
    assert.deepEqual(gl.getUniform(p, loc('uB3')), [true, false, true]);

    // samplers read back as the texture unit number
    gl.uniform1i(loc('uS'), 3);
    assert.equal(gl.getUniform(p, loc('uS')), 3);

    // whole float array
    gl.uniform1fv(loc('uArr'), [1, 2, 3, 4]);
    assert.equal(gl.getUniform(p, gl.getUniformLocation(p, 'uArr[3]')), 4);

    assertNoError(gl);
    dispose(gl);
  });

  test('matrix uniforms round-trip in column-major order', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, FS100_KITCHEN);
    gl.useProgram(p);
    const m2 = [1, 2, 3, 4];
    gl.uniformMatrix2fv(gl.getUniformLocation(p, 'uM2'), false, m2);
    assert.deepEqual(Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'uM2'))), m2);

    const m3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    gl.uniformMatrix3fv(gl.getUniformLocation(p, 'uM3'), false, new Float32Array(m3));
    assert.deepEqual(Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'uM3'))), m3);

    const m4 = Array.from({ length: 16 }, (_, i) => i + 1);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uM4'), false, m4);
    const got = gl.getUniform(p, gl.getUniformLocation(p, 'uM4'));
    assert.ok(got instanceof Float32Array);
    assert.deepEqual(Array.from(got), m4);
    assertNoError(gl);

    // WebGL 1 forbids transpose = true
    gl.uniformMatrix2fv(gl.getUniformLocation(p, 'uM2'), true, m2);
    assert.equal(gl.getError(), INVALID_VALUE, 'WebGL 1 rejects transpose=true');
    dispose(gl);
  });

  test('a wrong-size value array raises INVALID_VALUE', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, FS100_KITCHEN);
    gl.useProgram(p);
    gl.uniform3fv(gl.getUniformLocation(p, 'uV3'), [1, 2]);
    assert.equal(gl.getError(), INVALID_VALUE);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uM4'), false, [1, 2, 3]);
    assert.equal(gl.getError(), INVALID_VALUE);
    dispose(gl);
  });
});

describe('uniform location validity', () => {
  test('null location is a silent no-op', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform1f(null, 1);
    gl.uniform4fv(null, [1, 2, 3, 4]);
    gl.uniformMatrix4fv(null, false, new Float32Array(16));
    assertNoError(gl, 'setting a null uniform location must not raise');
    dispose(gl);
  });

  test("a location from another program raises INVALID_OPERATION", () => {
    const gl = makeGL(2, 8, 8);
    const a = program(gl, VS300, GLSL300.fsSolid);
    const b = program(gl, VS300, GLSL300.fsSolid);
    const locA = gl.getUniformLocation(a, 'u_color');
    gl.useProgram(b);
    gl.uniform4f(locA, 1, 0, 0, 1);
    assert.equal(gl.getError(), INVALID_OPERATION);
    // and the right program works
    gl.useProgram(a);
    gl.uniform4f(locA, 1, 0, 0, 1);
    assertNoError(gl);
    dispose(gl);
  });

  test('a location becomes invalid after relinking', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, GLSL300.fsSolid);
    const loc = gl.getUniformLocation(p, 'u_color');
    gl.useProgram(p);
    gl.uniform4f(loc, 0, 1, 0, 1);
    assertNoError(gl);

    gl.linkProgram(p);
    gl.useProgram(p);
    gl.uniform4f(loc, 1, 0, 0, 1);
    assert.equal(gl.getError(), INVALID_OPERATION, 'stale locations are rejected after a relink');

    const fresh = gl.getUniformLocation(p, 'u_color');
    gl.uniform4f(fresh, 1, 0, 0, 1);
    assertNoError(gl);
    dispose(gl);
  });

  test('getUniform with a foreign location raises INVALID_OPERATION', () => {
    const gl = makeGL(2, 8, 8);
    const a = program(gl, VS300, GLSL300.fsSolid);
    const b = program(gl, VS300, GLSL300.fsSolid);
    const locA = gl.getUniformLocation(a, 'u_color');
    assert.equal(gl.getUniform(b, locA), null);
    assert.equal(gl.getError(), INVALID_OPERATION);
    dispose(gl);
  });

  test('a uniform actually drives the rendered color', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0.2, 0.4, 0.6, 1);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 4, 4), [51, 102, 153, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WebGL 2 uniforms', () => {
  test('uniform*ui round-trips through Uint32Array', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, FS300_KITCHEN);
    gl.useProgram(p);
    const loc = (n: string) => gl.getUniformLocation(p, n);

    gl.uniform1ui(loc('uU'), 42);
    assert.equal(gl.getUniform(p, loc('uU')), 42);
    gl.uniform2ui(loc('uU2'), 1, 2);
    const u2 = gl.getUniform(p, loc('uU2'));
    assert.ok(u2 instanceof Uint32Array, 'uvec2 reads back as Uint32Array');
    assert.deepEqual(Array.from(u2), [1, 2]);
    gl.uniform3ui(loc('uU3'), 3, 4, 5);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uU3'))), [3, 4, 5]);
    gl.uniform4ui(loc('uU4'), 6, 7, 8, 4000000000);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uU4'))), [6, 7, 8, 4000000000]);

    gl.uniform1uiv(loc('uU'), new Uint32Array([9]));
    assert.equal(gl.getUniform(p, loc('uU')), 9);
    gl.uniform2uiv(loc('uU2'), [10, 11]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uU2'))), [10, 11]);
    gl.uniform3uiv(loc('uU3'), [12, 13, 14]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uU3'))), [12, 13, 14]);
    gl.uniform4uiv(loc('uU4'), [15, 16, 17, 18]);
    assert.deepEqual(Array.from(gl.getUniform(p, loc('uU4'))), [15, 16, 17, 18]);
    assertNoError(gl);
    dispose(gl);
  });

  test('non-square matrix uniforms round-trip', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, FS300_KITCHEN);
    gl.useProgram(p);
    const cases: [string, number, (l: any, t: boolean, v: number[]) => void][] = [
      ['uM23', 6, (l, t, v) => gl.uniformMatrix2x3fv(l, t, v)],
      ['uM32', 6, (l, t, v) => gl.uniformMatrix3x2fv(l, t, v)],
      ['uM24', 8, (l, t, v) => gl.uniformMatrix2x4fv(l, t, v)],
      ['uM42', 8, (l, t, v) => gl.uniformMatrix4x2fv(l, t, v)],
      ['uM34', 12, (l, t, v) => gl.uniformMatrix3x4fv(l, t, v)],
      ['uM43', 12, (l, t, v) => gl.uniformMatrix4x3fv(l, t, v)],
    ];
    for (const [name, n, setter] of cases) {
      const values = Array.from({ length: n }, (_, i) => i + 1);
      setter(gl.getUniformLocation(p, name), false, values);
      const got = gl.getUniform(p, gl.getUniformLocation(p, name));
      assert.ok(got instanceof Float32Array, `${name} reads back as Float32Array`);
      assert.deepEqual(Array.from(got), values, `${name} round-trip`);
    }
    assertNoError(gl);
    dispose(gl);
  });

  test('transpose=true transposes the uploaded matrix (WebGL 2)', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, FS300_KITCHEN);
    gl.useProgram(p);
    const loc = gl.getUniformLocation(p, 'uM2');
    gl.uniformMatrix2fv(loc, true, [1, 2, 3, 4]);
    assertNoError(gl, 'WebGL 2 allows transpose=true');
    assert.deepEqual(Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'uM2'))), [1, 3, 2, 4],
      'the stored matrix is the transpose of the supplied one');
    dispose(gl);
  });

  test('uniform*v srcOffset / srcLength overloads', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, FS300_KITCHEN);
    gl.useProgram(p);
    const loc = gl.getUniformLocation(p, 'uV4');
    gl.uniform4fv(loc, new Float32Array([0, 0, 1, 2, 3, 4, 9, 9]), 2, 4);
    assert.deepEqual(Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'uV4'))), [1, 2, 3, 4]);
    gl.uniform4fv(loc, new Float32Array([1, 2, 3]), 0, 4);
    assert.equal(gl.getError(), INVALID_VALUE, 'a range past the end raises INVALID_VALUE');
    dispose(gl);
  });

  test('getFragDataLocation', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, GLSL300.fsSolid);
    assert.equal(gl.getFragDataLocation(p, 'fragColor'), 0);
    assert.equal(gl.getFragDataLocation(p, 'nope'), -1);
    assertNoError(gl);
    dispose(gl);
  });

  test('getUniformIndices / getActiveUniforms', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS300, FS300_KITCHEN);
    const names = ['uF', 'uV4', 'uU4', 'nope'];
    const indices = gl.getUniformIndices(p, names);
    assert.ok(Array.isArray(indices));
    assert.equal(indices.length, 4);
    assert.equal(indices[3], gl.INVALID_INDEX, 'unknown names map to INVALID_INDEX');

    const real = indices.slice(0, 3);
    const types = gl.getActiveUniforms(p, real, gl.UNIFORM_TYPE);
    assert.deepEqual(types, [gl.FLOAT, gl.FLOAT_VEC4, gl.UNSIGNED_INT_VEC4]);
    const sizes = gl.getActiveUniforms(p, real, gl.UNIFORM_SIZE);
    assert.deepEqual(sizes, [1, 1, 1]);
    const blockIdx = gl.getActiveUniforms(p, real, gl.UNIFORM_BLOCK_INDEX);
    assert.deepEqual(blockIdx, [-1, -1, -1], 'default-block uniforms report block index -1');
    const rowMajor = gl.getActiveUniforms(p, real, gl.UNIFORM_IS_ROW_MAJOR);
    assert.deepEqual(rowMajor, [false, false, false]);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WebGL 2 uniform blocks', () => {
  const VS_UBO = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
  const FS_UBO = `#version 300 es
precision mediump float;
layout(std140) uniform Colors {
  vec4 uTint;
  vec4 uBias;
};
out vec4 fragColor;
void main() { fragColor = uTint + uBias; }`;

  test('block introspection and a UBO driving the rendered color', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS_UBO, FS_UBO);
    assert.equal(gl.getProgramParameter(p, gl.ACTIVE_UNIFORM_BLOCKS), 1);

    const idx = gl.getUniformBlockIndex(p, 'Colors');
    assert.notEqual(idx, gl.INVALID_INDEX);
    assert.equal(gl.getUniformBlockIndex(p, 'Nope'), gl.INVALID_INDEX);
    assert.equal(gl.getActiveUniformBlockName(p, idx), 'Colors');

    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_DATA_SIZE), 32, 'two std140 vec4s');
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_ACTIVE_UNIFORMS), 2);
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_BINDING), 0, 'blocks default to binding 0');
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER), true);
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER), false);
    const members = gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES);
    assert.ok(members instanceof Uint32Array);
    assert.equal(members.length, 2);

    // bind the block to unit 2 and feed it a buffer
    gl.uniformBlockBinding(p, idx, 2);
    assert.equal(gl.getActiveUniformBlockParameter(p, idx, gl.UNIFORM_BLOCK_BINDING), 2);

    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([0.25, 0, 0, 1, 0, 0.5, 0, 0]), gl.STATIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 2, ubo);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 2), ubo);

    gl.useProgram(p);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 4, 4), [64, 128, 0, 255], 2, 'uTint + uBias through the UBO');
    assertNoError(gl);
    dispose(gl);
  });

  test('bindBufferRange feeds a sub-range of a UBO', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, VS_UBO, FS_UBO);
    const idx = gl.getUniformBlockIndex(p, 'Colors');
    gl.uniformBlockBinding(p, idx, 0);

    const align = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
    assert.ok(align >= 1 && align % 4 === 0, `UNIFORM_BUFFER_OFFSET_ALIGNMENT = ${align}`);
    const floats = new Float32Array(align / 4 + 8);
    floats.set([0, 1, 0, 1, 0, 0, 0, 0], align / 4); // green tint at the aligned offset

    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, floats, gl.STATIC_DRAW);
    gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, ubo, align, 32);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0), ubo);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_START, 0), align);
    assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE, 0), 32);

    gl.useProgram(p);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 4, 4), [0, 255, 0, 255], 2);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WebGL 1 solid-color pipeline still renders', () => {
  test('GLSL ES 1.00 program draws through the default framebuffer', () => {
    const gl = makeGL(1, 8, 8);
    const p = program(gl, VS100, GLSL100.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 1, 0, 1);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 4, 4), [255, 255, 0, 255]);
    clearErrors(gl);
    dispose(gl);
  });
});
