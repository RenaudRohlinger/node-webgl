// HTMLCanvasElement look-alike that hands out WebGL contexts and encodes its pixels.
import { WebGLRenderingContext } from '../webgl/WebGLRenderingContext.ts';
import { WebGL2RenderingContext } from '../webgl/WebGL2RenderingContext.ts';
import type { WebGLContextAttributes, ContextOptions } from '../webgl/context.ts';
import { encodeImage, ImageData } from './image.ts';
import type { RGBA8Source } from '../webgl/pixels.ts';

export type CanvasContextId = 'webgl' | 'experimental-webgl' | 'webgl2' | 'experimental-webgl2';
export type CanvasContextAttributes = WebGLContextAttributes & { backend?: ContextOptions['backend'] };

export class Canvas extends EventTarget {
  /** @internal */ _width: number;
  /** @internal */ _height: number;
  /** @internal */ _ctx: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  /** @internal */ _ctxKind: 'webgl' | 'webgl2' | null = null;
  /** @internal */ _attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly nodeName = 'CANVAS';
  readonly tagName = 'CANVAS';
  readonly nodeType = 1;
  readonly ownerDocument: unknown = null;
  parentNode: unknown = null;
  id = '';
  className = '';

  constructor(width = 300, height = 150) {
    super();
    this._width = Math.max(0, width | 0);
    this._height = Math.max(0, height | 0);
  }

  get width(): number { return this._width; }
  set width(v: number) {
    const w = Math.max(0, Number(v) | 0);
    this._width = w;
    this._ctx?._resize(w, this._height);
  }
  get height(): number { return this._height; }
  set height(v: number) {
    const h = Math.max(0, Number(v) | 0);
    this._height = h;
    this._ctx?._resize(this._width, h);
  }
  get clientWidth(): number { return this._width; }
  get clientHeight(): number { return this._height; }
  get offsetWidth(): number { return this._width; }
  get offsetHeight(): number { return this._height; }

  getBoundingClientRect(): { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number } {
    return { x: 0, y: 0, width: this._width, height: this._height, top: 0, left: 0, right: this._width, bottom: this._height };
  }

  getContext(contextId: 'webgl' | 'experimental-webgl', attributes?: CanvasContextAttributes): WebGLRenderingContext | null;
  getContext(contextId: 'webgl2' | 'experimental-webgl2', attributes?: CanvasContextAttributes): WebGL2RenderingContext | null;
  getContext(contextId: string, attributes?: CanvasContextAttributes): WebGLRenderingContext | WebGL2RenderingContext | null;
  getContext(contextId: string, attributes: CanvasContextAttributes = {}): WebGLRenderingContext | WebGL2RenderingContext | null {
    let kind: 'webgl' | 'webgl2';
    switch (contextId) {
      case 'webgl': case 'experimental-webgl': kind = 'webgl'; break;
      case 'webgl2': case 'experimental-webgl2': kind = 'webgl2'; break;
      default: return null; // '2d', 'bitmaprenderer', 'webgpu' are not provided
    }
    if (this._ctx) return this._ctxKind === kind ? this._ctx : null;
    try {
      const opts = { ...attributes, width: this._width, height: this._height, canvas: this };
      this._ctx = kind === 'webgl2' ? new WebGL2RenderingContext(opts) : new WebGLRenderingContext(opts);
      this._ctxKind = kind;
    } catch (err) {
      this.dispatchEvent(Object.assign(new Event('webglcontextcreationerror'), { statusMessage: err instanceof Error ? err.message : String(err) }));
      return null;
    }
    return this._ctx;
  }

  /** Raw RGBA8 pixels of the drawing buffer, top row first. */
  getImageData(): ImageData {
    if (!this._ctx) return new ImageData(Math.max(this._width, 1), Math.max(this._height, 1));
    const { width, height, data } = this._ctx._readDrawingBuffer();
    return new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
  }

  /** @internal texture-source hook */
  _toRGBA8(): RGBA8Source {
    const img = this.getImageData();
    return { width: img.width, height: img.height, data: img.data };
  }

  /** Encodes the drawing buffer. PNG always works; JPEG/WebP/... need the native codec (macOS). */
  toBuffer(mime = 'image/png', options: { quality?: number } = {}): Buffer {
    const img = this.getImageData();
    const bytes = encodeImage(img.width, img.height, img.data, mime, options.quality ?? 0.92);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  toDataURL(mime = 'image/png', quality?: number): string {
    const buf = this.toBuffer(mime, { quality });
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  toBlob(callback: (blob: Blob | null) => void, mime = 'image/png', quality?: number): void {
    const buf = this.toBuffer(mime, { quality });
    callback(new Blob([buf], { type: mime }));
  }

  /** Same as toBuffer but async, matching OffscreenCanvas.convertToBlob(). */
  async convertToBlob(options: { type?: string; quality?: number } = {}): Promise<Blob> {
    const mime = options.type ?? 'image/png';
    return new Blob([this.toBuffer(mime, { quality: options.quality })], { type: mime });
  }

  setAttribute(name: string, value: string): void {
    this._attributes.set(name, String(value));
    if (name === 'width') this.width = Number(value);
    else if (name === 'height') this.height = Number(value);
    else if (name === 'id') this.id = value;
    else if (name === 'class') this.className = value;
  }
  getAttribute(name: string): string | null {
    if (name === 'width') return String(this._width);
    if (name === 'height') return String(this._height);
    return this._attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean { return name === 'width' || name === 'height' || this._attributes.has(name); }
  removeAttribute(name: string): void { this._attributes.delete(name); }
  focus(): void {}
  blur(): void {}
  remove(): void {}
  appendChild<T>(node: T): T { return node; }
  removeChild<T>(node: T): T { return node; }

  /** Destroys the GL context and frees GPU resources. */
  dispose(): void {
    this._ctx?.destroy();
  }

  get [Symbol.toStringTag](): string { return 'HTMLCanvasElement'; }
}

/** Creates a canvas; call getContext('webgl2') / getContext('webgl') on it. */
export function createCanvas(width: number, height: number): Canvas {
  return new Canvas(width, height);
}
