/**
 * Dependency-free JPEG decoder for Node.js.
 *
 * Supports baseline (SOF0) and extended sequential (SOF1) Huffman coding;
 * progressive (SOF2) Huffman coding with spectral selection, successive
 * approximation and EOB runs; 8-bit grayscale, YCbCr (any chroma
 * subsampling) and CMYK/YCCK (Adobe transform) samples; restart intervals
 * (DRI/RSTn); and the JFIF/Adobe APP markers. Arithmetic coding, lossless
 * and hierarchical modes, and >8-bit precision are not supported.
 *
 * Marker byte reference used below: D8 SOI, D9 EOI, C0/C1/C2 SOF0/1/2,
 * C4 DHT, DB DQT, DA SOS, DD DRI, D0-D7 RSTn, EE APP14 (Adobe).
 */

/** Checks whether `bytes` starts with the JPEG SOI marker (FF D8 FF). */
export function isJPEG(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// --- Bit-level entropy reader (handles FF00 byte stuffing and marker detection) ---
class BitReader {
  pos: number;
  private data: Uint8Array;
  private buf = 0;
  private bufBits = 0;
  private markerHit = false;

  constructor(data: Uint8Array, pos: number) {
    this.data = data;
    this.pos = pos;
  }

  private nextByte(): number {
    if (this.markerHit) return 0;
    for (;;) {
      if (this.pos >= this.data.length) { this.markerHit = true; return 0; }
      const b = this.data[this.pos];
      if (b !== 0xff) { this.pos++; return b; }
      const next = this.pos + 1 < this.data.length ? this.data[this.pos + 1] : 0xd9;
      if (next === 0x00) { this.pos += 2; return 0xff; }
      if (next === 0xff) { this.pos++; continue; } // fill byte before a marker
      this.markerHit = true; // real marker: leave pos pointing at its leading FF
      return 0;
    }
  }

  readBit(): number {
    if (this.bufBits === 0) {
      this.buf = this.nextByte();
      this.bufBits = 8;
    }
    this.bufBits--;
    return (this.buf >> this.bufBits) & 1;
  }

  receive(length: number): number {
    let v = 0;
    for (let i = 0; i < length; i++) v = (v << 1) | this.readBit();
    return v;
  }

  /** JPEG Annex F.2.2.1 EXTEND: reconstructs a signed magnitude from `length` raw bits. */
  receiveExtend(length: number): number {
    if (length === 0) return 0;
    const v = this.receive(length);
    return v < 1 << (length - 1) ? v - (1 << length) + 1 : v;
  }

  /** Discards any unread bits of the current byte (restart markers are byte-aligned). */
  alignByte(): void {
    this.bufBits = 0;
    this.buf = 0;
  }

  /**
   * Returns the marker code (e.g. 0xd0) if `pos` sits at one, otherwise null. Only valid right
   * after alignByte(): probes the byte stream directly rather than the (possibly stale)
   * markerHit flag, since a buffered-but-unread bit can leave pos already at the marker without
   * nextByte() ever having been called to notice it.
   */
  peekMarker(): number | null {
    let p = this.pos;
    if (p >= this.data.length || this.data[p] !== 0xff) return null;
    p++;
    while (p < this.data.length && this.data[p] === 0xff) p++; // skip fill bytes
    return p < this.data.length ? this.data[p] : null;
  }

  /** Consumes a marker previously seen via peekMarker() (including any fill bytes) and resumes reading. */
  consumeMarker(): void {
    let p = this.pos + 1;
    while (this.data[p] === 0xff) p++;
    this.pos = p + 1;
    this.markerHit = false;
  }
}

// --- Huffman tables: canonical codes stored as a nested-array binary tree ---
type HuffmanNode = number | (HuffmanNode | undefined)[];

function buildHuffmanTree(counts: Uint8Array, values: Uint8Array): HuffmanNode {
  const root: (HuffmanNode | undefined)[] = [undefined, undefined];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      let node = root;
      for (let bit = len - 1; bit > 0; bit--) {
        const b = (code >> bit) & 1;
        const existing = node[b];
        const child: (HuffmanNode | undefined)[] = Array.isArray(existing) ? existing : [undefined, undefined];
        node[b] = child;
        node = child;
      }
      node[code & 1] = values[k++];
      code++;
    }
    code <<= 1;
  }
  return root;
}

