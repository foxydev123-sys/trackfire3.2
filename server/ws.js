/* =====================================================================
   Minimal, dependency-free WebSocket server (RFC 6455).
   Supports text + binary frames, fragmentation, ping/pong, close.
   No compression on purpose: our packets are tiny and compression adds
   latency. TCP_NODELAY is switched on so small packets leave immediately
   (Nagle's algorithm would otherwise batch them and add delay).
   ===================================================================== */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

export class WSConn extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket; this.req = req;
    this.buf = Buffer.alloc(0);
    this.frag = null; this.fragOp = 0;
    this.open = true; this.alive = true;
    this.bytesIn = 0; this.bytesOut = 0;
    this.sendDelay = 0;          // artificial latency for testing (ms)
    this.sendChain = 0;
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    socket.on('end', () => this.finish());
  }
  finish() { if (!this.open) return; this.open = false; try { this.socket.destroy(); } catch (e) {} this.emit('close'); }
  onData(chunk) {
    this.bytesIn += chunk.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (!masked) return this.close(1002);            // browsers always mask
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4); off += 4;
      const payload = Buffer.from(b.subarray(off, off + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);
      if (op >= 0x8) {                                   // control frames
        if (op === 0x8) { this.close(1000); return; }
        if (op === 0x9) this.writeFrame(0xA, payload);
        if (op === 0xA) this.alive = true;
        continue;
      }
      if (op === 0x0) { if (!this.frag) return this.close(1002); this.frag.push(payload); }
      else { this.frag = [payload]; this.fragOp = op; }
      if (this.frag.reduce((a, p) => a + p.length, 0) > MAX_MESSAGE) return this.close(1009);
      if (fin) {
        const data = this.frag.length === 1 ? this.frag[0] : Buffer.concat(this.frag);
        const isBinary = this.fragOp === 0x2; this.frag = null;
        this.alive = true;
        this.emit('message', isBinary ? data : data.toString('utf8'), isBinary);
      }
    }
  }
  writeFrame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let hdr;
    if (len < 126) { hdr = Buffer.alloc(2); hdr[1] = len; }
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
    else { hdr = Buffer.alloc(10); hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
    hdr[0] = 0x80 | op;
    const frame = Buffer.concat([hdr, payload]);
    this.bytesOut += frame.length;
    if (this.sendDelay > 0) {
      // keep ordering: each delayed packet leaves no earlier than the previous one
      const at = Math.max(Date.now() + this.sendDelay, this.sendChain); this.sendChain = at;
      setTimeout(() => { if (this.open) this.socket.write(frame); }, at - Date.now());
    } else this.socket.write(frame);
  }
  send(data) {
    if (typeof data === 'string') this.writeFrame(0x1, Buffer.from(data, 'utf8'));
    else if (data instanceof ArrayBuffer) this.writeFrame(0x2, Buffer.from(data));
    else this.writeFrame(0x2, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  ping() { this.writeFrame(0x9, Buffer.alloc(0)); }
  congested() { return this.socket.writableLength > 96 * 1024; }
  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    try { this.writeFrame(0x8, p); this.socket.end(); } catch (e) {}
    setTimeout(() => this.finish(), 500);
  }
}

/** routes: { '/ws': (ws, req) => …, '/hub': … } — one upgrade handler for all paths. */
export function attachWebSocket(server, routes) {
  const conns = new Set();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    const onConnection = routes[url.pathname];
    if (!onConnection || !key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 20000);
    const ws = new WSConn(socket, req);
    conns.add(ws); ws.on('close', () => conns.delete(ws));
    onConnection(ws, req);
    if (head && head.length) ws.onData(head);
  });
  // Heartbeat: drop connections that stopped answering (e.g. phone went to sleep).
  setInterval(() => {
    for (const c of conns) { if (!c.alive) { c.finish(); continue; } c.alive = false; c.ping(); }
  }, 15000).unref();
}
