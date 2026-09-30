/* =====================================================================
   TANKS — the 8 tank types, their stats, rarity and upgrade costs.
   Shared by server and client. Stats are for a tank with no upgrades;
   see STATS below for the five upgrades (speed upgrades reach the client's
   prediction through the spawn message).
   ===================================================================== */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR = { common: '#b9c3cc', rare: '#5fb0ff', epic: '#c07bff', legendary: '#febd11' };
export const MAX_LEVEL = 10;

// hp · dmg [min,max] per shell · reload s · speed m/s · turn rad/s · turret rad/s · shell speed · range m
// armor = share of damage blocked · spread = shells per shot · regen = HP/s after 3 s without damage
// splash = extra damage to other tanks near the impact
export const TANKS = {
  zagros:  { rarity: 'common',    hp: 100, dmg: [25, 40], reload: 2.2,  speed: 9.5,  turn: 2.3, turret: 3.4, shellSpeed: 48, range: 40, size: 1.0,  body: 0x4a7a3a },
  baz:     { rarity: 'common',    hp: 92,  dmg: [21, 31], reload: 1.9,  speed: 12.5, turn: 2.9, turret: 4.0, shellSpeed: 52, range: 38, size: 0.88, body: 0xb88a3c },
  halgurd: { rarity: 'rare',      hp: 145, dmg: [28, 42], reload: 3.3,  speed: 7.6,  turn: 1.8, turret: 2.6, shellSpeed: 44, range: 40, size: 1.15, armor: 0.15, body: 0x5a6068 },
  rashaba: { rarity: 'rare',      hp: 95,  dmg: [11, 16], reload: 0.75, speed: 9.5,  turn: 2.3, turret: 3.8, shellSpeed: 56, range: 34, size: 0.98, body: 0x3a5a7a },
  safeen:  { rarity: 'epic',      hp: 80,  dmg: [45, 60], reload: 3.4,  speed: 8.8,  turn: 2.1, turret: 2.8, shellSpeed: 72, range: 62, size: 1.0,  body: 0x6b5a3a },
  bradost:  { rarity: 'epic',      hp: 110, dmg: [11, 16], reload: 2.3,  speed: 9.2,  turn: 2.4, turret: 3.4, shellSpeed: 44, range: 26, size: 1.05, spread: 3, body: 0x7a3a3a },
  korek:   { rarity: 'epic',      hp: 115, dmg: [24, 36], reload: 2.2,  speed: 9.2,  turn: 2.3, turret: 3.4, shellSpeed: 48, range: 40, size: 1.0,  regen: 6, body: 0x2f7a6a },
  newroz:  { rarity: 'legendary', hp: 110, dmg: [28, 38], reload: 2.4,  speed: 9.8,  turn: 2.4, turret: 3.6, shellSpeed: 50, range: 42, size: 1.05, splash: { r: 4, dmg: [12, 18] }, body: 0xc2542a },
};
export const TANK_IDS = Object.keys(TANKS);
export const STARTER = 'zagros';

/* ---------------- upgrades ----------------
   Each tank has five stats you upgrade one at a time (0…5 each), paid with
   coins + parts: Power (damage), Armour (health), Speed, Range, Reload.
   The tank's "level" (1…10) is just how far it is upgraded overall. */
