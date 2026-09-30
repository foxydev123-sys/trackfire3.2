/* =====================================================================
   ABILITIES AT RUNTIME — the server side of the eight tank powers.
   room.js calls into here; everything the players must see (a wall
   appearing, a dome, a black hole, a guided shell, a suicide car, a cage)
   is broadcast, and the client draws it.

   A power is charged by damage, not by a timer: room.damage() feeds
   addCharge(), and the power can be used once the bar is full.

   Live things kept on the room:
     room.abMs  guided shells      (fly, steer, big damage, camera rides them)
     room.abDr  suicide cars       (drive at an enemy, can be shot down)
     map.fx     walls · domes · holes  (see abilities.js — the client runs the
                                        same physics for these, so prediction
                                        matches the server)
   ===================================================================== */
import { GAME, NET } from './config.js';
import { ABILITIES, abilityOf, lvl, attachFx, wallCols, MAX_AB, abNeed, abAim, abRange, holeDps } from './abilities.js';
import { dist, wrapAngle, clamp } from './math.js';
import { muzzleOf } from './sim.js';

const DT = 1 / NET.TICK_RATE;
export const DRONE_ID0 = 250;          // pseudo ids for suicide cars in the shell hit test
const MAX_DRONES = 4;

/* ---------------- match start / per-life reset ---------------- */
export function abStart(room) {
  attachFx(room.map);
  room.abMs = []; room.abDr = []; room.abSeq = 1; room.fxDirty = true;
  for (const p of room.players.values()) abReset(p);
}
export function abReset(p) {
  p.healShot = 0; p.frzShot = 0; p.cloakT = 0; p.abWas = false; p.abUses = p.abUses || 0;
  p.abChg = p.abChg || 0;                 // charge is kept through a respawn — you earned it
  if (p.s) p.s.froz = 0;
}
/** Damage dealt to an enemy fills the power. Returns true when it just became ready. */
export function addCharge(room, p, dmg) {
  const ab = abilityOf(p.tank.id); if (!ab || !(dmg > 0)) return false;
  const need = abNeed(ab, abLvlOf(p)), was = (p.abChg || 0) >= need;
  p.abChg = Math.min(need, (p.abChg || 0) + dmg);
  const now = p.abChg >= need;
  sendCharge(room, p);
  if (now && !was) room.send(p, { t: 'abReady' });
  return now && !was;
}
export const abNeedOf = (p) => { const ab = abilityOf(p.tank.id); return ab ? abNeed(ab, abLvlOf(p)) : 0; };
export const abReady = (p) => (p.abChg || 0) >= abNeedOf(p);
function sendCharge(room, p) {
  if (p.bot || !p.connected) return;
  const v = Math.round(p.abChg || 0);
  if (p.abSent === v) return;
  p.abSent = v; room.send(p, { t: 'abc', v, need: abNeedOf(p) });
}
export const pushCharge = sendCharge;
/** Ability level of this player's current tank (0…5). */
export const abLvlOf = (p) => Math.max(0, Math.min(MAX_AB, (p.tank && p.tank.mods && p.tank.mods.ab) | 0));
export const cdOf = () => 0;   // powers are no longer on a timer (kept so old callers do not break)
/** How much a Repair Shot heals at this player's ability level. */
export const healAmount = (p) => lvl('heal', 'heal', abLvlOf(p));
/** How much of a Repair Shot's damage gets through when it hits an enemy instead. */
export const healFoeDmg = (p) => lvl('heal', 'foeDmg', abLvlOf(p)) || 0.5;

