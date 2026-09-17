// The WebGL "default framebuffer" is emulated with a framebuffer object, exactly like browsers do:
// binding `null` binds this FBO. With antialias the scene renders into a multisampled FBO that is
// resolved into a single-sample one whenever pixels are read back.
import type { Native } from '../native.ts';
import { GL } from './constants.ts';

export interface DrawingBufferOptions {
  alpha: boolean;
  depth: boolean;
  stencil: boolean;
  /** Requested sample count (0 = no multisampling). */
  samples: number;
  /** MAX_RENDERBUFFER_SIZE. */
  maxSize: number;
}

const RGBA8 = 0x8058;
const RGB8 = 0x8051;
const DEPTH_COMPONENT24 = 0x81a6;
const DEPTH24_STENCIL8 = 0x88f0;

/**
 * Clears the currently bound draw framebuffer to WebGL's initial contents (transparent black, depth 1, stencil 0),
 * ignoring the scissor, write masks and clear values of the application, all of which are preserved.
 */
export function clearFramebufferContents(n: Native, es3: boolean, mask: number): void {
  const clearColor = new Float32Array(4);
  const clearDepth = new Float32Array(1);
  const clearStencil = new Int32Array(1);
  const colorMask = new Uint8Array(4);
  const depthMask = new Uint8Array(1);
  const stencilMask = new Int32Array(1);
  const stencilBackMask = new Int32Array(1);
  n.getFloatv(GL.COLOR_CLEAR_VALUE, clearColor);
  n.getFloatv(GL.DEPTH_CLEAR_VALUE, clearDepth);
  n.getIntegerv(GL.STENCIL_CLEAR_VALUE, clearStencil);
  n.getBooleanv(GL.COLOR_WRITEMASK, colorMask);
  n.getBooleanv(GL.DEPTH_WRITEMASK, depthMask);
  n.getIntegerv(GL.STENCIL_WRITEMASK, stencilMask);
  n.getIntegerv(GL.STENCIL_BACK_WRITEMASK, stencilBackMask);
  const scissor = n.isEnabled(GL.SCISSOR_TEST);
  const discard = es3 ? n.isEnabled(GL.RASTERIZER_DISCARD) : false;

  n.clearColor(0, 0, 0, 0);
  n.clearDepthf(1);
  n.clearStencil(0);
  n.colorMask(true, true, true, true);
  n.depthMask(true);
  n.stencilMask(0xffffffff);
  if (scissor) n.disable(GL.SCISSOR_TEST);
  if (discard) n.disable(GL.RASTERIZER_DISCARD);
  n.clear(mask);

  n.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
  n.clearDepthf(clearDepth[0]);
  n.clearStencil(clearStencil[0]);
  n.colorMask(!!colorMask[0], !!colorMask[1], !!colorMask[2], !!colorMask[3]);
  n.depthMask(!!depthMask[0]);
  n.stencilMaskSeparate(GL.FRONT, stencilMask[0]);
  n.stencilMaskSeparate(GL.BACK, stencilBackMask[0]);
  if (scissor) n.enable(GL.SCISSOR_TEST);
  if (discard) n.enable(GL.RASTERIZER_DISCARD);
}

export class DrawingBuffer {
  /** Single-sample (resolved) framebuffer: what readPixels/toBuffer see. */
  fbo = 0;
  /** Multisampled framebuffer when antialias is on (0 otherwise). Draws go here. */
  msFbo = 0;
  width = 0;
  height = 0;
  /** Actual sample count in use. */
  samples = 0;
  readonly alpha: boolean;
  readonly depth: boolean;
  readonly stencil: boolean;
  /** Sized color format (RGBA8 / RGB8 by default, or what drawingBufferStorage() asked for). */
  colorFormat: number;

  private color = 0;
  private depthStencil = 0;
  private msColor = 0;
  private msDepthStencil = 0;
  private readonly n: Native;
  private readonly es3: boolean;
  private readonly maxSize: number;

  constructor(n: Native, es3: boolean, opts: DrawingBufferOptions) {
    this.n = n;
    this.es3 = es3;
    this.alpha = opts.alpha;
    this.depth = opts.depth;
    this.stencil = opts.stencil;
    this.maxSize = opts.maxSize;
    this.samples = opts.samples;
    this.colorFormat = opts.alpha ? RGBA8 : RGB8;
  }

