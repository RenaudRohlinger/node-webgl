// webgl_raw_shaders + webgl_materials_shaders-ish: RawShaderMaterial with GLSL ES 3.00 sampling a
// sampler2DArray (DataArrayTexture) and a sampler3D (Data3DTexture), a ShaderMaterial using
// screen-space derivatives (dFdx/dFdy/fwidth), and ACESFilmic tone mapping + sRGB output on a lit
// MeshStandardMaterial sphere in the same scene.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'shader-material';
const W = 640, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x14161c, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const halfHeight = 1.2;
const halfWidth = halfHeight * (W / H);
const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 10);
camera.position.z = 5;
camera.lookAt(0, 0, 0);

const unitPlane = new THREE.PlaneGeometry(1, 1);
const slots = 4;
const usableHalfWidth = halfWidth * 0.88;
const planeSize = (2 * usableHalfWidth) / slots * 0.78;
function slotX(i) { return -usableHalfWidth + ((i + 0.5) / slots) * 2 * usableHalfWidth; }
function addQuad(i, material) {
  const mesh = new THREE.Mesh(unitPlane, material);
  mesh.position.set(slotX(i), 0, 0);
  mesh.scale.set(planeSize, planeSize, 1);
  scene.add(mesh);
  return mesh;
}

// --- 1) RawShaderMaterial / GLSL3, sampler2DArray (DataArrayTexture) ---
const arraySize = 8, arrayLayers = 4;
const layerColors = [[230, 60, 60], [60, 220, 90], [70, 110, 240], [235, 210, 60]];
const arrayData = new Uint8Array(arraySize * arraySize * arrayLayers * 4);
for (let l = 0; l < arrayLayers; l++) {
  for (let p = 0; p < arraySize * arraySize; p++) {
    const i = (l * arraySize * arraySize + p) * 4;
    arrayData[i] = layerColors[l][0]; arrayData[i + 1] = layerColors[l][1]; arrayData[i + 2] = layerColors[l][2]; arrayData[i + 3] = 255;
  }
}
const arrayTexture = new THREE.DataArrayTexture(arrayData, arraySize, arraySize, arrayLayers);
arrayTexture.minFilter = arrayTexture.magFilter = THREE.NearestFilter;
arrayTexture.needsUpdate = true;
const SAMPLE_LAYER = 2; // blue -- proves indexing isn't just defaulting to layer 0

const arrayMaterial = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: `
    in vec3 position;
    in vec2 uv;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    out vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    precision highp sampler2DArray;
    in vec2 vUv;
    uniform sampler2DArray uArrayTex;
    uniform int uLayer;
    out vec4 outColor;
    void main() {
      outColor = texture(uArrayTex, vec3(vUv, float(uLayer)));
    }
  `,
  uniforms: { uArrayTex: { value: arrayTexture }, uLayer: { value: SAMPLE_LAYER } },
});
addQuad(0, arrayMaterial);

// --- 2) RawShaderMaterial / GLSL3, sampler3D (Data3DTexture) ---
const size3D = 8, depth3D = 8;
const volumeData = new Uint8Array(size3D * size3D * depth3D * 4);
for (let z = 0; z < depth3D; z++) {
  const t = z / (depth3D - 1);
  for (let p = 0; p < size3D * size3D; p++) {
    const i = (z * size3D * size3D + p) * 4;
    volumeData[i] = Math.round(255 * (1 - t)); volumeData[i + 1] = 30; volumeData[i + 2] = Math.round(255 * t); volumeData[i + 3] = 255;
  }
}
const volumeTexture = new THREE.Data3DTexture(volumeData, size3D, size3D, depth3D);
volumeTexture.minFilter = volumeTexture.magFilter = THREE.NearestFilter;
volumeTexture.needsUpdate = true;
const SAMPLE_W = 0.9; // near the "blue" end of the volume

const volumeMaterial = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: `
    in vec3 position;
    in vec2 uv;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    out vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    precision highp sampler3D;
    in vec2 vUv;
    uniform sampler3D uVolumeTex;
    uniform float uW;
    out vec4 outColor;
    void main() {
      outColor = texture(uVolumeTex, vec3(vUv, uW));
    }
  `,
  uniforms: { uVolumeTex: { value: volumeTexture }, uW: { value: SAMPLE_W } },
});
addQuad(1, volumeMaterial);

