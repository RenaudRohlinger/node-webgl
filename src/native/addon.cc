// node-webgl native addon: a thin N-API layer over ANGLE's EGL + GLES entry points.
//
// Everything WebGL-specific (object wrappers, validation, default framebuffer
// emulation, extensions) lives in the TypeScript layer. This file only:
//   * owns the EGL display and contexts (created with ANGLE's WebGL-compat attributes)
//   * marshals JS values into C arguments for the generated GL wrappers
//   * implements the handful of calls that cannot be expressed 1:1 (getBufferSubData)
#include <node_api.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#define GL_GLES_PROTOTYPES 0
#define GL_GLEXT_PROTOTYPES 0
#if defined(NODE_WEBGL_DYNAMIC_EGL)
#define EGL_EGL_PROTOTYPES 0
#endif
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <EGL/eglext_angle.h>
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>
#include <GLES2/gl2ext_angle.h>

#ifndef GL_APIENTRY
#define GL_APIENTRY
#endif

#if !defined(_WIN32)
#include <dlfcn.h>
#endif

namespace {

typedef void (*GenericFn)(void);
typedef GenericFn (*GetProcFn)(const char*);

// ---------------------------------------------------------------------------
// EGL entry points: statically linked ANGLE by default, or loaded at runtime from
// libEGL / libGLESv2 (NODE_WEBGL_LIBEGL / NODE_WEBGL_LIBGLESV2, or the platform defaults).
// ---------------------------------------------------------------------------
struct EGLApi {
  PFNEGLGETPROCADDRESSPROC GetProcAddress = nullptr;
  PFNEGLGETDISPLAYPROC GetDisplay = nullptr;
  PFNEGLINITIALIZEPROC Initialize = nullptr;
  PFNEGLTERMINATEPROC Terminate = nullptr;
  PFNEGLBINDAPIPROC BindAPI = nullptr;
  PFNEGLCHOOSECONFIGPROC ChooseConfig = nullptr;
  PFNEGLQUERYSTRINGPROC QueryString = nullptr;
  PFNEGLCREATECONTEXTPROC CreateContext = nullptr;
  PFNEGLDESTROYCONTEXTPROC DestroyContext = nullptr;
  PFNEGLCREATEPBUFFERSURFACEPROC CreatePbufferSurface = nullptr;
  PFNEGLDESTROYSURFACEPROC DestroySurface = nullptr;
  PFNEGLMAKECURRENTPROC MakeCurrent = nullptr;
  PFNEGLGETERRORPROC GetError = nullptr;
  void* libEGL = nullptr;
  void* libGLES = nullptr;
  bool dynamic = false;
  bool ok() const { return GetProcAddress && GetDisplay && Initialize && BindAPI && ChooseConfig && QueryString && CreateContext && DestroyContext && MakeCurrent && GetError; }
};
EGLApi egl;

#if !defined(_WIN32)
void* OpenLibrary(const char* envName, const char* const* candidates) {
  const char* env = getenv(envName);
  if (env && *env) return dlopen(env, RTLD_NOW | RTLD_GLOBAL);
  for (const char* const* c = candidates; *c; ++c) {
    void* h = dlopen(*c, RTLD_NOW | RTLD_GLOBAL);
    if (h) return h;
  }
  return nullptr;
}
#endif

// Returns an empty string on success, otherwise a description of what could not be loaded.
std::string LoadEGL() {
  if (egl.ok()) return "";
  const char* forced = getenv("NODE_WEBGL_LIBEGL");
#if !defined(NODE_WEBGL_DYNAMIC_EGL)
  if (!forced || !*forced) {
    egl.GetProcAddress = eglGetProcAddress;
    egl.GetDisplay = eglGetDisplay;
    egl.Initialize = eglInitialize;
    egl.Terminate = eglTerminate;
    egl.BindAPI = eglBindAPI;
    egl.ChooseConfig = eglChooseConfig;
    egl.QueryString = eglQueryString;
    egl.CreateContext = eglCreateContext;
    egl.DestroyContext = eglDestroyContext;
    egl.CreatePbufferSurface = eglCreatePbufferSurface;
    egl.DestroySurface = eglDestroySurface;
    egl.MakeCurrent = eglMakeCurrent;
    egl.GetError = eglGetError;
    egl.dynamic = false;
    return "";
  }
#endif
#if defined(_WIN32)
  (void)forced;
  return "dynamic EGL loading is not supported on Windows; use the static ANGLE build";
#else
#if defined(__APPLE__)
  static const char* const eglNames[] = {"libEGL.dylib", nullptr};
  static const char* const glesNames[] = {"libGLESv2.dylib", nullptr};
#else
  static const char* const eglNames[] = {"libEGL.so.1", "libEGL.so", nullptr};
  static const char* const glesNames[] = {"libGLESv2.so.2", "libGLESv2.so", nullptr};
#endif
  egl.libGLES = OpenLibrary("NODE_WEBGL_LIBGLESV2", glesNames);  // may be unnecessary (libEGL pulls it in), harmless
  egl.libEGL = OpenLibrary("NODE_WEBGL_LIBEGL", eglNames);
  if (!egl.libEGL) {
    std::string err = "could not load libEGL (";
    err += forced && *forced ? forced : eglNames[0];
    err += "): ";
    const char* d = dlerror();
    err += d ? d : "unknown error";
    return err;
  }
  auto sym = [&](const char* name) { return dlsym(egl.libEGL, name); };
  egl.GetProcAddress = (PFNEGLGETPROCADDRESSPROC)sym("eglGetProcAddress");
  egl.GetDisplay = (PFNEGLGETDISPLAYPROC)sym("eglGetDisplay");
  egl.Initialize = (PFNEGLINITIALIZEPROC)sym("eglInitialize");
  egl.Terminate = (PFNEGLTERMINATEPROC)sym("eglTerminate");
  egl.BindAPI = (PFNEGLBINDAPIPROC)sym("eglBindAPI");
  egl.ChooseConfig = (PFNEGLCHOOSECONFIGPROC)sym("eglChooseConfig");
  egl.QueryString = (PFNEGLQUERYSTRINGPROC)sym("eglQueryString");
  egl.CreateContext = (PFNEGLCREATECONTEXTPROC)sym("eglCreateContext");
  egl.DestroyContext = (PFNEGLDESTROYCONTEXTPROC)sym("eglDestroyContext");
  egl.CreatePbufferSurface = (PFNEGLCREATEPBUFFERSURFACEPROC)sym("eglCreatePbufferSurface");
  egl.DestroySurface = (PFNEGLDESTROYSURFACEPROC)sym("eglDestroySurface");
  egl.MakeCurrent = (PFNEGLMAKECURRENTPROC)sym("eglMakeCurrent");
  egl.GetError = (PFNEGLGETERRORPROC)sym("eglGetError");
  egl.dynamic = true;
  return egl.ok() ? "" : "libEGL is missing core EGL entry points";
#endif
}

// GL entry points come from eglGetProcAddress, falling back to the GLES library's exports.
GenericFn GetProc(const char* name) {
  GenericFn fn = egl.GetProcAddress ? (GenericFn)egl.GetProcAddress(name) : nullptr;
#if !defined(_WIN32)
  if (!fn && egl.libGLES) fn = (GenericFn)dlsym(egl.libGLES, name);
  if (!fn && egl.libEGL) fn = (GenericFn)dlsym(egl.libEGL, name);
#endif
  return fn;
}

// ---------------------------------------------------------------------------
// Argument marshalling (WebIDL-ish coercions: NaN -> 0, modulo 2^32 for ints)
// ---------------------------------------------------------------------------
inline double ArgNum(napi_env env, napi_value v) {
  double d;
  if (napi_get_value_double(env, v, &d) == napi_ok) return d;
  napi_value n;
  if (napi_coerce_to_number(env, v, &n) != napi_ok || napi_get_value_double(env, n, &d) != napi_ok) return 0;
  return d;
}
inline int32_t ArgI32(napi_env env, napi_value v) {
  double d = ArgNum(env, v);
  if (!std::isfinite(d)) return 0;
  double t = std::trunc(d);
  if (t >= -2147483648.0 && t <= 2147483647.0) return (int32_t)t;
  return (int32_t)(uint32_t)(int64_t)std::fmod(t, 4294967296.0);
}
inline uint32_t ArgU32(napi_env env, napi_value v) {
  double d = ArgNum(env, v);
  if (!std::isfinite(d)) return 0;
  double t = std::trunc(d);
  if (t >= 0 && t <= 4294967295.0) return (uint32_t)t;
  return (uint32_t)(int64_t)std::fmod(t, 4294967296.0);
}
inline int64_t ArgI64(napi_env env, napi_value v) {
  double d = ArgNum(env, v);
  if (!std::isfinite(d)) return 0;
  if (d >= 9223372036854775807.0) return INT64_MAX;
  if (d <= -9223372036854775808.0) return INT64_MIN;
  return (int64_t)std::trunc(d);
}
inline uint64_t ArgU64(napi_env env, napi_value v) {
  double d = ArgNum(env, v);
  if (!std::isfinite(d)) return 0;
  if (d < 0) return (uint64_t)(int64_t)std::trunc(d);  // e.g. -1 -> GL_TIMEOUT_IGNORED
  if (d >= 18446744073709551615.0) return UINT64_MAX;
  return (uint64_t)std::trunc(d);
}
inline float ArgF32(napi_env env, napi_value v) { return (float)ArgNum(env, v); }
inline bool ArgBool(napi_env env, napi_value v) {
  bool b;
  if (napi_get_value_bool(env, v, &b) == napi_ok) return b;
  napi_value c;
  if (napi_coerce_to_bool(env, v, &c) != napi_ok || napi_get_value_bool(env, c, &b) != napi_ok) return false;
  return b;
}
inline void* ArgSync(napi_env env, napi_value v) { return (void*)(intptr_t)ArgI64(env, v); }

struct Ptr {
  void* p;
  size_t len;
};
inline size_t ElemSize(napi_typedarray_type t) {
  switch (t) {
    case napi_int8_array: case napi_uint8_array: case napi_uint8_clamped_array: return 1;
    case napi_int16_array: case napi_uint16_array: return 2;
    case napi_int32_array: case napi_uint32_array: case napi_float32_array: return 4;
    case napi_float64_array: case napi_bigint64_array: case napi_biguint64_array: return 8;
    default: return 1;
  }
}
// A view/buffer becomes a pointer, a number becomes an offset (PBO / VBO bound), null/undefined -> nullptr.
inline Ptr ArgPtr(napi_env env, napi_value v) {
  napi_valuetype t;
  napi_typeof(env, v, &t);
  if (t == napi_number) {
    double d;
    napi_get_value_double(env, v, &d);
    return {(void*)(intptr_t)(int64_t)d, 0};
  }
  if (t != napi_object) return {nullptr, 0};
  bool is = false;
  napi_is_typedarray(env, v, &is);
  if (is) {
    napi_typedarray_type tt;
    size_t len;
    void* data;
    napi_value ab;
    size_t off;
    napi_get_typedarray_info(env, v, &tt, &len, &data, &ab, &off);
    return {data, len * ElemSize(tt)};
  }
  napi_is_arraybuffer(env, v, &is);
  if (is) {
    void* data;
    size_t len;
    napi_get_arraybuffer_info(env, v, &data, &len);
    return {data, len};
  }
  napi_is_dataview(env, v, &is);
  if (is) {
    size_t len;
    void* data;
    napi_value ab;
    size_t off;
    napi_get_dataview_info(env, v, &len, &data, &ab, &off);
    return {data, len};
  }
  return {nullptr, 0};
}
inline bool ArgStr(napi_env env, napi_value v, std::string& out) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) {
    napi_value s;
    if (napi_coerce_to_string(env, v, &s) != napi_ok) return false;
    v = s;
    if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) return false;
  }
  out.resize(len);
  if (len) napi_get_value_string_utf8(env, v, &out[0], len + 1, &len);
  return true;
}
struct StrArray {
  std::vector<std::string> store;
  std::vector<const char*> p;
  StrArray(napi_env env, napi_value v) {
    bool isArr = false;
    napi_is_array(env, v, &isArr);
    if (!isArr) return;
    uint32_t n = 0;
    napi_get_array_length(env, v, &n);
    store.resize(n);
    for (uint32_t i = 0; i < n; i++) {
      napi_value e;
      napi_get_element(env, v, i, &e);
      ArgStr(env, e, store[i]);
    }
    for (auto& s : store) p.push_back(s.c_str());
  }
  const GLchar* const* ptrs() const { return p.empty() ? nullptr : (const GLchar* const*)p.data(); }
};
inline napi_value RetNum(napi_env env, double d) { napi_value r; napi_create_double(env, d, &r); return r; }
inline napi_value RetBool(napi_env env, bool b) { napi_value r; napi_get_boolean(env, b, &r); return r; }
inline napi_value RetCStr(napi_env env, const char* s) {
  napi_value r;
  if (!s) { napi_get_null(env, &r); return r; }
  napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &r);
  return r;
}
inline napi_value RetStr(napi_env env, const std::string& s) { return RetCStr(env, s.c_str()); }
inline napi_value ThrowUnsupported(napi_env env, const char* fn) {
  std::string msg = std::string(fn) + " is not available in this ANGLE build";
  napi_throw_error(env, "ERR_GL_UNSUPPORTED", msg.c_str());
  return nullptr;
}
inline napi_value Throw(napi_env env, const std::string& msg) {
  napi_throw_error(env, nullptr, msg.c_str());
  return nullptr;
}
inline napi_value Undefined(napi_env env) { napi_value u; napi_get_undefined(env, &u); return u; }
inline void SetProp(napi_env env, napi_value obj, const char* name, napi_value v) { napi_set_named_property(env, obj, name, v); }
inline bool GetProp(napi_env env, napi_value obj, const char* name, napi_value* out) {
  bool has = false;
  napi_valuetype t;
  if (napi_typeof(env, obj, &t) != napi_ok || t != napi_object) return false;
  napi_has_named_property(env, obj, name, &has);
  if (!has) return false;
  napi_get_named_property(env, obj, name, out);
  napi_typeof(env, *out, &t);
  return t != napi_undefined;
}
inline int32_t OptI32(napi_env env, napi_value obj, const char* name, int32_t def) { napi_value v; return GetProp(env, obj, name, &v) ? ArgI32(env, v) : def; }
inline bool OptBool(napi_env env, napi_value obj, const char* name, bool def) { napi_value v; return GetProp(env, obj, name, &v) ? ArgBool(env, v) : def; }
inline std::string OptStr(napi_env env, napi_value obj, const char* name, const char* def) { napi_value v; std::string s; if (GetProp(env, obj, name, &v) && ArgStr(env, v, s)) return s; return def; }

