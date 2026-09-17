# @onirenaud/swiftshader-vulkan

[SwiftShader](https://github.com/google/swiftshader)'s Vulkan driver, built from the
revision Chrome bundles, packaged as a Vulkan ICD for Linux (x64 and arm64). It is the
CPU implementation Chrome uses for WebGPU on machines without a GPU, so Dawn-based tools
such as the [`webgpu`](https://www.npmjs.com/package/webgpu) package render exactly what
Chrome renders there.

```sh
npm install @onirenaud/swiftshader-vulkan
```

```js
import { vulkanEnvironment } from '@onirenaud/swiftshader-vulkan';
import { create } from 'webgpu';

Object.assign( process.env, vulkanEnvironment() ); // VK_DRIVER_FILES / VK_ICD_FILENAMES, before the first Vulkan call
const gpu = create( [ 'backend=vulkan' ] );
const adapter = await gpu.requestAdapter(); // SwiftShader Device (Subzero)
```

The loader must be installed (`libvulkan1` on Debian/Ubuntu, part of `mesa-vulkan-drivers`'
dependencies on the GitHub runners). Point `VK_DRIVER_FILES` at the ICD from a shell to use
it with any Vulkan program:

```sh
export VK_DRIVER_FILES="$(node -p "require.resolve('@onirenaud/swiftshader-vulkan/package.json').replace('package.json', 'linux-x64/vk_swiftshader_icd.json')")"
```

`package.json` records which Chromium release the SwiftShader revision was taken from
(`swiftshader.chromium`: Chrome 152, SwiftShader `5b0479bd2d15` for 0.1.0). Builds come from
[`swiftshader.yml`](../../.github/workflows/swiftshader.yml): `REACTOR_BACKEND=Subzero` on x64
like Chrome, the LLVM backend on arm64 where Subzero has no code generator.

SwiftShader is Copyright 2016 The SwiftShader Authors, Apache License 2.0 (see LICENSE).
