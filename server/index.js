/* =====================================================================
   KURDISH TANK server — one Node process that:
     1. serves the game's web files (so players only need one URL),
     2. runs every match room over WebSockets at a fixed tick rate (/ws),
     3. keeps player accounts, stats, ranks, friends and chat (SQLite),
     4. runs the social hub + ranked matchmaking (/hub) and a small JSON API (/api).
   Zero npm dependencies:  node server/index.js   (Node 22.13 or newer)
   Env: PORT (8080), HOST (0.0.0.0), DATA_DIR (./data — must survive restarts!),
        SIM_LATENCY_MS (fake delay for testing), ADMIN_KEY (to read reports),
        RANKED_BOTS_AFTER_S (60: fill empty ranked seats with bots after this
        long, as an unrated match; 0 = never)
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { attachWebSocket } from './ws.js';
import { Room } from '../client/shared/room.js';
import { NET, GAME, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../client/shared/config.js';
import { PLAY_MAPS, mapForMode } from '../client/shared/maps.js';
import { seasonInfo, quickModeOf } from '../client/shared/ranks.js';
import { Store } from './store.js';
import { Social } from './social.js';
import { Economy, playConfigFromEnv } from './economy.js';
import { CloudBackup, backupConfigFromEnv } from './backup.js';

process.removeAllListeners('warning');           // hide Node's "SQLite is experimental" notice
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const SIM_LATENCY = Number(process.env.SIM_LATENCY_MS) || 0;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const REG_LIMIT = Number(process.env.REG_LIMIT) || 5;      // new accounts per IP per 10 minutes
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';      // shown on the privacy + delete-account pages
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || process.env.PLAY_PACKAGE || '';
const ANDROID_SHA256 = (process.env.ANDROID_SHA256 || '').split(',').map(s => s.trim()).filter(Boolean);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
// Cloud backup (Supabase): bring the saved progress back before the database opens — see server/backup.js
const backupCfg = backupConfigFromEnv(), backup = backupCfg ? new CloudBackup(backupCfg, log) : null;
if (backup) await backup.restore(DATA_DIR);
else log('backup: off (set SUPABASE_URL + SUPABASE_KEY to keep progress when the server restarts)');
const store = new Store(DATA_DIR);
log(`database: ${store.file}`);
if (backup) backup.start(store);
// cheats: ON by default while you are building. Set TEST_CHEATS=0 before you publish.
const economy = new Economy(store, { log, testPayments: process.env.PAYMENTS_TEST === '1', cheats: process.env.TEST_CHEATS !== '0', play: playConfigFromEnv() });
log(`payments: ${economy.play ? 'Google Play' : 'not set up'}${economy.testPayments ? ' + TEST MODE (free gems!)' : ''}`);
if (economy.cheats) log('TEST CHEATS ARE ON — the hidden gem button in Settings gives free gems to anyone who finds it. Set TEST_CHEATS=0 before you publish!');

/* ---------------- static files ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let base = path.join(ROOT, 'client');
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- rooms ---------------- */
const rooms = new Map();
const now = () => performance.now();
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
function makeRoom(opts) {
  const code = newCode();
  const room = new Room(code, { now, log, loadGate: true, ...opts, onEnd: (s) => matchEnded(room, s) });
  rooms.set(code, room);
  return room;
}
// Quick match: join the fullest public room that is still waiting, whatever it is playing.
// A new room draws its mode and its map at random, and draws again after every match.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function quickRoom() {
  let best = null;
  for (const r of rooms.values()) {
    if (r.kind !== 'quick' || r.state === 'ended') continue;
    const humans = r.connectedHumans().length;
    if (humans >= GAME.MAX_PLAYERS) continue;
    if (!best || humans > best.connectedHumans().length) best = r;
  }
  if (best) return best;
  const mode = pick(GAME.QUICK_MODES);
  return makeRoom({ kind: 'quick', mode, map: mapForMode(mode, pick(PLAY_MAPS)) });
}
function createRanked({ map, mode, size, reserved, fillBots, unrated }) {
  const RM = GAME.RANKED.MODES; if (!RM.includes(mode)) mode = RM[Math.floor(Math.random() * RM.length)];
  const room = makeRoom({ kind: 'ranked', mode, map, maxPlayers: size * 2, reserved, fillBots });
  room.unrated = unrated; room.emptySince = 0;
  log(`ranked room ${room.code} ${size}v${size} ${mode} on ${map}${unrated ? ' (unrated, bots fill)' : ''}`);
  return room.code;
}
function matchEnded(room, s) {
  const orig = s;
  if (room.unrated) s = { ...s, kind: 'quick' };           // bot-filled ranked: normal stats, no RP
  let results = [];
  try { results = store.recordMatch(s); } catch (e) { log('record error', e); }
  // Coins, gems, quest progress and rank chests
  try {
    const rw = economy.matchRewards(orig, results, !!room.unrated);
    for (const [acct, r] of rw) { const m = { t: 'reward', ...r }; room.sendAcct(acct, m); social.push(acct, { t: 'wallet', state: economy.state(acct) }); }
  } catch (e) { log('reward error', e); }
  if (room.kind !== 'ranked') return;
  if (room.unrated || s.cancelled) {
    for (const p of s.players) if (p.acct) { const m = { t: 'rp', unrated: !!room.unrated, cancelled: !!s.cancelled }; room.sendAcct(p.acct, m); social.push(p.acct, m); }
    return;
  }
  for (const r of results) { const m = { t: 'rp', ...r }; room.sendAcct(r.acct, m); social.push(r.acct, m); }
}