function decodeHuffman(br: BitReader, tree: HuffmanNode): number {
  let node = tree;
  let depth = 0;
  while (Array.isArray(node)) {
    if (depth++ > 16) throw new Error('malformed JPEG: invalid Huffman code (exceeds 16 bits)');
    const next = node[br.readBit()];
    if (next === undefined) throw new Error('malformed JPEG: invalid Huffman code');
    node = next;
  }
  return node;
}

function requireTree(tree: HuffmanNode | null, kind: string): HuffmanNode {
  if (tree === null) throw new Error(`malformed JPEG: missing ${kind} Huffman table`);
  return tree;
}

function requireQuant(table: Uint16Array | null, id: number): Uint16Array {
  if (!table) throw new Error(`malformed JPEG: missing quantization table ${id}`);
  return table;
}

// --- Frame / component model ---
interface Component {
  id: number;
  h: number;
  v: number;
  quantId: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  /** DCT coefficients, zigzag order within each 64-entry block. */
  blocks: Int16Array;
  /** DC predictor, reset at the start of each scan and each restart interval. */
  pred: number;
}

interface Frame {
  width: number;
  height: number;
  progressive: boolean;
  components: Component[];
  maxH: number;
  maxV: number;
  mcusPerLine: number;
  mcusPerColumn: number;
}

interface ScanComponentRef { comp: Component; dcTree: HuffmanNode | null; acTree: HuffmanNode | null; }

/** Mutable EOB-run counter, threaded through progressive AC decode calls within a scan. */
interface EobRun { value: number }

// --- Marker segment parsers ---
function parseDQT(buf: Uint8Array, start: number, end: number, quantTables: (Uint16Array | null)[]): void {
  let p = start;
  while (p < end) {
    const pqtq = buf[p++];
    const pq = pqtq >> 4, tq = pqtq & 0xf;
    if (tq > 3) throw new Error(`malformed JPEG: invalid quantization table id ${tq}`);
    const size = pq === 0 ? 64 : pq === 1 ? 128 : -1;
    if (size < 0) throw new Error(`malformed JPEG: invalid quantization table precision ${pq}`);
    if (p + size > end) throw new Error('malformed JPEG: truncated DQT segment');
    const table = new Uint16Array(64);
    if (pq === 0) {
      for (let i = 0; i < 64; i++) table[i] = buf[p++];
    } else {
      for (let i = 0; i < 64; i++) { table[i] = (buf[p] << 8) | buf[p + 1]; p += 2; }
    }
    quantTables[tq] = table;
  }
}

function parseDHT(buf: Uint8Array, start: number, end: number, dcTables: (HuffmanNode | null)[], acTables: (HuffmanNode | null)[]): void {
  let p = start;
  while (p < end) {
    if (p + 17 > end) throw new Error('malformed JPEG: truncated DHT segment');
    const tcth = buf[p++];
    const tc = tcth >> 4, th = tcth & 0xf;
    if (th > 3) throw new Error(`malformed JPEG: invalid Huffman table id ${th}`);
    const counts = buf.subarray(p, p + 16);
    p += 16;
    let numValues = 0;
    for (let i = 0; i < 16; i++) numValues += counts[i];
    if (p + numValues > end) throw new Error('malformed JPEG: truncated DHT segment');
    const values = buf.subarray(p, p + numValues);
    p += numValues;
    const tree = buildHuffmanTree(counts, values);
    if (tc === 0) dcTables[th] = tree; else acTables[th] = tree;
  }
}

