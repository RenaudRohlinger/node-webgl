// misc_animation_keys-ish: an AnimationMixer drives a position + quaternion KeyframeTrack while
// renderer.setAnimationLoop() ticks it, riding installDOM()'s requestAnimationFrame. After 30
// frames the loop is stopped and the last frame is saved.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'animation-loop';
const W = 512, H = 384;
const FRAMES = 30;
const DT = 1 / 30; // fixed step: 30 frames covers exactly one 1s clip, deterministically.
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x101418, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 1.4, 6);
camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 2);
dir.position.set(3, 4, 5);
scene.add(dir);

const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xff9933 }));
const startPos = new THREE.Vector3(-2, 0, 0);
const endPos = new THREE.Vector3(2, 0.8, 0);
mesh.position.copy(startPos);
scene.add(mesh);

const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const positionTrack = new THREE.VectorKeyframeTrack('.position', [0, 1], [...startPos.toArray(), ...endPos.toArray()]);
const quaternionTrack = new THREE.QuaternionKeyframeTrack('.quaternion', [0, 1], [...q0.toArray(), ...q1.toArray()]);
const clip = new THREE.AnimationClip('move', 1, [positionTrack, quaternionTrack]);

const mixer = new THREE.AnimationMixer(mesh);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();

let frame = 0;
const frameDurations = [];
await new Promise((resolve) => {
  renderer.setAnimationLoop(() => {
    const fStart = performance.now();
    mixer.update(DT);
    renderer.render(scene, camera);
    frameDurations.push(performance.now() - fStart);
    frame++;
    if (frame >= FRAMES) {
      renderer.setAnimationLoop(null);
      resolve();
    }
  });
});

if (frame !== FRAMES) throw new Error(`${NAME}: expected the loop to run exactly ${FRAMES} frames, ran ${frame}`);
if (Math.abs(action.time - 1) > 0.01) throw new Error(`${NAME}: expected the clip to have reached t=1 (clamped), got t=${action.time}`);

const gl = renderer.getContext();
function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
function readAt(pt) { const px = new Uint8Array(4); gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }
function isBackground(px) { return Math.abs(px[0] - 0x10) <= 10 && Math.abs(px[1] - 0x14) <= 10 && Math.abs(px[2] - 0x18) <= 10; }

const endPx = readAt(toPixel(endPos));
if (isBackground(endPx)) throw new Error(`${NAME}: expected the box at its animated end position, got background rgba(${endPx.join(',')})`);
const startPx = readAt(toPixel(startPos));
if (!isBackground(startPx)) throw new Error(`${NAME}: expected the start position to be empty after the box moved away, got rgba(${startPx.join(',')})`);
const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/animation-loop.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

const avgMs = frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length;
console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H} (${FRAMES} frames, ${avgMs.toFixed(2)}ms/frame render)`);
