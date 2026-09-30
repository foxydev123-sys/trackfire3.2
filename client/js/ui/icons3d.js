/* 3D icons: chests (closed + open), coin, gem, gift box, lucky wheel,
   quest scroll and a tank badge are real low-poly models rendered once
   (transparent PNG) when the game starts. The pictures are handed to CSS
   as variables (--ic-coin, --ch-rare, --cho-rare …) so every place that
   shows an icon updates by itself. Until then the old flat icons are used. */
import * as THREE from '../three.js';

import { ICON_URL } from './icon-urls.js';
export { ICON_URL };
const TIERS = {
  common:    { body: 0x8a5a34, panel: 0x9aa4ab, band: 0x5d666d, trim: 0xc9d1d6, glow: 0xfff1c0 },
  rare:      { body: 0x7a4e2e, panel: 0x3d7fd0, band: 0x2a5c9c, trim: 0xc9d1d6, glow: 0x9fd0ff },
  epic:      { body: 0x5a3a5e, panel: 0x8a45d0, band: 0x5e2c96, trim: 0xf0c24a, glow: 0xe0b0ff },
  legendary: { body: 0x6b3a1c, panel: 0xe0a020, band: 0xb07010, trim: 0xfff0a0, glow: 0xffe27a },
};
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: o.r ?? 0.6, metalness: Math.min(0.3, o.m ?? 0.1), /* no env map: keep metals bright */ emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.op ?? 1 });
const box = (g, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
const cyl = (g, rt, rb, h, n, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, open = false, ts = 0, tl = Math.PI * 2) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n, 1, open, ts, tl), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };

