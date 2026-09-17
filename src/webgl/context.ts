// WebGLRenderingContextBase: everything shared by WebGL 1 and WebGL 2 contexts.
//
// ANGLE (created in WebGL-compatibility mode) enforces the WebGL validation rules on the GL side.
// This layer adds what only the embedder can know: JS object identity (ownership, deletion), the
// emulated default framebuffer, extension gating, pixel-unpack conversions, and the getX() result types.
import type { Native } from '../native.ts';
import { loadNative, init as initDisplay, refreshNativeFunctions, hasNativeFunction, getDisplayInfo } from '../native.ts';
import { GL } from './constants.ts';
import { GLX } from './gl-internal.ts';
import {
  WebGLObject, WebGLBuffer, WebGLFramebuffer, WebGLProgram, WebGLRenderbuffer, WebGLShader, WebGLTexture,
  WebGLUniformLocation, WebGLActiveInfo, WebGLShaderPrecisionFormat, WebGLQuery, WebGLSampler, WebGLSync,
  WebGLTransformFeedback, WebGLVertexArrayObject, WebGLContextEvent, type UniformInfo,
} from './objects.ts';
import { PARAMETER_KINDS, WEBGL2_ONLY_PNAMES, PNAME_EXTENSION, EXT_PNAME } from './parameters.ts';
import {
  bytesPerPixel, imageByteSize, repackForUpload, convertImage, canConvertImage, flipRowsInPlace,
  type UnpackParams, type RGBA8Source,
} from './pixels.ts';
import { DrawingBuffer, clearFramebufferContents } from './drawing-buffer.ts';
import { EXTENSIONS, type ExtensionEntry } from './extensions.ts';

export interface WebGLContextAttributes {
  alpha?: boolean;
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: 'default' | 'low-power' | 'high-performance';
  failIfMajorPerformanceCaveat?: boolean;
  desynchronized?: boolean;
  xrCompatible?: boolean;
}

/** What a context needs from its canvas (our Canvas class or any compatible object). */
export interface CanvasLike {
  width: number;
  height: number;
  dispatchEvent?(event: Event): boolean;
}

export interface ContextOptions extends WebGLContextAttributes {
  /** 1 for WebGL 1 (ES 2.0), 2 for WebGL 2 (ES 3.0). */
  version: 1 | 2;
  width: number;
  height: number;
  canvas?: CanvasLike | null;
  /** ANGLE backend override (see init()). */
  backend?: 'default' | 'metal' | 'gl' | 'gles' | 'vulkan' | 'swiftshader' | 'd3d11' | 'null';
}

export type TypedArray =
  | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array
  | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
export type Float32List = Float32Array | ArrayLike<number>;
export type Int32List = Int32Array | ArrayLike<number>;
export type Uint32List = Uint32Array | ArrayLike<number>;

/** Anything texImage2D & friends accept as an image: ImageData, our Image / Canvas, or {width,height,data(RGBA8)}. */
export type TexImageSource = RGBA8Source | { width: number; height: number; getContext?: unknown } | object;

const READ_FRAMEBUFFER = GL.READ_FRAMEBUFFER;
const DRAW_FRAMEBUFFER = GL.DRAW_FRAMEBUFFER;
const REQUESTABLE_EXTENSIONS_ANGLE = 0x93a8;
const MAX_SAMPLES_ANGLE = 0x8d57;
const COMPLETION_STATUS_KHR = 0x91b1;
const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
const TEXTURE_IMMUTABLE_FORMAT = 0x912f;
const TEXTURE_IMMUTABLE_LEVELS = 0x82df;
const HALF_FLOAT_OES = 0x8d61;
const DEPTH24_STENCIL8 = 0x88f0;
const SRGB8_ALPHA8_EXT = 0x8c43;
const RGBA32F_EXT = 0x8814, RGB32F_EXT = 0x8815, RGBA16F_EXT = 0x881a, RGB16F_EXT = 0x881b;
const TIME_ELAPSED_EXT = 0x88bf, TIMESTAMP_EXT = 0x8e28;
const QUERY_RESULT_EXT = 0x8866, QUERY_RESULT_AVAILABLE_EXT = 0x8867;
const FRAMEBUFFER_DEFAULT = 0x8218;
const MAX_CLIENT_WAIT_TIMEOUT = 1_000_000_000; // 1s in ns; blocking is fine off the main thread of a browser

let currentContext: WebGLRenderingContextBase | null = null;
let nextContextId = 1;
const utf8 = new TextDecoder();

function isView(v: unknown): v is ArrayBufferView {
  return ArrayBuffer.isView(v);
}
function bytesOf(v: ArrayBufferView, elementOffset = 0): Uint8Array {
  const bpe = (v as TypedArray).BYTES_PER_ELEMENT ?? 1;
  const off = elementOffset * bpe;
  return new Uint8Array(v.buffer, v.byteOffset + off, v.byteLength - off);
}
function toF32(v: Float32List): Float32Array {
  return v instanceof Float32Array ? v : new Float32Array(v as ArrayLike<number>);
}
function toI32(v: Int32List): Int32Array {
  return v instanceof Int32Array ? v : new Int32Array(v as ArrayLike<number>);
}
function toU32(v: Uint32List): Uint32Array {
  return v instanceof Uint32Array ? v : new Uint32Array(v as ArrayLike<number>);
}

/** Typed-array class a (type) requires for ArrayBufferView uploads/readbacks (null = any). */
function expectedArrayType(type: number): ((v: unknown) => boolean) | null {
  switch (type) {
    case GL.UNSIGNED_BYTE: return (v) => v instanceof Uint8Array || v instanceof Uint8ClampedArray;
    case GL.BYTE: return (v) => v instanceof Int8Array;
    case GL.UNSIGNED_SHORT: case GL.UNSIGNED_SHORT_4_4_4_4: case GL.UNSIGNED_SHORT_5_5_5_1: case GL.UNSIGNED_SHORT_5_6_5:
    case GL.HALF_FLOAT: case HALF_FLOAT_OES:
      return (v) => v instanceof Uint16Array;
    case GL.SHORT: return (v) => v instanceof Int16Array;
    case GL.UNSIGNED_INT: case GL.UNSIGNED_INT_2_10_10_10_REV: case GL.UNSIGNED_INT_10F_11F_11F_REV:
    case GL.UNSIGNED_INT_5_9_9_9_REV: case GL.UNSIGNED_INT_24_8:
      return (v) => v instanceof Uint32Array;
    case GL.INT: return (v) => v instanceof Int32Array;
    case GL.FLOAT: return (v) => v instanceof Float32Array;
    default: return null;
  }
}

const UNIFORM_TYPE_INFO: Record<number, { base: 'f' | 'i' | 'u' | 'b'; count: number }> = {
  [GL.FLOAT]: { base: 'f', count: 1 }, [GL.FLOAT_VEC2]: { base: 'f', count: 2 }, [GL.FLOAT_VEC3]: { base: 'f', count: 3 }, [GL.FLOAT_VEC4]: { base: 'f', count: 4 },
  [GL.FLOAT_MAT2]: { base: 'f', count: 4 }, [GL.FLOAT_MAT3]: { base: 'f', count: 9 }, [GL.FLOAT_MAT4]: { base: 'f', count: 16 },
  [GL.FLOAT_MAT2x3]: { base: 'f', count: 6 }, [GL.FLOAT_MAT2x4]: { base: 'f', count: 8 }, [GL.FLOAT_MAT3x2]: { base: 'f', count: 6 },
  [GL.FLOAT_MAT3x4]: { base: 'f', count: 12 }, [GL.FLOAT_MAT4x2]: { base: 'f', count: 8 }, [GL.FLOAT_MAT4x3]: { base: 'f', count: 12 },
  [GL.INT]: { base: 'i', count: 1 }, [GL.INT_VEC2]: { base: 'i', count: 2 }, [GL.INT_VEC3]: { base: 'i', count: 3 }, [GL.INT_VEC4]: { base: 'i', count: 4 },
  [GL.UNSIGNED_INT]: { base: 'u', count: 1 }, [GL.UNSIGNED_INT_VEC2]: { base: 'u', count: 2 }, [GL.UNSIGNED_INT_VEC3]: { base: 'u', count: 3 }, [GL.UNSIGNED_INT_VEC4]: { base: 'u', count: 4 },
  [GL.BOOL]: { base: 'b', count: 1 }, [GL.BOOL_VEC2]: { base: 'b', count: 2 }, [GL.BOOL_VEC3]: { base: 'b', count: 3 }, [GL.BOOL_VEC4]: { base: 'b', count: 4 },
  [GL.SAMPLER_2D]: { base: 'i', count: 1 }, [GL.SAMPLER_CUBE]: { base: 'i', count: 1 }, [GL.SAMPLER_3D]: { base: 'i', count: 1 },
  [GL.SAMPLER_2D_SHADOW]: { base: 'i', count: 1 }, [GL.SAMPLER_2D_ARRAY]: { base: 'i', count: 1 }, [GL.SAMPLER_2D_ARRAY_SHADOW]: { base: 'i', count: 1 },
  [GL.SAMPLER_CUBE_SHADOW]: { base: 'i', count: 1 }, [GL.INT_SAMPLER_2D]: { base: 'i', count: 1 }, [GL.INT_SAMPLER_3D]: { base: 'i', count: 1 },
  [GL.INT_SAMPLER_CUBE]: { base: 'i', count: 1 }, [GL.INT_SAMPLER_2D_ARRAY]: { base: 'i', count: 1 }, [GL.UNSIGNED_INT_SAMPLER_2D]: { base: 'i', count: 1 },
  [GL.UNSIGNED_INT_SAMPLER_3D]: { base: 'i', count: 1 }, [GL.UNSIGNED_INT_SAMPLER_CUBE]: { base: 'i', count: 1 }, [GL.UNSIGNED_INT_SAMPLER_2D_ARRAY]: { base: 'i', count: 1 },
};

export class WebGLRenderingContextBase {
  /** @internal */ readonly _contextId = nextContextId++;
  /** @internal */ readonly _n: Native;
  /** @internal */ _handle = 0;
  /** @internal */ readonly _isWebGL2: boolean;
  /** @internal GL ES major version of the underlying context (a WebGL 1 context may run on ES 3 with non-ANGLE drivers). */ _glMajor = 3;
  /** @internal */ _es3 = true;
  /** @internal EGL implementation is ANGLE (WebGL-compat validation, requestable extensions). */ _isAngle = true;
  /** @internal which instanced-drawing entry points exist. */ _instanced: 'core' | 'angle' | 'ext' = 'core';
  /** @internal */ readonly _attrs: Required<WebGLContextAttributes>;
  /** @internal */ _canvas: CanvasLike | null;
  /** @internal */ _lost = false;
  /** @internal */ _lostErrorPending = false;
  /** @internal */ _restoreAllowed = false;
  /** @internal */ _destroyed = false;
  /** @internal */ _errors: number[] = [];
  /** @internal */ _drawingBuffer!: DrawingBuffer;
  /** @internal Framebuffer used to initialize fresh depth/stencil storage on non-ANGLE drivers. */ _initFbo = 0;

  /** @internal */ _buffers = new Map<number, WebGLBuffer>();
  /** @internal */ _framebuffers = new Map<number, WebGLFramebuffer>();
  /** @internal */ _programs = new Map<number, WebGLProgram>();
  /** @internal */ _renderbuffers = new Map<number, WebGLRenderbuffer>();
  /** @internal */ _shaders = new Map<number, WebGLShader>();
  /** @internal */ _textures = new Map<number, WebGLTexture>();
  /** @internal */ _queries = new Map<number, WebGLQuery>();
  /** @internal */ _samplers = new Map<number, WebGLSampler>();
  /** @internal */ _syncs = new Map<number, WebGLSync>();
  /** @internal */ _transformFeedbacks = new Map<number, WebGLTransformFeedback>();
  /** @internal */ _vertexArrays = new Map<number, WebGLVertexArrayObject>();

  /** @internal */ _drawFramebuffer: WebGLFramebuffer | null = null;
  /** @internal */ _readFramebuffer: WebGLFramebuffer | null = null;
  /** @internal */ _currentProgram: WebGLProgram | null = null;

  /** @internal */ _unpackFlipY = false;
  /** @internal */ _unpackPremultiplyAlpha = false;
  /** @internal */ _unpackColorspace: number = GL.BROWSER_DEFAULT_WEBGL;
  /** @internal */ _unpack: UnpackParams = { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0, imageHeight: 0, skipImages: 0 };
  /** @internal */ _pack = { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0 };

  /** @internal enabled GL extensions (GL_EXTENSIONS). */ _glEnabled = new Set<string>();
  /** @internal requestable GL extensions (GL_REQUESTABLE_EXTENSIONS_ANGLE). */ _glRequestable = new Set<string>();
  /** @internal WebGL extensions returned by getExtension so far. */ _extensions = new Map<string, object>();
  /** @internal */ _supportedExtensions: string[] | null = null;
  /** @internal per-attribute current-value type: 0 float, 1 int, 2 uint. */ _attribType: Uint8Array;
  /** @internal */ _maxVertexAttribs: number;

