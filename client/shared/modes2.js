/* =====================================================================
   The six party modes (server rules, shared by the Node server and the
   offline practice worker). Room calls these hooks; everything else
   (tanks, shells, power-ups, networking) is the normal game.

   convoy  Convoy Escort — push a supply truck from your base to theirs, then swap sides.
   jugg    Juggernaut    — one giant tank; whoever finishes it becomes the giant. Most time as giant wins.
   ball    Tank Ball     — shoot and push a huge ball into the other goal. Shells knock tanks back.
   surv    Survival      — friends hold a spot against harder and harder bot waves; boss every 5th wave.
   potato  Hot Potato    — bump someone to pass the ticking bomb before it blows. Last tank wins.
   bounty  Bounty Hunt   — kills raise your bounty; big bounties show on the map and are worth more.
   ===================================================================== */
import { GAME, NET } from './config.js';
import { dist, wrapAngle } from './math.js';
import { collide } from './sim.js';
import { getNav, clearLine } from './nav.js';
import { tankStats, TANK_IDS } from './tanks.js';

const DT = 1 / NET.TICK_RATE;
const OTHER = { blue: 'red', red: 'blue' };
export const NEW_MODES = ['convoy', 'jugg', 'ball', 'surv', 'potato', 'bounty'];
export const isNew = (m) => NEW_MODES.includes(m);
const R = Math.random;
const alive = (room) => [...room.players.values()].filter(p => p.alive);

/* ---------------- shared helpers ---------------- */
// Knock a tank away (Tank Ball / Hot Potato shells, bumps). Applied over a few ticks, then walls push it back out.
function knock(p, dx, dz, power) { const l = Math.hypot(dx, dz) || 1; p.kb = { x: dx / l * power, z: dz / l * power, t: 0.3 }; }
function stepKnock(room, list) {
  for (const p of list) {
    if (!p.kb || !p.alive) continue;
    const k = p.kb; p.s.x += k.x * DT; p.s.z += k.z * DT; k.t -= DT; k.x *= 0.86; k.z *= 0.86;
    collide(p.s, room.map, list.filter(q => q !== p && q.alive).map(q => q.s));
    if (k.t <= 0) p.kb = null;
  }
}
function pathAlong(path, d) {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], L = dist(ax, az, bx, bz);
    if (acc + L >= d) { const k = (d - acc) / (L || 1); return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, a: Math.atan2(bx - ax, bz - az) }; }
    acc += L;
  }
  const [x, z] = path[path.length - 1], [px, pz] = path[path.length - 2] || [x, z - 1];
  return { x, z, a: Math.atan2(x - px, z - pz) };
}
const pathLen = (path) => { let L = 0; for (let i = 1; i < path.length; i++) L += dist(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]); return L; };

/* =====================================================================
   hooks called by Room
   ===================================================================== */
export function start(room) {
  const m = room.mode, M = room.map, S = room.m2 = { t0: room.time };
  if (m === 'convoy') {
    const path = convoyRoute(M);
    S.path = { blue: path, red: [...path].reverse() }; S.L = pathLen(path);
    S.half = 1; S.att = 'blue'; S.d = 0; S.halfUntil = room.time + GAME.MODES.convoy.halfS * 1000; S.best = { blue: 0, red: 0 };
  }
  if (m === 'jugg') { S.jugg = 0; S.pickAt = room.time + 3000; for (const p of room.players.values()) p.ms = 0; }
  if (m === 'ball') {
    const P = ballPitch(M); S.pitch = P; S.ball = { x: P.mid[0], z: P.mid[1], vx: 0, vz: 0 }; S.goals = P.goals;
  }
  if (m === 'surv') {
    for (const p of [...room.players.values()]) { if (p.wave) room.removePlayer(p); else p.team = 'blue'; }
    room.zone = { x: M.hill.x, z: M.hill.z, r: 9, own: null, acc: { blue: 0, red: 0 } };
    S.wave = 0; S.baseHp = 100; S.phase = 'break'; S.until = room.time + 6000; S.offers = new Map();
    for (const p of room.players.values()) { p.upg = []; p.baseTank = p.tank; }
  }
  if (m === 'potato') { S.bomb = null; S.nextAt = room.time + 3500; S.order = []; for (const p of room.players.values()) p.ms = 0; }
  if (m === 'bounty') for (const p of room.players.values()) p.bounty = 0;
}