/* ---------------- the player pressed the ability button ---------------- */
export function abUse(room, p, inp = null) {
  const ab = abilityOf(p.tank.id);
  if (!ab || !p.alive || p.s.froz > 0 || room.state !== 'playing') return false;
  if (!abReady(p)) return false;                                  // not charged yet
  const L = abLvlOf(p), t = room.time, s = p.s;
  // Where the player pointed the POWER. On a phone it has its own stick, so it carries its own
  // angle; older clients that aimed powers down the gun barrel send the gun's angle in its place.
  const A = inp && typeof inp.abAim === 'number' ? inp.abAim
    : inp && typeof inp.aim === 'number' ? inp.aim : s.t;
  const far = Math.max(0.12, Math.min(1, inp ? (inp.abd || 0) : 0.6)) * abRange(ab);
  const spot = () => ({
    x: clamp(s.x + Math.sin(A) * far, -room.map.bound, room.map.bound),
    z: clamp(s.z + Math.cos(A) * far, -room.map.bound, room.map.bound),
  });
  const msg = { t: 'ab', k: ab, id: p.id, l: L, st: t };
  switch (ab) {
    case 'wall': {
      const len = lvl(ab, 'len', L), at = spot(); msg.x = +at.x.toFixed(2); msg.z = +at.z.toFixed(2);
      const w = { id: room.abSeq++, k: 'wall', o: p.id, tm: p.team, x: at.x, z: at.z, a: A,
        len, hp: lvl(ab, 'hp', L), mhp: lvl(ab, 'hp', L), until: t + lvl(ab, 'life', L) * 1000 };
      w.cols = wallCols(w);
      room.map.fx.walls.push(w); room.fxDirty = true;
      break;
    }
    case 'dome': {
      const at = spot(); msg.x = +at.x.toFixed(2); msg.z = +at.z.toFixed(2);
      const d = { id: room.abSeq++, k: 'dome', o: p.id, tm: p.team, x: at.x, z: at.z, r: lvl(ab, 'r', L), until: t + lvl(ab, 'life', L) * 1000 };
      room.map.fx.domes.push(d); room.fxDirty = true;
      break;
    }
    case 'hole': {
      const at = spot(); msg.x = +at.x.toFixed(2); msg.z = +at.z.toFixed(2);
      const h = { id: room.abSeq++, k: 'hole', o: p.id, tm: p.team, x: at.x, z: at.z, r: lvl(ab, 'r', L), pull: lvl(ab, 'pull', L), dps: lvl(ab, 'dps', L), until: t + lvl(ab, 'life', L) * 1000 };
      room.map.fx.holes.push(h); room.fxDirty = true;
      break;
    }
    case 'cloak': {
      if (carryingFlag(room, p)) { room.send(p, { t: 'abNo', why: 'flag' }); return false; }
      p.cloakT = t + lvl(ab, 'life', L) * 1000; msg.until = p.cloakT; room.dirty = true;
      break;
    }
    case 'homing': {
      const m = muzzleOf(s);
      room.abMs.push({ id: room.abSeq++, o: p.id, tm: p.team, x: m.x, z: m.z, a: A, life: lvl(ab, 'life', L),
        spd: lvl(ab, 'spd0', L), maxSpd: lvl(ab, 'spd', L), acc: lvl(ab, 'acc', L),
        turn: lvl(ab, 'turn', L), dmg: lvl(ab, 'dmg', L), target: 0 });
      msg.own = 1;
      break;
    }
    case 'drone': {
      if (room.abDr.filter(d => d.o === p.id).length >= 2 || room.abDr.length >= MAX_DRONES) return false;
      const side = Math.sin(A) * 2.6, sz = Math.cos(A) * 2.6;
      room.abDr.push({ id: room.abSeq++, o: p.id, tm: p.team, x: s.x + side, z: s.z + sz, a: A, hp: lvl(ab, 'hp', L), mhp: lvl(ab, 'hp', L),
        dmg: lvl(ab, 'dmg', L), spd: lvl(ab, 'spd', L), life: lvl(ab, 'life', L), target: 0 });
      break;
    }
    // Repair Shot and Freeze Cage fire a shell of their OWN. They used to arm the next cannon
    // shot, which meant a full power bar sat useless until the gun had reloaded — the power is
    // charged with your own damage and should never be held up by the cannon.
    case 'heal': case 'freeze': abShotFire(room, p, A, ab, L); msg.a = +A.toFixed(4); break;
  }
  p.abChg = 0; p.abSent = -1; sendCharge(room, p); p.abUses++;
  room.broadcast(msg);
  return true;
}
/**
 * Send out a Repair Shot or a Freeze Cage: a shell the POWER owns, not the cannon's.
 * It takes no ammunition, starts no reload and ignores the gun's spread — the only thing it has
 * in common with a normal shell is how it flies and what it does when it lands.
 */