  // scratch buffers (never handed out)
  /** @internal */ _i32 = new Int32Array(16);
  /** @internal */ _u32 = new Uint32Array(16);
  /** @internal */ _f32 = new Float32Array(16);
  /** @internal */ _i64 = new BigInt64Array(4);
  /** @internal */ _u8 = new Uint8Array(16);

  constructor(options: ContextOptions) {
    this._n = loadNative();
    initDisplay({ backend: options.backend });
    this._isWebGL2 = options.version === 2;
    this._canvas = options.canvas ?? null;
    this._attrs = {
      alpha: options.alpha ?? true,
      depth: options.depth ?? true,
      stencil: options.stencil ?? false,
      antialias: options.antialias ?? true,
      premultipliedAlpha: options.premultipliedAlpha ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: options.powerPreference ?? 'default',
      failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat ?? false,
      desynchronized: options.desynchronized ?? false,
      xrCompatible: options.xrCompatible ?? false,
    };
    this._createNativeContext(options.width, options.height);
    this._maxVertexAttribs = this._getInt(GL.MAX_VERTEX_ATTRIBS);
    this._attribType = new Uint8Array(this._maxVertexAttribs);
  }

  /** @internal */
  _createNativeContext(width: number, height: number): void {
    const n = this._n;
    this._handle = n.createContext({
      major: this._isWebGL2 ? 3 : 2,
      minor: 0,
      webgl: true,
      robustness: true,
      robustResourceInit: true,
      powerPreference: this._attrs.powerPreference,
    });
    refreshNativeFunctions();
    currentContext = this;
    this._glEnabled = new Set((n.getString(GLX.EXTENSIONS) ?? '').split(' ').filter(Boolean));
    this._isAngle = getDisplayInfo()?.angle ?? true;
    const requestable = this._isAngle ? n.getString(REQUESTABLE_EXTENSIONS_ANGLE) : null;
    this._glRequestable = new Set((requestable ?? '').split(' ').filter(Boolean));
    const versionMatch = /OpenGL ES(?:-CM)? (\d+)\.(\d+)/.exec(n.getString(GL.VERSION) ?? '');
    this._glMajor = versionMatch ? Number(versionMatch[1]) : (this._isWebGL2 ? 3 : 2);
    this._es3 = this._glMajor >= 3;
    n.getError(); // clear a possible INVALID_ENUM on non-ANGLE drivers

    // Internal extensions the default-framebuffer emulation needs on ES 2.0.
    if (!this._es3) {
      this._requestGL('GL_OES_rgb8_rgba8');
      if (this._attrs.antialias) {
        this._requestGL('GL_ANGLE_framebuffer_blit');
        this._requestGL('GL_ANGLE_framebuffer_multisample');
      }
    }
    this._instanced = this._es3 ? 'core' : hasNativeFunction('glDrawArraysInstancedANGLE') ? 'angle' : 'ext';
    let samples = 0;
    if (this._attrs.antialias) {
      const maxSamples = this._es3 ? this._getInt(GL.MAX_SAMPLES) : (this._glEnabled.has('GL_ANGLE_framebuffer_multisample') ? this._getInt(MAX_SAMPLES_ANGLE) : 0);
      n.getError();
      samples = Math.min(4, maxSamples);
    }
    this._drawingBuffer = new DrawingBuffer(n, this._es3, {
      alpha: this._attrs.alpha, depth: this._attrs.depth, stencil: this._attrs.stencil, samples,
      maxSize: this._getInt(GL.MAX_RENDERBUFFER_SIZE),
    });
    this._drawingBuffer.allocate(width, height);
    this._attrs.antialias = this._drawingBuffer.samples > 0;
    n.bindFramebuffer(GL.FRAMEBUFFER, this._drawingBuffer.drawFbo);
    const w = this._drawingBuffer.width, h = this._drawingBuffer.height;
    n.viewport(0, 0, w, h);
    n.scissor(0, 0, w, h);
  }

  // ---------------------------------------------------------------------------
  // internals shared with extensions and the canvas
  // ---------------------------------------------------------------------------

  /** @internal Makes this context current; false when the context is lost. */
  _ready(): boolean {
    if (this._lost) return false;
    if (currentContext !== this) {
      this._n.makeCurrent(this._handle);
      currentContext = this;
    }
    return true;
  }

  /** @internal Records a WebGL-level error (returned by getError before GL's own). */
  _error(code: number): void {
    if (!this._errors.includes(code)) this._errors.push(code);
  }

  /** @internal Moves errors pending in the driver into the WebGL error queue. */
  _flushErrors(): void {
    for (let e = this._n.getError(); e !== GL.NO_ERROR; e = this._n.getError()) this._error(e);
  }

  /**
   * @internal WebGL guarantees that freshly allocated storage reads as zero (depth 1.0, stencil 0); ANGLE provides
   * this through robust resource initialization. Other drivers leave new storage undefined (Mesa leaves depth at 0,
   * so nothing passes the depth test until the application clears), so new depth/stencil storage is cleared here
   * through a scratch framebuffer. `layer` >= 0 addresses one layer of a 2D array texture.
   */
  _initDepthStencilStorage(kind: 'renderbuffer' | 'texture', id: number, internalformat: number, textarget = 0, level = 0, layer = -1): void {
    if (this._isAngle || !id) return;
    let attachment: number, mask: number;
    switch (internalformat) {
      case GL.DEPTH_COMPONENT: case GL.DEPTH_COMPONENT16: case GL.DEPTH_COMPONENT24: case GL.DEPTH_COMPONENT32F:
        attachment = GL.DEPTH_ATTACHMENT; mask = GL.DEPTH_BUFFER_BIT; break;
      case GL.DEPTH_STENCIL: case GL.DEPTH24_STENCIL8: case GL.DEPTH32F_STENCIL8:
        attachment = GL.DEPTH_STENCIL_ATTACHMENT; mask = GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT; break;
      case GL.STENCIL_INDEX8:
        attachment = GL.STENCIL_ATTACHMENT; mask = GL.STENCIL_BUFFER_BIT; break;
      default: return;
    }
    const n = this._n;
    this._flushErrors();
    if (!this._initFbo) { n.genFramebuffers(1, this._u32); this._initFbo = this._u32[0]; }
    const target = this._es3 ? GL.DRAW_FRAMEBUFFER : GL.FRAMEBUFFER;
    n.getIntegerv(this._es3 ? GL.DRAW_FRAMEBUFFER_BINDING : GL.FRAMEBUFFER_BINDING, this._i32);
    const previous = this._i32[0];
    n.bindFramebuffer(target, this._initFbo);
    const attach = (object: number) => {
      if (kind === 'renderbuffer') n.framebufferRenderbuffer(target, attachment, GL.RENDERBUFFER, object);
      else if (layer >= 0) n.framebufferTextureLayer(target, attachment, object, object ? level : 0, object ? layer : 0);
      else n.framebufferTexture2D(target, attachment, textarget, object, object ? level : 0);
    };
    attach(id);
    if (n.checkFramebufferStatus(target) === GL.FRAMEBUFFER_COMPLETE) clearFramebufferContents(n, this._es3, mask);
    attach(0);
    n.bindFramebuffer(target, previous);
    while (n.getError() !== GL.NO_ERROR) { /* errors raised while initializing are not the application's */ }
  }

  /** @internal Initializes every level (and layer) of a texture image allocated without data. */
  _initDepthStencilTexture(target: number, internalformat: number, levels: number, layers: number, level = 0): void {
    if (this._isAngle) return;
    const cubeFace = target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && target <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z;
    const binding = cubeFace ? GL.TEXTURE_BINDING_CUBE_MAP : target === GL.TEXTURE_2D_ARRAY ? GL.TEXTURE_BINDING_2D_ARRAY : target === GL.TEXTURE_2D ? GL.TEXTURE_BINDING_2D : 0;
    if (!binding) return;
    this._n.getIntegerv(binding, this._i32);
    const id = this._i32[0];
    for (let l = level; l < level + levels; l++) {
      if (layers > 0) for (let layer = 0; layer < layers; layer++) this._initDepthStencilStorage('texture', id, internalformat, target, l, layer);
      else this._initDepthStencilStorage('texture', id, internalformat, target, l);
    }
  }

  /** @internal Ownership / deletion check; throws TypeError for wrong types like a browser would. */
  _valid(obj: unknown, cls: abstract new (...args: never[]) => WebGLObject, nullable = false): boolean {
    if (obj === null || obj === undefined) {
      if (nullable) return true;
      throw new TypeError(`Failed to execute on 'WebGLRenderingContext': parameter is not of type '${cls.name}'.`);
    }
    if (!(obj instanceof cls)) throw new TypeError(`Failed to execute on 'WebGLRenderingContext': parameter is not of type '${cls.name}'.`);
    if ((obj as WebGLObject)._ctx !== this) { this._error(GL.INVALID_OPERATION); return false; }
    if ((obj as WebGLObject)._deleted) { this._error(GL.INVALID_OPERATION); return false; }
    return true;
  }

  /** @internal */
  _validLocation(loc: WebGLUniformLocation | null | undefined): boolean {
    if (loc === null || loc === undefined) return false;
    if (!(loc instanceof WebGLUniformLocation)) throw new TypeError("parameter is not of type 'WebGLUniformLocation'.");
    if (loc._program !== this._currentProgram || loc._program._linkId !== loc._linkId || loc._program._ctx !== this) {
      this._error(GL.INVALID_OPERATION);
      return false;
    }
    return true;
  }

  /** @internal */
  _getInt(pname: number): number {
    this._n.getIntegerv(pname, this._i32);
    return this._i32[0];
  }

  /** @internal requests a GL extension from ANGLE (idempotent); true when enabled. */
  _requestGL(ext: string): boolean {
    if (this._glEnabled.has(ext)) return true;
    if (!this._glRequestable.has(ext)) return false;
    this._n.requestExtensionANGLE(ext);
    this._glEnabled = new Set((this._n.getString(GLX.EXTENSIONS) ?? '').split(' ').filter(Boolean));
    return this._glEnabled.has(ext);
  }

  /** @internal */
  _glAvailable(ext: string): boolean {
    return this._glEnabled.has(ext) || this._glRequestable.has(ext);
  }

  /** @internal Is the emulated default framebuffer bound to this target? */
  _defaultBound(target: number): boolean {
    return target === READ_FRAMEBUFFER ? this._readFramebuffer === null : this._drawFramebuffer === null;
  }

  /** @internal Runs fn with the resolved (single-sample) default color buffer bound for reading. */
  _withResolvedRead<T>(fn: () => T): T {
    const db = this._drawingBuffer;
    if (!db.msFbo || this._readFramebuffer !== null) return fn();
    db.resolve();
    this._n.bindFramebuffer(READ_FRAMEBUFFER, db.fbo);
    try {
      return fn();
    } finally {
      this._n.bindFramebuffer(READ_FRAMEBUFFER, db.msFbo);
    }
  }

  /** @internal Sets tight unpack state for a converted upload; returns a restore function. */
  _tightUnpack(): () => void {
    const n = this._n;
    const u = this._unpack;
    const es3 = this._isWebGL2;
    if (u.alignment !== 1) n.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
    if (es3) {
      if (u.rowLength) n.pixelStorei(GL.UNPACK_ROW_LENGTH, 0);
      if (u.skipRows) n.pixelStorei(GL.UNPACK_SKIP_ROWS, 0);
      if (u.skipPixels) n.pixelStorei(GL.UNPACK_SKIP_PIXELS, 0);
      if (u.imageHeight) n.pixelStorei(GL.UNPACK_IMAGE_HEIGHT, 0);
      if (u.skipImages) n.pixelStorei(GL.UNPACK_SKIP_IMAGES, 0);
    }
    return () => {
      if (u.alignment !== 1) n.pixelStorei(GL.UNPACK_ALIGNMENT, u.alignment);
      if (es3) {
        if (u.rowLength) n.pixelStorei(GL.UNPACK_ROW_LENGTH, u.rowLength);
        if (u.skipRows) n.pixelStorei(GL.UNPACK_SKIP_ROWS, u.skipRows);
        if (u.skipPixels) n.pixelStorei(GL.UNPACK_SKIP_PIXELS, u.skipPixels);
        if (u.imageHeight) n.pixelStorei(GL.UNPACK_IMAGE_HEIGHT, u.imageHeight);
        if (u.skipImages) n.pixelStorei(GL.UNPACK_SKIP_IMAGES, u.skipImages);
      }
    };
  }

