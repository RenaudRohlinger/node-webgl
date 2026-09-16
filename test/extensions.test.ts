// Extension discovery, the extension objects themselves and context loss / restore.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, WebGLContextEvent } from '../src/index.ts';
import { EXTENSIONS } from '../src/webgl/extensions.ts';
import { makeGL, dispose, program, shader, drawFullscreenQuad, readPixel, assertPixel, assertNoError, clearErrors, GLSL100, GLSL300, isANGLE } from './helpers.ts';

const CONTEXT_LOST_WEBGL = 0x9242;
const INVALID_ENUM = 0x0500;

/** Guaranteed by ANGLE on every backend (Metal, D3D11, Vulkan, GL) for both context versions. */
const SHARED_ALWAYS = ['EXT_texture_filter_anisotropic', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_lose_context'];

/** WebGL 2 extensions every ANGLE backend supports; the full WebGL 2-only set comes from the registry. */
const WEBGL2_ALWAYS = ['EXT_color_buffer_float'];
const WEBGL2_ONLY = EXTENSIONS.filter((e) => e.version === 2).map((e) => e.name);

/** WebGL 1 extensions every ANGLE backend supports; the full WebGL 1-only set comes from the registry. */
const WEBGL1_ALWAYS = [
  'ANGLE_instanced_arrays', 'OES_element_index_uint', 'OES_standard_derivatives', 'OES_texture_float',
  'OES_texture_half_float', 'OES_vertex_array_object', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
];
const WEBGL1_ONLY = EXTENSIONS.filter((e) => e.version === 1).map((e) => e.name);

describe('getSupportedExtensions', () => {
  test('WebGL 2 lists the expected extensions and no WebGL1-only ones', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(2, 8, 8);
    const list = gl.getSupportedExtensions();
    assert.ok(Array.isArray(list));
    assert.equal(new Set(list).size, list.length, 'no duplicates');
    for (const name of [...SHARED_ALWAYS, ...WEBGL2_ALWAYS]) {
      assert.ok(list.includes(name), `WebGL 2 should expose ${name}`);
    }
    for (const name of WEBGL1_ONLY) {
      assert.ok(!list.includes(name), `${name} is WebGL 1 only`);
      assert.equal(gl.getExtension(name), null, `getExtension(${name}) on WebGL 2`);
    }
    // the returned array is a copy
    list.push('nope');
    assert.ok(!gl.getSupportedExtensions().includes('nope'));
    dispose(gl);
  });

  test('WebGL 1 lists the expected extensions and no WebGL2-only ones', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(1, 8, 8);
    const list = gl.getSupportedExtensions();
    for (const name of [...SHARED_ALWAYS, ...WEBGL1_ALWAYS]) {
      assert.ok(list.includes(name), `WebGL 1 should expose ${name}`);
    }
    for (const name of WEBGL2_ONLY) {
      assert.ok(!list.includes(name), `${name} is WebGL 2 only`);
      assert.equal(gl.getExtension(name), null, `getExtension(${name}) on WebGL 1`);
    }
    dispose(gl);
  });

  test('getExtension is case-insensitive, memoised and null for unknown names', () => {
    const gl = makeGL(2, 8, 8);
    const a = gl.getExtension('WEBGL_lose_context');
    assert.ok(a);
    assert.equal(gl.getExtension('WEBGL_lose_context'), a, 'the same object is returned twice');
    assert.equal(gl.getExtension('webgl_lose_context'), a, 'lookup is case-insensitive');
    assert.equal(gl.getExtension('WeBgL_LoSe_CoNtExT'), a);
    assert.equal(gl.getExtension('NOT_AN_EXTENSION'), null);
    assert.equal(gl.getExtension(''), null);
    assertNoError(gl, 'getExtension never raises');
    dispose(gl);
  });

  test('OVR_multiview2 is absent in this build', (t) => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('OVR_multiview2');
    if (ext) return void t.skip('OVR_multiview2 is present after all');
    assert.equal(ext, null);
    assert.ok(!gl.getSupportedExtensions().includes('OVR_multiview2'));
    dispose(gl);
  });
});

