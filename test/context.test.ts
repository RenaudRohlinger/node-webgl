// Context creation, attributes, drawing buffer, getParameter typing and PNG output.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, createWebGLContext, decodePNG, init, getDisplayInfo, WebGLRenderingContext, WebGL2RenderingContext, WebGLBuffer, WebGLProgram, WebGLTexture } from '../src/index.ts';
import { assertPixel, assertNoError, glErrorName, readPixel, dispose, makeGL, solidProgram, drawFullscreenQuad } from './helpers.ts';

const INVALID_ENUM = 0x0500;

describe('context creation', () => {
  test('createCanvas + getContext("webgl2") yields a WebGL2RenderingContext', () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2');
    assert.ok(gl instanceof WebGL2RenderingContext);
    assert.ok(gl instanceof WebGLRenderingContext === false, 'WebGL2 context is not a WebGLRenderingContext subclass');
    assert.equal(Object.prototype.toString.call(gl), '[object WebGL2RenderingContext]');
    assert.equal(gl!.canvas, canvas);
    assert.equal(gl!.getParameter(gl!.VERSION), 'WebGL 2.0 (OpenGL ES 3.0 ANGLE)');
    canvas.dispose();
  });

  test('createCanvas + getContext("webgl") yields a WebGLRenderingContext', () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl');
    assert.ok(gl instanceof WebGLRenderingContext);
    assert.equal(Object.prototype.toString.call(gl), '[object WebGLRenderingContext]');
    assert.match(gl!.getParameter(gl!.VERSION), /^WebGL 1\.0/);
    assert.match(gl!.getParameter(gl!.SHADING_LANGUAGE_VERSION), /GLSL ES 1\.0/);
    canvas.dispose();
  });

  test('getContext returns the same object and null for a different type', () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext('webgl2');
    assert.ok(gl);
    assert.equal(canvas.getContext('webgl2'), gl, 'repeated getContext returns the same object');
    assert.equal(canvas.getContext('experimental-webgl2'), gl);
    assert.equal(canvas.getContext('webgl'), null, 'a webgl context cannot be created after webgl2');
    assert.equal(canvas.getContext('2d'), null);
    assert.equal(canvas.getContext('bitmaprenderer'), null);
    canvas.dispose();
  });

  test('experimental-webgl creates a WebGL 1 context', () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext('experimental-webgl');
    assert.ok(gl instanceof WebGLRenderingContext);
    assert.equal(canvas.getContext('webgl'), gl);
    canvas.dispose();
  });

  test('createWebGLContext(w, h, {version}) hands back a context with a canvas', () => {
    const gl2 = createWebGLContext(16, 8);
    assert.ok(gl2 instanceof WebGL2RenderingContext);
    assert.equal(gl2.drawingBufferWidth, 16);
    assert.equal(gl2.drawingBufferHeight, 8);
    assert.equal((gl2.canvas as any).width, 16);
    dispose(gl2);

    const gl1 = createWebGLContext(4, 4, { version: 1 });
    assert.ok(gl1 instanceof WebGLRenderingContext);
    dispose(gl1);
  });
});

