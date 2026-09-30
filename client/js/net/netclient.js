/* =====================================================================
   NetClient — everything between the socket and the game renderer.

   ┌─ LOCAL PLAYER (client-side prediction + reconciliation) ───────────┐
   │ Every fixed tick (1/30 s) we sample the controls, send them to the │
   │ server AND immediately run the same shared simulateInput() locally,│
   │ so your tank reacts on the very next frame. Each input has a       │
   │ sequence number. Snapshots tell us the last input the server       │
   │ applied ("ack"); we reset to the server's state, replay the inputs │
   │ it hasn't seen yet, and blend any small difference out over ~60 ms │
   │ so corrections are invisible.                                      │
   └────────────────────────────────────────────────────────────────────┘
   ┌─ REMOTE TANKS (snapshot buffer + interpolation) ───────────────────┐
   │ Snapshots are stored in a buffer with their server timestamps. We  │
   │ render other tanks at  renderTime = serverNow − interpDelay         │
   │ (~100 ms) and blend between the two snapshots around that time on  │
   │ EVERY rendered frame. Movement is therefore continuous at 60 fps   │
   │ even though snapshots arrive 30×/s. If snapshots are late we       │
   │ extrapolate briefly, then hold — the game never freezes.           │
   └────────────────────────────────────────────────────────────────────┘
   Pure logic: no DOM, no Three.js (runs in Node for tests and bots).
   ===================================================================== */
import { NET, GAME } from '../../shared/config.js';
import { getMap } from '../../shared/maps.js';
import { newTankState, copyState, simulateInput, muzzleOf } from '../../shared/sim.js';
import { TANKS } from '../../shared/tanks.js';
import { encodeInput, quantizeInput, decodeSnapshot, MSG_SNAPSHOT } from '../../shared/protocol.js';
import { attachFx, abilityOf, lvl, wallCols, abNeed, abAim, abRange } from '../../shared/abilities.js';
import { lerp, lerpAngle, dist, wrapAngle } from '../../shared/math.js';
import { Connection } from './connection.js';

const DT = 1 / NET.TICK_RATE;
const TICK_MS = 1000 / NET.TICK_RATE;
const now = () => performance.now();

export class NetClient {
  constructor(opts) {
    this.openTransport = opts.openTransport;    // () => WebSocket-like
    this.name = opts.name; this.token = opts.token;
    this.h = opts.handlers || {};               // onRoom, onEvent, onStatus, onError, onWelcome
    this.conn = null; this.status = 'idle';     // idle | connecting | online | reconnecting | offline
    this.myId = 0; this.code = null; this.room = null; this.map = getMap('desert'); this.mapId = 'desert';
    this.reconnectTries = 0; this.wantOnline = false;
    // snapshots / clock
    this.snaps = []; this.latest = null;
    this.clockInit = false; this.offset = 0; this.offWin = []; this.excess = 0;
    this.interpDelay = NET.INTERP_DELAY_MS; this.renderTime = 0; this.renderInit = false;
    this.events = [];                           // scheduled on the render timeline
    // prediction
    this.seq = 0; this.history = []; this.acc = 0;
    this.me = newTankState(); this.prev = newTankState(); this.meAlive = false; this.meHp = GAME.HP; this.meMaxHp = GAME.HP;
    this.corr = { x: 0, z: 0, yaw: 0 };
    this.pendingShots = new Map();              // seq → predicted shot
    // my tank's special power: which one, how upgraded, how full its bar is, and whether it is
    // picked up and waiting for me to choose a spot
    this.ab = { id: null, l: 0, chg: 0, need: 1, armed: false };
    this.caged = 0;                             // ms timestamp the freeze cage opens again
    this.cloakUntil = 0;
    // stats
    this.st = { snaps: 0, snapsPS: 0, rtt: 0, rttAvg: 0, jitter: 0, corrections: 0, corrLast: 0, bytesInPS: 0, bytesOutPS: 0, snapAge: 0, bufferDepth: 0, lastIn: 0, lastOut: 0, extrap: 0 };
    this.statT = now(); this.pingT = 0;
  }

