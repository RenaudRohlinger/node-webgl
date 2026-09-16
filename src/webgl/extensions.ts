// WebGL extension registry: maps each WebGL extension to the ANGLE/GL extensions it needs and
// builds the extension object handed back by getExtension().
import { GL } from './constants.ts';
import type { WebGLRenderingContextBase } from './context.ts';
import { WebGLQuery, WebGLShader, WebGLTexture, WebGLVertexArrayObject } from './objects.ts';

export interface ExtensionEntry {
  name: string;
  /** 0 = WebGL 1 and 2, otherwise the only version exposing it. */
  version: 0 | 1 | 2;
  /** GL extensions that must all be available (requested on getExtension). */
  gl: string[];
  /** GL extensions requested too when available (implicit companions, like EXT_float_blend). */
  optional?: string[];
  /** Native entry points that must have resolved. */
  fns?: string[];
  /**
   * Alternatives for non-ANGLE drivers (Mesa, vendor EGL): other GL extension spellings, or 'core3'
   * when an ES 3.0+ context provides the feature natively.
   */
  alt?: Array<{ gl: string[]; fns?: string[] } | 'core3'>;
  create(ctx: WebGLRenderingContextBase): object;
}

type Ctx = WebGLRenderingContextBase;

function tagged<T extends object>(name: string, obj: T): T {
  Object.defineProperty(obj, Symbol.toStringTag, { value: name });
  return obj;
}

/** Offsets list for multiDrawElements*: GL wants pointer-sized entries. */
function pointerList(list: Int32Array | ArrayLike<number>, offset: number, count: number): BigInt64Array {
  const out = new BigInt64Array(count);
  for (let i = 0; i < count; i++) out[i] = BigInt(list[offset + i]);
  return out;
}
function i32(list: Int32Array | ArrayLike<number>, offset: number, count: number): Int32Array {
  const arr = list instanceof Int32Array ? list : Int32Array.from(list as ArrayLike<number>);
  return arr.subarray(offset, offset + count);
}

class ANGLE_instanced_arrays {
  readonly VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE = 0x88fe;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  drawArraysInstancedANGLE(mode: number, first: number, count: number, primcount: number): void { this.ctx._drawArraysInstanced(mode, first, count, primcount); }
  drawElementsInstancedANGLE(mode: number, count: number, type: number, offset: number, primcount: number): void { this.ctx._drawElementsInstanced(mode, count, type, offset, primcount); }
  vertexAttribDivisorANGLE(index: number, divisor: number): void { this.ctx._vertexAttribDivisor(index, divisor); }
}

class OES_vertex_array_object {
  readonly VERTEX_ARRAY_BINDING_OES = 0x85b5;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  createVertexArrayOES(): WebGLVertexArrayObject | null { return this.ctx._createVertexArray(); }
  deleteVertexArrayOES(vao: WebGLVertexArrayObject | null): void { this.ctx._deleteVertexArray(vao); }
  isVertexArrayOES(vao: unknown): boolean { return this.ctx._isVertexArray(vao); }
  bindVertexArrayOES(vao: WebGLVertexArrayObject | null): void { this.ctx._bindVertexArray(vao); }
}

