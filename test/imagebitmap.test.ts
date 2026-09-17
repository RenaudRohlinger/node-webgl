// ImageBitmap sources: the pixel-unpack flags must be ignored (WebGL spec 5.14.8), the bitmap options rule.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ImageData, createImageBitmap } from '../src/index.ts';
import { makeGL, dispose, assertNoError } from './helpers.ts';

/** 1x2 image: top row opaque red, bottom row half-transparent blue (straight alpha). */
function makeImage(): ImageData {
  const img = new ImageData(1, 2);
  img.data.set([255, 0, 0, 255, 0, 0, 255, 128]);
  return img;
}

/** Uploads `source` into a fresh RGBA8 texture, attaches it to an FBO and reads both texel rows back (bottom row first). */
function upload(gl: any, source: unknown, format = gl.RGBA, type = gl.UNSIGNED_BYTE): number[] {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, format, type, source);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const px = new Uint8Array(8);
  gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return Array.from(px);
}

for (const version of [2, 1] as const) {
  describe(`ImageBitmap uploads (WebGL ${version})`, () => {
    test('UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL are ignored for ImageBitmap', async () => {
      const gl = makeGL(version, 4, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

      // Without a flip an image's top row lands in GL row 0 (the bottom). ImageData honours both flags:
      // flipped, so the image's bottom row (blue) ends up in GL row 0, and premultiplied (blue 255 * 128/255 = 128).
      const viaImageData = upload(gl, makeImage());
      assert.deepEqual(viaImageData.slice(4, 8), [255, 0, 0, 255], 'flipped: image top row lands in GL row 1');
      assert.deepEqual(viaImageData.slice(0, 2), [0, 0]);
      assert.ok(viaImageData[2] < 140 && viaImageData[2] > 120, `premultiplied blue ≈ 128, got ${viaImageData[2]}`);
      assert.equal(viaImageData[3], 128);

      // ...an ImageBitmap of the same pixels ignores them: no flip, straight alpha.
      const bitmap = await createImageBitmap(makeImage());
      const viaBitmap = upload(gl, bitmap);
      assert.deepEqual(viaBitmap.slice(0, 4), [255, 0, 0, 255], 'not flipped: image top row in GL row 0');
      assert.deepEqual(viaBitmap.slice(4, 8), [0, 0, 255, 128], 'not premultiplied');

      // the bitmap's own options decide instead
      const flipped = await createImageBitmap(makeImage(), { imageOrientation: 'flipY' });
      assert.deepEqual(upload(gl, flipped).slice(0, 4), [0, 0, 255, 128], 'imageOrientation: flipY flips');
      const premultiplied = await createImageBitmap(makeImage(), { premultiplyAlpha: 'premultiply' });
      const pm = upload(gl, premultiplied);
      assert.ok(pm[6] < 140 && pm[6] > 120, `premultiplyAlpha: premultiply premultiplies (blue ${pm[6]})`);

      // and the flags still apply to non-bitmap sources afterwards
      assert.deepEqual(upload(gl, makeImage()).slice(4, 8), [255, 0, 0, 255]);
      assertNoError(gl);
      dispose(gl);
    });

    test('ImageBitmap also ignores the flags for format conversions (RGB / UNSIGNED_BYTE)', async () => {
      const gl = makeGL(version, 4, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      const bitmap = await createImageBitmap(makeImage());
      const px = upload(gl, bitmap, gl.RGB, gl.UNSIGNED_BYTE);
      assert.deepEqual(px.slice(0, 3), [255, 0, 0], 'no flip: the image top row stays in GL row 0');
      assert.deepEqual(px.slice(4, 7), [0, 0, 255]);
      assertNoError(gl);
      dispose(gl);
    });
  });
}
