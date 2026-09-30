/* The 100 long-term goals: they fill up from real matches, pay out once, and never expire.
     node tools/goals-test.js */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Store } from '../server/store.js';
import { Economy } from '../server/economy.js';
import { ACH, ACH_COUNT, ACH_FAMILIES, ACH_MODES } from '../client/shared/achievements.js';
process.removeAllListeners('warning');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-goals-'));
const store = new Store(DIR), eco = new Economy(store, {});
const A = store.register('Hemin');

console.log('--- the list itself');
ok(ACH_COUNT === 100, `exactly ${ACH_COUNT} goals`);
ok(new Set(ACH.map(a => a.id)).size === ACH_COUNT, 'every goal has its own id');
ok(ACH.every(a => a.reward.coins > 0), 'every goal pays coins');
ok(ACH.some(a => a.reward.gems > 0), 'the bigger ones also pay gems');
for (const f of ACH_FAMILIES) {
  const steps = ACH.filter(a => a.stat === f.stat).map(a => a.need);
  ok(steps.every((n, i) => i === 0 || n > steps[i - 1]), `${f.stat}: the steps rise (${steps.join(' → ')})`);
}
ok(ACH.filter(a => a.stat === 'mode').length === ACH_MODES.length, 'one goal per game mode');
const rewardRises = ACH.filter(a => a.stat === 'kills').map(a => a.reward.coins);
ok(rewardRises.every((n, i) => i === 0 || n > rewardRises[i - 1]), `later steps pay more (${rewardRises.join(' → ')})`);

console.log('\n--- they fill up from matches');
let st = eco.state(A.id);
ok(st.ach && st.ach.list.length === ACH_COUNT && st.ach.done === 0, 'a new player starts with none finished');
const prog = (id) => { const x = eco.state(A.id).ach.list.find(v => v.id === id); return x ? x.prog : -1; };
// play ten quick matches, winning five, with kills and damage
const playMatch = (won, kills, dmg, mode = 'tdm', kind = 'quick', mvp = false) => {
  const summary = {
    kind, mode, map: 'hawler', winner: won ? 'blue' : 'red', team: true, secs: 300,
    mvp: mvp ? { blue: { id: 1, name: 'Hemin' } } : null,
    players: [{ acct: A.id, id: 1, name: 'Hemin', team: 'blue', k: kills, d: 1, hk: kills, hd: 1, obj: 2, pu: 1, dmg, caps: 1, zone: 12, abUses: 3, tank: 'zagros', bot: false, left: false, won }],
  };
  eco.matchRewards(summary, [], false);
};
for (let i = 0; i < 10; i++) playMatch(i % 2 === 0, 6, 900, 'tdm', 'quick', i === 0);
ok(prog('matches_10') === 10, `10 matches counted (${prog('matches_10')})`);
ok(prog('wins_5') === 5, `5 wins counted (${prog('wins_5')})`);
ok(prog('kills_100') === 60, `kills counted (${prog('kills_100')})`);
ok(prog('dmg_25000') === 9000, `damage counted (${prog('dmg_25000')})`);
ok(prog('caps_25') === 10, `flag captures counted (${prog('caps_25')})`);
ok(prog('zone_500') === 120, `zone time counted (${prog('zone_500')})`);
ok(prog('abUses_100') === 30, `tank powers counted (${prog('abUses_100')})`);
ok(prog('mvp_1') === 1, `being MVP counted (${prog('mvp_1')})`);
ok(prog('mode_tdm_10') === 10, `playing one mode counted (${prog('mode_tdm_10')})`);
ok(prog('mode_ctf_10') === 0, 'a mode you never played stays at zero');
// ranked counts separately
for (let i = 0; i < 5; i++) playMatch(true, 3, 500, 'ctf', 'ranked');
ok(prog('ranked_10') === 5 && prog('rankedWins_5') === 5, `ranked matches and wins counted (${prog('ranked_10')}, ${prog('rankedWins_5')})`);
ok(prog('mode_ctf_10') === 5, 'ranked matches count toward their mode too');