function parseSOF(marker: number, buf: Uint8Array, start: number, end: number): Frame {
  if (end - start < 6) throw new Error('malformed JPEG: truncated SOF segment');
  let p = start;
  const precision = buf[p++];
  if (precision !== 8) throw new Error(`unsupported JPEG sample precision: ${precision}-bit (only 8-bit is supported)`);
  const height = (buf[p] << 8) | buf[p + 1]; p += 2;
  const width = (buf[p] << 8) | buf[p + 1]; p += 2;
  const numComponents = buf[p++];
  if (width === 0 || height === 0) throw new Error('malformed JPEG: zero width or height');
  if (numComponents !== 1 && numComponents !== 3 && numComponents !== 4) {
    throw new Error(`unsupported JPEG component count: ${numComponents} (only grayscale, YCbCr and CMYK/YCCK are supported)`);
  }
  if (end - p < numComponents * 3) throw new Error('malformed JPEG: truncated SOF component list');

  const components: Component[] = [];
  let maxH = 1, maxV = 1;
  for (let i = 0; i < numComponents; i++) {
    const id = buf[p++];
    const hv = buf[p++];
    const h = hv >> 4, v = hv & 0xf;
    const quantId = buf[p++];
    if (h < 1 || h > 4 || v < 1 || v > 4) throw new Error(`malformed JPEG: invalid sampling factor for component ${id}`);
    if (quantId > 3) throw new Error(`malformed JPEG: invalid quantization table id ${quantId}`);
    if (h > maxH) maxH = h;
    if (v > maxV) maxV = v;
    components.push({ id, h, v, quantId, blocksPerLine: 0, blocksPerColumn: 0, blocks: new Int16Array(0), pred: 0 });
  }
  const mcusPerLine = Math.ceil(width / (8 * maxH));
  const mcusPerColumn = Math.ceil(height / (8 * maxV));
  for (const c of components) {
    c.blocksPerLine = mcusPerLine * c.h;
    c.blocksPerColumn = mcusPerColumn * c.v;
    c.blocks = new Int16Array(c.blocksPerLine * c.blocksPerColumn * 64);
  }
  return { width, height, progressive: marker === 0xc2, components, maxH, maxV, mcusPerLine, mcusPerColumn };
}

interface ParsedSOS { scanComps: ScanComponentRef[]; ss: number; se: number; ah: number; al: number; }

function parseSOS(
  buf: Uint8Array,
  start: number,
  end: number,
  frame: Frame,
  dcTables: (HuffmanNode | null)[],
  acTables: (HuffmanNode | null)[],
): ParsedSOS {
  let p = start;
  if (p >= end) throw new Error('malformed JPEG: truncated SOS segment');
  const ns = buf[p++];
  if (ns < 1 || ns > 4) throw new Error(`malformed JPEG: invalid scan component count ${ns}`);
  if (end - p < ns * 2 + 3) throw new Error('malformed JPEG: truncated SOS segment');
  const scanComps: ScanComponentRef[] = [];
  for (let i = 0; i < ns; i++) {
    const cs = buf[p++];
    const tdta = buf[p++];
    const td = tdta >> 4, ta = tdta & 0xf;
    if (td > 3 || ta > 3) throw new Error('malformed JPEG: invalid Huffman table selector in scan header');
    const comp = frame.components.find((c) => c.id === cs);
    if (!comp) throw new Error(`malformed JPEG: scan references unknown component id ${cs}`);
    scanComps.push({ comp, dcTree: dcTables[td], acTree: acTables[ta] });
  }
  const ss = buf[p++];
  const se = buf[p++];
  const ahal = buf[p++];
  const ah = ahal >> 4, al = ahal & 0xf;
  if (ss > 63 || se > 63 || ss > se) throw new Error(`malformed JPEG: invalid spectral selection ${ss}-${se}`);
  return { scanComps, ss, se, ah, al };
}

// --- Per-block coefficient decoding (baseline and progressive) ---
function decodeBaselineBlock(br: BitReader, coeff: Int16Array, dcTree: HuffmanNode, acTree: HuffmanNode, comp: Component): void {
  const t = decodeHuffman(br, dcTree);
  comp.pred += t === 0 ? 0 : br.receiveExtend(t);
  coeff[0] = comp.pred;
  let k = 1;
  while (k < 64) {
    const rs = decodeHuffman(br, acTree);
    const r = rs >> 4, s = rs & 0xf;
    if (s === 0) {
      if (r === 15) { k += 16; continue; } // ZRL
      break; // EOB
    }
    k += r;
    if (k > 63) throw new Error('malformed JPEG: Huffman AC coefficient index out of range');
    coeff[k++] = br.receiveExtend(s);
  }
}

function decodeDcFirst(br: BitReader, coeff: Int16Array, dcTree: HuffmanNode, comp: Component, al: number): void {
  const t = decodeHuffman(br, dcTree);
  comp.pred += t === 0 ? 0 : br.receiveExtend(t);
  coeff[0] = comp.pred << al;
}

function decodeDcRefine(br: BitReader, coeff: Int16Array, al: number): void {
  if (br.readBit()) coeff[0] |= 1 << al;
}

