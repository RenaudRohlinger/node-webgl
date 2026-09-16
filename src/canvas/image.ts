// ImageData / Image / ImageBitmap look-alikes plus encode/decode helpers.
// Decoding uses ImageIO on macOS (PNG, JPEG, GIF, WebP, HEIC, ...) and falls back to the built-in PNG codec.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { loadNative, type DecodedImage } from '../native.ts';
import { decodePNG, encodePNG, isPNG } from './png.ts';
import { decodeJPEG, isJPEG } from './jpeg.ts';
import type { RGBA8Source } from '../webgl/pixels.ts';

export type { DecodedImage };

export class ImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace = 'srgb';
  constructor(width: number, height: number);
  constructor(data: Uint8ClampedArray | Uint8Array, width: number, height?: number);
  constructor(a: number | Uint8ClampedArray | Uint8Array, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.width = b;
      this.height = c ?? a.length / 4 / b;
      if (a.length !== this.width * this.height * 4) throw new RangeError('ImageData: data length does not match width*height*4');
      this.data = a instanceof Uint8ClampedArray ? a : new Uint8ClampedArray(a.buffer, a.byteOffset, a.length);
    }
  }
  get [Symbol.toStringTag](): string { return 'ImageData'; }
}

export interface ImageDecoder {
  /** Human-readable name, for error messages. */
  name: string;
  /** Quick sniff on the encoded bytes. */
  test(bytes: Uint8Array): boolean;
  /** Decode to straight-alpha RGBA8, top row first. */
  decode(bytes: Uint8Array): DecodedImage;
}

const decoders: ImageDecoder[] = [];

/**
 * Registers an image decoder consulted before the built-in ones (PNG, JPEG and, on macOS, everything
 * ImageIO knows). Use it to plug `sharp`, `jpeg-js`, a WebP decoder, ... for other formats or platforms.
 */
export function registerImageDecoder(decoder: ImageDecoder): void {
  decoders.unshift(decoder);
}

/** Decodes PNG/JPEG (built in) or anything ImageIO knows on macOS into straight-alpha RGBA8 (top row first). */
export function decodeImage(bytes: Uint8Array | ArrayBuffer): DecodedImage {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const d of decoders) if (d.test(u8)) return d.decode(u8);
  const native = loadNative();
  if (native.decodeImage) {
    try {
      return native.decodeImage(u8);
    } catch (e) {
      if (!isPNG(u8) && !isJPEG(u8)) throw e;
    }
  }
  if (isPNG(u8)) return decodePNG(u8);
  if (isJPEG(u8)) return decodeJPEG(u8);
  throw new Error('decodeImage: unsupported image format (PNG and JPEG are built in; register a decoder with registerImageDecoder() for others)');
}

/** Encodes RGBA8 pixels. PNG uses the built-in encoder everywhere; other formats need the native codec. */
export function encodeImage(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, mime = 'image/png', quality = 0.92): Uint8Array {
  const data = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length);
  if (mime === 'image/png') return encodePNG(width, height, data);
  const native = loadNative();
  if (native.encodeImage) return native.encodeImage(width, height, data, mime, quality);
  throw new Error(`encodeImage: ${mime} is not supported on this platform (use image/png)`);
}

