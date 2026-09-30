/* Unit test for the eight tank abilities, using the real server Room (no network). */
import { Room } from '../client/shared/room.js';
import { GAME, NET } from '../client/shared/config.js';
import { encodeInput, decodeSnapshot, MSG_SNAPSHOT, FLAG_CLOAK, FLAG_FROZEN } from '../client/shared/protocol.js';
import { MODE_DIR } from '../client/shared/sim.js';
import { ABILITIES, abilityOf, lvl, MAX_AB, abCost, abNeed, abAim } from '../client/shared/abilities.js';
import { tankStats } from '../client/shared/tanks.js';
import { dist } from '../client/shared/math.js';
let t = 0; const now = () => t;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const snapsOf = {};
const conn = (n, log) => ({ send: (d) => { if (typeof d === 'string') log.push([n, JSON.parse(d)]); else if (new Uint8Array(d)[0] === MSG_SNAPSHOT) (snapsOf[n] = snapsOf[n] || []).push(decodeSnapshot(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))); }, close() {}, congested: () => false });

/** A fresh 1v1 room on open desert ground with the two tanks we want. */
function duel(tankA, tankB, lvlA = MAX_AB, mode = 'tdm') {
  const log = [];
  const R = new Room('AB' + Math.random().toString(36).slice(2, 5).toUpperCase(), { now });
  const a = R.join(conn('a', log), 'Alice', 'ka'), b = R.join(conn('b', log), 'Bob', 'kb');
  R.onJSON(a, { t: 'mode', mode }); R.onJSON(a, { t: 'map', map: 'desert' });
  a.team = 'blue'; b.team = 'red';
  R.start();
  a.tank = tankStats(tankA, { pow: 0, arm: 0, spd: 0, rng: 0, rel: 0, ab: lvlA });
  b.tank = tankStats(tankB, { pow: 0, arm: 0, spd: 0, rng: 0, rel: 0, ab: 0 });
  R.spawn(a); R.spawn(b);
  a.s.shield = b.s.shield = 0; a.hp = a.tank.hp; b.hp = b.tank.hp;
  const T = (n = 1, fn = null) => { for (let i = 0; i < n; i++) { t += 1000 / NET.TICK_RATE; if (fn) fn(i); R.update(); } };
  // fill the power (normally done by damaging enemies) and press the button through the real input path
  const charge = (p) => { p.abChg = 9999; };
  const press = (p, aim = null, far = 0.6) => {
    charge(p);
    for (const v of [true, false]) { R.onBinary(p, new Uint8Array(encodeInput({ seq: (p.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 0, throttle: 0, steer: 0, aim: aim == null ? p.s.t : aim, fire: false, ab: v, abd: far }))); p.starving = false; T(1); }
  };
  return { R, a, b, T, log, press, charge };
}
const idle = () => ({ mode: MODE_DIR, dir: 0, mag: 0, throttle: 0, steer: 0, aim: 0, fire: false, ab: false });
const parkBot = (p) => { p.bot = { think: idle }; p.ready = true; p.connected = true; };   // stands still but is still simulated
const place = (p, x, z, aim = 0) => { p.s.x = x; p.s.z = z; p.s.t = aim; p.s.yaw = aim; p.s.v = 0; p.alive = true; p.s.shield = 0; p.s.armor = 0; p.inputQ.length = 0; p.starving = false; };

console.log('--- every tank has exactly one ability');
{
  const seen = new Set();
  for (const [k, A] of Object.entries(ABILITIES)) { ok(abilityOf(A.tank) === k, `${A.tank} → ${k}`); seen.add(A.tank); }
  ok(seen.size === 8, `all 8 tanks covered (${seen.size})`);
  ok(Object.values(ABILITIES).every(A => A.need[MAX_AB] < A.need[0]), 'upgrading always means less damage needed to charge it');
  ok(abCost('common', 0).coins > 0 && abCost('common', MAX_AB) === null, 'upgrade costs, and stops at level 5');
}

console.log('\n--- 1. Guided Shell (safeen): rides to the target and hurts');
{
  const { R, a, b, T, log, press } = duel('safeen', 'zagros');
  R.map.near0 = () => [];                     // open ground, but walls/domes still count
  place(a, 0, -20, 0); place(b, 3, 14, 0); b.hp = 9999;
  const hp0 = b.hp; press(a);
  ok(R.abMs.length === 1, 'a guided shell is in the air');
  ok(a.abChg === 0, 'using it empties the charge bar');
  T(70, () => { place(b, 3, 14, 0); });
  ok(b.hp <= hp0 - lvl('homing', 'dmg', MAX_AB) + 1, `it curved in and hit hard (${hp0} → ${b.hp})`);
  ok(log.some(([, m]) => m.t === 'ae' && m.m && m.m.length), 'its position is streamed so the camera can follow it');
  ok(log.some(([, m]) => m.t === 'ab' && m.k === 'homing' && m.own === 1), 'the owner is told to ride it');
}

console.log('\n--- 1b. the guided shell speeds up, is steerable, and pins your tank');
{
  const { R, a, b, T, press } = duel('safeen', 'zagros');
  R.map.near0 = () => [];
  place(a, 0, -30, 0); place(b, 60, 60, 0);
  press(a, 0, 1);
  const m = R.abMs[0];
  ok(!!m, 'a guided shell is out');
  const v0 = m.spd;
  ok(v0 <= 10.5, `it leaves the barrel at about tank speed (${v0} m/s)`);
  T(30);
  const v1 = m.spd;
  ok(v1 > v0 + 3, `it speeds up as it flies (${v0} → ${v1.toFixed(1)} m/s after 1 s)`);
  // the movement stick turns it (steer straight away, before it flies off the map)
  const before = m.a;
  for (let i = 0; i < 25 && R.abMs.length; i++) {
    R.onBinary(a, new Uint8Array(encodeInput({ seq: (a.lastQueued || 0) + 1, mode: MODE_DIR, dir: Math.PI / 2, mag: 1, throttle: 0, steer: 0, aim: 0, fire: false, ab: false, abd: 0 })));
    a.starving = false; T(1);
  }
  ok(Math.abs(m.a - before) > 1.2, `the movement stick steers it (turned ${(m.a - before).toFixed(2)} rad toward the stick)`);
  ok(m.spd > v1, `it keeps building up (${m.spd.toFixed(1)} m/s, tops out at ${lvl('homing', 'spd', MAX_AB)})`);
  // …and the tank did not drive off while we were flying it
  ok(Math.abs(a.s.v) < 0.6, `your tank holds still while you fly it (speed ${a.s.v.toFixed(2)})`);
}

console.log('\n--- 2. Suicide Car (baz): drives at the enemy, explodes, can be shot down');
{
  const { R, a, b, T, press } = duel('baz', 'zagros');
  R.map.near0 = () => [];
  place(a, 0, -24, 0); place(b, 0, 6, 0); b.hp = 9999;
  const hp0 = b.hp; press(a);
  ok(R.abDr.length === 1, 'a car appears');
  T(80, () => { place(b, 0, 6, 0); });
  ok(R.abDr.length === 0 && b.hp < hp0, `it reached him and blew up (${hp0} → ${b.hp}, -${hp0 - b.hp})`);
  // shot down before arrival
  place(a, 0, -24, 0); place(b, 0, 20, 0); b.hp = 9999; press(a);
  const d = R.abDr[0]; ok(!!d, 'second car out');
  d.hp = 1; T(4); d.hp = -1; T(2);
  ok(R.abDr.length === 0, 'shooting it destroys it before it lands');
}

console.log('\n--- 3. Repair Shot (korek): full heal for a friend, half damage to an enemy');
{
  const { R, a, b, T, log, press } = duel('korek', 'zagros');
  R.map.near0 = () => [];
  const c = R.addBot('blue') || [...R.players.values()].find(p => p.bot && p.team === 'blue');
  const mate = [...R.players.values()].find(p => p.bot && p.team === 'blue');
  mate.tank = tankStats('zagros', 1); R.spawn(mate);
  place(a, 0, -10, 0); place(mate, 0, 6, 0); mate.hp = 20; mate.s.shield = 0;
  a.s.reload = 99;                                          // the cannon is empty: it must not matter
  const nShells = R.shells.length;
  press(a);
  ok(R.shells.length === nShells + 1, 'pressing the power sends a repair shell straight out');
  ok(a.s.reload > 98, `and the cannon is still just as empty as it was (${a.s.reload.toFixed(2)} s left)`);
  ok(log.some(([, m]) => m.t === 'shot' && m.hl === 1 && m.ab === 1), 'it goes out marked as a power shot');
  T(20, () => { place(mate, 0, 6, 0); mate.s.shield = 0; });
  ok(mate.hp === mate.tank.hp, `team-mate healed all the way back to full (20 → ${mate.hp} of ${mate.tank.hp})`);
  ok(log.some(([, m]) => m.t === 'heal' && m.v === mate.id), 'a heal event is sent');
  // an enemy is hurt instead — but only half as much
  place(mate, 60, 60, 0);                                   // move the team-mate out of the line of fire
  const plain = (() => { place(a, 0, -10, 0); place(b, 0, 6, 0); b.hp = 5000; b.s.shield = 0;
    a.s.reload = 0; a.s.t = 0; R.fire(a, 0); T(20, () => { place(b, 0, 6, 0); b.s.shield = 0; });
    return 5000 - b.hp; })();
  const halved = (() => { place(a, 0, -10, 0); place(b, 0, 6, 0); b.hp = 5000; b.s.shield = 0;
    a.s.t = 0; press(a, 0); T(20, () => { place(b, 0, 6, 0); b.s.shield = 0; });
    return 5000 - b.hp; })();
  ok(b.hp < 5000, 'a Repair Shot that hits an enemy still hurts him');
  ok(halved > 0 && halved <= plain * 0.75, `but only about half as much (normal ${plain}, repair ${halved})`);
}

console.log('\n--- 4. Cover Wall (zagros): blocks shells, breaks after enough of them');
{
  const { R, a, b, T, press } = duel('zagros', 'safeen');
  R.map.near0 = () => [];
  place(a, 0, -20, 0); place(b, 0, 10, Math.PI);
  press(a);
  const w = R.map.fx.walls[0];
  ok(!!w, 'a wall was dropped in front of the tank');
  const wantZ = -20 + 0.6 * 15;            // aimed straight ahead, 60% of the wall's reach
  ok(Math.abs(w.z - wantZ) < 0.6, `it lands where he aimed, not at a fixed spot (z=${w.z.toFixed(1)}, aimed ${wantZ.toFixed(1)})`);
  // a shell from the enemy is stopped by it
  b.hp = 9999; a.hp = 9999; const ahp = a.hp;
  b.s.t = Math.PI; b.s.reload = 0; R.fire(b, 0); T(25, () => { place(a, 0, -20, 0); });
  ok(a.hp === ahp, 'the wall soaked the shell');
  ok(w.hp < w.mhp, `the wall took the damage (${w.mhp} → ${Math.round(w.hp)})`);
  // enough shells and it is gone
  for (let i = 0; i < 20 && R.map.fx.walls.length; i++) { b.s.t = Math.PI; b.s.reload = 0; R.fire(b, 0); T(25, () => { place(a, 0, -20, 0); place(b, 0, 10, Math.PI); }); }
  ok(R.map.fx.walls.length === 0, 'the wall is destroyed by repeated fire');
  // and it blocks driving through
  place(a, 0, -20, 0); press(a);
  place(a, 0, -20, 0); a.s.yaw = 0;
  for (let i = 0; i < 40; i++) { R.onBinary(a, new Uint8Array(encodeInput({ seq: (a.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 1, throttle: 0, steer: 0, aim: 0, fire: false, ab: false }))); a.starving = false; T(1); }
  { const w2 = R.map.fx.walls[0];
    ok(w2 && a.s.z < w2.z - 1.5, `you cannot drive through your own wall (stopped at z=${a.s.z.toFixed(1)}, wall at ${w2 ? w2.z.toFixed(1) : '?'})`); }
}

console.log('\n--- 5. Vanish (rashaba): enemies lose you, team-mates keep you, firing shows you');
{
  const { R, a, b, T, log, press } = duel('rashaba', 'zagros');
  place(a, 0, 0, 0); place(b, 20, 0, 0);
  for (const k in snapsOf) delete snapsOf[k];
  press(a); T(3);
  ok(a.cloakT > 0, 'the tank is invisible');
  const seenByEnemy = (snapsOf.b || []).slice(-1)[0];
  ok(seenByEnemy && !seenByEnemy.tanks.has(a.id), 'the enemy does not get his position at all');
  const seenBySelf = (snapsOf.a || []).slice(-1)[0];
  ok(seenBySelf && seenBySelf.tanks.has(a.id), 'he still sees himself');
  ok((seenBySelf.tanks.get(a.id).flags & FLAG_CLOAK) !== 0, 'marked as cloaked so it is drawn see-through');
  a.s.reload = 0; R.fire(a, 0);
  ok(!a.cloakT, 'firing breaks it at once');
  ok(log.some(([, m]) => m.t === 'ab' && m.k === 'uncloak'), 'everyone is told he is back');
  // it runs out by itself
  press(a); ok(a.cloakT > 0, 'cloaked again');
  T(Math.ceil(lvl('cloak', 'life', MAX_AB) * 30) + 4);
  ok(!a.cloakT, 'it ends on its own after a few seconds');
  // no cloaking with the flag
  const F = duel('rashaba', 'zagros', MAX_AB, 'ctf');
  place(F.a, 0, 0, 0);
  F.R.flags[F.b.team] = { team: F.b.team, home: [40, 0], x: 0, z: 0, s: 'carried', c: F.a.id, at: 0 };
  F.press(F.a);
  ok(!F.a.cloakT, 'you cannot vanish while carrying the flag');
  ok(F.log.some(([, m]) => m.t === 'abNo' && m.why === 'flag'), 'and you are told why');
}

console.log('\n--- 6. Bunker Dome (halgurd): drive in and out, but no shooting through the skin');
{
  const { R, a, b, T, press } = duel('halgurd', 'safeen');
  R.map.near0 = () => [];
  place(a, 0, 0, 0); press(a);
  const d = R.map.fx.domes[0];
  ok(!!d, `a dome is up (r=${d && d.r})`);
  // from outside: blocked
  a.hp = 9999; const ahp = a.hp;
  place(a, d.x, d.z, 0);                                   // stand in the middle of the bubble
  place(b, d.x, d.z + d.r + 10, Math.PI); b.s.reload = 0; R.fire(b, 0); T(25, () => { place(a, d.x, d.z, 0); });
  ok(a.hp === ahp, 'a shell from outside cannot reach in');
  // from inside to inside: allowed
  place(b, d.x, d.z + d.r - 3, Math.PI); b.s.reload = 0; R.fire(b, 0); T(25, () => { place(a, d.x, d.z, 0); });
  ok(a.hp < ahp, `inside the dome you can still shoot (hp ${a.hp})`);
  // driving through the skin is free
  place(b, 60, 60, 0);                       // out of the way, so we test the dome and not a traffic jam
  place(a, d.x, d.z, 0); a.s.yaw = 0;
  for (let i = 0; i < 90; i++) { R.onBinary(a, new Uint8Array(encodeInput({ seq: (a.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 1, throttle: 0, steer: 0, aim: 0, fire: false, ab: false }))); a.starving = false; T(1); }
  ok(a.s.z > d.z + d.r, `you can drive straight out of it (z=${a.s.z.toFixed(1)}, dome edge ${(d.z + d.r).toFixed(1)})`);
  ok(R.map.fx.domes.length === 1, 'it is still standing');
  T(Math.ceil(lvl('dome', 'life', MAX_AB) * 30) + 4);
  ok(R.map.fx.domes.length === 0, 'it disappears after 10 seconds');
}

console.log('\n--- 7. Freeze Cage (bradost): 2.5 s of nothing, but he still takes hits');
{
  const { R, a, b, T, log, press } = duel('bradost', 'zagros');
  R.map.near0 = () => [];
  place(a, 0, -8, 0); place(b, 0, 6, 0); b.hp = 9999;
  a.s.reload = 99;                                          // again: an empty cannon must not block it
  press(a);
  ok(a.s.reload > 98, `the freeze shell leaves the cannon reload alone (${a.s.reload.toFixed(2)} s left)`);
  ok(log.some(([, m]) => m.t === 'shot' && m.fz === 1 && m.ab === 1), 'it goes out marked as a power shot');
  T(14, () => { b.s.shield = 0; });
  ok(b.s.froz > 0, `he is caged (${b.s.froz.toFixed(2)} s left)`);
  ok(log.some(([, m]) => m.t === 'ab' && m.k === 'caged' && m.id === b.id), 'a cage event is sent');
  const hpIn = b.hp; ok(hpIn < 9999, 'the freeze shell still did its normal damage');
  // he cannot move
  const z0 = b.s.z;
  for (let i = 0; i < 20; i++) { R.onBinary(b, new Uint8Array(encodeInput({ seq: (b.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 1, throttle: 0, steer: 0, aim: 0, fire: true, ab: false }))); b.starving = false; T(1); }
  ok(Math.abs(b.s.z - z0) < 0.35, `he cannot drive out (moved ${Math.abs(b.s.z - z0).toFixed(2)} m)`);
  // but can be hurt
  a.s.reload = 0; a.s.t = 0; R.fire(a, 0); T(16, () => { b.s.shield = 0; });
  ok(b.hp < hpIn, `a caged tank still takes damage (${hpIn} → ${b.hp})`);
  T(Math.ceil(lvl('freeze', 'life', MAX_AB) * 30));
  ok(b.s.froz === 0, 'the cage opens again');
}

console.log('\n--- 8. Black Hole (newroz): drags enemies in, leaves your own team alone');
{
  const { R, a, b, T, press } = duel('newroz', 'zagros');
  R.map.near0 = () => [];
  place(a, 0, -30, 0);
  press(a);
  const h = R.map.fx.holes[0];
  ok(!!h, `a black hole opened ahead of him (r=${h && h.r})`);
  parkBot(b); place(b, h.x + h.r - 2, h.z, 0);
  const d0 = Math.hypot(b.s.x - h.x, b.s.z - h.z);
  T(20, () => { b.s.shield = 0; });
  const d1 = Math.hypot(b.s.x - h.x, b.s.z - h.z);
  ok(d1 < d0 - 1, `the enemy is pulled toward the middle (${d0.toFixed(1)} m → ${d1.toFixed(1)} m)`);
  // a team-mate standing in it is not moved
  const mate = [...R.players.values()].find(p => p.bot) || R.addBot('blue');
  const m2 = [...R.players.values()].find(p => p.bot);
  if (m2) {
    m2.team = 'blue'; R.spawn(m2); parkBot(m2); place(m2, h.x + h.r - 2, h.z, 0); m2.s.tm = 'blue';
    const e0 = Math.hypot(m2.s.x - h.x, m2.s.z - h.z); T(15);
    const e1 = Math.hypot(m2.s.x - h.x, m2.s.z - h.z);
    ok(Math.abs(e1 - e0) < 1.2, `your own side is not sucked in (${e0.toFixed(1)} → ${e1.toFixed(1)})`);
  }
  T(Math.ceil(lvl('hole', 'life', MAX_AB) * 30) + 4);
  ok(R.map.fx.holes.length === 0, 'it closes again');
}

console.log('\n--- 8b. Black Hole: it grinds down what it catches, harder toward the middle');
{
  // Health lost over one second, held at a fixed distance from the middle.
  const burn = (frac) => {
    const { R, a, b, T, press } = duel('newroz', 'zagros', 0);   // level 0 → dps 10
    R.map.near0 = () => [];
    place(a, 0, -30, 0); press(a);
    const h = R.map.fx.holes[0];
    parkBot(b); b.hp = 9999;
    const at = h.r * frac;                       // 0 = dead centre, 1 = the rim
    const hp0 = b.hp;
    T(NET.TICK_RATE, () => { place(b, h.x + at, h.z, 0); b.hp = Math.min(b.hp, 9999); });
    return hp0 - b.hp;
  };
  const rim = burn(0.98), mid = burn(0.5), core = burn(0.02);
  ok(rim > 0, `a tank at the rim is being hurt (${rim} hp in a second)`);
  ok(Math.abs(mid - 10) <= 2, `about 10 health a second halfway in (${mid})`);
  ok(core > mid && mid > rim, `the closer to the middle the worse it is (rim ${rim} < half ${mid} < centre ${core})`);
  ok(Math.abs(core - 20) <= 2 && Math.abs(rim - 4) <= 2, `it runs from about 4/s at the edge to about 20/s in the middle`);

  // outside the hole nothing happens, and your own team is safe inside it
  {
    const { R, a, b, T, press } = duel('newroz', 'zagros', 0);
    R.map.near0 = () => [];
    place(a, 0, -30, 0); press(a);
    const h = R.map.fx.holes[0];
    parkBot(b); place(b, h.x + h.r + 6, h.z, 0); b.hp = 500;
    const hp0 = b.hp; T(NET.TICK_RATE, () => { place(b, h.x + h.r + 6, h.z, 0); });
    ok(b.hp === hp0, 'standing outside it costs nothing');
    b.team = 'blue'; b.s.tm = 'blue'; place(b, h.x, h.z, 0); b.hp = 500;
    const hp1 = b.hp; T(NET.TICK_RATE, () => { place(b, h.x, h.z, 0); b.s.tm = 'blue'; });
    ok(b.hp === hp1, 'your own side can stand in it unharmed');
  }

  // it can finish a tank off, and the kill is credited to whoever cast it
  {
    const { R, a, b, T, press } = duel('newroz', 'zagros', 0);
    R.map.near0 = () => [];
    place(a, 0, -30, 0); press(a);
    const h = R.map.fx.holes[0];
    parkBot(b); place(b, h.x, h.z, 0); b.hp = 12;
    const k0 = a.k;
    T(NET.TICK_RATE, () => { if (b.alive) place(b, h.x, h.z, 0); });
    ok(!b.alive, 'a tank left in the middle is destroyed by it');
    ok(a.k === k0 + 1, 'the kill goes to the tank that opened it');
  }
}

console.log('\n--- you earn a power by damaging enemies, there is no timer');
{
  const { R, a, b, T, log } = duel('zagros', 'zagros', 0);
  R.map.near0 = () => [];
  place(a, 0, -8, 0); place(b, 0, 6, 0); b.hp = 99999; b.s.shield = 0;
  a.abChg = 0;
  const need = abNeed('wall', 0);
  ok(a.abChg === 0, 'a match starts with an empty power bar');
  // pressing it now does nothing at all
  for (const v of [true, false]) { R.onBinary(a, new Uint8Array(encodeInput({ seq: (a.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 0, throttle: 0, steer: 0, aim: 0, fire: false, ab: v, abd: 0.6 }))); a.starving = false; T(1); }
  ok(R.map.fx.walls.length === 0, 'you cannot use a power that is not charged yet');
  // now hurt him until it fills
  let shots = 0;
  while (a.abChg < need && shots < 60) { a.s.reload = 0; a.s.t = 0; R.fire(a, 0); T(16, () => { place(b, 0, 6, 0); b.s.shield = 0; b.hp = Math.max(500, b.hp); }); shots++; }
  ok(a.abChg >= need, `hitting an enemy fills it (${Math.round(a.abChg)}/${need} after ${shots} shells)`);
  ok(log.some(([, m]) => m.t === 'abc'), 'the player is told how full the bar is');
  ok(log.some(([, m]) => m.t === 'abReady'), 'and told the moment it is ready');
  for (const v of [true, false]) { R.onBinary(a, new Uint8Array(encodeInput({ seq: (a.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 0, throttle: 0, steer: 0, aim: 0, fire: false, ab: v, abd: 0.6 }))); a.starving = false; T(1); }
  ok(R.map.fx.walls.length === 1, 'a full bar lets you use it');
  ok(a.abChg === 0, 'and using it empties the bar again');
  // hurting a team-mate must not charge anything
  const before = a.abChg;
  const mate = [...R.players.values()].find(q => q.bot);
  if (mate) { mate.team = a.team; mate.s.tm = a.team; R.damage(mate, a, 50, false); ok(a.abChg === before, 'hitting a team-mate charges nothing'); }
  // a harder power needs more damage than an easy one
  ok(abNeed('dome', 0) > abNeed('heal', 0), `the strong powers cost more damage (dome ${abNeed('dome', 0)} vs repair ${abNeed('heal', 0)})`);
  ok(abNeed('wall', 5) < abNeed('wall', 0), `upgrading makes it fill sooner (${abNeed('wall', 0)} → ${abNeed('wall', 5)})`);
}

console.log('\n--- each power is aimed the way it should be');
{
  const kinds = {};
  for (const k of Object.keys(ABILITIES)) kinds[abAim(k)] = (kinds[abAim(k)] || 0) + 1;
  ok(abAim('wall') === 'ground' && abAim('dome') === 'ground' && abAim('hole') === 'ground', 'wall, dome and black hole are placed on the ground');
  ok(abAim('drone') === 'dir' && abAim('homing') === 'dir', 'the car and the guided shell are pointed in a direction');
  ok(abAim('heal') === 'shot' && abAim('freeze') === 'shot', 'repair and freeze arm your next shell');
  ok(abAim('cloak') === 'self', 'vanishing needs no aiming');
  // the placed spot really follows the aim
  const { R, a, T, press } = duel('newroz', 'zagros');
  R.map.near0 = () => [];
  place(a, 0, 0, 0);
  press(a, Math.PI / 2, 1);                       // aim east, as far as it goes
  const h = R.map.fx.holes[0];
  ok(h && h.x > 20 && Math.abs(h.z) < 4, `aiming east puts it east (x=${h ? h.x.toFixed(1) : '?'}, z=${h ? h.z.toFixed(1) : '?'})`);
  const R2 = duel('newroz', 'zagros'); R2.R.map.near0 = () => [];
  place(R2.a, 0, 0, 0); R2.press(R2.a, Math.PI, 0.4);   // aim south, closer in
  const h2 = R2.R.map.fx.holes[0];
  ok(h2 && h2.z < -6 && h2.z > -18, `a short aim puts it closer (z=${h2 ? h2.z.toFixed(1) : '?'})`);
}

console.log('\n--- bots use their power sensibly (they used to wall themselves in)');
{
  const R = new Room('BOTS', { now });
  const h = R.join(conn('h', []), 'Host', 'hh');
  R.onJSON(h, { t: 'map', map: 'hawler' });
  for (let i = 0; i < 6; i++) R.addBot(i % 2 ? 'red' : 'blue');
  R.start();
  for (const p of R.players.values()) if (p.bot) { p.tank = tankStats('zagros', { pow: 0, arm: 0, spd: 0, rng: 0, rel: 0, ab: 3 }); R.spawn(p); }
  let placed = 0, tooClose = 0, stuckTicks = 0, aliveTicks = 0;
  const seen = new Set();
  for (let i = 0; i < 60 * 45; i++) {
    t += 1000 / NET.TICK_RATE;
    for (const p of R.players.values()) if (p.bot) p.abChg = 9999;        // never waiting on charge: we want to see placement
    R.update();
    for (const w of (R.map.fx ? R.map.fx.walls : [])) {
      if (seen.has(w.id)) continue;
      seen.add(w.id); placed++;
      const o = R.players.get(w.o);
      if (o && dist(o.s.x, o.s.z, w.x, w.z) < 6) tooClose++;
    }
    for (const p of R.players.values()) {
      if (!p.bot || !p.alive) continue;
      aliveTicks++;
      if (Math.abs(p.s.v) < 0.4) { p.slow = (p.slow || 0) + 1; if (p.slow > 60) stuckTicks++; } else p.slow = 0;
    }
  }
  ok(placed > 0, `bots did use their power (${placed} walls in 45 s)`);
  ok(tooClose === 0, `no bot dropped a wall on its own nose (${tooClose} of ${placed})`);
  const stuckPct = aliveTicks ? stuckTicks / aliveTicks * 100 : 0;
  ok(stuckPct < 8, `bots keep moving (standing still ${stuckPct.toFixed(1)}% of the time, with powers forced on every tick)`);
}

console.log('\n--- upgrades really change the numbers');
{
  for (const [k, A] of Object.entries(ABILITIES)) {
    const keys = Object.keys(A).filter(x => Array.isArray(A[x]) && x !== 'need');
    const grew = keys.some(x => lvl(k, x, MAX_AB) > lvl(k, x, 0));
    // dome only grows its radius; the Repair Shot always heals to full, so its upgrade is the charge
    ok(grew || k === 'dome' || k === 'heal', `${k}: level 5 is stronger than level 0`);
  }
  ok(lvl('dome', 'r', MAX_AB) > lvl('dome', 'r', 0), 'dome: a bigger bubble at level 5');
  ok(abNeed('heal', MAX_AB) < abNeed('heal', 0), `repair: upgrading means it is ready sooner (${abNeed('heal', 0)} → ${abNeed('heal', MAX_AB)} damage)`);
}

console.log('\n--- the power is its own control: never the cannon\'s, never waiting on it');
{
  // one input frame, straight down the real wire path
  const send = (R, p, o) => {
    R.onBinary(p, new Uint8Array(encodeInput({ seq: (p.lastQueued || 0) + 1, mode: MODE_DIR, dir: 0, mag: 0,
      throttle: 0, steer: 0, aim: o.aim ?? p.s.t, fire: !!o.fire, ab: !!o.ab, abd: o.abd ?? 0.6,
      abAim: o.abAim ?? o.aim ?? p.s.t })));
    p.starving = false;
  };
  {
    const { R, a, T } = duel('zagros', 'baz');     // wall: something we can count on the map
    a.abChg = 9999; a.s.reload = 1.8;              // full power bar, cannon still reloading
    send(R, a, { ab: true }); T(1); send(R, a, { ab: false }); T(1);
    ok(R.map.fx.walls.length === 1, 'a full power bar goes off while the cannon is still reloading');
    ok(a.s.reload > 1.5, `and the cannon carries on reloading undisturbed (${a.s.reload.toFixed(2)} s)`);
  }
  {
    const { R, a, T } = duel('zagros', 'baz');
    a.abChg = 0;                                   // bar empty
    send(R, a, { ab: true }); T(1); send(R, a, { ab: false }); T(1);
    ok(R.map.fx.walls.length === 0, 'a power that is not charged does nothing at all');
  }
  {
    const { R, a, T } = duel('zagros', 'baz');
    a.abChg = 9999; a.s.reload = 0;
    for (let i = 0; i < 4; i++) { send(R, a, { fire: true }); T(1); }   // hammer the trigger
    ok(R.map.fx.walls.length === 0, 'pressing FIRE never lets the power off — the two are separate');
    ok(a.abChg >= 9999 || a.abChg > 0, 'and the power keeps its charge');
  }
  {
    const { R, a, T } = duel('zagros', 'baz');
    a.abChg = 9999;
    // held down for a while, then let go: one wall, not one per tick
    for (let i = 0; i < 6; i++) { send(R, a, { ab: true }); T(1); }
    send(R, a, { ab: false }); T(1);
    ok(R.map.fx.walls.length === 1, `holding the power aims it and places exactly one (${R.map.fx.walls.length})`);
    ok(a.abChg === 0, 'and the charge is spent exactly once');
  }
  {
    const { R, a, T } = duel('zagros', 'baz');
    a.abChg = 9999;
    // a laggy client repeating the same press must not buy two walls with one bar
    send(R, a, { ab: true }); T(1);
    a.abChg = 0;                                   // the bar is already spent server-side
    send(R, a, { ab: false }); T(1); send(R, a, { ab: true }); T(1);
    ok(R.map.fx.walls.length === 1, 'a repeated press on a spent bar cannot place a second one');
  }
  {
    // the power points where the POWER control points, not where the gun does
    const { R, a, T } = duel('zagros', 'baz');
    a.abChg = 9999; place(a, 0, 0, 0);
    send(R, a, { ab: true, aim: 0, abAim: Math.PI / 2, abd: 1 }); T(1); send(R, a, { ab: false }); T(1);
    const w = R.map.fx.walls[0];
    ok(!!w && w.x > 8 && Math.abs(w.z) < 4, `it lands where the power was aimed, not down the barrel (${w ? w.x.toFixed(1) + ',' + w.z.toFixed(1) : 'none'})`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nALL ABILITY TESTS PASS');
process.exit(fails ? 1 : 0);