function abShotFire(room, p, a, ab, L) {
  const m = muzzleOf(p.s), T = p.tank;
  const sh = { id: room.shellSeq++, owner: p.id, x: m.x, z: m.z, dx: Math.sin(a), dz: Math.cos(a),
    trav: 0, max: T.range, spd: T.shellSpeed, big: false, dmg: T.dmg, splash: null, ability: 1 };
  if (ab === 'heal') { sh.heal = healAmount(p); sh.foeK = healFoeDmg(p); }
  else sh.frz = 1;
  room.shells.push(sh);
  room.broadcast({ t: 'shot', id: sh.id, o: p.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2), a: +a.toFixed(4),
    seq: 0, k: 0, spd: T.shellSpeed, max: T.range, big: 0, hl: sh.heal ? 1 : 0, fz: sh.frz ? 1 : 0, ab: 1, st: room.time });
}

function carryingFlag(room, p) {
  if (!room.flags) return false;
  for (const f of Object.values(room.flags)) if (f.s === 'carried' && f.c === p.id) return true;
  return false;
}
/** Firing, or grabbing a flag, drops the cloak at once. */
export function abReveal(room, p) {
  if (!p.cloakT) return;
  p.cloakT = 0; room.dirty = true;
  room.broadcast({ t: 'ab', k: 'uncloak', id: p.id, st: room.time });
}

/* ---------------- special shells (heal · freeze) ---------------- */
/** Called when one of our shells hits a tank. Returns true when the shell was a special one. */
export function abShell(room, sh, v, k) {
  if (sh.heal) {
    // a team-mate goes back to full health; an enemy still takes damage, just half of it
    if (v && v.alive && k && !room.enemies(k, v)) {
      const before = v.hp; v.hp = v.tank.hp;
      const got = Math.round(v.hp - before);
      k.obj += got > 0 ? 1 : 0;
      room.broadcast({ t: 'heal', o: sh.owner, v: v.id, n: got, x: +v.s.x.toFixed(2), z: +v.s.z.toFixed(2), st: room.time });
      return true;
    }
    return false;                                 // hit an enemy: fall through to normal (halved) damage
  }
  if (sh.frz && v && v.alive && k && room.enemies(k, v)) {
    const L = abLvlOf(k), dur = lvl('freeze', 'life', L);
    if (v.s.shield <= 0) {
      v.s.froz = dur; v.frozUntil = room.time + dur * 1000;
      room.broadcast({ t: 'ab', k: 'caged', id: v.id, by: k.id, s: dur, st: room.time });
    }
    return false;       // a freeze shell still does its normal damage
  }
  return false;
}

