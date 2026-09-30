// Unit test for power-ups using the real server Room (no network).
import { Room } from '../client/shared/room.js';
import { GAME, NET } from '../client/shared/config.js';
import { encodeInput } from '../client/shared/protocol.js';
import { MODE_DIR } from '../client/shared/sim.js';
let t = 0; const now = () => t;
const sent = []; const conn = (n) => ({ send: (d) => { if (typeof d === 'string') sent.push([n, JSON.parse(d)]); }, close() {}, congested: () => false });
const room = new Room('TEST', { now });
const A = room.join(conn('A'), 'Alice', 'a'), B = room.join(conn('B'), 'Bob', 'b');
room.onJSON(A, { t: 'map', map: 'hawler' }); room.start();
const tick = (n = 1, inpA = null) => { for (let i = 0; i < n; i++) { t += 1000 / NET.TICK_RATE; if (inpA) room.onBinary(A, new Uint8Array(encodeInput({ ...inpA, seq: (A.lastQueued || 0) + 1 }))); room.update(); } };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const pad = (type) => { const p = room.pads[0]; p.type = type; p.on = true; return p; };
const put = (pl, p) => { pl.s.x = p.x; pl.s.z = p.z; };
// shield
let p = pad('shield'); put(A, p); tick(1);
ok(A.s.armor > 4.5, 'shield picked up (' + A.s.armor.toFixed(2) + ' s)'); ok(!p.on, 'pad emptied');
ok(sent.some(([n, m]) => m.t === 'pu' && m.id === A.id && m.type === 'shield'), 'pickup broadcast');
// shielded tank takes no damage: fire B at A point blank
A.s.x = 30; A.s.z = 30; A.s.shield = 0; B.s.x = 30; B.s.z = 22; B.s.t = 0; B.s.reload = 0; B.s.shield = 0; const hp0 = A.hp;
room.fire(B, 0); tick(10); ok(A.hp === hp0, 'shield blocked the hit (hp ' + A.hp + ')');
// firing does not cancel the power-up shield
A.s.reload = 0; tick(1, { mode: MODE_DIR, dir: 0, mag: 0, aim: 0, fire: true }); tick(2); ok(A.s.armor > 0, 'firing keeps the power-up shield');
// shield expires
tick(Math.ceil(GAME.POWERUPS.SHIELD_S * 30) + 5, { mode: MODE_DIR, dir: 0, mag: 0, aim: 0, fire: false }); ok(A.s.armor === 0, 'shield expires');
// health
A.hp = 20; p = pad('health'); p.on = true; put(A, p); tick(1); ok(A.hp === GAME.HP, 'full health');
// speed: compare top speed over 3 s
const run = (boost) => { A.s.x = -24; A.s.z = 0; A.s.yaw = 0; A.s.v = 0; A.s.boost = boost; A.inputQ.length = 0; A.starving = false; B.s.x = 60; B.s.z = 60; tick(40, { mode: MODE_DIR, dir: 0, mag: 1, aim: 0, fire: false }); return A.s.v; };
const vNormal = run(0); pad('speed'); room.pads[0].x = -24; room.pads[0].z = 0;
A.s.x = -24; A.s.z = 0; tick(1); ok(A.s.boost > 5, 'speed picked up'); const vB = run(A.s.boost);
ok(vB > vNormal * 1.3, `speed boost: ${vNormal.toFixed(1)} → ${vB.toFixed(1)} m/s`);
// one shot
p = pad('oneshot'); room.pads[0].x = -46; room.pads[0].z = -30; B.s.x = -46; B.s.z = -30; tick(1); ok(B.oneShot, 'one-shot collected');
A.s.x = 30; A.s.z = 30; A.s.armor = 0; A.s.shield = 0; A.hp = 100; A.alive = true; B.s.x = 30; B.s.z = 22; B.s.t = 0; B.s.reload = 0;
room.fire(B, 0); tick(10); ok(!A.alive, 'one-shot shell destroys a full-health tank'); ok(!B.oneShot, 'one-shot used up');
// pad respawns
const P0 = room.pads[0]; P0.on = false; P0.at = t + 100; tick(5); ok(P0.on, 'pad refills after the timer');
// homing rockets
{
  const R = new Room('RK', { now }); const a = R.join(conn('a'), 'A', 'x'), b = R.join(conn('b'), 'B', 'y');
  R.onJSON(a, { t: 'map', map: 'desert' }); R.start(); R.map = Object.assign(Object.create(R.map), { near: () => [] });   // open ground: no rocks in the way
  if (a.team === b.team) b.team = a.team === 'blue' ? 'red' : 'blue';
  const T = (n, fn) => { for (let i = 0; i < n; i++) { t += 1000 / NET.TICK_RATE; if (fn) fn(i); R.update(); } };
  const pd = R.pads[0]; pd.type = 'rocket'; pd.on = true; b.s.x = pd.x; b.s.z = pd.z; T(1);
  ok(b.rockets === GAME.POWERUPS.ROCKETS, 'rockets collected (' + b.rockets + ')');
  const setup = () => { a.alive = b.alive = true; a.hp = 5000; a.s.shield = a.s.armor = 0; b.s.shield = 0; a.s.x = 2; a.s.z = 9; b.s.x = 0; b.s.z = -13; b.s.t = 0.45; b.rockets = 1; R.rockets.length = 0; };
  setup(); let hp0 = a.hp; R.fire(b, 0); ok(R.rockets.length === 1 && b.rockets === 0, 'firing launches a rocket instead of a shell');
  T(90, () => { a.s.x = 2; a.s.z = 9; }); ok(a.hp < hp0, `rocket curves into a still tank (aimed 26° off, hp ${hp0} → ${a.hp})`);
  let hitsStill = 0, hitsDodge = 0;
  for (let k = 0; k < 10; k++) { setup(); hp0 = a.hp; R.fire(b, 0); T(90, () => { a.s.x = 2; a.s.z = 9; }); if (a.hp < hp0) hitsStill++; }
  for (let k = 0; k < 10; k++) { setup(); hp0 = a.hp; R.fire(b, 0); let x = 2, dir = 1; T(90, (i) => { if (i % 22 === 0) dir = -dir; x += dir * 12.5 / NET.TICK_RATE; a.s.x = x; a.s.z = 9; }); if (a.hp < hp0) hitsDodge++; }
  ok(hitsStill >= 9, `still target hit ${hitsStill}/10`);
  ok(hitsDodge < hitsStill, `a fast swerving tank dodges some rockets (hit ${hitsDodge}/10)`);
  ok(sent.some(([n, m]) => m.t === 'rk') , 'rocket positions are sent to players');
}
// breakable props
{
  const R = new Room('BR', { now }); const a = R.join(conn('a'), 'A', 'x'); R.onJSON(a, { t: 'map', map: 'desert' }); R.start();
  const c = R.map.colliders.find(c => c.k === 'crate'); ok(!!c, 'desert has breakable crates');
  const T = (n) => { for (let i = 0; i < n; i++) { t += 1000 / NET.TICK_RATE; R.update(); } };
  a.s.x = c.x; a.s.z = c.z - 6; a.s.t = 0; a.s.reload = 0; a.alive = true;
  R.fire(a, 0); T(15);
  ok(R.map.dead[c.i] === 1, 'one shell breaks a crate');
  ok(sent.some(([n, m]) => m.t === 'brk' && m.i === c.i), 'break is broadcast');
  // shells now fly through where the crate was
  const sh = { x: c.x, z: c.z - 3, dx: 0, dz: 1, trav: 0, max: 20, spd: 40, owner: 99 }; let r = null;
  const { stepShell } = await import('../client/shared/sim.js');
  for (let i = 0; i < 10 && !r; i++) r = stepShell(sh, 1 / 30, R.map, []);
  ok(!r || r.c !== c, 'shells pass the broken crate');
  const w = R.map.colliders.find(c => c.k === 'bags');
  a.s.x = w.x; a.s.z = w.z - 7; a.s.t = 0;
  for (let k = 0; k < 2; k++) { a.s.reload = 0; R.fire(a, 0); T(12); }
  ok(!R.map.dead[w.i], 'sandbags survive 2 hits');
  a.s.reload = 0; R.fire(a, 0); T(12); ok(R.map.dead[w.i] === 1, 'sandbags break on the 3rd hit');
  ok(!getMapDead(), 'other matches keep their props');
  function getMapDead() { return R.map.base.dead && R.map.base.dead[c.i]; }
  const R2 = new Room('BR2', { now }); const b2 = R2.join(conn('z'), 'Z', 'z'); R2.onJSON(b2, { t: 'map', map: 'desert' }); R2.start(); ok(!R2.map.dead[c.i], 'a new match starts with every prop back');
  // ramming a crate
  const c2 = R2.map.colliders.find(q => q.k === 'crate' && q !== c);
  b2.alive = true; b2.s.x = c2.x; b2.s.z = c2.z - 2.4; b2.s.yaw = 0; b2.s.v = 9; R2.update(); t += 33; R2.update();
  ok(R2.map.dead[c2.i] === 1, 'ramming a crate at speed smashes it');
}
// trees, palms and lamps in Hawler: a tank only has to push into them (no run-up) and they fall over
{
  const R = new Room('TR', { now }); const a = R.join(conn('a'), 'A', 'x'); R.onJSON(a, { t: 'map', map: 'hawler' }); R.start();
  const T = (n) => { for (let i = 0; i < n; i++) { t += 1000 / NET.TICK_RATE; R.update(); } };
  const { clearLine } = await import('../client/shared/nav.js');
  const tree = R.map.colliders.find(c => c.k === 'ctree'), palm = R.map.colliders.find(c => c.k === 'palm' && clearLine(R.map, c.x, c.z - 8, c.x, c.z - 2.2, 1.8));
  ok(!!tree && !!palm, 'Hawler has knock-over trees and palms');
  a.alive = true; a.s.x = tree.x; a.s.z = tree.z - 2.5; a.s.yaw = 0; a.s.v = 2; sent.length = 0;
  a.starving = false; for (let i = 0; i < 8; i++) a.inputQ.push({ seq: 1000 + i, mode: MODE_DIR, dir: 0, mag: 0.4, throttle: 0, steer: 0, aim: 0, fire: false });
  T(4);
  ok(R.map.dead[tree.i] === 1, 'driving slowly into a park tree knocks it over');
  const m = sent.find(([n, x]) => x.t === 'brk' && x.i === tree.i); ok(!!m && m[1].fx != null, 'the fall direction is sent to players');
  a.s.x = palm.x; a.s.z = palm.z - 8; a.s.t = 0; a.s.reload = 0; a.inputQ.length = 0; R.fire(a, 0); T(12);
  ok(R.map.dead[palm.i] === 1, 'a shell brings a palm down');
}
