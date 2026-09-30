/* =====================================================================
   PROMO STUDIO — stages cinematic shots with the real game's 3D code and
   exports ready-sized images (TikTok 9:16, square, wide, profile picture)
   with the title and text drawn on top.
   ===================================================================== */
import * as THREE from './three.js';
import { buildWorld } from './game/world.js';
import { TankView, TEAM_COLORS, TEAM_ACCENT } from './game/tank.js';
import { FX } from './game/fx.js';
import { Shells } from './game/shells.js';
import { buildPads, PU_COLORS } from './game/game.js';
import { getMap } from '../shared/maps.js';

const $ = (id) => document.getElementById(id);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- scenes (coordinates are real positions on the maps) ---------- */
const SCENES = [
  { id: 'citadel', name: 'Hawler Citadel', map: 'hawler', sun: 'golden', cam: [34, 30, 24], look: [-2, 4, -22], fov: 42,
    tanks: [{ x: -2, z: -4.5, yaw: 3.3, t: 2.4, team: 'blue', fire: true }, { x: -15, z: -12, yaw: 2.2, t: 0.9, team: 'red' }, { x: 16, z: -10, yaw: -2.4, t: -1.9, team: 'red', armor: true }, { x: 10, z: 2, yaw: 3.0, t: 3.2, team: 'blue' }],
    booms: [{ x: -13, z: -10.5, big: false }], shells: [{ x: -8, z: -8, a: -2.3 }], pads: [] },
  { id: 'park', name: 'Battle in Shar Park', map: 'hawler', sun: 'midday', cam: [2, 34, 40], look: [0, 0, 11], fov: 40,
    tanks: [{ x: -11, z: 13, yaw: 0.6, t: 1.1, team: 'blue', fire: true }, { x: 10.5, z: 3, yaw: -2.6, t: -2.1, team: 'red' }, { x: -4, z: -1.5, yaw: 1.6, t: 1.9, team: 'blue', boost: true }, { x: 12, z: 22, yaw: -1.2, t: -2.8, team: 'red' }],
    booms: [{ x: 9, z: 5.5, big: true }], shells: [{ x: 4, z: 17, a: 2.7 }], pads: [] },
  { id: 'power', name: 'Power-ups', map: 'hawler', sun: 'golden', cam: [-12, 11, 24], look: [-24, 1.5, 10], fov: 44,
    tanks: [{ x: -24, z: 7, yaw: 0.05, t: 0.4, team: 'blue', armor: true, oneShot: true }, { x: -23.5, z: -8, yaw: 0, t: 3.0, team: 'red' }],
    booms: [], shells: [], pads: [{ i: 0, type: 'speed' }] },
  { id: 'bazaar', name: 'Bazaar clock tower', map: 'hawler', sun: 'morning', cam: [-14, 9, 38], look: [-32, 6, 19], fov: 46,
    tanks: [{ x: -24, z: 26, yaw: 3.14, t: 2.6, team: 'red', fire: true }, { x: -21, z: 10, yaw: 0, t: -0.3, team: 'blue' }],
    booms: [], shells: [{ x: -23, z: 20, a: 2.9 }], pads: [] },
  { id: 'desert', name: 'Desert showdown', map: 'desert', sun: 'golden', cam: [22, 28, 30], look: [2, 0, 0], fov: 42,
    tanks: [{ x: 4, z: 6, yaw: -0.8, t: -0.6, team: 'blue', fire: true }, { x: -4, z: -6, yaw: 2.4, t: 2.5, team: 'red' }, { x: 14, z: -6, yaw: -2.2, t: -2.3, team: 'red' }],
    booms: [{ x: -2.5, z: -4, big: false }], shells: [{ x: 1, z: 1, a: -2.6 }], pads: [] },
  { id: 'forest', name: 'The bridge', map: 'forest', sun: 'midday', cam: [34, 26, 18], look: [24, 0, -5], fov: 44,
    tanks: [{ x: 23, z: -5.6, yaw: 1.57, t: 1.4, team: 'red' }, { x: 36, z: -3, yaw: -1.3, t: -1.6, team: 'blue', fire: true }],
    booms: [{ x: 26, z: -5, big: true }], shells: [], pads: [] },
];
const PROFILE = { id: 'profile', name: 'Profile picture', map: 'hawler', sun: 'golden', cam: [5.2, 4.6, 5.4], look: [0, 1.4, -6.2], fov: 44,
  tanks: [{ x: 0, z: -6.5, yaw: 0.25, t: 0.55, team: 'blue' }], booms: [], shells: [], pads: [] };

