/* Builds the 3D scene for a shared map: terrain, water, lights, fog,
   batched scenery and a minimap image. */
import * as THREE from '../three.js';
import { ChunkBatch, setTag, takeTags } from './batch.js';
import { DESTR, CRUSH, TOPPLE } from '../../shared/maps.js';
import { addObject } from './prefabs.js';
import { rng, fbm, polyDist } from '../../shared/math.js';

const groundColor = {
  desert(M) {
    return (x, y, z) => {
      const dr = polyDist(x, z, M.road);
      if (dr < 3.4) return Math.abs(dr - 1.25) < 0.36 ? 0xb98853 : 0xcf9e66;
      const n = fbm(x * 0.07, z * 0.07);
      if (y > 2.2) return n > 0.5 ? 0xf2c98f : 0xeabd80;
      return n < 0.38 ? 0xdfad6e : n < 0.6 ? 0xe8b978 : 0xeec48a;
    };
  },
  city(M) {
    const C = M.citadel, P = M.park, pc = (P.z0 + P.z1) / 2, AL = M.alleys || [], PZ = M.objects.filter(o => o.k === 'plaza');
    const inRect = (x, z, r, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
    return (x, y, z) => {
      const dC = Math.hypot(x - C.x, z - C.z);
      if (dC < C.T) return fbm(x * 0.3, z * 0.3) > 0.5 ? 0xcaa877 : 0xc29f6e;
      if (dC < C.R + 0.6) return 0xb58e62;
      let dr = 1e9; for (const r of M.roads) { const d = polyDist(x, z, r); if (d < dr) dr = d; }
      if (dr < 5.7) return 0xd3c7ae;                                                               // pavement (asphalt is a mesh on top)
      for (const a of AL) if (inRect(x, z, a, 0.2)) return fbm(x * 0.4, z * 0.4) > 0.5 ? 0xcdbf9f : 0xc6b796;   // cobbled alleys
      for (const q of PZ) if (Math.abs(x - q.x) < q.w / 2 && Math.abs(z - q.z) < q.d / 2) return 0xdccdae;
      if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) {
        if (Math.abs(x) < 2.4 || Math.abs(z - pc) < 1.6) return 0xdccdae;                              // park paths
        if (Math.abs(x) < 15 && z > P.z0 + 1 && z < P.z1 - 1.6) return 0xe2d6bb;                    // plaza around the pools and fountain
        return fbm(x * 0.15, z * 0.15) > 0.5 ? 0x74b04e : 0x66a444;
      }
      const n = fbm(x * 0.09, z * 0.09);
      return n < 0.4 ? 0xc9b894 : n < 0.6 ? 0xcfbf9d : 0xc4b28c;
    };
  },
  stadium(M) {
    const P = M.pitch;
    return (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      if (ax <= P.hx + 0.5 && az <= P.hz + 0.5 && ax + az < P.hx + P.hz - 6.5) return Math.floor((x + 200) / 6) % 2 ? 0x5fae4a : 0x55a042;   // mown stripes
      if (ax <= P.hx + P.gd + 0.6 && az <= P.gw + 0.4) return 0x5aa545;
      if (az < P.hz + 4 && ax < P.hx + 4) return 0xb66a4a;                                      // running track
      return fbm(x * 0.2, z * 0.2) > 0.5 ? 0xa9a59c : 0xb2aea4;
    };
  },
  forest(M) {
    return (x, y, z) => {
      for (const f of M.fords || []) if (x > f.x0 - 1 && x < f.x1 + 1 && Math.abs(z - f.zc) < f.halfW + 0.6) return fbm(x * 0.5, z * 0.5) > 0.5 ? 0xb7ab8a : 0xa89d7e;   // gravel ford
      const dv = polyDist(x, z, M.river); if (dv < M.riverW - 0.6) return 0x5d6f55; if (dv < M.riverW + 1.4) return 0xcbb98a;
      const dr = polyDist(x, z, M.road); if (dr < 2.9) return Math.abs(dr - 1.2) < 0.32 ? 0x8e6840 : 0xa77d4c;
      const n = fbm(x * 0.08, z * 0.08); if (y > 3) return n > 0.5 ? 0x8cbc5c : 0x7fb255;
      return n < 0.36 ? 0x5a9a42 : n < 0.58 ? 0x68a84b : 0x79b655;
    };
  },
};

