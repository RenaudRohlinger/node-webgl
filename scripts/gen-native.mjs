#!/usr/bin/env node
// Generates the N-API wrappers for every GLES 3.0 entry point plus the
// extension entry points WebGL needs, straight from the ANGLE headers.
//
//   node scripts/gen-native.mjs
//
// Output:
//   src/native/gl_bindings.inc  — C++ (function table, loader, wrappers, descriptors)
//   src/native-api.ts           — TypeScript declaration of the raw native surface
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inc = (p) => readFileSync(join(root, 'angle/include', p), 'utf8');

// Extension entry points (from gl2ext.h / gl2ext_angle.h) that WebGL extensions map onto.
const EXT_FUNCTIONS = [
  // ANGLE_instanced_arrays (WebGL 1) and the EXT spelling used by non-ANGLE drivers
  'glDrawArraysInstancedANGLE', 'glDrawElementsInstancedANGLE', 'glVertexAttribDivisorANGLE',
  'glDrawArraysInstancedEXT', 'glDrawElementsInstancedEXT', 'glVertexAttribDivisorEXT',
  // OES_vertex_array_object (WebGL 1)
  'glBindVertexArrayOES', 'glDeleteVertexArraysOES', 'glGenVertexArraysOES', 'glIsVertexArrayOES',
  // WEBGL_draw_buffers (WebGL 1)
  'glDrawBuffersEXT',
  // default framebuffer emulation on ES2 (non-requestable ANGLE extensions)
  'glBlitFramebufferANGLE', 'glRenderbufferStorageMultisampleANGLE',
  // EXT_disjoint_timer_query / EXT_disjoint_timer_query_webgl2
  'glGenQueriesEXT', 'glDeleteQueriesEXT', 'glIsQueryEXT', 'glBeginQueryEXT', 'glEndQueryEXT',
  'glQueryCounterEXT', 'glGetQueryivEXT', 'glGetQueryObjectivEXT', 'glGetQueryObjectuivEXT',
  'glGetQueryObjecti64vEXT', 'glGetQueryObjectui64vEXT',
  // ANGLE_request_extension
  'glRequestExtensionANGLE',
  // WEBGL_debug_shaders
  'glGetTranslatedShaderSourceANGLE',
  // WEBGL_lose_context
  'glLoseContextCHROMIUM',
  // EXT_robustness
  'glGetGraphicsResetStatusEXT',
  // WEBGL_multi_draw
  'glMultiDrawArraysANGLE', 'glMultiDrawArraysInstancedANGLE', 'glMultiDrawElementsANGLE', 'glMultiDrawElementsInstancedANGLE',
  // WEBGL_draw_instanced_base_vertex_base_instance / WEBGL_multi_draw_instanced_base_vertex_base_instance
  'glDrawArraysInstancedBaseInstanceANGLE', 'glDrawElementsInstancedBaseVertexBaseInstanceANGLE',
  'glMultiDrawArraysInstancedBaseInstanceANGLE', 'glMultiDrawElementsInstancedBaseVertexBaseInstanceANGLE',
  // OES_draw_buffers_indexed
  'glEnableiOES', 'glDisableiOES', 'glBlendEquationiOES', 'glBlendEquationSeparateiOES', 'glBlendFunciOES',
  'glBlendFuncSeparateiOES', 'glColorMaskiOES', 'glIsEnablediOES',
  // OVR_multiview2
  'glFramebufferTextureMultiviewOVR',
  // WEBGL_provoking_vertex
  'glProvokingVertexANGLE',
  // EXT_clip_control
  'glClipControlEXT',
  // EXT_polygon_offset_clamp
  'glPolygonOffsetClampEXT',
  // WEBGL_polygon_mode
  'glPolygonModeANGLE',
  // KHR_parallel_shader_compile
  'glMaxShaderCompilerThreadsKHR',
  // ANGLE_robust_client_memory: getters that report how many values they wrote
  'glGetBooleanvRobustANGLE', 'glGetFloatvRobustANGLE', 'glGetIntegervRobustANGLE', 'glGetInteger64vRobustANGLE',
  'glGetIntegeri_vRobustANGLE', 'glGetInteger64i_vRobustANGLE', 'glGetInternalformativRobustANGLE',
  'glGetProgramivRobustANGLE', 'glGetUniformfvRobustANGLE', 'glGetUniformivRobustANGLE', 'glGetUniformuivRobustANGLE',
  'glGetBufferParameteri64vRobustANGLE', 'glGetQueryObjectui64vRobustANGLE', 'glGetQueryObjecti64vRobustANGLE',
  'glGetTexParameterfvRobustANGLE', 'glGetTexParameterivRobustANGLE', 'glGetSamplerParameterfvRobustANGLE',
  'glGetSamplerParameterivRobustANGLE', 'glGetVertexAttribfvRobustANGLE', 'glGetVertexAttribivRobustANGLE',
  'glGetVertexAttribIivRobustANGLE', 'glGetVertexAttribIuivRobustANGLE', 'glGetFramebufferAttachmentParameterivRobustANGLE',
  'glGetRenderbufferParameterivRobustANGLE', 'glGetBufferParameterivRobustANGLE', 'glGetShaderivRobustANGLE',
  'glGetActiveUniformBlockivRobustANGLE', 'glGetQueryivRobustANGLE',
  'glGetQueryObjectuivRobustANGLE', 'glGetQueryObjectivRobustANGLE',
  // ANGLE_robust_client_memory: uploads/readbacks that validate against the client buffer size
  'glTexImage2DRobustANGLE', 'glTexSubImage2DRobustANGLE', 'glTexImage3DRobustANGLE', 'glTexSubImage3DRobustANGLE',
  'glReadPixelsRobustANGLE', 'glGetVertexAttribPointervRobustANGLE',
  // texture storage on WebGL 1 (used by the default framebuffer emulation)
  'glTexStorage2DEXT',
];

