// Pixel format bookkeeping and the CPU-side conversions WebGL performs on upload:
// UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL and image -> (format, type) packing.
import { GL } from './constants.ts';

const HALF_FLOAT_OES = 0x8d61;
const SRGB_EXT = 0x8c40;
const SRGB_ALPHA_EXT = 0x8c42;
const BGRA_EXT = 0x80e1;

/** Number of color channels described by a pixel transfer `format`. */
export function formatComponents(format: number): number {
  switch (format) {
    case GL.ALPHA: case GL.LUMINANCE: case GL.RED: case GL.RED_INTEGER:
    case GL.DEPTH_COMPONENT: case GL.DEPTH_STENCIL:
      return 1;
    case GL.LUMINANCE_ALPHA: case GL.RG: case GL.RG_INTEGER:
      return 2;
    case GL.RGB: case GL.RGB_INTEGER: case SRGB_EXT:
      return 3;
    case GL.RGBA: case GL.RGBA_INTEGER: case SRGB_ALPHA_EXT: case BGRA_EXT:
      return 4;
    default:
      return 0;
  }
}

/** Bytes per pixel for a (format, type) pair, or 0 when unknown. */
export function bytesPerPixel(format: number, type: number): number {
  switch (type) {
    case GL.UNSIGNED_SHORT_4_4_4_4: case GL.UNSIGNED_SHORT_5_5_5_1: case GL.UNSIGNED_SHORT_5_6_5:
      return 2;
    case GL.UNSIGNED_INT_2_10_10_10_REV: case GL.UNSIGNED_INT_10F_11F_11F_REV:
    case GL.UNSIGNED_INT_5_9_9_9_REV: case GL.UNSIGNED_INT_24_8:
      return 4;
    case GL.FLOAT_32_UNSIGNED_INT_24_8_REV:
      return 8;
  }
  const c = formatComponents(format);
  switch (type) {
    case GL.UNSIGNED_BYTE: case GL.BYTE: return c;
    case GL.UNSIGNED_SHORT: case GL.SHORT: case GL.HALF_FLOAT: case HALF_FLOAT_OES: return c * 2;
    case GL.UNSIGNED_INT: case GL.INT: case GL.FLOAT: return c * 4;
    default: return 0;
  }
}

export interface UnpackParams {
  alignment: number;
  rowLength: number;
  skipRows: number;
  skipPixels: number;
  imageHeight: number;
  skipImages: number;
}

export const DEFAULT_UNPACK: UnpackParams = { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0, imageHeight: 0, skipImages: 0 };

/** Row stride in bytes given width, bytes per pixel and unpack params. */
export function rowStride(width: number, bpp: number, p: UnpackParams): number {
  const w = p.rowLength > 0 ? p.rowLength : width;
  const unpadded = w * bpp;
  const a = p.alignment;
  return Math.ceil(unpadded / a) * a;
}

/** Total bytes GL will read for an upload of the given dimensions with these unpack params. */
export function imageByteSize(width: number, height: number, depth: number, bpp: number, p: UnpackParams): number {
  if (width === 0 || height === 0 || depth === 0) return 0;
  const stride = rowStride(width, bpp, p);
  const h = p.imageHeight > 0 ? p.imageHeight : height;
  const imageStride = stride * h;
  const lastRowBytes = (p.skipPixels + width) * bpp;
  const lastImage = stride * (p.skipRows + height - 1) + lastRowBytes;
  return imageStride * (p.skipImages + depth - 1) + lastImage;
}

/**
 * Repacks a (possibly strided / skipped) source into a tightly packed image with rows in
 * reverse order (flipY) and/or premultiplied alpha. Returns a Uint8Array view over new memory.
 */
export function repackForUpload(
  src: Uint8Array, width: number, height: number, depth: number, format: number, type: number,
  p: UnpackParams, flipY: boolean, premultiply: boolean,
): Uint8Array {
  const bpp = bytesPerPixel(format, type);
  const srcStride = rowStride(width, bpp, p);
  const srcImageRows = p.imageHeight > 0 ? p.imageHeight : height;
  const dstRow = width * bpp;
  const out = new Uint8Array(dstRow * height * depth);
  for (let z = 0; z < depth; z++) {
    const srcImage = (p.skipImages + z) * srcStride * srcImageRows;
    for (let y = 0; y < height; y++) {
      const sy = p.skipRows + y;
      const s = srcImage + sy * srcStride + p.skipPixels * bpp;
      const dy = flipY ? height - 1 - y : y;
      out.set(src.subarray(s, s + dstRow), z * dstRow * height + dy * dstRow);
    }
  }
  if (premultiply) premultiplyInPlace(out, format, type);
  return out;
}

