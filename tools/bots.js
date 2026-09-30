/* =====================================================================
   Headless test players (Node 22+). Each bot is a full network client —
   same protocol, prediction and interpolation as a browser — so you can
   fill a room with "real" remote players and watch them from your browser.

     node tools/bots.js <ROOMCODE> [count=4] [server=ws://localhost:8080/ws] [pingMs=0] [jitterMs=0]

   Example: open the game, create a room (e.g. F7K2Q), then run
     node tools/bots.js F7K2Q 5
   ===================================================================== */
import { NetClient } from '../client/js/net/netclient.js';
import { LAT_SIM } from '../client/js/net/connection.js';
import { BotBrain } from '../client/shared/bot.js';

const [code, countArg, urlArg, pingArg, jitArg] = process.argv.slice(2);
if (!code) { console.log('usage: node tools/bots.js <ROOMCODE> [count] [ws-url] [pingMs] [jitterMs]'); process.exit(1); }
const count = Number(countArg) || 4;
const url = urlArg || 'ws://localhost:8080/ws';
LAT_SIM.oneWay = (Number(pingArg) || 0) / 2; LAT_SIM.jitter = Number(jitArg) || 0;
const NAMES = ['Rashid', 'Kaz', 'Mo_7', 'Lina', 'Yousef', 'Tariq', 'Noor', 'Sami'];

const bots = [];
for (let i = 0; i < count; i++) {
  const b = { brain: null, room: null };
  b.c = new NetClient({ name: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''), token: 'bot' + i + Math.random(),
    openTransport: () => new WebSocket(url),
    handlers: { onRoom: (r) => { b.room = r; }, onError: (m) => console.log('bot', i, 'error:', m), onStatus: (s) => s === 'online' && console.log('bot', i, 'online') } });
  b.c.connect('join', code.toUpperCase());
  bots.push(b);
}
let last = performance.now();
setInterval(() => {
  const t = performance.now(), dt = t - last; last = t;
  for (const b of bots) {
    const c = b.c;
    if (!b.brain || b.brain.map !== c.map) b.brain = new BotBrain(c.map, Math.floor(Math.random() * 1e6));
    const playing = b.room && b.room.state === 'playing';
    c.update(dt, (me) => {
      const foes = [];
      for (const id of c.remoteIds()) {
        const p = c.remotePose(id); const info = b.room.players.find(x => x.id === id); const mine = b.room.players.find(x => x.id === c.myId);
        if (p && p.alive && info && mine && (info.team === 'ffa' || info.team !== mine.team)) foes.push(p);
      }
      return b.brain.think(me, foes, 1 / 30);
    }, playing);
  }
}, 16);
setInterval(() => {
  const b = bots[0];
  if (b && b.c.status === 'online') console.log(`room ${b.c.code} · ${b.room?.state} · rtt ${Math.round(b.c.st.rttAvg)} ms · snapshots ${b.c.st.snapsPS.toFixed(0)}/s · interp ${Math.round(b.c.interpDelay)} ms`);
}, 5000);
