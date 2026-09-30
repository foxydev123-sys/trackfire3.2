/* =====================================================================
   MAPS — deterministic layout shared by server and client.

   The server only needs `colliders`, `spawns`, `river`/`bridge`/`fords`
   and `bound` (for movement + projectile collision). The client also uses
   `objects` + `height()` to build the 3D scene. Because both sides run
   this exact generator (integer PRNG, no Math.sin in decisions), the
   obstacles you see are exactly the obstacles the server collides with.
   ===================================================================== */
import { rng, fbm, smooth, polyDist, catmull, dist, TAU } from './math.js';

// Arithmetic-only sine/cosine (Taylor series) so lane points are bit-identical
// on every JS engine — lanes decide where cover may be placed.
function dsin(a) { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; let t = a, s = a; const a2 = a * a;
  for (let n = 1; n < 12; n++) { t *= -a2 / ((2 * n) * (2 * n + 1)); s += t; } return s; }
const dcos = (a) => dsin(a + Math.PI / 2);
function ellipse(cx, cz, rx, rz, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([cx + dcos(a) * rx, cz + dsin(a) * rz]); }
  return out;
}
function line(a, b, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) { const k = i / (n - 1); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  return out;
}

// Breakable things: shells (and ramming, for light ones) destroy them, which opens new routes.
// hits = shells needed. Landmarks (buildings, citadel, mesas, big rocks, forest trees) never break.
export const DESTR = { crate: 1, barrel: 1, tires: 2, pole: 2, tent: 2, bags: 3, nest: 3, swall: 3, ctree: 1, palm: 1, dryTree: 1 };
export const RAMMABLE = { crate: 1, barrel: 1, tires: 1, pole: 1, tent: 1, ctree: 1, palm: 1, dryTree: 1 };
// Trees, palms, lamps, benches, signs and street flags fall over (and stay on the ground) instead of bursting.
// A tank only needs to touch them (RAM_SOFT speed), no run-up.
export const TOPPLE = { ctree: 1, palm: 1, dryTree: 1, lamp: 1, slamp: 1, bench: 1, sign: 1, sflag: 1, pole: 1 };
export const RAM_SOFT = 0.3;                    // m/s: just pushing into a tree is enough
// Soft things with no collision: flattened (or knocked over, see TOPPLE) when a tank drives into them or a shell lands next to them.
export const CRUSH = { dbush: 1.3, fbush: 1.5, tuft: 0.8, grass: 0.8, flower: 0.6, reeds: 0.9, umbrella: 1.4, fence: 1.2, lamp: 0.9, slamp: 0.9, bench: 1.1, sign: 1.2, sflag: 0.8 };
// Maps players can pick for normal modes (the stadium is only for Tank Ball).
export const PLAY_MAPS = ['hawler', 'desert', 'forest'];

function base(id, name, kind, seed, bound = 72) {
  const M = { id, name, kind, seed, size: 200, bound, objects: [], colliders: [], lanes: [], road: null, river: null, riverW: 0, bridge: null, fords: [] };
  M.R = rng(seed);
  const lim = bound + 4;
  M.isFree = (x, z, r, avoidRoad = true) => {
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    for (const s of M.lanes) if (dist(x, z, s[0], s[1]) < r + 4.2) return false;
    for (const c of M.colliders) if (dist(x, z, c.x, c.z) < r + c.r + 0.6) return false;
    if (avoidRoad) for (const rd of (M.roads || (M.road ? [M.road] : []))) if (polyDist(x, z, rd) < r + 3.6) return false;
    return true;
  };
  // Long/rectangular obstacles become a row of circles (the collision shape we use).
  M.colRect = (x, z, w, d, ry = 0, low = false) => {
    const long = Math.max(w, d), short = Math.min(w, d), r = short / 2 + 0.2;
    const alongX = w >= d; const n = Math.max(1, Math.ceil((long - 2 * r) / (r * 1.1)) + 1);
    const c = Math.cos(ry), sn = Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -long / 2 + r + (long - 2 * r) * i / (n - 1);
      const lx = alongX ? u : 0, lz = alongX ? 0 : u;
      M.colliders.push({ x: x + lx * c + lz * sn, z: z - lx * sn + lz * c, r, low });
    }
  };
  // A thin straight wall from a to b (row of small circles).
  M.colLine = (ax, az, bx, bz, r = 0.6, low = false) => {
    const L = dist(ax, az, bx, bz), n = Math.max(1, Math.ceil(L / (r * 1.2)));
    for (let i = 0; i <= n; i++) { const k = i / n; M.colliders.push({ x: ax + (bx - ax) * k, z: az + (bz - az) * k, r, low }); }
  };
  M.flag = (x, z, h = 7, s = 1, ry = 0, y0 = null, col = true) => { M.objects.push({ k: 'flag', x, z, h, s, ry, y0 }); if (col) M.colliders.push({ x, z, r: 0.4 }); };
  M.add = (o, colR) => { M.objects.push(o); if (colR) { const c = { x: o.x, z: o.z, r: colR }; if (DESTR[o.k]) { c.hp = DESTR[o.k]; c.k = o.k; c.o = M.objects.length - 1; } if (TOPPLE[o.k]) c.soft = 1; M.colliders.push(c); } return o; };
  M.col = (x, z, r) => M.colliders.push({ x, z, r });
  M.pick = (arr) => arr[Math.floor(M.R() * arr.length)];
  // A rock whose collision circle matches what you see (big rocks block, pebbles don't).
  M.rock = (x, z, s, R, extra = {}) => {
    const sx = 0.9 + R() * 0.5, sz = 0.9 + R() * 0.5, o = { k: 'rock', x, z, s, v: Math.floor(R() * 6), c: Math.floor(R() * 4), ry: R() * TAU, sx, sy: 0.55 + R() * 0.35, sz, big: s >= 1, ...extra };
    return M.add(o, s >= 1 ? s * Math.max(sx, sz) * 1.02 : 0);
  };
  return M;
}

function finish(M, blueTest) {
  M.colliders.forEach((c, i) => { c.i = i; }); M.objects.forEach((o, i) => { o.i = i; });
  const inner = M.bound - 12;
  // Spawn candidates: points along the open lanes (never inside cover).
  const all = [];
  for (let i = 0; i < M.lanes.length; i += 3) {
    const [x, z] = M.lanes[i];
    let ok = true;
    for (const c of M.colliders) if (dist(x, z, c.x, c.z) < c.r + 3) { ok = false; break; }
    if (ok && M.river) { const d = polyDist(x, z, M.river); if (d < M.riverW + 2.5) ok = false; }
    if (ok && Math.abs(x) < inner && Math.abs(z) < inner) all.push([x, z]);
  }
  M.spawns = { any: all, blue: all.filter(p => blueTest(p[0], p[1])), red: all.filter(p => !blueTest(p[0], p[1])) };
  // Capture-the-Flag bases: given by the map, or the spawn point on each side farthest from the other side's spawns.
  const cen = (a) => a.reduce((s, p) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length], [0, 0]);
  const far = (pts, from) => pts.reduce((b, p) => (dist(p[0], p[1], from[0], from[1]) > dist(b[0], b[1], from[0], from[1]) ? p : b), pts[0]);
  const cb = cen(M.spawns.blue), cr = cen(M.spawns.red);
  M.bases = M.bases || { blue: far(M.spawns.blue, cr), red: far(M.spawns.red, cb) };
  // King-of-the-hill zones: given by the map (the zone moves between them), or the open lane point nearest the middle.
  if (!M.hills) {
    const mid = [(M.bases.blue[0] + M.bases.red[0]) / 2, (M.bases.blue[1] + M.bases.red[1]) / 2];
    let best = all[0], bd = 1e9;
    for (const p of all) { let clear = 1e9; for (const c of M.colliders) if (!c.low) clear = Math.min(clear, dist(p[0], p[1], c.x, c.z) - c.r);
      const d = dist(p[0], p[1], mid[0], mid[1]) - Math.min(clear, 8) * 0.8; if (d < bd) { bd = d; best = p; } }
    M.hills = [[best[0], best[1]]];
  }
  M.hill = { x: M.hills[0][0], z: M.hills[0][1] };
  // Spatial grid for fast collision queries (cell = 8 m).
  M.grid = new Map();
  const CS = 8;
  for (const c of M.colliders) {
    const x0 = Math.floor((c.x - c.r - 3.2) / CS), x1 = Math.floor((c.x + c.r + 3.2) / CS);     // margin covers a tank (1.75) and the ball (2.4)
    const z0 = Math.floor((c.z - c.r - 3.2) / CS), z1 = Math.floor((c.z + c.r + 3.2) / CS);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx * 1000 + gz; let a = M.grid.get(k); if (!a) M.grid.set(k, (a = [])); a.push(c);
    }
  }
  M.near = (x, z) => M.grid.get(Math.floor(x / CS) * 1000 + Math.floor(z / CS)) || EMPTY;
  // Checksum so the client can verify it generated the same obstacles.
  let s = 0; for (const c of M.colliders) s = (s + Math.round(c.x * 10) * 31 + Math.round(c.z * 10) * 17 + Math.round(c.r * 10)) | 0;
  M.checksum = s >>> 0;
  delete M.R; delete M.isFree; delete M.add; delete M.col; delete M.pick; delete M.colRect; delete M.colLine; delete M.flag; delete M.rock;
  return M;
}
const EMPTY = [];

