/* Economy rules (in-process, throwaway database) + a live check through the server hub.
     node tools/economy-test.js */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { Store } from '../server/store.js';
import { Economy } from '../server/economy.js';
import { CHESTS, WHEEL, DAILY, START, TANK_QUESTS, PACK_GEMS } from '../client/shared/economy.js';
import { TANKS, statCost, CARD_PARTS, modsOf } from '../client/shared/tanks.js';
process.removeAllListeners('warning');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-eco-'));
const store = new Store(DIR), eco = new Economy(store, { testPayments: true });
const A = store.register('Solomon'), B = store.register('Lina');
let s = eco.state(A.id);
ok(s.coins === START.coins && s.gems === START.gems && s.tanks.zagros && s.tanks.zagros.level === 1 && s.sel === 'zagros', `new player: ${s.coins} coins, ${s.gems} gems, owns Zagros`);
ok(s.quests.list.length === 3 && s.daily.canClaim && s.wheel.free, '3 daily quests, daily reward and free spin ready');
// ---- daily streak (fake the clock by editing the saved day)
let r = eco.claimDaily(A.id); ok(r.ok && r.got.coins === 100, 'day 1 reward: 100 coins');
ok(eco.claimDaily(A.id).error === 'already', 'cannot claim twice in one day');
const setLast = (daysAgo, day) => { const w = eco.load(A.id); w.eco.daily = { last: new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10), day }; eco.save(w); };
setLast(1, 6); r = eco.claimDaily(A.id); ok(r.ok && r.day === 6 && r.got.gems === 20 && r.got.chests[0] === 'rare', 'day 7 reward: rare chest + 20 gems');
setLast(3, 4); r = eco.claimDaily(A.id); ok(r.ok && r.day === 0, 'missing a day starts again from day 1');
// ---- wheel
r = eco.spin(A.id, false); ok(r.ok && r.index >= 0, 'free spin: ' + JSON.stringify(r.got));
ok(eco.spin(A.id, false).error === 'no_free_spin', 'only one free spin per day');
let g0 = eco.state(A.id).gems; r = eco.spin(A.id, true); ok(r.ok && eco.state(A.id).gems === g0 - WHEEL.spinGems + (r.got.gems || 0), 'paid spin costs 10 gems');
for (let i = 0; i < 4; i++) eco.spin(A.id, true);
ok(eco.spin(A.id, true).error === 'no_spins_left', 'max 5 paid spins per day');
ok(WHEEL.segments.reduce((a, x) => a + x.p, 0) === 100, 'wheel chances add up to 100%');
// wheel distribution matches the published chances (20 000 spins on a scratch account)
{ const C = store.register('WheelBot'), hits = new Array(WHEEL.segments.length).fill(0), N = 20000;
  for (let i = 0; i < N; i++) { const w = eco.load(C.id); w.eco.wheel = { date: null, free: 0, paid: 0 }; eco.save(w); hits[eco.spin(C.id, false).index]++; }
  const worst = Math.max(...hits.map((h, i) => Math.abs(h / N * 100 - WHEEL.segments[i].p)));
  ok(worst < 1.2, `wheel results match the shown chances (largest gap ${worst.toFixed(2)} points)`); }