/** Called once per tick after tanks moved and shells flew. */
export function step(room, list) {
  const m = room.mode, S = room.m2; if (!S) return;
  stepKnock(room, list);
  if (m === 'convoy') stepConvoy(room, list, S);
  else if (m === 'jugg') stepJugg(room, list, S);
  else if (m === 'ball') stepBall(room, list, S);
  else if (m === 'surv') stepSurv(room, list, S);
  else if (m === 'potato') stepPotato(room, list, S);
  if (room.state === 'playing' && room.tick % NET.SNAPSHOT_EVERY === 0) room.broadcast(stateMsg(room));
}

/** Fast-changing mode state (truck, ball, bomb…), sent a few times a second. */
function stateMsg(room) {
  const S = room.m2, o = { t: 'ms', st: room.time };
  if (room.mode === 'convoy') { const p = pathAlong(S.path[S.att], S.d); o.truck = [+p.x.toFixed(2), +p.z.toFixed(2), +p.a.toFixed(3), Math.round(S.d / S.L * 100)]; }
  if (room.mode === 'ball') o.ball = [+S.ball.x.toFixed(2), +S.ball.z.toFixed(2), +S.ball.vx.toFixed(2), +S.ball.vz.toFixed(2)];
  if (room.mode === 'potato' && S.bomb) o.bomb = [S.bomb.c, Math.max(0, Math.round((S.bomb.until - room.time) / 100) / 10)];
  return o;
}

/** Extra fields for the 'obj' message (HUD objective line). */
export function objInfo(room, o) {
  const S = room.m2; if (!S) return;
  if (room.mode === 'convoy') o.cv = { att: S.att, half: S.half, pct: Math.round(S.d / S.L * 100), best: S.best, left: Math.max(0, Math.round((S.halfUntil - room.time) / 1000)) };
  if (room.mode === 'jugg') o.jg = S.jugg;
  if (room.mode === 'ball') o.goals = S.goals;
  if (room.mode === 'surv') o.sv = { wave: S.wave, hp: Math.round(S.baseHp), phase: S.phase, left: Math.max(0, Math.round((S.until - room.time) / 1000)), foes: [...room.players.values()].filter(p => p.wave && p.alive).length };
  if (room.mode === 'potato') o.pt = { alive: alive(room).length };
}
/** Extra per-player fields for the room info (scoreboards, name tags). */
export function playerInfo(room, p, o) {
  if (room.mode === 'jugg') { o.ms = Math.floor(p.ms || 0); if (p.jugg) o.jg = 1; }
  if (room.mode === 'bounty') o.bn = p.bounty || 0;
  if (room.mode === 'potato') o.ms = p.ms || 0;
  if (room.mode === 'surv' && p.boss) o.jg = 1;
}

export function teamPoints(room, team) { return room.score[team] || 0; }
export function checkScore(room) {
  const lim = GAME.MODES[room.mode].scoreLimit;
  if (room.mode === 'jugg') { for (const p of room.players.values()) if ((p.ms || 0) >= lim) return room.end(p.id); return; }
  if (room.mode === 'bounty' || room.mode === 'ball') for (const t of ['blue', 'red']) if ((room.score[t] || 0) >= lim) return room.end(t);
}
export function timeUp(room) {
  const S = room.m2;
  if (room.mode === 'convoy') return convoyHalfOver(room, S, true);
  if (room.mode === 'jugg' || room.mode === 'potato') { let best = null; for (const p of room.players.values()) if (!best || (p.ms || 0) > (best.ms || 0)) best = p; return room.end(best ? best.id : 'draw'); }
  if (room.mode === 'surv') return room.end(null);
  const b = room.score.blue || 0, r = room.score.red || 0; room.end(b === r ? 'draw' : b > r ? 'blue' : 'red');
}

