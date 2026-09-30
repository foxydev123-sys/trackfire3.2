// Simple bot brain used for bots in rooms, quick match, practice mode and load tests.
// It produces the same input objects a human client sends.
// With a `goal` ({x,z}) it heads there along the open lanes (flag, zone, enemy…).
import { MODE_DIR } from './sim.js';
import { wrapAngle, dist } from './math.js';
import { GAME } from './config.js';
import { getNav } from './nav.js';
import { TANKS } from './tanks.js';

export class BotBrain {
  // skill 0..1: 0.15 = clumsy beginner, 0.5 = average, 0.9 = sharp shooter.
  constructor(map, seed = 1, skill = null) {
    this.map = map; this.wp = null; this.stuck = 0; this.lastX = 0; this.lastZ = 0;
    this.r = seed; this.fireHold = 0; this.skill = skill == null ? 0.35 + (seed % 5) * 0.08 : skill;
    this.aimErr = 0; this.errT = 0; this.seenT = 0; this.lastTarget = null;
    this.strafe = 0; this.wpT = 0; this.path = null; this.pi = 0; this.pathGoal = null; this.replanT = 0; this.careful = 0; this.stuckN = 0; this.backDir = 0;
  }
  rand() { this.r = (Math.imul(this.r ^ (this.r >>> 15), 2246822507) + 0x9e3779b9) | 0; return ((this.r >>> 0) % 10000) / 10000; }
  pickWaypoint(s) {
    const pts = this.map.spawns.any;
    for (let i = 0; i < 6; i++) { const p = pts[Math.floor(this.rand() * pts.length)]; if (dist(p[0], p[1], s.x, s.z) > 14) { this.wp = p; return; } }
    this.wp = pts[Math.floor(this.rand() * pts.length)];
  }
  // Follow an A* path over the map's navigation grid; re-plan when the goal moves or every few seconds.
  stepToward(s, g) {
    const endMoved = !this.path || dist(this.pathGoal[0], this.pathGoal[1], g.x, g.z) > 5;
    if (endMoved || this.replanT <= 0) {
      this.path = getNav(this.map).path(s.x, s.z, g.x, g.z, this.careful > 0); this.pi = 1; this.pathGoal = [g.x, g.z]; this.replanT = 3;
      if (!this.path) { this.wp = [g.x, g.z]; return; }
    }
    const P = this.path;
    for (;;) {                                   // next waypoint: reached it, or already past it (closer to the one after)
      if (this.pi >= P.length - 1) break;
      const a = P[this.pi], b = P[this.pi + 1], da = dist(a[0], a[1], s.x, s.z);
      if (da < 3.5 || dist(b[0], b[1], s.x, s.z) < dist(a[0], a[1], b[0], b[1])) this.pi++; else break;
    }
    this.wp = P[Math.min(this.pi, P.length - 1)];
  }
  /** s = own state, foes = [{x,z,v,yaw}] visible enemies, goal = optional {x,z,rush}. Returns an input. */
  think(s, foes, dt, goal = null) {
    this.wpT -= dt;
    this.replanT -= dt; this.careful -= dt;
    if (goal && this.strafe <= 0) this.stepToward(s, goal);
    if (!goal && (!this.wp || dist(this.wp[0], this.wp[1], s.x, s.z) < 5)) this.pickWaypoint(s);
    // Stuck (terrain, a wall corner, other tanks): back straight out, then follow the route node by node
    // for a few seconds. It keeps its objective — the goal is re-planned, never forgotten.
    const moved = dist(s.x, s.z, this.lastX, this.lastZ); this.lastX = s.x; this.lastZ = s.z;
    this.stuck = moved < 0.05 ? this.stuck + dt : 0;
    if (this.stuck > 0.9) {
      this.stuck = 0; this.stuckN++; this.strafe = 0.6 + Math.min(0.8, this.stuckN * 0.2); this.replanT = 0; this.careful = 4;
      this.backDir = wrapAngle(s.yaw + Math.PI + (this.rand() - 0.5) * (this.stuckN > 2 ? 1.6 : 0.5));
      if (!goal || this.stuckN > 4) { this.pickWaypoint(s); this.stuckN = 0; }
    }
    if (moved > 0.12) this.stuckN = Math.max(0, this.stuckN - dt * 0.2);
    const T = TANKS[s.cls] || TANKS.zagros;
    const sk = this.skill;
    let target = null, td = Math.max(22, T.range - 2) * (0.72 + 0.28 * sk);
    for (const f of foes) { const d = dist(f.x, f.z, s.x, s.z); if (d < td) { td = d; target = f; } }
    // Reaction time: a bot needs a moment after spotting a tank before it shoots (longer for weak bots).
    if (target !== this.lastTarget) { this.lastTarget = target; this.seenT = 0; }
    this.seenT += dt;
    // Aim wobble: a new error every ~0.7 s (not every tick, or it would average out).
    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.5 + this.rand() * 0.5; this.aimErr = (this.rand() - 0.5) * (1 - sk) * 0.75; }
    let dir = Math.atan2(this.wp[0] - s.x, this.wp[1] - s.z), mag = 0.78 + 0.22 * sk;
    const onGoal = goal && dist(goal.x, goal.z, s.x, s.z) < 3;
    if (this.strafe > 0) { this.strafe -= dt; dir = this.backDir; mag = 0.9; }
    else if (target && sk > 0.35 && td < Math.min(16, T.range * 0.45) && !(goal && goal.rush)) { dir = wrapAngle(Math.atan2(target.x - s.x, target.z - s.z) + Math.PI / 2); mag = 0.7; } // circle-strafe
    else if (onGoal && !goal.rush) mag = 0.25;                                                                 // hold the spot
    let aim = s.t, fire = false;
    if (target) {
      const lead = (td / T.shellSpeed) * sk;
      const tx = target.x + Math.sin(target.yaw) * target.v * lead, tz = target.z + Math.cos(target.yaw) * target.v * lead;
      aim = Math.atan2(tx - s.x, tz - s.z) + this.aimErr;
      const react = 0.3 + (1 - sk) * 1.2;
      fire = this.seenT > react && Math.abs(wrapAngle(aim - s.t)) < 0.08 && s.reload <= 0 && this.rand() < 0.04 + sk * 0.3;
    } else aim = s.yaw;
    return { mode: MODE_DIR, dir, mag, throttle: 0, steer: 0, aim, fire };
  }
}
