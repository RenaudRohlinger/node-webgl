// Object identity, is*/delete* semantics, cross-context and deleted-object errors, brand checks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebGLBuffer, WebGLFramebuffer, WebGLProgram, WebGLRenderbuffer, WebGLShader, WebGLTexture,
  WebGLQuery, WebGLSampler, WebGLSync, WebGLTransformFeedback, WebGLVertexArrayObject,
  WebGLUniformLocation, WebGLActiveInfo, WebGLShaderPrecisionFormat, WebGLContextEvent,
  WebGLRenderingContext, WebGL2RenderingContext, ImageData,
} from '../src/index.ts';
import { makeGL, dispose, program, shader, readPixel, assertPixel, assertNoError, clearErrors, GLSL300 } from './helpers.ts';

const INVALID_OPERATION = 0x0502;

describe('is* / delete* lifecycle', () => {
  test('objects that only exist once bound', () => {
    const gl = makeGL(2, 8, 8);
    const cases: [string, () => any, (o: any) => void, (o: any) => boolean, (o: any) => void][] = [
      ['buffer', () => gl.createBuffer(), (o) => gl.bindBuffer(gl.ARRAY_BUFFER, o), (o) => gl.isBuffer(o), (o) => gl.deleteBuffer(o)],
      ['framebuffer', () => gl.createFramebuffer(), (o) => gl.bindFramebuffer(gl.FRAMEBUFFER, o), (o) => gl.isFramebuffer(o), (o) => gl.deleteFramebuffer(o)],
      ['renderbuffer', () => gl.createRenderbuffer(), (o) => gl.bindRenderbuffer(gl.RENDERBUFFER, o), (o) => gl.isRenderbuffer(o), (o) => gl.deleteRenderbuffer(o)],
      ['texture', () => gl.createTexture(), (o) => gl.bindTexture(gl.TEXTURE_2D, o), (o) => gl.isTexture(o), (o) => gl.deleteTexture(o)],
      ['vertexArray', () => gl.createVertexArray(), (o) => gl.bindVertexArray(o), (o) => gl.isVertexArray(o), (o) => gl.deleteVertexArray(o)],
      ['transformFeedback', () => gl.createTransformFeedback(), (o) => gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, o), (o) => gl.isTransformFeedback(o), (o) => gl.deleteTransformFeedback(o)],
    ];
    for (const [name, create, bind, is, del] of cases) {
      const obj = create();
      assert.ok(obj, `${name} created`);
      assert.equal(is(obj), false, `${name}: is* is false before the first bind`);
      bind(obj);
      assert.equal(is(obj), true, `${name}: is* is true after binding`);
      bind(null);
      assert.equal(is(obj), true, `${name}: unbinding does not delete`);
      del(obj);
      assert.equal(is(obj), false, `${name}: is* is false after delete`);
      del(obj);
      assert.equal(is(obj), false, `${name}: deleting twice is a no-op`);
      assertNoError(gl, `${name} lifecycle`);
    }
    dispose(gl);
  });

  test('shaders, programs, samplers and syncs exist as soon as they are created', () => {
    const gl = makeGL(2, 8, 8);
    const s = gl.createShader(gl.VERTEX_SHADER);
    assert.equal(gl.isShader(s), true);
    gl.deleteShader(s);
    assert.equal(gl.isShader(s), false);

    const p = gl.createProgram();
    assert.equal(gl.isProgram(p), true);
    gl.deleteProgram(p);
    assert.equal(gl.isProgram(p), false);

    const sampler = gl.createSampler();
    assert.equal(gl.isSampler(sampler), true);
    gl.deleteSampler(sampler);
    assert.equal(gl.isSampler(sampler), false);

    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    assert.equal(gl.isSync(sync), true);
    gl.deleteSync(sync);
    assert.equal(gl.isSync(sync), false);
    gl.deleteSync(sync);

    const q = gl.createQuery();
    assert.equal(gl.isQuery(q), false, 'a query exists once it has been begun');
    gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
    assert.equal(gl.isQuery(q), true);
    gl.endQuery(gl.ANY_SAMPLES_PASSED);
    gl.deleteQuery(q);
    assert.equal(gl.isQuery(q), false);
    assertNoError(gl);
    dispose(gl);
  });

  test('deleting null and is*(null) are harmless', () => {
    const gl = makeGL(2, 8, 8);
    gl.deleteBuffer(null);
    gl.deleteTexture(null);
    gl.deleteProgram(null);
    gl.deleteShader(null);
    gl.deleteFramebuffer(null);
    gl.deleteRenderbuffer(null);
    gl.deleteVertexArray(null);
    gl.deleteSampler(null);
    gl.deleteSync(null);
    gl.deleteQuery(null);
    gl.deleteTransformFeedback(null);
    assertNoError(gl, 'deleting null does nothing');

    assert.equal(gl.isBuffer(null), false);
    assert.equal(gl.isTexture(null), false);
    assert.equal(gl.isProgram(undefined as any), false);
    assert.equal(gl.isBuffer({} as any), false, 'is* on a foreign value is false, not a throw');
    assertNoError(gl);
    dispose(gl);
  });

  test('deleting a bound buffer / texture unbinds it', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), buf);
    gl.deleteBuffer(buf);
    assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), null, 'the binding went back to the default');

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), tex);
    gl.deleteTexture(tex);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), null);

    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), rb);
    gl.deleteRenderbuffer(rb);
    assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), null);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.deleteVertexArray(vao);
    assert.equal(gl.getParameter(gl.VERTEX_ARRAY_BINDING), null);
    clearErrors(gl);
    dispose(gl);
  });
});