// Generated: GL function table, loader, wrappers and property descriptors.
#include "gl_bindings.inc"

// Drops extension entry points whose extension the driver does not advertise. Needed for non-ANGLE
// EGL implementations: Mesa's eglGetProcAddress returns a callable no-op stub for any "gl*" name.
void PruneUnadvertisedExtensions(const char* glExtensions) {
  std::string exts = std::string(" ") + (glExtensions ? glExtensions : "") + " ";
  for (size_t i = 0; i < kGLBindingCount; i++) {
    const char* ext = kGLFunctionExts[i];
    if (!ext || !*ext) continue;
    if (exts.find(std::string(" ") + ext + " ") == std::string::npos) SetGLFunction(i, nullptr);
  }
}

// ---------------------------------------------------------------------------
// EGL display + contexts
// ---------------------------------------------------------------------------
struct Context {
  EGLContext ctx = EGL_NO_CONTEXT;
  EGLSurface surface = EGL_NO_SURFACE;
  int major = 3;
  int minor = 0;
};

struct Display {
  EGLDisplay dpy = EGL_NO_DISPLAY;
  EGLConfig config = nullptr;
  bool surfaceless = false;
  bool glLoaded = false;
  bool isAngle = false;
  std::string backend;
  std::string extensions;
  std::string vendor;
  std::string version;
  bool has(const char* ext) const {
    std::string needle = std::string(" ") + ext + " ";
    return (" " + extensions + " ").find(needle) != std::string::npos;
  }
};

