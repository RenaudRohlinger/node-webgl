// webgl_postprocessing_unreal_bloom-ish: EffectComposer chaining RenderPass -> UnrealBloomPass -> OutputPass.
// The composer's internal ping-pong buffers are HalfFloatType render targets.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'postprocessing';
const W = 512, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 1, 6);
camera.lookAt(0, 0, 0);

// A normally-lit icosahedron (must NOT blow out) next to a small over-bright "bulb" sphere
// (must exceed the bloom threshold and glow) -- the classic "selective" bloom setup.
const main = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3366aa, roughness: 0.5 }),
);
main.position.set(-0.6, 0, 0);
scene.add(main);

const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(3, 4, 5);
scene.add(dir);
scene.add(new THREE.AmbientLight(0xffffff, 0.2));

const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
bulb.material.color.setScalar(6); // well above the bloom threshold
bulb.position.set(1.7, 0.9, 0.3);
scene.add(bulb);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 1.0, 0.4, 0.85);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

composer.render();

const gl = renderer.getContext();
function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
function readAt(x, y) { const px = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }

// A far corner, away from both objects, should stay dark.
const corner = readAt(2, 2);
if (corner[0] > 40 || corner[1] > 40 || corner[2] > 40) {
  throw new Error(`${NAME}: expected a dark corner, got rgba(${corner.join(',')})`);
}

// The regular icosahedron must be lit but NOT blown out by bloom.
const mainPt = toPixel(main.position);
const mainPx = readAt(mainPt.x, mainPt.y);
if (mainPx[2] <= mainPx[0]) throw new Error(`${NAME}: expected the icosahedron to read blue-ish, got rgba(${mainPx.join(',')})`);
if (mainPx[0] > 230 && mainPx[1] > 230 && mainPx[2] > 230) throw new Error(`${NAME}: icosahedron looks blown out by bloom, got rgba(${mainPx.join(',')})`);

// The bulb itself should be blown out.
const bulbPt = toPixel(bulb.position);
const bulbPx = readAt(bulbPt.x, bulbPt.y);
if (!(bulbPx[0] > 200 && bulbPx[1] > 200 && bulbPx[2] > 200)) throw new Error(`${NAME}: expected the bulb to be blown out, got rgba(${bulbPx.join(',')})`);

// Just outside the bulb's own silhouette, the bloom halo should still be clearly visible.
const haloPt = toPixel(new THREE.Vector3(bulb.position.x, bulb.position.y + 0.55, bulb.position.z));
const haloPx = readAt(haloPt.x, haloPt.y);
if (haloPx[0] + haloPx[1] + haloPx[2] < 150) throw new Error(`${NAME}: expected a visible bloom halo above the bulb, got rgba(${haloPx.join(',')})`);

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/postprocessing.png', import.meta.url), canvas.toBuffer('image/png'));
composer.dispose();
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