/* ---------------- one server tick ---------------- */
export function abStep(room, list) {
  const t = room.time, fx = room.map.fx;
  // cooldowns, cloak, cages
  for (const p of list) {
    if (p.cloakT && (t >= p.cloakT || !p.alive)) abReveal(room, p);
    if (p.s.froz > 0) { p.s.froz = Math.max(0, p.s.froz - DT); if (!p.s.froz) room.dirty = true; }
    if (!p.alive && (p.healShot || p.frzShot)) { p.healShot = 0; p.frzShot = 0; }
  }
  // A black hole grinds down every enemy inside it — faster the closer they are dragged to the
  // middle. Fractions of a point are carried over between ticks so the rate comes out right
  // however often this runs.
  for (const h of fx.holes) {
    if (!h.dps) continue;
    const owner = room.players.get(h.o);
    for (const p of list) {
      if (!p.alive || (h.tm && p.team && h.tm === p.team)) continue;
      const d = Math.hypot(p.s.x - h.x, p.s.z - h.z);
      if (d > h.r) { p.holeAcc = 0; continue; }
      p.holeAcc = (p.holeAcc || 0) + holeDps(h, d) * DT;
      if (p.holeAcc < 1) continue;
      const n = Math.floor(p.holeAcc); p.holeAcc -= n;
      const dealt = room.damage(p, owner && owner !== p ? owner : null, n, false);
      if (!dealt) continue;
      room.broadcast({ t: 'holeDmg', id: p.id, h: h.id, dmg: dealt, st: t });
      if (p.hp <= 0 && p.alive) { room.kill(p, owner && owner !== p ? owner : p); if (room.state !== 'playing') return; }
    }
  }
  // walls / domes / holes run out
  let gone = false;
  for (const A of [fx.walls, fx.domes, fx.holes])
    for (let i = A.length - 1; i >= 0; i--) if (t >= A[i].until || A[i].hp <= 0 && A[i].mhp) { A.splice(i, 1); gone = true; }
  if (gone) room.fxDirty = true;
  stepMissiles(room, list);
  if (room.state !== 'playing') return;
  stepDrones(room, list);
  if (room.state !== 'playing') return;
  if (room.fxDirty) { room.broadcast(fxMsg(room)); room.fxDirty = false; }
  if ((room.abMs.length || room.abDr.length || room.abSent) && room.tick % NET.SNAPSHOT_EVERY === 0) {
    room.broadcast({ t: 'ae',
      m: room.abMs.map(m => [m.id, +m.x.toFixed(2), +m.z.toFixed(2), +m.a.toFixed(3), m.o, Math.round(m.spd)]),
      d: room.abDr.map(d => [d.id, +d.x.toFixed(2), +d.z.toFixed(2), +d.a.toFixed(3), Math.round(d.hp / d.mhp * 100), d.o, d.tm === 'red' ? 1 : 0]), st: t });
    room.abSent = room.abMs.length > 0 || room.abDr.length > 0;
  }
}
export function fxMsg(room) {
  const fx = room.map.fx;
  return { t: 'fx', st: room.time,
    w: fx.walls.map(w => ({ id: w.id, x: +w.x.toFixed(2), z: +w.z.toFixed(2), a: +w.a.toFixed(3), len: w.len, hp: Math.round(w.hp), mhp: w.mhp, tm: w.tm })),
    d: fx.domes.map(d => ({ id: d.id, x: +d.x.toFixed(2), z: +d.z.toFixed(2), r: d.r, tm: d.tm, o: d.o })),
    h: fx.holes.map(h => ({ id: h.id, x: +h.x.toFixed(2), z: +h.z.toFixed(2), r: h.r, pull: h.pull, tm: h.tm, o: h.o })) };
}
/** A shell hit a cover wall. */
export function abHitWall(room, w, n) {
  w.hp -= n; room.fxDirty = true;
  if (w.hp <= 0) { const A = room.map.fx.walls, i = A.indexOf(w); if (i >= 0) A.splice(i, 1); room.broadcast({ t: 'ab', k: 'wallGone', id: w.id, st: room.time }); }
}