function isHttp(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Reads bytes from a path, file:/http(s)/data: URL, Buffer or ArrayBuffer. */
export async function readImageBytes(src: string | URL | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  const s = src instanceof URL ? src.href : String(src);
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    const meta = s.slice(5, comma);
    const payload = s.slice(comma + 1);
    return meta.endsWith(';base64') ? new Uint8Array(Buffer.from(payload, 'base64')) : new Uint8Array(Buffer.from(decodeURIComponent(payload), 'latin1'));
  }
  if (isHttp(s)) {
    const res = await fetch(s);
    if (!res.ok) throw new Error(`failed to load ${s}: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const path = s.startsWith('file:') ? fileURLToPath(s) : resolvePath(s);
  return new Uint8Array(await readFile(path));
}

/** HTMLImageElement look-alike: set `src` (path, URL, data: URL) and await the `load` event or decode(). */
export class Image extends EventTarget {
  /** @internal */ _rgba: DecodedImage | null = null;
  /** @internal */ _src = '';
  /** @internal */ _width: number | null = null;
  /** @internal */ _height: number | null = null;
  /** @internal */ _loading: Promise<void> | null = null;
  complete = true;
  crossOrigin: string | null = null;
  decoding: 'auto' | 'sync' | 'async' = 'auto';
  onload: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readonly nodeName = 'IMG';
  readonly tagName = 'IMG';
  readonly style: Record<string, string> = {};

  constructor(width?: number, height?: number) {
    super();
    if (width !== undefined) this._width = width;
    if (height !== undefined) this._height = height;
  }

  get naturalWidth(): number { return this._rgba?.width ?? 0; }
  get naturalHeight(): number { return this._rgba?.height ?? 0; }
  get width(): number { return this._width ?? this.naturalWidth; }
  set width(v: number) { this._width = v; }
  get height(): number { return this._height ?? this.naturalHeight; }
  set height(v: number) { this._height = v; }
  get currentSrc(): string { return this._src; }

  get src(): string { return this._src; }
  set src(value: string) {
    this._src = String(value);
    this.complete = false;
    this._rgba = null;
    const p = (async () => {
      const bytes = await readImageBytes(this._src);
      this._rgba = decodeImage(bytes);
    })();
    this._loading = p.then(
      () => {
        this.complete = true;
        const ev = new Event('load');
        this.onload?.(ev);
        this.dispatchEvent(ev);
      },
      (err: unknown) => {
        this.complete = true;
        const ev = Object.assign(new Event('error'), { error: err, message: err instanceof Error ? err.message : String(err) });
        this.onerror?.(ev);
        this.dispatchEvent(ev);
      },
    );
  }

  /** Resolves once the image is decoded (rejects on failure). */
  async decode(): Promise<void> {
    if (this._loading) await this._loading;
    if (!this._rgba) throw new Error(`Image failed to decode: ${this._src}`);
  }

  /** @internal texture-source hook: decoded pixels (respects width/height overrides by nearest resampling). */
  _toRGBA8(): RGBA8Source {
    const img = this._rgba;
    if (!img) return { width: 0, height: 0, data: new Uint8Array(0) };
    const w = this._width ?? img.width, h = this._height ?? img.height;
    if (w === img.width && h === img.height) return img;
    return resampleNearest(img, w, h);
  }

  setAttribute(name: string, value: string): void {
    if (name === 'src') this.src = value;
    else if (name === 'width') this.width = Number(value);
    else if (name === 'height') this.height = Number(value);
    else if (name === 'crossorigin') this.crossOrigin = value;
  }
  getAttribute(name: string): string | null {
    if (name === 'src') return this._src;
    return null;
  }
  get [Symbol.toStringTag](): string { return 'HTMLImageElement'; }
}

function resampleNearest(img: RGBA8Source, w: number, h: number): RGBA8Source {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
      const s = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** Loads and decodes an image from a path, URL or bytes. */
export async function loadImage(src: string | URL | Uint8Array | ArrayBuffer): Promise<Image> {
  const img = new Image();
  img._rgba = decodeImage(await readImageBytes(src));
  img._src = typeof src === 'string' ? src : src instanceof URL ? src.href : '';
  return img;
}

/** ImageBitmap look-alike (decoded RGBA8). */
export class ImageBitmap {
  readonly width: number;
  readonly height: number;
  /** @internal */ _data: Uint8Array | Uint8ClampedArray;
  /** @internal */
  constructor(width: number, height: number, data: Uint8Array | Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this._data = data;
  }
  close(): void {}
  /** @internal */
  _toRGBA8(): RGBA8Source { return { width: this.width, height: this.height, data: this._data }; }
  get [Symbol.toStringTag](): string { return 'ImageBitmap'; }
}

export interface ImageBitmapOptions {
  imageOrientation?: 'none' | 'flipY' | 'from-image';
  premultiplyAlpha?: 'none' | 'premultiply' | 'default';
  colorSpaceConversion?: 'none' | 'default';
  resizeWidth?: number;
  resizeHeight?: number;
}

/** createImageBitmap(): accepts Blob, ImageData, Image, ImageBitmap, Canvas-like ({_toRGBA8}) or {width,height,data}. */
export async function createImageBitmap(source: unknown, options: ImageBitmapOptions = {}): Promise<ImageBitmap> {
  let src: RGBA8Source | null = null;
  if (typeof Blob !== 'undefined' && source instanceof Blob) src = decodeImage(new Uint8Array(await source.arrayBuffer()));
  else if (source instanceof ImageData) src = { width: source.width, height: source.height, data: source.data };
  else if (source instanceof Image) { await source.decode(); src = source._toRGBA8(); }
  else if (source && typeof (source as { _toRGBA8?: unknown })._toRGBA8 === 'function') src = (source as { _toRGBA8: () => RGBA8Source })._toRGBA8();
  else if (source && typeof source === 'object' && 'data' in source && 'width' in source) src = source as RGBA8Source;
  if (!src) throw new TypeError('createImageBitmap: unsupported source');
  let { width, height } = src;
  let data: Uint8Array = new Uint8Array(src.data.buffer, src.data.byteOffset, width * height * 4).slice();
  if (options.resizeWidth || options.resizeHeight) {
    const w = options.resizeWidth ?? Math.round(width * ((options.resizeHeight ?? height) / height));
    const h = options.resizeHeight ?? Math.round(height * (w / width));
    const r = resampleNearest({ width, height, data }, w, h);
    width = r.width; height = r.height; data = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  if (options.imageOrientation === 'flipY') {
    const row = width * 4;
    const tmp = new Uint8Array(row);
    for (let y = 0, z = height - 1; y < z; y++, z--) {
      tmp.set(data.subarray(y * row, (y + 1) * row));
      data.copyWithin(y * row, z * row, (z + 1) * row);
      data.set(tmp, z * row);
    }
  }
  if (options.premultiplyAlpha === 'premultiply') {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 255) continue;
      data[i] = (data[i] * a + 127) / 255; data[i + 1] = (data[i + 1] * a + 127) / 255; data[i + 2] = (data[i + 2] * a + 127) / 255;
    }
  }
  return new ImageBitmap(width, height, data);
}
