# Changelog

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
