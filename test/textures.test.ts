// Texture uploads from every source kind, unpack state, mipmaps, cube maps and the WebGL 2 formats.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, ImageData, loadImage, encodePNG, WebGLSampler } from '../src/index.ts';
import {
  makeGL, dispose, program, drawFullscreenQuad, readPixel, assertPixel, assertNoError, clearErrors,
  textureProgram, GLSL100, GLSL300,
} from './helpers.ts';

const INVALID_OPERATION = 0x0502;
const INVALID_VALUE = 0x0501;
const HALF_FLOAT_OES = 0x8d61;
const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
const TEXTURE_IMMUTABLE_FORMAT = 0x912f;

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];

/** 2x2 RGBA8, first row (red, green) then (blue, yellow). */
const RGBA_2X2 = () => new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 0, 255,
]);

function tex2D(gl: any, target = gl.TEXTURE_2D, filter = gl.NEAREST): any {
  const t = gl.createTexture();
  gl.bindTexture(target, t);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Renders the TEXTURE_2D bound on `unit` over the whole drawing buffer. */
function drawTexture(gl: any, isGL2: boolean, unit = 0): void {
  const { prog, tex } = textureProgram(gl, isGL2);
  gl.useProgram(prog);
  gl.uniform1i(tex, unit);
  drawFullscreenQuad(gl, prog);
  gl.useProgram(null);
  gl.deleteProgram(prog);
}

/** Center pixel of cell (col, row) of an n x n grid over the drawing buffer; row 0 is the GL bottom. */
function cell(gl: any, n: number, col: number, row: number): number[] {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  return readPixel(gl, Math.floor((col + 0.5) * w / n), Math.floor((row + 0.5) * h / n));
}

/** Asserts a 2x2 texture rendered over the drawing buffer: data row 0 lands at the GL bottom. */
function assert2x2(gl: any, bl: number[], br: number[], tl: number[], tr: number[], msg = ''): void {
  assertPixel(cell(gl, 2, 0, 0), bl, 3, `${msg} bottom-left`);
  assertPixel(cell(gl, 2, 1, 0), br, 3, `${msg} bottom-right`);
  assertPixel(cell(gl, 2, 0, 1), tl, 3, `${msg} top-left`);
  assertPixel(cell(gl, 2, 1, 1), tr, 3, `${msg} top-right`);
}

describe('texImage2D from ArrayBufferView', () => {
  test('RGBA8 2x2 uploads with data row 0 at the bottom', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'RGBA8');
    dispose(gl);
  });

  test('WebGL 1 uploads the same way', () => {
    const gl = makeGL(1, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'WebGL 1 RGBA8');
    dispose(gl);
  });

  test('RGB8 with an odd width honours UNPACK_ALIGNMENT', () => {
    const gl = makeGL(2, 24, 16);
    tex2D(gl);
    // 3x2 RGB = 9 bytes per row.
    const tight = new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, // row 0
      255, 255, 0, 0, 255, 255, 255, 0, 255, // row 1
    ]);
    assert.equal(tight.length, 18);

    // alignment 4 (the default) needs a 12-byte row stride -> 21 bytes minimum
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 3, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, tight);
    assert.equal(gl.getError(), INVALID_OPERATION, 'tight rows are too small for UNPACK_ALIGNMENT 4');

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    assert.equal(gl.getParameter(gl.UNPACK_ALIGNMENT), 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 3, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, tight);
    assertNoError(gl, 'UNPACK_ALIGNMENT 1 accepts tight rows');
    drawTexture(gl, true);
    assertPixel(cell(gl, 3, 0, 0), RED, 3, 'alignment 1 (0,0)');
    assertPixel(cell(gl, 3, 1, 0), GREEN, 3, 'alignment 1 (1,0)');
    assertPixel(cell(gl, 3, 2, 0), BLUE, 3, 'alignment 1 (2,0)');

    // same image with 12-byte padded rows and alignment 4
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const padded = new Uint8Array(24);
    padded.set(tight.subarray(0, 9), 0);
    padded.set(tight.subarray(9, 18), 12);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 3, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, padded);
    assertNoError(gl, 'padded rows work with UNPACK_ALIGNMENT 4');
    drawTexture(gl, true);
    assertPixel(cell(gl, 3, 0, 0), RED, 3, 'alignment 4 (0,0)');
    assertPixel(cell(gl, 3, 2, 1), [255, 0, 255, 255], 3, 'alignment 4 (2,1)');
    dispose(gl);
  });

  test('LUMINANCE and ALPHA formats', () => {
    const gl = makeGL(1, 16, 16);
    tex2D(gl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 2, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0, 64, 128, 255]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, [0, 0, 0, 255], [64, 64, 64, 255], [128, 128, 128, 255], [255, 255, 255, 255], 'LUMINANCE');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 2, 2, 0, gl.ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([0, 64, 128, 255]));
    assertNoError(gl);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawTexture(gl, false);
    assert2x2(gl, [0, 0, 0, 0], [0, 0, 0, 64], [0, 0, 0, 128], [0, 0, 0, 255], 'ALPHA');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, 2, 2, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 128, 255, 64, 255, 0, 255]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, [255, 255, 255, 255], [128, 128, 128, 255], [64, 64, 64, 255], [0, 0, 0, 255], 'LUMINANCE_ALPHA');
    dispose(gl);
  });

  test('UNSIGNED_SHORT_4_4_4_4 / 5_6_5 packed types', () => {
    const gl = makeGL(1, 16, 16);
    tex2D(gl);
    // 4444: r,g,b,a nibbles.  0xF00F = red, 0x0F0F = green, 0x00FF = blue, 0xFF0F = yellow
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4,
      new Uint16Array([0xf00f, 0x0f0f, 0x00ff, 0xff0f]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, '4444');

    // 565: r5 g6 b5
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 2, 2, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5,
      new Uint16Array([0xf800, 0x07e0, 0x001f, 0xffe0]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, '565');
    dispose(gl);
  });

  test('a null ArrayBufferView allocates without initialising', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    assertNoError(gl);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'allocate + texSubImage2D');
    dispose(gl);
  });

  test('a too-small view raises INVALID_OPERATION and does not crash', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
    assert.equal(gl.getError(), INVALID_OPERATION, '16 bytes cannot feed a 4x4 RGBA8 texture');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Float32Array(16));
    assert.equal(gl.getError(), INVALID_OPERATION, 'UNSIGNED_BYTE requires a Uint8Array');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2(), 8);
    assert.equal(gl.getError(), INVALID_OPERATION, 'srcOffset 8 leaves too few bytes');

    // a valid upload still works afterwards
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    dispose(gl);
  });

  test('texSubImage2D patches a region', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, [255, 0, 255, 255], 'texSubImage2D');

    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null);
    assert.equal(gl.getError(), INVALID_VALUE, 'texSubImage2D needs data');
    dispose(gl);
  });
});

