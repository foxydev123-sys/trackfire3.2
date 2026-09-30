/* Touch controls built for thumbs (not an emulated mouse):
   - MOVE stick and AIM stick; the turret points where you push.
   - FIRE button: hold to keep firing whenever the gun is loaded.
   Multi-touch safe: each finger is tracked by its pointer id.

   The layout is the player's: every control can be dragged anywhere,
   resized, and made faint ("visibility"). A touch goes to the nearest
   stick. "Floating" sticks jump to where the thumb lands; fixed sticks
   stay at their home spot. Saved in settings.touchLayout. */
import { settings, saveSettings } from '../settings.js';

// Smaller by default so the buttons cover less of the screen — Settings → Touch layout
// lets every player make them bigger again.
export const TOUCH_DEFAULT = () => ({
  move:  { x: 0.14, y: 0.75, s: 0.8 },
  aim:   { x: 0.88, y: 0.75, s: 0.8 },
  fire:  { x: 0.70, y: 0.84, s: 0.8 },
  power: { x: 0.855, y: 0.50, s: 0.8 },
  mic:   { x: 0.955, y: 0.33, s: 0.8 },
  alpha: 0.75, float: true,
});
export const TOUCH_ZONES = ['move', 'aim', 'fire', 'power', 'mic'];
export function touchLayout() {
  const d = TOUCH_DEFAULT(), L = settings.touchLayout || {};
  const pick = (k) => ({ ...d[k], ...(L[k] || {}) });
  const out = { alpha: L.alpha ?? d.alpha, float: L.float ?? d.float };
  for (const z of TOUCH_ZONES) out[z] = pick(z);
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TouchControls {
  constructor(root, els) {
    this.root = root; this.els = els; // {moveBase, moveKnob, aimBase, aimKnob, fire, power, mic}
    this.active = false; this.moveAngle = 0; this.moveMag = 0; this.aimAngle = 0; this.aimMag = 0; this.fire = false; this.everAimed = false;
    this.ptr = { move: null, aim: null, fire: null, power: null };
    this.R = 70; // stick radius in CSS px (before HUD scale and the player's size)
    this.editing = false; this.drag = null; this.sel = 'move';
    // Aim-and-release: push the aim stick far enough ("armed", a glowing ball appears), let go to fire.
    this.armed = false; this.firePending = 0; this.reloading = false; this.firePulse = false;
    // THE POWER STICK. The special power is not the cannon's business: it has its own control,
    // charged by its own bar. Hold it and drag to choose where the power goes, let go to use it —
    // a plain tap is just a very short hold, which is what an instant power like Vanish wants.
    this.abAngle = 0; this.abPush = 0; this.abPushHold = 0; this.abHold = false;
    this.abRelease = false; this.abOk = false;
    // How far the aim stick was pushed at the moment it was let go. A release-to-fire shot goes out on a
    // LATER tick, by which time aimMag is already back to 0 — without this latch a power placed by
    // aim-and-release would always land at the minimum distance, i.e. on top of your own tank.
    this.aimMagHold = 0;
    this.ball = document.createElement('i'); this.ball.className = 'ready-ball'; els.aimKnob.appendChild(this.ball);
    this.hint = document.createElement('span'); this.hint.className = 'letgo'; els.aimBase.appendChild(this.hint);
    this.L = touchLayout();
    const down = (e) => this.down(e), move = (e) => this.move(e), up = (e) => this.up(e);
    root.addEventListener('pointerdown', down, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    els.fire.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.editing) { this.startDrag('fire', e); return; }
      this.ptr.fire = e.pointerId; this.fire = true; this.firePulse = true;   // latched: a very quick tap still counts
      els.fire.classList.add('press'); this.onFire && this.onFire();
    }, { passive: false });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }
  scale() { return this.getScale ? this.getScale() : 1; }
  /** The special-power button: one tap = one use, picked up by the next input tick. */
  bindAbility(el) {
    if (!el || this._abBound) return; this._abBound = el; this.els.power = el;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.editing) { this.startDrag('power', e); return; }        // in the layout editor you move it instead
      if (!this.abOk) {                                                // still charging: say so and do nothing
        el.classList.remove('deny'); void el.offsetWidth; el.classList.add('deny');
        this.onAbilityDenied && this.onAbilityDenied(); return;
      }
      if (this.ptr.power !== null) return;
      this.ptr.power = e.pointerId;
      this.o_power = { x: e.clientX, y: e.clientY };
      this.abPush = 0; this.abPushHold = 0; this.abHold = true;
      el.classList.add('press', 'live');
      this.onAbility && this.onAbility();
    }, { passive: false });
    this.apply();
  }
  /** The power was let go of: use it now. One release = one use. */
  takeAbFire() { const v = this.abRelease; this.abRelease = false; return v; }
  /** How far out the power was pushed, 0…1 — live, or latched from the moment it was released. */
  abDist() { return Math.max(this.abPush, this.abPushHold); }
  endPower() {
    this.ptr.power = null; this.abHold = false;
    this.abPushHold = this.abPush; this.abPush = 0;
    const el = this.els.power; if (!el) return;
    el.classList.remove('press', 'live');
    const k = this.els.abKnob || (this.els.abKnob = el.querySelector('.ab-knob'));
    if (k) k.style.transform = '';
  }
  /** The microphone button is part of the layout too, so it can be moved and resized. */
  bindMic(el) {
    if (!el || this._micBound) return; this._micBound = el; this.els.mic = el;
    el.addEventListener('pointerdown', (e) => { if (this.editing) { e.preventDefault(); this.startDrag('mic', e); } }, { passive: false, capture: true });
    this.apply();
  }
  takePulse() { const v = this.firePulse; this.firePulse = false; return v; }
  /** How far out to place a power: the live stick, or the latched value if the stick was just let go. */
  abMag() { return Math.max(this.aimMag, this.aimMagHold); }
  baseOf(z) { return z === 'move' ? this.els.moveBase : z === 'aim' ? this.els.aimBase : z === 'power' ? this.els.power : z === 'mic' ? this.els.mic : this.els.fire; }
  home(z) { const c = this.L[z]; return { x: c.x * window.innerWidth, y: c.y * window.innerHeight }; }
  // Put every control at its saved spot, size and visibility.
  apply() {
    const L = this.L;
    for (const z of TOUCH_ZONES) {
      const b = this.baseOf(z); if (!b) continue;                 // the power / mic buttons appear later
      const h = this.home(z);
      b.style.setProperty('--sz', L[z].s);
      if (!b.classList.contains('live')) { b.style.left = h.x + 'px'; b.style.top = h.y + 'px'; }
    }
    this.root.style.setProperty('--ta', L.alpha);
  }
  save() { settings.touchLayout = JSON.parse(JSON.stringify(this.L)); saveSettings(); }
  reset() { this.L = TOUCH_DEFAULT(); this.apply(); this.save(); this.onEdit && this.onEdit(); }

  zoneOf(e) {
    const dist = (z) => { const h = this.home(z); return Math.hypot(e.clientX - h.x, e.clientY - h.y); };
    return dist('move') <= dist('aim') ? 'move' : 'aim';
  }
  place(base, x, y) { base.style.left = x + 'px'; base.style.top = y + 'px'; base.classList.add('live'); }
  down(e) {
    if (this.editing) {
      const st = e.target.closest('.stick');
      if (st) { e.preventDefault(); this.startDrag(st === this.els.moveBase ? 'move' : 'aim', e); }
      return;
    }
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.m-btn, .firebtn, .abilbtn, .no-stick')) return;
    e.preventDefault();
    this.active = true;
    const z = this.zoneOf(e);
    if (this.ptr[z] !== null) return;
    this.ptr[z] = e.pointerId;
    const s = this.baseOf(z);
    const r = this.root.getBoundingClientRect();
    if (this.L.float) { this['o_' + z] = { x: e.clientX, y: e.clientY }; this.place(s, e.clientX - r.left, e.clientY - r.top); }
    else { const h = this.home(z); this['o_' + z] = h; s.classList.add('live'); }
    this.move(e);
  }
  move(e) {
    if (this.drag && this.drag.id === e.pointerId) { e.preventDefault(); this.dragTo(e); return; }
    if (this.ptr.power === e.pointerId) {
      e.preventDefault();
      const o = this.o_power, el = this.els.power;
      const R = 58 * this.scale() * this.L.power.s;
      let dx = e.clientX - o.x, dy = e.clientY - o.y; const d = Math.hypot(dx, dy);
      this.abPush = Math.min(1, d / R); this.abPushHold = 0;
      if (d > R) { dx *= R / d; dy *= R / d; }
      if (d > 6) this.abAngle = Math.atan2(dx, dy);
      const k = this.els.abKnob || (this.els.abKnob = el && el.querySelector('.ab-knob'));
      if (k) k.style.transform = `translate(${dx}px, ${dy}px)`;
      return;
    }
    for (const z of ['move', 'aim']) {
      if (this.ptr[z] !== e.pointerId) continue;
      e.preventDefault();
      const sens = z === 'move' ? (settings.moveSens || 100) / 100 : (settings.aimSens || 100) / 100;   // higher = less thumb travel needed
      const o = this['o_' + z]; const R = this.R * this.scale() * this.L[z].s / sens;
      let dx = e.clientX - o.x, dy = e.clientY - o.y; const d = Math.hypot(dx, dy);
      const mag = Math.min(1, d / R); if (d > R) { dx *= R / d; dy *= R / d; }
      const knob = z === 'move' ? this.els.moveKnob : this.els.aimKnob;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const ang = Math.atan2(dx, dy); // screen right = +x, screen down = +z
      if (z === 'move') { this.moveAngle = ang; this.moveMag = mag < 0.15 ? 0 : mag; }
      else { this.aimAngle = ang; this.aimMag = mag; this.aimMagHold = 0; if (mag > 0.25) this.everAimed = true; this.setArmed(mag >= 0.6 && settings.releaseFire !== false); }
    }
  }
  up(e) {
    if (this.drag && this.drag.id === e.pointerId) { this.drag = null; this.save(); return; }
    if (this.ptr.fire === e.pointerId) { this.ptr.fire = null; this.fire = false; this.els.fire.classList.remove('press'); }
    if (this.ptr.power === e.pointerId) { this.abRelease = true; this.endPower(); return; }
    for (const z of ['move', 'aim']) {
      if (this.ptr[z] !== e.pointerId) continue;
      this.ptr[z] = null;
      const knob = z === 'move' ? this.els.moveKnob : this.els.aimKnob; knob.style.transform = '';
      const base = this.baseOf(z); base.classList.remove('live');
      const h = this.home(z); base.style.left = h.x + 'px'; base.style.top = h.y + 'px';
      if (z === 'move') this.moveMag = 0;
      else { if (this.armed) this.firePending = performance.now() + 450; this.aimMagHold = this.aimMag; this.aimMag = 0; this.setArmed(false); }
    }
  }
  setArmed(on) {
    if (on === this.armed) return; this.armed = on;
    this.els.aimBase.classList.toggle('armed', on);
    if (on && navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
  }
  setReloading(r) { if (r !== this.reloading) { this.reloading = r; this.els.aimBase.classList.toggle('wait', r); } }
  /** A release-to-fire shot waiting to go out (kept briefly so a shot released during reload still fires). */
  takeFire(reload) {
    if (!this.firePending) return false;
    if (performance.now() > this.firePending) { this.firePending = 0; return false; }
    if (reload > 0) return false;
    this.firePending = 0; return true;
  }
  release() {
    this.endPower(); this.abRelease = false; this.abPushHold = 0;
    this.ptr = { move: null, aim: null, fire: null, power: null }; this.moveMag = 0; this.aimMag = 0; this.aimMagHold = 0; this.fire = false; this.firePending = 0; this.setArmed(false);
    for (const z of ['move', 'aim']) { this.baseOf(z).classList.remove('live'); }
    this.els.moveKnob.style.transform = ''; this.els.aimKnob.style.transform = ''; this.els.fire.classList.remove('press');
    this.apply();
  }

  /* ---------------- layout editor ---------------- */
  setEditing(on) {
    this.release(); this.editing = on; this.drag = null;
    this.root.classList.toggle('editing', on);
    this.select(this.sel);
  }
  select(z) {
    this.sel = z;
    for (const k of TOUCH_ZONES) { const b = this.baseOf(k); if (b) b.classList.toggle('sel', this.editing && k === z); }
    this.onEdit && this.onEdit();
  }
  startDrag(z, e) {
    const h = this.home(z);
    this.drag = { id: e.pointerId, z, dx: e.clientX - h.x, dy: e.clientY - h.y };
    this.select(z);
  }
  dragTo(e) {
    const { z, dx, dy } = this.drag, W = window.innerWidth, H = window.innerHeight;
    const half = (z === 'fire' ? 56 : z === 'power' ? 32 : z === 'mic' ? 26 : 85) * this.scale() * this.L[z].s;
    const x = clamp(e.clientX - dx, half, W - half), y = clamp(e.clientY - dy, half, H - half);
    this.L[z].x = x / W; this.L[z].y = y / H; this.apply();
  }
  setSize(v) { this.L[this.sel].s = clamp(v, 0.6, 1.6); this.apply(); this.save(); }
  setAlpha(v) { this.L.alpha = clamp(v, 0.15, 1); this.apply(); this.save(); }
  setFloat(v) { this.L.float = !!v; this.save(); }
}
