/* Low-poly prefabs: turns shared map objects (pure data) into geometry
   added to batches. Visual-only randomness uses a per-object seed, so it
   never affects gameplay. */
import * as THREE from '../three.js';
import { G, CYL, M4, setTag } from './batch.js';
import { rng, TAU, polyDist } from '../../shared/math.js';

const WHITE = new THREE.Color(0xffffff);
// Kurdish flag colours: red, white, green, with the golden 21-ray sun.
export const KF = { red: 0xed2024, white: 0xf7f7f2, green: 0x278e43, sun: 0xfebd11 };

/** Kurdish flag on a pole. (x,z) ground position, h = pole height, s = size, y0 = base height override. */
export function addFlag(B, x, y, z, h, s, ry) {
  const pre = M4(x, y, z, ry);
  B.add(CYL(0.5, 0.6, 6), 0xb8bcc0, [0, h / 2, 0], [0, 0, 0], [0.16 * Math.max(1, s * 0.8), h, 0.16 * Math.max(1, s * 0.8)], 0.02, pre);
  B.add(G.sph, 0xd9b44a, [0, h + 0.1, 0], [0, 0, 0], [0.16 * s, 0.16 * s, 0.16 * s], 0, pre);
  const W = 2.6 * s, S = 0.55 * s, top = h - 0.15, cx = W / 2 + 0.1;
  // gentle wave: two halves at slight angles
  for (const [off, rot] of [[-0.25, 0.1], [0.25, -0.1]]) {
    const hx = cx + off * W;
    B.add(G.box, KF.red, [hx, top - S * 0.5, 0], [0, rot, 0], [W / 2 + 0.02, S, 0.05], 0.02, pre);
    B.add(G.box, KF.white, [hx, top - S * 1.5, 0], [0, rot, 0], [W / 2 + 0.02, S, 0.05], 0.02, pre);
    B.add(G.box, KF.green, [hx, top - S * 2.5, 0], [0, rot, 0], [W / 2 + 0.02, S, 0.05], 0.02, pre);
  }
  // the sun: a 21-sided disc (one side per ray)
  B.add(CYL(1, 1, 21), KF.sun, [cx, top - S * 1.5, 0], [Math.PI / 2, 0, 0], [0.34 * s, 0.1, 0.34 * s], 0, pre);
}

/* ---------------- tanks ----------------
   Each tank type has its own paint (`body`) and its own shape; the team
   colour (`team`) goes on marking panels, the skirt stripe and the turret
   roof, so you can tell both the tank type and the team at a glance. */
function tankKit(B, body, team, pre, dark) {
  const c = new THREE.Color(body), dk = c.clone().multiplyScalar(0.72), dk2 = c.clone().multiplyScalar(0.52), lt = c.clone().lerp(WHITE, 0.2);
  const tm = team == null ? (dark ? dk.clone() : c.clone().lerp(WHITE, 0.45)) : new THREE.Color(team);
  const K = {
    c, dk, dk2, lt, tm,
    TR: dark ? 0x1c1a19 : 0x2a2b2d, TR2: dark ? 0x221f1d : 0x3a3c3f, WH: dark ? 0x272321 : 0x4a4e52, HUB: dark ? 0x2a2624 : 0x80858a,
    MET: dark ? 0x2a2624 : 0x5b6064, GUN: dark ? 0x2a2624 : 0x4c5054, GOLD: dark ? 0x3a3431 : 0xf2b92a,
    bx: (col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, j = 0.03) => B.add(G.box, col, [x, y, z], [rx, ry, rz], [sx, sy, sz], j, pre),
    cy: (n, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, j = 0.03, rt = 0.5, rb = 0.5) => B.add(CYL(rt, rb, n), col, [x, y, z], [rx, ry, rz], [sx, sy, sz], j, pre),
    sp: (col, x, y, z, sx, sy, sz, j = 0.03) => B.add(G.sph, col, [x, y, z], [0, 0, 0], [sx, sy, sz], j, pre),
  };
  return K;
}

export function addHull(B, body, pre, dark, kind = 'zagros', team = null) {
  const K = tankKit(B, body, team, pre, dark), { c, dk, dk2, lt, tm, TR, TR2, WH, HUB, MET, GOLD, bx, cy } = K;
  const heavy = kind === 'halgurd', light = kind === 'baz';
  const L = heavy ? 3.8 : light ? 3.4 : 3.6;          // track length
  const nW = heavy ? 6 : light ? 4 : 5;               // road wheels per side
  const wR = light ? 0.62 : 0.54, hy = light ? 0.94 : 1.0;
  // ---- running gear
  for (const s of [-1, 1]) {
    const x = s * 1.06;
    bx(TR, x, 0.38, 0, 0.64, 0.66, L - 0.4, 0, 0, 0, 0.04);                                // track belt
    bx(TR, x, 0.38, L / 2 - 0.1, 0.62, 0.42, 0.5, 0.75);                                  // front wrap
    bx(TR, x, 0.38, -L / 2 + 0.1, 0.62, 0.42, 0.5, -0.75);                                // rear wrap
    for (let i = 0; i < 11; i++) bx(TR2, x, 0.72, -L / 2 + 0.4 + i * (L - 0.8) / 10, 0.66, 0.05, 0.13, 0, 0, 0, 0.02); // tread links
    for (let i = 0; i < nW; i++) {
      const z = -L / 2 + 0.72 + i * (L - 1.44) / (nW - 1);
      cy(10, WH, s * 1.39, 0.36, z, wR, 0.1, wR, 0, 0, Math.PI / 2);
      cy(8, HUB, s * 1.45, 0.36, z, wR * 0.42, 0.04, wR * 0.42, 0, 0, Math.PI / 2, 0);
    }
    cy(8, MET, s * 1.37, 0.47, -L / 2 + 0.24, 0.58, 0.16, 0.58, 0, 0, Math.PI / 2);        // drive sprocket
    cy(8, HUB, s * 1.46, 0.47, -L / 2 + 0.24, 0.2, 0.05, 0.2, 0, 0, Math.PI / 2, 0);
    cy(8, WH, s * 1.37, 0.47, L / 2 - 0.24, 0.48, 0.14, 0.48, 0, 0, Math.PI / 2);          // idler
    // fender, skirt and the team stripe
    bx(dk, s * 1.08, 0.8, 0, 0.82, 0.1, L + 0.3);
    if (heavy) for (let i = 0; i < 4; i++) {
      bx(dk, s * 1.45, 0.58, -1.35 + i * 0.9, 0.12, 0.52, 0.86, 0, 0, s * 0.06);
      for (const dz of [-0.28, 0.28]) cy(6, MET, s * 1.52, 0.74, -1.35 + i * 0.9 + dz, 0.08, 0.04, 0.08, 0, 0, Math.PI / 2, 0);
    } else bx(c, s * 1.43, 0.6, 0.05, 0.07, light ? 0.36 : 0.3, L - 0.4);
    bx(tm, s * (heavy ? 1.54 : 1.47), 0.66, 0.1, 0.02, 0.1, L - 0.9, 0, 0, 0, 0);
    // rear stowage box + jerry can
    bx(dk2, s * 1.12, 0.99, -L / 2 + 0.55, 0.58, 0.3, 0.72);
    bx(MET, s * 1.12, 1.15, -L / 2 + 0.55, 0.6, 0.03, 0.74, 0, 0, 0, 0);
    if (!light) { bx(0x55613f, s * 1.18, 1.0, -L / 2 + 1.12, 0.36, 0.34, 0.2); bx(MET, s * 1.18, 1.19, -L / 2 + 1.12, 0.1, 0.06, 0.06, 0, 0, 0, 0); }
  }
  // ---- hull
  bx(c, 0, 0.62, 0, 1.5, 0.6, L - 0.2);                                                   // lower hull
  bx(c, 0, hy, -0.15, 2.1, 0.34, L - 0.7);                                                // upper hull
  bx(lt, 0, hy - 0.1, L / 2 - 0.25, 2.1, 0.14, 1.0, -0.5);                                 // sloped glacis
  bx(dk, 0, hy - 0.1, -L / 2 + 0.28, 2.0, 0.3, 0.22, 0.3);                                 // rear plate
  bx(dk, 0, hy + 0.19, -1.15, 1.5, 0.05, 0.78);                                           // engine deck
  for (let i = 0; i < 4; i++) bx(MET, 0, hy + 0.23, -0.88 - i * 0.18, 1.3, 0.03, 0.06, 0, 0, 0, 0);
  for (const s of [-1, 1]) {
    cy(6, MET, s * 0.6, hy - 0.05, -L / 2 + 0.06, 0.22, 0.28, 0.22, Math.PI / 2);            // exhausts
    cy(6, 0x1a1a1a, s * 0.6, hy - 0.05, -L / 2 - 0.08, 0.14, 0.02, 0.14, Math.PI / 2, 0, 0, 0);
    bx(dk2, s * 0.78, hy + 0.06, L / 2 - 0.55, 0.3, 0.22, 0.14);                             // headlight housing
    bx(0xffe9b0, s * 0.78, hy + 0.06, L / 2 - 0.47, 0.22, 0.14, 0.04, 0, 0, 0, 0);          // headlight
    cy(6, MET, s * 0.5, 0.5, L / 2 - 0.02, 0.14, 0.24, 0.14, Math.PI / 2);                  // tow hooks
    bx(tm, s * 0.72, hy - 0.02, L / 2 - 0.02, 0.36, 0.16, 0.03, -0.5, 0, 0, 0);              // team marking plates
  }
  cy(8, dk, -0.45, hy + 0.19, L / 2 - 1.08, 0.46, 0.06, 0.46);                             // driver hatch
  cy(4, MET, -0.45, hy + 0.25, L / 2 - 0.88, 0.1, 0.06, 0.18, 0, Math.PI / 4, 0, 0);
  // ---- tank-type details
  if (heavy) {                                                                            // reactive armour bricks on the glacis
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) bx(i % 2 === r % 2 ? dk : dk2, -0.72 + i * 0.48, hy + 0.02 - r * 0.2, L / 2 - 0.02 - r * 0.36, 0.44, 0.1, 0.32, -0.5);
    bx(dk, 0, 0.72, L / 2 + 0.02, 1.6, 0.3, 0.16);
  }
  if (light) {                                                                           // rear spoiler + racing stripes
    bx(dk, 0, 1.24, -1.52, 1.9, 0.06, 0.42, 0.2); for (const s of [-1, 1]) bx(dk, s * 0.88, 1.1, -1.55, 0.08, 0.3, 0.2);
    for (const s of [-1, 1]) bx(tm, s * 0.2, hy + 0.175, -0.15, 0.14, 0.02, L - 0.9, 0, 0, 0, 0);
  }
  if (kind === 'korek') {                                                                // repair tank: medic box, crane, tool boxes
    bx(0xeeeeee, -0.62, hy + 0.32, -1.2, 0.58, 0.32, 0.58); bx(0x2fbf6a, -0.62, hy + 0.49, -1.2, 0.42, 0.04, 0.13, 0, 0, 0, 0); bx(0x2fbf6a, -0.62, hy + 0.49, -1.2, 0.13, 0.04, 0.42, 0, 0, 0, 0);
    cy(6, MET, 0.62, hy + 0.5, -1.45, 0.16, 0.7, 0.16);
    bx(0xf0b030, 0.62, hy + 0.95, -1.05, 0.12, 0.12, 1.0, -0.5, 0, 0);
    cy(4, MET, 0.62, hy + 0.9, -0.62, 0.03, 0.5, 0.03, 0, 0, 0, 0);
    for (const s of [-1, 1]) bx(0xb03a2a, s * 1.12, 0.99, 0.3, 0.5, 0.26, 0.6);
  }
  if (kind === 'newroz') for (const s of [-1, 1]) {                                        // flame stripes + gold trim
    bx(0xff7a2a, s * 1.47, 0.68, 0.4, 0.03, 0.12, 2.0, 0, 0, 0, 0); bx(0xffc23a, s * 1.47, 0.54, 0.2, 0.03, 0.08, 1.4, 0, 0, 0, 0);
    bx(GOLD, s * 1.05, hy + 0.18, -0.15, 0.05, 0.04, L - 0.7, 0, 0, 0, 0);
    bx(0xff8a2a, s * 0.4, hy + 0.2, -1.5, 0.3, 0.03, 0.4, 0, 0, 0, 0);
  }
  if (kind === 'bradost') {                                                              // dozer blade: it likes close fights
    bx(dk, 0, 0.4, L / 2 + 0.38, 2.5, 0.52, 0.14, -0.25);
    for (const s of [-1, 1]) bx(MET, s * 0.7, 0.55, L / 2 + 0.05, 0.12, 0.12, 0.7, 0.3);
    for (let i = 0; i < 5; i++) bx(dk2, -1.0 + i * 0.5, 0.16, L / 2 + 0.45, 0.16, 0.14, 0.12, -0.25, 0, 0, 0);
  }
  if (kind === 'safeen') {                                                               // camo net rolled on the back deck
    for (let i = 0; i < 5; i++) B.add(G.blobs[i % 3], i % 2 ? 0x5b6a3a : 0x6f6a45, [-0.6 + i * 0.3, hy + 0.3, -1.45], [0, i, 0], [0.34, 0.2, 0.34], 0.08, pre);
  }
  if (kind === 'rashaba') for (const s of [-1, 1]) { bx(0x55613f, s * 1.12, 0.99, 0.35, 0.5, 0.28, 0.7); bx(tm, s * 1.12, 1.0, 0.35, 0.52, 0.06, 0.72, 0, 0, 0, 0); }
}

