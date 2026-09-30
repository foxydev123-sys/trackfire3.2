/* =====================================================================
   Connection — thin wrapper over a WebSocket (or the practice-mode
   worker) that adds:
     • an optional LATENCY SIMULATOR (one-way delay + jitter, both
       directions, order-preserving like real TCP) for testing, and
     • byte / message counters for the debug panel.
   Works in browsers and in Node 22+ (global WebSocket).
   ===================================================================== */
const now = () => performance.now();

export const LAT_SIM = { oneWay: 0, jitter: 0 }; // shared, edited from the debug panel

export class Connection {
  /**
   * @param open    () => transport   (a WebSocket-like object)
   * @param handlers {onOpen, onMessage(data: string|ArrayBuffer), onClose(code)}
   */
  constructor(open, handlers) {
    this.h = handlers;
    this.stats = { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };
    this.outChain = 0; this.inChain = 0;
    this.closed = false;
    const t = open();
    this.t = t;
    if ('binaryType' in t) t.binaryType = 'arraybuffer';
    t.onopen = () => this.h.onOpen && this.h.onOpen();
    t.onmessage = (e) => this.receive(e.data);
    t.onclose = (e) => { if (!this.closed) { this.closed = true; this.h.onClose && this.h.onClose(e && e.code); } };
    t.onerror = () => {};
  }
  delay() { return LAT_SIM.oneWay + (LAT_SIM.jitter ? Math.random() * LAT_SIM.jitter : 0); }
  receive(data) {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    this.stats.bytesIn += size + 2; this.stats.msgsIn++;
    if (LAT_SIM.oneWay || LAT_SIM.jitter) {
      const at = Math.max(now() + this.delay(), this.inChain); this.inChain = at;
      setTimeout(() => { if (!this.closed) this.h.onMessage(data); }, at - now());
    } else this.h.onMessage(data);
  }
  send(data) {
    if (this.closed) return;
    const size = typeof data === 'string' ? data.length : data.byteLength;
    this.stats.bytesOut += size + 6; this.stats.msgsOut++;
    if (LAT_SIM.oneWay || LAT_SIM.jitter) {
      const at = Math.max(now() + this.delay(), this.outChain); this.outChain = at;
      setTimeout(() => this.raw(data), at - now());
    } else this.raw(data);
  }
  raw(data) { try { if (this.t.readyState === 1) this.t.send(data); } catch (e) {} }
  close() { this.closed = true; try { this.t.close(); } catch (e) {} }
}

/* Practice mode: the whole server Room runs inside a Web Worker and
   talks through postMessage, so the game code can't tell the difference. */
export function workerTransport(worker) {
  const t = { readyState: 0, binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, onerror: null };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.open) { t.readyState = 1; t.onopen && t.onopen(); return; }
    if (m.close) { t.readyState = 3; t.onclose && t.onclose({ code: 1000 }); return; }
    t.onmessage && t.onmessage({ data: m.d });
  };
  t.send = (d) => worker.postMessage({ d });
  t.close = () => { t.readyState = 3; worker.terminate(); t.onclose && t.onclose({ code: 1000 }); };
  worker.postMessage({ connect: true });
  return t;
}