class WEBGL_draw_buffers {
  readonly COLOR_ATTACHMENT0_WEBGL = 0x8ce0; readonly COLOR_ATTACHMENT1_WEBGL = 0x8ce1; readonly COLOR_ATTACHMENT2_WEBGL = 0x8ce2; readonly COLOR_ATTACHMENT3_WEBGL = 0x8ce3;
  readonly COLOR_ATTACHMENT4_WEBGL = 0x8ce4; readonly COLOR_ATTACHMENT5_WEBGL = 0x8ce5; readonly COLOR_ATTACHMENT6_WEBGL = 0x8ce6; readonly COLOR_ATTACHMENT7_WEBGL = 0x8ce7;
  readonly COLOR_ATTACHMENT8_WEBGL = 0x8ce8; readonly COLOR_ATTACHMENT9_WEBGL = 0x8ce9; readonly COLOR_ATTACHMENT10_WEBGL = 0x8cea; readonly COLOR_ATTACHMENT11_WEBGL = 0x8ceb;
  readonly COLOR_ATTACHMENT12_WEBGL = 0x8cec; readonly COLOR_ATTACHMENT13_WEBGL = 0x8ced; readonly COLOR_ATTACHMENT14_WEBGL = 0x8cee; readonly COLOR_ATTACHMENT15_WEBGL = 0x8cef;
  readonly DRAW_BUFFER0_WEBGL = 0x8825; readonly DRAW_BUFFER1_WEBGL = 0x8826; readonly DRAW_BUFFER2_WEBGL = 0x8827; readonly DRAW_BUFFER3_WEBGL = 0x8828;
  readonly DRAW_BUFFER4_WEBGL = 0x8829; readonly DRAW_BUFFER5_WEBGL = 0x882a; readonly DRAW_BUFFER6_WEBGL = 0x882b; readonly DRAW_BUFFER7_WEBGL = 0x882c;
  readonly DRAW_BUFFER8_WEBGL = 0x882d; readonly DRAW_BUFFER9_WEBGL = 0x882e; readonly DRAW_BUFFER10_WEBGL = 0x882f; readonly DRAW_BUFFER11_WEBGL = 0x8830;
  readonly DRAW_BUFFER12_WEBGL = 0x8831; readonly DRAW_BUFFER13_WEBGL = 0x8832; readonly DRAW_BUFFER14_WEBGL = 0x8833; readonly DRAW_BUFFER15_WEBGL = 0x8834;
  readonly MAX_COLOR_ATTACHMENTS_WEBGL = 0x8cdf;
  readonly MAX_DRAW_BUFFERS_WEBGL = 0x8824;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  drawBuffersWEBGL(buffers: ArrayLike<number>): void { this.ctx._drawBuffers(buffers); }
}

class EXT_disjoint_timer_query {
  readonly QUERY_COUNTER_BITS_EXT = 0x8864; readonly CURRENT_QUERY_EXT = 0x8865; readonly QUERY_RESULT_EXT = 0x8866; readonly QUERY_RESULT_AVAILABLE_EXT = 0x8867;
  readonly TIME_ELAPSED_EXT = 0x88bf; readonly TIMESTAMP_EXT = 0x8e28; readonly GPU_DISJOINT_EXT = 0x8fbb;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  createQueryEXT(): WebGLQuery | null { return this.ctx._createQuery(true); }
  deleteQueryEXT(q: WebGLQuery | null): void { this.ctx._deleteQuery(q, true); }
  isQueryEXT(q: unknown): boolean { return this.ctx._isQuery(q, true); }
  beginQueryEXT(target: number, q: WebGLQuery): void { this.ctx._beginQuery(target, q, true); }
  endQueryEXT(target: number): void { this.ctx._endQuery(target, true); }
  queryCounterEXT(q: WebGLQuery, target: number): void { this.ctx._queryCounter(q, target); }
  getQueryEXT(target: number, pname: number): any { return this.ctx._getQuery(target, pname, true); }
  getQueryObjectEXT(q: WebGLQuery, pname: number): any { return this.ctx._getQueryParameter(q, pname, true); }
}

class EXT_disjoint_timer_query_webgl2 {
  readonly QUERY_COUNTER_BITS_EXT = 0x8864; readonly TIME_ELAPSED_EXT = 0x88bf; readonly TIMESTAMP_EXT = 0x8e28; readonly GPU_DISJOINT_EXT = 0x8fbb;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  queryCounterEXT(q: WebGLQuery, target: number): void { this.ctx._queryCounter(q, target); }
}

class WEBGL_lose_context {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  loseContext(): void { this.ctx._loseContext(); }
  restoreContext(): void { this.ctx._restoreContext(); }
}

class WEBGL_debug_shaders {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  getTranslatedShaderSource(shader: WebGLShader): string {
    const c = this.ctx;
    if (!c._ready() || !c._valid(shader, WebGLShader)) return '';
    c._n.getShaderiv(shader._id, 0x93a0 /* TRANSLATED_SHADER_LENGTH_ANGLE */, c._i32);
    const len = c._i32[0];
    if (len <= 0) return '';
    const buf = new Uint8Array(len);
    c._n.getTranslatedShaderSourceANGLE(shader._id, len, c._i32, buf);
    return new TextDecoder().decode(buf.subarray(0, c._i32[0]));
  }
}