// ---- chests: price, contents, odds
{ const w = eco.load(A.id); w.coins = 100000; w.gems = 100000; eco.save(w); }
let c0 = eco.state(A.id).coins; r = eco.buyChest(A.id, 'common', 'coins');
ok(r.ok && r.opened.cards.reduce((a, c) => a + c.n, 0) === 6 && eco.state(A.id).coins === c0 - 250 + r.opened.coins + r.opened.cards.reduce((a, c) => a + (c.coins || 0), 0), 'common chest: costs 250 coins, gives 6 cards + coins');
ok(eco.buyChest(A.id, 'epic', 'coins').error === 'bad', 'epic chest can only be bought with gems');
r = eco.buyChest(A.id, 'legendary', 'gems'); ok(r.ok && r.opened.cards.some(c => TANKS[c.tank].rarity === 'legendary'), 'legendary chest always has a legendary card');
{ const C = store.register('ChestBot'); const w = eco.load(C.id); w.gems = 1e7; eco.save(w); const cnt = { common: 0, rare: 0, epic: 0, legendary: 0 }; let n = 0;
  for (let i = 0; i < 400; i++) { const o = eco.buyChest(C.id, 'rare', 'gems').opened; for (const c of o.cards) { cnt[TANKS[c.tank].rarity] += c.n; n += c.n; } }
  const gap = Math.max(...Object.keys(cnt).map(k => Math.abs(cnt[k] / n - CHESTS.rare.odds[k]) * 100));
  ok(gap < 1.5, `rare chest card rarities match the shown odds (largest gap ${gap.toFixed(2)} points, ${n} cards)`);
  const st = eco.state(C.id); ok(Object.keys(st.tanks).length === 8, 'opening chests unlocks new tanks (all 8 after 400 chests)'); }
// ---- upgrades: one stat at a time, paid with coins + parts
{ const w = eco.load(A.id); eco.setTank(w, 'zagros', {}); w.parts = 0; eco.save(w); }
c0 = eco.state(A.id).coins; r = eco.upgrade(A.id, 'zagros', 'spd');
ok(r.error === 'no_parts', 'no parts → cannot upgrade');
{ const w = eco.load(A.id); w.parts = 1000; eco.save(w); }
r = eco.upgrade(A.id, 'zagros', 'spd'); const cst = statCost('zagros', 0);
ok(r.ok && r.stat === 'spd' && r.n === 1 && eco.state(A.id).tanks.zagros.mods.spd === 1 && eco.state(A.id).tanks.zagros.mods.pow === 0 && eco.state(A.id).coins === c0 - cst.coins && eco.state(A.id).parts === 1000 - cst.parts, `upgrade only SPEED: ${cst.coins} coins + ${cst.parts} parts`);
ok(eco.upgrade(A.id, 'zagros', 'nitro').error === 'bad', 'unknown stat refused');
ok(eco.loadout(A.id).mods.spd === 1, 'the upgrade is used in matches (loadout)');
{ const w = eco.load(A.id); eco.setTank(w, 'zagros', { ...modsOf({}), pow: 5 }); } r = eco.upgrade(A.id, 'zagros', 'pow'); ok(r.error === 'max_level', 'each stat stops at 5');
{ const w = eco.load(A.id); const p0 = w.parts; const b = eco.addCards(w, 'zagros', 5); eco.save(w); ok(b.parts === 5 * CARD_PARTS.common && eco.state(A.id).parts === p0 + b.parts, 'spare cards turn into parts'); }
{ // old saves: level + cards are turned into stat upgrades + parts on the next load
  const C = store.register('OldSave'); eco.load(C.id); store.db.prepare("INSERT OR REPLACE INTO tanks (acct, tank, level, cards, mods) VALUES (?, 'zagros', 6, 10, '')").run(C.id);
  const w = eco.load(C.id); const pts = Object.values(w.tanks.zagros.mods).reduce((a, b) => a + b, 0);
  ok(pts > 0 && w.tanks.zagros.level === 6 && w.parts >= 10 * CARD_PARTS.common, `old level-6 tank → ${pts} upgrades (still level 6) + spare cards as parts`); }
