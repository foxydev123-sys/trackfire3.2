/* Trailer soundtrack + SFX, generated with Web Audio and scheduled on the
   audio clock (so picture and sound stay in sync in the recording).
   128 BPM, A minor: Am – F – C – G. */
const BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4;
const CH = [[110, [220, 261.63, 329.63]], [87.31, [174.61, 220, 261.63]], [130.81, [261.63, 329.63, 392]], [98, [196, 246.94, 293.66]]];

export class TrailerAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.dest = c.createMediaStreamDestination(); comp.connect(this.dest);
    this.music = c.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let s = 12345; for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
    this.noise = b; this.t0 = 0;
  }
  now() { return this.ctx.currentTime - this.t0; }
  env(g, t, peak, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  osc(out, type, f0, f1, t, dur, peak, a = 0.004) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur); this.env(g, t, peak, a, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05); }
  nz(out, type, f0, f1, t, dur, peak, q = 0.8, a = 0.003) { const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); this.env(g, t, peak, a, dur); s.connect(f); f.connect(g); g.connect(out); s.start(t, (t * 7.3) % 1.5); s.stop(t + a + dur + 0.05); }
  // ---- drums & synths (music bus)
  kick(t, v = 1) { this.osc(this.music, 'sine', 150, 42, t, 0.32, 1.0 * v); this.nz(this.music, 'lowpass', 900, 200, t, 0.03, 0.3 * v); }
  snare(t, v = 1) { this.nz(this.music, 'bandpass', 2200, 1500, t, 0.18, 0.55 * v, 0.9); this.osc(this.music, 'triangle', 220, 160, t, 0.1, 0.3 * v); }
  hat(t, v = 1) { this.nz(this.music, 'highpass', 8000, 7000, t, 0.04, 0.16 * v, 0.7); }
  bass(t, f, dur, v = 1) { this.osc(this.music, 'sawtooth', f, f, t, dur, 0.22 * v, 0.006); this.osc(this.music, 'sine', f / 2, f / 2, t, dur, 0.3 * v, 0.006); }
  stab(t, fs, dur, v = 1) { for (const f of fs) for (const det of [0.997, 1.003]) this.osc(this.music, 'sawtooth', f * det, f * det, t, dur, 0.05 * v, 0.008); }
  pad(t, fs, dur, v = 1) { for (const f of fs) for (const det of [0.995, 1.005]) this.osc(this.music, 'triangle', f * det, f * det, t, dur, 0.045 * v, dur * 0.3); }
  tom(t, f = 110, v = 1) { this.osc(this.music, 'sine', f * 1.6, f, t, 0.45, 0.8 * v); this.nz(this.music, 'lowpass', 600, 150, t, 0.2, 0.25 * v); }
  riser(t, dur, v = 1) { this.nz(this.music, 'bandpass', 300, 6000, t, dur, 0.28 * v, 1.2, dur * 0.9); this.osc(this.music, 'sawtooth', 110, 880, t, dur, 0.05 * v, dur * 0.9); }
  impact(t, v = 1) { this.osc(this.music, 'sine', 90, 30, t, 1.4, 1.0 * v); this.nz(this.music, 'lowpass', 3000, 100, t, 1.2, 0.7 * v); }
  // ---- sound effects (sfx bus)
  cannon(t, v = 1) { this.osc(this.sfx, 'sine', 110, 38, t, 0.35, 0.8 * v); this.nz(this.sfx, 'lowpass', 2400, 300, t, 0.45, 0.6 * v); }
  boom(t, big, v = 1) { this.nz(this.sfx, 'lowpass', 1800, 120, t, big ? 1.4 : 0.6, (big ? 0.9 : 0.55) * v, 0.7, 0.01); this.osc(this.sfx, 'sine', 60, 28, t, big ? 1.0 : 0.4, (big ? 0.9 : 0.5) * v, 0.01); }
  whoosh(t, v = 1) { this.nz(this.sfx, 'bandpass', 400, 3500, t, 0.35, 0.3 * v, 1.5, 0.15); }
  click(t) { this.osc(this.sfx, 'triangle', 1200, 900, t, 0.05, 0.25); }
  key(t) { this.nz(this.sfx, 'bandpass', 4200, 3000, t, 0.03, 0.2, 3); }
  pickup(t) { this.osc(this.sfx, 'triangle', 520, 1040, t, 0.12, 0.35); this.osc(this.sfx, 'triangle', 780, 1560, t + 0.09, 0.18, 0.3); }
  deflect(t) { this.osc(this.sfx, 'sine', 1300, 2400, t, 0.14, 0.3); }
  pop(t) { this.osc(this.sfx, 'sine', 600, 900, t, 0.08, 0.25); }

  /** Schedules the whole score. Section times match the trailer timeline. */
  score(T0, len) {
    this.t0 = T0;
    const at = (x) => T0 + x;
    // intro: riser into the title slam
    this.riser(at(0), 1.6, 1); this.impact(at(1.6), 1); this.pad(at(1.6), [110, 164.8, 220], 1.8, 0.8);
    const secMenu = [3.2, 14.5], secGame = [14.5, 45.5], secEnd = [45.5, 53];
    for (let bar = 0; ; bar++) {
      const b0 = 3.2 + bar * BAR; if (b0 >= secEnd[0]) break;
      const [root, chord] = CH[bar % 4];
      const game = b0 >= secGame[0] - 0.01, brk = b0 >= 39.8 && b0 < 41.6;
      for (let i = 0; i < 4; i++) {
        const t = b0 + i * BEAT; if (t >= secEnd[0]) break;
        if (!brk) this.kick(at(t), game ? 1 : 0.7);
        if (game && !brk && (i === 1 || i === 3)) this.snare(at(t));
        for (let h = 0; h < (game ? 4 : 2); h++) this.hat(at(t + h * BEAT / (game ? 4 : 2)), h % 2 ? 0.6 : 1);
        for (let e = 0; e < 2; e++) { const oct = game && e === 1 ? 2 : 1; this.bass(at(t + e * BEAT / 2), root * oct, BEAT / 2 - 0.02, game ? 1 : 0.7); }
      }
      if (game && !brk) this.stab(at(b0), chord, 0.35, 1);
      else this.pad(at(b0), chord, BAR, 0.8);
    }
    // builds + drops
    this.riser(at(12.6), 1.9, 0.9); this.impact(at(14.5), 0.8);
    this.riser(at(28.2), 1.8, 0.8); this.impact(at(30), 0.7);
    this.riser(at(43.7), 1.8, 1); this.impact(at(45.5), 1.1);
    // finale: big toms, sustained chord, final hit on "COMING SOON"
    this.pad(at(45.5), [110, 220, 261.63, 329.63], 3.8, 1.2);
    for (const [x, f] of [[46.4, 98], [46.9, 110], [47.4, 130], [47.65, 130], [47.9, 146]]) this.tom(at(x), f);
    this.impact(at(48.4), 1.2); this.stab(at(48.4), [220, 261.63, 329.63, 440], 1.6, 1.3); this.pad(at(48.4), [110, 164.8, 220, 329.63], 4.4, 1);
    this.master.gain.setValueAtTime(0.9, at(len - 1.6)); this.master.gain.linearRampToValueAtTime(0.0001, at(len));
  }
}
