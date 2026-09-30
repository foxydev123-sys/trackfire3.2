/* Practice mode: runs the real server Room (same code as the Node server)
   inside a Web Worker, with bots. No internet or server needed. */
import { Room } from '../shared/room.js';
import { NET } from '../shared/config.js';

let room = null, player = null;
const conn = {
  send(d) {
    if (typeof d === 'string') postMessage({ d });
    else { const b = d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength); postMessage({ d: b }, [b]); }
  },
  close() {}, congested() { return false; },
};

self.onmessage = (e) => {
  const m = e.data;
  if (m.connect) {
    room = new Room('SOLO', { now: () => performance.now(), kind: 'practice', loadGate: true });
    postMessage({ open: true });
    const TICK = 1000 / NET.TICK_RATE; let next = performance.now();
    const loop = () => { const t = performance.now(); let n = 0; while (t >= next && n < 5) { room.update(); next += TICK; n++; } if (t - next > 500) next = t; setTimeout(loop, Math.max(0, next - performance.now())); };
    loop();
    return;
  }
  const d = m.d;
  if (!player) {
    if (typeof d !== 'string') return;
    const h = JSON.parse(d); if (h.t !== 'hello') return;
    player = room.join(conn, h.name, h.token, null, h.tank);
    if (h.map) room.onJSON(player, { t: 'map', map: h.map });
    if (h.mode) room.onJSON(player, { t: 'mode', mode: h.mode });
    return;
  }
  if (typeof d === 'string') room.onJSON(player, JSON.parse(d));
  else room.onBinary(player, new Uint8Array(d));
};
