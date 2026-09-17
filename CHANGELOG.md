# Changelog

## 0.1.2

- `texImage2D` / `texSubImage2D` / `texImage3D` no longer apply `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` to `ImageBitmap` sources, as the WebGL spec requires (the `createImageBitmap()` options `imageOrientation` / `premultiplyAlpha` decide). Other sources (`ImageData`, `Image`, canvases, raw `{ width, height, data }`) are unchanged.

## 0.1.1

- Version bump, no code changes.

## 0.1.0

- Initial release: WebGL 1 + 2 on ANGLE (Metal / D3D11 / Mesa), canvas, image codecs, DOM shim, 246 tests, 12 three.js examples.
