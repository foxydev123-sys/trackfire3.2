/* =====================================================================
   KURDISH TANK — trailer engine.
   A fixed 54-second timeline rendered with the real game's 3D code, with
   the menus / HUD drawn on top in Kurdish or Arabic. Randomness is seeded,
   the clock is the audio clock, so every run is the same video.
   ===================================================================== */
import * as THREE from './three.js';
import { buildWorld } from './game/world.js';
import { TankView, TEAM_COLORS, TEAM_ACCENT } from './game/tank.js';
import { FX } from './game/fx.js';
import { Shells } from './game/shells.js';
import { buildPads, PU_COLORS } from './game/game.js';
import { getMap } from '../shared/maps.js';
import { tl } from './i18n.js';
import { clamp, lerp, lerpAngle, stepAngle, wrapAngle } from '../shared/math.js';
import { TrailerAudio } from './trailer-audio.js';

export const LEN = 54;
const ease = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const eout = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NAMES = { A: 'Solomon', B: 'Lina', C: 'Yousef', R1: 'Kaz', R2: 'Rashid', R3: 'Mo_7' };

let renderer, camera, glc, out, octx, W3 = {}, icon;
let S = null;               // live run state

/* ---------------- setup ---------------- */
export async function init(canvas, status) {
  out = canvas; octx = out.getContext('2d');
  status('Building the 3D maps…');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setPixelRatio(1);
  glc = renderer.domElement;
  camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 700);
  for (const id of ['hawler', 'desert', 'forest']) { world(id); await new Promise(r => setTimeout(r, 10)); }
  icon = new Image(); icon.src = 'icons/icon-512.png';
  status('Loading fonts…');
  try { await Promise.all(['800 60px "Noto Kufi Arabic"', '700 60px "Noto Kufi Arabic"', '400 60px Bungee', '700 40px "Chakra Petch"'].map(f => document.fonts.load(f))); } catch (e) {}
}
function world(id) {
  if (!W3[id]) {
    const W = buildWorld(getMap(id), { sun: 'midday' });
    W.fx = new FX(W.scene, W.map.env.dust, 360); W.shells = new Shells(W.scene);
    const B = W.map.bridge;
    W.H = (x, z) => { const h = W.map.height(x, z); return B && x > B.x0 - 0.5 && x < B.x1 + 0.5 && Math.abs(z - B.zc) < B.halfW + 1 ? Math.max(h, 0.45) : h; };
    W.pads = buildPads(W, W.H); W.actors = [];
    W3[id] = W;
  }
  return W3[id];
}
function resetWorld(W) {
  for (const a of W.actors) a.v.dispose(); W.actors = [];
  W.shells.clear();
  for (const a of W.fx.act) { a.m.visible = false; W.fx.pool.push(a.m); } W.fx.act = [];
  for (const r of W.fx.rings) r.m.visible = false;
  showPads(W, []);
}
function showPads(W, list) {
  W.pads.forEach((p, i) => {
    const want = list.find(q => q.i === i);
    for (const k in p.icons) p.icons[k].visible = !!want && k === want.type;
    p.ring.visible = p.holder.visible = !!want;
    if (want) p.ring.material.color.setHex(PU_COLORS[want.type]);
  });
}

/* ---------------- actors & paths ---------------- */
const P = {
  line: (ax, az, bx, bz, sp, delay = 0) => { const L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
    return (t) => { const d = clamp((t - delay) * sp, 0, L); return { x: ax + (bx - ax) * d / L, z: az + (bz - az) * d / L, yaw, v: d > 0 && d < L ? sp : 0 }; }; },
  arc: (cx, cz, r, a0, w) => (t) => { const a = a0 + w * t; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, yaw: Math.atan2(-Math.sin(a) * w, Math.cos(a) * w), v: Math.abs(r * w) }; },
  still: (x, z, yaw) => () => ({ x, z, yaw, v: 0 }),
};
function tank(W, id, team, path, opt = {}) {
  const a = { id, name: NAMES[id] || id, team, path, W, alive: true, v: new TankView(W.scene, TEAM_COLORS[team], TEAM_ACCENT[team], !!opt.me),
    t: opt.turret ?? null, aim: opt.aim || null, powers: { armor: opt.armor ? 5 : 0, boost: opt.boost ? 5 : 0, oneShot: !!opt.oneShot }, x: 0, z: 0, yaw: 0, sp: 0, dustT: 0 };
  W.actors.push(a); poseActor(a, 0, 0.001); return a;
}
function aimPoint(a) { const g = a.aim; if (!g) return null; return g.id ? [g.x, g.z] : g; }
function poseActor(a, lt, dt) {
  const p = a.path(lt); a.x = p.x; a.z = p.z; a.yaw = p.yaw; a.sp = p.v;
  const ap = aimPoint(a); const want = ap ? Math.atan2(ap[0] - a.x, ap[1] - a.z) : a.yaw;
  a.t = a.t == null ? want : stepAngle(a.t, want, 4 * Math.max(dt, 0.001));
  a.v.setPose(a.x, a.z, a.yaw, a.t, a.W.H, Math.max(dt, 0.001), a.sp);
  a.v.setPowers(a.powers, S ? S.t : 0);
  if (a.sp > 1 && dt > 0) { a.dustT -= dt; if (a.dustT <= 0) { a.dustT = a.powers.boost ? 0.03 : 0.07;
    const s = Math.random() < 0.5 ? -1 : 1, y = a.W.H(a.x, a.z);
    a.W.fx.dust(V(a.x - Math.sin(a.yaw) * 1.9 + Math.cos(a.yaw) * s, y + 0.25, a.z - Math.cos(a.yaw) * 1.9 - Math.sin(a.yaw) * s));
    if (a.powers.boost) a.W.fx.spawn('f2', V(a.x - Math.sin(a.yaw) * 2.2, y + 0.9, a.z - Math.cos(a.yaw) * 2.2), V(0, 0.6, 0), 0.25, 0.4, 0.05, 0, 0.1); } }
}

