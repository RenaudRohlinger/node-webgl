// WebGL object wrappers. Each wraps a GL name (`_id`) owned by one context.

/** Minimal view of the owning context needed by the object classes (avoids a circular import). */
export interface OwnerContext {
  readonly _contextId: number;
}

export class WebGLObject {
  /** @internal GL object name. */
  _id: number;
  /** @internal owning context. */
  _ctx: OwnerContext;
  /** @internal set by delete*(); the GL object may outlive it while still bound/attached. */
  _deleted = false;
  /** Free-form debugging label (WebGL IDL `WebGLObject.label`). */
  label = '';
  /** @internal */
  constructor(ctx: OwnerContext, id: number) {
    this._ctx = ctx;
    this._id = id;
  }
  get [Symbol.toStringTag](): string {
    return this.constructor.name;
  }
}

export class WebGLBuffer extends WebGLObject {
  /** @internal first target this buffer was bound to (WebGL 2 forbids mixing element/non-element use). */
  _target = 0;
}
export class WebGLFramebuffer extends WebGLObject {}
export class WebGLRenderbuffer extends WebGLObject {}
export class WebGLTexture extends WebGLObject {
  /** @internal first target this texture was bound to. */
  _target = 0;
}
export class WebGLShader extends WebGLObject {
  /** @internal */
  _type: number;
  /** @internal */
  _source = '';
  /** @internal */
  constructor(ctx: OwnerContext, id: number, type: number) {
    super(ctx, id);
    this._type = type;
  }
}

export interface UniformInfo {
  name: string;
  /** GLSL type enum (FLOAT_VEC3, SAMPLER_2D, ...). */
  type: number;
  /** Array length (1 for non-arrays). */
  size: number;
  /** Base location of element 0 (-1 if not active / in a block). */
  location: number;
}

export class WebGLProgram extends WebGLObject {
  /** @internal incremented on each successful link; uniform locations are bound to a link. */
  _linkId = 0;
  /** @internal active uniform table, built lazily after link. */
  _uniforms: UniformInfo[] | null = null;
  /** @internal */
  _linked = false;
}

export class WebGLQuery extends WebGLObject {
  /** @internal target used by beginQuery (needed by EXT_disjoint_timer_query). */
  _target = 0;
}
export class WebGLSampler extends WebGLObject {}
export class WebGLSync extends WebGLObject {}
export class WebGLTransformFeedback extends WebGLObject {}
export class WebGLVertexArrayObject extends WebGLObject {}
/** WebGL 1 name for VAOs from OES_vertex_array_object; same class. */
export const WebGLVertexArrayObjectOES = WebGLVertexArrayObject;
/** WebGL 1 name for queries from EXT_disjoint_timer_query; same class. */
export const WebGLTimerQueryEXT = WebGLQuery;

export class WebGLUniformLocation {
  /** @internal */
  _program: WebGLProgram;
  /** @internal */
  _location: number;
  /** @internal */
  _linkId: number;
  /** @internal */
  _info: UniformInfo | null;
  /** @internal element index inside an array uniform (for getUniform). */
  _elementIndex: number;
  /** @internal */
  constructor(program: WebGLProgram, location: number, info: UniformInfo | null, elementIndex = 0) {
    this._program = program;
    this._location = location;
    this._linkId = program._linkId;
    this._info = info;
    this._elementIndex = elementIndex;
  }
  get [Symbol.toStringTag](): string {
    return 'WebGLUniformLocation';
  }
}

export class WebGLActiveInfo {
  readonly size: number;
  readonly type: number;
  readonly name: string;
  /** @internal */
  constructor(size: number, type: number, name: string) {
    this.size = size;
    this.type = type;
    this.name = name;
  }
  get [Symbol.toStringTag](): string {
    return 'WebGLActiveInfo';
  }
}

export class WebGLShaderPrecisionFormat {
  readonly rangeMin: number;
  readonly rangeMax: number;
  readonly precision: number;
  /** @internal */
  constructor(rangeMin: number, rangeMax: number, precision: number) {
    this.rangeMin = rangeMin;
    this.rangeMax = rangeMax;
    this.precision = precision;
  }
  get [Symbol.toStringTag](): string {
    return 'WebGLShaderPrecisionFormat';
  }
}

export class WebGLContextEvent extends Event {
  readonly statusMessage: string;
  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; composed?: boolean; statusMessage?: string } = {}) {
    super(type, init);
    this.statusMessage = init.statusMessage ?? '';
  }
}
