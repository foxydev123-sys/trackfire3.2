/* Player settings, saved in this browser (localStorage). Also holds the
   client-side camera constants. */
export const CAMERA = { PITCH_DEG: 58, DIST: 44, FOV: 36, LOOK_AHEAD: 0.18, LOOK_AHEAD_MAX: 4, FOLLOW: 4.5 };

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, shadowMap: 1024, particles: 0.45, lowDetail: true },
  medium: { pixelRatio: 1.25, shadows: true, shadowMap: 1024, particles: 0.75, lowDetail: false },
  high:   { pixelRatio: 2, shadows: true, shadowMap: 2048, particles: 1, lowDetail: false },
};

export const isTouch = () => (typeof window !== 'undefined') && (('ontouchstart' in window) || matchMedia('(pointer: coarse)').matches);

const DEFAULTS = () => ({
  name: '', quality: 'high', shadows: true, particles: 'full', renderScale: 100, autoRes: true,
  master: 80, music: 40, sfx: 90, mute: false, controls: 'dir', touch: 'auto', releaseFire: true, moveSens: 100, aimSens: 100, debug: false, shake: true, xray: true, sun: 'midday',
  // voice chat — off until the player turns it on
  voice: false, voiceMode: 'push', voiceTalk: 'team', voiceHear: 'team', voiceVol: 100,
});
export const settings = (() => {
  let s = DEFAULTS();
  try { const raw = localStorage.getItem('trackfire-settings'); if (raw) s = { ...s, ...JSON.parse(raw) }; } catch (e) {}
  return s;
})();
export function saveSettings() { try { localStorage.setItem('trackfire-settings', JSON.stringify(settings)); } catch (e) {} }
export function useTouch() { return settings.touch === 'on' || (settings.touch === 'auto' && isTouch()); }
export function getToken() {
  // Per-tab token (sessionStorage): a page reload rejoins your old slot, but two tabs are two players.
  try { let t = sessionStorage.getItem('trackfire-token'); if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('trackfire-token', t); } return t; }
  catch (e) { return Math.random().toString(36).slice(2); }
}