function stepMissiles(room, list) {
  const R = GAME.TANK_RADIUS + 0.4;
  for (let i = room.abMs.length - 1; i >= 0; i--) {
    const m = room.abMs[i], o = room.players.get(m.o);
    // it speeds up the longer it flies
    m.spd = Math.min(m.maxSpd || m.spd, m.spd + (m.acc || 0) * DT);
    // the owner steers it with his movement stick; with no steering it homes in by itself
    const st = o && o.lastInput;
    const steer = st && st.mag > 0.15 ? st.dir : null;
    if (steer != null) {
      m.a = wrapAngle(m.a + clamp(wrapAngle(steer - m.a), -m.turn * DT, m.turn * DT));
      m.target = 0;
    } else {
      let tgt = m.target && room.players.get(m.target);
      const ok = (q) => q && q.alive && o && room.enemies(o, q) && !q.cloakT && dist(q.s.x, q.s.z, m.x, m.z) < 70 && Math.abs(wrapAngle(Math.atan2(q.s.x - m.x, q.s.z - m.z) - m.a)) < 1.3;
      if (!ok(tgt)) { tgt = null; let bd = 1e9; for (const q of list) if (ok(q)) { const d = dist(q.s.x, q.s.z, m.x, m.z); if (d < bd) { bd = d; tgt = q; } } m.target = tgt ? tgt.id : 0; }
      if (tgt) m.a = wrapAngle(m.a + clamp(wrapAngle(Math.atan2(tgt.s.x - m.x, tgt.s.z - m.z) - m.a), -m.turn * DT, m.turn * DT));
    }
    const px = m.x, pz = m.z;
    m.x += Math.sin(m.a) * m.spd * DT; m.z += Math.cos(m.a) * m.spd * DT; m.life -= DT;
    let hit = null;
    for (const q of list) if (q.alive && q.id !== m.o && dist(q.s.x, q.s.z, m.x, m.z) < R) { hit = q; break; }
    let wall = !hit && (m.life <= 0 || Math.abs(m.x) > room.map.bound + 6 || Math.abs(m.z) > room.map.bound + 6);
    let prop = null, wallObj = null;
    if (!hit && !wall) {
      for (const c of room.map.near(m.x, m.z)) {
        if (c.low || (c.i !== undefined && room.map.dead[c.i]) || dist(m.x, m.z, c.x, c.z) > c.r + 0.3) continue;
        wall = true; if (c.wall) wallObj = c.wall; else prop = c; break;
      }
      if (!wall) { const dm = domeAt(room, px, pz, m.x, m.z); if (dm) wall = true; }
    }
    if (!hit && !wall) continue;
    room.abMs.splice(i, 1);
    let dmg = 0;
    if (hit) dmg = room.damage(hit, o, m.dmg, false);
    room.broadcast({ t: 'hit', s: -1000 - m.id, o: m.o, x: +m.x.toFixed(2), z: +m.z.toFixed(2), v: hit ? hit.id : 0, dmg, w: wall ? 1 : 0, gm: 1, st: room.time });
    if (prop) room.hitProp(prop, 9, { x: m.x - Math.sin(m.a) * 4, z: m.z - Math.cos(m.a) * 4 });
    if (wallObj) abHitWall(room, wallObj, 60);
    if (hit && hit.hp <= 0 && hit.alive) room.kill(hit, o || hit);
    if (room.state !== 'playing') return;
  }
}
function domeAt(room, x0, z0, x1, z1) {
  const fx = room.map.fx;
  for (const d of fx.domes) { const a = dist(x0, z0, d.x, d.z) <= d.r, b = dist(x1, z1, d.x, d.z) <= d.r; if (a !== b) return d; }
  return null;
}
function stepDrones(room, list) {
  const R = GAME.TANK_RADIUS + 1.0;
  for (let i = room.abDr.length - 1; i >= 0; i--) {
    const d = room.abDr[i], o = room.players.get(d.o);
    d.life -= DT;
    let tgt = d.target && room.players.get(d.target);
    const ok = (q) => q && q.alive && o && room.enemies(o, q) && !q.cloakT;
    if (!ok(tgt)) { tgt = null; let bd = 1e9; for (const q of list) if (ok(q)) { const dd = dist(q.s.x, q.s.z, d.x, d.z); if (dd < bd) { bd = dd; tgt = q; } } d.target = tgt ? tgt.id : 0; }
    if (tgt) {
      const want = Math.atan2(tgt.s.x - d.x, tgt.s.z - d.z);
      d.a = wrapAngle(d.a + clamp(wrapAngle(want - d.a), -3.4 * DT, 3.4 * DT));
    }
    // drive, and slide around obstacles instead of getting stuck on them
    d.x += Math.sin(d.a) * d.spd * DT; d.z += Math.cos(d.a) * d.spd * DT;
    for (const c of room.map.near(d.x, d.z)) {
      if (c.low || (c.i !== undefined && room.map.dead[c.i])) continue;
      const dx = d.x - c.x, dz = d.z - c.z, dd = Math.hypot(dx, dz), min = c.r + 0.7;
      if (dd < min && dd > 1e-4) { d.x = c.x + dx / dd * min; d.z = c.z + dz / dd * min; d.a = wrapAngle(d.a + 0.5); }
    }
    d.x = clamp(d.x, -room.map.bound, room.map.bound); d.z = clamp(d.z, -room.map.bound, room.map.bound);
    let boom = d.hp <= 0 || d.life <= 0, victim = null;
    if (!boom) for (const q of list) if (q.alive && o && room.enemies(o, q) && dist(q.s.x, q.s.z, d.x, d.z) < R) { boom = true; victim = q; break; }
    if (!boom) continue;
    room.abDr.splice(i, 1);
    let dmg = 0;
    if (victim) dmg = room.damage(victim, o, d.dmg, false);
    room.broadcast({ t: 'carBoom', id: d.id, o: d.o, x: +d.x.toFixed(2), z: +d.z.toFixed(2), v: victim ? victim.id : 0, dmg, st: room.time });
    if (victim && victim.hp <= 0 && victim.alive) room.kill(victim, o || victim);
    if (room.state !== 'playing') return;
  }
}
/* ---------------- how a bot uses its power ----------------
   Bots used to fire whatever they had straight ahead, which walled them in.
   Now each power is only used when it makes sense, and aimed at the enemy. */
