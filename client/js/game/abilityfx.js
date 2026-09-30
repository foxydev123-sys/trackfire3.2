/* =====================================================================
   ABILITY VISUALS — everything the eight tank powers put on the screen:
   cover walls, bunker domes, black holes, guided shells, suicide cars and
   the freeze cage. The server owns the real thing (see abrun.js); this
   file only draws it, and smooths the streamed positions between updates.
   ===================================================================== */
import * as THREE from '../three.js';
import { lerp, lerpAngle } from '../../shared/math.js';

const TEAM_HEX = { blue: 0x62a2ff, red: 0xff6250, '': 0xdddddd };
const M = (c, o) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, ...o });

/* ---------------- one cover wall ---------------- */
function makeWall(len, team) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, 2.1, 0.8), M(0x8b8d84, { roughness: 0.9 }));
  body.position.y = 1.05; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.25, 0.22, 1.05), M(0x6d7069));
  cap.position.y = 2.16; g.add(cap);
  for (const sx of [-1, 1]) {                                   // feet, so it does not look like it floats
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.5), M(0x62655f));
    f.position.set(sx * (len / 2 - 0.4), 0.25, 0); g.add(f);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.18, 0.86), new THREE.MeshBasicMaterial({ color: TEAM_HEX[team] || TEAM_HEX[''] }));
  stripe.position.y = 1.75; g.add(stripe);
  g.userData = { body, stripe, len };
  return g;
}

/* ---------------- bunker dome ---------------- */
function makeDome(r, team) {
  const g = new THREE.Group(), col = TEAM_HEX[team] || TEAM_HEX[''];
  const skin = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 14),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  const wire = new THREE.Mesh(new THREE.SphereGeometry(r * 1.002, 18, 10),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, wireframe: true, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.35, r, 56),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.14;
  g.add(skin, wire, ring);
  g.userData = { skin, wire, ring, r };
  return g;
}

/* ---------------- black hole ----------------
   Built to match the reference: a pitch-dark core wrapped in a hot violet
   accretion ring, a faint bubble around the whole thing, dark tendrils of
   matter spiralling in, sparks falling inward, a marked ring scratched into
   the ground and the odd bolt of energy flicking up out of it.
   All of it is plain geometry and additive blending — no textures, and the
   piece counts are kept small so cheap phones can still draw several at once. */
// A black hole should read as a hole: black first, and only then the thin blue light bending
// round it. The old violet and magenta made it look like a firework, so the palette is now a
// near-black navy with two restrained blues on top, and the glowing parts are kept faint so the
// void keeps the eye. Bright enough still to be found on a night map.
const HOLE_HOT = 0x1e46b4, HOLE_HOT2 = 0x5c9cff, HOLE_DEEP = 0x03060f;
const add = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o });

