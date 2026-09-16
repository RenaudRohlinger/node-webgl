/**
 * Dependency-free PNG encoder/decoder for Node.js.
 *
 * The only Node API used is `node:zlib` for the DEFLATE/INFLATE transform in
 * the zlib-wrapped IDAT payload. Chunk framing, CRC32, scanline filtering,
 * Adam7 interlacing, and palette/tRNS handling are implemented from scratch.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Checks whether `bytes` starts with the 8-byte PNG signature. */
export function isPNG(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

// CRC32, table-based (zlib/PNG polynomial 0xedb88320) so we never depend on zlib.crc32.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// --- Encoder ---

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Forward scanline filter: 0=None 1=Sub 2=Up 3=Average 4=Paeth. */
function applyFilter(type: number, out: Uint8Array, cur: Uint8Array, prev: Uint8Array | null, bpp: number): void {
  for (let i = 0; i < cur.length; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    let v: number;
    switch (type) {
      case 0: v = cur[i]; break;
      case 1: v = cur[i] - a; break;
      case 2: v = cur[i] - b; break;
      case 3: v = cur[i] - ((a + b) >> 1); break;
      default: v = cur[i] - paethPredictor(a, b, c); break;
    }
    out[i] = v & 0xff;
  }
}

/** Min-sum-of-absolute-differences heuristic cost (bytes treated as signed) used to pick a filter. */
function filterCost(row: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

/**
 * Encodes tightly-packed, top-row-first RGBA8 pixels as a PNG (color type 6,
 * bit depth 8), auto-selecting the cheapest of the 5 scanline filters per row.
 * @throws {RangeError} if `rgba` is shorter than `width * height * 4` bytes.
 */
export function encodePNG(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  options?: { compressionLevel?: number },
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`encodePNG: invalid dimensions ${width}x${height}`);
  }
  const required = width * height * 4;
  if (rgba.length < required) {
    throw new RangeError(`encodePNG: rgba buffer too small, need ${required} bytes, got ${rgba.length}`);
  }
  const src = rgba instanceof Uint8ClampedArray
    ? new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    : rgba;
  const bpp = 4;
  const stride = width * bpp;
  const filtered = new Uint8Array((stride + 1) * height);
  const scratch = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));

  let prevRow: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const cur = src.subarray(rowStart, rowStart + stride);

    let bestType = 0;
    let bestCost = Infinity;
    for (let t = 0; t < 5; t++) {
      applyFilter(t, scratch[t], cur, prevRow, bpp);
      const cost = filterCost(scratch[t]);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = t;
      }
    }

    const outStart = y * (stride + 1);
    filtered[outStart] = bestType;
    filtered.set(scratch[bestType], outStart + 1);
    prevRow = cur;
  }

  const compressed = deflateSync(filtered, { level: options?.compressionLevel ?? 6 });

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8); // bit depth 8, color type RGBA, compression/filter/interlace methods 0

  return concatBytes([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
}

// --- Decoder ---

interface RawChunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): RawChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: RawChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error(`malformed PNG: truncated '${type}' chunk`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (view.getUint32(dataEnd, false) !== crc32(bytes.subarray(offset + 4, dataEnd))) {
      throw new Error(`malformed PNG: CRC mismatch in '${type}' chunk`);
    }
    chunks.push({ type, data });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 || chunks[0].type !== 'IHDR') throw new Error('malformed PNG: missing IHDR chunk');
  return chunks;
}

/** Reverses the 5 PNG scanline filters for `rows` consecutive scanlines starting at `cursor.pos`. */
function unfilterScanlines(src: Uint8Array, cursor: { pos: number }, rowBytes: number, rows: number, bpp: number): Uint8Array {
  const out = new Uint8Array(rowBytes * rows);
  let pos = cursor.pos;
  let prevRowStart = -1;
  for (let y = 0; y < rows; y++) {
    const filterType = src[pos++];
    const rowStart = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = src[pos + i];
      const a = i >= bpp ? out[rowStart + i - bpp] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + i] : 0;
      const c = prevRowStart >= 0 && i >= bpp ? out[prevRowStart + i - bpp] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paethPredictor(a, b, c); break;
        default: throw new Error(`malformed PNG: unsupported filter type ${filterType}`);
      }
      out[rowStart + i] = value & 0xff;
    }
    pos += rowBytes;
    prevRowStart = rowStart;
  }
  cursor.pos = pos;
  return out;
}