describe('context attributes', () => {
  test('defaults match the spec', () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2')!;
    const a = gl.getContextAttributes()!;
    assert.equal(a.alpha, true);
    assert.equal(a.depth, true);
    assert.equal(a.stencil, false);
    assert.equal(a.premultipliedAlpha, true);
    assert.equal(a.preserveDrawingBuffer, false);
    assert.equal(a.powerPreference, 'default');
    assert.equal(a.failIfMajorPerformanceCaveat, false);
    canvas.dispose();
  });

  test('alpha:false gives ALPHA_BITS 0 and readPixels alpha 255', () => {
    const gl = makeGL(2, 16, 16, { alpha: false });
    assert.equal(gl.getContextAttributes().alpha, false);
    assert.equal(gl.getParameter(gl.ALPHA_BITS), 0);
    assert.ok(gl.getParameter(gl.RED_BITS) >= 8);
    gl.clearColor(0.25, 0.5, 0.75, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = readPixel(gl, 0, 0);
    assert.equal(px[3], 255, 'an alpha-less drawing buffer reads back opaque');
    assertPixel(px, [64, 128, 191, 255], 2);
    dispose(gl);
  });

  test('alpha:true keeps the cleared alpha', () => {
    const gl = makeGL(2, 8, 8, { alpha: true });
    assert.ok(gl.getParameter(gl.ALPHA_BITS) >= 8);
    gl.clearColor(0, 0, 0, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 0, 0), [0, 0, 0, 128], 2);
    dispose(gl);
  });

  test('depth / stencil attributes drive DEPTH_BITS and STENCIL_BITS', () => {
    const d = makeGL(2, 8, 8, { depth: true, stencil: false });
    assert.ok(d.getParameter(d.DEPTH_BITS) >= 16, `DEPTH_BITS = ${d.getParameter(d.DEPTH_BITS)}`);
    assert.equal(d.getParameter(d.STENCIL_BITS), 0);
    dispose(d);

    const ds = makeGL(2, 8, 8, { depth: true, stencil: true });
    assert.ok(ds.getParameter(ds.DEPTH_BITS) >= 16);
    assert.equal(ds.getParameter(ds.STENCIL_BITS), 8);
    assert.equal(ds.getContextAttributes().stencil, true);
    dispose(ds);

    const none = makeGL(2, 8, 8, { depth: false, stencil: false });
    assert.equal(none.getParameter(none.DEPTH_BITS), 0);
    assert.equal(none.getParameter(none.STENCIL_BITS), 0);
    dispose(none);
  });

  test('antialias:true reports SAMPLES > 0 and SAMPLE_BUFFERS 1', () => {
    const gl = makeGL(2, 16, 16, { antialias: true });
    const attrs = gl.getContextAttributes();
    assert.equal(attrs.antialias, true, 'MSAA should be available through ANGLE/Metal');
    assert.ok(gl.getParameter(gl.SAMPLES) > 0, `SAMPLES = ${gl.getParameter(gl.SAMPLES)}`);
    assert.equal(gl.getParameter(gl.SAMPLE_BUFFERS), 1);
    // The resolved buffer still reads back the cleared color.
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255]);
    dispose(gl);
  });

  test('antialias:false reports SAMPLES 0', () => {
    const gl = makeGL(2, 16, 16, { antialias: false });
    assert.equal(gl.getContextAttributes().antialias, false);
    assert.equal(gl.getParameter(gl.SAMPLES), 0);
    assert.equal(gl.getParameter(gl.SAMPLE_BUFFERS), 0);
    dispose(gl);
  });

  test('powerPreference / failIfMajorPerformanceCaveat / premultipliedAlpha are reflected back', () => {
    const gl = makeGL(2, 8, 8, {
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    const a = gl.getContextAttributes();
    assert.equal(a.powerPreference, 'high-performance');
    assert.equal(a.failIfMajorPerformanceCaveat, true);
    assert.equal(a.premultipliedAlpha, false);
    assert.equal(a.preserveDrawingBuffer, true);
    dispose(gl);
  });

  test('the drawing buffer persists between draws even with preserveDrawingBuffer:false', () => {
    const gl = makeGL(2, 16, 16, { preserveDrawingBuffer: false });
    assert.equal(gl.getContextAttributes().preserveDrawingBuffer, false);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // headless: nothing composites the buffer away, so a later readback still sees it
    gl.finish();
    assertPixel(readPixel(gl, 8, 8), [255, 0, 0, 255], 0);
    const { prog, color } = solidProgram(gl, true);
    gl.useProgram(prog);
    gl.uniform4f(color, 0, 0, 1, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 8, 16);
    drawFullscreenQuad(gl, prog);
    gl.disable(gl.SCISSOR_TEST);
    assertPixel(readPixel(gl, 4, 8), [0, 0, 255, 255], 0, 'the new draw landed');
    assertPixel(readPixel(gl, 12, 8), [255, 0, 0, 255], 0, 'the previous frame is still there');
    dispose(gl);
  });

  test('init() and getDisplayInfo() describe the ANGLE backend', () => {
    const info = init();
    assert.ok(info);
    assert.equal(typeof info.backend, 'string');
    assert.ok(info.backend.length > 0, `backend = ${info.backend}`);
    assert.equal(typeof info.vendor, 'string');
    assert.equal(typeof info.version, 'string');
    assert.equal(typeof info.extensions, 'string');
    assert.equal(typeof info.surfaceless, 'boolean');
    assert.deepEqual(getDisplayInfo(), info, 'getDisplayInfo returns the cached display info');
  });

  test('WebGL 1 honours the same attributes', () => {
    const gl = makeGL(1, 8, 8, { alpha: false, stencil: true, antialias: true });
    const a = gl.getContextAttributes();
    assert.equal(a.alpha, false);
    assert.equal(a.stencil, true);
    assert.equal(gl.getParameter(gl.ALPHA_BITS), 0);
    assert.equal(gl.getParameter(gl.STENCIL_BITS), 8);
    assert.ok(gl.getParameter(gl.SAMPLES) > 0, 'WebGL 1 MSAA via ANGLE_framebuffer_multisample');
    dispose(gl);
  });
});