export const SUNS = {
  morning: { dir: [-1, 0.62, -0.35], col: 0xffe2c4, int: 0.85, hemi: 0.5, tint: 0xd8e6f2, tk: 0.18 },
  midday: { dir: [-0.45, 1, 0.55], col: 0xfff0d6, int: 0.88, hemi: 0.52, tint: 0xffffff, tk: 0 },
  golden: { dir: [1, 0.48, 0.55], col: 0xffb877, int: 0.95, hemi: 0.44, tint: 0xf3b27a, tk: 0.3 },
};

const NIGHT = {
  stadium: { moon: 0xa9bcff, moonI: 0.6, sky: 0x46598f, ground: 0x24302a, hemiI: 0.7, fog: 0x101a2e },
  city:   { moon: 0x9db4ff, moonI: 0.55, sky: 0x40548c, ground: 0x2a2420, hemiI: 0.62, fog: 0x0e1830 },
  desert: { moon: 0xa9bcff, moonI: 0.6, sky: 0x46598f, ground: 0x3a2e24, hemiI: 0.62, fog: 0x121a30 },
  forest: { moon: 0x98b2ff, moonI: 0.52, sky: 0x3c5488, ground: 0x1e2a22, hemiI: 0.6, fog: 0x0c1628 },
};
export const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
export const POOL_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
function makeStars() {
  const n = 500, p = new Float32Array(n * 3), r = rng(99);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, y = 0.15 + r() * 0.85, s = Math.sqrt(1 - y * y), R = 320;
    p[i * 3] = Math.cos(a) * s * R; p[i * 3 + 1] = y * R; p[i * 3 + 2] = Math.sin(a) * s * R;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false }));
}

