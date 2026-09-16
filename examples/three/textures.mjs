// webgl_materials_texture-ish: TextureLoader (PNG + JPEG), flipY, sRGB colorSpace, anisotropy,
// repeat wrapping + mipmaps, a DataTexture, and a CanvasTexture fed by actual WebGL drawing.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'textures';
const W = 640, H = 384;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x10131a, 1);

// --- a second, independent canvas + raw WebGL2 draw, used as a CanvasTexture source ---
const canvas2 = createCanvas(128, 128);
const gl2 = canvas2.getContext('webgl2');
{
  const vsSource = `#version 300 es\nin vec2 pos;\nout vec2 vUv;\nvoid main(){ vUv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;
  const fsSource = `#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 outColor;\nvoid main(){ outColor = vec4(vUv.x, vUv.y, 1.0 - vUv.x, 1.0); }`;
  function compile(type, src) {
    const s = gl2.createShader(type);
    gl2.shaderSource(s, src);
    gl2.compileShader(s);
    if (!gl2.getShaderParameter(s, gl2.COMPILE_STATUS)) throw new Error(`canvas2 shader: ${gl2.getShaderInfoLog(s)}`);
    return s;
  }
  const prog = gl2.createProgram();
  gl2.attachShader(prog, compile(gl2.VERTEX_SHADER, vsSource));
  gl2.attachShader(prog, compile(gl2.FRAGMENT_SHADER, fsSource));
  gl2.linkProgram(prog);
  if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) throw new Error(`canvas2 program: ${gl2.getProgramInfoLog(prog)}`);
  gl2.useProgram(prog);
  const buf = gl2.createBuffer();
  gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
  gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl2.STATIC_DRAW);
  const loc = gl2.getAttribLocation(prog, 'pos');
  gl2.enableVertexAttribArray(loc);
  gl2.vertexAttribPointer(loc, 2, gl2.FLOAT, false, 0, 0);
  gl2.viewport(0, 0, 128, 128);
  gl2.clearColor(0, 0, 0, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT);
  gl2.drawArrays(gl2.TRIANGLES, 0, 3);
  if (gl2.getError() !== gl2.NO_ERROR) throw new Error(`${NAME}: canvas2 raw-GL draw failed`);
}

// --- load the two generated assets ---
const assetsDir = new URL('../assets/', import.meta.url);
const loader = new THREE.TextureLoader();
const [uvGridBase, photo] = await Promise.all([
  loader.loadAsync(new URL('uv-grid.png', assetsDir).href),
  loader.loadAsync(new URL('photo.jpg', assetsDir).href),
]);

const scene = new THREE.Scene();
const halfHeight = 1.2;
const halfWidth = halfHeight * (W / H);
const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 10);
camera.position.z = 5;
camera.lookAt(0, 0, 0);

const unitPlane = new THREE.PlaneGeometry(1, 1);
const slots = 6;
const usableHalfWidth = halfWidth * 0.88;
const planeSize = (2 * usableHalfWidth) / slots * 0.78;
function slotX(i) { return -usableHalfWidth + ((i + 0.5) / slots) * 2 * usableHalfWidth; }

function addPlane(index, material) {
  const mesh = new THREE.Mesh(unitPlane, material);
  mesh.position.set(slotX(index), 0, 0);
  mesh.scale.set(planeSize, planeSize, 1);
  scene.add(mesh);
  return mesh;
}

// 0: flipY = true (default) -- crisp NearestFilter so the top/bottom edge stripes read back exactly.
const texFlipTrue = uvGridBase.clone();
texFlipTrue.colorSpace = THREE.SRGBColorSpace;
texFlipTrue.magFilter = texFlipTrue.minFilter = THREE.NearestFilter;
texFlipTrue.generateMipmaps = false;
texFlipTrue.needsUpdate = true;
const meshFlipTrue = addPlane(0, new THREE.MeshBasicMaterial({ map: texFlipTrue }));

// 1: flipY = false -- same image, vertically mirrored on upload.
const texFlipFalse = uvGridBase.clone();
texFlipFalse.colorSpace = THREE.SRGBColorSpace;
texFlipFalse.flipY = false;
texFlipFalse.magFilter = texFlipFalse.minFilter = THREE.NearestFilter;
texFlipFalse.generateMipmaps = false;
texFlipFalse.needsUpdate = true;
const meshFlipFalse = addPlane(1, new THREE.MeshBasicMaterial({ map: texFlipFalse }));

// 2: repeat wrapping + mipmaps + anisotropy.
const texRepeat = uvGridBase.clone();
texRepeat.colorSpace = THREE.SRGBColorSpace;
texRepeat.wrapS = texRepeat.wrapT = THREE.RepeatWrapping;
texRepeat.repeat.set(3, 3);
texRepeat.anisotropy = renderer.capabilities.getMaxAnisotropy();
texRepeat.needsUpdate = true;
addPlane(2, new THREE.MeshBasicMaterial({ map: texRepeat }));

