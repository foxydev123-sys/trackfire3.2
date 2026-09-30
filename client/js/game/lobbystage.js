/* =====================================================================
   LOBBY STAGE — the tanks you see on the menu screen.

   Your tank stands on the ground south of the Citadel, turned about 35°
   so you see its front and one side, with Hawler behind it. As friends
   join your squad their tanks fall in beside you and the camera eases
   back so the whole line stays in frame; when one leaves it closes up
   again. Everyone's pick is live: change tank and the model swaps.

   The stage only ever runs on the menu and lobby screens — it is torn
   down before a match, so it costs a match nothing.
   ===================================================================== */
import * as THREE from '../three.js';
import { TankView } from './tank.js';
import { TANKS } from '../../shared/tanks.js';

// Every map carries its own staging ground — where the line-up stands, where the camera goes
// and what it looks at — in `map.lobby` (see LOBBY in shared/maps.js). The area around it has
// already been swept clear of rocks, trees and props, so nothing can hide a tank.
const FALLBACK = { stage: { x: 3.1, z: 26.5 }, look: { x: 0, z: 17 },
                   shot: { dist: 23, height: 5.4, side: -2.5, aim: 2.2 }, clear: 15 };

// Up to four standing spots. You take the middle one; the empty ones show a "+" to bring a
// friend in — the same shape as the squad slots in games like Brawl Stars.
//
// The line-up is only as wide as the squad needs: on your own it is you plus one open place,
// and it grows as people arrive. That keeps every tank big enough to see on a phone, instead
// of framing four spots when three of them are empty.
export const SLOTS = 4;
const SPACING = 6.6;            // metres between spots
const ARC = 1.2;                // the outer spots sit a little further back, so none is hidden
const TURN = 0.62;              // radians off facing the camera dead-on — about 35°
// How far the camera pulls back for a line-up of 1, 2, 3 or 4 spots, as a multiple of the
// map's own shot distance. Two tanks need much less room than four.
const ZOOM = [0.74, 0.88, 1.0, 1.12];

const FILL_ORDER = [1, 2, 0, 3];

const TEAM_COL = [
  [0xd8a83c, 0xffe0a0],   // you — the game's amber
  [0x5f92e8, 0xbcd6ff],
  [0x6fb85f, 0xc4f0b8],
  [0xb07fd8, 0xe2c8ff],
];

export class LobbyStage {
  constructor() {
    this.W = null;              // the world we are staged in
    this.views = new Map();     // player id → { view, kind, slot }
    this.t = 0;
    this.L = FALLBACK;
    this.cam = { ...FALLBACK.shot };
    this.want = { ...FALLBACK.shot };
    this.spin = 0;              // a slow drift, so the shot is never dead still
    // The clear strip between the two menu columns, in screen pixels. The camera frames the
    // line-up into THIS, not into the whole window, so a tank is never left under a panel.
    this.safe = null;
    this.pan = 0; this.wantPan = 0;       // sideways dolly that centres the line-up on the strip
    this.fit = 1; this.wantFit = 1;       // how much further back to sit so the line-up fits it
    // Frames still owed a worked-out shot rather than an eased one. More than one, because the
    // squad bar and the side panel re-lay-out on the same change, and the shot has to be framed
    // around where they end up, not where they were.
    this.snapFor = 3;
    this._shown = 0;
  }

  /** Move the stage into `W` (the menu world). Safe to call with the same world again. */
  attach(W) {
    if (this.W === W) return;
    this.clear();
    this.W = W;
    this.L = (W && W.map && W.map.lobby) || FALLBACK;     // this map's own staging ground
    this.want = { ...this.L.shot };
    this.cam = { ...this.L.shot };
    this.pan = this.wantPan = 0; this.fit = this.wantFit = 1;                        // snap, don't sweep across the map
    this.snapFor = 3;
  }

  clear() {
    for (const e of this.views.values()) e.view.dispose();
    this.views.clear();
  }

  groundY(x, z) { return this.W && this.W.map ? this.W.map.height(x, z) : 0; }