describe('float and half-float textures', () => {
  test('WebGL 1 OES_texture_float', (t) => {
    const gl = makeGL(1, 16, 16);
    const ext = gl.getExtension('OES_texture_float');
    if (!ext) return void t.skip('OES_texture_float unavailable');
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array([
      1, 0, 0, 1, 0, 1, 0, 1,
      0, 0, 1, 1, 0.25, 0.5, 0.75, 1,
    ]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, RED, GREEN, BLUE, [64, 128, 191, 255], 'OES_texture_float');
    dispose(gl);
  });

  test('WebGL 1 OES_texture_half_float', (t) => {
    const gl = makeGL(1, 16, 16);
    const ext = gl.getExtension('OES_texture_half_float');
    if (!ext) return void t.skip('OES_texture_half_float unavailable');
    assert.equal(ext.HALF_FLOAT_OES, HALF_FLOAT_OES);
    tex2D(gl);
    // half-float bit patterns: 0.0 = 0x0000, 0.5 = 0x3800, 1.0 = 0x3C00
    const Z = 0x0000, H = 0x3800, O = 0x3c00;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, ext.HALF_FLOAT_OES, new Uint16Array([
      O, Z, Z, O, Z, O, Z, O,
      Z, Z, O, O, H, H, H, O,
    ]));
    assertNoError(gl);
    drawTexture(gl, false);
    assert2x2(gl, RED, GREEN, BLUE, [128, 128, 128, 255], 'OES_texture_half_float');
    dispose(gl);
  });

  test('WebGL 2 RGBA32F and RGBA16F', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array([
      1, 0, 0, 1, 0, 1, 0, 1,
      0, 0, 1, 1, 0.25, 0.5, 0.75, 1,
    ]));
    assertNoError(gl, 'RGBA32F upload');
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, [64, 128, 191, 255], 'RGBA32F');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array([
      1, 1, 0, 1, 0, 1, 1, 1,
      1, 0, 1, 1, 0.5, 0.5, 0.5, 1,
    ]));
    assertNoError(gl, 'RGBA16F upload from FLOAT');
    drawTexture(gl, true);
    assert2x2(gl, YELLOW, [0, 255, 255, 255], [255, 0, 255, 255], [128, 128, 128, 255], 'RGBA16F');
    dispose(gl);
  });

  test('WebGL 2 sRGB8_ALPHA8 is decoded to linear when sampled', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    // 188/255 in sRGB is ~0.5 in linear light
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([188, 188, 188, 255]));
    assertNoError(gl);
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), [128, 128, 128, 255], 3, 'sRGB -> linear decode');
    dispose(gl);
  });
});