function makeHole(r) {
  const g = new THREE.Group();
  const CY = r * 0.62;                       // the core floats a little above the ground
  const spin = [];                           // things that turn, each at its own rate

  // --- the ground: a dark well, radial streaks, and a scratched ring with tick marks
  const well = new THREE.Mesh(new THREE.CircleGeometry(r, 44),
    new THREE.MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0.86, depthWrite: false }));
  well.rotation.x = -Math.PI / 2; well.position.y = 0.12; g.add(well);

  const streaks = new THREE.Group(); streaks.position.y = 0.16;
  for (let i = 0; i < 14; i++) {
    const len = r * (0.45 + Math.random() * 0.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.3 + Math.random() * 0.5),
      add(i % 3 ? HOLE_DEEP : HOLE_HOT, { opacity: 0.16 + Math.random() * 0.16 }));
    m.rotation.x = -Math.PI / 2;
    const a2 = (i / 14) * Math.PI * 2;
    m.position.set(Math.sin(a2) * (r - len / 2) * 0.92, 0, Math.cos(a2) * (r - len / 2) * 0.92);
    m.rotation.z = -a2;
    streaks.add(m);
  }
  g.add(streaks); spin.push({ o: streaks, s: 0.5 });

  const rune = new THREE.Mesh(new THREE.RingGeometry(r * 0.93, r, 60), add(HOLE_HOT, { opacity: 0.38 }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.18; g.add(rune);
  const ticks = new THREE.Group(); ticks.position.y = 0.19;
  for (let i = 0; i < 12; i++) {
    const t2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, r * 0.13), add(HOLE_HOT2, { opacity: 0.42 }));
    t2.rotation.x = -Math.PI / 2;
    const a2 = (i / 12) * Math.PI * 2;
    t2.position.set(Math.sin(a2) * r * 1.03, 0, Math.cos(a2) * r * 1.03);
    t2.rotation.z = -a2;
    ticks.add(t2);
  }
  g.add(ticks); spin.push({ o: ticks, s: -0.22 });

  // --- the core: black ball, hot ring around its middle, faint bubble outside
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0x000103 }));
  core.position.y = CY; g.add(core);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.3, r * 0.055, 10, 40), add(HOLE_HOT, { opacity: 0.72 }));
  ring.position.y = CY; ring.rotation.x = Math.PI / 2.35; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(r * 0.38, r * 0.022, 8, 40), add(HOLE_HOT2, { opacity: 0.5 }));
  ring2.position.y = CY; ring2.rotation.x = Math.PI / 2.35; g.add(ring2);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 0.29, 16, 12), add(HOLE_HOT, { opacity: 0.13 }));
  glow.position.y = CY; g.add(glow);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(r * 0.52, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x24509e, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  shell.position.y = CY; g.add(shell);

  // --- dark tendrils of matter, wound round the core at different tilts
  const tendrils = [];
  for (let i = 0; i < 5; i++) {
    const rr = r * (0.34 + i * 0.075);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(rr, r * (0.05 - i * 0.006), 6, 26, Math.PI * (0.8 + Math.random() * 0.7)),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x1b0a33 : 0x3b1170, transparent: true, opacity: 0.85, depthWrite: false }));
    t2.position.y = CY;
    t2.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 1.1, Math.random() * 6.28, Math.random() * 6.28);
    g.add(t2); tendrils.push({ m: t2, s: (i % 2 ? 1 : -1) * (0.7 + i * 0.35) });
  }

  // --- sparks falling inward, and bolts flicking up out of the well
  const N = 54, pos = new Float32Array(N * 3), seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    seeds[i * 3] = Math.random() * 6.28;                       // angle
    seeds[i * 3 + 1] = 0.25 + Math.random() * 0.75;            // how far out it starts
    seeds[i * 3 + 2] = 0.35 + Math.random() * 0.9;             // how fast it falls in
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: HOLE_HOT2, size: r * 0.075, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(sparks);

  const bolts = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.16, r * 0.75), add(HOLE_HOT2, { opacity: 0 }));
    b.position.y = CY; g.add(b); bolts.push(b);
  }

  g.userData = { spin, tendrils, core, ring, ring2, glow, shell, sparks, seeds, bolts, well, rune, r, CY };
  return g;
}

/* ---------------- the flourish when a power is let off ----------------
   Every power throws the same shape of burst from the tank that used it, in
   its own colour: a ring that races out along the ground, a column of light
   that shoots up and fades, and a scatter of shards thrown outward. Powers
   that are placed somewhere also get a second, smaller burst where they land. */
export const AB_COLOR = {
  wall:   0xc9b28a,   // stone
  drone:  0xff9a3a,   // engine orange
  dome:   0x8fe8ff,   // shield blue
  cloak:  0x9fd8ff,   // pale shimmer
  homing: 0xffc04a,   // rocket flame
  freeze: 0x9fe4ff,   // frost
  heal:   0x7ef08a,   // green cross
  hole:   0x3a6fe0,   // deep blue, to match the void it opens
};
function makeCast(col) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 40), add(col, { opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), add(col, { opacity: 0.55 }));
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.2; g.add(ring2);
  const col3 = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, 4.4, 14, 1, true),
    add(col, { opacity: 0.55, side: THREE.DoubleSide }));
  col3.position.y = 2.2; g.add(col3);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), add(col, { opacity: 0.85 }));
  flash.position.y = 1.5; g.add(flash);
  const shards = [];
  for (let i = 0; i < 9; i++) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.85), add(col, { opacity: 0.9 }));
    const a = (i / 9) * Math.PI * 2 + Math.random();
    sh.userData = { a, up: 0.5 + Math.random() * 1.5, sp: 7 + Math.random() * 7 };
    sh.position.y = 1.2; g.add(sh); shards.push(sh);
  }
  g.userData = { ring, ring2, col3, flash, shards };
  return g;
}