  /**
   * Set the whole line-up at once.
   * `players` = [{ id, tank }] in the order they should stand, you first.
   */
  setPlayers(players) {
    if (!this.W) return;
    const list = players.slice(0, SLOTS);
    const seen = new Set();
    this.taken = new Set();
    list.forEach((p, i) => {
      seen.add(p.id);
      const slot = FILL_ORDER[i];
      this.taken.add(slot);
      const kind = p.tank || 'zagros';
      let e = this.views.get(p.id);
      if (e && e.kind !== kind) { e.view.dispose(); e = null; }     // they switched tank
      if (!e) {
        const [col, acc] = TEAM_COL[i % 4];
        const view = new TankView(this.W.scene, col, acc, i === 0, kind);
        if (view.teamRing) view.teamRing.visible = false;           // no team ring on the menu
        view.setNight(!!this.W.night);
        e = { view, kind, slot, born: this.t };
        this.views.set(p.id, e);
      }
      e.slot = slot; e.me = i === 0;
    });
    for (const [id, e] of this.views) if (!seen.has(id)) { e.view.dispose(); this.views.delete(id); }
    // Someone joining or leaving widens or narrows the line-up on the very next frame. Easing the
    // camera into the new shot over a second meant the newcomer's tank spent that second sliding
    // about under the side panel, so work the shot out first and arrive already framed.
    if (this.shown() !== this._shown) { this._shown = this.shown(); this.snapFor = 3; }
  }

  /** How many standing places are shown: everyone here, plus one empty one to fill. */
  shown() { return Math.max(2, Math.min(SLOTS, this.views.size + 1)); }

  /** Where standing spot `i` is, of the `shown()` on the ground: a shallow arc, middle nearest. */
  spotOf(i) {
    const S = this.L.stage, n = this.shown(), off = this.orderOf(i) - (n - 1) / 2;
    return { x: S.x + off * SPACING, z: S.z - Math.abs(off) * ARC };
  }
  /** Where slot `i` sits left-to-right in a line-up of `shown()` places. */
  orderOf(i) {
    const n = this.shown(), used = FILL_ORDER.slice(0, n).slice().sort((a, b) => a - b);
    const at = used.indexOf(i);
    return at < 0 ? (n - 1) / 2 : at;
  }
  /** The places with nobody on them — one while there is room, none when the squad is full. */
  openSlots() {
    const taken = this.taken || new Set();
    return FILL_ORDER.slice(0, this.shown()).filter((i) => !taken.has(i));
  }

  /**
   * Tell the stage exactly which rectangles the UI paints over the scene, in pixels.
   * Real rectangles, not one inscribed strip: the menu columns do not reach the bottom of the
   * screen, and the tanks stand low, so the width beside and below them is theirs to use. Boxing
   * the line-up into the narrow strip between the columns was what shrank it to a thumbnail.
   */
  setSafe(rects, W, H) {
    rects = rects || [];
    // A shot is only right for the layout it was worked out against. The squad bar and the side
    // panel keep moving for a few frames after someone joins, so whenever a panel actually shifts,
    // work the shot out again rather than easing towards an answer that is already out of date.
    let sig = W + 'x' + H;
    for (const r of rects) sig += '|' + (r.x0 >> 1) + ',' + (r.x1 >> 1) + ',' + (r.y0 >> 1) + ',' + (r.y1 >> 1);
    if (sig !== this._sig) { this._sig = sig; this.snapFor = Math.max(this.snapFor, 1); }
    this.safe = { rects, W, H };
  }

  /** How far left and right a box spanning `top`..`bot` on screen can reach without meeting UI. */
  clearAt(top, bot) {
    const S = this.safe, mid = S.W / 2;
    let x0 = 6, x1 = S.W - 6;
    for (const r of S.rects) {
      if (Math.min(bot, r.y1) - Math.max(top, r.y0) <= 2) continue;   // not level with this box
      if (r.x1 <= mid) x0 = Math.max(x0, r.x1 + 16);                  // a panel down the left
      else if (r.x0 >= mid) x1 = Math.min(x1, r.x0 - 16);             // one down the right
      else if (r.x1 - mid < mid - r.x0) x1 = Math.min(x1, r.x0 - 16); // straddles: take the near side
      else x0 = Math.max(x0, r.x1 + 16);
    }
    return { x0, x1 };
  }