class WEBGL_multi_draw {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  multiDrawArraysWEBGL(mode: number, firsts: Int32Array | number[], firstsOffset: number, counts: Int32Array | number[], countsOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    this.ctx._n.multiDrawArraysANGLE(mode, i32(firsts, firstsOffset, drawcount), i32(counts, countsOffset, drawcount), drawcount);
  }
  multiDrawElementsWEBGL(mode: number, counts: Int32Array | number[], countsOffset: number, type: number, offsets: Int32Array | number[], offsetsOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    this.ctx._n.multiDrawElementsANGLE(mode, i32(counts, countsOffset, drawcount), type, pointerList(offsets, offsetsOffset, drawcount), drawcount);
  }
  multiDrawArraysInstancedWEBGL(mode: number, firsts: Int32Array | number[], firstsOffset: number, counts: Int32Array | number[], countsOffset: number,
    instanceCounts: Int32Array | number[], instanceCountsOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    this.ctx._n.multiDrawArraysInstancedANGLE(mode, i32(firsts, firstsOffset, drawcount), i32(counts, countsOffset, drawcount), i32(instanceCounts, instanceCountsOffset, drawcount), drawcount);
  }
  multiDrawElementsInstancedWEBGL(mode: number, counts: Int32Array | number[], countsOffset: number, type: number, offsets: Int32Array | number[], offsetsOffset: number,
    instanceCounts: Int32Array | number[], instanceCountsOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    this.ctx._n.multiDrawElementsInstancedANGLE(mode, i32(counts, countsOffset, drawcount), type, pointerList(offsets, offsetsOffset, drawcount), i32(instanceCounts, instanceCountsOffset, drawcount), drawcount);
  }
}

class WEBGL_draw_instanced_base_vertex_base_instance {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  drawArraysInstancedBaseInstanceWEBGL(mode: number, first: number, count: number, instanceCount: number, baseInstance: number): void {
    if (this.ctx._ready()) this.ctx._n.drawArraysInstancedBaseInstanceANGLE(mode, first, count, instanceCount, baseInstance);
  }
  drawElementsInstancedBaseVertexBaseInstanceWEBGL(mode: number, count: number, type: number, offset: number, instanceCount: number, baseVertex: number, baseInstance: number): void {
    if (this.ctx._ready()) this.ctx._n.drawElementsInstancedBaseVertexBaseInstanceANGLE(mode, count, type, offset, instanceCount, baseVertex, baseInstance);
  }
}

class WEBGL_multi_draw_instanced_base_vertex_base_instance {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  multiDrawArraysInstancedBaseInstanceWEBGL(mode: number, firsts: Int32Array | number[], firstsOffset: number, counts: Int32Array | number[], countsOffset: number,
    instanceCounts: Int32Array | number[], instanceCountsOffset: number, baseInstances: Uint32Array | number[], baseInstancesOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    const bi = baseInstances instanceof Uint32Array ? baseInstances : Uint32Array.from(baseInstances);
    this.ctx._n.multiDrawArraysInstancedBaseInstanceANGLE(mode, i32(firsts, firstsOffset, drawcount), i32(counts, countsOffset, drawcount),
      i32(instanceCounts, instanceCountsOffset, drawcount), bi.subarray(baseInstancesOffset, baseInstancesOffset + drawcount), drawcount);
  }
  multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL(mode: number, counts: Int32Array | number[], countsOffset: number, type: number, offsets: Int32Array | number[], offsetsOffset: number,
    instanceCounts: Int32Array | number[], instanceCountsOffset: number, baseVertices: Int32Array | number[], baseVerticesOffset: number,
    baseInstances: Uint32Array | number[], baseInstancesOffset: number, drawcount: number): void {
    if (!this.ctx._ready()) return;
    const bi = baseInstances instanceof Uint32Array ? baseInstances : Uint32Array.from(baseInstances);
    this.ctx._n.multiDrawElementsInstancedBaseVertexBaseInstanceANGLE(mode, i32(counts, countsOffset, drawcount), type, pointerList(offsets, offsetsOffset, drawcount),
      i32(instanceCounts, instanceCountsOffset, drawcount), i32(baseVertices, baseVerticesOffset, drawcount), bi.subarray(baseInstancesOffset, baseInstancesOffset + drawcount), drawcount);
  }
}

