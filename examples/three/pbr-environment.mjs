// webgl_materials_envmaps-ish: PMREMGenerator + RoomEnvironment IBL lighting a row of
// MeshPhysicalMaterial spheres (metal, rough dielectric, clearcoat, transmission).
// Exercises float/half-float render targets and cube render targets inside PMREMGenerator
// and the renderer's transmission render target.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'pbr-environment';
const W = 640, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x0e1116, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
if (!envRT.texture || envRT.texture.mapping !== THREE.CubeUVReflectionMapping) {
  throw new Error(`${NAME}: PMREMGenerator did not produce a CubeUV environment texture`);
}

const scene = new THREE.Scene();
scene.environment = envRT.texture;

const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
camera.position.set(0, 0.8, 7);
camera.lookAt(0, 0, 0);

const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(4, 6, 5);
scene.add(dir);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.1;
scene.add(floor);

const sphereGeo = new THREE.SphereGeometry(0.75, 64, 48);
const configs = [
  { x: -3.3, name: 'metal', mat: new THREE.MeshPhysicalMaterial({ color: 0xd8d8d8, metalness: 1.0, roughness: 0.08 }) },
  { x: -1.1, name: 'rough-dielectric', mat: new THREE.MeshPhysicalMaterial({ color: 0xdd3344, metalness: 0.0, roughness: 0.9 }) },
  { x: 1.1, name: 'clearcoat', mat: new THREE.MeshPhysicalMaterial({ color: 0x2255dd, metalness: 0.0, roughness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.08 }) },
  { x: 3.3, name: 'transmission', mat: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.02, transmission: 1.0, thickness: 1.2, ior: 1.4 }) },
];
const spheres = configs.map(({ x, mat }) => {
  const m = new THREE.Mesh(sphereGeo, mat);
  m.position.set(x, 0, 0);
  scene.add(m);
  return m;
});

renderer.render(scene, camera);
pmremGenerator.dispose();

const gl = renderer.getContext();

function near(a, b, tol = 12) { return Math.abs(a - b) <= tol; }
const bg = new Uint8Array(4);
gl.readPixels(3, H - 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
if (!(near(bg[0], 0x0e) && near(bg[1], 0x11) && near(bg[2], 0x16))) {
  throw new Error(`${NAME}: expected background corner near #0e1116, got rgba(${bg.join(',')})`);
}

function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
for (const [i, s] of spheres.entries()) {
  const pt = toPixel(s.position);
  const px = new Uint8Array(4);
  gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  if (near(px[0], 0x0e) && near(px[1], 0x11) && near(px[2], 0x16)) {
    throw new Error(`${NAME}: sphere "${configs[i].name}" center still reads as background rgba(${px.join(',')})`);
  }
}

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/pbr-environment.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
