/* =====================================================================
   STORE — player accounts, stats, ranks, friends, chat, match history,
   reports. One SQLite file (Node's built-in node:sqlite, no npm needed).

   File: $DATA_DIR/kurdish-tank.db  (default ./data). On hosts that wipe
   the disk on restart (Render free), point DATA_DIR at a persistent disk
   or accounts are lost — see DEPLOY.md.

   Accounts have no password: the game creates one with a random secret
   and keeps it on the device. The player's public identity is Name#1234.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { GAME } from '../client/shared/config.js';
import { rankOf, seasonInfo, seasonResetRp, LEGEND_TOP } from '../client/shared/ranks.js';
import { cleanName } from '../client/shared/room.js';
import { cleanText, badName } from './filter.js';

const R = GAME.RANKED;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const RENAME_EVERY_MS = 30 * 86400000;
export class Store {
  constructor(dir = process.env.DATA_DIR || path.resolve('data')) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'kurdish-tank.db');
    const db = this.db = new DatabaseSync(this.file);
    db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, tag TEXT NOT NULL, secret TEXT NOT NULL,
        created INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
        season INTEGER NOT NULL DEFAULT 1, rp INTEGER NOT NULL DEFAULT ${R.START_RP}, placed INTEGER NOT NULL DEFAULT 0,
        best_rp INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
        s_kills INTEGER NOT NULL DEFAULT 0, s_deaths INTEGER NOT NULL DEFAULT 0, s_wins INTEGER NOT NULL DEFAULT 0, s_matches INTEGER NOT NULL DEFAULT 0,
        maps TEXT NOT NULL DEFAULT '{}', modes TEXT NOT NULL DEFAULT '{}');
      CREATE UNIQUE INDEX IF NOT EXISTS acc_nametag ON accounts(name_key, tag);
      -- age_group is 'kid' (under 13), 'teen' (13-17) or 'adult'. We deliberately do NOT
      -- keep a birth date: the stores treat a child's date of birth as personal data.
      CREATE INDEX IF NOT EXISTS acc_rp ON accounts(season, placed, rp);
      CREATE TABLE IF NOT EXISTS friends (a INTEGER NOT NULL, b INTEGER NOT NULL, status TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (a, b));
      CREATE INDEX IF NOT EXISTS fr_b ON friends(b);
      CREATE TABLE IF NOT EXISTS blocks (a INTEGER NOT NULL, b INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (a, b));
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS msg_pair ON messages(a, b, id);
      CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL, map TEXT NOT NULL, winner TEXT, secs INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS match_players (match INTEGER NOT NULL, acct INTEGER NOT NULL, team TEXT, k INTEGER, d INTEGER, won INTEGER, rp INTEGER, left_early INTEGER, PRIMARY KEY (match, acct));
      CREATE INDEX IF NOT EXISTS mp_acct ON match_players(acct, match);
      CREATE TABLE IF NOT EXISTS delete_requests (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, player TEXT NOT NULL, contact TEXT NOT NULL, note TEXT, done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, reason TEXT NOT NULL, context TEXT NOT NULL);
    `);
    { const cols = new Set(db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name));
      if (!cols.has('renamed_at')) db.exec('ALTER TABLE accounts ADD COLUMN renamed_at INTEGER NOT NULL DEFAULT 0');
      if (!cols.has('age_group')) db.exec("ALTER TABLE accounts ADD COLUMN age_group TEXT NOT NULL DEFAULT ''");
      if (!cols.has('city')) db.exec("ALTER TABLE accounts ADD COLUMN city TEXT NOT NULL DEFAULT ''"); }
    this.q = {};
    const P = (k, sql) => { this.q[k] = db.prepare(sql); };
    P('byId', 'SELECT * FROM accounts WHERE id = ?');
    P('byNameTag', 'SELECT * FROM accounts WHERE name_key = ? AND tag = ?');
    P('tagUsed', 'SELECT 1 FROM accounts WHERE name_key = ? AND tag = ?');
    P('insert', 'INSERT INTO accounts (name, name_key, tag, secret, created, last_seen, season) VALUES (?, ?, ?, ?, ?, ?, ?)');
    P('seen', 'UPDATE accounts SET last_seen = ? WHERE id = ?');
    P('profileSet', 'UPDATE accounts SET age_group = ?, city = ? WHERE id = ?');
    P('friendRow', 'SELECT * FROM friends WHERE a = ? AND b = ?');
    P('friendIns', 'INSERT OR REPLACE INTO friends (a, b, status, ts) VALUES (?, ?, ?, ?)');
    P('friendDel', 'DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)');
    P('friendsOf', "SELECT CASE WHEN a = ? THEN b ELSE a END AS id, status, a AS from_id, ts FROM friends WHERE a = ? OR b = ?");
    P('blocked', 'SELECT 1 FROM blocks WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)');
    P('blockIns', 'INSERT OR IGNORE INTO blocks (a, b, ts) VALUES (?, ?, ?)');
    P('blockDel', 'DELETE FROM blocks WHERE a = ? AND b = ?');
    P('blocksOf', 'SELECT b AS id FROM blocks WHERE a = ?');
    P('msgIns', 'INSERT INTO messages (a, b, kind, text, ts) VALUES (?, ?, ?, ?, ?)');
    P('msgHist', 'SELECT * FROM messages WHERE (a = ? AND b = ?) OR (a = ? AND b = ?) ORDER BY id DESC LIMIT ?');
    P('msgPrune', 'DELETE FROM messages WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND id < ?');
    P('matchIns', 'INSERT INTO matches (ts, kind, mode, map, winner, secs) VALUES (?, ?, ?, ?, ?, ?)');
    P('mpIns', 'INSERT OR REPLACE INTO match_players (match, acct, team, k, d, won, rp, left_early) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    P('recent', 'SELECT m.id, m.ts, m.kind, m.mode, m.map, mp.team, mp.k, mp.d, mp.won, mp.rp, mp.left_early FROM match_players mp JOIN matches m ON m.id = mp.match WHERE mp.acct = ? ORDER BY m.id DESC LIMIT ?');
    P('reportIns', 'INSERT INTO reports (ts, from_id, to_id, reason, context) VALUES (?, ?, ?, ?, ?)');
    P('rankPos', 'SELECT COUNT(*) AS n FROM accounts WHERE season = ? AND placed >= ? AND rp > ? AND banned = 0');
  }

  /* ---------------- accounts ---------------- */
  freeTag(key) {
    for (let i = 0; i < 60; i++) { const tag = String(1000 + crypto.randomInt(9000)); if (!this.q.tagUsed.get(key, tag)) return tag; }
    return null;
  }
  /** Turn a birth year into the only thing we keep: which age group the player is in. */
  static ageGroup(birthYear) {
    const y = Number(birthYear) | 0;
    if (!y || y < 1900 || y > new Date().getUTCFullYear()) return '';
    const age = new Date().getUTCFullYear() - y;
    return age < 13 ? 'kid' : age < 18 ? 'teen' : 'adult';
  }
  register(rawName, opts = {}) {
    const name = cleanName(rawName);
    if (name.length < 2) return { error: 'name_short' };
    if (badName(name)) return { error: 'name_bad' };
    const key = name.toLowerCase(), tag = this.freeTag(key);
    if (!tag) return { error: 'name_taken' };
    const secret = crypto.randomBytes(24).toString('base64url'), now = Date.now();
    const r = this.q.insert.run(name, key, tag, sha(secret), now, now, seasonInfo().n);
    const id = Number(r.lastInsertRowid);
    const group = Store.ageGroup(opts.birthYear), city = String(opts.city || '').slice(0, 40).replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
    if (group || city) this.q.profileSet.run(group || '', city || '', id);
    return { id, name, tag, secret, ageGroup: group, city };
  }
  /** Change the city (or set the age group once, if it was skipped at the start). */
  setProfile(id, { city, birthYear } = {}) {
    const a = this.get(id); if (!a) return { error: 'not_found' };
    const group = a.age_group || Store.ageGroup(birthYear) || '';
    const c = city === undefined ? (a.city || '') : String(city || '').slice(0, 40).replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
    this.q.profileSet.run(group, c, id);
    return { ok: true, ageGroup: group, city: c };
  }
  auth(id, secret) {
    const a = this.q.byId.get(Number(id) || 0);
    if (!a || !secret || a.secret !== sha(String(secret))) return null;
    this.ensureSeason(a);
    this.q.seen.run(Date.now(), a.id);
    return a;
  }
  get(id) { const a = this.q.byId.get(Number(id) || 0); if (a) this.ensureSeason(a); return a || null; }
  findNameTag(s) {
    const m = String(s || '').trim().match(/^(.+?)\s*#\s*(\d{4})$/u);
    if (!m) return null;
    return this.q.byNameTag.get(cleanName(m[1]).toLowerCase(), m[2]) || null;
  }
  rename(id, rawName) {
    const a = this.get(id); if (!a) return { error: 'no_account' };
    const name = cleanName(rawName);
    if (name.length < 2) return { error: 'name_short' };
    if (badName(name)) return { error: 'name_bad' };
    if (name === a.name) return { name, tag: a.tag };
    // A name can be changed once every 30 days (the #tag stays whenever possible).
    const wait = (a.renamed_at || 0) + RENAME_EVERY_MS - Date.now();
    if (wait > 0) return { error: 'name_wait', days: Math.ceil(wait / 86400000) };
    const key = name.toLowerCase();
    const tag = (key === a.name_key || !this.q.tagUsed.get(key, a.tag)) ? a.tag : this.freeTag(key);
    if (!tag) return { error: 'name_taken' };
    this.db.prepare('UPDATE accounts SET name = ?, name_key = ?, tag = ?, renamed_at = ? WHERE id = ?').run(name, key, tag, Date.now(), a.id);
    return { name, tag, nextRename: Date.now() + RENAME_EVERY_MS };
  }
  // New season: soft-reset RP and season stats (done lazily when the account is next used).
  ensureSeason(a) {
    const n = seasonInfo().n;
    if (a.season >= n) return a;
    a.rp = seasonResetRp(a.rp); a.season = n; a.s_kills = a.s_deaths = a.s_wins = a.s_matches = 0; a.streak = 0;
    this.db.prepare('UPDATE accounts SET rp = ?, season = ?, s_kills = 0, s_deaths = 0, s_wins = 0, s_matches = 0, streak = 0 WHERE id = ?').run(a.rp, n, a.id);
    return a;
  }

  /* ---------------- ranks ---------------- */
  rankInfo(a) {
    const placed = a.placed >= R.PLACEMENT;
    if (!placed) return { placed: false, games: a.placed, of: R.PLACEMENT, rp: null };
    const r = rankOf(a.rp);
    let legend = false, pos = null;
    if (r.tier === 'cmd') { pos = this.q.rankPos.get(seasonInfo().n, R.PLACEMENT, a.rp).n + 1; legend = pos <= LEGEND_TOP; }
    const best = a.best_rp ? rankOf(a.best_rp) : null;
    return { placed: true, rp: a.rp, tier: legend ? 'legend' : r.tier, div: legend ? 0 : r.div, next: r.next, pct: r.pct, pos, best: best ? { tier: best.tier, div: best.div, rp: a.best_rp } : null };
  }
  card(a) { return a ? { id: a.id, name: a.name, tag: a.tag, rank: this.rankInfo(a) } : null; }

  /* ---------------- profiles ---------------- */
  profile(id, viewer = 0) {
    const a = this.get(id); if (!a || a.banned) return null;
    const top = (json) => { const o = JSON.parse(json || '{}'); let k = null; for (const x in o) if (!k || o[x] > o[k]) k = x; return k; };
    const out = {
      ...this.card(a), created: a.created, season: seasonInfo(), city: a.city || '',
      season_stats: { kills: a.s_kills, deaths: a.s_deaths, wins: a.s_wins, matches: a.s_matches },
      all_time: { kills: a.kills, deaths: a.deaths, wins: a.wins, matches: a.matches },
      fav_map: top(a.maps), fav_mode: top(a.modes),
      recent: this.q.recent.all(a.id, 10).map(r => ({ ts: r.ts, kind: r.kind, mode: r.mode, map: r.map, k: r.k, d: r.d, won: !!r.won, rp: r.rp, left: !!r.left_early })),
    };
    if (viewer && viewer !== a.id) out.relation = this.relation(viewer, a.id);
    return out;
  }
  relation(me, other) {
    if (this.q.blocked.get(me, other, -1, -1)) return 'blocked';
    const f = this.q.friendRow.get(me, other) || this.q.friendRow.get(other, me);
    if (!f) return 'none';
    if (f.status === 'friends') return 'friends';
    return f.a === me ? 'sent' : 'incoming';
  }

  /* ---------------- leaderboards ---------------- */
  // board: kills | wins | rank · period: season | all · scope: global | friends
  leaderboard(board, period, scope, me = 0, limit = 50) {
    const season = seasonInfo().n;
    const col = board === 'rank' ? (period === 'all' ? 'best_rp' : 'rp') : (period === 'all' ? '' : 's_') + (board === 'wins' ? 'wins' : 'kills');
    let where = 'banned = 0';
    const args = [];
    if (board === 'rank') { where += ' AND placed >= ?'; args.push(R.PLACEMENT); if (period !== 'all') { where += ' AND season = ?'; args.push(season); } else where += ' AND best_rp > 0'; }
    else if (period !== 'all') { where += ' AND season = ? AND ' + col + ' > 0'; args.push(season); }
    else where += ' AND ' + col + ' > 0';
    if (scope === 'friends' && me) { const ids = [me, ...this.friendIds(me)]; where += ` AND id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
    const rows = this.db.prepare(`SELECT * FROM accounts WHERE ${where} ORDER BY ${col} DESC, id ASC LIMIT ${limit | 0}`).all(...args);
    const out = { board, period, scope, rows: rows.map((a, i) => ({ pos: i + 1, ...this.card(a), value: a[col] })) };
    const mine = me && this.get(me);
    if (mine) {
      const val = mine[col];
      const qualifies = board === 'rank' ? mine.placed >= R.PLACEMENT && (period === 'all' ? val > 0 : mine.season === season) : val > 0;
      const n = qualifies ? this.db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE ${where} AND (${col} > ? OR (${col} = ? AND id < ?))`).get(...args, val, val, mine.id).n : null;
      out.me = { pos: qualifies ? n + 1 : null, ...this.card(mine), value: val };
    }
    return out;
  }

  /* ---------------- friends & blocks ---------------- */
  friendIds(me) { return this.q.friendsOf.all(me, me, me).filter(r => r.status === 'friends').map(r => r.id); }
  friendList(me) {
    const rows = this.q.friendsOf.all(me, me, me);
    const blocked = new Set(this.q.blocksOf.all(me).map(r => r.id));
    const pick = (r) => { const a = this.get(r.id); return a ? { ...this.card(a), since: r.ts } : null; };
    return {
      friends: rows.filter(r => r.status === 'friends' && !blocked.has(r.id)).map(pick).filter(Boolean),
      incoming: rows.filter(r => r.status === 'pending' && r.from_id !== me && !blocked.has(r.id)).map(pick).filter(Boolean),
      outgoing: rows.filter(r => r.status === 'pending' && r.from_id === me).map(pick).filter(Boolean),
      blocked: [...blocked].map(id => this.card(this.get(id))).filter(Boolean),
    };
  }
  isBlocked(a, b) { return !!this.q.blocked.get(a, b, b, a); }
  areFriends(a, b) { const f = this.q.friendRow.get(a, b) || this.q.friendRow.get(b, a); return !!f && f.status === 'friends'; }
  /** → { ok, auto? } or { error } */
  friendRequest(me, target) {
    const b = typeof target === 'number' ? this.get(target) : this.findNameTag(target);
    if (!b || b.banned) return { error: 'not_found' };
    if (b.id === me) return { error: 'self' };
    if (this.isBlocked(me, b.id)) return { error: 'blocked' };
    const mine = this.q.friendRow.get(me, b.id), theirs = this.q.friendRow.get(b.id, me);
    if ((mine && mine.status === 'friends') || (theirs && theirs.status === 'friends')) return { error: 'already', id: b.id };
    if (theirs && theirs.status === 'pending') { this.q.friendIns.run(b.id, me, 'friends', Date.now()); return { ok: true, auto: true, id: b.id }; }
    if (this.q.friendsOf.all(me, me, me).length >= 200) return { error: 'too_many' };
    this.q.friendIns.run(me, b.id, 'pending', Date.now());
    return { ok: true, id: b.id };
  }
  friendAccept(me, other) {
    const r = this.q.friendRow.get(other, me);
    if (!r || r.status !== 'pending') return { error: 'no_request' };
    this.q.friendIns.run(other, me, 'friends', Date.now()); return { ok: true };
  }
  friendRemove(me, other) { this.q.friendDel.run(me, other, other, me); return { ok: true }; }   // also declines / cancels
  block(me, other) { if (me === other) return { error: 'self' }; this.q.blockIns.run(me, other, Date.now()); this.q.friendDel.run(me, other, other, me); return { ok: true }; }
  unblock(me, other) { this.q.blockDel.run(me, other); return { ok: true }; }

  /* ---------------- chat ---------------- */
  /** Only friends can message each other; text is filtered. → saved message or { error } */
  sendMessage(from, to, text, kind = 'text') {
    if (!this.areFriends(from, to)) return { error: 'not_friends' };
    if (this.isBlocked(from, to)) return { error: 'blocked' };
    const clean = kind === 'text' ? cleanText(text) : String(text).slice(0, 40);
    if (!clean) return { error: 'empty' };
    const ts = Date.now(), r = this.q.msgIns.run(from, to, kind, clean, ts);
    const id = Number(r.lastInsertRowid);
    if (id % 50 === 0) this.q.msgPrune.run(from, to, to, from, id - 300);     // keep the last ~300 per chat
    return { id, from, to, kind, text: clean, ts };
  }
  history(me, other, limit = 60) {
    if (!this.areFriends(me, other)) return [];
    return this.q.msgHist.all(me, other, other, me, limit).reverse().map(m => ({ id: m.id, from: m.a, to: m.b, kind: m.kind, text: m.text, ts: m.ts }));
  }
  report(from, to, reason, context) {
    this.q.reportIns.run(Date.now(), from, to, String(reason || 'other').slice(0, 30), JSON.stringify(context || []).slice(0, 4000));
    return { ok: true };
  }
  reports(limit = 100) { return this.db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?').all(limit); }

  /* ---------------- match results ---------------- */
  /** Records stats for quick-match and ranked games. Returns per-account ranked results. */
  recordMatch(s) {
    if (s.cancelled || (s.kind !== 'quick' && s.kind !== 'ranked')) return [];
    const humans = s.players.filter(p => !p.bot && p.acct);
    if (!humans.length) return [];
    const now = Date.now();
    const winner = s.winner == null ? null : String(s.winner);
    const mid = Number(this.q.matchIns.run(now, s.kind, s.mode, s.map, winner, s.secs | 0).lastInsertRowid);
    const realHumans = s.players.filter(p => !p.bot).length;
    const results = [];
    const ranked = s.kind === 'ranked';
    // Ranked: RP depends on the two teams' average RP.
    const avg = { blue: 0, red: 0 };
    if (ranked) for (const t of ['blue', 'red']) { const ms = humans.filter(p => p.team === t).map(p => this.get(p.acct)?.rp ?? R.START_RP); avg[t] = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : R.START_RP; }
    const score = (p) => p.k * 2 + p.obj - p.d * 0.5;
    let mvp = ranked ? humans.filter(p => !p.left).reduce((b, p) => (!b || score(p) > score(b) ? p : b), null) : null;
    if (mvp && score(mvp) <= 0) mvp = null;
    const draw = winner == null || winner === 'draw';
    this.db.exec('BEGIN');
    try {
      for (const p of humans) {
        const a = this.get(p.acct); if (!a) continue;
        const countsWin = p.won && (ranked || realHumans >= 2);
        const maps = JSON.parse(a.maps || '{}'), modes = JSON.parse(a.modes || '{}');
        maps[s.map] = (maps[s.map] || 0) + 1; if (!ranked) modes[s.mode] = (modes[s.mode] || 0) + 1; else modes.ranked = (modes.ranked || 0) + 1;
        let rpDelta = null; const parts = [];
        const before = { rp: a.rp, rank: this.rankInfo(a) };
        if (ranked) {
          const opp = p.team === 'blue' ? 'red' : 'blue';
          const diff = clamp(Math.round((avg[opp] - avg[p.team]) / 40), -R.SPREAD, R.SPREAD);
          let d = 0, streak = a.streak;
          if (p.left) { d = -R.LEAVE; parts.push(['left', -R.LEAVE]); streak = 0; }
          else if (draw) { parts.push(['draw', 0]); }
          else if (p.won) { d = R.WIN + diff; parts.push(['win', d]); streak++; if (streak >= 3) { d += R.STREAK; parts.push(['streak', R.STREAK]); } }
          else { d = -(R.LOSS - diff); parts.push(['loss', d]); streak = 0; }
          if (mvp === p && !p.left) { d += R.MVP; parts.push(['mvp', R.MVP]); }
          const placing = a.placed < R.PLACEMENT;
          if (placing) { d *= 2; parts.push(['placement', null]); }
          const rp = Math.max(0, a.rp + d), placed = Math.min(R.PLACEMENT, a.placed + 1);
          rpDelta = rp - a.rp;
          const best = placed >= R.PLACEMENT ? Math.max(a.best_rp, rp) : a.best_rp;
          this.db.prepare('UPDATE accounts SET rp = ?, placed = ?, best_rp = ?, streak = ? WHERE id = ?').run(rp, placed, best, streak, a.id);
        }
        const k = p.hk | 0, d = p.hd | 0, w = countsWin ? 1 : 0;
        this.db.prepare(`UPDATE accounts SET kills = kills + ?, deaths = deaths + ?, wins = wins + ?, matches = matches + 1,
          s_kills = s_kills + ?, s_deaths = s_deaths + ?, s_wins = s_wins + ?, s_matches = s_matches + 1, maps = ?, modes = ? WHERE id = ?`)
          .run(k, d, w, k, d, w, JSON.stringify(maps), JSON.stringify(modes), a.id);
        this.q.mpIns.run(mid, a.id, p.team, p.k, p.d, p.won ? 1 : 0, rpDelta, p.left ? 1 : 0);
        if (ranked) { const after = this.get(a.id); results.push({ acct: a.id, won: p.won, draw, left: !!p.left, mvp: mvp === p, parts, delta: rpDelta, before, after: { rp: after.rp, rank: this.rankInfo(after) } }); }
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return results;
  }
  /* ---------------- account deletion (required by Google Play) ---------------- */
  /** Deletes the account and everything tied to it. Purchase receipts are kept without a name (tax/refund records). */
  deleteAccount(id) {
    const a = this.get(id); if (!a) return { error: 'no_account' };
    const tables = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    this.db.exec('BEGIN');
    try {
      const run = (sql, ...args) => this.db.prepare(sql).run(...args);
      run('DELETE FROM friends WHERE a = ? OR b = ?', id, id);
      run('DELETE FROM blocks WHERE a = ? OR b = ?', id, id);
      run('DELETE FROM messages WHERE a = ? OR b = ?', id, id);
      run('DELETE FROM match_players WHERE acct = ?', id);
      run('DELETE FROM reports WHERE from_id = ?', id);
      if (tables.has('tanks')) run('DELETE FROM tanks WHERE acct = ?', id);
      run('DELETE FROM accounts WHERE id = ?', id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return { ok: true };
  }
  deleteRequest(player, contact, note) {
    this.db.prepare('INSERT INTO delete_requests (ts, player, contact, note) VALUES (?, ?, ?, ?)').run(Date.now(), String(player).slice(0, 40), String(contact).slice(0, 120), String(note || '').slice(0, 500));
    return { ok: true };
  }
  deleteRequests() { return this.db.prepare('SELECT * FROM delete_requests ORDER BY id DESC LIMIT 200').all(); }
  close() { try { this.db.close(); } catch (e) {} }
}
