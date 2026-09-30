/* Low-poly 3D props for the party modes: supply truck (Convoy), the big
   ball and goals (Tank Ball), the ticking bomb (Hot Potato). Same flat
   style as the rest of the game. Also used for the mode pictures. */
import * as THREE from '../three.js';
import { KF } from './prefabs.js';

const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: o.r ?? 0.75, metalness: o.m ?? 0.05, emissive: o.e ?? 0x000000 });
const box = (g, w, h, d, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = true; g.add(o); return o; };
const cyl = (g, rt, rb, h, n, m, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; g.add(o); return o; };

/** Army supply truck with a Kurdish flag on the cargo cover. Faces +z. */
export function makeTruck() {
  const g = new THREE.Group(), body = S(0x6b7042), dark = S(0x4c5030), cab = S(0x7a8050), glass = S(0x2a3a44, { r: 0.3 }), tyre = S(0x1c1c1c), canvas = S(0x8b8a5c);
  box(g, 2.5, 0.35, 5.8, dark, 0, 0.75, 0);                                         // chassis
  box(g, 2.4, 1.5, 1.9, cab, 0, 1.65, 1.9);                                         // cab
  box(g, 2.2, 0.6, 0.06, glass, 0, 2.0, 2.86);                                      // windscreen
  box(g, 2.5, 0.35, 0.5, dark, 0, 1.0, 3.0);                                        // bumper
  for (const s of [-1, 1]) box(g, 0.3, 0.2, 0.06, S(0xffe9b0, { e: 0x6a5a30 }), s * 0.85, 1.25, 3.26);
  box(g, 2.5, 0.5, 3.6, body, 0, 1.2, -0.9);                                        // cargo bed
  cyl(g, 1.3, 1.3, 3.5, 10, canvas, 0, 1.75, -0.9, Math.PI / 2, 0).scale.set(1, 1, 0.75);   // canvas cover
  [[KF.red, 0.35], [KF.white, 0], [KF.green, -0.35]].forEach(([c, dy]) => { for (const s of [-1, 1]) box(g, 0.02, 0.35, 2.2, S(c), s * 1.27, 2.05 + dy, -0.9); });
  for (const s of [-1, 1]) cyl(g, 0.24, 0.24, 0.03, 16, S(KF.sun), s * 1.29, 2.05, -0.9, 0, Math.PI / 2);
  for (const z of [2.0, -0.4, -2.0]) for (const s of [-1, 1]) cyl(g, 0.55, 0.55, 0.45, 12, tyre, s * 1.2, 0.55, z, 0, Math.PI / 2);
  // a glowing ring shows how close you must be to push it
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.4, 9, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring); g.userData.ring = ring;
  return g;
}

/** The big ball: white and black patches, low-poly. radius r */
export function makeBall(r = 2.4) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(r, 1).toNonIndexed(), n = geo.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let f = 0; f < n; f += 3) { const dark = (f / 3) % 5 === 0; c.setHex(dark ? 0x222222 : 0xf4f4f0); for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; } }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55 })); m.castShadow = true; m.position.y = r; g.add(m);
  g.userData.ball = m;
  return g;
}

/** A goal: two posts, a bar, a net and a coloured glowing ring on the ground. */
export function makeGoal(color, r = 5) {
  const g = new THREE.Group(), post = S(0xf2f2f2);
  for (const s of [-1, 1]) cyl(g, 0.22, 0.22, 3.4, 8, post, s * 3.6, 1.7, 0);
  cyl(g, 0.22, 0.22, 7.4, 8, post, 0, 3.4, 0, 0, Math.PI / 2);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.3, 8, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.45 }));
  net.position.set(0, 1.7, -1.2); net.rotation.x = -0.35; g.add(net);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.5, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r - 0.5, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.1; g.add(fill);
  return g;
}

/** Round black bomb with a burning fuse and a red light that blinks faster as time runs out. */
export function makeBomb() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), S(0x1b1b1e, { r: 0.4, m: 0.3 })); g.add(b);
  cyl(g, 0.3, 0.35, 0.3, 8, S(0x55585c), 0, 0.95, 0);
  const fuse = cyl(g, 0.06, 0.06, 0.6, 5, S(0xc8b27a), 0.18, 1.3, 0, 0, -0.5);
  const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0xffd060 })); spark.position.set(0.36, 1.56, 0); g.add(spark);
  const light = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); light.position.set(0, 0.2, 0.86); g.add(light);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 24), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -1.6; g.add(ring);
  g.userData = { spark, light, fuse, ring };
  return g;
}