  /** @internal Resizes the drawing buffer (canvas.width/height changed). */
  _resize(width: number, height: number): void {
    if (!this._ready()) return;
    const db = this._drawingBuffer;
    db.allocate(width, height);
    const n = this._n;
    if (this._es3 || db.msFbo) {
      if (this._drawFramebuffer === null) n.bindFramebuffer(DRAW_FRAMEBUFFER, db.drawFbo);
      if (this._readFramebuffer === null) n.bindFramebuffer(READ_FRAMEBUFFER, db.drawFbo);
    } else if (this._drawFramebuffer === null) {
      n.bindFramebuffer(GL.FRAMEBUFFER, db.drawFbo);
    }
  }

  /** @internal Reads the drawing buffer as RGBA8, top row first. */
  _readDrawingBuffer(): { width: number; height: number; data: Uint8Array } {
    const db = this._drawingBuffer;
    const w = db.width, h = db.height;
    const data = new Uint8Array(w * h * 4);
    if (!this._ready()) return { width: w, height: h, data };
    const n = this._n;
    const p = this._pack;
    if (p.alignment !== 4) n.pixelStorei(GL.PACK_ALIGNMENT, 4);
    if (this._isWebGL2) {
      if (p.rowLength) n.pixelStorei(GL.PACK_ROW_LENGTH, 0);
      if (p.skipRows) n.pixelStorei(GL.PACK_SKIP_ROWS, 0);
      if (p.skipPixels) n.pixelStorei(GL.PACK_SKIP_PIXELS, 0);
    }
    const pbo = this._es3 ? this._getInt(GL.PIXEL_PACK_BUFFER_BINDING) : 0;
    if (pbo) n.bindBuffer(GL.PIXEL_PACK_BUFFER, 0);
    this._withResolvedRead(() => {
      if (!db.msFbo && this._readFramebuffer !== null) {
        // a user framebuffer is bound for reading: temporarily read from the default one
        n.bindFramebuffer(this._es3 ? READ_FRAMEBUFFER : GL.FRAMEBUFFER, db.fbo);
        n.readPixels(0, 0, w, h, GL.RGBA, GL.UNSIGNED_BYTE, data);
        n.bindFramebuffer(this._es3 ? READ_FRAMEBUFFER : GL.FRAMEBUFFER, this._readFramebuffer._id);
      } else {
        n.readPixels(0, 0, w, h, GL.RGBA, GL.UNSIGNED_BYTE, data);
      }
    });
    if (pbo) n.bindBuffer(GL.PIXEL_PACK_BUFFER, pbo);
    if (p.alignment !== 4) n.pixelStorei(GL.PACK_ALIGNMENT, p.alignment);
    if (this._isWebGL2) {
      if (p.rowLength) n.pixelStorei(GL.PACK_ROW_LENGTH, p.rowLength);
      if (p.skipRows) n.pixelStorei(GL.PACK_SKIP_ROWS, p.skipRows);
      if (p.skipPixels) n.pixelStorei(GL.PACK_SKIP_PIXELS, p.skipPixels);
    }
    flipRowsInPlace(data, w * 4, h);
    return { width: w, height: h, data };
  }

  /** @internal Converts any accepted image source into RGBA8 (top row first). */
  _sourceToRGBA(source: unknown): RGBA8Source | null {
    if (source === null || typeof source !== 'object') return null;
    const s = source as Record<string, unknown>;
    if (typeof s._toRGBA8 === 'function') return (s._toRGBA8 as () => RGBA8Source)();
    const w = Number(s.width), h = Number(s.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0) return null;
    const data = s.data;
    if ((data instanceof Uint8Array || data instanceof Uint8ClampedArray) && data.length >= w * h * 4) {
      return { width: w, height: h, data };
    }
    return null;
  }

  /** Releases the GL context and all its resources. The context behaves as lost afterwards. */
  destroy(): void {
    if (this._destroyed) return;
    if (this._ready()) this._drawingBuffer.destroy();
    this._n.destroyContext(this._handle);
    if (currentContext === this) currentContext = null;
    this._destroyed = true;
    this._lost = true;
    this._clearObjectMaps();
  }

  /** @internal */
  _clearObjectMaps(): void {
    for (const map of [this._buffers, this._framebuffers, this._programs, this._renderbuffers, this._shaders, this._textures,
      this._queries, this._samplers, this._syncs, this._transformFeedbacks, this._vertexArrays]) {
      for (const o of map.values()) o._deleted = true;
      map.clear();
    }
  }

  /** @internal WEBGL_lose_context.loseContext */
  _loseContext(): void {
    if (this._lost) { this._error(GL.INVALID_OPERATION); return; }
    this._lost = true;
    this._lostErrorPending = true;
    this._errors = [];
    this._restoreAllowed = false;
    this._clearObjectMaps();
    this._extensions.clear();
    const ev = new WebGLContextEvent('webglcontextlost', { cancelable: true, statusMessage: 'context lost via WEBGL_lose_context' });
    if (this._canvas?.dispatchEvent) {
      this._canvas.dispatchEvent(ev);
      this._restoreAllowed = ev.defaultPrevented;
    }
  }