Display g_display;
std::vector<Context*> g_contexts;  // handle = index + 1
Context* g_current = nullptr;

PFNGLMAPBUFFERRANGEPROC p_glMapBufferRange = nullptr;
PFNGLUNMAPBUFFERPROC p_glUnmapBuffer = nullptr;

std::string EglErrorString() {
  EGLint e = egl.GetError();
  char buf[64];
  snprintf(buf, sizeof buf, "EGL error 0x%04x", e);
  return buf;
}

bool BackendAttribs(const std::string& backend, std::vector<EGLint>& attrs, std::string& err) {
  EGLint type = EGL_PLATFORM_ANGLE_TYPE_DEFAULT_ANGLE;
  EGLint device = 0;
  if (backend == "metal") type = EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE;
  else if (backend == "gl" || backend == "opengl") type = EGL_PLATFORM_ANGLE_TYPE_OPENGL_ANGLE;
  else if (backend == "gles") type = EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE;
  else if (backend == "vulkan") type = EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE;
  else if (backend == "swiftshader") { type = EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE; device = EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE; }
  else if (backend == "d3d11") type = EGL_PLATFORM_ANGLE_TYPE_D3D11_ANGLE;
  else if (backend == "null") type = EGL_PLATFORM_ANGLE_TYPE_NULL_ANGLE;
  else if (backend == "default" || backend.empty()) type = EGL_PLATFORM_ANGLE_TYPE_DEFAULT_ANGLE;
  else { err = "unknown backend '" + backend + "'"; return false; }
  attrs = {EGL_PLATFORM_ANGLE_TYPE_ANGLE, type};
  if (device) { attrs.push_back(EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE); attrs.push_back(device); }
  attrs.push_back(EGL_NONE);
  return true;
}