/* ---------------- combat choreography ---------------- */
function fire(a, target, opt = {}) {
  if (!a.alive) return;
  const W = a.W, m = a.v.muzzleWorld(V(0, 0, 0));
  const tp = target.id ? [target.x, target.z] : [target[0], target[1]];
  const ang = Math.atan2(tp[0] - m.x, tp[1] - m.z); a.t = ang;
  const dist = Math.hypot(tp[0] - m.x, tp[1] - m.z) - (target.id ? 1.4 : 0);
  const s = W.shells.spawn({ x: m.x, z: m.z, a: ang, y: m.y, big: !!opt.big });
  if (!s) return;
  S.flights.push({ s, W, dx: Math.sin(ang), dz: Math.cos(ang), left: dist, target, opt, by: a });
  W.fx.muzzle(m, V(Math.sin(ang), 0, Math.cos(ang))); a.v.recoil = 1;
  S.au.cannon(S.au.ctx.currentTime, opt.big ? 1.2 : 0.9); S.shake = Math.max(S.shake, opt.big ? 0.5 : 0.18);
  if (opt.big) a.powers.oneShot = false;
}
function stepFlights(dt) {
  for (let i = S.flights.length - 1; i >= 0; i--) {
    const f = S.flights[i], st = 48 * dt; f.left -= st;
    f.s.x += f.dx * st; f.s.z += f.dz * st; f.s.g.position.set(f.s.x, f.s.y, f.s.z);
    if (f.left > 0) continue;
    f.W.shells.remove(f.s); S.flights.splice(i, 1);
    const tgt = f.target, x = tgt.id ? tgt.x : tgt[0], z = tgt.id ? tgt.z : tgt[1], y = f.W.H(x, z) + 1.2;
    if (f.opt.deflect) { f.W.fx.deflect(V(x, y, z)); S.au.deflect(S.au.ctx.currentTime); continue; }
    f.W.fx.explode(V(f.s.x, y, f.s.z), !!f.opt.big); S.au.boom(S.au.ctx.currentTime, !!f.opt.big);
    if (tgt.id && f.opt.dmg) tgt.hp = Math.max(0, (tgt.hp ?? 100) - f.opt.dmg);
    if (tgt.id && f.opt.kill) kill(tgt, f.by);
  }
}
function kill(v, k) {
  if (!v.alive) return; v.alive = false;
  v.W.fx.explode(V(v.x, v.W.H(v.x, v.z) + 1.2, v.z), true); v.v.setVisible(false);
  S.au.boom(S.au.ctx.currentTime + 0.02, true); S.shake = Math.max(S.shake, 0.7);
  S.feed.unshift({ k: k.name, kt: k.team, v: v.name, vt: v.team, t: S.t }); if (S.feed.length > 4) S.feed.pop();
  if (k.team === 'blue') S.score.blue++; else S.score.red++;
}

/* ---------------- 2D drawing kit ---------------- */
const C = { acc: '#f5a53c', ink: '#f4efe6', mute: '#b7bec3', blue: '#62a2ff', red: '#ff6250', ok: '#8fd16a', panel: 'rgba(10,14,18,.72)', line: 'rgba(255,255,255,.14)' };
function font(kind, px) {
  const rtl = S.rtl;
  if (kind === 'display') return rtl ? `800 ${px}px "Noto Kufi Arabic", sans-serif` : `400 ${px}px Bungee, Impact, sans-serif`;
  if (kind === 'bold') return rtl ? `800 ${px}px "Noto Kufi Arabic", sans-serif` : `700 ${px}px "Chakra Petch", sans-serif`;
  if (kind === 'latin') return `400 ${px}px Bungee, Impact, sans-serif`;
  if (kind === 'mono') return `700 ${px}px "Chakra Petch", monospace`;
  return rtl ? `700 ${px}px "Noto Kufi Arabic", sans-serif` : `600 ${px}px "Chakra Petch", sans-serif`;
}
function txt(s, x, y, o = {}) {
  const c = octx; c.save();
  c.font = font(o.kind || 'ui', o.size || 28); c.fillStyle = o.color || C.ink;
  c.direction = o.ltr ? 'ltr' : (S.rtl ? 'rtl' : 'ltr');
  const al0 = o.align || 'start'; c.textAlign = al0 === 'start' ? 'left' : al0 === 'end' ? 'right' : al0; c.textBaseline = o.base || 'middle'; c.globalAlpha = o.alpha ?? 1;
  if (o.shadow) { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowOffsetY = o.shadow; }
  if (o.max) { let px = o.size || 28; while (c.measureText(s).width > o.max && px > 10) { px -= 2; c.font = font(o.kind || 'ui', px); } }
  c.fillText(s, x, y); const w = c.measureText(s).width; c.restore(); return w;
}
function rr(x, y, w, h, r, fill, stroke, alpha = 1) {
  const c = octx; c.save(); c.globalAlpha = alpha; c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); } c.restore();
}
function flag(x, y, w, h, alpha = 1) {
  const c = octx; c.save(); c.globalAlpha = alpha;
  c.fillStyle = '#ed2024'; c.fillRect(x, y, w, h / 3); c.fillStyle = '#f7f7f2'; c.fillRect(x, y + h / 3, w, h / 3); c.fillStyle = '#278e43'; c.fillRect(x, y + 2 * h / 3, w, h / 3);
  const r = h * 0.2, cx = x + w / 2, cy = y + h / 2; c.fillStyle = '#febd11'; c.beginPath();
  for (let i = 0; i < 42; i++) { const a = i / 42 * Math.PI * 2, q = i % 2 ? r * 0.7 : r * 1.12; c.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } c.closePath(); c.fill(); c.restore();
}
// Mirror an x position for right-to-left layouts.
const MX = (x, w = 0) => S.rtl ? S.W - x - w : x;
const T = (k, v) => tl(S.lang, k, v);

function button(x, y, w, h, label, sub, primary, pressed, alpha = 1) {
  const u = S.u; const sc = pressed ? 0.94 : 1; const cx = x + w / 2, cy = y + h / 2; const ww = w * sc, hh = h * sc;
  rr(cx - ww / 2, cy - hh / 2, ww, hh, 8 * u, primary ? C.acc : 'rgba(20,24,28,.86)', primary ? null : 'rgba(255,255,255,.22)', alpha);
  const ink = primary ? '#1b1206' : '#fff';
  const sx = S.rtl ? cx + ww / 2 - 22 * u : cx - ww / 2 + 22 * u;
  txt(label, sx, cy, { kind: 'bold', size: (primary ? 34 : 28) * u, color: ink, alpha, align: S.rtl ? 'end' : 'start' });
  if (sub) txt(sub, S.rtl ? cx - ww / 2 + 22 * u : cx + ww / 2 - 22 * u, cy, { size: 18 * u, color: ink, align: S.rtl ? 'start' : 'end', alpha: alpha * 0.8 });
}
function caption(big, small, t, col = C.acc, y = null) {
  const u = S.u, a = clamp(t * 4, 0, 1); const cy = y ?? S.H * 0.18; const sc = 1 + (1 - eout(t * 3)) * 0.35;
  octx.save(); octx.translate(S.W / 2, cy); octx.scale(sc, sc); octx.translate(-S.W / 2, -cy);
  const w = txt(big, S.W / 2, cy, { kind: 'display', size: 92 * u, color: '#fff', align: 'center', alpha: a, shadow: 6 * u, max: S.W - 120 * u });
  octx.fillStyle = col; octx.globalAlpha = a; octx.fillRect(S.W / 2 - Math.min(w, S.W - 160 * u) / 2, cy + 58 * u, Math.min(w, S.W - 160 * u), 8 * u); octx.globalAlpha = 1;
  if (small) txt(small, S.W / 2, cy + 110 * u, { kind: 'bold', size: 40 * u, color: col, align: 'center', alpha: a, shadow: 4 * u, max: S.W - 120 * u });
  octx.restore();
}
function title(t, y) {
  const u = S.u, a = clamp(t * 5, 0, 1), sc = 1 + (1 - eout(t * 4)) * 0.6;
  octx.save(); octx.translate(S.W / 2, y); octx.scale(sc, sc); octx.translate(-S.W / 2, -y);
  if (S.rtl) {
    txt(T('logo'), S.W / 2, y, { kind: 'display', size: 170 * u, color: C.acc, align: 'center', alpha: a, shadow: 10 * u, max: S.W - 100 * u });
    txt('KURDISH TANK', S.W / 2, y + 120 * u, { kind: 'latin', size: 48 * u, color: '#fff4e2', align: 'center', alpha: a, ltr: true, shadow: 4 * u });
    flag(S.W / 2 - 120 * u, y + 165 * u, 240 * u, 72 * u, a);
  } else {
    txt('KURDISH TANK', S.W / 2, y, { kind: 'latin', size: 140 * u, color: C.acc, align: 'center', alpha: a, ltr: true, shadow: 10 * u, max: S.W - 100 * u });
    flag(S.W / 2 - 120 * u, y + 90 * u, 240 * u, 72 * u, a);
  }
  octx.restore();
}