function decodeAcFirst(br: BitReader, coeff: Int16Array, acTree: HuffmanNode, ss: number, se: number, al: number, eobrun: EobRun): void {
  if (eobrun.value > 0) { eobrun.value--; return; }
  let k = ss;
  while (k <= se) {
    const rs = decodeHuffman(br, acTree);
    const r = rs >> 4, s = rs & 0xf;
    if (s === 0) {
      if (r < 15) {
        eobrun.value = (1 << r) - 1 + (r > 0 ? br.receive(r) : 0);
        break;
      }
      k += 16; // ZRL
      continue;
    }
    k += r;
    if (k > se) throw new Error('malformed JPEG: progressive AC coefficient index out of range');
    coeff[k++] = br.receiveExtend(s) * (1 << al);
  }
}

/** Progressive AC successive-approximation refinement (spec Annex G.1.2.3). */
function decodeAcRefine(br: BitReader, coeff: Int16Array, acTree: HuffmanNode, ss: number, se: number, al: number, eobrun: EobRun): void {
  const p1 = 1 << al;
  const m1 = -1 << al;
  let k = ss;
  if (eobrun.value === 0) {
    while (k <= se) {
      const rs = decodeHuffman(br, acTree);
      let r = rs >> 4;
      const s = rs & 0xf;
      let value = 0;
      if (s === 0) {
        if (r < 15) {
          eobrun.value = (1 << r) + (r > 0 ? br.receive(r) : 0);
          break;
        }
        // r === 15: ZRL, fall through to skip 16 zero-history coefficients below.
      } else {
        value = br.readBit() ? p1 : m1;
      }
      while (k <= se) {
        if (coeff[k] !== 0) {
          if (br.readBit() && (coeff[k] & p1) === 0) coeff[k] += coeff[k] < 0 ? m1 : p1;
        } else {
          if (r === 0) {
            if (s !== 0) coeff[k] = value;
            k++;
            break;
          }
          r--;
        }
        k++;
      }
    }
  }
  if (eobrun.value > 0) {
    while (k <= se) {
      if (coeff[k] !== 0) {
        if (br.readBit() && (coeff[k] & p1) === 0) coeff[k] += coeff[k] < 0 ? m1 : p1;
      }
      k++;
    }
    eobrun.value--;
  }
}

// --- Scan decoding: walks MCUs (interleaved) or a plain block raster (single-component) ---
function decodeScan(
  buf: Uint8Array,
  startPos: number,
  frame: Frame,
  scanComps: ScanComponentRef[],
  ss: number,
  se: number,
  ah: number,
  al: number,
  resetInterval: number,
): number {
  const br = new BitReader(buf, startPos);
  const progressive = frame.progressive;
  const eobrun: EobRun = { value: 0 };
  for (const sc of scanComps) sc.comp.pred = 0;

  const single = scanComps.length === 1;
  let unitsW = 1;
  let totalUnits: number;
  if (single) {
    const c = scanComps[0].comp;
    unitsW = Math.max(1, Math.ceil(Math.ceil((frame.width * c.h) / frame.maxH) / 8));
    const unitsH = Math.max(1, Math.ceil(Math.ceil((frame.height * c.v) / frame.maxV) / 8));
    totalUnits = unitsW * unitsH;
  } else {
    totalUnits = frame.mcusPerLine * frame.mcusPerColumn;
  }

  function decodeOneBlock(sc: ScanComponentRef, blockRow: number, blockCol: number): void {
    const comp = sc.comp;
    const base = (blockRow * comp.blocksPerLine + blockCol) * 64;
    const coeff = comp.blocks.subarray(base, base + 64);
    if (!progressive) {
      decodeBaselineBlock(br, coeff, requireTree(sc.dcTree, 'DC'), requireTree(sc.acTree, 'AC'), comp);
    } else if (ss === 0) {
      if (ah === 0) decodeDcFirst(br, coeff, requireTree(sc.dcTree, 'DC'), comp, al);
      else decodeDcRefine(br, coeff, al);
    } else if (ah === 0) {
      decodeAcFirst(br, coeff, requireTree(sc.acTree, 'AC'), ss, se, al, eobrun);
    } else {
      decodeAcRefine(br, coeff, requireTree(sc.acTree, 'AC'), ss, se, al, eobrun);
    }
  }

  let unitsDone = 0;
  let untilRestart = resetInterval > 0 ? resetInterval : Infinity;
  while (unitsDone < totalUnits) {
    if (single) {
      decodeOneBlock(scanComps[0], Math.floor(unitsDone / unitsW), unitsDone % unitsW);
    } else {
      const mcuRow = Math.floor(unitsDone / frame.mcusPerLine);
      const mcuCol = unitsDone % frame.mcusPerLine;
      for (const sc of scanComps) {
        const comp = sc.comp;
        for (let vy = 0; vy < comp.v; vy++) {
          for (let vx = 0; vx < comp.h; vx++) decodeOneBlock(sc, mcuRow * comp.v + vy, mcuCol * comp.h + vx);
        }
      }
    }
    unitsDone++;
    untilRestart--;
    if (untilRestart === 0 && unitsDone < totalUnits) {
      br.alignByte();
      const m = br.peekMarker();
      if (m !== null && m >= 0xd0 && m <= 0xd7) {
        br.consumeMarker();
        for (const sc of scanComps) sc.comp.pred = 0;
        eobrun.value = 0;
        untilRestart = resetInterval;
      } else {
        break; // missing restart marker: stop decoding this scan early rather than throw
      }
    }
  }
  br.alignByte();
  return br.pos;
}