#ifndef EGL_PLATFORM_SURFACELESS_MESA
#define EGL_PLATFORM_SURFACELESS_MESA 0x31DD
#endif

bool HasClientExtension(const char* ext) {
  const char* s = egl.QueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS);
  if (!s) return false;
  std::string needle = std::string(" ") + ext + " ";
  return (" " + std::string(s) + " ").find(needle) != std::string::npos;
}

bool TryInitDisplay(const std::string& backend, std::string& err) {
  std::vector<EGLint> attrs;
  if (!BackendAttribs(backend, attrs, err)) return false;
  auto getPlatformDisplayEXT = (PFNEGLGETPLATFORMDISPLAYEXTPROC)egl.GetProcAddress("eglGetPlatformDisplayEXT");
  EGLDisplay dpy = EGL_NO_DISPLAY;
  bool isAngle = HasClientExtension("EGL_ANGLE_platform_angle");
  if (isAngle && getPlatformDisplayEXT) {
    dpy = getPlatformDisplayEXT(EGL_PLATFORM_ANGLE_ANGLE, (void*)EGL_DEFAULT_DISPLAY, attrs.data());
  } else if (backend != "default" && !backend.empty()) {
    err = "backend selection needs ANGLE (EGL_ANGLE_platform_angle not available)";
    return false;
  } else if (getPlatformDisplayEXT && HasClientExtension("EGL_MESA_platform_surfaceless")) {
    dpy = getPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA, (void*)EGL_DEFAULT_DISPLAY, nullptr);  // headless Mesa
  } else {
    dpy = egl.GetDisplay(EGL_DEFAULT_DISPLAY);
  }
  if (dpy == EGL_NO_DISPLAY) { err = "eglGetPlatformDisplay failed: " + EglErrorString(); return false; }
  EGLint major = 0, minor = 0;
  if (!egl.Initialize(dpy, &major, &minor)) { err = "eglInitialize failed (" + backend + "): " + EglErrorString(); return false; }
  if (!egl.BindAPI(EGL_OPENGL_ES_API)) { err = "eglBindAPI failed: " + EglErrorString(); egl.Terminate(dpy); return false; }
  const EGLint cfgAttrs[] = {
      EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
      EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
      EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
      EGL_DEPTH_SIZE, 0, EGL_STENCIL_SIZE, 0,
      EGL_NONE};
  EGLConfig config = nullptr;
  EGLint n = 0;
  if (!egl.ChooseConfig(dpy, cfgAttrs, &config, 1, &n) || n < 1) {
    // Fall back to any pbuffer-capable config.
    const EGLint loose[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
    if (!egl.ChooseConfig(dpy, loose, &config, 1, &n) || n < 1) { err = "eglChooseConfig found no config: " + EglErrorString(); egl.Terminate(dpy); return false; }
  }
  g_display.dpy = dpy;
  g_display.config = config;
  g_display.isAngle = isAngle;
  g_display.backend = isAngle ? (backend.empty() ? "default" : backend) : "egl";
  const char* ext = egl.QueryString(dpy, EGL_EXTENSIONS);
  g_display.extensions = ext ? ext : "";
  const char* vendor = egl.QueryString(dpy, EGL_VENDOR);
  g_display.vendor = vendor ? vendor : "";
  const char* version = egl.QueryString(dpy, EGL_VERSION);
  g_display.version = version ? version : "";
  g_display.surfaceless = g_display.has("EGL_KHR_surfaceless_context");
  return true;
}