  /* ---------------- connection lifecycle ---------------- */
  connect(action, code, extra = {}) {
    this.wantOnline = true; this.action = action; this.code = code; this.extra = extra;
    this.open();
  }
  open() {
    this.setStatus(this.reconnectTries ? 'reconnecting' : 'connecting');
    this.conn = new Connection(this.openTransport, {
      onOpen: () => {
        this.conn.send(JSON.stringify({ t: 'hello', v: 1, name: this.name, token: this.token, action: this.action, code: this.code, ...this.extra }));
      },
      onMessage: (d) => this.onMessage(d),
      onClose: () => {
        if (!this.wantOnline) { this.setStatus('offline'); return; }
        this.reconnectTries++;
        if (this.reconnectTries > 12) { this.setStatus('offline'); this.h.onError && this.h.onError('Lost connection to the server.', 'lost'); return; }
        this.setStatus('reconnecting');
        setTimeout(() => { if (this.wantOnline) this.open(); }, Math.min(4000, 500 * this.reconnectTries));
      },
    });
  }
  leave() { this.wantOnline = false; if (this.conn) { this.conn.send(JSON.stringify({ t: 'leave' })); this.conn.close(); } this.setStatus('offline'); }
  setStatus(s) { this.status = s; this.h.onStatus && this.h.onStatus(s); }
  sendJSON(o) { if (this.conn) this.conn.send(JSON.stringify(o)); }

