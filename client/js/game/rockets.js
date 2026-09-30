/* Homing rockets (power-up). The server steers them; it sends their
   positions a few times a second (on the render timeline, like tanks) and
   this file glides each rocket between those points, with a flame and a
   smoke trail. The explosion itself comes with the normal 'hit' event. */
import * as THREE from '../three.js';
import { glowTex } from './fxtex.js';
import { lerp, lerpAngle } from '../../shared/math.js';

let GEO = null;
function model() {
  if (!GEO) {
    const S = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.6 });
    GEO = {
      body: new THREE.CylinderGeometry(0.2, 0.2, 1.3, 8).rotateX(Math.PI / 2), nose: new THREE.ConeGeometry(0.2, 0.5, 8).rotateX(Math.PI / 2),
      fin: new THREE.BoxGeometry(0.06, 0.34, 0.34), mw: S(0xeeeeee), mr: S(0xd8453a), md: S(0x3a3d40),
    };
  }
  const g = new THREE.Group();
  const b = new THREE.Mesh(GEO.body, GEO.mw); g.add(b);
  const n = new THREE.Mesh(GEO.nose, GEO.mr); n.position.z = 0.9; g.add(n);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(GEO.fin, GEO.md); f.position.z = -0.5; f.rotation.z = i * Math.PI / 2; f.position.x = Math.cos(i * Math.PI / 2) * 0.22; f.position.y = Math.sin(i * Math.PI / 2) * 0.22; g.add(f); }
  if (glowTex()) { const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff9a3a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); fl.position.z = -0.85; fl.scale.set(1.3, 1.3, 1); g.add(fl); g.userData.flame = fl; }
  return g;
}

export class Rockets {
  constructor(scene, fx) { this.scene = scene; this.fx = fx; this.list = new Map(); }
  // r = [[id, x, z, angle, owner], ...] — every rocket still flying
  update(r, groundY) {
    const seen = new Set();
    for (const [id, x, z, a] of r) {
      seen.add(id);
      let k = this.list.get(id);
      if (!k) { k = { g: model(), x, z, a, tx: x, tz: z, ta: a }; this.scene.add(k.g); this.list.set(id, k); }
      k.tx = x; k.tz = z; k.ta = a; k.gy = groundY(x, z);
    }
    for (const [id, k] of this.list) if (!seen.has(id)) this.remove(id);
  }
  remove(id) { const k = this.list.get(id); if (!k) return; this.scene.remove(k.g); this.list.delete(id); }
  frame(dt, t) {
    const f = 1 - Math.exp(-dt * 14);
    for (const k of this.list.values()) {
      k.x = lerp(k.x, k.tx, f); k.z = lerp(k.z, k.tz, f); k.a = lerpAngle(k.a, k.ta, f);
      k.g.position.set(k.x, (k.gy || 0) + 1.5 + Math.sin(t * 9 + k.x) * 0.06, k.z); k.g.rotation.set(0, k.a, 0);
      if (k.g.userData.flame) k.g.userData.flame.scale.setScalar(1.1 + Math.random() * 0.5);
      if (this.fx && (k.tt = (k.tt || 0) + dt) > 0.025) { k.tt = 0; this.fx.trail(this.fx._o.set(k.x - Math.sin(k.a) * 0.9, k.g.position.y, k.z - Math.cos(k.a) * 0.9)); }
    }
  }
  clear() { for (const id of [...this.list.keys()]) this.remove(id); }
}
