/* =====================================================================
   ROOM — one match. Transport-agnostic: the Node server plugs real
   WebSockets in, practice mode plugs a Web Worker in. A "conn" is
   anything with send(stringOrBytes), close() and optional congested().

   The room is SERVER-AUTHORITATIVE: clients only send inputs (move
   direction, aim angle, fire button). The room moves tanks, fires shells,
   decides hits, damage, kills, flags, zones, rounds and respawns.

   Kinds:  private  – a code room with a host who picks map/mode, adds bots
           practice – the same, offline in a Web Worker
           quick    – public matchmaking: starts by itself, bots fill gaps
           ranked   – reserved seats for matched accounts, fixed teams,
                      Last Tank Standing, closes after the match
   Modes:  tdm · ffa · ctf · koh · lts · rush   (see GAME.MODES)
   ===================================================================== */
import { NET, GAME } from './config.js';
import { getMap, MAP_IDS, PLAY_MAPS, RAMMABLE, TOPPLE, RAM_SOFT, mapForMode } from './maps.js';
// Each match gets its own copy of the map so broken crates/walls only affect that match.
function matchMap(base) { const m = Object.create(base); m.base = base; m.dead = new Uint8Array(base.colliders.length); m.hp = base.colliders.map(c => c.hp || 0); m.fx = null; return m; }
import { newTankState, simulateInput, stepShell, muzzleOf } from './sim.js';
import { decodeInput, quantizeInput, encodeSnapshotBody, encodeSnapshot, MSG_INPUT, FLAG_ALIVE, FLAG_SHIELD, FLAG_CONNECTED, FLAG_ONESHOT, FLAG_HOT } from './protocol.js';
import { BotBrain } from './bot.js';
import * as M2 from './modes2.js';
import * as AB from './abrun.js';
import { abilityOf, abLevel } from './abilities.js';
import { FLAG_CLOAK, FLAG_FROZEN } from './protocol.js';
// Commons show up most, legendaries least (like in real players' garages).
const BOT_TANK_WEIGHT = { common: 3, rare: 2, epic: 1.4, legendary: 0.8 };
function randomBotTank() {
  let sum = 0; for (const id of TANK_IDS) sum += BOT_TANK_WEIGHT[TANKS[id].rarity];
  let r = Math.random() * sum;
  for (const id of TANK_IDS) { r -= BOT_TANK_WEIGHT[TANKS[id].rarity]; if (r <= 0) return id; }
  return TANK_IDS[0];
}
import { dist, wrapAngle } from './math.js';
import { tankStats, TANK_IDS, TANKS } from './tanks.js';