/* ---------------- JSON API ---------------- */
function authOf(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (\d+)\.([\w-]+)$/);
  return m ? store.auth(Number(m[1]), m[2]) : null;
}
function readBody(req) {
  return new Promise((res) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({}); } });
  });
}
const regLimit = new Map();          // ip → [timestamps]  (5 new accounts per 10 minutes)
async function api(req, res, url) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' }).end(); return; }
  const p = url.pathname, q = url.searchParams, me = authOf(req);
  try {
    if (p === '/api/info') return send(200, { season: seasonInfo(), quickMode: quickModeOf(), online: social.onlineCount(), rooms: rooms.size, contact: CONTACT_EMAIL });
    if (p === '/api/register' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const list = (regLimit.get(ip) || []).filter(t => Date.now() - t < 600000);
      if (list.length >= REG_LIMIT) return send(429, { error: 'too_many' });
      const b = await readBody(req); const r = store.register(b.name, { birthYear: b.birthYear, city: b.city });
      if (r.error) return send(400, r);
      list.push(Date.now()); regLimit.set(ip, list);
      return send(200, r);
    }
    if (p === '/api/me') { if (!me) return send(401, { error: 'auth' }); return send(200, store.profile(me.id)); }
    if (p === '/api/delete-account' && req.method === 'POST') {
      if (!me) return send(401, { error: 'auth' });
      social.dropAccount(me.id);
      const r = store.deleteAccount(me.id); log(`account #${me.id} deleted by its owner`);
      return send(r.error ? 400 : 200, r);
    }
    if (p === '/api/delete-request' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const list = (regLimit.get('del:' + ip) || []).filter(t => Date.now() - t < 3600000);
      if (list.length >= 3) return send(429, { error: 'too_many' });
      const b = await readBody(req);
      if (!b.player || !b.contact) return send(400, { error: 'bad' });
      list.push(Date.now()); regLimit.set('del:' + ip, list);
      store.deleteRequest(b.player, b.contact, b.note); log('deletion request received');
      return send(200, { ok: true });
    }
    if (p === '/api/admin/delete-requests') { if (!ADMIN_KEY || q.get('key') !== ADMIN_KEY) return send(403, { error: 'forbidden' }); return send(200, store.deleteRequests()); }
    if (p === '/api/rename' && req.method === 'POST') {
      if (!me) return send(401, { error: 'auth' });
      const r = store.rename(me.id, (await readBody(req)).name); return send(r.error ? 400 : 200, r);
    }
    if (p === '/api/profile') {
      const a = q.get('id') ? store.get(Number(q.get('id'))) : store.findNameTag(q.get('tag'));
      const prof = a && store.profile(a.id, me ? me.id : 0);
      if (prof && economy) { try { prof.garage = economy.publicGarage(a.id); } catch (e) {} }   // their tanks, so friends can see what they play
      return prof ? send(200, prof) : send(404, { error: 'not_found' });
    }
    if (p === '/api/profile-set' && req.method === 'POST') {
      if (!me) return send(401, { error: 'auth' });
      const b = await readBody(req);
      return send(200, store.setProfile(me.id, { city: b.city, birthYear: b.birthYear }));
    }
    if (p === '/api/leaderboard') {
      const board = ['kills', 'wins', 'rank'].includes(q.get('board')) ? q.get('board') : 'kills';
      const period = q.get('period') === 'all' ? 'all' : 'season';
      const scope = q.get('scope') === 'friends' && me ? 'friends' : 'global';
      return send(200, store.leaderboard(board, period, scope, me ? me.id : 0));
    }
    if (p === '/api/admin/reports') { if (!ADMIN_KEY || q.get('key') !== ADMIN_KEY) return send(403, { error: 'forbidden' }); return send(200, store.reports()); }
    return send(404, { error: 'not_found' });
  } catch (e) { log('api error', e); return send(500, { error: 'server' }); }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true })); return; }
  // Digital Asset Links: proves to Android that this website and the Play Store app belong together
  // (without it the app shows a browser address bar). Set ANDROID_PACKAGE + ANDROID_SHA256.
  if (url.pathname === '/.well-known/assetlinks.json') {
    const body = ANDROID_PACKAGE && ANDROID_SHA256.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_SHA256 } }] : [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(body, null, 2)); return;
  }
  if (url.pathname === '/privacy' || url.pathname === '/delete-account') { req.url = url.pathname + '.html'; }
  // Files the service worker saves for offline use (everything the game itself needs).
  if (url.pathname === '/sw-files.json') {
    const out = [], base = path.join(ROOT, 'client');
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (/\.(js|css|png|jpg|html|webmanifest)$/.test(f.name) && !/(studio|trailer)/.test(f.name) && f.name !== 'sw.js') out.push(path.relative(base, p).split(path.sep).join('/')); } };
    try { walk(base); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(out)); return;
  }
  if (url.pathname === '/stats') {
    const r = [...rooms.values()].map(x => ({ code: x.code, kind: x.kind, mode: x.mode, state: x.state, map: x.mapId, players: x.players.size, humans: x.connectedHumans().length }));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rooms: r, online: social.onlineCount(), tickRate: NET.TICK_RATE })); return;
  }
  if (url.pathname.startsWith('/api/')) { api(req, res, url); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res);
});

