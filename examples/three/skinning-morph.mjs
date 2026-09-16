// webgl_skinning_simple + webgl_morphtargets-ish: a procedural SkinnedMesh (bones posed by
// rotation) whose BufferGeometry also carries a morph target (radial "bulge"), both applied
// together with a nonzero morphTargetInfluences, rendered with MeshStandardMaterial.
import { createCanvas, installDOM } from '../../src/index.ts';
installDOM();
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

const NAME = 'skinning-morph';
const W = 512, H = 448;
const t0 = performance.now();

const canvas = createCanvas(W, H);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x11141c, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
camera.position.set(2.6, 0.2, 5.2);
camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const dir = new THREE.DirectionalLight(0xffffff, 2);
dir.position.set(3, 4, 5);
scene.add(dir);

// --- geometry: an open-ended cylinder ("worm"), skinned along its length. ---
const segmentHeight = 0.75;
const segmentCount = 4;
const height = segmentHeight * segmentCount;
const halfHeight = height / 2;
const radius = 0.32;

const geometry = new THREE.CylinderGeometry(radius, radius, height, 16, segmentCount * 4, true);
geometry.computeVertexNormals();

const position = geometry.attributes.position;
const normal = geometry.attributes.normal;
const vertex = new THREE.Vector3();
const skinIndices = [];
const skinWeights = [];
const morphed = new Float32Array(position.count * 3);
const BULGE = 0.55;
for (let i = 0; i < position.count; i++) {
  vertex.fromBufferAttribute(position, i);

  // skin binding: blend between the two bones straddling this vertex's height.
  const y = vertex.y + halfHeight;
  const skinIndex = Math.min(segmentCount - 1, Math.floor(y / segmentHeight));
  const skinWeight = (y % segmentHeight) / segmentHeight;
  skinIndices.push(skinIndex, skinIndex + 1, 0, 0);
  skinWeights.push(1 - skinWeight, skinWeight, 0, 0);

  // morph target: bulge outward along the vertex normal, peaking at the mid-height.
  const t = Math.max(0, Math.min(1, y / height));
  const bulge = BULGE * Math.sin(Math.PI * t);
  morphed[i * 3] = vertex.x + normal.getX(i) * bulge;
  morphed[i * 3 + 1] = vertex.y;
  morphed[i * 3 + 2] = vertex.z + normal.getZ(i) * bulge;
}
geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(morphed, 3)];

// --- bones: a simple chain, root at the bottom. ---
const bones = [];
let prevBone = new THREE.Bone();
prevBone.position.y = -halfHeight;
bones.push(prevBone);
for (let i = 0; i < segmentCount; i++) {
  const bone = new THREE.Bone();
  bone.position.y = segmentHeight; // each bone sits one segment above its parent
  prevBone.add(bone);
  bones.push(bone);
  prevBone = bone;
}
const material = new THREE.MeshStandardMaterial({ color: 0x2299aa, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
const mesh = new THREE.SkinnedMesh(geometry, material);
const skeleton = new THREE.Skeleton(bones);
mesh.add(bones[0]);
// bind() must run while the bones are still in their neutral rest pose: it captures the inverse
// bind matrices used to compute skinning deltas. Posing (rotating) the bones has to happen after.
mesh.bind(skeleton);
mesh.updateMorphTargets();

// pose: bend the upper bones (all around the same axis, so it's a clean planar bend rather than
// an oblique one) away from the bind pose so skinning visibly deforms the mesh.
bones[1].rotation.z = 0.22;
bones[2].rotation.z = 0.38;
bones[3].rotation.z = 0.48;
mesh.updateMatrixWorld(true);
if (!mesh.morphTargetInfluences || mesh.morphTargetInfluences.length < 1) throw new Error(`${NAME}: expected updateMorphTargets() to populate morphTargetInfluences`);
mesh.morphTargetInfluences[0] = 0.6; // nonzero: blend in the bulge
scene.add(mesh);

renderer.render(scene, camera);
const gl = renderer.getContext();

function isBackground(px) { return Math.abs(px[0] - 0x11) <= 12 && Math.abs(px[1] - 0x14) <= 12 && Math.abs(px[2] - 0x1c) <= 12; }
function readRow(y) {
  const row = new Uint8Array(W * 4);
  gl.readPixels(0, y, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
  return row;
}
function rowExtent(row) {
  let min = -1, max = -1;
  for (let x = 0; x < W; x++) {
    const px = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]];
    if (!isBackground(px)) { if (min < 0) min = x; max = x; }
  }
  return min < 0 ? null : { min, max, width: max - min };
}

// background corner.
const bg = new Uint8Array(4);
gl.readPixels(3, 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
if (!isBackground(bg)) throw new Error(`${NAME}: expected background corner near #11141c, got rgba(${bg.join(',')})`);

// Discover the mesh's vertical silhouette span, then compare its width at mid-height vs near an end:
// the bulge morph should make the middle visibly wider than the tip.
const rowsWithContent = [];
for (let y = 0; y < H; y++) {
  const ext = rowExtent(readRow(y));
  if (ext) rowsWithContent.push({ y, ...ext });
}
if (rowsWithContent.length < 20) throw new Error(`${NAME}: expected a tall visible silhouette, found only ${rowsWithContent.length} rows with content`);
const yMin = rowsWithContent[0].y, yMax = rowsWithContent[rowsWithContent.length - 1].y;
const midY = Math.round((yMin + yMax) / 2);
const endY = yMin + Math.round((yMax - yMin) * 0.06);
const midWidth = rowExtent(readRow(midY))?.width ?? 0;
const endWidth = rowExtent(readRow(endY))?.width ?? 0;
if (!(midWidth > endWidth * 1.15)) {
  throw new Error(`${NAME}: expected the bulge morph to widen the mid-height silhouette (mid=${midWidth}px) vs the end (end=${endWidth}px)`);
}

const err = gl.getError();
if (err !== gl.NO_ERROR) throw new Error(`${NAME}: gl error ${err}`);

writeFileSync(new URL('../out/skinning-morph.png', import.meta.url), canvas.toBuffer('image/png'));
renderer.dispose();
canvas.dispose();

console.log(`ok ${NAME} ${(performance.now() - t0).toFixed(1)}ms ${W}x${H} (mid ${midWidth}px vs end ${endWidth}px)`);