describe('image sources', () => {
  test('ImageData, plain {width,height,data} and ImageBitmap-like objects', async () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    // ImageData is top-row-first: its first row ends up as texture row 0 (the GL bottom).
    const id = new ImageData(new Uint8ClampedArray(RGBA_2X2()), 2, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, id);
    assertNoError(gl, 'ImageData source');
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'ImageData');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { width: 2, height: 2, data: RGBA_2X2() });
    assertNoError(gl, 'plain object source');
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'plain {width,height,data}');

    const { createImageBitmap } = await import('../src/index.ts');
    const bmp = await createImageBitmap(id);
    assert.equal(bmp.width, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    assertNoError(gl, 'ImageBitmap source');
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'ImageBitmap');

    assert.throws(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, 'nope' as any), TypeError);
    dispose(gl);
  });

  test('another Canvas is a valid texture source', () => {
    // source canvas: GL bottom half red, top half blue
    const srcCanvas = createCanvas(4, 4);
    const src = srcCanvas.getContext('webgl2', { antialias: false })!;
    src.clearColor(0, 0, 1, 1);
    src.clear(src.COLOR_BUFFER_BIT);
    src.enable(src.SCISSOR_TEST);
    src.scissor(0, 0, 4, 2);
    src.clearColor(1, 0, 0, 1);
    src.clear(src.COLOR_BUFFER_BIT);
    src.disable(src.SCISSOR_TEST);

    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    assertNoError(gl, 'Canvas source');
    drawTexture(gl, true);
    // the canvas image is top-row-first, so without flipY it lands upside down
    assertPixel(cell(gl, 2, 0, 0), BLUE, 3, 'canvas top row lands at the GL bottom without flipY');
    assertPixel(cell(gl, 2, 0, 1), RED, 3);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    drawTexture(gl, true);
    assertPixel(cell(gl, 2, 0, 0), RED, 3, 'with flipY the canvas comes back the right way up');
    assertPixel(cell(gl, 2, 0, 1), BLUE, 3);
    assertNoError(gl);
    srcCanvas.dispose();
    dispose(gl);
  });

  test('a decoded PNG Image uploads correctly', async () => {
    const png = encodePNG(2, 2, RGBA_2X2());
    const img = await loadImage(png);
    await img.decode();
    assert.equal(img.naturalWidth, 2);
    assert.equal(img.naturalHeight, 2);

    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    assertNoError(gl, 'Image source');
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'PNG Image');
    dispose(gl);
  });
});