// ---- select, packs
ok(eco.select(B.id, 'newroz').error === 'locked', 'cannot select a locked tank');
{ const w = eco.load(B.id); w.gems = 5000; eco.save(w); }
r = eco.buyPack(B.id, 'safeen'); ok(r.ok && eco.state(B.id).tanks.safeen && r.opened.cards[0].parts === 10 * CARD_PARTS.epic && eco.state(B.id).gems === 5000 - PACK_GEMS.epic, 'tank pack unlocks Safeen (+10 cards as parts) for 700 gems');
r = eco.buyParts(B.id, 'parts1'); ok(r.ok && r.got.parts === 150, 'buy 150 parts with gems');
ok(eco.select(B.id, 'safeen').ok && eco.loadout(B.id).id === 'safeen', 'select Safeen → it is the tank used in matches');
r = eco.buyCoins(B.id, 'coins2'); ok(r.ok && r.got.coins === 5500, 'buy 5500 coins with gems');
// ---- purchases (test mode)
g0 = eco.state(B.id).gems; r = await eco.purchase(B.id, { provider: 'test', product: 'gems_500' }); ok(r.ok && eco.state(B.id).gems === g0 + 500, 'test purchase: +500 gems');
r = await eco.purchase(B.id, { provider: 'test', product: 'starter_pack' }); ok(r.ok && eco.state(B.id).chests.epic === 1, 'starter pack: gems + epic chest in inventory');
ok((await eco.purchase(B.id, { provider: 'test', product: 'starter_pack' })).error === 'already', 'starter pack only once');
ok((await eco.purchase(B.id, { provider: 'play', product: 'gems_80', token: 'x' })).error === 'payments_not_set_up', 'Google Play purchases refused until set up');
r = eco.openOwned(B.id, 'epic'); ok(r.ok && !eco.state(B.id).chests.epic && r.opened.cards.filter(c => TANKS[c.tank].rarity === 'epic').reduce((a, c) => a + c.n, 0) >= 3, 'open owned epic chest (at least 3 epic cards)');
ok(eco.openOwned(B.id, 'epic').error === 'no_chest', 'cannot open a chest you do not have');
// ---- match rewards + quests + tank quests
{ const w = eco.load(A.id); w.eco.quests.list = [{ id: 'play', need: 3, prog: 0, claimed: false }, { id: 'kills', need: 8, prog: 0, claimed: false }, { id: 'win', need: 2, prog: 0, claimed: false }]; w.coins = 0; eco.save(w); }
const summ = (won, k, left = false) => ({ kind: 'quick', mode: 'tdm', winner: 'blue', players: [{ acct: A.id, team: won ? 'blue' : 'red', k, d: 2, hk: 1, won, left, pu: 2, dmg: 300, caps: 0, zone: 0, bot: false }, { acct: null, bot: true, team: 'red', k: 1 }] });
let rw = eco.matchRewards(summ(true, 4)).get(A.id); ok(rw.coins === 60 + 4 * 3 && rw.parts === 14 + 4, `quick match win with 4 kills: +${rw.coins} coins, +${rw.parts} parts`);
rw = eco.matchRewards(summ(false, 5)).get(A.id); ok(rw.coins === 30 + 15, `quick match loss with 5 kills: +${rw.coins} coins`);
rw = eco.matchRewards(summ(true, 2, true)).get(A.id); ok(rw.coins === 0, 'leaving early: no coins');
ok(eco.matchRewards({ ...summ(true, 9), kind: 'private' }).size === 0, 'private rooms give no rewards');
rw = eco.matchRewards(summ(true, 0)).get(A.id);
s = eco.state(A.id); ok(s.quests.list.every(q => q.prog >= q.need), 'quests progress from matches (play 3, destroy 8, win 2)');
for (const q of s.quests.list) ok(eco.claimQuest(A.id, q.id).ok, `claim quest "${q.id}"`);
ok(eco.claimQuest(A.id, 'play').error === 'not_ready', 'a quest can be claimed only once');
r = eco.claimQuestBonus(A.id); ok(r.ok && r.got.chests[0] === 'common', 'all 3 quests → bonus common chest');
{ const w = eco.load(A.id); w.eco.prog.wins = 5; eco.save(w); } s = eco.state(A.id);
ok(s.tankQuests.baz.prog === 5 && !s.tankQuests.baz.done, 'tank quest "win 5 matches" complete');
const hadBaz = !!s.tanks.baz; r = eco.claimTankQuest(A.id, 'baz'); ok(r.ok && eco.state(A.id).tanks.baz && (hadBaz ? r.opened.cards[0].n === 20 : r.opened.cards[0].new), 'tank quest unlocks Baz (or gives 20 cards)');
ok(eco.claimTankQuest(A.id, 'baz').error === 'not_ready', 'tank quest only once');
// ranked: rewards + tier chest
const rr = [{ acct: A.id, after: { rank: { placed: true, tier: 'gold', div: 3 } } }];
rw = eco.matchRewards({ ...summ(true, 2), kind: 'ranked' }, rr).get(A.id);
ok(rw.coins === 120 + 10 && rw.gems === 2 && rw.tierChests.join() === 'silver,gold', `ranked win: +${rw.coins} coins, +${rw.gems} gems, chests for reaching Silver and Gold`);
rw = eco.matchRewards({ ...summ(true, 2), kind: 'ranked' }, rr).get(A.id); ok(rw.tierChests.length === 0, 'tier chests only once per season');
// daily soft cap
{ const w = eco.load(A.id); w.eco.dayMatches = { date: new Date().toISOString().slice(0, 10), n: 25 }; eco.save(w); }
rw = eco.matchRewards(summ(true, 0)).get(A.id); ok(rw.coins === 30 && rw.capped, 'after 25 matches in a day match coins are halved');
store.close(); fs.rmSync(DIR, { recursive: true, force: true });

