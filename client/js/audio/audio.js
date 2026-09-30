/* Procedural audio (Web Audio API, no sound files to load).
   Everything is synthesised from layers — a transient "crack", a body,
   a sub-bass thump and a reverb tail — then glued by a compressor, so
   guns and blasts feel heavy without any downloads.
   Also: UI sounds (click, whoosh, coins, reward jingle, chest, wheel ticks,
   level up), an engine with a rumbling idle, and a menu music loop in a
   Kurdish-flavoured scale (daf drum + tembûr-like pluck + drone). */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class GameAudio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.45, sfx: 0.9, mute: false }; this.listener = { x: 0, z: 0 }; this.musicOn = false; this.last = {}; this.rk = new Map(); }
  // Browsers only allow audio after a user gesture — call this from a click/tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
      this.master.connect(this.comp); this.comp.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.ui = c.createGain(); this.ui.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      // reverb send (a synthetic room/outdoor slap impulse)
      this.rev = c.createConvolver(); this.rev.buffer = this.impulse(1.6, 2.6);
      this.revIn = c.createGain(); this.revIn.gain.value = 0.35; this.revIn.connect(this.rev); this.rev.connect(this.sfx);
      const len = c.sampleRate; const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
      // brown noise for rumbles
      const bb = c.createBuffer(1, len, c.sampleRate), bd = bb.getChannelData(0); let l = 0;
      for (let i = 0; i < len; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = l * 3.5; }
      this.brown = bb;
      this.dist = c.createWaveShaper(); this.dist.curve = this.curve(2.2); this.dist.connect(this.sfx);
      this.apply();
      this.startEngine();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) { const k = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * (i < 400 ? i / 400 : 1); } }
    return b;
  }
  curve(k) { const n = 1024, a = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; a[i] = Math.tanh(k * x) / Math.tanh(k); } return a; }
  setVolumes(v) { Object.assign(this.vol, v); this.apply(); }
  apply() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.mute ? 0 : this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ui.gain.setTargetAtTime(this.vol.sfx * 0.8, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 1.1, t, 0.2);
  }
  // Distance attenuation, stereo pan and a muffled high end for far sounds.
  spatial(pos, bus) {
    const c = this.ctx, g = c.createGain();
    if (!pos) { g.connect(bus || this.sfx); return { out: g, far: 0 }; }
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, d = Math.hypot(dx, dz);
    g.gain.value = clamp(1 / (1 + d / 14), 0, 1) * (d > 95 ? 0 : 1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(16000 / (1 + d / 12), 700, 16000);
    g.connect(lp);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(dx / 30, -0.8, 0.8); lp.connect(p); p.connect(this.sfx); }
    else lp.connect(this.sfx);
    return { out: g, far: clamp(d / 60, 0, 1) };
  }
  src(buf, dur, t, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); return s; }
  env(g, t0, peak, attack, decay, curve = 'exp') {
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    else g.gain.setTargetAtTime(0.0001, t0 + attack, decay / 4);
  }
  // Building blocks -------------------------------------------------------
  tone(out, type, f0, f1, t, dur, peak, att = 0.004, det = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.detune.value = det;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, peak, att, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + att + dur + 0.05); return g;
  }
  noiseHit(out, type, f0, f1, t, dur, peak, q = 0.8, att = 0.003, buf = null, rate = 1) {
    const c = this.ctx, s = this.src(buf || this.noise, dur + att, t, rate), f = c.createBiquadFilter(), g = c.createGain(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, att, dur); s.connect(f); f.connect(g); g.connect(out); return g;
  }
  bell(out, f, t, dur, peak, partials = [1, 2.76, 5.4]) { partials.forEach((p, i) => this.tone(out, 'sine', f * p, f * p, t, dur / (1 + i * 0.6), peak / (1 + i * 1.4), 0.002)); }
  // Stop the same sound from piling up (e.g. 6 cannons in one frame).
  gate(name, ms) { const n = performance.now(); if (this.last[name] && n - this.last[name] < ms) return false; this.last[name] = n; return true; }

  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime + 0.005;
    const UI = ['click', 'tab', 'whoosh', 'coin', 'gem', 'reward', 'chestShake', 'chestOpen', 'wheelTick', 'win', 'levelup', 'error', 'deny', 'card', 'pop', 'matchWin', 'matchLose', 'matchDraw'];
    if (UI.includes(name)) return this.playUI(name, vol);
    const { out, far } = this.spatial(pos);
    const wet = (g, amt) => { const s = c.createGain(); s.gain.value = amt; g.connect(s); s.connect(this.revIn); };
    switch (name) {
      case 'cannon': {
        if (!this.gate('cannon' + (pos ? 'r' : 'm'), 35)) return;
        const v = vol * (1 - far * 0.3);
        const crack = this.noiseHit(out, 'bandpass', 3800, 1200, t, 0.07, 0.9 * v, 0.9, 0.001);           // sharp crack
        const body = this.noiseHit(out, 'lowpass', 2600, 180, t, 0.55, 1.0 * v, 0.7, 0.002);              // blast body
        const sub = this.tone(out, 'sine', 120, 34, t, 0.42, 1.1 * v, 0.002);                              // chest thump
        this.tone(this.dist, 'triangle', 70, 30, t, 0.3, 0.35 * v * (pos ? 0.4 : 1), 0.002);                // gritty punch
        this.noiseHit(out, 'lowpass', 500, 90, t + 0.05, 1.1, 0.35 * v, 0.5, 0.05, this.brown);            // rumble tail
        wet(body, 0.9); wet(crack, 0.6); wet(sub, 0.2);
        // shell casing clink after a moment (own gun only)
        if (!pos) this.bell(out, 1650, t + 0.32, 0.18, 0.05 * v, [1, 2.4]);
        break;
      }
      case 'reload': {                                               // breech: two metallic clacks + a latch
        for (const [dt, f, p] of [[0, 2600, 0.4], [0.11, 1800, 0.45], [0.2, 3400, 0.25]]) this.noiseHit(out, 'bandpass', f, f * 0.8, t + dt, 0.045, p * vol, 5, 0.001);
        this.tone(out, 'square', 180, 120, t + 0.11, 0.06, 0.06 * vol);
        this.bell(out, 900, t + 0.11, 0.12, 0.04 * vol, [1, 2.9]);
        break;
      }
      case 'impact': {                                               // shell hits the ground / a wall
        if (!this.gate('impact', 30)) return;
        const b = this.noiseHit(out, 'lowpass', 1800, 160, t, 0.45, 0.8 * vol, 0.6, 0.002);
        this.tone(out, 'sine', 95, 40, t, 0.25, 0.7 * vol);
        this.noiseHit(out, 'highpass', 2500, 5000, t + 0.03, 0.25, 0.12 * vol, 0.5, 0.02);                 // falling grit
        wet(b, 0.7);
        break;
      }
      case 'guidedImpact': {                                         // Safeen's rocket going in
        // Its own detonation, built from scratch rather than the shell impact turned up: a hard
        // crack off the front, a deep thump you feel, a short heavy rumble and debris after it.
        const v = vol * (1 - far * 0.2);
        this.noiseHit(out, 'highpass', 4200, 2600, t, 0.05, 1.0 * v, 0.9, 0.0008);                   // the crack
        this.noiseHit(out, 'bandpass', 2200, 700, t, 0.18, 0.95 * v, 0.7, 0.001);                    // body of the blast
        this.tone(out, 'sine', 150, 28, t, 0.7, 1.25 * v, 0.002);                                     // the thump
        this.tone(this.dist, 'sawtooth', 80, 26, t, 0.4, 0.3 * v * (pos ? 0.5 : 1), 0.002);           // grit
        this.noiseHit(out, 'lowpass', 500, 70, t + 0.06, 1.7, 0.6 * v, 0.45, 0.12, this.brown);       // rumble
        for (let i = 0; i < 8; i++)                                                                   // debris cracking off
          this.noiseHit(out, 'bandpass', 2000 + Math.random() * 3400, 900, t + 0.14 + Math.random() * 0.7, 0.035, 0.16 * v, 6, 0.001);
        wet(this.tone(out, 'sine', 60, 40, t + 0.05, 1.0, 0.3 * v, 0.01), 0.5);                       // tail into the reverb
        break;
      }
      case 'explosion': {                                            // a tank blows up
        if (!this.gate('explosion', 60)) return;
        const v = vol * (1 - far * 0.25);
        const a = this.noiseHit(out, 'bandpass', 3000, 900, t, 0.09, 0.9 * v, 0.8, 0.001);
        const b = this.noiseHit(out, 'lowpass', 2400, 90, t, 1.5, 1.0 * v, 0.6, 0.004);
        this.tone(out, 'sine', 75, 24, t, 1.1, 1.2 * v, 0.004);
        this.tone(this.dist, 'sawtooth', 55, 22, t, 0.5, 0.25 * v * (pos ? 0.5 : 1), 0.003);
        this.noiseHit(out, 'lowpass', 380, 60, t + 0.1, 2.4, 0.55 * v, 0.4, 0.2, this.brown);                // long rolling rumble
        for (let i = 0; i < 6; i++) this.noiseHit(out, 'bandpass', 1800 + Math.random() * 3000, 900, t + 0.25 + Math.random() * 0.9, 0.04, 0.12 * v, 6, 0.001); // debris crackle
        wet(b, 1.1); wet(a, 0.8);
        break;
      }
      case 'deflect': {                                              // ricochet: metal ping that whizzes off
        this.bell(out, 2100, t, 0.35, 0.22 * vol, [1, 1.47, 2.83]);
        this.tone(out, 'sine', 2600, 900, t + 0.02, 0.28, 0.08 * vol);
        this.noiseHit(out, 'bandpass', 4200, 2600, t, 0.05, 0.3 * vol, 3, 0.001);
        break;
      }
      case 'hitmark': {                                              // you hit someone: crisp double tick
        this.tone(this.ui, 'sine', 2300, 2300, t, 0.05, 0.16 * vol, 0.001);
        this.tone(this.ui, 'sine', 3450, 3450, t + 0.045, 0.07, 0.12 * vol, 0.001);
        this.noiseHit(this.ui, 'highpass', 6000, 6000, t, 0.025, 0.08 * vol, 0.7, 0.001);
        break;
      }
      case 'hurt': {                                                 // you got hit: heavy metal clang + muffled thud
        this.noiseHit(out, 'lowpass', 900, 120, t, 0.3, 0.7 * vol, 0.7, 0.002);
        this.bell(out, 330, t, 0.45, 0.2 * vol, [1, 2.32, 4.25, 6.8]);
        this.tone(out, 'sine', 90, 45, t, 0.2, 0.5 * vol);
        break;
      }
      case 'spawn': {                                                // rising "ready" chime
        [523, 659, 784].forEach((f, i) => this.tone(this.ui, 'triangle', f, f, t + i * 0.07, 0.35, 0.09 * vol, 0.01));
        this.tone(this.ui, 'sine', 1046, 1046, t + 0.21, 0.5, 0.05 * vol, 0.02);
        break;
      }
      case 'pickup': {                                               // power-up / reward: sparkly two-step arpeggio
        [660, 880, 1320].forEach((f, i) => this.tone(pos ? out : this.ui, 'triangle', f, f * 1.01, t + i * 0.06, 0.22, 0.14 * vol, 0.004));
        this.bell(pos ? out : this.ui, 1760, t + 0.18, 0.4, 0.06 * vol);
        break;
      }
      case 'rocket': {                                               // launch: soft thump + rising hiss
        const g = this.noiseHit(out, 'bandpass', 700, 2600, t, 0.5, 0.45 * vol, 1.2, 0.01); wet(g, 0.4);
        this.tone(out, 'sine', 140, 60, t, 0.2, 0.5 * vol);
        this.noiseHit(out, 'highpass', 3000, 6000, t + 0.05, 0.6, 0.12 * vol, 0.6, 0.05);
        break;
      }
      case 'crash': {                                                // wood breaking: cracks + thud
        if (!this.gate('crash', 40)) return;
        for (let i = 0; i < 4; i++) this.noiseHit(out, 'bandpass', 1800 + Math.random() * 1500, 700, t + i * 0.035, 0.07, 0.35 * vol, 3, 0.001);
        this.tone(out, 'sine', 180, 70, t, 0.15, 0.3 * vol); break;
      }
      case 'crumble': {                                              // stone / sandbags collapsing
        if (!this.gate('crumble', 60)) return;
        this.noiseHit(out, 'lowpass', 900, 150, t, 0.6, 0.5 * vol, 0.7, 0.01, this.brown);
        for (let i = 0; i < 6; i++) this.noiseHit(out, 'bandpass', 900 + Math.random() * 900, 500, t + 0.05 + i * 0.06, 0.05, 0.18 * vol, 4, 0.001); break;
      }
      case 'freeze': {                                               // the freeze cage snaps shut: glassy chime + frost hiss
        this.bell(out, 1900, t, 0.5, 0.09 * vol, [1, 2.4, 4.1]); this.bell(out, 2600, t + 0.06, 0.4, 0.05 * vol, [1, 2.8]);
        const h = this.noiseHit(out, 'highpass', 4200, 1800, t, 0.5, 0.11 * vol, 0.7, 0.01); wet(h, 0.7);
        this.tone(out, 'sine', 700, 180, t, 0.35, 0.05 * vol, 0.004);
        break;
      }
      case 'cloak': {                                                // vanishing: a falling shimmer
        this.tone(out, 'sine', 1400, 320, t, 0.45, 0.07 * vol, 0.004);
        const h = this.noiseHit(out, 'bandpass', 3000, 700, t, 0.45, 0.07 * vol, 1.2, 0.02); wet(h, 0.8);
        this.bell(out, 1200, t + 0.02, 0.3, 0.035 * vol, [1, 2.2]);
        break;
      }
      case 'dome': {                                                 // the bubble goes up: soft swell
        const g = this.tone(out, 'sine', 90, 150, t, 0.9, 0.12 * vol, 0.12); wet(g, 0.9);
        this.tone(out, 'triangle', 300, 480, t, 0.7, 0.05 * vol, 0.15);
        this.bell(out, 640, t + 0.1, 0.6, 0.045 * vol, [1, 2.01, 3.1]);
        break;
      }
      case 'blackhole': {                                            // a deep, rising pull
        const g = this.tone(out, 'sine', 40, 150, t, 1.5, 0.16 * vol, 0.3); wet(g, 1);
        this.tone(this.dist, 'triangle', 60, 200, t, 1.3, 0.07 * vol, 0.35);
        const h = this.noiseHit(out, 'lowpass', 300, 1400, t, 1.4, 0.1 * vol, 0.6, 0.4, this.brown); wet(h, 0.9);
        break;
      }
      case 'abWall': {                                              // stone slabs slam up out of the ground
        const g = this.tone(out, 'sine', 120, 42, t, 0.5, 0.16 * vol, 0.004); wet(g, 0.5);
        this.noiseHit(out, 'lowpass', 900, 280, t, 0.35, 0.16 * vol, 0.9, 0.002);
        this.noiseHit(out, 'bandpass', 2200, 900, t + 0.04, 0.22, 0.09 * vol, 1.6, 0.002);
        this.tone(this.dist, 'square', 70, 50, t, 0.22, 0.05 * vol, 0.002);
        break;
      }
      case 'abMissile': {                                           // launch: hard thump then a climbing whistle
        this.noiseHit(out, 'lowpass', 700, 200, t, 0.22, 0.17 * vol, 0.8, 0.002);
        const h = this.noiseHit(out, 'bandpass', 1100, 4200, t, 0.75, 0.1 * vol, 1.1, 0.02); wet(h, 0.5);
        this.tone(out, 'sawtooth', 300, 1500, t + 0.02, 0.6, 0.05 * vol, 0.03);
        break;
      }
      case 'abDrone': {                                             // the little car: starter whirr + warning beeps
        this.tone(out, 'sawtooth', 160, 420, t, 0.45, 0.07 * vol, 0.02, 6);
        this.noiseHit(out, 'bandpass', 1800, 2600, t, 0.4, 0.06 * vol, 2.2, 0.01);
        this.tone(out, 'square', 1600, 1600, t + 0.12, 0.07, 0.05 * vol);
        this.tone(out, 'square', 1600, 1600, t + 0.28, 0.07, 0.05 * vol);
        break;
      }
      case 'abHeal': {                                              // warm rising third, like a field kit opening
        this.tone(out, 'sine', 523, 784, t, 0.5, 0.07 * vol, 0.01);
        this.bell(out, 1046, t + 0.05, 0.55, 0.05 * vol, [1, 2.01, 3.02]);
        const g = this.tone(out, 'triangle', 262, 392, t, 0.6, 0.04 * vol, 0.05); wet(g, 0.8);
        break;
      }
      case 'abFreezeCast': {                                        // frost gathering on the barrel, before the cage
        const h = this.noiseHit(out, 'highpass', 3000, 6500, t, 0.45, 0.09 * vol, 0.8, 0.05); wet(h, 0.6);
        this.tone(out, 'sine', 900, 1800, t, 0.4, 0.05 * vol, 0.03);
        this.bell(out, 2100, t + 0.08, 0.35, 0.04 * vol, [1, 2.6]);
        break;
      }
      case 'rustle': if (!this.gate('rustle', 90)) return; this.noiseHit(out, 'highpass', 2500, 5000, t, 0.25, 0.1 * vol, 0.6, 0.03); break;
      case 'pickup2': break;
    }
  }
  playUI(name, vol) {
    const c = this.ctx, t = c.currentTime + 0.003, O = this.ui;
    switch (name) {
      case 'click':                                                  // soft wooden tap
        if (!this.gate('click', 25)) return;
        this.tone(O, 'sine', 820, 560, t, 0.06, 0.2 * vol, 0.001); this.noiseHit(O, 'bandpass', 2400, 1800, t, 0.025, 0.1 * vol, 2, 0.001); break;
      case 'tab': this.tone(O, 'triangle', 640, 720, t, 0.06, 0.12 * vol, 0.002); break;
      case 'pop': this.tone(O, 'sine', 400, 900, t, 0.08, 0.18 * vol, 0.002); break;
      case 'whoosh':                                                 // panel slides in
        if (!this.gate('whoosh', 120)) return;
        this.noiseHit(O, 'bandpass', 500, 2600, t, 0.22, 0.14 * vol, 1.4, 0.06); break;
      case 'coin':                                                   // one coin landing in the wallet
        this.bell(O, 1976 + Math.random() * 120, t, 0.22, 0.08 * vol, [1, 1.5, 2.9]); break;
      case 'gem': this.bell(O, 2637, t, 0.35, 0.08 * vol, [1, 2.01, 3.3]); this.tone(O, 'sine', 3520, 3520, t + 0.05, 0.3, 0.03 * vol); break;
      case 'card': this.noiseHit(O, 'bandpass', 3000, 1500, t, 0.08, 0.18 * vol, 1.5, 0.002); this.tone(O, 'triangle', 700, 1100, t, 0.1, 0.06 * vol); break;
      case 'reward':                                                 // little fanfare
        [523, 659, 784, 1046].forEach((f, i) => { this.tone(O, 'triangle', f, f, t + i * 0.09, 0.3, 0.12 * vol, 0.005); this.tone(O, 'sine', f * 2, f * 2, t + i * 0.09, 0.2, 0.03 * vol); });
        this.bell(O, 2093, t + 0.36, 0.7, 0.06 * vol); break;
      case 'win':                                                    // wheel win / big reward
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(O, 'triangle', f, f, t + i * 0.08, 0.4, 0.13 * vol, 0.005));
        [784, 988, 1175].forEach(f => this.tone(O, 'sine', f, f, t + 0.42, 0.9, 0.06 * vol, 0.02));
        for (let i = 0; i < 8; i++) this.bell(O, 2000 + Math.random() * 2500, t + 0.45 + i * 0.05, 0.2, 0.025 * vol);
        break;
      // ---- how a match ends. Short stings, not music: they play once, over the result card,
      // and the menu song is never started on top of them.
      case 'matchWin': {                                             // brass call + drum, ~3 s
        const bras = (f, at, dur, p) => { this.tone(O, 'sawtooth', f, f, t + at, dur, 0.055 * p * vol, 0.012, 6);
                                          this.tone(O, 'triangle', f, f, t + at, dur, 0.085 * p * vol, 0.012); };
        [[392, 0, 0.16, 1], [392, 0.17, 0.14, 0.9], [523, 0.32, 0.2, 1], [659, 0.54, 0.22, 1]].forEach(([f, a, d, p]) => bras(f, a, d, p));
        bras(784, 0.78, 1.15, 1.1); bras(1046, 0.78, 1.15, 0.5);      // held top note, with its octave
        this.tone(O, 'sine', 98, 98, t, 0.5, 0.16 * vol, 0.004);      // timpani under the first hit
        this.tone(O, 'sine', 196, 196, t + 0.78, 1.2, 0.07 * vol, 0.02);
        for (let i = 0; i < 9; i++)                                    // a snare roll into the last note
          this.noiseHit(O, 'bandpass', 2400, 2000, t + 0.5 + i * 0.032, 0.035, (0.04 + i * 0.012) * vol, 2.2, 0.001);
        this.noiseHit(O, 'bandpass', 2600, 1400, t + 0.78, 0.25, 0.14 * vol, 1.2, 0.001);
        for (let i = 0; i < 6; i++) this.bell(O, 2100 + Math.random() * 2200, t + 0.95 + i * 0.07, 0.3, 0.022 * vol);
        break;
      }
      case 'matchLose': {                                            // a short, level descent — sober, not glum
        [[440, 0, 0.26], [392, 0.24, 0.26], [330, 0.48, 0.3], [262, 0.76, 1.0]].forEach(([f, a, d]) => {
          this.tone(O, 'triangle', f, f, t + a, d, 0.085 * vol, 0.014);
          this.tone(O, 'sine', f / 2, f / 2, t + a, d, 0.05 * vol, 0.014);
        });
        this.tone(O, 'sine', 131, 110, t + 0.76, 1.1, 0.09 * vol, 0.03);     // low drone settling
        this.noiseHit(O, 'lowpass', 900, 200, t, 0.5, 0.05 * vol, 0.7, 0.05);
        break;
      }
      case 'matchDraw': {                                            // neither one thing nor the other
        [523, 523].forEach((f, i) => this.tone(O, 'triangle', f, f, t + i * 0.2, 0.22, 0.08 * vol, 0.012));
        this.tone(O, 'triangle', 392, 392, t + 0.42, 0.75, 0.08 * vol, 0.014);
        this.tone(O, 'sine', 196, 196, t + 0.42, 0.8, 0.05 * vol, 0.02);
        break;
      }
      case 'levelup':
        [440, 554, 659, 880].forEach((f, i) => this.tone(O, 'sawtooth', f, f, t + i * 0.07, 0.25, 0.05 * vol, 0.004));
        this.tone(O, 'sine', 220, 880, t, 0.5, 0.08 * vol, 0.02); this.bell(O, 1760, t + 0.3, 0.8, 0.07 * vol); break;
      case 'chestShake':                                             // wooden rattle
        for (let i = 0; i < 3; i++) this.noiseHit(O, 'bandpass', 900 + i * 200, 600, t + i * 0.05, 0.05, 0.2 * vol, 3, 0.001);
        this.tone(O, 'sine', 140, 90, t, 0.12, 0.2 * vol); break;
      case 'chestOpen':                                              // lid bursts open: thump + magical rise + sparkle
        this.noiseHit(O, 'lowpass', 1600, 200, t, 0.3, 0.5 * vol, 0.6, 0.002); this.tone(O, 'sine', 110, 50, t, 0.25, 0.5 * vol);
        this.tone(O, 'triangle', 330, 1320, t + 0.05, 0.5, 0.08 * vol, 0.05);
        this.noiseHit(O, 'highpass', 3000, 8000, t + 0.05, 0.6, 0.07 * vol, 0.5, 0.05);
        for (let i = 0; i < 10; i++) this.bell(O, 1500 + Math.random() * 3000, t + 0.15 + i * 0.045, 0.25, 0.03 * vol);
        break;
      case 'wheelTick': this.noiseHit(O, 'bandpass', 3200, 2800, t, 0.018, 0.25 * vol, 4, 0.0005); this.tone(O, 'sine', 1400, 1100, t, 0.03, 0.05 * vol, 0.001); break;
      case 'error': this.tone(O, 'square', 220, 180, t, 0.12, 0.06 * vol); this.tone(O, 'square', 180, 150, t + 0.12, 0.16, 0.06 * vol); break;
      case 'deny': this.tone(O, 'square', 300, 240, t, 0.07, 0.05 * vol); this.tone(O, 'square', 200, 160, t + 0.08, 0.12, 0.05 * vol); break;
    }
  }
  // Engine: two detuned saws + a sub, low-passed, with a throbbing "chug" that speeds up with the tank.
  startEngine() {
    const c = this.ctx;
    this.engBus = c.createGain(); this.engBus.gain.value = 0; this.engBus.connect(this.sfx);
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 260; this.engF.Q.value = 1.8; this.engF.connect(this.engBus);
    this.engAM = c.createGain(); this.engAM.gain.value = 0.7; this.engAM.connect(this.engF);
    this.eng = []; for (const [type, det, g] of [['sawtooth', -9, 0.5], ['sawtooth', 9, 0.5], ['sine', 0, 0.9]]) {
      const o = c.createOscillator(), gg = c.createGain(); o.type = type; o.frequency.value = type === 'sine' ? 21 : 42; o.detune.value = det; gg.gain.value = g; o.connect(gg); gg.connect(this.engAM); o.start(); this.eng.push(o);
    }
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.3; this.lfo.connect(lg); lg.connect(this.engAM.gain); this.lfo.start();
    // track clatter: filtered noise chopped by a fast LFO
    this.trkG = c.createGain(); this.trkG.gain.value = 0; this.trkG.connect(this.sfx);
    this.trk = c.createBufferSource(); this.trk.buffer = this.noise; this.trk.loop = true;
    this.trkF = c.createBiquadFilter(); this.trkF.type = 'bandpass'; this.trkF.frequency.value = 700; this.trkF.Q.value = 1.2;
    this.trkAM = c.createGain(); this.trkAM.gain.value = 0.5;
    this.trk.connect(this.trkF); this.trkF.connect(this.trkAM); this.trkAM.connect(this.trkG); this.trk.start();
    this.trkL = c.createOscillator(); this.trkL.type = 'square'; this.trkL.frequency.value = 12; const tl = c.createGain(); tl.gain.value = 0.5; this.trkL.connect(tl); tl.connect(this.trkAM.gain); this.trkL.start();
  }
  /* ---------------- Safeen's guided rocket ----------------
     One living sound per rocket, started when it appears and stopped the moment it is gone:
     a motor, the air tearing past, and a thin mechanical whine that all climb as it builds up
     speed. It is a loop, not a sound re-triggered every frame — that would both sound wrong and
     leak a node a frame. Everything hangs off one gain node, so stopping is one disconnect.
     Yours is heard head-on, because the camera rides it; everyone else's is placed in the world
     and falls away with distance. */
  rocketOn(id) {
    if (!this.ctx || this.rk.has(id)) return;
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain(); out.gain.value = 0; out.connect(this.sfx);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    if (pan) { lp.connect(pan); pan.connect(out); } else lp.connect(out);
    // motor: two detuned saws with a rough edge
    const m1 = c.createOscillator(), m2 = c.createOscillator();
    m1.type = 'sawtooth'; m2.type = 'sawtooth'; m2.detune.value = 17;
    const mg = c.createGain(); mg.gain.value = 0.28; m1.connect(mg); m2.connect(mg); mg.connect(lp);
    // the air going past: broadband noise through a band-pass that opens up with speed
    const air = c.createBufferSource(); air.buffer = this.noise; air.loop = true;
    const af = c.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 900; af.Q.value = 0.7;
    const ag = c.createGain(); ag.gain.value = 0.5; air.connect(af); af.connect(ag); ag.connect(lp);
    // a thin whine riding on top, so it reads as machinery and not just wind
    const wh = c.createOscillator(); wh.type = 'triangle';
    const wg = c.createGain(); wg.gain.value = 0.045; wh.connect(wg); wg.connect(lp);
    m1.start(t); m2.start(t); air.start(t); wh.start(t);
    out.gain.setTargetAtTime(1, t, 0.06);
    this.rk.set(id, { out, pan, lp, m1, m2, af, ag, wh, air, nodes: [m1, m2, air, wh] });
  }
  /** Where the rocket is and how fast it is going, every frame while it flies. */
  rocketAt(id, pos, speed01, mine) {
    const r = this.rk.get(id); if (!r || !this.ctx) return;
    const c = this.ctx, t = c.currentTime, s = clamp(speed01, 0, 1);
    r.m1.frequency.setTargetAtTime(78 + s * 120, t, 0.08);
    r.m2.frequency.setTargetAtTime(78 + s * 120, t, 0.08);
    r.wh.frequency.setTargetAtTime(1500 + s * 1700, t, 0.08);
    r.af.frequency.setTargetAtTime(700 + s * 2400, t, 0.06);   // wind bites harder the faster it goes
    r.ag.gain.setTargetAtTime(0.35 + s * 0.5, t, 0.08);
    if (mine) {                                                // the camera is riding it: centred and loud
      r.lp.frequency.setTargetAtTime(9000, t, 0.1);
      if (r.pan) r.pan.pan.setTargetAtTime(0, t, 0.1);
      r.out.gain.setTargetAtTime(0.5, t, 0.1);
      return;
    }
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, d = Math.hypot(dx, dz);
    r.out.gain.setTargetAtTime(clamp(1 / (1 + d / 13), 0, 1) * (d > 110 ? 0 : 0.42), t, 0.1);
    r.lp.frequency.setTargetAtTime(clamp(14000 / (1 + d / 11), 600, 14000), t, 0.1);
    if (r.pan) r.pan.pan.setTargetAtTime(clamp(dx / 30, -0.85, 0.85), t, 0.1);
  }
  /** It hit something, or ran out: take the whole loop down and free its nodes. */
  rocketOff(id) {
    const r = this.rk.get(id); if (!r) return;
    this.rk.delete(id);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    r.out.gain.cancelScheduledValues(t);
    r.out.gain.setTargetAtTime(0, t, 0.02);
    for (const n of r.nodes) { try { n.stop(t + 0.12); } catch (e) {} }
    setTimeout(() => { try { r.out.disconnect(); } catch (e) {} }, 400);
  }
  /** Every rocket at once — leaving a match, or the effects being torn down. */
  rocketsOff() { for (const id of [...this.rk.keys()]) this.rocketOff(id); }

  engine(speed01, on) {
    if (!this.ctx || !this.eng) return; const t = this.ctx.currentTime; const s = on ? clamp(speed01, 0, 1) : 0;
    this.eng[0].frequency.setTargetAtTime(40 + s * 38, t, 0.15); this.eng[1].frequency.setTargetAtTime(40 + s * 38, t, 0.15); this.eng[2].frequency.setTargetAtTime(20 + s * 19, t, 0.15);
    this.lfo.frequency.setTargetAtTime(8 + s * 14, t, 0.15);
    this.engF.frequency.setTargetAtTime(200 + s * 520, t, 0.12);
    this.engBus.gain.setTargetAtTime(on ? 0.045 + s * 0.055 : 0, t, 0.2);
    this.trkL.frequency.setTargetAtTime(6 + s * 22, t, 0.1);
    this.trkF.frequency.setTargetAtTime(500 + s * 700, t, 0.1);
    this.trkG.gain.setTargetAtTime(on ? s * 0.11 : 0, t, 0.1);
  }

  /* ---------------- menu music ----------------
     92 BPM, D Hijaz (D Eb F# G A Bb C): daf frame drum, a plucked tembûr-like
     melody made of short phrases, and a soft drone on D + A. Scheduled
     slightly ahead with a timer (the standard Web Audio look-ahead pattern). */
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true;
    const c = this.ctx;
    this.mBus = c.createGain(); this.mBus.gain.value = 0; this.mBus.connect(this.music);
    this.mBus.gain.setTargetAtTime(1, c.currentTime, 1.2);
    const mRev = c.createConvolver(); mRev.buffer = this.impulse(2.4, 3); const mRevG = c.createGain(); mRevG.gain.value = 0.35; mRevG.connect(mRev); mRev.connect(this.mBus);
    this.mRev = mRevG;
    // drone
    this.drone = [];
    for (const [f, g] of [[73.4, 0.05], [110, 0.03], [146.8, 0.02]]) {
      const o = c.createOscillator(), gg = c.createGain(), lp = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 380; gg.gain.value = g;
      o.connect(lp); lp.connect(gg); gg.connect(this.mBus); gg.connect(mRevG); o.start(); this.drone.push(o);
    }
    const SC = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16];                                 // Hijaz steps from D
    const f = (deg, oct = 0) => 293.66 * Math.pow(2, (SC[((deg % SC.length) + SC.length) % SC.length] + 12 * (oct + Math.floor(deg / SC.length))) / 12);
    const PH = [[0, 1, 2, 1, 0, -1, 0, null], [4, 3, 2, 3, 4, 5, 4, null], [2, 3, 4, 6, 5, 4, 3, 2], [1, 0, 1, 2, 1, 0, 0, null], [4, 5, 6, 7, 6, 5, 4, 2], [3, 2, 1, 2, 1, 0, -1, 0]];
    // daf pattern (1 bar = 8 eighths): D = deep dum, T = tek (rim slap), . = rest
    const DAF = ['D', '.', 'T', 'T', 'D', 'T', '.', 'T'];
    const eighth = 60 / 92 / 2; let step = 0, next = c.currentTime + 0.3, phrase = 0;
    const tick = () => {
      if (!this.musicOn) return;
      while (next < c.currentTime + 0.25) {
        const s = step % 8, bar = Math.floor(step / 8);
        const k = DAF[s];
        if (k === 'D') { this.tone(this.mBus, 'sine', 95, 55, next, 0.35, 0.28, 0.002); this.noiseHit(this.mBus, 'lowpass', 300, 120, next, 0.2, 0.2, 0.7, 0.002); }
        if (k === 'T') { const g = this.noiseHit(this.mBus, 'bandpass', 2400, 1700, next, 0.06, 0.1, 1.5, 0.001); g.connect(mRevG); }
        if (s === 7 && bar % 2) this.noiseHit(this.mBus, 'highpass', 6000, 7000, next, 0.12, 0.05, 0.6, 0.002);   // jingles on the frame
        // melody: plays 2 bars of each 4, rests the others (gives space)
        if (bar % 4 < 2) {
          const note = PH[phrase % PH.length][s];
          if (note !== null && note !== undefined) this.pluck(f(note, bar % 8 < 4 ? 0 : 1), next, s % 2 ? 0.08 : 0.11);
          if (s === 7 && bar % 4 === 1) phrase++;
        }
        next += eighth; step++;
      }
      this.musicTimer = setTimeout(tick, 60);
    };
    tick();
  }
  // tembûr-like pluck: bright saw through a closing band-pass, with a tiny pitch bend down.
  pluck(freq, t, peak) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'triangle'; o.frequency.setValueAtTime(freq * 1.01, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.04); o2.frequency.value = freq * 2; o2.detune.value = 6;
    bp.type = 'lowpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(freq * 8, t); bp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(bp);
    o.connect(bp); bp.connect(g); g.connect(this.mBus); g.connect(this.mRev);
    o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
  }
  stopMusic() {
    if (!this.musicOn) return; this.musicOn = false; clearTimeout(this.musicTimer);
    const c = this.ctx, bus = this.mBus, dr = this.drone || [];
    if (bus) { bus.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => { dr.forEach(o => { try { o.stop(); } catch (e) {} }); try { bus.disconnect(); } catch (e) {} }, 1500); }
    this.drone = [];
  }
}
