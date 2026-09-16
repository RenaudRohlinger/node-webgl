// webgl_geometries-ish: a lit cube + sphere over a shadowed floor.
// Exercises MeshStandardMaterial/MeshPhysicalMaterial, PCF shadow maps and MSAA resolve.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'basic-scene';
const W = 512, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x223344, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
const dir = new THREE.DirectionalLight(0xffffff, 3);
dir.position.set(3, 5, 2);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
scene.add(dir);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.4, metalness: 0.2 }),
);
cube.position.set(-0.9, 0, 0);
cube.rotation.set(0.5, 0.8, 0);
cube.castShadow = true;
scene.add(cube);

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 48, 32),
  new THREE.MeshPhysicalMaterial({ color: 0x3399ff, roughness: 0.1, metalness: 0.0, clearcoat: 1 }),
);
sphere.position.set(1.2, 0, 0.5);
sphere.castShadow = true;
scene.add(sphere);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x999999 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.8;
floor.receiveShadow = true;
scene.add(floor);

renderer.render(scene, camera);

const gl = renderer.getContext();

// Sanity checks. gl.readPixels uses GL's bottom-left origin: y=H-1 is the visual top row (empty sky),
// the visual center (W/2, H/2) falls on the cube.
const bg = new Uint8Array(4);
gl.readPixels(4, H - 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
const center = new Uint8Array(4);
gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);

function near(a, b, tol = 12) { return Math.abs(a - b) <= tol; }

if (!(near(bg[0], 0x22) && near(bg[1], 0x33) && near(bg[2], 0x44))) {
  throw new Error(`${NAME}: expected sky-background pixel near (4,${H - 4}) to be ~#223344, got rgba(${bg.join(',')})`);
}
if (near(center[0], 0x22) && near(center[1], 0x33) && near(center[2], 0x44)) {
  throw new Error(`${NAME}: expected center pixel to be the cube, but it still reads as the clear color rgba(${center.join(',')})`);
}
const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/basic-scene.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
