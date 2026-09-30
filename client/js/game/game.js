/* =====================================================================
   Game — one match on screen. Runs every rendered frame:
     net.update()  → fixed-rate inputs + prediction, render clock, due events
     local tank    → predicted pose (instant response)
     remote tanks  → interpolated poses (smooth at any frame rate)
     shells / fx / camera / HUD / audio
   ===================================================================== */
import * as THREE from '../three.js';
import { TankView, TEAM_COLORS, TEAM_ACCENT, FFA_COLORS } from './tank.js';
import { FX } from './fx.js';
import { Shells } from './shells.js';
import { Rockets } from './rockets.js';
import { Debris } from './debris.js';
import { makeTruck, makeBall, makeGoal, makeBomb } from './modeprops.js';
import { CAMERA, QUALITY, settings } from '../settings.js';
import { GAME } from '../../shared/config.js';
import { dist, clamp, lerp } from '../../shared/math.js';
import { t } from '../i18n.js';
import { TOPPLE } from '../../shared/maps.js';
import { TANKS, levelOf, MAX_LEVEL } from '../../shared/tanks.js';
import { AbilityFx, makeCage } from './abilityfx.js';

// Which sound each power makes when it goes off, and how hard it shakes the camera for the
// player who used it. Both are per-power so the eight of them are told apart with eyes shut.
const AB_SOUND = { wall: 'abWall', dome: 'dome', hole: 'blackhole', cloak: 'cloak',
                   homing: 'abMissile', drone: 'abDrone', heal: 'abHeal', freeze: 'abFreezeCast' };
const AB_SHAKE = { wall: 0.26, dome: 0.16, hole: 0.34, cloak: 0.08,
                   homing: 0.2, drone: 0.18, heal: 0.08, freeze: 0.12 };
import { ABILITIES, abilityOf, abAim, abRange, lvl as abNum } from '../../shared/abilities.js';

export const PU_COLORS = { shield: 0x46a8ff, speed: 0xffd23a, health: 0x49d16a, oneshot: 0xff3b2f, rocket: 0xff8a3a };
export const PU_NAMES = { shield: 'shield', speed: 'speedBoost', health: 'fullHealth', oneshot: 'oneShotRound', rocket: 'homingRockets' }; // i18n keys
// Floating power-up pickups on their pads (one icon per type, only the active one shown).
export function buildPads(W, groundY) {
  const out = [];
  const B = (c) => new THREE.MeshBasicMaterial({ color: c });
  for (const [x, z] of W.map.pads || []) {
    const g = new THREE.Group(); const y = groundY(x, z); g.position.set(x, y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0x2b2f33, flatShading: true }));
    base.position.y = 0.11; base.receiveShadow = true; g.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.65, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.24; g.add(ring);
    const icons = {};
    const sh = new THREE.Group(); const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 6), B(PU_COLORS.shield)); hex.rotation.x = Math.PI / 2; sh.add(hex);
    const hexIn = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.34, 6), B(0xffffff)); hexIn.rotation.x = Math.PI / 2; sh.add(hexIn); icons.shield = sh;
    const sp = new THREE.Group(); for (const dx of [-0.35, 0.35]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.55, 0.9, 4), B(PU_COLORS.speed)); c.rotation.z = -Math.PI / 2; c.position.x = dx; sp.add(c); } icons.speed = sp;
    const he = new THREE.Group(); he.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 0.45), B(PU_COLORS.health))); he.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), B(PU_COLORS.health))); icons.health = he;
    const os = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.0, 8), B(PU_COLORS.oneshot)); os.add(body);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.32, 0.5, 8), B(0xffd9b0)); tip.position.y = 0.75; os.add(tip); icons.oneshot = os;
    // homing rockets: two little rockets side by side
    const rk = new THREE.Group(); for (const dx of [-0.32, 0.32]) { const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 8), B(PU_COLORS.rocket)); b2.position.x = dx; rk.add(b2);
      const n2 = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.2, 0.4, 8), B(0xffffff)); n2.position.set(dx, 0.65, 0); rk.add(n2); } rk.rotation.z = 0.35; icons.rocket = rk;
    const holder = new THREE.Group(); holder.position.y = 1.7; g.add(holder);
    for (const k in icons) { icons[k].visible = false; holder.add(icons[k]); }
    W.scene.add(g);
    out.push({ x, z, g, ring, holder, icons, type: null });
  }
  return out;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
// Tall things that can hide a tank from the camera (for the x-ray silhouette): boxes (hw, hd) or circles (r), with a height.
function buildOccluders(M) {
  const list = [];
  for (const o of M.objects) {
    const k = o.k;
    if (k === 'building') list.push({ x: o.x, z: o.z, hw: o.w / 2, hd: o.d / 2, h: o.h + 0.4 });
    else if (k === 'arch') list.push({ x: o.x, z: o.z, hw: o.w / 2, hd: o.d / 2, h: o.h });
    else if (k === 'arcade') { const along = Math.abs(Math.sin(o.ry)) > 0.5; list.push({ x: o.x, z: o.z, hw: along ? 3.75 : o.len / 2, hd: along ? o.len / 2 : 3.75, h: o.H + 1 }); }
    else if (k === 'citadel') list.push({ x: o.x, z: o.z, r: o.T + 1, h: o.H + 5 });
    else if (k === 'mesa') list.push({ x: o.x, z: o.z, r: o.R * 0.9, h: o.H });
    else if (k === 'cabin') list.push({ x: o.x, z: o.z, r: Math.max(o.w, o.d) / 2, h: 4.5 });
    else if (k === 'ruin') list.push({ x: o.x, z: o.z, r: Math.max(o.w, o.d) * 0.5, h: o.H });
    else if (k === 'tower') list.push({ x: o.x, z: o.z, r: 2, h: 8.5 });
    else if (k === 'pine' || k === 'leafy' || k === 'ctree') list.push({ x: o.x, z: o.z, r: 2 * o.s, h: 5.2 * o.s, tag: k === 'ctree' ? o.i : null });
    else if (k === 'palm') list.push({ x: o.x, z: o.z, r: 2.1 * o.s, h: 5.6 * o.s, tag: o.i });
  }
  const grid = new Map(), CS = 6;
  for (const c of list) { const ex = c.r || Math.max(c.hw, c.hd);
    for (let gx = Math.floor((c.x - ex) / CS); gx <= Math.floor((c.x + ex) / CS); gx++) for (let gz = Math.floor((c.z - ex) / CS); gz <= Math.floor((c.z + ex) / CS); gz++) {
      const key = gx * 1000 + gz; let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(c); } }
  return { at: (x, z) => grid.get(Math.floor(x / CS) * 1000 + Math.floor(z / CS)) };
}
const XRAY_OFF = [-1.1, 0, 1.1];        // three lines across the tank's width
const RARITY_STAR = { common: '#cfd6dd', rare: '#6fbaff', epic: '#c98bff', legendary: '#ffcf3a' };
/** The stars over a tank: how far it is upgraded (1…5), coloured by how rare the tank is, plus its power icon. */
function starsOf(info) {
  if (!info || !info.tank) return null;
  const T = TANKS[info.tank]; if (!T) return null;
  const lv = Math.max(1, Math.min(MAX_LEVEL, info.lvl || 1));
  const A = info.ab && ABILITIES[info.ab];
  return { n: Math.max(1, Math.ceil(lv / 2)), col: RARITY_STAR[T.rarity] || '#fff', ab: A ? A.icon : '' };
}
const TEAM_HEX = { blue: 0x62a2ff, red: 0xff6250 };
const ZONE_HEX = { blue: 0x62a2ff, red: 0xff6250, contested: 0xffd23a, null: 0xffffff };