export function botAbility(room, p, list) {
  if (!abReady(p) || !p.alive || p.s.froz > 0) return false;
  const ab = abilityOf(p.tank.id); if (!ab) return false;
  const kind = abAim(ab), reach = abRange(ab) || 1;
  // nearest enemy, and the most hurt team-mate
  let foe = null, fd = 1e9, mate = null, mhurt = 0;
  for (const q of list) {
    if (!q.alive || q === p) continue;
    const d = dist(q.s.x, q.s.z, p.s.x, p.s.z);
    if (room.enemies(p, q)) { if (d < fd && !q.cloakT) { fd = d; foe = q; } }
    else if (d < 40) { const miss = 1 - q.hp / q.tank.hp; if (miss > mhurt) { mhurt = miss; mate = q; } }
  }
  const aimAt = (q) => Math.atan2(q.s.x - p.s.x, q.s.z - p.s.z);
  switch (ab) {
    case 'heal':                                  // only when a team-mate actually needs it
      if (!mate || mhurt < 0.35) return false;
      return abUse(room, p, { abAim: aimAt(mate), abd: 1 });
    case 'cloak':                                 // slip away when badly hurt
      if (p.hp > p.tank.hp * 0.45) return false;
      return abUse(room, p, { abAim: p.s.t, abd: 0 });
    case 'wall':                                  // put it between us and a distant enemy, never on our own nose
      if (!foe || fd < 16 || fd > 60) return false;
      return abUse(room, p, { abAim: aimAt(foe), abd: Math.min(1, 11 / reach) });
    case 'dome':                                  // a bubble on ourselves when a fight is close
      if (!foe || fd > 26) return false;
      return abUse(room, p, { abAim: p.s.t, abd: 0.15 });
    case 'hole': case 'drone': case 'homing': case 'freeze':
      if (!foe || fd > (ab === 'freeze' ? 34 : 70)) return false;
      return abUse(room, p, { abAim: aimAt(foe), abd: Math.min(1, fd / reach) });
  }
  return false;
}

/** Is this player flying one of his own guided shells right now? His tank holds still while he does. */
export function flyingShell(room, p) { return room.abMs && room.abMs.some(m => m.o === p.id); }

/** Shells can shoot a suicide car down: targets for the shell test. */
export function droneTargets(room) {
  return room.abDr.map((d, i) => ({ id: DRONE_ID0 + i, x: d.x, z: d.z, alive: true }));
}
export function droneByTarget(room, id) { return room.abDr[id - DRONE_ID0] || null; }