/* ---------------- social hub ---------------- */
const social = new Social({ store, log, createRanked, economy, botsAfterS: process.env.RANKED_BOTS_AFTER_S != null ? Number(process.env.RANKED_BOTS_AFTER_S) : 60 });

/* ---------------- game connections ---------------- */
function gameConnection(ws) {
  ws.sendDelay = SIM_LATENCY;
  let room = null, player = null, acct = null;
  const helloTimer = setTimeout(() => { if (!player) ws.close(1008); }, 15000);
  const busy = () => { if (acct) social.setStatus(acct.id, { s: 'match', kind: room.kind, mode: room.mode, map: room.mapId }); };
  ws.on('message', (data, isBinary) => {
    if (player) {
      if (isBinary) room.onBinary(player, data);
      else {
        let m; try { m = JSON.parse(data); } catch (e) { return; }
        room.onJSON(player, m);
        if (m.t === 'leave') { if (acct) social.setStatus(acct.id, { s: 'menu' }); player = null; room = null; }
      }
      return;
    }
    // First message must be {t:'hello', name, token, action:'create'|'join'|'quick'|'ranked', code, auth:{id,secret}}
    if (isBinary) return;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t !== 'hello') return;
    const fail = (code, msg) => ws.send(JSON.stringify({ t: 'error', code, msg }));
    const a = m.auth ? store.auth(m.auth.id, m.auth.secret) : null;
    if (a && a.banned) return fail('banned', 'This account is blocked.');
    acct = a ? { id: a.id, name: a.name, tag: a.tag, tank: economy.loadout(a.id) } : null;
    if (m.action === 'create') {
      room = makeRoom({ kind: 'private' });
      log(`room ${room.code} created`);
    } else if (m.action === 'quick') {
      room = quickRoom();
    } else {
      const code = String(m.code || '').toUpperCase().trim();
      room = rooms.get(code);
      if (!room) return fail('no_room', `No room with code ${code}. Check the code or create a new room.`);
      if (room.kind === 'ranked' && !acct) return fail('need_account', 'Sign in to play ranked.');
    }
    const r = room.join(ws, m.name, String(m.token || '').slice(0, 64), acct);
    if (r.error) { fail(room.kind === 'ranked' ? 'not_yours' : 'full', r.error); room = null; return; }
    player = r; clearTimeout(helloTimer); busy();
    // The room is built with the choices already made in setup — mode first, since it decides
    // which maps are legal — rather than created bare and then reconfigured in three messages.
    if (m.action === 'create') {
      if (m.mode) room.onJSON(player, { t: 'mode', mode: m.mode });
      if (m.map) room.onJSON(player, { t: 'map', map: m.map });
      if (m.tod) room.onJSON(player, { t: 'tod', v: m.tod });
    }
    // A squad stays together: whatever room its leader walks into, the rest are taken along.
    // Ranked is left alone — matchmaking already keeps squads on the same side.
    if (acct && room.kind !== 'ranked') {
      const n = social.pullParty(acct.id, room.code);
      if (n) log(`room ${room.code}: ${n} squad member(s) pulled in behind ${acct.name}`);
    }
  });
  ws.on('close', () => { clearTimeout(helloTimer); if (room && player) room.disconnect(player); if (acct && player) social.setStatus(acct.id, { s: 'menu' }); });
}
attachWebSocket(server, { '/ws': gameConnection, '/hub': (ws) => social.attach(ws) });

