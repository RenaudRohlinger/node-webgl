# three.js examples

Headless WebGL 1/2 renders of three.js scenes on top of this package, backed by ANGLE (Metal on
macOS). Every script renders synchronously (no `requestAnimationFrame`, except `animation-loop.mjs`),
writes `out/<name>.png`, sanity-checks its own pixels (`gl.readPixels` + `gl.getError()`), logs
`ok <name> <ms>ms <w>x<h>`, and throws (non-zero exit) on failure.

Run everything: `node examples/run-all.mjs` (or `npm run examples`). Run one example directly with
`node examples/three/<name>.mjs`.

`textures.mjs` and `gltf-loader.mjs` use small assets committed in `assets/` (`uv-grid.png`,
`photo.jpg`); regenerate them with `node examples/assets/make-assets.mjs`.

## Examples (`three/`)

- `basic-scene.mjs` -- lit cube + sphere over a shadowed floor (MeshStandardMaterial/MeshPhysicalMaterial, PCF shadow maps, MSAA).
- `instancing.mjs` -- one draw call rendering 5,832 `InstancedMesh` boxes with per-instance color.
- `textures.mjs` -- `TextureLoader` (PNG + JPEG), `flipY` behavior, sRGB colorSpace, anisotropy, repeat wrapping + mipmaps, a `DataTexture`, and a `CanvasTexture` fed by real WebGL drawing.
- `pbr-environment.mjs` -- `PMREMGenerator` + `RoomEnvironment` lighting metal / rough / clearcoat / transmission `MeshPhysicalMaterial` spheres (exercises float/half-float and cube render targets).
- `postprocessing.mjs` -- `EffectComposer`: `RenderPass` -> `UnrealBloomPass` -> `OutputPass`.
- `render-targets.mjs` -- render-to-texture, a 2-attachment MRT `ShaderMaterial` writing `layout(location=1)`, a `WebGLCubeRenderTarget` used as an envMap, and a `DepthTexture` sampled in a second pass.
- `points-lines.mjs` -- vertex-colored `Points` with size attenuation, `LineSegments`, a fat `Line2`/`LineMaterial`, and a `Sprite`.
- `skinning-morph.mjs` -- a procedural `SkinnedMesh` (bones posed by rotation) combined with a nonzero morph-target bulge, applied together.
- `gltf-loader.mjs` -- `GLTFExporter` -> `GLTFLoader.parse()` round trip of a procedural scene, fully in memory.
- `shader-material.mjs` -- `RawShaderMaterial`/GLSL3 sampling a `sampler2DArray` (`DataArrayTexture`) and a `sampler3D` (`Data3DTexture`), a `ShaderMaterial` using screen-space derivatives (`fwidth`), and ACESFilmic tone mapping + sRGB output.
- `webgl1-fallback.mjs` -- no three.js: raw WebGL 1 instanced, textured quads (`ANGLE_instanced_arrays`, `OES_vertex_array_object`, `OES_texture_float`) rendered into a 2-attachment `WEBGL_draw_buffers` framebuffer, with both attachments read back and composited into one PNG.
- `animation-loop.mjs` -- `AnimationMixer` driven by `renderer.setAnimationLoop()` riding `installDOM()`'s `requestAnimationFrame`, for 30 frames.