/* ---------------- guided shell ---------------- */
function makeMissile() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.5, 10), M(0xdfe4ea));
  b.rotation.x = Math.PI / 2; g.add(b);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.7, 10), M(0xff6250)); tip.rotation.x = Math.PI / 2; tip.position.z = 1.1; g.add(tip);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.45), M(0xb8bec7)); f.position.z = -0.6; f.rotation.z = i * Math.PI / 2; f.position.y = 0; g.add(f); }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.85, depthWrite: false }));
  fire.rotation.x = -Math.PI / 2; fire.position.z = -1.2; g.add(fire);
  g.userData = { fire };
  return g;
}

/* ---------------- suicide car ---------------- */
function makeDrone(team) {
  const g = new THREE.Group(), col = TEAM_HEX[team] || TEAM_HEX[''];
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 2.1), M(0x555a60)); body.position.y = 0.55; body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 1.0), M(0x3f444a)); top.position.set(0, 1.0, -0.15); g.add(top);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.8), M(0xb04a2a)); crate.position.set(0, 1.05, 0.55); g.add(crate);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10), M(0x1f2124));
    w.rotation.z = Math.PI / 2; w.position.set(sx * 0.66, 0.3, sz * 0.72); g.add(w);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), new THREE.MeshBasicMaterial({ color: col }));
  light.position.set(0, 1.42, 0.55); g.add(light);
  g.userData = { light, col };
  return g;
}

/* ---------------- freeze cage (added to a tank) ---------------- */
export function makeCage() {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.75, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2, bar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 3.3, 5), m);
    bar.position.set(Math.sin(a) * 2.6, 1.65, Math.cos(a) * 2.6); g.add(bar);
  }
  for (const y of [0.15, 1.65, 3.2]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.075, 5, 22), m); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r);
  }
  const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(3.0, 0), new THREE.MeshBasicMaterial({ color: 0xcdf0ff, transparent: true, opacity: 0.16, depthWrite: false }));
  ice.position.y = 1.5; g.add(ice);
  g.userData = { m };
  return g;
}

/* ---------------- the ghost you see while choosing where to put it ---------------- */
function makeGhost() {
  const g = new THREE.Group();
  const lineG = new THREE.Group(); g.add(lineG);          // a wrapper so we can turn it with one angle
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, transparent: true, opacity: 0.5, depthWrite: false }));
  line.rotation.x = -Math.PI / 2; lineG.add(line);
  const spot = new THREE.Group(); g.add(spot);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, transparent: true, opacity: 0.9, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, transparent: true, opacity: 0.14, depthWrite: false }));
  ring.rotation.x = fill.rotation.x = -Math.PI / 2; fill.position.y = -0.01; spot.add(fill, ring);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 2.1, 0.8), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, transparent: true, opacity: 0.3, depthWrite: false }));
  bar.position.y = 1.05; spot.add(bar);
  const tipG = new THREE.Group(); g.add(tipG);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 3), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, transparent: true, opacity: 0.85, depthWrite: false }));
  tip.rotation.x = Math.PI / 2; tipG.add(tip);
  g.userData = { line, lineG, spot, ring, fill, bar, tip, tipG };
  g.visible = false;
  return g;
}

/* =====================================================================
   The manager: keeps the meshes in step with what the server sent.
   ===================================================================== */