describe('drawing buffer', () => {
  test('drawingBufferWidth/Height follow the canvas', () => {
    const canvas = createCanvas(32, 24);
    const gl = canvas.getContext('webgl2')!;
    assert.equal(gl.drawingBufferWidth, 32);
    assert.equal(gl.drawingBufferHeight, 24);
    canvas.dispose();
  });

  test('resizing via canvas.width clears the buffer but leaves the viewport alone', () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 0, 0), [255, 0, 0, 255]);

    const viewportBefore = Array.from(gl.getParameter(gl.VIEWPORT));
    canvas.width = 32;
    assert.equal(gl.drawingBufferWidth, 32);
    assert.equal(gl.drawingBufferHeight, 16);
    assertPixel(readPixel(gl, 0, 0), [0, 0, 0, 0], 0, 'a resized drawing buffer starts transparent black');
    assert.deepEqual(Array.from(gl.getParameter(gl.VIEWPORT)), viewportBefore,
      'per the WebGL spec, resizing the drawing buffer does not change the viewport');

    canvas.height = 8;
    assert.equal(gl.drawingBufferHeight, 8);
    assertNoError(gl);
    canvas.dispose();
  });

  test('two contexts in one process render independently', () => {
    const a = makeGL(2, 8, 8);
    const b = makeGL(2, 8, 8);
    const c = makeGL(1, 8, 8);

    a.clearColor(1, 0, 0, 1);
    a.clear(a.COLOR_BUFFER_BIT);
    b.clearColor(0, 1, 0, 1);
    b.clear(b.COLOR_BUFFER_BIT);
    c.clearColor(0, 0, 1, 1);
    c.clear(c.COLOR_BUFFER_BIT);

    // Interleave reads to force context switching.
    assertPixel(readPixel(a, 0, 0), [255, 0, 0, 255], 0, 'context a');
    assertPixel(readPixel(c, 0, 0), [0, 0, 255, 255], 0, 'context c');
    assertPixel(readPixel(b, 0, 0), [0, 255, 0, 255], 0, 'context b');
    assertPixel(readPixel(a, 4, 4), [255, 0, 0, 255], 0, 'context a again');

    // Objects belong to one context only.
    const buf = a.createBuffer();
    assert.equal(a.isBuffer(buf), false, 'not a buffer before first bind');
    a.bindBuffer(a.ARRAY_BUFFER, buf);
    assert.equal(a.isBuffer(buf), true);
    assert.equal(b.isBuffer(buf), false, 'foreign object is not recognised');

    dispose(a); dispose(b); dispose(c);
  });
});