describe('UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL', () => {
  test('flipY applies to ArrayBufferView uploads', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, BLUE, YELLOW, RED, GREEN, 'flipY view upload');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    dispose(gl);
  });

  test('flipY applies to image sources', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    const id = new ImageData(new Uint8ClampedArray(RGBA_2X2()), 2, 2);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, id);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, BLUE, YELLOW, RED, GREEN, 'flipY image source');
    dispose(gl);
  });

  test('premultiplyAlpha applies to view and image uploads', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    // straight alpha: white at 50% alpha
    const data = () => new Uint8Array([255, 255, 255, 128, 255, 255, 255, 128, 255, 255, 255, 128, 255, 255, 255, 128]);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data());
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), [255, 255, 255, 128], 3, 'straight alpha is preserved');

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    assert.equal(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data());
    assertNoError(gl);
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), [128, 128, 128, 128], 3, 'premultiplied view upload');

    const id = new ImageData(new Uint8ClampedArray(data()), 2, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, id);
    assertNoError(gl);
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), [128, 128, 128, 128], 3, 'premultiplied image source');
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    dispose(gl);
  });
});

describe('copyTexImage2D / copyTexSubImage2D', () => {
  test('copies from the default framebuffer into a texture', () => {
    const gl = makeGL(2, 16, 16);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 8, 16);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);

    const t = tex2D(gl);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, 2, 1, 0);
    assertNoError(gl, 'copyTexImage2D');

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, t);
    drawTexture(gl, true);
    assertPixel(cell(gl, 2, 0, 0), RED, 3, 'left half was red');
    assertPixel(cell(gl, 2, 1, 0), RED, 3, 'x=1 of a 2px-wide copy is still inside the red half');

    // copyTexSubImage2D over the right texel using the blue half
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 1, 0, 0, 0, 1, 1);
    assertNoError(gl, 'copyTexSubImage2D');
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawTexture(gl, true);
    assertPixel(cell(gl, 2, 0, 0), RED, 3);
    assertPixel(cell(gl, 2, 1, 0), GREEN, 3, 'the right texel now holds the copied green pixel');
    dispose(gl);
  });
});