  onMessage(d) {
    if (typeof d !== 'string') {
      const u8 = new Uint8Array(d);
      if (u8[0] === MSG_SNAPSHOT) this.onSnapshot(decodeSnapshot(d));
      return;
    }
    let m; try { m = JSON.parse(d); } catch (e) { return; }
    switch (m.t) {
      case 'welcome':
        this.myId = m.id; this.code = m.code; this.action = 'join'; this.reconnectTries = 0;
        this.setMap(m.map);
        this.mapMismatch = this.map.checksum !== m.checksum;
        this.serverTick = m.tickRate; this.snapEvery = m.snapEvery;
        this.setStatus('online');
        this.h.onWelcome && this.h.onWelcome(m);
        break;
      case 'room':
        this.room = m; if (m.map !== this.mapId) this.setMap(m.map);
        // Props already broken (e.g. we joined mid-match): remove them quietly.
        if (m.broken && m.broken.length) { const d = this.deadArr(); for (const i of m.broken) if (!d[i]) { d[i] = 1; this.h.onEvent && this.h.onEvent({ t: 'brk', i, o: this.map.colliders[i] && this.map.colliders[i].o, silent: true }); } }
        this.h.onRoom && this.h.onRoom(m);
        break;
      case 'pong': { const rtt = now() - m.c; this.st.rtt = rtt; this.st.rttAvg = this.st.rttAvg ? lerp(this.st.rttAvg, rtt, 0.2) : rtt; break; }
      case 'error': this.wantOnline = false; this.h.onError && this.h.onError(m.msg, m.code); this.conn.close(); break;
      case 'start': this.resetMatch(); this.setMap(m.map); this.map.dead = new Uint8Array(this.map.colliders.length); this.h.onEvent && this.h.onEvent(m); break;
      case 'brk': this.deadArr()[m.i] = 1; this.schedule(m); break;
      case 'shot':
        if (m.o === this.myId) {                 // our own shot: confirm the predicted shell right away
          const p = this.pendingShots.get(m.seq); this.pendingShots.delete(m.seq);
          this.h.onEvent && this.h.onEvent({ ...m, own: true, pred: p || null });
        } else this.schedule(m);
        break;
      case 'hit':
        if (m.o === this.myId || m.v === this.myId) { if (m.v === this.myId) this.meHp = Math.max(0, this.meHp - m.dmg); this.h.onEvent && this.h.onEvent({ ...m, now: true }); }
        this.schedule(m);
        break;
      case 'kill':
        if (m.v === this.myId) { this.meAlive = false; this.h.onEvent && this.h.onEvent({ ...m, now: true }); }
        this.schedule(m);
        break;
      case 'rk': case 'ms': case 'ae': case 'carBoom': this.schedule(m); break;   // carBoom = a suicide car went off
      case 'fx': this.applyFx(m); this.h.onEvent && this.h.onEvent(m); break;
      case 'ab': this.onAbility(m); break;
      case 'abNo': this.h.onEvent && this.h.onEvent(m); break;
      case 'heal': if (m.v === this.myId) this.meHp = Math.min(this.meMaxHp, this.meHp + (m.n || 0)); this.schedule(m); break;
      case 'abc': this.ab.chg = m.v; if (m.need) this.ab.need = m.need; break;     // how full the power bar is
      case 'abReady': this.h.onEvent && this.h.onEvent(m); break;
      case 'mh': if (m.id === this.myId) this.meMaxHp = m.mh; this.h.onEvent && this.h.onEvent(m); break;
      case 'spawn':
        if (m.id === this.myId) { this.me = newTankState(m.x, m.z, m.yaw, m.c, m.rl, m.sm); this.me.tm = m.tm || ''; this.ab = { id: m.ab || abilityOf(m.c), l: m.al || 0, chg: m.chg || 0, need: m.need || abNeed(m.ab || abilityOf(m.c), m.al || 0), armed: false }; this.caged = 0; this.cloakUntil = 0; this.meShot = { spd: m.ss, max: m.rg }; this.me.shield = GAME.SPAWN_SHIELD_S; copyState(this.prev, this.me); this.meAlive = true; this.meMaxHp = m.mh || GAME.HP; this.meHp = this.meMaxHp; this.history = []; this.corr = { x: 0, z: 0, yaw: 0 }; }
        this.h.onEvent && this.h.onEvent({ ...m, now: true });
        break;
      default: this.h.onEvent && this.h.onEvent(m);
    }
  }
  /** Walls / domes / black holes now standing, so local prediction feels them too. */
  applyFx(m) {
    const fx = this.map.fx || attachFx(this.map);
    fx.walls.length = 0; fx.domes.length = 0; fx.holes.length = 0;
    for (const w of m.w || []) { const o = { ...w }; o.cols = wallCols(o); fx.walls.push(o); }
    for (const d of m.d || []) fx.domes.push({ ...d });
    for (const h of m.h || []) fx.holes.push({ ...h });
  }
  onAbility(m) {
    if (m.k === 'caged' && m.id === this.myId) { this.caged = performance.now() + (m.s || 2.5) * 1000; this.me.froz = m.s || 2.5; }
    if (m.k === 'uncloak' && m.id === this.myId) this.cloakUntil = 0;
    if (m.id === this.myId && m.k === 'cloak') this.cloakUntil = performance.now() + (this.abLife() * 1000);
    if (m.id === this.myId && ABILITY_KEYS.has(m.k)) { this.ab.armed = false; this.ab.chg = 0; }
    this.h.onEvent && this.h.onEvent({ ...m, now: true });
  }
  abLife() { return this.ab.id ? lvl(this.ab.id, 'life', this.ab.l) : 0; }
  /** Is the power charged up and usable? */
  abReady() { return !!this.ab.id && this.ab.chg >= this.ab.need && this.meAlive && !this.isCaged(); }
  abKind() { return this.ab.id ? abAim(this.ab.id) : 'self'; }
  abReach() { return this.ab.id ? abRange(this.ab.id) : 0; }
  /** Kept for callers that used to arm the power; holding the power control is what aims it now. */
  armAbility() { return this.abReady(); }
  cancelAbility() { this.ab.armed = false; }
  /** True while a freeze cage is holding us. */
  isCaged() { return this.caged > performance.now(); }
  deadArr() { if (!this.map.dead || this.map.dead.length !== this.map.colliders.length) this.map.dead = new Uint8Array(this.map.colliders.length); return this.map.dead; }
  setMap(id) { if (id && id !== this.mapId) { this.mapId = id; this.map = getMap(id); } if (!this.map.fx) attachFx(this.map); }
  resetMatch() { this.snaps = []; this.events = []; this.history = []; this.meAlive = false; this.pendingShots.clear();
    attachFx(this.map); this.caged = 0; this.cloakUntil = 0; this.ab = { id: null, l: 0, chg: 0, need: 1, armed: false }; }
  schedule(m) { this.events.push(m); }