describe('getParameter', () => {
  test('returns the documented JS types (WebGL 2)', () => {
    const gl = makeGL(2, 16, 16);

    // booleans
    for (const p of ['DEPTH_TEST', 'BLEND', 'CULL_FACE', 'DITHER', 'SCISSOR_TEST', 'STENCIL_TEST', 'DEPTH_WRITEMASK',
      'UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'RASTERIZER_DISCARD', 'TRANSFORM_FEEDBACK_ACTIVE'] as const) {
      assert.equal(typeof gl.getParameter(gl[p]), 'boolean', `${p} should be a boolean`);
    }
    assert.equal(gl.getParameter(gl.DITHER), true, 'DITHER is enabled by default');
    assert.equal(gl.getParameter(gl.DEPTH_WRITEMASK), true);
    assert.equal(gl.getParameter(gl.DEPTH_TEST), false);

    // numbers
    for (const p of ['MAX_TEXTURE_SIZE', 'MAX_VERTEX_ATTRIBS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'RED_BITS',
      'DEPTH_BITS', 'SUBPIXEL_BITS', 'PACK_ALIGNMENT', 'UNPACK_ALIGNMENT', 'MAX_3D_TEXTURE_SIZE',
      'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_SAMPLES',
      'MAX_ELEMENT_INDEX', 'MAX_UNIFORM_BLOCK_SIZE', 'MAX_SERVER_WAIT_TIMEOUT', 'MAX_TEXTURE_LOD_BIAS',
      'LINE_WIDTH', 'DEPTH_CLEAR_VALUE', 'POLYGON_OFFSET_FACTOR', 'SAMPLE_COVERAGE_VALUE',
      'ACTIVE_TEXTURE', 'BLEND_EQUATION_RGB', 'DEPTH_FUNC', 'CULL_FACE_MODE', 'FRONT_FACE', 'STENCIL_FUNC'] as const) {
      const v = gl.getParameter(gl[p]);
      assert.equal(typeof v, 'number', `${p} should be a number, got ${typeof v}`);
      assert.ok(Number.isFinite(v), `${p} should be finite`);
    }
    assert.equal(gl.getParameter(gl.UNPACK_ALIGNMENT), 4);
    assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE0);
    assert.equal(gl.getParameter(gl.DEPTH_FUNC), gl.LESS);
    assert.equal(gl.getParameter(gl.CULL_FACE_MODE), gl.BACK);
    assert.equal(gl.getParameter(gl.FRONT_FACE), gl.CCW);
    assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB), gl.FUNC_ADD);
    assert.equal(gl.getParameter(gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL), 1e9);

    // Int32Array(4)
    for (const p of ['VIEWPORT', 'SCISSOR_BOX'] as const) {
      const v = gl.getParameter(gl[p]);
      assert.ok(v instanceof Int32Array, `${p} should be an Int32Array`);
      assert.equal(v.length, 4);
    }
    assert.deepEqual(Array.from(gl.getParameter(gl.VIEWPORT)), [0, 0, 16, 16]);

    // Int32Array(2)
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    assert.ok(dims instanceof Int32Array);
    assert.equal(dims.length, 2);

    // Float32Array(4)
    for (const p of ['COLOR_CLEAR_VALUE', 'BLEND_COLOR'] as const) {
      const v = gl.getParameter(gl[p]);
      assert.ok(v instanceof Float32Array, `${p} should be a Float32Array`);
      assert.equal(v.length, 4);
    }
    gl.clearColor(0.25, 0.5, 0.75, 1);
    assert.deepEqual(Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)), [0.25, 0.5, 0.75, 1]);

    // Float32Array(2)
    for (const p of ['DEPTH_RANGE', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE'] as const) {
      const v = gl.getParameter(gl[p]);
      assert.ok(v instanceof Float32Array, `${p} should be a Float32Array`);
      assert.equal(v.length, 2);
    }
    assert.deepEqual(Array.from(gl.getParameter(gl.DEPTH_RANGE)), [0, 1]);

    // boolean[4]
    const mask = gl.getParameter(gl.COLOR_WRITEMASK);
    assert.ok(Array.isArray(mask), 'COLOR_WRITEMASK is a sequence<GLboolean>');
    assert.deepEqual(mask, [true, true, true, true]);

    // Uint32Array
    const formats = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
    assert.ok(formats instanceof Uint32Array, 'COMPRESSED_TEXTURE_FORMATS is a Uint32Array');

    // strings
    for (const p of ['VERSION', 'VENDOR', 'RENDERER', 'SHADING_LANGUAGE_VERSION'] as const) {
      const v = gl.getParameter(gl[p]);
      assert.equal(typeof v, 'string', `${p} should be a string`);
      assert.ok(v.length > 0);
    }

    // nulls for unbound objects
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null, 'default framebuffer reads back as null');
    assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), null);
    assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), null);
    assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), null);
    assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), null);
    assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), null);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), null);
    assert.equal(gl.getParameter(gl.SAMPLER_BINDING), null);
    assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING), null);

    // READ_BUFFER / DRAW_BUFFER0 report BACK for the default framebuffer
    assert.equal(gl.getParameter(gl.READ_BUFFER), gl.BACK);
    assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.BACK);

    assertNoError(gl);
    dispose(gl);
  });

  test('returns object identity for bound objects', () => {
    const gl = makeGL(2, 8, 8);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const got = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    assert.equal(got, buf, 'ARRAY_BUFFER_BINDING returns the same JS object');
    assert.ok(got instanceof WebGLBuffer);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), tex);
    assert.ok(gl.getParameter(gl.TEXTURE_BINDING_2D) instanceof WebGLTexture);

    const { prog } = solidProgram(gl, true);
    gl.useProgram(prog);
    assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), prog);
    assert.ok(gl.getParameter(gl.CURRENT_PROGRAM) instanceof WebGLProgram);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null);

    assertNoError(gl);
    dispose(gl);
  });

  // KNOWN LIBRARY BUG: WebGL 2 core pnames whose enum value is also a WebGL 1 extension pname
  // (MAX_COLOR_ATTACHMENTS/0x8CDF, MAX_DRAW_BUFFERS/0x8824, VERTEX_ARRAY_BINDING/0x85B5,
  // FRAGMENT_SHADER_DERIVATIVE_HINT/0x8B8B) are gated behind getExtension() on WebGL 2 too.
  test('WebGL 2 core pnames that alias WebGL 1 extension enums need no extension', () => {
    const gl = makeGL(2, 8, 8);

    const attachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
    assert.equal(gl.getError(), 0, 'MAX_COLOR_ATTACHMENTS is core in WebGL 2');
    assert.equal(typeof attachments, 'number');
    assert.ok(attachments >= 4, `MAX_COLOR_ATTACHMENTS = ${attachments}`);

    const drawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
    assert.equal(gl.getError(), 0, 'MAX_DRAW_BUFFERS is core in WebGL 2');
    assert.ok(drawBuffers >= 4, `MAX_DRAW_BUFFERS = ${drawBuffers}`);

    const hint = gl.getParameter(gl.FRAGMENT_SHADER_DERIVATIVE_HINT);
    assert.equal(gl.getError(), 0, 'FRAGMENT_SHADER_DERIVATIVE_HINT is core in WebGL 2');
    assert.equal(hint, gl.DONT_CARE);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    assert.equal(gl.getParameter(gl.VERTEX_ARRAY_BINDING), vao, 'VERTEX_ARRAY_BINDING is core in WebGL 2');
    gl.bindVertexArray(null);
    assertNoError(gl);
    dispose(gl);
  });

  test('an unknown pname yields INVALID_ENUM and null', () => {
    const gl = makeGL(2, 8, 8);
    assert.equal(gl.getParameter(0x1234), null);
    assert.equal(gl.getError(), INVALID_ENUM);
    assertNoError(gl);
    dispose(gl);
  });

  test('WebGL 1 rejects WebGL 2 pnames with INVALID_ENUM', () => {
    const gl = makeGL(1, 8, 8);
    const gl2Only: Record<string, number> = {
      MAX_3D_TEXTURE_SIZE: 0x8073,
      MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
      MAX_COLOR_ATTACHMENTS: 0x8cdf,
      MAX_DRAW_BUFFERS: 0x8824,
      MAX_SAMPLES: 0x8d57,
      READ_BUFFER: 0x0c02,
      UNPACK_ROW_LENGTH: 0x0cf2,
      VERTEX_ARRAY_BINDING: 0x85b5,
      TRANSFORM_FEEDBACK_BINDING: 0x8e25,
      SAMPLER_BINDING: 0x8919,
      MAX_CLIENT_WAIT_TIMEOUT_WEBGL: 0x9247,
      RASTERIZER_DISCARD: 0x8c89,
      TEXTURE_BINDING_3D: 0x806a,
    };
    for (const [name, pname] of Object.entries(gl2Only)) {
      const v = gl.getParameter(pname);
      assert.equal(v, null, `${name} should be null on a WebGL 1 context`);
      assert.equal(gl.getError(), INVALID_ENUM, `${name} should raise INVALID_ENUM`);
    }
    // ...but the WebGL 1 pnames still work.
    assert.equal(typeof gl.getParameter(gl.MAX_TEXTURE_SIZE), 'number');
    assertNoError(gl);
    dispose(gl);
  });

  test('extension pnames need getExtension first', () => {
    const gl = makeGL(2, 8, 8);
    const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;
    assert.equal(gl.getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT), null);
    assert.equal(gl.getError(), INVALID_ENUM);
    assert.ok(gl.getExtension('EXT_texture_filter_anisotropic'));
    const v = gl.getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    assert.equal(typeof v, 'number');
    assert.ok(v >= 2, `MAX_TEXTURE_MAX_ANISOTROPY_EXT = ${v}`);
    assertNoError(gl);
    dispose(gl);
  });

  test('a lost context returns null from getParameter', () => {
    const gl = makeGL(2, 8, 8);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose.loseContext();
    assert.equal(gl.getParameter(gl.MAX_TEXTURE_SIZE), null);
    assert.equal(gl.getContextAttributes(), null);
    assert.equal(gl.drawingBufferWidth, 0);
    dispose(gl);
  });
});

