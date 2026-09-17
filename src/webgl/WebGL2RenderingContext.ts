// WebGL 2 additions on top of the shared base (ES 3.0 entry points).
import { WebGLRenderingContextBase, type ContextOptions, type Float32List, type Int32List, type Uint32List } from './context.ts';
import { WEBGL1_CONSTANTS, WEBGL2_CONSTANTS, GL } from './constants.ts';
import { GLX } from './gl-internal.ts';
import { defineConstants } from './WebGLRenderingContext.ts';
import {
  WebGLActiveInfo, WebGLBuffer, WebGLProgram, WebGLQuery, WebGLSampler, WebGLSync, WebGLTexture,
  WebGLTransformFeedback, WebGLVertexArrayObject,
} from './objects.ts';

const utf8 = new TextDecoder();
const toF32 = (v: Float32List): Float32Array => (v instanceof Float32Array ? v : new Float32Array(v as ArrayLike<number>));
const toI32 = (v: Int32List): Int32Array => (v instanceof Int32Array ? v : new Int32Array(v as ArrayLike<number>));
const toU32 = (v: Uint32List): Uint32Array => (v instanceof Uint32Array ? v : new Uint32Array(v as ArrayLike<number>));

/** WebGL 2 context (OpenGL ES 3.0 through ANGLE). */
export class WebGL2RenderingContext extends WebGLRenderingContextBase {
  /** @internal */
  constructor(options: Omit<ContextOptions, 'version'>) {
    super({ ...options, version: 2 });
  }

