/* Debris from broken props: low-poly chunks (planks, stones, sandbags,
   tyres…) that fly out, bounce, and then STAY on the ground. Tanks driving
   into them push them around, and nearby explosions kick them again.
   Purely visual (each player sees their own), pooled so nothing is created
   during a match. Old pieces slowly sink away when the pool runs out. */
import * as THREE from '../three.js';
import { G } from './batch.js';

// Colours and piece shapes per kind of prop.
export const DEBRIS = {
  crate:  { cols: [0xa87646, 0x8a5c34, 0xb98552], shape: 'plank', n: 10, size: 0.9 },
  barrel: { cols: [0xa84f32, 0x6b7042, 0x3a3d40], shape: 'curve', n: 7, size: 0.7 },
  tires:  { cols: [0x1f1f1f, 0x2b2b2b], shape: 'ring', n: 5, size: 0.9 },
  pole:   { cols: [0x6e5238, 0x5f4630], shape: 'plank', n: 6, size: 1.2 },
  tent:   { cols: [0x8b8a5c, 0x6b6a44], shape: 'cloth', n: 8, size: 1.1 },
  bags:   { cols: [0xc4a674, 0xb99c69], shape: 'bag', n: 12, size: 0.7 },
  nest:   { cols: [0xbba577, 0xb09a6c], shape: 'bag', n: 14, size: 0.7 },
  swall:  { cols: [0x9a9d97, 0x8a8d86, 0x7c7f79], shape: 'stone', n: 14, size: 0.8 },
  fence:  { cols: [0x7a5334, 0x8a6040], shape: 'plank', n: 5, size: 1.0 },
  umbrella: { cols: [0x2f6fb5, 0xf2f2f2, 0xd14b3c, 0x5a5a5a], shape: 'cloth', n: 5, size: 0.9 },
};
const R = Math.random;

export class Debris {
  constructor(scene, max = 180) {
    this.scene = scene; this.items = []; this.next = 0; this.mats = new Map();
    this.geos = { plank: G.box, curve: G.box, ring: new THREE.TorusGeometry(0.5, 0.2, 5, 8), cloth: G.box, bag: G.sph, stone: G.ico };
    for (let i = 0; i < max; i++) { const m = new THREE.Mesh(G.box, this.mat(0xffffff)); m.visible = false; m.castShadow = true; scene.add(m); this.items.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), rest: false, on: false, sink: 0, s: 1 }); }
  }
  mat(c) { let m = this.mats.get(c); if (!m) this.mats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 }))); return m; }
  scale(shape, s) {
    if (shape === 'plank') return [0.18 * s, 0.1 * s, (0.6 + R() * 0.6) * s];
    if (shape === 'curve') return [0.45 * s, 0.5 * s, 0.1 * s];
    if (shape === 'ring') return [0.9 * s, 0.9 * s, 0.9 * s];
    if (shape === 'cloth') return [(0.5 + R() * 0.5) * s, 0.04, (0.4 + R() * 0.4) * s];
    if (shape === 'bag') return [0.3 * s, 0.2 * s, 0.5 * s];
    return [(0.25 + R() * 0.25) * s, (0.2 + R() * 0.2) * s, (0.25 + R() * 0.25) * s];
  }
  /** Break a prop of `kind` at (x, y, z). `from` = optional {x, z} the hit came from (pieces fly away from it). */
  burst(kind, x, y, z, from = null, power = 1) {
    const D = DEBRIS[kind] || DEBRIS.crate, geo = this.geos[D.shape] || G.box;
    let dx = 0, dz = 0; if (from) { dx = x - from.x; dz = z - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    for (let i = 0; i < D.n; i++) {
      const it = this.items[this.next++ % this.items.length], m = it.m;
      m.geometry = geo; m.material = this.mat(D.cols[i % D.cols.length]);
      const sc = this.scale(D.shape, D.size); m.scale.set(sc[0], sc[1], sc[2]); it.h = sc[1] / 2;
      m.position.set(x + (R() - 0.5) * 1.2, y + 0.4 + R() * 0.8, z + (R() - 0.5) * 1.2);
      m.rotation.set(R() * 6.28, R() * 6.28, R() * 6.28);
      it.v.set((R() - 0.5) * 6 + dx * 5, 3 + R() * 5, (R() - 0.5) * 6 + dz * 5).multiplyScalar(power);
      it.spin.set((R() - 0.5) * 12, (R() - 0.5) * 12, (R() - 0.5) * 12);
      it.rest = false; it.on = true; it.sink = 0; m.visible = true; m.position.y = Math.max(m.position.y, 0.2);
    }
  }
  /** Explosion nearby: push resting pieces away. */
  kick(x, z, r = 4, power = 5) {
    for (const it of this.items) {
      if (!it.on) continue; const p = it.m.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > r) continue; const k = (1 - d / r) * power / (d || 1);
      it.v.x += dx * k; it.v.z += dz * k; it.v.y += (1 - d / r) * power * 0.8; it.rest = false; it.spin.set((R() - 0.5) * 8, (R() - 0.5) * 8, (R() - 0.5) * 8);
    }
  }
  /** tanks = [{x, z, vx, vz}] — anything a tank drives into gets shoved. */
  update(dt, groundY, tanks) {
    for (const it of this.items) {
      if (!it.on) continue;
      const m = it.m, p = m.position;
      for (const t of tanks) {
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
        if (d < 2.1) {
          const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0, push = 2.1 - d;
          p.x += nx * push; p.z += nz * push;
          const sp = Math.hypot(t.vx, t.vz); it.v.x += nx * (2 + sp * 0.7) + t.vx * 0.5; it.v.z += nz * (2 + sp * 0.7) + t.vz * 0.5; it.v.y += 0.8 + sp * 0.1;
          it.rest = false; it.spin.set((R() - 0.5) * 6, (R() - 0.5) * 6, (R() - 0.5) * 6);
        }
      }
      if (it.rest) continue;
      it.v.y -= 22 * dt; p.addScaledVector(it.v, dt);
      m.rotation.x += it.spin.x * dt; m.rotation.y += it.spin.y * dt; m.rotation.z += it.spin.z * dt;
      const gy = groundY(p.x, p.z) + (it.h || 0.1);
      if (p.y < gy) {
        p.y = gy; it.v.y *= -0.3; it.v.x *= 0.6; it.v.z *= 0.6; it.spin.multiplyScalar(0.5);
        if (Math.abs(it.v.y) < 1 && Math.hypot(it.v.x, it.v.z) < 0.4) { it.rest = true; m.rotation.x = Math.round(m.rotation.x / 1.5708) * 1.5708; m.rotation.z = Math.round(m.rotation.z / 1.5708) * 1.5708; }
      }
    }
  }
  clear() { for (const it of this.items) { it.on = false; it.m.visible = false; } }
}
