/* In-game HUD: health, reload, crosshair, name tags, kill feed, scores,
   minimap, debug panel, death and end-of-match cards. Pure DOM. */
import { GAME, NET } from '../../shared/config.js';
import { ABILITIES } from '../../shared/abilities.js';
import { clamp } from '../../shared/math.js';
import { t, th } from '../i18n.js';
import { rankResultHTML } from './social.js';
import { COIN, GEM, PARTS, chestSVG } from './eco.js';

// Element lookups are cached: the HUD asks for the same few dozen elements 60 times a
// second, and document.getElementById is not free.
const _els = new Map();
const $ = (id) => {
  let e = _els.get(id);
  if (e === undefined || !e || !e.isConnected) { e = document.getElementById(id); _els.set(id, e); }
  return e;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHELL_SVG = '<svg viewBox="0 0 22 10"><path d="M0 3h13l6 2-6 2H0z" fill="#f1c56a"/><path d="M0 3h4v4H0z" fill="#9a6a24"/></svg>';

export class HUD {
  constructor() {
    this.wrap = $('hud'); this.vl = $('hudVL'); this.ov = $('ov');
    this.feed = []; this.tags = new Map(); this.lastHp = 100; this.slowT = 0; this.touch = false;
    this.xh = document.createElement('div'); this.xh.className = 'xh';
    this.xh.innerHTML = '<svg viewBox="-26 -26 52 52"><circle r="15" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="4"/><circle r="15" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>' +
      '<circle class="arc" r="15" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="94.25" stroke-dashoffset="0" transform="rotate(-90)" stroke-linecap="round"/>' +
      '<g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M0 -22v-4M0 22v4M-22 0h-4M22 0h4"/></g><circle r="1.8" fill="#fff"/>' +
      '<g class="hitx" stroke="#ff5a4a" stroke-width="2.6" stroke-linecap="round"><path d="M-9 -9l-5 -5M9 -9l5 -5M-9 9l-5 5M9 9l5 5"/></g></svg>';
    this.xhArc = this.xh.querySelector('.arc');
    this.ov.appendChild(this.xh);
    this.perfHist = [];
  }
  show(on) { this.wrap.hidden = !on; this.ov.hidden = !on; }
  layout() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight; if (!W || !H) return;
    const baseH = this.touch ? 520 : 720, minW = this.touch ? 860 : 1100;
    let s = H / baseH; if (W / s < minW) s = W / minW;
    s = clamp(s, 0.45, 2.2);
    this.vl.style.width = W / s + 'px'; this.vl.style.height = H / s + 'px'; this.vl.style.transform = `scale(${s})`;
    this.scale = s;
    const t = $('touch'); t.style.setProperty('--ts', clamp(Math.min(window.innerWidth, window.innerHeight) / 390, 0.75, 1.3).toFixed(3));
    this.tagFont = clamp(window.innerWidth / 105, 9, 13);
    this.ov.style.setProperty('--tf', this.tagFont + 'px');
  }
  setTouch(on) { this.touch = on; document.body.classList.toggle('touchui', on); $('touch').hidden = !on; this.layout(); }

  /* ---------- room / scores ---------- */
  setRoom(room, myId) {
    this.room = room; this.myId = myId;
    const me = room.players.find(p => p.id === myId);
    this.me = me;
    const ffa = !GAME.MODES[room.mode] || !GAME.MODES[room.mode].team, msMode = !!(GAME.MODES[room.mode] && GAME.MODES[room.mode].ms);
    $('hhName').textContent = me ? me.name : 'You';
    $('hhSub').textContent = ffa ? t('ffa') : (me ? t('teamLbl', { team: t(me.team) }) : '');
    const R = this.obj && this.obj.round;
    $('modeLbl').textContent = room.mode === 'lts' && R ? t('roundN', { n: R.n }) + ' · ' + t('toScore', { mode: t('lts'), n: room.limit }) : t('toScore', { mode: t(room.mode), n: room.limit });
    $('roomTxt').textContent = t('room', { code: room.code });
    if (ffa) {
      const sc = (p) => msMode ? (p.ms || 0) : p.k;
      const sorted = [...room.players].sort((a, b) => sc(b) - sc(a));
      const lead = sorted[0], mine = me || { k: 0, ms: 0 };
      $('sBlueLbl').textContent = t('you'); $('sBlue').textContent = room.mode === 'potato' ? (mine.out ? '✖' : '✔') : sc(mine);
      $('sRedLbl').textContent = room.mode === 'potato' ? t('aliveLbl') : t('leader'); $('sRed').textContent = room.mode === 'potato' ? room.players.filter(p => !p.out).length : (lead ? sc(lead) : 0);
    } else {
      const pts = !!(GAME.MODES[room.mode] && GAME.MODES[room.mode].pts);
      const ts = (tm) => pts ? ((this.obj && this.obj.score) || room.score || {})[tm] || 0 : room.players.filter(p => p.team === tm).reduce((a, p) => a + p.k, 0);
      $('sBlueLbl').textContent = t('blue'); $('sRedLbl').textContent = t('red');
      $('sBlue').textContent = ts('blue'); $('sRed').textContent = ts('red');
    }
    this.clockBase = { left: room.timeLeft, at: performance.now() };
    this.renderBoards();
  }
  isAlly(p) { const me = this.me; if (!me || !p) return false; if (p.id === me.id) return true; return p.team !== 'ffa' && p.team === me.team; }
  renderBoards() {
    const r = this.room; if (!r) return;
    const rows = [...r.players].sort((a, b) => b.k - a.k || a.d - b.d);
    const col = (p) => p.team === 'blue' ? 'var(--blue)' : p.team === 'red' ? 'var(--red)' : (this.isAlly(p) ? 'var(--acc)' : '#ccc');
    $('miniboard').innerHTML = `<div class="row hd"><span></span><span>${t('sbPlayer')}</span><span class="k">${t('kShort')}</span><span class="d">${t('dShort')}</span></div>` +
      rows.slice(0, 8).map(p => `<div class="row${p.id === this.myId ? ' me' : ''}"><span class="sw" style="background:${col(p)}"></span><span class="n">${esc(p.name)}</span><span class="k">${p.k}</span><span class="d">${p.d}</span></div>`).join('');
    $('scoreboard').innerHTML = `<h3>${t('scoreboard')} <small>${esc(t('room', { code: r.code }))} · ${esc(t(({ hawler: 'mapHawler', desert: 'mapDesert', forest: 'mapForest', stadium: 'mapStadium' })[r.map] || 'mapHawler'))}</small></h3>` + this.gridHTML(r);
  }
  gridHTML(r) {
    let h = `<div class="sb-grid"><div class="h">${t('sbPlayer')}</div><div class="h num">${t('sbKills')}</div><div class="h num">${t('sbDeaths')}</div><div class="h num">${t('sbScore')}</div><div class="h num">${t('sbPing')}</div>`;
    const groups = r.mode === 'ffa' ? [['ffa', t('allPlayers')]] : [['blue', t('teamLbl', { team: t('blue') })], ['red', t('teamLbl', { team: t('red') })]];
    for (const [tm, label] of groups) {
      const ps = r.players.filter(p => p.team === tm).sort((a, b) => (b.sc || 0) - (a.sc || 0) || b.k - a.k || a.d - b.d);
      const mvpId = r.mvp && r.mvp[tm] ? r.mvp[tm].id : 0;
      const sum = ps.reduce((a, p) => a + p.k, 0);
      h += `<div class="tb ${tm}">${label}${r.mode === 'ffa' ? '' : ' · ' + sum}</div>`;
      for (const p of ps) {
        const c = (p.id === this.myId ? ' me' : '') + (p.conn ? '' : ' off');
        const crown = p.id === mvpId ? '<span class="sb-mvp" title="MVP">♛</span>' : '';
        h += `<div class="${c.trim()}">${crown}${esc(p.name)}${p.bot ? ` <small style="opacity:.6">${t('bot')}</small>` : ''}</div><div class="num${c}">${p.k}</div><div class="num${c}">${p.d}</div><div class="num${c}">${p.sc != null ? p.sc : p.k * 100}</div><div class="num${c}">${p.bot ? '–' : p.ping}</div>`;
      }
    }
    return h + '</div>';
  }
  toggleScores(on) { $('scoreboard').hidden = !on; }

  /* ---------- kill feed ---------- */
  kill(killer, victim) {
    if (!killer || !victim) return;
    this.feed.unshift({ k: killer, v: victim, t: performance.now() });
    if (this.feed.length > 5) this.feed.pop();
    this.renderFeed();
  }
  renderFeed() {
    const cls = (p) => (p.team === 'blue' ? 'b' : p.team === 'red' ? 'r' : (this.isAlly(p) ? 'b' : 'r')) + (p.id === this.myId ? ' me' : '');
    $('killfeed').innerHTML = this.feed.map(f => `<div class="kf pnl"><span class="${cls(f.k)}">${esc(f.k.name)}</span>${SHELL_SVG}<span class="${cls(f.v)}">${esc(f.v.name)}</span></div>`).join('');
  }

  /* ---------- per-frame ---------- */
  frame(st) {
    const maxHp = st.maxHp || 100, hpAbs = st.alive ? clamp(st.hp, 0, maxHp) : 0, hp = hpAbs / maxHp * 100;
    const col = hp > 60 ? 'var(--ok)' : hp > 30 ? 'var(--warn)' : 'var(--bad)';
    const bar = $('hpBar'); bar.style.width = hp + '%'; bar.style.background = col;
    if (hp !== this.lastHp) { $('hpLag').style.width = hp + '%'; this.lastHp = hp; $('hpNum').textContent = Math.round(hpAbs); }
    if (this._mh !== maxHp) { this._mh = maxHp; $('hpMax').textContent = maxHp; }
    const rl = st.rl || GAME.RELOAD_S, k = st.alive ? 1 - st.reload / rl : 0, ready = st.alive && st.reload <= 0;
    $('rlBar').style.width = (k * 100).toFixed(1) + '%'; $('rlBar').className = ready ? '' : 'busy';
    const lbl = $('rlLabel'); const txt = !st.alive ? t('deadWait') : ready ? t('reloadReady') : t('reloading'); if (lbl.textContent !== txt) { lbl.textContent = txt; lbl.className = ready ? 'ready' : 'busy'; }
    $('rlTime').textContent = !st.alive ? '' : ready ? t('reloadTime', { s: rl.toFixed(1) }) : st.reload.toFixed(1) + ' ' + t('sec');
    $('fireRing').setAttribute('stroke-dashoffset', (439.8 * (1 - k)).toFixed(1)); $('fireBtn').classList.toggle('cool', !ready);
    this.ability(st.ab);
    this.playing = !!st.playing;
    // crosshair
    const showX = st.crosshair && st.alive && !this.touch;
    this.xh.style.display = showX ? '' : 'none';
    if (showX) {
      this.xh.style.transform = `translate(${st.crosshair.x}px,${st.crosshair.y}px)`;
      this.xhArc.setAttribute('stroke-dashoffset', (94.25 * (1 - k)).toFixed(1)); this.xhArc.setAttribute('stroke', ready ? '#fff' : '#ffb347');
    }
    // death card (when you're out and watching others it goes away after 3 s)
    $('deathcard').hidden = st.alive || !st.playing || !st.deadInfo || (st.deadInfo.out && performance.now() - (st.deadInfo.at || 0) > 3000);
    if (!st.alive && st.deadInfo && st.deadInfo.out) {
      const key = 'out|' + st.deadInfo.killer;
      if (this._dk !== key) { this._dk = key; $('dcTitle').innerHTML = th('destroyedBy', { name: st.deadInfo.killer }, (v) => `<b>${v}</b>`); $('dcSub').textContent = t('eliminated') + ' · ' + t('elimSub'); }
    } else if (!st.alive && st.deadInfo) {
      const n = Math.max(1, Math.ceil(st.deadInfo.left)), key = st.deadInfo.killer + '|' + n;
      if (this._dk !== key) { this._dk = key;
        $('dcTitle').innerHTML = th('destroyedBy', { name: st.deadInfo.killer }, (v) => `<b>${v}</b>`);
        $('dcSub').textContent = t('respawn', { n }) + ' · ' + t('spawnProt'); }
    }
    // slow parts (5×/s)
    this.slowT -= st.dt;
    if (this.slowT <= 0) {
      this.slowT = 0.2;
      const ping = Math.round(st.net.st.rttAvg);
      $('pingTxt').textContent = ping + ' ms';
      $('netDot').style.color = $('netDot').style.background = ping < 80 ? 'var(--ok)' : ping < 160 ? 'var(--warn)' : 'var(--bad)';
      if (this.clockBase) {
        const left = Math.max(0, this.clockBase.left - (performance.now() - this.clockBase.at) / 1000);
        $('clock').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(Math.floor(left % 60)).padStart(2, '0');
      }
      const now = performance.now(); const before = this.feed.length;
      this.feed = this.feed.filter(f => now - f.t < 9000); if (this.feed.length !== before) this.renderFeed();
      $('connBar').hidden = st.net.status === 'online';
      $('connBar').textContent = st.net.status === 'offline' ? t('disconnected') : t('reconnecting');
      if (!$('debug').hidden) this.debug(st);
      this.powerChips(st.powers);
    }
  }
  debug(st) {
    const n = st.net, s = n.st;
    const rows = [
      ['FPS', st.fps.toFixed(0) + ' · ' + st.frameMs.toFixed(1) + ' ms'],
      ['Render', `${st.res} · ${st.quality}`],
      ['Ping (RTT)', Math.round(s.rttAvg) + ' ms'],
      ['Server tick', (n.serverTick || NET.TICK_RATE) + ' Hz'],
      ['Snapshots in', s.snapsPS.toFixed(0) + ' /s'],
      ['Snapshot age', Math.max(0, s.snapAge).toFixed(0) + ' ms'],
      ['Interp. delay', Math.round(n.interpDelay) + ' ms'],
      ['Buffered snaps', String(s.bufferDepth), s.bufferDepth < 1],
      ['Jitter', s.jitter.toFixed(0) + ' ms', s.jitter > 40],
      ['Corrections', s.corrections + ' (last ' + s.corrLast.toFixed(2) + ' m)'],
      ['Down / up', (s.bytesInPS / 1024).toFixed(1) + ' / ' + (s.bytesOutPS / 1024).toFixed(1) + ' KB/s'],
      ['Room · players', (n.code || '-') + ' · ' + (this.room ? this.room.players.length : 0) + '/' + GAME.MAX_PLAYERS],
    ];
    if (n.mapMismatch) rows.push(['Map check', 'MISMATCH', true]);
    $('dbgRows').innerHTML = rows.map(r => `<div class="r"><span>${r[0]}</span><b class="${r[2] ? 'warn' : ''}">${r[1]}</b></div>`).join('');
    this.perfHist.push(st.frameMs); if (this.perfHist.length > 54) this.perfHist.shift();
    const c = $('spark').getContext('2d'); c.clearRect(0, 0, 216, 26);
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(0, 26 - 16.7 / 40 * 24); c.lineTo(216, 26 - 16.7 / 40 * 24); c.stroke();
    c.strokeStyle = '#8fd16a'; c.lineWidth = 1.5; c.beginPath();
    this.perfHist.forEach((v, i) => { const y = 26 - clamp(v / 40, 0, 1) * 24; i ? c.lineTo(i * 4, y) : c.moveTo(0, y); }); c.stroke();
  }

  /* ---------- name tags ---------- */
  tag(id, name, ally, x, y, hp, visible, stars = null) {
    let e = this.tags.get(id);
    if (!e) { e = document.createElement('div'); e.innerHTML = '<span></span><u></u><i><b></b></i>'; this.ov.appendChild(e); this.tags.set(id, e); e._n = ''; e._a = null; e._s = null; }
    if (!visible) { if (e.style.display !== 'none') e.style.display = 'none'; return; }
    if (e._n !== name) { e.firstChild.textContent = name; e._n = name; }
    // how strong that tank is: filled stars = how far it is upgraded, colour = how rare it is
    const key = stars ? stars.n + '|' + stars.col + '|' + (stars.ab || '') : '';
    if (e._s !== key) {
      e._s = key; const u = e.children[1];
      if (!stars) u.textContent = '';
      else { u.textContent = '★'.repeat(stars.n) + '☆'.repeat(5 - stars.n) + (stars.ab ? ' ' + stars.ab : ''); u.style.color = stars.col; }
    }
    if (e._a !== ally) { e.className = 'tag ' + (ally ? 'ally' : 'enemy'); e._a = ally; }
    e.style.display = '';
    e.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    const w = clamp(hp, 0, 100) + '%'; const b = e.lastChild.firstChild; if (b.style.width !== w) b.style.width = w;
  }
  pruneTags(ids) { for (const [id, e] of this.tags) if (!ids.has(id)) { e.remove(); this.tags.delete(id); } }
  powerToast(text, color) {
    const e = document.getElementById('puToast'); e.textContent = text; e.style.color = '#' + color.toString(16).padStart(6, '0');
    e.hidden = false; e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop');
    clearTimeout(this._pt); this._pt = setTimeout(() => { e.hidden = true; }, 1600);
  }
  powerChips(p) {
    const el = document.getElementById('puChips'); if (!el) return;
    const chips = [];
    if (p && p.armor > 0) chips.push(['shield', t('shield'), p.armor.toFixed(1) + ' ' + t('sec')]);
    if (p && p.boost > 0) chips.push(['speed', t('speed'), p.boost.toFixed(1) + ' ' + t('sec')]);
    if (p && p.oneShot) chips.push(['oneshot', t('oneShot'), t('nextShell')]);
    if (p && p.rockets > 0) chips.push(['rocket', t('rocketsLbl'), '×' + p.rockets]);
    const html = chips.map(c => `<span class="chip-pu ${c[0]}"><i></i>${c[1]}<em>${c[2]}</em></span>`).join('');
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }
  /* ---------- the tank's special power ---------- */
  ability(a) {
    const btn = $('abBtn'), chip = $('abChip');
    if (!a) { if (btn && !btn.hidden) btn.hidden = true; if (chip && !chip.hidden) chip.hidden = true; return; }
    const A = ABILITIES[a.id] || {}, ready = !!a.ready && !a.caged;
    // the power stick only comes alive on a full bar; below that a press just shakes its head
    if (this.touchCtl) this.touchCtl.abOk = ready;
    const k = Math.max(0, Math.min(1, (a.chg || 0) / Math.max(1, a.need || 1)));   // how full the bar is
    if (btn) {
      btn.hidden = !this.touch;
      if (this.touch) {
        if (this._abi !== a.id) { this._abi = a.id; $('abIcon').textContent = A.icon || '⚡'; }
        $('abRing').setAttribute('stroke-dashoffset', (339.3 * (1 - k)).toFixed(1));
        btn.classList.toggle('cool', !ready);
        btn.classList.toggle('armed', !!a.armed);
        const cd = $('abCd'); const txt = a.armed ? '◉' : ready ? '' : Math.round(k * 100) + '%';
        if (cd.textContent !== txt) cd.textContent = txt;
      }
    }
    if (chip) {
      chip.hidden = !!this.touch;
      if (!this.touch) {
        if (this._abc !== a.id + '|' + a.l) {
          this._abc = a.id + '|' + a.l;
          $('abChipIcon').textContent = A.icon || '⚡';
          $('abChipName').textContent = t('ab_' + a.id);
          $('abChipStars').textContent = '★'.repeat(a.l) + '☆'.repeat(5 - a.l);
        }
        $('abChipBar').style.width = (k * 100).toFixed(1) + '%';
        chip.classList.toggle('cool', !ready);
        chip.classList.toggle('armed', !!a.armed);
        const key = $('abChipKey'), txt = a.caged ? t('abCagedShort') : a.armed ? t('abPlace') : ready ? 'Q' : Math.round(k * 100) + '%';
        if (key.textContent !== txt) key.textContent = txt;
      }
    }
  }
  /* ---------- voice chat ---------- */
  voice(v) {
    const panel = $('vcPanel'), btn = $('vcBtn');
    if (btn) {
      btn.hidden = !this.touch || !this.playing;
      if (!btn._b) { btn._b = 1;
        const down = (e) => { e.preventDefault(); if (!v || !v.on) { this.onVoiceToggle && this.onVoiceToggle(); return; } btn.classList.add('live'); this.onVoicePush && this.onVoicePush(true); };
        const up = () => { btn.classList.remove('live'); this.onVoicePush && this.onVoicePush(false); };
        btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
      }
      btn.classList.toggle('off', !v || !v.on);
      btn.classList.toggle('live', !!(v && v.live));
    }
    if (!panel) return;
    if (!v || !v.on) { panel.hidden = true; document.body.classList.remove('vc-on'); return; }
    const talking = v.players.filter(p => p.talking), mics = v.players.filter(p => p.mic);
    panel.hidden = !this.playing;
    document.body.classList.toggle('vc-on', !panel.hidden);
    $('vcTitle').textContent = t(v.live ? 'vcLive' : 'vcOnLbl');
    $('vcHow').textContent = t(v.talk === 'all' ? 'vcToAll' : 'vcToTeam') + ' · ' + t(v.hear === 'all' ? 'vcFromAll' : 'vcFromTeam');
    panel.classList.toggle('live', !!v.live);
    const key = mics.map(p => p.id + (p.talking ? 't' : '') + (p.muted ? 'm' : '') + (p.linked ? 'c' : '')).join(',') + '|' + v.live;
    if (this._vck === key) return;
    this._vck = key;
    const L = $('vcList');
    L.innerHTML = mics.length ? mics.map(p => `<li class="${p.team} ${p.talking ? 'talk' : ''}"><span class="lvl"></span><span class="n">${esc(p.name)}</span>${p.linked ? '' : `<em>${esc(t('vcLinking'))}</em>`}<button type="button" data-vm="${p.id}" class="${p.muted ? 'on' : ''}" title="${esc(t(p.muted ? 'vcUnmute' : 'vcMute'))}">${p.muted ? '\u{1F507}' : '\u{1F50A}'}</button></li>`).join('')
      : `<li class="none">${esc(t('vcNobody'))}</li>`;
    L.querySelectorAll('[data-vm]').forEach(b => b.onclick = () => { const id = Number(b.dataset.vm); const now = b.classList.contains('on'); this.onVoiceMute && this.onVoiceMute(id, !now); });
  }
  abFlash() { const b = $('abBtn'), c = $('abChip'); for (const e of [b, c]) if (e) { e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); } }
  hitMarker() { this.xh.classList.add('hit'); clearTimeout(this._hm); this._hm = setTimeout(() => this.xh.classList.remove('hit'), 220); }
  damageNumber(x, y, n, color = null) {
    const d = document.createElement('div'); d.className = 'dmgnum'; d.textContent = typeof n === 'string' ? n : '-' + n; d.style.transform = `translate(${x}px,${y}px)`;
    if (color) d.style.color = color;
    this.ov.appendChild(d); setTimeout(() => d.remove(), 950);
  }
  flash() { const e = $('vign'); e.style.transition = 'none'; e.style.opacity = 1; requestAnimationFrame(() => { e.style.transition = 'opacity .7s'; e.style.opacity = 0; }); }

  /* ---------- minimap ---------- */
  minimap(img, me, others, pads = [], marks = null) {
    const cv = $('mm'); const x = cv.getContext('2d'); const s = cv.width; x.clearRect(0, 0, s, s);
    if (!img || !me) return;
    const span = 90, O = 90, k = img.width / 180;             // minimap image covers −90…90 m (see world.js MM_EXT)
    x.drawImage(img, (me.x - span / 2 + O) * k, (me.z - span / 2 + O) * k, span * k, span * k, 0, 0, s, s);
    const to = (px, pz) => [(px - me.x + span / 2) / span * s, (pz - me.z + span / 2) / span * s];
    for (const o of others) {
      const [a, b] = to(o.x, o.z); if (a < -5 || b < -5 || a > s + 5 || b > s + 5) continue;
      x.fillStyle = o.ally ? '#62a2ff' : '#ff6250'; x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 2;
      x.beginPath(); x.arc(a, b, s * 0.028, 0, Math.PI * 2); x.fill(); x.stroke();
      if (o.star) { x.fillStyle = '#ffd23a'; x.font = `bold ${Math.round(s * 0.07)}px sans-serif`; x.textAlign = 'center'; x.fillText('★', a, b - s * 0.04); }
    }
    for (const p of pads) { const [a, b] = to(p.x, p.z); if (a < -5 || b < -5 || a > s + 5 || b > s + 5) continue; x.fillStyle = '#' + p.c.toString(16).padStart(6, '0'); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.save(); x.translate(a, b); x.rotate(Math.PI / 4); x.fillRect(-s * 0.022, -s * 0.022, s * 0.044, s * 0.044); x.strokeRect(-s * 0.022, -s * 0.022, s * 0.044, s * 0.044); x.restore(); }
    if (marks) {
      if (marks.zone) { const [zx, zz] = to(marks.zone.x, marks.zone.z); x.beginPath(); x.arc(zx, zz, marks.zone.r / span * s, 0, Math.PI * 2); x.fillStyle = marks.zone.col + '44'; x.fill(); x.strokeStyle = marks.zone.col; x.lineWidth = 2.5; x.stroke(); }
      for (const p of marks.pts || []) {                 // truck, ball, goals, bomb (kept on the edge when off the map)
        let [px, pz] = to(p.x, p.z); px = clamp(px, 8, s - 8); pz = clamp(pz, 8, s - 8);
        x.fillStyle = p.col; x.strokeStyle = '#000'; x.lineWidth = 2; const r = s * p.r;
        if (p.sq) { x.fillRect(px - r, pz - r, r * 2, r * 2); x.strokeRect(px - r, pz - r, r * 2, r * 2); }
        else { x.beginPath(); x.arc(px, pz, r, 0, Math.PI * 2); x.fill(); x.stroke(); }
      }
      for (const f of marks.flags || []) {
        let [fx, fz] = to(f.x, f.z); fx = clamp(fx, 8, s - 8); fz = clamp(fz, 8, s - 8);
        x.fillStyle = f.col; x.strokeStyle = '#000'; x.lineWidth = 2; x.fillRect(fx - 1, fz - s * 0.07, 3, s * 0.07);
        x.beginPath(); x.moveTo(fx + 2, fz - s * 0.07); x.lineTo(fx + s * 0.055, fz - s * 0.05); x.lineTo(fx + 2, fz - s * 0.03); x.closePath(); x.fill(); x.stroke();
      }
    }
    const [a, b] = to(me.x, me.z);
    x.save(); x.translate(a, b); x.rotate(-me.yaw + Math.PI); x.fillStyle = '#ffc466'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -s * 0.05); x.lineTo(s * 0.033, s * 0.035); x.lineTo(0, s * 0.018); x.lineTo(-s * 0.033, s * 0.035); x.closePath(); x.fill(); x.stroke(); x.restore();
  }

  /* ---------- end of match ---------- */
  showEnd(room, myId) {
    const e = $('endcard'); const me = room.players.find(p => p.id === myId);
    let title = esc(t('matchOver'));
    const w = room.winner;
    if (w === 'draw') title = esc(t('draw'));
    else if (w === 'blue' || w === 'red') title = esc(t((me && me.team === w) ? 'victory' : 'defeat'));
    else if (typeof w === 'number') { const p = room.players.find(x => x.id === w); title = p ? (p.id === myId ? esc(t('youWin')) : th('playerWins', { name: p.name })) : esc(t('matchOver')); }
    const back = room.kind === 'ranked' ? `${esc(t('backMenu'))} · <span id="endT">${GAME.END_SCREEN_S}</span>` : esc(t('backLobby', { n: '\u0001' })).replace('\u0001', `<span id="endT">${GAME.END_SCREEN_S}</span>`);
    e.innerHTML = `<div class="big">${title}</div><p>${w === 'blue' || w === 'red' ? esc(t('teamWins', { team: t(w) })) + ' · ' : ''}${back}</p>${this.mvpHTML(room, myId)}<div id="rpRes">${rankResultHTML(this.rankRes)}</div><div id="rewRes">${this.rewardHTML(room)}</div>` + this.gridHTML(room);
    e.hidden = false; e.scrollTop = 0;
    // Play the result in, but only the first time. showEnd runs again when the language changes
    // or when you come back to a room that has already finished, and the reward and rank blocks
    // are patched in a moment later — none of that is the match ending a second time.
    const key = (room && room.code ? room.code : '') + '|' + String(w);
    if (this._endKey !== key) {
      this._endKey = key;
      e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
      const sting = w === 'draw' ? 'matchDraw'
        : (w === 'blue' || w === 'red') ? ((me && me.team === w) ? 'matchWin' : 'matchLose')
        : (typeof w === 'number') ? (w === myId ? 'matchWin' : 'matchLose') : 'matchDraw';
      if (this.audio) this.audio.play(sting);
    }
    this.endAt = performance.now() + GAME.END_SCREEN_S * 1000;
    clearInterval(this._endI); this._endI = setInterval(() => { const t = $('endT'); if (t) t.textContent = Math.max(0, Math.ceil((this.endAt - performance.now()) / 1000)); }, 250);
  }
  /** Best player of each side, shown at the end of the match. */
  mvpHTML(room, myId) {
    const m = room && room.mvp; if (!m) return '';
    const keys = Object.keys(m); if (!keys.length) return '';
    const card = (tm) => {
      const p = m[tm]; if (!p) return '';
      const mine = p.id === myId;
      return `<div class="mvp-card ${tm}${mine ? ' me' : ''}">
        <span class="crown" aria-hidden="true">♛</span>
        <div><span class="lbl">${esc(tm === 'ffa' ? t('mvpMatch') : t('mvpTeam', { team: t(tm) }))}</span>
        <b>${esc(p.name)}${p.bot ? ` <small>${esc(t('bot'))}</small>` : ''}${mine ? ` <em>${esc(t('mvpYou'))}</em>` : ''}</b>
        <small class="ltr">${esc(t('mvpLine', { k: p.k, d: p.d, dmg: p.dmg }))}</small></div></div>`;
    };
    return `<div class="mvp-row">${keys.map(card).join('')}</div>`;
  }
  hideEnd() { const e = $('endcard'); e.hidden = true; e.classList.remove('show'); this._endKey = null; clearInterval(this._endI); }
  showReward(r) { this.reward = r; const el = $('rewRes'); if (el) el.innerHTML = this.rewardHTML(this.room); }
  rewardHTML(room) {
    const r = this.reward;
    if (!r) return room && (room.kind === 'private' || room.kind === 'practice') ? `<p class="set-hint" style="margin:0 0 10px">${esc(t('rewNone'))}</p>` : '';
    const items = [];
    if (r.coins) items.push(`<span class="got">${COIN}<b>+${r.coins}</b></span>`);
    if (r.gems) items.push(`<span class="got">${GEM}<b>+${r.gems}</b></span>`);
    if (r.parts) items.push(`<span class="got">${PARTS}<b>+${r.parts}</b></span>`);
    for (const c of r.chests || []) items.push(`<span class="got">${chestSVG(c, 'sm')}<b>${esc(t('ch_' + c))}</b></span>`);
    for (const u of r.rankTanks || []) items.push(`<span class="got tank-got">\u{1F6A9}<b>${esc(t(u.unlocked ? 'rankTankNew' : 'rankTankParts', { tank: t('tk_' + u.tank) }))}</b></span>`);
    const qs = (r.quests || []).map(q => `${esc(t('qt_' + q.id, { n: q.need }))} ${q.prog}/${q.need}${q.prog >= q.need ? ' ✓' : ''}`).join(' · ');
    return `<div class="rew-res">${items.join('')}${qs ? `<span class="qp">${qs}</span>` : ''}${r.capped ? `<span class="qp">${esc(t('rewCapped'))}</span>` : ''}</div>`;
  }
  showRankResult(res) { this.rankRes = res; const el = $('rpRes'); if (el) el.innerHTML = rankResultHTML(res); }

  /* ---------- objectives (flags, zone, rounds) ---------- */
  objective(obj, room, myId) {
    this.obj = obj;
    const el = $('objLine');
    if (!obj || !room || room.state !== 'playing' || !['ctf', 'koh', 'lts', 'convoy', 'jugg', 'ball', 'surv', 'potato', 'bounty'].includes(room.mode)) { el.hidden = true; return; }
    const me = room.players.find(p => p.id === myId), team = me ? me.team : 'blue', foe = team === 'blue' ? 'red' : 'blue';
    const name = (id) => { const p = room.players.find(x => x.id === id); return p ? p.name : '?'; };
    let h = '';
    if (obj.flags) {
      const mine = obj.flags[team], theirs = obj.flags[foe];
      if (theirs && theirs.s === 'carried' && theirs.c === myId) h = `<span style="color:var(--acc)">${esc(t('oYouCarry'))}</span>`;
      else if (mine) h = esc(mine.s === 'home' ? t('oFlagHome') : mine.s === 'carried' ? t('oFlagCarried', { name: name(mine.c) }) : t('oFlagDropped'));
    }
    if (obj.zone) {
      const own = obj.zone.own, sc = obj.score || {}, lim = room.limit || 100;
      const txt = own === team ? t('oZoneMine') : own === foe ? t('oZoneTheirs') : own === 'contested' ? t('oZoneCont') : t('oZoneEmpty');
      h = `<span style="color:${own === team ? 'var(--ok)' : own === foe ? 'var(--bad)' : own === 'contested' ? 'var(--warn)' : '#fff'}">${esc(txt)}</span><span class="zb"><i class="b" style="width:${(sc.blue || 0) / lim * 50}%"></i><span style="flex:1"></span><i class="r" style="width:${(sc.red || 0) / lim * 50}%"></i></span>`;
    }
    if (obj.round) {
      const R = obj.round, n = (tm) => room.players.filter(p => p.team === tm).length;
      const pips = (tm) => `<span class="pip ${tm === 'blue' ? 'b' : 'r'}">${Array.from({ length: n(tm) }, (_, i) => `<i class="${i < (R.alive[tm] || 0) ? 'on' : ''}"></i>`).join('')}</span>`;
      h = `${pips('blue')}<span>${esc(t('aliveLbl'))}</span>${pips('red')}`;
      this.clockBase = { left: R.left, at: performance.now() };
      $('modeLbl').textContent = t('roundN', { n: R.n }) + ' · ' + t('toScore', { mode: t('lts'), n: room.limit });
    }
    // ---- party modes
    const bar = (pct, col) => `<span class="zb"><i class="b" style="width:${Math.min(100, pct)}%;background:${col}"></i></span>`;
    if (obj.cv) {
      const C = obj.cv, att = C.att === team;
      h = `<span style="color:${att ? 'var(--ok)' : 'var(--bad)'}">${esc(t(att ? 'oPush' : 'oStop'))}</span>${bar(C.pct, att ? '#8fd16a' : '#ff6250')}<span>${C.pct}%</span><small>${esc(t('oHalf', { n: C.half }))}${C.half === 2 ? ' · ' + esc(t('oToBeat', { n: C.best[C.att === 'blue' ? 'red' : 'blue'] })) : ''}</small>`;
      this.clockBase = { left: C.left, at: performance.now() };
    }
    if (room.mode === 'jugg') {
      const j = room.players.find(p => p.id === obj.jg), mine = room.players.find(p => p.id === myId);
      h = j ? `<span style="color:var(--acc)">👑 ${esc(j.id === myId ? t('oYouGiant') : t('oGiantIs', { name: j.name }))}</span><small>${esc(t('oYourTime', { n: mine ? mine.ms || 0 : 0, lim: room.limit }))}</small>` : esc(t('oGiantSoon'));
    }
    if (room.mode === 'ball') h = esc(t('oBall'));
    if (obj.sv) {
      const V = obj.sv;
      h = V.phase === 'break' ? `<span style="color:var(--ok)">${esc(t('oNextWave', { n: V.wave + 1, s: V.left }))}</span>` : `<span>${esc(t('oWave', { n: V.wave, f: V.foes }))}</span>`;
      h += `${bar(V.hp, V.hp > 50 ? '#8fd16a' : V.hp > 25 ? '#ffd23a' : '#ff6250')}<small>${esc(t('oSpot', { n: V.hp }))}</small>`;
      $('sBlue').textContent = Math.max(0, V.wave - (V.phase === 'fight' ? 1 : 0)); $('sBlueLbl').textContent = t('wavesLbl'); $('sRed').textContent = V.foes; $('sRedLbl').textContent = t('foesLbl');
    }
    if (obj.pt) h = `<span>${esc(t('oAlive', { n: obj.pt.alive }))}</span><small>${esc(t('oBump'))}</small>`;
    if (room.mode === 'bounty') { const mine = room.players.find(p => p.id === myId); h = `<span style="color:var(--acc)">${esc(t('oBounty'))} ${'★'.repeat(mine && mine.bn || 0) || '—'}</span><small>${esc(t('oBountyHint'))}</small>`; }
    if (obj.score && GAME.MODES[room.mode] && GAME.MODES[room.mode].pts && room.mode !== 'surv') { $('sBlue').textContent = obj.score.blue || 0; $('sRed').textContent = obj.score.red || 0; }
    el.innerHTML = h; el.hidden = !h;
  }
  // Survival: between waves, pick one of three upgrades (auto-picked if you don't choose in time).
  upgradePicker(ev, pick) {
    let el = document.getElementById('upgPick');
    if (!el) { el = document.createElement('div'); el.id = 'upgPick'; el.className = 'upg-pick'; document.body.appendChild(el); }
    const ico = { armor: '🛡', rapid: '⚡', power: '💥', repair: '🔧' };
    el.innerHTML = `<b>${esc(t('upgTitle', { n: ev.wave }))}</b><div>${ev.v.map(v => `<button type="button" data-u="${v}"><i>${ico[v] || '★'}</i><span>${esc(t('upg_' + v))}</span></button>`).join('')}</div>`;
    el.hidden = false;
    el.querySelectorAll('[data-u]').forEach(b => b.onclick = (e) => { e.stopPropagation(); pick(b.dataset.u); el.hidden = true; });
    clearTimeout(this._upg); this._upg = setTimeout(() => { el.hidden = true; }, (ev.left || 12) * 1000);
  }
  /* ---------- spectating (out of the match): who you watch, ◀ ▶ to switch ---------- */
  spectate(name, multi = false, cycle = null) {
    let el = document.getElementById('specBar');
    if (!name) { if (el) el.hidden = true; this.specOn = false; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'specBar'; el.className = 'spec-bar pnl';
      el.innerHTML = '<button type="button" class="sb-prev" aria-label="previous">◀</button><span><small></small><b></b></span><button type="button" class="sb-next" aria-label="next">▶</button>';
      this.vl.appendChild(el);
      el.querySelector('.sb-prev').onclick = (e) => { e.stopPropagation(); this._cycle && this._cycle(-1); };
      el.querySelector('.sb-next').onclick = (e) => { e.stopPropagation(); this._cycle && this._cycle(1); };
      window.addEventListener('keydown', (e) => { if (!this.specOn || !this._cycle) return; if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') this._cycle(-1); if (e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') this._cycle(1); });
    }
    this._cycle = cycle; this.specOn = true; el.hidden = false;
    el.querySelector('small').textContent = t('spectating'); el.querySelector('b').textContent = name;
    el.querySelectorAll('button').forEach(b => { b.style.visibility = multi ? '' : 'hidden'; });
  }
  /* ---------- guide markers (CTF flags): above the flag on screen, or an arrow at the screen edge ---------- */
  guides(list) {
    this._gd = this._gd || new Map();
    const W = window.innerWidth, H = window.innerHeight, M = 46, keep = new Set();
    for (const g of list) {
      keep.add(g.key);
      let e = this._gd.get(g.key);
      if (!e) { e = document.createElement('div'); e.className = 'guide'; e.innerHTML = '<i></i><span></span>'; this.ov.appendChild(e); this._gd.set(g.key, e); }
      e.style.setProperty('--gc', g.col); if (e._l !== g.label) { e.lastChild.textContent = g.label; e._l = g.label; }
      const p = g.p; let x, y, ang = 0, edge = false;
      if (p && p.on && p.x > M && p.x < W - M && p.y > M && p.y < H - M) { x = p.x; y = p.y; }
      else {
        let dx = p ? p.x - W / 2 : 0, dy = p ? p.y - H / 2 : 1; if (!p) { dx = 0; dy = H; }
        const k = Math.min((W / 2 - M) / Math.max(1e-3, Math.abs(dx)), (H / 2 - M) / Math.max(1e-3, Math.abs(dy)));
        x = W / 2 + dx * k; y = H / 2 + dy * k; ang = Math.atan2(dy, dx) * 180 / Math.PI - 90; edge = true;
      }
      e.classList.toggle('edge', edge); e.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`; e.firstChild.style.transform = `translate(-50%,-50%) rotate(${edge ? ang.toFixed(0) : 0}deg)`;
      e.hidden = false;
    }
    for (const [k, e] of this._gd) if (!keep.has(k)) e.hidden = true;
  }
  objToast(text, color = '#fff') {
    const e = $('objToast'); e.textContent = text; e.style.color = color;
    e.hidden = false; e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop');
    clearTimeout(this._ot); this._ot = setTimeout(() => { e.hidden = true; }, 2000);
  }
}