describe('canvas image output', () => {
  test('toBuffer("image/png") round-trips and is top-row-first', () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    // Clear everything to blue, then scissor the bottom-left quadrant (GL coords) to red.
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 8, 8);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    assertPixel(readPixel(gl, 0, 0), [255, 0, 0, 255], 0, 'GL bottom-left is red');
    assertPixel(readPixel(gl, 0, 15), [0, 0, 1 * 255, 255], 0, 'GL top-left is blue');

    const png = canvas.toBuffer('image/png');
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');

    const img = decodePNG(new Uint8Array(png));
    assert.equal(img.width, 16);
    assert.equal(img.height, 16);
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
    assertPixel(at(0, 15), [255, 0, 0, 255], 0, 'red quadrant lands on the BOTTOM row of the image');
    assertPixel(at(0, 0), [0, 0, 255, 255], 0, 'image row 0 is the GL top row');

    canvas.dispose();
  });

  test('getImageData matches the drawing buffer, top row first', () => {
    const canvas = createCanvas(4, 4);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 3, 4, 1); // GL top row
    gl.clearColor(1, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);

    const img = canvas.getImageData();
    assert.equal(img.width, 4);
    assert.equal(img.height, 4);
    assert.equal(img.data.length, 4 * 4 * 4);
    assert.ok(img.data instanceof Uint8ClampedArray);
    assertPixel(Array.from(img.data.subarray(0, 4)), [255, 255, 0, 255], 0, 'image row 0 == GL top row');
    assertPixel(Array.from(img.data.subarray(4 * 4 * 3, 4 * 4 * 3 + 4)), [0, 255, 0, 255], 0, 'last image row == GL bottom row');
    canvas.dispose();
  });

  test('toDataURL has the right prefix and decodes', () => {
    const canvas = createCanvas(4, 4);
    const gl = canvas.getContext('webgl2')!;
    gl.clearColor(1, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const url = canvas.toDataURL();
    assert.ok(url.startsWith('data:image/png;base64,'), url.slice(0, 40));
    const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    const img = decodePNG(new Uint8Array(bytes));
    assertPixel(Array.from(img.data.subarray(0, 4)), [255, 0, 255, 255]);
    canvas.dispose();
  });

  test('rendered geometry (not just clear) shows up in the PNG', () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    const { prog, color } = solidProgram(gl, true);
    gl.useProgram(prog);
    gl.uniform4f(color, 0, 1, 1, 1);
    drawFullscreenQuad(gl, prog);
    assertNoError(gl, glErrorName(0));
    const img = decodePNG(new Uint8Array(canvas.toBuffer('image/png')));
    assertPixel(Array.from(img.data.subarray(0, 4)), [0, 255, 255, 255]);
    canvas.dispose();
  });
});

describe('display info', () => {
  test('reports the client API behind the contexts', () => {
    const d = getDisplayInfo() ?? init();
    assert.ok(d.api === 'gl' || d.api === 'gles', `api = ${d.api}`);
    if (d.api === 'gl') {
      assert.equal(d.angle, false, 'ANGLE only offers OpenGL ES');
      assert.ok(d.glVersion >= 33, `glVersion = ${d.glVersion}`);
    } else {
      assert.equal(d.glVersion, 0);
    }
    const gl = makeGL(2, 4, 4);
    assert.equal(gl.getError(), 0);
    dispose(gl);
  });
});