/** Damage hook: returns the (possibly changed) damage, or -1 to cancel it (knockback modes). */
export function damage(room, v, k, base, from) {
  const m = room.mode;
  if (m === 'ball' || m === 'potato') { if (from) knock(v, v.s.x - from.x, v.s.z - from.z, m === 'ball' ? 22 : 18); return -1; }
  let d = base;
  if (k && (k.jugg || k.boss)) d *= 1.6;
  return d;
}
/** Shells hitting the ball (Tank Ball): push it. Returns true if the shell was used up. */
export function shellHitsBall(room, sh) {
  if (room.mode !== 'ball' || !room.m2) return false;
  const B = room.m2.ball, BR = GAME.MODES.ball.ballR;
  if (dist(sh.x, sh.z, B.x, B.z) > BR + 0.4) return false;
  B.vx += sh.dx * 14; B.vz += sh.dz * 14;
  room.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +sh.x.toFixed(2), z: +sh.z.toFixed(2), v: 0, dmg: 0, w: 1, st: room.time });
  return true;
}

/** A tank died. Returns true if Room should NOT respawn it (handled here). */
export function onKill(room, v, k) {
  const S = room.m2; if (!S) return false;
  if (room.mode === 'jugg' && v.jugg) {
    unJugg(v);
    if (k && k !== v && k.alive) makeJugg(room, k); else { S.jugg = 0; S.pickAt = room.time + 2000; }
    room.sendObj('jugg', null, S.jugg); room.dirty = true;
  }
  if (room.mode === 'bounty' && k && k !== v) {
    const pts = 1 + (v.bounty || 0); room.score[k.team] = (room.score[k.team] || 0) + pts;
    k.bounty = Math.min(5, (k.bounty || 0) + 1); v.bounty = 0; room.dirty = true;
    room.sendObj('bounty', k.team, k.id);
  }
  if (room.mode === 'surv') {
    if (v.wave) { v.removeAt = room.time + 1500; return true; }
  }
  if (room.mode === 'potato') { v.out = true; v.deadT = 0; S.order.push(v.id); v.ms = S.order.length; return true; }
  return false;
}
export function canSpawn(room, p) {
  if (p.removeAt) return false;
  if (room.mode === 'potato' && room.m2 && room.state === 'playing') return !p.out;
  return true;
}
/** Spawn position override (Survival: humans at the spot; waves at the far side). */
export function spawnAt(room, p) {
  if (room.mode === 'surv' && room.m2) {
    const Z = room.zone, pool = p.wave ? room.m2.foeSpawns : null;
    if (pool && pool.length) return pool[Math.floor(R() * pool.length)];
    const a = R() * 6.28; return [Z.x + Math.cos(a) * 5, Z.z + Math.sin(a) * 5];
  }
  if (room.mode === 'ball' && room.m2) {                   // start near your own goal
    const g = room.m2.goals[p.team], pool = room.map.spawns.any.slice().sort((a, b) => dist(a[0], a[1], g[0], g[1]) - dist(b[0], b[1], g[0], g[1])).slice(0, 6);
    return pool.length ? pool[Math.floor(R() * pool.length)] : null;
  }
  if (room.mode === 'convoy' && room.m2) {
    // attackers come back a little behind the truck; defenders well ahead of it — but never right at the truck,
    // so near the end of the route the defence can't just respawn on top of it
    const S = room.m2, C = GAME.MODES.convoy, path = S.path[S.att], truck = pathAlong(path, S.d), att = p.team === S.att;
    const goal = att ? pathAlong(path, Math.max(0, S.d - 24)) : pathAlong(path, Math.min(S.L, S.d + 42));
    const foes = [...room.players.values()].filter(q => q.alive && q.team !== p.team);
    const ok = (a) => dist(a[0], a[1], truck.x, truck.z) >= (att ? 14 : C.defMinDist) && !foes.some(q => dist(a[0], a[1], q.s.x, q.s.z) < 12);
    let pool = room.map.spawns.any.filter(ok);
    if (!pool.length) pool = room.map.spawns.any.slice();
    pool.sort((a, b) => dist(a[0], a[1], goal.x, goal.z) - dist(b[0], b[1], goal.x, goal.z));
    pool = pool.slice(0, 5);
    return pool.length ? pool[Math.floor(R() * pool.length)] : null;
  }
  return null;
}

