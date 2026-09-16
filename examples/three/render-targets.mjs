// webgl_rendertarget-ish grab-bag: render-to-texture, a 2-attachment MRT ShaderMaterial writing
// layout(location=1), a WebGLCubeRenderTarget used as an envMap, and a DepthTexture sampled in a
// second pass.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'render-targets';
const W = 640, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x12141a, 1);

// ---------------------------------------------------------------------------
// 1) Basic render-to-texture: a small offscreen scene, later shown as a texture.
// ---------------------------------------------------------------------------
const rtScene = new THREE.Scene();
rtScene.background = new THREE.Color(0x117733);
const rtCam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
rtCam.position.set(0, 0, 3);
rtScene.add(new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), new THREE.MeshBasicMaterial({ color: 0xdd2222 })));
const rtA = new THREE.WebGLRenderTarget(256, 256);
renderer.setRenderTarget(rtA);
renderer.render(rtScene, rtCam);
renderer.setRenderTarget(null);

// ---------------------------------------------------------------------------
// 2) MRT: one draw, two color attachments, via an explicit GLSL3 layout(location=N).
// ---------------------------------------------------------------------------
const mrtScene = new THREE.Scene();
const mrtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mrtMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: `
    out vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    in vec2 vUv;
    layout(location = 0) out vec4 outColor0;
    layout(location = 1) out vec4 outColor1;
    void main() {
      outColor0 = vec4(vUv, 0.0, 1.0);
      float d = distance(vUv, vec2(0.5));
      float mask = step(d, 0.35);
      outColor1 = vec4(mask, mask, mask, 1.0);
    }
  `,
});
mrtScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mrtMaterial));
const rtMRT = new THREE.WebGLRenderTarget(256, 256, { count: 2 });
if (rtMRT.textures.length !== 2) throw new Error(`${NAME}: expected a 2-attachment render target`);
renderer.setRenderTarget(rtMRT);
renderer.render(mrtScene, mrtCam);
renderer.setRenderTarget(null);

// ---------------------------------------------------------------------------
// 3) WebGLCubeRenderTarget: six colored panels captured into a cube map, used as an envMap.
// ---------------------------------------------------------------------------
const cubeRT = new THREE.WebGLCubeRenderTarget(128);
const cubeCamera = new THREE.CubeCamera(0.1, 10, cubeRT);
const cubeScene = new THREE.Scene();
cubeScene.background = new THREE.Color(0x111111);
const panelColors = [0xff3333, 0x33ff33, 0x3355ff, 0xffff33, 0xff33ff, 0x33ffff];
const panelGeo = new THREE.PlaneGeometry(5, 5);
const panelDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
for (let i = 0; i < 6; i++) {
  const [dx, dy, dz] = panelDirs[i];
  const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: panelColors[i], side: THREE.DoubleSide }));
  panel.position.set(dx * 3, dy * 3, dz * 3);
  panel.lookAt(0, 0, 0);
  cubeScene.add(panel);
}
cubeCamera.position.set(0, 0, 0);
cubeCamera.update(renderer, cubeScene);

// ---------------------------------------------------------------------------
// 4) DepthTexture: attach to a render target, sample it in a second pass.
// ---------------------------------------------------------------------------
const depthScene = new THREE.Scene();
const depthCam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
depthCam.position.set(0, 0, 4);
depthScene.add(new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffffff })).translateZ(1.2));
depthScene.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x888888 })).translateZ(-2));
const rtDepth = new THREE.WebGLRenderTarget(256, 256);
rtDepth.depthTexture = new THREE.DepthTexture(256, 256);
renderer.setRenderTarget(rtDepth);
renderer.render(depthScene, depthCam);
renderer.setRenderTarget(null);

