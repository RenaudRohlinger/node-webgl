// ImageData / Image / ImageBitmap, the PNG and native codecs, canvas encoding and installDOM().
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCanvas, encodePNG, decodePNG, isPNG, encodeImage, decodeImage, loadImage,
  Image, ImageData, ImageBitmap, createImageBitmap, installDOM,
} from '../src/index.ts';
import { assertPixel } from './helpers.ts';

const TMP = mkdtempSync(join(tmpdir(), 'node-webgl-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

/** 4x2 RGBA8: top row red/green/blue/white, bottom row all opaque black. */
function sample(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(4 * 2 * 4);
  const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  for (let x = 0; x < 4; x++) {
    data.set(colors[x], x * 4);
    data.set([0, 0, 0, 255], (4 + x) * 4);
  }
  return { width: 4, height: 2, data };
}

const at = (img: { width: number; data: ArrayLike<number> }, x: number, y: number): number[] =>
  Array.from({ length: 4 }, (_, i) => img.data[(y * img.width + x) * 4 + i]);

describe('PNG codec', () => {
  test('encodePNG / decodePNG round-trips exactly', () => {
    const src = sample();
    const png = encodePNG(src.width, src.height, src.data);
    assert.ok(png instanceof Uint8Array);
    assert.ok(isPNG(png), 'isPNG recognises the output');
    assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const out = decodePNG(png);
    assert.equal(out.width, 4);
    assert.equal(out.height, 2);
    assert.equal(out.data.length, 4 * 2 * 4);
    assert.deepEqual(Array.from(out.data), Array.from(src.data), 'lossless round trip');
    assert.equal(out.hasAlpha, true);
    assert.deepEqual(at(out, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(at(out, 3, 0), [255, 255, 255, 255]);
    assert.deepEqual(at(out, 0, 1), [0, 0, 0, 255], 'row 1 is the second row of the image');
  });

  test('transparency survives the round trip', () => {
    const data = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 200, 9, 9, 9, 255]);
    const out = decodePNG(encodePNG(2, 2, data));
    assert.deepEqual(Array.from(out.data), Array.from(data));
  });

  test('isPNG rejects non-PNG bytes', () => {
    assert.equal(isPNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), false);
    assert.equal(isPNG(new Uint8Array(0)), false);
  });

  test('decodeImage handles PNG bytes', () => {
    const src = sample();
    const img = decodeImage(encodePNG(src.width, src.height, src.data));
    assert.equal(img.width, 4);
    assert.deepEqual(at(img, 1, 0), [0, 255, 0, 255]);
  });

  test('decodeImage throws on garbage', () => {
    assert.throws(() => decodeImage(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
  });
});

describe('native codec (macOS ImageIO)', () => {
  test('encodeImage(image/jpeg) round-trips through decodeImage', (t) => {
    // 8x8 with a red left half and a blue right half: JPEG is lossy, so keep blocks large.
    const w = 8, h = 8;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set((i % w) < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);

    let jpeg: Uint8Array;
    try {
      jpeg = encodeImage(w, h, rgba, 'image/jpeg', 0.95);
    } catch {
      return void t.skip('the native JPEG encoder is unavailable on this platform');
    }
    assert.deepEqual(Array.from(jpeg.subarray(0, 3)), [0xff, 0xd8, 0xff], 'JPEG SOI marker');
    assert.equal(isPNG(jpeg), false);

    const out = decodeImage(jpeg);
    assert.equal(out.width, w);
    assert.equal(out.height, h);
    assertPixel(at(out, 1, 1), [255, 0, 0, 255], 12, 'left half is red');
    assertPixel(at(out, 6, 6), [0, 0, 255, 255], 12, 'right half is blue');
    assert.equal(out.data[3], 255, 'JPEG is opaque');
  });

  test('canvas.toBuffer("image/jpeg") produces a decodable JPEG', (t) => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let buf: Buffer;
    try {
      buf = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    } catch {
      canvas.dispose();
      return void t.skip('the native JPEG encoder is unavailable on this platform');
    }
    const out = decodeImage(new Uint8Array(buf));
    assert.equal(out.width, 16);
    assertPixel(at(out, 8, 8), [0, 255, 0, 255], 12);
    canvas.dispose();
  });
});

describe('ImageData', () => {
  test('both constructor forms', () => {
    const blank = new ImageData(3, 2);
    assert.equal(blank.width, 3);
    assert.equal(blank.height, 2);
    assert.equal(blank.data.length, 24);
    assert.ok(blank.data instanceof Uint8ClampedArray);
    assert.equal(blank.colorSpace, 'srgb');
    assert.ok(Array.from(blank.data).every((v) => v === 0));

    const src = sample();
    const wrapped = new ImageData(new Uint8ClampedArray(src.data), 4, 2);
    assert.equal(wrapped.width, 4);
    assert.equal(wrapped.height, 2);
    assert.deepEqual(at(wrapped, 2, 0), [0, 0, 255, 255]);

    const inferred = new ImageData(new Uint8ClampedArray(src.data), 4);
    assert.equal(inferred.height, 2, 'the height is inferred from the data length');

    assert.throws(() => new ImageData(new Uint8ClampedArray(10), 4, 2), RangeError);
  });
});

describe('Image', () => {
  test('loads from a file path and fires the load event', async () => {
    const src = sample();
    const file = join(TMP, 'sample.png');
    writeFileSync(file, encodePNG(src.width, src.height, src.data));

    const img = new Image();
    const loaded = new Promise<Event>((resolve, reject) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', () => reject(new Error('load failed')), { once: true });
    });
    assert.equal(img.complete, true, 'a fresh Image starts complete');
    img.src = file;
    assert.equal(img.complete, false, 'setting src starts a load');
    const ev = await loaded;
    assert.equal(ev.type, 'load');
    assert.equal(img.complete, true);
    assert.equal(img.naturalWidth, 4);
    assert.equal(img.naturalHeight, 2);
    assert.equal(img.width, 4);
    assert.equal(img.height, 2);
    assert.equal(img.src, file);
    assert.equal(img.currentSrc, file);
    await img.decode();
    assert.deepEqual(at(img._toRGBA8(), 0, 0), [255, 0, 0, 255]);
  });

  test('loads from a file: URL and a data: URL', async () => {
    const src = sample();
    const file = join(TMP, 'sample2.png');
    const png = encodePNG(src.width, src.height, src.data);
    writeFileSync(file, png);

    const byUrl = new Image();
    byUrl.src = pathToFileURL(file).href;
    await byUrl.decode();
    assert.equal(byUrl.naturalWidth, 4);

    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const byData = new Image();
    const onload = new Promise((r) => byData.addEventListener('load', r, { once: true }));
    byData.src = dataUrl;
    await onload;
    await byData.decode();
    assert.equal(byData.naturalWidth, 4);
    assert.equal(byData.naturalHeight, 2);
    assert.deepEqual(at(byData._toRGBA8(), 3, 0), [255, 255, 255, 255]);
  });

  test('a failed load fires error and decode() rejects', async () => {
    const img = new Image();
    const failed = new Promise<any>((resolve) => img.addEventListener('error', resolve, { once: true }));
    img.src = join(TMP, 'does-not-exist.png');
    const ev = await failed;
    assert.equal(ev.type, 'error');
    await assert.rejects(() => img.decode());
    assert.equal(img.naturalWidth, 0);
  });

  test('onload / onerror properties are called too', async () => {
    const src = sample();
    const file = join(TMP, 'sample3.png');
    writeFileSync(file, encodePNG(src.width, src.height, src.data));
    const img = new Image();
    const called = new Promise((r) => { img.onload = r; });
    img.src = file;
    await called;
    assert.equal(img.naturalWidth, 4);
  });

  test('setting width/height resamples the texture source', async () => {
    const src = sample();
    const img = await loadImage(encodePNG(src.width, src.height, src.data));
    assert.equal(img.naturalWidth, 4);
    img.width = 8;
    img.height = 4;
    assert.equal(img.width, 8);
    const resampled = img._toRGBA8();
    assert.equal(resampled.width, 8);
    assert.equal(resampled.height, 4);
    assert.deepEqual(at(resampled, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(at(resampled, 7, 0), [255, 255, 255, 255]);
  });

  test('loadImage accepts bytes, a path and a file URL', async () => {
    const src = sample();
    const png = encodePNG(src.width, src.height, src.data);
    const file = join(TMP, 'sample4.png');
    writeFileSync(file, png);
    for (const input of [png, file, pathToFileURL(file)] as const) {
      const img = await loadImage(input as any);
      assert.equal(img.naturalWidth, 4, `loadImage(${typeof input})`);
      assert.deepEqual(at(img._toRGBA8(), 1, 0), [0, 255, 0, 255]);
    }
  });
});

describe('ImageBitmap', () => {
  test('createImageBitmap from ImageData, with flipY and resize', async () => {
    const src = sample();
    const id = new ImageData(new Uint8ClampedArray(src.data), 4, 2);

    const plain = await createImageBitmap(id);
    assert.ok(plain instanceof ImageBitmap);
    assert.equal(plain.width, 4);
    assert.equal(plain.height, 2);
    assert.deepEqual(at(plain._toRGBA8(), 0, 0), [255, 0, 0, 255]);

    const flipped = await createImageBitmap(id, { imageOrientation: 'flipY' });
    assert.deepEqual(at(flipped._toRGBA8(), 0, 0), [0, 0, 0, 255], 'flipY moves the black row to the top');
    assert.deepEqual(at(flipped._toRGBA8(), 0, 1), [255, 0, 0, 255]);
    // the original is untouched
    assert.deepEqual(at(id, 0, 0), [255, 0, 0, 255]);

    const resized = await createImageBitmap(id, { resizeWidth: 8, resizeHeight: 4 });
    assert.equal(resized.width, 8);
    assert.equal(resized.height, 4);

    const premul = await createImageBitmap(new ImageData(new Uint8ClampedArray([255, 255, 255, 128]), 1, 1),
      { premultiplyAlpha: 'premultiply' });
    assertPixel(at(premul._toRGBA8(), 0, 0), [128, 128, 128, 128], 2);

    plain.close();
  });

  test('createImageBitmap from an Image, a Canvas and a Blob', async () => {
    const src = sample();
    const png = encodePNG(src.width, src.height, src.data);

    const img = await loadImage(png);
    const fromImage = await createImageBitmap(img);
    assert.equal(fromImage.width, 4);

    const canvas = createCanvas(4, 4);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    gl.clearColor(1, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const fromCanvas = await createImageBitmap(canvas);
    assert.equal(fromCanvas.width, 4);
    assert.deepEqual(at(fromCanvas._toRGBA8(), 0, 0), [255, 0, 255, 255]);
    canvas.dispose();

    const fromBlob = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    assert.equal(fromBlob.width, 4);
    assert.deepEqual(at(fromBlob._toRGBA8(), 2, 0), [0, 0, 255, 255]);

    await assert.rejects(() => createImageBitmap(42 as any), TypeError);
  });
});

describe('canvas encoding', () => {
  test('toDataURL, toBuffer, toBlob and getImageData', async () => {
    const canvas = createCanvas(8, 4);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    gl.clearColor(0.25, 0.5, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const url = canvas.toDataURL();
    assert.ok(url.startsWith('data:image/png;base64,'));
    assert.ok(url.length > 40);

    const buf = canvas.toBuffer();
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(isPNG(new Uint8Array(buf)));

    const img = canvas.getImageData();
    assert.equal(img.width, 8);
    assert.equal(img.height, 4);
    assert.equal(img.data.length, 8 * 4 * 4);
    assertPixel(at(img, 0, 0), [64, 128, 191, 255], 2);

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
    assert.equal(blob.type, 'image/png');
    assert.ok(blob.size > 0);
    const viaBlob = decodeImage(new Uint8Array(await blob.arrayBuffer()));
    assertPixel(at(viaBlob, 0, 0), [64, 128, 191, 255], 2);

    const converted = await canvas.convertToBlob();
    assert.equal(converted.type, 'image/png');
    canvas.dispose();
  });

  test('getImageData on a canvas without a context returns a blank image', () => {
    const canvas = createCanvas(5, 3);
    const img = canvas.getImageData();
    assert.equal(img.width, 5);
    assert.equal(img.height, 3);
    assert.ok(Array.from(img.data).every((v) => v === 0));
  });
});

describe('installDOM', () => {
  test('defines the browser globals and a working canvas factory', async () => {
    installDOM({ baseDir: TMP, devicePixelRatio: 2, innerWidth: 800, innerHeight: 600 });
    const g = globalThis as any;

    assert.equal(g.window, globalThis);
    assert.equal(g.self, globalThis);
    assert.ok(g.document);
    assert.equal(typeof g.requestAnimationFrame, 'function');
    assert.equal(typeof g.cancelAnimationFrame, 'function');
    assert.equal(g.devicePixelRatio, 2);
    assert.equal(g.innerWidth, 800);
    assert.equal(g.innerHeight, 600);
    assert.equal(g.HTMLCanvasElement, createCanvas(1, 1).constructor);
    assert.equal(g.Image, Image);
    assert.equal(g.ImageData, ImageData);
    assert.equal(g.ImageBitmap, ImageBitmap);
    assert.equal(typeof g.createImageBitmap, 'function');
    assert.equal(typeof g.WebGLRenderingContext, 'function');
    assert.equal(typeof g.WebGL2RenderingContext, 'function');
    assert.equal(typeof g.WebGLBuffer, 'function');
    assert.ok(g.location.href.startsWith('file://'));
    assert.equal(typeof g.getComputedStyle, 'function');
    assert.equal(g.matchMedia('(min-width: 1px)').matches, false);
    assert.equal(g.screen.width, 800);

    installDOM({ baseDir: TMP }); // idempotent
    assert.equal(g.devicePixelRatio, 2);

    // requestAnimationFrame actually fires with a timestamp
    const t = await new Promise<number>((resolve) => g.requestAnimationFrame(resolve));
    assert.equal(typeof t, 'number');
    assert.ok(t > 0);
    const id = g.requestAnimationFrame(() => assert.fail('cancelled frame ran'));
    g.cancelAnimationFrame(id);
    await new Promise((r) => setTimeout(r, 40));

    // document.createElement / createElementNS give working canvases
    for (const el of [g.document.createElement('canvas'),
      g.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')]) {
      assert.ok(el instanceof g.HTMLCanvasElement);
      el.width = 8;
      el.height = 8;
      const ctx = el.getContext('webgl2');
      assert.ok(ctx, 'the created canvas hands out a WebGL 2 context');
      ctx.clearColor(1, 0, 0, 1);
      ctx.clear(ctx.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      assertPixel(Array.from(px), [255, 0, 0, 255], 0);
      el.dispose();
    }

    const imgEl = g.document.createElement('img');
    assert.ok(imgEl instanceof Image);
    const div = g.document.createElement('div');
    assert.equal(div.tagName, 'DIV');
    assert.equal(div.getContext(), null);
    assert.equal(g.document.body.tagName, 'BODY');
  });

  test('the patched fetch reads local files', async () => {
    installDOM({ baseDir: TMP });
    const src = sample();
    const png = encodePNG(src.width, src.height, src.data);
    writeFileSync(join(TMP, 'fetched.png'), png);
    writeFileSync(join(TMP, 'data.json'), JSON.stringify({ hello: 'world' }));

    const res = await fetch('fetched.png');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Array.from(bytes), Array.from(png));
    const decoded = decodeImage(bytes);
    assert.equal(decoded.width, 4);

    const json = await (await fetch('./data.json')).json();
    assert.deepEqual(json, { hello: 'world' });
    assert.equal((await fetch(join(TMP, 'data.json'))).status, 200, 'absolute paths work too');
    assert.equal((await fetch(pathToFileURL(join(TMP, 'data.json')).href)).status, 200, 'file: URLs work too');

    const missing = await fetch('nope.bin');
    assert.equal(missing.status, 404);

    const dataUrl = await fetch(`data:text/plain;base64,${Buffer.from('hi').toString('base64')}`);
    assert.equal(await dataUrl.text(), 'hi', 'data: URLs still go to the original fetch');
  });
});