/* ---------- breaking and flattening single objects inside the merged meshes ---------- */
function setupDestruction(W, groups) {
  W.destr = new Map();                                  // tag → [{mesh, s, c}]
  for (const g of groups) for (const m of g.children) {
    const R = m.userData.ranges; if (!R) continue;
    for (const [tag, list] of R) { let a = W.destr.get(tag); if (!a) W.destr.set(tag, (a = [])); for (const [s0, c] of list) a.push({ mesh: m, s: s0, c }); }
  }
  // grid of soft things (bushes, grass, fences, umbrellas) for quick "what did this tank drive over" checks
  W.crushGrid = new Map(); W.gone = new Set(); W.touched = new Set();
  const key = (x, z) => Math.floor(x / 4) * 1000 + Math.floor(z / 4);
  for (const [tag, info] of W.tags) if (CRUSH[info.k] && W.destr.has(tag)) { const k = key(info.x, info.z); let a = W.crushGrid.get(k); if (!a) W.crushGrid.set(k, (a = [])); a.push(tag); }
  const edit = (mesh) => { if (!mesh.userData.orig) mesh.userData.orig = mesh.geometry.attributes.position.array.slice(); W.touched.add(mesh); return mesh.geometry.attributes.position; };
  // mode 'hide': the object disappears (its pieces fly as debris). 'flat': squashed onto the ground and spread a little.
  // mode 'fall': it tips over away from `dir` ({x, z}) like a real tree — slowly at first, faster and faster,
  // a small bounce on the ground — and stays lying there. `instant` skips the animation (joining mid-match).
  W.falls = [];
  W.breakTag = (tag, mode, groundY, dir = null, instant = false) => {
    if (W.gone.has(tag)) return null; const parts = W.destr.get(tag), info = W.tags.get(tag); if (!parts || !info) return null;
    W.gone.add(tag);
    if (mode === 'fall') {
      let dx = dir ? dir.x : 1, dz = dir ? dir.z : 0; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const F = { info, kx: dz, kz: -dx, gy0: groundY(info.x, info.z), th: 0, w: 0.9, target: info.k === 'bench' ? 1.25 : 1.5, bounced: false, parts: [] };
      for (const { mesh, s: s0, c } of parts) {
        const P = edit(mesh), a = P.array, N = mesh.geometry.attributes.normal;
        if (mesh.userData.pool) { for (let i = s0; i < s0 + c; i++) { a[i * 3] = info.x; a[i * 3 + 1] = -20; a[i * 3 + 2] = info.z; } P.needsUpdate = true; continue; }
        F.parts.push({ mesh, s0, c, pos: a.slice(s0 * 3, (s0 + c) * 3), nor: N ? N.array.slice(s0 * 3, (s0 + c) * 3) : null });
      }
      if (instant) { F.th = F.target; poseFall(F); } else { W.falls.push(F); }
      return info;
    }
    for (const { mesh, s: s0, c } of parts) {
      const P = edit(mesh), a = P.array, N = mesh.geometry.attributes.normal;
      for (let i = s0; i < s0 + c; i++) {
        if (mode === 'hide') { a[i * 3] = info.x; a[i * 3 + 1] = -20; a[i * 3 + 2] = info.z; continue; }
        const x = a[i * 3], z = a[i * 3 + 2], gy = groundY(x, z), y = a[i * 3 + 1];
        a[i * 3] = info.x + (x - info.x) * 1.35; a[i * 3 + 2] = info.z + (z - info.z) * 1.35; a[i * 3 + 1] = gy + 0.05 + Math.max(0, y - gy) * 0.1;
        if (N) N.setXYZ(i, 0, 1, 0);
      }
      P.needsUpdate = true; if (N) N.needsUpdate = true;
    }
    return info;
  };
  // Put a falling object at its current angle (Rodrigues rotation of the original vertices about the base).
  function poseFall(F) {
    const cs = Math.cos(F.th), sn = Math.sin(F.th), kx = F.kx, kz = F.kz, bx = F.info.x, bz = F.info.z, gy0 = F.gy0, lift = 0.12 * (F.th / F.target);
    const rot = (x, y, z, o, k) => { const kv = kx * x + kz * z;
      o[k] = x * cs + (-kz * y) * sn + kx * kv * (1 - cs); o[k + 1] = y * cs + (kz * x - kx * z) * sn; o[k + 2] = z * cs + (kx * y) * sn + kz * kv * (1 - cs); };
    const tmp = [0, 0, 0];
    for (const p of F.parts) {
      const P = p.mesh.geometry.attributes.position, a = P.array, N = p.mesh.geometry.attributes.normal;
      for (let j = 0; j < p.c; j++) {
        const i = (p.s0 + j) * 3, o = j * 3;
        rot(p.pos[o] - bx, p.pos[o + 1] - gy0, p.pos[o + 2] - bz, tmp, 0);
        a[i] = bx + tmp[0]; a[i + 1] = gy0 + Math.max(-0.4, tmp[1]) + lift; a[i + 2] = bz + tmp[2];
        if (N && p.nor) { rot(p.nor[o], p.nor[o + 1], p.nor[o + 2], tmp, 0); N.array[i] = tmp[0]; N.array[i + 1] = tmp[1]; N.array[i + 2] = tmp[2]; }
      }
      P.needsUpdate = true; if (N) N.needsUpdate = true;
    }
  }
  // Called every frame: gravity pulls harder the further it leans; one small bounce when it hits the ground.
  // Returns the objects that just landed (for dust and a thud).
  W.updateFalls = (dt) => {
    const landed = [];
    for (let n = W.falls.length - 1; n >= 0; n--) {
      const F = W.falls[n];
      F.w += (7.5 * Math.sin(F.th + 0.08) + 0.6) * dt; F.th += F.w * dt;
      if (F.th >= F.target) {
        F.th = F.target;
        const L = F.info.k === 'bench' ? 0.8 : F.info.k === 'palm' || F.info.k === 'ctree' || F.info.k === 'dryTree' ? 4.5 : 3.5;
        const hit = { k: F.info.k, x: F.info.x, z: F.info.z, hx: F.info.x - F.kz * L, hz: F.info.z + F.kx * L };   // where the top hits the ground
        if (!F.bounced && F.w > 1.2) { F.bounced = true; F.w = -F.w * 0.22; landed.push(hit); }
        else { poseFall(F); W.falls.splice(n, 1); if (!F.bounced) landed.push(hit); continue; }
      }
      poseFall(F);
    }
    return landed;
  };
  W.crushAt = (x, z, r, groundY) => {
    const out = [];
    for (let gx = Math.floor((x - r) / 4); gx <= Math.floor((x + r) / 4); gx++) for (let gz = Math.floor((z - r) / 4); gz <= Math.floor((z + r) / 4); gz++) {
      const a = W.crushGrid.get(gx * 1000 + gz); if (!a) continue;
      for (const tag of a) { if (W.gone.has(tag)) continue; const info = W.tags.get(tag);
        if (Math.hypot(info.x - x, info.z - z) < r + (CRUSH[info.k] || 1) * 0.6) { W.breakTag(tag, TOPPLE[info.k] ? 'fall' : 'flat', groundY, { x: info.x - x, z: info.z - z }); out.push(info); } }
    }
    return out;
  };
  // new match: everything back as it was
  W.resetDestruction = () => {
    for (const m of W.touched) { const P = m.geometry.attributes.position; P.array.set(m.userData.orig); P.needsUpdate = true; m.geometry.computeVertexNormals(); }
    W.touched.clear(); W.gone.clear(); W.falls.length = 0;
  };
}

