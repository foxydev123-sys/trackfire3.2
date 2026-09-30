/* =====================================================================
   ECONOMY (server side) — everything that gives or costs coins and gems.
   All decisions happen here on the server (the client only asks), so
   nobody can give themselves coins, cards or chests.

   Data per account:  coins, gems, parts, selected tank (columns in accounts)
                      eco JSON (daily streak, wheel, quests, progress, chests)
                      tanks table (upgrades per stat + overall level per tank)
                      purchases table (real-money receipts, each used once)
   ===================================================================== */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { TANKS, TANK_IDS, STARTER, STATS, statCost, modsOf, levelOf, CARD_PARTS } from '../client/shared/tanks.js';
import { abCost, MAX_AB } from '../client/shared/abilities.js';
import { ACH, ACH_BY_ID, achProgress } from '../client/shared/achievements.js';
import { START, MATCH_REWARD, TIER_CHEST, TIER_TANK, CHESTS, WHEEL, DAILY, QUESTS, QUEST_BONUS, TANK_QUESTS, PACK_GEMS, PACK_CARDS, COIN_PACKS, PARTS_PACKS, GEM_PRODUCTS, dayKey } from '../client/shared/economy.js';
import { quickModeOf, seasonInfo, rankOf } from '../client/shared/ranks.js';
import { GAME } from '../client/shared/config.js';

const rint = (a, b) => (b <= a ? a : a + crypto.randomInt(b - a + 1));
const TIER_ORDER = ['bronze', 'silver', 'gold', 'plat', 'dia', 'cmd', 'legend'];
const prevDay = (key) => dayKey(Date.parse(key + 'T12:00:00Z') - 86400000);