console.log('\n--- claiming');
let before = eco.state(A.id);
let r = eco.claimAch(A.id, 'matches_10');
const paid = ACH.find(a => a.id === 'matches_10').reward;
ok(r.ok, 'a finished goal can be claimed');
let after = eco.state(A.id);
ok(after.coins === before.coins + paid.coins, `it paid ${paid.coins} coins (${before.coins} → ${after.coins})`);
ok(after.ach.done === 1, 'it shows as finished');
ok(eco.claimAch(A.id, 'matches_10').error === 'already', 'it cannot be claimed twice');
ok(eco.claimAch(A.id, 'matches_1000').error === 'not_ready', 'an unfinished goal cannot be claimed');
ok(eco.claimAch(A.id, 'nonsense_5').error === 'bad', 'a made-up goal is refused');
ok(eco.state(A.id).ach.ready > 0, `${eco.state(A.id).ach.ready} more are waiting to be claimed`);

console.log('\n--- goals that read the wallet, not a counter');
ok(prog('tanks_2') === 1, 'owning tanks is counted from the garage');
ok(prog('chests_5') >= 0, 'chests opened is tracked');
const w = eco.load(A.id); w.eco.prog.streak = 8; eco.save(w);
ok(prog('streak_7') === 7, 'the daily streak counts toward its goal');

console.log('\n--- private rooms and practice do not count');
before = eco.state(A.id).ach.list.find(v => v.id === 'matches_50').prog;
playMatch(true, 9, 2000, 'tdm', 'private');
ok(prog('matches_50') === before, 'a private match changes nothing');

console.log('\n--- every new rank hands you a tank');
{
  const C = store.register('Ranker');
  const tiers = ['bronze', 'silver', 'gold', 'plat', 'dia', 'cmd', 'legend'];
  const rankUp = (tier) => {
    const summary = { kind: 'ranked', mode: 'tdm', map: 'hawler', winner: 'blue', team: true, secs: 300, mvp: null,
      players: [{ acct: C.id, id: 1, name: 'Ranker', team: 'blue', k: 3, d: 1, hk: 3, hd: 1, obj: 0, pu: 0, dmg: 400, caps: 0, zone: 0, abUses: 0, tank: 'zagros', bot: false, left: false, won: true }] };
    const rr = [{ acct: C.id, won: true, draw: false, left: false, mvp: false, parts: [], delta: 20,
      before: { rp: 0, rank: { placed: true, tier: 'bronze', div: 1 } }, after: { rp: 1, rank: { placed: true, tier, div: 1 } } }];
    return eco.matchRewards(summary, rr, false).get(C.id);
  };
  const owned = () => Object.keys(eco.state(C.id).tanks).length;
  ok(owned() === 1, 'a new player owns one tank');
  let got = rankUp('bronze');
  ok(got.rankTanks && got.rankTanks.length === 1 && got.rankTanks[0].tank === 'baz' && got.rankTanks[0].unlocked, `bronze unlocked ${got.rankTanks && got.rankTanks[0] && got.rankTanks[0].tank}`);
  ok(owned() === 2, 'the tank really landed in the garage');
  got = rankUp('bronze');
  ok(!got.rankTanks, 'the same rank does not pay twice');
  got = rankUp('gold');
  const names = (got.rankTanks || []).map(x => x.tank);
  ok(names.length === 2 && names.includes('halgurd') && names.includes('rashaba'), `jumping to gold hands over the ranks you skipped (${names.join(', ')})`);
  ok(owned() === 4, `four tanks owned now (${owned()})`);
  // already own it → parts instead
  const w2 = eco.load(C.id); const partsBefore = w2.parts;
  got = rankUp('legend');
  const legend = (got.rankTanks || []).find(x => x.tank === 'newroz');
  ok(!!legend && legend.unlocked, 'legend hands over Newroz');
  ok(eco.state(C.id).parts > partsBefore, 'the spare cards turned into parts');
  ok(owned() === 8, `all eight tanks after reaching legend (${owned()})`);
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nALL GOAL TESTS PASS');
process.exit(fails ? 1 : 0);