/** Multiplies color channels by alpha for the formats that carry alpha (no-op otherwise). */
export function premultiplyInPlace(data: Uint8Array, format: number, type: number): void {
  if (format !== GL.RGBA && format !== GL.LUMINANCE_ALPHA && format !== SRGB_ALPHA_EXT && format !== BGRA_EXT) return;
  const comps = formatComponents(format);
  const n = data.byteLength;
  if (type === GL.UNSIGNED_BYTE) {
    for (let i = 0; i + comps <= n; i += comps) {
      const a = data[i + comps - 1];
      if (a === 255) continue;
      for (let c = 0; c < comps - 1; c++) data[i + c] = (data[i + c] * a + 127) / 255;
    }
  } else if (type === GL.FLOAT) {
    const f = new Float32Array(data.buffer, data.byteOffset, n >> 2);
    for (let i = 0; i + comps <= f.length; i += comps) {
      const a = f[i + comps - 1];
      for (let c = 0; c < comps - 1; c++) f[i + c] *= a;
    }
  } else if (type === GL.HALF_FLOAT || type === HALF_FLOAT_OES) {
    const h = new Uint16Array(data.buffer, data.byteOffset, n >> 1);
    for (let i = 0; i + comps <= h.length; i += comps) {
      const a = halfToFloat(h[i + comps - 1]);
      for (let c = 0; c < comps - 1; c++) h[i + c] = floatToHalf(halfToFloat(h[i + c]) * a);
    }
  } else if (type === GL.UNSIGNED_SHORT_4_4_4_4) {
    const u = new Uint16Array(data.buffer, data.byteOffset, n >> 1);
    for (let i = 0; i < u.length; i++) {
      const v = u[i]; const a = v & 0xf;
      if (a === 15) continue;
      const r = ((v >> 12) & 0xf) * a / 15, g = ((v >> 8) & 0xf) * a / 15, b = ((v >> 4) & 0xf) * a / 15;
      u[i] = (Math.round(r) << 12) | (Math.round(g) << 8) | (Math.round(b) << 4) | a;
    }
  } else if (type === GL.UNSIGNED_SHORT_5_5_5_1) {
    const u = new Uint16Array(data.buffer, data.byteOffset, n >> 1);
    for (let i = 0; i < u.length; i++) if ((u[i] & 1) === 0) u[i] = 0;
  }
}

/** Source image for texImage2D-style uploads: RGBA8, straight alpha, top row first. */
export interface RGBA8Source {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  return sign | (exp << 10) | ((mant + 0x1000) >> 13);
}

export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

/** True when an RGBA8 image can be converted into this (format, type) pair by convertImage(). */
export function canConvertImage(format: number, type: number): boolean {
  const comps = formatComponents(format);
  if (comps === 0 || format === GL.DEPTH_COMPONENT || format === GL.DEPTH_STENCIL) return false;
  if (format === GL.RED_INTEGER || format === GL.RG_INTEGER || format === GL.RGB_INTEGER || format === GL.RGBA_INTEGER) return false;
  switch (type) {
    case GL.UNSIGNED_BYTE: case GL.FLOAT: case GL.HALF_FLOAT: case HALF_FLOAT_OES: case GL.UNSIGNED_SHORT:
      return true;
    case GL.UNSIGNED_SHORT_4_4_4_4: case GL.UNSIGNED_SHORT_5_5_5_1:
      return comps === 4;
    case GL.UNSIGNED_SHORT_5_6_5:
      return comps === 3;
    case GL.UNSIGNED_INT_2_10_10_10_REV:
      return comps === 4;
    case GL.UNSIGNED_INT_10F_11F_11F_REV: case GL.UNSIGNED_INT_5_9_9_9_REV:
      return comps === 3;
    default:
      return false;
  }
}

/**
 * Converts an RGBA8 top-down image into tightly packed (alignment 1) pixel data for the requested
 * transfer format/type, optionally flipping rows and premultiplying alpha — what a browser does
 * for texImage2D(target, level, internalformat, format, type, image).
 */