export class Economy {
  constructor(store, opts = {}) {
    this.store = store; this.db = store.db; this.log = opts.log || (() => {});
    this.testPayments = !!opts.testPayments;
    // The hidden "give me gems" button in Settings. ON while you are building the game.
    // Set TEST_CHEATS=0 on the server before you publish, or any player who finds it
    // (seven taps on the game name in Settings) gets free gems.
    this.cheats = opts.cheats !== false;
    this.play = opts.play || null;               // { packageName, serviceAccount } for Google Play verification
    const cols = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name));
    if (!cols.has('coins')) this.db.exec(`ALTER TABLE accounts ADD COLUMN coins INTEGER NOT NULL DEFAULT ${START.coins}`);
    if (!cols.has('gems')) this.db.exec(`ALTER TABLE accounts ADD COLUMN gems INTEGER NOT NULL DEFAULT ${START.gems}`);
    if (!cols.has('sel_tank')) this.db.exec(`ALTER TABLE accounts ADD COLUMN sel_tank TEXT NOT NULL DEFAULT '${STARTER}'`);
    if (!cols.has('eco')) this.db.exec(`ALTER TABLE accounts ADD COLUMN eco TEXT NOT NULL DEFAULT '{}'`);
    if (!cols.has('parts')) this.db.exec(`ALTER TABLE accounts ADD COLUMN parts INTEGER NOT NULL DEFAULT ${START.parts}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tanks (acct INTEGER NOT NULL, tank TEXT NOT NULL, level INTEGER NOT NULL, cards INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (acct, tank));
      CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY, acct INTEGER NOT NULL, provider TEXT NOT NULL, product TEXT NOT NULL, token TEXT NOT NULL UNIQUE, order_id TEXT, gems INTEGER NOT NULL, usd REAL, ts INTEGER NOT NULL);
    `);
    { const tc = new Set(this.db.prepare('PRAGMA table_info(tanks)').all().map(c => c.name));
      if (!tc.has('mods')) this.db.exec(`ALTER TABLE tanks ADD COLUMN mods TEXT NOT NULL DEFAULT ''`); }
    const P = (sql) => this.db.prepare(sql);
    this.q = {
      acc: P('SELECT id, coins, gems, parts, sel_tank, eco, rp, placed, best_rp FROM accounts WHERE id = ?'),
      wallet: P('UPDATE accounts SET coins = ?, gems = ?, parts = ? WHERE id = ?'),
      eco: P('UPDATE accounts SET eco = ? WHERE id = ?'),
      sel: P('UPDATE accounts SET sel_tank = ? WHERE id = ?'),
      tanks: P('SELECT tank, level, cards, mods FROM tanks WHERE acct = ?'),
      tank: P('SELECT level, cards, mods FROM tanks WHERE acct = ? AND tank = ?'),
      tankSet: P('INSERT OR REPLACE INTO tanks (acct, tank, level, cards, mods) VALUES (?, ?, ?, ?, ?)'),
      purchase: P('INSERT INTO purchases (acct, provider, product, token, order_id, gems, usd, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      tokenUsed: P('SELECT 1 FROM purchases WHERE token = ?'),
    };
  }

  /* ---------------- loading / saving ---------------- */
  load(id) {
    const a = this.q.acc.get(id); if (!a) return null;
    let eco; try { eco = JSON.parse(a.eco || '{}'); } catch (e) { eco = {}; }
    eco.daily ||= { last: null, day: 0 }; eco.wheel ||= { date: null, free: 0, paid: 0 };
    eco.prog ||= { matches: 0, wins: 0, kills: 0, pu: 0, dmg: 0, questsDone: 0, streak: 0 };
    // lifetime counters the achievements read (older saves just start at 0)
    for (const k of ['deaths', 'ranked', 'rankedWins', 'caps', 'zone', 'abUses', 'mvp', 'obj', 'chests', 'upgrades']) eco.prog[k] ||= 0;
    eco.prog.modes ||= {};
    eco.ach ||= { got: [] };
    eco.chests ||= {}; eco.tq ||= []; eco.tiers ||= { season: 0, got: [] }; eco.dayMatches ||= { date: null, n: 0 };
    const tanks = {}; let legacyCards = 0;
    for (const r of this.q.tanks.all(id)) {
      let mods; try { mods = r.mods ? JSON.parse(r.mods) : null; } catch (e) { mods = null; }
      if (!mods) {                                   // saved before per-stat upgrades: spread the old level over the stats, spare cards become parts
        mods = modsOf(r.level); legacyCards += (r.cards || 0) * CARD_PARTS[(TANKS[r.tank] || TANKS.zagros).rarity];
        this.q.tankSet.run(id, r.tank, levelOf(mods), 0, JSON.stringify(mods));
      }
      mods = modsOf(mods); tanks[r.tank] = { level: levelOf(mods), mods };
    }
    if (!tanks[STARTER]) { tanks[STARTER] = { level: 1, mods: modsOf({}) }; this.q.tankSet.run(id, STARTER, 1, 0, JSON.stringify(tanks[STARTER].mods)); }
    const w = { id, coins: a.coins, gems: a.gems, parts: a.parts || 0, sel: tanks[a.sel_tank] ? a.sel_tank : STARTER, eco, tanks, rp: a.rp, placed: a.placed, best_rp: a.best_rp };
    if (legacyCards) { w.parts += legacyCards; this.q.wallet.run(w.coins, w.gems, w.parts, id); }
    this.ensureQuests(w);
    return w;
  }
  save(w) { this.q.wallet.run(Math.max(0, w.coins | 0), Math.max(0, w.gems | 0), Math.max(0, w.parts | 0), w.id); this.q.eco.run(JSON.stringify(w.eco), w.id); }
  setTank(w, id, mods) { mods = modsOf(mods); w.tanks[id] = { level: levelOf(mods), mods }; this.q.tankSet.run(w.id, id, levelOf(mods), 0, JSON.stringify(mods)); }
  tx(fn) { this.db.exec('BEGIN'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }

  /** The tank an account plays with (used when joining a match). */
  loadout(id) { const w = this.load(id); if (!w) return { id: STARTER, level: 1 }; const t = w.tanks[w.sel]; return { id: w.sel, level: t.level, mods: t.mods }; }
  power(id) { return this.loadout(id).level; }
  /** What other players may see of someone's garage: the tanks they own and how far each is upgraded. */
  publicGarage(id) {
    const w = this.load(id); if (!w) return null;
    const tanks = Object.entries(w.tanks).map(([t, v]) => ({ id: t, level: v.level, ab: (v.mods && v.mods.ab) | 0, pts: STATS.reduce((a, k) => a + (v.mods[k] | 0), 0) }))
      .sort((a, b) => b.level - a.level || b.pts - a.pts);
    return { sel: w.sel, owned: tanks.length, total: TANK_IDS.length, tanks: tanks.slice(0, 8) };
  }

  /* ---------------- what the client sees ---------------- */
  state(id) {
    const w = this.load(id); if (!w) return null;
    const today = dayKey(), E = w.eco;
    const canDaily = E.daily.last !== today;
    const nextDay = canDaily ? (E.daily.last === prevDay(today) ? E.daily.day % 7 : 0) : (E.daily.day - 1 + 7) % 7;
    const wheelToday = E.wheel.date === today ? E.wheel : { free: 0, paid: 0 };
    const tq = {};
    for (const [tid, q] of Object.entries(TANK_QUESTS)) tq[tid] = { stat: q.stat, need: q.need, prog: Math.min(q.need, this.tqProgress(w, q)), done: E.tq.includes(tid) };
    return {
      coins: w.coins, gems: w.gems, parts: w.parts, sel: w.sel, tanks: w.tanks,
      daily: { canClaim: canDaily, day: nextDay, streak: E.prog.streak },
      ach: this.achState(w),
      wheel: { free: wheelToday.free < 1, paidLeft: WHEEL.maxPaidPerDay - wheelToday.paid },
      quests: E.quests, tankQuests: tq, chests: E.chests, starterBought: !!E.starter,
      payments: { test: this.testPayments, play: !!this.play }, cheats: this.cheats,
    };
  }
  /** The lifetime numbers the achievements are measured against. */
  achProg(w) {
    const P = w.eco.prog, tiers = ['bronze', 'silver', 'gold', 'plat', 'dia', 'cmd', 'legend'];
    const best = w.placed >= GAME.RANKED.PLACEMENT && w.best_rp ? tiers.indexOf(rankOf(w.best_rp).tier) : 0;
    return { ...P, tanks: Object.keys(w.tanks).length, tier: Math.max(0, best), streak: P.streak || 0 };
  }
  /** Every achievement with how far along it is and whether the reward is waiting. */
  achState(w) {
    const prog = this.achProg(w), got = w.eco.ach.got;
    let ready = 0, done = 0;
    const list = ACH.map(a => {
      const n = Math.min(a.need, achProgress(a, prog)), claimed = got.includes(a.id);
      if (claimed) done++; else if (n >= a.need) ready++;
      return { id: a.id, prog: n, claimed };
    });
    return { list, ready, done, total: ACH.length };
  }
  /** Claim one finished achievement. */
  claimAch(id, achId) {
    const a = ACH_BY_ID[achId]; if (!a) return { error: 'bad' };
    return this.tx(() => {
      const w = this.load(id); if (!w) return { error: 'bad' };
      if (w.eco.ach.got.includes(achId)) return { error: 'already' };
      if (achProgress(a, this.achProg(w)) < a.need) return { error: 'not_ready' };
      const got = {};
      if (a.reward.coins) this.give(w, { kind: 'coins', n: a.reward.coins }, got);
      if (a.reward.gems) this.give(w, { kind: 'gems', n: a.reward.gems }, got);
      w.eco.ach.got.push(achId);
      this.save(w);
      return { ok: true, id: achId, got };
    });
  }
  tqProgress(w, q) {
    if (q.stat === 'bestTier') { const t = w.placed >= GAME.RANKED.PLACEMENT && w.best_rp ? TIER_ORDER.indexOf(rankOf(w.best_rp).tier) : 0; return Math.max(0, t); }
    return w.eco.prog[q.stat] || 0;
  }

  /* ---------------- rewards (shared helper) ---------------- */
  // r = {kind:'coins'|'gems'|'chest', n}. Chests go to the account's chest inventory.
  give(w, r, out) {
    if (r.kind === 'coins') { w.coins += r.n; out.coins = (out.coins || 0) + r.n; }
    else if (r.kind === 'gems') { w.gems += r.n; out.gems = (out.gems || 0) + r.n; }
    else if (r.kind === 'parts') { w.parts += r.n; out.parts = (out.parts || 0) + r.n; }
    else if (r.kind === 'chest') { w.eco.chests[r.n] = (w.eco.chests[r.n] || 0) + 1; (out.chests ||= []).push(r.n); }
  }
  pay(w, cost) {
    if ((cost.coins || 0) > w.coins) return 'no_coins';
    if ((cost.gems || 0) > w.gems) return 'no_gems';
    if ((cost.parts || 0) > w.parts) return 'no_parts';
    w.coins -= cost.coins || 0; w.gems -= cost.gems || 0; w.parts -= cost.parts || 0; return null;
  }

  /* ---------------- daily login ---------------- */
  claimDaily(id) {
    return this.tx(() => {
      const w = this.load(id), E = w.eco, today = dayKey();
      if (E.daily.last === today) return { error: 'already' };
      const cont = E.daily.last === prevDay(today);
      const idx = cont ? E.daily.day % 7 : 0;
      E.prog.streak = cont ? (E.prog.streak || 0) + 1 : 1;
      E.daily = { last: today, day: idx + 1 };
      const out = {}; for (const r of DAILY[idx]) this.give(w, r, out);
      this.save(w); return { ok: true, day: idx, got: out };
    });
  }

  /* ---------------- lucky wheel ---------------- */
  spin(id, paid) {
    return this.tx(() => {
      const w = this.load(id), today = dayKey();
      if (w.eco.wheel.date !== today) w.eco.wheel = { date: today, free: 0, paid: 0 };
      const W = w.eco.wheel;
      if (!paid && W.free >= 1) return { error: 'no_free_spin' };
      if (paid) { if (W.paid >= WHEEL.maxPaidPerDay) return { error: 'no_spins_left' }; const e = this.pay(w, { gems: WHEEL.spinGems }); if (e) return { error: e }; W.paid++; }
      else W.free++;
      let roll = crypto.randomInt(10000) / 100, i = 0;
      for (; i < WHEEL.segments.length - 1; i++) { roll -= WHEEL.segments[i].p; if (roll < 0) break; }
      const seg = WHEEL.segments[i], out = {};
      this.give(w, { kind: seg.kind, n: seg.n }, out);
      this.save(w); return { ok: true, index: i, got: out };
    });
  }

  /* ---------------- chests ---------------- */
  buyChest(id, type, currency) {
    const C = CHESTS[type]; if (!C) return { error: 'bad' };
    const price = currency === 'gems' ? C.price.gems : C.price.coins;
    if (!price) return { error: 'bad' };
    return this.tx(() => {
      const w = this.load(id), e = this.pay(w, { [currency === 'gems' ? 'gems' : 'coins']: price });
      if (e) return { error: e };
      const res = this.openInto(w, type); this.save(w); return { ok: true, opened: res };
    });
  }
  openOwned(id, type) {
    return this.tx(() => {
      const w = this.load(id);
      if (!(w.eco.chests[type] > 0)) return { error: 'no_chest' };
      w.eco.chests[type]--; if (!w.eco.chests[type]) delete w.eco.chests[type];
      const res = this.openInto(w, type); this.save(w); return { ok: true, opened: res };
    });
  }
  /** Roll a chest's contents and add them to the account. */
  openInto(w, type) {
    w.eco.prog.chests = (w.eco.prog.chests || 0) + 1;
    const C = CHESTS[type], out = { type, coins: rint(...C.coins), gems: rint(...C.gems), parts: C.parts ? rint(...C.parts) : 0, cards: [] };
    const byR = {}; for (const id of TANK_IDS) (byR[TANKS[id].rarity] ||= []).push(id);
    const rarities = [];
    for (const [r, n] of Object.entries(C.guarantee || {})) for (let i = 0; i < n; i++) rarities.push(r);
    while (rarities.length < C.cards) {
      let roll = crypto.randomInt(10000) / 10000, pick = 'common';
      for (const [r, p] of Object.entries(C.odds)) { if (roll < p) { pick = r; break; } roll -= p; }
      rarities.push(pick);
    }
    const count = {};
    for (const r of rarities) { const list = byR[r]; const t = list[crypto.randomInt(list.length)]; count[t] = (count[t] || 0) + 1; }
    w.coins += out.coins; w.gems += out.gems; w.parts += out.parts;
    for (const [t, n] of Object.entries(count)) out.cards.push(this.addCards(w, t, n));
    out.cards.sort((a, b) => ['legendary', 'epic', 'rare', 'common'].indexOf(TANKS[a.tank].rarity) - ['legendary', 'epic', 'rare', 'common'].indexOf(TANKS[b.tank].rarity));
    return out;
  }
  // The first card of a tank you don't own unlocks it; every other card becomes parts.
  addCards(w, t, n) {
    const have = w.tanks[t], res = { tank: t, n, new: !have };
    const extra = have ? n : n - 1;
    if (!have) this.setTank(w, t, {});
    if (extra > 0) { const p = extra * CARD_PARTS[TANKS[t].rarity]; w.parts += p; res.parts = p; }
    return res;
  }

  /* ---------------- garage ---------------- */
  /** Upgrade ONE stat of a tank (pow | arm | spd | rng | rel), or its special power ('ab'), for coins + parts. */
  upgrade(id, t, stat) {
    if (!TANKS[t] || !(STATS.includes(stat) || stat === 'ab')) return { error: 'bad' };
    return this.tx(() => {
      const w = this.load(id), have = w.tanks[t];
      if (!have) return { error: 'locked' };
      const cur = have.mods[stat] | 0;
      const cost = stat === 'ab' ? abCost(TANKS[t].rarity, cur) : statCost(t, cur); if (!cost) return { error: 'max_level' };
      w.eco.prog.upgrades = (w.eco.prog.upgrades || 0) + 1;
      const e = this.pay(w, cost); if (e) return { error: e };
      const mods = { ...have.mods, [stat]: cur + 1 };
      this.setTank(w, t, mods); this.save(w);
      return { ok: true, tank: t, stat, n: mods[stat], level: levelOf(mods), mods };
    });
  }
  /** Testing only (TEST_CHEATS=1 on the server): top the wallet up. */
  cheat(id) {
    if (!this.cheats) return { error: 'not_available' };
    return this.tx(() => {
      const w = this.load(id); if (!w) return { error: 'bad' };
      w.gems += 10000; w.coins += 100000; w.parts += 5000;
      this.save(w);
      this.log(`TEST CHEAT: +10000 gems for account ${id}`);
      return { ok: true, got: { gems: 10000, coins: 100000, parts: 5000 } };
    });
  }
  buyParts(id, packId) {
    const pk = PARTS_PACKS.find(p => p.id === packId); if (!pk) return { error: 'bad' };
    return this.tx(() => { const w = this.load(id), e = this.pay(w, { gems: pk.gems }); if (e) return { error: e }; w.parts += pk.parts; this.save(w); return { ok: true, got: { parts: pk.parts } }; });
  }
  select(id, t) { const w = this.load(id); if (!w || !w.tanks[t]) return { error: 'locked' }; this.q.sel.run(t, id); return { ok: true }; }

  /* ---------------- shop ---------------- */
  buyPack(id, t) {
    if (!TANKS[t]) return { error: 'bad' };
    return this.tx(() => {
      const w = this.load(id);
      if (w.tanks[t]) return { error: 'owned' };
      const e = this.pay(w, { gems: PACK_GEMS[TANKS[t].rarity] }); if (e) return { error: e };
      const card = this.addCards(w, t, PACK_CARDS + 1); this.save(w); return { ok: true, opened: { type: 'pack', coins: 0, gems: 0, cards: [card] } };
    });
  }
  buyCoins(id, packId) {
    const pk = COIN_PACKS.find(p => p.id === packId); if (!pk) return { error: 'bad' };
    return this.tx(() => { const w = this.load(id), e = this.pay(w, { gems: pk.gems }); if (e) return { error: e }; w.coins += pk.coins; this.save(w); return { ok: true, got: { coins: pk.coins } }; });
  }

  /* ---------------- quests ---------------- */
  ensureQuests(w) {
    const today = dayKey(), E = w.eco;
    if (E.quests && E.quests.date === today) return;
    const mode = quickModeOf();
    const pool = Object.keys(QUESTS).filter(k => !QUESTS[k].mode || QUESTS[k].mode === mode);
    // Same 3 quests all day for this player (seeded by player + day).
    let h = crypto.createHash('sha1').update(w.id + ':' + today).digest();
    const list = []; let i = 0;
    while (list.length < 3 && i < 40) { const k = pool[h[i % h.length] % pool.length]; if (!list.some(q => q.id === k)) list.push({ id: k, need: QUESTS[k].need, prog: 0, claimed: false }); i++; }
    E.quests = { date: today, list, bonus: false };
    this.q.eco.run(JSON.stringify(E), w.id);
  }
  claimQuest(id, qid) {
    return this.tx(() => {
      const w = this.load(id), Q = w.eco.quests, q = Q.list.find(x => x.id === qid);
      if (!q || q.claimed || q.prog < q.need) return { error: 'not_ready' };
      q.claimed = true; w.eco.prog.questsDone++;
      const out = {}; this.give(w, QUESTS[qid].reward, out); this.save(w); return { ok: true, got: out };
    });
  }
  claimQuestBonus(id) {
    return this.tx(() => {
      const w = this.load(id), Q = w.eco.quests;
      if (Q.bonus || !Q.list.every(q => q.claimed)) return { error: 'not_ready' };
      Q.bonus = true; const out = {}; this.give(w, QUEST_BONUS, out); this.save(w); return { ok: true, got: out };
    });
  }
  claimTankQuest(id, t) {
    const q = TANK_QUESTS[t]; if (!q) return { error: 'bad' };
    return this.tx(() => {
      const w = this.load(id);
      if (w.eco.tq.includes(t) || this.tqProgress(w, q) < q.need) return { error: 'not_ready' };
      w.eco.tq.push(t);
      const card = this.addCards(w, t, w.tanks[t] ? 20 : 1); this.save(w);
      return { ok: true, opened: { type: 'quest', coins: 0, gems: 0, cards: [card] } };
    });
  }

  /* ---------------- after a match ---------------- */
  /** summary = room summary (kind quick/ranked); ranked = store.recordMatch results. → Map(acct → reward) */
  matchRewards(summary, rankedResults = [], unrated = false) {
    const out = new Map();
    if (summary.cancelled || (summary.kind !== 'quick' && summary.kind !== 'ranked')) return out;
    const ranked = summary.kind === 'ranked' && !unrated, R = MATCH_REWARD[ranked ? 'ranked' : 'quick'];
    const draw = summary.winner == null || summary.winner === 'draw';
    for (const p of summary.players) {
      if (p.bot || !p.acct) continue;
      const res = this.tx(() => {
        const w = this.load(p.acct); if (!w) return null;
        const E = w.eco, got = {}, today = dayKey();
        if (E.dayMatches.date !== today) E.dayMatches = { date: today, n: 0 };
        // coins + gems for playing
        if (!p.left) {
          E.dayMatches.n++;
          let c = (p.won ? R.win : draw ? R.draw : R.loss) + Math.min(p.k, R.maxKills) * R.perKill;
          if (E.dayMatches.n > MATCH_REWARD.fullRewardsPerDay) c = Math.round(c / 2);
          this.give(w, { kind: 'coins', n: c }, got);
          if (p.won && R.gemsWin) this.give(w, { kind: 'gems', n: R.gemsWin }, got);
          let pr = (p.won ? R.partsWin : draw ? R.partsDraw : R.partsLoss) + Math.min(p.k, R.maxKills) * R.partsPerKill;
          if (E.dayMatches.n > MATCH_REWARD.fullRewardsPerDay) pr = Math.round(pr / 2);
          this.give(w, { kind: 'parts', n: pr }, got);
        }
        // quests + lifetime progress
        const add = { play: p.left ? 0 : 1, win: p.won ? 1 : 0, kills: p.k, pu: p.pu || 0, dmg: p.dmg || 0, ranked: summary.kind === 'ranked' && !p.left ? 1 : 0, flag: p.caps || 0, zone: p.zone || 0 };
        const quests = [];
        for (const q of E.quests.list) if (!q.claimed && add[q.id]) { const before = q.prog; q.prog = Math.min(q.need, q.prog + add[q.id]); if (q.prog !== before) quests.push({ id: q.id, prog: q.prog, need: q.need }); }
        E.prog.matches += add.play; E.prog.wins += add.win; E.prog.kills += p.k; E.prog.pu += add.pu; E.prog.dmg += add.dmg;
        // lifetime counters for the achievements
        E.prog.deaths += p.d | 0; E.prog.caps += p.caps | 0; E.prog.zone += p.zone | 0; E.prog.obj += p.obj | 0;
        E.prog.abUses += p.abUses | 0;
        if (summary.kind === 'ranked' && !p.left) { E.prog.ranked++; if (p.won) E.prog.rankedWins++; }
        if (!p.left && summary.mvp) { for (const k in summary.mvp) if (summary.mvp[k].id === p.id) { E.prog.mvp++; break; } }
        if (!p.left && summary.mode) E.prog.modes[summary.mode] = (E.prog.modes[summary.mode] || 0) + 1;
        // ranked: first time reaching a tier this season → chest
        const rr = rankedResults.find(x => x.acct === p.acct);
        if (rr && rr.after.rank.placed) {
          const season = seasonInfo().n; if (E.tiers.season !== season) E.tiers = { season, got: [] };
          const reached = TIER_ORDER.indexOf(rr.after.rank.tier);
          for (let i = 1; i <= reached; i++) {
            const tier = TIER_ORDER[i]; if (E.tiers.got.includes(tier)) continue;
            E.tiers.got.push(tier);
            this.give(w, { kind: 'chest', n: TIER_CHEST[tier] }, got); (got.tierChests ||= []).push(tier);
          }
          // reaching a rank for the very first time (any season) also unlocks a tank
          E.rankTanks ||= [];
          for (let i = 0; i <= reached; i++) {
            const tier = TIER_ORDER[i], tank = TIER_TANK[tier];
            if (!tank || E.rankTanks.includes(tier)) continue;
            E.rankTanks.push(tier);
            const had = !!w.tanks[tank];
            const res = this.addCards(w, tank, PACK_CARDS);          // first card unlocks it, the rest become parts
            (got.rankTanks ||= []).push({ tier, tank, unlocked: !had, parts: res.parts || 0 });
            if (res.parts) got.parts = (got.parts || 0) + res.parts;
          }
        }
        this.save(w);
        return { coins: got.coins || 0, gems: got.gems || 0, parts: got.parts || 0, chests: got.chests || [], tierChests: got.tierChests || [], rankTanks: got.rankTanks || null, quests, capped: E.dayMatches.n > MATCH_REWARD.fullRewardsPerDay };
      });
      if (res) out.set(p.acct, res);
    }
    return out;
  }
  dailyStreakCheck() {}

  /* ---------------- real money ---------------- */
  /** provider 'play' (Google Play Billing via the Android app) or 'test' (only when PAYMENTS_TEST=1). */
  async purchase(id, { provider, product, token }) {
    const P = GEM_PRODUCTS.find(x => x.id === product); if (!P) return { error: 'bad' };
    const w0 = this.load(id); if (!w0) return { error: 'bad' };
    if (P.once && w0.eco.starter) return { error: 'already' };
    let orderId = null;
    if (provider === 'test') {
      if (!this.testPayments) return { error: 'payments_not_set_up' };
      token = 'test-' + crypto.randomBytes(8).toString('hex');
    } else if (provider === 'play') {
      if (!this.play) return { error: 'payments_not_set_up' };
      if (!token || this.q.tokenUsed.get(token)) return { error: 'used' };
      const v = await this.verifyPlay(product, token);
      if (!v.ok) return { error: v.error || 'not_paid' };
      orderId = v.orderId;
    } else return { error: 'payments_not_set_up' };
    const res = this.tx(() => {
      if (this.q.tokenUsed.get(token)) return { error: 'used' };
      const w = this.load(id), got = {};
      this.q.purchase.run(id, provider, product, token, orderId, P.gems, P.usd, Date.now());
      this.give(w, { kind: 'gems', n: P.gems }, got);
      if (P.chest) this.give(w, { kind: 'chest', n: P.chest }, got);
      if (P.once) w.eco.starter = true;
      this.save(w); return { ok: true, got };
    });
    if (res.ok && provider === 'play') this.consumePlay(product, token).catch(e => this.log('consume failed', e.message));
    this.log(`purchase ${provider} ${product} by #${id}: ${res.ok ? 'OK' : res.error}`);
    return res;
  }
  // ---- Google Play Developer API (server-to-server), no npm needed ----
  async playToken() {
    if (this._tok && this._tok.exp > Date.now() + 60000) return this._tok.v;
    const sa = this.play.serviceAccount, now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }) });
    const j = await r.json(); if (!j.access_token) throw new Error('google auth failed');
    this._tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return this._tok.v;
  }
  playUrl(product, token, suffix = '') { return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.play.packageName)}/purchases/products/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}${suffix}`; }
  async verifyPlay(product, token) {
    try {
      const r = await fetch(this.playUrl(product, token), { headers: { Authorization: 'Bearer ' + await this.playToken() } });
      if (!r.ok) return { ok: false, error: 'not_paid' };
      const j = await r.json();
      // purchaseState 0 = purchased; consumptionState 0 = not consumed yet
      if (j.purchaseState !== 0 || j.consumptionState === 1) return { ok: false, error: 'not_paid' };
      return { ok: true, orderId: j.orderId };
    } catch (e) { this.log('play verify error', e.message); return { ok: false, error: 'server' }; }
  }
  async consumePlay(product, token) { await fetch(this.playUrl(product, token, ':consume'), { method: 'POST', headers: { Authorization: 'Bearer ' + await this.playToken() } }); }
}

export function playConfigFromEnv() {
  const pkg = process.env.PLAY_PACKAGE, sa = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!pkg || !sa) return null;
  try { return { packageName: pkg, serviceAccount: JSON.parse(sa.trim().startsWith('{') ? sa : fs.readFileSync(sa, 'utf8')) }; } catch (e) { console.error('GOOGLE_SERVICE_ACCOUNT unreadable', e.message); return null; }
}