  /* ---------------- snapshots, clock, reconciliation ---------------- */
  onSnapshot(s) {
    const arrival = now();
    this.st.snaps++;
    // --- clock sync: offset = local − server. The smallest recent sample is the
    // least-delayed packet; everything above it is jitter.
    const sample = arrival - s.time;
    this.offWin.push([arrival, sample]);
    while (this.offWin.length && arrival - this.offWin[0][0] > 3000) this.offWin.shift();
    let mn = Infinity, mx = -Infinity; for (const w of this.offWin) { if (w[1] < mn) mn = w[1]; if (w[1] > mx) mx = w[1]; }
    if (!this.clockInit) { this.offset = mn; this.clockInit = true; }
    else this.offset = lerp(this.offset, mn, 0.05);
    this.excess = mx - mn;                         // worst recent jitter
    this.st.jitter = this.excess;
    // Interpolation delay grows with jitter so we always have a snapshot pair.
    const snapMs = TICK_MS * (this.snapEvery || NET.SNAPSHOT_EVERY);
    this.targetDelay = Math.min(NET.INTERP_DELAY_MAX_MS, Math.max(NET.INTERP_DELAY_MS, snapMs * 1.5 + this.excess + 10));

    this.snaps.push(s); this.latest = s;
    const cut = (this.renderTime || s.time) - 1500;
    while (this.snaps.length > 3 && this.snaps[0].time < cut) this.snaps.shift();
    if (this.snaps.length > 120) this.snaps.shift();

    // --- reconcile our own tank
    const me = s.tanks.get(this.myId);
    if (!me) return;
    me.cls = this.me.cls; me.rl = this.me.rl; me.sm = this.me.sm;   // snapshots don't repeat the tank type / upgrades
    this.meHp = me.hp * this.meMaxHp / 100; this.meOneShot = me.oneShot;
    if (!me.alive) { this.meAlive = false; this.history = this.history.filter(h => h.seq > s.ack); return; }
    const others = this.othersFrom(s);
    if (!this.meAlive) {                           // (re)spawned: take the server state as-is
      this.meAlive = true; copyState(this.me, me); this.me.reload = me.reload; this.me.shield = me.shield;
      this.history = this.history.filter(h => h.seq > s.ack);
      for (const h of this.history) simulateInput(this.me, h.inp, DT, this.map, others);
      copyState(this.prev, this.me); this.corr = { x: 0, z: 0, yaw: 0 };
      return;
    }
    this.history = this.history.filter(h => h.seq > s.ack);
    const was = { x: this.me.x, z: this.me.z, yaw: this.me.yaw };
    const r = newTankState(); copyState(r, me);
    for (const h of this.history) simulateInput(r, h.inp, DT, this.map, others);
    const ex = was.x - r.x, ez = was.z - r.z, ey = wrapAngle(was.yaw - r.yaw);
    const err = Math.sqrt(ex * ex + ez * ez);
    if (err > 0.02 || Math.abs(ey) > 0.01) { this.st.corrections++; this.st.corrLast = err; }
    if (err > NET.SNAP_DISTANCE) { this.corr = { x: 0, z: 0, yaw: 0 }; copyState(this.prev, r); }
    else {
      // keep the tank visually where it was and fade the difference out
      this.corr.x += ex; this.corr.z += ez; this.corr.yaw += ey;
      this.prev.x -= ex; this.prev.z -= ez; this.prev.yaw -= ey;
    }
    copyState(this.me, r);
  }
  othersFrom(s) {
    const out = [];
    if (s) for (const t of s.tanks.values()) if (t.id !== this.myId && t.alive) out.push(t);
    return out;
  }

