# @onirenaud/swiftshader-vulkan

[SwiftShader](https://github.com/google/swiftshader)'s Vulkan driver, the CPU implementation
Chrome uses for WebGPU on machines without a GPU, packaged as a Vulkan ICD for Linux. Dawn-based
tools such as the [`webgpu`](https://www.npmjs.com/package/webgpu) package render exactly what
Chrome renders there, which is what the three.js screenshot baselines are made of.

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

The Vulkan loader must be installed (`libvulkan1` on Debian/Ubuntu; the GitHub runners have it
through `mesa-vulkan-drivers`). Any Vulkan program can use the driver from a shell:

```sh
export VK_DRIVER_FILES="$(node -p "require.resolve('@onirenaud/swiftshader-vulkan/package.json').replace('package.json', 'linux-x64/vk_swiftshader_icd.json')")"
```

## What is in it

| Platform | Origin |
|---|---|
| `linux-x64` | `libvk_swiftshader.so` and its ICD from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) 152.0.7977.54, unmodified. Chrome builds SwiftShader with Chromium's toolchain; a build of the same revision from source renders a few pixels differently, so the binary Chrome ships is the one that matches browser output. |
| `linux-arm64` | Built from SwiftShader revision `5b0479bd2d15` (the one Chrome 152 pins) with the LLVM Reactor backend, since Chrome has no Linux arm64 build. Close to Chrome's output but not pixel-identical. |

`package.json` records the Chrome version and SwiftShader revision under `swiftshader`. Builds and
packaging come from [`swiftshader.yml`](../../.github/workflows/swiftshader.yml).

SwiftShader is Copyright 2016 The SwiftShader Authors, Apache License 2.0 (see LICENSE).