const DT = 1 / NET.TICK_RATE;
// Bot names: 50% Kurdish (10% girls, 40% guys), 30% Arabic, 20% English.
const BOT_NAME_POOLS = [
  [0.10, ['ژیلا', 'شیلان', 'ڤیان', 'نازدار', 'ڕۆژان', 'هێڤی', 'لاڤا', 'چنار', 'ڕۆژین', 'سۆما', 'ئەڤین', 'بەهار']],
  [0.40, ['هێمن', 'ئاراس', 'کاروان', 'ڕێبین', 'شوان', 'دڵشاد', 'سۆران', 'هاوکار', 'ئازاد', 'بەختیار', 'ڕێباز', 'زانا', 'دیار', 'ئاسۆ', 'هەڵۆ', 'ژیار', 'پشتیوان', 'بەرزان', 'کۆسرەت', 'سەرهەنگ']],
  [0.30, ['أحمد', 'علي', 'حسن', 'مصطفى', 'عمر', 'يوسف', 'كرار', 'حيدر', 'زيد', 'سيف', 'مرتضى', 'ليث', 'محمد', 'خالد']],
  [0.20, ['Jack', 'Ryan', 'Mason', 'Leo', 'Ethan', 'Noah', 'Liam', 'Oliver', 'Lucas', 'Harry', 'James', 'Max']],
];
function randomBotName(used) {
  let r = Math.random(), pool = BOT_NAME_POOLS[BOT_NAME_POOLS.length - 1][1];
  for (const [w, names] of BOT_NAME_POOLS) { if (r < w) { pool = names; break; } r -= w; }
  let free = pool.filter(n => !used.has(n));
  if (!free.length) free = BOT_NAME_POOLS.flatMap(p => p[1]).filter(n => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}
const OTHER = { blue: 'red', red: 'blue' };
const SPREAD_ANGLE = 0.13;
// A caged tank cannot drive, turn or shoot: we feed it an empty input so it still ticks.
const CAGED = (p) => ({ mode: 0, dir: 0, mag: 0, throttle: 0, steer: 0, aim: p.s.t, fire: false, ab: false });           // radians between the shells of a spread shot
export const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N}_\- .]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.now = opts.now || (() => Date.now());
    this.log = opts.log || (() => {});
    this.kind = opts.kind || 'private';
    this.maxPlayers = opts.maxPlayers || GAME.MAX_PLAYERS;
    this.onEnd = opts.onEnd || null;            // (summary) → server records stats / RP
    this.reserved = opts.reserved || null;      // ranked: Map(accountId → team)
    this.fillBots = !!opts.fillBots;            // ranked test mode: bots take empty seats
    this.loadGate = !!opts.loadGate;            // wait for every player's map to load before the match begins (server + practice)
    this.players = new Map();
    this.state = 'lobby';          // lobby → loading → playing → ended → lobby   (ranked: → closed)
    this.mode = opts.mode && GAME.MODES[opts.mode] ? opts.mode : 'tdm';
    this.mapId = mapForMode(this.mode, opts.map && MAP_IDS.includes(opts.map) ? opts.map : 'hawler');
    this.map = matchMap(getMap(this.mapId));
    // Time of day: private rooms let the host pick day / night / random; other rooms are random (about 1 in 3 at night).
    this.tod = 'random'; this.night = false;
    this.hostId = 0;
    this.tick = 0;
    this.time = this.now();
    this.created = this.time;
    this.shells = []; this.rockets = []; this.broken = [];
    this.shellSeq = 1;
    this.dirty = true;
    this.infoT = 0;
    this.endTime = 0;
    this.endAt = 0;
    this.emptySince = this.time;
    this.winner = null;
    this.pads = [];
    this.score = { blue: 0, red: 0 };
    this.flags = null; this.zone = null; this.round = null;
    this.autoStartAt = 0;
    this.teamGone = { blue: 0, red: 0 };
  }
  get isTeam() { return GAME.MODES[this.mode].team; }
  get hosted() { return this.kind === 'private' || this.kind === 'practice'; }

  /* ---------------- membership ---------------- */
  humans() { return [...this.players.values()].filter(p => !p.bot); }
  connectedHumans() { return this.humans().filter(p => p.connected); }
  nextId() { for (let i = 1; i < 250; i++) if (!this.players.has(i)) return i; return 0; }
  teamCounts() { const c = { blue: 0, red: 0 }; for (const p of this.players.values()) if (c[p.team] !== undefined) c[p.team]++; return c; }
  pickTeam() { if (!this.isTeam) return 'ffa'; if (this.mode === 'surv') return 'blue'; const c = this.teamCounts(); return c.blue <= c.red ? 'blue' : 'red'; }
  canSpawnNow(p) { return this.state === 'playing' && !p.out && !(this.round && this.round.phase !== 'fight') && (!this.m2 || M2.canSpawn(this, p)); }

  /** acct = {id, name, tag, tank:{id, level}} from the server; loadout = {id, level} (practice only) */
  join(conn, name, token, acct = null, loadout = null) {
    name = cleanName(acct ? acct.name : name) || 'Player';
    // Reconnect: same token (or same account) takes its old slot back (stats kept).
    for (const p of this.players.values()) {
      if (p.bot) continue;
      if ((token && p.token === token) || (acct && p.acct && p.acct.id === acct.id)) {
        if (p.conn && p.conn !== conn && p.connected) try { p.conn.close(); } catch (e) {}
        p.conn = conn; p.connected = true; p.disconnectedAt = 0; p.name = name; p.inputQ.length = 0; p.starving = true; p.token = token || p.token; p.left = false;
        if (acct) p.acct = acct;
        if (acct && acct.tank && !p.alive) p.tank = tankStats(acct.tank.id, acct.tank.mods || acct.tank.level);
        this.emptySince = 0; this.dirty = true;
        if (this.hosted && (!this.hostId || !this.players.get(this.hostId)?.connected)) this.hostId = p.id;
        this.welcome(p);
        if (this.state === 'playing' && !p.alive && p.deadT <= 0 && this.canSpawnNow(p)) this.spawn(p);
        this.log(`[${this.code}] ${name} reconnected`);
        return p;
      }
    }
    if (this.state === 'closed') return { error: 'This match is over.' };
    let team;
    if (this.kind === 'ranked') {
      if (!acct || !this.reserved || !this.reserved.has(acct.id)) return { error: 'This ranked match is for other players.' };
      team = this.reserved.get(acct.id);
    } else team = this.pickTeam();
    if (this.players.size >= this.maxPlayers || (this.kind === 'quick' && this.players.size >= GAME.QUICK_FILL_TO)) {
      const bots = [...this.players.values()].filter(p => p.bot);
      const bot = bots.find(b => b.team === team) || bots[0];
      if (!bot && this.players.size >= this.maxPlayers) return { error: 'This room is full.' };
      if (bot) { team = this.isTeam ? bot.team : 'ffa'; this.removePlayer(bot); }
    }
    const id = this.nextId();
    const p = this.makePlayer(id, name, team);
    p.token = token; p.conn = conn; p.connected = true; p.acct = acct;
    const lo = (acct && acct.tank) || (this.kind === 'practice' && loadout) || null;
    if (lo) p.tank = tankStats(lo.id, lo.mods || lo.level);
    this.players.set(id, p);
    if (this.hosted && (!this.hostId || !this.players.get(this.hostId)?.connected)) this.hostId = id;
    this.emptySince = 0; this.dirty = true;
    if (this.kind === 'quick' && this.state === 'lobby' && !this.autoStartAt) this.autoStartAt = this.time + GAME.QUICK_COUNTDOWN_S * 1000;
    this.welcome(p);
    if (this.state === 'playing') { if (this.round) p.out = true; if (this.canSpawnNow(p)) this.spawn(p); }
    this.log(`[${this.code}] ${name} joined (${this.players.size} players)`);
    return p;
  }
  makePlayer(id, name, team) {
    return { id, name, team, token: null, conn: null, connected: false, bot: null, ready: false, acct: null,
      k: 0, d: 0, hk: 0, hd: 0, obj: 0, pu: 0, dmg: 0, caps: 0, zone: 0, lastHit: 0, tank: tankStats('zagros', 1), ping: 0, s: newTankState(), alive: false, hp: GAME.HP, deadT: 0, killer: 0, out: false, left: false,
      inputQ: [], lastSeq: 0, lastQueued: 0, lastInput: null, debt: 0, starving: true, bufTarget: NET.INPUT_BUFFER_MIN + 1,
      disconnectedAt: 0 };
  }
  addBot(team) {
    if (this.players.size >= this.maxPlayers) return;
    const id = this.nextId();
    const used = new Set([...this.players.values()].map(p => p.name));
    const name = randomBotName(used) || 'Bot' + id;
    const p = this.makePlayer(id, name, team || this.pickTeam());
    // Every bot is different: a random skill (weak / average / good) and a random tank near the humans' level.
    const r = Math.random();
    p.botSkill = r < 0.38 ? 0.12 + Math.random() * 0.25 : r < 0.8 ? 0.38 + Math.random() * 0.24 : 0.62 + Math.random() * 0.25;
    if (this.kind === 'ranked') p.botSkill = 0.3 + Math.random() * 0.35;
    p.bot = new BotBrain(this.map, id * 7919 + this.tick, p.botSkill); p.ready = true; p.connected = true;
    const hs = this.humans(), lvl = hs.length ? Math.round(hs.reduce((a, h) => a + h.tank.level, 0) / hs.length) : 1;
    p.tank = tankStats(randomBotTank(), Math.max(1, Math.min(10, lvl + Math.floor(Math.random() * 4) - 2)));
    this.players.set(id, p); this.dirty = true;
    if (this.state === 'playing') { if (this.round) p.out = true; if (this.canSpawnNow(p)) this.spawn(p); }
  }
  // Survival: an enemy bot for the current wave (not limited by room size, removed when destroyed).
  addWaveBot(kind, lvl, skill) {
    const id = this.nextId();
    const p = this.makePlayer(id, randomBotName(new Set([...this.players.values()].map(q => q.name))) || 'Raider', 'red');
    p.wave = true; p.botSkill = skill; p.bot = new BotBrain(this.map, id * 7919 + this.tick, skill); p.ready = true; p.connected = true;
    p.tank = tankStats(kind, lvl); this.players.set(id, p); this.dirty = true; this.spawn(p);
    return p;
  }
  removeBot() { const b = [...this.players.values()].reverse().find(p => p.bot && !p.wave); if (b) this.removePlayer(b); }
  removePlayer(p) {
    this.dropFlagOf(p);
    this.players.delete(p.id);
    if (this.hostId === p.id) { const h = this.connectedHumans()[0]; this.hostId = h && this.hosted ? h.id : 0; }
    this.dirty = true;
    this.broadcast({ t: 'left', id: p.id });
    if (this.round) this.roundCheck();
  }
  disconnect(p) {
    if (!this.players.has(p.id) || !p.connected) return;
    p.connected = false; p.conn = null; p.disconnectedAt = this.time; p.alive = false; p.inputQ.length = 0;
    this.dropFlagOf(p);
    if (this.hostId === p.id) { const h = this.connectedHumans()[0]; if (h) this.hostId = h.id; }
    if (!this.connectedHumans().length) this.emptySince = this.time;
    this.dirty = true;
    this.log(`[${this.code}] ${p.name} disconnected`);
    if (this.round) this.roundCheck();
  }
  welcome(p) {
    this.send(p, { t: 'welcome', id: p.id, code: this.code, kind: this.kind, tickRate: NET.TICK_RATE, snapEvery: NET.SNAPSHOT_EVERY, st: this.time, map: this.mapId, checksum: this.map.checksum });
    this.send(p, this.roomInfo());
    if (this.state !== 'lobby') this.send(p, this.objInfo());
    if (this.state === 'playing' && this.map.fx) this.send(p, AB.fxMsg(this));
  }

  /* ---------------- messages ---------------- */
  onBinary(p, bytes) {
    if (bytes[0] !== MSG_INPUT || bytes.length < 12) return;   // 13 bytes now; 12 still decodes (abd = 0)
    const inp = decodeInput(bytes);
    if (inp.seq <= p.lastQueued) return;          // duplicate / old
    p.lastQueued = inp.seq;
    p.inputQ.push(inp);
    // Arrival jitter estimate (ms) → sizes the cushion at the next spawn.
    const t = this.now(), gap = p.lastArr ? t - p.lastArr : 33.3; p.lastArr = t;
    const dev = Math.abs(gap - 1000 / NET.TICK_RATE);
    p.arrJit = (p.arrJit || 0) * 0.97 + dev * 0.03;
    if (p.inputQ.length > NET.MAX_INPUT_QUEUE) p.inputQ.splice(0, p.inputQ.length - NET.INPUT_BUFFER_MAX);
  }
  onJSON(p, m) {
    const host = this.hosted && p.id === this.hostId;
    switch (m.t) {
      case 'ping': p.ping = Math.max(0, Math.min(9999, m.rtt | 0)); this.send(p, { t: 'pong', c: m.c, st: this.now() }); break;
      case 'ready': p.ready = !!m.v; this.dirty = true; break;
      case 'loaded': if (!p.loaded) { p.loaded = true; this.dirty = true; } break;
      case 'team':
        if (this.hosted && this.isTeam && (m.team === 'blue' || m.team === 'red') && this.state !== 'playing') { p.team = m.team; this.dirty = true; }
        break;
      case 'map': if (host && PLAY_MAPS.includes(m.map) && this.state === 'lobby') { this.pickedMap = m.map; this.setMap(mapForMode(this.mode, m.map)); } break;
      case 'mode':
        if (host && GAME.MODES[m.mode] && this.state === 'lobby' && m.mode !== this.mode) {
          const wasTeam = this.isTeam; this.mode = m.mode;
          const want = mapForMode(this.mode, this.pickedMap || this.mapId); if (want !== this.mapId) this.setMap(want);   // Tank Ball → stadium and back
          if (wasTeam !== this.isTeam) { let i = 0; for (const q of this.players.values()) q.team = this.isTeam ? (i++ % 2 ? 'red' : 'blue') : 'ffa'; }
          this.dirty = true;
        }
        break;
      case 'upg': M2.onJSON(this, p, m); break;
      // Practice only (offline, no rewards): try any tank and any power level straight away.
      case 'tryTank':
        if (this.kind === 'practice' && TANKS[m.id]) {
          const L = Math.max(0, Math.min(5, m.ab | 0));
          p.tank = tankStats(m.id, { pow: L, arm: L, spd: L, rng: L, rel: L, ab: L });
          if (this.state === 'playing') { p.alive = false; p.deadT = 0; this.spawn(p); }
          p.abChg = AB.abNeedOf(p); p.abSent = -1; AB.pushCharge(this, p);   // practice: the power starts full so you can try it
          this.dirty = true;
        }
        break;
      case 'tod': if (host && ['day', 'night', 'random'].includes(m.v) && this.state === 'lobby') { this.tod = m.v; this.dirty = true; } break;
      case 'start':
        if (!host) break;
        // everyone in a private room has to press READY first (the host counts as ready)
        if (this.kind === 'private') { const wait = this.connectedHumans().filter(q => q.id !== this.hostId && !q.ready); if (wait.length) { this.send(p, { t: 'notReady', names: wait.map(q => q.name) }); break; } }
        this.start(); break;
      case 'stop': if (host && this.state === 'playing') this.end(null); break;
      case 'addBot': if (host) this.addBot(); break;
      case 'removeBot': if (host) this.removeBot(); break;
      // ---- voice chat: the server only passes the two players' connection offers along.
      // The voices themselves go straight from phone to phone, never through the server.
      case 'rtc': {
        const q = this.players.get(m.to | 0);
        if (q && !q.bot && q.connected && q.id !== p.id) this.send(q, { t: 'rtc', from: p.id, sdp: m.sdp, ice: m.ice, kind: m.kind });
        break;
      }
      case 'vc': {                                   // "my microphone is on / I am talking"
        const on = !!m.on, talk = !!m.talk;
        if (p.vcOn === on && p.vcTalk === talk) break;
        p.vcOn = on; p.vcTalk = talk;
        this.broadcast({ t: 'vc', id: p.id, on, talk });
        break;
      }
      case 'leave':
        if (this.kind === 'ranked' && this.state !== 'closed') { p.left = true; this.disconnect(p); }
        else this.removePlayer(p);
        try { p.conn?.close(); } catch (e) {}
        break;
    }
  }
  setMap(id) { this.mapId = id; this.map = matchMap(getMap(id)); for (const p of this.players.values()) if (p.bot) p.bot = new BotBrain(this.map, p.id * 7919 + this.tick, p.botSkill); this.dirty = true; }
  send(p, obj) { if (p.conn && p.connected) p.conn.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.players.values()) if (!p.bot) this.send(p, s); }
  sendAcct(accountId, obj) { for (const p of this.players.values()) if (p.acct && p.acct.id === accountId) this.send(p, obj); }

  /* ---------------- match flow ---------------- */
  // Start: first everyone loads the map (loading screen), then the match really begins.
  start() {
    if (this.state !== 'lobby') return;
    const humans = this.connectedHumans();
    if (this.loadGate && humans.length) {
      this.state = 'loading'; this.loadUntil = this.time + GAME.LOAD_WAIT_S * 1000;
      for (const p of this.players.values()) p.loaded = !!p.bot;
      this.broadcast({ t: 'load', map: this.mapId, mode: this.mode, st: this.time });
      this.dirty = true; return;
    }
    this.begin();
  }
  checkLoaded() {
    const waiting = this.connectedHumans().filter(p => !p.loaded);
    if (!waiting.length || this.time >= this.loadUntil) { this.state = 'lobby'; this.begin(); }
  }
  begin() {
    if (this.state !== 'lobby') return;
    { const want = mapForMode(this.mode, this.mapId); if (want !== this.mapId) this.setMap(want); }   // Tank Ball → stadium
    if (this.kind === 'ranked' && this.fillBots)
      for (const t of ['blue', 'red']) { const want = this.maxPlayers / 2; while (this.teamCounts()[t] < want) this.addBot(t); }
    this.shells = []; this.rockets = []; this.score = { blue: 0, red: 0 }; this.winner = null; this.map = matchMap(this.map.base || this.map); this.broken = [];
    for (const p of this.players.values()) {
      p.k = 0; p.d = 0; p.hk = 0; p.hd = 0; p.obj = 0; p.pu = 0; p.dmg = 0; p.caps = 0; p.zone = 0; p.alive = false; p.deadT = 0; p.out = false; p.oneShot = false; p.rockets = 0; p.inputQ.length = 0; p.starving = true; p.abChg = 0; p.abSent = -1; p.abUses = 0;
      if (p.bot) p.bot = new BotBrain(this.map, p.id * 7919 + this.tick, p.botSkill);
    }
    this.state = 'playing'; this.startedAt = this.time; this.autoStartAt = 0;
    this.night = this.tod === 'night' || (this.tod === 'random' && Math.random() < 0.33);
    const M = GAME.MODES[this.mode];
    this.endTime = this.time + M.timeLimitS * 1000;
    this.flags = null; this.zone = null; this.round = null;
    if (this.mode === 'ctf') {
      this.flags = {};
      for (const t of ['blue', 'red']) { const [x, z] = this.map.bases[t]; this.flags[t] = { team: t, home: [x, z], x, z, s: 'home', c: 0, at: 0 }; }
    }
    if (this.mode === 'koh') {
      // the zone moves between the map's hills: the first one, then the others in a random order
      const H = this.map.hills || [[this.map.hill.x, this.map.hill.z]], rest = H.slice(1).sort(() => Math.random() - 0.5);
      this.hillOrder = [H[0], ...rest];
      this.zone = { x: H[0][0], z: H[0][1], r: GAME.KOH.RADIUS, own: null, acc: { blue: 0, red: 0 }, n: 0, next: GAME.MODES.koh.moveEvery || 1e9 };
    }
    AB.abStart(this);
    this.m2 = null; if (M2.isNew(this.mode)) M2.start(this);
    this.broadcast({ t: 'start', map: this.mapId, mode: this.mode, night: this.night, st: this.time });
    if (this.mode === 'lts') this.startRound(1);
    else { this.resetPads(false); for (const p of this.players.values()) if (p.connected) this.spawn(p); }
    this.dirty = true; this.sendObj();
    this.log(`[${this.code}] ${this.mode} started on ${this.mapId}`);
  }
  resetPads(same) {
    const PT = GAME.POWERUPS.TYPES, one = PT[Math.floor(Math.random() * PT.length)];
    this.pads = (this.map.pads || []).map(([x, z], i) => ({ x, z, type: same ? one : PT[(i + Math.floor(Math.random() * PT.length)) % PT.length], on: true, at: 0 }));
  }
  startRound(n) {
    this.round = { n, phase: 'fight', until: this.time + GAME.MODES.lts.roundS * 1000, winner: null };
    this.shells = []; this.rockets = []; this.resetPads(true);           // every pad the same type: fair for both sides
    for (const p of this.players.values()) { p.out = false; p.oneShot = false; p.rockets = 0; if (p.connected) this.spawn(p); else { p.alive = false; p.out = true; } }
    this.broadcast({ t: 'round', n, phase: 'fight', st: this.time });
    this.dirty = true; this.sendObj();
  }
  roundCheck() {
    const R = this.round; if (!R || R.phase !== 'fight' || this.state !== 'playing') return;
    const all = [...this.players.values()];
    if (!all.some(p => p.team === 'blue') || !all.some(p => p.team === 'red')) return;
    const alive = { blue: 0, red: 0 }, hp = { blue: 0, red: 0 };
    for (const p of all) if (p.alive && alive[p.team] !== undefined) { alive[p.team]++; hp[p.team] += p.hp; }
    const timeout = this.time >= R.until;
    if (alive.blue && alive.red && !timeout) return;
    let w = null;
    if (!alive.blue && alive.red) w = 'red'; else if (!alive.red && alive.blue) w = 'blue';
    else if (timeout) w = alive.blue !== alive.red ? (alive.blue > alive.red ? 'blue' : 'red') : hp.blue !== hp.red ? (hp.blue > hp.red ? 'blue' : 'red') : null;
    if (w) this.score[w]++;
    R.phase = 'break'; R.winner = w; R.until = this.time + GAME.MODES.lts.breakS * 1000;
    this.broadcast({ t: 'round', n: R.n, phase: 'break', winner: w, score: this.score, st: this.time });
    this.dirty = true; this.sendObj();
    this.checkScore();
  }
  /** One number for how well a player did: kills and objectives count most, damage helps, dying hurts a little. */
  matchScore(p) {
    return Math.max(0, Math.round((p.k || 0) * 120 + (p.obj || 0) * 150 + (p.caps || 0) * 200 + (p.zone || 0) * 15
      + (p.dmg || 0) * 0.5 + (p.pu || 0) * 20 - (p.d || 0) * 40));
  }
  /** Best player on each side (the whole lobby in free-for-all modes). */
  bestPlayers() {
    const out = {};
    const teams = this.isTeam ? ['blue', 'red'] : ['ffa'];
    for (const tm of teams) {
      let best = null, bs = -1;
      for (const p of this.players.values()) {
        if (p.team !== tm || p.wave) continue;
        const sc = this.matchScore(p);
        if (sc > bs) { bs = sc; best = p; }
      }
      if (best && bs > 0) out[tm] = { id: best.id, name: best.name, score: bs, k: best.k, d: best.d, obj: best.obj, dmg: Math.round(best.dmg), bot: !!best.bot };
    }
    return out;
  }
  end(winner) {
    this.mvp = this.bestPlayers();
    this.state = 'ended'; this.winner = winner; this.endAt = this.time + GAME.END_SCREEN_S * 1000; this.shells = []; this.rockets = [];
    this.broadcast({ t: 'end', winner, mvp: this.mvp, st: this.time });
    this.dirty = true;
    if (this.onEnd) try { this.onEnd(this.summary(winner)); } catch (e) { this.log('onEnd error', e); }
  }
  summary(winner) {
    const players = [...this.players.values()].map(p => ({ acct: p.acct ? p.acct.id : null, name: p.name, team: p.team, k: p.k, d: p.d, hk: p.hk, hd: p.hd, obj: p.obj, pu: p.pu, dmg: p.dmg, caps: p.caps, zone: p.zone, abUses: p.abUses | 0, id: p.id, tank: p.tank.id, bot: !!p.bot,
      left: !!p.left || !p.connected, won: winner != null && (this.isTeam ? p.team === winner : p.id === winner) }));
    if (this.reserved) for (const [id, team] of this.reserved) if (!players.some(p => p.acct === id))
      players.push({ acct: id, name: '', team, k: 0, d: 0, hk: 0, hd: 0, obj: 0, pu: 0, dmg: 0, caps: 0, zone: 0, bot: false, left: true, won: false, absent: true });
    return { code: this.code, kind: this.kind, mode: this.mode, map: this.mapId, winner, team: this.isTeam, score: { ...this.score }, mvp: this.mvp || this.bestPlayers(),
      secs: Math.round((this.time - (this.startedAt || this.time)) / 1000), players };
  }
  toLobby() {
    if (this.kind === 'ranked') { this.state = 'closed'; this.dirty = true; return; }
    this.state = 'lobby'; this.flags = null; this.zone = null; this.round = null; this.m2 = null; this.mvp = null;
    this.abMs = []; this.abDr = []; if (this.map.fx) { this.map.fx.walls.length = 0; this.map.fx.domes.length = 0; this.map.fx.holes.length = 0; }
    for (const p of [...this.players.values()]) if (p.wave) this.removePlayer(p);
    for (const p of this.players.values()) { if (p.jbase) { p.tank = p.jbase; p.jbase = null; } if (p.baseTank) { p.tank = p.baseTank; p.baseTank = null; } p.jugg = false; p.boss = false; p.bounty = 0; p.ms = 0; p.kb = null; }
    for (const p of this.players.values()) { p.alive = false; if (!p.bot) { p.ready = false; p.loaded = false; } }
    if (this.kind === 'quick') {          // draw a new mode and map, then start again by itself
      const M = GAME.QUICK_MODES || GAME.MODE_IDS;
      const wasTeam = this.isTeam;
      this.mode = M[Math.floor(Math.random() * M.length)];
      this.pickedMap = PLAY_MAPS[Math.floor(Math.random() * PLAY_MAPS.length)];
      this.setMap(mapForMode(this.mode, this.pickedMap));
      if (wasTeam !== this.isTeam) { let i = 0; for (const q of this.players.values()) q.team = this.isTeam ? (i++ % 2 ? 'red' : 'blue') : 'ffa'; }
      this.autoStartAt = this.time + GAME.QUICK_COUNTDOWN_S * 1000;
    }
    this.dirty = true;
  }
  teamPoints(team) {
    if (this.m2) return M2.teamPoints(this, team);
    if (this.mode === 'ctf' || this.mode === 'koh' || this.mode === 'lts') return this.score[team];
    let s = 0; for (const p of this.players.values()) if (p.team === team) s += p.k; return s;
  }
  checkScore() {
    if (this.state !== 'playing') return;
    if (this.m2) return M2.checkScore(this);
    const lim = GAME.MODES[this.mode].scoreLimit;
    if (this.isTeam) { for (const t of ['blue', 'red']) if (this.teamPoints(t) >= lim) return this.end(t); }
    else for (const p of this.players.values()) if (p.k >= lim) return this.end(p.id);
  }
  timeUp() {
    if (this.m2) return M2.timeUp(this);
    if (this.isTeam) { const b = this.teamPoints('blue'), r = this.teamPoints('red'); this.end(b === r ? 'draw' : b > r ? 'blue' : 'red'); }
    else { let best = null; for (const p of this.players.values()) if (!best || p.k > best.k) best = p; this.end(best ? best.id : 'draw'); }
  }

  enemies(a, b) { return a.id !== b.id && (a.team === 'ffa' || a.team !== b.team); }

  spawn(p) {
    const pool = this.isTeam ? this.map.spawns[p.team] : this.map.spawns.any;
    const live = [...this.players.values()].filter(q => q.alive && q !== p);
    const home = this.flags ? this.flags[p.team].home : null;
    let best = null, bestScore = -1e9;
    for (const [x, z] of pool) {
      let minFoe = 200, minAny = 200;
      for (const q of live) {
        const d = dist(x, z, q.s.x, q.s.z);
        if (d < minAny) minAny = d;
        if (this.enemies(p, q) && d < minFoe) minFoe = d;
      }
      if (minAny < 6) continue;                          // never on top of a tank
      let score = Math.min(minFoe, 45) + Math.random() * 8; // far from enemies, a bit random
      if (home) score -= dist(x, z, home[0], home[1]) * 0.35;   // CTF: near your own base
      if (this.round) score = -dist(x, z, this.map.bases[p.team][0], this.map.bases[p.team][1]) + Math.random() * 6; // rounds: together at base
      score -= this.spawnPenalty(p, x, z);
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) best = pool[Math.floor(Math.random() * pool.length)] || [0, 0];
    const at = this.m2 && M2.spawnAt(this, p); if (at) best = at;
    const yaw = Math.atan2(-best[0], -best[1]);          // face the middle of the map
    p.s = newTankState(best[0], best[1], yaw, p.tank.id, p.tank.reload, p.tank.sm || 1);
    p.s.tm = p.team;                          // black holes only pull the other side
    p.s.shield = GAME.SPAWN_SHIELD_S;
    AB.abReset(p);
    p.hp = p.tank.hp; p.alive = true; p.lastHit = 0; p.deadT = 0; p.inputQ.length = 0; p.starving = true; p.starveT = 0; p.debt = 0; p.lastInput = null;
    p.bufTarget = Math.max(NET.INPUT_BUFFER_MIN, Math.min(NET.INPUT_BUFFER_MAX, 1 + Math.ceil((p.arrJit || 0) * 2.5 / (1000 / NET.TICK_RATE))));
    this.broadcast({ t: 'spawn', id: p.id, x: p.s.x, z: p.s.z, yaw, c: p.tank.id, rl: p.tank.reload, mh: p.tank.hp, sm: p.tank.sm || 1, ss: p.tank.shellSpeed, rg: p.tank.range, tm: p.team, ab: abilityOf(p.tank.id), al: AB.abLvlOf(p), chg: p.abChg || 0, need: AB.abNeedOf(p), st: this.time });
  }
  // Respawning on a power-up, inside the zone or next to the enemy flag is an unfair head start.
  spawnPenalty(p, x, z) {
    const A = GAME.SPAWN_AWAY; let pen = 0;
    for (const pd of this.pads) if (dist(x, z, pd.x, pd.z) < A.PAD) pen += 1000;
    if (this.zone && this.mode === 'koh' && dist(x, z, this.zone.x, this.zone.z) < this.zone.r + A.ZONE) pen += 1000;
    if (this.flags && this.flags[OTHER[p.team]]) { const h = this.flags[OTHER[p.team]].home; if (dist(x, z, h[0], h[1]) < A.FLAG) pen += 1000; }
    return pen;
  }

  fire(p, seq) {
    const m = muzzleOf(p.s), T = p.tank;
    if (p.cloakT) AB.abReveal(this, p);              // the muzzle flash gives you away
    if (p.rockets > 0) { p.rockets--; this.launchRocket(p, m); return; }
    const big = !!p.oneShot; p.oneShot = false;
    const n = T.spread || 1;
    for (let k = 0; k < n; k++) {
      const a = p.s.t + (n > 1 ? (k - (n - 1) / 2) * SPREAD_ANGLE : 0);
      const sh = { id: this.shellSeq++, owner: p.id, x: m.x, z: m.z, dx: Math.sin(a), dz: Math.cos(a), trav: 0, max: T.range, spd: T.shellSpeed,
        big: big && k === (n - 1) >> 1, dmg: T.dmg, splash: T.splash };
      // A repair or freeze shell is the POWER's own shot now (see abShotFire in abrun.js), never
      // something the cannon carries, so nothing here has to look at whether one was armed.
      this.shells.push(sh);
      this.broadcast({ t: 'shot', id: sh.id, o: p.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2), a: +a.toFixed(4), seq, k, spd: T.shellSpeed, max: T.range, big: sh.big ? 1 : 0, hl: 0, fz: 0, st: this.time });
    }
  }
  launchRocket(p, m) {
    const PU = GAME.POWERUPS;
    this.rockets.push({ id: this.shellSeq++, owner: p.id, x: m.x, z: m.z, a: p.s.t, life: PU.ROCKET_LIFE, target: 0, lvl: p.tank.level });
    this.broadcast({ t: 'rkl', o: p.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2), n: p.rockets, st: this.time });
  }
  // Homing rockets: steer at a limited rate toward the nearest enemy in front, so fast or swerving tanks can dodge.
  stepRockets(list) {
    const PU = GAME.POWERUPS, R = GAME.TANK_RADIUS + 0.35;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i], o = this.players.get(r.owner);
      let tgt = r.target && this.players.get(r.target);
      const ok = (q) => q && q.alive && o && this.enemies(o, q) && dist(q.s.x, q.s.z, r.x, r.z) < PU.ROCKET_SEEK && Math.abs(wrapAngle(Math.atan2(q.s.x - r.x, q.s.z - r.z) - r.a)) < PU.ROCKET_CONE;
      if (!ok(tgt)) { tgt = null; let bd = 1e9; for (const q of list) if (ok(q)) { const d = dist(q.s.x, q.s.z, r.x, r.z); if (d < bd) { bd = d; tgt = q; } } r.target = tgt ? tgt.id : 0; }
      if (tgt) r.a = wrapAngle(r.a + Math.max(-PU.ROCKET_TURN * DT, Math.min(PU.ROCKET_TURN * DT, wrapAngle(Math.atan2(tgt.s.x - r.x, tgt.s.z - r.z) - r.a))));
      r.x += Math.sin(r.a) * PU.ROCKET_SPEED * DT; r.z += Math.cos(r.a) * PU.ROCKET_SPEED * DT; r.life -= DT;
      let hit = null;
      for (const q of list) if (q.alive && q.id !== r.owner && dist(q.s.x, q.s.z, r.x, r.z) < R) { hit = q; break; }
      let wall = !hit && (r.life <= 0 || Math.abs(r.x) > 90 || Math.abs(r.z) > 90);
      let prop = null;
      if (!hit && !wall) for (const c of this.map.near(r.x, r.z)) if (!c.low && !this.map.dead[c.i] && dist(r.x, r.z, c.x, c.z) < c.r + 0.2) { wall = true; prop = c; break; }
      if (!hit && !wall) continue;
      this.rockets.splice(i, 1);
      let dmg = 0;
      if (hit) { const d = PU.ROCKET_DMG, k = 1 + 0.03 * ((r.lvl || 1) - 1); dmg = this.damage(hit, o, Math.round((d[0] + Math.random() * (d[1] - d[0])) * k), false); }
      this.broadcast({ t: 'hit', s: -r.id, o: r.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: hit ? hit.id : 0, dmg, w: wall ? 1 : 0, rk: 1, st: this.time });
      if (prop) this.hitProp(prop, 2, { x: r.x - Math.sin(r.a) * 4, z: r.z - Math.cos(r.a) * 4 });
      if (hit && hit.hp <= 0 && hit.alive) this.kill(hit, o || hit);
      if (this.state !== 'playing') return;
    }
    if (this.rockets.length || this.rkSent) {
      if (this.tick % NET.SNAPSHOT_EVERY === 0) { this.broadcast({ t: 'rk', r: this.rockets.map(r => [r.id, +r.x.toFixed(2), +r.z.toFixed(2), +r.a.toFixed(3), r.owner]), st: this.time }); this.rkSent = this.rockets.length > 0; }
    }
  }
  // Breakable props (crates, barrels, sandbags, small walls…): a few hits and they are gone for the rest of the match.
  // `from` = where the blow came from ({x, z}): trees and poles fall away from it.
  hitProp(c, n, from = null) {
    const M = this.map; if (!c.hp || M.dead[c.i]) return;
    M.hp[c.i] -= n; if (M.hp[c.i] > 0) return;
    M.dead[c.i] = 1; this.broken.push(c.i);
    const m = { t: 'brk', i: c.i, o: c.o, st: this.time };
    if (from) { m.fx = +from.x.toFixed(1); m.fz = +from.z.toFixed(1); }
    this.broadcast(m);
  }
  /** Damage one tank (shields, armour power-up, team and the tank's own armour are respected). → damage done */
  damage(v, k, base, big) {
    if (!v.alive || v.s.shield > 0 || v.s.armor > 0 || (k && !this.enemies(k, v))) return 0;
    if (this.m2) { const d = M2.damage(this, v, k, base, k && k.s); if (d < 0) return 0; base = d; }
    const dmg = big ? v.hp : Math.max(1, Math.round(base * (1 - (v.tank.armor || 0))));
    v.hp -= dmg; v.lastHit = this.time;
    if (k && k !== v) { const real = Math.min(dmg, v.hp + dmg); k.dmg += real; AB.addCharge(this, k, real); }   // hurting enemies charges your power
    return dmg;
  }

  // Explosive shells (Newroz) also hurt other enemy tanks near the impact.
  splash(sh, r, skip) {
    const k = this.players.get(sh.owner);
    for (const q of [...this.players.values()]) {
      if (q.id === skip || !q.alive || q.id === sh.owner || dist(q.s.x, q.s.z, r.x, r.z) > sh.splash.r) continue;
      const d = sh.splash.dmg, dmg = this.damage(q, k, d[0] + Math.floor(Math.random() * (d[1] - d[0] + 1)), false);
      if (!dmg) continue;
      this.broadcast({ t: 'hit', s: -1, o: sh.owner, x: +q.s.x.toFixed(2), z: +q.s.z.toFixed(2), v: q.id, dmg, sp: 1, st: this.time });
      if (q.hp <= 0 && q.alive) this.kill(q, k || q);
      if (this.state !== 'playing') return;
    }
  }

  kill(v, k) {
    v.alive = false; v.killer = k.id; v.d++; v.oneShot = false; v.rockets = 0; v.healShot = 0; v.frzShot = 0; v.s.froz = 0;
    if (v.cloakT) AB.abReveal(this, v);
    v.deadT = this.round ? 0 : GAME.RESPAWN_S; if (this.round) v.out = true;
    if (k !== v) { k.k++; if (!v.bot) k.hk++; if (!k.bot) v.hd++; }
    if (this.m2) M2.onKill(this, v, k);
    this.dropFlagOf(v);
    this.broadcast({ t: 'kill', k: k.id, v: v.id, st: this.time });
    this.dirty = true;
    if (this.round) this.roundCheck(); else this.checkScore();
  }

  /* ---------------- objectives ---------------- */
  dropFlagOf(p) {
    if (!this.flags) return;
    for (const f of Object.values(this.flags)) if (f.s === 'carried' && f.c === p.id) {
      f.s = 'dropped'; f.c = 0; f.x = p.s.x; f.z = p.s.z; f.at = this.time + GAME.CTF.RETURN_S * 1000;
      this.sendObj('drop', f.team, p.id);
    }
  }
  stepCTF(list) {
    const C = GAME.CTF;
    for (const f of Object.values(this.flags)) {
      if (f.s === 'carried') { const c = this.players.get(f.c); if (c && c.alive) { f.x = c.s.x; f.z = c.s.z; } }
      else if (f.s === 'dropped' && this.time >= f.at) { f.s = 'home'; [f.x, f.z] = f.home; this.sendObj('return', f.team, 0); }
    }
    for (const p of list) {
      if (!p.alive || !this.flags[p.team]) continue;
      const mine = this.flags[p.team], theirs = this.flags[OTHER[p.team]];
      if (theirs.s !== 'carried' && dist(p.s.x, p.s.z, theirs.x, theirs.z) < C.TAKE_RADIUS) {
        theirs.s = 'carried'; theirs.c = p.id; if (p.cloakT) AB.abReveal(this, p); this.sendObj('take', theirs.team, p.id);
      }
      if (mine.s === 'dropped' && dist(p.s.x, p.s.z, mine.x, mine.z) < C.TAKE_RADIUS) {
        mine.s = 'home'; [mine.x, mine.z] = mine.home; p.obj++; this.sendObj('return', mine.team, p.id);
      }
      if (theirs.s === 'carried' && theirs.c === p.id && mine.s === 'home' && dist(p.s.x, p.s.z, mine.home[0], mine.home[1]) < C.CAPTURE_RADIUS) {
        theirs.s = 'home'; theirs.c = 0; [theirs.x, theirs.z] = theirs.home; this.score[p.team]++; p.obj += 3; p.caps++;
        this.sendObj('cap', theirs.team, p.id); this.dirty = true; this.checkScore();
        if (this.state !== 'playing') return;
      }
    }
  }
  stepKOH(list) {
    const Z = this.zone, n = { blue: 0, red: 0 };
    for (const p of list) if (p.alive && n[p.team] !== undefined && dist(p.s.x, p.s.z, Z.x, Z.z) < Z.r) n[p.team]++;
    const own = n.blue && n.red ? 'contested' : n.blue ? 'blue' : n.red ? 'red' : null;
    let changed = own !== Z.own; Z.own = own;
    if (own === 'blue' || own === 'red') {
      Z.acc[own] += DT;
      if (Z.acc[own] >= 1) {
        Z.acc[own] -= 1; this.score[own]++; changed = true;
        for (const p of list) if (p.alive && p.team === own && dist(p.s.x, p.s.z, Z.x, Z.z) < Z.r) { p.obj++; p.zone++; }
        this.checkScore();
        if (this.state === 'playing' && Math.max(this.score.blue, this.score.red) >= Z.next && Z.next < GAME.MODES.koh.scoreLimit) { Z.next += GAME.MODES.koh.moveEvery; this.moveZone(); return; }
      }
    }
    if (changed && this.state === 'playing') this.sendObj();
  }
  moveZone() {
    const Z = this.zone, H = this.hillOrder; if (!H || H.length < 2) return;
    Z.n = (Z.n + 1) % H.length; [Z.x, Z.z] = H[Z.n]; Z.own = null; Z.acc = { blue: 0, red: 0 };
    this.sendObj('zmove'); this.dirty = true;
  }
  objInfo(ev, team, by) {
    const o = { t: 'obj', mode: this.mode, score: this.score, st: this.time };
    if (ev) { o.ev = ev; o.team = team; o.by = by; }
    if (this.flags) o.flags = Object.fromEntries(Object.entries(this.flags).map(([t, f]) => [t, { s: f.s, c: f.c, x: +f.x.toFixed(2), z: +f.z.toFixed(2), hx: f.home[0], hz: f.home[1] }]));
    if (this.zone) o.zone = { x: this.zone.x, z: this.zone.z, r: this.zone.r, own: this.zone.own };
    if (this.round) o.round = { n: this.round.n, phase: this.round.phase, winner: this.round.winner, left: Math.max(0, Math.round((this.round.until - this.time) / 1000)),
      alive: { blue: [...this.players.values()].filter(p => p.alive && p.team === 'blue').length, red: [...this.players.values()].filter(p => p.alive && p.team === 'red').length } };
    if (this.m2) M2.objInfo(this, o);
    return o;
  }
  sendObj(ev, team, by) { this.broadcast(this.objInfo(ev, team, by)); }
  botGoal(p, list) {
    if (this.m2) { const g = M2.botGoal(this, p, list); if (g) return g; }
    const alive = (q) => q.alive && this.enemies(p, q);
    if (this.flags) {
      const mine = this.flags[p.team], theirs = this.flags[OTHER[p.team]];
      if (theirs.s === 'carried' && theirs.c === p.id) return { x: mine.home[0], z: mine.home[1], rush: true };
      if (mine.s !== 'home') return { x: mine.x, z: mine.z, rush: mine.s === 'dropped' };
      if (p.id % 3 === 0) return { x: mine.home[0], z: mine.home[1] };   // defender
      return { x: theirs.x, z: theirs.z, rush: theirs.s === 'dropped' };
    }
    if (this.zone) return { x: this.zone.x + ((p.id * 37) % 7) - 3, z: this.zone.z + ((p.id * 53) % 7) - 3 };
    // Otherwise go find the nearest enemy (keeps matches moving on big maps).
    let best = null, bd = 1e9;
    for (const q of list) if (alive(q)) { const d = dist(q.s.x, q.s.z, p.s.x, p.s.z); if (d < bd) { bd = d; best = q; } }
    return best && bd > 20 ? { x: best.s.x, z: best.s.z } : null;
  }

  /* ---------------- the fixed-rate server tick ---------------- */
  update() {
    this.time = this.now();
    this.tick++;
    if (this.state === 'playing') this.simulate();
    else if (this.state === 'loading') this.checkLoaded();
    else if (this.state === 'ended' && this.time >= this.endAt) this.toLobby();
    else if (this.state === 'lobby') this.autoStart();
    if (this.state === 'playing' && this.tick % NET.SNAPSHOT_EVERY === 0) this.sendSnapshots();
    if (this.state === 'playing' && this.round && this.tick % NET.TICK_RATE === 0) this.sendObj();   // round clock + alive counts
    this.infoT += DT;
    if (this.dirty || this.infoT > 2) { this.broadcast(this.roomInfo()); this.dirty = false; this.infoT = 0; }
    // Drop players whose reconnect grace ran out (ranked keeps them: they count as leavers).
    if (this.kind !== 'ranked')
      for (const p of [...this.players.values()])
        if (!p.bot && !p.connected && this.time - p.disconnectedAt > NET.RECONNECT_GRACE_MS) this.removePlayer(p);
  }
  autoStart() {
    if (this.kind === 'quick') {
      if (!this.connectedHumans().length) { this.autoStartAt = 0; return; }
      if (!this.autoStartAt) this.autoStartAt = this.time + GAME.QUICK_COUNTDOWN_S * 1000;
      if (this.time < this.autoStartAt) return;
      while (this.players.size < GAME.QUICK_FILL_TO) this.addBot();
      this.start();
    } else if (this.kind === 'ranked') {
      const need = this.reserved.size, here = this.connectedHumans().length;
      if (here < need && this.time - this.created < GAME.RANKED.START_WAIT_S * 1000) return;
      const teams = new Set(this.connectedHumans().map(p => p.team));
      if (!this.fillBots && (teams.size < 2)) {           // a whole team never showed up: cancel, nobody gains or loses
        this.state = 'closed'; this.dirty = true;
        if (this.onEnd) try { this.onEnd({ ...this.summary(null), cancelled: true }); } catch (e) {}
        return;
      }
      this.start();
    }
  }

  simulate() {
    const list = [...this.players.values()];
    // Every tank needs "all the other live tanks" to bump into. One shared list is built per
    // tick and handed to everybody — collide() skips the tank's own entry (see sim.js).
    const live = [];
    for (const q of list) if (q.alive) live.push(q.s);
    const othersOf = () => live;
    for (const p of list) {
      if (p.bot) {
        if (!p.alive) continue;
        if (p.s.froz > 0) { simulateInput(p.s, CAGED(p), DT, this.map, othersOf(p)); continue; }
        if (this.tick % 15 === p.id % 15) AB.botAbility(this, p, list);        // a few times a second, and only when it makes sense
        let foes = list.filter(q => q.alive && this.enemies(p, q)).map(q => q.s);
        if (this.m2) foes = M2.botTargets(this, p, foes);
        const inp = quantizeInput(p.bot.think(p.s, foes, DT, this.botGoal(p, list)));
        if (simulateInput(p.s, inp, DT, this.map, othersOf(p))) this.fire(p, 0);
        continue;
      }
      if (!p.connected) continue;
      // ---- input jitter buffer (see NET.INPUT_BUFFER_*) ----
      // A cushion of `bufTarget` inputs is built only while the tank is
      // standing at spawn. After that: one input per tick; if an input is
      // late we take a "phantom" step with the previous input (so nobody
      // sees a stall) and repay it one-per-tick once the late inputs arrive.
      const q = p.inputQ;
      if (p.starving) {
        // Wait for a small cushion of inputs — but never wait for ever. If something went
        // wrong on the way in, one input is enough after a second and the tank moves again.
        p.starveT = (p.starveT || 0) + DT;
        if (q.length < p.bufTarget && !(q.length && p.starveT > 1)) { p.nStarve = (p.nStarve || 0) + 1; continue; }
        p.starving = false; p.starveT = 0;
      }
      if (!q.length) {
        if (p.alive && p.lastInput && p.debt < NET.INPUT_BUFFER_MAX + 2) {
          p.debt++; p.nPhantom = (p.nPhantom || 0) + 1;
          simulateInput(p.s, { ...p.lastInput, fire: false }, DT, this.map, othersOf(p));
        } else p.starving = true;
        continue;
      }
      // Jitter got worse mid-match: keep one phantom step instead of repaying it,
      // which grows the cushion by one input without ever pausing the tank.
      const want = Math.min(NET.INPUT_BUFFER_MAX, 1 + Math.ceil((p.arrJit || 0) * 2.5 / (1000 / NET.TICK_RATE)));
      if (p.debt > 0 && p.bufTarget < want) { p.bufTarget++; p.debt--; }
      if (p.debt > 0 && q.length > p.bufTarget) {
        const skip = q.shift(); p.debt--; p.lastSeq = skip.seq; p.lastInput = skip;
        if (p.alive && skip.fire && p.s.reload <= 0) { p.s.reload = GAME.RELOAD_S; p.s.shield = 0; this.fire(p, skip.seq); }
      }
      // Normally one input per tick; catch up gently if a big burst piled up.
      let n = q.length > p.bufTarget + 6 ? 2 : 1;
      while (n-- > 0 && q.length) {
        const inp = q.shift();
        p.lastSeq = inp.seq; p.lastInput = inp;
        if (!p.alive) continue;
        if (p.s.froz > 0) { simulateInput(p.s, CAGED(p), DT, this.map, othersOf(p)); continue; }
        if (inp.ab && !p.abWas) AB.abUse(this, p, inp);
        p.abWas = inp.ab;
        // flying a guided shell: the movement stick steers the shell, so the tank holds still
        const flying = AB.flyingShell(this, p);
        const use = flying ? { ...inp, mag: 0, throttle: 0, steer: 0 } : inp;
        if (simulateInput(p.s, use, DT, this.map, othersOf(p))) this.fire(p, inp.seq);
      }
    }
    // Ramming light props (crates, barrels, tyres, poles, tents) at speed breaks them; trees and palms only need a push.
    for (const p of list) { const sp = Math.abs(p.s.v); if (!p.alive || sp < RAM_SOFT) continue;
      for (const c of this.map.near(p.s.x, p.s.z))
        if (RAMMABLE[c.k] && (sp > 4 || TOPPLE[c.k]) && !this.map.dead[c.i] && dist(p.s.x, p.s.z, c.x, c.z) < c.r + GAME.TANK_RADIUS + 0.35) this.hitProp(c, 9, p.s); }
    // Power-up pads: the server alone decides who picked what up.
    const PU = GAME.POWERUPS, padRespawn = (GAME.MODES[this.mode].padRespawnS || PU.RESPAWN_S) * 1000;
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      if (!pad.on) {
        if (this.time >= pad.at && !this.round) { pad.on = true; pad.type = PU.TYPES[Math.floor(Math.random() * PU.TYPES.length)]; this.dirty = true; }
        continue;
      }
      for (const p of list) {
        if (!p.alive || dist(p.s.x, p.s.z, pad.x, pad.z) > PU.PICKUP_RADIUS) continue;
        if (pad.type === 'shield') p.s.armor = PU.SHIELD_S;
        else if (pad.type === 'speed') p.s.boost = PU.SPEED_S;
        else if (pad.type === 'health') p.hp = p.tank.hp;
        else if (pad.type === 'oneshot') p.oneShot = true;
        else if (pad.type === 'rocket') p.rockets = PU.ROCKETS;
        pad.on = false; pad.at = this.time + padRespawn; this.dirty = true; p.pu++;
        this.broadcast({ t: 'pu', i, id: p.id, type: pad.type, n: pad.type === 'rocket' ? PU.ROCKETS : undefined, st: this.time });
        break;
      }
    }
    // Self-repair (Korek): heals after 3 s without taking damage
    for (const p of list) if (p.alive && p.tank.regen && p.hp < p.tank.hp && this.time - p.lastHit > 3000) p.hp = Math.min(p.tank.hp, p.hp + p.tank.regen * DT);
    // Respawn timers
    for (const p of list) if (!p.alive && p.deadT > 0) { p.deadT -= DT; if (p.deadT <= 0 && p.connected) this.spawn(p); }
    AB.abStep(this, list); if (this.state !== 'playing') return;
    // Shells — the server alone decides what they hit. Suicide cars can be shot down too.
    const targets = list.filter(p => p.alive).map(p => ({ id: p.id, x: p.s.x, z: p.s.z, alive: true }));
    if (this.abDr.length) targets.push(...AB.droneTargets(this));
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      if (this.m2 && M2.shellHitsBall(this, sh)) { this.shells.splice(i, 1); continue; }
      const r = stepShell(sh, DT, this.map, targets);
      if (!r) continue;
      this.shells.splice(i, 1);
      let victim = 0, dmg = 0;
      if (r.hit === 'tank' && r.id >= AB.DRONE_ID0) {           // a shell hit a suicide car
        const d = AB.droneByTarget(this, r.id);
        if (d) { d.hp -= (sh.dmg ? (sh.dmg[0] + sh.dmg[1]) / 2 : 30) * (sh.big ? 4 : 1); }
        this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: 0, dmg: 0, w: 1, st: this.time });
        continue;
      }
      if (r.hit === 'dome') {                                    // the dome skin eats it
        this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: 0, dmg: 0, w: 1, dm: 1, st: this.time });
        continue;
      }
      if (r.hit === 'tank') {
        const v = this.players.get(r.id), k = this.players.get(sh.owner);
        if (v && v.alive && (sh.heal || sh.frz) && AB.abShell(this, sh, v, k)) {
          this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: v.id, dmg: 0, hl: 1, st: this.time });
          continue;
        }
        if (v && v.alive) {
          victim = v.id;
          const d = sh.dmg || [GAME.DAMAGE_MIN, GAME.DAMAGE_MAX];
          let base = d[0] + Math.floor(Math.random() * (d[1] - d[0] + 1));
          if (sh.foeK) base = Math.max(1, Math.round(base * sh.foeK));      // a Repair Shot that hits an enemy hurts half as much
          dmg = this.damage(v, k, base, sh.big);
          this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: victim, dmg, st: this.time });
          if (v.hp <= 0 && v.alive) this.kill(v, k || v);
          if (this.state !== 'playing') return;
          if (sh.splash) this.splash(sh, r, victim);
          if (this.state !== 'playing') return;
          continue;
        }
      }
      this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: 0, dmg: 0, w: r.hit === 'wall' ? 1 : 0, sp: sh.splash ? 1 : 0, st: this.time });
      if (r.c && r.c.wall) AB.abHitWall(this, r.c.wall, sh.big ? 90 : (sh.dmg ? (sh.dmg[0] + sh.dmg[1]) / 2 : 30));
      else if (r.c) this.hitProp(r.c, sh.big ? 9 : 1, { x: r.x - sh.dx * 4, z: r.z - sh.dz * 4 });
      if (sh.splash && r.hit !== 'range') { this.splash(sh, r, 0); if (this.state !== 'playing') return; }
    }
    if (this.rockets.length || this.rkSent) { this.stepRockets(list); if (this.state !== 'playing') return; }
    if (this.m2 && this.state === 'playing') { M2.step(this, list); if (this.state !== 'playing') return; }
    // Objectives
    if (this.flags) this.stepCTF(list);
    if (this.zone && this.mode === 'koh' && this.state === 'playing') this.stepKOH(list);
    if (this.round && this.state === 'playing') {
      if (this.round.phase === 'fight') this.roundCheck();
      else if (this.time >= this.round.until) this.startRound(this.round.n + 1);
    }
    // Ranked: a whole team gone for 30 s loses by forfeit.
    if (this.kind === 'ranked' && this.state === 'playing') for (const t of ['blue', 'red']) {
      const here = list.some(p => p.team === t && p.connected);
      if (here) this.teamGone[t] = 0; else if (!this.teamGone[t]) this.teamGone[t] = this.time;
      else if (this.time - this.teamGone[t] > 30000) { this.end(OTHER[t]); return; }
    }
    if (this.state === 'playing' && this.time >= this.endTime) this.timeUp();
  }

  sendSnapshots() {
    const tanks = [];
    let cloaked = false;
    for (const p of this.players.values()) {
      if (!p.connected && !p.bot) continue;
      if (p.cloakT && p.alive) cloaked = true;
      tanks.push({ id: p.id, cl: !!(p.cloakT && p.alive), tm: p.team,
        flags: (p.alive ? FLAG_ALIVE : 0) | (p.s.shield > 0 ? FLAG_SHIELD : 0) | (p.connected ? FLAG_CONNECTED : 0) | (p.oneShot ? FLAG_ONESHOT : 0) | (p.s.hot ? FLAG_HOT : 0) | (p.cloakT && p.alive ? FLAG_CLOAK : 0) | (p.s.froz > 0 ? FLAG_FROZEN : 0),
        x: p.s.x, z: p.s.z, yaw: p.s.yaw, t: p.s.t, v: p.s.v, w: p.s.w, hp: Math.max(0, p.hp) / p.tank.hp * 100, reload: p.s.reload, shield: p.s.shield, armor: p.s.armor, boost: p.s.boost });
    }
    const body = encodeSnapshotBody(tanks);
    // Somebody is invisible: cut them out of every enemy's snapshot, so not even a
    // modified client can find them. Team-mates and the player himself still see him.
    const bodies = new Map();
    const bodyFor = (p) => {
      if (!cloaked) return body;
      const key = this.isTeam ? p.team : 'p' + p.id;
      if (bodies.has(key)) return bodies.get(key);
      const vis = tanks.filter(t => !t.cl || t.id === p.id || (this.isTeam && t.tm === p.team));
      const b = encodeSnapshotBody(vis); bodies.set(key, b); return b;
    };
    for (const p of this.players.values()) {
      if (p.bot || !p.connected || !p.conn) continue;
      // A client that can't keep up gets this snapshot skipped instead of
      // building a backlog (a backlog is what makes tanks lag seconds behind).
      if (p.conn.congested && p.conn.congested()) { p.skipped = (p.skipped || 0) + 1; continue; }
      p.conn.send(encodeSnapshot(this.tick, this.time, p.lastSeq, bodyFor(p)));
    }
  }

  roomInfo() {
    const M = GAME.MODES[this.mode];
    const left = this.round ? Math.max(0, Math.round((this.round.until - this.time) / 1000)) : Math.max(0, Math.round((this.endTime - this.time) / 1000));
    return { t: 'room', code: this.code, kind: this.kind, host: this.hostId, map: this.mapId, mode: this.mode, tod: this.tod, night: this.night, state: this.state, max: this.maxPlayers,
      limit: M.scoreLimit, timeLeft: this.state === 'playing' ? left : M.timeLimitS,
      startIn: this.state === 'lobby' && this.autoStartAt ? Math.max(0, Math.ceil((this.autoStartAt - this.time) / 1000)) : null,
      winner: this.winner, score: this.score, mvp: this.state === 'ended' ? this.mvp : null, broken: this.state === 'playing' ? this.broken : [],
      pads: this.state === 'playing' ? this.pads.map(p => p.on ? GAME.POWERUPS.TYPES.indexOf(p.type) : -1) : [],
      loadLeft: this.state === 'loading' ? Math.max(0, Math.ceil((this.loadUntil - this.time) / 1000)) : null,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, tag: p.acct ? p.acct.tag : null, team: p.team, ready: p.ready, ld: !!p.loaded, k: p.k, d: p.d, obj: p.obj,
        ping: p.bot ? 0 : p.ping, conn: p.connected, bot: !!p.bot, out: !!p.out, tank: p.tank.id, lvl: p.tank.level, mh: p.tank.hp, sc: this.matchScore(p), dmg: Math.round(p.dmg || 0), ab: abilityOf(p.tank.id), al: AB.abLvlOf(p), vc: !!p.vcOn, medic: abilityOf(p.tank.id) === 'heal' && AB.abReady(p), ...this.m2Info(p) })) };
  }
  m2Info(p) { const o = {}; if (this.m2) M2.playerInfo(this, p, o); return o;
  }
}