/** Where bots should go. */
export function botGoal(room, p, list) {
  const S = room.m2; if (!S) return null;
  if (room.mode === 'convoy') {
    const at = pathAlong(S.path[S.att], S.d), ahead = pathAlong(S.path[S.att], Math.min(S.L, S.d + 10));
    const t = p.team === S.att ? at : ahead;
    return { x: t.x + ((p.id * 37) % 7) - 3, z: t.z + ((p.id * 53) % 7) - 3, rush: p.team !== S.att };
  }
  if (room.mode === 'jugg') {
    const j = S.jugg && room.players.get(S.jugg);
    if (j && j !== p && j.alive) return { x: j.s.x, z: j.s.z };
    return null;
  }
  if (room.mode === 'ball') {
    // get behind the ball (seen from their goal), then drive straight through it toward the goal
    const B = S.ball, g = S.goals[OTHER[p.team]], dx = g[0] - B.x, dz = g[1] - B.z, l = Math.hypot(dx, dz) || 1;
    const bx = B.x - p.s.x, bz = B.z - p.s.z, bl = Math.hypot(bx, bz) || 1, cos = (bx * dx + bz * dz) / (bl * l);
    if (cos > 0.6 && bl < 12) return { x: g[0], z: g[1], rush: true };
    const side = ((p.id % 2) ? 1 : -1) * (cos < -0.2 ? 5 : 0);          // swing around the ball instead of pushing it the wrong way
    return { x: B.x - dx / l * 6 - dz / l * side, z: B.z - dz / l * 6 + dx / l * side, rush: true };
  }
  if (room.mode === 'surv') { const Z = room.zone; return { x: Z.x + ((p.id * 37) % 9) - 4, z: Z.z + ((p.id * 53) % 9) - 4, rush: !!p.wave }; }
  if (room.mode === 'potato' && S.bomb) {
    const c = room.players.get(S.bomb.c); if (!c || !c.alive) return null;
    if (c === p) { let best = null, bd = 1e9; for (const q of list) if (q !== p && q.alive) { const d = dist(q.s.x, q.s.z, p.s.x, p.s.z); if (d < bd) { bd = d; best = q; } } return best ? { x: best.s.x, z: best.s.z, rush: true } : null; }
    const dx = p.s.x - c.s.x, dz = p.s.z - c.s.z, l = Math.hypot(dx, dz) || 1; return { x: p.s.x + dx / l * 12, z: p.s.z + dz / l * 12, rush: true };
  }
  if (room.mode === 'bounty') {
    let best = null, bs = -1e9;
    for (const q of list) if (q.alive && room.enemies(p, q)) { const s = (q.bounty || 0) * 15 - dist(q.s.x, q.s.z, p.s.x, p.s.z); if (s > bs) { bs = s; best = q; } }
    return best ? { x: best.s.x, z: best.s.z } : null;
  }
  return null;
}
/** Things bots shoot at besides tanks (Tank Ball: the ball). */
export function botTargets(room, p, foes) {
  if (room.mode === 'ball' && room.m2) {       // shoot the ball only when the shot sends it toward their goal
    const B = room.m2.ball, g = room.m2.goals[OTHER[p.team]];
    const a1 = Math.atan2(B.x - p.s.x, B.z - p.s.z), a2 = Math.atan2(g[0] - B.x, g[1] - B.z);
    if (Math.abs(wrapAngle(a1 - a2)) < 0.6) foes.unshift({ x: B.x, z: B.z, v: 0, yaw: 0 });
  }
  if (room.mode === 'surv' && p.wave) return foes;          // waves only fight
  return foes;
}
/** Messages from players (Survival upgrade choice). */
export function onJSON(room, p, m) {
  if (m.t === 'upg' && room.mode === 'surv' && room.m2) {
    const offer = room.m2.offers.get(p.id); if (!offer || !offer.includes(m.v)) return;
    p.upgPick = m.v; room.m2.offers.delete(p.id); room.send(p, { t: 'upgOk', v: m.v });
  }
}

