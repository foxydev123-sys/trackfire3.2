/* One tank's 3D model (2 draw calls: hull + turret) + small visual state. */
import * as THREE from '../three.js';
import { Batch } from './batch.js';
import { addHull, addTurret } from './prefabs.js';
import { lerp, lerpAngle } from '../../shared/math.js';
import { TANKS } from '../../shared/tanks.js';
import { glowTex, beamTex } from './fxtex.js';

export const TEAM_COLORS = { blue: 0x4a78b8, red: 0xc24b3c };
export const TEAM_ACCENT = { blue: 0x9cc4ff, red: 0xffc26b };
export const FFA_COLORS = [0x4a78b8, 0xc24b3c, 0x5d8f45, 0xd09a2f, 0x8a5bb8, 0x2f9c9a, 0xb85b86, 0x6b6f76];
const TMAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.08 });
const modelCache = new Map();

// The tank type decides the paint and shape; `team` colours the marking panels (null = garage/neutral).
function models(team, kind) {
  const k = team + '_' + kind;
  if (!modelCache.has(k)) {
    const body = (TANKS[kind] || TANKS.zagros).body;
    const hb = new Batch(3); addHull(hb, body, null, false, kind, team); const tb = new Batch(4); addTurret(tb, body, team, null, false, kind);
    modelCache.set(k, { hull: hb.build(TMAT).geometry, tur: tb.build(TMAT).geometry });
  }
  return modelCache.get(k);
}