  /* ---------------- per-frame update ----------------
     getInput() returns the raw controls {mode, dir, mag, throttle, steer, aim, fire}.
     Returns info the renderer needs. */
  update(dtMs, getInput, playing) {
    const t = now();
    // ---- 1. fixed-rate input + local prediction
    this.acc += dtMs;
    let steps = 0;
    const fired = [];
    if (this.acc > TICK_MS * 6) this.acc = TICK_MS * 2;  // tab was asleep: don't burst
    while (this.acc >= TICK_MS && steps < 4) {
      this.acc -= TICK_MS; steps++;
      if (this.status !== 'online' || !playing) continue;
      const raw = getInput(this.me);
      if (this.isCaged()) { raw.mag = 0; raw.throttle = 0; raw.steer = 0; raw.fire = false; raw.abFire = false; raw.abHold = false; raw.aim = this.me.t; }
      // flying a guided shell: the stick steers the shell, so our own tank holds still
      const steerShell = !!this.flying;
      // ---- the power, on its own control: hold to aim it, let go to use it.
      // The trigger is never consulted, and neither is the gun's reload — the power is charged by
      // the damage you have already dealt, and a loaded cannon is not a condition of spending it.
      raw.ab = false;
      this.ab.armed = !!raw.abHold && this.abReady();      // only a preview: it shows you the spot
      if (raw.abFire && this.abReady()) { raw.ab = true; this.ab.armed = false; }
      raw.seq = ++this.seq;
      const inp = quantizeInput(raw);
      this.conn.send(encodeInput(raw));
      this.history.push({ seq: inp.seq, inp });
      if (this.history.length > 90) this.history.shift();
      if (this.meAlive) {
        copyState(this.prev, this.me);
        const sim = steerShell ? { ...inp, mag: 0, throttle: 0, steer: 0 } : inp;
        if (simulateInput(this.me, sim, DT, this.map, this.othersFrom(this.latest))) {
          const m = muzzleOf(this.me), T = TANKS[this.me.cls] || TANKS.zagros, n = T.spread || 1;
          for (let k = 0; k < n; k++) {
            const ms = this.meShot || {};
            const shot = { seq: inp.seq, k, x: m.x, z: m.z, a: this.me.t + (n > 1 ? (k - (n - 1) / 2) * 0.13 : 0), at: t, big: !!this.meOneShot && k === (n - 1) >> 1, spd: ms.spd || T.shellSpeed, max: ms.max || T.range };
            if (k === 0) this.pendingShots.set(inp.seq, shot); fired.push(shot);
          }
          this.meOneShot = false;
          if (this.pendingShots.size > 20) this.pendingShots.delete(this.pendingShots.keys().next().value);
        }
      }
    }
    if (this.caged && !this.isCaged()) { this.caged = 0; this.me.froz = 0; }
    // correction offset decays with a half-life (smooth, frame-rate independent)
    const k = Math.pow(0.5, dtMs / NET.CORRECTION_HALF_LIFE_MS);
    this.corr.x *= k; this.corr.z *= k; this.corr.yaw *= k;

    // ---- 2. render clock for remote tanks
    if (this.clockInit) {
      // Delay changes are applied gently so the render clock never jumps.
      const td = this.targetDelay || NET.INTERP_DELAY_MS;
      this.interpDelay += Math.max(-0.02 * dtMs, Math.min(0.06 * dtMs, (td - this.interpDelay) * (td > this.interpDelay ? 0.05 : 0.01)));
      const target = t - this.offset - this.interpDelay;
      if (!this.renderInit || Math.abs(target - this.renderTime) > 400) { this.renderTime = target; this.renderInit = true; }
      else {
        // Time-scale by at most ±10% to converge on the target: remote tanks may
        // move 10% slower/faster for a moment, but never stop or jump.
        const adj = Math.max(-0.1 * dtMs, Math.min(0.1 * dtMs, (target - this.renderTime) * (dtMs / 250)));
        this.renderTime += dtMs + adj;
      }
    }
    // ---- 3. due events (remote shots, hits, kills) on the render timeline
    const due = [];
    if (this.events.length) {
      this.events.sort((a, b) => a.st - b.st);
      while (this.events.length && this.events[0].st <= this.renderTime) due.push(this.events.shift());
      if (this.events.length > 200) due.push(...this.events.splice(0, this.events.length - 200));
    }
    // ---- 4. stats + ping
    if (t - this.statT >= 1000) {
      const sec = (t - this.statT) / 1000; this.statT = t;
      this.st.snapsPS = this.st.snaps / sec; this.st.snaps = 0;
      if (this.conn) {
        this.st.bytesInPS = (this.conn.stats.bytesIn - this.st.lastIn) / sec; this.st.lastIn = this.conn.stats.bytesIn;
        this.st.bytesOutPS = (this.conn.stats.bytesOut - this.st.lastOut) / sec; this.st.lastOut = this.conn.stats.bytesOut;
      }
    }
    if (this.status === 'online' && t - this.pingT > NET.PING_INTERVAL_MS) { this.pingT = t; this.sendJSON({ t: 'ping', c: t, rtt: Math.round(this.st.rttAvg) }); }
    if (this.latest) this.st.snapAge = (t - this.offset) - this.latest.time;
    this.st.bufferDepth = this.snaps.filter(s => s.time > this.renderTime).length;
    return { alpha: this.acc / TICK_MS, fired, due };
  }