  /** @internal WEBGL_lose_context.restoreContext */
  _restoreContext(): void {
    if (!this._lost || this._destroyed) { this._error(GL.INVALID_OPERATION); return; }
    if (!this._restoreAllowed) { this._error(GL.INVALID_OPERATION); return; }
    const w = this._drawingBuffer.width, h = this._drawingBuffer.height;
    this._drawingBuffer.destroy();
    this._n.destroyContext(this._handle);
    this._lost = false;
    this._lostErrorPending = false;
    this._drawFramebuffer = this._readFramebuffer = null;
    this._currentProgram = null;
    this._unpackFlipY = this._unpackPremultiplyAlpha = false;
    this._unpackColorspace = GL.BROWSER_DEFAULT_WEBGL;
    this._unpack = { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0, imageHeight: 0, skipImages: 0 };
    this._pack = { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0 };
    this._attribType.fill(0);
    this._createNativeContext(w, h);
    setTimeout(() => {
      this._canvas?.dispatchEvent?.(new WebGLContextEvent('webglcontextrestored', { statusMessage: 'context restored' }));
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // context state
  // ---------------------------------------------------------------------------

  get canvas(): CanvasLike | null {
    return this._canvas;
  }
  get drawingBufferWidth(): number {
    return this._lost ? 0 : this._drawingBuffer.width;
  }
  get drawingBufferHeight(): number {
    return this._lost ? 0 : this._drawingBuffer.height;
  }
  get drawingBufferColorSpace(): string {
    return 'srgb';
  }
  set drawingBufferColorSpace(_v: string) {}
  get unpackColorSpace(): string {
    return 'srgb';
  }
  set unpackColorSpace(_v: string) {}
  get drawingBufferFormat(): number {
    return this._drawingBuffer.colorFormat;
  }

  /** Changes the drawing buffer's sized color format (RGBA8, SRGB8_ALPHA8 or RGBA16F) and size. */
  drawingBufferStorage(sizedFormat: number, width: number, height: number): void {
    if (!this._ready()) return;
    if (!this._attrs.alpha) { this._error(GL.INVALID_OPERATION); return; }
    switch (sizedFormat) {
      case GL.RGBA8: case SRGB8_ALPHA8_EXT: break;
      case RGBA16F_EXT:
        if (!this._extensions.has('EXT_color_buffer_half_float') && !this._extensions.has('EXT_color_buffer_float')) { this._error(GL.INVALID_OPERATION); return; }
        break;
      default: this._error(GL.INVALID_ENUM); return;
    }
    if (width < 0 || height < 0) { this._error(GL.INVALID_VALUE); return; }
    if (!this._isWebGL2 && sizedFormat === SRGB8_ALPHA8_EXT) this._requestGL('GL_EXT_sRGB');
    this._drawingBuffer.colorFormat = sizedFormat;
    this._resize(width, height);
  }

  getContextAttributes(): WebGLContextAttributes | null {
    if (this._lost) return null;
    return { ...this._attrs };
  }

  isContextLost(): boolean {
    return this._lost;
  }

  makeXRCompatible(): Promise<void> {
    return Promise.resolve();
  }

  /** @internal Which GL extensions (if any) make this WebGL extension available; null when unavailable. */
  _extensionRequirements(e: ExtensionEntry): string[] | null {
    const v = this._isWebGL2 ? 2 : 1;
    if (e.version !== 0 && e.version !== v) return null;
    const ok = (gl: string[], fns?: string[]) => gl.every((g) => this._glAvailable(g)) && (fns ?? []).every((f) => hasNativeFunction(f));
    if (ok(e.gl, e.fns)) return e.gl;
    if (!this._isAngle) {
      for (const a of e.alt ?? []) {
        if (a === 'core3') { if (this._es3) return []; continue; }
        if (ok(a.gl, a.fns)) return a.gl;
      }
    }
    return null;
  }

  getSupportedExtensions(): string[] | null {
    if (this._lost) return null;
    if (!this._supportedExtensions) {
      this._supportedExtensions = EXTENSIONS.filter((e) => this._extensionRequirements(e) !== null).map((e) => e.name);
    }
    return [...this._supportedExtensions];
  }

  getExtension(name: string): any {
    if (this._lost) return null;
    const supported = this.getSupportedExtensions()!;
    const canonical = supported.find((s) => s.toLowerCase() === String(name).toLowerCase());
    if (!canonical) return null;
    let ext = this._extensions.get(canonical);
    if (ext) return ext;
    const entry = EXTENSIONS.find((e) => e.name === canonical) as ExtensionEntry;
    this._ready();
    for (const g of this._extensionRequirements(entry) ?? []) this._requestGL(g);
    for (const g of entry.optional ?? []) this._requestGL(g);
    ext = entry.create(this);
    this._extensions.set(canonical, ext);
    return ext;
  }

  getError(): number {
    if (this._lostErrorPending) {
      this._lostErrorPending = false;
      return GL.CONTEXT_LOST_WEBGL;
    }
    if (this._errors.length) return this._errors.shift()!;
    if (!this._ready()) return GL.NO_ERROR;
    return this._n.getError();
  }

  // ---------------------------------------------------------------------------
  // getParameter & friends
  // ---------------------------------------------------------------------------

  getParameter(pname: number): any {
    if (!this._ready()) return null;
    const n = this._n;
    switch (pname) {
      case GL.UNPACK_FLIP_Y_WEBGL: return this._unpackFlipY;
      case GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL: return this._unpackPremultiplyAlpha;
      case GL.UNPACK_COLORSPACE_CONVERSION_WEBGL: return this._unpackColorspace;
      case GL.VENDOR: return 'node-webgl';
      case GL.RENDERER: return `node-webgl (ANGLE ${getDisplayInfo()?.backend ?? ''})`.trim();
      case GL.VERSION: return this._isWebGL2 ? 'WebGL 2.0 (OpenGL ES 3.0 ANGLE)' : 'WebGL 1.0 (OpenGL ES 2.0 ANGLE)';
      case GL.SHADING_LANGUAGE_VERSION: return this._isWebGL2 ? 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 ANGLE)' : 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 ANGLE)';
      case GL.MAX_CLIENT_WAIT_TIMEOUT_WEBGL:
        if (!this._isWebGL2) { this._error(GL.INVALID_ENUM); return null; }
        return MAX_CLIENT_WAIT_TIMEOUT;
    }
    const kind = PARAMETER_KINDS.get(pname);
    if (!kind) { this._error(GL.INVALID_ENUM); return null; }
    // Some enums are WebGL 2 core and WebGL 1 extension pnames at the same time (MAX_DRAW_BUFFERS,
    // VERTEX_ARRAY_BINDING, ...): core needs no extension, WebGL 1 needs the extension enabled.
    const req = PNAME_EXTENSION.get(pname);
    if (this._isWebGL2) {
      if (req && !WEBGL2_ONLY_PNAMES.has(pname) && !req.some((e) => this._extensions.has(e))) { this._error(GL.INVALID_ENUM); return null; }
    } else if (req) {
      if (!req.some((e) => this._extensions.has(e))) { this._error(GL.INVALID_ENUM); return null; }
    } else if (WEBGL2_ONLY_PNAMES.has(pname)) { this._error(GL.INVALID_ENUM); return null; }
    switch (pname) {
      case EXT_PNAME.UNMASKED_VENDOR_WEBGL: return n.getString(GL.VENDOR);
      case EXT_PNAME.UNMASKED_RENDERER_WEBGL: return n.getString(GL.RENDERER);
      case EXT_PNAME.TIMESTAMP_EXT: n.getInteger64v(pname, this._i64); return Number(this._i64[0]);
    }
    switch (kind) {
      case 'bool': n.getBooleanv(pname, this._u8); return this._u8[0] !== 0;
      case 'int': n.getIntegerv(pname, this._i32); return this._i32[0];
      case 'uint': {
        n.getIntegerv(pname, this._i32);
        let v = this._i32[0] >>> 0;
        if (this._drawFramebuffer === null && (pname === GL.READ_BUFFER || pname === GL.DRAW_BUFFER0) && v === GL.COLOR_ATTACHMENT0) v = GL.BACK;
        return v;
      }
      case 'float': n.getFloatv(pname, this._f32); return this._f32[0];
      case 'int64': n.getInteger64v(pname, this._i64); return Number(this._i64[0]);
      case 'string': return n.getString(pname);
      case 'i32x2': { const out = new Int32Array(2); n.getIntegerv(pname, out); return out; }
      case 'i32x4': { const out = new Int32Array(4); n.getIntegerv(pname, out); return out; }
      case 'f32x2': { const out = new Float32Array(2); n.getFloatv(pname, out); return out; }
      case 'f32x4': { const out = new Float32Array(4); n.getFloatv(pname, out); return out; }
      case 'boolx4': n.getBooleanv(pname, this._u8); return [!!this._u8[0], !!this._u8[1], !!this._u8[2], !!this._u8[3]];
      case 'compressed': {
        const count = this._getInt(GLX.NUM_COMPRESSED_TEXTURE_FORMATS);
        const out = new Int32Array(Math.max(count, 1));
        if (count > 0) n.getIntegerv(GL.COMPRESSED_TEXTURE_FORMATS, out);
        return new Uint32Array(out.buffer, 0, count);
      }
      case 'buffer': return this._buffers.get(this._getInt(pname)) ?? null;
      case 'texture': return this._textures.get(this._getInt(pname)) ?? null;
      case 'renderbuffer': return this._renderbuffers.get(this._getInt(pname)) ?? null;
      case 'program': return this._programs.get(this._getInt(pname)) ?? null;
      case 'vao': return this._vertexArrays.get(this._getInt(pname)) ?? null;
      case 'sampler': return this._samplers.get(this._getInt(pname)) ?? null;
      case 'tf': return this._transformFeedbacks.get(this._getInt(pname)) ?? null;
      case 'framebuffer': {
        const id = this._getInt(pname);
        if (id === this._drawingBuffer.drawFbo || id === this._drawingBuffer.fbo) return null;
        return this._framebuffers.get(id) ?? null;
      }
    }
  }

  isEnabled(cap: number): boolean {
    if (!this._ready() || !this._capOk(cap)) return false;
    return this._n.isEnabled(cap);
  }

  getBufferParameter(target: number, pname: number): any {
    if (!this._ready()) return null;
    if (pname !== GL.BUFFER_SIZE && pname !== GL.BUFFER_USAGE) { this._error(GL.INVALID_ENUM); return null; }
    this._n.getBufferParameteriv(target, pname, this._i32);
    return pname === GL.BUFFER_USAGE ? this._i32[0] >>> 0 : this._i32[0];
  }

  getRenderbufferParameter(target: number, pname: number): any {
    if (!this._ready()) return null;
    this._n.getRenderbufferParameteriv(target, pname, this._i32);
    if (pname === GL.RENDERBUFFER_INTERNAL_FORMAT) {
      const f = this._i32[0] >>> 0;
      return !this._isWebGL2 && f === DEPTH24_STENCIL8 ? GL.DEPTH_STENCIL : f;
    }
    return this._i32[0];
  }

  getTexParameter(target: number, pname: number): any {
    if (!this._ready()) return null;
    const n = this._n;
    switch (pname) {
      case TEXTURE_MAX_ANISOTROPY_EXT: case GL.TEXTURE_MAX_LOD: case GL.TEXTURE_MIN_LOD:
        n.getTexParameterfv(target, pname, this._f32); return this._f32[0];
      case TEXTURE_IMMUTABLE_FORMAT:
        n.getTexParameteriv(target, pname, this._i32); return this._i32[0] !== 0;
      case TEXTURE_IMMUTABLE_LEVELS: case GL.TEXTURE_BASE_LEVEL: case GL.TEXTURE_MAX_LEVEL:
        n.getTexParameteriv(target, pname, this._i32); return this._i32[0];
      default:
        n.getTexParameteriv(target, pname, this._i32); return this._i32[0] >>> 0;
    }
  }

  getFramebufferAttachmentParameter(target: number, attachment: number, pname: number): any {
    if (!this._ready()) return null;
    const n = this._n;
    if (this._defaultBound(target)) {
      if (!this._isWebGL2) { this._error(GL.INVALID_OPERATION); return null; }
      const db = this._drawingBuffer;
      let glAttachment: number;
      let present: boolean;
      switch (attachment) {
        case GL.BACK: glAttachment = GL.COLOR_ATTACHMENT0; present = true; break;
        case GL.DEPTH: glAttachment = GL.DEPTH_ATTACHMENT; present = db.depth || db.stencil; break;
        case GL.STENCIL: glAttachment = GL.STENCIL_ATTACHMENT; present = db.stencil; break;
        default: this._error(GL.INVALID_ENUM); return null;
      }
      if (pname === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) return present ? FRAMEBUFFER_DEFAULT : GL.NONE;
      if (!present) { this._error(GL.INVALID_OPERATION); return null; }
      switch (pname) {
        case GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: case GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:
        case GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: case GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER:
          this._error(GL.INVALID_ENUM); return null;
      }
      n.getFramebufferAttachmentParameteriv(target, glAttachment, pname, this._i32);
      return (pname === GL.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE || pname === GL.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING) ? this._i32[0] >>> 0 : this._i32[0];
    }
    if (pname === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) {
      n.getFramebufferAttachmentParameteriv(target, attachment, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, this._i32);
      const type = this._i32[0];
      n.getFramebufferAttachmentParameteriv(target, attachment, pname, this._i32);
      const id = this._i32[0];
      if (type === GL.TEXTURE) return this._textures.get(id) ?? null;
      if (type === GL.RENDERBUFFER) return this._renderbuffers.get(id) ?? null;
      return null;
    }
    n.getFramebufferAttachmentParameteriv(target, attachment, pname, this._i32);
    switch (pname) {
      case GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: case GL.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE:
      case GL.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING: case GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE:
        return this._i32[0] >>> 0;
      default:
        return this._i32[0];
    }
  }

  getProgramParameter(program: WebGLProgram, pname: number): any {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    switch (pname) {
      case GL.DELETE_STATUS: case GL.LINK_STATUS: case GL.VALIDATE_STATUS:
        this._n.getProgramiv(program._id, pname, this._i32); return this._i32[0] !== 0;
      case COMPLETION_STATUS_KHR:
        if (!this._extensions.has('KHR_parallel_shader_compile')) { this._error(GL.INVALID_ENUM); return null; }
        this._n.getProgramiv(program._id, pname, this._i32); return this._i32[0] !== 0;
      case GL.ATTACHED_SHADERS: case GL.ACTIVE_ATTRIBUTES: case GL.ACTIVE_UNIFORMS:
        this._n.getProgramiv(program._id, pname, this._i32); return this._i32[0];
      case GL.TRANSFORM_FEEDBACK_VARYINGS: case GL.ACTIVE_UNIFORM_BLOCKS:
        if (!this._isWebGL2) break;
        this._n.getProgramiv(program._id, pname, this._i32); return this._i32[0];
      case GL.TRANSFORM_FEEDBACK_BUFFER_MODE:
        if (!this._isWebGL2) break;
        this._n.getProgramiv(program._id, pname, this._i32); return this._i32[0] >>> 0;
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }

  getShaderParameter(shader: WebGLShader, pname: number): any {
    if (!this._ready() || !this._valid(shader, WebGLShader)) return null;
    switch (pname) {
      case GL.SHADER_TYPE: this._n.getShaderiv(shader._id, pname, this._i32); return this._i32[0] >>> 0;
      case GL.DELETE_STATUS: case GL.COMPILE_STATUS:
        this._n.getShaderiv(shader._id, pname, this._i32); return this._i32[0] !== 0;
      case COMPLETION_STATUS_KHR:
        if (!this._extensions.has('KHR_parallel_shader_compile')) break;
        this._n.getShaderiv(shader._id, pname, this._i32); return this._i32[0] !== 0;
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }

  getShaderPrecisionFormat(shadertype: number, precisiontype: number): WebGLShaderPrecisionFormat | null {
    if (!this._ready()) return null;
    const range = new Int32Array(2);
    const precision = new Int32Array(1);
    this._n.getShaderPrecisionFormat(shadertype, precisiontype, range, precision);
    return new WebGLShaderPrecisionFormat(range[0], range[1], precision[0]);
  }

  getShaderInfoLog(shader: WebGLShader): string | null {
    if (!this._ready() || !this._valid(shader, WebGLShader)) return null;
    this._n.getShaderiv(shader._id, GLX.INFO_LOG_LENGTH, this._i32);
    const len = this._i32[0];
    if (len <= 0) return '';
    const buf = new Uint8Array(len);
    this._n.getShaderInfoLog(shader._id, len, this._i32, buf);
    return utf8.decode(buf.subarray(0, this._i32[0]));
  }

  getProgramInfoLog(program: WebGLProgram): string | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    this._n.getProgramiv(program._id, GLX.INFO_LOG_LENGTH, this._i32);
    const len = this._i32[0];
    if (len <= 0) return '';
    const buf = new Uint8Array(len);
    this._n.getProgramInfoLog(program._id, len, this._i32, buf);
    return utf8.decode(buf.subarray(0, this._i32[0]));
  }

  getShaderSource(shader: WebGLShader): string | null {
    if (!this._ready() || !this._valid(shader, WebGLShader)) return null;
    return shader._source;
  }

  getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    const ids = new Uint32Array(2);
    this._n.getAttachedShaders(program._id, 2, this._i32, ids);
    const out: WebGLShader[] = [];
    for (let i = 0; i < this._i32[0]; i++) {
      const s = this._shaders.get(ids[i]);
      if (s) out.push(s);
    }
    return out;
  }

  getActiveAttrib(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    return this._activeInfo(program, index, false);
  }

  getActiveUniform(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    return this._activeInfo(program, index, true);
  }

  private _activeInfo(program: WebGLProgram, index: number, uniform: boolean): WebGLActiveInfo | null {
    const n = this._n;
    n.getProgramiv(program._id, uniform ? GLX.ACTIVE_UNIFORM_MAX_LENGTH : GLX.ACTIVE_ATTRIBUTE_MAX_LENGTH, this._i32);
    const bufSize = Math.max(this._i32[0], 1);
    const name = new Uint8Array(bufSize);
    const len = new Int32Array(1), size = new Int32Array(1), type = new Uint32Array(1);
    this._flushErrors(); // an error left behind by an earlier call must not be mistaken for a failure of this one
    if (uniform) n.getActiveUniform(program._id, index, bufSize, len, size, type, name);
    else n.getActiveAttrib(program._id, index, bufSize, len, size, type, name);
    const err = n.getError();
    if (err !== GL.NO_ERROR) { this._error(err); return null; }
    return new WebGLActiveInfo(size[0], type[0], utf8.decode(name.subarray(0, len[0])));
  }

  getAttribLocation(program: WebGLProgram, name: string): number {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return -1;
    if (/^_?webgl_/.test(name)) return -1;
    return this._n.getAttribLocation(program._id, name);
  }

  /** @internal */
  _uniformTable(program: WebGLProgram): UniformInfo[] {
    if (program._uniforms) return program._uniforms;
    const n = this._n;
    n.getProgramiv(program._id, GL.ACTIVE_UNIFORMS, this._i32);
    const count = this._i32[0];
    n.getProgramiv(program._id, GLX.ACTIVE_UNIFORM_MAX_LENGTH, this._i32);
    const bufSize = Math.max(this._i32[0], 1);
    const nameBuf = new Uint8Array(bufSize);
    const len = new Int32Array(1), size = new Int32Array(1), type = new Uint32Array(1);
    const table: UniformInfo[] = [];
    for (let i = 0; i < count; i++) {
      n.getActiveUniform(program._id, i, bufSize, len, size, type, nameBuf);
      let name = utf8.decode(nameBuf.subarray(0, len[0]));
      if (name.endsWith('[0]')) name = name.slice(0, -3);
      const location = n.getUniformLocation(program._id, name);
      table.push({ name, type: type[0], size: size[0], location });
    }
    program._uniforms = table;
    return table;
  }

  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    name = String(name);
    if (/^_?webgl_/.test(name)) return null;
    const loc = this._n.getUniformLocation(program._id, name);
    if (loc < 0) return null;
    const table = this._uniformTable(program);
    const m = /^(.*)\[(\d+)\]$/.exec(name);
    const base = m ? m[1] : name;
    const info = table.find((u) => u.name === base) ?? null;
    return new WebGLUniformLocation(program, loc, info, m ? Number(m[2]) : 0);
  }

  getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    if (!(location instanceof WebGLUniformLocation)) throw new TypeError("parameter 2 is not of type 'WebGLUniformLocation'.");
    if (location._program !== program || location._linkId !== program._linkId) { this._error(GL.INVALID_OPERATION); return null; }
    const info = location._info;
    const t = info ? UNIFORM_TYPE_INFO[info.type] : undefined;
    if (!t) { this._error(GL.INVALID_OPERATION); return null; }
    const n = this._n;
    if (t.base === 'f') {
      const out = new Float32Array(t.count);
      n.getUniformfv(program._id, location._location, out);
      return t.count === 1 ? out[0] : out;
    }
    if (t.base === 'u') {
      const out = new Uint32Array(t.count);
      n.getUniformuiv(program._id, location._location, out);
      return t.count === 1 ? out[0] : out;
    }
    const out = new Int32Array(t.count);
    n.getUniformiv(program._id, location._location, out);
    if (t.base === 'b') return t.count === 1 ? out[0] !== 0 : Array.from(out, (v) => v !== 0);
    return t.count === 1 ? out[0] : out;
  }

