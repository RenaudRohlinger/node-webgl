// webgl_instancing_performance-ish: one draw call rendering thousands of instances with per-instance
// color and transform (InstancedMesh + instanceColor).
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'instancing';
const W = 512, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x0b0e14, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
camera.position.set(22, 18, 22);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 2.2);
dir.position.set(10, 20, 10);
scene.add(dir);

const AMOUNT = 18; // 18^3 = 5832 instances
const COUNT = AMOUNT * AMOUNT * AMOUNT;
const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 });
const mesh = new THREE.InstancedMesh(geometry, material, COUNT);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
let i = 0;
const offset = (AMOUNT - 1) / 2;
for (let x = 0; x < AMOUNT; x++) {
  for (let y = 0; y < AMOUNT; y++) {
    for (let z = 0; z < AMOUNT; z++) {
      dummy.position.set(offset - x, offset - y, offset - z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setHSL((x / AMOUNT), 0.7, 0.3 + 0.5 * (y / AMOUNT));
      mesh.setColorAt(i, color);
      i++;
    }
  }
}
mesh.instanceMatrix.needsUpdate = true;
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
scene.add(mesh);

renderer.render(scene, camera);

const gl = renderer.getContext();
const bg = new Uint8Array(4);
gl.readPixels(2, H - 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
const center = new Uint8Array(4);
gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);

function near(a, b, tol = 10) { return Math.abs(a - b) <= tol; }
if (!(near(bg[0], 0x0b) && near(bg[1], 0x0e) && near(bg[2], 0x14))) {
  throw new Error(`${NAME}: expected background corner near #0b0e14, got rgba(${bg.join(',')})`);
}
if (near(center[0], 0x0b) && near(center[1], 0x0e) && near(center[2], 0x14)) {
  throw new Error(`${NAME}: expected center pixel to hit the instanced cube field, got background rgba(${center.join(',')})`);
}
const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);
if (renderer.info.render.calls !== 1) throw new Error(`${NAME}: expected a single draw call, got ${renderer.info.render.calls}`);

writeFileSync(new URL('../out/instancing.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H} (${COUNT} instances, ${renderer.info.render.calls} draw call)`);