describe('error semantics', () => {
  test('using a deleted object raises INVALID_OPERATION', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.deleteBuffer(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    assert.equal(gl.getError(), INVALID_OPERATION, 'bindBuffer(deleted)');

    const tex = gl.createTexture();
    gl.deleteTexture(tex);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    assert.equal(gl.getError(), INVALID_OPERATION, 'bindTexture(deleted)');

    const s = gl.createShader(gl.VERTEX_SHADER);
    gl.deleteShader(s);
    gl.shaderSource(s, 'void main(){}');
    assert.equal(gl.getError(), INVALID_OPERATION, 'shaderSource(deleted)');
    assert.equal(gl.getShaderSource(s), null);
    assert.equal(gl.getError(), INVALID_OPERATION);

    const p = gl.createProgram();
    gl.deleteProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), null);
    assert.equal(gl.getError(), INVALID_OPERATION, 'getProgramParameter(deleted)');
    gl.useProgram(p);
    assert.equal(gl.getError(), INVALID_OPERATION, 'useProgram(deleted)');
    dispose(gl);
  });

  test('objects from another context raise INVALID_OPERATION', () => {
    const a = makeGL(2, 8, 8);
    const b = makeGL(2, 8, 8);
    const buf = a.createBuffer();
    a.bindBuffer(a.ARRAY_BUFFER, buf);
    const tex = a.createTexture();
    const prog = program(a, GLSL300.vsQuad, GLSL300.fsSolid);
    assertNoError(a);

    b.bindBuffer(b.ARRAY_BUFFER, buf);
    assert.equal(b.getError(), INVALID_OPERATION, 'bindBuffer with a foreign buffer');
    b.bindTexture(b.TEXTURE_2D, tex);
    assert.equal(b.getError(), INVALID_OPERATION, 'bindTexture with a foreign texture');
    b.useProgram(prog);
    assert.equal(b.getError(), INVALID_OPERATION, 'useProgram with a foreign program');
    assert.equal(b.getUniformLocation(prog, 'u_color'), null);
    assert.equal(b.getError(), INVALID_OPERATION);
    b.deleteBuffer(buf);
    assert.equal(b.getError(), INVALID_OPERATION, 'deleting a foreign object');
    assert.equal(b.isBuffer(buf), false);

    // the original context is unaffected
    assert.equal(a.isBuffer(buf), true, 'the foreign delete did not destroy it');
    assertNoError(a);
    dispose(a);
    dispose(b);
  });

  test('wrong object types throw TypeError like a browser', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    const tex = gl.createTexture();
    const prog = gl.createProgram();

    assert.throws(() => gl.bindBuffer(gl.ARRAY_BUFFER, tex as any), TypeError, 'a texture where a buffer is expected');
    assert.throws(() => gl.bindTexture(gl.TEXTURE_2D, buf as any), TypeError, 'a buffer where a texture is expected');
    assert.throws(() => gl.useProgram(buf as any), TypeError);
    assert.throws(() => gl.deleteBuffer(tex as any), TypeError);
    assert.throws(() => gl.bindFramebuffer(gl.FRAMEBUFFER, buf as any), TypeError);
    assert.throws(() => gl.attachShader(prog, buf as any), TypeError);

    // null is only allowed where the IDL says nullable
    assert.throws(() => gl.shaderSource(null as any, ''), TypeError, 'shaderSource(null)');
    assert.throws(() => gl.compileShader(null as any), TypeError);
    assert.throws(() => gl.linkProgram(null as any), TypeError);
    assert.throws(() => gl.getProgramParameter(null as any, gl.LINK_STATUS), TypeError);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    assertNoError(gl, 'null is fine for the nullable bind points');

    assert.throws(() => gl.uniform1f({} as any, 1), TypeError, 'a bogus uniform location');
    dispose(gl);
  });
});