describe('mipmaps and texture parameters', () => {
  test('generateMipmap makes a mipmap-filtered texture complete', () => {
    const gl = makeGL(1, 16, 16);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const solid = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i++) solid.set([255, 128, 0, 255], i * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, solid);
    assertNoError(gl);

    drawTexture(gl, false);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 0, 255], 1, 'a mip-incomplete texture samples as opaque black');

    gl.generateMipmap(gl.TEXTURE_2D);
    assertNoError(gl, 'generateMipmap');
    drawTexture(gl, false);
    assertPixel(readPixel(gl, 8, 8), [255, 128, 0, 255], 3, 'after generateMipmap the texture is complete');
    dispose(gl);
  });

  test('WebGL 2 TEXTURE_BASE_LEVEL reads the generated mip chain', () => {
    const gl = makeGL(2, 16, 16);
    const t = tex2D(gl);
    // bottom half red, top half blue: the 1x1 level is their average
    const data = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        data.set(y < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 8 + x) * 4);
      }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    assertNoError(gl);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 3);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL), 3);
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), [128, 0, 128, 255], 4, 'the 1x1 mip averages the two halves');

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    drawTexture(gl, true);
    assertPixel(cell(gl, 2, 0, 0), RED, 3, 'base level 0 is the original image');
    assertPixel(cell(gl, 2, 0, 1), BLUE, 3);
    assert.ok(t);
    dispose(gl);
  });

  test('texParameter get/set round-trips', () => {
    const gl = makeGL(2, 8, 8);
    tex2D(gl);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER), gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER), gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S), gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T), gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL), 4);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, 3.5);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD), 3.5);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE), gl.COMPARE_REF_TO_TEXTURE);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, TEXTURE_IMMUTABLE_FORMAT), false);
    assertNoError(gl);
    dispose(gl);
  });

  test('EXT_texture_filter_anisotropic', () => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    assert.ok(ext, 'EXT_texture_filter_anisotropic is always available here');
    assert.equal(ext.TEXTURE_MAX_ANISOTROPY_EXT, 0x84fe);
    assert.equal(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT, 0x84ff);
    const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    assert.ok(max >= 2, `MAX_TEXTURE_MAX_ANISOTROPY_EXT = ${max}`);
    tex2D(gl);
    gl.texParameterf(gl.TEXTURE_2D, TEXTURE_MAX_ANISOTROPY_EXT, 2);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, TEXTURE_MAX_ANISOTROPY_EXT), 2);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('cube maps', () => {
  const FACES = ['TEXTURE_CUBE_MAP_POSITIVE_X', 'TEXTURE_CUBE_MAP_NEGATIVE_X', 'TEXTURE_CUBE_MAP_POSITIVE_Y',
    'TEXTURE_CUBE_MAP_NEGATIVE_Y', 'TEXTURE_CUBE_MAP_POSITIVE_Z', 'TEXTURE_CUBE_MAP_NEGATIVE_Z'] as const;
  const COLORS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  test('all six faces upload and sample independently', () => {
    const gl = makeGL(1, 8, 8);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D((gl as any)[FACES[i]], 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([...COLORS[i], 255]));
    }
    assertNoError(gl, 'cube face uploads');
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP), t);

    const p = program(gl, GLSL100.vsQuad, `
precision mediump float;
uniform samplerCube u_tex;
uniform vec3 u_dir;
void main() { gl_FragColor = textureCube(u_tex, u_dir); }`);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    for (let i = 0; i < 6; i++) {
      gl.uniform3f(gl.getUniformLocation(p, 'u_dir'), DIRS[i][0], DIRS[i][1], DIRS[i][2]);
      drawFullscreenQuad(gl, p);
      assertPixel(readPixel(gl, 4, 4), [...COLORS[i], 255], 3, FACES[i]);
    }
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WebGL 2 texture storage and 3D targets', () => {
  test('texStorage2D marks the texture immutable', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, TEXTURE_IMMUTABLE_FORMAT), false);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 2, 2);
    assertNoError(gl, 'texStorage2D');
    assert.equal(gl.getTexParameter(gl.TEXTURE_2D, TEXTURE_IMMUTABLE_FORMAT), true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assertNoError(gl);
    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'texStorage2D + texSubImage2D');

    // redefining an immutable texture is an error
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, RGBA_2X2());
    assert.equal(gl.getError(), INVALID_OPERATION, 'texImage2D on an immutable texture');
    dispose(gl);
  });

  test('texImage3D / texSubImage3D with sampler3D', () => {
    const gl = makeGL(2, 16, 16);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // 1x1x2: slice 0 red, slice 1 green
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
    assertNoError(gl, 'texImage3D');
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_3D), t);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
precision mediump sampler3D;
uniform sampler3D u_tex;
uniform float u_z;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, vec3(v_uv, u_z)); }`);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_z'), 0.25);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), RED, 3, 'slice 0');
    gl.uniform1f(gl.getUniformLocation(p, 'u_z'), 0.75);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), GREEN, 3, 'slice 1');

    // patch slice 1 to blue
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
    assertNoError(gl, 'texSubImage3D');
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), BLUE, 3, 'patched slice 1');
    dispose(gl);
  });

  test('TEXTURE_2D_ARRAY with sampler2DArray', () => {
    const gl = makeGL(2, 16, 16);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 3);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 3, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
    assertNoError(gl, 'texStorage3D + texSubImage3D');
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY), t);

    const p = program(gl, GLSL300.vsQuad, `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray u_tex;
