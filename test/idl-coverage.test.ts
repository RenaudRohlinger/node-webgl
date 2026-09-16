// Checks the full WebGL 1 / WebGL 2 IDL surface against the real context objects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebGLRenderingContext, WebGL2RenderingContext } from '../src/index.ts';
import { makeGL, dispose } from './helpers.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Body of `interface mixin <name> { ... };`. */
function mixinBody(source: string, name: string): string {
  const m = new RegExp(`interface mixin ${name}\\b[\\s\\S]*?\\n\\{([\\s\\S]*?)\\n\\};`, 'm').exec(source);
  assert.ok(m, `interface mixin ${name} not found in the IDL`);
  return m![1];
}

/** `const <type> NAME = value;` declarations (GLenum, and GLint64 for TIMEOUT_IGNORED). */
function idlConstants(body: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of stripComments(body).matchAll(/^\s*const\s+(?:GLenum|GLint64|GLuint|GLint|GLbitfield)\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/gm)) {
    const value = Number(m[2].trim());
    assert.ok(Number.isFinite(value), `could not parse the value of ${m[1]}`);
    out.set(m[1], value);
  }
  return out;
}

/** `<returnType> name(` declarations (extended attributes allowed in front). */
function idlMethods(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of stripComments(body).split('\n')) {
    if (/^\s*(readonly|attribute|dictionary|enum|typedef)\b/.test(line)) continue;
    const m = /^\s*(?:\[[^\]]*\]\s*)?(?:[A-Za-z_][A-Za-z0-9_]*(?:<[^>]*>)?\??\s+)+?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

const idl1 = readFileSync(join(ROOT, 'scripts/idl/webgl1.idl'), 'utf8');
const idl2 = readFileSync(join(ROOT, 'scripts/idl/webgl2.idl'), 'utf8');

const base1 = mixinBody(idl1, 'WebGLRenderingContextBase');
const overloads1 = mixinBody(idl1, 'WebGLRenderingContextOverloads');
const base2 = mixinBody(idl2, 'WebGL2RenderingContextBase');
const overloads2 = mixinBody(idl2, 'WebGL2RenderingContextOverloads');

const CONSTANTS_1 = idlConstants(base1);
const CONSTANTS_2 = idlConstants(base2);
const METHODS_1 = new Set([...idlMethods(base1), ...idlMethods(overloads1)]);
const METHODS_2 = new Set([...idlMethods(base2), ...idlMethods(overloads2)]);

describe('IDL parsing sanity', () => {
  test('the IDL files yield a plausible surface', () => {
    assert.ok(CONSTANTS_1.size > 250, `WebGL 1 constants parsed: ${CONSTANTS_1.size}`);
    assert.ok(CONSTANTS_2.size > 200, `WebGL 2 constants parsed: ${CONSTANTS_2.size}`);
    assert.ok(METHODS_1.size > 120, `WebGL 1 methods parsed: ${METHODS_1.size}`);
    assert.ok(METHODS_2.size > 90, `WebGL 2 methods parsed: ${METHODS_2.size}`);
    // spot checks that the regexes actually matched the right things
    assert.equal(CONSTANTS_1.get('TRIANGLES'), 0x0004);
    assert.equal(CONSTANTS_1.get('ONE_MINUS_SRC_ALPHA'), 0x0303);
    assert.equal(CONSTANTS_2.get('TEXTURE_3D'), 0x806f);
    assert.ok(METHODS_1.has('drawArrays') && METHODS_1.has('texImage2D') && METHODS_1.has('getParameter'));
    assert.ok(METHODS_2.has('createVertexArray') && METHODS_2.has('texImage3D') && METHODS_2.has('clientWaitSync'));
  });
});