export class TankView {
  constructor(scene, color, accent, isMe, kind = 'zagros') {
    const g = models(color, TANKS[kind] ? kind : 'zagros');
    this.kind = kind;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);       // tilts with terrain
    this.hull = new THREE.Mesh(g.hull, TMAT); this.hull.castShadow = true; this.hull.receiveShadow = true; this.body.add(this.hull);
    this.pivot = new THREE.Group(); this.pivot.position.y = 1.16; this.body.add(this.pivot);
    this.tur = new THREE.Mesh(g.tur, TMAT); this.tur.castShadow = true; this.tur.receiveShadow = true; this.pivot.add(this.tur);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.34, kind === 'safeen' ? 4.6 : kind === 'baz' || kind === 'bradost' ? 3.0 : 3.5); this.tur.add(this.muzzle);
    this.body.scale.setScalar((TANKS[kind] || TANKS.zagros).size);
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(2.9, 1), new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.22, wireframe: true, depthWrite: false }));
    this.shield.position.y = 1.1; this.shield.visible = false; this.root.add(this.shield);
    // power-up visuals
    this.armor = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.18, depthWrite: false }));
    this.armor.position.y = 1.1; this.armor.visible = false; this.root.add(this.armor);
    this.power = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.35, 32), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.8, depthWrite: false }));
    this.power.rotation.x = -Math.PI / 2; this.power.position.y = 0.14; this.power.visible = false; this.root.add(this.power);
    // Team ring on the ground (your own tank gets the orange ring below instead).
    if (!isMe && color != null) {
      const tr = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.7, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
      tr.rotation.x = -Math.PI / 2; tr.position.y = 0.09; this.root.add(tr); this.teamRing = tr;
    }
    // Headlights (night only): two glowing dots and a beam painted on the ground ahead.
    this.lights = new THREE.Group(); this.lights.visible = false; this.root.add(this.lights);
    const sz = (TANKS[kind] || TANKS.zagros).size;
    if (glowTex()) {
      const dotM = new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff1c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      for (const sx of [-1, 1]) { const d = new THREE.Sprite(dotM); d.scale.set(1.3, 1.3, 1); d.position.set(sx * 0.78 * sz, 1.08 * sz, 1.62 * sz); this.lights.add(d); }
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 15), new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xffe6b0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.16, 1.6 * sz + 7.3); beam.renderOrder = 3; this.lights.add(beam);
    }
    if (isMe) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc466, transparent: true, opacity: 0.75, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.85, 40), mat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; this.root.add(ring);
      const chev = new THREE.Mesh(new THREE.CircleGeometry(0.5, 3), mat); chev.rotation.set(-Math.PI / 2, 0, Math.PI / 2); chev.position.set(0, 0.1, 3.3); this.root.add(chev);
    }
    scene.add(this.root);
    this.scene = scene; this.recoil = 0; this.pitch = 0; this.roll = 0; this.dustT = 0; this.t = 0; this.visible = true;
  }
  setPose(x, z, yaw, turret, H, dt, speed) {
    this.t += dt;
    // Tilt to follow the terrain (sample ground under front/back/left/right).
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const hf = H(x + s * 1.7, z + c * 1.7), hb = H(x - s * 1.7, z - c * 1.7), hl = H(x + c * 1.1, z - s * 1.1), hr = H(x - c * 1.1, z + s * 1.1);
    const k = 1 - Math.exp(-10 * dt);
    this.pitch = lerp(this.pitch, Math.atan2(hb - hf, 3.4), k); this.roll = lerp(this.roll, Math.atan2(hl - hr, 2.2), k);
    this.root.position.set(x, (hf + hb + hl + hr) / 4, z);
    this.root.rotation.y = yaw;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.pivot.rotation.y = turret - yaw;
    this.hull.position.y = Math.sin(this.t * 15) * 0.02 * Math.min(1, Math.abs(speed) / 4);
    this.recoil = Math.max(0, this.recoil - dt * 3.2); this.tur.position.z = -this.recoil * 0.35;
  }
  setNight(on) { this.lights.visible = !!on; }
  setShield(on, t) { this.shield.visible = on && (Math.floor(t * 10) % 3 !== 0); }
  setPowers(p, t) {
    const arm = (p.armor || 0) > 0; this.armor.visible = arm && (p.armor > 1 || Math.floor(t * 8) % 2 === 0);
    if (arm) { this.armor.rotation.y = t * 0.6; this.armor.material.opacity = 0.16 + Math.sin(t * 6) * 0.05; }
    this.power.visible = !!p.oneShot; if (p.oneShot) this.power.scale.setScalar(1 + Math.sin(t * 8) * 0.06);
    this.boosting = (p.boost || 0) > 0;
  }
  // "X-ray": a flat coloured silhouette drawn only where something (a house, a tree) is in front of the tank,
  // so you never lose your own tank (or a teammate) behind buildings.
  setXray(on, color = 0x5fb4ff) {
    if (on && !this.xray) {
      const m = new THREE.MeshBasicMaterial({ color, depthFunc: THREE.GreaterDepth, depthWrite: false });
      const a = new THREE.Mesh(this.hull.geometry, m), b = new THREE.Mesh(this.tur.geometry, m);
      a.renderOrder = b.renderOrder = 1; this.hull.renderOrder = this.tur.renderOrder = 2;
      this.hull.add(a); this.tur.add(b); this.xray = { a, b, m };
    }
    if (this.xray) { this.xray.a.visible = this.xray.b.visible = !!on; if (on) this.xray.m.color.setHex(color); }
  }
  // Cloaked (your own tank or a team-mate's): drawn see-through so you know it is hidden from the enemy.
  setGhost(on) {
    on = !!on;
    if (on === !!this.ghostOn) return;
    this.ghostOn = on;
    if (on && !this.gmat) { this.gmat = TMAT.clone(); this.gmat.transparent = true; this.gmat.opacity = 0.3; this.gmat.depthWrite = false; }
    this.hull.material = on ? this.gmat : TMAT; this.tur.material = on ? this.gmat : TMAT;
    if (this.teamRing) this.teamRing.material.opacity = on ? 0.2 : 0.55;
  }
  /** Holding a Repair Shot: a green ring under the tank and little plus signs floating up. */
  setMedic(on, t) {
    on = !!on;
    if (on && !this.medic) {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x49d16a, transparent: true, opacity: 0.85, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.95, 40), m);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
      const plus = [];
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Group();
        p.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.05), m));
        p.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.05), m));
        g.add(p); plus.push(p);
      }
      this.root.add(g); this.medic = { g, ring, plus, m };
    }
    if (!this.medic) return;
    this.medic.g.visible = on;
    if (!on) return;
    this.medic.ring.material.opacity = 0.55 + 0.35 * Math.sin(t * 5);
    this.medic.plus.forEach((p, i) => {                       // pluses drift upwards and fade
      const k = ((t * 0.55 + i / 3) % 1);
      p.position.set(Math.sin(i * 2.1) * 1.4, 1.2 + k * 3.2, Math.cos(i * 2.1) * 1.4);
      p.rotation.y = -t;
      p.scale.setScalar(0.8 + k * 0.5);
      p.visible = k < 0.85;
    });
  }
  setVisible(v) { this.visible = v; this.root.visible = v; }
  muzzleWorld(v) { this.root.updateMatrixWorld(true); return this.muzzle.getWorldPosition(v); }
  dispose() { this.scene.remove(this.root); if (this.xray) this.xray.m.dispose(); if (this.gmat) this.gmat.dispose(); if (this.medic) this.medic.m.dispose(); if (this.teamRing) this.teamRing.geometry.dispose(); this.shield.geometry.dispose(); this.armor.geometry.dispose(); this.power.geometry.dispose(); }
}