// Core entry points that WebGL never exposes and that need a hand-written path (or none at all).
const EXCLUDE = new Set([
  'glMapBufferRange', 'glUnmapBuffer', 'glFlushMappedBufferRange', // used by native getBufferSubData
  'glGetProgramBinary', 'glProgramBinary', 'glProgramParameteri',
  'glGetBufferPointerv',
]);

function parsePrototypes(src, only) {
  const re = /GL_APICALL\s+([\w\s\*]+?)\s*GL_APIENTRY\s+(gl\w+)\s*\(([^)]*)\)\s*;/g;
  // Extension blocks look like `#ifndef GL_EXT_draw_buffers ... #endif`; remember which one each prototype sits in.
  const blocks = [...src.matchAll(/^#ifndef (GL_\w+)\s*$/gm)].map((b) => ({ index: b.index, ext: b[1] }));
  const extAt = (index) => { let ext = ''; for (const b of blocks) { if (b.index > index) break; ext = b.ext; } return ext; };
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const [, ret, name, params] = m;
    if (only && !only.has(name)) continue;
    if (EXCLUDE.has(name)) continue;
    const args = params.trim() === 'void' || params.trim() === '' ? [] : params.split(',').map((p, i) => {
      p = p.trim().replace(/\s+/g, ' ').replace(/(\w+)\s*\[\]/, '*$1');
      if (!/\w$/.test(p)) p += ` a${i}`; // unnamed parameter
      // separate type and name; pointer stars may hug the name
      const nameMatch = /(\w+)$/.exec(p);
      const argName = nameMatch[1];
      let type = p.slice(0, p.length - argName.length).trim();
      type = type.replace(/\s*\*\s*/g, '*').replace(/\s+/g, ' ').trim();
      return { type, name: argName };
    });
    out.push({ ret: ret.replace(/\s*\*\s*/g, '*').trim(), name, args, ext: only ? extAt(m.index) : '' });
  }
  return out;
}