export function convertImage(img: RGBA8Source, format: number, type: number, flipY: boolean, premultiply: boolean): Uint8Array {
  const { width, height } = img;
  const src = img.data;
  const comps = formatComponents(format);
  const bpp = bytesPerPixel(format, type);
  const out = new Uint8Array(width * height * bpp);
  const view = new DataView(out.buffer);
  // channel order for the target format
  const isBGRA = format === BGRA_EXT;
  const lum = format === GL.LUMINANCE || format === GL.LUMINANCE_ALPHA;
  const alphaOnly = format === GL.ALPHA;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const sy = flipY ? height - 1 - y : y;
    let s = sy * width * 4;
    for (let x = 0; x < width; x++, s += 4) {
      let r = src[s], g = src[s + 1], b = src[s + 2];
      const a = src[s + 3];
      if (premultiply && a !== 255) { r = (r * a + 127) / 255 | 0; g = (g * a + 127) / 255 | 0; b = (b * a + 127) / 255 | 0; }
      // channels as 0..255 numbers in target order
      let c0 = r, c1 = g, c2 = b, c3 = a;
      if (isBGRA) { c0 = b; c2 = r; }
      else if (lum) { c0 = r; c1 = a; }
      else if (alphaOnly) { c0 = a; }
      switch (type) {
        case GL.UNSIGNED_BYTE:
          out[o] = c0;
          if (comps > 1) out[o + 1] = c1;
          if (comps > 2) out[o + 2] = c2;
          if (comps > 3) out[o + 3] = c3;
          break;
        case GL.UNSIGNED_SHORT: // normalized 16-bit (EXT_texture_norm16)
          view.setUint16(o, c0 * 257, true);
          if (comps > 1) view.setUint16(o + 2, c1 * 257, true);
          if (comps > 2) view.setUint16(o + 4, c2 * 257, true);
          if (comps > 3) view.setUint16(o + 6, c3 * 257, true);
          break;
        case GL.FLOAT:
          view.setFloat32(o, c0 / 255, true);
          if (comps > 1) view.setFloat32(o + 4, c1 / 255, true);
          if (comps > 2) view.setFloat32(o + 8, c2 / 255, true);
          if (comps > 3) view.setFloat32(o + 12, c3 / 255, true);
          break;
        case GL.HALF_FLOAT: case HALF_FLOAT_OES:
          view.setUint16(o, floatToHalf(c0 / 255), true);
          if (comps > 1) view.setUint16(o + 2, floatToHalf(c1 / 255), true);
          if (comps > 2) view.setUint16(o + 4, floatToHalf(c2 / 255), true);
          if (comps > 3) view.setUint16(o + 6, floatToHalf(c3 / 255), true);
          break;
        case GL.UNSIGNED_SHORT_4_4_4_4:
          view.setUint16(o, ((c0 >> 4) << 12) | ((c1 >> 4) << 8) | ((c2 >> 4) << 4) | (c3 >> 4), true);
          break;
        case GL.UNSIGNED_SHORT_5_5_5_1:
          view.setUint16(o, ((c0 >> 3) << 11) | ((c1 >> 3) << 6) | ((c2 >> 3) << 1) | (c3 >> 7), true);
          break;
        case GL.UNSIGNED_SHORT_5_6_5:
          view.setUint16(o, ((c0 >> 3) << 11) | ((c1 >> 2) << 5) | (c2 >> 3), true);
          break;
        case GL.UNSIGNED_INT_2_10_10_10_REV:
          view.setUint32(o, (c0 * 1023 / 255 | 0) | ((c1 * 1023 / 255 | 0) << 10) | ((c2 * 1023 / 255 | 0) << 20) | ((c3 >> 6) << 30), true);
          break;
        case GL.UNSIGNED_INT_10F_11F_11F_REV:
          view.setUint32(o, packR11G11B10F(c0 / 255, c1 / 255, c2 / 255), true);
          break;
        case GL.UNSIGNED_INT_5_9_9_9_REV:
          view.setUint32(o, packRGB9E5(c0 / 255, c1 / 255, c2 / 255), true);
          break;
      }
      o += bpp;
    }
  }
  return out;
}

function packR11G11B10F(r: number, g: number, b: number): number {
  const f11 = (v: number) => (floatToHalf(Math.max(v, 0)) >> 4) & 0x7ff;
  const f10 = (v: number) => (floatToHalf(Math.max(v, 0)) >> 5) & 0x3ff;
  return (f11(r) | (f11(g) << 11) | (f10(b) << 22)) >>> 0;
}

function packRGB9E5(r: number, g: number, b: number): number {
  const maxVal = Math.max(r, g, b, 0);
  if (maxVal <= 0) return 0;
  const e = Math.max(-16, Math.floor(Math.log2(maxVal))) + 1 + 15;
  const exp = Math.min(31, e);
  const scale = Math.pow(2, exp - 15 - 9);
  const q = (v: number) => Math.min(511, Math.round(v / scale));
  return (q(r) | (q(g) << 9) | (q(b) << 18) | (exp << 27)) >>> 0;
}

/** Flips rows of a tightly packed image in place (bottom-up <-> top-down). */
export function flipRowsInPlace(data: Uint8Array, rowBytes: number, rows: number): void {
  const tmp = new Uint8Array(rowBytes);
  for (let y = 0, z = rows - 1; y < z; y++, z--) {
    const a = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    const b = data.subarray(z * rowBytes, (z + 1) * rowBytes);
    tmp.set(a);
    a.set(b);
    b.set(tmp);
  }
}
