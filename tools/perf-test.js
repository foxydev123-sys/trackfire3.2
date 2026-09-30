/* How fast is the game? Measures the parts that decide how many players a server holds
   and how smooth a phone feels, then checks each one against a budget.
     node tools/perf-test.js            */
import { Room } from '../client/shared/room.js';
import { NET, GAME } from '../client/shared/config.js';
import { getMap, buildMap } from '../client/shared/maps.js';
import { newTankState, simulateInput, stepShell, collide } from '../client/shared/sim.js';
import { encodeInput, decodeInput, encodeSnapshotBody, decodeSnapshot, encodeSnapshot } from '../client/shared/protocol.js';
process.removeAllListeners('warning');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const conn = () => ({ send() {}, close() {}, congested: () => false });

/** Run fn a few times and keep the best — the machine running the tests is noisy. */
function best(fn, runs = 5) {
  let b = Infinity;
  for (let i = 0; i < runs; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; }
  return b;
}

console.log('--- the server tick (this decides how many players one core holds)');
{
  const modes = ['tdm', 'ctf', 'koh', 'convoy', 'bounty', 'lts'];
  let worst = 0, worstMode = '';
  for (const mode of modes) {
    const N = 30 * 30;                      // 30 seconds of play
    const ms = best(() => {
      let t = 0; const R = new Room('P', { now: () => t, kind: 'private' });
      const h = R.join(conn(), 'H', 'k');
      R.onJSON(h, { t: 'mode', mode }); R.onJSON(h, { t: 'map', map: 'hawler' });
      for (let i = 0; i < 7; i++) R.addBot();
      R.hostId = h.id; R.start();
      for (let i = 0; i < N; i++) { t += 1000 / NET.TICK_RATE; R.update(); }
    }, 3) / N;
    if (ms > worst) { worst = ms; worstMode = mode; }
    console.log(`    ${mode.padEnd(7)} ${ms.toFixed(3)} ms/tick`);
  }
  const perCore = Math.floor(33.3 / worst);
  ok(worst < 1.2, `worst mode (${worstMode}) costs ${worst.toFixed(3)} ms a tick — about ${perCore} matches per core`);
}

console.log('\n--- moving and colliding 8 tanks (shared by server and every browser)');
{
  const map = getMap('hawler');
  const tanks = Array.from({ length: 8 }, (_, i) => newTankState(-30 + i * 8, 0, 0, 'zagros', 2.2, 1));
  const inp = decodeInput(new Uint8Array(encodeInput({ seq: 1, mode: 0, dir: 0.4, mag: 1, throttle: 0, steer: 0, aim: 1, fire: false, ab: false, abd: 0 })));
  const N = 30 * 60;                        // a minute of play
  const ms = best(() => { for (let i = 0; i < N; i++) for (const s of tanks) simulateInput(s, inp, 1 / 30, map, tanks); });
  const per = ms / (N * 8);
  ok(per < 0.02, `${per.toFixed(4)} ms per tank per tick (${ms.toFixed(0)} ms for a minute of 8 tanks)`);
}

console.log('\n--- packing what goes over the wire');
{
  const tanks = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, flags: 5, x: i, z: -i, yaw: 1, t: 2, v: 5, w: 0.2, hp: 80, reload: 1, shield: 0, armor: 0, boost: 0 }));
  const N = 30 * 60;
  const enc = best(() => { for (let i = 0; i < N; i++) encodeSnapshot(i, i * 33, i, encodeSnapshotBody(tanks)); });
  const body = encodeSnapshotBody(tanks), snap = encodeSnapshot(1, 1, 1, body);
  const buf = snap.buffer.slice(snap.byteOffset, snap.byteOffset + snap.byteLength);
  const dec = best(() => { for (let i = 0; i < N; i++) decodeSnapshot(buf); });
  ok(enc / N < 0.05, `packing a 10-tank snapshot: ${(enc / N * 1000).toFixed(1)} µs (${snap.byteLength} bytes)`);
  ok(dec / N < 0.05, `unpacking it in the browser: ${(dec / N * 1000).toFixed(1)} µs`);
  const perSec = snap.byteLength * 30;
  ok(perSec < 12000, `about ${(perSec / 1024).toFixed(1)} KB a second down to each player`);
}

console.log('\n--- building a map (the browser does this once per map)');
{
  let slowest = 0, slowId = '';
  for (const id of ['hawler', 'desert', 'forest', 'stadium']) {
    const ms = best(() => buildMap(id), 3);
    if (ms > slowest) { slowest = ms; slowId = id; }
    console.log(`    ${id.padEnd(8)} ${ms.toFixed(1)} ms`);
  }
  ok(slowest < 120, `the heaviest map (${slowId}) takes ${slowest.toFixed(0)} ms to build, once`);
}

console.log('\n--- shells');
{
  const map = getMap('hawler');
  const targets = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, x: i * 6, z: 10, alive: true }));
  const N = 200000;
  const ms = best(() => {
    for (let i = 0; i < N; i++) {
      const sh = { x: 0, z: -40, dx: 0, dz: 1, trav: 0, max: 40, spd: 48, owner: 99 };
      stepShell(sh, 1 / 30, map, targets);
    }
  });
  ok(ms / N < 0.01, `${(ms / N * 1000).toFixed(2)} µs to move one shell one tick`);
}

console.log(fails ? `\n${fails} OVER BUDGET` : '\nALL PERFORMANCE CHECKS PASS');
process.exit(fails ? 1 : 0);
