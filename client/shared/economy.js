/* =====================================================================
   ECONOMY — coins, gems, chests, the lucky wheel, daily login rewards,
   quests, match rewards and shop products. Shared: the server uses these
   numbers to hand out rewards, the client shows the same numbers (prices,
   drop chances). Change values here and restart the server.
   ===================================================================== */
export const START = { coins: 500, gems: 50, parts: 40 };

// Match rewards (only Quick match and Ranked; private rooms and practice give nothing).
// parts* = Parts, the second currency: needed (with coins) for every tank upgrade.
export const MATCH_REWARD = {
  quick:  { win: 60,  draw: 40, loss: 30, perKill: 3, maxKills: 15, gemsWin: 0, partsWin: 14, partsDraw: 10, partsLoss: 7, partsPerKill: 1 },
  ranked: { win: 120, draw: 70, loss: 50, perKill: 5, maxKills: 15, gemsWin: 2, partsWin: 28, partsDraw: 18, partsLoss: 12, partsPerKill: 2 },
  fullRewardsPerDay: 25,          // after this many matches in a day, match coins are halved
};
// First time you reach a tier in a season you get a chest.
export const TIER_CHEST = { silver: 'common', gold: 'rare', plat: 'rare', dia: 'epic', cmd: 'epic', legend: 'legendary' };
// Every new rank also hands you a tank, weakest first. If you already own it you get its
// cards as parts instead, so the reward is never wasted.
export const TIER_TANK = { bronze: 'baz', silver: 'halgurd', gold: 'rashaba', plat: 'bradost', dia: 'korek', cmd: 'safeen', legend: 'newroz' };

// Chests: coins, number of tank cards, and the chance for EACH card to be of each rarity.
export const CHESTS = {
  common:    { price: { coins: 250 },              coins: [80, 150],    gems: [0, 0],   parts: [15, 30],   cards: 6,  odds: { common: 0.80, rare: 0.17, epic: 0.03, legendary: 0.00 }, color: '#b9c3cc' },
  rare:      { price: { coins: 900, gems: 60 },    coins: [250, 400],   gems: [0, 2],   parts: [40, 70],   cards: 15, odds: { common: 0.60, rare: 0.30, epic: 0.09, legendary: 0.01 }, color: '#5fb0ff' },
  epic:      { price: { gems: 250 },               coins: [600, 900],   gems: [2, 6],   parts: [100, 160], cards: 30, odds: { common: 0.40, rare: 0.35, epic: 0.22, legendary: 0.03 }, guarantee: { epic: 3 }, color: '#c07bff' },
  legendary: { price: { gems: 600 },               coins: [1500, 2200], gems: [5, 12],  parts: [250, 400], cards: 50, odds: { common: 0.30, rare: 0.35, epic: 0.27, legendary: 0.08 }, guarantee: { legendary: 1, epic: 5 }, color: '#febd11' },
};
export const CHEST_IDS = Object.keys(CHESTS);

// Lucky wheel: one free spin per day, more spins cost gems. Chances in % (shown to players).
export const WHEEL = {
  spinGems: 10, maxPaidPerDay: 5,
  segments: [
    { kind: 'coins', n: 50,  p: 25, color: '#c9a24a' },
    { kind: 'gems',  n: 5,   p: 15, color: '#3fa7c9' },
    { kind: 'coins', n: 100, p: 12, color: '#d8b35a' },
    { kind: 'parts', n: 25, p: 8, color: '#7f8a93' },
    { kind: 'chest', n: 'common', p: 12, color: '#8d969d' },
    { kind: 'coins', n: 250, p: 12, color: '#e6c066' },
    { kind: 'gems',  n: 15,  p: 5,  color: '#2f8fb3' },
    { kind: 'coins', n: 500, p: 6,  color: '#f0cc70' },
    { kind: 'chest', n: 'rare', p: 4, color: '#3d7fd0' },
    { kind: 'chest', n: 'epic', p: 1, color: '#9a55e0' },
  ],
};

// Daily login: 7-day cycle. Missing a day starts again from day 1.
export const DAILY = [
  [{ kind: 'coins', n: 100 }],
  [{ kind: 'coins', n: 200 }],
  [{ kind: 'gems', n: 5 }],
  [{ kind: 'coins', n: 300 }],
  [{ kind: 'chest', n: 'common' }],
  [{ kind: 'coins', n: 500 }],
  [{ kind: 'chest', n: 'rare' }, { kind: 'gems', n: 20 }],
];

// Daily quests: 3 a day from this list (progress only in Quick match and Ranked).
export const QUESTS = {
  play:   { need: 3,   reward: { kind: 'coins', n: 120 } },
  win:    { need: 2,   reward: { kind: 'coins', n: 200 } },
  kills:  { need: 8,   reward: { kind: 'coins', n: 150 } },
  pu:     { need: 5,   reward: { kind: 'coins', n: 120 } },
  dmg:    { need: 800, reward: { kind: 'coins', n: 150 } },
  ranked: { need: 1,   reward: { kind: 'gems', n: 5 } },
  flag:   { need: 1,   reward: { kind: 'coins', n: 200 }, mode: 'ctf' },
  zone:   { need: 60,  reward: { kind: 'coins', n: 150 }, mode: 'koh' },
};
export const QUEST_BONUS = { kind: 'chest', n: 'common' };      // for finishing all 3

// One-time tank quests: finish one to unlock that tank (or get 20 of its cards if you own it already).
export const TANK_QUESTS = {
  baz:     { stat: 'wins',      need: 5 },
  rashaba: { stat: 'matches',   need: 25 },
  halgurd: { stat: 'kills',     need: 50 },
  bradost:  { stat: 'pu',        need: 40 },
  korek:   { stat: 'questsDone', need: 15 },
  safeen:  { stat: 'bestTier',  need: 1 },      // reach Silver in ranked
  newroz:  { stat: 'streak',    need: 7 },      // log in 7 days in a row
};

// Shop: tank packs and coins cost gems.
export const PACK_GEMS = { common: 120, rare: 300, epic: 700, legendary: 1500 };
export const PACK_CARDS = 10;
export const PARTS_PACKS = [
  { id: 'parts1', parts: 150, gems: 40 },
  { id: 'parts2', parts: 900, gems: 200 },
];
export const COIN_PACKS = [
  { id: 'coins1', coins: 1000, gems: 60 },
  { id: 'coins2', coins: 5500, gems: 300 },
  { id: 'coins3', coins: 12000, gems: 600 },
];
// Real-money products (the same IDs must be created in Google Play Console → Monetize → In-app products).
export const GEM_PRODUCTS = [
  { id: 'gems_80',   gems: 80,   usd: 0.99 },
  { id: 'gems_500',  gems: 500,  usd: 4.99,  tag: 'popular' },
  { id: 'gems_1200', gems: 1200, usd: 9.99 },
  { id: 'gems_2600', gems: 2600, usd: 19.99 },
  { id: 'gems_7000', gems: 7000, usd: 49.99, tag: 'best' },
  { id: 'starter_pack', gems: 300, usd: 2.99, chest: 'epic', once: true, tag: 'starter' },
];

export const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);   // UTC day
