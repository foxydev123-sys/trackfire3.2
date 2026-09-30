/* =====================================================================
   ABILITIES — every tank has ONE special power, fired with its own
   button (key Q / the ⚡ button). Each one has a cooldown and five
   upgrade levels bought with coins + parts, like the five stats.

     zagros   wall    Cover Wall   — drops a wall you can hide behind
     baz      drone   Suicide Car  — a little car that chases an enemy and blows up
     halgurd  dome    Bunker Dome  — a big bubble: nothing can be shot through its skin
     rashaba  cloak   Vanish       — invisible to enemies; firing breaks it
     safeen   homing  Guided Shell — the camera rides the shell until it hits
     bradost  freeze  Freeze Cage  — your next shell cages an enemy: no moving, no firing
     korek    heal    Repair Shot  — your next shell heals the team-mate it hits
     newroz   hole    Black Hole   — drags every enemy near it into the middle

   A power is NOT on a timer. You charge it by hurting enemies: `need` is
   how much damage you must deal before it is ready, and upgrading a power
   lowers that (as well as making the power itself stronger).

   `aim` says how you point it:
     ground  tap the button, then move the aim stick to choose the spot, FIRE to place it
     dir     same, but you only choose a direction
     shot    arms your next shell (the shot itself is the aim)
     self    happens the moment you tap it

   The numbers below are [level 0 … level 5]; lvl(a, 'dmg', l) reads one.
   Both the server and the client read this file, so a power can never
   mean two different things.
   ===================================================================== */

export const ABILITIES = {
  wall:   { tank: 'zagros',  icon: '🧱', aim: 'ground', range: 15, need: [180, 165, 150, 135, 120, 105], hp: [150, 185, 220, 255, 290, 330], life: [20, 21, 22, 23, 24, 26], len: [7, 7.4, 7.8, 8.2, 8.6, 9] },
  drone:  { tank: 'baz',     icon: '🚗', aim: 'dir',    range: 20, need: [260, 240, 220, 200, 180, 160], hp: [30, 38, 46, 54, 62, 70], dmg: [45, 51, 57, 63, 69, 75], life: [10, 10.6, 11.2, 11.8, 12.4, 13], spd: [13, 13.4, 13.8, 14.2, 14.6, 15] },
  dome:   { tank: 'halgurd', icon: '🛡', aim: 'ground', range: 13, need: [340, 315, 290, 265, 240, 215], r: [9, 9.8, 10.6, 11.4, 12.2, 13], life: [10, 10, 10, 10, 10, 10] },
  cloak:  { tank: 'rashaba', icon: '👁', aim: 'self',              need: [220, 205, 190, 175, 160, 145], life: [3, 3.2, 3.4, 3.6, 3.8, 4] },
  // The guided shell leaves the barrel at about tank speed and builds up as it flies, so you
  // have time to steer it with the movement stick. spd0 = launch speed, acc = m/s gained each
  // second, spd = the fastest it ever goes.
  homing: { tank: 'safeen',  icon: '🚀', aim: 'dir',    range: 30, need: [300, 278, 256, 234, 212, 190], dmg: [70, 78, 86, 94, 102, 110], turn: [2.6, 2.9, 3.2, 3.5, 3.8, 4.2], life: [7, 7.3, 7.6, 7.9, 8.2, 8.5], spd0: [9.5, 9.5, 9.5, 9.5, 9.5, 9.5], acc: [5.5, 6, 6.5, 7, 7.5, 8], spd: [34, 36, 38, 40, 42, 45] },
  freeze: { tank: 'bradost', icon: '❄', aim: 'shot',              need: [240, 222, 204, 186, 168, 150], life: [2.5, 2.7, 2.9, 3.1, 3.3, 3.5] },
  // Repair Shot: the shell heals a team-mate all the way back to full. If it hits an enemy
  // instead it still hurts, but only half as much (foeDmg = the share that gets through).
  heal:   { tank: 'korek',   icon: '➕', aim: 'shot',              need: [160, 148, 136, 124, 112, 100], heal: [999, 999, 999, 999, 999, 999], foeDmg: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5] },
  // dps = health lost per second by an enemy caught inside, at the HOLE_RIM..HOLE_CORE scale below
  hole:   { tank: 'newroz',  icon: '🕳', aim: 'ground', range: 30, need: [320, 296, 272, 248, 224, 200], r: [12, 13, 14, 15, 16, 17], life: [3.5, 3.8, 4.1, 4.4, 4.7, 5], pull: [9, 10, 11, 12, 13, 14], dps: [10, 11, 12, 13, 14, 15] },
};
/** Damage you must deal to enemies before this power is ready. */
export const abNeed = (ab, l = 0) => lvl(ab, 'need', l) || 999;
/** How you point it: 'ground' | 'dir' | 'shot' | 'self'. */
export const abAim = (ab) => (ABILITIES[ab] ? ABILITIES[ab].aim : 'self');
/** How far in front of the tank a placed power can go. */
export const abRange = (ab) => (ABILITIES[ab] && ABILITIES[ab].range) || 0;
/** The biggest placement distance of any power — the wire format scales to this. */
// A black hole grinds down whatever is inside it: slowly out at the rim, hard in the middle.
// At the rim an enemy loses HOLE_RIM x dps health per second, dead centre HOLE_CORE x dps,
// so a level-0 hole runs from 4/s at the edge to 20/s in the middle (10/s about halfway).
export const HOLE_RIM = 0.4, HOLE_CORE = 2;
/** Health per second an enemy loses at distance d from the middle of hole h. */
export function holeDps(h, d) {
  if (!h.dps || d > h.r) return 0;
  const close = Math.max(0, 1 - d / h.r);              // 0 at the rim, 1 dead centre
  return h.dps * (HOLE_RIM + (HOLE_CORE - HOLE_RIM) * close);
}
export const AB_RANGE_MAX = 30;
export const AB_IDS = Object.keys(ABILITIES);
export const MAX_AB = 5;
/** Which ability a tank type carries. */
export const AB_OF = {};
for (const [k, a] of Object.entries(ABILITIES)) AB_OF[a.tank] = k;
export const abilityOf = (tankId) => AB_OF[tankId] || null;
/** One number of an ability at an upgrade level (0…5). */
export function lvl(ab, key, l = 0) {
  const A = ABILITIES[ab]; if (!A || !A[key]) return 0;
  return A[key][Math.max(0, Math.min(MAX_AB, l | 0))];
}
export const abLevel = (mods) => Math.max(0, Math.min(MAX_AB, (mods && mods.ab) | 0));

