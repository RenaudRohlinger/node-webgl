// Generates the small binary assets used by the examples (run once, results are committed).
// Uses only the library's own image codec (no three.js, no network).
//
//   node examples/assets/make-assets.mjs
//
import { encodeImage } from '../../src/index.ts';
import { writeFileSync } from 'node:fs';

// --- uv-grid.png: classic three.js-style UV checker, generated as raw RGBA then PNG-encoded. ---
// 8x8 checker of hue-rotated cells, thin grid lines, and a red top / blue bottom edge stripe so
// flipY behavior is visually obvious (top-left corner is warm/red, bottom edge is blue).
function makeUvGrid(size = 256, cells = 8) {
  const data = new Uint8Array(size * size * 4);
  const cell = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const hue = ((cx + cy * cells) / (cells * cells)) * 360;
      const [r, g, b] = hsv(hue, 0.55, 0.95);
      const onLine = x % cell < 1 || y % cell < 1;
      const edgeTop = y < Math.max(2, size * 0.03);
      const edgeBottom = y > size - Math.max(2, size * 0.03);
      if (edgeTop) { data[i] = 230; data[i + 1] = 30; data[i + 2] = 30; }
      else if (edgeBottom) { data[i] = 30; data[i + 1] = 60; data[i + 2] = 230; }
      else if (onLine) { data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; }
      else { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

// --- photo.jpg: smooth radial gradient + a few soft blobs, the kind of continuous-tone image JPEG is for. ---
function makePhoto(size = 160) {
  const data = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x - cx) / size, dy = (y - cy) / size;
      const d = Math.sqrt(dx * dx + dy * dy);
      const r = 255 * clamp01(1.0 - d * 1.3 + 0.15 * Math.sin(x * 0.09));
      const g = 255 * clamp01(0.5 + 0.5 * Math.cos(d * 6.0));
      const b = 255 * clamp01(0.3 + 0.7 * (y / size));
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map((v) => v | 0);
}

const grid = makeUvGrid();
const gridPng = encodeImage(grid.width, grid.height, grid.data, 'image/png');
writeFileSync(new URL('./uv-grid.png', import.meta.url), gridPng);
console.log('wrote uv-grid.png', gridPng.byteLength, 'bytes');

const photo = makePhoto();
const photoJpg = encodeImage(photo.width, photo.height, photo.data, 'image/jpeg', 0.85);
writeFileSync(new URL('./photo.jpg', import.meta.url), photoJpg);
console.log('wrote photo.jpg', photoJpg.byteLength, 'bytes');