  getVertexAttrib(index: number, pname: number): any {
    if (!this._ready()) return null;
    const n = this._n;
    switch (pname) {
      case GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
        n.getVertexAttribiv(index, pname, this._i32);
        return this._buffers.get(this._i32[0]) ?? null;
      case GL.CURRENT_VERTEX_ATTRIB: {
        const kind = index < this._attribType.length ? this._attribType[index] : 0;
        if (kind === 1) { const out = new Int32Array(4); n.getVertexAttribIiv(index, pname, out); return out; }
        if (kind === 2) { const out = new Uint32Array(4); n.getVertexAttribIuiv(index, pname, out); return out; }
        const out = new Float32Array(4);
        n.getVertexAttribfv(index, pname, out);
        return out;
      }
      case GL.VERTEX_ATTRIB_ARRAY_ENABLED: case GL.VERTEX_ATTRIB_ARRAY_NORMALIZED: case GL.VERTEX_ATTRIB_ARRAY_INTEGER:
        if (pname === GL.VERTEX_ATTRIB_ARRAY_INTEGER && !this._isWebGL2) break;
        n.getVertexAttribiv(index, pname, this._i32); return this._i32[0] !== 0;
      case GL.VERTEX_ATTRIB_ARRAY_SIZE: case GL.VERTEX_ATTRIB_ARRAY_STRIDE:
        n.getVertexAttribiv(index, pname, this._i32); return this._i32[0];
      case GL.VERTEX_ATTRIB_ARRAY_DIVISOR:
        if (!this._isWebGL2 && !this._extensions.has('ANGLE_instanced_arrays')) break;
        n.getVertexAttribiv(index, pname, this._i32); return this._i32[0];
      case GL.VERTEX_ATTRIB_ARRAY_TYPE:
        n.getVertexAttribiv(index, pname, this._i32); return this._i32[0] >>> 0;
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }

  getVertexAttribOffset(index: number, pname: number): number {
    if (!this._ready()) return 0;
    this._i64[0] = 0n;
    this._n.getVertexAttribPointerv(index, pname, this._i64);
    return Number(this._i64[0]);
  }

  // ---------------------------------------------------------------------------
  // state setters (thin passthroughs)
  // ---------------------------------------------------------------------------

  activeTexture(texture: number): void { if (this._ready()) this._n.activeTexture(texture); }
  blendColor(r: number, g: number, b: number, a: number): void { if (this._ready()) this._n.blendColor(r, g, b, a); }
  blendEquation(mode: number): void { if (this._ready()) this._n.blendEquation(mode); }
  blendEquationSeparate(modeRGB: number, modeAlpha: number): void { if (this._ready()) this._n.blendEquationSeparate(modeRGB, modeAlpha); }
  blendFunc(sfactor: number, dfactor: number): void { if (this._ready()) this._n.blendFunc(sfactor, dfactor); }
  blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void { if (this._ready()) this._n.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha); }
  clear(mask: number): void { if (this._ready()) this._n.clear(mask); }
  clearColor(r: number, g: number, b: number, a: number): void { if (this._ready()) this._n.clearColor(r, g, b, a); }
  clearDepth(depth: number): void { if (this._ready()) this._n.clearDepthf(depth); }
  clearStencil(s: number): void { if (this._ready()) this._n.clearStencil(s); }
  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void { if (this._ready()) this._n.colorMask(r, g, b, a); }
  cullFace(mode: number): void { if (this._ready()) this._n.cullFace(mode); }
  depthFunc(func: number): void { if (this._ready()) this._n.depthFunc(func); }
  depthMask(flag: boolean): void { if (this._ready()) this._n.depthMask(flag); }
  depthRange(zNear: number, zFar: number): void { if (this._ready()) this._n.depthRangef(zNear, zFar); }
  disable(cap: number): void { if (this._ready() && this._capOk(cap)) this._n.disable(cap); }
  enable(cap: number): void { if (this._ready() && this._capOk(cap)) this._n.enable(cap); }
  /** @internal WebGL 1 must reject WebGL 2-only capabilities even when the driver context is ES 3. */
  _capOk(cap: number): boolean {
    if (!this._isWebGL2 && cap === GL.RASTERIZER_DISCARD) { this._error(GL.INVALID_ENUM); return false; }
    return true;
  }
  finish(): void { if (this._ready()) this._n.finish(); }
  flush(): void { if (this._ready()) this._n.flush(); }
  frontFace(mode: number): void { if (this._ready()) this._n.frontFace(mode); }
  hint(target: number, mode: number): void { if (this._ready()) this._n.hint(target, mode); }
  lineWidth(width: number): void { if (this._ready()) this._n.lineWidth(width); }
  polygonOffset(factor: number, units: number): void { if (this._ready()) this._n.polygonOffset(factor, units); }
  sampleCoverage(value: number, invert: boolean): void { if (this._ready()) this._n.sampleCoverage(value, invert); }
  scissor(x: number, y: number, w: number, h: number): void { if (this._ready()) this._n.scissor(x, y, w, h); }
  stencilFunc(func: number, ref: number, mask: number): void { if (this._ready()) this._n.stencilFunc(func, ref, mask); }
  stencilFuncSeparate(face: number, func: number, ref: number, mask: number): void { if (this._ready()) this._n.stencilFuncSeparate(face, func, ref, mask); }
  stencilMask(mask: number): void { if (this._ready()) this._n.stencilMask(mask); }
  stencilMaskSeparate(face: number, mask: number): void { if (this._ready()) this._n.stencilMaskSeparate(face, mask); }
  stencilOp(fail: number, zfail: number, zpass: number): void { if (this._ready()) this._n.stencilOp(fail, zfail, zpass); }
  stencilOpSeparate(face: number, fail: number, zfail: number, zpass: number): void { if (this._ready()) this._n.stencilOpSeparate(face, fail, zfail, zpass); }
  viewport(x: number, y: number, w: number, h: number): void { if (this._ready()) this._n.viewport(x, y, w, h); }

  pixelStorei(pname: number, param: number | boolean): void {
    if (!this._ready()) return;
    const v = Number(param);
    switch (pname) {
      case GL.UNPACK_FLIP_Y_WEBGL: this._unpackFlipY = !!param; return;
      case GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL: this._unpackPremultiplyAlpha = !!param; return;
      case GL.UNPACK_COLORSPACE_CONVERSION_WEBGL:
        if (v === GL.BROWSER_DEFAULT_WEBGL || v === GL.NONE) this._unpackColorspace = v;
        else this._error(GL.INVALID_VALUE);
        return;
      case GL.UNPACK_ALIGNMENT: case GL.PACK_ALIGNMENT:
        if (v !== 1 && v !== 2 && v !== 4 && v !== 8) { this._error(GL.INVALID_VALUE); return; }
        if (pname === GL.UNPACK_ALIGNMENT) this._unpack.alignment = v; else this._pack.alignment = v;
        this._n.pixelStorei(pname, v);
        return;
    }
    if (!this._isWebGL2) { this._error(GL.INVALID_ENUM); return; }
    if (v < 0) { this._error(GL.INVALID_VALUE); return; }
    switch (pname) {
      case GL.UNPACK_ROW_LENGTH: this._unpack.rowLength = v; break;
      case GL.UNPACK_SKIP_ROWS: this._unpack.skipRows = v; break;
      case GL.UNPACK_SKIP_PIXELS: this._unpack.skipPixels = v; break;
      case GL.UNPACK_IMAGE_HEIGHT: this._unpack.imageHeight = v; break;
      case GL.UNPACK_SKIP_IMAGES: this._unpack.skipImages = v; break;
      case GL.PACK_ROW_LENGTH: this._pack.rowLength = v; break;
      case GL.PACK_SKIP_ROWS: this._pack.skipRows = v; break;
      case GL.PACK_SKIP_PIXELS: this._pack.skipPixels = v; break;
      default: this._error(GL.INVALID_ENUM); return;
    }
    this._n.pixelStorei(pname, v);
  }

  // ---------------------------------------------------------------------------
  // buffers
  // ---------------------------------------------------------------------------

  createBuffer(): WebGLBuffer | null {
    if (!this._ready()) return null;
    this._n.genBuffers(1, this._u32);
    const b = new WebGLBuffer(this, this._u32[0]);
    this._buffers.set(b._id, b);
    return b;
  }

  deleteBuffer(buffer: WebGLBuffer | null): void {
    if (!this._ready() || !this._deletable(buffer, WebGLBuffer)) return;
    this._buffers.delete(buffer!._id);
    this._u32[0] = buffer!._id;
    this._n.deleteBuffers(1, this._u32);
  }

  /** @internal common delete validation; true when GL deletion should proceed. */
  _deletable(obj: WebGLObject | null | undefined, cls: abstract new (...args: never[]) => WebGLObject): boolean {
    if (obj === null || obj === undefined) return false;
    if (!(obj instanceof cls)) throw new TypeError(`parameter is not of type '${cls.name}'.`);
    if (obj._ctx !== this) { this._error(GL.INVALID_OPERATION); return false; }
    if (obj._deleted) return false;
    obj._deleted = true;
    return true;
  }

  isBuffer(buffer: unknown): boolean {
    if (!this._ready() || !(buffer instanceof WebGLBuffer) || buffer._ctx !== this || buffer._deleted) return false;
    return this._n.isBuffer(buffer._id);
  }

  bindBuffer(target: number, buffer: WebGLBuffer | null): void {
    if (!this._ready() || !this._valid(buffer, WebGLBuffer, true)) return;
    this._n.bindBuffer(target, buffer ? buffer._id : 0);
  }

  bufferData(target: number, sizeOrData: number | ArrayBuffer | ArrayBufferView | null, usage: number, srcOffset?: number, length?: number): void {
    if (!this._ready()) return;
    const n = this._n;
    if (typeof sizeOrData === 'number') { n.bufferData(target, sizeOrData, null, usage); return; }
    if (sizeOrData === null || sizeOrData === undefined) { n.bufferData(target, 0, null, usage); return; }
    if (sizeOrData instanceof ArrayBuffer) { n.bufferData(target, sizeOrData.byteLength, sizeOrData, usage); return; }
    if (!isView(sizeOrData)) throw new TypeError('bufferData: data must be an ArrayBuffer, ArrayBufferView, size or null');
    if (srcOffset !== undefined) {
      if (!this._isWebGL2) throw new TypeError('bufferData: srcOffset/length overload requires WebGL 2');
      const bpe = (sizeOrData as TypedArray).BYTES_PER_ELEMENT ?? 1;
      const elems = sizeOrData.byteLength / bpe;
      const len = length === undefined || length === 0 ? elems - srcOffset : length;
      if (srcOffset < 0 || len < 0 || srcOffset + len > elems) { this._error(GL.INVALID_VALUE); return; }
      const view = bytesOf(sizeOrData, srcOffset).subarray(0, len * bpe);
      n.bufferData(target, view.byteLength, view, usage);
      return;
    }
    n.bufferData(target, sizeOrData.byteLength, sizeOrData, usage);
  }

  bufferSubData(target: number, dstByteOffset: number, data: ArrayBuffer | ArrayBufferView, srcOffset?: number, length?: number): void {
    if (!this._ready()) return;
    const n = this._n;
    if (data instanceof ArrayBuffer) { n.bufferSubData(target, dstByteOffset, data.byteLength, data); return; }
    if (!isView(data)) throw new TypeError('bufferSubData: data must be an ArrayBuffer or ArrayBufferView');
    if (srcOffset !== undefined) {
      if (!this._isWebGL2) throw new TypeError('bufferSubData: srcOffset/length overload requires WebGL 2');
      const bpe = (data as TypedArray).BYTES_PER_ELEMENT ?? 1;
      const elems = data.byteLength / bpe;
      const len = length === undefined || length === 0 ? elems - srcOffset : length;
      if (srcOffset < 0 || len < 0 || srcOffset + len > elems) { this._error(GL.INVALID_VALUE); return; }
      const view = bytesOf(data, srcOffset).subarray(0, len * bpe);
      n.bufferSubData(target, dstByteOffset, view.byteLength, view);
      return;
    }
    n.bufferSubData(target, dstByteOffset, data.byteLength, data);
  }

  // ---------------------------------------------------------------------------
  // framebuffers & renderbuffers
  // ---------------------------------------------------------------------------

  createFramebuffer(): WebGLFramebuffer | null {
    if (!this._ready()) return null;
    this._n.genFramebuffers(1, this._u32);
    const f = new WebGLFramebuffer(this, this._u32[0]);
    this._framebuffers.set(f._id, f);
    return f;
  }