  /**
   * Work out how the camera has to move so no tank ends up behind a panel.
   * Measured, not assumed: every tank's own eight corners are projected through the real camera,
   * compared against the real panel rectangles beside them, and the answer comes back as a
   * sideways dolly plus a pull-back — plus a note (`urgent`, `viol`) on whether the shot as it
   * stands is merely untidy or actually hiding somebody.
   */
  fitToSafe(camera) {
    const S = this.safe;
    if (!S || !camera || !this.views.size) { this.wantPan = 0; this.wantFit = 1; this.viol = 0; this.urgent = false; return; }
    const V = this._v || (this._v = new THREE.Vector3());

    // 1. where every tank actually lands on screen, hull and all
    const boxes = [];
    let depth = 0, n = 0;
    for (const e of this.views.values()) {
      const sp = this.spotOf(e.slot);
      const P = (e.view && e.view.root && e.view.root.position) || null;
      const cx = P ? P.x : sp.x, cz = P ? P.z : sp.z;
      const cy = P ? P.y : this.groundY(sp.x, sp.z);
      const sz = (TANKS[e.kind] && TANKS[e.kind].size) || 1;
      const hw = 1.7 * sz, ht = 2.6 * sz, hl = 2.7 * sz;
      let lo = 1e9, hi = -1e9, top = 1e9, bot = -1e9, on = false;
      for (const ox of [-hw, hw]) for (const oy of [0, 2 * ht]) for (const oz of [-hl, hl]) {
        V.set(cx + ox, cy + oy, cz + oz);
        const d = V.distanceTo(camera.position);
        V.project(camera);
        if (V.z >= 1) continue;
        const px = (V.x * 0.5 + 0.5) * S.W, py = (-V.y * 0.5 + 0.5) * S.H;
        lo = Math.min(lo, px); hi = Math.max(hi, px);
        top = Math.min(top, py); bot = Math.max(bot, py);
        depth += d; n++; on = true;
      }
      if (on) boxes.push({ lo, hi, top, bot, me: !!e.me });
    }
    if (!boxes.length) { this.wantPan = 0; this.wantFit = 1; this.viol = 0; this.urgent = false; return; }
    depth /= n;
    const tn = Math.tan(((camera.fov || 36) * Math.PI / 180) / 2);
    const mPerPx = (2 * depth * tn * (camera.aspect || S.W / S.H)) / S.W;

    // 2. for each tank, how far it is over the panels beside it — and how much room it has spare
    let pushR = 0, pushL = 0, slackL = 1e9, slackR = 1e9;
    let meC = null, top = 1e9, bot = -1e9;
    for (const b of boxes) {
      const c = this.clearAt(b.top, b.bot);
      pushR = Math.max(pushR, c.x0 - b.lo);          // hanging off the left edge of its room
      pushL = Math.max(pushL, b.hi - c.x1);          // off the right
      slackL = Math.min(slackL, b.lo - c.x0);
      slackR = Math.min(slackR, c.x1 - b.hi);
      top = Math.min(top, b.top); bot = Math.max(bot, b.bot);
      if (b.me) meC = (b.lo + b.hi) / 2;
    }
    const lineW = Math.max(1, Math.max(...boxes.map((b) => b.hi)) - Math.min(...boxes.map((b) => b.lo)));

    // 3. slide if sliding is enough; only when it is over on BOTH sides is the line-up too wide
    let shift = 0, grow = 1;
    // Is something actually covered right now? Then the correction is not a matter of taste and
    // must not be eased into over a second — the panels finish sliding in after the squad changes,
    // and a tank sitting under one while the camera saunters over is exactly the bug being fixed.
    this.urgent = pushR > 0.5 || pushL > 0.5;
    if (pushR > 0 && pushL > 0) {
      grow = (lineW + pushR + pushL) / lineW;
      shift = (pushR - pushL) / 2;
    } else if (pushR > 0 || pushL > 0) {
      shift = pushR - pushL;
    } else if (meC != null) {
      // Nothing is covered, so spend what room is left putting YOUR tank in the middle — but keep
      // a margin in hand and stop once it is close enough. Without a deadband the shot creeps
      // towards centre frame after frame until it quietly slides a squadmate under a panel.
      const room = 14;
      const want = S.W / 2 - meC;
      const capped = Math.max(-Math.max(0, slackL - room), Math.min(Math.max(0, slackR - room), want));
      shift = Math.abs(capped) > 10 ? capped * 0.35 : 0;
    }

    // 4. the line-up must also stay on screen top to bottom
    const overT = Math.max(0, 6 - top), overB = Math.max(0, bot - (S.H - 6));
    if (overT > 0 || overB > 0) {
      const h = Math.max(1, bot - top);
      grow = Math.max(grow, (h + overT + overB) / h);
      this.urgent = true;
    }

    // how badly this shot fails, in pixels — what `solve` minimises
    this.viol = Math.max(0, pushR) + Math.max(0, pushL) + overT + overB;
    this.wantPan = this.pan - shift * mPerPx;      // camera right = subject left
    this.wantFit = Math.max(0.72, Math.min(2.2, this.fit * grow));
  }