describe('extension constants', () => {
  test('anisotropic filtering constants', () => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    assert.equal(ext.TEXTURE_MAX_ANISOTROPY_EXT, 0x84fe);
    assert.equal(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT, 0x84ff);
    assert.equal(Object.prototype.toString.call(ext), '[object EXT_texture_filter_anisotropic]');
    dispose(gl);
  });

  test('compressed-texture extensions expose their formats', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(2, 8, 8);
    const expectations: Record<string, Record<string, number>> = {
      WEBGL_compressed_texture_s3tc: {
        COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0, COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1,
        COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2, COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3,
      },
      WEBGL_compressed_texture_s3tc_srgb: {
        COMPRESSED_SRGB_S3TC_DXT1_EXT: 0x8c4c, COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: 0x8c4f,
      },
      WEBGL_compressed_texture_etc: {
        COMPRESSED_RGB8_ETC2: 0x9274, COMPRESSED_RGBA8_ETC2_EAC: 0x9278, COMPRESSED_R11_EAC: 0x9270,
      },
      WEBGL_compressed_texture_etc1: { COMPRESSED_RGB_ETC1_WEBGL: 0x8d64 },
      WEBGL_compressed_texture_pvrtc: { COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 0x8c00 },
      WEBGL_compressed_texture_astc: { COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0, COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR: 0x93dd },
      EXT_texture_compression_bptc: { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c },
      EXT_texture_compression_rgtc: { COMPRESSED_RED_RGTC1_EXT: 0x8dbb },
    };
    let checked = 0;
    for (const [name, consts] of Object.entries(expectations)) {
      const ext = gl.getExtension(name);
      if (!ext) continue; // depends on the GPU / backend
      checked++;
      for (const [k, v] of Object.entries(consts)) assert.equal(ext[k], v, `${name}.${k}`);
    }
    const astc = gl.getExtension('WEBGL_compressed_texture_astc');
    const profiles = astc.getSupportedProfiles();
    assert.ok(Array.isArray(profiles) && profiles.includes('ldr'), `ASTC profiles: ${profiles}`);
    assert.ok(checked >= 2, `at least S3TC/ETC-style compressed formats should exist, found ${checked}`);
    dispose(gl);
  });

  test('other constant-only extensions', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(2, 8, 8);
    assert.equal(gl.getExtension('EXT_texture_norm16').RGBA16_EXT, 0x805b);
    assert.equal(gl.getExtension('EXT_depth_clamp').DEPTH_CLAMP_EXT, 0x864f);
    assert.equal(gl.getExtension('EXT_texture_mirror_clamp_to_edge').MIRROR_CLAMP_TO_EDGE_EXT, 0x8743);
    assert.equal(gl.getExtension('KHR_parallel_shader_compile').COMPLETION_STATUS_KHR, 0x91b1);
    assert.equal(gl.getExtension('WEBGL_blend_func_extended').SRC1_COLOR_WEBGL, 0x88f9);
    assert.equal(gl.getExtension('WEBGL_clip_cull_distance').MAX_CLIP_DISTANCES_WEBGL, 0x0d32);
    assert.equal(gl.getExtension('WEBGL_stencil_texturing').DEPTH_STENCIL_TEXTURE_MODE_WEBGL, 0x90ea);
    assert.equal(gl.getExtension('EXT_color_buffer_half_float').RGBA16F_EXT, 0x881a);
    dispose(gl);
  });

  test('WebGL 1 extension constants', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(1, 8, 8);
    assert.equal(gl.getExtension('OES_standard_derivatives').FRAGMENT_SHADER_DERIVATIVE_HINT_OES, 0x8b8b);
    assert.equal(gl.getExtension('OES_vertex_array_object').VERTEX_ARRAY_BINDING_OES, 0x85b5);
    assert.equal(gl.getExtension('ANGLE_instanced_arrays').VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE, 0x88fe);
    assert.equal(gl.getExtension('WEBGL_depth_texture').UNSIGNED_INT_24_8_WEBGL, 0x84fa);
    assert.equal(gl.getExtension('EXT_sRGB').SRGB8_ALPHA8_EXT, 0x8c43);
    assert.equal(gl.getExtension('WEBGL_color_buffer_float').RGBA32F_EXT, 0x8814);
    assert.equal(gl.getExtension('EXT_blend_minmax').MIN_EXT, 0x8007);
    const db = gl.getExtension('WEBGL_draw_buffers');
    assert.equal(db.COLOR_ATTACHMENT0_WEBGL, 0x8ce0);
    assert.equal(db.MAX_DRAW_BUFFERS_WEBGL, 0x8824);
    assert.equal(db.DRAW_BUFFER0_WEBGL, 0x8825);
    const tq = gl.getExtension('EXT_disjoint_timer_query');
    assert.equal(tq.TIME_ELAPSED_EXT, 0x88bf);
    assert.equal(tq.GPU_DISJOINT_EXT, 0x8fbb);
    dispose(gl);
  });

  // KNOWN LIBRARY BUG: these WebGL 1 extension pnames share enum values with WebGL 2 core pnames
  // and are listed in WEBGL2_ONLY_PNAMES, so getParameter() rejects them on a WebGL 1 context.
  test('WebGL 1 extension pnames are readable once the extension is enabled', () => {
    const gl = makeGL(1, 8, 8);
    const deriv = gl.getExtension('OES_standard_derivatives');
    assert.equal(gl.getParameter(deriv.FRAGMENT_SHADER_DERIVATIVE_HINT_OES), gl.DONT_CARE);
    assertNoError(gl, 'FRAGMENT_SHADER_DERIVATIVE_HINT_OES');

    const db = gl.getExtension('WEBGL_draw_buffers');
    assert.ok(gl.getParameter(db.MAX_DRAW_BUFFERS_WEBGL) >= 4);
    assertNoError(gl, 'MAX_DRAW_BUFFERS_WEBGL');
    assert.ok(gl.getParameter(db.MAX_COLOR_ATTACHMENTS_WEBGL) >= 4);
    assertNoError(gl, 'MAX_COLOR_ATTACHMENTS_WEBGL');
    dispose(gl);
  });
});

