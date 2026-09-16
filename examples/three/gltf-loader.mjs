// webgl_loader_gltf-ish, but self-contained: GLTFExporter serializes a small procedural scene to
// an in-memory .glb ArrayBuffer, GLTFLoader.parse() reads it straight back, then we render the
// round-tripped scene. No network, no on-disk asset needed.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'gltf-loader';
const W = 512, H = 384;
const t0 = performance.now();

// --- build a small procedural scene to export ---
const sourceGroup = new THREE.Group();
sourceGroup.name = 'ExportRoot';
const torus = new THREE.Mesh(
  new THREE.TorusGeometry(0.8, 0.28, 24, 48),
  new THREE.MeshStandardMaterial({ color: 0xff8822, metalness: 0.3, roughness: 0.4 }),
);
torus.name = 'Torus';
torus.position.set(-1.1, 0, 0);
sourceGroup.add(torus);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3388ff, metalness: 0.1, roughness: 0.6 }),
);
box.name = 'Box';
box.position.set(1.3, 0, 0);
box.rotation.set(0.3, 0.5, 0);
sourceGroup.add(box);

// --- export to an in-memory .glb (binary glTF) ---
// (GLTFExporter's .glb path uses FileReader, which installDOM() provides.)
const exporter = new GLTFExporter();
const glbBuffer = await new Promise((resolve, reject) => {
  exporter.parse(sourceGroup, resolve, reject, { binary: true });
});
if (!(glbBuffer instanceof ArrayBuffer) || glbBuffer.byteLength < 100) {
  throw new Error(`${NAME}: GLTFExporter did not produce a usable .glb ArrayBuffer (got ${glbBuffer?.byteLength ?? typeof glbBuffer} bytes)`);
}

// --- load it straight back with GLTFLoader.parse() ---
const loader = new GLTFLoader();
const gltf = await new Promise((resolve, reject) => {
  loader.parse(glbBuffer, '', resolve, reject);
});

let meshCount = 0;
gltf.scene.traverse((obj) => { if (obj.isMesh) meshCount++; });
if (meshCount !== 2) throw new Error(`${NAME}: expected 2 meshes round-tripped through glTF, found ${meshCount}`);

// --- render the round-tripped scene ---
const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x1a1c22, 1);

const scene = new THREE.Scene();
scene.add(gltf.scene);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 2);
dir.position.set(3, 4, 5);
scene.add(dir);

const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 1, 5);
camera.lookAt(0, 0, 0);

renderer.render(scene, camera);
const gl = renderer.getContext();

function near(a, b, tol = 12) { return Math.abs(a - b) <= tol; }
const bg = new Uint8Array(4);
gl.readPixels(3, H - 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
if (!(near(bg[0], 0x1a) && near(bg[1], 0x1c) && near(bg[2], 0x22))) {
  throw new Error(`${NAME}: expected background corner near #1a1c22, got rgba(${bg.join(',')})`);
}

function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
const torusInScene = gltf.scene.getObjectByName('Torus');
const boxInScene = gltf.scene.getObjectByName('Box');
if (!torusInScene || !boxInScene) throw new Error(`${NAME}: expected named objects "Torus" and "Box" to survive the glTF round-trip`);

const torusWorldPos = new THREE.Vector3();
torusInScene.getWorldPosition(torusWorldPos);
torusWorldPos.x += 0.8; // sample the ring (major radius 0.8), not the hole in the middle
const torusPx = toPixel(torusWorldPos);
const torusColor = new Uint8Array(4);
gl.readPixels(torusPx.x, torusPx.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, torusColor);
if (!(torusColor[0] > torusColor[2] + 30)) throw new Error(`${NAME}: expected the orange torus ring at its projected position, got rgba(${torusColor.join(',')})`);

const boxWorldPos = new THREE.Vector3();
boxInScene.getWorldPosition(boxWorldPos);
const boxPx = toPixel(boxWorldPos);
const boxColor = new Uint8Array(4);
gl.readPixels(boxPx.x, boxPx.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, boxColor);
if (!(boxColor[2] > boxColor[0] + 20)) throw new Error(`${NAME}: expected the blue box at its projected center, got rgba(${boxColor.join(',')})`);

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/gltf-loader.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H} (glb ${glbBuffer.byteLength}B, ${meshCount} meshes)`);