describe('WebGLRenderingContextBase (WebGL 1)', () => {
  test('every constant exists with the right value on a WebGL 1 context', () => {
    const gl = makeGL(1, 4, 4);
    const wrong: string[] = [];
    for (const [name, value] of CONSTANTS_1) {
      if ((gl as any)[name] !== value) wrong.push(`${name}: expected ${value}, got ${(gl as any)[name]}`);
    }
    assert.deepEqual(wrong, [], `WebGL 1 constants missing or wrong (${wrong.length})`);
    dispose(gl);
  });

  test('every constant is also on the WebGLRenderingContext constructor', () => {
    const wrong: string[] = [];
    for (const [name, value] of CONSTANTS_1) {
      if ((WebGLRenderingContext as any)[name] !== value) wrong.push(`${name}: expected ${value}, got ${(WebGLRenderingContext as any)[name]}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('constants are read-only', () => {
    const gl = makeGL(1, 4, 4);
    const before = (gl as any).TRIANGLES;
    assert.throws(() => { 'use strict'; (gl as any).TRIANGLES = 999; }, TypeError);
    assert.equal((gl as any).TRIANGLES, before);
    dispose(gl);
  });

  test('every method exists as a function on a WebGL 1 context', () => {
    const gl = makeGL(1, 4, 4);
    const missing = [...METHODS_1].filter((name) => typeof (gl as any)[name] !== 'function');
    assert.deepEqual(missing, [], `WebGL 1 methods missing (${missing.length})`);
    dispose(gl);
  });

  test('WebGL 1 constants and methods are all present on a WebGL 2 context too', () => {
    const gl = makeGL(2, 4, 4);
    const wrong: string[] = [];
    for (const [name, value] of CONSTANTS_1) {
      if ((gl as any)[name] !== value) wrong.push(`${name}: expected ${value}, got ${(gl as any)[name]}`);
    }
    assert.deepEqual(wrong, []);
    const missing = [...METHODS_1].filter((name) => typeof (gl as any)[name] !== 'function');
    assert.deepEqual(missing, []);
    dispose(gl);
  });
});

describe('WebGL2RenderingContextBase / Overloads (WebGL 2)', () => {
  test('every constant exists with the right value on a WebGL 2 context', () => {
    const gl = makeGL(2, 4, 4);
    const wrong: string[] = [];
    for (const [name, value] of CONSTANTS_2) {
      if ((gl as any)[name] !== value) wrong.push(`${name}: expected ${value}, got ${(gl as any)[name]}`);
    }
    assert.deepEqual(wrong, [], `WebGL 2 constants missing or wrong (${wrong.length})`);
    dispose(gl);
  });

  test('every constant is also on the WebGL2RenderingContext constructor', () => {
    const wrong: string[] = [];
    for (const [name, value] of [...CONSTANTS_1, ...CONSTANTS_2]) {
      if ((WebGL2RenderingContext as any)[name] !== value) wrong.push(`${name}: expected ${value}, got ${(WebGL2RenderingContext as any)[name]}`);
    }
    assert.deepEqual(wrong, []);
    assert.equal(WebGL2RenderingContext.TRIANGLES, 0x0004);
  });

  test('every method exists as a function on a WebGL 2 context', () => {
    const gl = makeGL(2, 4, 4);
    const missing = [...METHODS_2].filter((name) => typeof (gl as any)[name] !== 'function');
    assert.deepEqual(missing, [], `WebGL 2 methods missing (${missing.length})`);
    dispose(gl);
  });
});

describe('WebGL 1 does not expose the WebGL 2 surface', () => {
  test('WebGL2-only constants are undefined on a WebGL 1 context', () => {
    const gl = makeGL(1, 4, 4);
    const only2 = [...CONSTANTS_2].filter(([name]) => !CONSTANTS_1.has(name));
    assert.ok(only2.length > 150, `expected many WebGL2-only constants, got ${only2.length}`);
    const leaked = only2.filter(([name]) => (gl as any)[name] !== undefined).map(([name]) => name);
    assert.deepEqual(leaked, [], `WebGL2-only constants leaked onto a WebGL 1 context (${leaked.length})`);
    // explicit spot checks from the brief
    assert.equal((gl as any).TEXTURE_3D, undefined);
    assert.equal((gl as any).TRANSFORM_FEEDBACK, undefined);
    assert.equal((gl as any).SYNC_GPU_COMMANDS_COMPLETE, undefined);
    assert.equal((WebGLRenderingContext as any).TEXTURE_3D, undefined);
    dispose(gl);
  });

  test('WebGL2-only methods are undefined on a WebGL 1 context', () => {
    const gl = makeGL(1, 4, 4);
    const only2 = [...METHODS_2].filter((name) => !METHODS_1.has(name));
    assert.ok(only2.length > 60, `expected many WebGL2-only methods, got ${only2.length}`);
    const leaked = only2.filter((name) => (gl as any)[name] !== undefined);
    assert.deepEqual(leaked, [], `WebGL2-only methods leaked onto a WebGL 1 context (${leaked.length})`);
    assert.equal((gl as any).createVertexArray, undefined);
    assert.equal((gl as any).texImage3D, undefined);
    assert.equal((gl as any).fenceSync, undefined);
    assert.equal((gl as any).drawBuffers, undefined);
    dispose(gl);
  });
});
