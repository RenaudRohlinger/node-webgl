{
  "targets": [
    {
      "target_name": "node_webgl",
      "sources": ["src/native/addon.cc"],
      "include_dirs": ["angle/include"],
      "defines": ["NAPI_VERSION=8"],
      "cflags_cc": ["-std=c++17", "-fvisibility=hidden"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/native/image_apple.mm"],
          "libraries": [
            "<(module_root_dir)/angle/lib/darwin-<(target_arch)/libEGL.a",
            "<(module_root_dir)/angle/lib/darwin-<(target_arch)/libGLESv2.a",
            "<(module_root_dir)/angle/lib/darwin-<(target_arch)/libANGLE.a",
            "-framework Metal",
            "-framework QuartzCore",
            "-framework IOSurface",
            "-framework IOKit",
            "-framework CoreGraphics",
            "-framework CoreFoundation",
            "-framework Foundation",
            "-framework ImageIO",
            "-framework OpenGL",
            "-framework Cocoa"
          ],
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fvisibility=hidden", "-Wno-deprecated-declarations"],
            "OTHER_LDFLAGS": ["-Wl,-dead_strip"]
          }
        }],
        ["OS=='win'", {
          "libraries": [
            "<(module_root_dir)/angle/lib/win32-<(target_arch)/libEGL.lib",
            "<(module_root_dir)/angle/lib/win32-<(target_arch)/libGLESv2.lib",
            "<(module_root_dir)/angle/lib/win32-<(target_arch)/libANGLE.lib",
            "d3d11.lib", "dxgi.lib", "dxguid.lib", "d3d9.lib", "gdi32.lib", "user32.lib", "synchronization.lib", "dcomp.lib", "delayimp.lib"
          ],
          "defines": ["KHRONOS_STATIC", "EGLAPI=", "GL_APICALL=", "ANGLE_STATIC", "NOMINMAX", "WIN32_LEAN_AND_MEAN"],
          "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"]}}
        }],
        ["OS=='linux'", {
          "libraries": ["-ldl"],
          "defines": ["NODE_WEBGL_DYNAMIC_EGL"]
        }]
      ]
    }
  ]
}
