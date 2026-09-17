# Changelog

## 0.2.0

Desktop OpenGL on Linux, so headless renders clip exactly like Chrome:

- On a non-ANGLE EGL (Mesa), contexts now run on a desktop OpenGL core profile whenever the driver can compile GLSL ES on it (`ARB_ES3_compatibility`, OpenGL 3.3+). That is the context type Chrome's ANGLE drives on Linux, so wide points and lines at the viewport edge or crossing the near plane are clipped by their centres and endpoints like in the browser; Mesa's OpenGL ES contexts clip them after widening, which is why three.js' point-sprite and grid-helper screenshots differed. `init({ api: 'gl' | 'gles' | 'auto' })` and `NODE_WEBGL_API` choose; `getDisplayInfo().api` and `.glVersion` report.
- What GLES has implicitly is provided on the desktop profile: a default vertex array, shader-written point sizes, seamless cube maps, sRGB framebuffer encoding, the fixed primitive restart index, `GENERATE_MIPMAP_HINT`, `RED_BITS` & co., `ALIASED_POINT_SIZE_RANGE`, `LUMINANCE` / `ALPHA` / `LUMINANCE_ALPHA` textures (red / red-green storage with a swizzle), WebGL 1's unsized float and half-float formats, `HALF_FLOAT_OES`, `SRGB_EXT`, `#version 100` for shaders without a version directive, and the desktop spellings of the extensions WebGL exposes (`ARB_timer_query`, `ARB_clip_control`, `ARB_draw_buffers_blend`, ...). `EXT_shader_texture_lod` is not available on that profile (Mesa only accepts it in ES contexts).
- WebGL validation the driver no longer performs there is done in JavaScript: framebuffers with color attachments WebGL calls non-renderable (`RGB16F`, `RGB32F`, `SRGB8`, snorm, luminance, floats without the color-buffer-float extensions) report `FRAMEBUFFER_INCOMPLETE_ATTACHMENT` and refuse draws and clears, and `blitFramebuffer` into a multisampled draw framebuffer raises `INVALID_OPERATION`.
- The Linux CI job runs the suite on both client APIs.

## 0.1.3

Fixes for drivers other than ANGLE (Mesa on Linux), found while running the three.js example suite on llvmpipe:

- New depth and stencil storage (renderbuffers, depth textures, `texStorage2D`/`3D`) is initialized to depth 1.0 and stencil 0, as WebGL specifies and ANGLE's robust resource initialization provides. Mesa left it at 0, so anything rendered into a fresh target without a clear failed the depth test: three.js' `PMREMGenerator.fromScene()` produced a black environment, which darkened every scene lit by `RoomEnvironment`.
- `getActiveUniform()` / `getActiveAttrib()` no longer return `null` when an unrelated GL error was pending; the pending error is queued for `getError()` instead. three.js threw `Cannot read properties of null (reading 'name')` after an unsupported compressed-texture upload.
- `WEBGL_clip_cull_distance` is available on drivers exposing `GL_EXT_clip_cull_distance`, and `#extension GL_ANGLE_clip_cull_distance` in shaders is mapped to the EXT name for them.

## 0.1.2

- `texImage2D` / `texSubImage2D` / `texImage3D` no longer apply `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` to `ImageBitmap` sources, as the WebGL spec requires (the `createImageBitmap()` options `imageOrientation` / `premultiplyAlpha` decide). Other sources (`ImageData`, `Image`, canvases, raw `{ width, height, data }`) are unchanged.

## 0.1.1

- Version bump, no code changes.

## 0.1.0

- Initial release: WebGL 1 + 2 on ANGLE (Metal / D3D11 / Mesa), canvas, image codecs, DOM shim, 246 tests, 12 three.js examples.
