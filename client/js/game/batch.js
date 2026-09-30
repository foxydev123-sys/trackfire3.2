/* Static geometry batching.
   Thousands of low-poly parts (trees, rocks, walls…) are merged into a
   handful of meshes with per-face colour variation baked into vertex
   colours → very few draw calls, which is what keeps phones fast.
   ChunkBatch splits the map into 40 m tiles so off-screen tiles are
   frustum-culled (and skipped in the shadow pass). */
import * as THREE from '../three.js';
import { rng } from '../../shared/math.js';

export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  sph: new THREE.SphereGeometry(1, 6, 4),
};
const cylCache = {};
export function CYL(rt = 0.5, rb = 0.5, n = 8) {
  const k = rt + '_' + rb + '_' + n;
  return cylCache[k] || (cylCache[k] = new THREE.CylinderGeometry(rt, rb, 1, n));
}
function extrudeGeo(pts) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
}
G.prism = extrudeGeo([[-0.5, 0], [0.5, 0], [0, 1]]);
G.jersey = extrudeGeo([[-0.36, 0], [0.36, 0], [0.18, 0.33], [0.12, 1], [-0.12, 1], [-0.18, 0.33]]);
function jitterGeo(geo, amt, r) {
  const g = geo.clone(); const p = g.attributes.position; const map = {};
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    if (!map[k]) map[k] = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt];
    const o = map[k]; p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}
const _rr = rng(5);
G.rocks = [0, 1, 2, 3, 4, 5].map(() => jitterGeo(G.ico, 0.55, _rr));
G.blobs = [0, 1, 2].map(() => jitterGeo(G.ico, 0.35, _rr));

const niCache = new WeakMap();
function NI(g) { if (!g.index) return g; let n = niCache.get(g); if (!n) { n = g.toNonIndexed(); niCache.set(g, n); } return n; }
export const VMAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

// Tags mark which map object each part belongs to, so single objects can later be
// broken or flattened inside the merged mesh (see world.js breakTag).
let TAG = null; const TAGS = new Map();
export function setTag(t, info) { TAG = t; if (t != null && info && !TAGS.has(t)) TAGS.set(t, info); }
export function takeTags() { const m = new Map(TAGS); TAGS.clear(); TAG = null; return m; }

export class Batch {
  constructor(seed = 1) { this.parts = []; this.r = rng(seed); }
  add(geo, color, p, r = [0, 0, 0], s = [1, 1, 1], jit = 0.05, pre = null) {
    _e.set(r[0], r[1], r[2]); _q.setFromEuler(_e);
    const m = new THREE.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    if (pre) m.premultiply(pre);
    this.parts.push([NI(geo), color instanceof THREE.Color ? color.clone() : new THREE.Color(color), m, jit, TAG]);
  }
  get empty() { return !this.parts.length; }
  build(mat) {
    let n = 0; for (const pt of this.parts) n += pt[0].attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    const ranges = new Map();
    for (const [g, color, m, jit, tag] of this.parts) {
      const a = g.attributes.position;
      if (tag != null) { let r = ranges.get(tag); if (!r) ranges.set(tag, (r = [])); const last = r[r.length - 1]; if (last && last[0] + last[1] === o) last[1] += a.count; else r.push([o, a.count]); }
      for (let i = 0; i < a.count; i++) {
        _v.fromBufferAttribute(a, i).applyMatrix4(m);
        pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z;
        if (i % 3 === 0) { const f = 1 + (this.r() - 0.5) * 2 * jit; _c.copy(color).multiplyScalar(f); }
        col[o * 3] = _c.r; col[o * 3 + 1] = _c.g; col[o * 3 + 2] = _c.b; o++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
    this.parts = [];
    const mesh = new THREE.Mesh(geo, mat || VMAT); if (ranges.size) mesh.userData.ranges = ranges;
    return mesh;
  }
}

// Map-wide batch split into tiles for frustum culling.
export class ChunkBatch {
  constructor(seed, size = 40) { this.size = size; this.seed = seed; this.chunks = new Map(); }
  at(x, z) {
    const k = Math.floor(x / this.size) + ',' + Math.floor(z / this.size);
    let b = this.chunks.get(k); if (!b) { b = new Batch(this.seed + this.chunks.size * 101); this.chunks.set(k, b); }
    return b;
  }
  build(castShadow, receiveShadow = true) {
    const group = new THREE.Group();
    for (const b of this.chunks.values()) {
      if (b.empty) continue;
      const m = b.build(); m.castShadow = castShadow; m.receiveShadow = receiveShadow; group.add(m);
    }
    return group;
  }
}

export const M4 = (x, y, z, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