// 3: JPEG photo (exercises the native ImageIO JPEG decode path).
photo.colorSpace = THREE.SRGBColorSpace;
photo.needsUpdate = true;
addPlane(3, new THREE.MeshBasicMaterial({ map: photo }));

// 4: DataTexture -- a horizontal red->blue gradient built directly from a typed array.
const dtSize = 64;
const dtData = new Uint8Array(dtSize * dtSize * 4);
for (let y = 0; y < dtSize; y++) {
  for (let x = 0; x < dtSize; x++) {
    const i = (y * dtSize + x) * 4;
    const t = x / (dtSize - 1);
    dtData[i] = Math.round(255 * (1 - t));
    dtData[i + 1] = 40;
    dtData[i + 2] = Math.round(255 * t);
    dtData[i + 3] = 255;
  }
}
const dataTexture = new THREE.DataTexture(dtData, dtSize, dtSize, THREE.RGBAFormat, THREE.UnsignedByteType);
dataTexture.magFilter = dataTexture.minFilter = THREE.NearestFilter;
dataTexture.needsUpdate = true;
addPlane(4, new THREE.MeshBasicMaterial({ map: dataTexture }));

// 5: CanvasTexture sourced from the second canvas' own WebGL-rendered pixels.
const canvasTexture = new THREE.CanvasTexture(canvas2);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
canvasTexture.needsUpdate = true;
addPlane(5, new THREE.MeshBasicMaterial({ map: canvasTexture }));

renderer.render(scene, camera);
const gl = renderer.getContext();

function toPixel(v3) {
  const p = v3.clone().project(camera);
  return {
    x: Math.min(W - 1, Math.max(0, Math.round((p.x * 0.5 + 0.5) * W))),
    y: Math.min(H - 1, Math.max(0, Math.round((p.y * 0.5 + 0.5) * H))),
  };
}
function readAt(pt) {
  const px = new Uint8Array(4);
  gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
function near(a, b, tol = 12) { return Math.abs(a - b) <= tol; }
function isReddish(px) { return px[0] > px[2] + 40 && px[0] > 90; }
function isBluish(px) { return px[2] > px[0] + 40 && px[2] > 90; }

// background corners.
const bg = readAt({ x: 3, y: 3 });
if (!(near(bg[0], 0x10) && near(bg[1], 0x13) && near(bg[2], 0x1a))) {
  throw new Error(`${NAME}: expected background corner near #10131a, got rgba(${bg.join(',')})`);
}

// flipY = true (default): top edge of the plane shows the source's top (red) stripe, bottom shows blue.
const trueTop = readAt(toPixel(new THREE.Vector3(meshFlipTrue.position.x, 0.49 * planeSize, 0)));
const trueBottom = readAt(toPixel(new THREE.Vector3(meshFlipTrue.position.x, -0.49 * planeSize, 0)));
if (!isReddish(trueTop)) throw new Error(`${NAME}: flipY=true plane top should read red, got rgba(${trueTop.join(',')})`);
if (!isBluish(trueBottom)) throw new Error(`${NAME}: flipY=true plane bottom should read blue, got rgba(${trueBottom.join(',')})`);

// flipY = false: mirrored -- top shows blue, bottom shows red.
const falseTop = readAt(toPixel(new THREE.Vector3(meshFlipFalse.position.x, 0.49 * planeSize, 0)));
const falseBottom = readAt(toPixel(new THREE.Vector3(meshFlipFalse.position.x, -0.49 * planeSize, 0)));
if (!isBluish(falseTop)) throw new Error(`${NAME}: flipY=false plane top should read blue, got rgba(${falseTop.join(',')})`);
if (!isReddish(falseBottom)) throw new Error(`${NAME}: flipY=false plane bottom should read red, got rgba(${falseBottom.join(',')})`);

// DataTexture: left edge red-ish, right edge blue-ish.
const dtMeshX = slotX(4);
const dtLeft = readAt(toPixel(new THREE.Vector3(dtMeshX - 0.49 * planeSize, 0, 0)));
const dtRight = readAt(toPixel(new THREE.Vector3(dtMeshX + 0.49 * planeSize, 0, 0)));
if (!isReddish(dtLeft)) throw new Error(`${NAME}: DataTexture left edge should read red, got rgba(${dtLeft.join(',')})`);
if (!isBluish(dtRight)) throw new Error(`${NAME}: DataTexture right edge should read blue, got rgba(${dtRight.join(',')})`);

// photo.jpg and CanvasTexture planes: just confirm they aren't background (i.e. actually textured).
const photoCenter = readAt(toPixel(new THREE.Vector3(slotX(3), 0, 0)));
const canvasCenter = readAt(toPixel(new THREE.Vector3(slotX(5), 0, 0)));
for (const [label, px] of [['photo.jpg plane', photoCenter], ['CanvasTexture plane', canvasCenter]]) {
  if (near(px[0], 0x10) && near(px[1], 0x13) && near(px[2], 0x1a)) {
    throw new Error(`${NAME}: ${label} center still reads as background rgba(${px.join(',')})`);
  }
}

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/textures.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();
canvas2.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H}`);