describe('deletion while still in use', () => {
  test('a deleted shader stays attached and the program keeps working', () => {
    const gl = makeGL(2, 16, 16);
    const vs = shader(gl, gl.VERTEX_SHADER, GLSL300.vsQuad);
    const fs = shader(gl, gl.FRAGMENT_SHADER, GLSL300.fsSolid);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true);

    gl.deleteShader(vs);
    gl.deleteShader(fs);
    assert.equal(gl.isShader(vs), false);
    assert.equal(gl.getProgramParameter(p, gl.ATTACHED_SHADERS), 2, 'the shaders are still attached');

    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 0, 0, 1);
    const loc = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 2, 'the program still renders');
    assertNoError(gl);
    dispose(gl);
  });

  test('a deleted program keeps rendering until useProgram(null)', () => {
    const gl = makeGL(2, 16, 16);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 1, 0, 1);
    const loc = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.deleteProgram(p);
    assert.equal(gl.isProgram(p), false, 'the program is flagged for deletion');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    assertNoError(gl, 'drawing with a deleted but still-current program');
    assertPixel(readPixel(gl, 8, 8), [0, 255, 0, 255], 2, 'it still renders');

    gl.useProgram(null);
    assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    assert.equal(gl.getError(), INVALID_OPERATION, 'drawing with no program is an error');
    assertPixel(readPixel(gl, 8, 8), [0, 0, 0, 255], 2, 'and nothing was drawn');
    dispose(gl);
  });

  test('a texture attached to a framebuffer survives until detached', () => {
    const gl = makeGL(2, 8, 8);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);

    gl.deleteTexture(tex);
    // GL detaches a deleted texture from the currently bound framebuffer
    assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
    clearErrors(gl);
    dispose(gl);
  });
});