export function addTurret(B, body, team, pre, dark, kind = 'zagros') {
  const K = tankKit(B, body, team, pre, dark), { c, dk, dk2, lt, tm, MET, GUN, GOLD, bx, cy } = K;
  let top = 0.72, back = -1.0, cup = [-0.32, -0.3];
  // ---- turret body by type
  if (kind === 'baz') {                                                                  // small wedge turret
    bx(c, 0, 0.27, -0.2, 1.3, 0.48, 1.5); bx(lt, 0, 0.27, 0.7, 1.2, 0.44, 0.5, 0, 0, 0);
    bx(lt, 0, 0.5, 0.62, 1.2, 0.08, 0.6, 0.35); bx(tm, 0, 0.52, -0.3, 1.0, 0.02, 0.9, 0, 0, 0, 0);
    top = 0.52; back = -0.95; cup = [-0.3, -0.35];
  } else if (kind === 'halgurd') {                                                       // big boxy turret with armour bricks
    bx(c, 0, 0.33, -0.15, 1.95, 0.66, 2.25); bx(lt, 0, 0.33, 1.05, 1.5, 0.6, 0.3);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) bx(i % 2 ? dk : dk2, s * 1.0, 0.33, 0.5 - i * 0.5, 0.1, 0.44, 0.44);
    bx(tm, 0, 0.67, -0.3, 1.5, 0.02, 1.4, 0, 0, 0, 0);
    top = 0.66; back = -1.35; cup = [-0.45, -0.4];
  } else if (kind === 'rashaba') {                                                       // flat turret, ammo drums, radar
    cy(8, c, 0, 0.22, -0.1, 1.95, 0.44, 2.0, 0, Math.PI / 8); bx(lt, 0, 0.3, 0.85, 1.0, 0.36, 0.4);
    for (const s of [-1, 1]) { cy(10, dk2, s * 0.98, 0.3, -0.2, 0.46, 0.5, 0.46, 0, 0, Math.PI / 2); cy(10, tm, s * 1.02, 0.3, -0.2, 0.48, 0.08, 0.48, 0, 0, Math.PI / 2, 0); }
    bx(tm, 0, 0.45, -0.3, 1.1, 0.02, 1.0, 0, 0, 0, 0);
    cy(4, MET, 0.45, 0.75, -0.75, 0.05, 0.6, 0.05, 0, 0, 0, 0); cy(12, 0xd8dde0, 0.45, 1.08, -0.75, 0.55, 0.06, 0.55, 0.9, 0.4, 0);
    top = 0.44; back = -1.05; cup = [-0.4, -0.35];
  } else if (kind === 'safeen') {                                                        // low sleek turret + big scope
    cy(7, c, 0, 0.25, -0.3, 0.9, 0.5, 1.15, 0, Math.PI / 7, 0, 0.03, 0.82, 1);
    bx(lt, 0, 0.26, 0.75, 0.9, 0.4, 0.5);
    bx(dk, 0.48, 0.66, 0.05, 0.22, 0.24, 1.0); cy(8, 0x9fd8ff, 0.48, 0.66, 0.57, 0.18, 0.04, 0.18, Math.PI / 2, 0, 0, 0);
    bx(tm, -0.2, 0.51, -0.5, 0.8, 0.02, 1.1, 0, 0, 0, 0);
    top = 0.5; back = -1.35; cup = [-0.35, -0.5];
  } else if (kind === 'bradost') {                                                       // wide brawler turret with shields
    bx(c, 0, 0.3, -0.1, 2.0, 0.58, 1.8); bx(lt, 0, 0.3, 0.9, 1.4, 0.5, 0.3);
    for (const s of [-1, 1]) bx(dk, s * 0.95, 0.35, 0.95, 0.36, 0.7, 0.1, 0, s * 0.35);
    bx(tm, 0, 0.6, -0.3, 1.4, 0.02, 1.1, 0, 0, 0, 0);
    top = 0.6; back = -1.1;
  } else if (kind === 'newroz') {                                                        // angular legendary turret with a golden sun
    cy(6, c, 0, 0.3, -0.12, 1.02, 0.58, 1.08, 0, 0, 0, 0.03, 0.8, 1);
    cy(6, lt, 0, 0.64, -0.12, 0.82, 0.12, 0.86, 0, 0, 0, 0.03, 0.85, 1);
    cy(21, GOLD, 0, 0.72, -0.2, 0.6, 0.06, 0.6, 0, 0, 0, 0); cy(12, 0xffe07a, 0, 0.76, -0.2, 0.3, 0.04, 0.3, 0, 0, 0, 0);
    for (const s of [-1, 1]) { bx(0xff7a2a, s * 0.86, 0.3, 0.05, 0.04, 0.1, 0.9, 0, s * -0.25, 0, 0); bx(GOLD, s * 0.72, 0.6, -0.12, 0.04, 0.04, 0.9, 0, s * -0.25, 0, 0); }
    bx(tm, 0, 0.71, -0.85, 0.9, 0.02, 0.5, 0, 0, 0, 0);
    top = 0.72; back = -1.15; cup = [0.4, -0.55];
  } else {                                                                               // zagros / korek: classic rounded turret
    cy(9, c, 0, 0.3, -0.1, 1, 0.6, 1.12, 0, Math.PI / 9, 0, 0.03, 0.86, 1);
    cy(9, lt, 0, 0.66, -0.12, 1, 0.14, 1.1, 0, Math.PI / 9, 0, 0.03, 0.72, 0.86);
    bx(tm, 0, 0.74, -0.35, 0.9, 0.02, 0.7, 0, 0, 0, 0);
    if (kind === 'korek') { bx(0xeeeeee, 0.45, 0.8, -0.55, 0.36, 0.14, 0.36); bx(0x2fbf6a, 0.45, 0.88, -0.55, 0.26, 0.03, 0.08, 0, 0, 0, 0); bx(0x2fbf6a, 0.45, 0.88, -0.55, 0.08, 0.03, 0.26, 0, 0, 0, 0);
      K.sp(0x2fff7a, -0.55, 0.86, 0.2, 0.1, 0.1, 0.1, 0); }
  }
  // ---- gun mantlet + barrel(s)
  if (kind !== 'safeen') bx(dk, 0, 0.33, 0.98, kind === 'halgurd' ? 0.8 : 0.62, 0.46, 0.42);
  else bx(dk, 0, 0.33, 0.98, 0.5, 0.36, 0.42);
  cy(8, MET, 0, 0.34, 1.28, 0.36, 0.6, 0.36, Math.PI / 2);
  const barrel = (x, len, w, ang = 0, brake = false, fume = false) => {
    const zc = 1.0 + len / 2;
    const px = (d) => x + Math.sin(ang) * d, pz = (d) => 1.0 + Math.cos(ang) * d;
    B.add(CYL(0.5, 0.5, 8), GUN, [px(zc - 1.0), 0.34, pz(zc - 1.0)], [Math.PI / 2, 0, -ang], [w, len, w], 0.02, pre);
    if (fume) B.add(CYL(0.5, 0.5, 8), dk2, [px(len * 0.55), 0.34, pz(len * 0.55)], [Math.PI / 2, 0, -ang], [w * 1.55, 0.42, w * 1.55], 0.02, pre);
    if (brake) {
      B.add(G.box, GUN, [px(len + 0.05), 0.34, pz(len + 0.05)], [0, ang, 0], [w * 1.9, w * 1.25, 0.42], 0.02, pre);
      B.add(G.box, 0x1a1a1a, [px(len + 0.05), 0.34, pz(len + 0.05)], [0, ang, 0], [w * 1.95, w * 0.35, 0.12], 0, pre);
    } else B.add(CYL(0.5, 0.5, 8), GUN, [px(len + 0.05), 0.34, pz(len + 0.05)], [Math.PI / 2, 0, -ang], [w * 1.3, 0.22, w * 1.3], 0.02, pre);
  };
  if (kind === 'rashaba') { for (const x of [-0.17, 0.17]) { barrel(x, 2.0, 0.16); for (let i = 0; i < 4; i++) B.add(CYL(0.5, 0.5, 8), dk2, [x, 0.34, 1.5 + i * 0.35], [Math.PI / 2, 0, 0], [0.23, 0.08, 0.23], 0, pre); } }
  else if (kind === 'bradost') { bx(dk2, 0, 0.34, 1.35, 0.8, 0.36, 0.5); barrel(-0.22, 1.5, 0.2, -0.12); barrel(0, 1.62, 0.22); barrel(0.22, 1.5, 0.2, 0.12); }
  else if (kind === 'safeen') barrel(0, 3.4, 0.2, 0, true, true);
  else if (kind === 'halgurd') barrel(0, 2.4, 0.34, 0, true, true);
  else if (kind === 'baz') barrel(0, 1.8, 0.2, 0, true);
  else if (kind === 'newroz') { barrel(0, 2.3, 0.26, 0, false, true); B.add(CYL(0.5, 0.5, 8), GOLD, [0, 0.34, 3.3], [Math.PI / 2, 0, 0], [0.36, 0.1, 0.36], 0, pre); }
  else barrel(0, 2.28, 0.24, 0, false, true);
  // ---- commander cupola, periscopes, smoke launchers, rear rack
  cy(8, dk, cup[0], top + 0.05, cup[1], 0.54, 0.12, 0.54);
  cy(8, dk2, cup[0], top + 0.13, cup[1], 0.4, 0.05, 0.4, 0, 0, 0.12);
  for (let i = 0; i < 3; i++) bx(0x2a3a44, cup[0] - 0.15 + i * 0.15, top + 0.1, cup[1] + 0.25, 0.08, 0.06, 0.05, 0, 0, 0, 0);
  bx(MET, cup[0] + 0.02, top + 0.2, cup[1] + 0.26, 0.05, 0.05, 0.4, 0, 0, 0, 0);          // roof MG
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++)
    B.add(CYL(0.5, 0.5, 6), MET, [s * (0.66 + i * 0.08), 0.5 + i * 0.07, 0.58 - i * 0.02], [0.7, 0, s * -0.2], [0.11, 0.26, 0.11], 0.02, pre);
  bx(dk2, 0, 0.36, back - 0.18, 1.3, 0.04, 0.42);                                          // rear basket
  for (const s of [-1, 0, 1]) bx(MET, s * 0.63, 0.46, back - 0.18, 0.04, 0.24, 0.42, 0, 0, 0, 0);
  bx(MET, 0, 0.58, back - 0.38, 1.3, 0.04, 0.04, 0, 0, 0, 0);
  bx(0x6b6a4a, -0.3, 0.46, back - 0.16, 0.5, 0.2, 0.34); bx(0x55613f, 0.3, 0.46, back - 0.18, 0.4, 0.22, 0.3);
  if (!dark) {
    cy(4, 0x202224, 0.5, top + 0.62, back + 0.3, 0.04, 1.4, 0.04, 0, 0, 0, 0);            // antenna + little Kurdish flag
    const fy = top + 1.27;
    bx(KF.red, 0.66, fy, back + 0.3, 0.32, 0.07, 0.02, 0, 0, 0, 0);
    bx(KF.white, 0.66, fy - 0.07, back + 0.3, 0.32, 0.07, 0.02, 0, 0, 0, 0);
    bx(KF.green, 0.66, fy - 0.14, back + 0.3, 0.32, 0.07, 0.02, 0, 0, 0, 0);
    bx(KF.sun, 0.66, fy - 0.07, back + 0.3, 0.07, 0.07, 0.04, 0, 0, 0, 0);
  }
}