/* ---------------- Convoy Escort ---------------- */
// The route winds through the map (via points given by the map, or two bends either side of the straight line),
// so it is long and has corners to defend — never a straight dash from base to base.
function convoyRoute(M0) {
  const M = M0.base || M0; if (M.convoyRoute) return M.convoyRoute;
  const nav = getNav(M), B = M.bases.blue, Rd = M.bases.red, pts = M.spawns.any;
  let via = M.convoyVia;
  if (!via) {
    const dx = Rd[0] - B[0], dz = Rd[1] - B[1], L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L, off = Math.min(28, L * 0.32);
    const near = (v) => pts.reduce((b, p) => (dist(p[0], p[1], v[0], v[1]) < dist(b[0], b[1], v[0], v[1]) ? p : b), pts[0]);
    via = [near([B[0] + dx * 0.33 + px * off, B[1] + dz * 0.33 + pz * off]), near([B[0] + dx * 0.66 - px * off, B[1] + dz * 0.66 - pz * off])];
  }
  const stops = [B, ...via, Rd], path = [];
  for (let i = 1; i < stops.length; i++) {
    const seg = nav.path(stops[i - 1][0], stops[i - 1][1], stops[i][0], stops[i][1]) || [stops[i - 1], stops[i]];
    if (path.length) seg.shift(); path.push(...seg.map(p => [p[0], p[1]]));
  }
  return (M.convoyRoute = path.length >= 2 ? path : [B, Rd]);
}
function stepConvoy(room, list, S) {
  const C = GAME.MODES.convoy, pos = pathAlong(S.path[S.att], S.d);
  let esc = 0, def = 0;
  for (const p of list) if (p.alive && dist(p.s.x, p.s.z, pos.x, pos.z) < C.pushR) { if (p.team === S.att) esc++; else def++; }
  const was = S.state;
  // more escorts than defenders at the truck: it keeps rolling (slower when contested)
  S.state = esc > def ? 'moving' : esc && def ? 'blocked' : 'idle';
  if (S.state === 'moving') {
    S.d = Math.min(S.L, S.d + C.truckSpeed * Math.min(1.5, (def ? 0.55 : 0.8) + 0.2 * (esc - def)) * DT);
    for (const p of list) if (p.alive && p.team === S.att && dist(p.s.x, p.s.z, pos.x, pos.z) < C.pushR) p.obj += DT * 0.2;
  }
  const pct = Math.floor(S.d / S.L * 100);
  if (pct > S.best[S.att]) { S.best[S.att] = pct; room.score[S.att] = pct; if (pct % 10 === 0) room.sendObj(); }
  if (was !== S.state) room.sendObj();
  if (S.d >= S.L - 0.01) { room.sendObj('delivered', S.att); return convoyHalfOver(room, S, false); }
  if (room.time >= S.halfUntil) convoyHalfOver(room, S, true);
}
function convoyHalfOver(room, S, timeout) {
  if (S.half === 1) {
    S.half = 2; S.att = OTHER[S.att]; S.d = 0; S.halfUntil = room.time + GAME.MODES.convoy.halfS * 1000;
    room.shells = []; room.rockets = [];
    for (const p of room.players.values()) if (p.connected) room.spawn(p);
    room.sendObj('half', S.att); room.dirty = true;
    return;
  }
  // second half done: when the second team beats the first team's distance the match ends at once (see stepConvoy); otherwise compare
  const b = S.best.blue, r = S.best.red;
  room.end(b === r ? 'draw' : b > r ? 'blue' : 'red');
}

/* ---------------- Juggernaut ---------------- */
function makeJugg(room, p) {
  const S = room.m2; S.jugg = p.id; p.jugg = true;
  p.jbase = p.tank; p.tank = { ...p.tank, hp: Math.round(p.tank.hp * GAME.MODES.jugg.hpMult) };
  p.hp = p.tank.hp; p.s.shield = 1.5;
  room.broadcast({ t: 'mh', id: p.id, mh: p.tank.hp });
  room.sendObj('jugg', null, p.id); room.dirty = true;
}
function unJugg(p) { p.jugg = false; if (p.jbase) { p.tank = p.jbase; p.jbase = null; } }
function stepJugg(room, list, S) {
  if (!S.jugg && room.time >= S.pickAt) { const a = list.filter(p => p.alive); if (a.length) makeJugg(room, a[Math.floor(R() * a.length)]); else S.pickAt = room.time + 1000; }
  const j = S.jugg && room.players.get(S.jugg);
  if (j && !room.players.has(j.id)) { S.jugg = 0; S.pickAt = room.time + 1000; }
  if (j && j.alive) {
    const before = Math.floor(j.ms || 0); j.ms = (j.ms || 0) + DT;
    if (Math.floor(j.ms) !== before) { room.dirty = true; checkScore(room); }
  }
}

