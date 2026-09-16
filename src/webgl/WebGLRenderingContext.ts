import { WebGLRenderingContextBase, type ContextOptions } from './context.ts';
import { WEBGL1_CONSTANTS } from './constants.ts';

/** WebGL 1 context (OpenGL ES 2.0 through ANGLE). */
export class WebGLRenderingContext extends WebGLRenderingContextBase {
  /** @internal */
  constructor(options: Omit<ContextOptions, 'version'>) {
    super({ ...options, version: 1 });
  }
}

/** Defines the WebGL constants on both the prototype (gl.TRIANGLES) and the constructor (WebGLRenderingContext.TRIANGLES). */
export function defineConstants(target: object, constants: Record<string, number>): void {
  const descriptors: PropertyDescriptorMap = {};
  for (const [name, value] of Object.entries(constants)) descriptors[name] = { value, writable: false, enumerable: true, configurable: false };
  Object.defineProperties(target, descriptors);
}

defineConstants(WebGLRenderingContext.prototype, WEBGL1_CONSTANTS);
defineConstants(WebGLRenderingContext, WEBGL1_CONSTANTS);
Object.defineProperty(WebGLRenderingContext.prototype, Symbol.toStringTag, { value: 'WebGLRenderingContext' });

export interface WebGLRenderingContext extends Readonly<typeof WEBGL1_CONSTANTS> {}