/* ---------------- map objects ---------------- */
function rockAt(B, M, o, cols) {
  const y = M.height(o.x, o.z);
  B.add(G.rocks[o.v % 6], cols[o.c % cols.length], [o.x, y + o.s * 0.25, o.z], [0.2, o.ry, 0.1], [o.s * o.sx, o.s * o.sy, o.s * o.sz], 0.08);
  if (o.moss) B.add(G.blobs[0], 0x6f8f55, [o.x, y + o.s * 0.62, o.z], [0, o.ry, 0], [o.s * 0.7, o.s * 0.18, o.s * 0.7], 0.08);
}
const DESERT_ROCK = [0xc08a5c, 0xb07d55, 0xcf9a6a, 0xa9744c];
const GREY_ROCK = [0x8f928d, 0xa0a39c, 0x7f837e];

const WARM = [0xffd27a, 0xffe3a0, 0xffc060, 0xfff0c8];
export function addObject(CB, CBflat, o, M, NB = null) {
  const B = CB.at(o.x, o.z), Bs = CBflat.at(o.x, o.z);
  const R = rng(o.seed || (Math.floor(o.x * 131) ^ Math.floor(o.z * 977)) + 7);
  const h = (x, z) => M.height(x, z);
  // Night extras (own random stream so the daytime look never changes).
  const Gw = NB ? NB.glow.at(o.x, o.z) : null, Pl = NB ? NB.pool.at(o.x, o.z) : null;
  const R2 = rng((o.seed || (Math.floor(o.x * 71) ^ Math.floor(o.z * 313))) + 991);
  const glow = (geo, col, p, r, s, pre = null) => { if (Gw) Gw.add(geo, col, p, r, s, 0.08, pre); };
  // A soft pool of light on the ground: 3 stacked additive discs make a stepped gradient.
  const pool = (x, z, r, col = 0x2c2010) => { if (!Pl) return; const y = Math.max(h(x, z), 0.1) + 0.16;
    for (const k of [1, 0.68, 0.38]) Pl.add(CYL(1, 1, 18), col, [x, y + (1 - k) * 0.01, z], [0, 0, 0], [r * k, 0.01, r * k], 0); };
  switch (o.k) {
    case 'rock': rockAt(B, M, o, o.grey ? GREY_ROCK : DESERT_ROCK); break;
    case 'mesa': {
      const cols = [0xd98b55, 0xc9763f, 0xe6a56c, 0xd08048, 0xbf6d3c]; let y = h(o.x, o.z) - 1.2; let r = o.R;
      const layers = Math.round(o.H / 2.1);
      for (let i = 0; i < layers; i++) {
        const hh = 1.8 + R() * 0.9; const rn = r * (0.84 + R() * 0.1);
        B.add(CYL(0.88, 1, 7), cols[i % cols.length], [o.x, y + hh / 2, o.z], [0, R() * TAU, 0], [r, hh, r * (0.85 + R() * 0.3)], 0.05);
        y += hh; r = rn;
      }
      B.add(CYL(0.95, 1, 7), 0xe9ad72, [o.x, y + 0.2, o.z], [0, R() * TAU, 0], [r * 0.95, 0.4, r * 0.9], 0.05);
      break;
    }
    case 'ruin': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry); const wall = 0xe2c69c, wall2 = 0xd2b184, wood = 0x8b5e3a, t = 0.5, { w, d, H } = o;
      B.add(G.box, 0xcdb38a, [0, 0.07, 0], [0, 0, 0], [w, 0.15, d], 0.03, pre);
      const sides = [{ len: w, z: -d / 2, rot: 0 }, { len: w, z: d / 2, rot: 0, door: true }, { len: d, x: -w / 2, rot: 1 }, { len: d, x: w / 2, rot: 1, win: true }];
      for (const s of sides) {
        const n = Math.max(3, Math.round(s.len / 1.15)); const seg = s.len / n;
        for (let i = 0; i < n; i++) {
          if (s.door && i === Math.floor(n / 2)) continue;
          const u = -s.len / 2 + seg * (i + 0.5);
          let hh = H * (0.45 + R() * 0.55); if (i === 0 || i === n - 1) hh = H * (0.85 + R() * 0.15); if (R() < 0.12) hh = H * 0.18;
          const px = s.rot ? s.x : u, pz = s.rot ? u : s.z, sz = s.rot ? [t, 0, seg + 0.02] : [seg + 0.02, 0, t];
          if (s.win && i % 2 === 1 && hh > 2.4) {
            B.add(G.box, wall, [px, 0.5, pz], [0, 0, 0], [sz[0], 1, sz[2]], 0.04, pre);
            B.add(G.box, wall, [px, (2 + hh) / 2, pz], [0, 0, 0], [sz[0], hh - 2, sz[2]], 0.04, pre);
          } else B.add(G.box, i % 3 ? wall : wall2, [px, hh / 2, pz], [0, 0, 0], [sz[0], hh, sz[2]], 0.04, pre);
        }
      }
      B.add(G.box, wood, [0, H - 0.3, -0.6], [0, 0.08, 0.12], [w + 0.6, 0.22, 0.26], 0.05, pre);
      B.add(G.box, wood, [0.4, H - 0.6, 0.8], [0, -0.1, -0.25], [w * 0.8, 0.22, 0.26], 0.05, pre);
      for (let i = 0; i < 9; i++) { const a = R() * TAU, rr = R() * Math.min(w, d) * 0.45; B.add(G.box, R() < 0.5 ? wall2 : 0xbfa071, [Math.cos(a) * rr, 0.2, Math.sin(a) * rr], [R(), R() * 3, R()], [0.4 + R() * 0.6, 0.3 + R() * 0.3, 0.4 + R() * 0.5], 0.05, pre); }
      for (let i = 0; i < 5; i++) { const a = R() * TAU; B.add(G.box, wall2, [Math.cos(a) * (w / 2 + 0.9), 0.18, Math.sin(a) * (d / 2 + 0.9)], [R(), R() * 3, R()], [0.5, 0.35, 0.5], 0.05, pre); }
      if (Gw && R2() < 0.6) {                                   // a small campfire inside, lit only at night
        glow(G.ico, 0xff8a2a, [0, 0.45, 0], [0, 0.4, 0], [0.45, 0.55, 0.45], pre); glow(G.ico, 0xffe070, [0, 0.4, 0], [0, 0, 0], [0.25, 0.35, 0.25], pre);
        const v = new THREE.Vector3(0, 0, 0).applyMatrix4(pre); pool(v.x, v.z, 5, 0x3a1e0a);
      }
      break;
    }
    case 'jersey': B.add(G.jersey, o.alt ? 0xd8cfbf : 0xc5bdae, [o.x, h(o.x, o.z), o.z], [0, o.ry, 0], [1, 1, 2.4], 0.04); break;
    case 'hedgehog': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.box, 0x5a534c, [o.x, y + 0.7, o.z], [k === 0 ? 0.9 : 0, k * 1.05, k === 2 ? 0.9 : 0], [0.18, 1.9, 0.18], 0.03); break; }
    case 'bags': {
      const y = h(o.x, o.z);
      for (let l = 0; l < 3; l++) { const n = Math.round((o.a1 - o.a0) * o.R / 1.05);
        for (let i = 0; i <= n; i++) { const a = o.a0 + (o.a1 - o.a0) * (i + (l % 2) * 0.5) / n; if (a > o.a1) continue;
          B.add(G.sph, l % 2 ? 0xb99c69 : 0xc4a674, [o.x + Math.cos(a) * o.R, y + 0.22 + l * 0.36, o.z + Math.sin(a) * o.R], [0, -a, 0], [0.3, 0.2, 0.55], 0.06); } }
      break;
    }
    case 'nest': {
      const y = h(o.x, o.z);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 7; i++) { const a = Math.PI * 0.9 + i * 0.22 + (l % 2) * 0.11; B.add(G.sph, l % 2 ? 0xb09a6c : 0xbba577, [o.x + Math.cos(a) * 2.4, y + 0.22 + l * 0.36, o.z + Math.sin(a) * 2.4], [0, -a, 0], [0.3, 0.2, 0.55], 0.06); }
      break;
    }
    case 'tent': B.add(G.prism, 0x8b8a5c, [o.x, h(o.x, o.z), o.z], [0, o.ry, 0], [3.2, 2.2, 4.2], 0.04); break;
    case 'wreck': {
      const pre = M4(o.x, h(o.x, o.z) - 0.15, o.z, 0.9); pre.multiply(new THREE.Matrix4().makeRotationZ(0.08)); addHull(B, 0x3b3431, pre, true);
      const pt = M4(o.x + 2.4, h(o.x, o.z) + 0.2, o.z + 1.6, 2.2).multiply(new THREE.Matrix4().makeRotationX(0.35)); addTurret(B, 0x3b3431, 0, pt, true);
      break;
    }
    case 'barrel': { const y = h(o.x, o.z); const c = [0xa84f32, 0x6b7042, 0x8a3a2a][o.c];
      if (o.tip) B.add(CYL(0.5, 0.5, 8), c, [o.x, y + 0.4, o.z], [0, R() * TAU, Math.PI / 2], [0.8, 1.1, 0.8], 0.04);
      else {
        B.add(CYL(0.5, 0.5, 8), c, [o.x, y + 0.55, o.z], [0, 0, 0], [0.8, 1.1, 0.8], 0.04);
        B.add(CYL(0.5, 0.5, 8), new THREE.Color(c).multiplyScalar(0.7), [o.x, y + 0.3, o.z], [0, 0, 0], [0.84, 0.08, 0.84], 0);
        B.add(CYL(0.5, 0.5, 8), new THREE.Color(c).multiplyScalar(0.7), [o.x, y + 0.8, o.z], [0, 0, 0], [0.84, 0.08, 0.84], 0);
        if (o.c === 0 && R2() < 0.5) { glow(G.ico, 0xff9a3a, [o.x, y + 1.25, o.z], [0, R2() * 3, 0], [0.34, 0.42, 0.34]); glow(G.ico, 0xffe070, [o.x, y + 1.18, o.z], [0, 0, 0], [0.2, 0.26, 0.2]); pool(o.x, o.z, 4.5, 0x3a1e08); }
      } break; }
    case 'crate': B.add(G.box, 0xa87646, [o.x, h(o.x, o.z) + o.y0 + o.s / 2, o.z], [0, o.ry, 0], [o.s, o.s, o.s], 0.06); break;
    case 'pole': { const y = h(o.x, o.z); B.add(CYL(0.5, 0.6, 5), 0x6e5238, [o.x, y + 3, o.z], [0, 0, 0.03], [0.26, 6, 0.26], 0.04); B.add(G.box, 0x5f4630, [o.x, y + 5.6, o.z], [0, o.ry, 0], [1.8, 0.14, 0.14], 0.04); break; }
    case 'crater': { const y = h(o.x, o.z);
      Bs.add(CYL(1, 1.18, 10), 0xd5a66e, [o.x, y + 0.02, o.z], [0, R(), 0], [o.R, 0.3, o.R], 0.05);
      Bs.add(CYL(1, 1, 10), 0x9b7550, [o.x, y + 0.1, o.z], [0, R(), 0], [o.R * 0.7, 0.16, o.R * 0.7], 0.05);
      Bs.add(CYL(1, 1, 8), 0x7d5f44, [o.x, y + 0.12, o.z], [0, R(), 0], [o.R * 0.38, 0.16, o.R * 0.38], 0.05); break; }
    case 'dryTree': {
      const y = h(o.x, o.z); const s = 0.8 + R() * 0.6;
      B.add(CYL(0.7, 1, 5), 0x7a6451, [o.x, y + 1.5 * s, o.z], [0, 0, (R() - 0.5) * 0.2], [0.3 * s, 3 * s, 0.3 * s], 0.05);
      for (let k = 0; k < 3; k++) {
        const rx = (R() - 0.5) * 1.6, rz = (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.5), ry = R() * TAU;
        const ax = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, ry, rz)); const L = (1.2 + R() * 0.8) * s;
        B.add(CYL(0.6, 1, 4), 0x6b5645, [o.x + ax.x * L / 2, y + (2.2 + k * 0.35) * s + ax.y * L / 2, o.z + ax.z * L / 2], [rx, ry, rz], [0.14 * s, L, 0.14 * s], 0.05);
      }
      break;
    }
    case 'dbush': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.blobs[k], [0x9a9a55, 0x8f8f4f, 0xa99f5a][k], [o.x + (R() - 0.5) * 1.1, y + 0.3, o.z + (R() - 0.5) * 1.1], [0, R() * TAU, 0], [0.35 + R() * 0.3, 0.3 + R() * 0.2, 0.35 + R() * 0.3], 0.08); break; }
    case 'tuft': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0xcbb06a : 0xb9a45e, [o.x + (R() - 0.5) * 0.5, y + 0.28, o.z + (R() - 0.5) * 0.5], [(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5], [0.14, 0.6, 0.14], 0.06); break; }
    case 'bridge': {
      const zc = o.z, y = 0.35, bw = o.w || 5.2, L = o.x1 - o.x0;
      for (let x = o.x0; x <= o.x1; x += 0.55) B.add(G.box, R() < 0.5 ? 0x9a6a3e : 0x8a5c34, [x, y, zc], [0, 0, (R() - 0.5) * 0.03], [0.5, 0.18, bw], 0.05);
      for (const s of [-1, 1]) {
        for (let x = o.x0; x <= o.x1 + 0.01; x += 2.5) B.add(G.box, 0x6e4a2c, [x, y + 0.7, zc + s * (bw / 2 - 0.05)], [0, 0, 0], [0.22, 1.2, 0.22], 0.04);
        B.add(G.box, 0x7b5534, [(o.x0 + o.x1) / 2, y + 1.15, zc + s * (bw / 2 - 0.05)], [0, 0, 0], [L, 0.16, 0.16], 0.04);
        for (const px of [o.x0 + L * 0.3, o.x0 + L * 0.7]) B.add(G.box, 0x5b3d25, [px, -1, zc + s * (bw / 2 - 0.4)], [0, 0, 0], [0.4, 2.6, 0.4], 0.04);
      }
      for (const x of [o.x0 - 1, o.x1 + 1]) B.add(G.box, 0x8f918c, [x, 0.1, zc], [0, 0, 0], [1.6, 0.9, bw + 0.8], 0.06);
      for (const x of [o.x0 + 0.4, o.x1 - 0.4]) for (const s of [-1, 1]) { B.add(G.box, 0x6e4a2c, [x, y + 1.3, zc + s * (bw / 2 - 0.05)], [0, 0, 0], [0.34, 2.2, 0.34], 0.04); glow(G.box, 0xffd27a, [x, y + 2.5, zc + s * (bw / 2 - 0.05)], [0, 0, 0], [0.3, 0.3, 0.3]); }
      pool(o.x, zc, 7, 0x2a2010);
      break;
    }
    case 'ford': {                                                   // shallow gravel crossing: stepping stones and ripples
      for (let i = 0; i < 26; i++) { const x = o.x + (R() - 0.5) * o.w, z = o.z + (R() - 0.5) * o.d * 1.3, s = 0.25 + R() * 0.45;
        B.add(G.rocks[i % 6], i % 3 ? 0x9d9f98 : 0x8a8c85, [x, h(x, z) + s * 0.1, z], [0.2, R() * TAU, 0.1], [s * 1.2, s * 0.45, s], 0.08); }
      for (let i = 0; i < 8; i++) { const z = o.z + (R() - 0.5) * o.d * 1.6, x = o.x + (R() - 0.5) * o.w * 0.5; Bs.add(G.box, 0xcfe6ee, [x, -0.42, z], [0, (R() - 0.5) * 0.4, 0], [2 + R() * 2, 0.02, 0.12], 0.02); }
      break;
    }
    case 'campfire': {
      const y = h(o.x, o.z);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; B.add(G.rocks[i % 6], 0x8a8c85, [o.x + Math.cos(a) * 0.75, y + 0.12, o.z + Math.sin(a) * 0.75], [0, a, 0], [0.26, 0.2, 0.26], 0.06); }
      for (let i = 0; i < 3; i++) B.add(CYL(0.5, 0.5, 6), 0x6b4a2f, [o.x, y + 0.2, o.z], [0, i * 1.05, Math.PI / 2 - 0.25], [0.18, 1.1, 0.18], 0.05);
      B.add(CYL(0, 1, 5), 0xff8a2a, [o.x, y + 0.5, o.z], [0, R(), 0], [0.35, 0.6, 0.35], 0);
      glow(G.ico, 0xff8a2a, [o.x, y + 0.55, o.z], [0, 0.4, 0], [0.45, 0.6, 0.45]); glow(G.ico, 0xffe070, [o.x, y + 0.45, o.z], [0, 0, 0], [0.25, 0.35, 0.25]); pool(o.x, o.z, 5.5, 0x3a1e0a);
      for (const s of [-1, 1]) B.add(CYL(0.5, 0.5, 7), 0x7a5234, [o.x + s * 1.9, y + 0.25, o.z + 0.2], [0, 0.2 * s, Math.PI / 2], [0.45, 1.8, 0.45], 0.05);
      break;
    }
    case 'woodpile': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry || 0);
      for (let k = 0; k < 9; k++) B.add(CYL(0.5, 0.5, 6), k % 2 ? 0x7a5234 : 0x8a6040, [-0.6 + (k % 3) * 0.55, 0.3 + Math.floor(k / 3) * 0.48, 0], [Math.PI / 2, 0, 0], [0.46, 1.8, 0.46], 0.04, pre);
      break;
    }
    case 'cabin': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry); const { w, d } = o;
      B.add(G.box, 0x7b5535, [0, 0.2, 0], [0, 0, 0], [w + 1.4, 0.4, d + 1.4], 0.04, pre);
      if (o.c) { B.add(G.box, 0xa8a398, [0, 1.6, 0], [0, 0, 0], [w, 2.6, d], 0.06, pre); for (let k = 0; k < 14; k++) B.add(G.box, R() < 0.5 ? 0x938e84 : 0xb9b4a8, [(R() - 0.5) * w, 0.5 + R() * 2.2, d / 2 + 0.02], [0, 0, 0], [0.5 + R() * 0.4, 0.3, 0.05], 0.05, pre); }
      else { B.add(G.box, 0x9a6a3e, [0, 1.6, 0], [0, 0, 0], [w, 2.6, d], 0.03, pre);
        for (let k = 0; k < 4; k++) B.add(G.box, 0x7d5231, [0, 0.7 + k * 0.62, 0], [0, 0, 0], [w + 0.08, 0.1, d + 0.08], 0.02, pre); }
      B.add(G.box, 0x4a3322, [0, 1.3, d / 2 + 0.03], [0, 0, 0], [1, 2, 0.1], 0.02, pre);
      for (const s of [-1, 1]) { B.add(G.box, 0xf2d88a, [s * 2.2, 1.8, d / 2 + 0.04], [0, 0, 0], [1, 0.8, 0.08], 0.02, pre); glow(G.box, 0xffc868, [s * 2.2, 1.8, d / 2 + 0.07], [0, 0, 0], [0.95, 0.75, 0.05], pre); }
      if (Pl) { const v = new THREE.Vector3(0, 0, d / 2 + 2.2).applyMatrix4(pre); pool(v.x, v.z, 3.8, 0x2e2010); }
      B.add(G.prism, o.c ? 0x5a4a44 : 0xb8573a, [0, 2.9, 0], [0, Math.PI / 2, 0], [d + 1.2, 2.1, w + 1.2], 0.04, pre);
      B.add(G.box, 0x8d8a85, [w / 2 - 1.2, 3.9, -1], [0, 0, 0], [0.8, 2.2, 0.8], 0.06, pre);
      for (let k = 0; k < 7; k++) B.add(CYL(0.5, 0.5, 6), k % 2 ? 0x7a5234 : 0x8a6040, [-w / 2 - 1.1, 0.35 + Math.floor(k / 3) * 0.5, -1 + (k % 3) * 0.55], [Math.PI / 2, 0, 0], [0.45, 1.6, 0.45], 0.04, pre);
      break;
    }
    case 'tower': {
      const y = h(o.x, o.z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(CYL(0.5, 0.6, 5), 0x6e4a2c, [o.x + sx * 1.3, y + 3, o.z + sz * 1.3], [sz * 0.05, 0, -sx * 0.05], [0.3, 6.2, 0.3], 0.04);
      B.add(G.box, 0x8a5c34, [o.x, y + 6.1, o.z], [0, 0, 0], [3.6, 0.25, 3.6], 0.04);
      for (const s of [-1, 1]) { B.add(G.box, 0x7b5534, [o.x, y + 6.7, o.z + s * 1.7], [0, 0, 0], [3.6, 0.9, 0.14], 0.04); B.add(G.box, 0x7b5534, [o.x + s * 1.7, y + 6.7, o.z], [0, 0, 0], [0.14, 0.9, 3.6], 0.04); }
      B.add(CYL(0, 1, 4), 0xa54c34, [o.x, y + 8.3, o.z], [0, Math.PI / 4, 0], [3.2, 1.6, 3.2], 0.04);
      glow(G.box, 0xffd27a, [o.x, y + 6.9, o.z], [0, 0, 0], [0.5, 0.6, 0.5]); pool(o.x, o.z, 6, 0x281e0e);
      break;
    }
    case 'swall': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry);
      for (let i = 0; i < 5; i++) { const hh = 0.8 + R() * 1.2; B.add(G.box, R() < 0.5 ? 0x9a9d97 : 0x8a8d86, [-2 + i, hh / 2, 0], [0, 0, 0], [1.02, hh, 0.8], 0.07, pre); }
      B.add(G.box, 0x6f8f55, [-1, 0.1, 0.9], [0, 0, 0], [2, 0.2, 0.6], 0.1, pre);
      break;
    }
    case 'fence': {
      let prev = null;
      let j = 0;
      for (const [x, z] of o.posts) { const y = h(x, z); const b = CB.at(x, z); if (NB) setTag(o.i + '.' + (j++), { x, z, k: 'fence' });
        b.add(G.box, 0x7a5334, [x, y + 0.6, z], [0, 0, 0], [0.2, 1.2, 0.2], 0.04);
        if (prev) { const mx = (x + prev[0]) / 2, mz = (z + prev[1]) / 2, ll = Math.hypot(x - prev[0], z - prev[1]), ang = Math.atan2(x - prev[0], z - prev[1]);
          for (const hy of [0.45, 0.95]) b.add(G.box, 0x8a6040, [mx, (y + prev[2]) / 2 + hy, mz], [0, ang, 0], [0.1, 0.12, ll], 0.04); }
        prev = [x, z, y]; }
      setTag(null);
      break;
    }
    case 'log': B.add(CYL(0.5, 0.5, 7), 0x7a5234, [o.x, h(o.x, o.z) + 0.36, o.z], [0, o.ry, Math.PI / 2], [0.72, o.L, 0.72], 0.05); break;
    case 'stump': { const y = h(o.x, o.z); B.add(CYL(0.9, 1, 7), 0x7a5536, [o.x, y + 0.3, o.z], [0, o.ry, 0], [0.9, 0.6, 0.9], 0.05); B.add(CYL(1, 1, 7), 0xc49a6a, [o.x, y + 0.61, o.z], [0, 0, 0], [0.75, 0.04, 0.75], 0.03); break; }
    case 'pine': {
      const y = h(o.x, o.z), s = o.s; const c = [0x2f6d3c, 0x357a41, 0x2b6236, 0x3f8446][o.c];
      B.add(CYL(0.8, 1, 5), 0x6b4a2f, [o.x, y + 0.9 * s, o.z], [0, o.ry, 0], [0.36 * s, 1.8 * s, 0.36 * s], 0.05);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 2.9 * s, o.z], [0, o.ry, 0], [3.5 * s, 3.2 * s, 3.5 * s], 0.06);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 4.5 * s, o.z], [0, o.ry + 0.3, 0], [2.7 * s, 2.8 * s, 2.7 * s], 0.06);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 5.9 * s, o.z], [0, o.ry + 0.6, 0], [1.7 * s, 2.4 * s, 1.7 * s], 0.06);
      break;
    }
    case 'ctree':
    case 'leafy': {
      const y = h(o.x, o.z), s = o.s;
      if (o.k === 'ctree') Bs.add(G.box, 0x8a7a62, [o.x, y + 0.04, o.z], [0, 0, 0], [1.4, 0.08, 1.4], 0.03);
      const c = o.autumn ? [0xd8923a, 0xc9702e, 0xe0b041][o.autumn - 1] : [0x6aa84f, 0x7db552, 0x5e9a45, 0x88bb4f][o.c];
      B.add(CYL(0.75, 1, 5), 0x6b4a2f, [o.x, y + 1.2 * s, o.z], [0, 0, 0], [0.4 * s, 2.4 * s, 0.4 * s], 0.05);
      B.add(G.blobs[Math.floor(R() * 3)], c, [o.x, y + 3.3 * s, o.z], [0, R() * TAU, 0], [2.2 * s, 1.9 * s, 2.2 * s], 0.07);
      B.add(G.blobs[Math.floor(R() * 3)], c, [o.x + 0.9 * s, y + 4 * s, o.z + 0.3 * s], [0, R() * TAU, 0], [1.4 * s, 1.3 * s, 1.4 * s], 0.07);
      break;
    }
    case 'fbush': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.blobs[k], [0x4f8f3e, 0x5c9d45, 0x467f37][k], [o.x + (R() - 0.5) * 1.4, y + 0.45, o.z + (R() - 0.5) * 1.4], [0, R() * TAU, 0], [0.55 + R() * 0.35, 0.45 + R() * 0.25, 0.55 + R() * 0.35], 0.08); break; }
    case 'reeds': { for (let j = 0; j < 4; j++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0x9fb35a : 0x7d9a48, [o.x + (R() - 0.5) * 0.6, h(o.x, o.z) + 0.5, o.z + (R() - 0.5) * 0.6], [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3], [0.12, 1.1 + R() * 0.5, 0.12], 0.06); break; }
    case 'flower': Bs.add(G.box, [0xf5f0e0, 0xf2d24a, 0xe98fb3][o.c], [o.x, h(o.x, o.z) + 0.22, o.z], [0, o.ry, 0], [0.18, 0.18, 0.18], 0.04); break;
    case 'flag': addFlag(B, o.x, o.y0 != null ? o.y0 : h(o.x, o.z), o.z, o.h, o.s, o.ry || 0); break;
    case 'citadel': {
      const { R: RB, T, H } = o; const cx = o.x, cz = o.z;
      const sand = [0xc79c63, 0xd4ab72, 0xb88c56, 0xcfa56c];
      // outer ring of house-facades forming the wall, sitting on the top edge of the mound
      const N = 46;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU, gate = Math.abs(((a - Math.PI / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI) < 0.12;
        if (gate) continue;
        const r = T + 0.2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, hh = 2.6 + R() * 2.2;
        const pre = M4(x, H - 1.2, z, -a + Math.PI / 2);
        B.add(G.box, sand[i % 4], [0, hh / 2, 0], [0, 0, 0], [2.25, hh, 1.8], 0.05, pre);
        if (R() < 0.7) { const wx = (R() - 0.5) * 0.8; B.add(G.box, 0x5a4330, [wx, hh * 0.62, 0.92], [0, 0, 0], [0.45, 0.6, 0.05], 0, pre); if (R2() < 0.55) glow(G.box, WARM[i % 4], [wx, hh * 0.62, 0.95], [0, 0, 0], [0.4, 0.55, 0.05], pre); }
        if (R() < 0.35) B.add(G.box, 0x5a4330, [(R() - 0.5) * 0.8, hh * 0.3, 0.92], [0, 0, 0], [0.4, 0.5, 0.05], 0, pre);
      }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2, x = cx + Math.cos(a) * (T + 0.3), z = cz + Math.sin(a) * (T + 0.3);
        B.add(CYL(0.9, 1, 10), 0xc19358, [x, H + 1.6, z], [0, 0, 0], [1.7, 6, 1.7], 0.05); }
      // main gate (south) + ramp
      const gz = cz + T + 0.4;
      B.add(G.box, 0xcaa06a, [cx - 2.2, H + 2.2, gz], [0, 0, 0], [1.6, 6.4, 2.2], 0.04);
      B.add(G.box, 0xcaa06a, [cx + 2.2, H + 2.2, gz], [0, 0, 0], [1.6, 6.4, 2.2], 0.04);
      B.add(G.box, 0xcaa06a, [cx, H + 4.6, gz], [0, 0, 0], [5.9, 1.6, 2.2], 0.04);
      B.add(G.box, 0x3d2c1e, [cx, H + 1.5, gz + 0.2], [0, 0, 0], [2.8, 3.4, 2]);
      const L = RB - T + 0.4, ang = Math.atan2(H, L);            // ends at the foot of the mound, before the ring road
      B.add(G.box, 0xbfa27a, [cx, H / 2 - 0.1, cz + T + L / 2], [ang, 0, 0], [4.6, 0.5, Math.hypot(L, H)], 0.03);
      // houses packed on top (skip the central plaza)
      for (let gx = -T + 2; gx <= T - 2; gx += 3.1) for (let gzz = -T + 2; gzz <= T - 2; gzz += 3.1) {
        const d = Math.hypot(gx, gzz); if (d > T - 2.2 || d < 4.5 || R() < 0.12) continue;
        const hh = 1.4 + R() * 1.8, w = 2.2 + R() * 0.8, dd = 2.2 + R() * 0.8;
        B.add(G.box, sand[Math.floor(R() * 4)], [cx + gx, H + hh / 2, cz + gzz], [0, (R() - 0.5) * 0.2, 0], [w, hh, dd], 0.06);
      }
      // mosque with dome + minaret
      B.add(G.box, 0xd9c29a, [cx + 6, H + 1.6, cz - 5], [0, 0, 0], [4.5, 3.2, 4.5], 0.03);
      B.add(G.sph, 0x7fa8a0, [cx + 6, H + 3.2, cz - 5], [0, 0, 0], [1.9, 1.5, 1.9], 0.03);
      B.add(CYL(0.8, 1, 8), 0xe2d2b0, [cx + 8.8, H + 4.5, cz - 7.5], [0, 0, 0], [0.7, 9, 0.7], 0.03);
      B.add(CYL(0, 1, 8), 0x7fa8a0, [cx + 8.8, H + 9.5, cz - 7.5], [0, 0, 0], [0.8, 1.2, 0.8], 0.03);
      break;
    }
    case 'park': {
      // low hedges along the park edge, gaps for paths
      for (let z = o.z0; z < o.z1; z += 2.2) for (const x of [o.x0, o.x1]) { if (Math.abs(z - 11) < 2.5) continue; B.add(G.box, 0x4f8f3e, [x, 0.45, z + 1.1], [0, 0, 0], [0.8, 0.9, 2.1], 0.08); }
      for (let x = o.x0; x < o.x1; x += 2.2) { if (Math.abs(x + 1.1) < 5) continue; B.add(G.box, 0x4f8f3e, [x + 1.1, 0.45, o.z1], [0, 0, 0], [2.1, 0.9, 0.8], 0.08); }
      for (const [bx, bz] of [[-3.2, 3], [3.2, 3], [-3.2, 9], [3.2, 9], [-10, 14], [10, 14]]) B.add(G.box, 0x7b5a3a, [bx, 0.35, bz], [0, 0, 0], [0.5, 0.35, 1.6], 0.05);
      break;
    }
    case 'pool':
      B.add(G.box, 0xd9cdb5, [o.x, 0.25, o.z], [0, 0, 0], [o.w + 0.8, 0.5, o.d + 0.8], 0.03);
      Bs.add(G.box, 0x3fb0cf, [o.x, 0.5, o.z], [0, 0, 0], [o.w, 0.04, o.d], 0.04);
      break;
    case 'fountain':
      B.add(CYL(1, 1, 18), 0xd9cdb5, [o.x, 0.3, o.z], [0, 0, 0], [o.r + 0.35, 0.6, o.r + 0.35], 0.03);
      Bs.add(CYL(1, 1, 18), 0x2fc4c9, [o.x, 0.62, o.z], [0, 0, 0], [o.r, 0.04, o.r], 0.03);
      B.add(CYL(1, 1, 10), 0xcfc3aa, [o.x, 0.9, o.z], [0, 0, 0], [1.1, 0.8, 1.1], 0.03);
      B.add(CYL(1, 1, 10), 0xcfc3aa, [o.x, 1.6, o.z], [0, 0, 0], [0.5, 1.2, 0.5], 0.03);
      B.add(CYL(0.3, 1, 8), 0xe6f7ff, [o.x, 2.9, o.z], [0, 0, 0], [0.25, 1.6, 0.25], 0);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.add(CYL(0.4, 1, 5), 0xe6f7ff, [o.x + Math.cos(a) * 2.3, 1.0, o.z + Math.sin(a) * 2.3], [0, 0, 0], [0.12, 0.8, 0.12], 0); }
      break;
    case 'lamp': B.add(CYL(0.6, 1, 5), 0x3a3d40, [o.x, 2, o.z], [0, 0, 0], [0.14, 4, 0.14], 0.02); B.add(G.box, 0xfff1c0, [o.x, 4.1, o.z], [0, 0, 0], [0.45, 0.35, 0.45], 0);
      B.add(G.box, 0x2e3134, [o.x, 4.34, o.z], [0, 0, 0], [0.62, 0.1, 0.62], 0);
      glow(G.box, 0xfff4cc, [o.x, 4.1, o.z], [0, 0, 0], [0.5, 0.38, 0.5]); pool(o.x, o.z, 4.6, 0x302612); break;
    case 'bench': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry || 0);
      B.add(G.box, 0x8a5c34, [0, 0.45, 0], [0, 0, 0], [1.7, 0.08, 0.5], 0.05, pre);
      B.add(G.box, 0x8a5c34, [0, 0.75, -0.24], [0, 0, 0], [1.7, 0.4, 0.07], 0.05, pre);
      for (const x of [-0.7, 0.7]) B.add(G.box, 0x2e3134, [x, 0.22, 0], [0, 0, 0], [0.08, 0.44, 0.45], 0.02, pre);
      break;
    }
    case 'sflag': addFlag(B, o.x, h(o.x, o.z), o.z, o.h || 7, o.s || 1, 0); break;
    case 'arch': {                                                   // an upper floor bridging the alley: the passage runs under a house
      const body = [0xe8dcc3, 0xd9c6a0, 0xcfb58a, 0xf0e8d8, 0xc9a77c, 0xb9b3a8][o.c || 0], y0 = 3.8, H = Math.max(o.h, y0 + 2.4);
      B.add(G.box, body, [o.x, (y0 + H) / 2, o.z], [0, 0, 0], [o.w, H - y0, o.d], 0.04);
      B.add(G.box, new THREE.Color(body).multiplyScalar(0.6), [o.x, y0 + 0.1, o.z], [0, 0, 0], [o.w - 0.2, 0.2, o.d - 0.2], 0);
      const face = o.w > o.d ? [0, o.d / 2 + 0.02] : [o.w / 2 + 0.02, 0];
      for (let f = y0 + 1; f < H - 0.6; f += 1.6) for (const k of [-1, 1]) {
        B.add(G.box, 0x4a5560, [o.x + face[0] * k, f, o.z + face[1] * k], [0, 0, 0], face[0] ? [0.05, 0.85, 0.7] : [0.7, 0.85, 0.05], 0);
        if (R2() < 0.5) glow(G.box, WARM[Math.floor(R2() * 4)], [o.x + face[0] * k * 1.01, f, o.z + face[1] * k * 1.01], [0, 0, 0], face[0] ? [0.05, 0.78, 0.62] : [0.62, 0.78, 0.05]);
      }
      glow(G.box, 0xffd9a0, [o.x, y0 - 0.1, o.z], [0, 0, 0], [0.3, 0.12, 0.3]); pool(o.x, o.z, 3.2, 0x2a1e0e);
      break;
    }
    case 'alley': {                                                  // washing lines across the alley, up high
      const along = o.d > o.w, L = along ? o.d : o.w;
      for (let u = -L / 2 + 4; u < L / 2 - 3; u += 7 + R() * 4) {
        if (R() < 0.35) continue;
        const cx = along ? o.x : o.x + u, cz = along ? o.z + u : o.z, span = (along ? o.w : o.d) + 0.4, y = 4.2 + R() * 1.2;
        B.add(G.box, 0x333333, [cx, y, cz], [0, 0, 0], along ? [span, 0.03, 0.03] : [0.03, 0.03, span], 0);
        for (let k = 0; k < 3; k++) { const off = (R() - 0.5) * (span - 1.2), c = [0xf2f2f2, 0xd14b3c, 0x2f6fb5, 0xf2d24a, 0x4f8a4f][Math.floor(R() * 5)];
          B.add(G.box, c, [cx + (along ? off : 0), y - 0.45, cz + (along ? 0 : off)], [0, 0, 0], along ? [0.7, 0.8, 0.04] : [0.04, 0.8, 0.7], 0.03); }
      }
      break;
    }
    case 'plaza': {
      const y = h(o.x, o.z);
      for (const [dx, dz, w, d] of [[0, -o.d / 2 + 0.2, o.w, 0.4], [-o.w / 2 + 0.2, 0, 0.4, o.d], [o.w / 2 - 0.2, 0, 0.4, o.d]]) B.add(G.box, 0xd6c6a2, [o.x + dx, y + 0.25, o.z + dz], [0, 0, 0], [w, 0.5, d], 0.04);
      for (let i = 0; i < 4; i++) { const a = R() * TAU; B.add(G.blobs[i % 3], 0x5c9d45, [o.x + Math.cos(a) * o.w * 0.35, y + 0.4, o.z + Math.sin(a) * o.d * 0.3], [0, R(), 0], [0.6, 0.5, 0.6], 0.08); }
      break;
    }
    /* ---------------- the stadium ---------------- */
    case 'pitch': {
      const { hx, hz, cut } = o, P = M.pitch, L = 0xf4f4ec, y = 0.03, ln = (x, z, w, d) => Bs.add(G.box, L, [x, y, z], [0, 0, 0], [w, 0.02, d], 0);
      ln(0, -hz, hx * 2 - cut * 2 + 1, 0.25); ln(0, hz, hx * 2 - cut * 2 + 1, 0.25); ln(-hx, 0, 0.25, hz * 2 - cut * 2 + 1); ln(hx, 0, 0.25, hz * 2 - cut * 2 + 1); ln(0, 0, 0.25, hz * 2);
      for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; Bs.add(G.box, L, [Math.cos(a) * 9, y, Math.sin(a) * 9], [0, -a, 0], [0.25, 0.02, 1.5], 0); }
      Bs.add(CYL(1, 1, 12), L, [0, y, 0], [0, 0, 0], [0.5, 0.02, 0.5], 0);
      for (const s of [-1, 1]) {
        ln(s * (hx - 8), 0, 0.25, 32); ln(s * (hx - 4), -16 * 0 - 16, 8, 0.25); ln(s * (hx - 4), 16, 8, 0.25);
        ln(s * (hx - 3), 0, 0.25, 20); ln(s * (hx - 1.5), -10, 3, 0.25); ln(s * (hx - 1.5), 10, 3, 0.25);
        Bs.add(CYL(1, 1, 10), L, [s * (hx - 5.5), y, 0], [0, 0, 0], [0.4, 0.02, 0.4], 0);
      }
      // the stadium wall (what the ball bounces off)
      const wall = (ax, az, bx, bz) => { const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
        B.add(G.box, 0xd9d4c8, [mx, 0.7, mz], [0, a, 0], [0.8, 1.4, len + 0.6], 0.03); B.add(G.box, 0x2f6fb5, [mx, 1.42, mz], [0, a, 0], [0.9, 0.12, len + 0.6], 0.02); };
      wall(-hx + cut, -hz - 0.7, hx - cut, -hz - 0.7); wall(-hx + cut, hz + 0.7, hx - cut, hz + 0.7);
      for (const s of [-1, 1]) { wall(s * (hx + 0.7), -hz + cut, s * (hx + 0.7), -P.gw - 0.7); wall(s * (hx + 0.7), P.gw + 0.7, s * (hx + 0.7), hz - cut);
        wall(s * (hx - cut), -hz - 0.7, s * (hx + 0.7), -hz + cut); wall(s * (hx - cut), hz + 0.7, s * (hx + 0.7), hz - cut); }
      break;
    }
    case 'goal': {
      const s = o.s, gx = s * M.pitch.hx, back = s * (M.pitch.hx + M.pitch.gd), gw = o.w / 2, GH = 6, P = 0xf7f7f2, N = 0xdfe3e6;
      // posts + crossbar, and the net as a see-through grid of cords (so you can see the ball go in)
      const dep = Math.abs(back - gx), mid = (gx + back) / 2;
      for (const z of [-gw, gw]) { B.add(CYL(0.5, 0.5, 8), P, [gx, GH / 2, z], [0, 0, 0], [0.4, GH, 0.4], 0); B.add(CYL(0.5, 0.5, 6), N, [back, GH / 2, z], [0, 0, 0], [0.18, GH, 0.18], 0);
        for (let yy = 1.2; yy < GH; yy += 1.2) B.add(G.box, N, [mid, yy, z], [0, 0, 0], [dep, 0.05, 0.05], 0); B.add(G.box, N, [mid, GH, z], [0, 0, 0], [dep, 0.08, 0.08], 0); }
      B.add(CYL(0.5, 0.5, 8), P, [gx, GH, 0], [Math.PI / 2, 0, 0], [0.4, o.w + 0.4, 0.4], 0);
      B.add(CYL(0.5, 0.5, 6), N, [back, GH, 0], [Math.PI / 2, 0, 0], [0.18, o.w, 0.18], 0);
      for (let z = -gw + 1.2; z < gw; z += 1.2) { B.add(G.box, N, [mid, GH, z], [0, 0, 0], [dep, 0.05, 0.05], 0); B.add(G.box, N, [back, GH / 2, z], [0, 0, 0], [0.05, GH, 0.05], 0); }
      for (let yy = 1.2; yy < GH; yy += 1.2) B.add(G.box, N, [back, yy, 0], [0, 0, 0], [0.05, 0.05, o.w], 0);
      Bs.add(G.box, s < 0 ? 0x62a2ff : 0xff6250, [(gx + back) / 2, 0.035, 0], [0, 0, 0], [Math.abs(back - gx) - 0.4, 0.02, o.w - 0.4], 0);
      break;
    }
    case 'stand': {                                                  // stepped concrete stand full of fans
      const pre = M4(o.x, 0, o.z, o.ry), rows = o.rows || 7, L = o.len, fan = [0xed2024, 0xf7f7f2, 0x278e43, 0xfebd11, 0x2f6fb5, 0xd14b3c, 0x3a3d40, 0xe8dcc3];
      for (let r = 0; r < rows; r++) {
        B.add(G.box, r % 2 ? 0xb9b4a8 : 0xc9c4b8, [0, 0.9 + r * 0.9, 2 + r * 1.5], [0, 0, 0], [L, 1.8 + r * 1.8, 1.5], 0.02, pre);
        for (let u = -L / 2 + 0.8; u < L / 2 - 0.5; u += 1.25) if (R() < 0.82) B.add(G.box, fan[Math.floor(R() * fan.length)], [u + (R() - 0.5) * 0.3, 2.1 + r * 1.8 * 0.5 + r * 0.45, 2 + r * 1.5], [0, 0, 0], [0.55, 0.75, 0.45], 0.1, pre);
      }
      B.add(G.box, 0xa9a59c, [0, (rows * 0.9) + 2.6, 2 + rows * 1.5 + 0.4], [0, 0, 0], [L, 1.6, 0.6], 0.02, pre);
      if (o.roof) B.add(G.box, 0xe8e6e0, [0, rows * 1.8 + 3.2, 2 + rows * 0.8], [0.12, 0, 0], [L + 1, 0.25, rows * 1.5 + 2], 0.02, pre);   // roof
      for (let u = -L / 2 + 6; u < L / 2; u += 16) { const v = new THREE.Vector3(u, rows * 1.8 + 3.3, 2 + rows * 1.5 + 0.8).applyMatrix4(pre); addFlag(B, v.x, v.y, v.z, 3.2, 0.9, 0); }
      break;
    }
    case 'floodlight': {
      const y = 0; B.add(CYL(0.7, 1, 6), 0x9a9d9f, [o.x, 11, o.z], [0, 0, 0], [0.6, 22, 0.6], 0.02);
      const ry = Math.atan2(-o.x, -o.z), pre = M4(o.x, y, o.z, ry);
      B.add(G.box, 0x3a3d40, [0, 22.5, 0.4], [-0.5, 0, 0], [4, 2.4, 0.4], 0.02, pre);
      for (let i = 0; i < 6; i++) { B.add(G.box, 0xfff6d8, [-1.4 + (i % 3) * 1.4, 22 + Math.floor(i / 3) * 1.1, 0.62], [-0.5, 0, 0], [1, 0.8, 0.06], 0, pre); glow(G.box, 0xfffbe8, [-1.4 + (i % 3) * 1.4, 22 + Math.floor(i / 3) * 1.1, 0.66], [-0.5, 0, 0], [1, 0.8, 0.06], pre); }
      break;
    }
    case 'adboard': {
      const c = [0xd14b3c, 0x2f6fb5, 0x278e43, 0xfebd11, 0x3a3d40][o.c];
      B.add(G.box, c, [o.x, 0.55, o.z], [0, 0, 0], [6.4, 1.1, 0.25], 0.02);
      for (let i = 0; i < 2; i++) B.add(G.box, 0xf7f7f2, [o.x - 1 + i * 1.6, 0.6, o.z + Math.sign(o.z) * -0.14], [0, 0, 0], [1.2 - i * 0.4, 0.22, 0.02], 0);
      break;
    }
    case 'umbrella': {
      const c = [0x2f6fb5, 0xf2f2f2, 0xd14b3c][o.c];
      B.add(CYL(0.5, 0.5, 4), 0x5a5a5a, [o.x, 1.15, o.z], [0, 0, 0], [0.08, 2.3, 0.08], 0);
      B.add(CYL(0, 1, 8), c, [o.x, 2.45, o.z], [0, R() * TAU, 0], [1.5, 0.6, 1.5], 0.04);
      B.add(G.box, 0x9c7a55, [o.x + 0.4, 0.45, o.z], [0, 0, 0], [0.9, 0.9, 0.9], 0.08);
      break;
    }
    case 'arcade': {
      const pre = M4(o.x, 0, o.z, o.ry); const L = o.len, H = o.H, D = 7;
      B.add(G.box, 0xd6aa6c, [0, H / 2, 0], [0, 0, 0], [L, H, D], 0.03, pre);
      B.add(G.box, 0xc4965a, [0, H + 0.2, 0], [0, 0, 0], [L + 0.4, 0.4, D + 0.4], 0.03, pre);
      for (let u = -L / 2 + 0.6; u < L / 2; u += 1.6) B.add(G.box, 0xc99d62, [u, H + 0.7, D / 2], [0, 0, 0], [0.7, 0.6, 0.4], 0.03, pre);
      for (let u = -L / 2 + 3.6; u < L / 2 - 0.8; u += 2.4) {
        B.add(G.box, 0x5c4028, [u, 1.2, D / 2 + 0.01], [0, 0, 0], [1.5, 2.4, 0.2], 0, pre);
        B.add(CYL(1, 1, 8), 0x5c4028, [u, 2.4, D / 2 + 0.01], [Math.PI / 2, 0, 0], [0.75, 0.2, 0.75], 0, pre);
        B.add(G.box, 0x6b4c30, [u, 4.1, D / 2 + 0.01], [0, 0, 0], [0.8, 1.0, 0.1], 0, pre);
        if (R2() < 0.6) glow(G.box, WARM[Math.floor(R2() * 4)], [u, 1.2, D / 2 + 0.05], [0, 0, 0], [1.35, 2.2, 0.05], pre);
      }
      if (o.tower) {
        const tx = -L / 2 + 1.8, TH = 15;
        B.add(G.box, 0xcf9f60, [tx, TH / 2, 0], [0, 0, 0], [3.6, TH, 3.6], 0.03, pre);
        B.add(G.box, 0xdcb378, [tx, TH - 1.5, 0], [0, 0, 0], [4.0, 3, 4.0], 0.03, pre);
        for (const [fx, fz, rx, rz] of [[0, 2.02, Math.PI / 2, 0], [2.02, 0, 0, Math.PI / 2], [-2.02, 0, 0, Math.PI / 2], [0, -2.02, Math.PI / 2, 0]]) {
          B.add(CYL(1, 1, 16), 0xf4efe2, [tx + fx, TH - 1.5, fz], [rx, 0, rz], [1.1, 0.1, 1.1], 0, pre);
          B.add(G.box, 0x2a2a2a, [tx + fx * 1.03, TH - 1.2, fz * 1.03], [0, fx ? Math.PI / 2 : 0, 0], [0.08, 0.7, 0.05], 0, pre);
        }
        B.add(CYL(0, 1, 4), 0xa9784a, [tx, TH + 0.9, 0], [0, Math.PI / 4, 0], [2.6, 1.8, 2.6], 0.03, pre);
      }
      break;
    }
    case 'building': {
      const body = [0xe8dcc3, 0xd9c6a0, 0xcfb58a, 0xf0e8d8, 0xc9a77c, 0xb9b3a8][o.c]; const { w, d } = o, H = o.h, y = h(o.x, o.z);
      const pre = M4(o.x, y, o.z, 0);
      B.add(G.box, body, [0, H / 2, 0], [0, 0, 0], [w, H, d], 0.04, pre);
      const par = new THREE.Color(body).multiplyScalar(0.88);
      B.add(G.box, par, [0, H + 0.18, d / 2 - 0.12], [0, 0, 0], [w, 0.36, 0.24], 0, pre);
      B.add(G.box, par, [0, H + 0.18, -d / 2 + 0.12], [0, 0, 0], [w, 0.36, 0.24], 0, pre);
      B.add(G.box, par, [w / 2 - 0.12, H + 0.18, 0], [0, 0, 0], [0.24, 0.36, d], 0, pre);
      B.add(G.box, par, [-w / 2 + 0.12, H + 0.18, 0], [0, 0, 0], [0.24, 0.36, d], 0, pre);
      // windows on the three faces the camera can see
      const floors = Math.max(1, Math.floor(H / 1.6));
      for (let f = 0; f < floors; f++) {
        const wy = 1.0 + f * 1.6; if (wy > H - 0.5) break;
        const n = Math.max(1, Math.floor(w / 1.9));
        for (let i = 0; i < n; i++) { const wx = -w / 2 + (w / n) * (i + 0.5); if (f === 0 && i === Math.floor(n / 2)) continue; B.add(G.box, 0x4a5560, [wx, wy, d / 2 + 0.02], [0, 0, 0], [0.7, 0.85, 0.05], 0, pre);
          if (R2() < 0.5) glow(G.box, WARM[Math.floor(R2() * 4)], [wx, wy, d / 2 + 0.04], [0, 0, 0], [0.62, 0.78, 0.05], pre); }
        const m = Math.max(1, Math.floor(d / 2.2));
        for (let i = 0; i < m; i++) { const wz = -d / 2 + (d / m) * (i + 0.5); for (const sx of [-1, 1]) { B.add(G.box, 0x4a5560, [sx * (w / 2 + 0.02), wy, wz], [0, 0, 0], [0.05, 0.85, 0.7], 0, pre);
          if (R2() < 0.45) glow(G.box, WARM[Math.floor(R2() * 4)], [sx * (w / 2 + 0.04), wy, wz], [0, 0, 0], [0.05, 0.78, 0.62], pre); } }
      }
      // shop front + awning
      B.add(G.box, 0x3d3a36, [0, 0.9, d / 2 + 0.02], [0, 0, 0], [1.4, 1.8, 0.05], 0, pre);
      if (R2() < 0.4) { glow(G.box, 0xffe6a8, [0, 0.9, d / 2 + 0.05], [0, 0, 0], [1.3, 1.7, 0.05], pre); pool(o.x, o.z + d / 2 + 1.4, 2.2, 0x2a1e0e); }
      B.add(G.box, [0xb5473a, 0x2f6fb5, 0x4f8a4f, 0xd9a13a][Math.floor(R() * 4)], [0, 2.05, d / 2 + 0.45], [0.35, 0, 0], [Math.min(w - 0.6, 3.6), 0.08, 0.95], 0, pre);
      // rooftop clutter
      for (let k = 0; k < 1 + Math.floor(R() * 2); k++) B.add(CYL(1, 1, 8), R() < 0.5 ? 0xf1f1f1 : 0x2e3136, [(R() - 0.5) * (w - 2), H + 0.55, (R() - 0.5) * (d - 2)], [0, 0, 0], [0.5, 0.9, 0.5], 0.03, pre);
      if (R() < 0.6) B.add(G.box, 0xb7bcc0, [(R() - 0.5) * (w - 2), H + 0.3, (R() - 0.5) * (d - 2)], [0, 0, 0], [0.9, 0.6, 0.7], 0.03, pre);
      if (o.flag) addFlag(B, o.x + w / 2 - 0.7, y + H, o.z + d / 2 - 0.7, 3.2, 0.8, 0);
      break;
    }
    case 'skyscraper': {
      const c = [0x8fa6b8, 0x6f8799, 0xa9b8c4, 0x7d95a6][o.c]; const y = 0;
      B.add(G.box, c, [o.x, y + o.h / 2, o.z], [0, 0, 0], [o.w, o.h, o.d], 0.03);
      const band = new THREE.Color(c).lerp(WHITE, 0.35);
      for (let hy = 4; hy < o.h - 2; hy += 4) B.add(G.box, band, [o.x, y + hy, o.z], [0, 0, 0], [o.w + 0.15, 0.3, o.d + 0.15], 0);
      for (let hy = 2; hy < o.h - 1; hy += 2) for (const [fx, fz, sw, sd] of [[0, o.d / 2 + 0.05, o.w * 0.18, 0.05], [0, -o.d / 2 - 0.05, o.w * 0.18, 0.05], [o.w / 2 + 0.05, 0, 0.05, o.d * 0.18], [-o.w / 2 - 0.05, 0, 0.05, o.d * 0.18]])
        for (let k = -2; k <= 2; k++) if (R2() < 0.35) glow(G.box, R2() < 0.3 ? 0xcfe6ff : WARM[Math.floor(R2() * 4)], [o.x + fx + (sd > 0.1 ? 0 : k * o.w * 0.19), y + hy, o.z + fz + (sd > 0.1 ? k * o.d * 0.19 : 0)], [0, 0, 0], [sw, 0.9, sd], null);
      glow(G.sph, 0xff4030, [o.x, y + o.h + 6.8, o.z], [0, 0, 0], [0.3, 0.3, 0.3]);
      B.add(G.box, c, [o.x, y + o.h + 1.2, o.z], [0, 0, 0], [o.w * 0.6, 2.4, o.d * 0.6], 0.03);
      B.add(CYL(0.5, 0.5, 4), 0xdddddd, [o.x, y + o.h + 4.5, o.z], [0, 0, 0], [0.15, 4.5, 0.15], 0);
      break;
    }
    case 'car': {
      const c = [0xeeeeee, 0xb9bcc0, 0x2a2c30, 0xe07a2a, 0x3b5f8c, 0x9c2f2a][o.c]; const pre = M4(o.x, h(o.x, o.z), o.z, o.ry);
      B.add(G.box, c, [0, 0.62, 0], [0, 0, 0], [1.9, 0.72, 4.2], 0.03, pre);
      B.add(G.box, 0x2f3a44, [0, 1.25, -0.2], [0, 0, 0], [1.7, 0.6, 2.2], 0.02, pre);
      B.add(G.box, c, [0, 1.58, -0.2], [0, 0, 0], [1.62, 0.08, 1.8], 0.02, pre);
      for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) B.add(CYL(0.5, 0.5, 8), 0x1d1d1d, [wx, 0.38, wz], [0, 0, Math.PI / 2], [0.76, 0.3, 0.76], 0, pre);
      B.add(G.box, 0xfff3c4, [0, 0.72, 2.11], [0, 0, 0], [1.5, 0.15, 0.04], 0, pre);
      break;
    }
    case 'road': {
      // Asphalt ribbon: one flat box per segment, raised curbs, dashed centre line.
      const w = o.w, pts = o.pts, others = M.roads.filter(r => r !== pts);
      const nearOther = (x, z, d) => others.some(r => polyDist(x, z, r) < d);
      let dashAcc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
        const ang = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const BB = CBflat.at(mx, mz), pre = M4(mx, 0, mz, ang);
        BB.add(G.box, 0x4d5054, [0, 0.06, 0], [0, 0, 0], [w, 0.12, L + (o.ring ? 0.35 : 0.05)], 0.035, pre);
        // curbs in short pieces, left out wherever another road joins (so no curb runs across a junction)
        const nP = Math.max(1, Math.ceil(L / 2)), pl = L / nP;
        for (const sd of [-1, 1]) for (let k = 0; k < nP; k++) {
          const u = -L / 2 + pl * (k + 0.5), px = mx + Math.sin(ang) * u + Math.cos(ang) * sd * (w / 2 + 0.16), pz = mz + Math.cos(ang) * u - Math.sin(ang) * sd * (w / 2 + 0.16);
          if (!nearOther(px, pz, w / 2 + 0.6)) CBflat.at(px, pz).add(G.box, 0xbdb6a6, [sd * (w / 2 + 0.16), 0.1, u], [0, 0, 0], [0.32, 0.2, pl + (o.ring ? 0.35 : 0.02)], 0.03, pre);
        }
        // centre dashes (skipped inside junctions)
        for (let u = -dashAcc; u < L; u += 4.5) {
          if (u < 0) continue;
          const t = (u + 1) / L; const px = ax + (bx - ax) * Math.min(1, t), pz = az + (bz - az) * Math.min(1, t);
          if (nearOther(px, pz, w / 2 + 1.5)) continue;
          BB.add(G.box, 0xf1efe6, [0, 0.125, -L / 2 + u + 1], [0, 0, 0], [0.16, 0.02, 2], 0, pre);
        }
        dashAcc = (dashAcc + L) % 4.5;
      }
      break;
    }
    case 'zebra': {
      const pre = M4(o.x, 0, o.z, o.ang);
      for (let i = -3; i <= 3; i++) Bs.add(G.box, 0xf4f2ea, [i * 1.0, 0.13, 0], [0, 0, 0], [0.55, 0.02, 3.2], 0, pre);
      break;
    }
    case 'palm': {                                                   // date palm: bent segmented trunk + drooping fronds
      const y = h(o.x, o.z), s = o.s, lean = (R() - 0.5) * 0.25, la = R() * TAU;
      let px = o.x, pz = o.z, py = y;
      for (let i = 0; i < 6; i++) {
        const seg = 0.95 * s, k = i / 6, bend = lean * k * 2;
        const dx = Math.cos(la) * bend * seg, dz = Math.sin(la) * bend * seg;
        B.add(CYL(0.85, 1, 6), i % 2 ? 0x8a6a45 : 0x7b5c3b, [px + dx / 2, py + seg / 2, pz + dz / 2], [Math.sin(la) * bend, 0, -Math.cos(la) * bend], [0.36 * s * (1 - k * 0.3), seg, 0.36 * s * (1 - k * 0.3)], 0.05);
        px += dx; pz += dz; py += seg * 0.97;
      }
      const cols = [0x4f8a36, 0x5f9a3e, 0x44792f];
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + R() * 0.3, L = (2.2 + R() * 0.6) * s;
        B.add(G.box, cols[i % 3], [px + Math.cos(a) * L * 0.42, py - 0.25 * s, pz + Math.sin(a) * L * 0.42], [0, -a, 0.45 + R() * 0.2], [L, 0.08 * s, 0.55 * s], 0.08);
        B.add(G.box, cols[(i + 1) % 3], [px + Math.cos(a) * L * 0.85, py - 0.85 * s, pz + Math.sin(a) * L * 0.85], [0, -a, 0.95], [L * 0.45, 0.07 * s, 0.4 * s], 0.08);
      }
      B.add(G.sph, 0x6f5a36, [px, py, pz], [0, 0, 0], [0.35 * s, 0.3 * s, 0.35 * s], 0.05);
      for (let i = 0; i < 3; i++) { const a = R() * TAU; B.add(G.sph, 0xd98a2a, [px + Math.cos(a) * 0.3 * s, py - 0.35 * s, pz + Math.sin(a) * 0.3 * s], [0, 0, 0], [0.18 * s, 0.25 * s, 0.18 * s], 0.08); }
      break;
    }
    case 'slamp': {                                                  // street light arching over the road
      const y = h(o.x, o.z), pre = M4(o.x, y, o.z, o.ry);
      B.add(CYL(0.7, 1, 6), 0x3a3d40, [0, 2.6, 0], [0, 0, 0], [0.16, 5.2, 0.16], 0.02, pre);
      B.add(G.box, 0x3a3d40, [0, 5.15, 0.8], [0, 0, 0], [0.1, 0.1, 1.7], 0.02, pre);
      B.add(G.box, 0x2e3134, [0, 5.1, 1.55], [0, 0, 0], [0.36, 0.14, 0.6], 0.02, pre);
      B.add(G.box, 0xfff1c0, [0, 5.02, 1.55], [0, 0, 0], [0.28, 0.04, 0.5], 0, pre);
      glow(G.box, 0xfff4cc, [0, 5.0, 1.55], [0, 0, 0], [0.32, 0.06, 0.55], pre);
      if (Pl) { const v = new THREE.Vector3(0, 0, 2).applyMatrix4(pre); pool(v.x, v.z, 5, 0x302612); }
      break;
    }
    case 'garden': {                                                 // small walled garden in an empty lot
      const y = h(o.x, o.z), pre = M4(o.x, y, o.z, o.ry);
      for (const [x, z, w, d] of [[0, -1.9, 4, 0.3], [0, 1.9, 4, 0.3], [-1.9, 0, 0.3, 3.5], [1.9, 0.9, 0.3, 1.7]]) B.add(G.box, 0xd6c6a2, [x, 0.45, z], [0, 0, 0], [w, 0.9, d], 0.04, pre);
      Bs.add(G.box, 0x6a9a4a, [0, 0.04, 0], [0, 0, 0], [3.5, 0.08, 3.5], 0.08, pre);
      B.add(G.blobs[0], 0x5c9d45, [-0.7, 0.9, -0.6], [0, R(), 0], [1.1, 1.0, 1.1], 0.08, pre);
      B.add(G.box, 0x9c7a55, [0.8, 0.3, 0.8], [0, 0, 0], [0.9, 0.6, 0.5], 0.06, pre);
      B.add(CYL(0.8, 1, 8), 0xb56a3a, [0.6, 0.3, -0.8], [0, 0, 0], [0.5, 0.6, 0.5], 0.06, pre);
      break;
    }
    case 'oasis': {
      const y = h(o.x, o.z);
      Bs.add(CYL(1, 1, 16), 0xd9b27a, [o.x, y + 0.03, o.z], [0, 0, 0], [o.r + 1.4, 0.1, o.r + 1.2], 0.04);
      Bs.add(CYL(1, 1, 16), 0x3fa6c4, [o.x, y + 0.1, o.z], [0, 0, 0], [o.r, 0.06, o.r * 0.9], 0.03);
      Bs.add(CYL(1, 1, 12), 0x69c0d8, [o.x - 0.6, y + 0.12, o.z - 0.4], [0, 0, 0], [o.r * 0.45, 0.04, o.r * 0.35], 0.03);
      for (let i = 0; i < 10; i++) { const a = R() * TAU, rr = o.r + 0.2 + R() * 0.8; Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0x7d9a48 : 0x9fb35a, [o.x + Math.cos(a) * rr, y + 0.5, o.z + Math.sin(a) * rr * 0.9], [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3], [0.14, 1.1 + R() * 0.5, 0.14], 0.06); }
      break;
    }
    case 'wreckcar': {                                               // burnt-out car
      const y = h(o.x, o.z), pre = M4(o.x, y - 0.1, o.z, o.ry);
      B.add(G.box, 0x3a302a, [0, 0.55, 0], [0.04, 0, 0.06], [1.9, 0.6, 4.1], 0.1, pre);
      B.add(G.box, 0x2b2623, [0, 1.1, -0.3], [0.04, 0, 0.06], [1.6, 0.5, 2.0], 0.1, pre);
      B.add(G.box, 0x8a4a2a, [0.3, 0.9, 1.3], [0.2, 0.3, 0], [1.2, 0.08, 1.1], 0.12, pre);
      for (const [wx, wz] of [[-0.95, 1.35], [0.95, -1.35]]) B.add(CYL(0.5, 0.5, 8), 0x1a1a1a, [wx, 0.3, wz], [0, 0, Math.PI / 2], [0.7, 0.28, 0.7], 0, pre);
      B.add(G.box, 0x6a3a22, [-0.7, 0.25, -1.7], [0.3, 0.4, 0.2], [0.6, 0.1, 0.5], 0.1, pre);
      break;
    }
    case 'tires': {
      const y = h(o.x, o.z);
      for (let i = 0; i < o.n; i++) { const ox = (i % 2) * 0.35 - 0.15, oz = (i % 3) * 0.2 - 0.2;
        B.add(CYL(0.5, 0.5, 10), 0x1f1f1f, [o.x + ox, y + 0.18 + i * 0.34, o.z + oz], [0, 0, 0], [1.1, 0.32, 1.1], 0.05);
        B.add(CYL(0.5, 0.5, 8), 0x3a3530, [o.x + ox, y + 0.2 + i * 0.34, o.z + oz], [0, 0, 0], [0.5, 0.34, 0.5], 0.05); }
      break;
    }
    case 'ripple': {                                                 // wind ripples on the sand
      const c = Math.cos(o.ry), sn = Math.sin(o.ry);
      for (let i = 0; i < o.n; i++) { const off = (i - o.n / 2) * 0.9, x = o.x + c * off, z = o.z - sn * off;
        Bs.add(G.box, i % 2 ? 0xd9a668 : 0xf3cc92, [x, h(x, z) + 0.05, z], [0, o.ry + Math.PI / 2, 0], [0.22, 0.08, o.L * (1 - Math.abs(off) * 0.12)], 0.04); }
      break;
    }
    case 'sign': {                                                   // road sign (green panel, white text lines)
      const y = h(o.x, o.z), pre = M4(o.x, y, o.z, o.ry);
      for (const sx of [-0.8, 0.8]) B.add(CYL(0.5, 0.5, 6), 0x9a9d9f, [sx, 1.3, 0], [0, 0, 0], [0.1, 2.6, 0.1], 0.02, pre);
      B.add(G.box, o.c ? 0x2f7a4a : 0x2f5f9a, [0, 2.4, 0], [0, 0, 0], [2.2, 1.0, 0.08], 0.02, pre);
      for (let i = 0; i < 2; i++) B.add(G.box, 0xf4f4ef, [0, 2.6 - i * 0.35, 0.05], [0, 0, 0], [1.6 - i * 0.5, 0.1, 0.02], 0, pre);
      break;
    }
    case 'grass': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0x7cc05a : 0x8ccf62, [o.x + (R() - 0.5) * 0.5, y + 0.25, o.z + (R() - 0.5) * 0.5], [(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5], [0.13, 0.55, 0.13], 0.06); break; }
  }
}
