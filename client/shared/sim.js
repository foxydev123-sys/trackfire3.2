/* =====================================================================
   SHARED SIMULATION — the one movement/collision function that both the
   server (authoritative) and the client (prediction) run. Same inputs +
   same dt + same map ⇒ same result, which is what makes client-side
   prediction line up with the server almost exactly.
   ===================================================================== */
import { GAME } from './config.js';
import { clamp, wrapAngle, stepAngle, polyNearest, dist } from './math.js';
import { TANKS } from './tanks.js';
import { fxForces, domeBlock } from './abilities.js';

export const MODE_DIR = 0;     // stick / WASD direction: tank turns toward it and drives
export const MODE_CLASSIC = 1; // W/S throttle, A/D rotate hull

// cls = tank type (movement stats), rl = reload time in seconds
// sm = speed multiplier from garage upgrades (sent with the spawn), hot = carrying the Hot Potato bomb
export function newTankState(x = 0, z = 0, yaw = 0, cls = 'zagros', rl = 0, sm = 1) {
  return { x, z, yaw, v: 0, w: 0, t: yaw, reload: 0, shield: 0, armor: 0, boost: 0, hot: false, tm: '', froz: 0, sm: sm || 1, cls: TANKS[cls] ? cls : 'zagros', rl: rl || (TANKS[cls] || TANKS.zagros).reload };
}
export function copyState(o, s) {
  o.x = s.x; o.z = s.z; o.yaw = s.yaw; o.v = s.v; o.w = s.w; o.t = s.t; o.reload = s.reload; o.shield = s.shield; o.armor = s.armor || 0; o.boost = s.boost || 0; o.hot = !!s.hot; o.sm = s.sm || o.sm || 1; o.tm = s.tm || o.tm || ''; o.froz = s.froz || 0;
  o.cls = s.cls || o.cls || 'zagros'; o.rl = s.rl || o.rl || GAME.RELOAD_S; return o;
}
/** Everything that changes top speed: upgrades × speed power-up × Hot Potato bomb. */
export function speedMult(s) { return (s.sm || 1) * (s.boost > 0 ? GAME.POWERUPS.SPEED_MULT : 1) * (s.hot ? GAME.MODES.potato.holderSpeed : 1); }

// Converts an input into throttle (-1..1) and steer (-1..1) for this hull.
function control(s, inp) {
  if (inp.mode === MODE_CLASSIC) return [inp.throttle, inp.steer];
  const mag = inp.mag;
  if (mag < 0.08) return [0, 0];
  const diff = wrapAngle(inp.dir - s.yaw);
  if (Math.abs(diff) > GAME.REVERSE_ANGLE) {
    // Stick points behind us → back up while turning the rear toward it.
    const d2 = wrapAngle(inp.dir + Math.PI - s.yaw);
    return [-mag * (Math.abs(d2) < 0.9 ? 1 : 0.35), clamp(d2 * 3.2, -1, 1)];
  }
  const a = Math.abs(diff);
  return [mag * (a < 0.6 ? 1 : Math.max(0.1, 1 - (a - 0.6) / 0.9)), clamp(diff * 3.2, -1, 1)];
}

/**
 * Advance one tank by one fixed step.
 * @param s      tank state (mutated)
 * @param inp    decoded input {mode, dir, mag, throttle, steer, aim, fire}
 * @param dt     step length (1 / NET.TICK_RATE)
 * @param map    shared map (colliders, river, bounds)
 * @param others array of {x, z} for other live tanks (may be empty)
 */
export function stepTank(s, inp, dt, map, others) {
  const [thr, steer] = control(s, inp);
  const T = TANKS[s.cls] || TANKS.zagros, sk = T.speed / GAME.MAX_SPEED;   // tank type: speed / turning
  // --- throttle → forward speed, with acceleration and braking
  const bk = speedMult(s);                                  // upgrades, speed power-up, Hot Potato
  const target = thr >= 0 ? thr * T.speed * bk : thr * GAME.MAX_REVERSE * sk * bk;
  let rate;
  if (Math.abs(thr) < 0.01) rate = GAME.COAST;
  else if (Math.sign(target) !== Math.sign(s.v) && Math.abs(s.v) > 0.05) rate = GAME.BRAKE;
  else rate = Math.abs(target) > Math.abs(s.v) ? GAME.ACCEL * sk * bk : GAME.BRAKE;
  const dv = target - s.v;
  s.v += clamp(dv, -rate * dt, rate * dt);
  // --- steering → hull yaw rate (slightly slower at top speed = weight)
  const speedK = 1 - 0.12 * Math.min(1, Math.abs(s.v) / T.speed);
  const wT = steer * T.turn * (GAME.TURN_MULT || 1) * speedK * (1 + ((s.sm || 1) - 1) * 0.6);
  s.w += clamp(wT - s.w, -GAME.TURN_ACCEL * dt, GAME.TURN_ACCEL * dt);
  s.yaw = wrapAngle(s.yaw + s.w * dt);
  // --- move
  s.x += Math.sin(s.yaw) * s.v * dt;
  s.z += Math.cos(s.yaw) * s.v * dt;
  fxForces(s, map, dt);            // black holes drag you toward the middle
  collide(s, map, others);
  // --- turret turns toward the aim angle at a limited speed
  s.t = wrapAngle(stepAngle(s.t, inp.aim, T.turret * dt));
  if (s.reload > 0) s.reload = Math.max(0, s.reload - dt);
  if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
  if (s.armor > 0) s.armor = Math.max(0, s.armor - dt);
  if (s.boost > 0) s.boost = Math.max(0, s.boost - dt);
}