describe('WEBGL_debug_renderer_info / WEBGL_debug_shaders', () => {
  test('unmasked vendor and renderer strings are non-empty', () => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    assert.ok(ext);
    assert.equal(ext.UNMASKED_VENDOR_WEBGL, 0x9245);
    assert.equal(ext.UNMASKED_RENDERER_WEBGL, 0x9246);
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    assert.equal(typeof vendor, 'string');
    assert.equal(typeof renderer, 'string');
    assert.ok(vendor.length > 0, 'UNMASKED_VENDOR_WEBGL');
    assert.ok(renderer.length > 0, 'UNMASKED_RENDERER_WEBGL');
    if (isANGLE()) assert.match(renderer, /ANGLE/i);
    // the masked strings are still the library's own
    assert.equal(gl.getParameter(gl.VENDOR), 'node-webgl');
    assertNoError(gl);
    dispose(gl);
  });

  test('getTranslatedShaderSource returns the backend shader text', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('WEBGL_debug_shaders');
    assert.ok(ext);
    const fs = shader(gl, gl.FRAGMENT_SHADER, GLSL300.fsSolid);
    const src = ext.getTranslatedShaderSource(fs);
    assert.equal(typeof src, 'string');
    assert.ok(src.length > 100, `translated source length ${src.length}`);
    const renderer: string = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    if (/metal/i.test(renderer)) assert.match(src, /metal_stdlib|#include|namespace metal/, 'the Metal backend emits MSL');
    else if (/direct3d|d3d11/i.test(renderer)) assert.match(src, /float4|SV_Target|cbuffer|Texture2D/, 'the D3D11 backend emits HLSL');
    else assert.match(src, /#version|layout|gl_FragColor|void main/, 'GL/Vulkan backends emit GLSL');
    assert.notEqual(src, GLSL300.fsSolid, 'it is not just the original GLSL');
    assertNoError(gl);
    dispose(gl);
  });
});

