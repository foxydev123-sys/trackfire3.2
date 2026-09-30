/* Tank types: checks each special rule on the real server logic, then runs
   1v1 bot duels (every tank vs the starter Zagros, same level) to see balance.
     node tools/tanks-test.js [duels per tank] */
import { Room } from '../client/shared/room.js';
import { NET } from '../client/shared/config.js';
import { tankStats, TANK_IDS, TANKS, upgradeCost, statCost } from '../client/shared/tanks.js';
import { decodeSnapshot } from '../client/shared/protocol.js';
let T = 0; const now = () => T; const tick = (room, n = 1) => { for (let i = 0; i < n; i++) { T += 1000 / NET.TICK_RATE; room.update(); } };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = []; const conn = { send(d) { if (typeof d === 'string') msgs.push(JSON.parse(d)); else msgs.push(d); }, close() {} };
function setup(clsA, clsB, lvl = 1) {
  const room = new Room('TT', { now, kind: 'practice' }); room.setMap('desert');
  const a = room.join(conn, 'A', 'ta', null, { id: clsA, level: lvl });
  room.onJSON(a, { t: 'mode', mode: 'tdm' }); room.addBot(); const b = [...room.players.values()].find(p => p.bot);
  b.tank = tankStats(clsB, lvl); room.onJSON(a, { t: 'start' });
  for (const p of [a, b]) { p.s.shield = 0; p.s.armor = 0; }
  a.s.x = 0; a.s.z = 0; a.s.t = 0; b.s.x = 0; b.s.z = 12; b.s.v = 0; b.bot = null; b.inputQ = []; // B stands still in front of A
  b.connected = false; b.alive = true;
  return { room, a, b };
}
// ---- stats are applied
{ const { room, a, b } = setup('halgurd', 'zagros'); ok(a.hp === 145 && a.s.rl === 3.3 && a.s.cls === 'halgurd', 'Halgurd spawns with 145 HP and 3.3 s reload');
  ok(tankStats('halgurd', 10).hp === Math.round(145 * 1.3) && tankStats('zagros', 10).dmg[1] === Math.round(40 * 1.25), 'fully upgraded: +30% health, +25% damage');
  const sp = tankStats('zagros', { spd: 5 }); ok(sp.sm > 1.14 && sp.hp === 100 && sp.dmg[1] === 40 && sp.level === 3, 'upgrading only speed changes only speed (5 of 25 upgrades = level 3)');
  const rg = tankStats('safeen', { rng: 5, rel: 5 }); ok(rg.range > 62 && rg.reload < 3.4, 'range and reload upgrades'); }
// ---- spread
{ const { room, a } = setup('bradost', 'zagros'); msgs.length = 0; room.fire(a, 1); const shots = msgs.filter(m => m.t === 'shot');
  ok(shots.length === 3 && new Set(shots.map(s => s.a)).size === 3 && shots[0].max === 26, 'Bradost fires 3 spread shells with 26 m range'); }
// ---- armor
{ const { room, a, b } = setup('zagros', 'halgurd'); b.hp = 145; const d = room.damage(b, a, 40, false); ok(d === 34 && b.hp === 111, 'Halgurd armour blocks 15% (40 → 34)'); }
// ---- splash
{ const { room, a, b } = setup('newroz', 'zagros'); room.addBot(); const c = [...room.players.values()].find(p => p !== a && p !== b); c.team = b.team; c.tank = tankStats('zagros', 1); c.alive = true; c.hp = 100; c.s.shield = 0; c.s.armor = 0; c.s.x = 2.5; c.s.z = 12; c.bot = null; c.connected = false;
  b.hp = 100; room.fire(a, 1); for (let i = 0; i < 20 && room.shells.length; i++) tick(room);
  ok(b.hp < 100 && c.hp < 100 && c.hp >= 100 - 18, `Newroz splash hurts the tank next to the target (target ${b.hp}, neighbour ${c.hp})`); }
// ---- regen
{ const { room, a, b } = setup('korek', 'zagros'); a.hp = 50; a.lastHit = T; tick(room, 60); const mid = a.hp; tick(room, 90); ok(mid === 50 && a.hp > 60, `Korek repairs itself after 3 s without damage (${mid} → ${Math.round(a.hp)})`); }
// ---- snapshot hp is a percentage of that tank's max
{ const { room, a } = setup('halgurd', 'zagros'); a.hp = 72.5; msgs.length = 0; room.sendSnapshots(); const bin = msgs.find(m => typeof m !== 'string' && !m.t);
  const snap = decodeSnapshot(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)); ok(snap.tanks.get(a.id).hp === 50, 'snapshot sends health as % of max (72.5/145 → 50%)'); }
// ---- upgrade costs rise and rarer tanks need fewer cards
ok(upgradeCost('zagros', 1).cards === 2 && upgradeCost('zagros', 9).cards === 800 && upgradeCost('newroz', 9).cards === 80 && upgradeCost('newroz', 9).coins > upgradeCost('zagros', 9).coins && upgradeCost('zagros', 10) === null, 'upgrade costs rise per level; rarer = fewer but rarer cards, more coins');

// ---- balance: 1v1 bot duels vs Zagros
const N = Number(process.argv[2]) || 16;
console.log(`\nBalance: ${N} bot duels per tank vs Zagros (same level, desert):`);
for (const id of TANK_IDS) {
  let wins = 0, secs = 0;
  for (let i = 0; i < N; i++) {
    const room = new Room('B' + i, { now, kind: 'practice' }); room.setMap('desert'); room.mode = 'tdm';
    room.addBot('blue'); room.addBot('red');
    const [x, y] = [...room.players.values()]; x.tank = tankStats(id, 1); y.tank = tankStats('zagros', 1);
    room.start();
    const t0 = T; let winner = null;
    x.bot.skill = y.bot.skill = 0.8;
    while (T - t0 < 120000) { tick(room); if (x.d > 0 || y.d > 0) { winner = y.d > 0 ? 'x' : 'y'; break; } }
    if (winner === 'x') wins++; secs += (T - t0) / 1000;
  }
  const t = TANKS[id];
  console.log(`  ${id.padEnd(8)} ${t.rarity.padEnd(9)} wins ${String(Math.round(wins / N * 100)).padStart(3)}%   avg fight ${(secs / N).toFixed(0)} s`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL TANK TESTS PASS');
process.exit(fails ? 1 : 0);