export class AbilityFx {
  constructor(scene, groundY) {
    this.S = scene; this.gy = groundY; this.walls = new Map(); this.domes = new Map(); this.holes = new Map(); this.ms = new Map(); this.dr = new Map(); this.t = 0;
    this.casts = [];                      // short-lived 'power let off' bursts
    this.ghost = makeGhost(); scene.add(this.ghost);
  }
  /** Show where the power would land. `p` = null hides it.
      p: { kind:'ground'|'dir', ab, x, z, a, r, len, fromX, fromZ } */
  showGhost(p) {
    const g = this.ghost, u = g.userData;
    if (!p) { g.visible = false; return; }
    g.visible = true;
    const y = this.gy(p.x, p.z) + 0.12;
    const d = Math.hypot(p.x - p.fromX, p.z - p.fromZ);
    // the dotted line from the tank out to the spot
    u.lineG.visible = true;
    u.line.scale.set(1, Math.max(0.1, d), 1);
    u.lineG.position.set((p.x + p.fromX) / 2, this.gy(p.fromX, p.fromZ) + 0.1, (p.z + p.fromZ) / 2);
    u.lineG.rotation.y = p.a;
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 7);
    if (p.kind === 'ground') {
      u.spot.visible = true; u.tipG.visible = false;
      u.spot.position.set(p.x, y, p.z);
      u.spot.rotation.y = p.a;
      const r = p.r || 2.5;
      u.ring.scale.setScalar(r); u.fill.scale.setScalar(r);
      u.ring.material.opacity = 0.9 * pulse;
      u.bar.visible = !!p.len;
      if (p.len) u.bar.scale.set(p.len, 1, 1);
    } else {                                   // a direction: an arrow in front of the tank
      u.spot.visible = false; u.tipG.visible = true;
      u.tipG.position.set(p.x, this.gy(p.x, p.z) + 0.9, p.z);
      u.tipG.rotation.y = p.a;
      u.tip.material.opacity = 0.85 * pulse;
    }
  }

  clear() {
    if (this.audio) this.audio.rocketsOff();
    for (const M2 of [this.walls, this.domes, this.holes, this.ms, this.dr]) { for (const o of M2.values()) this.S.remove(o.g); M2.clear(); }
    for (const c of this.casts) this.S.remove(c.g);
    this.casts.length = 0;
    this.showGhost(null);
  }
  /** Throw the "a power went off here" burst. `scale` shrinks it for the landing spot. */
  cast(ab, x, y, z, scale = 1) {
    const col = AB_COLOR[ab] || 0xffd23a;
    const g = makeCast(col);
    g.position.set(x, y, z); g.scale.setScalar(scale);
    this.S.add(g);
    this.casts.push({ g, born: this.t, life: 0.55, base: scale });
    if (this.casts.length > 14) { const old2 = this.casts.shift(); this.S.remove(old2.g); }   // never pile up
  }
  /** Walls, domes and holes, from the server's 'fx' message. */
  setFx(msg) {
    this.sync(this.walls, msg.w || [], (w) => makeWall(w.len, w.tm), (o, w) => {
      o.g.position.set(w.x, this.gy(w.x, w.z), w.z); o.g.rotation.y = w.a;
      const k = Math.max(0, Math.min(1, w.hp / w.mhp));            // a battered wall goes darker
      if (o.hp === undefined || Math.abs(o.hp - k) > 0.06) {
        o.hp = k; const g = Math.round(0x8b * (0.45 + 0.55 * k)), g2 = Math.round(0x84 * (0.45 + 0.55 * k));
        o.g.userData.body.material.color.setHex((g << 16) | (Math.round(0x8d * (0.45 + 0.55 * k)) << 8) | g2);
      }
    });
    this.sync(this.domes, msg.d || [], (d) => makeDome(d.r, d.tm), (o, d) => o.g.position.set(d.x, this.gy(d.x, d.z), d.z));
    this.sync(this.holes, msg.h || [], (h) => makeHole(h.r), (o, h) => { o.g.position.set(h.x, this.gy(h.x, h.z), h.z); o.r = h.r; }, 0.36);
  }
  /** `linger` seconds lets a thing play a closing animation after the server drops it. */
  sync(map, list, make, place, linger = 0) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let o = map.get(it.id);
      if (!o) { o = { g: make(it), born: this.t }; this.S.add(o.g); map.set(it.id, o); o.fresh = true; }
      o.dying = 0;                                   // it came back (or never really went)
      place(o, it);
    }
    for (const [id, o] of map) {
      if (seen.has(id)) continue;
      if (!linger) { this.S.remove(o.g); map.delete(id); continue; }
      if (!o.dying) { o.dying = this.t; o.linger = linger; }   // start collapsing; frame() drops it
    }
  }
  /** Guided shells and suicide cars, from the streamed 'ae' message. */
  setEntities(msg) {
    // rows: missile [id, x, z, angle, owner] · car [id, x, z, angle, hp%, owner, isRed]
    this.syncMoving(this.ms, msg.m || [], () => makeMissile(), 4, 5);
    this.syncMoving(this.dr, msg.d || [], (row) => makeDrone(row[6] ? 'red' : 'blue'), 5);
  }
  syncMoving(map, rows, make, ownerAt, spdAt) {
    const seen = new Set();
    for (const row of rows) {
      const [id, x, z, a] = row; seen.add(id);
      let o = map.get(id);
      if (!o) {
        o = { g: make(row), x, z, a }; this.S.add(o.g); map.set(id, o);
        // a rocket appearing starts its own flight sound, which lives exactly as long as it does
        if (spdAt !== undefined && this.audio) this.audio.rocketOn(id);
      }
      o.tx = x; o.tz = z; o.ta = a; o.owner = row[ownerAt];
      if (spdAt !== undefined) o.spd = row[spdAt] || 0;
      if (ownerAt === 5) o.hpPct = row[4];
    }
    for (const [id, o] of map) if (!seen.has(id)) {
      this.S.remove(o.g); map.delete(id);
      if (spdAt !== undefined && this.audio) this.audio.rocketOff(id);   // gone: stop it at once
    }
  }
  /** Where one of my guided shells is right now (for the camera to ride it). */
  myMissile(myId) { for (const o of this.ms.values()) if (o.owner === myId) return o; return null; }

  frame(dt, t) {
    this.t = t;
    const f = 1 - Math.exp(-dt * 14);
    for (const [id, o] of this.ms) {
      o.x = lerp(o.x, o.tx ?? o.x, f); o.z = lerp(o.z, o.tz ?? o.z, f); o.a = lerpAngle(o.a, o.ta ?? o.a, f);
      o.g.position.set(o.x, this.gy(o.x, o.z) + 1.8, o.z); o.g.rotation.y = o.a;
      // the flame stretches as it picks up speed, and so does the noise it makes
      const s01 = Math.max(0, Math.min(1, ((o.spd || 10) - 9) / 32));
      o.g.userData.fire.scale.set(1, 0.7 + s01 * 0.9 + Math.random() * 0.5, 1);
      if (this.audio) this.audio.rocketAt(id, o, s01, o.owner === this.myId);
    }
    for (const o of this.dr.values()) {
      o.x = lerp(o.x, o.tx ?? o.x, f); o.z = lerp(o.z, o.tz ?? o.z, f); o.a = lerpAngle(o.a, o.ta ?? o.a, f);
      o.g.position.set(o.x, this.gy(o.x, o.z), o.z); o.g.rotation.y = o.a;
      o.g.userData.light.visible = Math.sin(t * 16) > 0;          // blinking, so you notice it coming
    }
    for (const o of this.domes.values()) {
      const u = o.g.userData;
      u.wire.rotation.y = t * 0.25;
      u.skin.material.opacity = 0.1 + 0.04 * Math.sin(t * 3);
      const pop = Math.min(1, (t - o.born) * 6); o.g.scale.setScalar(0.3 + 0.7 * pop);
    }
    for (const [id, o] of this.holes) {
      // one that finished collapsing is dropped here, not in sync(), because the server stops
      // telling us about it the moment it goes — there is no later message to clean it up on
      if (o.dying && t - o.dying > (o.linger || 0)) { this.S.remove(o.g); this.holes.delete(id); continue; }
      const u = o.g.userData, r = u.r;
      // it opens with a snap, then breathes
      const age = t - o.born, pop = Math.min(1, age * 4.5);
      const ease = 1 - Math.pow(1 - pop, 3);
      // a hole the server has taken away collapses in on itself before it is dropped
      const die = o.dying ? Math.min(1, (t - o.dying) * 3.4) : 0;
      const k = ease * (1 - die);
      o.g.scale.setScalar(Math.max(0.001, k));
      o.g.visible = k > 0.002;

      for (const sp of u.spin) sp.o.rotation.y += dt * sp.s;
      for (const td of u.tendrils) { td.m.rotation.z += dt * td.s; td.m.rotation.y += dt * td.s * 0.45; }
      u.core.rotation.y += dt * 1.6;
      u.ring.rotation.z += dt * 2.4; u.ring2.rotation.z -= dt * 3.1;
      const breathe = 1 + 0.07 * Math.sin(t * 7);
      u.glow.scale.setScalar(breathe);
      u.shell.scale.setScalar(1 + 0.04 * Math.sin(t * 4.2 + 1));
      u.rune.material.opacity = (0.4 + 0.25 * Math.sin(t * 5)) * (1 - die);
      u.well.material.opacity = 0.72 * (1 - die * 0.6);

      // sparks spiral inward and are swallowed, then start again from the rim
      const P = u.sparks.geometry.attributes.position, sd = u.seeds, n = P.count;
      for (let i = 0; i < n; i++) {
        const base = sd[i * 3], out0 = sd[i * 3 + 1], sp = sd[i * 3 + 2];
        const cyc = ((t * sp * 0.55) + out0) % 1;              // 0 just swallowed, 1 out at the rim
        const rad = r * 0.52 * (1 - cyc) + r * 0.08;
        const ang = base + t * (1.4 + sp) + (1 - cyc) * 5.5;   // winds up as it falls in
        P.setXYZ(i, Math.sin(ang) * rad, u.CY + Math.sin(base * 3 + t * 1.7) * r * 0.16 * cyc, Math.cos(ang) * rad);
      }
      P.needsUpdate = true;
      u.sparks.material.opacity = 0.9 * (1 - die);

      // the odd bolt of energy flicking up out of the well
      u.bolts.forEach((b, i) => {
        const ph = (t * 1.7 + i * 0.37) % 1;
        const on = ph < 0.13 ? 1 - ph / 0.13 : 0;
        b.material.opacity = on * 0.85 * (1 - die);
        if (on > 0) {
          const a2 = (i * 2.1 + Math.floor(t * 1.7 + i * 0.37) * 1.3);
          b.position.set(Math.sin(a2) * r * 0.3, u.CY + r * 0.45, Math.cos(a2) * r * 0.3);
          b.rotation.set(0, a2, (Math.random() - 0.5) * 0.5);
          b.scale.set(1, 0.7 + Math.random() * 0.7, 1);
        }
      });
    }
    for (const o of this.walls.values()) { const pop = Math.min(1, (t - o.born) * 7); o.g.scale.y = 0.15 + 0.85 * pop; }
    // the burst thrown when a power is let off: everything races outward and fades in ~0.55 s
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i], k = (t - c.born) / c.life;
      if (k >= 1) { this.S.remove(c.g); this.casts.splice(i, 1); continue; }
      const u = c.g.userData, fade = 1 - k, ease = 1 - Math.pow(1 - k, 2);
      u.ring.scale.setScalar(1 + ease * 7); u.ring.material.opacity = 0.9 * fade;
      u.ring2.scale.setScalar(1 + ease * 4.2); u.ring2.material.opacity = 0.55 * fade * fade;
      u.col3.scale.set(1 - k * 0.55, 0.35 + ease * 1.5, 1 - k * 0.55);
      u.col3.material.opacity = 0.55 * fade * fade;
      u.flash.scale.setScalar(1.3 - k); u.flash.material.opacity = 0.85 * Math.pow(fade, 3);
      for (const sh of u.shards) {
        const d = ease * sh.userData.sp;
        sh.position.set(Math.sin(sh.userData.a) * d, 1.2 + sh.userData.up * ease * 2.4 - ease * ease * 3, Math.cos(sh.userData.a) * d);
        sh.rotation.set(sh.userData.a, sh.userData.a * 2 + k * 6, 0);
        sh.material.opacity = 0.9 * fade;
      }
    }
  }
  /** Minimap dots for the things players should be able to see coming. */
  marks(out) {
    for (const o of this.dr.values()) out.push({ x: o.x, z: o.z, col: '#ff9a3a', r: 0.05 });
    for (const o of this.holes.values()) if (!o.dying) out.push({ x: o.g.position.x, z: o.g.position.z, col: '#5c9cff', r: 0.05 });
    for (const o of this.domes.values()) out.push({ x: o.g.position.x, z: o.g.position.z, col: '#8fe8ff', r: 0.04 });
  }
}