  deleteFramebuffer(fb: WebGLFramebuffer | null): void {
    if (!this._ready() || !this._deletable(fb, WebGLFramebuffer)) return;
    this._framebuffers.delete(fb!._id);
    this._u32[0] = fb!._id;
    this._n.deleteFramebuffers(1, this._u32);
    // GL rebinds 0 for deleted bound framebuffers; WebGL means "the default framebuffer".
    const db = this._drawingBuffer;
    if (this._drawFramebuffer === fb) { this._drawFramebuffer = null; this._n.bindFramebuffer(this._es3 || db.msFbo ? DRAW_FRAMEBUFFER : GL.FRAMEBUFFER, db.drawFbo); }
    if (this._readFramebuffer === fb) { this._readFramebuffer = null; if (this._es3 || db.msFbo) this._n.bindFramebuffer(READ_FRAMEBUFFER, db.drawFbo); }
  }

  isFramebuffer(fb: unknown): boolean {
    if (!this._ready() || !(fb instanceof WebGLFramebuffer) || fb._ctx !== this || fb._deleted) return false;
    return this._n.isFramebuffer(fb._id);
  }

  bindFramebuffer(target: number, fb: WebGLFramebuffer | null): void {
    if (!this._ready() || !this._valid(fb, WebGLFramebuffer, true)) return;
    if (target !== GL.FRAMEBUFFER && (!this._isWebGL2 || (target !== DRAW_FRAMEBUFFER && target !== READ_FRAMEBUFFER))) { this._error(GL.INVALID_ENUM); return; }
    const id = fb ? fb._id : this._drawingBuffer.drawFbo;
    this._n.bindFramebuffer(target, id);
    if (target !== READ_FRAMEBUFFER) this._drawFramebuffer = fb;
    if (target !== DRAW_FRAMEBUFFER) this._readFramebuffer = fb;
  }

  checkFramebufferStatus(target: number): number {
    if (!this._ready()) return 0;
    return this._n.checkFramebufferStatus(target);
  }

  framebufferRenderbuffer(target: number, attachment: number, rbTarget: number, rb: WebGLRenderbuffer | null): void {
    if (!this._ready() || !this._valid(rb, WebGLRenderbuffer, true)) return;
    if (this._defaultBound(target)) { this._error(GL.INVALID_OPERATION); return; }
    this._n.framebufferRenderbuffer(target, attachment, rbTarget, rb ? rb._id : 0);
  }

  framebufferTexture2D(target: number, attachment: number, textarget: number, texture: WebGLTexture | null, level: number): void {
    if (!this._ready() || !this._valid(texture, WebGLTexture, true)) return;
    if (this._defaultBound(target)) { this._error(GL.INVALID_OPERATION); return; }
    this._n.framebufferTexture2D(target, attachment, textarget, texture ? texture._id : 0, level);
  }

  createRenderbuffer(): WebGLRenderbuffer | null {
    if (!this._ready()) return null;
    this._n.genRenderbuffers(1, this._u32);
    const r = new WebGLRenderbuffer(this, this._u32[0]);
    this._renderbuffers.set(r._id, r);
    return r;
  }

  deleteRenderbuffer(rb: WebGLRenderbuffer | null): void {
    if (!this._ready() || !this._deletable(rb, WebGLRenderbuffer)) return;
    this._renderbuffers.delete(rb!._id);
    this._u32[0] = rb!._id;
    this._n.deleteRenderbuffers(1, this._u32);
  }

  isRenderbuffer(rb: unknown): boolean {
    if (!this._ready() || !(rb instanceof WebGLRenderbuffer) || rb._ctx !== this || rb._deleted) return false;
    return this._n.isRenderbuffer(rb._id);
  }

  bindRenderbuffer(target: number, rb: WebGLRenderbuffer | null): void {
    if (!this._ready() || !this._valid(rb, WebGLRenderbuffer, true)) return;
    this._n.bindRenderbuffer(target, rb ? rb._id : 0);
  }

  renderbufferStorage(target: number, internalformat: number, width: number, height: number): void {
    if (!this._ready()) return;
    if (!this._isWebGL2) {
      switch (internalformat) {
        case GL.RGBA4: case GL.RGB565: case GL.RGB5_A1: case GL.DEPTH_COMPONENT16: case GL.STENCIL_INDEX8: break;
        case GL.DEPTH_STENCIL: internalformat = DEPTH24_STENCIL8; break;
        case SRGB8_ALPHA8_EXT: if (this._extensions.has('EXT_sRGB')) break; this._error(GL.INVALID_ENUM); return;
        case RGBA32F_EXT: case RGB32F_EXT: if (this._extensions.has('WEBGL_color_buffer_float')) break; this._error(GL.INVALID_ENUM); return;
        case RGBA16F_EXT: case RGB16F_EXT: if (this._extensions.has('EXT_color_buffer_half_float')) break; this._error(GL.INVALID_ENUM); return;
        default: this._error(GL.INVALID_ENUM); return;
      }
    }
    this._n.renderbufferStorage(target, internalformat, width, height);
    if (!this._isAngle) { this._n.getIntegerv(GL.RENDERBUFFER_BINDING, this._i32); this._initDepthStencilStorage('renderbuffer', this._i32[0], internalformat); }
  }

  // ---------------------------------------------------------------------------
  // shaders & programs
  // ---------------------------------------------------------------------------

  createShader(type: number): WebGLShader | null {
    if (!this._ready()) return null;
    if (type !== GL.VERTEX_SHADER && type !== GL.FRAGMENT_SHADER) { this._error(GL.INVALID_ENUM); return null; }
    const id = this._n.createShader(type);
    if (!id) return null;
    const s = new WebGLShader(this, id, type);
    this._shaders.set(id, s);
    return s;
  }

  deleteShader(shader: WebGLShader | null): void {
    if (!this._ready() || !this._deletable(shader, WebGLShader)) return;
    this._shaders.delete(shader!._id);
    this._n.deleteShader(shader!._id);
  }

  isShader(shader: unknown): boolean {
    if (!this._ready() || !(shader instanceof WebGLShader) || shader._ctx !== this || shader._deleted) return false;
    return this._n.isShader(shader._id);
  }