/* ---------------- HUD (like the real game) ---------------- */
function hud(o) {
  const u = S.u, W = S.W, H = S.H;
  // score + clock
  const sw = 460 * u, sx = W / 2 - sw / 2, sy = 24 * u;
  rr(sx, sy, sw, 76 * u, 8 * u, C.panel, C.line);
  octx.fillStyle = 'rgba(60,120,220,.55)'; octx.fillRect(sx, sy, 150 * u, 76 * u); octx.fillStyle = 'rgba(220,70,55,.55)'; octx.fillRect(sx + sw - 150 * u, sy, 150 * u, 76 * u);
  const L = S.rtl ? ['red', 'blue'] : ['blue', 'red'];
  txt(String(S.score[L[0]]), sx + 45 * u, sy + 38 * u, { kind: 'mono', size: 44 * u, align: 'center', ltr: true });
  txt(T(L[0]), sx + 105 * u, sy + 40 * u, { kind: 'bold', size: 20 * u, align: 'center' });
  txt(String(S.score[L[1]]), sx + sw - 45 * u, sy + 38 * u, { kind: 'mono', size: 44 * u, align: 'center', ltr: true });
  txt(T(L[1]), sx + sw - 105 * u, sy + 40 * u, { kind: 'bold', size: 20 * u, align: 'center' });
  const left = Math.max(0, 452 - Math.floor(S.t)); txt(`0${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, W / 2, sy + 30 * u, { kind: 'mono', size: 32 * u, align: 'center', ltr: true });
  txt(T('tdm'), W / 2, sy + 60 * u, { size: 15 * u, align: 'center', color: C.mute });
  // kill feed
  S.feed.forEach((f, i) => {
    const a = clamp((S.t - f.t) * 5, 0, 1) * clamp((f.t + 6 - S.t) * 2, 0, 1); if (a <= 0) return;
    const y = 140 * u + i * 50 * u, w = 330 * u, x = MX(24 * u, w);
    rr(x, y, w, 42 * u, 6 * u, C.panel, C.line, a);
    const k = f.k, v = f.v, s0 = S.rtl ? x + w - 16 * u : x + 16 * u;
    txt(k, s0, y + 21 * u, { kind: 'bold', size: 22 * u, color: f.kt === 'blue' ? C.blue : C.red, alpha: a, ltr: true, align: S.rtl ? 'end' : 'start' });
    octx.save(); octx.globalAlpha = a; octx.fillStyle = '#f1c56a'; octx.fillRect(x + w / 2 - 14 * u, y + 18 * u, 28 * u, 6 * u); octx.restore();
    txt(v, S.rtl ? x + 16 * u : x + w - 16 * u, y + 21 * u, { kind: 'bold', size: 22 * u, color: f.vt === 'blue' ? C.blue : C.red, alpha: a, ltr: true, align: S.rtl ? 'start' : 'end' });
  });
  // health
  const hp = clamp(o.hp ?? 100, 0, 100), hw = 400 * u, hx = MX(28 * u, hw), hy = H - (S.vert ? 230 : 140) * u;
  rr(hx, hy, hw, 112 * u, 8 * u, C.panel, C.line);
  txt(NAMES.A, S.rtl ? hx + hw - 18 * u : hx + 18 * u, hy + 30 * u, { kind: 'bold', size: 26 * u, ltr: true, align: S.rtl ? 'end' : 'start' });
  txt(`${Math.round(hp)} / 100`, S.rtl ? hx + 18 * u : hx + hw - 18 * u, hy + 30 * u, { kind: 'mono', size: 30 * u, ltr: true, align: S.rtl ? 'start' : 'end' });
  rr(hx + 18 * u, hy + 56 * u, hw - 36 * u, 20 * u, 4 * u, 'rgba(0,0,0,.5)');
  const bw = (hw - 36 * u) * hp / 100; octx.fillStyle = hp > 60 ? C.ok : hp > 30 ? '#f2c14e' : '#ef5a4a';
  octx.fillRect(S.rtl ? hx + hw - 18 * u - bw : hx + 18 * u, hy + 56 * u, bw, 20 * u);
  txt(T('teamLbl', { team: T('blue') }), S.rtl ? hx + hw - 18 * u : hx + 18 * u, hy + 94 * u, { size: 17 * u, color: C.mute, align: S.rtl ? 'end' : 'start' });
  // reload
  const rw = 380 * u, rx = W / 2 - rw / 2, ry = H - 92 * u, k = clamp(o.reload ?? 1, 0, 1);
  rr(rx, ry, rw, 64 * u, 8 * u, C.panel, C.line);
  txt(k >= 1 ? T('reloadReady') : T('reloading'), S.rtl ? rx + rw - 18 * u : rx + 18 * u, ry + 22 * u, { kind: 'bold', size: 20 * u, color: k >= 1 ? C.ok : C.acc, align: S.rtl ? 'end' : 'start' });
  rr(rx + 18 * u, ry + 40 * u, rw - 36 * u, 12 * u, 3 * u, 'rgba(0,0,0,.5)'); octx.fillStyle = k >= 1 ? C.ok : C.acc;
  octx.fillRect(S.rtl ? rx + rw - 18 * u - (rw - 36 * u) * k : rx + 18 * u, ry + 40 * u, (rw - 36 * u) * k, 12 * u);
  // power-up chips
  let cy = hy - 56 * u;
  for (const [key, col, val] of o.chips || []) {
    const w = 260 * u, x = MX(28 * u, w);
    rr(x, cy, w, 44 * u, 6 * u, C.panel, col);
    txt(T(key), S.rtl ? x + w - 16 * u : x + 16 * u, cy + 22 * u, { kind: 'bold', size: 20 * u, align: S.rtl ? 'end' : 'start' });
    if (val) txt(val, S.rtl ? x + 16 * u : x + w - 16 * u, cy + 22 * u, { size: 20 * u, color: C.mute, align: S.rtl ? 'start' : 'end' });
    cy -= 52 * u;
  }
}

/* ---------------- the timeline ---------------- */
function orbitCam(c, r, h, a, fov = 45) { return { pos: [c[0] + Math.sin(a) * r, h, c[2] + Math.cos(a) * r], look: c, fov }; }
function followCam(a, dist, pitch = 58, look = [0, 0], fov = 40) {
  const pr = pitch * Math.PI / 180, y = a.W.H(a.x, a.z);
  return { pos: [a.x + look[0], y + Math.sin(pr) * dist, a.z + look[1] + Math.cos(pr) * dist], look: [a.x + look[0], y, a.z + look[1]], fov };
}
function lerpCam(A, B, k) { return { pos: A.pos.map((v, i) => lerp(v, B.pos[i], k)), look: A.look.map((v, i) => lerp(v, B.look[i], k)), fov: lerp(A.fov, B.fov, k) }; }

const SEGS = [
  { t0: 0, t1: 3.2, map: 'hawler', sun: 'golden', setup(W) {
      const A = tank(W, 'A', 'blue', P.arc(0, -30, 24, 1.45, 0.16), { me: true });
      const R1 = tank(W, 'R1', 'red', P.arc(0, -30, 24, 0.75, 0.13)); const R2 = tank(W, 'R2', 'red', P.arc(0, -30, 24, 2.3, -0.1));
      A.aim = R1; R1.aim = A; R2.aim = A;
      return [[0.45, () => fire(A, R1, { dmg: 35 })], [1.1, () => fire(R2, A, { dmg: 20 })], [1.5, () => fire(A, R1, { kill: true })]]; },
    cam: (t) => lerpCam({ pos: [70, 80, 70], look: [0, 6, -28], fov: 42 }, { pos: [30, 22, 16], look: [0, 4, -20], fov: 44 }, ease(t / 3.2)),
    draw(t) { if (t > 1.6) title(t - 1.6, S.H * (S.vert ? 0.32 : 0.36)); if (t > 2.8) fadeRect('#000', 0); } },
  { t0: 3.2, t1: 8.0, map: 'hawler', sun: 'golden', setup(W) {
      tank(W, 'B', 'blue', P.arc(0, -30, 24, 1.2, 0.12)); tank(W, 'R3', 'red', P.arc(0, -30, 24, 3.4, 0.12)); return [
        ...'Solomon'.split('').map((ch, i) => [0.35 + i * 0.12, () => S.au.key(S.au.ctx.currentTime)]),
        [3.4, () => S.au.click(S.au.ctx.currentTime)], [4.3, () => S.au.whoosh(S.au.ctx.currentTime)]]; },
    cam: (t) => orbitCam([0, 2, -18], 72, 44, 0.5 + t * 0.07),
    draw(t) { menuScreen(t); } },
  { t0: 8.0, t1: 14.5, map: (t) => t < 3.6 ? 'hawler' : t < 4.2 ? 'desert' : t < 4.8 ? 'forest' : 'hawler', sun: 'golden', setup() {
      const ev = [[0.2, () => {}]];
      for (let i = 0; i < 5; i++) ev.push([0.2 + i * 0.12, () => S.au.key(S.au.ctx.currentTime)]);
      for (let i = 0; i < 6; i++) ev.push([0.9 + i * 0.55, () => S.au.pop(S.au.ctx.currentTime)]);
      for (const x of [3.6, 4.2, 4.8, 5.0, 5.6]) ev.push([x, () => S.au.click(S.au.ctx.currentTime)]);
      ev.push([6.1, () => { S.au.click(S.au.ctx.currentTime); S.au.whoosh(S.au.ctx.currentTime + 0.05); }]);
      return ev; },
    cam: (t) => orbitCam(t < 3.6 ? [0, 2, -18] : t < 4.2 ? [0, 0, 0] : t < 4.8 ? [14, 0, -4] : [0, 2, -18], 70, 42, 0.8 + t * 0.07),
    draw(t) { lobbyScreen(t); } },
  { t0: 14.5, t1: 21.0, map: 'hawler', sun: 'midday', setup(W) {
      const A = tank(W, 'A', 'blue', P.line(-24, 40, -24, -2, 7), { me: true }); A.hp = 100; S.me = A;
      const B = tank(W, 'B', 'blue', P.line(-19.5, 52, -19.5, 14, 6));
      const R1 = tank(W, 'R1', 'red', P.line(-11, -2, -11, 22, 2.6)); const R2 = tank(W, 'R2', 'red', P.still(-30, -14, 2.4));
      A.aim = R1; B.aim = R2; R1.aim = A; R2.aim = B; S.reloadAt = -9;
      const f = (t, a, b, o) => [t, () => { fire(a, b, o); if (a === A) S.reloadAt = S.t; }];
      return [f(0.7, A, R1, { dmg: 34 }), f(1.4, R1, [-22.5, 27], {}), f(1.9, R1, A, { dmg: 32 }), f(2.3, B, R2, { dmg: 30 }), f(3.1, A, R1, { kill: true }),
        [3.2, () => { A.aim = R2; }], f(4.2, R2, B, { dmg: 36 }), f(5.1, A, R2, { kill: true })]; },
    cam: (t) => { const c = followCam(S.me, S.vert ? 52 : 40, 58, [-3, -6], 40); return c; },
    draw(t) { hud({ hp: S.me.hp, reload: clamp((S.t - S.reloadAt) / 2.2, 0, 1) }); if (t > 0.3 && t < 3.2) caption(T('mapHawler'), T('subHawler'), t - 0.3, C.acc, S.H * (S.vert ? 0.26 : 0.3)); if (t > 6.2) wipe(t - 6.2); } },
  { t0: 21.0, t1: 25.5, map: 'desert', sun: 'golden', setup(W) {
      const A = tank(W, 'A', 'blue', P.line(-20, 10, 12, 3.5, 7.5), { me: true }); S.me = A;
      const R1 = tank(W, 'R1', 'red', P.line(22, -12, 8, -6, 3)); const R2 = tank(W, 'R2', 'red', P.still(-3, -8.5, 0.6));
      A.aim = R1; R1.aim = A; R2.aim = A;
      return [[0.5, () => fire(A, R1, { dmg: 35 })], [1.2, () => fire(R2, [A.x + 3, A.z + 2], {})], [2.2, () => fire(A, R1, { kill: true })], [2.4, () => { A.aim = R2; }], [3.5, () => fire(A, R2, { dmg: 40 })]]; },
    cam: (t) => { const a = S.me, y = a.W.H(a.x, a.z); return { pos: [a.x + 4, y + (S.vert ? 12 : 8), a.z + (S.vert ? 22 : 15)], look: [a.x + 7, y + 1, a.z - 3], fov: 48 }; },
    draw(t) { if (t < 0.35) wipe(t + 0.35); if (t > 0.3 && t < 3.6) caption(T('mapDesert'), T('subDesert'), t - 0.3, '#e8b978', S.H * (S.vert ? 0.26 : 0.22)); if (t > 4.1) wipe(t - 4.1); } },
  { t0: 25.5, t1: 30.0, map: 'forest', sun: 'midday', setup(W) {
      const R1 = tank(W, 'R1', 'red', P.line(36, -5.6, 19, -5.6, 4.2)); const A = tank(W, 'A', 'blue', P.line(4, 2, 10, -1.5, 2), { me: true });
      const B = tank(W, 'B', 'blue', P.line(8, 14, 12, 5, 3)); A.aim = R1; B.aim = R1; R1.aim = A; S.me = A;
      return [[0.6, () => fire(A, R1, { dmg: 35 })], [1.3, () => fire(R1, [A.x + 2.5, A.z - 2], {})], [2.3, () => fire(B, R1, { kill: true, big: true })]]; },
    cam: (t) => lerpCam({ pos: [44, 24, 18], look: [24, 0, -5], fov: 44 }, { pos: [34, 16, 16], look: [22, 0, -4], fov: 46 }, ease(t / 4.5)),
    draw(t) { if (t < 0.35) wipe(t + 0.35); if (t > 0.3 && t < 3.6) caption(T('mapForest'), T('subForest'), t - 0.3, '#7fb255', S.H * (S.vert ? 0.26 : 0.2)); if (t > 4.1) wipe(t - 4.1); } },
  { t0: 30.0, t1: 40.0, map: 'hawler', sun: 'golden', setup(W) { S.sub = -1; return []; },
    cam: (t) => powerCam(t),
    draw(t) { powerScene(t); } },
  { t0: 40.0, t1: 45.5, map: 'hawler', sun: 'midday', setup(W) {
      const ids = [['A', 'blue', 1.0], ['B', 'blue', 2.1], ['C', 'blue', 3.2], ['R1', 'red', 4.3], ['R2', 'red', 5.4], ['R3', 'red', 0.1]];
      const ts = ids.map(([id, tm, a0]) => tank(W, id, tm, P.arc(0, -30, 24, a0, 0.14), { me: id === 'A' }));
      ts.forEach((a, i) => { a.aim = ts[(i + 3) % 6]; });
      const ev = []; for (let i = 0; i < 9; i++) { const a = ts[i % 6], b = ts[(i + 3) % 6]; ev.push([0.3 + i * 0.55, () => fire(a, b, { dmg: 20 })]); }
      S.score = { blue: 21, red: 19 }; return ev; },
    cam: (t) => orbitCam([0, 4, -26], 64, 46, 2.4 + t * 0.09, 44),
    draw(t) { modesScreen(t); } },
  { t0: 45.5, t1: LEN, map: 'hawler', sun: 'golden', setup(W) {
      tank(W, 'A', 'blue', P.arc(0, -30, 24, 1.3, 0.12), { me: true }); tank(W, 'B', 'blue', P.arc(0, -30, 24, 1.62, 0.12)); tank(W, 'R1', 'red', P.arc(0, -30, 24, 0.9, 0.12));
      return []; },
    cam: (t) => lerpCam({ pos: [7, 21, -13], look: [0, 18, -30], fov: 42 }, { pos: [44, 40, 42], look: [0, 6, -24], fov: 44 }, ease(t / 4.8)),
    draw(t) { finale(t); } },
];

/* ---- power-ups: four quick scenes ---- */
const PSUB = [
  { key: 'shield', desc: 'trShieldD', col: '#46a8ff', setup(W) {
      const A = tank(W, 'A', 'blue', P.still(-24, 16, Math.PI), { me: true, armor: true }); const R = tank(W, 'R1', 'red', P.still(-24, -8, 0)); A.aim = R; R.aim = A; S.me = A;
      return [[0.45, () => fire(R, A, { deflect: true })], [1.15, () => fire(R, A, { deflect: true })], [1.8, () => fire(R, A, { deflect: true })]]; },
    cam: () => ({ pos: [-12, 9, 25], look: [-24, 1.5, 12], fov: 44 }) },
  { key: 'speedBoost', desc: 'trSpeedD', col: '#ffd23a', setup(W) {
      showPads(W, [{ i: 5, type: 'speed' }]);
      const A = tank(W, 'A', 'blue', P.line(-10, 30, 40, 30, 14), { me: true }); S.me = A; A.aim = [60, 30];
      return [[0.7, () => { A.powers.boost = 6; showPads(W, []); S.au.pickup(S.au.ctx.currentTime); W.fx.ring(V(0, 0.5, 30), 5, PU_COLORS.speed); }]]; },
    cam: () => { const a = S.me; return { pos: [a.x - 4, 9, a.z + 15], look: [a.x + 5, 1, a.z - 1], fov: 52 }; } },
  { key: 'fullHealth', desc: 'trHealthD', col: '#49d16a', setup(W) {
      showPads(W, [{ i: 1, type: 'health' }]);
      const A = tank(W, 'A', 'blue', P.line(24, 2, 24, 12, 6), { me: true }); A.hp = 18; S.me = A; A.aim = [24, 40];
      return [[1.65, () => { S.healAt = S.t; showPads(W, []); S.au.pickup(S.au.ctx.currentTime); W.fx.ring(V(24, 0.5, 12), 5, PU_COLORS.health); }]]; },
    cam: () => ({ pos: [33, 11, 20], look: [24, 1, 9], fov: 46 }) },
  { key: 'oneShotRound', desc: 'trOneShotD', col: '#ff3b2f', setup(W) {
      const A = tank(W, 'A', 'blue', P.still(-12, -54, Math.PI / 2), { me: true, oneShot: true }); const R = tank(W, 'R1', 'red', P.still(14, -53, -Math.PI / 2));
      A.aim = R; R.aim = A; S.me = A;
      return [[0.8, () => fire(A, R, { big: true, kill: true })]]; },
    cam: () => ({ pos: [1, 11, -74], look: [1, 1.5, -52], fov: 46 }) },
];
function powerCam(t) { const i = Math.min(3, Math.floor(t / 2.5)); return PSUB[i].cam(); }
function powerScene(t) {
  const i = Math.min(3, Math.floor(t / 2.5)), lt = t - i * 2.5, p = PSUB[i];
  if (i !== S.sub) { S.sub = i; const W = world('hawler'); resetWorld(W); S.events = p.setup(W).map(([x, fn]) => [S.segT0 + i * 2.5 + x, fn]); S.au.whoosh(S.au.ctx.currentTime); S.healAt = null; }
  const me = S.me; let hp = me.hp ?? 100;
  if (i === 2) hp = S.healAt != null ? lerp(18, 100, eout((S.t - S.healAt) * 2)) : 18;
  const chips = [];
  if (me.powers.armor) chips.push(['shield', '#46a8ff', (me.powers.armor - lt * 0.8).toFixed(1) + ' ' + T('sec')]);
  if (me.powers.boost) chips.push(['speed', '#ffd23a', (6 - Math.max(0, lt - 0.7)).toFixed(1) + ' ' + T('sec')]);
  if (me.powers.oneShot) chips.push(['oneShot', '#ff3b2f', T('nextShell')]);
  hud({ hp, reload: 1, chips });
  if (t < 1.1) caption(T('trPowerups'), null, t, C.acc, S.H * 0.13);
  caption(T(p.key), T(p.desc), lt, p.col, S.H * (S.vert ? 0.3 : 0.34));
  if (lt < 0.18) fadeRect('#fff', 0.35 * (1 - lt / 0.18));
}
function fadeRect(col, a) { if (a <= 0) return; octx.save(); octx.globalAlpha = a; octx.fillStyle = col; octx.fillRect(0, 0, S.W, S.H); octx.restore(); }
function wipe(k) { // Kurdish-flag stripe wipe, k 0→0.7
  const x = (k / 0.7) * (S.W * 1.6) - S.W * 0.3, u = S.u;
  const cols = ['#ed2024', '#f7f7f2', '#278e43'];
  for (let i = 0; i < 3; i++) { octx.fillStyle = cols[i]; octx.beginPath(); const o = i * 140 * u; octx.moveTo(x - o - 900 * u, 0); octx.lineTo(x - o, 0); octx.lineTo(x - o - 400 * u, S.H); octx.lineTo(x - o - 1300 * u, S.H); octx.closePath(); octx.fill(); }
}

/* ---- menu + lobby screens ---- */
function menuScreen(t) {
  const u = S.u, W = S.W, H = S.H, slide = eout((t - 0.05) * 3) * (1 - ease((t - 4.3) * 2.5));
  const g = octx.createLinearGradient(S.rtl ? W : 0, 0, S.rtl ? 0 : W, 0); g.addColorStop(0, 'rgba(12,10,8,.86)'); g.addColorStop(S.vert ? 1 : 0.55, 'rgba(12,10,8,.25)'); g.addColorStop(1, 'rgba(12,10,8,.05)');
  octx.fillStyle = g; octx.fillRect(0, 0, W, H);
  const cw = 620 * u, x0 = S.vert ? (W - cw) / 2 : MX(110 * u, cw) - (1 - slide) * 700 * u * (S.rtl ? -1 : 1);
  let y = S.vert ? 300 * u : 120 * u; const a = slide;
  const edge = S.rtl ? x0 + cw : x0, al = S.rtl ? 'end' : 'start';
  if (S.rtl) { txt(T('logo'), edge, y + 50 * u, { kind: 'display', size: 96 * u, color: C.acc, align: al, alpha: a, shadow: 6 * u }); txt('KURDISH TANK', edge, y + 125 * u, { kind: 'latin', size: 26 * u, color: '#fff4e2', align: al, alpha: a, ltr: true }); }
  else { txt('KURDISH', edge, y + 40 * u, { kind: 'latin', size: 88 * u, color: C.acc, alpha: a, ltr: true }); txt('TANK', edge, y + 120 * u, { kind: 'latin', size: 88 * u, color: '#fff4e2', alpha: a, ltr: true }); }
  y += 160 * u; flag(S.rtl ? edge - 170 * u : edge, y, 170 * u, 50 * u, a); y += 80 * u;
  txt(T('tagline'), edge, y, { size: 22 * u, color: '#e9dfcf', align: al, alpha: a, max: cw }); y += 50 * u;
  txt(T('callsign'), edge, y, { kind: 'bold', size: 18 * u, color: '#c8bfb0', align: al, alpha: a }); y += 22 * u;
  rr(x0, y, cw, 60 * u, 6 * u, 'rgba(8,10,12,.75)', 'rgba(255,255,255,.22)', a);
  const typed = 'Solomon'.slice(0, clamp(Math.floor((t - 0.3) / 0.12) + 1, 0, 7));
  txt(typed + (Math.floor(t * 3) % 2 && t < 2 ? '|' : ''), S.rtl ? x0 + cw - 18 * u : x0 + 18 * u, y + 31 * u, { kind: 'mono', size: 28 * u, align: al, alpha: a, ltr: true });
  y += 80 * u;
  button(x0, y, cw, 70 * u, T('play'), T('newRoom'), true, false, a); y += 84 * u;
  const pressed = t > 3.3 && t < 3.55;
  button(x0, y, cw, 62 * u, T('create'), T('getCode'), false, pressed, a);
  if (t > 2.3 && t < 4.2) { // cursor/tap ring moving to CREATE ROOM
    const k = ease((t - 2.3) / 1.0), tx = S.rtl ? x0 + cw * 0.3 : x0 + cw * 0.7, ty = y + 31 * u;
    const cx = lerp(W / 2, tx, k), cy = lerp(H * 0.85, ty, k), r = (pressed ? 18 : 26) * u;
    octx.save(); octx.globalAlpha = 0.9; octx.strokeStyle = '#fff'; octx.lineWidth = 4 * u; octx.beginPath(); octx.arc(cx, cy, r, 0, 7); octx.stroke(); octx.fillStyle = 'rgba(255,255,255,.35)'; octx.fill(); octx.restore();
  }
  y += 76 * u;
  rr(S.rtl ? x0 + 170 * u : x0, y, cw - 170 * u, 62 * u, 6 * u, 'rgba(8,10,12,.75)', 'rgba(255,255,255,.22)', a);
  txt(T('codePh'), S.rtl ? x0 + cw - 18 * u : x0 + 18 * u, y + 31 * u, { size: 24 * u, color: '#7d858a', align: al, alpha: a });
  button(S.rtl ? x0 : x0 + cw - 156 * u, y, 156 * u, 62 * u, T('join'), null, false, false, a); y += 76 * u;
  button(x0, y, cw, 62 * u, T('practice'), T('vsBots'), false, false, a); y += 76 * u;
  button(x0, y, cw, 62 * u, T('settings'), null, false, false, a);
}
function lobbyScreen(t) {
  const u = S.u, W = S.W, H = S.H, a = eout(t * 3) * (1 - ease((t - 6.1) * 4));
  fadeRect('#0b0c0e', 0.35 * a);
  const cw = Math.min(1100 * u, W - 60 * u), x0 = (W - cw) / 2, ch = S.vert ? 1000 * u : 900 * u, y0 = (H - ch) / 2 + (1 - a) * 60 * u + (S.vert ? 80 * u : 40 * u);
  if (!S.vert) { txt(T('trOnline'), W / 2, 44 * u, { kind: 'display', size: 44 * u, color: '#fff', align: 'center', alpha: a, shadow: 4 * u }); }
  else { txt(T('trOnline'), W / 2, 160 * u, { kind: 'display', size: 56 * u, color: '#fff', align: 'center', alpha: a, shadow: 4 * u, max: W - 80 * u }); txt(T('trRooms'), W / 2, 240 * u, { kind: 'bold', size: 32 * u, color: C.acc, align: 'center', alpha: a, max: W - 80 * u }); }
  rr(x0, y0, cw, ch, 10 * u, 'rgba(14,17,20,.9)', 'rgba(255,255,255,.14)', a);
  const al = S.rtl ? 'end' : 'start', edge = S.rtl ? x0 + cw - 28 * u : x0 + 28 * u, far = S.rtl ? x0 + 28 * u : x0 + cw - 28 * u;
  let y = y0 + 40 * u;
  txt(T('roomCodeLbl'), edge, y, { kind: 'bold', size: 18 * u, color: C.mute, align: al, alpha: a }); y += 50 * u;
  const code = 'F7K2Q'.slice(0, clamp(Math.floor((t - 0.2) / 0.12) + 1, 0, 5));
  octx.save(); octx.font = `700 ${66 * u}px "Chakra Petch", monospace`; octx.fillStyle = '#fff'; octx.globalAlpha = a; octx.textBaseline = 'middle'; octx.textAlign = 'left';
  let cx = S.rtl ? edge - 5 * 60 * u + 20 * u : edge; for (const ch2 of code) { octx.fillText(ch2, cx, y); cx += 60 * u; } octx.restore();
  if (!S.vert) txt(T('trRooms'), far, y, { kind: 'bold', size: 24 * u, color: C.acc, align: S.rtl ? 'start' : 'end', alpha: a });
  y += 56 * u;
  // maps
  const sel = t < 3.6 ? 0 : t < 4.2 ? 1 : t < 4.8 ? 2 : 0; const mw = (cw - 56 * u - 20 * u) / 3;
  const maps = [['mapHawler', 'subHawler', '#c9b894'], ['mapDesert', 'subDesert', '#e0b77c'], ['mapForest', 'subForest', '#6aa84a']];
  maps.forEach(([n, sb, col], i) => {
    const mx = S.rtl ? x0 + cw - 28 * u - mw - i * (mw + 10 * u) : x0 + 28 * u + i * (mw + 10 * u);
    rr(mx, y, mw, 128 * u, 8 * u, 'rgba(12,14,16,.95)', i === sel ? C.acc : 'rgba(255,255,255,.14)', a);
    rr(mx + 6 * u, y + 6 * u, mw - 12 * u, 56 * u, 5 * u, col, null, a * 0.85);
    const me2 = S.rtl ? mx + mw - 12 * u : mx + 12 * u;
    txt(T(n), me2, y + 84 * u, { kind: 'bold', size: 22 * u, align: al, alpha: a, max: mw - 20 * u });
    txt(T(sb), me2, y + 110 * u, { size: 15 * u, color: C.mute, align: al, alpha: a, max: mw - 20 * u });
  });
  y += 150 * u;
  // mode toggle
  const ffa = t > 5.0 && t < 5.6; const sw = 520 * u, sx = S.rtl ? x0 + cw - 28 * u - sw : x0 + 28 * u;
  rr(sx, y, sw, 48 * u, 6 * u, null, 'rgba(255,255,255,.25)', a);
  const half = sw / 2; const tdmX = S.rtl ? sx + half : sx, ffaX = S.rtl ? sx : sx + half;
  rr(ffa ? ffaX : tdmX, y, half, 48 * u, 6 * u, C.acc, null, a);
  txt(T('tdm'), tdmX + half / 2, y + 24 * u, { kind: 'bold', size: 18 * u, color: ffa ? '#ddd' : '#1b1206', align: 'center', alpha: a, max: half - 16 * u });
  txt(T('ffa'), ffaX + half / 2, y + 24 * u, { kind: 'bold', size: 18 * u, color: ffa ? '#1b1206' : '#ddd', align: 'center', alpha: a, max: half - 16 * u });
  const np = clamp(Math.floor((t - 0.9) / 0.55) + 1, 1, 6);
  txt(T('players', { n: np, max: 8 }), far, y + 24 * u, { kind: 'bold', size: 22 * u, align: S.rtl ? 'start' : 'end', alpha: a });
  y += 70 * u;
  // players
  const ps = [['Solomon', 'blue', 1], ['Rashid', 'red', 0], ['Lina', 'blue', 0], ['Kaz', 'red', 0], ['Mo_7', 'red', 0], ['Yousef', 'blue', 0]];
  ps.forEach(([n, tm, host], i) => {
    const ta = 0.9 + i * 0.55; if (t < ta) return;
    const k = eout((t - ta) * 4), ry = y + i * 52 * u, al2 = a * k;
    rr(x0 + 20 * u, ry, cw - 40 * u, 46 * u, 5 * u, i === 0 ? 'rgba(245,165,60,.12)' : 'rgba(255,255,255,.03)', null, al2);
    txt(n + (host ? '  ♛' : ''), edge, ry + 23 * u, { kind: 'bold', size: 24 * u, align: al, alpha: al2, ltr: true });
    const chx = S.rtl ? x0 + 330 * u : x0 + cw - 330 * u;
    rr(chx - 60 * u, ry + 9 * u, 120 * u, 28 * u, 4 * u, tm === 'blue' ? 'rgba(98,162,255,.25)' : 'rgba(255,98,80,.25)', null, al2);
    txt(T(tm), chx, ry + 23 * u, { kind: 'bold', size: 16 * u, color: tm === 'blue' ? '#bcd6ff' : '#ffc2b8', align: 'center', alpha: al2 });
    const rdy = t > ta + 0.9 || i === 0;
    txt(rdy ? T('ready') : T('waiting'), far, ry + 23 * u, { kind: 'bold', size: 18 * u, color: rdy ? C.ok : '#8d959a', align: S.rtl ? 'start' : 'end', alpha: al2 });
  });
  y += 6 * 52 * u + 20 * u;
  const pressed = t > 6.05 && t < 6.3;
  button(x0 + 28 * u, y, cw - 56 * u, 74 * u, T('start'), null, true, pressed, a);
}
function modesScreen(t) {
  const u = S.u, W = S.W, H = S.H;
  fadeRect('#000', 0.28);
  txt(T('trModes'), W / 2, (S.vert ? 170 : 70) * u, { kind: 'display', size: 54 * u, color: '#fff', align: 'center', shadow: 5 * u, max: W - 80 * u });
  const first = t < 2.8, lt = first ? t : t - 2.8, a = eout(lt * 3) * (first ? 1 - ease((t - 2.55) * 5) : 1);
  const cw = Math.min(900 * u, W - 80 * u), x0 = (W - cw) / 2, y0 = H * (S.vert ? 0.3 : 0.24);
  rr(x0, y0, cw, 520 * u, 12 * u, 'rgba(12,15,18,.88)', 'rgba(255,255,255,.14)', a);
  if (first) {
    txt(T('tdm'), W / 2, y0 + 60 * u, { kind: 'display', size: 50 * u, color: C.acc, align: 'center', alpha: a, max: cw - 60 * u });
    const b = 21 + Math.min(3, Math.floor(lt * 1.3)), r = 19 + Math.min(3, Math.floor(lt * 1.1));
    const L = S.rtl ? [['red', r, '#ff6250'], ['blue', b, '#62a2ff']] : [['blue', b, '#62a2ff'], ['red', r, '#ff6250']];
    L.forEach(([tm, n, col], i) => {
      const bx = x0 + 60 * u + i * (cw / 2), bw = cw / 2 - 120 * u;
      rr(bx, y0 + 130 * u, bw, 250 * u, 10 * u, col + '33', col, a);
      txt(T(tm), bx + bw / 2, y0 + 180 * u, { kind: 'bold', size: 34 * u, color: col, align: 'center', alpha: a });
      txt(String(n), bx + bw / 2, y0 + 290 * u, { kind: 'mono', size: 120 * u, align: 'center', alpha: a, ltr: true });
    });
    txt('VS', W / 2, y0 + 255 * u, { kind: 'latin', size: 44 * u, align: 'center', alpha: a, ltr: true });
  } else {
    txt(T('ffa'), W / 2, y0 + 60 * u, { kind: 'display', size: 50 * u, color: C.acc, align: 'center', alpha: a, max: cw - 60 * u });
    const rows = [['Solomon', 11 + Math.min(2, Math.floor(lt * 1.2))], ['Kaz', 10], ['Lina', 9], ['Rashid', 7], ['Mo_7', 6]];
    rows.forEach(([n, k], i) => {
      const ry = y0 + 120 * u + i * 72 * u, k2 = eout((lt - i * 0.12) * 4) * a;
      rr(x0 + 40 * u, ry, cw - 80 * u, 60 * u, 6 * u, i === 0 ? 'rgba(245,165,60,.2)' : 'rgba(255,255,255,.05)', null, k2);
      txt(String(i + 1), S.rtl ? x0 + cw - 70 * u : x0 + 70 * u, ry + 30 * u, { kind: 'mono', size: 30 * u, color: i === 0 ? C.acc : C.mute, align: 'center', alpha: k2, ltr: true });
      txt(n, S.rtl ? x0 + cw - 120 * u : x0 + 120 * u, ry + 30 * u, { kind: 'bold', size: 30 * u, align: S.rtl ? 'end' : 'start', alpha: k2, ltr: true });
      txt(`${k} ${T('sbKills')}`, S.rtl ? x0 + 70 * u : x0 + cw - 70 * u, ry + 30 * u, { kind: 'bold', size: 26 * u, align: S.rtl ? 'start' : 'end', alpha: k2 });
    });
  }
  // chips
  const cy = y0 + 560 * u;
  [[T('trUpTo8'), C.acc], [T('trDevices'), '#fff']].forEach(([s, col], i) => {
    const w = Math.min(cw / 2 - 20 * u, 440 * u), x = S.vert ? (W - w) / 2 : x0 + i * (cw / 2 + 20 * u), y = S.vert ? cy + i * 80 * u : cy;
    rr(x, y, w, 62 * u, 31 * u, 'rgba(12,15,18,.85)', col, 1); txt(s, x + w / 2, y + 31 * u, { kind: 'bold', size: 24 * u, color: col, align: 'center', max: w - 30 * u });
  });
}
function finale(t) {
  const u = S.u, W = S.W, H = S.H;
  const g = octx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.8)'); octx.fillStyle = g; octx.fillRect(0, 0, W, H);
  if (t > 0.5) {
    const k = eout((t - 0.5) * 2), s = (S.vert ? 300 : 230) * u, y = H * (S.vert ? 0.2 : 0.12);
    if (icon && icon.complete && icon.naturalWidth) { octx.save(); octx.globalAlpha = k; octx.beginPath(); const x = W / 2 - s / 2; octx.moveTo(x + 50 * u, y); octx.arcTo(x + s, y, x + s, y + s, 52 * u); octx.arcTo(x + s, y + s, x, y + s, 52 * u); octx.arcTo(x, y + s, x, y, 52 * u); octx.arcTo(x, y, x + s, y, 52 * u); octx.closePath(); octx.clip(); octx.drawImage(icon, x, y, s, s); octx.restore(); }
    title(t - 0.5, y + s + (S.rtl ? 120 : 110) * u);
  }
  if (t > 2.9) {
    const k = t - 2.9, y = H * (S.vert ? 0.66 : 0.66);
    if (k < 0.25) fadeRect('#fff', 0.6 * (1 - k / 0.25));
    caption(T('trSoon'), null, k, C.acc, y);
    const plats = ['iOS', 'ANDROID', 'STEAM'];
    plats.forEach((p, i) => {
      const ta = 3.2 + i * 0.2; if (t < ta) return; const a = eout((t - ta) * 4);
      const w = 250 * u, gap = 24 * u, total = 3 * w + 2 * gap;
      const x = S.vert ? (W - w) / 2 : W / 2 - total / 2 + i * (w + gap), yy = S.vert ? y + 150 * u + i * 90 * u : y + 150 * u;
      rr(x, yy, w, 72 * u, 36 * u, 'rgba(12,15,18,.9)', '#ffffff', a);
      txt(p, x + w / 2, yy + 37 * u, { kind: 'latin', size: 30 * u, align: 'center', alpha: a, ltr: true });
    });
  }
  if (t > 4.1) {
    const a = eout((t - 4.1) * 3), y = H - (S.vert ? 150 : 90) * u;
    txt(T('trPlayNow'), W / 2, y - (S.link ? 30 : 0) * u, { kind: 'bold', size: 30 * u, color: '#fff', align: 'center', alpha: a, max: W - 80 * u });
    if (S.link) txt(S.link, W / 2, y + 24 * u, { kind: 'mono', size: 30 * u, color: C.acc, align: 'center', alpha: a, ltr: true });
  }
  if (t > LEN - 45.5 - 1.4) fadeRect('#000', clamp((t - (LEN - 45.5 - 1.4)) / 1.2, 0, 1));
}

/* ---------------- runner ---------------- */
export function play({ lang, link, vert, res, record, onEnd, onTick }) {
  const W = vert ? res[1] : res[0], H = vert ? res[0] : res[1];
  out.width = W; out.height = H; renderer.setSize(W, H, false);
  window.__seed(20260925);
  const au = new TrailerAudio();
  S = { lang, rtl: lang !== 'en', link, vert, W, H, u: Math.min(W, H) / 1080, au, t: 0, seg: -1, events: [], flights: [], feed: [], score: { blue: 16, red: 15 }, shake: 0, sub: -1 };
  let rec = null, chunks = [], mime = '';
  if (record) {
    const stream = out.captureStream(30);
    for (const tr of au.dest.stream.getAudioTracks()) stream.addTrack(tr);
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    mime = types.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: vert || res[0] >= 1920 ? 12e6 : 8e6 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => { const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }); onEnd({ blob, ext: /mp4/.test(blob.type) ? 'mp4' : 'webm' }); };
  }
  const T0 = au.ctx.currentTime + 0.25; au.score(T0, LEN);
  if (rec) rec.start(1000);
  let last = 0, done = false;
  const frame = () => {
    if (done) return;
    const t = au.ctx.currentTime - T0;
    if (t >= LEN) { done = true; if (rec) setTimeout(() => rec.stop(), 300); else onEnd(null); setTimeout(() => au.ctx.close(), 1500); return; }
    requestAnimationFrame(frame);
    if (t < 0) { octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H); return; }
    const dt = clamp(t - last, 0, 0.1); last = t; S.t = t;
    render(t, dt); onTick && onTick(t);
  };
  requestAnimationFrame(frame);
  return { stop: () => { done = true; try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {} au.ctx.close(); } };
}

function render(t, dt) {
  let si = SEGS.findIndex(s => t >= s.t0 && t < s.t1); if (si < 0) si = SEGS.length - 1;
  const seg = SEGS[si], lt = t - seg.t0;
  const mapId = typeof seg.map === 'function' ? seg.map(lt) : seg.map;
  if (si !== S.seg || mapId !== S.mapId) {
    const firstEntry = si !== S.seg; S.seg = si; S.mapId = mapId;
    const W = world(mapId); resetWorld(W); W.setSun(seg.sun);
    S.flights = [];
    if (firstEntry) { S.segT0 = seg.t0; if (si === 3) S.feed = []; S.sub = -1;
      const ev = seg.setup(W) || []; S.events = ev.map(([x, fn]) => [seg.t0 + x, fn]).sort((a, b) => a[0] - b[0]); }
  }
  const W = world(mapId);
  while (S.events.length && S.events[0][0] <= t) S.events.shift()[1]();
  S.events.sort((a, b) => a[0] - b[0]);
  for (const a of W.actors) if (a.alive) poseActor(a, lt - (si === 6 ? S.sub * 2.5 : 0), dt);
  stepFlights(dt); W.fx.update(dt);
  for (const p of W.pads) if (p.holder.visible) { p.holder.rotation.y = t * 1.8; p.holder.position.y = 1.7 + Math.sin(t * 2.4) * 0.22; }
  // camera
  const c = seg.cam(lt); const fov = S.vert ? Math.min(78, c.fov * 1.45) : c.fov;
  S.shake = Math.max(0, S.shake - dt * 2.4); const sh = S.shake * S.shake * 0.6;
  camera.fov = fov; camera.aspect = S.W / S.H; camera.updateProjectionMatrix();
  camera.position.set(c.pos[0] + (Math.random() - 0.5) * sh, c.pos[1] + (Math.random() - 0.5) * sh, c.pos[2] + (Math.random() - 0.5) * sh);
  camera.lookAt(c.look[0], c.look[1], c.look[2]);
  W.follow(V(c.look[0], 0, c.look[2]));
  renderer.render(W.scene, camera);
  octx.fillStyle = '#000'; octx.fillRect(0, 0, S.W, S.H); octx.drawImage(glc, 0, 0, S.W, S.H);
  seg.draw(lt);
  if (t < 0.35) fadeRect('#000', 1 - t / 0.35);
}