describe('WEBGL_multi_draw', () => {
  test('multiDrawArraysWEBGL issues several draws', (t) => {
    if (!isANGLE()) return t.skip('ANGLE-specific behavior');
    const gl = makeGL(2, 16, 1);
    const ext = gl.getExtension('WEBGL_multi_draw');
    assert.ok(ext, 'WEBGL_multi_draw is always available here');
    const p = program(gl, `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 0, 0, 1);
    const loc = gl.getAttribLocation(p, 'a_position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // two separate quads: the left half then the right half
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, -1, -1, 1, 0, 1,
      0, -1, 1, -1, 0, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    ext.multiDrawArraysWEBGL(gl.TRIANGLE_STRIP, [0], 0, [4], 0, 1);
    assertNoError(gl, 'multiDrawArraysWEBGL with drawcount 1');
    assertPixel(readPixel(gl, 4, 0), [255, 0, 0, 255], 2, 'left quad drawn');
    assertPixel(readPixel(gl, 12, 0), [0, 0, 0, 255], 2, 'right quad not drawn yet');

    gl.clear(gl.COLOR_BUFFER_BIT);
    ext.multiDrawArraysWEBGL(gl.TRIANGLE_STRIP, new Int32Array([0, 4]), 0, new Int32Array([4, 4]), 0, 2);
    assertNoError(gl, 'multiDrawArraysWEBGL with drawcount 2');
    assertPixel(readPixel(gl, 4, 0), [255, 0, 0, 255], 2, 'left quad');
    assertPixel(readPixel(gl, 12, 0), [255, 0, 0, 255], 2, 'right quad');

    // indexed variant
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]), gl.STATIC_DRAW);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 0, 1, 0, 1);
    ext.multiDrawElementsWEBGL(gl.TRIANGLES, new Int32Array([6, 6]), 0, gl.UNSIGNED_SHORT, new Int32Array([0, 12]), 0, 2);
    assertNoError(gl, 'multiDrawElementsWEBGL');
    assertPixel(readPixel(gl, 4, 0), [0, 255, 0, 255], 2);
    assertPixel(readPixel(gl, 12, 0), [0, 255, 0, 255], 2);
    dispose(gl);
  });
});

describe('state-setting extensions', () => {
  test('WEBGL_provoking_vertex', (t) => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('WEBGL_provoking_vertex');
    if (!ext) return void t.skip('WEBGL_provoking_vertex unavailable');
    assert.equal(ext.FIRST_VERTEX_CONVENTION_WEBGL, 0x8e4d);
    assert.equal(ext.LAST_VERTEX_CONVENTION_WEBGL, 0x8e4e);
    assert.equal(gl.getParameter(ext.PROVOKING_VERTEX_WEBGL), ext.LAST_VERTEX_CONVENTION_WEBGL);
    ext.provokingVertexWEBGL(ext.FIRST_VERTEX_CONVENTION_WEBGL);
    assertNoError(gl, 'provokingVertexWEBGL');
    assert.equal(gl.getParameter(ext.PROVOKING_VERTEX_WEBGL), ext.FIRST_VERTEX_CONVENTION_WEBGL);
    ext.provokingVertexWEBGL(ext.LAST_VERTEX_CONVENTION_WEBGL);
    dispose(gl);
  });

  test('EXT_clip_control', (t) => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('EXT_clip_control');
    if (!ext) return void t.skip('EXT_clip_control unavailable');
    assert.equal(gl.getParameter(ext.CLIP_ORIGIN_EXT), ext.LOWER_LEFT_EXT);
    assert.equal(gl.getParameter(ext.CLIP_DEPTH_MODE_EXT), ext.NEGATIVE_ONE_TO_ONE_EXT);
    ext.clipControlEXT(ext.UPPER_LEFT_EXT, ext.ZERO_TO_ONE_EXT);
    assertNoError(gl, 'clipControlEXT');
    assert.equal(gl.getParameter(ext.CLIP_ORIGIN_EXT), ext.UPPER_LEFT_EXT);
    assert.equal(gl.getParameter(ext.CLIP_DEPTH_MODE_EXT), ext.ZERO_TO_ONE_EXT);
    ext.clipControlEXT(ext.LOWER_LEFT_EXT, ext.NEGATIVE_ONE_TO_ONE_EXT);
    dispose(gl);
  });

  test('WEBGL_polygon_mode', (t) => {
    const gl = makeGL(2, 16, 16);
    const ext = gl.getExtension('WEBGL_polygon_mode');
    if (!ext) return void t.skip('WEBGL_polygon_mode unavailable');
    assert.equal(gl.getParameter(ext.POLYGON_MODE_WEBGL), ext.FILL_WEBGL);
    ext.polygonModeWEBGL(gl.FRONT_AND_BACK, ext.LINE_WEBGL);
    assertNoError(gl, 'polygonModeWEBGL');
    assert.equal(gl.getParameter(ext.POLYGON_MODE_WEBGL), ext.LINE_WEBGL);
    ext.polygonModeWEBGL(gl.FRONT_AND_BACK, ext.FILL_WEBGL);
    assertNoError(gl);
    dispose(gl);
  });

  test('EXT_polygon_offset_clamp', (t) => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('EXT_polygon_offset_clamp');
    if (!ext) return void t.skip('EXT_polygon_offset_clamp unavailable');
    ext.polygonOffsetClampEXT(1, 2, 0.5);
    assertNoError(gl, 'polygonOffsetClampEXT');
    assert.equal(gl.getParameter(ext.POLYGON_OFFSET_CLAMP_EXT), 0.5);
    ext.polygonOffsetClampEXT(0, 0, 0);
    dispose(gl);
  });

  test('KHR_parallel_shader_compile eventually reports completion', async () => {
    const gl = makeGL(2, 8, 8);
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    assert.ok(ext, 'KHR_parallel_shader_compile is always available here');
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);

    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      done = gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
      assert.equal(typeof done, 'boolean');
      if (!done) await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(done, true, 'COMPLETION_STATUS_KHR became true');
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true);

    const s = shader(gl, gl.VERTEX_SHADER, GLSL300.vsQuad);
    assert.equal(typeof gl.getShaderParameter(s, ext.COMPLETION_STATUS_KHR), 'boolean');
    assertNoError(gl);
    dispose(gl);
  });

  test('COMPLETION_STATUS_KHR needs the extension first', () => {
    const gl = makeGL(2, 8, 8);
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    assert.equal(gl.getProgramParameter(p, 0x91b1), null);
    assert.equal(gl.getError(), INVALID_ENUM);
    dispose(gl);
  });
});

describe('WEBGL_lose_context', () => {
  test('losing and restoring a context', async () => {
    const canvas = createCanvas(16, 16);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    const ext = gl.getExtension('WEBGL_lose_context');
    assert.ok(ext, 'WEBGL_lose_context is always available');

    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [0, 255, 0, 255], 0);

    const events: Event[] = [];
    canvas.addEventListener('webglcontextlost', (e) => {
      events.push(e);
      e.preventDefault(); // allow restoreContext()
    });
    const restored = new Promise<Event>((resolve) => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));

    assert.equal(gl.isContextLost(), false);
    ext.loseContext();
    assert.equal(gl.isContextLost(), true);
    assert.equal(events.length, 1, 'a webglcontextlost event was dispatched');
    assert.ok(events[0] instanceof WebGLContextEvent);
    assert.equal(events[0].type, 'webglcontextlost');
    assert.equal(events[0].cancelable, true);
    assert.equal((events[0] as any).statusMessage.length > 0, true);

    // CONTEXT_LOST_WEBGL exactly once, then NO_ERROR
    assert.equal(gl.getError(), CONTEXT_LOST_WEBGL);
    assert.equal(gl.getError(), 0);
    assert.equal(gl.getError(), 0);

    // every entry point becomes a no-op
    assert.equal(gl.getParameter(gl.MAX_TEXTURE_SIZE), null);
    assert.equal(gl.getContextAttributes(), null);
    assert.equal(gl.getSupportedExtensions(), null);
    assert.equal(gl.getExtension('WEBGL_lose_context'), null);
    assert.equal(gl.createBuffer(), null);
    assert.equal(gl.createTexture(), null);
    assert.equal(gl.createProgram(), null);
    assert.equal(gl.createShader(gl.VERTEX_SHADER), null);
    assert.equal(gl.createFramebuffer(), null);
    assert.equal(gl.createVertexArray(), null);
    assert.equal(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), null);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), 0);
    assert.equal(gl.isBuffer(null as any), false);
    assert.equal(gl.isEnabled(gl.BLEND), false);
    assert.equal(gl.drawingBufferWidth, 0);
    assert.equal(gl.drawingBufferHeight, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, 4, 4);
    assert.equal(gl.getError(), 0, 'no-op calls raise nothing');

    // a second loseContext is an error
    ext.loseContext();
    assert.equal(gl.getError(), 0x0502);

    ext.restoreContext();
    const ev = await restored;
    assert.equal(ev.type, 'webglcontextrestored');
    assert.equal(gl.isContextLost(), false);
    assert.equal(gl.drawingBufferWidth, 16);
    assert.ok(gl.getContextAttributes());

    // and the context works again
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 8, 8), [0, 0, 255, 255], 0, 'rendering works after restore');
    const p = program(gl, GLSL300.vsQuad, GLSL300.fsSolid);
    gl.useProgram(p);
    gl.uniform4f(gl.getUniformLocation(p, 'u_color'), 1, 1, 0, 1);
    drawFullscreenQuad(gl, p);
    assertPixel(readPixel(gl, 8, 8), [255, 255, 0, 255], 0, 'drawing works after restore');
    assertNoError(gl);
    canvas.dispose();
  });

  test('without preventDefault the context cannot be restored', () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context');
    let seen = 0;
    canvas.addEventListener('webglcontextlost', () => { seen++; });
    ext.loseContext();
    assert.equal(seen, 1);
    assert.equal(gl.getError(), CONTEXT_LOST_WEBGL);
    ext.restoreContext();
    assert.equal(gl.isContextLost(), true, 'restore is refused when the event was not cancelled');
    assert.equal(gl.getError(), 0x0502);
    canvas.dispose();
  });

  test('WebGL 1 loses and restores too', async () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext('webgl', { antialias: false })!;
    const ext = gl.getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    const restored = new Promise((r) => canvas.addEventListener('webglcontextrestored', r, { once: true }));
    ext.loseContext();
    assert.equal(gl.isContextLost(), true);
    assert.equal((gl as any).getExtension('OES_vertex_array_object'), null);
    ext.restoreContext();
    await restored;
    assert.equal(gl.isContextLost(), false);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertPixel(readPixel(gl, 4, 4), [255, 0, 0, 255], 0);
    assert.ok(gl.getExtension('OES_vertex_array_object'), 'extensions come back after restore');
    clearErrors(gl);
    canvas.dispose();
  });
});
