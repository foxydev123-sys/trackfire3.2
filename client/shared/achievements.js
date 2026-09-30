/* =====================================================================
   ACHIEVEMENTS — the long game. About a hundred goals that never expire,
   in families of rising steps: play 10 matches, then 50, then 100…
   Each step pays coins and, for the bigger ones, gems.

   They fill up on their own from what you do in Quick match and Ranked
   (private rooms and practice do not count, same as the daily quests).
   Nothing here resets with the season.

   A family is { stat, name, steps }. `stat` is a lifetime counter the
   server keeps (see economy.js prog), or one worked out from the wallet.
   ===================================================================== */

export const ACH_FAMILIES = [
  { stat: 'matches',   icon: '🎮', steps: [10, 50, 100, 250, 500, 1000, 2500, 5000] },
  { stat: 'wins',      icon: '🏆', steps: [5, 25, 100, 250, 500, 1000, 2500] },
  { stat: 'kills',     icon: '💥', steps: [10, 100, 500, 1000, 5000, 10000, 25000] },
  { stat: 'dmg',       icon: '🎯', steps: [5000, 25000, 100000, 500000, 1000000, 5000000] },
  { stat: 'deaths',    icon: '🛠', steps: [50, 250, 1000, 5000] },
  { stat: 'ranked',    icon: '🥇', steps: [10, 50, 100, 500] },
  { stat: 'rankedWins', icon: '👑', steps: [5, 25, 100, 250] },
  { stat: 'caps',      icon: '🚩', steps: [5, 25, 100, 250] },
  { stat: 'zone',      icon: '🏰', steps: [100, 500, 2000, 5000, 10000] },
  { stat: 'pu',        icon: '⚡', steps: [25, 100, 500, 1000, 2500] },
  { stat: 'abUses',    icon: '🔮', steps: [25, 100, 500, 2000, 5000] },
  { stat: 'mvp',       icon: '⭐', steps: [1, 10, 50, 150] },
  { stat: 'obj',       icon: '📌', steps: [50, 250, 1000, 5000] },
  { stat: 'chests',    icon: '🎁', steps: [5, 25, 100, 300] },
  { stat: 'upgrades',  icon: '🔧', steps: [5, 25, 75, 150] },
  { stat: 'tanks',     icon: '🚜', steps: [2, 4, 6, 8] },
  { stat: 'streak',    icon: '📅', steps: [3, 7, 30, 100] },
  { stat: 'tier',      icon: '🎖', steps: [1, 2, 3, 4, 5, 6] },          // silver … legend
];
// One more family per game mode: play it this many times.
export const ACH_MODE_STEPS = [10];
export const ACH_MODES = ['tdm', 'ffa', 'ctf', 'koh', 'lts', 'rush', 'convoy', 'jugg', 'ball', 'potato', 'bounty'];

/** Coins and gems for finishing one step. Later steps in a family pay much more. */
export function achReward(stat, i, need) {
  const big = stat === 'tier' || stat === 'mvp' || stat === 'rankedWins';
  const coins = Math.round((250 + i * i * 600 + (big ? 500 : 0)) / 10) * 10;
  const gems = i === 0 ? (big ? 5 : 0) : Math.min(120, 5 + i * (big ? 12 : 7));
  return { coins, gems };
}

/** The whole list, in a fixed order. id looks like "kills_500" or "mode_ctf_10". */
export function achList() {
  const out = [];
  for (const f of ACH_FAMILIES)
    f.steps.forEach((need, i) => out.push({ id: `${f.stat}_${need}`, stat: f.stat, icon: f.icon, need, step: i + 1, of: f.steps.length, reward: achReward(f.stat, i, need) }));
  for (const m of ACH_MODES)
    ACH_MODE_STEPS.forEach((need, i) => out.push({ id: `mode_${m}_${need}`, stat: 'mode', mode: m, icon: '🗺', need, step: i + 1, of: ACH_MODE_STEPS.length, reward: achReward('mode', 1, need) }));
  return out;
}
export const ACH = achList();
export const ACH_BY_ID = Object.fromEntries(ACH.map(a => [a.id, a]));
export const ACH_COUNT = ACH.length;

/** How far along one achievement is, given the lifetime counters. */
export function achProgress(a, prog = {}) {
  if (a.stat === 'mode') return (prog.modes && prog.modes[a.mode]) || 0;
  return prog[a.stat] || 0;
}