  shaderSource(shader: WebGLShader, source: string): void {
    if (!this._ready() || !this._valid(shader, WebGLShader)) return;
    source = String(source);
    shader._source = source;
    // Extensions WebGL names after ANGLE keep their EXT spelling on other drivers.
    if (!this._isAngle) source = source.replace(/#extension\s+GL_ANGLE_clip_cull_distance\b/g, '#extension GL_EXT_clip_cull_distance');
    this._n.shaderSource(shader._id, 1, [source], null);
  }

  compileShader(shader: WebGLShader): void {
    if (!this._ready() || !this._valid(shader, WebGLShader)) return;
    this._n.compileShader(shader._id);
  }

  createProgram(): WebGLProgram | null {
    if (!this._ready()) return null;
    const id = this._n.createProgram();
    if (!id) return null;
    const p = new WebGLProgram(this, id);
    this._programs.set(id, p);
    return p;
  }

  deleteProgram(program: WebGLProgram | null): void {
    if (!this._ready() || !this._deletable(program, WebGLProgram)) return;
    this._programs.delete(program!._id);
    this._n.deleteProgram(program!._id);
  }

  isProgram(program: unknown): boolean {
    if (!this._ready() || !(program instanceof WebGLProgram) || program._ctx !== this || program._deleted) return false;
    return this._n.isProgram(program._id);
  }

  attachShader(program: WebGLProgram, shader: WebGLShader): void {
    if (!this._ready() || !this._valid(program, WebGLProgram) || !this._valid(shader, WebGLShader)) return;
    this._n.attachShader(program._id, shader._id);
  }

  detachShader(program: WebGLProgram, shader: WebGLShader): void {
    if (!this._ready() || !this._valid(program, WebGLProgram) || !this._valid(shader, WebGLShader)) return;
    this._n.detachShader(program._id, shader._id);
  }

  bindAttribLocation(program: WebGLProgram, index: number, name: string): void {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return;
    this._n.bindAttribLocation(program._id, index, String(name));
  }

  linkProgram(program: WebGLProgram): void {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return;
    this._n.linkProgram(program._id);
    program._linkId++;
    program._uniforms = null;
  }

  useProgram(program: WebGLProgram | null): void {
    if (!this._ready() || !this._valid(program, WebGLProgram, true)) return;
    this._n.useProgram(program ? program._id : 0);
    this._currentProgram = program;
  }

  validateProgram(program: WebGLProgram): void {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return;
    this._n.validateProgram(program._id);
  }

  // ---------------------------------------------------------------------------
  // uniforms
  // ---------------------------------------------------------------------------

  /** @internal */
  _uniformVec(loc: WebGLUniformLocation | null, data: Float32Array | Int32Array | Uint32Array, comps: number, srcOffset: number | undefined, srcLength: number | undefined,
    fn: (location: number, count: number, v: ArrayBufferView) => void): void {
    if (!this._ready() || !this._validLocation(loc)) return;
    let v = data;
    if (srcOffset !== undefined || srcLength !== undefined) {
      const off = srcOffset ?? 0;
      const len = srcLength === undefined || srcLength === 0 ? v.length - off : srcLength;
      if (off < 0 || len < 0 || off + len > v.length) { this._error(GL.INVALID_VALUE); return; }
      v = v.subarray(off, off + len) as typeof v;
    }
    if (v.length % comps !== 0 || v.length === 0) { this._error(GL.INVALID_VALUE); return; }
    fn(loc!._location, v.length / comps, v);
  }

  uniform1f(loc: WebGLUniformLocation | null, x: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform1f(loc!._location, x); }
  uniform2f(loc: WebGLUniformLocation | null, x: number, y: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform2f(loc!._location, x, y); }
  uniform3f(loc: WebGLUniformLocation | null, x: number, y: number, z: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform3f(loc!._location, x, y, z); }
  uniform4f(loc: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform4f(loc!._location, x, y, z, w); }
  uniform1i(loc: WebGLUniformLocation | null, x: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform1i(loc!._location, x); }
  uniform2i(loc: WebGLUniformLocation | null, x: number, y: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform2i(loc!._location, x, y); }
  uniform3i(loc: WebGLUniformLocation | null, x: number, y: number, z: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform3i(loc!._location, x, y, z); }
  uniform4i(loc: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform4i(loc!._location, x, y, z, w); }

  uniform1fv(loc: WebGLUniformLocation | null, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 1, srcOffset, srcLength, (l, c, d) => this._n.uniform1fv(l, c, d)); }
  uniform2fv(loc: WebGLUniformLocation | null, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 2, srcOffset, srcLength, (l, c, d) => this._n.uniform2fv(l, c, d)); }
  uniform3fv(loc: WebGLUniformLocation | null, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 3, srcOffset, srcLength, (l, c, d) => this._n.uniform3fv(l, c, d)); }
  uniform4fv(loc: WebGLUniformLocation | null, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 4, srcOffset, srcLength, (l, c, d) => this._n.uniform4fv(l, c, d)); }
  uniform1iv(loc: WebGLUniformLocation | null, v: Int32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toI32(v), 1, srcOffset, srcLength, (l, c, d) => this._n.uniform1iv(l, c, d)); }
  uniform2iv(loc: WebGLUniformLocation | null, v: Int32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toI32(v), 2, srcOffset, srcLength, (l, c, d) => this._n.uniform2iv(l, c, d)); }
  uniform3iv(loc: WebGLUniformLocation | null, v: Int32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toI32(v), 3, srcOffset, srcLength, (l, c, d) => this._n.uniform3iv(l, c, d)); }
  uniform4iv(loc: WebGLUniformLocation | null, v: Int32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toI32(v), 4, srcOffset, srcLength, (l, c, d) => this._n.uniform4iv(l, c, d)); }

  /** @internal WebGL 1 only accepts transpose = false (ES 2.0 rule, enforced here for non-ANGLE drivers too). */
  _transposeOk(transpose: boolean): boolean {
    if (!this._isWebGL2 && transpose) { this._error(GL.INVALID_VALUE); return false; }
    return true;
  }
  uniformMatrix2fv(loc: WebGLUniformLocation | null, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { if (this._transposeOk(transpose)) this._uniformVec(loc, toF32(v), 4, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix2fv(l, c, transpose, d)); }
  uniformMatrix3fv(loc: WebGLUniformLocation | null, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { if (this._transposeOk(transpose)) this._uniformVec(loc, toF32(v), 9, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix3fv(l, c, transpose, d)); }
  uniformMatrix4fv(loc: WebGLUniformLocation | null, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { if (this._transposeOk(transpose)) this._uniformVec(loc, toF32(v), 16, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix4fv(l, c, transpose, d)); }

  // ---------------------------------------------------------------------------
  // vertex attributes & drawing
  // ---------------------------------------------------------------------------

  enableVertexAttribArray(index: number): void { if (this._ready()) this._n.enableVertexAttribArray(index); }
  disableVertexAttribArray(index: number): void { if (this._ready()) this._n.disableVertexAttribArray(index); }

  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    if (!this._ready()) return;
    this._n.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }

  /** @internal */
  _setAttribType(index: number, kind: number): void {
    if (index >= 0 && index < this._attribType.length) this._attribType[index] = kind;
  }
  vertexAttrib1f(i: number, x: number): void { if (this._ready()) { this._n.vertexAttrib1f(i, x); this._setAttribType(i, 0); } }
  vertexAttrib2f(i: number, x: number, y: number): void { if (this._ready()) { this._n.vertexAttrib2f(i, x, y); this._setAttribType(i, 0); } }
  vertexAttrib3f(i: number, x: number, y: number, z: number): void { if (this._ready()) { this._n.vertexAttrib3f(i, x, y, z); this._setAttribType(i, 0); } }
  vertexAttrib4f(i: number, x: number, y: number, z: number, w: number): void { if (this._ready()) { this._n.vertexAttrib4f(i, x, y, z, w); this._setAttribType(i, 0); } }
  /** @internal */
  _vertexAttribFv(i: number, v: Float32List, count: number, fn: (i: number, d: Float32Array) => void): void {
    if (!this._ready()) return;
    const d = toF32(v);
    if (d.length < count) { this._error(GL.INVALID_VALUE); return; }
    fn(i, d);
    this._setAttribType(i, 0);
  }
  vertexAttrib1fv(i: number, v: Float32List): void { this._vertexAttribFv(i, v, 1, (a, d) => this._n.vertexAttrib1fv(a, d)); }
  vertexAttrib2fv(i: number, v: Float32List): void { this._vertexAttribFv(i, v, 2, (a, d) => this._n.vertexAttrib2fv(a, d)); }
  vertexAttrib3fv(i: number, v: Float32List): void { this._vertexAttribFv(i, v, 3, (a, d) => this._n.vertexAttrib3fv(a, d)); }
  vertexAttrib4fv(i: number, v: Float32List): void { this._vertexAttribFv(i, v, 4, (a, d) => this._n.vertexAttrib4fv(a, d)); }

  /** @internal Drawing without a program is INVALID_OPERATION in WebGL (not every driver reports it). */
  _canDraw(): boolean {
    if (!this._ready()) return false;
    if (this._currentProgram === null) { this._error(GL.INVALID_OPERATION); return false; }
    return true;
  }
  drawArrays(mode: number, first: number, count: number): void { if (this._canDraw()) this._n.drawArrays(mode, first, count); }
  drawElements(mode: number, count: number, type: number, offset: number): void { if (this._canDraw()) this._n.drawElements(mode, count, type, offset); }

  /** @internal ES3 core, ANGLE_instanced_arrays or EXT_instanced_arrays */
  _drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void {
    if (!this._canDraw()) return;
    if (this._instanced === 'core') this._n.drawArraysInstanced(mode, first, count, instanceCount);
    else if (this._instanced === 'angle') this._n.drawArraysInstancedANGLE(mode, first, count, instanceCount);
    else this._n.drawArraysInstancedEXT(mode, first, count, instanceCount);
  }
  /** @internal */
  _drawElementsInstanced(mode: number, count: number, type: number, offset: number, instanceCount: number): void {
    if (!this._canDraw()) return;
    if (this._instanced === 'core') this._n.drawElementsInstanced(mode, count, type, offset, instanceCount);
    else if (this._instanced === 'angle') this._n.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
    else this._n.drawElementsInstancedEXT(mode, count, type, offset, instanceCount);
  }
  /** @internal */
  _vertexAttribDivisor(index: number, divisor: number): void {
    if (!this._ready()) return;
    if (this._instanced === 'core') this._n.vertexAttribDivisor(index, divisor);
    else if (this._instanced === 'angle') this._n.vertexAttribDivisorANGLE(index, divisor);
    else this._n.vertexAttribDivisorEXT(index, divisor);
  }

  // ---------------------------------------------------------------------------
  // vertex array objects (WebGL 2 core / OES_vertex_array_object)
  // ---------------------------------------------------------------------------

  /** @internal */
  _createVertexArray(): WebGLVertexArrayObject | null {
    if (!this._ready()) return null;
    if (this._es3) this._n.genVertexArrays(1, this._u32); else this._n.genVertexArraysOES(1, this._u32);
    const v = new WebGLVertexArrayObject(this, this._u32[0]);
    this._vertexArrays.set(v._id, v);
    return v;
  }
  /** @internal */
  _deleteVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (!this._ready() || !this._deletable(vao, WebGLVertexArrayObject)) return;
    this._vertexArrays.delete(vao!._id);
    this._u32[0] = vao!._id;
    if (this._es3) this._n.deleteVertexArrays(1, this._u32); else this._n.deleteVertexArraysOES(1, this._u32);
  }
  /** @internal */
  _isVertexArray(vao: unknown): boolean {
    if (!this._ready() || !(vao instanceof WebGLVertexArrayObject) || vao._ctx !== this || vao._deleted) return false;
    return this._es3 ? this._n.isVertexArray(vao._id) : this._n.isVertexArrayOES(vao._id);
  }
  /** @internal */
  _bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (!this._ready() || !this._valid(vao, WebGLVertexArrayObject, true)) return;
    if (this._es3) this._n.bindVertexArray(vao ? vao._id : 0); else this._n.bindVertexArrayOES(vao ? vao._id : 0);
  }

  // ---------------------------------------------------------------------------
  // draw buffers (WebGL 2 core / WEBGL_draw_buffers)
  // ---------------------------------------------------------------------------

  /** @internal */
  _drawBuffers(buffers: ArrayLike<number>): void {
    if (!this._ready()) return;
    const list = Array.from(buffers, Number);
    if (this._drawFramebuffer === null) {
      if (list.length !== 1 || (list[0] !== GL.BACK && list[0] !== GL.NONE)) { this._error(GL.INVALID_OPERATION); return; }
      if (list[0] === GL.BACK) list[0] = GL.COLOR_ATTACHMENT0;
    }
    const arr = new Uint32Array(list);
    if (this._es3) this._n.drawBuffers(arr.length, arr); else this._n.drawBuffersEXT(arr.length, arr);
  }

  // ---------------------------------------------------------------------------
  // queries (WebGL 2 core / EXT_disjoint_timer_query)
  // ---------------------------------------------------------------------------

  /** @internal */
  _createQuery(ext: boolean): WebGLQuery | null {
    if (!this._ready()) return null;
    if (ext) this._n.genQueriesEXT(1, this._u32); else this._n.genQueries(1, this._u32);
    const q = new WebGLQuery(this, this._u32[0]);
    this._queries.set(q._id, q);
    return q;
  }
  /** @internal */
  _deleteQuery(q: WebGLQuery | null, ext: boolean): void {
    if (!this._ready() || !this._deletable(q, WebGLQuery)) return;
    this._queries.delete(q!._id);
    this._u32[0] = q!._id;
    if (ext) this._n.deleteQueriesEXT(1, this._u32); else this._n.deleteQueries(1, this._u32);
  }
  /** @internal */
  _isQuery(q: unknown, ext: boolean): boolean {
    if (!this._ready() || !(q instanceof WebGLQuery) || q._ctx !== this || q._deleted) return false;
    return ext ? this._n.isQueryEXT(q._id) : this._n.isQuery(q._id);
  }
  /** @internal */
  _beginQuery(target: number, q: WebGLQuery, ext: boolean): void {
    if (!this._ready() || !this._valid(q, WebGLQuery)) return;
    if (ext) this._n.beginQueryEXT(target, q._id); else this._n.beginQuery(target, q._id);
    q._target = target;
  }
  /** @internal */
  _endQuery(target: number, ext: boolean): void {
    if (!this._ready()) return;
    if (ext) this._n.endQueryEXT(target); else this._n.endQuery(target);
  }
  /** @internal */
  _queryCounter(q: WebGLQuery, target: number): void {
    if (!this._ready() || !this._valid(q, WebGLQuery)) return;
    this._n.queryCounterEXT(q._id, target);
    q._target = target;
  }
  /** @internal */
  _getQuery(target: number, pname: number, ext: boolean): any {
    if (!this._ready()) return null;
    if (pname === GL.CURRENT_QUERY) {
      if (ext) this._n.getQueryivEXT(target, pname, this._i32); else this._n.getQueryiv(target, pname, this._i32);
      return this._queries.get(this._i32[0]) ?? null;
    }
    if (ext && pname === 0x8864 /* QUERY_COUNTER_BITS_EXT */) {
      this._n.getQueryivEXT(target, pname, this._i32);
      return this._i32[0];
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }
  /** @internal */
  _getQueryParameter(q: WebGLQuery, pname: number, ext: boolean): any {
    if (!this._ready() || !this._valid(q, WebGLQuery)) return null;
    if (pname === GL.QUERY_RESULT_AVAILABLE || pname === QUERY_RESULT_AVAILABLE_EXT) {
      if (ext) this._n.getQueryObjectuivEXT(q._id, QUERY_RESULT_AVAILABLE_EXT, this._u32); else this._n.getQueryObjectuiv(q._id, GL.QUERY_RESULT_AVAILABLE, this._u32);
      return this._u32[0] !== 0;
    }
    if (pname === GL.QUERY_RESULT || pname === QUERY_RESULT_EXT) {
      if (q._target === TIME_ELAPSED_EXT || q._target === TIMESTAMP_EXT) {
        const out = new BigUint64Array(1);
        this._n.getQueryObjectui64vEXT(q._id, QUERY_RESULT_EXT, out);
        return Number(out[0]);
      }
      if (ext) this._n.getQueryObjectuivEXT(q._id, QUERY_RESULT_EXT, this._u32); else this._n.getQueryObjectuiv(q._id, GL.QUERY_RESULT, this._u32);
      return this._u32[0];
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }

  // ---------------------------------------------------------------------------
  // textures
  // ---------------------------------------------------------------------------

  createTexture(): WebGLTexture | null {
    if (!this._ready()) return null;
    this._n.genTextures(1, this._u32);
    const t = new WebGLTexture(this, this._u32[0]);
    this._textures.set(t._id, t);
    return t;
  }

  deleteTexture(texture: WebGLTexture | null): void {
    if (!this._ready() || !this._deletable(texture, WebGLTexture)) return;
    this._textures.delete(texture!._id);
    this._u32[0] = texture!._id;
    this._n.deleteTextures(1, this._u32);
  }

  isTexture(texture: unknown): boolean {
    if (!this._ready() || !(texture instanceof WebGLTexture) || texture._ctx !== this || texture._deleted) return false;
    return this._n.isTexture(texture._id);
  }

  bindTexture(target: number, texture: WebGLTexture | null): void {
    if (!this._ready() || !this._valid(texture, WebGLTexture, true)) return;
    this._n.bindTexture(target, texture ? texture._id : 0);
  }

  texParameterf(target: number, pname: number, param: number): void { if (this._ready()) this._n.texParameterf(target, pname, param); }
  texParameteri(target: number, pname: number, param: number): void { if (this._ready()) this._n.texParameteri(target, pname, param); }
  generateMipmap(target: number): void { if (this._ready()) this._n.generateMipmap(target); }

  copyTexImage2D(target: number, level: number, internalformat: number, x: number, y: number, width: number, height: number, border: number): void {
    if (!this._ready()) return;
    this._withResolvedRead(() => this._n.copyTexImage2D(target, level, internalformat, x, y, width, height, border));
  }

  copyTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, x: number, y: number, width: number, height: number): void {
    if (!this._ready()) return;
    this._withResolvedRead(() => this._n.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height));
  }

  /**
   * texImage2D(target, level, internalformat, format, type, source)
   * texImage2D(target, level, internalformat, width, height, border, format, type, pixels | offset)
   * texImage2D(target, level, internalformat, width, height, border, format, type, source)           [WebGL 2]
   * texImage2D(target, level, internalformat, width, height, border, format, type, srcData, srcOffset) [WebGL 2]
   */
  texImage2D(...args: any[]): void {
    if (!this._ready()) return;
    const [target, level, internalformat] = args as number[];
    if (args.length === 6) {
      this._texImageSource(false, target, level, internalformat, 0, 0, 0, args[3], args[4], args[5], -1, -1, 0);
      return;
    }
    if (args.length < 9) throw new TypeError(`texImage2D: 6, 9 or 10 arguments required, but ${args.length} present`);
    const [, , , width, height, border, format, type] = args as number[];
    const p = args[8];
    if (args.length >= 10 && !this._isWebGL2) throw new TypeError('texImage2D: 10-argument overloads require WebGL 2');
    if (typeof p === 'number') { this._texImageOffset(target, level, internalformat, width, height, 0, border, format, type, p, false); return; }
    if (p === null || p === undefined || isView(p)) {
      this._texImageData(false, target, level, internalformat, width, height, 0, border, format, type, p ?? null, args[9] ?? 0, -1, -1, 0);
      return;
    }
    this._texImageSource(false, target, level, internalformat, width, height, border, format, type, p, -1, -1, 0);
  }

  /**
   * texSubImage2D(target, level, xoffset, yoffset, format, type, source)
   * texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels | offset)
   * texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, source)              [WebGL 2]
   * texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, srcData, srcOffset)  [WebGL 2]
   */
  texSubImage2D(...args: any[]): void {
    if (!this._ready()) return;
    const [target, level, xoffset, yoffset] = args as number[];
    if (args.length === 7) {
      this._texImageSource(false, target, level, 0, 0, 0, 0, args[4], args[5], args[6], xoffset, yoffset, 0);
      return;
    }
    if (args.length < 9) throw new TypeError(`texSubImage2D: 7, 9 or 10 arguments required, but ${args.length} present`);
    const [, , , , width, height, format, type] = args as number[];
    const p = args[8];
    if (args.length >= 10 && !this._isWebGL2) throw new TypeError('texSubImage2D: 10-argument overloads require WebGL 2');
    if (typeof p === 'number') { this._texImageOffset(target, level, 0, width, height, 0, 0, format, type, p, false, xoffset, yoffset, 0); return; }
    if (p === null || p === undefined) { this._error(GL.INVALID_VALUE); return; }
    if (isView(p)) {
      this._texImageData(false, target, level, 0, width, height, 0, 0, format, type, p, args[9] ?? 0, xoffset, yoffset, 0);
      return;
    }
    this._texImageSource(false, target, level, 0, width, height, 0, format, type, p, xoffset, yoffset, 0);
  }

  /** @internal PBO-sourced upload (WebGL 2). xoffset >= 0 selects the Sub variant. */
  _texImageOffset(target: number, level: number, internalformat: number, width: number, height: number, depth: number, border: number,
    format: number, type: number, offset: number, is3D: boolean, xoffset = -1, yoffset = 0, zoffset = 0): void {
    if (this._unpackFlipY || this._unpackPremultiplyAlpha) { this._error(GL.INVALID_OPERATION); return; }
    const n = this._n;
    if (is3D) {
      if (xoffset >= 0) n.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, offset);
      else n.texImage3D(target, level, internalformat, width, height, depth, border, format, type, offset);
    } else if (xoffset >= 0) n.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, offset);
    else n.texImage2D(target, level, internalformat, width, height, border, format, type, offset);
  }

  /** @internal ArrayBufferView (or null) upload. xoffset >= 0 selects the Sub variant. */
  _texImageData(is3D: boolean, target: number, level: number, internalformat: number, width: number, height: number, depth: number, border: number,
    format: number, type: number, view: ArrayBufferView | null, srcOffset: number, xoffset: number, yoffset: number, zoffset: number): void {
    const n = this._n;
    const sub = xoffset >= 0;
    if (view === null) {
      if (sub) { this._error(GL.INVALID_VALUE); return; }
      if (is3D) n.texImage3D(target, level, internalformat, width, height, depth, border, format, type, null);
      else n.texImage2D(target, level, internalformat, width, height, border, format, type, null);
      this._initDepthStencilTexture(target, internalformat, 1, is3D ? depth : 0, level);
      return;
    }
    const check = expectedArrayType(type);
    if (type === GL.FLOAT_32_UNSIGNED_INT_24_8_REV) { this._error(GL.INVALID_OPERATION); return; }
    if (check && !check(view)) { this._error(GL.INVALID_OPERATION); return; }
    const bpe = (view as TypedArray).BYTES_PER_ELEMENT ?? 1;
    if (srcOffset < 0 || srcOffset * bpe > view.byteLength) { this._error(GL.INVALID_VALUE); return; }
    let data = bytesOf(view, srcOffset);
    const bpp = bytesPerPixel(format, type);
    if (bpp === 0) { this._error(GL.INVALID_ENUM); return; }
    const d = is3D ? depth : 1;
    const required = imageByteSize(width, height, d, bpp, this._unpack);
    if (data.byteLength < required) { this._error(GL.INVALID_OPERATION); return; }
    let restore: (() => void) | null = null;
    if ((this._unpackFlipY || this._unpackPremultiplyAlpha) && width > 0 && height > 0) {
      data = repackForUpload(data, width, height, d, format, type, this._unpack, this._unpackFlipY, this._unpackPremultiplyAlpha);
      restore = this._tightUnpack();
    }
    this._upload(is3D, sub, target, level, internalformat, width, height, depth, border, format, type, data, xoffset, yoffset, zoffset);
    restore?.();
  }

  /** @internal Final GL upload call; uses ANGLE's robust variants (size-checked) when available. */
  _upload(is3D: boolean, sub: boolean, target: number, level: number, internalformat: number, width: number, height: number, depth: number,
    border: number, format: number, type: number, data: Uint8Array, xoffset: number, yoffset: number, zoffset: number): void {
    const n = this._n;
    const robust = hasNativeFunction('glTexImage2DRobustANGLE');
    if (is3D) {
      if (sub) {
        if (robust) n.texSubImage3DRobustANGLE(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, data.byteLength, data);
        else n.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, data);
      } else if (robust) n.texImage3DRobustANGLE(target, level, internalformat, width, height, depth, border, format, type, data.byteLength, data);
      else n.texImage3D(target, level, internalformat, width, height, depth, border, format, type, data);
    } else if (sub) {
      if (robust) n.texSubImage2DRobustANGLE(target, level, xoffset, yoffset, width, height, format, type, data.byteLength, data);
      else n.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, data);
    } else if (robust) n.texImage2DRobustANGLE(target, level, internalformat, width, height, border, format, type, data.byteLength, data);
    else n.texImage2D(target, level, internalformat, width, height, border, format, type, data);
  }

  /** @internal Image-source upload (ImageData / Canvas / Image / {width,height,data}). width<=0 means "whole image". */
  _texImageSource(is3D: boolean, target: number, level: number, internalformat: number, width: number, height: number, border: number,
    format: number, type: number, source: unknown, xoffset: number, yoffset: number, zoffset: number, depth = 1): void {
    const img = this._sourceToRGBA(source);
    this._ready(); // reading another canvas may have switched the current GL context
    if (!img) throw new TypeError('texImage2D: unsupported image source (expected ImageData, Canvas, Image or {width,height,data})');
    if (!canConvertImage(format, type)) { this._error(GL.INVALID_OPERATION); return; }
    // Per the WebGL spec, ImageBitmap sources ignore the UNPACK_FLIP_Y_WEBGL / UNPACK_PREMULTIPLY_ALPHA_WEBGL /
    // UNPACK_COLORSPACE_CONVERSION_WEBGL state: createImageBitmap()'s options already settled orientation and alpha.
    const isBitmap = (source as { _isImageBitmap?: boolean })._isImageBitmap === true;
    const flipY = isBitmap ? false : this._unpackFlipY;
    const premultiply = isBitmap ? false : this._unpackPremultiplyAlpha;
    let w = img.width, h = img.height;
    let src: RGBA8Source = img;
    if (width > 0 || height > 0) {
      // WebGL 2: upload a sub-rectangle selected by UNPACK_SKIP_PIXELS/ROWS and the given size.
      const sx = this._unpack.skipPixels, sy = this._unpack.skipRows;
      if (sx + width > img.width || sy + height > img.height) { this._error(GL.INVALID_OPERATION); return; }
      if (sx !== 0 || sy !== 0 || width !== img.width || height !== img.height) {
        const crop = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
          const s = ((sy + y) * img.width + sx) * 4;
          crop.set(img.data.subarray(s, s + width * 4), y * width * 4);
        }
        src = { width, height, data: crop };
      }
      w = width; h = height;
    }
    let data: Uint8Array;
    if (format === GL.RGBA && type === GL.UNSIGNED_BYTE && !premultiply) {
      // Fast path for the common RGBA8 case: upload the decoded pixels as-is (optionally row-flipped).
      const px = src.data;
      const bytes = w * h * 4;
      if (!flipY) data = px instanceof Uint8Array && px.byteLength === bytes ? px : new Uint8Array(px.buffer, px.byteOffset, bytes);
      else {
        data = new Uint8Array(bytes);
        const row = w * 4;
        for (let y = 0; y < h; y++) data.set(px.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
      }
    } else {
      data = convertImage(src, format, type, flipY, premultiply);
    }
    const restore = this._tightUnpack();
    this._upload(is3D, xoffset >= 0, target, level, internalformat, w, h, depth, border, format, type, data, xoffset, yoffset, zoffset);
    restore();
  }

  /**
   * compressedTexImage2D(target, level, internalformat, width, height, border, srcData[, srcOffset[, srcLengthOverride]])
   * compressedTexImage2D(target, level, internalformat, width, height, border, imageSize, offset)  [WebGL 2, PBO]
   */
  compressedTexImage2D(target: number, level: number, internalformat: number, width: number, height: number, border: number,
    data: ArrayBufferView | number, srcOffsetOrOffset?: number, srcLengthOverride?: number): void {
    if (!this._ready()) return;
    if (typeof data === 'number') {
      if (!this._isWebGL2) throw new TypeError('compressedTexImage2D: PBO overload requires WebGL 2');
      this._n.compressedTexImage2D(target, level, internalformat, width, height, border, data, srcOffsetOrOffset ?? 0);
      return;
    }
    const bytes = this._compressedBytes(data, srcOffsetOrOffset, srcLengthOverride);
    if (!bytes) return;
    this._n.compressedTexImage2D(target, level, internalformat, width, height, border, bytes.byteLength, bytes);
  }

  compressedTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, width: number, height: number, format: number,
    data: ArrayBufferView | number, srcOffsetOrOffset?: number, srcLengthOverride?: number): void {
    if (!this._ready()) return;
    if (typeof data === 'number') {
      if (!this._isWebGL2) throw new TypeError('compressedTexSubImage2D: PBO overload requires WebGL 2');
      this._n.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, data, srcOffsetOrOffset ?? 0);
      return;
    }
    const bytes = this._compressedBytes(data, srcOffsetOrOffset, srcLengthOverride);
    if (!bytes) return;
    this._n.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, bytes.byteLength, bytes);
  }

  /** @internal */
  _compressedBytes(data: ArrayBufferView, srcOffset?: number, srcLengthOverride?: number): Uint8Array | null {
    if (!isView(data)) throw new TypeError('compressed texture data must be an ArrayBufferView');
    const bpe = (data as TypedArray).BYTES_PER_ELEMENT ?? 1;
    const elems = data.byteLength / bpe;
    const off = srcOffset ?? 0;
    const len = srcLengthOverride === undefined || srcLengthOverride === 0 ? elems - off : srcLengthOverride;
    if (off < 0 || len < 0 || off + len > elems) { this._error(GL.INVALID_VALUE); return null; }
    return bytesOf(data, off).subarray(0, len * bpe);
  }

  // ---------------------------------------------------------------------------
  // readPixels
  // ---------------------------------------------------------------------------

  /**
   * readPixels(x, y, width, height, format, type, pixels[, dstOffset])
   * readPixels(x, y, width, height, format, type, offset)  [WebGL 2, PBO]
   */
  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView | number | null, dstOffset = 0): void {
    if (!this._ready()) return;
    const n = this._n;
    if (typeof pixels === 'number') {
      if (!this._isWebGL2) throw new TypeError('readPixels: PBO overload requires WebGL 2');
      this._withResolvedRead(() => n.readPixels(x, y, width, height, format, type, pixels));
      return;
    }
    if (pixels === null || pixels === undefined) { this._error(GL.INVALID_VALUE); return; }
    if (!isView(pixels)) throw new TypeError('readPixels: pixels must be an ArrayBufferView');
    const check = expectedArrayType(type);
    if (check && !check(pixels)) { this._error(GL.INVALID_OPERATION); return; }
    const bpe = (pixels as TypedArray).BYTES_PER_ELEMENT ?? 1;
    if (dstOffset < 0 || dstOffset * bpe > pixels.byteLength) { this._error(GL.INVALID_VALUE); return; }
    const dst = bytesOf(pixels, dstOffset);
    const bpp = bytesPerPixel(format, type);
    if (bpp === 0) { this._error(GL.INVALID_ENUM); return; }
    if (width < 0 || height < 0) { this._error(GL.INVALID_VALUE); return; }
    const p = this._pack;
    const required = imageByteSize(width, height, 1, bpp, { alignment: p.alignment, rowLength: p.rowLength, skipRows: p.skipRows, skipPixels: p.skipPixels, imageHeight: 0, skipImages: 0 });
    if (dst.byteLength < required) { this._error(GL.INVALID_OPERATION); return; }
    this._withResolvedRead(() => {
      if (hasNativeFunction('glReadPixelsRobustANGLE')) {
        n.readPixelsRobustANGLE(x, y, width, height, format, type, dst.byteLength, this._i32, null, null, dst);
      } else {
        n.readPixels(x, y, width, height, format, type, dst);
      }
    });
  }
}