function pushOut(s, cx, cz, minD) {
  const dx = s.x - cx, dz = s.z - cz; const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= minD) return false;
  const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
  s.x = cx + nx * minD; s.z = cz + nz * minD;
  // Remove the part of our velocity that drives into the obstacle (slide along it).
  const into = -(Math.sin(s.yaw) * nx + Math.cos(s.yaw) * nz) * Math.sign(s.v);
  if (into > 0) s.v *= 1 - 0.6 * into;       // keep some speed: slide along walls instead of sticking
  return true;
}

// Shallow fords: tanks can drive straight through the river there.
export function inFord(map, x, z) {
  const F = map.fords; if (!F) return false;
  for (const f of F) if (x > f.x0 && x < f.x1 && Math.abs(z - f.zc) < f.halfW) return true;
  return false;
}
export function collide(s, map, others) {
  const TR = GAME.TANK_RADIUS;
  for (let pass = 0; pass < 2; pass++) {
    const dead = map.dead;
    for (const c of map.near(s.x, s.z)) if (!c.soft && !(dead && dead[c.i])) pushOut(s, c.x, c.z, c.r + TR);   // soft = trees, palms, poles: you drive through, they fall
    if (others) for (const o of others) { if (o === s) continue; pushOut(s, o.x, o.z, TR * 2); }   // one shared list: skip ourselves
    if (map.river) {
      const n = polyNearest(s.x, s.z, map.river);
      const limit = map.riverW - 0.4;
      if (n.d < limit) {
        const b = map.bridge;
        if (b && s.x > b.x0 - 1 && s.x < b.x1 + 1 && Math.abs(s.z - b.zc) < b.halfW + 1.4) {
          s.z = clamp(s.z, b.zc - b.halfW, b.zc + b.halfW); // bridge rails
        } else if (!inFord(map, s.x, s.z)) pushOut(s, n.x, n.z, limit);
      }
    }
  }
  const B = map.bound;
  if (s.x < -B) { s.x = -B; s.v *= 0.5; } else if (s.x > B) { s.x = B; s.v *= 0.5; }
  if (s.z < -B) { s.z = -B; s.v *= 0.5; } else if (s.z > B) { s.z = B; s.v *= 0.5; }
}

// Where a shell leaves the barrel (2D) for a given tank state.
export const MUZZLE_DIST = 3.4;
export function muzzleOf(s) {
  return { x: s.x + Math.sin(s.t) * MUZZLE_DIST, z: s.z + Math.cos(s.t) * MUZZLE_DIST };
}

/**
 * Move a shell by dt. Returns null (still flying) or
 * {hit:'tank', id, x, z} | {hit:'wall', x, z} | {hit:'range', x, z}.
 * `tanks` = [{id, x, z, alive}] (server: live positions).
 */
export function stepShell(sh, dt, map, tanks) {
  const SUB = 3, step = ((sh.spd || GAME.SHELL_SPEED) * dt) / SUB, R = GAME.TANK_RADIUS + GAME.SHELL_RADIUS;
  for (let i = 0; i < SUB; i++) {
    const px = sh.x, pz = sh.z;
    sh.x += sh.dx * step; sh.z += sh.dz * step; sh.trav += step;
    if (domeBlock(map, px, pz, sh.x, sh.z)) return { hit: 'dome', x: sh.x, z: sh.z };
    for (const t of tanks) {
      if (!t.alive || t.id === sh.owner) continue;
      if (dist(sh.x, sh.z, t.x, t.z) < R) return { hit: 'tank', id: t.id, x: sh.x, z: sh.z };
    }
    for (const c of map.near(sh.x, sh.z)) if (!c.low && !(map.dead && map.dead[c.i]) && dist(sh.x, sh.z, c.x, c.z) < c.r + GAME.SHELL_RADIUS) return { hit: 'wall', x: sh.x, z: sh.z, c }; // low = pools etc., shells fly over
    if (sh.trav >= sh.max || Math.abs(sh.x) > 90 || Math.abs(sh.z) > 90) return { hit: 'range', x: sh.x, z: sh.z };
  }
  return null;
}

/**
 * One full player tick: movement + firing. Returns true if a shell was fired.
 * Server and client prediction both call exactly this.
 */
export function simulateInput(s, inp, dt, map, others) {
  stepTank(s, inp, dt, map, others);
  if (inp.fire && s.reload <= 0) { s.reload = s.rl || GAME.RELOAD_S; s.shield = 0; return true; }
  return false;
}