export function buildWorld(M, opts = {}) {
  const W = { map: M, scene: new THREE.Scene() };
  const seg = opts.lowDetail ? 70 : 110;
  // The menu's copy of a map has the same ground as the one you play on — only the props
  // differ — so it borrows that geometry instead of building a second 24,000-triangle mesh.
  // `sharedGround` therefore must never be disposed with the world that borrowed it.
  if (opts.sharedGround) {
    W.ground = new THREE.Mesh(opts.sharedGround, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
    W.ground.receiveShadow = true; W.scene.add(W.ground);
    W.borrowedGround = true;
    return buildRest(W, M, opts, seg);
  }
  // --- terrain (flat-shaded, per-face colours)
  const g = new THREE.PlaneGeometry(200, 200, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, M.height(p.getX(i), p.getZ(i)));
  const ng = g.toNonIndexed(); g.dispose();
  const pos = ng.attributes.position; const col = new Float32Array(pos.count * 3); const r = rng(M.seed); const cf = groundColor[M.kind](M); const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3, cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3, cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    c.set(cf(cx, cy, cz)).multiplyScalar(1 + (r() - 0.5) * 0.07);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  ng.deleteAttribute('uv'); ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.computeVertexNormals();
  W.ground = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
  W.ground.receiveShadow = true; W.scene.add(W.ground);
  return buildRest(W, M, opts, seg);
}

/** Everything in a world except the ground: water, scenery, lights, sky. */
function buildRest(W, M, opts, seg) {
  if (M.river) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4ba3c6, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.86 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.55; water.receiveShadow = true; W.scene.add(water); W.water = water;
  }
  // --- scenery: casting + flat (decals, grass) batches, both tiled
  const CB = new ChunkBatch(M.seed + 7), CBf = new ChunkBatch(M.seed + 8);
  // Night-only extras: lit windows / lamp heads (glow) and soft pools of light on the ground.
  const NB = { glow: new ChunkBatch(M.seed + 9), pool: new ChunkBatch(M.seed + 10) };
  for (const o of M.objects) {
    if (opts.lowDetail && (o.k === 'grass' || o.k === 'tuft' || o.k === 'flower')) continue;
    setTag(DESTR[o.k] || CRUSH[o.k] ? o.i : null, { x: o.x, z: o.z, k: o.k, top: !!o.y0 });
    addObject(CB, CBf, o, M, NB);
  }
  setTag(null); W.tags = takeTags();
  const gA = CB.build(true), gB = CBf.build(false);
  W.scene.add(gA, gB);
  W.glow = new THREE.Group();
  for (const b of NB.glow.chunks.values()) if (!b.empty) W.glow.add(b.build(GLOW_MAT));
  for (const b of NB.pool.chunks.values()) if (!b.empty) { const m = b.build(POOL_MAT); m.renderOrder = 2; m.userData.pool = true; W.glow.add(m); }
  setupDestruction(W, [gA, gB, W.glow]);                // lamp heads and their light pools go with the lamp
  W.glow.visible = false; W.scene.add(W.glow);
  // --- lights + fog
  const env = M.env;
  W.hemi = new THREE.HemisphereLight(env.sky, env.ground, 0.52); W.scene.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xfff0d6, 0.88); W.sun.castShadow = true;
  const sc = W.sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 170;
  W.sun.shadow.bias = -0.0006; W.sun.shadow.normalBias = 0.03;
  W.scene.add(W.sun, W.sun.target);
  W.fogBase = new THREE.Color(env.fog);
  W.scene.fog = new THREE.Fog(env.fog, 85, 190); W.scene.background = new THREE.Color(env.fog);
  W.skyCol = new THREE.Color(env.sky); W.groundCol = new THREE.Color(env.ground);
  W.night = false; W.sunKey = opts.sun || 'midday';
  W.setSun = (key) => {
    W.sunKey = key; if (W.night) return;
    const s = SUNS[key] || SUNS.midday;
    W.sunDir = new THREE.Vector3(...s.dir).normalize(); W.sun.color.setHex(s.col); W.sun.intensity = s.int; W.hemi.intensity = s.hemi;
    W.hemi.color.copy(W.skyCol); W.hemi.groundColor.copy(W.groundCol);
    const f = W.fogBase.clone().lerp(new THREE.Color(s.tint), s.tk); W.scene.fog.color.copy(f); W.scene.background.copy(f);
    W.scene.fog.near = 85; W.scene.fog.far = 190;
  };
  // Night: cool moonlight, dark blue fog, lit windows and street lamps.
  W.setNight = (on) => {
    on = !!on; if (W.night === on && W.nightSet) return; W.nightSet = true; W.night = on;
    W.glow.visible = on; if (W.stars) W.stars.visible = on;
    if (!on) { W.setSun(W.sunKey); return; }
    const N = NIGHT[M.kind] || NIGHT.city;
    W.sunDir = new THREE.Vector3(0.55, 1, -0.4).normalize(); W.sun.color.setHex(N.moon); W.sun.intensity = N.moonI;
    W.hemi.color.setHex(N.sky); W.hemi.groundColor.setHex(N.ground); W.hemi.intensity = N.hemiI;
    W.scene.fog.color.setHex(N.fog); W.scene.background.setHex(N.fog); W.scene.fog.near = 60; W.scene.fog.far = 175;
  };
  W.stars = makeStars(); W.stars.visible = false; W.scene.add(W.stars);
  W.setSun(W.sunKey);
  W.follow = (target) => { W.sun.position.copy(target).addScaledVector(W.sunDir, 80); W.sun.target.position.copy(target); };
  W.minimap = minimapImage(M);
  return W;
}