/* ============================ DESERT ============================
   15% bigger than before. Every rock you can see blocks you; pebbles are small enough to look drivable. */
function desert() {
  const K = 1.15, k2 = (p) => [p[0] * K, p[1] * K];
  const M = base('desert', 'Dune Crossing', 'desert', 1101, Math.round(72 * K));
  const R = M.R;
  M.road = catmull([[-90, 24], [-52, 15], [-24, 6], [0, -1], [22, -6], [48, -17], [90, -25]].map(k2), 60);
  M.lanes = [
    ...ellipse(0, 2 * K, 9 * K, 6 * K), ...ellipse(-6 * K, 17 * K, 5 * K, 3.6 * K), ...ellipse(6 * K, -22 * K, 5 * K, 3 * K), ...ellipse(18 * K, -8 * K, 5 * K, 3.8 * K),
    ...line(k2([-25, -12]), k2([-10, -8])), ...ellipse(22 * K, 16 * K, 4 * K, 3.4 * K),
    ...line(k2([-8, 8]), k2([-44, 30]), 14), ...line(k2([10, -6]), k2([44, -34]), 14), ...line(k2([12, 4]), k2([46, 22]), 12), ...line(k2([-10, -4]), k2([-46, -28]), 12),
    ...ellipse(-38 * K, 28 * K, 5 * K, 4 * K, 24), ...ellipse(34 * K, -24 * K, 5 * K, 4 * K, 24), ...ellipse(-30 * K, -32 * K, 5 * K, 4 * K, 24), ...ellipse(34 * K, 26 * K, 5 * K, 4 * K, 24)];
  const road = M.road;
  M.height = (X, Z) => {
    const x = X / K, z = Z / K;
    const r = Math.sqrt(x * x + z * z * 1.1664), edge = smooth(38, 68, r);
    const dunes = (Math.sin(x * 0.09 + Math.cos(z * 0.05) * 2) * 0.5 + 0.5) * 4.5 + fbm(x * 0.05, z * 0.05) * 6.5;
    const inn = (fbm(x * 0.12 + 3, z * 0.12) - 0.5) * 0.45;
    const dr = polyDist(X, Z, road) / K;
    return inn * (1 - edge) + edge * dunes * 1.35 * (0.25 + 0.75 * smooth(4, 13, dr));
  };
  // Mesas / cliffs, each with a few boulders at its foot (those block too)
  const D0 = rng(1101 + 99);
  for (const [x0, z0, Rr0, H] of [[-52, -36, 9, 13], [-30, -46, 7, 11], [38, -42, 10, 14], [60, -10, 8, 12], [54, 30, 9, 12], [-58, 32, 10, 13], [-62, 2, 7, 10], [10, -54, 8, 12], [-12, 50, 8, 9], [24, 48, 7, 8], [-40, -58, 9, 12], [64, -40, 8, 12]]) {
    const x = x0 * K, z = z0 * K, Rr = Rr0 * K;
    M.add({ k: 'mesa', x, z, R: Rr, H, seed: Math.floor(R() * 1e9) }, Rr + 0.5);
    for (let i = 0; i < 4; i++) { const a = D0() * TAU, s = 1 + D0() * 1.2, rx = x + dcos(a) * (Rr + 0.6 + s * 0.6), rz = z + dsin(a) * (Rr + 0.6 + s * 0.6);
      M.rock(rx, rz, s, D0, { mesa: 1 }); }
  }
  // Ruined buildings
  for (const [x, z, ry, w, d, H] of [[10, 11, 0.2, 7, 6, 3.4], [-25, 1, -0.4, 6.5, 6, 3.1], [29, 4, 0.55, 6, 5.5, 3.6], [-6, -33, 0.05, 9, 7, 4], [-40, -22, 0.3, 5.5, 5, 2.8]])
    M.add({ k: 'ruin', x: x * K, z: z * K, ry, w, d, H, seed: Math.floor(R() * 1e9) }, Math.max(w, d) * 0.62);
  // Jersey barriers
  const jersey = (x, z, ry) => M.add({ k: 'jersey', x, z, ry, alt: R() < 0.2 }, 1.1);
  for (let i = 0; i < 6; i++) if (i !== 3) jersey((-6 + i * 2.6) * K, (-14 + (i % 2) * 0.4) * K, Math.PI / 2 + (R() - 0.5) * 0.25);
  jersey(34 * K, -1 * K, 0.3); jersey(36.5 * K, 0.4 * K, 0.5); jersey(-38 * K, 10 * K, 1.2); jersey(40 * K, 12 * K, -0.3);
  for (const [x, z] of [[-46, 4], [-43, 8], [-49, 9], [46, -4], [43, -9], [14, -30]]) M.add({ k: 'hedgehog', x: x * K, z: z * K }, 0.9);
  for (const [x, z, Rr, a0, a1] of [[4, 24, 2.6, Math.PI * 1.1, Math.PI * 1.9], [-36, -15, 2.4, -0.4, Math.PI * 0.7], [38, -20, 2.3, 0.6, Math.PI * 1.4]])
    M.add({ k: 'bags', x: x * K, z: z * K, R: Rr, a0, a1 }, Rr * 0.8);
  M.add({ k: 'tent', x: -33 * K, z: -19 * K, ry: 0.4 }, 2.4);
  M.add({ k: 'wreck', x: -34 * K, z: -5 * K }, 2);
  for (const [x, z, tip] of [[14.5, 15], [15.3, 16.1], [14, 16.6, 1], [-21, 5.5], [-20, 6.4], [33, 8], [33.8, 7.2, 1], [-3, -28], [-2, -27.2], [37.5, -18.5]])
    M.add({ k: 'barrel', x: x * K, z: z * K, tip: !!tip, c: Math.floor(R() * 3) }, 0.5);
  for (const [x, z, y0, s] of [[-28.5, -2.5, 0, 1.1], [-27.4, -2.6, 0, 1.1], [-28, -2.5, 1.1, 1], [6, 15.5, 0, 1.1], [-10.5, -29, 0, 1.1], [-9.4, -29.5, 0, 0.9], [40, -2, 0, 1.1]])
    M.add({ k: 'crate', x: x * K, z: z * K, y0, s, ry: R() * 0.6 }, y0 ? 0 : 0.75);
  // Telegraph poles along the road
  { let acc = 0; for (let i = 1; i < road.length; i++) {
      const a = road[i - 1], b = road[i]; const L = dist(a[0], a[1], b[0], b[1]); acc += L;
      if (acc > 17) { acc = 0; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; const x = b[0] + nx * 5, z = b[1] + nz * 5;
        if (!M.isFree(x, z, 0.4, false)) continue; M.add({ k: 'pole', x, z, ry: Math.atan2(nx, nz) }, 0.4); } } }
  for (const [x, z, Rr] of [[-2, -19, 3], [16, -1, 2.4], [-14, 5, 2], [30, -28, 3.4], [-22, 24, 2.6], [46, 6, 2.8]]) M.add({ k: 'crater', x: x * K, z: z * K, R: Rr });
  // A few big boulders out in the open (fewer than before: the old random ones cluttered the lanes)
  for (let i = 0; i < 90; i++) {
    const x = (R() - 0.5) * 170, z = (R() - 0.5) * 170, big = R() < 0.3, s = big ? 1.3 + R() * 1.2 : 0.25 + R() * 0.25;
    if (!M.isFree(x, z, big ? s * 1.5 : s)) continue;
    if (big && Math.hypot(x, z) < 34) continue;          // the middle stays open for driving; cover there is placed by hand
    M.rock(x, z, s, R);
  }
  // Rock clusters as mid-field cover
  for (const [cx, cz] of [[-18, -2], [12, -14], [-2, -8.2], [26, -16], [-14, 12]]) for (let k = 0; k < 3; k++) {
    const x = (cx + (R() - 0.5) * 2.6) * K, z = (cz + (R() - 0.5) * 2.6) * K, s = 1.5 + R() * 0.9;
    M.rock(x, z, s, R);
  }
  for (let i = 0; i < 60; i++) { const x = (R() - 0.5) * 160, z = (R() - 0.5) * 160; if (M.isFree(x, z, 1)) M.add({ k: 'dryTree', x, z, seed: Math.floor(R() * 1e9) }, 0.5); }
  for (let i = 0; i < 230; i++) { const x = (R() - 0.5) * 170, z = (R() - 0.5) * 170; if (M.isFree(x, z, 0.6)) M.add({ k: 'dbush', x, z, seed: Math.floor(R() * 1e9) }); }
  for (let i = 0; i < 480; i++) { const x = (R() - 0.5) * 170, z = (R() - 0.5) * 170; if (M.isFree(x, z, 0.2, false)) M.add({ k: 'tuft', x, z, seed: Math.floor(R() * 1e9) }); }
  // Kurdish flags
  M.flag(14 * K, 14.5 * K, 7.5, 1.1); M.flag(-22.5 * K, 4.5 * K, 7, 1); M.flag(-3 * K, -28.5 * K, 8, 1.2); M.flag(-30 * K, -16.5 * K, 6.5, 1); M.flag(31 * K, 7 * K, 7, 1); M.flag(-38.5 * K, 12.5 * K, 6.5, 1);
  M.pads = [[9, 2], [-6, 13.4], [6, -19], [23, -8], [-17, -10], [22, 19.4], [-30, 22], [32, -24]].map(k2);
  M.hills = [[0, 2], [18, -8], [-17, -10], [-6, 17], [22, 16]].map(k2);
  M.bases = { blue: k2([-38, 28]), red: k2([34, -24]) };
  // Extra life in the open sand (own random stream, so the old layout above never moves)
  { const D = rng(1101 + 555);
    let oases = 0;
    for (let i = 0; i < 60 && oases < 2; i++) {
      const ox = (D() - 0.5) * 138, oz = (D() - 0.5) * 138;
      if (Math.hypot(ox, oz) < 29 || !M.isFree(ox, oz, 6.5)) continue; oases++;
      M.objects.push({ k: 'oasis', x: ox, z: oz, r: 3.6 }); M.colliders.push({ x: ox, z: oz, r: 3.8, low: true });
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + D() * 0.5, rr = 5 + D() * 1.5, x = ox + dcos(a) * rr, z = oz + dsin(a) * rr;
        if (M.isFree(x, z, 0.6)) M.add({ k: 'palm', x, z, s: 0.85 + D() * 0.35, seed: Math.floor(D() * 1e9) }, 0.45); }
    }
    for (let i = 0; i < 14; i++) { const x = (D() - 0.5) * 160, z = (D() - 0.5) * 160; if (M.isFree(x, z, 1)) M.add({ k: 'palm', x, z, s: 0.8 + D() * 0.4, seed: Math.floor(D() * 1e9) }, 0.45); }
    for (let i = 0; i < 5; i++) { const x = (D() - 0.5) * 138, z = (D() - 0.5) * 138; if (M.isFree(x, z, 2.2)) { const ry = D() * TAU; M.objects.push({ k: 'wreckcar', x, z, ry, seed: Math.floor(D() * 1e9) }); M.colRect(x, z, 1.9, 4.1, ry); } }
    for (let i = 0; i < 6; i++) { const x = (D() - 0.5) * 138, z = (D() - 0.5) * 138; if (M.isFree(x, z, 1.2)) M.add({ k: 'tires', x, z, n: 2 + Math.floor(D() * 3), seed: Math.floor(D() * 1e9) }, 0.8); }
    for (let i = 0; i < 100; i++) { const x = (D() - 0.5) * 170, z = (D() - 0.5) * 170; if (M.isFree(x, z, 1.5)) M.objects.push({ k: 'ripple', x, z, ry: 0.35 + (D() - 0.5) * 0.3, L: 4 + D() * 6, n: 2 + Math.floor(D() * 3) }); }
    { let acc = 0, side = 1; for (let i = 1; i < road.length; i++) { const a = road[i - 1], b = road[i]; const L = dist(a[0], a[1], b[0], b[1]); acc += L;
      if (acc > 42) { acc = 0; side = -side; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, x = b[0] - nx * 4.6 * side, z = b[1] - nz * 4.6 * side;
        if (Math.abs(x) < M.bound && M.isFree(x, z, 0.4, false)) M.objects.push({ k: 'sign', x, z, ry: Math.atan2(b[0] - a[0], b[1] - a[1]) + (side > 0 ? Math.PI : 0), c: Math.floor(D() * 2) }); } } }
  }
  M.env = { sky: 0xcfe4ff, ground: 0xc79a64, fog: 0xf0d2a2, dust: 0xe0bb86 };
  return finish(M, (x, z) => z > 0);
}