/* ---------------- Tank Ball ---------------- */
// The pitch: the longest straight, open stretch of the map (so the ball can actually roll goal to goal).
function ballPitch(M0) {
  const M = M0.base || M0; if (M.ballPitch) return M.ballPitch;
  const pts = M.spawns.any, W = GAME.MODES.ball.ballR + 0.6;
  let best = null, bd = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const [ax, az] = pts[i], [bx, bz] = pts[j], d = dist(ax, az, bx, bz);
    if (d < 30 || d > 64 || d <= bd) continue;
    if (!clearLine(M, ax, az, bx, bz, W)) continue;
    bd = d; best = [pts[i], pts[j]];
  }
  if (!best) best = [M.bases.blue, M.bases.red];
  let [a, b] = best;
  const bb = M.bases.blue; if (dist(b[0], b[1], bb[0], bb[1]) < dist(a[0], a[1], bb[0], bb[1])) [a, b] = [b, a];
  // goals sit a little inside each end so the ball can reach them
  const k = 0.06, g1 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], g2 = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k];
  return (M.ballPitch = { goals: { blue: g1, red: g2 }, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
}
function stepBall(room, list, S) {
  const B = S.ball, C = GAME.MODES.ball, BR = C.ballR, TR = GAME.TANK_RADIUS;
  for (const p of list) {
    if (!p.alive) continue;
    const dx = B.x - p.s.x, dz = B.z - p.s.z, d = Math.hypot(dx, dz);
    if (d < BR + TR) {
      const nx = dx / (d || 1), nz = dz / (d || 1);
      B.x = p.s.x + nx * (BR + TR); B.z = p.s.z + nz * (BR + TR);
      const tv = Math.max(0, Math.sin(p.s.yaw) * p.s.v * nx + Math.cos(p.s.yaw) * p.s.v * nz);
      const vn = B.vx * nx + B.vz * nz, push = Math.max(0, tv * 1.25 + 2 - vn);
      B.vx += nx * push; B.vz += nz * push;
    }
  }
  const f = Math.exp(-C.friction * DT); B.vx *= f; B.vz *= f;
  const sp = Math.hypot(B.vx, B.vz); if (sp > C.maxSpeed) { B.vx *= C.maxSpeed / sp; B.vz *= C.maxSpeed / sp; }
  B.x += B.vx * DT; B.z += B.vz * DT;
  for (const c of room.map.near(B.x, B.z)) {
    if (c.low || (room.map.dead && room.map.dead[c.i])) continue;
    const dx = B.x - c.x, dz = B.z - c.z, d = Math.hypot(dx, dz), min = c.r + BR;
    if (d < min) { const nx = dx / (d || 1), nz = dz / (d || 1); B.x = c.x + nx * min; B.z = c.z + nz * min; const vn = B.vx * nx + B.vz * nz; if (vn < 0) { B.vx -= 1.7 * vn * nx; B.vz -= 1.7 * vn * nz; } }
  }
  // On a real pitch the ball can never leave it (a tank pressing it into the wall can't squeeze it through)
  const Pt = room.map.pitch;
  if (Pt) {
    const mouth = Math.abs(B.z) < Pt.gw - BR + 0.2, lx = mouth ? Pt.hx + Pt.gd - BR : Pt.hx - BR, lz = Pt.hz - BR;
    if (Math.abs(B.x) > lx) { B.x = Math.sign(B.x) * lx; if (B.vx * Math.sign(B.x) > 0) B.vx *= -0.7; }
    if (Math.abs(B.z) > lz) { B.z = Math.sign(B.z) * lz; if (B.vz * Math.sign(B.z) > 0) B.vz *= -0.7; }
    const cut = Pt.hx + Pt.hz - (Pt.cut || 7) - BR * 1.42, sx = Math.sign(B.x) || 1, sz = Math.sign(B.z) || 1, e = Math.abs(B.x) + Math.abs(B.z) - cut;
    if (e > 0 && !mouth) { B.x -= sx * e / 2; B.z -= sz * e / 2; const vn = (B.vx * sx + B.vz * sz) / 1.4142; if (vn > 0) { B.vx -= 1.7 * vn * sx / 1.4142; B.vz -= 1.7 * vn * sz / 1.4142; } }
  }
  // stuck in a corner for 12 s → back to the centre spot
  if (!S.lastSpot || dist(B.x, B.z, S.lastSpot[0], S.lastSpot[1]) > 3) { S.lastSpot = [B.x, B.z]; S.stillT = 0; }
  else if ((S.stillT = (S.stillT || 0) + DT) > 12) { B.x = S.pitch.mid[0]; B.z = S.pitch.mid[1]; B.vx = B.vz = 0; S.stillT = 0; room.sendObj('reset'); }
  const lim = room.map.bound - BR;
  if (Math.abs(B.x) > lim) { B.x = Math.sign(B.x) * lim; B.vx *= -0.7; }
  if (Math.abs(B.z) > lim) { B.z = Math.sign(B.z) * lim; B.vz *= -0.7; }
  const P = room.map.pitch;
  for (const t of ['blue', 'red']) {
    const g = S.goals[t];
    const inGoal = P ? (Math.sign(B.x) === Math.sign(g[0]) && Math.abs(B.x) > P.hx + 0.6 && Math.abs(B.z) < P.gw) : dist(B.x, B.z, g[0], g[1]) < C.goalR;
    if (inGoal) {                                                   // ball in blue's goal → red scores
      const sc = OTHER[t]; room.score[sc] = (room.score[sc] || 0) + 1;
      let by = 0, bd = 1e9; for (const p of list) if (p.alive && p.team === sc) { const d = dist(p.s.x, p.s.z, B.x, B.z); if (d < bd) { bd = d; by = p.id; } }
      const pb = room.players.get(by); if (pb) { pb.obj += 5; pb.caps++; }
      room.sendObj('goal', sc, by);
      B.x = S.pitch.mid[0]; B.z = S.pitch.mid[1]; B.vx = B.vz = 0;
      room.dirty = true; checkScore(room);
      return;
    }
  }
}

/* ---------------- Survival waves ---------------- */
const UPGRADES = ['armor', 'rapid', 'power', 'repair'];
function survTank(p) {
  const base = p.baseTank || p.tank; let T = { ...tankStats(base.id, base.mods || base.level) };
  for (const u of p.upg || []) {
    if (u === 'armor') T.hp = Math.round(T.hp * 1.25);
    if (u === 'rapid') T.reload = +(T.reload * 0.8).toFixed(2);
    if (u === 'power') T.dmg = [Math.round(T.dmg[0] * 1.2), Math.round(T.dmg[1] * 1.2)];
    if (u === 'repair') T.regen = (T.regen || 0) + 5;
  }
  return T;
}
function stepSurv(room, list, S) {
  const C = GAME.MODES.surv;
  for (const p of [...room.players.values()]) if (p.removeAt && room.time >= p.removeAt) room.removePlayer(p);
  if (S.phase === 'break') {
    if (room.time < S.until) return;
    // new wave: everyone picks up their upgrade, respawns at the spot at full health
    for (const p of room.players.values()) {
      if (p.wave) continue;
      const o = S.offers.get(p.id); if (o && !p.upgPick) p.upgPick = o[Math.floor(R() * o.length)];
      if (p.upgPick) { p.upg.push(p.upgPick); p.upgPick = null; }
      p.tank = survTank(p); if (p.connected) room.spawn(p);
    }
    S.offers.clear();
    S.wave++; S.phase = 'fight'; spawnWave(room, S); room.sendObj('wave', null, S.wave); room.dirty = true;
    return;
  }
  const Z = room.zone; let inZone = 0, guards = 0;
  for (const p of list) if (p.alive && dist(p.s.x, p.s.z, Z.x, Z.z) < Z.r) { if (p.wave) inZone++; else guards++; }
  if (inZone > guards) {                                    // more enemies than defenders on the spot
    const hp0 = Math.ceil(S.baseHp); S.baseHp -= (inZone - guards) * C.drain * DT; Z.own = 'red';
    if (Math.ceil(S.baseHp) !== hp0 && Math.ceil(S.baseHp) % 5 === 0) room.sendObj();
    if (S.baseHp <= 0) { S.baseHp = 0; room.sendObj('lost'); return room.end(null); }
  } else Z.own = inZone ? 'contested' : 'blue';
  const left = [...room.players.values()].filter(p => p.wave && !p.removeAt).length;
  if (!left && room.time > S.waveAt + 1500) {
    S.phase = 'break'; S.until = room.time + C.breakS * 1000; room.score.blue = S.wave;
    for (const p of room.players.values()) if (!p.wave) {
      const pool = UPGRADES.slice().sort(() => R() - 0.5).slice(0, 3); S.offers.set(p.id, pool);
      if (p.bot) p.upgPick = pool[0]; else room.send(p, { t: 'upgOffer', wave: S.wave, v: pool, left: C.breakS });
      if (p.alive) p.hp = p.tank.hp;
    }
    room.sendObj('cleared', null, S.wave); room.dirty = true;
  }
}
function spawnWave(room, S) {
  const guards = [...room.players.values()].filter(p => !p.wave).length;   // more defenders → bigger waves
  const n = S.wave, count = Math.min(1 + n + Math.ceil(guards * 0.6), 16), lvl = Math.min(10, 1 + Math.floor(n / 2)), skill = Math.min(0.85, 0.3 + 0.05 * n);
  // enemies come from the far side of the map
  const Z = room.zone, all = room.map.spawns.any.slice().sort((a, b) => dist(b[0], b[1], Z.x, Z.z) - dist(a[0], a[1], Z.x, Z.z));
  S.foeSpawns = all.slice(0, 16); S.waveAt = room.time;
  const boss = n % 5 === 0;
  for (let i = 0; i < count; i++) {
    const kind = boss && i === 0 ? 'halgurd' : TANK_IDS[Math.floor(R() * TANK_IDS.length)];
    const p = room.addWaveBot(kind, lvl, skill);
    if (boss && i === 0) { p.boss = true; p.name = 'BOSS'; p.tank = { ...p.tank, hp: p.tank.hp * 6 }; p.hp = p.tank.hp; room.broadcast({ t: 'mh', id: p.id, mh: p.tank.hp }); }
  }
}

/* ---------------- Hot Potato ---------------- */
function stepPotato(room, list, S) {
  const C = GAME.MODES.potato, TR = GAME.TANK_RADIUS;
  const a = list.filter(p => p.alive && !p.out);
  if (room.time > S.t0 + 3000 && a.length <= 1 && room.state === 'playing') {
    const w = a[0]; if (w) w.ms = 99;
    return room.end(w ? w.id : 'draw');
  }
  if (!S.bomb) {
    if (room.time >= S.nextAt && a.length > 1) { const c = a[Math.floor(R() * a.length)]; S.bomb = { c: c.id, until: room.time + (C.fuse[0] + R() * (C.fuse[1] - C.fuse[0])) * 1000, from: 0, safe: 0 }; room.sendObj('bomb', null, c.id); }
    return;
  }
  const B = S.bomb, c = room.players.get(B.c);
  if (!c || !c.alive) { S.bomb = null; S.nextAt = room.time + 1500; for (const q of list) q.s.hot = false; return; }
  // pass it by bumping into someone (can't hand it straight back for a moment)
  for (const q of a) {
    if (q === c || (q.id === B.from && room.time < B.safe)) continue;
    if (dist(q.s.x, q.s.z, c.s.x, c.s.z) < TR * 2 + 0.5) {
      B.from = c.id; B.c = q.id; B.safe = room.time + 1200;
      knock(q, q.s.x - c.s.x, q.s.z - c.s.z, 14); knock(c, c.s.x - q.s.x, c.s.z - q.s.z, 10);
      room.sendObj('pass', null, q.id); break;
    }
  }
  for (const q of list) q.s.hot = !!S.bomb && q.id === S.bomb.c && q.alive;   // the carrier drives 1.8× faster
  if (room.time >= B.until) {
    const v = room.players.get(B.c); S.bomb = null; S.nextAt = room.time + 2500; v.s.hot = false;
    room.broadcast({ t: 'boom', id: v.id, x: +v.s.x.toFixed(2), z: +v.s.z.toFixed(2), st: room.time });
    for (const q of a) if (q !== v && dist(q.s.x, q.s.z, v.s.x, v.s.z) < 7) knock(q, q.s.x - v.s.x, q.s.z - v.s.z, 20);
    room.kill(v, v);
  }
}