/* ---------------- fixed-rate simulation loop ----------------
   Every room advances exactly NET.TICK_RATE times per second. The loop
   corrects for timer drift, and if the process stalls it catches up a few
   ticks instead of slowing the game down. */
const TICK_MS = 1000 / NET.TICK_RATE;
let nextTick = performance.now();
function loop() {
  const t = performance.now();
  let steps = 0;
  while (t >= nextTick && steps < 5) {
    for (const [code, room] of rooms) {
      try { room.update(); } catch (e) { log('room error', code, e); }
      const empty = !room.connectedHumans().length && room.emptySince && t - room.emptySince > NET.RECONNECT_GRACE_MS;
      if (empty || room.state === 'closed' && t - (room.closedAt ??= t) > 5000) { rooms.delete(code); log(`room ${code} closed`); }
    }
    nextTick += TICK_MS; steps++;
  }
  if (t - nextTick > 500) nextTick = t;           // don't spiral after a long stall
  setTimeout(loop, Math.max(0, nextTick - performance.now()));
}
loop();

server.listen(PORT, HOST, () => log(`Kurdish Tank server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (tick ${NET.TICK_RATE} Hz, snapshots ${NET.TICK_RATE / NET.SNAPSHOT_EVERY}/s${SIM_LATENCY ? `, simulated latency ${SIM_LATENCY} ms` : ''})`));
let stopping = false;
const shutdown = async () => {
  if (stopping) return; stopping = true;
  if (backup) { try { await Promise.race([backup.stop(), new Promise(r => setTimeout(r, 8000))]); } catch (e) {} }
  store.close(); process.exit(0);
};
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