class OES_draw_buffers_indexed {
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  enableiOES(target: number, index: number): void { if (this.ctx._ready()) this.ctx._n.enableiOES(target, index); }
  disableiOES(target: number, index: number): void { if (this.ctx._ready()) this.ctx._n.disableiOES(target, index); }
  blendEquationiOES(buf: number, mode: number): void { if (this.ctx._ready()) this.ctx._n.blendEquationiOES(buf, mode); }
  blendEquationSeparateiOES(buf: number, modeRGB: number, modeAlpha: number): void { if (this.ctx._ready()) this.ctx._n.blendEquationSeparateiOES(buf, modeRGB, modeAlpha); }
  blendFunciOES(buf: number, src: number, dst: number): void { if (this.ctx._ready()) this.ctx._n.blendFunciOES(buf, src, dst); }
  blendFuncSeparateiOES(buf: number, srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void { if (this.ctx._ready()) this.ctx._n.blendFuncSeparateiOES(buf, srcRGB, dstRGB, srcAlpha, dstAlpha); }
  colorMaskiOES(buf: number, r: boolean, g: boolean, b: boolean, a: boolean): void { if (this.ctx._ready()) this.ctx._n.colorMaskiOES(buf, r, g, b, a); }
}

class OVR_multiview2 {
  readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_NUM_VIEWS_OVR = 0x9630; readonly MAX_VIEWS_OVR = 0x9631;
  readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_BASE_VIEW_INDEX_OVR = 0x9632; readonly FRAMEBUFFER_INCOMPLETE_VIEW_TARGETS_OVR = 0x9633;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  framebufferTextureMultiviewOVR(target: number, attachment: number, texture: WebGLTexture | null, level: number, baseViewIndex: number, numViews: number): void {
    const c = this.ctx;
    if (!c._ready() || !c._valid(texture, WebGLTexture, true)) return;
    if (c._defaultBound(target)) { c._error(GL.INVALID_OPERATION); return; }
    c._n.framebufferTextureMultiviewOVR(target, attachment, texture ? texture._id : 0, level, baseViewIndex, numViews);
  }
}

class WEBGL_provoking_vertex {
  readonly FIRST_VERTEX_CONVENTION_WEBGL = 0x8e4d; readonly LAST_VERTEX_CONVENTION_WEBGL = 0x8e4e; readonly PROVOKING_VERTEX_WEBGL = 0x8e4f;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  provokingVertexWEBGL(mode: number): void { if (this.ctx._ready()) this.ctx._n.provokingVertexANGLE(mode); }
}

class EXT_clip_control {
  readonly LOWER_LEFT_EXT = 0x8ca1; readonly UPPER_LEFT_EXT = 0x8ca2; readonly NEGATIVE_ONE_TO_ONE_EXT = 0x935e; readonly ZERO_TO_ONE_EXT = 0x935f;
  readonly CLIP_ORIGIN_EXT = 0x935c; readonly CLIP_DEPTH_MODE_EXT = 0x935d;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  clipControlEXT(origin: number, depth: number): void { if (this.ctx._ready()) this.ctx._n.clipControlEXT(origin, depth); }
}

class EXT_polygon_offset_clamp {
  readonly POLYGON_OFFSET_CLAMP_EXT = 0x8e1b;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  polygonOffsetClampEXT(factor: number, units: number, clamp: number): void { if (this.ctx._ready()) this.ctx._n.polygonOffsetClampEXT(factor, units, clamp); }
}

class WEBGL_polygon_mode {
  readonly POLYGON_MODE_WEBGL = 0x0b40; readonly POLYGON_OFFSET_LINE_WEBGL = 0x2a02; readonly LINE_WEBGL = 0x1b01; readonly FILL_WEBGL = 0x1b02;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  polygonModeWEBGL(face: number, mode: number): void { if (this.ctx._ready()) this.ctx._n.polygonModeANGLE(face, mode); }
}

class WEBGL_compressed_texture_astc {
  readonly COMPRESSED_RGBA_ASTC_4x4_KHR = 0x93b0; readonly COMPRESSED_RGBA_ASTC_5x4_KHR = 0x93b1; readonly COMPRESSED_RGBA_ASTC_5x5_KHR = 0x93b2; readonly COMPRESSED_RGBA_ASTC_6x5_KHR = 0x93b3;
  readonly COMPRESSED_RGBA_ASTC_6x6_KHR = 0x93b4; readonly COMPRESSED_RGBA_ASTC_8x5_KHR = 0x93b5; readonly COMPRESSED_RGBA_ASTC_8x6_KHR = 0x93b6; readonly COMPRESSED_RGBA_ASTC_8x8_KHR = 0x93b7;
  readonly COMPRESSED_RGBA_ASTC_10x5_KHR = 0x93b8; readonly COMPRESSED_RGBA_ASTC_10x6_KHR = 0x93b9; readonly COMPRESSED_RGBA_ASTC_10x8_KHR = 0x93ba; readonly COMPRESSED_RGBA_ASTC_10x10_KHR = 0x93bb;
  readonly COMPRESSED_RGBA_ASTC_12x10_KHR = 0x93bc; readonly COMPRESSED_RGBA_ASTC_12x12_KHR = 0x93bd;
  readonly COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR = 0x93d0; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR = 0x93d1; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR = 0x93d2;
  readonly COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR = 0x93d3; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR = 0x93d4; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR = 0x93d5;
  readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR = 0x93d6; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR = 0x93d7; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR = 0x93d8;
  readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR = 0x93d9; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR = 0x93da; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR = 0x93db;
  readonly COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR = 0x93dc; readonly COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR = 0x93dd;
  private ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  getSupportedProfiles(): string[] {
    const p = ['ldr'];
    if (this.ctx._glEnabled.has('GL_KHR_texture_compression_astc_hdr')) p.push('hdr');
    return p;
  }
}

const constantsOnly = (name: string, constants: Record<string, number>) => (): object => Object.freeze(tagged(name, { ...constants }));

export const EXTENSIONS: ExtensionEntry[] = [
  { name: 'ANGLE_instanced_arrays', version: 1, gl: ['GL_ANGLE_instanced_arrays'], fns: ['glDrawArraysInstancedANGLE'], alt: [{ gl: ['GL_EXT_instanced_arrays'], fns: ['glDrawArraysInstancedEXT'] }, 'core3'], create: (c) => new ANGLE_instanced_arrays(c) },
  { name: 'EXT_blend_minmax', version: 1, gl: ['GL_EXT_blend_minmax'], create: constantsOnly('EXT_blend_minmax', { MIN_EXT: 0x8007, MAX_EXT: 0x8008 }) },
  { name: 'EXT_clip_control', version: 0, gl: ['GL_EXT_clip_control'], fns: ['glClipControlEXT'], create: (c) => new EXT_clip_control(c) },
  { name: 'EXT_color_buffer_float', version: 2, gl: ['GL_EXT_color_buffer_float'], optional: ['GL_EXT_float_blend'], create: constantsOnly('EXT_color_buffer_float', {}) },
  { name: 'EXT_color_buffer_half_float', version: 0, gl: ['GL_EXT_color_buffer_half_float'], create: constantsOnly('EXT_color_buffer_half_float', { RGBA16F_EXT: 0x881a, RGB16F_EXT: 0x881b, FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211, UNSIGNED_NORMALIZED_EXT: 0x8c17 }) },
  { name: 'EXT_conservative_depth', version: 2, gl: ['GL_EXT_conservative_depth'], create: constantsOnly('EXT_conservative_depth', {}) },
  { name: 'EXT_depth_clamp', version: 0, gl: ['GL_EXT_depth_clamp'], create: constantsOnly('EXT_depth_clamp', { DEPTH_CLAMP_EXT: 0x864f }) },
  { name: 'EXT_disjoint_timer_query', version: 1, gl: ['GL_EXT_disjoint_timer_query'], fns: ['glGenQueriesEXT', 'glQueryCounterEXT'], create: (c) => new EXT_disjoint_timer_query(c) },
  { name: 'EXT_disjoint_timer_query_webgl2', version: 2, gl: ['GL_EXT_disjoint_timer_query'], fns: ['glQueryCounterEXT', 'glGetQueryObjectui64vEXT'], create: (c) => new EXT_disjoint_timer_query_webgl2(c) },
  { name: 'EXT_float_blend', version: 0, gl: ['GL_EXT_float_blend'], create: constantsOnly('EXT_float_blend', {}) },
  { name: 'EXT_frag_depth', version: 1, gl: ['GL_EXT_frag_depth'], create: constantsOnly('EXT_frag_depth', {}) },
  { name: 'EXT_polygon_offset_clamp', version: 0, gl: ['GL_EXT_polygon_offset_clamp'], fns: ['glPolygonOffsetClampEXT'], create: (c) => new EXT_polygon_offset_clamp(c) },
  { name: 'EXT_render_snorm', version: 2, gl: ['GL_EXT_render_snorm'], create: constantsOnly('EXT_render_snorm', { R16_SNORM_EXT: 0x8f98, RG16_SNORM_EXT: 0x8f99, RGB16_SNORM_EXT: 0x8f9a, RGBA16_SNORM_EXT: 0x8f9b }) },
  { name: 'EXT_shader_texture_lod', version: 1, gl: ['GL_EXT_shader_texture_lod'], create: constantsOnly('EXT_shader_texture_lod', {}) },
  { name: 'EXT_sRGB', version: 1, gl: ['GL_EXT_sRGB'], create: constantsOnly('EXT_sRGB', { SRGB_EXT: 0x8c40, SRGB_ALPHA_EXT: 0x8c42, SRGB8_ALPHA8_EXT: 0x8c43, FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT: 0x8210 }) },
  { name: 'EXT_texture_compression_bptc', version: 0, gl: ['GL_EXT_texture_compression_bptc'], create: constantsOnly('EXT_texture_compression_bptc', { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c, COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: 0x8e8d, COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT: 0x8e8e, COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT: 0x8e8f }) },
  { name: 'EXT_texture_compression_rgtc', version: 0, gl: ['GL_EXT_texture_compression_rgtc'], create: constantsOnly('EXT_texture_compression_rgtc', { COMPRESSED_RED_RGTC1_EXT: 0x8dbb, COMPRESSED_SIGNED_RED_RGTC1_EXT: 0x8dbc, COMPRESSED_RED_GREEN_RGTC2_EXT: 0x8dbd, COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: 0x8dbe }) },
  { name: 'EXT_texture_filter_anisotropic', version: 0, gl: ['GL_EXT_texture_filter_anisotropic'], create: constantsOnly('EXT_texture_filter_anisotropic', { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff }) },
  { name: 'EXT_texture_mirror_clamp_to_edge', version: 0, gl: ['GL_EXT_texture_mirror_clamp_to_edge'], create: constantsOnly('EXT_texture_mirror_clamp_to_edge', { MIRROR_CLAMP_TO_EDGE_EXT: 0x8743 }) },
  { name: 'EXT_texture_norm16', version: 2, gl: ['GL_EXT_texture_norm16'], create: constantsOnly('EXT_texture_norm16', { R16_EXT: 0x822a, RG16_EXT: 0x822c, RGB16_EXT: 0x8054, RGBA16_EXT: 0x805b, R16_SNORM_EXT: 0x8f98, RG16_SNORM_EXT: 0x8f99, RGB16_SNORM_EXT: 0x8f9a, RGBA16_SNORM_EXT: 0x8f9b }) },
  { name: 'KHR_parallel_shader_compile', version: 0, gl: ['GL_KHR_parallel_shader_compile'], create: constantsOnly('KHR_parallel_shader_compile', { COMPLETION_STATUS_KHR: 0x91b1 }) },
  { name: 'NV_shader_noperspective_interpolation', version: 2, gl: ['GL_NV_shader_noperspective_interpolation'], create: constantsOnly('NV_shader_noperspective_interpolation', {}) },
  { name: 'OES_draw_buffers_indexed', version: 2, gl: ['GL_OES_draw_buffers_indexed'], fns: ['glEnableiOES', 'glBlendFunciOES'], create: (c) => new OES_draw_buffers_indexed(c) },
  { name: 'OES_element_index_uint', version: 1, gl: ['GL_OES_element_index_uint'], alt: ['core3'], create: constantsOnly('OES_element_index_uint', {}) },
  { name: 'OES_fbo_render_mipmap', version: 1, gl: ['GL_OES_fbo_render_mipmap'], create: constantsOnly('OES_fbo_render_mipmap', {}) },
  { name: 'OES_standard_derivatives', version: 1, gl: ['GL_OES_standard_derivatives'], create: constantsOnly('OES_standard_derivatives', { FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8b8b }) },
  { name: 'OES_texture_float', version: 1, gl: ['GL_OES_texture_float'], optional: ['GL_CHROMIUM_color_buffer_float_rgba', 'GL_CHROMIUM_color_buffer_float_rgb'], create: constantsOnly('OES_texture_float', {}) },
  { name: 'OES_texture_float_linear', version: 0, gl: ['GL_OES_texture_float_linear'], create: constantsOnly('OES_texture_float_linear', {}) },
  { name: 'OES_texture_half_float', version: 1, gl: ['GL_OES_texture_half_float'], optional: ['GL_EXT_color_buffer_half_float'], create: constantsOnly('OES_texture_half_float', { HALF_FLOAT_OES: 0x8d61 }) },
  { name: 'OES_texture_half_float_linear', version: 1, gl: ['GL_OES_texture_half_float_linear'], create: constantsOnly('OES_texture_half_float_linear', {}) },
  { name: 'OES_vertex_array_object', version: 1, gl: ['GL_OES_vertex_array_object'], fns: ['glGenVertexArraysOES'], alt: ['core3'], create: (c) => new OES_vertex_array_object(c) },
  { name: 'OVR_multiview2', version: 2, gl: ['GL_OVR_multiview2'], fns: ['glFramebufferTextureMultiviewOVR'], create: (c) => new OVR_multiview2(c) },
  { name: 'WEBGL_blend_func_extended', version: 0, gl: ['GL_EXT_blend_func_extended'], create: constantsOnly('WEBGL_blend_func_extended', { SRC1_COLOR_WEBGL: 0x88f9, SRC1_ALPHA_WEBGL: 0x8589, ONE_MINUS_SRC1_COLOR_WEBGL: 0x88fa, ONE_MINUS_SRC1_ALPHA_WEBGL: 0x88fb, MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL: 0x88fc }) },
  { name: 'WEBGL_clip_cull_distance', version: 2, gl: ['GL_ANGLE_clip_cull_distance'], create: constantsOnly('WEBGL_clip_cull_distance', { MAX_CLIP_DISTANCES_WEBGL: 0x0d32, MAX_CULL_DISTANCES_WEBGL: 0x82f9, MAX_COMBINED_CLIP_AND_CULL_DISTANCES_WEBGL: 0x82fa, CLIP_DISTANCE0_WEBGL: 0x3000, CLIP_DISTANCE1_WEBGL: 0x3001, CLIP_DISTANCE2_WEBGL: 0x3002, CLIP_DISTANCE3_WEBGL: 0x3003, CLIP_DISTANCE4_WEBGL: 0x3004, CLIP_DISTANCE5_WEBGL: 0x3005, CLIP_DISTANCE6_WEBGL: 0x3006, CLIP_DISTANCE7_WEBGL: 0x3007 }) },
  { name: 'WEBGL_color_buffer_float', version: 1, gl: ['GL_CHROMIUM_color_buffer_float_rgba'], optional: ['GL_CHROMIUM_color_buffer_float_rgb', 'GL_EXT_float_blend'], create: constantsOnly('WEBGL_color_buffer_float', { RGBA32F_EXT: 0x8814, RGB32F_EXT: 0x8815, FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211, UNSIGNED_NORMALIZED_EXT: 0x8c17 }) },
  { name: 'WEBGL_compressed_texture_astc', version: 0, gl: ['GL_KHR_texture_compression_astc_ldr'], optional: ['GL_KHR_texture_compression_astc_hdr'], create: (c) => new WEBGL_compressed_texture_astc(c) },
  { name: 'WEBGL_compressed_texture_etc', version: 0, gl: ['GL_ANGLE_compressed_texture_etc'], alt: ['core3'], create: constantsOnly('WEBGL_compressed_texture_etc', { COMPRESSED_R11_EAC: 0x9270, COMPRESSED_SIGNED_R11_EAC: 0x9271, COMPRESSED_RG11_EAC: 0x9272, COMPRESSED_SIGNED_RG11_EAC: 0x9273, COMPRESSED_RGB8_ETC2: 0x9274, COMPRESSED_SRGB8_ETC2: 0x9275, COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9276, COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9277, COMPRESSED_RGBA8_ETC2_EAC: 0x9278, COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279 }) },
  { name: 'WEBGL_compressed_texture_etc1', version: 0, gl: ['GL_OES_compressed_ETC1_RGB8_texture'], create: constantsOnly('WEBGL_compressed_texture_etc1', { COMPRESSED_RGB_ETC1_WEBGL: 0x8d64 }) },
  { name: 'WEBGL_compressed_texture_pvrtc', version: 0, gl: ['GL_IMG_texture_compression_pvrtc'], create: constantsOnly('WEBGL_compressed_texture_pvrtc', { COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 0x8c00, COMPRESSED_RGB_PVRTC_2BPPV1_IMG: 0x8c01, COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: 0x8c02, COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: 0x8c03 }) },
  { name: 'WEBGL_compressed_texture_s3tc', version: 0, gl: ['GL_EXT_texture_compression_dxt1', 'GL_ANGLE_texture_compression_dxt3', 'GL_ANGLE_texture_compression_dxt5'], alt: [{ gl: ['GL_EXT_texture_compression_s3tc'] }], create: constantsOnly('WEBGL_compressed_texture_s3tc', { COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0, COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1, COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2, COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3 }) },
  { name: 'WEBGL_compressed_texture_s3tc_srgb', version: 0, gl: ['GL_EXT_texture_compression_s3tc_srgb'], create: constantsOnly('WEBGL_compressed_texture_s3tc_srgb', { COMPRESSED_SRGB_S3TC_DXT1_EXT: 0x8c4c, COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT: 0x8c4d, COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT: 0x8c4e, COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: 0x8c4f }) },
  { name: 'WEBGL_debug_renderer_info', version: 0, gl: [], create: constantsOnly('WEBGL_debug_renderer_info', { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }) },
  { name: 'WEBGL_debug_shaders', version: 0, gl: ['GL_ANGLE_translated_shader_source'], fns: ['glGetTranslatedShaderSourceANGLE'], create: (c) => new WEBGL_debug_shaders(c) },
  { name: 'WEBGL_depth_texture', version: 1, gl: ['GL_ANGLE_depth_texture'], alt: [{ gl: ['GL_OES_depth_texture'] }, 'core3'], create: constantsOnly('WEBGL_depth_texture', { UNSIGNED_INT_24_8_WEBGL: 0x84fa }) },
  { name: 'WEBGL_draw_buffers', version: 1, gl: ['GL_EXT_draw_buffers'], fns: ['glDrawBuffersEXT'], alt: ['core3'], create: (c) => new WEBGL_draw_buffers(c) },
  { name: 'WEBGL_draw_instanced_base_vertex_base_instance', version: 2, gl: ['GL_ANGLE_base_vertex_base_instance'], fns: ['glDrawArraysInstancedBaseInstanceANGLE'], create: (c) => new WEBGL_draw_instanced_base_vertex_base_instance(c) },
  { name: 'WEBGL_lose_context', version: 0, gl: [], create: (c) => new WEBGL_lose_context(c) },
  { name: 'WEBGL_multi_draw', version: 0, gl: ['GL_ANGLE_multi_draw'], fns: ['glMultiDrawArraysANGLE'], create: (c) => new WEBGL_multi_draw(c) },
  { name: 'WEBGL_multi_draw_instanced_base_vertex_base_instance', version: 2, gl: ['GL_ANGLE_multi_draw', 'GL_ANGLE_base_vertex_base_instance'], fns: ['glMultiDrawArraysInstancedBaseInstanceANGLE'], create: (c) => new WEBGL_multi_draw_instanced_base_vertex_base_instance(c) },
  { name: 'WEBGL_polygon_mode', version: 0, gl: ['GL_ANGLE_polygon_mode'], fns: ['glPolygonModeANGLE'], create: (c) => new WEBGL_polygon_mode(c) },
  { name: 'WEBGL_provoking_vertex', version: 2, gl: ['GL_ANGLE_provoking_vertex'], fns: ['glProvokingVertexANGLE'], create: (c) => new WEBGL_provoking_vertex(c) },
  { name: 'WEBGL_render_shared_exponent', version: 2, gl: ['GL_QCOM_render_shared_exponent'], create: constantsOnly('WEBGL_render_shared_exponent', {}) },
  { name: 'WEBGL_stencil_texturing', version: 2, gl: ['GL_ANGLE_stencil_texturing'], create: constantsOnly('WEBGL_stencil_texturing', { DEPTH_STENCIL_TEXTURE_MODE_WEBGL: 0x90ea, STENCIL_INDEX_WEBGL: 0x1901 }) },
];