/** Reads one `bitDepth`-wide sample at `sampleIndex` (0-based, across channels*width) from a row. */
function readSample(data: Uint8Array, rowOffset: number, sampleIndex: number, bitDepth: number): number {
  if (bitDepth === 8) return data[rowOffset + sampleIndex];
  if (bitDepth === 16) {
    const i = rowOffset + sampleIndex * 2;
    return (data[i] << 8) | data[i + 1];
  }
  const samplesPerByte = 8 / bitDepth;
  const byteIndex = rowOffset + Math.floor(sampleIndex / samplesPerByte);
  const shift = 8 - bitDepth - (sampleIndex % samplesPerByte) * bitDepth;
  return (data[byteIndex] >> shift) & ((1 << bitDepth) - 1);
}

/** Reads a sample and normalizes it to 0..255 (exact bit replication for <8-bit, high byte for 16-bit). */
function sample8(data: Uint8Array, rowOffset: number, sampleIndex: number, bitDepth: number): number {
  const raw = readSample(data, rowOffset, sampleIndex, bitDepth);
  if (bitDepth === 16) return (raw >>> 8) & 0xff;
  if (bitDepth === 8) return raw;
  return raw * (255 / ((1 << bitDepth) - 1)); // 1/2/4-bit gray -> exact 255/85/17 replication
}

const ADAM7_PASSES = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
];

/** Unpacks one pass's unfiltered scanlines into RGBA8 pixels, scattering into `dst` at the Adam7 stride. */
function processPass(
  dst: Uint8Array,
  imgWidth: number,
  rows: Uint8Array,
  passWidth: number,
  passHeight: number,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  colorType: number,
  bitDepth: number,
  channels: number,
  rowBytes: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
): void {
  for (let ry = 0; ry < passHeight; ry++) {
    const rowOffset = ry * rowBytes;
    const destY = y0 + ry * dy;
    for (let rx = 0; rx < passWidth; rx++) {
      const destIndex = (destY * imgWidth + x0 + rx * dx) * 4;
      const s = rx * channels;
      let r: number, g: number, b: number, a: number;

      if (colorType === 0) {
        const raw = readSample(rows, rowOffset, s, bitDepth);
        r = g = b = sample8(rows, rowOffset, s, bitDepth);
        a = trns && trns.length >= 2 && raw === ((trns[0] << 8) | trns[1]) ? 0 : 255;
      } else if (colorType === 2) {
        const rr = readSample(rows, rowOffset, s, bitDepth);
        const rg = readSample(rows, rowOffset, s + 1, bitDepth);
        const rb = readSample(rows, rowOffset, s + 2, bitDepth);
        r = bitDepth === 16 ? (rr >>> 8) & 0xff : rr;
        g = bitDepth === 16 ? (rg >>> 8) & 0xff : rg;
        b = bitDepth === 16 ? (rb >>> 8) & 0xff : rb;
        a = 255;
        if (trns && trns.length >= 6) {
          const key = [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]];
          if (rr === key[0] && rg === key[1] && rb === key[2]) a = 0;
        }
      } else if (colorType === 3) {
        const index = readSample(rows, rowOffset, s, bitDepth);
        if (!palette || index * 3 + 2 >= palette.length) throw new Error(`malformed PNG: palette index ${index} out of range`);
        r = palette[index * 3];
        g = palette[index * 3 + 1];
        b = palette[index * 3 + 2];
        a = trns && index < trns.length ? trns[index] : 255;
      } else if (colorType === 4) {
        r = g = b = sample8(rows, rowOffset, s, bitDepth);
        a = sample8(rows, rowOffset, s + 1, bitDepth);
      } else {
        r = sample8(rows, rowOffset, s, bitDepth);
        g = sample8(rows, rowOffset, s + 1, bitDepth);
        b = sample8(rows, rowOffset, s + 2, bitDepth);
        a = sample8(rows, rowOffset, s + 3, bitDepth);
      }

      dst[destIndex] = r;
      dst[destIndex + 1] = g;
      dst[destIndex + 2] = b;
      dst[destIndex + 3] = a;
    }
  }
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const VALID_BIT_DEPTHS: Record<number, number[] | undefined> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/**
 * Decodes a PNG into straight-alpha, top-row-first RGBA8 pixels.
 * Supports color types 0/2/3/4/6, bit depths 1/2/4/8/16 (16-bit truncates to
 * the high byte), all 5 scanline filters, tRNS transparency (color-key or
 * palette alpha), Adam7 interlacing, and concatenated IDAT chunks. Ancillary
 * chunks are ignored. `hasAlpha` is true for color types 4/6 or a tRNS chunk.
 * @throws {Error} on a bad signature or malformed/unsupported chunks.
 */