  /** Called every menu frame. Returns the camera position and target to use. */
  frame(dt, camera) {
    this.t += dt;
    // Face the camera, then turn 35° off it, so you see the front and one side of every tank.
    const yaw = Math.atan2(this.cam.side, this.cam.dist) + TURN;
    for (const e of this.views.values()) {
      const s = this.spotOf(e.slot);
      // a gentle idle sway, each tank slightly out of phase with the others
      const sway = Math.sin(this.t * 0.5 + e.slot * 1.3) * 0.035;
      e.view.setPose(s.x, s.z, yaw + sway, yaw + sway, (x, z) => this.groundY(x, z), dt, 0);
      e.view.setShield(false, this.t);
    }
    // frame however many are actually standing there, so two tanks fill the screen properly
    const z = ZOOM[Math.min(ZOOM.length - 1, Math.max(0, this.shown() - 1))];
    this.want = { dist: this.L.shot.dist * z, height: this.L.shot.height * (0.82 + 0.18 * z),
                  side: this.L.shot.side, aim: this.L.shot.aim };
    const k = 1 - Math.exp(-dt * 2.2);
    for (const key of ['dist', 'height', 'side', 'aim']) this.cam[key] += (this.want[key] - this.cam[key]) * k;
    this.pan += (this.wantPan - this.pan) * k;
    this.fit += (this.wantFit - this.fit) * k;
    this.spin += dt * 0.055;
    const drift = Math.sin(this.spin) * 1.1;                 // a slow, small left-right drift
    const S = this.L.stage, K = this.L.look;
    // `pan` slides the whole shot sideways — camera and aim point together — so the line-up moves
    // across the frame into the clear strip without changing the character of the shot. `fit`
    // pulls the camera back until the whole line-up fits that strip.
    this.place(camera, this.pan, this.fit, drift);
    this.fitToSafe(camera);                 // measure where that landed, ready for the next frame

    // The rule, and the whole point of this machinery: no frame is ever drawn with a tank behind
    // a panel. Easing is for composition, and composition can wait a moment; a hidden tank cannot.
    // So the instant the measurement says something is actually covered — a friend arriving, the
    // side panel finishing its slide, a map change resetting the shot, the window being resized —
    // the framing is worked out in full here and used on this same frame instead of crept towards.
    if ((this.urgent || this.snapFor > 0) && this.safe) {
      if (this.snapFor > 0) this.snapFor--;
      this.solve(camera, drift);
      this.fitToSafe(camera);
    }
    return { x: S.x, z: S.z };
  }

  /** Put `camera` where a given pan and fit would put it. No drawing, so it is safe to iterate. */
  place(camera, pan, fit, drift) {
    const S = this.L.stage, K = this.L.look;
    const cx = S.x + this.cam.side + drift + pan;
    const cz = S.z + this.cam.dist * fit;
    const cy = this.groundY(cx, cz) + this.cam.height * (0.55 + 0.45 * fit);
    camera.position.set(cx, cy, cz);
    camera.lookAt(K.x + drift * 0.3 + pan, this.groundY(K.x, K.z) + this.cam.aim, K.z);
    camera.updateMatrixWorld && camera.updateMatrixWorld(true);
  }

  /**
   * Run the framing to its answer without drawing a frame. Placing the camera and measuring the
   * result is cheap — a couple of dozen rounds costs less than one frame — so when the line-up
   * changes shape we settle the shot here and show it already correct rather than sliding into it.
   */
  solve(camera, drift) {
    this.cam = { ...this.want };
    // Damped, and it keeps the best shot it saw rather than wherever the last round happened to
    // land: taking the whole correction each round makes the pull-back and the sideways slide
    // fight each other, and the search walks away from a perfectly good answer it already had.
    let bp = this.pan, bf = this.fit, best = Infinity;
    for (let i = 0; i < 64; i++) {
      this.place(camera, this.pan, this.fit, drift);
      this.fitToSafe(camera);
      if (this.viol < best - 0.01) { best = this.viol; bp = this.pan; bf = this.fit; }
      const dp = this.wantPan - this.pan, df = this.wantFit - this.fit;
      if (best <= 0.01 && Math.abs(dp) < 0.01 && Math.abs(df) < 0.002) break;
      this.pan += dp * 0.5;
      this.fit += df * 0.5;
    }
    this.pan = bp; this.fit = bf;
    this.place(camera, this.pan, this.fit, drift);
    this.fitToSafe(camera);
  }

  /** Where standing spot `i` shows up on screen, `up` metres above the ground. */
  slotScreen(i, camera, out, up = 1.6) {
    const s = this.spotOf(i);
    out.set(s.x, this.groundY(s.x, s.z) + up, s.z);
    out.project(camera);
    return { x: (out.x * 0.5 + 0.5) * innerWidth, y: (-out.y * 0.5 + 0.5) * innerHeight, on: out.z < 1 };
  }
}
