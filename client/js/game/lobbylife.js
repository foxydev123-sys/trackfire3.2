/* =====================================================================
   LOBBY LIFE — the things moving behind the menu line-up.

   A still picture looks dead, so each map's staging ground gets a pair of
   jets crossing the sky and a firefight somewhere over the horizon that
   flickers away. (Traffic was tried and cut: cars driven along a straight
   line ignore the actual roads, so they slid through scenery.)

   All of it is deliberately cheap. Every moving thing is built once and
   moved by setting a position — no geometry is rebuilt, nothing casts a
   shadow, and nothing is added at all on low quality. The whole lot is
   about a dozen small meshes, which is less than a single tank.
   ===================================================================== */
import * as THREE from '../three.js';

const M = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85 });

/* ---------------- one jet ---------------- */
function makeJet() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 5.4, 7), M(0x9aa3ab));
  b.rotation.x = Math.PI / 2; g.add(b);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 7), M(0x8a939b));
  nose.rotation.x = Math.PI / 2; nose.position.z = 3.3; g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.16, 1.5), M(0x8a939b));
  wing.position.z = -0.3; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.9), M(0x8a939b));
  tail.position.z = -2.4; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 1.1), M(0x8a939b));
  fin.position.set(0, 0.6, -2.4); g.add(fin);
  // a short vapour trail, just two long thin boxes
  const trail = new THREE.Group();
  for (const sx of [-2.6, 2.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 26),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    t.position.set(sx, 0, -14); trail.add(t);
  }
  g.add(trail);
  g.userData = { trail };
  return g;
}

export class LobbyLife {
  constructor() { this.W = null; this.t = 0; this.items = []; this.quality = 'medium'; }

  /** Put the traffic, the jets and the far-off firefight into `W`. Safe to call repeatedly. */
  attach(W, quality = 'medium') {
    if (this.W === W && this.quality === quality) return;
    this.clear();
    this.W = W; this.quality = quality;
    if (!W || !W.map || quality === 'low') return;        // weak phones get the still picture
    const L = W.map.lobby; if (!L) return;
    const rich = quality !== 'medium';                    // high/best get the extras
    const S = L.stage;

    // --- a pair of jets crossing high overhead, every so often
    const nJets = rich ? 2 : 1;
    for (let i = 0; i < nJets; i++) {
      const g = makeJet(); g.visible = false;
      this.W.scene.add(g);
      this.items.push({ k: 'jet', g, off: i * 0.5, spd: 46 + i * 7, y: 52 + i * 9, lean: i ? 1 : -1 });
    }

    // --- a firefight over the horizon: a few lights that flash and fade
    const nFlash = rich ? 5 : 3;
    for (let i = 0; i < nFlash; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending }));
      const a = (i / nFlash) * 1.6 - 0.8;
      m.position.set(S.x + Math.sin(a) * 90, 3 + (i % 3) * 2, S.z - 78 - (i % 2) * 14);
      this.W.scene.add(m);
      this.items.push({ k: 'flash', g: m, next: Math.random() * 3, lit: 0 });
    }
  }

  clear() {
    if (this.W) for (const it of this.items) this.W.scene.remove(it.g);
    this.items.length = 0;
  }

  /** Move everything on. Called once per menu frame; no allocation, no rebuilding. */
  frame(dt) {
    if (!this.items.length) return;
    this.t += dt;
    for (const it of this.items) {
      if (it.k === 'jet') {
        // one pass every 14 seconds, then away until its turn comes round again
        const cyc = ((this.t / 14) + it.off) % 1;
        const on = cyc < 0.45;
        it.g.visible = on;
        if (on) {
          const p = cyc / 0.45;
          it.g.position.set(it.lean > 0 ? -130 + p * 260 : 130 - p * 260,
                            it.y + Math.sin(p * 3.1) * 4,
                            (this.W.map.lobby.stage.z - 70) + it.lean * 26);
          it.g.rotation.y = it.lean > 0 ? Math.PI / 2 : -Math.PI / 2;
          it.g.rotation.z = Math.sin(this.t * 0.6 + it.off) * 0.12;
        }
      } else if (it.k === 'flash') {
        it.next -= dt;
        if (it.next <= 0) { it.next = 0.7 + Math.random() * 3.4; it.lit = 0.16 + Math.random() * 0.14; }
        if (it.lit > 0) {
          it.lit = Math.max(0, it.lit - dt);
          it.g.material.opacity = Math.min(0.85, it.lit * 5);
          it.g.scale.setScalar(1 + (1 - it.lit * 5) * 0.5);
        } else if (it.g.material.opacity) it.g.material.opacity = 0;
      }
    }
  }
}