napi_value DisplayInfo(napi_env env) {
  napi_value o;
  napi_create_object(env, &o);
  SetProp(env, o, "backend", RetStr(env, g_display.backend));
  SetProp(env, o, "vendor", RetStr(env, g_display.vendor));
  SetProp(env, o, "version", RetStr(env, g_display.version));
  SetProp(env, o, "extensions", RetStr(env, g_display.extensions));
  SetProp(env, o, "surfaceless", RetBool(env, g_display.surfaceless));
  SetProp(env, o, "dynamic", RetBool(env, egl.dynamic));
  SetProp(env, o, "angle", RetBool(env, g_display.isAngle));
  return o;
}

// init({ backend?: string }) -> display info. Idempotent.
napi_value Init(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (g_display.dpy != EGL_NO_DISPLAY) return DisplayInfo(env);
  std::string loadErr = LoadEGL();
  if (!loadErr.empty()) return Throw(env, "node-webgl: " + loadErr);
  std::string requested = OptStr(env, argv[0], "backend", "");
  if (requested.empty()) {
    const char* envBackend = getenv("NODE_WEBGL_BACKEND");
    if (envBackend && *envBackend) requested = envBackend;
  }
  std::vector<std::string> candidates;
  if (!requested.empty()) candidates.push_back(requested);
  else {
#if defined(__APPLE__)
    candidates = {"metal", "gl", "default"};
#elif defined(_WIN32)
    candidates = {"d3d11", "vulkan", "gl", "default"};
#else
    candidates = {"vulkan", "gl", "gles", "swiftshader", "default"};
#endif
  }
  if (!HasClientExtension("EGL_ANGLE_platform_angle")) candidates = {"default"};
  std::string errors;
  for (const auto& c : candidates) {
    std::string err;
    if (TryInitDisplay(c, err)) return DisplayInfo(env);
    errors += (errors.empty() ? "" : "; ") + err;
  }
  return Throw(env, "node-webgl: could not initialize ANGLE: " + errors);
}