const FORMATS = [
  { id: 'tiktok', label: 'TikTok / Reels / Stories', w: 1080, h: 1920 },
  { id: 'square', label: 'Square post', w: 1080, h: 1080 },
  { id: 'wide', label: 'Wide cover (YouTube, PC)', w: 1920, h: 1080 },
];

/* ---------- text for the overlays ---------- */
const TXT = {
  ku: { dir: 'rtl', title: 'تانکی کوردی', heads: ['شەڕی تانک لە هەولێر', 'لەگەڵ هاوڕێکانت یاری بکە', 'کێ باشترین تانکەوانی کوردستانە؟'], cta: 'بەخۆڕایی · بێ دابەزاندن · لە وێبگەڕ' },
  ar: { dir: 'rtl', title: 'الدبابة الكردية', heads: ['معارك الدبابات في هولير', 'العب مع أصدقائك', 'من أفضل سائق دبابة في كردستان؟'], cta: 'مجاناً · بدون تحميل · في المتصفح' },
  en: { dir: 'ltr', title: 'KURDISH TANK', heads: ['Tank battles in Hawler', 'Play with your friends', 'Who is the best tank driver in Kurdistan?'], cta: 'FREE · NO DOWNLOAD · PLAYS IN YOUR BROWSER' },
};

/* ---------- 3D ---------- */
let renderer, camera; const worlds = {};
function world(id) {
  if (!worlds[id]) {
    const W = buildWorld(getMap(id), { sun: 'midday' });
    W.fx = new FX(W.scene, W.map.env.dust, 200); W.shells = new Shells(W.scene);
    W.pads = buildPads(W, (x, z) => W.map.height(x, z));
    W.tanks = [];
    worlds[id] = W;
  }
  return worlds[id];
}
function stage(S) {
  const W = world(S.map);
  W.setSun(S.sun);
  for (const tv of W.tanks) tv.dispose(); W.tanks = [];
  W.shells.clear();
  for (const a of W.fx.act) { a.m.visible = false; W.fx.pool.push(a.m); } W.fx.act = [];
  const B = W.map.bridge;
  const H = (x, z) => { const h = W.map.height(x, z); return B && x > B.x0 - 0.5 && x < B.x1 + 0.5 && Math.abs(z - B.zc) < B.halfW + 1 ? Math.max(h, 0.45) : h; };
  for (const T of S.tanks) {
    const tv = new TankView(W.scene, TEAM_COLORS[T.team], TEAM_ACCENT[T.team], false);
    tv.setPose(T.x, T.z, T.yaw, T.t, H, 1, 0); tv.setPose(T.x, T.z, T.yaw, T.t, H, 1, 0);
    tv.setPowers({ armor: T.armor ? 4 : 0, oneShot: !!T.oneShot, boost: T.boost ? 4 : 0 }, 0.1);
    if (T.fire) { const m = tv.muzzleWorld(V(0, 0, 0)); W.fx.muzzle(m, V(Math.sin(T.t), 0, Math.cos(T.t))); tv.recoil = 0.6; tv.setPose(T.x, T.z, T.yaw, T.t, H, 0.001, 0); }
    if (T.boost) for (let i = 0; i < 6; i++) W.fx.dust(V(T.x - Math.sin(T.yaw) * (2 + i * 0.8), H(T.x, T.z) + 0.3, T.z - Math.cos(T.yaw) * (2 + i * 0.8)));
    W.tanks.push(tv);
  }
  for (const b of S.booms) W.fx.explode(V(b.x, H(b.x, b.z) + 1.2, b.z), b.big);
  for (const s of S.shells) W.shells.spawn({ x: s.x, z: s.z, a: s.a, y: H(s.x, s.z) + 1.5 });
  // let explosions and flashes bloom for a moment, then freeze
  W.fx.update(0.09); W.fx.update(0.07);
  (W.pads || []).forEach((p, i) => {
    const want = S.pads.find(q => q.i === i);
    for (const k in p.icons) p.icons[k].visible = !!want && k === want.type;
    p.ring.visible = p.holder.visible = !!want;
    if (want) { p.ring.material.color.setHex(PU_COLORS[want.type]); p.holder.rotation.y = 0.6; }
  });
  W.follow(V(S.look[0], 0, S.look[2]));
  return W;
}
function shoot(S, w, h) {
  const W = stage(S);
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  camera.fov = S.fov * (h > w ? 1.25 : 1); camera.aspect = w / h;
  // tall frames: pull the camera back a little so the action still fits
  const k = h > w ? 1.18 : w > h * 1.5 ? 0.95 : 1.05;
  camera.position.set(S.look[0] + (S.cam[0] - S.look[0]) * k, S.look[1] + (S.cam[1] - S.look[1]) * k, S.look[2] + (S.cam[2] - S.look[2]) * k);
  camera.updateProjectionMatrix(); camera.lookAt(...S.look);
  renderer.render(W.scene, camera);
}