export const MM_EXT = 90;                                     // the minimap image covers −90…90 m
function minimapImage(M) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 360;
  const x = cv.getContext('2d'); const S = 360 / (MM_EXT * 2), O = MM_EXT; const tx = (v) => (v + O) * S;
  x.fillStyle = M.kind === 'desert' ? '#dcae72' : M.kind === 'city' ? '#c9b894' : M.kind === 'stadium' ? '#a9a59c' : '#5f9b45'; x.fillRect(0, 0, 360, 360);
  const line = (pts, wd, c) => { x.strokeStyle = c; x.lineWidth = wd * S; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(tx(p[0]), tx(p[1])) : x.moveTo(tx(p[0]), tx(p[1]))); x.stroke(); };
  if (M.kind === 'city') {
    const P = M.park; x.fillStyle = '#6aa84a'; x.fillRect(tx(P.x0), tx(P.z0), (P.x1 - P.x0) * S, (P.z1 - P.z0) * S);
    for (const r of M.roads) line(r, 7, '#6b6e72');
    x.fillStyle = '#d8ccb0'; for (const a of M.alleys || []) x.fillRect(tx(a.x0), tx(a.z0), (a.x1 - a.x0) * S, (a.z1 - a.z0) * S);
    const C = M.citadel; x.fillStyle = '#b58e62'; x.beginPath(); x.arc(tx(C.x), tx(C.z), C.R * S, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#d4ab72'; x.beginPath(); x.arc(tx(C.x), tx(C.z), C.T * S, 0, Math.PI * 2); x.fill();
  }
  if (M.kind === 'stadium') {
    const P = M.pitch; x.fillStyle = '#5fae4a'; x.fillRect(tx(-P.hx), tx(-P.hz), P.hx * 2 * S, P.hz * 2 * S);
    x.fillRect(tx(-P.hx - P.gd), tx(-P.gw), P.gd * S, P.gw * 2 * S); x.fillRect(tx(P.hx), tx(-P.gw), P.gd * S, P.gw * 2 * S);
    x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.strokeRect(tx(-P.hx), tx(-P.hz), P.hx * 2 * S, P.hz * 2 * S); x.beginPath(); x.moveTo(tx(0), tx(-P.hz)); x.lineTo(tx(0), tx(P.hz)); x.stroke();
    x.beginPath(); x.arc(tx(0), tx(0), 9 * S, 0, Math.PI * 2); x.stroke();
  }
  if (M.river) line(M.river, M.riverW * 2, '#4ba3c6');
  for (const f of M.fords || []) { x.fillStyle = '#b7ab8a'; x.fillRect(tx(f.x0), tx(f.zc - f.halfW), (f.x1 - f.x0) * S, f.halfW * 2 * S); }
  if (M.road) line(M.road, 4, M.kind === 'desert' ? '#bd8d5a' : '#a57b4b');
  for (const o of M.objects) {
    let c = null, r = 0;
    if (o.k === 'pine' || o.k === 'leafy' || o.k === 'palm' || o.k === 'ctree') { c = '#2f6436'; r = (o.k === 'palm' ? 1.1 : 1.6) * o.s; }
    else if (o.k === 'oasis') { c = '#3fa6c4'; r = o.r; }
    else if (o.k === 'mesa') { c = '#b8683a'; r = o.R; }
    else if (o.k === 'rock' && o.big) { c = o.grey ? '#8f928d' : '#b37b50'; r = o.s; }
    if (c) { x.fillStyle = c; x.beginPath(); x.arc(tx(o.x), tx(o.z), r * S * 0.8, 0, Math.PI * 2); x.fill(); }
    if (o.k === 'pool') { x.fillStyle = '#3fb0cf'; x.fillRect(tx(o.x - o.w / 2), tx(o.z - o.d / 2), o.w * S, o.d * S); }
    if (o.k === 'fountain') { x.fillStyle = '#2fc4c9'; x.beginPath(); x.arc(tx(o.x), tx(o.z), o.r * S, 0, Math.PI * 2); x.fill(); }
    if (o.k === 'arcade') { x.fillStyle = '#d6aa6c'; x.fillRect(tx(o.x - 3.75), tx(o.z - o.len / 2), 7.5 * S, o.len * S); }
    const rect = o.k === 'building' ? [o.w, o.d, '#efe4cc'] : o.k === 'car' ? [1.9, 4.2, '#444'] : o.k === 'ruin' ? [o.w, o.d, '#f3dfbd'] : o.k === 'cabin' ? [o.w, o.d, o.c ? '#9a948a' : '#c9683f'] : o.k === 'tower' ? [3.6, 3.6, '#c9683f'] : o.k === 'swall' ? [5, 0.8, '#9a9d97'] : o.k === 'log' ? [o.L, 0.7, '#7a5234'] : o.k === 'bridge' ? [o.x1 - o.x0, o.w || 5.2, '#b0875a'] : o.k === 'tent' ? [3.2, 4.2, '#8b8a5c'] : null;
    if (rect) { x.save(); x.translate(tx(o.x), tx(o.z)); x.rotate(-(o.ry || 0)); x.fillStyle = rect[2]; x.fillRect(-rect[0] * S / 2, -rect[1] * S / 2, rect[0] * S, rect[1] * S); x.restore(); }
  }
  return cv;
}
