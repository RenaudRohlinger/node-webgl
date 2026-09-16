// node-webgl: headless WebGL 1 & 2 for Node.js, powered by ANGLE.
export { init, getDisplayInfo, type DisplayInfo, type InitOptions } from './native.ts';
export { WebGLRenderingContext } from './webgl/WebGLRenderingContext.ts';
export { WebGL2RenderingContext } from './webgl/WebGL2RenderingContext.ts';
export { WebGLRenderingContextBase, type WebGLContextAttributes, type ContextOptions, type TexImageSource } from './webgl/context.ts';
export {
  WebGLObject, WebGLBuffer, WebGLFramebuffer, WebGLProgram, WebGLRenderbuffer, WebGLShader, WebGLTexture,
  WebGLUniformLocation, WebGLActiveInfo, WebGLShaderPrecisionFormat, WebGLQuery, WebGLSampler, WebGLSync,
  WebGLTransformFeedback, WebGLVertexArrayObject, WebGLVertexArrayObjectOES, WebGLTimerQueryEXT, WebGLContextEvent,
} from './webgl/objects.ts';
export { WEBGL1_CONSTANTS, WEBGL2_CONSTANTS } from './webgl/constants.ts';
export { Canvas, Canvas as HTMLCanvasElement, createCanvas, type CanvasContextAttributes } from './canvas/Canvas.ts';
export {
  ImageData, Image, Image as HTMLImageElement, ImageBitmap, createImageBitmap, loadImage, decodeImage, encodeImage, readImageBytes,
  registerImageDecoder, type ImageDecoder, type DecodedImage, type ImageBitmapOptions,
} from './canvas/image.ts';
export { encodePNG, decodePNG, isPNG } from './canvas/png.ts';
export { decodeJPEG, isJPEG } from './canvas/jpeg.ts';
export { installDOM, type InstallDOMOptions } from './dom.ts';

import { Canvas } from './canvas/Canvas.ts';
import type { WebGLRenderingContext } from './webgl/WebGLRenderingContext.ts';
import type { WebGL2RenderingContext } from './webgl/WebGL2RenderingContext.ts';
import type { CanvasContextAttributes } from './canvas/Canvas.ts';

export interface CreateContextOptions extends CanvasContextAttributes {
  /** 2 (default) for WebGL 2, 1 for WebGL 1. */
  version?: 1 | 2;
}

/**
 * Creates a WebGL context of the given size without an explicit canvas (headless-gl style).
 * `ctx.canvas` is a Canvas you can call toBuffer()/toDataURL() on.
 */
export function createWebGLContext(width: number, height: number, options: CreateContextOptions & { version: 1 }): WebGLRenderingContext;
export function createWebGLContext(width: number, height: number, options?: CreateContextOptions): WebGL2RenderingContext;
export function createWebGLContext(width: number, height: number, options: CreateContextOptions = {}): WebGLRenderingContext | WebGL2RenderingContext {
  const { version = 2, ...attrs } = options;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext(version === 1 ? 'webgl' : 'webgl2', attrs);
  if (!ctx) throw new Error('node-webgl: failed to create a WebGL context');
  return ctx;
}

export default createWebGLContext;