/* ---------- 2D overlay ---------- */
function flag(ctx, x, y, w, h) {
  ctx.fillStyle = '#ed2024'; ctx.fillRect(x, y, w, h / 3);
  ctx.fillStyle = '#f7f7f2'; ctx.fillRect(x, y + h / 3, w, h / 3);
  ctx.fillStyle = '#278e43'; ctx.fillRect(x, y + 2 * h / 3, w, h / 3);
  const r = h * 0.2, cx = x + w / 2, cy = y + h / 2;
  ctx.fillStyle = '#febd11'; ctx.beginPath();
  for (let i = 0; i < 42; i++) { const a = (i / 42) * Math.PI * 2, rr = i % 2 ? r * 0.72 : r * 1.12; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}
function fit(ctx, text, max, size, font) { let s = size; do { ctx.font = font.replace('{s}', s); s -= 2; } while (ctx.measureText(text).width > max && s > 12); return s + 2; }
function overlay(ctx, w, h, opt) {
  const L = TXT[opt.lang], u = Math.min(w, h) / 1080, tall = h > w;
  // readability gradients
  let g = ctx.createLinearGradient(0, 0, 0, h * 0.42); g.addColorStop(0, 'rgba(8,8,10,.78)'); g.addColorStop(1, 'rgba(8,8,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.42);
  g = ctx.createLinearGradient(0, h, 0, h * 0.62); g.addColorStop(0, 'rgba(8,8,10,.82)'); g.addColorStop(1, 'rgba(8,8,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.62, w, h * 0.38);
  const pad = 70 * u, rtl = L.dir === 'rtl';
  ctx.textBaseline = 'alphabetic'; ctx.direction = L.dir; ctx.textAlign = 'center';
  const cx = w / 2;
  let y = tall ? 250 * u : 150 * u;
  // title
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowOffsetY = 6 * u; ctx.shadowBlur = 0;
  if (rtl) {
    fit(ctx, L.title, w - pad * 2, Math.round(150 * u), '800 {s}px "Noto Kufi Arabic", sans-serif');
    ctx.fillStyle = '#f5a53c'; ctx.fillText(L.title, cx, y);
    ctx.font = `400 ${Math.round(40 * u)}px Bungee, Impact, sans-serif`; ctx.fillStyle = '#fff4e2'; ctx.shadowOffsetY = 3 * u;
    ctx.direction = 'ltr'; ctx.fillText('KURDISH TANK', cx, y + 64 * u); ctx.direction = L.dir;
    y += 105 * u;
  } else {
    fit(ctx, 'KURDISH TANK', w - pad * 2, Math.round(128 * u), '400 {s}px Bungee, Impact, sans-serif');
    ctx.fillStyle = '#f5a53c'; ctx.fillText('KURDISH', cx, y); ctx.fillStyle = '#fff4e2'; ctx.fillText('TANK', cx, y + 118 * u);
    y += 150 * u;
  }
  ctx.shadowColor = 'transparent';
  flag(ctx, cx - 110 * u, y, 220 * u, 66 * u); y += 66 * u;
  // headline
  const head = L.heads[opt.head] || L.heads[0];
  const hf = rtl ? '800 {s}px "Noto Kufi Arabic", sans-serif' : '700 {s}px "Chakra Petch", sans-serif';
  const hs = fit(ctx, head, w - pad * 2, Math.round(72 * u), hf);
  ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowOffsetY = 4 * u;
  ctx.fillText(head, cx, y + hs * 1.35); ctx.shadowColor = 'transparent';
  // bottom: call to action + link
  let by = h - (tall ? 240 : 120) * u;
  const cf = rtl ? '700 {s}px "Noto Kufi Arabic", sans-serif' : '700 {s}px "Chakra Petch", sans-serif';
  const cs = fit(ctx, L.cta, w - pad * 2 - 80 * u, Math.round(40 * u), cf);
  const cw = ctx.measureText(L.cta).width + 70 * u, ch = cs * 1.9;
  ctx.fillStyle = '#f5a53c'; roundRect(ctx, cx - cw / 2, by - ch * 0.72, cw, ch, ch / 2); ctx.fill();
  ctx.fillStyle = '#1b1206'; ctx.fillText(L.cta, cx, by + cs * 0.1);
  if (opt.link) {
    ctx.direction = 'ltr'; fit(ctx, opt.link, w - pad * 2, Math.round(40 * u), '600 {s}px "Chakra Petch", monospace');
    ctx.fillStyle = '#fff4e2'; ctx.fillText(opt.link, cx, by + ch * 1.15); ctx.direction = L.dir;
  }
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function compose(S, F, opt) {
  shoot(S, F.w, F.h);
  const c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
  const ctx = c.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0);
  if (opt.lang !== 'none') overlay(ctx, F.w, F.h, opt);
  return c.toDataURL('image/jpeg', 0.92);
}
function composeProfile() {
  shoot(PROFILE, 1080, 1080);
  const c = document.createElement('canvas'); c.width = c.height = 1080; const ctx = c.getContext('2d');
  ctx.drawImage(renderer.domElement, 0, 0);
  const g = ctx.createRadialGradient(540, 540, 380, 540, 540, 620); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1080);
  flag(ctx, 390, 880, 300, 90);
  return c.toDataURL('image/jpeg', 0.92);
}

/* ---------- UI ---------- */
const state = { lang: 'ku', head: 0, link: '' };
try { Object.assign(state, JSON.parse(localStorage.getItem('kt-studio') || '{}')); } catch (e) {}
function save() { try { localStorage.setItem('kt-studio', JSON.stringify(state)); } catch (e) {} }

async function renderAll() {
  const btn = $('go'); btn.disabled = true; const gal = $('gallery'); gal.innerHTML = '';
  $('status').textContent = 'Loading fonts…';
  try { await Promise.all(['800 80px "Noto Kufi Arabic"', '400 80px Bungee', '700 40px "Chakra Petch"'].map(f => document.fonts.load(f))); } catch (e) {}
  const jobs = [];
  for (const F of FORMATS) for (const S of SCENES) jobs.push({ S, F });
  jobs.splice(0, 0, { profile: true });
  let n = 0;
  for (const j of jobs) {
    $('status').textContent = `Rendering ${++n} of ${jobs.length}…`;
    await new Promise(r => setTimeout(r, 30));
    const url = j.profile ? composeProfile() : compose(j.S, j.F, state);
    const card = document.createElement('figure'); card.className = 'shot ' + (j.profile ? 'square' : j.F.id);
    const img = new Image(); img.src = url; img.alt = j.profile ? 'Profile picture' : `${j.S.name}, ${j.F.label}`;
    img.addEventListener('click', () => { $('bigImg').src = url; $('big').hidden = false; });
    const cap = document.createElement('figcaption');
    cap.innerHTML = j.profile ? '<b>Profile picture</b><span>1080 × 1080</span>' : `<b>${j.S.name}</b><span>${j.F.label} · ${j.F.w} × ${j.F.h}</span>`;
    card.append(img, cap); gal.append(card);
  }
  $('status').textContent = `Done — ${jobs.length} images. Tap one to view it full size.`;
  btn.disabled = false;
  renderer.setSize(10, 10, false);
}

function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  camera = new THREE.PerspectiveCamera(42, 9 / 16, 0.5, 600);
  for (const b of document.querySelectorAll('#langSeg button')) {
    b.setAttribute('aria-pressed', b.dataset.l === state.lang ? 'true' : 'false');
    b.addEventListener('click', () => { state.lang = b.dataset.l; save(); for (const x of document.querySelectorAll('#langSeg button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); fillHeads(); });
  }
  $('head').addEventListener('change', (e) => { state.head = +e.target.value; save(); });
  $('link').value = state.link || ''; $('link').addEventListener('input', (e) => { state.link = e.target.value.trim(); save(); });
  $('go').addEventListener('click', renderAll);
  $('big').addEventListener('click', () => { $('big').hidden = true; });
  fillHeads();
  $('status').textContent = 'Ready. Choose a language and press Make the pictures.';
  $('go').disabled = false;
}
function fillHeads() {
  const L = TXT[state.lang === 'none' ? 'en' : state.lang];
  $('head').innerHTML = L.heads.map((h, i) => `<option value="${i}" ${i === state.head ? 'selected' : ''}>${h}</option>`).join('');
  $('head').disabled = state.lang === 'none';
}
boot();