/* ============================ FOREST ============================
   The river runs north–south through the middle of the map with the big
   bridge right in the centre, and two shallow fords to the north and
   south. Each side has a camp (the CTF bases), log cabins, stone cottages
   and small hunters' camps in the woods. Blue = west, red = east. */
function forest() {
  const M = base('forest', 'Pinewood Ford', 'forest', 2202);
  const R = M.R;
  M.road = catmull([[-95, 4], [-62, -2], [-34, 3], [-12, 1], [0, 0], [12, -1], [34, -3], [62, 2], [95, -4]], 70);
  M.river = catmull([[5, -95], [-4, -58], [3, -30], [-2, -12], [0, 0], [2, 12], [-3, 30], [4, 56], [-3, 95]], 80);
  M.riverW = 5;
  M.bridge = { x0: -9, x1: 9, zc: 0, halfW: 2.3 };
  const riverX = (z) => { let best = 0, bd = 1e9; for (const p of M.river) { const d = Math.abs(p[1] - z); if (d < bd) { bd = d; best = p[0]; } } return best; };
  const fx1 = riverX(-42), fx2 = riverX(44);
  M.fords = [{ x0: fx1 - 8, x1: fx1 + 8, zc: -42, halfW: 3.6 }, { x0: fx2 - 8, x1: fx2 + 8, zc: 44, halfW: 3.6 }];
  const camps = { blue: [-52, 0], red: [52, 0] };
  M.bases = { blue: camps.blue, red: camps.red };
  // Open lanes: the road, both camps, clearings on either bank, paths to the fords.
  M.lanes = [
    ...line([-66, 1], [-12, 1], 30), ...line([12, -1], [66, 1], 30),
    ...ellipse(-52, 0, 10, 8), ...ellipse(52, 0, 10, 8),
    ...ellipse(-20, 13, 6, 5), ...ellipse(20, -13, 6, 5), ...ellipse(-26, -30, 6, 5), ...ellipse(26, 30, 6, 5),
    ...line([-26, -30], [fx1 - 9, -42], 10), ...line([fx1 + 9, -42], [30, -46], 10), ...line([-30, 46], [fx2 - 9, 44], 10), ...line([fx2 + 9, 44], [26, 30], 10),
    ...line([-20, 13], [-52, 0], 12), ...line([20, -13], [52, 0], 12), ...line([-26, -30], [-52, 0], 12), ...line([26, 30], [52, 0], 12),
    ...line([-30, 46], [-20, 13], 12), ...line([30, -46], [20, -13], 12), ...ellipse(-30, 46, 5, 4), ...ellipse(30, -46, 5, 4)];
  const road = M.road, river = M.river, rw = M.riverW;
  M.height = (x, z) => {
    const r = Math.sqrt(x * x + z * z), edge = smooth(46, 74, r);
    let y = (fbm(x * 0.1, z * 0.1) - 0.5) * 0.6 * (1 - edge) + edge * fbm(x * 0.04, z * 0.04) * 11;
    y += 2.6 * Math.exp(-((x + 36) * (x + 36) + (z + 14) * (z + 14)) / 90) + 2.6 * Math.exp(-((x - 36) * (x - 36) + (z - 14) * (z - 14)) / 90);
    const dr = polyDist(x, z, road); y *= 0.3 + 0.7 * smooth(3, 9, dr);
    const dv = polyDist(x, z, river); y -= 2.2 * (1 - smooth(rw - 1.5, rw + 2.5, dv));
    for (const f of M.fords) if (x > f.x0 - 2 && x < f.x1 + 2 && Math.abs(z - f.zc) < f.halfW + 3) y = Math.max(y, -0.5 - 0.1 * smooth(0, 4, Math.abs(z - f.zc)));
    return y;
  };
  M.add({ k: 'bridge', x: 0, z: 0, x0: M.bridge.x0, x1: M.bridge.x1, w: 6 });
  for (const f of M.fords) M.objects.push({ k: 'ford', x: (f.x0 + f.x1) / 2, z: f.zc, w: f.x1 - f.x0, d: f.halfW * 2 });
  // --- the two camps (CTF bases): tents, a campfire, crates, sandbags and a watchtower
  for (const [team, [cx, cz]] of Object.entries(camps)) {
    const s = team === 'blue' ? -1 : 1;                    // -1 = west side
    M.add({ k: 'tent', x: cx + s * 9, z: cz - 8, ry: 0.3 * s }, 2.4);
    M.add({ k: 'tent', x: cx + s * 10, z: cz + 7, ry: -0.3 * s }, 2.4);
    M.objects.push({ k: 'campfire', x: cx + s * 5, z: cz + 0.5 });
    M.add({ k: 'tower', x: cx + s * 12, z: cz - 1 }, 2);
    M.flag(cx + s * 12, cz - 1, 4, 1.1, 0, 8.4, false);
    for (const [x, z] of [[cx + s * 4, cz - 10], [cx + s * 5.1, cz - 10.4], [cx + s * 4.5, cz + 10]]) M.add({ k: 'crate', x, z, y0: 0, s: 1.1, ry: R() }, 0.8);
    M.add({ k: 'barrel', x: cx + s * 3.2, z: cz + 10.6, tip: false, c: Math.floor(R() * 3) }, 0.5);
    const fa = s < 0 ? 0 : Math.PI;                        // sandbags face the enemy side
    M.add({ k: 'bags', x: cx - s * 6, z: cz - 9, R: 2.4, a0: fa - 0.9, a1: fa + 0.9 }, 2);
    M.add({ k: 'bags', x: cx - s * 6, z: cz + 9, R: 2.4, a0: fa - 0.9, a1: fa + 0.9 }, 2);
    M.flag(cx - s * 2, cz - 12, 6.5, 1);
  }
  // --- houses: log cabins and stone cottages on both sides
  for (const [x, z, ry, w, d, c] of [[-34, 26, 0.3, 7, 5.2, 0], [-40, -44, -0.2, 6.5, 5, 1], [-14, -56, 0.1, 6, 4.8, 0], [-60, 34, 0.5, 6.5, 5, 1],
    [34, -26, 0.3 + Math.PI, 7, 5.2, 0], [40, 44, -0.2 + Math.PI, 6.5, 5, 1], [14, 56, 0.1 + Math.PI, 6, 4.8, 0], [60, -34, 0.5 + Math.PI, 6.5, 5, 1]]) {
    M.objects.push({ k: 'cabin', x, z, ry, w, d, c }); M.colRect(x, z, w + 1.4, d + 1.4, ry);
    const wx = x + Math.cos(ry) * (w / 2 + 2.2), wz = z - Math.sin(ry) * (w / 2 + 2.2);
    M.objects.push({ k: 'woodpile', x: wx, z: wz, ry }); M.colliders.push({ x: wx, z: wz, r: 1.1 });
  }
  // --- small hunters' camps in the woods (one tent + fire + crates)
  for (const [x, z] of [[-30, 46], [30, -46], [-58, -26], [58, 26]]) {
    M.add({ k: 'tent', x: x + 2.5, z: z - 2, ry: R() }, 2.4);
    M.objects.push({ k: 'campfire', x: x - 1.5, z: z + 1 });
    M.add({ k: 'crate', x: x - 3.4, z: z - 1.8, y0: 0, s: 1, ry: R() }, 0.75);
    M.add({ k: 'log', x: x - 1.5, z: z + 3.2, ry: 0.1, L: 3 }, 1.35);
  }
  M.add({ k: 'tower', x: -12, z: -24 }, 2); M.flag(-12, -24, 4, 1.1, 0, 8.4, false);
  M.add({ k: 'tower', x: 12, z: 24 }, 2); M.flag(12, 24, 4, 1.1, 0, 8.4, false);
  M.flag(-11, 4, 6.5, 1); M.flag(11, -4, 6.5, 1);
  // stone walls and a machine-gun nest guarding each bridge head
  for (const [x, z, ry] of [[-15, -6, 0.2], [15, 6, 0.2], [-18, 26, 1.3], [18, -26, 1.3], [-40, 12, 0.1], [40, -12, 0.1]])
    M.add({ k: 'swall', x, z, ry, seed: Math.floor(R() * 1e9) }, 2.6);
  M.add({ k: 'nest', x: -15, z: 8 }, 2); M.add({ k: 'nest', x: 15, z: -8 }, 2);
  // Fence posts (visual) along both roads
  { let acc = 0; const posts = [];
    for (let i = 1; i < road.length; i++) { const a = road[i - 1], b = road[i]; if (Math.abs(b[0]) < 18 || Math.abs(b[0]) > 36) { if (posts.length) M.add({ k: 'fence', posts: posts.splice(0) }); continue; }
      const L = dist(a[0], a[1], b[0], b[1]); acc += L; if (acc < 2.6) continue; acc = 0;
      const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; posts.push([b[0] - nx * 4, b[1] - nz * 4]); }
    if (posts.length) M.add({ k: 'fence', posts }); }
  for (const [x, z, ry, L] of [[-24, -8, 0.5, 3.2], [24, 8, 0.5, 3.2], [-8, 22, -0.3, 2.6], [8, -22, -0.3, 2.6], [-44, -16, 1.2, 3.2], [44, 16, 1.2, 3.2]])
    M.add({ k: 'log', x, z, ry, L }, L * 0.45);
  // Trees: dense woods, thinner along the lanes and around the clearings
  for (let i = 0; i < 1500; i++) {
    const x = (R() - 0.5) * 156, z = (R() - 0.5) * 156;
    const dens = 0.18 + 0.82 * (0.55 + 0.45 * fbm(x * 0.05 + 7, z * 0.05));
    if (R() > dens) continue;
    if (polyDist(x, z, river) < rw + 2.4) continue;
    const s = 0.8 + R() * 0.55; if (!M.isFree(x, z, 1.4 * s)) continue;
    if (R() < 0.62) M.add({ k: 'pine', x, z, s, c: Math.floor(R() * 4), ry: R() * TAU }, 0.7 * s);
    else M.add({ k: 'leafy', x, z, s, c: Math.floor(R() * 4), autumn: R() < 0.12 ? 1 + Math.floor(R() * 3) : 0, seed: Math.floor(R() * 1e9) }, 0.8 * s);
  }
  for (let i = 0; i < 200; i++) { const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; if (!M.isFree(x, z, 0.8)) continue; if (polyDist(x, z, river) < rw + 1.5) continue; M.add({ k: 'fbush', x, z, seed: Math.floor(R() * 1e9) }); }
  for (let i = 0; i < 26; i++) { const x = (R() - 0.5) * 130, z = (R() - 0.5) * 130; if (!M.isFree(x, z, 0.6)) continue; M.add({ k: 'stump', x, z, ry: R() }, 0.5); }
  for (let i = 0; i < 150; i++) {
    const x = (R() - 0.5) * 156, z = (R() - 0.5) * 156, big = R() < 0.3, s = big ? 1.2 + R() * 1.1 : 0.25 + R() * 0.25;
    if (!M.isFree(x, z, big ? s * 1.5 : s)) continue; if (polyDist(x, z, river) < rw + 1) continue;
    M.rock(x, z, s, R, { grey: true, moss: big });
  }
  for (let i = 0; i < river.length; i += 2) { const p = river[i]; if (Math.abs(p[1]) > 72) continue;
    if (Math.abs(p[1]) < 5 || M.fords.some(f => Math.abs(p[1] - f.zc) < f.halfW + 2)) continue;
    for (let k = 0; k < 2; k++) { const off = (R() - 0.5) * 2 * (rw + 1.2), x = p[0] + off, z = p[1] + (R() - 0.5) * 3;
      if (!M.isFree(x, z, 0.3, false)) continue;
      if (Math.abs(off) > rw - 1) M.add({ k: 'reeds', x, z, seed: Math.floor(R() * 1e9) });
      else M.objects.push({ k: 'rock', x, z, s: 0.35 + R() * 0.4, v: Math.floor(R() * 6), c: 0, ry: R() * TAU, sx: 1, sy: 0.7, sz: 1, grey: true }); } }
  for (let i = 0; i < 760; i++) { const x = (R() - 0.5) * 156, z = (R() - 0.5) * 156;
    if (!M.isFree(x, z, 0.2, false)) continue; if (polyDist(x, z, river) < rw + 1) continue; if (polyDist(x, z, road) < 2.6) continue;
    if (R() < 0.18) M.add({ k: 'flower', x, z, c: Math.floor(R() * 3), ry: R() }); else M.add({ k: 'grass', x, z, seed: Math.floor(R() * 1e9) }); }
  M.pads = [[-20, 13], [20, -13], [-26, -30], [26, 30], [-30, 46], [30, -46], [-40, 1], [40, -1], [-16, -1], [16, 1]];
  M.hills = [[0, 0], [-20, 13], [20, -13], [-26, -30], [26, 30]];
  M.convoyVia = [[-26, -30], [fx1, -42], [30, -46], [20, -13]];
  M.env = { sky: 0xcfe6ff, ground: 0x557a3a, fog: 0xb7d3bd, dust: 0x9c8466 };
  return finish(M, (x) => x < 0);
}