function chest(tier, open) {
  const T = TIERS[tier], g = new THREE.Group();
  const wood = M(T.body, { r: 0.85 }), panel = M(T.panel, { r: 0.45, m: 0.3 }), band = M(T.band, { r: 0.4, m: 0.5 }), trim = M(T.trim, { r: 0.3, m: 0.7 });
  const W = 2.2, D = 1.5, H = 1.1;
  box(g, W, H, D, wood, 0, H / 2, 0);
  for (let i = 0; i < 4; i++) box(g, W + 0.02, 0.04, D + 0.02, M(0x3a2414), 0, 0.22 + i * 0.22, 0);                 // plank lines
  box(g, W * 0.8, H * 0.62, 0.06, panel, 0, H * 0.48, D / 2 + 0.02);                                             // coloured front panel
  for (const sx of [-1, 1]) { box(g, 0.18, H + 0.04, D + 0.06, band, sx * W * 0.34, H / 2, 0); for (const sz of [-1, 1]) box(g, 0.2, 0.2, 0.2, trim, sx * (W / 2), 0.1, sz * (D / 2)); }
  // lid: half cylinder hinged at the back
  const lid = new THREE.Group(); lid.position.set(0, H, -D / 2); g.add(lid);
  const lidIn = new THREE.Group(); lidIn.position.set(0, 0, D / 2); lid.add(lidIn);
  cyl(lidIn, D / 2, D / 2, W, 10, wood, 0, 0, 0, 0, 0, Math.PI / 2, false, 0, Math.PI);
  cyl(lidIn, D / 2 + 0.03, D / 2 + 0.03, W * 0.8, 10, panel, 0, 0, 0, 0, 0, Math.PI / 2, false, 0.35, Math.PI - 0.7);
  for (const sx of [-1, 1]) cyl(lidIn, D / 2 + 0.05, D / 2 + 0.05, 0.18, 10, band, sx * W * 0.34, 0, 0, 0, 0, Math.PI / 2, false, 0, Math.PI);
  box(lidIn, W + 0.04, 0.08, D + 0.04, trim, 0, 0.02, 0);
  // lock
  const lock = box(open ? lidIn : g, 0.34, 0.4, 0.1, trim, 0, open ? -0.1 : H - 0.05, D / 2 + 0.08);
  if (open) lock.position.set(0, 0.05, D / 2 + 0.06);
  if (tier === 'epic' || tier === 'legendary') for (const sx of [-1, 1]) { const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), M(tier === 'epic' ? 0x5ff0ff : 0xff4060, { r: 0.1, m: 0.2, e: tier === 'epic' ? 0x0a4a55 : 0x550a18 })); gem.position.set(sx * W * 0.2, H * 0.48, D / 2 + 0.09); g.add(gem); }
  if (tier === 'legendary') { const sun = cyl(g, 0.16, 0.16, 0.05, 21, M(0xfebd11, { m: 0.6, r: 0.3, e: 0x442a00 }), 0, H * 0.48, D / 2 + 0.07, Math.PI / 2); sun.rotation.set(Math.PI / 2, 0, 0); }
  if (open) {
    lid.rotation.x = -1.95;
    const inside = box(g, W - 0.12, 0.1, D - 0.12, M(T.glow, { e: T.glow, ei: 1 }), 0, H - 0.08, 0);
    inside.userData.glow = true;
    // coins / gems spilling out
    for (let i = 0; i < 7; i++) { const c = cyl(g, 0.16, 0.16, 0.05, 12, M(0xf2c14e, { m: 0.7, r: 0.3, e: 0x3a2800 }), -0.6 + i * 0.2, H + 0.02 + (i % 3) * 0.06, -0.2 + (i % 2) * 0.3, 0.3 * (i % 3), 0, 0.2 * i); }
  }
  g.userData.T = T;
  return g;
}
function coin() {
  const g = new THREE.Group(), gold = M(0xf2c14e, { m: 0.75, r: 0.28 }), dk = M(0xc9912a, { m: 0.7, r: 0.35 });
  cyl(g, 1, 1, 0.24, 24, gold, 0, 0, 0, Math.PI / 2);
  cyl(g, 0.78, 0.78, 0.27, 24, dk, 0, 0, 0, Math.PI / 2);
  cyl(g, 0.7, 0.7, 0.3, 24, gold, 0, 0, 0, Math.PI / 2);
  // a little 21-ray sun embossed on the face
  cyl(g, 0.28, 0.28, 0.34, 21, dk, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; box(g, 0.08, 0.22, 0.33, dk, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0, 0, 0, a - Math.PI / 2); }
  g.rotation.set(0.15, -0.5, 0.1);
  return g;
}
function gem() {
  const g = new THREE.Group(), c = M(0x46c8ff, { m: 0.25, r: 0.15, e: 0x0a3a55 }), c2 = M(0x8fe4ff, { m: 0.2, r: 0.1, e: 0x14506a });
  cyl(g, 0.62, 1, 0.42, 8, c2, 0, 0.21, 0);           // crown
  cyl(g, 1, 0, 1.1, 8, c, 0, -0.55, 0);               // pavilion
  cyl(g, 0.62, 0.62, 0.02, 8, M(0xd8f6ff, { e: 0x3a7a90 }), 0, 0.43, 0);
  g.rotation.set(0.35, 0.3, 0);
  return g;
}
function gift() {
  const g = new THREE.Group(), red = M(0xd8453a, { r: 0.5 }), rib = M(0xf5c24a, { m: 0.5, r: 0.35 });
  box(g, 1.8, 1.4, 1.8, red, 0, 0.7, 0); box(g, 2.0, 0.4, 2.0, M(0xe85a4a, { r: 0.5 }), 0, 1.55, 0);
  box(g, 0.3, 1.82, 2.04, rib, 0, 0.92, 0); box(g, 2.04, 1.82, 0.3, rib, 0, 0.92, 0);
  for (const s of [-1, 1]) { const b = cyl(g, 0.35, 0.35, 0.22, 10, rib, s * 0.38, 1.95, 0, 0, 0, s * 0.9); b.scale.set(1, 1, 0.5); }
  return g;
}
function wheel() {
  const g = new THREE.Group(), cols = [0xf5a53c, 0x3d7fd0, 0x8fd16a, 0xd8453a, 0xc07bff, 0xfebd11, 0x46c8ff, 0xf2f2f2];
  for (let i = 0; i < 8; i++) cyl(g, 1, 1, 0.2, 4, M(cols[i], { r: 0.5 }), 0, 0, 0, Math.PI / 2, 0, 0, false, i / 8 * Math.PI * 2, Math.PI / 4);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.1, 6, 24), M(0x5a3a1c, { r: 0.5 })); g.add(rim);
  cyl(g, 0.18, 0.18, 0.34, 10, M(0xf2c14e, { m: 0.7, r: 0.3 }), 0, 0, 0, Math.PI / 2);
  const ptr = cyl(g, 0, 0.18, 0.4, 4, M(0xf2f2f2), 0, 1.18, 0.12, Math.PI, 0, 0);
  g.rotation.set(-0.3, 0.35, 0);
  return g;
}
function scroll() {
  const g = new THREE.Group(), paper = M(0xf1e2bd, { r: 0.9 }), wood = M(0x8a5a34, { r: 0.7 });
  box(g, 1.5, 1.9, 0.05, paper, 0, 0, 0);
  for (const s of [-1, 1]) { cyl(g, 0.13, 0.13, 1.8, 10, wood, 0, s * 1.0, 0.02, 0, 0, Math.PI / 2); cyl(g, 0.16, 0.16, 0.12, 10, M(0xf5c24a, { m: 0.6 }), 0.95, s * 1.0, 0.02, 0, 0, Math.PI / 2); cyl(g, 0.16, 0.16, 0.12, 10, M(0xf5c24a, { m: 0.6 }), -0.95, s * 1.0, 0.02, 0, 0, Math.PI / 2); }
  for (let i = 0; i < 4; i++) { box(g, 0.16, 0.16, 0.08, M(i < 2 ? 0x8fd16a : 0xb9c3cc), -0.45, 0.55 - i * 0.38, 0.04); box(g, 0.7, 0.07, 0.07, M(0x6a5a44), 0.15, 0.55 - i * 0.38, 0.04); }
  g.rotation.set(-0.25, 0.4, 0.08);
  return g;
}