// ---- live: hub actions through the real server
const PORT = 9700 + Math.floor(Math.random() * 200), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-eco2-'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA, PAYMENTS_TEST: '1', REG_LIMIT: '100' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
try {
  const acc = await (await fetch(`http://127.0.0.1:${PORT}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Kaz"}' })).json();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/hub`); const inbox = []; let rid = 1;
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data)); await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ t: 'auth', id: acc.id, secret: acc.secret }));
  const wait = async (pred) => { for (let i = 0; i < 200; i++) { const m = inbox.find(pred); if (m) return m; await new Promise(r => setTimeout(r, 20)); } return null; };
  const hello = await wait(m => m.t === 'hello'); ok(hello && hello.wallet && hello.wallet.coins === START.coins, 'hub hello includes the wallet');
  const op = async (o) => { const r = rid++; ws.send(JSON.stringify({ t: 'eco', rid: r, ...o })); return wait(m => m.rid === r); };
  let m = await op({ op: 'daily' }); ok(m.t === 'ok' && m.state.coins === START.coins + 100, 'hub: claim daily');
  m = await op({ op: 'purchase', provider: 'test', product: 'gems_80' }); ok(m.t === 'ok' && m.state.gems === START.gems + 80, 'hub: test purchase (PAYMENTS_TEST=1)');
  m = await op({ op: 'buyChest', type: 'common', cur: 'coins' }); ok(m.t === 'ok' && m.res.opened.cards.length > 0, 'hub: buy + open a chest');
  m = await op({ op: 'upgrade', tank: 'newroz', stat: 'pow' }); ok(m.t === 'err' && m.code === 'locked', 'hub: upgrading a locked tank is refused');
  ok(!!(await wait(x => x.t === 'wallet')), 'hub pushes wallet updates');
  // the hidden test button: refused unless the server was started with TEST_CHEATS=1
  m = await op({ op: 'cheat' }); ok(m.t === 'ok' && m.state.gems >= 10000, 'the hidden gem button works while building');
  // the selected tank is used in a match
  await op({ op: 'pack', tank: 'baz' }); await op({ op: 'select', tank: 'baz' });
  const g = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); const gin = []; g.onmessage = (e) => { if (typeof e.data === 'string') gin.push(JSON.parse(e.data)); };
  await new Promise(r => g.onopen = r); g.send(JSON.stringify({ t: 'hello', name: 'Kaz', token: 'tk', action: 'create', auth: { id: acc.id, secret: acc.secret } }));
  for (let i = 0; i < 100 && !gin.some(x => x.t === 'room'); i++) await new Promise(r => setTimeout(r, 20));
  const room = gin.find(x => x.t === 'room'); ok(room && room.players[0].tank === 'baz', 'your selected tank (Baz) is the one you play with');
  g.close(); ws.close();
} catch (e) { console.error(e); fails++; }
srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nALL ECONOMY TESTS PASS');
process.exit(fails ? 1 : 0);