const depthVisMaterial = new THREE.ShaderMaterial({
  uniforms: { tDepth: { value: rtDepth.depthTexture }, cameraNear: { value: depthCam.near }, cameraFar: { value: depthCam.far } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    ${THREE.ShaderChunk.packing}
    varying vec2 vUv;
    uniform sampler2D tDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    void main() {
      float fragCoordZ = texture2D(tDepth, vUv).x;
      float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
      float d = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
      gl_FragColor = vec4(vec3(d), 1.0);
    }
  `,
});

// ---------------------------------------------------------------------------
// Lay all four demos out on one orthographic canvas.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const halfHeight = 1.2;
const halfWidth = halfHeight * (W / H);
const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 10);
camera.position.z = 5;
camera.lookAt(0, 0, 0);

const unitPlane = new THREE.PlaneGeometry(1, 1);
const slots = 5;
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

addQuad(0, new THREE.MeshBasicMaterial({ map: rtA.texture }));
addQuad(1, new THREE.MeshBasicMaterial({ map: rtMRT.textures[0] }));
addQuad(2, new THREE.MeshBasicMaterial({ map: rtMRT.textures[1] }));
const reflectiveSphere = new THREE.Mesh(
  new THREE.SphereGeometry(planeSize * 0.5, 48, 32),
  new THREE.MeshStandardMaterial({ envMap: cubeRT.texture, metalness: 1, roughness: 0.05, color: 0xffffff }),
);
reflectiveSphere.position.set(slotX(3), 0, 0);
scene.add(reflectiveSphere);
scene.add(new THREE.DirectionalLight(0xffffff, 1.0).translateX(2).translateY(2).translateZ(3));
addQuad(4, depthVisMaterial);

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
function near(a, b, tol = 14) { return Math.abs(a - b) <= tol; }

// background.
const bg = readAt({ x: 3, y: 3 });
if (!(near(bg[0], 0x12) && near(bg[1], 0x14) && near(bg[2], 0x1a))) {
  throw new Error(`${NAME}: expected background corner near #12141a, got rgba(${bg.join(',')})`);
}

// 1) RTT quad: red sphere at its center, green backdrop near its corner.
const rttCenter = readAt(toPixel(new THREE.Vector3(slotX(0), 0, 0)));
if (!(rttCenter[0] > rttCenter[1] + 40 && rttCenter[0] > 120)) throw new Error(`${NAME}: RTT quad center should be red, got rgba(${rttCenter.join(',')})`);
const rttCorner = readAt(toPixel(new THREE.Vector3(slotX(0) + 0.44 * planeSize, 0.44 * planeSize, 0)));
if (!(rttCorner[1] > rttCorner[0] + 20)) throw new Error(`${NAME}: RTT quad corner should show the green backdrop, got rgba(${rttCorner.join(',')})`);

// 2) MRT attachment 0 (UV gradient): near its top-right corner it should read strongly yellow (~1,1,0).
const mrt0Corner = readAt(toPixel(new THREE.Vector3(slotX(1) + 0.47 * planeSize, 0.47 * planeSize, 0)));
if (!(mrt0Corner[0] > 180 && mrt0Corner[1] > 180 && mrt0Corner[2] < 80)) {
  throw new Error(`${NAME}: MRT attachment 0 corner should be yellow (encoded UV), got rgba(${mrt0Corner.join(',')})`);
}

// 3) MRT attachment 1 (circular mask): center white, corner black.
const mrt1Center = readAt(toPixel(new THREE.Vector3(slotX(2), 0, 0)));
const mrt1Corner = readAt(toPixel(new THREE.Vector3(slotX(2) + 0.47 * planeSize, 0.47 * planeSize, 0)));
if (mrt1Center[0] < 200) throw new Error(`${NAME}: MRT attachment 1 center should be white, got rgba(${mrt1Center.join(',')})`);
if (mrt1Corner[0] > 40) throw new Error(`${NAME}: MRT attachment 1 corner should be black, got rgba(${mrt1Corner.join(',')})`);

// 4) Cube render target reflection: two points on the sphere must differ (real spatial reflection, not flat).
const reflA = readAt(toPixel(new THREE.Vector3(slotX(3) - planeSize * 0.2, planeSize * 0.15, planeSize * 0.35)));
const reflB = readAt(toPixel(new THREE.Vector3(slotX(3) + planeSize * 0.2, -planeSize * 0.15, planeSize * 0.35)));
const reflDiff = Math.abs(reflA[0] - reflB[0]) + Math.abs(reflA[1] - reflB[1]) + Math.abs(reflA[2] - reflB[2]);
if (reflDiff < 30) throw new Error(`${NAME}: expected varied cube-map reflection, got nearly identical rgba ${reflA.join(',')} vs ${reflB.join(',')}`);

// 5) Depth visualization: the near sphere and the far backdrop must read distinctly different depths.
const depthNear = readAt(toPixel(new THREE.Vector3(slotX(4), 0, 0)));
const depthFar = readAt(toPixel(new THREE.Vector3(slotX(4), 0.46 * planeSize, 0)));
if (Math.abs(depthNear[0] - depthFar[0]) < 25) {
  throw new Error(`${NAME}: expected distinct depth values for near/far geometry, got ${depthNear[0]} vs ${depthFar[0]}`);
}

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/render-targets.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