  // --- buffers ------------------------------------------------------------------
  copyBufferSubData(readTarget: number, writeTarget: number, readOffset: number, writeOffset: number, size: number): void {
    if (this._ready()) this._n.copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size);
  }

  getBufferSubData(target: number, srcByteOffset: number, dstBuffer: ArrayBufferView, dstOffset = 0, length = 0): void {
    if (!this._ready()) return;
    if (!ArrayBuffer.isView(dstBuffer)) throw new TypeError('getBufferSubData: dstBuffer must be an ArrayBufferView');
    const bpe = (dstBuffer as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const elems = dstBuffer.byteLength / bpe;
    const len = length === 0 ? elems - dstOffset : length;
    if (dstOffset < 0 || len < 0 || dstOffset + len > elems) { this._error(GL.INVALID_VALUE); return; }
    if (len === 0) return;
    // Buffer size / bound-state validation, then a mapped read on the native side.
    this._n.getBufferParameteri64v(target, GL.BUFFER_SIZE, this._i64);
    const bufSize = Number(this._i64[0]);
    if (srcByteOffset < 0 || srcByteOffset + len * bpe > bufSize) { this._error(GL.INVALID_VALUE); return; }
    if (!this._n.getBufferSubData(target, srcByteOffset, dstBuffer, dstOffset * bpe, len * bpe)) this._error(GL.INVALID_OPERATION);
  }

  // --- framebuffers -----------------------------------------------------------------
  blitFramebuffer(srcX0: number, srcY0: number, srcX1: number, srcY1: number, dstX0: number, dstY0: number, dstX1: number, dstY1: number, mask: number, filter: number): void {
    if (!this._ready()) return;
    const db = this._drawingBuffer;
    if (db.msFbo && this._readFramebuffer === null && (mask & (GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT))) db.resolve(mask);
    this._withResolvedRead(() => this._n.blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter));
  }

  framebufferTextureLayer(target: number, attachment: number, texture: WebGLTexture | null, level: number, layer: number): void {
    if (!this._ready() || !this._valid(texture, WebGLTexture, true)) return;
    if (this._defaultBound(target)) { this._error(GL.INVALID_OPERATION); return; }
    this._n.framebufferTextureLayer(target, attachment, texture ? texture._id : 0, level, layer);
  }

  /** @internal */
  _mapDefaultAttachments(target: number, attachments: ArrayLike<number>): Uint32Array | null {
    const list = Array.from(attachments, Number);
    if (this._defaultBound(target)) {
      for (let i = 0; i < list.length; i++) {
        switch (list[i]) {
          case GL.COLOR: list[i] = GL.COLOR_ATTACHMENT0; break;
          case GL.DEPTH: list[i] = GL.DEPTH_ATTACHMENT; break;
          case GL.STENCIL: list[i] = GL.STENCIL_ATTACHMENT; break;
          default: this._error(GL.INVALID_ENUM); return null;
        }
      }
    }
    return new Uint32Array(list);
  }

  invalidateFramebuffer(target: number, attachments: ArrayLike<number>): void {
    if (!this._ready()) return;
    const a = this._mapDefaultAttachments(target, attachments);
    if (a) this._n.invalidateFramebuffer(target, a.length, a);
  }

  invalidateSubFramebuffer(target: number, attachments: ArrayLike<number>, x: number, y: number, width: number, height: number): void {
    if (!this._ready()) return;
    const a = this._mapDefaultAttachments(target, attachments);
    if (a) this._n.invalidateSubFramebuffer(target, a.length, a, x, y, width, height);
  }

  readBuffer(src: number): void {
    if (!this._ready()) return;
    if (this._readFramebuffer === null) {
      if (src === GL.BACK) src = GL.COLOR_ATTACHMENT0;
      else if (src !== GL.NONE) { this._error(GL.INVALID_OPERATION); return; }
    } else if (src === GL.BACK) { this._error(GL.INVALID_OPERATION); return; }
    this._n.readBuffer(src);
  }

  drawBuffers(buffers: ArrayLike<number>): void {
    this._drawBuffers(buffers);
  }

  clearBufferfv(buffer: number, drawbuffer: number, values: Float32List, srcOffset = 0): void {
    if (!this._ready()) return;
    const v = toF32(values);
    const need = buffer === GL.COLOR ? 4 : 1;
    if (v.length - srcOffset < need || srcOffset < 0) { this._error(GL.INVALID_VALUE); return; }
    this._n.clearBufferfv(buffer, drawbuffer, v.subarray(srcOffset));
  }
  clearBufferiv(buffer: number, drawbuffer: number, values: Int32List, srcOffset = 0): void {
    if (!this._ready()) return;
    const v = toI32(values);
    const need = buffer === GL.COLOR ? 4 : 1;
    if (v.length - srcOffset < need || srcOffset < 0) { this._error(GL.INVALID_VALUE); return; }
    this._n.clearBufferiv(buffer, drawbuffer, v.subarray(srcOffset));
  }
  clearBufferuiv(buffer: number, drawbuffer: number, values: Uint32List, srcOffset = 0): void {
    if (!this._ready()) return;
    const v = toU32(values);
    const need = buffer === GL.COLOR ? 4 : 1;
    if (v.length - srcOffset < need || srcOffset < 0) { this._error(GL.INVALID_VALUE); return; }
    this._n.clearBufferuiv(buffer, drawbuffer, v.subarray(srcOffset));
  }
  clearBufferfi(buffer: number, drawbuffer: number, depth: number, stencil: number): void {
    if (this._ready()) this._n.clearBufferfi(buffer, drawbuffer, depth, stencil);
  }

  getInternalformatParameter(target: number, internalformat: number, pname: number): Int32Array | null {
    if (!this._ready()) return null;
    if (pname !== GL.SAMPLES) { this._error(GL.INVALID_ENUM); return null; }
    this._n.getInternalformativ(target, internalformat, GLX.NUM_SAMPLE_COUNTS, 1, this._i32);
    const count = this._i32[0];
    const out = new Int32Array(Math.max(count, 0));
    if (count > 0) this._n.getInternalformativ(target, internalformat, GL.SAMPLES, count, out);
    return out;
  }

  renderbufferStorageMultisample(target: number, samples: number, internalformat: number, width: number, height: number): void {
    if (!this._ready()) return;
    this._n.renderbufferStorageMultisample(target, samples, internalformat, width, height);
    if (!this._isAngle) { this._n.getIntegerv(GL.RENDERBUFFER_BINDING, this._i32); this._initDepthStencilStorage('renderbuffer', this._i32[0], internalformat); }
  }

  // --- textures ------------------------------------------------------------------
  texStorage2D(target: number, levels: number, internalformat: number, width: number, height: number): void {
    if (!this._ready()) return;
    this._n.texStorage2D(target, levels, internalformat, width, height);
    if (target === GL.TEXTURE_2D) this._initDepthStencilTexture(target, internalformat, levels, 0);
    else for (let face = 0; face < 6; face++) this._initDepthStencilTexture(GL.TEXTURE_CUBE_MAP_POSITIVE_X + face, internalformat, levels, 0);
  }
  texStorage3D(target: number, levels: number, internalformat: number, width: number, height: number, depth: number): void {
    if (!this._ready()) return;
    this._n.texStorage3D(target, levels, internalformat, width, height, depth);
    if (target === GL.TEXTURE_2D_ARRAY) this._initDepthStencilTexture(target, internalformat, levels, depth);
  }

  /**
   * texImage3D(target, level, internalformat, width, height, depth, border, format, type, offset | source | srcData[, srcOffset])
   */
  texImage3D(...args: any[]): void {
    if (!this._ready()) return;
    if (args.length < 10) throw new TypeError(`texImage3D: 10 or 11 arguments required, but ${args.length} present`);
    const [target, level, internalformat, width, height, depth, border, format, type] = args as number[];
    const p = args[9];
    if (typeof p === 'number') { this._texImageOffset(target, level, internalformat, width, height, depth, border, format, type, p, true); return; }
    if (p === null || p === undefined || ArrayBuffer.isView(p)) {
      this._texImageData(true, target, level, internalformat, width, height, depth, border, format, type, p ?? null, args[10] ?? 0, -1, -1, 0);
      return;
    }
    this._texImageSource(true, target, level, internalformat, width, height, border, format, type, p, -1, -1, 0, depth);
  }

  /**
   * texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, offset | source | srcData[, srcOffset])
   */
  texSubImage3D(...args: any[]): void {
    if (!this._ready()) return;
    if (args.length < 11) throw new TypeError(`texSubImage3D: 11 or 12 arguments required, but ${args.length} present`);
    const [target, level, xoffset, yoffset, zoffset, width, height, depth, format, type] = args as number[];
    const p = args[10];
    if (typeof p === 'number') { this._texImageOffset(target, level, 0, width, height, depth, 0, format, type, p, true, xoffset, yoffset, zoffset); return; }
    if (p === null || p === undefined) { this._error(GL.INVALID_VALUE); return; }
    if (ArrayBuffer.isView(p)) {
      this._texImageData(true, target, level, 0, width, height, depth, 0, format, type, p, args[11] ?? 0, xoffset, yoffset, zoffset);
      return;
    }
    this._texImageSource(true, target, level, 0, width, height, 0, format, type, p, xoffset, yoffset, zoffset, depth);
  }

  copyTexSubImage3D(target: number, level: number, xoffset: number, yoffset: number, zoffset: number, x: number, y: number, width: number, height: number): void {
    if (!this._ready()) return;
    this._withResolvedRead(() => this._n.copyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height));
  }

  compressedTexImage3D(target: number, level: number, internalformat: number, width: number, height: number, depth: number, border: number,
    data: ArrayBufferView | number, srcOffsetOrOffset?: number, srcLengthOverride?: number): void {
    if (!this._ready()) return;
    if (typeof data === 'number') { this._n.compressedTexImage3D(target, level, internalformat, width, height, depth, border, data, srcOffsetOrOffset ?? 0); return; }
    const bytes = this._compressedBytes(data, srcOffsetOrOffset, srcLengthOverride);
    if (bytes) this._n.compressedTexImage3D(target, level, internalformat, width, height, depth, border, bytes.byteLength, bytes);
  }

  compressedTexSubImage3D(target: number, level: number, xoffset: number, yoffset: number, zoffset: number, width: number, height: number, depth: number, format: number,
    data: ArrayBufferView | number, srcOffsetOrOffset?: number, srcLengthOverride?: number): void {
    if (!this._ready()) return;
    if (typeof data === 'number') { this._n.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, data, srcOffsetOrOffset ?? 0); return; }
    const bytes = this._compressedBytes(data, srcOffsetOrOffset, srcLengthOverride);
    if (bytes) this._n.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, bytes.byteLength, bytes);
  }

  // --- programs & uniforms -------------------------------------------------------------
  getFragDataLocation(program: WebGLProgram, name: string): number {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return -1;
    return this._n.getFragDataLocation(program._id, String(name));
  }

  uniform1ui(loc: WebGLUniformLocationT, v0: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform1ui(loc!._location, v0); }
  uniform2ui(loc: WebGLUniformLocationT, v0: number, v1: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform2ui(loc!._location, v0, v1); }
  uniform3ui(loc: WebGLUniformLocationT, v0: number, v1: number, v2: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform3ui(loc!._location, v0, v1, v2); }
  uniform4ui(loc: WebGLUniformLocationT, v0: number, v1: number, v2: number, v3: number): void { if (this._ready() && this._validLocation(loc)) this._n.uniform4ui(loc!._location, v0, v1, v2, v3); }
  uniform1uiv(loc: WebGLUniformLocationT, v: Uint32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toU32(v), 1, srcOffset, srcLength, (l, c, d) => this._n.uniform1uiv(l, c, d)); }
  uniform2uiv(loc: WebGLUniformLocationT, v: Uint32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toU32(v), 2, srcOffset, srcLength, (l, c, d) => this._n.uniform2uiv(l, c, d)); }
  uniform3uiv(loc: WebGLUniformLocationT, v: Uint32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toU32(v), 3, srcOffset, srcLength, (l, c, d) => this._n.uniform3uiv(l, c, d)); }
  uniform4uiv(loc: WebGLUniformLocationT, v: Uint32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toU32(v), 4, srcOffset, srcLength, (l, c, d) => this._n.uniform4uiv(l, c, d)); }

  uniformMatrix3x2fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 6, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix3x2fv(l, c, transpose, d)); }
  uniformMatrix4x2fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 8, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix4x2fv(l, c, transpose, d)); }
  uniformMatrix2x3fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 6, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix2x3fv(l, c, transpose, d)); }
  uniformMatrix4x3fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 12, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix4x3fv(l, c, transpose, d)); }
  uniformMatrix2x4fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 8, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix2x4fv(l, c, transpose, d)); }
  uniformMatrix3x4fv(loc: WebGLUniformLocationT, transpose: boolean, v: Float32List, srcOffset?: number, srcLength?: number): void { this._uniformVec(loc, toF32(v), 12, srcOffset, srcLength, (l, c, d) => this._n.uniformMatrix3x4fv(l, c, transpose, d)); }

  // --- vertex attribs & drawing ---------------------------------------------------------
  vertexAttribI4i(index: number, x: number, y: number, z: number, w: number): void { if (this._ready()) { this._n.vertexAttribI4i(index, x, y, z, w); this._setAttribType(index, 1); } }
  vertexAttribI4ui(index: number, x: number, y: number, z: number, w: number): void { if (this._ready()) { this._n.vertexAttribI4ui(index, x, y, z, w); this._setAttribType(index, 2); } }
  vertexAttribI4iv(index: number, v: Int32List): void {
    if (!this._ready()) return;
    const d = toI32(v);
    if (d.length < 4) { this._error(GL.INVALID_VALUE); return; }
    this._n.vertexAttribI4iv(index, d);
    this._setAttribType(index, 1);
  }
  vertexAttribI4uiv(index: number, v: Uint32List): void {
    if (!this._ready()) return;
    const d = toU32(v);
    if (d.length < 4) { this._error(GL.INVALID_VALUE); return; }
    this._n.vertexAttribI4uiv(index, d);
    this._setAttribType(index, 2);
  }
  vertexAttribIPointer(index: number, size: number, type: number, stride: number, offset: number): void {
    if (this._ready()) this._n.vertexAttribIPointer(index, size, type, stride, offset);
  }
  vertexAttribDivisor(index: number, divisor: number): void { this._vertexAttribDivisor(index, divisor); }
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void { this._drawArraysInstanced(mode, first, count, instanceCount); }
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instanceCount: number): void { this._drawElementsInstanced(mode, count, type, offset, instanceCount); }
  drawRangeElements(mode: number, start: number, end: number, count: number, type: number, offset: number): void {
    if (this._canDraw()) this._n.drawRangeElements(mode, start, end, count, type, offset);
  }

  // --- queries -----------------------------------------------------------------------
  createQuery(): WebGLQuery | null { return this._createQuery(false); }
  deleteQuery(query: WebGLQuery | null): void { this._deleteQuery(query, false); }
  isQuery(query: unknown): boolean { return this._isQuery(query, false); }
  beginQuery(target: number, query: WebGLQuery): void { this._beginQuery(target, query, false); }
  endQuery(target: number): void { this._endQuery(target, false); }
  getQuery(target: number, pname: number): WebGLQuery | null { return this._getQuery(target, pname, false); }
  getQueryParameter(query: WebGLQuery, pname: number): any { return this._getQueryParameter(query, pname, false); }

  // --- samplers ---------------------------------------------------------------------
  createSampler(): WebGLSampler | null {
    if (!this._ready()) return null;
    this._n.genSamplers(1, this._u32);
    const s = new WebGLSampler(this, this._u32[0]);
    this._samplers.set(s._id, s);
    return s;
  }
  deleteSampler(sampler: WebGLSampler | null): void {
    if (!this._ready() || !this._deletable(sampler, WebGLSampler)) return;
    this._samplers.delete(sampler!._id);
    this._u32[0] = sampler!._id;
    this._n.deleteSamplers(1, this._u32);
  }
  isSampler(sampler: unknown): boolean {
    if (!this._ready() || !(sampler instanceof WebGLSampler) || sampler._ctx !== this || sampler._deleted) return false;
    return this._n.isSampler(sampler._id);
  }
  bindSampler(unit: number, sampler: WebGLSampler | null): void {
    if (!this._ready() || !this._valid(sampler, WebGLSampler, true)) return;
    this._n.bindSampler(unit, sampler ? sampler._id : 0);
  }
  samplerParameteri(sampler: WebGLSampler, pname: number, param: number): void {
    if (!this._ready() || !this._valid(sampler, WebGLSampler)) return;
    this._n.samplerParameteri(sampler._id, pname, param);
  }
  samplerParameterf(sampler: WebGLSampler, pname: number, param: number): void {
    if (!this._ready() || !this._valid(sampler, WebGLSampler)) return;
    this._n.samplerParameterf(sampler._id, pname, param);
  }
  getSamplerParameter(sampler: WebGLSampler, pname: number): any {
    if (!this._ready() || !this._valid(sampler, WebGLSampler)) return null;
    if (pname === GL.TEXTURE_MAX_LOD || pname === GL.TEXTURE_MIN_LOD) {
      this._n.getSamplerParameterfv(sampler._id, pname, this._f32);
      return this._f32[0];
    }
    this._n.getSamplerParameteriv(sampler._id, pname, this._i32);
    return this._i32[0] >>> 0;
  }

  // --- sync objects -----------------------------------------------------------------
  fenceSync(condition: number, flags: number): WebGLSync | null {
    if (!this._ready()) return null;
    const ptr = this._n.fenceSync(condition, flags);
    if (!ptr) return null;
    const s = new WebGLSync(this, ptr);
    this._syncs.set(ptr, s);
    return s;
  }
  isSync(sync: unknown): boolean {
    if (!this._ready() || !(sync instanceof WebGLSync) || sync._ctx !== this || sync._deleted) return false;
    return this._n.isSync(sync._id);
  }
  deleteSync(sync: WebGLSync | null): void {
    if (!this._ready() || !this._deletable(sync, WebGLSync)) return;
    this._syncs.delete(sync!._id);
    this._n.deleteSync(sync!._id);
  }
  clientWaitSync(sync: WebGLSync, flags: number, timeout: number): number {
    if (!this._ready() || !this._valid(sync, WebGLSync)) return GL.WAIT_FAILED;
    if (timeout < 0 || timeout > 1_000_000_000) { this._error(GL.INVALID_OPERATION); return GL.WAIT_FAILED; }
    return this._n.clientWaitSync(sync._id, flags, timeout);
  }
  waitSync(sync: WebGLSync, flags: number, timeout: number): void {
    if (!this._ready() || !this._valid(sync, WebGLSync)) return;
    if (timeout !== -1 && timeout !== GLX.TIMEOUT_IGNORED) { this._error(GL.INVALID_VALUE); return; }
    this._n.waitSync(sync._id, flags, -1);
  }
  getSyncParameter(sync: WebGLSync, pname: number): number | null {
    if (!this._ready() || !this._valid(sync, WebGLSync)) return null;
    switch (pname) {
      case GL.OBJECT_TYPE: case GL.SYNC_STATUS: case GL.SYNC_CONDITION: case GL.SYNC_FLAGS:
        this._n.getSynciv(sync._id, pname, 1, this._i32.subarray(8), this._i32);
        return pname === GL.SYNC_FLAGS ? this._i32[0] : this._i32[0] >>> 0;
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }

  // --- transform feedback ---------------------------------------------------------------
  createTransformFeedback(): WebGLTransformFeedback | null {
    if (!this._ready()) return null;
    this._n.genTransformFeedbacks(1, this._u32);
    const t = new WebGLTransformFeedback(this, this._u32[0]);
    this._transformFeedbacks.set(t._id, t);
    return t;
  }
  deleteTransformFeedback(tf: WebGLTransformFeedback | null): void {
    if (!this._ready() || !this._deletable(tf, WebGLTransformFeedback)) return;
    this._transformFeedbacks.delete(tf!._id);
    this._u32[0] = tf!._id;
    this._n.deleteTransformFeedbacks(1, this._u32);
  }
  isTransformFeedback(tf: unknown): boolean {
    if (!this._ready() || !(tf instanceof WebGLTransformFeedback) || tf._ctx !== this || tf._deleted) return false;
    return this._n.isTransformFeedback(tf._id);
  }
  bindTransformFeedback(target: number, tf: WebGLTransformFeedback | null): void {
    if (!this._ready() || !this._valid(tf, WebGLTransformFeedback, true)) return;
    this._n.bindTransformFeedback(target, tf ? tf._id : 0);
  }
  beginTransformFeedback(primitiveMode: number): void { if (this._ready()) this._n.beginTransformFeedback(primitiveMode); }
  endTransformFeedback(): void { if (this._ready()) this._n.endTransformFeedback(); }
  pauseTransformFeedback(): void { if (this._ready()) this._n.pauseTransformFeedback(); }
  resumeTransformFeedback(): void { if (this._ready()) this._n.resumeTransformFeedback(); }
  transformFeedbackVaryings(program: WebGLProgram, varyings: string[], bufferMode: number): void {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return;
    const names = Array.from(varyings, String);
    this._n.transformFeedbackVaryings(program._id, names.length, names, bufferMode);
  }
  getTransformFeedbackVarying(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    this._n.getProgramiv(program._id, GLX.TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH, this._i32);
    const bufSize = Math.max(this._i32[0], 1);
    const name = new Uint8Array(bufSize);
    const len = new Int32Array(1), size = new Int32Array(1), type = new Uint32Array(1);
    this._n.getTransformFeedbackVarying(program._id, index, bufSize, len, size, type, name);
    const err = this._n.getError();
    if (err !== GL.NO_ERROR) { this._error(err); return null; }
    return new WebGLActiveInfo(size[0], type[0], utf8.decode(name.subarray(0, len[0])));
  }

  // --- uniform buffer objects ---------------------------------------------------------------
  bindBufferBase(target: number, index: number, buffer: WebGLBuffer | null): void {
    if (!this._ready() || !this._valid(buffer, WebGLBuffer, true)) return;
    this._n.bindBufferBase(target, index, buffer ? buffer._id : 0);
  }
  bindBufferRange(target: number, index: number, buffer: WebGLBuffer | null, offset: number, size: number): void {
    if (!this._ready() || !this._valid(buffer, WebGLBuffer, true)) return;
    this._n.bindBufferRange(target, index, buffer ? buffer._id : 0, offset, size);
  }
  getIndexedParameter(target: number, index: number): any {
    if (!this._ready()) return null;
    switch (target) {
      case GL.TRANSFORM_FEEDBACK_BUFFER_BINDING: case GL.UNIFORM_BUFFER_BINDING:
        this._n.getIntegeri_v(target, index, this._i32);
        return this._buffers.get(this._i32[0]) ?? null;
      case GL.TRANSFORM_FEEDBACK_BUFFER_SIZE: case GL.TRANSFORM_FEEDBACK_BUFFER_START:
      case GL.UNIFORM_BUFFER_SIZE: case GL.UNIFORM_BUFFER_START:
        this._n.getInteger64i_v(target, index, this._i64);
        return Number(this._i64[0]);
      case GL.BLEND_EQUATION_RGB: case GL.BLEND_EQUATION_ALPHA: case GL.BLEND_SRC_RGB: case GL.BLEND_SRC_ALPHA:
      case GL.BLEND_DST_RGB: case GL.BLEND_DST_ALPHA:
        if (!this._extensions.has('OES_draw_buffers_indexed')) break;
        this._n.getIntegeri_v(target, index, this._i32);
        return this._i32[0] >>> 0;
      case GL.COLOR_WRITEMASK:
        if (!this._extensions.has('OES_draw_buffers_indexed')) break;
        this._n.getIntegeri_v(target, index, this._i32);
        return [!!this._i32[0], !!this._i32[1], !!this._i32[2], !!this._i32[3]];
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }
  getUniformIndices(program: WebGLProgram, uniformNames: string[]): number[] | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    const names = Array.from(uniformNames, String);
    const out = new Uint32Array(Math.max(names.length, 1));
    this._n.getUniformIndices(program._id, names.length, names, out);
    return Array.from(out.subarray(0, names.length));
  }
  getActiveUniforms(program: WebGLProgram, uniformIndices: number[], pname: number): any {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    const idx = Uint32Array.from(uniformIndices, Number);
    const out = new Int32Array(Math.max(idx.length, 1));
    this._n.getActiveUniformsiv(program._id, idx.length, idx, pname, out);
    const err = this._n.getError();
    if (err !== GL.NO_ERROR) { this._error(err); return null; }
    const vals = Array.from(out.subarray(0, idx.length));
    switch (pname) {
      case GL.UNIFORM_TYPE: return vals.map((v) => v >>> 0);
      case GL.UNIFORM_IS_ROW_MAJOR: return vals.map((v) => v !== 0);
      default: return vals;
    }
  }
  getUniformBlockIndex(program: WebGLProgram, uniformBlockName: string): number {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return GL.INVALID_INDEX;
    return this._n.getUniformBlockIndex(program._id, String(uniformBlockName));
  }
  getActiveUniformBlockParameter(program: WebGLProgram, uniformBlockIndex: number, pname: number): any {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    switch (pname) {
      case GL.UNIFORM_BLOCK_BINDING: case GL.UNIFORM_BLOCK_DATA_SIZE: case GL.UNIFORM_BLOCK_ACTIVE_UNIFORMS:
        this._n.getActiveUniformBlockiv(program._id, uniformBlockIndex, pname, this._i32);
        return this._i32[0];
      case GL.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: case GL.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER:
        this._n.getActiveUniformBlockiv(program._id, uniformBlockIndex, pname, this._i32);
        return this._i32[0] !== 0;
      case GL.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: {
        this._n.getActiveUniformBlockiv(program._id, uniformBlockIndex, GL.UNIFORM_BLOCK_ACTIVE_UNIFORMS, this._i32);
        const count = this._i32[0];
        const out = new Int32Array(Math.max(count, 1));
        if (count > 0) this._n.getActiveUniformBlockiv(program._id, uniformBlockIndex, pname, out);
        return new Uint32Array(out.buffer, 0, count);
      }
    }
    this._error(GL.INVALID_ENUM);
    return null;
  }
  getActiveUniformBlockName(program: WebGLProgram, uniformBlockIndex: number): string | null {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return null;
    this._n.getActiveUniformBlockiv(program._id, uniformBlockIndex, GLX.UNIFORM_BLOCK_NAME_LENGTH, this._i32);
    const err = this._n.getError();
    if (err !== GL.NO_ERROR) { this._error(err); return null; }
    const bufSize = Math.max(this._i32[0], 1);
    const name = new Uint8Array(bufSize);
    this._n.getActiveUniformBlockName(program._id, uniformBlockIndex, bufSize, this._i32, name);
    return utf8.decode(name.subarray(0, this._i32[0]));
  }
  uniformBlockBinding(program: WebGLProgram, uniformBlockIndex: number, uniformBlockBinding: number): void {
    if (!this._ready() || !this._valid(program, WebGLProgram)) return;
    this._n.uniformBlockBinding(program._id, uniformBlockIndex, uniformBlockBinding);
  }

  // --- vertex array objects -----------------------------------------------------------
  createVertexArray(): WebGLVertexArrayObject | null { return this._createVertexArray(); }
  deleteVertexArray(vao: WebGLVertexArrayObject | null): void { this._deleteVertexArray(vao); }
  isVertexArray(vao: unknown): boolean { return this._isVertexArray(vao); }
  bindVertexArray(vao: WebGLVertexArrayObject | null): void { this._bindVertexArray(vao); }
}

type WebGLUniformLocationT = import('./objects.ts').WebGLUniformLocation | null;

const ALL = { ...WEBGL1_CONSTANTS, ...WEBGL2_CONSTANTS };
defineConstants(WebGL2RenderingContext.prototype, ALL);
defineConstants(WebGL2RenderingContext, ALL);
Object.defineProperty(WebGL2RenderingContext.prototype, Symbol.toStringTag, { value: 'WebGL2RenderingContext' });

export interface WebGL2RenderingContext extends Readonly<typeof WEBGL1_CONSTANTS>, Readonly<typeof WEBGL2_CONSTANTS> {}