describe('brands and classes', () => {
  test('Object.prototype.toString on contexts and objects', () => {
    const gl2 = makeGL(2, 8, 8);
    const gl1 = makeGL(1, 8, 8);
    assert.equal(Object.prototype.toString.call(gl2), '[object WebGL2RenderingContext]');
    assert.equal(Object.prototype.toString.call(gl1), '[object WebGLRenderingContext]');
    assert.equal(Object.prototype.toString.call(gl2.canvas), '[object HTMLCanvasElement]');

    assert.equal(Object.prototype.toString.call(gl2.createBuffer()), '[object WebGLBuffer]');
    assert.equal(Object.prototype.toString.call(gl2.createTexture()), '[object WebGLTexture]');
    assert.equal(Object.prototype.toString.call(gl2.createProgram()), '[object WebGLProgram]');
    assert.equal(Object.prototype.toString.call(gl2.createShader(gl2.VERTEX_SHADER)), '[object WebGLShader]');
    assert.equal(Object.prototype.toString.call(gl2.createFramebuffer()), '[object WebGLFramebuffer]');
    assert.equal(Object.prototype.toString.call(gl2.createRenderbuffer()), '[object WebGLRenderbuffer]');
    assert.equal(Object.prototype.toString.call(gl2.createVertexArray()), '[object WebGLVertexArrayObject]');
    assert.equal(Object.prototype.toString.call(gl2.createSampler()), '[object WebGLSampler]');
    assert.equal(Object.prototype.toString.call(gl2.createQuery()), '[object WebGLQuery]');
    assert.equal(Object.prototype.toString.call(gl2.createTransformFeedback()), '[object WebGLTransformFeedback]');
    assert.equal(Object.prototype.toString.call(gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0)), '[object WebGLSync]');
    assert.equal(Object.prototype.toString.call(new ImageData(1, 1)), '[object ImageData]');
    assertNoError(gl2);
    dispose(gl2);
    dispose(gl1);
  });

  test('every object is instanceof its exported class', () => {
    const gl = makeGL(2, 8, 8);
    assert.ok(gl instanceof WebGL2RenderingContext);
    assert.ok(gl.createBuffer() instanceof WebGLBuffer);
    assert.ok(gl.createFramebuffer() instanceof WebGLFramebuffer);
    assert.ok(gl.createRenderbuffer() instanceof WebGLRenderbuffer);
    assert.ok(gl.createTexture() instanceof WebGLTexture);
    assert.ok(gl.createShader(gl.VERTEX_SHADER) instanceof WebGLShader);
    assert.ok(gl.createVertexArray() instanceof WebGLVertexArrayObject);
    assert.ok(gl.createSampler() instanceof WebGLSampler);
    assert.ok(gl.createQuery() instanceof WebGLQuery);
    assert.ok(gl.createTransformFeedback() instanceof WebGLTransformFeedback);
    assert.ok(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) instanceof WebGLSync);

    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    assert.ok(p instanceof WebGLProgram);
    assert.ok(gl.getUniformLocation(p, 'u_color') instanceof WebGLUniformLocation);
    assert.ok(gl.getActiveAttrib(p, 0) instanceof WebGLActiveInfo);
    assert.ok(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) instanceof WebGLShaderPrecisionFormat);
    assert.ok(new WebGLContextEvent('webglcontextlost') instanceof Event);
    assert.equal(new WebGLContextEvent('webglcontextlost', { statusMessage: 'x' }).statusMessage, 'x');

    const gl1 = makeGL(1, 8, 8);
    assert.ok(gl1 instanceof WebGLRenderingContext);
    assert.ok(!(gl1 instanceof WebGL2RenderingContext));
    assertNoError(gl);
    dispose(gl);
    dispose(gl1);
  });

  test('WebGLActiveInfo and WebGLShaderPrecisionFormat fields are read-only data', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    const info = gl.getActiveUniform(p, 0);
    assert.equal(typeof info.name, 'string');
    assert.equal(typeof info.size, 'number');
    assert.equal(typeof info.type, 'number');
    const fmt = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
    assert.equal(typeof fmt.rangeMin, 'number');
    assert.equal(typeof fmt.rangeMax, 'number');
    assert.equal(typeof fmt.precision, 'number');
    dispose(gl);
  });

  test('canvas.dispose() makes the context behave as lost', () => {
    const gl = makeGL(2, 8, 8);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255], 0);
    dispose(gl);
    assert.equal(gl.isContextLost(), true);
    assert.equal(gl.createBuffer(), null);
    assert.equal(gl.getParameter(gl.MAX_TEXTURE_SIZE), null);
    dispose(gl); // idempotent
  });
});