uniform int u_layer;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, vec3(v_uv, float(u_layer))); }`);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    for (const [layer, expect] of [[0, RED], [1, GREEN], [2, BLUE]] as [number, number[]][]) {
      gl.uniform1i(gl.getUniformLocation(p, 'u_layer'), layer);
      drawFullscreenQuad(gl, p);
      assertPixel(readPixel(gl, 8, 8), expect, 3, `layer ${layer}`);
    }
    assertNoError(gl);
    dispose(gl);
  });

  test('integer textures sampled through usampler2D', () => {
    const gl = makeGL(2, 16, 16);
    const fsU = `#version 300 es
precision mediump float;
precision mediump usampler2D;
uniform usampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  uvec4 v = texture(u_tex, v_uv);
  fragColor = vec4(float(v.r) / 255.0, float(v.g) / 255.0, float(v.b) / 255.0, 1.0);
}`;
    const p = program(gl, GLSL300.vsQuad, fsU);
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);

    // RGBA8UI
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array([10, 20, 30, 255]));
    assertNoError(gl, 'RGBA8UI upload');
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), [10, 20, 30, 255], 2, 'RGBA8UI');

    // R32UI
    tex2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array([200]));
    assertNoError(gl, 'R32UI upload');
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), [200, 0, 0, 255], 2, 'R32UI (g/b default to 0/1... r carries the value)');
    dispose(gl);
  });

  test('UNPACK_ROW_LENGTH / SKIP_PIXELS / SKIP_ROWS upload a sub-rectangle', () => {
    const gl = makeGL(2, 16, 16);
    tex2D(gl);
    // 4x4 source; the inner 2x2 at (1,1) holds red/green/blue/yellow
    const src = new Uint8Array(4 * 4 * 4);
    const put = (x: number, y: number, c: number[]) => src.set(c, (y * 4 + x) * 4);
    put(1, 1, RED); put(2, 1, GREEN);
    put(1, 2, BLUE); put(2, 2, YELLOW);

    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 4);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 1);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 1);
    assert.equal(gl.getParameter(gl.UNPACK_ROW_LENGTH), 4);
    assert.equal(gl.getParameter(gl.UNPACK_SKIP_PIXELS), 1);
    assert.equal(gl.getParameter(gl.UNPACK_SKIP_ROWS), 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    assertNoError(gl, 'sub-rect upload');
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);

    drawTexture(gl, true);
    assert2x2(gl, RED, GREEN, BLUE, YELLOW, 'row-length sub-rect');
    dispose(gl);
  });
});

describe('samplers (WebGL 2)', () => {
  test('a sampler object overrides the texture filter', () => {
    const gl = makeGL(2, 4, 1);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // 2x1: black then white
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]));

    drawTexture(gl, true);
    assertPixel(readPixel(gl, 1, 0), [0, 0, 0, 255], 2, 'NEAREST picks texel 0');
    assertPixel(readPixel(gl, 2, 0), [255, 255, 255, 255], 2, 'NEAREST picks texel 1');

    const sampler = gl.createSampler();
    assert.ok(sampler instanceof WebGLSampler);
    assert.equal(gl.isSampler(sampler), true, 'createSampler creates the object immediately');
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    assert.equal(gl.getSamplerParameter(sampler, gl.TEXTURE_MAG_FILTER), gl.LINEAR);
    gl.bindSampler(0, sampler);
    assert.equal(gl.isSampler(sampler), true);
    assert.equal(gl.getParameter(gl.SAMPLER_BINDING), sampler);

    drawTexture(gl, true);
    assertPixel(readPixel(gl, 1, 0), [64, 64, 64, 255], 4, 'LINEAR from the sampler blends the texels');
    assertPixel(readPixel(gl, 2, 0), [191, 191, 191, 255], 4);

    gl.bindSampler(0, null);
    assert.equal(gl.getParameter(gl.SAMPLER_BINDING), null);
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 1, 0), [0, 0, 0, 255], 2, 'unbinding the sampler restores NEAREST');

    gl.samplerParameterf(sampler, gl.TEXTURE_MAX_LOD, 2.5);
    assert.equal(gl.getSamplerParameter(sampler, gl.TEXTURE_MAX_LOD), 2.5);
    gl.deleteSampler(sampler);
    assert.equal(gl.isSampler(sampler), false);
    assertNoError(gl);
    dispose(gl);
  });
});

describe('compressed textures', () => {
  // ETC2 RGB8 "individual mode" block: base colour (15,0,0) -> ~red, all pixel indices 0.
  const ETC2_RED_BLOCK = new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  // DXT1 block: colour0 = colour1 = RGB565 red, all indices 0.
  const DXT1_RED_BLOCK = new Uint8Array([0x00, 0xf8, 0x00, 0xf8, 0x00, 0x00, 0x00, 0x00]);

  test('WEBGL_compressed_texture_etc uploads and samples an ETC2 block', (t) => {
    const gl = makeGL(2, 16, 16);
    const ext = gl.getExtension('WEBGL_compressed_texture_etc');
    if (!ext) return void t.skip('WEBGL_compressed_texture_etc unavailable');
    assert.equal(ext.COMPRESSED_RGB8_ETC2, 0x9274);
    const formats = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
    assert.ok(Array.from(formats).includes(ext.COMPRESSED_RGB8_ETC2), 'the format is advertised');

    tex2D(gl);
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext.COMPRESSED_RGB8_ETC2, 4, 4, 0, ETC2_RED_BLOCK);
    assertNoError(gl, 'compressedTexImage2D with exactly one 8-byte block');
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), RED, 6, 'the decoded block is red');

    // a wrong-sized payload is rejected
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext.COMPRESSED_RGB8_ETC2, 4, 4, 0, new Uint8Array(7));
    assert.notEqual(gl.getError(), 0, 'a short compressed payload must error');
    clearErrors(gl);
    dispose(gl);
  });

  test('WEBGL_compressed_texture_s3tc uploads and samples a DXT1 block', (t) => {
    const gl = makeGL(2, 16, 16);
    const ext = gl.getExtension('WEBGL_compressed_texture_s3tc');
    if (!ext) return void t.skip('WEBGL_compressed_texture_s3tc unavailable');
    assert.equal(ext.COMPRESSED_RGB_S3TC_DXT1_EXT, 0x83f0);
    tex2D(gl);
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext.COMPRESSED_RGB_S3TC_DXT1_EXT, 4, 4, 0, DXT1_RED_BLOCK);
    assertNoError(gl, 'compressedTexImage2D DXT1');
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), RED, 6, 'the decoded DXT1 block is red');
    dispose(gl);
  });

  test('compressedTexSubImage2D replaces a block', (t) => {
    const gl = makeGL(2, 16, 16);
    const ext = gl.getExtension('WEBGL_compressed_texture_etc');
    if (!ext) return void t.skip('WEBGL_compressed_texture_etc unavailable');
    tex2D(gl);
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext.COMPRESSED_RGB8_ETC2, 4, 4, 0, new Uint8Array(8));
    assertNoError(gl);
    gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, ext.COMPRESSED_RGB8_ETC2, ETC2_RED_BLOCK);
    assertNoError(gl, 'compressedTexSubImage2D');
    drawTexture(gl, true);
    assertPixel(readPixel(gl, 8, 8), RED, 6);
    dispose(gl);
  });
});
