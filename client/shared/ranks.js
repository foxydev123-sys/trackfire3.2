/* Rank tiers, seasons and the weekly quick-match mode.
   Shared by the server (to compute) and the client (to display). */
import { GAME } from './config.js';

// Each tier has 3 divisions (III → II → I), 100 RP each. Commander I is open-ended.
export const TIERS = [['bronze', 0], ['silver', 300], ['gold', 600], ['plat', 900], ['dia', 1200], ['cmd', 1500]];
export const LEGEND_TOP = 100;       // the top 100 Commanders are shown as Legend

/** rp → { tier, div, next: {tier, div, need}, pct } (placement and Legend are decided by the caller). */
export function rankOf(rp) {
  rp = Math.max(0, rp | 0);
  let i = TIERS.length - 1; while (i > 0 && rp < TIERS[i][1]) i--;
  const [tier, start] = TIERS[i];
  const div = Math.max(1, 3 - Math.floor((rp - start) / 100));
  const divStart = start + (3 - div) * 100;
  let next = null;
  if (div > 1) next = { tier, div: div - 1, need: divStart + 100 - rp };
  else if (i < TIERS.length - 1) next = { tier: TIERS[i + 1][0], div: 3, need: TIERS[i + 1][1] - rp };
  const pct = next ? Math.min(1, (rp - divStart) / 100) : 1;
  return { tier, div, next, pct };
}

// Seasons: 2 months each, Season 1 = September + October 2026 (UTC).
const S0 = Date.UTC(2026, 8, 1);
export function seasonInfo(ts = Date.now()) {
  const d = new Date(Math.max(ts, S0));
  const months = (d.getUTCFullYear() - 2026) * 12 + d.getUTCMonth() - 8;
  const n = Math.floor(months / 2) + 1;
  const start = Date.UTC(2026, 8 + (n - 1) * 2, 1), end = Date.UTC(2026, 8 + n * 2, 1);
  return { n, start, end, daysLeft: Math.max(0, Math.ceil((end - ts) / 86400000)) };
}
/** New season: everyone keeps half of what they had above the starting RP. */
export const seasonResetRp = (rp) => Math.round(GAME.RANKED.START_RP + Math.max(0, rp - GAME.RANKED.START_RP) * 0.5);

// Weekly quick-match mode (weeks start Monday 00:00 UTC).
const W0 = Date.UTC(2026, 8, 21);   // a Monday
export function quickModeOf(ts = Date.now()) {
  const w = Math.floor((ts - W0) / (7 * 86400000));
  const R = GAME.QUICK_ROTATION; return R[((w % R.length) + R.length) % R.length];
}