// Capture-the-Flag flag: a Kurdish flag on a pole with a team-coloured cap and base ring.
function buildCtfFlag(team) {
  const g = new THREE.Group(), M = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, side: THREE.DoubleSide });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 6), M(0xdddddd)); pole.position.y = 2.6; g.add(pole);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: TEAM_HEX[team] })); cap.position.y = 5.3; g.add(cap);
  const cloth = new THREE.Group(); cloth.position.set(1.25, 4.45, 0); g.add(cloth);
  [[0xed2024, 0.5], [0xf7f7f2, 0], [0x278e43, -0.5]].forEach(([c, y]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.05), M(c)); m.position.y = y; cloth.add(m); });
  const sun = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), new THREE.MeshBasicMaterial({ color: 0xfebd11 })); sun.rotation.x = Math.PI / 2; cloth.add(sun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 24), new THREE.MeshBasicMaterial({ color: TEAM_HEX[team], transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { cloth, ring };
  return g;
}

export class Game {
  constructor({ renderer, camera, net, hud, input, audio, getWorld }) {
    Object.assign(this, { renderer, camera, net, hud, input, audio, getWorld });
    this.views = new Map(); this.W = null; this.camT = new THREE.Vector3(); this.shake = 0;
    this.recent = []; this.deadInfo = null; this.room = null; this.lastMe = { x: 0, z: 0, yaw: 0 };
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); this.ndc = new THREE.Vector2();
    this.perf = { frames: 0, acc: 0, fps: 60, ms: 16.7, low: 0, high: 0 }; this.resScale = settings.renderScale / 100;
    this.aimLine = null; this.scoresHeld = false;
  }

  /* ---------------- setup ---------------- */
  useMap(mapId) {
    const W = this.getWorld(mapId);
    if (this.W === W) return;
    this.clearViews();
    if (this.aimLine && this.W) { this.W.scene.remove(this.aimLine, this.aimDot); }
    this.W = W;
    if (!W.fx) {
      W.fx = new FX(W.scene, W.map.env.dust, 360, { lights: settings.quality === 'low' ? 0 : 2 }); W.shells = new Shells(W.scene); W.shells.fx = W.fx; W.rockets = new Rockets(W.scene, W.fx); W.debris = new Debris(W.scene); W.pads = buildPads(W, (x, z) => this.groundY(x, z));
      // your own headlights: a real spot light (kept in the scene all the time so shaders never recompile)
      W.spot = new THREE.SpotLight(0xffe8c0, 0, 36, 0.62, 0.65, 1.2); W.scene.add(W.spot, W.spot.target);
      W.abfx = new AbilityFx(W.scene, (x, z) => this.groundY(x, z));
      W.abfx.audio = this.audio; W.abfx.myId = this.net.myId;   // so a rocket can make its own noise
    }
    W.shells.clear(); W.rockets.clear(); if (W.abfx) W.abfx.clear();
    if (!this.aimLine) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      this.aimLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.7, gapSize: 0.5, transparent: true, opacity: 0.55 }));
      this.aimLine.frustumCulled = false;
      this.aimDot = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
      this.aimDot.rotation.x = -Math.PI / 2;
    }
    W.scene.add(this.aimLine, this.aimDot);
    if (!W.occ) W.occ = buildOccluders(W.map);
    this.applyQuality();
  }
  // Is a tank at (x, z) hidden from the camera by something tall between it and the camera?
  /* Is a tank hidden behind something tall? This walks a short line toward the camera and
     is asked for every tank on screen, so the answer is remembered for a few frames and
     only worked out again once the tank has actually moved. */
  hiddenAt(x, z, key = null) {
    if (key != null) {
      const c = (this.xrayC ||= new Map()).get(key);
      const now = this.t || 0;
      if (c && now - c.t < 0.12 && Math.abs(c.x - x) < 0.6 && Math.abs(c.z - z) < 0.6) return c.v;
      const v = this.hiddenAt(x, z);
      this.xrayC.set(key, { t: now, x, z, v });
      return v;
    }
    const occ = this.W.occ, tp = this.xrayTan || (this.xrayTan = Math.tan(CAMERA.PITCH_DEG * Math.PI / 180)), gone = this.W.gone;
    for (const ox of XRAY_OFF) for (let d = 0.4; d < 15; d += 0.7) {
      const px = x + ox, pz = z + d, need = 1.2 + d * tp, a = occ.at(px, pz); if (!a) continue;
      for (const o of a) {
        if (o.h <= need || (o.tag != null && gone && gone.has(o.tag))) continue;
        if (o.r ? (px - o.x) * (px - o.x) + (pz - o.z) * (pz - o.z) < o.r * o.r : Math.abs(px - o.x) < o.hw && Math.abs(pz - o.z) < o.hd) return true;
      }
    }
    return false;
  }
  applyQuality() {
    const Q = QUALITY[settings.quality] || QUALITY.medium;
    const shadows = Q.shadows && settings.shadows;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      if (this.W) this.W.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    }
    this.renderer.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.W) {
      const ms = Q.shadowMap; const sh = this.W.sun.shadow;
      if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); if (sh.map) { sh.map.dispose(); sh.map = null; } }
      this.W.fx.budget = settings.particles === 'low' ? Math.min(0.45, Q.particles) : Q.particles;
      this.W.setSun(settings.sun);
    }
    this.resScale = settings.renderScale / 100;
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const Q = QUALITY[settings.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(dpr, Q.pixelRatio) * this.resScale));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.hud.layout();
  }
  clearViews() { for (const v of this.views.values()) v.dispose(); this.views.clear(); this.hud.pruneTags(new Set()); }

  startMatch(room) {
    this.room = room; this.useMap(room.map); this.W.setNight(!!room.night); this.clearViews(); this.clearObjective();
    this.deadInfo = null; this.recent = []; this.myRockets = 0; this.xrayC = new Map(); this.W.shells.clear(); this.W.rockets.clear(); this.W.debris.clear(); this.W.resetDestruction(); this.hud.feed = []; this.hud.renderFeed(); this.hud.hideEnd();
    this.W.abfx.clear(); this.ride = null; this.cages = new Map();
    this.keysShownAt = performance.now();
    this.camT.set(0, 0, 0); if (this.net && this.net.meAlive) this.lastMe = { ...this.net.me };
  }

  playerInfo(id) { return this.room ? this.room.players.find(p => p.id === id) : null; }
  viewFor(id) {
    const info = this.playerInfo(id);
    const team = info ? info.team : 'ffa';
    const kind = info && info.tank && TANKS[info.tank] ? info.tank : 'zagros';
    const big = !!(info && info.jg);                     // Juggernaut / Survival boss: a giant tank
    const key = (team === 'ffa' ? 'ffa' + (id % 8) : team) + '|' + kind + (big ? '|G' : '');
    let v = this.views.get(id);
    if (v && v.key === key) return v;
    if (v) v.dispose();
    const col = key.startsWith('ffa') ? FFA_COLORS[id % 8] : TEAM_COLORS[team] || 0x777777;
    const acc = key.startsWith('ffa') ? 0xffffff : TEAM_ACCENT[team] || 0xffffff;
    v = new TankView(this.W.scene, col, acc, id === this.net.myId, kind); v.key = key; v.setNight(this.W.night);
    if (big) { v.body.scale.setScalar((TANKS[kind] || TANKS.zagros).size * 1.6); v.muzzle.position.z *= 1.6; v.muzzle.position.y *= 1.6; }
    this.views.set(id, v); return v;
  }
  groundY(x, z) {
    const M = this.W.map; const h = M.height(x, z);
    const b = M.bridge; if (b && x > b.x0 - 0.5 && x < b.x1 + 0.5 && Math.abs(z - b.zc) < b.halfW + 1) return Math.max(h, 0.45);
    return h;
  }
  isAlly(id) { const me = this.playerInfo(this.net.myId), p = this.playerInfo(id); return !!(me && p && p.team !== 'ffa' && p.team === me.team); }

  /* ---------------- events ---------------- */
  // Called immediately when the message arrives (own shots, things that hit US).
  onEvent(ev) {
    const me = this.net.myId, W = this.W; if (!W) return;
    if (ev.t === 'shot' && ev.own) {
      const s = W.shells.bySeq(ev.seq, ev.k || 0);
      if (s) s.id = ev.id;
      else { W.shells.spawn({ x: ev.x, z: ev.z, a: ev.a, y: this.groundY(ev.x, ev.z) + 1.5, id: ev.id, own: true, owner: me, big: !!ev.big, k: ev.k || 0, spd: ev.spd, max: ev.max }); }
    } else if (ev.t === 'hit' && ev.now) {
      if (ev.o === me) {
        const s = W.shells.byId(ev.s); if (s) W.shells.remove(s);
        this.impact(ev.x, ev.z, ev.v && ev.dmg === 0);
        if (ev.v && ev.dmg > 0) {
          this.hud.hitMarker(); this.audio.play('hitmark');
          const p = this.project(ev.x, this.groundY(ev.x, ev.z) + 2.5, ev.z); if (p) this.hud.damageNumber(p.x, p.y, ev.dmg);
        }
      }
      if (ev.v === me && ev.dmg > 0) { this.hud.flash(); this.addShake(0.5); this.audio.play('hurt'); }
    } else if (ev.t === 'kill' && ev.now && ev.v === me) {
      this.myRockets = 0;
      const v = this.views.get(me);
      const p = v ? v.root.position : _v.set(this.lastMe.x, this.groundY(this.lastMe.x, this.lastMe.z), this.lastMe.z);
      W.fx.explode(_v2.set(p.x, p.y + 1.2, p.z), true); this.audio.play('explosion', null, 1.1); this.addShake(1);
      if (v) v.setVisible(false);
      const k = this.playerInfo(ev.k);
      this.deadInfo = { killer: k ? (k.id === me ? t('yourself') : k.name) : '?', until: performance.now() + GAME.RESPAWN_S * 1000, at: performance.now(), out: !!(this.room && (this.room.mode === 'lts' || this.room.mode === 'potato')) };
      this.hud.kill(k, this.playerInfo(ev.v));
    } else if (ev.t === 'spawn' && ev.id === me) {
      this.deadInfo = null; this.audio.play('spawn');
      this.camT.set(ev.x, this.groundY(ev.x, ev.z), ev.z);
    } else if (ev.t === 'pu') {
      const pad = W.pads && W.pads[ev.i];
      if (pad) W.fx.ring(pad.g.position, 5, PU_COLORS[ev.type]);
      if (ev.id === me) { this.audio.play('pickup'); this.hud.powerToast(t(PU_NAMES[ev.type]), PU_COLORS[ev.type]); if (ev.type === 'rocket') this.myRockets = ev.n || 3; }
      else if (pad) this.audio.play('pickup', { x: pad.x, z: pad.z }, 0.6);
    } else if (ev.t === 'upgOffer') {
      this.hud.upgradePicker(ev, (v) => { this.net.sendJSON({ t: 'upg', v }); this.audio.play('pickup'); });
    } else if (ev.t === 'boom') {                             // Hot Potato: the bomb went off
      const y = this.groundY(ev.x, ev.z) + 1.2; W.fx.explode(_v.set(ev.x, y, ev.z), true); W.fx.explode(_v.set(ev.x + 1, y + 1, ev.z), true);
      this.audio.play('explosion', ev.id === me ? null : { x: ev.x, z: ev.z }, 1.2); this.addShake(ev.id === me ? 1.2 : 0.5); W.debris.kick(ev.x, ev.z, 8, 9);
    } else if (ev.t === 'brk' && ev.silent) {
      this.breakProp(ev, true);
    } else if (ev.t === 'rkl') {                            // a rocket was launched
      if (ev.o === me) this.myRockets = ev.n;
      else { W.fx.muzzle(_v.set(ev.x, this.groundY(ev.x, ev.z) + 1.5, ev.z), _v2.set(0, 0.3, 0)); this.audio.play('rocket', { x: ev.x, z: ev.z }, 0.9); }
    } else if (ev.t === 'ab') {                               // somebody used a special power
      this.onAbilityEvent(ev);
    } else if (ev.t === 'abReady') {
      this.hud.powerToast(t('abFull'), 0xc9a4ff); this.audio.play('levelup'); this.hud.abFlash();
    } else if (ev.t === 'abNo') {
      this.hud.objToast(ev.why === 'flag' ? t('abNoFlag') : t('abNotReady'), '#ff6250'); this.audio.play('deny');
    } else if (ev.t === 'fx') {
      W.abfx.setFx(ev);
    } else if (ev.t === 'left') {
      const v = this.views.get(ev.id); if (v) { v.dispose(); this.views.delete(ev.id); }
    }
  }
  // Called when the render timeline reaches the event's server time (matches what you see).
  onScheduled(ev) {
    const me = this.net.myId, W = this.W;
    if (ev.t === 'rk') { W.rockets.update(ev.r, (x, z) => this.groundY(x, z)); return; }
    if (ev.t === 'brk') { this.breakProp(ev, false); return; }
    if (ev.t === 'ms') { this.modeState(ev); return; }
    if (ev.t === 'ae') { W.abfx.setEntities(ev); return; }
    if (ev.t === 'heal') {                                     // a Repair Shot landed on a team-mate
      const y = this.groundY(ev.x, ev.z) + 1.4;
      W.fx.ring(_v.set(ev.x, y - 1.2, ev.z), 4, 0x49d16a);
      for (let i = 0; i < 8; i++) W.fx.spawn('f2', _v.set(ev.x + (Math.random() - 0.5) * 2.4, y, ev.z + (Math.random() - 0.5) * 2.4), _v2.set(0, 2.2, 0), 0.5, 0.5, 0.1, 0x49d16a, 0.7);
      const p = this.project(ev.x, y + 1.4, ev.z); if (p && ev.n > 0) this.hud.damageNumber(p.x, p.y, '+' + ev.n, '#7ef08a');
      this.audio.play(ev.v === me ? 'pickup' : 'click', ev.v === me ? null : { x: ev.x, z: ev.z }, 0.7);
      return;
    }
    if (ev.t === 'carBoom') {                                  // a suicide car reached its target
      const y = this.groundY(ev.x, ev.z) + 0.9;
      W.fx.explode(_v.set(ev.x, y, ev.z), true); W.debris.kick(ev.x, ev.z, 7, 8); this.crush(ev.x, ev.z, 3, false);
      this.audio.play('explosion', ev.v === me || ev.o === me ? null : { x: ev.x, z: ev.z }, 1.1);
      if (ev.v === me) this.addShake(1); else if (dist(ev.x, ev.z, this.lastMe.x, this.lastMe.z) < 25) this.addShake(0.4);
      return;
    }
    if (ev.t === 'shot') {
      const y = this.groundY(ev.x, ev.z) + 1.5;
      W.shells.spawn({ x: ev.x, z: ev.z, a: ev.a, y, id: ev.id, owner: ev.o, big: !!ev.big, spd: ev.spd, max: ev.max });
      if (!ev.k) {
        W.fx.muzzle(_v.set(ev.x, y, ev.z), _v2.set(Math.sin(ev.a), 0, Math.cos(ev.a)));
        const v = this.views.get(ev.o); if (v) v.recoil = 1;
        this.audio.play('cannon', { x: ev.x, z: ev.z }, 0.9);
      }
    } else if (ev.t === 'hit') {
      if (ev.rk) W.rockets.remove(-ev.s);
      // A guided rocket landing is its own event: the server marks it, so we never have to guess
      // whether a shell happened to be one. It gets the big blast and its own sound, and it is
      // shown for the owner too — unlike a normal shell, which was already drawn locally.
      if (ev.gm) { this.guidedBlast(ev.x, ev.z); return; }
      if (ev.o === me) return;                        // our own shells were handled instantly
      const s = W.shells.byId(ev.s); if (s) W.shells.remove(s);
      this.impact(ev.x, ev.z, ev.v && ev.dmg === 0);
    } else if (ev.t === 'kill') {
      if (ev.v === me) return;
      const v = this.views.get(ev.v);
      if (v) { const p = v.root.position; W.fx.explode(_v.set(p.x, p.y + 1.2, p.z), true); this.audio.play('explosion', { x: p.x, z: p.z }); if (dist(p.x, p.z, this.lastMe.x, this.lastMe.z) < 25) this.addShake(0.35); v.setVisible(false); }
      this.hud.kill(this.playerInfo(ev.k), this.playerInfo(ev.v));
    }
  }
  /* ---------------- special powers ---------------- */
  onAbilityEvent(ev) {
    const me = this.net.myId, W = this.W, mine = ev.id === me;
    const who = this.playerInfo(ev.id), at = () => { const v = this.views.get(ev.id); return v && v.root.visible ? v.root.position : null; };
    if (ev.k === 'caged') {
      const p = at(); if (p) { W.fx.ring(_v.set(p.x, p.y + 0.2, p.z), 4, 0x9fe4ff); }
      this.audio.play('freeze', mine ? null : p ? { x: p.x, z: p.z } : null, mine ? 1 : 0.7);
      if (mine) { this.hud.powerToast(t('abCaged'), 0x9fe4ff); this.addShake(0.4); }
      return;
    }
    if (ev.k === 'uncloak' || ev.k === 'wallGone') {
      if (ev.k === 'wallGone') this.audio.play('crumble', null, 0.7);
      return;
    }
    const A = ABILITIES[ev.k]; if (!A) return;
    const p = at();
    if (mine) { this.hud.powerToast(t('ab_' + ev.k), 0xffd23a); this.hud.abFlash(); }
    if (ev.k === 'homing' && mine) { this.ride = { since: performance.now() }; this.hud.objToast(t('abSteer'), '#c9a4ff'); }
    // Every power throws its own coloured burst from the tank that let it off, and a second,
    // smaller one where a placed power lands. The sound goes with it.
    const near = mine ? null : (p ? { x: p.x, z: p.z } : null);
    if (p) W.abfx.cast(ev.k, p.x, this.groundY(p.x, p.z), p.z);
    if (ev.x !== undefined && ev.z !== undefined) W.abfx.cast(ev.k, ev.x, this.groundY(ev.x, ev.z), ev.z, 0.7);
    this.audio.play(AB_SOUND[ev.k] || 'rocket', near, mine ? 1 : 0.8);
    if (mine) this.addShake(AB_SHAKE[ev.k] || 0.12);
    else if (AB_SHAKE[ev.k] > 0.25) this.addShake(AB_SHAKE[ev.k] * 0.45);
    if (ev.k === 'cloak' && p) { W.fx.ring(_v.set(p.x, p.y + 0.2, p.z), 3.4, 0x9fd8ff); return; }
    if (ev.k === 'homing' || ev.k === 'drone') { if (p) W.fx.muzzle(_v.set(p.x, p.y + 1.5, p.z), _v2.set(0, 0.4, 0)); return; }
    if (ev.k === 'dome' && p) { W.fx.ring(_v.set(p.x, p.y + 0.2, p.z), 6, 0x8fe8ff); return; }
  }
  // the blue cage around a frozen tank
  cageFor(id, on, view) {
    let c = this.cages.get(id);
    if (on && !c) { c = makeCage(); view.root.add(c); this.cages.set(id, c); }
    if (c) { c.visible = !!on; if (on) { c.rotation.y = -view.root.rotation.y; c.userData.m.opacity = 0.6 + 0.2 * Math.sin(this.t * 9); } }
    if (!on && c && !view.root.visible) { view.root.remove(c); this.cages.delete(id); }
  }
  // A prop (crate, barrel, sandbags, wall…) was destroyed on the server: hide it and throw its pieces around.
  breakProp(ev, silent) {
    const W = this.W, gy = (x, z) => this.groundY(x, z), tag = W.tags.get(ev.o);
    if (tag && TOPPLE[tag.k]) {                                  // trees, palms, poles: fall over and stay there
      const fx = ev.fx != null ? ev.fx : tag.x - 1, fz = ev.fz != null ? ev.fz : tag.z;
      const info = W.breakTag(ev.o, 'fall', gy, { x: tag.x - fx, z: tag.z - fz }, silent); if (!info || silent) return;
      W.fx.leaves(_v.set(info.x, gy(info.x, info.z) + 3, info.z), 6, 0x5c9d45);
      this.audio.play('rustle', { x: info.x, z: info.z }, 0.8);            // the crash comes when it hits the ground (see frame)
      return;
    }
    const info = W.breakTag(ev.o, 'hide', gy); if (!info) return;
    const list = [info];
    for (const [tag, o] of W.tags) if (o.top && !W.gone.has(tag) && Math.hypot(o.x - info.x, o.z - info.z) < 1.4) { W.breakTag(tag, 'hide', gy); list.push(o); }  // stacked crates fall too
    if (silent) return;
    for (const o of list) W.debris.burst(o.k, o.x, gy(o.x, o.z) + (o.top ? 1.4 : 0.5), o.z, this.lastImpact);
    W.fx.ring(_v.set(info.x, gy(info.x, info.z), info.z), 3, 0xd8c8a8);
    for (let i = 0; i < 6; i++) W.fx.dust(_v.set(info.x + (Math.random() - 0.5) * 2, gy(info.x, info.z) + 0.5, info.z + (Math.random() - 0.5) * 2));
    this.audio.play(info.k === 'swall' || info.k === 'bags' || info.k === 'nest' ? 'crumble' : 'crash', { x: info.x, z: info.z });
  }
  // Soft things (bushes, grass, fences, umbrellas) flattened by a tank or a blast.
  crush(x, z, r, fromTank) {
    const W = this.W, out = W.crushAt(x, z, r, (a, b) => this.groundY(a, b));
    for (const o of out) {
      const y = this.groundY(o.x, o.z);
      if (o.k === 'fence' || o.k === 'umbrella') { W.debris.burst(o.k, o.x, y + 0.6, o.z, fromTank ? null : { x, z }, fromTank ? 0.6 : 1); this.audio.play('crash', { x: o.x, z: o.z }, 0.5); }
      else if (TOPPLE[o.k]) { W.fx.dust(_v.set(o.x, y + 0.4, o.z)); if (o.k === 'lamp' || o.k === 'slamp') W.fx.ring(_v.set(o.x, y + 0.2, o.z), 1.5, 0xfff1c0); this.audio.play('crash', { x: o.x, z: o.z }, 0.45); }
      else { W.fx.leaves(_v.set(o.x, y + 0.4, o.z), o.k === 'fbush' || o.k === 'dbush' ? 8 : 3, o.k === 'dbush' || o.k === 'tuft' ? 0x9a9a55 : 0x5c9d45); if (o.k === 'fbush' || o.k === 'dbush') this.audio.play('rustle', { x: o.x, z: o.z }, 0.6); }
    }
  }
  impact(x, z, deflect) {
    const now = performance.now();
    this.recent = this.recent.filter(r => now - r.t < 900);
    if (this.recent.some(r => dist(r.x, r.z, x, z) < 3.5)) return;   // already exploded locally
    this.recent.push({ x, z, t: now });
    const y = this.groundY(x, z) + 1.2;
    this.lastImpact = { x, z }; this.crush(x, z, 2.4, false); this.W.debris.kick(x, z, 5, 6);
    if (deflect) { this.W.fx.deflect(_v.set(x, y, z)); this.audio.play('deflect', { x, z }); }
    else { this.W.fx.explode(_v.set(x, y, z), false); this.audio.play('impact', { x, z }, 0.8); }
  }
  /** Safeen's rocket hitting home: a big blast, its own sound, and a shove to the camera. */
  guidedBlast(x, z) {
    const y = this.groundY(x, z) + 1.2;
    this.lastImpact = { x, z };
    this.crush(x, z, 4.2, false); this.W.debris.kick(x, z, 9, 11);
    this.W.fx.guided(_v.set(x, y, z));
    this.audio.play('guidedImpact', { x, z }, 1);
    const d = dist(x, z, this.lastMe.x, this.lastMe.z);
    if (d < 40) this.addShake(Math.min(0.62, 0.62 * (1 - d / 40) + 0.08));
  }
  /* ---------------- objectives: flags, zone, rounds ---------------- */
  clearObjective() {
    if (this.objMeshes) for (const m of this.objMeshes) m.parent && m.parent.remove(m);
    this.objMeshes = []; this.flagMeshes = null; this.baseMeshes = null; this.zoneMesh = null; this.obj = null;
    this.mp = null; this.ms = null;                         // party-mode props (truck, ball, bomb, goals)
    this.hud.objective(null, this.room, this.net ? this.net.myId : 0); this.hud.guides([]); this.hud.spectate(null);
  }
  ensureObjMeshes(o) {
    const S = this.W.scene;
    if (o.flags && !this.flagMeshes) {
      this.flagMeshes = {}; this.baseMeshes = {};
      for (const tm of ['blue', 'red']) {
        const f = o.flags[tm]; const fl = buildCtfFlag(tm); S.add(fl); this.flagMeshes[tm] = fl; this.objMeshes.push(fl);
        const BR = GAME.CTF.BASE_R, base = new THREE.Mesh(new THREE.RingGeometry(BR - 0.7, BR, 48), new THREE.MeshBasicMaterial({ color: TEAM_HEX[tm], transparent: true, opacity: 0.6, depthWrite: false }));
        const fill = new THREE.Mesh(new THREE.CircleGeometry(BR - 0.7, 48), new THREE.MeshBasicMaterial({ color: TEAM_HEX[tm], transparent: true, opacity: 0.14, depthWrite: false })); base.add(fill); fill.position.z = -0.01;
        base.rotation.x = -Math.PI / 2; base.position.set(f.hx, this.groundY(f.hx, f.hz) + 0.1, f.hz); S.add(base); this.baseMeshes[tm] = base; this.objMeshes.push(base);
      }
    }
    if (o.goals && !(this.mp && this.mp.goals) && this.W.map.kind === 'stadium') { this.mp = this.mp || {}; this.mp.goals = { blue: { position: { x: o.goals.blue[0], z: o.goals.blue[1] } }, red: { position: { x: o.goals.red[0], z: o.goals.red[1] } } }; }
    if (o.goals && !(this.mp && this.mp.goals)) {
      this.mp = this.mp || {}; this.mp.goals = {};
      for (const tm of ['blue', 'red']) { const [gx, gz] = o.goals[tm], g = makeGoal(TEAM_HEX[tm]); g.position.set(gx, this.groundY(gx, gz), gz);
        const o2 = o.goals[tm === 'blue' ? 'red' : 'blue']; g.rotation.y = Math.atan2(o2[0] - gx, o2[1] - gz); S.add(g); this.objMeshes.push(g); this.mp.goals[tm] = g; }
    }
    if (o.zone && !this.zoneMesh) {
      const z = o.zone, g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.5, z.r, 56), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(z.r - 0.5, 56), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
      for (const m of [ring, fill]) { m.rotation.x = -Math.PI / 2; g.add(m); }
      ring.position.y = 0.16; fill.position.y = 0.14;
      g.position.set(z.x, this.groundY(z.x, z.z), z.z); g.userData = { ring, fill };
      S.add(g); this.zoneMesh = g; this.objMeshes.push(g);
    }
  }
  onObjective(ev) {
    const me = this.net.myId, info = this.playerInfo(me), team = info ? info.team : 'blue', foe = team === 'blue' ? 'red' : 'blue';
    if (ev.t === 'round') {
      if (ev.phase === 'fight') { this.hud.objToast(t('roundN', { n: ev.n })); this.audio.play('spawn'); }
      else { const w = ev.winner; this.hud.objToast(w == null ? t('roundDraw') : w === team ? t('roundWon') : t('roundLost'), w == null ? '#fff' : w === team ? '#8fd16a' : '#ff6250'); this.audio.play(w === team ? 'pickup' : 'hurt'); }
      return;
    }
    const prev = this.obj; this.obj = ev;
    if (this.W) this.ensureObjMeshes(ev);
    if (ev.ev === 'take') { if (ev.team === team) { this.hud.objToast(t('tFlagLost'), '#ff6250'); this.audio.play('hurt'); } else { this.hud.objToast(t('tFlagTaken'), '#8fd16a'); this.audio.play('pickup'); } }
    if (ev.ev === 'cap') { if (ev.team === foe) { this.hud.objToast(t('tCapUs'), '#8fd16a'); this.audio.play('pickup'); } else { this.hud.objToast(t('tCapThem'), '#ff6250'); this.audio.play('hurt'); } }
    if (ev.ev === 'return' && ev.team === team) this.hud.objToast(t('tFlagBack'), '#62a2ff');
    if (ev.ev === 'drop' && ev.team === foe) this.hud.objToast(t('tFlagDrop'), '#ffd23a');
    const nm = (id) => { const p = this.playerInfo(id); return p ? p.name : '?'; };
    const T = (key, col, snd, vars) => { this.hud.objToast(t(key, vars), col); if (snd) this.audio.play(snd); };
    if (ev.ev === 'half') T(ev.team === team ? 'tHalfAttack' : 'tHalfDefend', '#ffd23a', 'spawn');
    if (ev.ev === 'delivered') T(ev.team === team ? 'tDelivered' : 'tDeliveredThem', ev.team === team ? '#8fd16a' : '#ff6250', ev.team === team ? 'win' : 'hurt');
    if (ev.ev === 'jugg' && ev.by) T(ev.by === me ? 'tYouGiant' : 'tNewGiant', ev.by === me ? '#ffd23a' : '#fff', ev.by === me ? 'levelup' : 'pickup', { name: nm(ev.by) });
    if (ev.ev === 'goal') T(ev.team === team ? 'tGoalUs' : 'tGoalThem', ev.team === team ? '#8fd16a' : '#ff6250', ev.team === team ? 'win' : 'hurt', { name: nm(ev.by) });
    if (ev.ev === 'wave') T(ev.by % 5 === 0 ? 'tBossWave' : 'tWave', ev.by % 5 === 0 ? '#ff6250' : '#ffd23a', 'spawn', { n: ev.by });
    if (ev.ev === 'cleared') T('tWaveCleared', '#8fd16a', 'reward', { n: ev.by });
    if (ev.ev === 'lost') T('tSpotLost', '#ff6250', 'hurt');
    if (ev.ev === 'bomb' || ev.ev === 'pass') T(ev.by === me ? 'tYouBomb' : 'tBombTo', ev.by === me ? '#ff6250' : '#fff', ev.by === me ? 'hurt' : 'click', { name: nm(ev.by) });
    if (ev.ev === 'bounty' && ev.by === me) T('tBountyUp', '#ffd23a', 'pickup');
    if (ev.ev === 'zmove') T('tZoneMoved', '#ffd23a', 'spawn');
    if (ev.zone && prev && prev.zone && prev.zone.own !== ev.zone.own && this.room && this.room.mode === 'koh') {
      if (ev.zone.own === team) { this.hud.objToast(t('tZoneMine'), '#8fd16a'); this.audio.play('pickup'); }
      else if (ev.zone.own === foe && prev.zone.own === team) this.hud.objToast(t('tZoneLost'), '#ff6250');
    }
    this.hud.objective(ev, this.room, me);
  }
  // Fast party-mode state from the server (truck, ball, bomb), on the render timeline.
  modeState(ev) {
    const S = this.W.scene; this.mp = this.mp || {}; this.ms = ev;
    if (ev.truck && !this.mp.truck) { this.mp.truck = makeTruck(); S.add(this.mp.truck); this.objMeshes.push(this.mp.truck); this.mp.tp = { x: ev.truck[0], z: ev.truck[1], a: ev.truck[2] }; }
    if (ev.ball && !this.mp.ball) { this.mp.ball = makeBall(GAME.MODES.ball.ballR); S.add(this.mp.ball); this.objMeshes.push(this.mp.ball); this.mp.bp = { x: ev.ball[0], z: ev.ball[1] }; }
    if (ev.bomb && !this.mp.bomb) { this.mp.bomb = makeBomb(); S.add(this.mp.bomb); this.objMeshes.push(this.mp.bomb); }
    if (this.mp.bomb) this.mp.bomb.visible = !!ev.bomb;
  }
  updateModeProps(dt, marks) {
    const mp = this.mp, ms = this.ms; if (!mp || !ms) return;
    const f = 1 - Math.exp(-dt * 12);
    if (mp.truck && ms.truck) {
      const tp = mp.tp; tp.x = lerp(tp.x, ms.truck[0], f); tp.z = lerp(tp.z, ms.truck[1], f); tp.a = tp.a + ((((ms.truck[2] - tp.a) + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * f;
      mp.truck.position.set(tp.x, this.groundY(tp.x, tp.z), tp.z); mp.truck.rotation.y = tp.a;
      const o = this.obj && this.obj.cv, mine = o && this.playerInfo(this.net.myId), att = o && mine && mine.team === o.att;
      mp.truck.userData.ring.material.color.setHex(!o ? 0xffffff : att ? 0x8fd16a : 0xff6250);
      marks.pts.push({ x: tp.x, z: tp.z, col: '#ffd23a', r: 0.06 });
    }
    if (mp.ball && ms.ball) {
      const bp = mp.bp, ox = bp.x, oz = bp.z; bp.x = lerp(bp.x, ms.ball[0] + ms.ball[2] * 0.05, f); bp.z = lerp(bp.z, ms.ball[1] + ms.ball[3] * 0.05, f);
      mp.ball.position.set(bp.x, this.groundY(bp.x, bp.z), bp.z);
      const b = mp.ball.userData.ball, R = GAME.MODES.ball.ballR, dx = bp.x - ox, dz = bp.z - oz;   // roll
      b.rotation.x += dz / R; b.rotation.z -= dx / R;
      marks.pts.push({ x: bp.x, z: bp.z, col: '#ffffff', r: 0.055 });
    }
    if (mp.goals) for (const tm of ['blue', 'red']) { const g = mp.goals[tm].position; marks.pts.push({ x: g.x, z: g.z, col: tm === 'blue' ? '#62a2ff' : '#ff6250', r: 0.04, sq: true }); }
    if (mp.bomb && ms.bomb) {
      const [cid, left] = ms.bomb, v = this.views.get(cid);
      if (v && v.root.visible) {
        const p = v.root.position; mp.bomb.position.set(p.x, p.y + 4.2 + Math.sin(this.t * 6) * 0.15, p.z); mp.bomb.rotation.y += dt * 2;
        const u = mp.bomb.userData, blink = left < 4 ? 10 : left < 8 ? 5 : 2.5; u.light.visible = Math.sin(this.t * blink * Math.PI) > 0; u.spark.scale.setScalar(0.8 + Math.random() * 0.6);
        this.tickT = (this.tickT || 0) - dt; if (this.tickT <= 0) { this.tickT = 1 / blink * 2; this.audio.play('wheelTick', cid === this.net.myId ? null : { x: p.x, z: p.z }, cid === this.net.myId ? 1.2 : 0.8); }
        marks.pts.push({ x: p.x, z: p.z, col: '#ff3b2f', r: 0.07 });
      }
    }
  }
  updateObjective(dt, mePose) {
    const o = this.obj; if (!o || !this.W) return null;
    const marks = { flags: [], zone: null, pts: [] }, guides = [];
    this.updateModeProps(dt, marks);
    if (this.flagMeshes && o.flags) for (const tm of ['blue', 'red']) {
      const f = o.flags[tm], m = this.flagMeshes[tm];
      let x = f.x, z = f.z, y = this.groundY(x, z), carried = false;
      if (f.s === 'carried') {
        const v = f.c === this.net.myId ? (mePose ? this.views.get(f.c) : null) : this.views.get(f.c);
        if (v && v.root.visible) { x = v.root.position.x; z = v.root.position.z; y = v.root.position.y + 1.2; carried = true; }
      }
      m.position.set(x, y, z); m.scale.setScalar(carried ? 0.7 : 1); m.userData.ring.visible = !carried;
      m.userData.cloth.rotation.y = Math.sin(this.t * 2.2 + (tm === 'red' ? 1 : 0)) * 0.25;
      marks.flags.push({ x, z, col: tm === 'blue' ? '#62a2ff' : '#ff6250' });
      const mine = this.playerInfo(this.net.myId), myTeam = mine ? mine.team : 'blue';
      const show = tm !== myTeam ? !(f.s === 'carried' && f.c === this.net.myId) : f.s !== 'home';
      guides.push(show ? { key: tm, x, y: y + 5.6, z, col: tm === 'blue' ? '#62a2ff' : '#ff6250', label: tm !== myTeam ? t('gEnemyFlag') : f.s === 'carried' ? t('gOurFlagTaken') : t('gOurFlagDropped') } : null);
    }
    if (this.zoneMesh && o.zone) {
      const zm = this.zoneMesh.position; if (Math.abs(zm.x - o.zone.x) + Math.abs(zm.z - o.zone.z) > 0.01) zm.set(o.zone.x, this.groundY(o.zone.x, o.zone.z), o.zone.z);
      const col = ZONE_HEX[o.zone.own] ?? 0xffffff, u = this.zoneMesh.userData;
      u.ring.material.color.setHex(col); u.fill.material.color.setHex(col);
      u.fill.material.opacity = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(this.t * 3));
      marks.zone = { x: o.zone.x, z: o.zone.z, r: o.zone.r, col: '#' + col.toString(16).padStart(6, '0') };
    }
    this.hud.guides(guides.filter(Boolean).map(g => ({ ...g, p: this.project(g.x, g.y, g.z) })));
    return marks;
  }
  addShake(a) { if (settings.shake) this.shake = Math.max(this.shake, a); }
  isOut() { const p = this.playerInfo(this.net.myId); return !!((p && p.out) || (this.deadInfo && this.deadInfo.out)); }
  specCycle(d) { const L = this.specList || []; if (!L.length) return; const i = L.indexOf(this.specId); this.specId = L[((i < 0 ? 0 : i) + d + L.length) % L.length]; this.audio.play('click'); }
  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight, on: Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 };
  }

  /* ---------------- per-frame ---------------- */
  frame(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000), net = this.net, W = this.W;
    if (!W || !net) return;
    const me = net.myId;
    this.t = (this.t || 0) + dt;
    const playing = !!(this.room && this.room.state === 'playing');
    // Mouse → ground point for aiming (desktop)
    if (!this.hud.touch && this.input.mouse.in) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.ndc.set((this.input.mouse.x - r.left) / r.width * 2 - 1, -(this.input.mouse.y - r.top) / r.height * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.camera);
      this.plane.constant = -(this.groundY(this.lastMe.x, this.lastMe.z) + 1);
      if (this.ray.ray.intersectPlane(this.plane, _v)) this.input.aimWorld = { x: _v.x, z: _v.z };
    }
    const r = net.update(dtMs, (s) => this.input.get(s), playing);

    // predicted own shots → instant shell, flash, sound
    const myView = net.meAlive ? this.viewFor(me) : this.views.get(me);
    for (const f of r.fired) {
      const y = this.groundY(f.x, f.z) + 1.5;
      if (!f.k && this.myRockets > 0) {                 // this shot is a homing rocket (the server launches and steers it)
        this.myRockets--; this.rocketSeq = f.seq;
        W.fx.muzzle(_v.set(f.x, y, f.z), _v2.set(Math.sin(f.a), 0.2, Math.cos(f.a))); this.audio.play('rocket', null, 1); if (myView) myView.recoil = 0.6;
        const rl = net.me.rl || GAME.RELOAD_S; this.reloadSoundAt = rl > 1.2 ? performance.now() + rl * 1000 - 250 : 0; continue;
      }
      if (f.seq === this.rocketSeq) continue;           // extra barrels of the same rocket shot
      W.shells.spawn({ x: f.x, z: f.z, a: f.a, y, own: true, seq: f.seq, owner: me, big: f.big, k: f.k, spd: f.spd, max: f.max });
      if (f.k) continue;
      W.fx.muzzle(_v.set(f.x, y, f.z), _v2.set(Math.sin(f.a), 0, Math.cos(f.a)));
      if (myView) myView.recoil = 1;
      this.audio.play('cannon', null, 1); this.addShake(0.22);
      const rl = net.me.rl || GAME.RELOAD_S; this.reloadSoundAt = rl > 1.2 ? performance.now() + rl * 1000 - 250 : 0;
    }
    if (this.reloadSoundAt && performance.now() > this.reloadSoundAt) { this.reloadSoundAt = 0; if (net.meAlive) this.audio.play('reload', null, 0.8); }
    for (const ev of r.due) this.onScheduled(ev);

    // ---- local tank
    let mePose = null;
    if (net.meAlive && playing) {
      mePose = net.localPose(r.alpha);
      myView.setVisible(true);
      myView.setPose(mePose.x, mePose.z, mePose.yaw, mePose.t, (x, z) => this.groundY(x, z), dt, mePose.v);
      myView.setShield(mePose.shield > 0, this.t); myView.setPowers(mePose, this.t);
      myView.setXray(settings.xray !== false && this.hiddenAt(mePose.x, mePose.z, me), 0x5fb4ff);
      myView.setGhost(net.cloakUntil > performance.now());
      myView.setMedic(!!(net.ab && net.ab.id === 'heal' && net.abReady()), this.t);
      this.cageFor(me, net.isCaged(), myView);
      this.lastMe = mePose;
      this.dust(myView, mePose.v, dt);
      if (W.spot) {
        const sp = W.spot, p = myView.root.position, sy = Math.sin(mePose.yaw), cy = Math.cos(mePose.yaw);
        sp.intensity = W.night ? 2.2 : 0; sp.position.set(p.x + sy * 1.4, p.y + 2.4, p.z + cy * 1.4); sp.target.position.set(p.x + sy * 14, p.y, p.z + cy * 14);
      }
    } else if (myView) myView.setVisible(false);

    // ---- remote tanks (interpolated). These lists are reused every frame, not rebuilt.
    const S = this.scratch || (this.scratch = { live: new Set(), remotes: [], mm: [], mmPads: [], dtanks: [] });
    const live = S.live, remotes = S.remotes, mm = S.mm;
    live.clear(); remotes.length = 0; mm.length = 0; live.add(me);
    for (const id of net.remoteIds()) {
      live.add(id);
      const p = net.remotePose(id); const v = this.viewFor(id);
      const info = this.playerInfo(id);
      if (!p || !p.alive || !playing) { v.setVisible(false); this.hud.tag(id, '', false, 0, 0, 0, false); continue; }
      v.setVisible(true);
      v.setPose(p.x, p.z, p.yaw, p.t, (x, z) => this.groundY(x, z), dt, p.v);
      v.setShield(p.shield > 0, this.t); v.setPowers(p, this.t);
      this.dust(v, p.v, dt);
      remotes.push({ id, x: p.x, z: p.z, vx: Math.sin(p.yaw) * p.v, vz: Math.cos(p.yaw) * p.v });
      const ally = this.isAlly(id);
      v.setXray(ally && settings.xray !== false && this.hiddenAt(p.x, p.z, id), id === this.specId ? 0x5fb4ff : 0x3a78c9);   // teammates too (never enemies)
      // Bounty Hunt: far-away enemies only show on the minimap once their bounty is 3★ or more
      const hidden = this.room && this.room.mode === 'bounty' && !ally && !(info && info.bn >= 3) && dist(p.x, p.z, this.lastMe.x, this.lastMe.z) > 28;
      if (!hidden) mm.push({ x: p.x, z: p.z, ally, star: !ally && info && info.bn >= 3 });
      v.setGhost(!!p.cloak);
      v.setMedic(!!(info && info.medic), this.t);
      this.cageFor(id, !!p.froz, v);
      const sp = this.project(p.x, v.root.position.y + 3.4, p.z);
      this.hud.tag(id, (info ? info.name : '…') + (info && info.bn ? ' ' + '★'.repeat(info.bn) : '') + (info && info.jg ? ' 👑' : ''), ally, sp ? sp.x : 0, sp ? sp.y : 0, p.hp, !!(sp && sp.on), starsOf(info));
    }
    for (const [id, v] of this.views) if (!live.has(id)) { v.dispose(); this.views.delete(id); }
    this.hud.pruneTags(live);

    // ---- power-up pads
    const padState = (this.room && this.room.pads) || [];
    const PT = GAME.POWERUPS.TYPES; const mmPads = S.mmPads; mmPads.length = 0;
    for (let i = 0; i < (W.pads || []).length; i++) {
      const pad = W.pads[i], ti = padState[i], type = ti >= 0 ? PT[ti] : null;
      if (pad.type !== type) { for (const k in pad.icons) pad.icons[k].visible = k === type; pad.type = type; if (type) pad.ring.material.color.setHex(PU_COLORS[type]); }
      pad.ring.visible = !!type; pad.holder.visible = !!type;
      if (type) { pad.holder.rotation.y = this.t * 1.6; pad.holder.position.y = 1.7 + Math.sin(this.t * 2.2 + i) * 0.22; mmPads.push({ x: pad.x, z: pad.z, c: PU_COLORS[type] }); }
    }
    // ---- shells + particles
    W.shells.update(dt, W.map, remotes, (s, x, z, hit) => { if (s.own || hit) this.impact(x, z, false); });
    W.abfx.frame(dt, this.t);
    // holding a power: show where it would land
    this.input.abRange = net.abReach ? net.abReach() : 20;
    if (mePose && net.ab && net.ab.armed && net.ab.id) {
      const ab = net.ab.id, kind = abAim(ab), L = net.ab.l || 0;
      const far = Math.max(0.12, Math.min(1, this.input.abDist ? this.input.abDist(net.me) : 0.6)) * abRange(ab);
      // the power has its own aim, so the preview follows the power control and not the turret
      const pa = typeof this.input.lastAbAim === 'number' ? this.input.lastAbAim : mePose.t;
      const gx = mePose.x + Math.sin(pa) * far, gz = mePose.z + Math.cos(pa) * far;
      W.abfx.showGhost({ kind: kind === 'ground' ? 'ground' : 'dir', ab, a: pa, fromX: mePose.x, fromZ: mePose.z,
        x: kind === 'ground' ? gx : mePose.x + Math.sin(pa) * Math.min(far, 6), z: kind === 'ground' ? gz : mePose.z + Math.cos(pa) * Math.min(far, 6),
        r: ab === 'wall' ? 1.2 : abNum(ab, 'r', L) || 2.5, len: ab === 'wall' ? abNum(ab, 'len', L) : 0 });
    } else W.abfx.showGhost(null);
    W.fx.update(dt); W.rockets.frame(dt, this.t);
    // tanks flatten bushes/fences they drive over and shove debris out of the way
    const dtanks = S.dtanks; dtanks.length = 0;
    if (mePose) { dtanks.push({ x: mePose.x, z: mePose.z, vx: Math.sin(mePose.yaw) * mePose.v, vz: Math.cos(mePose.yaw) * mePose.v }); }
    for (const q of remotes) dtanks.push(q);
    for (const q of dtanks) if (Math.abs(q.vx) + Math.abs(q.vz) > 0.5) this.crush(q.x, q.z, 1.4, true);
    W.debris.update(dt, (x, z) => this.groundY(x, z), dtanks);
    // falling trees / lamps: animate, and a thud + dust where they land
    for (const o of W.updateFalls(dt)) {
      const hx = o.hx, hz = o.hz, gy = this.groundY(hx, hz);
      for (let i = 0; i < 5; i++) W.fx.dust(_v.set(hx + (Math.random() - 0.5) * 2.5, gy + 0.3, hz + (Math.random() - 0.5) * 2.5));
      if (o.k !== 'bench' && o.k !== 'sign' && o.k !== 'lamp' && o.k !== 'slamp' && o.k !== 'sflag') W.fx.leaves(_v.set(hx, gy + 0.8, hz), 8, o.k === 'dryTree' ? 0x9a9a55 : 0x5c9d45);
      this.audio.play('crash', { x: o.x, z: o.z }, o.k === 'lamp' || o.k === 'slamp' || o.k === 'sflag' ? 0.45 : 0.7);
    }

    // ---- aim line (where the turret actually points)
    const showAim = !!mePose;
    this.aimLine.visible = this.aimDot.visible = showAim;
    if (showAim) {
      myView.muzzleWorld(_v);
      const range = (TANKS[net.me.cls] || TANKS.zagros).range;
      let d = range * 0.6;
      if (!this.hud.touch && this.input.aimWorld) d = Math.min(range, Math.max(4, dist(this.input.aimWorld.x, this.input.aimWorld.z, mePose.x, mePose.z) - 3.4));
      const tc = this.hud.touch && this.input.touch;
      if (tc) { tc.setReloading(mePose.reload > 0); if (tc.aimMag > 0.25) d = range * (0.35 + 0.65 * Math.min(1, tc.aimMag)); }
      const armed = !!(tc && tc.armed);
      const holdShot = !!(net.ab && net.ab.armed && net.ab.id && abAim(net.ab.id) === 'shot');
      const col = holdShot ? (net.ab.id === 'heal' ? 0x7ef08a : 0x9fe4ff) : armed ? 0xffd27a : 0xffffff;
      this.aimLine.material.color.setHex(col); this.aimLine.material.opacity = holdShot || armed ? 0.95 : 0.55; this.aimDot.material.color.setHex(col);
      const ex = _v.x + Math.sin(mePose.t) * d, ez = _v.z + Math.cos(mePose.t) * d, gy = this.groundY(ex, ez) + 0.15;
      const a = this.aimLine.geometry.attributes.position; a.setXYZ(0, _v.x, _v.y, _v.z); a.setXYZ(1, ex, gy, ez); a.needsUpdate = true;
      this.aimLine.computeLineDistances(); this.aimDot.position.set(ex, gy - 0.03, ez);
    }

    // ---- camera: smooth follow with a little look-ahead toward the aim
    let focus = mePose || this.lastMe;
    // Guided Shell: the camera leaves the tank and rides the shell until it hits something.
    const shell = W.abfx.myMissile(me);
    net.flying = !!shell;                       // the movement stick is steering the shell, not the tank
    if (shell && this.ride) { focus = { x: shell.x, z: shell.z, t: shell.a, yaw: shell.a }; this.riding = true; }
    else if (this.riding) { this.riding = false; this.ride = null; }        // let the camera glide back, do not snap it
    else if (this.ride && performance.now() - this.ride.since > 2500) this.ride = null;
    // how much we are "in the shell" — eased, so going in and coming back are both smooth
    this.rideK = lerp(this.rideK || 0, this.riding ? 1 : 0, 1 - Math.exp(-6 * dt));
    if (this.rideK < 0.002) this.rideK = 0;
    const spec = !mePose && playing && this.isOut();
    if (spec) {                                                       // out of the match: watch a player (teammates first), switch with ◀ ▶
      const mine = this.playerInfo(me), team = mine && mine.team !== 'ffa' ? mine.team : null;
      let cand = remotes.filter(q => { const p = this.playerInfo(q.id); return p && (!team || p.team === team); });
      if (!cand.length) cand = remotes;
      this.specList = cand.map(q => q.id);
      if (!cand.some(q => q.id === this.specId)) this.specId = cand.length ? cand[0].id : 0;
      const tgt = cand.find(q => q.id === this.specId);
      if (tgt) { const v = this.views.get(tgt.id); focus = { x: tgt.x, z: tgt.z, t: v ? v.root.rotation.y : 0, yaw: 0 }; }
      const who = this.playerInfo(this.specId);
      this.hud.spectate(tgt && who ? who.name : null, cand.length > 1, (d) => this.specCycle(d));
    } else if (this.hud.specOn) this.hud.spectate(null);
    let lx = 0, lz = 0;
    if (mePose) {
      if (!this.hud.touch && this.input.aimWorld) { lx = (this.input.aimWorld.x - focus.x) * CAMERA.LOOK_AHEAD; lz = (this.input.aimWorld.z - focus.z) * CAMERA.LOOK_AHEAD; }
      else { lx = Math.sin(focus.t) * 3; lz = Math.cos(focus.t) * 3; }
      const L = Math.hypot(lx, lz); if (L > CAMERA.LOOK_AHEAD_MAX) { lx *= CAMERA.LOOK_AHEAD_MAX / L; lz *= CAMERA.LOOK_AHEAD_MAX / L; }
    }
    const fy = this.groundY(focus.x, focus.z);
    if (this.camT.lengthSq() === 0) this.camT.set(focus.x, fy, focus.z);
    this.camT.lerp(_v.set(focus.x + lx, fy, focus.z + lz), 1 - Math.exp(-(CAMERA.FOLLOW + (this.rideK || 0) * 3.5) * dt));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.5; const pr = CAMERA.PITCH_DEG * Math.PI / 180;
    const camDist = CAMERA.DIST * (1 - (this.rideK || 0) * 0.14);        // a little closer while flying a shell, never jarring
    this.camera.position.set(this.camT.x + (Math.random() - 0.5) * sh, this.camT.y + Math.sin(pr) * camDist + (Math.random() - 0.5) * sh, this.camT.z + Math.cos(pr) * camDist);
    this.camera.lookAt(this.camT);
    W.follow(this.camT);
    this.renderer.render(W.scene, this.camera);

    // ---- audio
    this.audio.listener = { x: focus.x, z: focus.z };
    this.audio.engine(mePose ? Math.abs(mePose.v) / GAME.MAX_SPEED : 0, !!mePose);

    // ---- HUD
    this.perfTick(dtMs);
    if (this.deadInfo) this.deadInfo.left = (this.deadInfo.until - performance.now()) / 1000;
    if (this.keysShownAt && performance.now() - this.keysShownAt > 20000) { document.getElementById('keys').style.opacity = 0; this.keysShownAt = 0; }
    const st = mePose || net.me;
    this.hud.frame({
      dt, alive: !!mePose, hp: net.meHp, maxHp: net.meMaxHp || 100, rl: net.me.rl || GAME.RELOAD_S, reload: st.reload || 0, playing, deadInfo: this.deadInfo,
      powers: mePose ? { armor: mePose.armor || 0, boost: mePose.boost || 0, oneShot: !!mePose.oneShot, rockets: this.myRockets || 0 } : null,
      ab: net.ab && net.ab.id ? { id: net.ab.id, l: net.ab.l, chg: net.ab.chg, need: net.ab.need || 1, armed: !!net.ab.armed, ready: net.abReady(), caged: net.isCaged() } : null,
      crosshair: this.input.mouse.in ? { x: this.input.mouse.x, y: this.input.mouse.y } : null,
      net, fps: this.perf.fps, frameMs: this.perf.ms, quality: settings.quality,
      res: this.renderer.domElement.width + '×' + this.renderer.domElement.height,
    });
    this.mmT = (this.mmT || 0) - dt;
    const marks = this.updateObjective(dt, mePose);
    if (this.mmT <= 0) { this.mmT = 0.1; if (marks) W.abfx.marks(marks.pts); this.hud.minimap(W.minimap, focus, mm, mmPads, marks); }
  }
  dust(v, speed, dt) {
    v.dustT -= dt;
    if (Math.abs(speed) > 1.2 && v.dustT <= 0) {
      v.dustT = v.boosting ? 0.035 : 0.07; const yaw = v.root.rotation.y, s = Math.random() < 0.5 ? -1 : 1, p = v.root.position;
      if (v.boosting) this.W.fx.spawn('f2', _v2.set(p.x - Math.sin(yaw) * 2.1 * Math.sign(speed), p.y + 0.9, p.z - Math.cos(yaw) * 2.1 * Math.sign(speed)), _v.set(0, 0.5, 0), 0.25, 0.3, 0.05, 0, 0.1);
      this.W.fx.dust(_v.set(p.x - Math.sin(yaw) * 1.9 * Math.sign(speed) + Math.cos(yaw) * s * 1.05, p.y + 0.25, p.z - Math.cos(yaw) * 1.9 * Math.sign(speed) - Math.sin(yaw) * s * 1.05));
    }
  }
  // FPS meter + automatic resolution scaling to hold frame rate on phones.
  perfTick(dtMs) {
    const P = this.perf; P.frames++; P.acc += dtMs;
    if (P.acc < 500) return;
    P.fps = P.frames / (P.acc / 1000); P.ms = P.acc / P.frames; P.frames = 0; P.acc = 0;
    if (!settings.autoRes || document.hidden) return;
    if (P.fps < 48) { P.low++; P.high = 0; } else if (P.fps > 58) { P.high++; P.low = 0; } else { P.low = 0; P.high = 0; }
    const max = settings.renderScale / 100;
    if (P.low >= 4 && this.resScale > 0.55) { this.resScale = Math.max(0.55, this.resScale - 0.1); P.low = 0; this.resize(); }
    else if (P.high >= 10 && this.resScale < max) { this.resScale = Math.min(max, this.resScale + 0.05); P.high = 0; this.resize(); }
  }
}