/* ============================ HAWLER (ERBIL) ============================
   The Citadel on its mound in the north with the ring road around it, a
   boulevard along its southern foot, Shar Park (big and open) in front of
   it, the sandstone bazaar (Qaysari) with clock towers on either side,
   and proper city blocks between straight streets. Most blocks have a
   narrow alley through them (some go under a house — hidden paths), and
   the cars are parked at the curb, never in a junction. Trees, palms,
   lamps, benches and street flags get knocked over by tanks. */
function hawler() {
  const M = base('hawler', 'Hawler City', 'city', 3303);
  const R = M.R;
  const C = [0, -30], CR = 19.5, CT = 14.5, CH = 7;          // citadel centre, base radius, top radius, height
  const HW = 3.5, EDGE = HW + 2.1;                              // road half-width, lot edge (road + sidewalk)
  const ring = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; ring.push([C[0] + dcos(a) * 24, C[1] + dsin(a) * 24]); }
  M.road = null;
  M.roads = [ring, [[0, -54], [0, -90]], [[-90, -30], [-24, -30]], [[24, -30], [90, -30]], [[-90, -6], [90, -6]],
    [[-28, -6], [-28, 90]], [[28, -6], [28, 90]], [[-90, 30], [90, 30]], [[-90, 58], [90, 58]], [[-58, -90], [-58, 90]], [[58, -90], [58, 90]]];
  const roadDist = (x, z, skip = null) => { let m = 1e9; for (const r of M.roads) if (r !== skip) { const d = polyDist(x, z, r); if (d < m) m = d; } return m; };
  const P = M.park = { x0: -28 + EDGE, x1: 28 - EDGE, z0: -6 + EDGE, z1: 30 - EDGE };        // −22.4…22.4 × −0.4…24.4
  const PC = [0, (P.z0 + P.z1) / 2];
  M.alleys = [];
  // Asphalt ribbons (drawn as real geometry, not ground colour) + zebra crossings
  M.roads.forEach((pts, i) => M.objects.push({ k: 'road', x: pts[0][0], z: pts[0][1], pts, w: 7, ring: i === 0 }));
  for (const [x, z, ang] of [[-28, 1, 0], [28, 1, 0], [-28, 23, 0], [28, 23, 0], [-21, 30, Math.PI / 2], [21, 30, Math.PI / 2], [0, 30, Math.PI / 2],
    [-58, 23, 0], [58, 23, 0], [-35, -6, Math.PI / 2], [35, -6, Math.PI / 2], [-58, -13, 0], [58, -13, 0], [-7, -60, Math.PI / 2]])
    M.objects.push({ k: 'zebra', x, z, ang, w: 7 });
  M.citadel = { x: C[0], z: C[1], R: CR, T: CT, H: CH };
  M.lanes = [...ellipse(0, -30, 24, 24, 64), ...line([-66, -6], [66, -6], 40), ...line([-28, -2], [-28, 66], 24), ...line([28, -2], [28, 66], 24),
    ...line([-66, 30], [66, 30], 40), ...line([-66, 58], [66, 58], 36), ...line([-66, -30], [-26, -30], 14), ...line([26, -30], [66, -30], 14),
    ...line([-58, -66], [-58, 66], 36), ...line([58, -66], [58, 66], 36), ...line([0, -56], [0, -66], 4), ...ellipse(PC[0], PC[1] - 1, 12, 3.5, 20)];
  // The flat top of the mound reaches further out than the ring of walls standing on it, so the
  // walls sit ON the hill with ground showing outside them. They used to start exactly at the lip
  // and looked like they were sliding off. The foot stays where it was, clear of the ring road,
  // so the slope is simply a little steeper.
  const CTG = CT + 2.2;
  M.height = (x, z) => {
    const d = dist(x, z, C[0], C[1]);
    return CH * smooth(CR, CTG, d) + (fbm(x * 0.2, z * 0.2) - 0.5) * 0.08;
  };
  // Citadel (the mound itself is terrain; walls, houses and the big flag are the prefab)
  M.add({ k: 'citadel', x: C[0], z: C[1], R: CR, T: CT, H: CH, seed: 77 }, CR + 0.3);
  M.flag(C[0], C[1], 12, 2.4, 0, CH, false);
  // ---- Shar Park: bigger, with wide gaps between the pools and the fountain so tanks never get wedged
  M.add({ k: 'park', x: PC[0], z: PC[1], x0: P.x0, x1: P.x1, z0: P.z0, z1: P.z1 });
  for (const [x, z, w, d] of [[0, 4.6, 3, 5], [-10.5, 4.6, 4, 5], [10.5, 4.6, 4, 5]]) { M.objects.push({ k: 'pool', x, z, w, d }); M.colRect(x, z, w + 0.8, d + 0.8, 0, true); }
  M.objects.push({ k: 'fountain', x: 0, z: 18.2, r: 3.2 }); M.colliders.push({ x: 0, z: 18.2, r: 3.6, low: true });
  for (const x of [-19.6, 19.6]) for (let z = 2; z <= 22; z += 5) M.add({ k: 'ctree', x, z, s: 0.75 + R() * 0.2, c: Math.floor(R() * 4), seed: Math.floor(R() * 1e9) }, 0.6);
  for (const [x, z] of [[-12, 22], [12, 22], [-6, 12.2], [6, 12.2]]) M.add({ k: 'ctree', x, z, s: 0.65, c: 1, seed: Math.floor(R() * 1e9) }, 0.55);
  for (const x of [-5.4, 5.4]) for (const z of [1.5, 8.5]) M.objects.push({ k: 'lamp', x, z });
  for (const x of [-15, 15]) for (const z of [8, 16]) M.objects.push({ k: 'lamp', x, z });
  for (const [x, z, ry] of [[-3.6, 10.6, 0], [3.6, 10.6, 0], [-9, 18, Math.PI / 2], [9, 18, Math.PI / 2], [-15, 2.5, 0], [15, 2.5, 0], [-15, 22.5, 0], [15, 22.5, 0]]) M.objects.push({ k: 'bench', x, z, ry });
  M.flag(-5, 23.6, 8, 1.3); M.flag(5, 23.6, 8, 1.3);
  // ---- helpers for city blocks
  const bld = (x, z, w, d, big = false) => {
    const h = (big ? 4.6 : 3) + Math.floor(R() * 4) * 1.6;
    M.objects.push({ k: 'building', x, z, w, d, h, c: Math.floor(R() * 6), seed: Math.floor(R() * 1e9), flag: R() < 0.14 });
    M.colRect(x, z, w, d, 0);
    return h;
  };
  const okRect = (x0, x1, z0, z1) => {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2]]) {
      if (roadDist(x, z) < HW + 1.6 || dist(x, z, C[0], C[1]) < 29) return false;
    }
    return true;
  };
  const split = (a, b, size) => { const n = Math.max(1, Math.round((b - a) / size)), w = (b - a) / n; return Array.from({ length: n }, (_, i) => [a + w * i, a + w * (i + 1)]); };
  const AW = 5.6, GAP = 0.35;                                  // alley clear width, half gap between houses (houses touch: no squeezing between them)
  // Fill a block with houses. Alleys: one through the block (both ways on big blocks), centred on the 4 m nav grid.
  const block = (x0, x1, z0, z1, opt = {}) => {
    const W = x1 - x0, D = z1 - z0; const ax = [], az = [];
    const snap = (v, a, b) => Math.max(a + 7, Math.min(b - 7, Math.round(v / 4) * 4));
    if (!opt.noAlley) {
      if ((W >= D || D >= 30) && W >= 18) ax.push(snap((x0 + x1) / 2 + (R() - 0.5) * 6, x0, x1));   // alley running north–south
      if ((D > W || W >= 30) && D >= 18) az.push(snap((z0 + z1) / 2 + (R() - 0.5) * 6, z0, z1));   // alley running east–west
    }
    const cuts = (a, b, list) => { const out = []; let s = a; for (const c of list) { out.push([s, c - AW / 2]); s = c + AW / 2; } out.push([s, b]); return out; };
    const xs = cuts(x0, x1, ax).flatMap(([a, b]) => split(a, b, 8)), zs = cuts(z0, z1, az).flatMap(([a, b]) => split(a, b, 8));
    for (const [a0, a1] of xs) for (const [b0, b1] of zs) {
      const bx0 = a0 + GAP, bx1 = a1 - GAP, bz0 = b0 + GAP, bz1 = b1 - GAP;
      if (bx1 - bx0 < 3 || bz1 - bz0 < 3 || !okRect(bx0, bx1, bz0, bz1)) continue;
      const street = a0 === x0 || a1 === x1 || b0 === z0 || b1 === z1;
      if (street && !opt.dense && R() < 0.06 && bx1 - bx0 > 5 && bz1 - bz0 > 5) {   // a small square with a tree and a bench
        const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
        M.objects.push({ k: 'plaza', x: cx, z: cz, w: bx1 - bx0, d: bz1 - bz0 });
        M.add({ k: 'ctree', x: cx, z: cz, s: 0.7, c: Math.floor(R() * 4), seed: Math.floor(R() * 1e9) }, 0.55);
        M.objects.push({ k: 'bench', x: cx, z: bz1 - 0.8, ry: 0 });
        continue;
      }
      bld((bx0 + bx1) / 2, (bz0 + bz1) / 2, bx1 - bx0, bz1 - bz0);
    }
    // the alleys: paving, a few crates, and on some an upper floor bridging across between two houses (a hidden passage)
    const house = (x, z) => M.objects.find(o => o.k === 'building' && Math.abs(o.x - x) < o.w / 2 && Math.abs(o.z - z) < o.d / 2);
    const arch = (x, z, w, d, a, b) => { const h1 = house(...a), h2 = house(...b); if (!h1 || !h2) return;
      M.objects.push({ k: 'arch', x, z, w, d, h: Math.min(h1.h, h2.h) + 0.01, ry: 0, c: h1.c }); };
    for (const x of ax) {
      M.alleys.push({ x0: x - AW / 2, x1: x + AW / 2, z0, z1 });
      M.objects.push({ k: 'alley', x, z: (z0 + z1) / 2, w: AW, d: z1 - z0 });
      if (R() < 0.65) { const zc = R() < 0.5 ? z0 + 2.5 : z1 - 2.5; arch(x, zc, AW + 0.9, 4, [x - AW / 2 - 1.5, zc], [x + AW / 2 + 1.5, zc]); }
      if (D > 16 && R() < 0.7) { const zc = z0 + D * (0.3 + R() * 0.4); M.add({ k: 'barrel', x: x + AW / 2 - 0.7, z: zc, tip: false, c: Math.floor(R() * 3) }, 0.45); }
    }
    for (const z of az) {
      M.alleys.push({ x0, x1, z0: z - AW / 2, z1: z + AW / 2 });
      M.objects.push({ k: 'alley', x: (x0 + x1) / 2, z, w: x1 - x0, d: AW });
      if (R() < 0.65) { const xc = R() < 0.5 ? x0 + 2.5 : x1 - 2.5; arch(xc, z, 4, AW + 0.9, [xc, z - AW / 2 - 1.5], [xc, z + AW / 2 + 1.5]); }
      if (W > 16 && R() < 0.7) { const xc = x0 + W * (0.3 + R() * 0.4); M.add({ k: 'crate', x: xc, z: z - AW / 2 + 0.8, y0: 0, s: 1, ry: R() }, 0.7); }
    }
  };
  // ---- blocks between the streets (lot edges = road centre ± 5.6)
  const XL = 76;                                 // outermost lots run past the map edge (backdrop)
  const cols = [[-XL, -58 - EDGE], [-58 + EDGE, -28 - EDGE], [-28 + EDGE, 28 - EDGE], [28 + EDGE, 58 - EDGE], [58 + EDGE, XL]];
  const rows = [[-XL, -30 - EDGE], [-30 + EDGE, -6 - EDGE], [-6 + EDGE, 30 - EDGE], [30 + EDGE, 58 - EDGE], [58 + EDGE, XL]];
  // north of the radials: one wide block either side of the north road (the ring cuts its corner off)
  block(cols[0][0], cols[0][1], rows[0][0], rows[0][1]);
  block(-58 + EDGE, -EDGE, rows[0][0], rows[0][1]);
  block(EDGE, 58 - EDGE, rows[0][0], rows[0][1]);
  block(cols[4][0], cols[4][1], rows[0][0], rows[0][1]);
  // between the radials and the boulevard
  block(cols[0][0], cols[0][1], rows[1][0], rows[1][1], { noAlley: true });
  block(-58 + EDGE, -22, rows[1][0], rows[1][1], { noAlley: true });
  block(22, 58 - EDGE, rows[1][0], rows[1][1], { noAlley: true });
  block(cols[4][0], cols[4][1], rows[1][0], rows[1][1], { noAlley: true });
  // the park row: bazaar blocks either side of the park
  block(cols[0][0], cols[0][1], rows[2][0], rows[2][1]);
  block(cols[4][0], cols[4][1], rows[2][0], rows[2][1]);
  for (const sgn of [-1, 1]) {
    const ax = sgn * (28 + EDGE + 3.75), z = (rows[2][0] + rows[2][1]) / 2, len = rows[2][1] - rows[2][0] - 1;
    M.objects.push({ k: 'arcade', x: ax, z, len, ry: sgn < 0 ? Math.PI / 2 : -Math.PI / 2, H: 5.5, tower: true });
    M.colRect(ax, z, 7.5, len, 0);
    M.flag(ax, z - sgn * (len / 2 - 1.8), 5, 1.2, 0, 16.4, false);    // on the clock tower
    for (let k = 0; k < 6; k++) M.objects.push({ k: 'umbrella', x: sgn * (28 + HW + 1.2), z: z - 10 + k * 4 + R(), c: Math.floor(R() * 3) });
    // houses behind the bazaar
    const bx0 = sgn < 0 ? -58 + EDGE : 28 + EDGE + 7.8, bx1 = sgn < 0 ? -28 - EDGE - 7.8 : 58 - EDGE;
    block(bx0, bx1, rows[2][0], rows[2][1], { noAlley: true, dense: true });
    // market crates at the arcade ends (breakable cover)
    for (const zz of [rows[2][0] + 0.8, rows[2][1] - 0.8]) {
      const cx = sgn * (28 + HW + 1.3);
      M.add({ k: 'crate', x: cx, z: zz, y0: 0, s: 1.05, ry: R() * 0.6 }, 0.75);
      M.objects.push({ k: 'crate', x: cx, z: zz, y0: 1.05, s: 0.9, ry: R() });
      M.add({ k: 'barrel', x: cx, z: zz + (zz < z ? 1.5 : -1.5), tip: false, c: Math.floor(R() * 3) }, 0.45);
    }
  }
  // south of the park and the outer ring of blocks
  for (const [c0, c1] of cols) block(c0, c1, rows[3][0], rows[3][1]);
  for (const [c0, c1] of cols) block(c0, c1, rows[4][0], rows[4][1]);
  // Modern skyline beyond the playable area (backdrop)
  for (let i = 0; i < 26; i++) {
    const side = i % 4, t = (i >> 2) / 6;
    const x = side < 2 ? -90 + t * 180 + R() * 8 : (side === 2 ? -86 - R() * 10 : 86 + R() * 10);
    const z = side < 2 ? -86 - R() * 12 : -70 + t * 140 + R() * 8;
    M.objects.push({ k: 'skyscraper', x, z, w: 7 + R() * 6, d: 7 + R() * 6, h: 22 + R() * 40, c: Math.floor(R() * 4) });
  }
  const freeCol = (x, z, r, m = 0.1) => { for (const c of M.colliders) if (dist(x, z, c.x, c.z) < r + c.r + m) return false; return true; };
  // Parked cars: at the curb, never in a junction or on a crossing (20% more than before)
  const Rc = rng(3303 + 313);
  for (const rd of M.roads.slice(1)) {
    const [[ax, az], [bx, bz]] = rd; const L = dist(ax, az, bx, bz), ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let u = 4; u < L - 4; u += 6 + Rc() * 7) {
      if (Rc() < 0.2) continue;
      const side = Rc() < 0.5 ? -1 : 1, x = ax + ux * u - uz * side * 4.3, z = az + uz * u + ux * side * 4.3;
      if (Math.abs(x) > 72 || Math.abs(z) > 72 || dist(x, z, C[0], C[1]) < 31) continue;
      if (roadDist(x, z, rd) < HW + 6.5) continue;                                   // keep junctions clear
      if (M.objects.some(o => o.k === 'zebra' && dist(o.x, o.z, x, z) < 7)) continue;
      if (![-1.6, 0, 1.6].every(k => freeCol(x + ux * k, z + uz * k, 0.95))) continue;
      const ry = Math.atan2(ux, uz) + (Rc() < 0.5 ? Math.PI : 0);
      M.objects.push({ k: 'car', x, z, ry, c: Math.floor(Rc() * 6) }); M.colRect(x, z, 1.9, 4.3, ry);
    }
  }
  // Street flags at the main junctions (they fall over when rammed)
  for (const [x, z] of [[-33, -11], [33, -11], [-33, 35], [33, 35], [-5.2, -59.2], [5.2, -59.2], [-53, 35], [53, 35], [-63, -35], [63, -35], [-23, 35], [23, 35]])
    if (freeCol(x, z, 0.6)) M.objects.push({ k: 'sflag', x, z, h: 7, s: 1 });
  // Street life: palms and street lights on the sidewalks
  { const D = rng(3303 + 555);
    for (const rd of M.roads.slice(1)) {
      const [[ax, az], [bx, bz]] = rd; const L = dist(ax, az, bx, bz), ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let u = 6; u < L - 4; u += 11) for (const side of [-1, 1]) {
        const x = ax + ux * u - uz * side * 4.9, z = az + uz * u + ux * side * 4.9;
        if (Math.abs(x) > 74 || Math.abs(z) > 74 || dist(x, z, C[0], C[1]) < 29) continue;
        if (!freeCol(x, z, 0.8) || roadDist(x, z, rd) < 5.8) continue;
        if (((u / 11) | 0) % 2 === (side > 0 ? 0 : 1)) M.add({ k: 'palm', x, z, s: 0.75 + D() * 0.25, seed: Math.floor(D() * 1e9) }, 0.4);
        else M.objects.push({ k: 'slamp', x, z, ry: Math.atan2(-uz * side, ux * side) });
      }
    }
  }
  M.pads = [[-28, 12], [28, 12], [0, -58], [-43, -30], [43, -30], [0, 30], [-58, 44], [58, 44], [0, 58], [-43, -6], [43, -6]];
  M.hills = [[0, -6], [PC[0], 9.6], [-28, 30], [28, 30], [-58, -6], [58, -6]];
  M.bases = { blue: [-58, 12], red: [58, 12] };
  M.convoyVia = [[-58, -30], [-24, -30], [0, -54], [24, -30], [58, -30]];
  M.env = { sky: 0xc9e2ff, ground: 0xb9a582, fog: 0xe8dcc4, dust: 0xcdbb98 };
  return finish(M, (x) => x < 0);
}