  /** The FBO that `bindFramebuffer(target, null)` should bind. */
  get drawFbo(): number {
    return this.msFbo || this.fbo;
  }

  private gen(kind: 'fbo' | 'rbo'): number {
    const out = new Uint32Array(1);
    if (kind === 'fbo') this.n.genFramebuffers(1, out);
    else this.n.genRenderbuffers(1, out);
    return out[0];
  }

  /** (Re)allocates storage for a new size and clears every buffer. Bindings are preserved. */
  allocate(width: number, height: number): void {
    const n = this.n;
    const w = Math.max(1, Math.min(width, this.maxSize));
    const h = Math.max(1, Math.min(height, this.maxSize));
    this.width = w;
    this.height = h;

    const prevDraw = new Int32Array(1);
    const prevRead = new Int32Array(1);
    const prevRbo = new Int32Array(1);
    n.getIntegerv(GL.FRAMEBUFFER_BINDING, prevDraw);
    const separateRead = this.es3 || this.samples > 0;
    if (separateRead) n.getIntegerv(GL.READ_FRAMEBUFFER_BINDING, prevRead);
    n.getIntegerv(GL.RENDERBUFFER_BINDING, prevRbo);

    const colorFormat = this.colorFormat;
    const dsFormat = this.stencil ? DEPTH24_STENCIL8 : this.depth ? DEPTH_COMPONENT24 : 0;
    const dsAttachment = this.stencil ? GL.DEPTH_STENCIL_ATTACHMENT : GL.DEPTH_ATTACHMENT;

    if (!this.fbo) {
      this.fbo = this.gen('fbo');
      this.color = this.gen('rbo');
      if (dsFormat) this.depthStencil = this.gen('rbo');
    }
    n.bindRenderbuffer(GL.RENDERBUFFER, this.color);
    n.renderbufferStorage(GL.RENDERBUFFER, colorFormat, w, h);
    if (dsFormat) {
      n.bindRenderbuffer(GL.RENDERBUFFER, this.depthStencil);
      n.renderbufferStorage(GL.RENDERBUFFER, dsFormat, w, h);
    }
    n.bindFramebuffer(GL.FRAMEBUFFER, this.fbo);
    n.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.RENDERBUFFER, this.color);
    if (dsFormat) n.framebufferRenderbuffer(GL.FRAMEBUFFER, dsAttachment, GL.RENDERBUFFER, this.depthStencil);