export const STATS = ['pow', 'arm', 'spd', 'rng', 'rel'];
export const MAX_STAT = 5;
export const STAT_STEP = { pow: 0.05, arm: 0.06, spd: 0.03, rng: 0.05, rel: 0.04 };   // per upgrade: +5% damage, +6% health, +3% speed, +5% range, −4% reload
const STAT_COINS = [150, 350, 800, 1800, 4000], STAT_PARTS = [10, 25, 60, 130, 280];
const RARITY_K = { common: 1, rare: 1.5, epic: 2, legendary: 3 };
/** Cost of the next upgrade of one stat (k = its current level), or null when maxed. */
export function statCost(id, k) {
  if (k >= MAX_STAT || !TANKS[id]) return null;
  const r = RARITY_K[TANKS[id].rarity]; return { coins: Math.round(STAT_COINS[k] * r), parts: Math.round(STAT_PARTS[k] * r) };
}
const LEGACY_ORDER = ['arm', 'pow', 'rel', 'rng', 'spd'];
/** Stat levels from either an object {pow, arm, …} or an old-style overall level (1…10, bots and old saves). */
export function modsOf(x) {
  const m = { pow: 0, arm: 0, spd: 0, rng: 0, rel: 0, ab: 0 };   // ab = the tank's special power, 0…5 (see abilities.js)
  if (x && typeof x === 'object') { for (const k of STATS) m[k] = Math.max(0, Math.min(MAX_STAT, x[k] | 0)); m.ab = Math.max(0, Math.min(MAX_STAT, x.ab | 0)); return m; }
  let pts = Math.round((Math.max(1, Math.min(MAX_LEVEL, x | 0 || 1)) - 1) * (STATS.length * MAX_STAT) / (MAX_LEVEL - 1));
  for (let i = 0; pts > 0; i++) { const k = LEGACY_ORDER[i % 5]; if (m[k] < MAX_STAT) { m[k]++; pts--; } }
  return m;
}
export const modPoints = (m) => STATS.reduce((a, k) => a + (m[k] || 0), 0);
export const levelOf = (m) => 1 + Math.round(modPoints(m) * (MAX_LEVEL - 1) / (STATS.length * MAX_STAT));

/** Full stats for a tank with its upgrades (object) or an overall level (number). */
export function tankStats(id, up = 1) {
  const T = TANKS[id] || TANKS.zagros, m = modsOf(up);
  const dK = 1 + STAT_STEP.pow * m.pow, hK = 1 + STAT_STEP.arm * m.arm, rK = 1 + STAT_STEP.rng * m.rng;
  return { ...T, id: TANKS[id] ? id : 'zagros', level: levelOf(m), mods: m, hp: Math.round(T.hp * hK), dmg: [Math.round(T.dmg[0] * dK), Math.round(T.dmg[1] * dK)],
    reload: +(T.reload * (1 - STAT_STEP.rel * m.rel)).toFixed(2), range: Math.round(T.range * rK), shellSpeed: Math.round(T.shellSpeed * (1 + 0.02 * m.rng)),
    sm: +(1 + STAT_STEP.spd * m.spd).toFixed(3), speed: +(T.speed * (1 + STAT_STEP.spd * m.spd)).toFixed(2),
    splash: T.splash ? { r: T.splash.r, dmg: [Math.round(T.splash.dmg[0] * dK), Math.round(T.splash.dmg[1] * dK)] } : null };
}
// Spare cards of a tank you already own turn into parts.
export const CARD_PARTS = { common: 3, rare: 8, epic: 20, legendary: 60 };

// Cards needed to go from level L to L+1 (index L-1). Rarer tanks need fewer cards, but their cards are much rarer.
export const CARDS_TO_LEVEL = {
  common:    [2, 4, 10, 20, 50, 100, 200, 400, 800],
  rare:      [1, 2, 4, 10, 20, 40, 80, 150, 300],
  epic:      [1, 2, 3, 5, 10, 20, 40, 80, 150],
  legendary: [1, 1, 2, 3, 5, 10, 20, 40, 80],
};
const COINS = [100, 250, 500, 1000, 2000, 4000, 8000, 15000, 30000];
const COIN_K = { common: 1, rare: 1.5, epic: 2, legendary: 3 };
/** Cost of the next upgrade, or null at max level. */
export function upgradeCost(id, level) {
  if (level >= MAX_LEVEL) return null;
  const r = TANKS[id].rarity;
  return { cards: CARDS_TO_LEVEL[r][level - 1], coins: Math.round(COINS[level - 1] * COIN_K[r]) };
}
// Extra cards of a max-level tank turn into coins.
export const CARD_COINS = { common: 10, rare: 25, epic: 60, legendary: 200 };

/** 0..1 bars for the garage (relative to the best tank in each stat). */
export function statBars(id, up = 1) {
  const s = tankStats(id, up), shots = s.spread || 1;
  const dps = ((s.dmg[0] + s.dmg[1]) / 2) * shots / s.reload;
  return {
    hp: s.hp * (1 + (s.armor || 0)) / 240,
    damage: ((s.dmg[0] + s.dmg[1]) / 2) * shots / 70,
    fireRate: Math.min(1, 0.7 / s.reload + 0.1),
    speed: s.speed / 14,
    range: s.range / 64,
    dps: dps / 30,
  };
}