/* ============================ STADIUM (Tank Ball only) ============================
   A football pitch with walls all round, goals at both ends, stands full
   of fans, flood lights and advertising boards. Blue defends the west goal. */
function stadium() {
  const M = base('stadium', 'Hawler Stadium', 'stadium', 4404);
  const HX = 50, HZ = 30, GW = 9, GD = 6, CUT = 7;                 // half length / width, goal half-width, goal depth, corner cut
  M.pitch = { hx: HX, hz: HZ, gw: GW, gd: GD };
  M.height = () => 0;
  // walls (low boards: shells fly over them? no — they're the stadium wall, so they stop shells and the ball)
  const W = (ax, az, bx, bz) => M.colLine(ax, az, bx, bz, 0.7);
  W(-HX + CUT, -HZ - 0.7, HX - CUT, -HZ - 0.7); W(-HX + CUT, HZ + 0.7, HX - CUT, HZ + 0.7);
  for (const s of [-1, 1]) {
    W(s * (HX + 0.7), -HZ + CUT, s * (HX + 0.7), -GW - 0.7); W(s * (HX + 0.7), GW + 0.7, s * (HX + 0.7), HZ - CUT);
    W(s * (HX - CUT), -HZ - 0.7, s * (HX + 0.7), -HZ + CUT); W(s * (HX - CUT), HZ + 0.7, s * (HX + 0.7), HZ - CUT);   // cut corners: the ball never gets stuck
    W(s * (HX + 0.7), -GW - 0.7, s * (HX + GD + 0.7), -GW - 0.7); W(s * (HX + 0.7), GW + 0.7, s * (HX + GD + 0.7), GW + 0.7);   // goal pocket
    W(s * (HX + GD + 0.9), -GW - 0.7, s * (HX + GD + 0.9), GW + 0.7);
    M.objects.push({ k: 'goal', x: s * (HX + GD / 2), z: 0, s, w: GW * 2, d: GD });
  }
  M.objects.push({ k: 'pitch', x: 0, z: 0, hx: HX, hz: HZ, cut: CUT });
  // stands, lights and boards outside the walls (backdrop)
  for (const s of [-1, 1]) {
    // the camera looks from the south, so the south stand is low and open (it never hides the pitch)
    M.objects.push({ k: 'stand', x: 0, z: s * (HZ + (s > 0 ? 10 : 8)), len: HX * 2 + 10, ry: s > 0 ? 0 : Math.PI, rows: s > 0 ? 3 : 7, roof: s < 0, seed: 11 + s });
    M.objects.push({ k: 'stand', x: s * (HX + GD + 9), z: 0, len: HZ * 2 + 6, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, rows: 5, roof: false, seed: 21 + s });
    for (const t of [-1, 1]) M.objects.push({ k: 'floodlight', x: s * (HX + 6), z: t * (HZ + 6) });
    for (let u = -HX + CUT + 4; u < HX - CUT - 2; u += 8) M.objects.push({ k: 'adboard', x: u + 3, z: s * (HZ + 1.6), ry: 0, c: Math.floor(Math.abs(u * 7 + s * 3)) % 5 });
  }
  M.flag(-HX - 3, -HZ - 3, 9, 1.4, 0, 0, false); M.flag(HX + 3, HZ + 3, 9, 1.4, 0, 0, false); M.flag(HX + 3, -HZ - 3, 9, 1.4, 0, 0, false); M.flag(-HX - 3, HZ + 3, 9, 1.4, 0, 0, false);
  M.lanes = [];
  for (let x = -HX + 6; x <= HX - 6; x += 4) for (const z of [-HZ + 5, -HZ / 2, 0, HZ / 2, HZ - 5]) M.lanes.push([x, z]);
  M.pads = [[-24, -20], [24, 20], [-24, 20], [24, -20]];
  M.hills = [[0, 0]];
  M.bases = { blue: [-HX + 6, 0], red: [HX - 6, 0] };
  M.ballPitch = { goals: { blue: [-HX - GD / 2, 0], red: [HX + GD / 2, 0] }, mid: [0, 0], line: HX };
  M.env = { sky: 0xbfdcff, ground: 0x4f8f3e, fog: 0xd6e6f0, dust: 0xb9c79a };
  return finish(M, (x) => x < 0);
}