  /** Local tank pose for rendering (interpolated between fixed steps + smoothed corrections). */
  localPose(alpha) {
    const a = this.prev, b = this.me;
    return { x: lerp(a.x, b.x, alpha) + this.corr.x, z: lerp(a.z, b.z, alpha) + this.corr.z,
      yaw: lerpAngle(a.yaw, b.yaw, alpha) + this.corr.yaw, t: lerpAngle(a.t, b.t, alpha), v: b.v, reload: b.reload, shield: b.shield, armor: b.armor, boost: b.boost, oneShot: !!this.meOneShot };
  }

  /** Remote tank pose at the current render time (interpolated / briefly extrapolated). */
  remotePose(id) {
    const S = this.snaps, rt = this.renderTime;
    if (!S.length) return null;
    let i = S.length - 1;
    while (i > 0 && S[i].time > rt) i--;
    const s0 = S[i], s1 = S[i + 1];
    const a = s0.tanks.get(id);
    if (!a) { const b = s1 && s1.tanks.get(id); return b && rt >= s1.time ? { ...b } : null; }
    if (rt < s0.time) return { ...a };                                 // older than our buffer
    if (s1) {
      const b = s1.tanks.get(id);
      if (!b || a.alive !== b.alive || dist(a.x, a.z, b.x, b.z) > 8) return { ...a }; // death/respawn: no sliding
      const f = (rt - s0.time) / (s1.time - s0.time);
      return { id, alive: a.alive, hp: b.hp, shield: b.shield, armor: b.armor, boost: b.boost, oneShot: b.oneShot, cloak: b.cloak, froz: b.froz, v: lerp(a.v, b.v, f),
        x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), yaw: lerpAngle(a.yaw, b.yaw, f), t: lerpAngle(a.t, b.t, f), extrap: 0 };
    }
    // Past the newest snapshot (late packet): extrapolate a little, then hold.
    const ex = Math.min(rt - s0.time, NET.EXTRAPOLATE_MAX_MS) / 1000;
    this.st.extrap = rt - s0.time;
    const yaw = a.yaw + a.w * ex;
    return { id, alive: a.alive, hp: a.hp, shield: a.shield, armor: a.armor, boost: a.boost, oneShot: a.oneShot, cloak: a.cloak, froz: a.froz, v: a.v, x: a.x + Math.sin(yaw) * a.v * ex, z: a.z + Math.cos(yaw) * a.v * ex, yaw, t: a.t, extrap: ex };
  }
  remoteIds() { return this.latest ? [...this.latest.tanks.keys()].filter(id => id !== this.myId) : []; }
}

const ABILITY_KEYS = new Set(['wall', 'dome', 'hole', 'cloak', 'homing', 'drone', 'heal', 'freeze']);
