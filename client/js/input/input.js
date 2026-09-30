/* Controls → one raw input per tick.
   PC:     WASD / arrows = drive, mouse = aim, left click or Space = fire.
           Mode "Direction" (default): WASD is a screen direction and the
           tank turns toward it. Mode "Classic": W/S throttle, A/D rotate.
           Q (or right click) = pick up the tank's power, then aim with the mouse and click to place it.
   Mobile: see touch.js (left stick drive, right stick aim, FIRE button, power button). */
import { MODE_DIR, MODE_CLASSIC } from '../../shared/sim.js';

export class Input {
  constructor(el) {
    this.el = el; this.keys = new Set(); this.mouse = { x: 0, y: 0, in: false, down: false, right: false };
    this.aimWorld = null;            // {x, z} ground point under cursor (set by game)
    this.touch = null;               // TouchControls when on mobile
    this.mode = 'dir';
    this.lastAim = 0; this.enabled = true;
    // The power is held and released, not confirmed with the trigger: hold Q (or the right mouse
    // button) to see where it will land, let go to use it. The gun is not involved at any point.
    this.abDown = false; this.abFired = false;
    this.firePulse = false;                   // same for a very quick click / Space tap
    this.abRange = 20;                        // how far the armed power can reach (set by the game)
    this.onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (e.type === 'keydown') {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
        if (k === 'KeyQ' && !e.repeat) this.abDown = true;      // held: aim the power
        if (k === 'Space' && !e.repeat) this.firePulse = true;
        this.keys.add(k);
      } else {
        if (k === 'KeyQ' && this.abDown) { this.abDown = false; this.abFired = true; }   // let go: use it
        this.keys.delete(k);
      }
    };
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.mouse.right = false; this.abDown = false; this.abFired = false; this.firePulse = false; });
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true; });
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; if (e.button === 2) { this.mouse.right = true; this.abDown = true; } if (e.button === 0) { this.mouse.down = true; this.firePulse = true; } this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true; });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) { this.mouse.right = false; if (this.abDown) { this.abDown = false; this.abFired = true; } } });
    el.addEventListener('pointerleave', () => { this.mouse.in = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  key(...codes) { return codes.some(c => this.keys.has(c)); }
  /** How far out the player is pointing, as 0…1 of the power's reach. */
  abDist(me) {
    if (this.touch && this.touch.active) return Math.max(0.12, Math.min(1, this.touch.abDist() / 0.95));
    if (this.aimWorld) {
      const d = Math.hypot(this.aimWorld.x - me.x, this.aimWorld.z - me.z);
      return Math.max(0.12, Math.min(1, d / Math.max(1, this.abRange)));
    }
    return 0.6;
  }
  /** me = predicted local tank state */
  get(me) {
    if (!this.enabled) { this.abDown = false; this.abFired = false; this.firePulse = false; return { mode: MODE_DIR, dir: 0, mag: 0, aim: me.t, fire: false, abFire: false, abHold: false, abAim: me.t, abd: 0 }; }
    if (this.touch && this.touch.active) {
      const t = this.touch;
      if (t.aimMag > 0.25) this.lastAim = t.aimAngle; else if (!t.everAimed) this.lastAim = me.yaw;
      const abd = this.abDist(me);          // read the stick BEFORE taking the shot, which clears it
      // the power carries its own angle: the power stick's, falling back to where the tank looks
      const abAim = t.abHold || t.abPushHold > 0 ? t.abAngle : me.t;
      this.lastAbAim = abAim;                       // so the preview can be drawn where it will land
      return { mode: MODE_DIR, dir: t.moveAngle, mag: t.moveMag, aim: this.lastAim,
        fire: t.fire || t.takePulse() || t.takeFire(me.reload),
        abFire: t.takeAbFire(), abHold: !!t.abHold, abAim, abd };
    }
    let aim = this.lastAim;
    if (this.aimWorld) { aim = Math.atan2(this.aimWorld.x - me.x, this.aimWorld.z - me.z); this.lastAim = aim; }
    const fire = this.mouse.down || this.key('Space') || this.firePulse;
    this.firePulse = false;
    const abFire = this.abFired; this.abFired = false;              // one release = one use
    const abHold = this.abDown, abAim = aim;                       // the mouse aims the power too
    this.lastAbAim = abAim;
    const abd = this.abDist(me);
    const up = this.key('KeyW', 'ArrowUp'), dn = this.key('KeyS', 'ArrowDown'), lf = this.key('KeyA', 'ArrowLeft'), rt = this.key('KeyD', 'ArrowRight');
    if (this.mode === 'classic') {
      return { mode: MODE_CLASSIC, throttle: (up ? 1 : 0) - (dn ? 1 : 0), steer: (lf ? 1 : 0) - (rt ? 1 : 0), aim, fire, abFire, abHold, abAim, abd };
    }
    // Screen-relative: camera looks north (−z), so screen up = −z, right = +x.
    const x = (rt ? 1 : 0) - (lf ? 1 : 0), z = (dn ? 1 : 0) - (up ? 1 : 0);
    const mag = x || z ? 1 : 0;
    return { mode: MODE_DIR, dir: Math.atan2(x, z), mag, aim, fire, abFire, abHold, abAim, abd };
  }
}