const cache = {};
export const MAP_IDS = ['hawler', 'desert', 'forest', 'stadium'];
export const MAP_NAMES = { hawler: 'Hawler City', desert: 'Dune Crossing', forest: 'Pinewood Ford', stadium: 'Hawler Stadium' };
export function getMap(id) {
  if (!cache[id]) cache[id] = buildMap(id);
  return cache[id];
}
/** Build a map from scratch, ignoring the cache (used by the speed test). */
export function buildMap(id) {
  return id === 'forest' ? forest() : id === 'desert' ? desert() : id === 'stadium' ? stadium() : hawler();
}
/* ====================================================================
   LOBBY MAPS — a second copy of each map, used only behind the menu.

   The playing maps are built for a match: cover everywhere, props in the
   open, a river where you want to stand. Behind the menu we need the
   opposite — a clear piece of ground with a good view, so the line-up of
   tanks is never hidden behind a rock or standing in a stream.

   So each map gets a staging area: a spot to stand, somewhere for the
   camera, and a radius that is swept clear of everything the map put
   there. The terrain, the landmarks and the skyline are untouched, so it
   still looks like the map you are about to play.
   ==================================================================== */
export const LOBBY = {
  // Shar Park, looking north up the park at the Citadel on its mound.
  hawler:  { stage: { x: 3.1, z: 26.5 }, look: { x: 0, z: 17 },
             shot: { dist: 23, height: 5.4, side: -2.5, aim: 2.2 }, clear: 15 },
  // Open sand south of the road, looking north at the mesas on the skyline.
  desert:  { stage: { x: 2, z: 34 }, look: { x: -2, z: 16 },
             shot: { dist: 24, height: 5.8, side: -2.5, aim: 2.4 }, clear: 17 },
  // The east bank, looking across the ford at the bridge and the pines beyond.
  // Well east of the ford, looking back north-west across it: the bridge and the two bank flags
  // sit behind the line-up. The old spot was 0.2 m from the water and the left tank stood in it.
  forest:  { stage: { x: 26, z: -5 }, look: { x: 8, z: -3 },
             shot: { dist: 24, height: 5.6, side: 5, aim: 2.3 }, clear: 15 },
  // On the pitch, looking down it at the far stand.
  stadium: { stage: { x: 2, z: 24 }, look: { x: 0, z: 4 },
             shot: { dist: 22, height: 5.6, side: -2, aim: 2.2 }, clear: 14 },
};