// --- 3) ShaderMaterial using screen-space derivatives (fwidth) for analytic anti-aliasing. ---
// `material.extensions.derivatives` is a vestige of WebGL1/GLSL ES 1.00, where dFdx/dFdy/fwidth
// needed `#extension GL_OES_standard_derivatives : enable`. Under WebGL2/GLSL ES 3.00 (all this
// renderer supports) they are core language features, so no extension pragma is needed -- but we
// still set the flag for documentation / back-compat with code written against older three.js.
const derivativesMaterial = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 8.0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uScale;
    void main() {
      vec2 g = fract(vUv * uScale);
      vec2 w = fwidth(vUv * uScale) * 1.5;
      vec2 aa = smoothstep(vec2(0.0), w, g) * (1.0 - smoothstep(vec2(1.0) - w, vec2(1.0), g));
      float line = min(aa.x, aa.y); // 1 = cell interior, 0 = right on a grid line
      vec3 color = mix(vec3(0.04), vec3(1.0, 0.45, 0.1), 1.0 - line);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
derivativesMaterial.extensions.derivatives = true;
addQuad(2, derivativesMaterial);

// --- 4) A normal lit MeshStandardMaterial sphere, so ACESFilmic tone mapping + sRGB output are
//        actually visible in this scene (Raw/custom shaders above bypass those chunks entirely).
const litSphere = new THREE.Mesh(
  new THREE.SphereGeometry(planeSize * 0.5, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 }),
);
litSphere.position.set(slotX(3), 0, 0);
scene.add(litSphere);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const hot = new THREE.PointLight(0xffffff, 18, 20);
hot.position.set(slotX(3) + 0.3, 0.3, 1.0);
scene.add(hot);

renderer.render(scene, camera);
const gl = renderer.getContext();

function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
function readAt(pt) { const px = new Uint8Array(4); gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }

const bg = readAt({ x: 3, y: 3 });
if (!(Math.abs(bg[0] - 0x14) <= 10 && Math.abs(bg[1] - 0x16) <= 10 && Math.abs(bg[2] - 0x1c) <= 10)) {
  throw new Error(`${NAME}: expected background corner near #14161c, got rgba(${bg.join(',')})`);
}

// sampler2DArray: layer 2 is blue-ish (70,110,240).
const arrayPx = readAt(toPixel(new THREE.Vector3(slotX(0), 0, 0)));
if (!(arrayPx[2] > arrayPx[0] + 30 && arrayPx[2] > 150)) {
  throw new Error(`${NAME}: expected sampler2DArray layer ${SAMPLE_LAYER} to read blue-ish, got rgba(${arrayPx.join(',')})`);
}

// sampler3D: near w=0.9 the volume is blue-heavy, red-light.
const volumePx = readAt(toPixel(new THREE.Vector3(slotX(1), 0, 0)));
if (!(volumePx[2] > volumePx[0] + 60)) {
  throw new Error(`${NAME}: expected sampler3D w=${SAMPLE_W} to read blue-heavy, got rgba(${volumePx.join(',')})`);
}

// derivatives quad: center of a grid cell is background-dark, right on a grid line is bright orange.
const gridDark = readAt(toPixel(new THREE.Vector3(slotX(2) + planeSize * 0.06, planeSize * 0.06, 0)));
const gridLinePt = toPixel(new THREE.Vector3(slotX(2), -0.5 * planeSize, 0));
gridLinePt.y = Math.max(0, gridLinePt.y - 1);
let sawLine = false;
for (let dy = -3; dy <= 3; dy++) {
  const px = readAt({ x: gridLinePt.x, y: Math.min(H - 1, Math.max(0, gridLinePt.y + dy)) });
  if (px[0] > 180 && px[1] < 160) { sawLine = true; break; }
}
if (gridDark[0] > 60) throw new Error(`${NAME}: expected a dark grid-cell interior, got rgba(${gridDark.join(',')})`);
if (!sawLine) throw new Error(`${NAME}: expected to find a bright anti-aliased grid line near a cell edge`);

// lit sphere: bright, tone-mapped highlight (not a raw blown-out 255,255,255 flat value everywhere).
const spherePx = readAt(toPixel(litSphere.position));
if (!(spherePx[0] > 80 || spherePx[1] > 80 || spherePx[2] > 80)) {
  throw new Error(`${NAME}: expected the lit sphere to be visible, got rgba(${spherePx.join(',')})`);
}

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/shader-material.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