// --- IDCT: clean separable float implementation with a DC-only fast path ---
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

// IDCT_BASIS[x*8+u] = alpha(u) * cos((2x+1)*u*PI/16), the separable 1-D IDCT-III basis.
const IDCT_BASIS = (() => {
  const table = new Float64Array(64);
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) {
      const alpha = u === 0 ? Math.SQRT1_2 : 1;
      table[x * 8 + u] = alpha * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

const idctTmp = new Float64Array(64);

/** Separable 8x8 inverse DCT. `coeff` is dequantized, natural (row-major) order; writes clamped samples into `out`. */
function idct8x8(coeff: Float64Array, out: Uint8ClampedArray): void {
  for (let v = 0; v < 8; v++) {
    const rowOff = v * 8;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += coeff[rowOff + u] * IDCT_BASIS[x * 8 + u];
      idctTmp[rowOff + x] = sum * 0.5;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += idctTmp[v * 8 + x] * IDCT_BASIS[y * 8 + v];
      out[y * 8 + x] = sum * 0.5 + 128;
    }
  }
}

const idctNatural = new Float64Array(64);
const idctBlockOut = new Uint8ClampedArray(64);

/** Dequantizes and IDCTs every block of a component into a full (MCU-padded) sample plane. */
function buildComponentPlane(comp: Component, quantTable: Uint16Array): Uint8ClampedArray {
  const stride = comp.blocksPerLine * 8;
  const plane = new Uint8ClampedArray(stride * comp.blocksPerColumn * 8);
  for (let by = 0; by < comp.blocksPerColumn; by++) {
    for (let bx = 0; bx < comp.blocksPerLine; bx++) {
      const base = (by * comp.blocksPerLine + bx) * 64;
      let acZero = true;
      for (let i = 1; i < 64; i++) {
        if (comp.blocks[base + i] !== 0) { acZero = false; break; }
      }
      const originX = bx * 8, originY = by * 8;
      if (acZero) {
        const v = comp.blocks[base] * quantTable[0] * 0.125 + 128;
        for (let yy = 0; yy < 8; yy++) {
          const rowStart = (originY + yy) * stride + originX;
          plane.fill(v, rowStart, rowStart + 8);
        }
        continue;
      }
      for (let i = 0; i < 64; i++) idctNatural[ZIGZAG[i]] = comp.blocks[base + i] * quantTable[i];
      idct8x8(idctNatural, idctBlockOut);
      for (let yy = 0; yy < 8; yy++) {
        plane.set(idctBlockOut.subarray(yy * 8, yy * 8 + 8), (originY + yy) * stride + originX);
      }
    }
  }
  return plane;
}

// --- Upsampling + color conversion ---
interface SampleInfo { plane: Uint8ClampedArray; stride: number; actualW: number; actualH: number; h: number; v: number; }

function clampInt(v: number, upper: number): number {
  return v < 0 ? 0 : v >= upper ? upper - 1 : v;
}

/**
 * Chroma-style upsampling. For the common 1x/2x expansion factors (4:4:4, 4:2:2, 4:2:0) this
 * matches libjpeg/ImageIO's "fancy" triangle-filter upsampling via pixel-center-aligned bilinear
 * interpolation. Uncommon expansion factors (e.g. 3x, 4x) fall back to nearest-neighbor block
 * replication, matching the generic (non-fancy) upsampler every mainstream decoder uses there.
 */
function sampleComponent(info: SampleInfo, x: number, y: number, maxH: number, maxV: number): number {
  if (info.h === maxH && info.v === maxV) return info.plane[y * info.stride + x];
  const hExpand = maxH / info.h, vExpand = maxV / info.v;
  const fancy = Number.isInteger(hExpand) && hExpand <= 2 && Number.isInteger(vExpand) && vExpand <= 2;
  if (!fancy) {
    const sx = clampInt(Math.floor(x / hExpand), info.actualW);
    const sy = clampInt(Math.floor(y / vExpand), info.actualH);
    return info.plane[sy * info.stride + sx];
  }
  const sx = ((x + 0.5) * info.h) / maxH - 0.5;
  const sy = ((y + 0.5) * info.v) / maxV - 0.5;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const cx0 = clampInt(x0, info.actualW), cx1 = clampInt(x0 + 1, info.actualW);
  const cy0 = clampInt(y0, info.actualH), cy1 = clampInt(y0 + 1, info.actualH);
  const p00 = info.plane[cy0 * info.stride + cx0];
  const p10 = info.plane[cy0 * info.stride + cx1];
  const p01 = info.plane[cy1 * info.stride + cx0];
  const p11 = info.plane[cy1 * info.stride + cx1];
  const top = p00 + (p10 - p00) * fx;
  const bot = p01 + (p11 - p01) * fx;
  return top + (bot - top) * fy;
}

/**
 * Decodes a JPEG into straight-alpha, top-row-first RGBA8 pixels (`hasAlpha` is always false).
 * Supports baseline (SOF0) and extended sequential (SOF1) Huffman coding, progressive (SOF2)
 * with spectral selection / successive approximation / EOB runs, 8-bit grayscale, YCbCr (any
 * chroma subsampling) and CMYK/YCCK (Adobe transform, inverted-CMYK convention) samples,
 * restart intervals and JFIF/Adobe APP markers. EXIF orientation is ignored.
 * @throws {Error} on malformed data, missing tables, or unsupported precision/coding processes.
 */
export function decodeJPEG(bytes: Uint8Array | ArrayBuffer): { width: number; height: number; data: Uint8Array; hasAlpha: boolean } {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isJPEG(buf)) throw new Error('malformed JPEG: bad SOI marker');

  let frame: Frame | null = null;
  const quantTables: (Uint16Array | null)[] = [null, null, null, null];
  const dcTables: (HuffmanNode | null)[] = [null, null, null, null];
  const acTables: (HuffmanNode | null)[] = [null, null, null, null];
  let resetInterval = 0;
  let adobeTransform: number | null = null;

  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw new Error(`malformed JPEG: expected marker at offset ${pos}`);
    pos++;
    if (pos >= buf.length) throw new Error('malformed JPEG: truncated marker at end of file');
    let marker = buf[pos];
    while (marker === 0xff) {
      pos++;
      if (pos >= buf.length) throw new Error('malformed JPEG: truncated marker at end of file');
      marker = buf[pos];
    }
    pos++;

    if (marker === 0xd9) break; // EOI
    if (marker === 0x00) throw new Error(`malformed JPEG: invalid marker 0x00 at offset ${pos - 1}`);
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // TEM / stray RSTn

    if (pos + 2 > buf.length) throw new Error('malformed JPEG: truncated marker segment');
    const length = (buf[pos] << 8) | buf[pos + 1];
    if (length < 2) throw new Error(`malformed JPEG: invalid segment length at offset ${pos}`);
    const segStart = pos + 2;
    const segEnd = pos + length;
    if (segEnd > buf.length) throw new Error('malformed JPEG: truncated marker segment');

    switch (marker) {
      case 0xdb: // DQT
        parseDQT(buf, segStart, segEnd, quantTables);
        pos = segEnd;
        break;
      case 0xc4: // DHT
        parseDHT(buf, segStart, segEnd, dcTables, acTables);
        pos = segEnd;
        break;
      case 0xc0: case 0xc1: case 0xc2: // SOF0 baseline / SOF1 extended sequential / SOF2 progressive
        frame = parseSOF(marker, buf, segStart, segEnd);
        pos = segEnd;
        break;
      case 0xc3: case 0xc5: case 0xc6: case 0xc7:
      case 0xc9: case 0xca: case 0xcb: case 0xcd: case 0xce: case 0xcf:
        throw new Error(
          `unsupported JPEG coding process (SOF marker 0x${marker.toString(16)}); only baseline, extended ` +
          'sequential and progressive Huffman coding are supported',
        );
      case 0xdd: // DRI
        if (segEnd - segStart < 2) throw new Error('malformed JPEG: truncated DRI segment');
        resetInterval = (buf[segStart] << 8) | buf[segStart + 1];
        pos = segEnd;
        break;
      case 0xda: { // SOS
        if (!frame) throw new Error('malformed JPEG: SOS marker before SOF');
        const sos = parseSOS(buf, segStart, segEnd, frame, dcTables, acTables);
        pos = decodeScan(buf, segEnd, frame, sos.scanComps, sos.ss, sos.se, sos.ah, sos.al, resetInterval);
        break;
      }
      case 0xee: // APP14: Adobe transform flag (0 = RGB/CMYK, 1 = YCbCr, 2 = YCCK)
        if (
          segEnd - segStart >= 12 &&
          buf[segStart] === 0x41 && buf[segStart + 1] === 0x64 && buf[segStart + 2] === 0x6f &&
          buf[segStart + 3] === 0x62 && buf[segStart + 4] === 0x65
        ) {
          adobeTransform = buf[segStart + 11];
        }
        pos = segEnd;
        break;
      default: // APPn (incl. JFIF APP0), COM, DNL, reserved markers: not needed for decoding
        pos = segEnd;
        break;
    }
  }

  if (!frame) throw new Error('malformed JPEG: missing SOF marker');

  const planes = frame.components.map((c) => buildComponentPlane(c, requireQuant(quantTables[c.quantId], c.quantId)));
  const { width, height, maxH, maxV, components } = frame;
  const n = components.length;
  const infos: SampleInfo[] = components.map((c, i) => ({
    plane: planes[i],
    stride: c.blocksPerLine * 8,
    actualW: Math.max(1, Math.ceil((width * c.h) / maxH)),
    actualH: Math.max(1, Math.ceil((height * c.v) / maxV)),
    h: c.h,
    v: c.v,
  }));

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOut = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = rowOut + x * 4;
      if (n === 1) {
        const Y = sampleComponent(infos[0], x, y, maxH, maxV);
        out[o] = Y; out[o + 1] = Y; out[o + 2] = Y; out[o + 3] = 255;
      } else if (n === 3) {
        const Y = sampleComponent(infos[0], x, y, maxH, maxV);
        const Cb = sampleComponent(infos[1], x, y, maxH, maxV);
        const Cr = sampleComponent(infos[2], x, y, maxH, maxV);
        if (adobeTransform === 0) {
          out[o] = Y; out[o + 1] = Cb; out[o + 2] = Cr; // untransformed RGB
        } else {
          out[o] = Y + 1.402 * (Cr - 128);
          out[o + 1] = Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128);
          out[o + 2] = Y + 1.772 * (Cb - 128);
        }
        out[o + 3] = 255;
      } else {
        const c0 = sampleComponent(infos[0], x, y, maxH, maxV);
        const c1 = sampleComponent(infos[1], x, y, maxH, maxV);
        const c2 = sampleComponent(infos[2], x, y, maxH, maxV);
        const k = sampleComponent(infos[3], x, y, maxH, maxV);
        if (adobeTransform === 2) {
          // YCCK: components 0-2 are YCbCr-encoded inverted C/M/Y; K is stored inverted too.
          const r = c0 + 1.402 * (c2 - 128);
          const g = c0 - 0.344136 * (c1 - 128) - 0.714136 * (c2 - 128);
          const b = c0 + 1.772 * (c1 - 128);
          out[o] = (r * k) / 255; out[o + 1] = (g * k) / 255; out[o + 2] = (b * k) / 255;
        } else if (adobeTransform !== null) {
          // Adobe CMYK convention: stored values are inverted (255 - ink).
          out[o] = (c0 * k) / 255; out[o + 1] = (c1 * k) / 255; out[o + 2] = (c2 * k) / 255;
        } else {
          // No Adobe marker: assume conventional (non-inverted) CMYK.
          out[o] = ((255 - c0) * (255 - k)) / 255; out[o + 1] = ((255 - c1) * (255 - k)) / 255; out[o + 2] = ((255 - c2) * (255 - k)) / 255;
        }
        out[o + 3] = 255;
      }
    }
  }

  return { width, height, data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), hasAlpha: false };
}