// Upgrading an ability costs the same kind of money as a stat, a bit more.
const AB_COINS = [220, 500, 1100, 2400, 5200], AB_PARTS = [14, 34, 80, 175, 360];
const RK = { common: 1, rare: 1.5, epic: 2, legendary: 3 };
export function abCost(rarity, k) {
  if (k >= MAX_AB) return null;
  const r = RK[rarity] || 1;
  return { coins: Math.round(AB_COINS[k] * r), parts: Math.round(AB_PARTS[k] * r) };
}

/* ---------------- live effects that sit on the map ----------------
   A match's map carries fx = {walls, domes, holes}. The server owns them
   and tells clients when one appears or goes; both sides then run the very
   same physics on them, so your tank is pulled into a black hole on your
   screen at the same moment as on the server. */
export function attachFx(map) {
  const fx = map.fx && map.fx.own === map ? map.fx : (map.fx = { own: map, walls: [], domes: [], holes: [] });
  fx.walls.length = 0; fx.domes.length = 0; fx.holes.length = 0;
  if (!map.near0) {
    map.near0 = map.near;
    map.near = (x, z) => {
      const b = map.near0(x, z), W = map.fx && map.fx.walls;
      if (!W || !W.length) return b;
      let out = null;
      for (const w of W) if (!w.gone && Math.abs(w.x - x) < 12 && Math.abs(w.z - z) < 12) (out || (out = b.slice())).push(...w.cols);
      return out || b;
    };
  }
  return fx;
}
/** Build the colliders of one cover wall (a short row of posts across the aim direction). */
export function wallCols(w) {
  const n = 5, R = 0.95, step = (w.len - R * 2) / (n - 1), sx = Math.cos(w.a), sz = -Math.sin(w.a);
  const cols = [];
  for (let i = 0; i < n; i++) { const d = -w.len / 2 + R + step * i; cols.push({ x: w.x + sx * d, z: w.z + sz * d, r: R, wall: w }); }
  return cols;
}
/** Extra pull on a tank from every black hole that is not on its own side. Run by server AND client. */
export function fxForces(s, map, dt) {
  const fx = map.fx; if (!fx || !fx.holes.length) return;
  for (const h of fx.holes) {
    if (h.tm && s.tm && h.tm === s.tm) continue;           // your own team is not pulled
    const dx = h.x - s.x, dz = h.z - s.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > h.r || d < 0.4) continue;
    const k = (1 - d / h.r) * h.pull * dt;                 // stronger the closer you are
    s.x += (dx / d) * k; s.z += (dz / d) * k;
  }
}
/** True when a shot from (x0,z0) to (x1,z1) crosses the skin of a dome — the shell dies there. */
export function domeBlock(map, x0, z0, x1, z1) {
  const fx = map.fx; if (!fx || !fx.domes.length) return null;
  for (const d of fx.domes) {
    const a = Math.hypot(x0 - d.x, z0 - d.z) <= d.r, b = Math.hypot(x1 - d.x, z1 - d.z) <= d.r;
    if (a !== b) return d;
  }
  return null;
}