// createContext({ major, minor, webgl, robustness, robustResourceInit, powerPreference }) -> handle
napi_value CreateContext(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (g_display.dpy == EGL_NO_DISPLAY) return Throw(env, "node-webgl: init() must be called before createContext()");
  const Display& D = g_display;
  int major = OptI32(env, argv[0], "major", 3);
  int minor = OptI32(env, argv[0], "minor", 0);
  bool webgl = OptBool(env, argv[0], "webgl", true);
  bool robustness = OptBool(env, argv[0], "robustness", true);
  bool robustInit = OptBool(env, argv[0], "robustResourceInit", true);
  bool extensionsEnabled = OptBool(env, argv[0], "extensionsEnabled", false);
  std::string power = OptStr(env, argv[0], "powerPreference", "default");

  std::vector<EGLint> a = {EGL_CONTEXT_MAJOR_VERSION, major, EGL_CONTEXT_MINOR_VERSION, minor};
  // Ask for exactly the requested ES version (ANGLE otherwise hands out the highest compatible one).
  if (D.has("EGL_ANGLE_create_context_backwards_compatible")) { a.push_back(EGL_CONTEXT_OPENGL_BACKWARDS_COMPATIBLE_ANGLE); a.push_back(EGL_FALSE); }
  if (D.has("EGL_ANGLE_create_context_webgl_compatibility")) { a.push_back(EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE); a.push_back(webgl ? EGL_TRUE : EGL_FALSE); }
  if (D.has("EGL_CHROMIUM_create_context_bind_generates_resource")) { a.push_back(EGL_CONTEXT_BIND_GENERATES_RESOURCE_CHROMIUM); a.push_back(EGL_FALSE); }
  if (D.has("EGL_ANGLE_create_context_client_arrays")) { a.push_back(EGL_CONTEXT_CLIENT_ARRAYS_ENABLED_ANGLE); a.push_back(EGL_FALSE); }
  if (robustInit && D.has("EGL_ANGLE_robust_resource_initialization")) { a.push_back(EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE); a.push_back(EGL_TRUE); }
  if (D.has("EGL_ANGLE_create_context_extensions_enabled")) { a.push_back(EGL_EXTENSIONS_ENABLED_ANGLE); a.push_back(extensionsEnabled ? EGL_TRUE : EGL_FALSE); }
  if (robustness && D.has("EGL_EXT_create_context_robustness")) {
    a.push_back(EGL_CONTEXT_OPENGL_ROBUST_ACCESS_EXT); a.push_back(EGL_TRUE);
    a.push_back(EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT); a.push_back(EGL_LOSE_CONTEXT_ON_RESET_EXT);
  }
  if (D.has("EGL_ANGLE_power_preference") && power != "default") {
    a.push_back(EGL_POWER_PREFERENCE_ANGLE);
    a.push_back(power == "low-power" ? EGL_LOW_POWER_ANGLE : EGL_HIGH_POWER_ANGLE);
  }
  a.push_back(EGL_NONE);

  EGLContext ctx = egl.CreateContext(D.dpy, D.config, EGL_NO_CONTEXT, a.data());
  if (ctx == EGL_NO_CONTEXT) return Throw(env, "eglCreateContext failed: " + EglErrorString());
  EGLSurface surface = EGL_NO_SURFACE;
  if (!D.surfaceless) {
    const EGLint pb[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    surface = egl.CreatePbufferSurface(D.dpy, D.config, pb);
    if (surface == EGL_NO_SURFACE) { egl.DestroyContext(D.dpy, ctx); return Throw(env, "eglCreatePbufferSurface failed: " + EglErrorString()); }
  }
  if (!egl.MakeCurrent(D.dpy, surface, surface, ctx)) {
    std::string e = EglErrorString();
    if (surface != EGL_NO_SURFACE) egl.DestroySurface(D.dpy, surface);
    egl.DestroyContext(D.dpy, ctx);
    return Throw(env, "eglMakeCurrent failed: " + e);
  }
  if (!g_display.glLoaded) {
    LoadGLFunctions(GetProc);
    if (!g_display.isAngle && gl.glGetString) PruneUnadvertisedExtensions((const char*)gl.glGetString(GL_EXTENSIONS));
    p_glMapBufferRange = (PFNGLMAPBUFFERRANGEPROC)GetProc("glMapBufferRange");
    p_glUnmapBuffer = (PFNGLUNMAPBUFFERPROC)GetProc("glUnmapBuffer");
    g_display.glLoaded = true;
  }
  Context* c = new Context();
  c->ctx = ctx;
  c->surface = surface;
  c->major = major;
  c->minor = minor;
  g_current = c;
  size_t slot = g_contexts.size();
  for (size_t i = 0; i < g_contexts.size(); i++) if (!g_contexts[i]) { slot = i; break; }
  if (slot == g_contexts.size()) g_contexts.push_back(c); else g_contexts[slot] = c;
  return RetNum(env, (double)(slot + 1));
}

Context* GetContext(napi_env env, napi_value v) {
  int32_t h = ArgI32(env, v);
  if (h <= 0 || (size_t)h > g_contexts.size()) return nullptr;
  return g_contexts[h - 1];
}

napi_value MakeCurrent(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Context* c = GetContext(env, argv[0]);
  if (!c) return Throw(env, "makeCurrent: invalid context handle");
  if (c == g_current) return RetBool(env, true);
  if (!egl.MakeCurrent(g_display.dpy, c->surface, c->surface, c->ctx)) return Throw(env, "eglMakeCurrent failed: " + EglErrorString());
  g_current = c;
  return RetBool(env, true);
}

napi_value DestroyContext(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Context* c = GetContext(env, argv[0]);
  if (!c) return Undefined(env);
  if (c == g_current) {
    egl.MakeCurrent(g_display.dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    g_current = nullptr;
  }
  egl.DestroyContext(g_display.dpy, c->ctx);
  if (c->surface != EGL_NO_SURFACE) egl.DestroySurface(g_display.dpy, c->surface);
  for (auto& slot : g_contexts) if (slot == c) slot = nullptr;
  delete c;
  return Undefined(env);
}

// getBufferSubData(target, srcByteOffset, dst, dstByteOffset, byteLength) -> boolean
// GLES has no glGetBufferSubData; map the range read-only and copy.
napi_value GetBufferSubData(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (!p_glMapBufferRange || !p_glUnmapBuffer) return ThrowUnsupported(env, "glMapBufferRange");
  GLenum target = ArgU32(env, argv[0]);
  int64_t srcOffset = ArgI64(env, argv[1]);
  Ptr dst = ArgPtr(env, argv[2]);
  int64_t dstOffset = ArgI64(env, argv[3]);
  int64_t length = ArgI64(env, argv[4]);
  if (!dst.p || length < 0 || dstOffset < 0 || (size_t)(dstOffset + length) > dst.len) return RetBool(env, false);
  if (length == 0) return RetBool(env, true);
  void* src = p_glMapBufferRange(target, (GLintptr)srcOffset, (GLsizeiptr)length, GL_MAP_READ_BIT);
  if (!src) return RetBool(env, false);
  memcpy((uint8_t*)dst.p + dstOffset, src, (size_t)length);
  p_glUnmapBuffer(target);
  return RetBool(env, true);
}

// loadedFunctions() -> string[] of GL entry points that resolved (extension availability probing).
napi_value LoadedFunctions(napi_env env, napi_callback_info) {
  napi_value arr;
  napi_create_array(env, &arr);
  uint32_t n = 0;
  for (size_t i = 0; i < kGLBindingCount; i++) {
    if (!IsGLFunctionLoaded(i)) continue;
    napi_value s;
    napi_create_string_utf8(env, kGLFunctionNames[i], NAPI_AUTO_LENGTH, &s);
    napi_set_element(env, arr, n++, s);
  }
  return arr;
}

napi_value GetProcAvailable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string name;
  ArgStr(env, argv[0], name);
  return RetBool(env, GetProc(name.c_str()) != nullptr);
}

}  // namespace

#if defined(__APPLE__)
napi_value DecodeImageApple(napi_env env, napi_callback_info info);
napi_value EncodeImageApple(napi_env env, napi_callback_info info);
#endif

NAPI_MODULE_INIT() {
  std::vector<napi_property_descriptor> props(kGLBindings, kGLBindings + kGLBindingCount);
  auto add = [&](const char* name, napi_callback cb) {
    props.push_back({name, nullptr, cb, nullptr, nullptr, nullptr, napi_default, nullptr});
  };
  add("init", Init);
  add("createContext", CreateContext);
  add("makeCurrent", MakeCurrent);
  add("destroyContext", DestroyContext);
  add("getBufferSubData", GetBufferSubData);
  add("loadedFunctions", LoadedFunctions);
  add("hasProc", GetProcAvailable);
#if defined(__APPLE__)
  add("decodeImage", DecodeImageApple);
  add("encodeImage", EncodeImageApple);
#endif
  napi_define_properties(env, exports, props.size(), props.data());
  return exports;
}
