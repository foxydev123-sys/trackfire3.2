/* =====================================================================
   Automated MULTIPLAYER ACCEPTANCE TEST (headless, Node 22+).
   Starts the server, connects client A (drives in continuous circles and
   fires) and client B (observer, plus extra bots), then renders B's view
   of A at 60 fps and measures how smooth it is — under several simulated
   latencies. Pass = no stalls/teleports in B's view of A.
     node tools/net-test.js            (all latency profiles)
     node tools/net-test.js 100 30     (one profile: 100 ms ping, 30 ms jitter)
   ===================================================================== */
import { spawn } from 'node:child_process';
import { NetClient } from '../client/js/net/netclient.js';
import { LAT_SIM } from '../client/js/net/connection.js';
import { MODE_DIR } from '../client/shared/sim.js';

const PORT = 8123 + Math.floor(Math.random() * 500);
const URL_ = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(name, handlers = {}) {
  const c = new NetClient({ name, token: name + Math.random(), openTransport: () => new WebSocket(URL_), handlers: { ...handlers,
    onEvent: (m) => { if (m.t === 'load') c.sendJSON({ t: 'loaded' }); if (handlers.onEvent) handlers.onEvent(m); } } });   // like the game: tell the server the map is loaded
  return c;
}
function frameLoop(clients, fn, ms) {
  return new Promise((res) => {
    let last = performance.now(); const end = last + ms;
    const tick = () => {
      const t = performance.now(); const dt = t - last; last = t;
      fn(dt, t);
      if (t < end) setTimeout(tick, Math.max(0, 16.67 - (performance.now() - t))); else res();
    };
    tick();
  });
}

async function runProfile(pingMs, jitterMs, seconds = 8) {
  LAT_SIM.oneWay = pingMs / 2; LAT_SIM.jitter = jitterMs;
  let room = null;
  const A = client('CircleA', { onRoom: (r) => room = r });
  A.connect('create', null, { map: 'desert' });
  for (let i = 0; i < 100 && !room; i++) await sleep(20);
  const B = client('ObserverB'); B.connect('join', room.code);
  const C = client('ExtraC'); C.connect('join', room.code);
  const D = client('ExtraD'); D.connect('join', room.code);
  await sleep(400 + pingMs * 2);
  A.sendJSON({ t: 'addBot' }); A.sendJSON({ t: 'addBot' });
  for (const X of [B, C, D]) X.sendJSON({ t: 'ready', v: true });     // private rooms start only when everyone is ready
  await sleep(100 + pingMs);
  A.sendJSON({ t: 'start' });
  await sleep(600 + pingMs * 2);

  const all = [A, B, C, D];
  let t0 = performance.now();
  const circle = (s) => ({ mode: MODE_DIR, dir: ((performance.now() - t0) / 1000) * 1.1, mag: 1, aim: s.yaw + 0.5, fire: Math.floor((performance.now() - t0) / 700) % 3 === 0 });
  const wander = (k) => (s) => ({ mode: MODE_DIR, dir: k + Math.sin(performance.now() / 900 + k) * 2, mag: 0.8, aim: s.yaw, fire: false });
  const inputs = [circle, wander(1), wander(2), wander(3)];
  // warm-up (lets interpolation delay settle)
  await frameLoop(all, (dt) => all.forEach((c, i) => c.update(dt, inputs[i], true)), 1500);

  const samples = []; let prev = null;
  let snapsPS = [], corr0 = A.st.corrections, maxCorr = 0;
  await frameLoop(all, (dt) => {
    all.forEach((c, i) => c.update(dt, inputs[i], true));
    const p = B.remotePose(A.myId);
    if (p && p.alive && prev && prev.alive) {
      const d = Math.hypot(p.x - prev.x, p.z - prev.z);
      const S = B.snaps, rt = B.renderTime; let i = S.length - 1; while (i > 0 && S[i].time > rt) i--;
      samples.push({ d, dt, v: Math.abs(p.v), extrap: p.extrap > 0, rt, s0: S[i] && S[i].time, s1: S[i + 1] && S[i + 1].time, prt: prev.rt, gap: S[i+1] ? S[i+1].time - S[i].time : -1 });
    }
    if (p) p.rt = B.renderTime;
    prev = p; maxCorr = Math.max(maxCorr, A.st.corrLast);
  }, seconds * 1000);
  snapsPS = B.st.snapsPS;
  // Server-side motion check: did A's authoritative position advance every tick?
  let rawStalls = 0, rawJumps = 0, rawN = 0;
  for (let i = 1; i < B.snaps.length; i++) {
    const a = B.snaps[i - 1].tanks.get(A.myId), b = B.snaps[i].tanks.get(A.myId);
    if (!a || !b || !a.alive || !b.alive || Math.abs(b.v) < 2) continue;
    const ticks = b.time && a.time ? Math.round((B.snaps[i].time - B.snaps[i - 1].time) / (1000 / 30)) : 1;
    const d = Math.hypot(b.x - a.x, b.z - a.z), e = Math.abs(b.v) / 30 * ticks; rawN++;
    if (d < e * 0.3) rawStalls++; if (d > e * 1.7) rawJumps++;
  }

  // Analysis: displacement per frame vs. what the speed implies
  let stalls = 0, jumps = 0, moving = 0, extrap = 0;
  for (const s of samples) {
    const expect = s.v * s.dt / 1000;
    if (expect < 0.02) continue;                       // not moving
    moving++;
    if (s.d < expect * 0.2) { stalls++; if (process.env.DUMP) console.log('STALL', JSON.stringify({d:+s.d.toFixed(3),exp:+expect.toFixed(3),dt:+s.dt.toFixed(1),drt:+(s.rt-s.prt).toFixed(1),gap:s.gap,intoSeg:+(s.rt-s.s0).toFixed(1)})); }
    if (s.d > expect * 2.5 + 0.05) jumps++;
    if (s.extrap) extrap++;
  }
  const res = {
    profile: `${pingMs} ms ping, ±${jitterMs} ms jitter`,
    frames: samples.length, movingFrames: moving,
    stalls, jumps, extrapolatedFrames: extrap, serverTicksChecked: rawN, serverStalls: rawStalls, serverJumps: rawJumps,
    snapshotsPerSec: +snapsPS.toFixed(1), interpDelayMs: Math.round(B.interpDelay),
    measuredRttMs: Math.round(B.st.rttAvg), localCorrections: A.st.corrections - corr0, maxCorrectionM: +maxCorr.toFixed(3),
    downKBps: +(B.st.bytesInPS / 1024).toFixed(2), upKBps: +(A.st.bytesOutPS / 1024).toFixed(2),
  };
  res.pass = moving > 150 && stalls / moving < 0.01 && jumps / moving < 0.01;
  all.forEach(c => c.leave());
  await sleep(200);
  return res;
}

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', (d) => { if (String(d).includes('server on')) r(); }));
const args = process.argv.slice(2).map(Number);
const profiles = args.length ? [[args[0], args[1] || 0]] : [[0, 0], [20, 5], [50, 10], [100, 20], [150, 30], [100, 60]];
let ok = true;
for (const [p, j] of profiles) {
  const r = await runProfile(p, j);
  ok = ok && r.pass;
  console.log(JSON.stringify(r));
}
srv.kill();
console.log(ok ? 'ALL PROFILES PASSED' : 'SOME PROFILES FAILED');
process.exit(ok ? 0 : 1);