const gl3 = parsePrototypes(inc('GLES3/gl3.h'));
const only = new Set(EXT_FUNCTIONS);
const ext = [...parsePrototypes(inc('GLES2/gl2ext.h'), only), ...parsePrototypes(inc('GLES2/gl2ext_angle.h'), only)];
const seen = new Set(gl3.map((f) => f.name));
const fns = [...gl3];
for (const f of ext) if (!seen.has(f.name)) { seen.add(f.name); fns.push(f); }
const missing = EXT_FUNCTIONS.filter((n) => !seen.has(n));
if (missing.length) console.warn('WARNING: extension prototypes not found in headers:', missing.join(', '));

// --- classify a C parameter type into a marshalling kind -------------------
const SCALAR = {
  GLenum: 'u32', GLuint: 'u32', GLbitfield: 'u32',
  GLint: 'i32', GLsizei: 'i32',
  GLintptr: 'i64', GLsizeiptr: 'i64', GLint64: 'i64', GLuint64: 'u64',
  GLfloat: 'f32', GLclampf: 'f32',
  GLboolean: 'bool', GLubyte: 'u32', GLbyte: 'i32', GLshort: 'i32', GLushort: 'u32', GLfixed: 'i32',
  GLsync: 'sync',
};
function kindOf(type) {
  const stripped = type.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').trim();
  if (type === 'const GLchar*') return 'str';
  if (/^const GLchar\*\s*const\*$/.test(type) || type === 'const GLchar*const*') return 'strarr';
  if (/GLDEBUGPROC/.test(type)) return null;
  if (stripped.includes('*')) return 'ptr';
  if (SCALAR[stripped]) return SCALAR[stripped];
  return null;
}
function retKind(type) {
  if (type === 'void') return 'void';
  if (type === 'const GLubyte*') return 'cstr';
  if (type === 'GLboolean') return 'bool';
  if (type === 'GLsync') return 'sync';
  if (type === 'void*') return null;
  if (SCALAR[type]) return SCALAR[type];
  return null;
}
const jsName = (n) => n.replace(/^gl/, '').replace(/^[A-Z]/, (c) => c.toLowerCase());

const bound = [];
for (const f of fns) {
  const kinds = f.args.map((a) => kindOf(a.type));
  const rk = retKind(f.ret);
  if (kinds.includes(null) || rk === null) { console.warn('skip', f.name, f.ret, f.args.map((a) => a.type).join(', ')); continue; }
  bound.push({ ...f, kinds, rk });
}

// --- emit C++ ---------------------------------------------------------------
let cc = `// GENERATED by scripts/gen-native.mjs — do not edit.\n// ${bound.length} GL entry points.\n\n`;
cc += `struct GLFunctions {\n`;
for (const f of bound) cc += `  ${f.ret} (GL_APIENTRY *${f.name})(${f.args.map((a) => `${a.type} ${a.name}`).join(', ') || 'void'});\n`;
cc += `};\nstatic GLFunctions gl;\n\n`;
cc += `static void LoadGLFunctions(GetProcFn getProc) {\n`;
for (const f of bound) cc += `  gl.${f.name} = (decltype(gl.${f.name}))getProc("${f.name}");\n`;
cc += `}\n\n`;

