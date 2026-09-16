// Minimal browser globals so libraries written for the web (three.js, pixi, regl, ...) run unchanged in Node.
import { readFile } from 'node:fs/promises';
import { extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from './canvas/Canvas.ts';
import { Image, ImageData, ImageBitmap, createImageBitmap } from './canvas/image.ts';
import { WebGLRenderingContext } from './webgl/WebGLRenderingContext.ts';
import { WebGL2RenderingContext } from './webgl/WebGL2RenderingContext.ts';
import * as objects from './webgl/objects.ts';

export interface InstallDOMOptions {
  /** Teach global fetch() to read local files (relative paths and file: URLs). Default true. */
  fetch?: boolean;
  /** Directory relative paths resolve against. Default process.cwd(). */
  baseDir?: string;
  devicePixelRatio?: number;
  /** Viewport reported by window.innerWidth/innerHeight. Default 1920x1080. */
  innerWidth?: number;
  innerHeight?: number;
  /** requestAnimationFrame interval in ms. Default 16. */
  frameInterval?: number;
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr', '.ktx2': 'image/ktx2', '.ktx': 'image/ktx', '.basis': 'application/octet-stream',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.obj': 'text/plain', '.mtl': 'text/plain', '.fbx': 'application/octet-stream', '.drc': 'application/octet-stream',
};

class Element extends EventTarget {
  readonly style: Record<string, string> = {};
  readonly children: Element[] = [];
  readonly dataset: Record<string, string> = {};
  readonly classList = { add(): void {}, remove(): void {}, toggle(): boolean { return false; }, contains(): boolean { return false; } };
  parentNode: Element | null = null;
  innerHTML = '';
  textContent = '';
  id = '';
  className = '';
  readonly nodeType = 1;
  readonly tagName: string;
  private attrs = new Map<string, string>();
  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }
  get nodeName(): string { return this.tagName; }
  get clientWidth(): number { return 0; }
  get clientHeight(): number { return 0; }
  get offsetWidth(): number { return 0; }
  get offsetHeight(): number { return 0; }
  appendChild<T>(node: T): T { if (node instanceof Element) { this.children.push(node); node.parentNode = this; } return node; }
  removeChild<T>(node: T): T { const i = this.children.indexOf(node as unknown as Element); if (i >= 0) this.children.splice(i, 1); return node; }
  insertBefore<T>(node: T): T { return this.appendChild(node); }
  remove(): void { this.parentNode?.removeChild(this); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  getBoundingClientRect(): { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number } {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
  querySelector(): Element | null { return null; }
  querySelectorAll(): Element[] { return []; }
  focus(): void {}
  blur(): void {}
  click(): void {}
  getContext(): null { return null; }
}

/** FileReader polyfill on top of Node's Blob (Node has Blob/File but no FileReader). */
class FileReader extends EventTarget {
  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
  readonly EMPTY = 0;
  readonly LOADING = 1;
  readonly DONE = 2;
  readyState = 0;
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onloadstart: ((ev: Event) => void) | null = null;
  onload: ((ev: Event) => void) | null = null;
  onloadend: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onabort: ((ev: Event) => void) | null = null;
  onprogress: ((ev: Event) => void) | null = null;

  private fire(type: 'loadstart' | 'load' | 'loadend' | 'error' | 'abort' | 'progress'): void {
    const ev = new Event(type);
    const handler = this[`on${type}`];
    handler?.call(this, ev);
    this.dispatchEvent(ev);
  }
  private read(blob: Blob, convert: (buf: ArrayBuffer) => string | ArrayBuffer): void {
    if (this.readyState === 1) throw new DOMException('The object is already busy reading Blobs.', 'InvalidStateError');
    this.readyState = 1;
    this.result = null;
    this.error = null;
    this.fire('loadstart');
    blob.arrayBuffer().then(
      (buf) => {
        if (this.readyState !== 1) return;
        this.result = convert(buf);
        this.readyState = 2;
        this.fire('progress');
        this.fire('load');
        this.fire('loadend');
      },
      (err: unknown) => {
        this.error = err instanceof Error ? err : new Error(String(err));
        this.readyState = 2;
        this.fire('error');
        this.fire('loadend');
      },
    );
  }
  readAsArrayBuffer(blob: Blob): void { this.read(blob, (buf) => buf); }
  readAsText(blob: Blob, encoding = 'utf-8'): void { this.read(blob, (buf) => new TextDecoder(encoding).decode(buf)); }
  readAsBinaryString(blob: Blob): void { this.read(blob, (buf) => Buffer.from(buf).toString('latin1')); }
  readAsDataURL(blob: Blob): void { this.read(blob, (buf) => `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`); }
  abort(): void {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this.result = null;
    this.fire('abort');
    this.fire('loadend');
  }
  get [Symbol.toStringTag](): string { return 'FileReader'; }
}

function createElement(tag: string): Element | Canvas | Image {
  const t = String(tag).toLowerCase();
  if (t === 'canvas') return new Canvas(300, 150);
  if (t === 'img') return new Image();
  return new Element(t);
}

let installed = false;

/**
 * Installs window, document, Image, HTMLCanvasElement, the WebGL classes and requestAnimationFrame (only the ones missing),
 * and optionally makes fetch() read local files. Idempotent.
 */
export function installDOM(options: InstallDOMOptions = {}): void {
  const g = globalThis as Record<string, unknown>;
  const define = (name: string, value: unknown): void => {
    if (name in g && g[name] !== undefined) return;
    Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: false });
  };

  define('window', g);
  define('self', g);
  define('HTMLCanvasElement', Canvas);
  define('OffscreenCanvas', class OffscreenCanvas extends Canvas {});
  define('HTMLImageElement', Image);
  define('Image', Image);
  define('ImageData', ImageData);
  define('ImageBitmap', ImageBitmap);
  define('createImageBitmap', createImageBitmap);
  define('FileReader', FileReader);
  define('HTMLElement', Element);
  define('Element', Element);
  define('Node', Element);
  define('WebGLRenderingContext', WebGLRenderingContext);
  define('WebGL2RenderingContext', WebGL2RenderingContext);
  for (const [name, cls] of Object.entries(objects)) if (typeof cls === 'function') define(name, cls);
  define('devicePixelRatio', options.devicePixelRatio ?? 1);
  define('innerWidth', options.innerWidth ?? 1920);
  define('innerHeight', options.innerHeight ?? 1080);
  define('screen', { width: options.innerWidth ?? 1920, height: options.innerHeight ?? 1080, availWidth: options.innerWidth ?? 1920, availHeight: options.innerHeight ?? 1080 });
  const interval = options.frameInterval ?? 16;
  define('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), interval));
  define('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  define('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  define('matchMedia', () => ({ matches: false, addEventListener(): void {}, removeEventListener(): void {}, addListener(): void {}, removeListener(): void {} }));
  define('scrollTo', () => {});
  define('alert', (msg: unknown) => console.warn('[alert]', msg));

  if (!('location' in g) || g.location === undefined) {
    const base = options.baseDir ?? process.cwd();
    const href = `file://${base.replace(/\/?$/, '/')}`;
    define('location', { href, origin: 'file://', protocol: 'file:', host: '', hostname: '', port: '', pathname: base, search: '', hash: '', reload(): void {}, toString: () => href });
  }

  if (!('document' in g) || g.document === undefined) {
    const body = new Element('body');
    const head = new Element('head');
    const html = new Element('html');
    html.appendChild(head);
    html.appendChild(body);
    const document = Object.assign(new EventTarget(), {
      body, head, documentElement: html, defaultView: g, readyState: 'complete', title: '', hidden: false, visibilityState: 'visible',
      createElement, createElementNS: (_ns: string, tag: string) => createElement(tag),
      createTextNode: (text: string) => ({ textContent: text, nodeType: 3 }),
      createEvent: (type: string) => new Event(type),
      getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
      querySelector: () => null, querySelectorAll: () => [],
      hasFocus: () => true, exitPointerLock(): void {}, exitFullscreen: () => Promise.resolve(),
      get pointerLockElement() { return null; }, get fullscreenElement() { return null; }, get activeElement() { return body; },
    });
    define('document', document);
  }

  if (options.fetch !== false && !installed) {
    const baseDir = options.baseDir ?? process.cwd();
    const originalFetch = globalThis.fetch;
    const localFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/^(https?|data|blob):/i.test(url)) return originalFetch(input, init);
      const path = url.startsWith('file:') ? fileURLToPath(url) : resolvePath(baseDir, url.replace(/[?#].*$/, ''));
      try {
        const bytes = await readFile(path);
        return new Response(bytes, { status: 200, headers: { 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' } });
      } catch {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
    };
    Object.defineProperty(globalThis, 'fetch', { value: localFetch, writable: true, configurable: true });
  }
  installed = true;
}
