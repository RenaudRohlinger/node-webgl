// webgl_points / webgl_lines_fat-ish: Points with per-vertex color + sizeAttenuation, plain
// LineSegments, a fat Line2 (LineMaterial + resolution), and a Sprite.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'points-lines';
const W = 640, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x0a0c10, 1);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 0.6, 9);
camera.lookAt(0, 0, 0);

// --- 1) Points: a colorful point cloud with per-vertex color and sizeAttenuation. ---
const POINT_COUNT = 2500;
const pointPos = new Float32Array(POINT_COUNT * 3);
const pointColor = new Float32Array(POINT_COUNT * 3);
const tmpColor = new THREE.Color();
for (let i = 0; i < POINT_COUNT; i++) {
  // uniform-ish points inside a sphere
  let x, y, z;
  do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; } while (x * x + y * y + z * z > 1);
  pointPos[i * 3] = x * 0.95; pointPos[i * 3 + 1] = y * 0.95; pointPos[i * 3 + 2] = z * 0.95;
  tmpColor.setHSL((x + 1) / 2, 0.8, 0.55);
  pointColor[i * 3] = tmpColor.r; pointColor[i * 3 + 1] = tmpColor.g; pointColor[i * 3 + 2] = tmpColor.b;
}
const pointsGeo = new THREE.BufferGeometry();
pointsGeo.setAttribute('position', new THREE.BufferAttribute(pointPos, 3));
pointsGeo.setAttribute('color', new THREE.BufferAttribute(pointColor, 3));
const pointsMat = new THREE.PointsMaterial({ size: 0.16, sizeAttenuation: true, vertexColors: true });
const points = new THREE.Points(pointsGeo, pointsMat);
points.position.set(-3.4, 0, 0);
scene.add(points);

// --- 2) LineSegments: a wireframe cube (edges only). ---
const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6));
const lineSegments = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x66ccff }));
lineSegments.position.set(-1.0, 0, 0);
lineSegments.rotation.set(0.4, 0.6, 0);
scene.add(lineSegments);

// --- 3) Line2: a thick, per-vertex-colored zigzag (screen-space line width via LineMaterial). ---
const zigzagPoints = [];
const zigzagColors = [];
const N = 12;
for (let i = 0; i <= N; i++) {
  const t = i / N;
  zigzagPoints.push(0, (t - 0.5) * 2.2, (i % 2 === 0 ? -0.35 : 0.35));
  const c = new THREE.Color().setHSL(t, 1.0, 0.5);
  zigzagColors.push(c.r, c.g, c.b);
}
const line2Geo = new LineGeometry();
line2Geo.setPositions(zigzagPoints);
line2Geo.setColors(zigzagColors);
const line2Mat = new LineMaterial({ linewidth: 7, vertexColors: true, worldUnits: false });
line2Mat.resolution.set(W, H);
const fatLine = new Line2(line2Geo, line2Mat);
fatLine.computeLineDistances();
fatLine.position.set(1.4, 0, 0);
scene.add(fatLine);

// --- 4) Sprite: a camera-facing billboard with a radial-gradient texture. ---
const spriteSize = 64;
const spriteData = new Uint8Array(spriteSize * spriteSize * 4);
for (let y = 0; y < spriteSize; y++) {
  for (let x = 0; x < spriteSize; x++) {
    const i = (y * spriteSize + x) * 4;
    const dx = (x - spriteSize / 2) / (spriteSize / 2), dy = (y - spriteSize / 2) / (spriteSize / 2);
    const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
    const a = Math.max(0, 1 - d);
    spriteData[i] = 255; spriteData[i + 1] = 210; spriteData[i + 2] = 60; spriteData[i + 3] = Math.round(255 * a * a);
  }
}
const spriteTexture = new THREE.DataTexture(spriteData, spriteSize, spriteSize, THREE.RGBAFormat, THREE.UnsignedByteType);
spriteTexture.needsUpdate = true;
spriteTexture.minFilter = THREE.LinearFilter;
const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture, transparent: true, depthWrite: false }));
sprite.position.set(3.6, 0.3, 0);
sprite.scale.set(1.3, 1.3, 1);
scene.add(sprite);

renderer.render(scene, camera);
const gl = renderer.getContext();

function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
function readAt(x, y) { const px = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }
function isBackground(px) { return Math.abs(px[0] - 0x0a) <= 12 && Math.abs(px[1] - 0x0c) <= 12 && Math.abs(px[2] - 0x10) <= 12; }
// Scans a small box around (cx,cy) since sparse content (points/thin lines) may miss an exact pixel.
function anyNonBackgroundNear(cx, cy, radius) {
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const x = Math.min(W - 1, Math.max(0, cx + dx));
      const y = Math.min(H - 1, Math.max(0, cy + dy));
      if (!isBackground(readAt(x, y))) return true;
    }
  }
  return false;
}

const bg = readAt(3, H - 3);
if (!isBackground(bg)) throw new Error(`${NAME}: expected background corner near #0a0c10, got rgba(${bg.join(',')})`);

const pointsPx = toPixel(points.position);
if (!anyNonBackgroundNear(pointsPx.x, pointsPx.y, 24)) throw new Error(`${NAME}: expected visible points near the point-cloud center`);

const linesPx = toPixel(lineSegments.position);
if (!anyNonBackgroundNear(linesPx.x, linesPx.y, 40)) throw new Error(`${NAME}: expected visible wireframe edges near the LineSegments cube`);

const fatLinePx = toPixel(fatLine.position);
if (!anyNonBackgroundNear(fatLinePx.x, fatLinePx.y, 40)) throw new Error(`${NAME}: expected a visible fat Line2 near its position`);

const spritePx = readAt(...Object.values(toPixel(sprite.position)));
if (isBackground(spritePx)) throw new Error(`${NAME}: expected the sprite to be visible at its center, got rgba(${spritePx.join(',')})`);
if (!(spritePx[0] > spritePx[2])) throw new Error(`${NAME}: expected the sprite center to read warm (orange), got rgba(${spritePx.join(',')})`);

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/points-lines.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
