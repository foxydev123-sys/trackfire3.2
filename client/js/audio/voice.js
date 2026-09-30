/* =====================================================================
   VOICE CHAT — players talk to each other during a match.

   The sound goes STRAIGHT from one player's phone to another's (WebRTC,
   peer to peer). The game server only passes the two "hello" messages
   along so they can find each other; it never carries or stores any voice.

   Each player can choose, separately:
     talk to   TEAM   or   EVERYONE
     listen to TEAM   or   EVERYONE
   and either hold a key to talk (push to talk) or leave the microphone open.

   Team-only talking works because every connection has its own copy of the
   microphone track: the copies for the other team are simply switched off.
   ===================================================================== */
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SPEAK_ON = 0.022, SPEAK_OFF = 0.012;      // how loud counts as "talking" (open microphone)

export class VoiceChat {
  /** opts: { send(msg), myId(), players(), teamOf(id), onState(), settings } */
  constructor(opts) {
    Object.assign(this, opts);
    this.peers = new Map();           // playerId → {pc, out, audio, stream, level, talking, state}
    this.stream = null; this.ctx = null; this.on = false; this.talking = false;
    this.muted = new Set();           // players this user silenced
    this.error = null; this.starting = false;
  }
  get supported() { return typeof RTCPeerConnection === 'function' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  S() { return this.settings; }

  /* ---------------- turning it on and off ---------------- */
  async enable() {
    if (this.on || this.starting) return true;
    if (!this.supported) { this.error = 'unsupported'; this.onState && this.onState(); return false; }
    this.starting = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      this.error = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nomic';
      this.starting = false; this.onState && this.onState(); return false;
    }
    this.starting = false; this.error = null; this.on = true;
    this.setupMeter();
    this.applyTalk();
    this.send({ t: 'vc', on: true, talk: false });
    this.sync();
    this.onState && this.onState();
    return true;
  }
  disable() {
    if (!this.on) return;
    this.on = false; this.talking = false;
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.stream) { for (const tr of this.stream.getTracks()) tr.stop(); this.stream = null; }
    if (this.meter) { try { this.meter.disconnect(); } catch (e) {} this.meter = null; }
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; }
    this.send({ t: 'vc', on: false, talk: false });
    this.onState && this.onState();
  }
  async toggle() { return this.on ? (this.disable(), false) : this.enable(); }

  /** Push-to-talk key held / released, or the on-screen microphone button. */
  setTalking(v) {
    v = !!v && this.on;
    if (v === this.talking) return;
    this.talking = v; this.applyTalk();
    this.send({ t: 'vc', on: this.on, talk: v });
    this.onState && this.onState();
  }
  /** Am I sending sound right now, and to whom? */
  applyTalk() {
    const S = this.S(), open = S.voiceMode === 'open';
    const live = this.on && (open ? this.micLevel > (this.talking ? SPEAK_OFF : SPEAK_ON) : this.talking);
    this.live = live;
    for (const [id, p] of this.peers) {
      if (!p.out) continue;
      const mate = this.sameTeam(id);
      p.out.enabled = live && (S.voiceTalk === 'all' || mate);
    }
  }
  sameTeam(id) { const a = this.teamOf(this.myId()), b = this.teamOf(id); return !!a && a !== 'ffa' && a === b; }
  /** Should I hear this player at all? */
  canHear(id) {
    if (this.muted.has(id)) return false;
    return this.S().voiceHear === 'all' || this.sameTeam(id);
  }
  mute(id, v) { if (v) this.muted.add(id); else this.muted.delete(id); this.applyHear(); this.onState && this.onState(); }
  applyHear() {
    const vol = Math.max(0, Math.min(1, (this.S().voiceVol ?? 100) / 100));
    for (const [id, p] of this.peers) if (p.audio) { p.audio.muted = !this.canHear(id); p.audio.volume = vol; }
  }

  /* ---------------- who to connect to ---------------- */
  /** Called whenever the player list changes: open connections to new players, drop the ones who left. */
  sync() {
    if (!this.on) return;
    const me = this.myId(), want = new Set();
    for (const p of this.players()) if (p.id !== me && !p.bot && p.conn) want.add(p.id);
    for (const id of want) if (!this.peers.has(id)) { if (id > me) this.connect(id, true); else this.peers.set(id, this.blank(id)); }  // the higher id calls first, so both sides never call at once
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    this.applyTalk(); this.applyHear();
  }
  blank(id) { return { id, pc: null, out: null, audio: null, state: 'waiting', level: 0, talking: false }; }
  drop(id) {
    const p = this.peers.get(id); if (!p) return;
    if (p.pc) try { p.pc.close(); } catch (e) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (p.out) try { p.out.stop(); } catch (e) {}
    this.peers.delete(id);
  }
  makePc(id) {
    let p = this.peers.get(id);
    if (!p) { p = this.blank(id); this.peers.set(id, p); }
    if (p.pc) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p.pc = pc; p.state = 'connecting';
    // our microphone, as a separate copy for this one player (so team-only talk can switch it off)
    if (this.stream) {
      const tr = this.stream.getAudioTracks()[0];
      if (tr) { p.out = tr.clone(); p.out.enabled = false; pc.addTrack(p.out, this.stream); }
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', to: id, ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      const a = new Audio(); a.autoplay = true; a.srcObject = e.streams[0];
      a.muted = !this.canHear(id); a.volume = Math.max(0, Math.min(1, (this.S().voiceVol ?? 100) / 100));
      a.play && a.play().catch(() => {});
      p.audio = a; p.remote = e.streams[0];
      this.watchRemote(p);
      this.onState && this.onState();
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === 'failed') { this.drop(id); setTimeout(() => { if (this.on) this.sync(); }, 1500); }
      this.onState && this.onState();
    };
    return p;
  }
  async connect(id) {
    const p = this.makePc(id);
    try {
      const offer = await p.pc.createOffer({ offerToReceiveAudio: true });
      await p.pc.setLocalDescription(offer);
      this.send({ t: 'rtc', to: id, sdp: p.pc.localDescription, kind: 'offer' });
    } catch (e) { p.state = 'failed'; }
  }
  /** A signalling message arrived from another player (relayed by the server). */
  async onSignal(m) {
    if (!this.on) return;
    const id = m.from;
    const p = this.makePc(id);
    try {
      if (m.sdp && m.kind === 'offer') {
        await p.pc.setRemoteDescription(m.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        this.send({ t: 'rtc', to: id, sdp: p.pc.localDescription, kind: 'answer' });
        this.applyTalk();
      } else if (m.sdp && m.kind === 'answer') {
        if (p.pc.signalingState !== 'stable') await p.pc.setRemoteDescription(m.sdp);
      } else if (m.ice) {
        await p.pc.addIceCandidate(m.ice).catch(() => {});
      }
    } catch (e) { /* a late or duplicate message: ignore */ }
  }

  /* ---------------- levels: who is talking ---------------- */
  setupMeter() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = this.ctx || new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const src = this.ctx.createMediaStreamSource(this.stream), an = this.ctx.createAnalyser();
      an.fftSize = 512; src.connect(an); this.meter = an; this.buf = new Float32Array(an.fftSize);
    } catch (e) {}
  }
  watchRemote(p) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = this.ctx || new AC();
      const src = this.ctx.createMediaStreamSource(p.remote), an = this.ctx.createAnalyser();
      an.fftSize = 512; src.connect(an); p.an = an; p.buf = new Float32Array(an.fftSize);
    } catch (e) {}
  }
  rms(an, buf) { if (!an) return 0; an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }
  /** Called every frame: updates the little "talking" lights and the open-microphone gate. */
  frame() {
    if (!this.on) return;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.micLevel = this.rms(this.meter, this.buf);
    if (this.S().voiceMode === 'open') {
      const speak = this.micLevel > (this.live ? SPEAK_OFF : SPEAK_ON);
      if (speak !== this.live) { this.applyTalk(); this.send({ t: 'vc', on: true, talk: this.live }); this.onState && this.onState(); }
    }
    for (const p of this.peers.values()) {
      const lvl = this.rms(p.an, p.buf);
      p.level = lvl;
      const talking = lvl > SPEAK_OFF && this.canHear(p.id);
      if (talking !== p.talking) { p.talking = talking; this.onState && this.onState(); }
    }
  }
  /** Who is talking right now (for the HUD). */
  talkers() { const out = []; for (const [id, p] of this.peers) if (p.talking) out.push(id); return out; }
  isConnected(id) { const p = this.peers.get(id); return !!(p && p.state === 'connected'); }
}