    if (this.samples > 0) {
      const storageMS = this.es3
        ? (t: number, s: number, f: number, ww: number, hh: number) => n.renderbufferStorageMultisample(t, s, f, ww, hh)
        : (t: number, s: number, f: number, ww: number, hh: number) => n.renderbufferStorageMultisampleANGLE(t, s, f, ww, hh);
      if (!this.msFbo) {
        this.msFbo = this.gen('fbo');
        this.msColor = this.gen('rbo');
        if (dsFormat) this.msDepthStencil = this.gen('rbo');
      }
      n.bindRenderbuffer(GL.RENDERBUFFER, this.msColor);
      storageMS(GL.RENDERBUFFER, this.samples, colorFormat, w, h);
      if (dsFormat) {
        n.bindRenderbuffer(GL.RENDERBUFFER, this.msDepthStencil);
        storageMS(GL.RENDERBUFFER, this.samples, dsFormat, w, h);
      }
      n.bindFramebuffer(GL.FRAMEBUFFER, this.msFbo);
      n.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.RENDERBUFFER, this.msColor);
      if (dsFormat) n.framebufferRenderbuffer(GL.FRAMEBUFFER, dsAttachment, GL.RENDERBUFFER, this.msDepthStencil);
      if (n.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
        // Multisampling not available at this size/format: fall back to single-sample.
        n.deleteFramebuffers(1, new Uint32Array([this.msFbo]));
        n.deleteRenderbuffers(1, new Uint32Array([this.msColor]));
        if (this.msDepthStencil) n.deleteRenderbuffers(1, new Uint32Array([this.msDepthStencil]));
        this.msFbo = this.msColor = this.msDepthStencil = 0;
        this.samples = 0;
      }
    }

    // WebGL: a (re)sized drawing buffer starts cleared to transparent black, depth 1, stencil 0.
    this.clearAll(this.fbo);
    if (this.msFbo) this.clearAll(this.msFbo);

    n.bindRenderbuffer(GL.RENDERBUFFER, prevRbo[0]);
    if (separateRead) {
      n.bindFramebuffer(GL.DRAW_FRAMEBUFFER, prevDraw[0]);
      n.bindFramebuffer(GL.READ_FRAMEBUFFER, prevRead[0]);
    } else {
      n.bindFramebuffer(GL.FRAMEBUFFER, prevDraw[0]);
    }
  }

  private clearAll(fbo: number): void {
    this.n.bindFramebuffer(GL.FRAMEBUFFER, fbo);
    clearFramebufferContents(this.n, this.es3, GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
  }

  /**
   * Resolves the multisampled buffer into the single-sample one (no-op without antialias).
   * Framebuffer bindings and scissor state are preserved.
   */
  resolve(mask: number = GL.COLOR_BUFFER_BIT): void {
    if (!this.msFbo) return;
    const n = this.n;
    const prevDraw = new Int32Array(1);
    const prevRead = new Int32Array(1);
    n.getIntegerv(GL.DRAW_FRAMEBUFFER_BINDING, prevDraw);
    n.getIntegerv(GL.READ_FRAMEBUFFER_BINDING, prevRead);
    const scissor = n.isEnabled(GL.SCISSOR_TEST);
    if (scissor) n.disable(GL.SCISSOR_TEST);
    n.bindFramebuffer(GL.READ_FRAMEBUFFER, this.msFbo);
    n.bindFramebuffer(GL.DRAW_FRAMEBUFFER, this.fbo);
    const w = this.width, h = this.height;
    if (this.es3) n.blitFramebuffer(0, 0, w, h, 0, 0, w, h, mask, GL.NEAREST);
    else n.blitFramebufferANGLE(0, 0, w, h, 0, 0, w, h, mask, GL.NEAREST);
    n.bindFramebuffer(GL.READ_FRAMEBUFFER, prevRead[0]);
    n.bindFramebuffer(GL.DRAW_FRAMEBUFFER, prevDraw[0]);
    if (scissor) n.enable(GL.SCISSOR_TEST);
  }

  /** Copies the resolved color buffer back into the multisampled one (after external writes to `fbo`). */
  unresolve(): void {
    if (!this.msFbo) return;
    const n = this.n;
    const prevDraw = new Int32Array(1);
    const prevRead = new Int32Array(1);
    n.getIntegerv(GL.DRAW_FRAMEBUFFER_BINDING, prevDraw);
    n.getIntegerv(GL.READ_FRAMEBUFFER_BINDING, prevRead);
    const scissor = n.isEnabled(GL.SCISSOR_TEST);
    if (scissor) n.disable(GL.SCISSOR_TEST);
    n.bindFramebuffer(GL.READ_FRAMEBUFFER, this.fbo);
    n.bindFramebuffer(GL.DRAW_FRAMEBUFFER, this.msFbo);
    const w = this.width, h = this.height;
    if (this.es3) n.blitFramebuffer(0, 0, w, h, 0, 0, w, h, GL.COLOR_BUFFER_BIT, GL.NEAREST);
    else n.blitFramebufferANGLE(0, 0, w, h, 0, 0, w, h, GL.COLOR_BUFFER_BIT, GL.NEAREST);
    n.bindFramebuffer(GL.READ_FRAMEBUFFER, prevRead[0]);
    n.bindFramebuffer(GL.DRAW_FRAMEBUFFER, prevDraw[0]);
    if (scissor) n.enable(GL.SCISSOR_TEST);
  }

  destroy(): void {
    const n = this.n;
    const fbos = [this.fbo, this.msFbo].filter(Boolean);
    const rbos = [this.color, this.depthStencil, this.msColor, this.msDepthStencil].filter(Boolean);
    if (fbos.length) n.deleteFramebuffers(fbos.length, new Uint32Array(fbos));
    if (rbos.length) n.deleteRenderbuffers(rbos.length, new Uint32Array(rbos));
    this.fbo = this.msFbo = this.color = this.depthStencil = this.msColor = this.msDepthStencil = 0;
  }
}
