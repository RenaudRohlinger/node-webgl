// Windows only. Godot's static ANGLE build references Arm's astcenc decoder (used for CPU-side ASTC
// decompression on GPUs without ASTC support) but ships it as a separate library that is not part of
// the release archive. These stubs satisfy the linker and make ANGLE report the decode as unsupported.
#if defined(_WIN32)
#include <cstddef>
#include <cstdint>

struct astcenc_config;
struct astcenc_context;
struct astcenc_image;
struct astcenc_swizzle;
enum astcenc_error {
  ASTCENC_SUCCESS = 0, ASTCENC_ERR_OUT_OF_MEM, ASTCENC_ERR_BAD_CPU_FLOAT, ASTCENC_ERR_BAD_PARAM,
  ASTCENC_ERR_BAD_BLOCK_SIZE, ASTCENC_ERR_BAD_PROFILE, ASTCENC_ERR_BAD_QUALITY, ASTCENC_ERR_BAD_SWIZZLE,
  ASTCENC_ERR_BAD_FLAGS, ASTCENC_ERR_BAD_CONTEXT, ASTCENC_ERR_NOT_IMPLEMENTED, ASTCENC_ERR_BAD_DECODE_MODE,
};
enum astcenc_profile { ASTCENC_PRF_LDR_SRGB = 0, ASTCENC_PRF_LDR, ASTCENC_PRF_HDR_RGB_LDR_A, ASTCENC_PRF_HDR };

astcenc_error astcenc_config_init(astcenc_profile, unsigned int, unsigned int, unsigned int, float, unsigned int, astcenc_config*) {
  return ASTCENC_ERR_NOT_IMPLEMENTED;
}
astcenc_error astcenc_context_alloc(const astcenc_config*, unsigned int, astcenc_context**) {
  return ASTCENC_ERR_NOT_IMPLEMENTED;
}
astcenc_error astcenc_decompress_image(astcenc_context*, const uint8_t*, size_t, astcenc_image*, const astcenc_swizzle*, unsigned int) {
  return ASTCENC_ERR_NOT_IMPLEMENTED;
}
astcenc_error astcenc_decompress_reset(astcenc_context*) {
  return ASTCENC_ERR_NOT_IMPLEMENTED;
}
void astcenc_context_free(astcenc_context*) {}
const char* astcenc_get_error_string(astcenc_error) {
  return "ASTC software decoding is not available in this build";
}
#endif
