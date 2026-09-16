// Image decode/encode through ImageIO (PNG, JPEG, GIF, WebP, HEIC, ...) on Apple platforms.
// Exposed as decodeImage(bytes) -> { width, height, data: Uint8Array (RGBA8, straight alpha) }
// and encodeImage(width, height, rgba, mime, quality) -> Uint8Array.
#include <node_api.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <Foundation/Foundation.h>

#include <cstdint>
#include <cstring>
#include <string>

namespace {

struct Bytes { const uint8_t* p; size_t len; };

Bytes ViewBytes(napi_env env, napi_value v) {
  bool is = false;
  napi_is_typedarray(env, v, &is);
  if (is) {
    napi_typedarray_type t; size_t len; void* data; napi_value ab; size_t off;
    napi_get_typedarray_info(env, v, &t, &len, &data, &ab, &off);
    size_t es = 1;
    switch (t) { case napi_int16_array: case napi_uint16_array: es = 2; break; case napi_int32_array: case napi_uint32_array: case napi_float32_array: es = 4; break; case napi_float64_array: case napi_bigint64_array: case napi_biguint64_array: es = 8; break; default: break; }
    return {(const uint8_t*)data, len * es};
  }
  napi_is_arraybuffer(env, v, &is);
  if (is) { void* data; size_t len; napi_get_arraybuffer_info(env, v, &data, &len); return {(const uint8_t*)data, len}; }
  return {nullptr, 0};
}

napi_value NewUint8Array(napi_env env, size_t len, uint8_t** out) {
  napi_value ab, arr;
  void* data = nullptr;
  napi_create_arraybuffer(env, len, &data, &ab);
  napi_create_typedarray(env, napi_uint8_array, len, ab, 0, &arr);
  *out = (uint8_t*)data;
  return arr;
}

napi_value Fail(napi_env env, const char* msg) { napi_throw_error(env, nullptr, msg); return nullptr; }

}  // namespace

napi_value DecodeImageApple(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Bytes b = ViewBytes(env, argv[0]);
  if (!b.p || !b.len) return Fail(env, "decodeImage: expected a Uint8Array/ArrayBuffer with encoded image bytes");

  CFDataRef data = CFDataCreateWithBytesNoCopy(kCFAllocatorDefault, b.p, (CFIndex)b.len, kCFAllocatorNull);
  CGImageSourceRef src = CGImageSourceCreateWithData(data, nullptr);
  CFRelease(data);
  if (!src) return Fail(env, "decodeImage: unrecognized image data");
  CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0, nullptr);
  CFRelease(src);
  if (!img) return Fail(env, "decodeImage: could not decode image");

  size_t w = CGImageGetWidth(img), h = CGImageGetHeight(img);
  CGImageAlphaInfo ai = CGImageGetAlphaInfo(img);
  bool hasAlpha = !(ai == kCGImageAlphaNone || ai == kCGImageAlphaNoneSkipLast || ai == kCGImageAlphaNoneSkipFirst);

  uint8_t* out = nullptr;
  napi_value arr = NewUint8Array(env, w * h * 4, &out);
  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef ctx = CGBitmapContextCreate(out, w, h, 8, w * 4, cs, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(cs);
  if (!ctx) { CGImageRelease(img); return Fail(env, "decodeImage: could not create bitmap context"); }
  CGContextSetBlendMode(ctx, kCGBlendModeCopy);
  CGContextDrawImage(ctx, CGRectMake(0, 0, (CGFloat)w, (CGFloat)h), img);
  CGContextRelease(ctx);
  CGImageRelease(img);

  if (hasAlpha) {  // CG only hands out premultiplied 8-bit RGBA; undo it (WebGL wants straight alpha).
    for (size_t i = 0; i < w * h * 4; i += 4) {
      uint8_t a = out[i + 3];
      if (a == 0 || a == 255) continue;
      out[i] = (uint8_t)std::min(255u, (out[i] * 255u + a / 2) / a);
      out[i + 1] = (uint8_t)std::min(255u, (out[i + 1] * 255u + a / 2) / a);
      out[i + 2] = (uint8_t)std::min(255u, (out[i + 2] * 255u + a / 2) / a);
    }
  }
  napi_value result, vw, vh, va;
  napi_create_object(env, &result);
  napi_create_uint32(env, (uint32_t)w, &vw);
  napi_create_uint32(env, (uint32_t)h, &vh);
  napi_get_boolean(env, hasAlpha, &va);
  napi_set_named_property(env, result, "width", vw);
  napi_set_named_property(env, result, "height", vh);
  napi_set_named_property(env, result, "data", arr);
  napi_set_named_property(env, result, "hasAlpha", va);
  return result;
}

napi_value EncodeImageApple(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value argv[5] = {};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t w = 0, h = 0; double quality = 0.92;
  napi_get_value_uint32(env, argv[0], &w);
  napi_get_value_uint32(env, argv[1], &h);
  Bytes px = ViewBytes(env, argv[2]);
  char mime[64] = "image/png"; size_t ml = 0;
  napi_get_value_string_utf8(env, argv[3], mime, sizeof mime, &ml);
  napi_valuetype qt; napi_typeof(env, argv[4], &qt);
  if (qt == napi_number) napi_get_value_double(env, argv[4], &quality);
  if (!px.p || px.len < (size_t)w * h * 4) return Fail(env, "encodeImage: pixel buffer too small");

  CFStringRef uti = CFSTR("public.png");
  std::string m(mime);
  if (m == "image/jpeg" || m == "image/jpg") uti = CFSTR("public.jpeg");
  else if (m == "image/webp") uti = CFSTR("org.webmproject.webp");
  else if (m == "image/heic") uti = CFSTR("public.heic");
  else if (m == "image/tiff") uti = CFSTR("public.tiff");
  else if (m == "image/bmp") uti = CFSTR("com.microsoft.bmp");
  else if (m == "image/gif") uti = CFSTR("com.compuserve.gif");

  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGDataProviderRef provider = CGDataProviderCreateWithData(nullptr, px.p, (size_t)w * h * 4, nullptr);
  CGBitmapInfo bi = (uti == CFSTR("public.jpeg") ? kCGImageAlphaNoneSkipLast : kCGImageAlphaLast) | kCGBitmapByteOrder32Big;
  CGImageRef img = CGImageCreate(w, h, 8, 32, (size_t)w * 4, cs, bi, provider, nullptr, false, kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CGColorSpaceRelease(cs);
  if (!img) return Fail(env, "encodeImage: could not create image");

  CFMutableDataRef outData = CFDataCreateMutable(kCFAllocatorDefault, 0);
  CGImageDestinationRef dest = CGImageDestinationCreateWithData(outData, uti, 1, nullptr);
  if (!dest) { CGImageRelease(img); CFRelease(outData); return Fail(env, "encodeImage: unsupported output format"); }
  CFNumberRef q = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &quality);
  const void* keys[] = {kCGImageDestinationLossyCompressionQuality};
  const void* vals[] = {q};
  CFDictionaryRef props = CFDictionaryCreate(kCFAllocatorDefault, keys, vals, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CGImageDestinationAddImage(dest, img, props);
  bool ok = CGImageDestinationFinalize(dest);
  CFRelease(props); CFRelease(q); CFRelease(dest); CGImageRelease(img);
  if (!ok) { CFRelease(outData); return Fail(env, "encodeImage: encoding failed"); }

  uint8_t* out = nullptr;
  size_t len = (size_t)CFDataGetLength(outData);
  napi_value arr = NewUint8Array(env, len, &out);
  memcpy(out, CFDataGetBytePtr(outData), len);
  CFRelease(outData);
  return arr;
}
