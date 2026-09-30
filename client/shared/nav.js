/* Bot navigation: a 4 m grid over the open ground of each map (no buildings,
   no river except the bridge), connected to its 8 neighbours when a tank can
   drive straight between them. Bots ask for a path with A*. Built once per map. */
import { GAME } from './config.js';
import { dist, polyNearest } from './math.js';
import { inFord } from './sim.js';

const STEP = 4;

function freeAt(M, x, z, margin) {
  if (Math.abs(x) > M.bound - 1 || Math.abs(z) > M.bound - 1) return false;
  for (const c of M.near(x, z)) if (!c.soft && dist(x, z, c.x, c.z) < c.r + margin) return false;
  if (M.river) {
    const n = polyNearest(x, z, M.river);
    if (n.d < M.riverW + 0.6) { const b = M.bridge; if (!(b && x > b.x0 && x < b.x1 && Math.abs(z - b.zc) < b.halfW - 0.4) && !inFord(M, x, z)) return false; }
  }
  return true;
}
export function clearLine(M, ax, az, bx, bz, margin = GAME.TANK_RADIUS) {
  const L = dist(ax, az, bx, bz), n = Math.max(1, Math.ceil(L / 0.7));
  for (let i = 1; i < n; i++) { const k = i / n; if (!freeAt(M, ax + (bx - ax) * k, az + (bz - az) * k, margin)) return false; }
  return true;
}

export function getNav(M) {
  M = M.base || M;                 // a room's map copy shares the base map's grid
  if (M.nav) return M.nav;
  const R = GAME.TANK_RADIUS, SPAN = Math.floor(M.bound / STEP) * STEP, N = Math.floor((SPAN * 2) / STEP) + 1;
  const free = new Uint8Array(N * N), xs = new Float32Array(N * N), zs = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, x = -SPAN + i * STEP, z = -SPAN + j * STEP; xs[k] = x; zs[k] = z;
    free[k] = freeAt(M, x, z, R + 0.45) ? 1 : 0;
  }
  const adj = Array.from({ length: N * N }, () => []);
  const D = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = i * N + j; if (!free[a]) continue;
    for (const [di, dj] of D) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const b = ii * N + jj; if (!free[b]) continue;
      if (!clearLine(M, xs[a], zs[a], xs[b], zs[b], R)) continue;
      const w = di && dj ? STEP * Math.SQRT2 : STEP; adj[a].push(b, w); adj[b].push(a, w);
    }
  }
  const nearestNode = (x, z) => {
    const ci = Math.round((x + SPAN) / STEP), cj = Math.round((z + SPAN) / STEP);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= 4 && best < 0; r++)
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue; const k = i * N + j; if (!free[k] || !adj[k].length) continue;
        const d = dist(x, z, xs[k], zs[k]); if (d < bd) { bd = d; best = k; }
      }
    return best;
  };
  // A* with a small binary heap. Returns [[x,z], …] ending at the goal, or null.
  const path = (ax, az, bx, bz, raw = false) => {
    const s = nearestNode(ax, az), g = nearestNode(bx, bz); if (s < 0 || g < 0) return null;
    const cost = new Float32Array(N * N).fill(1e9), prev = new Int32Array(N * N).fill(-1);
    const heap = [[dist(xs[s], zs[s], bx, bz), s]]; cost[s] = 0;
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let found = false, n = 0;
    while (heap.length && n++ < 4000) {
      const [, a] = pop(); if (a === g) { found = true; break; }
      const e = adj[a];
      for (let q = 0; q < e.length; q += 2) {
        const b = e[q], c = cost[a] + e[q + 1];
        if (c < cost[b]) { cost[b] = c; prev[b] = a; push([c + dist(xs[b], zs[b], bx, bz), b]); }
      }
    }
    if (!found) return null;
    const out = []; for (let k = g; k >= 0; k = prev[k]) out.push([xs[k], zs[k]]);
    out.reverse(); out.push([bx, bz]);
    if (raw) return out;                                  // node by node (used right after a bot got stuck)
    // Shortcut: skip nodes the tank can drive past in a straight line.
    const sm = [out[0]];
    let i = 0;
    while (i < out.length - 1) {
      let j = Math.min(out.length - 1, i + 6);
      while (j > i + 1 && !clearLine(M, out[i][0], out[i][1], out[j][0], out[j][1], R + 0.4)) j--;
      sm.push(out[j]); i = j;
    }
    return sm;
  };
  M.nav = { path, nearestNode, clear: (ax, az, bx, bz) => clearLine(M, ax, az, bx, bz) };
  return M.nav;
}