const reader = { u32: 'ArgU32', i32: 'ArgI32', i64: 'ArgI64', u64: 'ArgU64', f32: 'ArgF32', bool: 'ArgBool', sync: 'ArgSync' };
for (const f of bound) {
  const n = f.args.length;
  cc += `static napi_value W_${f.name}(napi_env env, napi_callback_info info) {\n`;
  if (n) cc += `  size_t argc = ${n}; napi_value argv[${n}] = {}; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);\n`;
  else cc += `  (void)info;\n`;
  cc += `  if (!gl.${f.name}) return ThrowUnsupported(env, "${f.name}");\n`;
  const call = [];
  f.args.forEach((a, i) => {
    const k = f.kinds[i];
    if (k === 'str') { cc += `  std::string s${i}; ArgStr(env, argv[${i}], s${i});\n`; call.push(`s${i}.c_str()`); }
    else if (k === 'strarr') { cc += `  StrArray sa${i}(env, argv[${i}]);\n`; call.push(`sa${i}.ptrs()`); }
    else if (k === 'ptr') { cc += `  Ptr p${i} = ArgPtr(env, argv[${i}]);\n`; call.push(`(${a.type})p${i}.p`); }
    else if (k === 'sync') { call.push(`(GLsync)ArgSync(env, argv[${i}])`); }
    else { call.push(`(${a.type})${reader[k]}(env, argv[${i}])`); }
  });
  const expr = `gl.${f.name}(${call.join(', ')})`;
  switch (f.rk) {
    case 'void': cc += `  ${expr};\n  return nullptr;\n`; break;
    case 'bool': cc += `  return RetBool(env, ${expr} != GL_FALSE);\n`; break;
    case 'cstr': cc += `  return RetCStr(env, (const char*)${expr});\n`; break;
    case 'sync': cc += `  return RetNum(env, (double)(intptr_t)${expr});\n`; break;
    default: cc += `  return RetNum(env, (double)${expr});\n`;
  }
  cc += `}\n`;
}
cc += `\nstatic const napi_property_descriptor kGLBindings[] = {\n`;
for (const f of bound) cc += `  {"${jsName(f.name)}", nullptr, W_${f.name}, nullptr, nullptr, nullptr, napi_default, nullptr},\n`;
cc += `};\nstatic const size_t kGLBindingCount = ${bound.length};\n`;
cc += `\nstatic const char* const kGLFunctionNames[] = {\n${bound.map((f) => `  "${f.name}",`).join('\n')}\n};\n`;
cc += `// GL extension each entry point belongs to ("" = core). Drivers whose eglGetProcAddress hands out stubs for\n// unknown names (Mesa) need this to tell real extension functions from no-op placeholders.\n`;
cc += `static const char* const kGLFunctionExts[] = {\n${bound.map((f) => `  "${f.ext}",`).join('\n')}\n};\n`;
cc += `static void SetGLFunction(size_t i, GenericFn fn) {\n  switch (i) {\n${bound.map((f, i) => `    case ${i}: gl.${f.name} = (decltype(gl.${f.name}))fn; break;`).join('\n')}\n    default: break;\n  }\n}\n`;
cc += `static bool IsGLFunctionLoaded(size_t i) {\n  switch (i) {\n${bound.map((f, i) => `    case ${i}: return gl.${f.name} != nullptr;`).join('\n')}\n    default: return false;\n  }\n}\n`;
writeFileSync(join(root, 'src/native/gl_bindings.inc'), cc);

// --- emit TypeScript declaration ---------------------------------------------
const tsType = { u32: 'number', i32: 'number', i64: 'number', u64: 'number', f32: 'number', bool: 'GLboolean', sync: 'number', str: 'string', strarr: 'readonly string[]', ptr: 'Ptr' };
const tsRet = { void: 'void', bool: 'boolean', cstr: 'string | null', sync: 'number', u32: 'number', i32: 'number', i64: 'number', u64: 'number', f32: 'number' };
let ts = `// GENERATED by scripts/gen-native.mjs — do not edit.\n/** Anything that can be handed to GL as a pointer: a view, a raw buffer, a byte offset (when a PBO/VBO is bound) or null. */\nexport type Ptr = ArrayBufferView | ArrayBuffer | number | null | undefined;\nexport type GLboolean = boolean | number;\n\n/** Raw GLES entry points exposed by the native addon (1:1 with the C signatures, ids instead of objects). */\nexport interface NativeGL {\n`;
for (const f of bound) {
  ts += `  ${jsName(f.name)}(${f.args.map((a, i) => `${a.name}: ${tsType[f.kinds[i]]}`).join(', ')}): ${tsRet[f.rk]};\n`;
}
ts += `}\n`;
writeFileSync(join(root, 'src/native-api.ts'), ts);
console.log(`generated ${bound.length} bindings (${gl3.length} core, ${bound.length - gl3.filter(f=>!EXCLUDE.has(f.name)).length} extension)`);