/** Render every icon once. `makeTank(scene)` returns a TankView for the garage badge (optional). */
export async function renderIcons3D(makeTank) {
  if (!THREE.REVISION) return false;                     // test stand-in without WebGL: keep the flat icons
  let R;
  try { R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return false; }
  R.setClearColor(0x000000, 0); R.setPixelRatio(1);
  const shot = (obj, w, h, cam, keep = false) => {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x3a3f48, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(4, 7, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc8ff, 0.6); rim.position.set(-5, 3, -4); scene.add(rim);
    obj.traverse(o => { if (o.userData.glow) { const l = new THREE.PointLight(obj.userData.T.glow, 2.2, 6); l.position.set(0, 1.6, 0.3); scene.add(l); } });
    scene.add(obj); R.setSize(w, h, false);
    const c = new THREE.PerspectiveCamera(cam.fov || 26, w / h, 0.1, 100); c.position.set(...cam.p); c.lookAt(...cam.t); R.render(scene, c);
    const url = R.domElement.toDataURL('image/png');
    if (!keep) obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return url;
  };
  const root = document.documentElement.style;
  for (const tier of Object.keys(TIERS)) {
    ICON_URL['ch-' + tier] = shot(chest(tier, false), 256, 224, { p: [3.6, 3.4, 5.6], t: [0, 0.75, 0] });
    ICON_URL['cho-' + tier] = shot(chest(tier, true), 256, 224, { p: [3.9, 4.4, 7.0], t: [0, 1.15, -0.25] });
    root.setProperty('--ch-' + tier, `url(${ICON_URL['ch-' + tier]})`); root.setProperty('--cho-' + tier, `url(${ICON_URL['cho-' + tier]})`);
  }
  const ic = (name, obj, cam) => { ICON_URL[name] = shot(obj, 96, 96, cam); root.setProperty('--ic-' + name, `url(${ICON_URL[name]})`); };
  ic('coin', coin(), { p: [0, 0, 5.4], t: [0, 0, 0] });
  ic('gem', gem(), { p: [0, 0.3, 5.6], t: [0, 0, 0] });
  ic('gift', gift(), { p: [2.8, 3.2, 5], t: [0, 0.95, 0], fov: 30 });
  ic('wheel', wheel(), { p: [0, 0.2, 5.4], t: [0, 0.15, 0] });
  ic('scroll', scroll(), { p: [0, 0, 5.6], t: [0, 0, 0] });
  ICON_URL['shop'] = ICON_URL['ch-rare']; root.setProperty('--ic-shop', `url(${ICON_URL['ch-rare']})`);
  if (makeTank) {
    const scene = new THREE.Scene(); const v = makeTank(scene); v.setPose(0, 0, -0.6, -0.3, () => 0, 0.016, 0);
    const g = v.root; scene.remove(g);
    ICON_URL.garage = shot(g, 128, 96, { p: [7, 5.4, 8], t: [0, 1, 0.4], fov: 30 }, true); root.setProperty('--ic-garage', `url(${ICON_URL.garage})`);
  }
  document.documentElement.classList.add('icons3d');
  try { R.dispose(); R.forceContextLoss(); } catch (e) {}
  return true;
}
