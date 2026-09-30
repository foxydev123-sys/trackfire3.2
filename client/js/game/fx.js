/* Pooled particles: explosions, muzzle flashes, sparks, dust, smoke,
   scorch marks and short flashes of real light.
   - Low-poly chunks (fire, debris, dirt) keep the game's flat style.
   - Additive sprites (star flash, fireball glow) and soft smoke puffs add punch.
   Everything is pre-allocated (object pooling) so combat never triggers
   garbage-collection hitches. `budget` scales particle counts by quality. */
import * as THREE from '../three.js';
import { G } from './batch.js';
import { lerp, smooth, TAU } from '../../shared/math.js';
import { glowTex, starTex, puffTex, scorchTex } from './fxtex.js';

const R = Math.random;
export class FX {
  constructor(scene, dustCol, poolSize = 360, opts = {}) {
    this.scene = scene; this.pool = []; this.act = []; this.rings = []; this.budget = 1; this.ri = 0;
    const B = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false });
    const S = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 });
    this.mats = { f1: B(0xfff1a8), f2: B(0xffa53a), f3: B(0xff5a2a), smoke: S(0x5f5854), smokeL: S(0x958c84), smokeD: S(0x3a3532), dust: S(dustCol), dirt: S(new THREE.Color(dustCol).multiplyScalar(0.7)),
      debris: S(0x3a3430), leafG: S(0x5c9d45), leafD: S(0x9a9a55), spark: B(0xffe28a), sparkW: B(0xffffff), blue: B(0x8fe8ff) };
    for (let i = 0; i < poolSize; i++) { const m = new THREE.Mesh(G.ico, this.mats.smoke); m.visible = false; m.frustumCulled = false; scene.add(m); this.pool.push(m); }
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); this.rings.push({ m, t: 1, life: 1, R: 1 });
    }
    // additive sprites (flash / glow) and soft smoke puffs
    this.sprites = []; this.sAct = [];
    this.tex = { flash: starTex(), glow: glowTex(), puff: puffTex() };
    if (this.tex.glow) for (let i = 0; i < 90; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const s = new THREE.Sprite(mat); s.visible = false; s.frustumCulled = false; scene.add(s); this.sprites.push(s);
    }
    // scorch marks that stay on the ground for a while
    this.scorches = [];
    if (scorchTex()) for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: scorchTex(), transparent: true, depthWrite: false, opacity: 0 }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; scene.add(m); this.scorches.push({ m, t: 99, life: 14 });
    }
    this.si = 0;
    // a few real point lights for flashes (skipped on low quality: phones pay for every light)
    this.lights = [];
    const nL = opts.lights ?? 2;
    for (let i = 0; i < nL; i++) { const l = new THREE.PointLight(0xffb060, 0, 22, 2); l.visible = true; scene.add(l); this.lights.push({ l, t: 1, life: 1, I: 0 }); }
    this.li = 0;
    this._v = new THREE.Vector3(); this._o = new THREE.Vector3(); this._c = new THREE.Color();
  }
  spawn(type, pos, vel, life, s0, s1, grav = 0, drag = 1) {
    const m = this.pool.pop(); if (!m) return;
    m.material = this.mats[type]; m.visible = true; m.position.copy(pos);
    m.rotation.set(R() * TAU, R() * TAU, 0); m.scale.setScalar(s0);
    this.act.push({ m, vel: vel.clone(), life, t: 0, s0, s1, grav, drag, spin: (R() - 0.5) * 6, stretch: type === 'spark' || type === 'sparkW' });
  }
  // kind: 'flash' | 'glow' | 'puff'. Additive unless it's a smoke puff.
  sprite(kind, pos, vel, life, s0, s1, color, alpha = 1, rot = 0) {
    const s = this.sprites.pop(); if (!s) return;
    const add = kind !== 'puff';
    s.material.map = this.tex[kind]; s.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.color.setHex(color); s.material.opacity = alpha; s.material.rotation = rot || R() * TAU;
    s.position.copy(pos); s.scale.set(s0, s0, 1); s.visible = true;
    this.sAct.push({ s, vel: vel ? vel.clone() : new THREE.Vector3(), life, t: 0, s0, s1, a0: alpha, add });
  }
  flash(pos, color = 0xffb060, intensity = 3, life = 0.15) {
    if (!this.lights.length) return;
    const L = this.lights[this.li++ % this.lights.length];
    L.l.position.set(pos.x, pos.y + 1.2, pos.z); L.l.color.setHex(color); L.I = intensity; L.l.intensity = intensity; L.t = 0; L.life = life;
  }
  scorch(p, size) {
    if (!this.scorches.length) return;
    const S = this.scorches[this.si++ % this.scorches.length];
    S.m.position.set(p.x, p.y + 0.13, p.z); S.m.scale.set(size, size, 1); S.m.rotation.z = R() * TAU; S.t = 0; S.m.visible = true; S.m.material.opacity = 0.75;
  }
  ring(pos, Rr, col = 0xffd9a0, life = 0.45) {
    const r = this.rings[this.ri++ % this.rings.length];
    r.m.position.set(pos.x, pos.y + 0.15, pos.z); r.m.material.color.setHex(col); r.t = 0; r.life = life; r.R = Rr; r.m.visible = true;
  }
  sparks(p, n, speed = 12, up = 0.6) {
    const v = this._v;
    for (let i = 0; i < n; i++) { v.set(R() - 0.5, R() * up + 0.15, R() - 0.5).normalize().multiplyScalar(speed * (0.5 + R() * 0.7)); this.spawn(i % 3 ? 'spark' : 'sparkW', p, v, 0.35 + R() * 0.35, 0.09, 0.05, 20, 0.5); }
  }
  // p = centre of the blast (about 1.2 m above ground). big = a tank blowing up.
  explode(p, big) {
    const q = this.budget, v = this._v, o = this._o, gy = p.y - 1.2;
    // bright core + fireball glow + real light
    this.sprite('flash', p, null, big ? 0.16 : 0.1, big ? 6 : 3.2, big ? 9 : 4.5, 0xfff0c0, 1);
    this.sprite('glow', p, v.set(0, 1.2, 0), big ? 0.65 : 0.35, big ? 5 : 2.6, big ? 9 : 4.2, 0xff8a30, 0.95);
    if (big) this.sprite('glow', o.copy(p).setY(p.y + 1), v.set(0, 2.5, 0), 0.9, 3, 7, 0xff5a20, 0.7);
    this.flash(p, big ? 0xff8a3a : 0xffb060, big ? 6 : 2.6, big ? 0.45 : 0.18);
    const nF = Math.round((big ? 18 : 7) * q), nS = Math.round((big ? 14 : 5) * q), nD = Math.round((big ? 14 : 4) * q);
    for (let i = 0; i < nF; i++) { v.set(R() - 0.5, R() * 0.8 + 0.2, R() - 0.5).normalize(); o.copy(p).addScaledVector(v, 0.3);
      this.spawn(['f1', 'f2', 'f3'][i % 3], o, v.multiplyScalar((big ? 7.5 : 4.5) * (0.5 + R())), 0.3 + R() * 0.35, 0.35, big ? 1.8 : 1.0, 0, 0.02); }
    // smoke: dark rolling column for tanks, light puff for shells
    for (let i = 0; i < nS; i++) { o.set(p.x + (R() - 0.5) * 1.5, p.y + R(), p.z + (R() - 0.5) * 1.5);
      this.spawn(big ? (R() < 0.6 ? 'smokeD' : 'smoke') : (R() < 0.5 ? 'smoke' : 'smokeL'), o, v.set((R() - 0.5) * 1.4, 1.4 + R() * (big ? 2.6 : 1.8), (R() - 0.5) * 1.4), (big ? 2.2 : 1.3) + R() * 0.9, 0.5, big ? 2.8 : 1.3, 0, 0.35); }
    if (this.tex.puff) for (let i = 0; i < Math.round((big ? 6 : 2) * q); i++)
      this.sprite('puff', o.set(p.x + (R() - 0.5) * 2, p.y + 0.5 + R(), p.z + (R() - 0.5) * 2), v.set((R() - 0.5) * 1.2, 1 + R() * 1.5, (R() - 0.5) * 1.2), 1.8 + R(), 2, big ? 7 : 4, big ? 0x2e2a28 : 0x8a847e, 0.6);
    for (let i = 0; i < nD; i++) { o.set(p.x, p.y + 0.4, p.z); this.spawn('debris', o, v.set((R() - 0.5) * 9, 5 + R() * 6, (R() - 0.5) * 9), 1.5, big ? 0.28 : 0.2, 0.22, 18, 0.9); }
    // dirt thrown up from the ground
    for (let i = 0; i < Math.round((big ? 8 : 6) * q); i++) { o.set(p.x + (R() - 0.5), gy + 0.3, p.z + (R() - 0.5)); this.spawn(R() < 0.5 ? 'dirt' : 'dust', o, v.set((R() - 0.5) * 6, 4 + R() * 5, (R() - 0.5) * 6), 1.1, 0.25, 0.3, 16, 0.8); }
    this.sparks(p, Math.round((big ? 16 : 7) * q), big ? 16 : 11);
    this.ring(o.set(p.x, gy, p.z), big ? 9 : 4.5, big ? 0xffc080 : 0xffd9a0, big ? 0.55 : 0.4);
    this.scorch(o.set(p.x, gy, p.z), big ? 7 : 3.4);
  }
  /**
   * Safeen's guided rocket going in. Plainly bigger than a cannon shell landing — a white-hot
   * core, two shock rings running out along the ground, a real dust burst and debris — but built
   * from the same handful of pieces as everything else and still counted against `budget`, so a
   * cheap phone draws the same shape with fewer particles rather than dropping frames.
   */
  guided(p) {
    const q = this.budget, v = this._v, o = this._o, gy = p.y - 1.2;
    this.sprite('flash', p, null, 0.2, 5.5, 11, 0xffffff, 1);                    // hard white core
    this.sprite('glow', p, v.set(0, 1.4, 0), 0.5, 4.5, 8.5, 0xffb347, 0.95);
    this.sprite('glow', o.copy(p).setY(p.y + 1.1), v.set(0, 2.2, 0), 0.8, 3, 7, 0xff6a24, 0.7);
    this.flash(p, 0xffc070, 7, 0.34);
    // two rings a beat apart, so the blast reads as a wave going out rather than one flat circle
    this.ring(o.set(p.x, gy, p.z), 7.5, 0xfff0c8, 0.4);
    this.ring(o.set(p.x, gy + 0.05, p.z), 12, 0xffb060, 0.62);
    for (let i = 0; i < Math.round(13 * q); i++) {                               // fireballs
      v.set(R() - 0.5, R() * 0.85 + 0.2, R() - 0.5).normalize(); o.copy(p).addScaledVector(v, 0.35);
      this.spawn(['f1', 'f2', 'f3'][i % 3], o, v.multiplyScalar(6.5 * (0.5 + R())), 0.32 + R() * 0.4, 0.35, 1.5, 0, 0.02);
    }
    for (let i = 0; i < Math.round(10 * q); i++) {                               // smoke that lingers
      o.set(p.x + (R() - 0.5) * 1.8, p.y + R(), p.z + (R() - 0.5) * 1.8);
      this.spawn(R() < 0.55 ? 'smokeD' : 'smoke', o, v.set((R() - 0.5) * 1.6, 1.6 + R() * 2.2, (R() - 0.5) * 1.6), 1.9 + R(), 0.5, 2.4, 0, 0.35);
    }
    if (this.tex.puff) for (let i = 0; i < Math.round(4 * q); i++)
      this.sprite('puff', o.set(p.x + (R() - 0.5) * 2.4, p.y + 0.5 + R(), p.z + (R() - 0.5) * 2.4), v.set((R() - 0.5) * 1.3, 1.1 + R() * 1.5, (R() - 0.5) * 1.3), 2 + R(), 2, 6, 0x3a3532, 0.6);
    for (let i = 0; i < Math.round(11 * q); i++) {                               // debris and ground dust
      o.set(p.x, p.y + 0.4, p.z);
      this.spawn('debris', o, v.set((R() - 0.5) * 11, 5.5 + R() * 6.5, (R() - 0.5) * 11), 1.5, 0.26, 0.22, 18, 0.9);
    }
    for (let i = 0; i < Math.round(9 * q); i++) {
      o.set(p.x + (R() - 0.5) * 1.4, gy + 0.3, p.z + (R() - 0.5) * 1.4);
      this.spawn(R() < 0.5 ? 'dirt' : 'dust', o, v.set((R() - 0.5) * 8, 4.5 + R() * 5, (R() - 0.5) * 8), 1.2, 0.25, 0.32, 16, 0.8);
    }
    this.sparks(p, Math.round(14 * q), 15);
    this.scorch(o.set(p.x, gy, p.z), 5.2);
  }
  deflect(p) {
    const v = this._v;
    for (let i = 0; i < 7; i++) { v.set(R() - 0.5, R() * 0.6, R() - 0.5).normalize().multiplyScalar(7); this.spawn('blue', p, v, 0.25, 0.25, 0.1, 0, 0.05); }
    this.sprite('flash', p, null, 0.12, 2.6, 3.4, 0x9fe8ff, 1);
    this.sparks(p, 6, 10);
    this.ring(p, 2.5, 0x8fe8ff);
    this.flash(p, 0x8fe8ff, 1.6, 0.12);
  }
  muzzle(p, dir) {
    const v = this._v, o = this._o;
    // star flash just in front of the barrel + a bright glow and a quick light
    o.copy(p).addScaledVector(dir, 0.6);
    this.sprite('flash', o, null, 0.09, 3.2, 4.2, 0xffe6a0, 1, Math.atan2(dir.x, dir.z));
    this.sprite('glow', o, null, 0.14, 2.2, 3.4, 0xff9a40, 0.9);
    this.flash(o, 0xffb060, 2.4, 0.1);
    for (let i = 0; i < 5; i++) { o.copy(p).addScaledVector(dir, i * 0.28); this.spawn(i < 2 ? 'f1' : 'f2', o, v.copy(dir).multiplyScalar(7 + i * 2.2), 0.11, 0.5 - i * 0.06, 0.75, 0, 0.01); }
    // side jets from the muzzle brake + forward smoke
    for (const sd of [-1, 1]) { o.copy(p).addScaledVector(dir, 0.3); this.spawn('f2', o, v.set(dir.z * sd * 5, 0.4, -dir.x * sd * 5), 0.1, 0.3, 0.5, 0, 0.01); }
    const n = Math.round(5 * this.budget);
    for (let i = 0; i < n; i++) { o.copy(p).addScaledVector(dir, 0.4 + R() * 0.6); this.spawn(R() < 0.5 ? 'smokeL' : 'smoke', o, v.set(dir.x * (2 + R() * 2) + (R() - 0.5), 0.6 + R(), dir.z * (2 + R() * 2) + (R() - 0.5)), 0.9 + R() * 0.4, 0.3, 1.1, 0, 0.2); }
    if (this.tex.puff) this.sprite('puff', o.copy(p).addScaledVector(dir, 1.2), v.set(dir.x * 1.5, 0.8, dir.z * 1.5), 1.1, 1.2, 3.2, 0xb8b0a6, 0.45);
    // ground blast under the barrel
    for (let i = 0; i < Math.round(4 * this.budget); i++) { o.set(p.x + dir.x * 1.2, p.y - 1.25, p.z + dir.z * 1.2); this.spawn('dust', o, v.set((R() - 0.5) * 4 + dir.x * 2, 0.5 + R() * 0.8, (R() - 0.5) * 4 + dir.z * 2), 0.7, 0.3, 0.9, 0, 0.3); }
  }
  // tiny smoke puff behind a flying shell
  trail(p) { if (R() > this.budget) return; this.spawn('smokeL', p, this._v.set((R() - 0.5) * 0.3, 0.3 + R() * 0.3, (R() - 0.5) * 0.3), 0.45, 0.12, 0.45, 0, 0.5); }
  leaves(p, n, col) {
    const v = this._v, t = col === 0x9a9a55 ? 'leafD' : 'leafG';
    for (let i = 0; i < n; i++) this.spawn(t, p, v.set((R() - 0.5) * 4, 2 + R() * 3, (R() - 0.5) * 4), 0.9 + R() * 0.5, 0.18, 0.14, 9, 0.6);
  }
  dust(p) { if (R() > this.budget) return; this.spawn('dust', p, this._v.set((R() - 0.5) * 0.6, 0.6 + R() * 0.6, (R() - 0.5) * 0.6), 0.8 + R() * 0.4, 0.2, 0.75, 0, 0.4); }
  smoke(p) { this.spawn(R() < 0.6 ? 'smoke' : 'smokeL', p, this._v.set((R() - 0.5) * 0.5, 2 + R(), (R() - 0.5) * 0.5), 1.8, 0.5, 1.8, 0, 0.6); }
  update(dt) {
    for (let i = this.act.length - 1; i >= 0; i--) {
      const a = this.act[i]; a.t += dt; const k = a.t / a.life;
      if (k >= 1) { a.m.visible = false; this.pool.push(a.m); this.act[i] = this.act[this.act.length - 1]; this.act.pop(); continue; }
      a.vel.y -= a.grav * dt; a.vel.multiplyScalar(Math.pow(a.drag, dt)); a.m.position.addScaledVector(a.vel, dt);
      if (a.grav && a.m.position.y < 0.15) { a.m.position.y = 0.15; a.vel.y *= -0.3; a.vel.x *= 0.6; a.vel.z *= 0.6; }
      const e = 1 - Math.pow(1 - k, 3), sc = lerp(a.s0, a.s1, e) * (1 - smooth(0.62, 1, k));
      if (a.stretch) { a.m.scale.set(sc, sc, sc * 5); a.m.lookAt(this._o.copy(a.m.position).add(a.vel)); }
      else { a.m.scale.setScalar(sc); a.m.rotation.x += a.spin * dt; a.m.rotation.y += a.spin * 0.7 * dt; }
    }
    for (let i = this.sAct.length - 1; i >= 0; i--) {
      const a = this.sAct[i]; a.t += dt; const k = a.t / a.life;
      if (k >= 1) { a.s.visible = false; this.sprites.push(a.s); this.sAct[i] = this.sAct[this.sAct.length - 1]; this.sAct.pop(); continue; }
      a.s.position.addScaledVector(a.vel, dt);
      const sc = lerp(a.s0, a.s1, 1 - Math.pow(1 - k, 2)); a.s.scale.set(sc, sc, 1);
      a.s.material.opacity = a.a0 * (a.add ? (1 - k * k) : (1 - smooth(0.3, 1, k)));
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue; r.t += dt; const k = r.t / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.5 + r.R * (1 - Math.pow(1 - k, 2))); r.m.material.opacity = 0.7 * (1 - k);
    }
    for (const S of this.scorches) {
      if (!S.m.visible) continue; S.t += dt;
      if (S.t >= S.life) { S.m.visible = false; continue; }
      S.m.material.opacity = 0.75 * (1 - smooth(0.6, 1, S.t / S.life));
    }
    for (const L of this.lights) {
      if (L.t >= L.life) { L.l.intensity = 0; continue; }
      L.t += dt; L.l.intensity = L.I * Math.max(0, 1 - L.t / L.life);
    }
  }
}