export function decodePNG(bytes: Uint8Array | ArrayBuffer): { width: number; height: number; data: Uint8Array; hasAlpha: boolean } {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPNG(buf)) throw new Error('malformed PNG: bad signature');

  const chunks = readChunks(buf);
  const ihdr = chunks[0].data;
  if (ihdr.length < 13) throw new Error('malformed PNG: IHDR too short');
  const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = ihdrView.getUint32(0, false);
  const height = ihdrView.getUint32(4, false);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const [compressionMethod, filterMethod, interlaceMethod] = [ihdr[10], ihdr[11], ihdr[12]];

  if (width === 0 || height === 0) throw new Error('malformed PNG: zero width or height');
  if (compressionMethod !== 0 || filterMethod !== 0) throw new Error('malformed PNG: unsupported compression/filter method');
  if (interlaceMethod !== 0 && interlaceMethod !== 1) throw new Error(`malformed PNG: unsupported interlace method ${interlaceMethod}`);

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  const validDepths = VALID_BIT_DEPTHS[colorType];
  if (channels === undefined || !validDepths || !validDepths.includes(bitDepth)) {
    throw new Error(`malformed PNG: unsupported color type ${colorType} / bit depth ${bitDepth}`);
  }
  const plte = chunks.find((c) => c.type === 'PLTE');
  const palette = plte ? plte.data : null;
  if (colorType === 3 && !palette) throw new Error('malformed PNG: palette color type without PLTE chunk');
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  const trns = trnsChunk ? trnsChunk.data : null;
  const idatChunks = chunks.filter((c) => c.type === 'IDAT');
  if (idatChunks.length === 0) throw new Error('malformed PNG: no IDAT chunk');
  let idatLength = 0;
  for (const c of idatChunks) idatLength += c.data.length;
  const idat = new Uint8Array(idatLength);
  let idatOffset = 0;
  for (const c of idatChunks) {
    idat.set(c.data, idatOffset);
    idatOffset += c.data.length;
  }
  let inflated: Uint8Array;
  try {
    inflated = new Uint8Array(inflateSync(idat));
  } catch (err) {
    throw new Error(`malformed PNG: failed to inflate IDAT data (${err instanceof Error ? err.message : String(err)})`);
  }
  const bpp = Math.max(1, Math.ceil((bitDepth * channels) / 8));
  const dst = new Uint8Array(width * height * 4);
  const cursor = { pos: 0 };
  if (interlaceMethod === 0) {
    const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
    const rows = unfilterScanlines(inflated, cursor, rowBytes, height, bpp);
    processPass(dst, width, rows, width, height, 0, 0, 1, 1, colorType, bitDepth, channels, rowBytes, palette, trns);
  } else {
    for (const pass of ADAM7_PASSES) {
      const passWidth = width > pass.x0 ? Math.ceil((width - pass.x0) / pass.dx) : 0;
      const passHeight = height > pass.y0 ? Math.ceil((height - pass.y0) / pass.dy) : 0;
      if (passWidth === 0 || passHeight === 0) continue;
      const rowBytes = Math.ceil((passWidth * channels * bitDepth) / 8);
      const rows = unfilterScanlines(inflated, cursor, rowBytes, passHeight, bpp);
      processPass(dst, width, rows, passWidth, passHeight, pass.x0, pass.y0, pass.dx, pass.dy, colorType, bitDepth, channels, rowBytes, palette, trns);
    }
  }

  return { width, height, data: dst, hasAlpha: colorType === 4 || colorType === 6 || trns !== null };
}