/** Distance from (x,z) to a segment. */
function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / l2)) : 0;
  return Math.hypot(wx - vx * t, wz - vz * t);
}

/** Every point an object occupies. Most sit at an (x,z); fences and roads are a run of points. */
function pointsOf(o) {
  if (o.posts && o.posts.length) return o.posts;
  if (o.pts && o.pts.length) return o.pts;
  if (o.cols && o.cols.length) return o.cols.map(c => [c.x, c.z]);
  return Number.isFinite(o.x) && Number.isFinite(o.z) ? [[o.x, o.z]] : null;
}

/**
 * Sweep the staging ground clear — and, just as importantly, every line of sight the menu camera
 * can end up using. It does not sit still: it slides sideways and pulls back to fit the line-up
 * between the menu columns, so clearing only the one straight-ahead corridor left trees and
 * buildings standing in the shot as soon as a squad turned up.
 */
function clearStage(M, L) {
  const S = L.stage;
  // the line-up is four spots 6.6 m apart, so it reaches about 10 m either side of the middle
  const REACH = 10, TANK = 3.4;
  const radius = Math.max(L.clear, REACH + TANK + 3);
  // The camera's whole range, with room to spare: the shot slides sideways and pulls back on its
  // own to keep every tank clear of the menu panels, and on a wide screen it uses all of it.
  const cams = [];
  for (let pan = -14; pan <= 14; pan += 3.5) {
    for (const back of [1, 1.35, 1.7, 2.05, 2.4]) {
      cams.push([S.x + L.shot.side + pan, S.z + L.shot.dist * back]);
    }
  }
  // and every one of those has to see every standing spot — the middle one included, which is
  // the line anything standing dead ahead of the line-up would sit on
  const aims = [-REACH, -REACH / 2, 0, REACH / 2, REACH].map((o) => [S.x + o, S.z]);
  const blocks = (x, z) => {
    if (Math.hypot(x - S.x, z - S.z) <= radius) return true;
    for (const [cx, cz] of cams) for (const [ax, az] of aims) {
      if (segDist(x, z, cx, cz, ax, az) <= 6) return true;
    }
    return false;
  };
  const keep = (o) => {
    const pts = pointsOf(o);
    if (!pts) return true;                      // no position we can read: leave it alone
    return !pts.some(([x, z]) => blocks(x, z));
  };
  for (let i = M.objects.length - 1; i >= 0; i--) if (!keep(M.objects[i])) M.objects.splice(i, 1);
  for (let i = M.colliders.length - 1; i >= 0; i--) if (!keep(M.colliders[i])) M.colliders.splice(i, 1);
  return M;
}

const lobbyCache = {};
/**
 * The menu version of a map: the same world, with the staging area swept clear.
 * Built fresh (never the cached playing map) so a match is never affected, and only
 * built for a map once you actually look at it.
 */
export function getLobbyMap(id) {
  const key = MAP_IDS.includes(id) ? id : 'hawler';
  if (!lobbyCache[key]) {
    const M = buildMap(key);
    M.lobby = LOBBY[key] || LOBBY.hawler;
    lobbyCache[key] = clearStage(M, M.lobby);
  }
  return lobbyCache[key];
}

/** The map a match really uses: Tank Ball is always played in the stadium, and nothing else is. */
export function mapForMode(mode, id) {
  if (mode === 'ball') return 'stadium';
  return PLAY_MAPS.includes(id) ? id : 'hawler';
}
