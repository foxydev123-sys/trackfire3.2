// Small math helpers shared by client and server (no dependencies).
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const stepAngle = (a, b, max) => a + clamp(wrapAngle(b - a), -max, max);

// Deterministic PRNG (mulberry32) — same sequence on server and client.
export function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash (bit-exact on every JS engine, unlike Math.sin) so the
// server and every browser generate identical maps.
function hash(xi, zi) {
  let h = (Math.imul(xi | 0, 374761393) + Math.imul(zi | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 5, z * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 9, z * 4.3 + 1) * 0.1;

// Distance from point to segment / polyline ([[x,z],...]).
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const ex = px - ax - dx * t, ez = pz - az - dz * t;
  return Math.sqrt(ex * ex + ez * ez);
}
export function polyDist(px, pz, pts) {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < m) m = d;
  }
  return m;
}
// Nearest point on polyline → {x, z, d}
export function polyNearest(px, pz, pts) {
  let best = { x: 0, z: 0, d: 1e9 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const x = ax + dx * t, z = az + dz * t, d = Math.sqrt((px - x) * (px - x) + (pz - z) * (pz - z));
    if (d < best.d) best = { x, z, d };
  }
  return best;
}

// Centripetal-ish Catmull-Rom sampling of a 2D control polyline.
export function catmull(pts, n) {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  const segs = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * segs;
    const s = Math.min(Math.floor(f), segs - 1), t = f - s;
    const p0 = P[s], p1 = P[s + 1], p2 = P[s + 2], p3 = P[s + 3];
    const t2 = t * t, t3 = t2 * t;
    const c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

// sqrt is correctly rounded everywhere (Math.hypot is not) — use this in shared logic.
export const dist = (ax, az, bx, bz) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
