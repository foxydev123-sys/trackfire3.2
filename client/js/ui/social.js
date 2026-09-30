/* =====================================================================
   Online UI: home profile card, pages (profile, leaderboards, friends +
   chat, ranked, game modes, rank tiers) and overlays (search bar, match
   found, notifications, dialogs). Pure DOM; talks to the server through
   the Account object.
   ===================================================================== */
import { t, getLang } from '../i18n.js';
import { GAME } from '../../shared/config.js';
import { ABILITIES, abilityOf } from '../../shared/abilities.js';
import { TIERS, quickModeOf, seasonInfo } from '../../shared/ranks.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ROMAN = { 3: 'III', 2: 'II', 1: 'I' };
const MAPK = { hawler: 'mapHawler', desert: 'mapDesert', forest: 'mapForest' };
const L = (s) => `<span class="ltr">${esc(s)}</span>`;
const idText = (c) => `<span class="ltr">${esc(c.name)}<span class="muted">#${esc(c.tag)}</span></span>`;

/* ---------------- rank helpers (shared with HUD / end card) ---------------- */
export function rankName(r) {
  if (!r || !r.placed) return r ? t('placement', { n: r.games || 0, of: r.of || GAME.RANKED.PLACEMENT }) : t('unranked');
  return r.tier === 'legend' ? t('legend') : `${t(r.tier)} ${ROMAN[r.div] || ''}`;
}
export function badge(r, size = '') {
  if (!r || !r.placed) return `<span class="rbadge none ${size}" aria-hidden="true"><span class="q">?</span></span>`;
  if (r.tier === 'legend') return `<span class="rbadge legend t-legend ${size}" aria-hidden="true"><span class="sun"></span></span>`;
  return `<span class="rbadge t-${r.tier} ${size}" aria-hidden="true"><span class="chev">${'<i></i>'.repeat(4 - (r.div || 3))}</span></span>`;
}
export const tierClass = (r) => 'tc-' + (r && r.placed ? r.tier : 'none');
const nextText = (r) => !r || !r.placed ? t('placementSub', { n: Math.max(0, (r?.of || 5) - (r?.games || 0)) }) : r.next ? t('toNext', { n: r.next.need, r: `${t(r.next.tier)} ${ROMAN[r.next.div]}` }) : t('topRank');
const modeName = (m) => t('m_' + m);
const cityName = (c) => { const k = 'city_' + String(c).toLowerCase(); const v = t(k); return v === k ? c : v; };
function statusText(st) {
  if (!st || st.s === 'offline') return t('stOffline');
  if (st.s === 'queue') return t('stQueue');
  if (st.s === 'match') return t('stMatch', { mode: st.kind === 'ranked' ? t('rankedMode') : modeName(st.mode) + (st.map ? ' · ' + t(MAPK[st.map] || 'mapHawler') : '') });
  return t('stOnline');
}
const dotClass = (st) => !st || st.s === 'offline' ? '' : st.s === 'match' ? 'match' : st.s === 'queue' ? 'queue' : 'on';
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
  ku: ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەممووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'],
};
function fmtDate(ts) { const d = new Date(ts); return `${(MONTHS[getLang()] || MONTHS.en)[d.getMonth()]} ${d.getFullYear()}`; }
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// Each mode's picture: a real 3D render of that mode (see renderModeImages in main.js),
// with a saved picture used until the live one is ready.
export function modeArt(kind) {
  return `<div class="art mode-pic" style="background-image:var(--mode-${kind},url(img/modes/${kind}.jpg))" role="img" aria-hidden="true"></div>`;
}

const TORD = { bronze: 0, silver: 1, gold: 2, plat: 3, dia: 4, cmd: 5, legend: 6 };
const rankOrder = (r) => !r || !r.placed ? -1 : r.tier === 'legend' ? 99 : TORD[r.tier] * 3 + (3 - r.div);
/** Ranked result block (end-of-match card and menu dialog). */
export function rankResultHTML(res) {
  if (!res) return '';
  if (res.unrated || res.cancelled) return `<div class="rp-res"><p class="note" style="margin:0">${esc(t(res.cancelled ? 'cancelRes' : 'unratedRes'))}</p></div>`;
  const b = res.before.rank, a = res.after.rank, d = res.delta || 0;
  const title = !b.placed && a.placed ? t('newRank') : rankOrder(a) > rankOrder(b) ? t('rankUp') : rankOrder(a) < rankOrder(b) ? t('rankDown') : t('rpTitle');
  const parts = (res.parts || []).map(([k, v]) => `<div><span>${esc(t('rp_' + k))}</span><b class="${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v == null ? '' : L((v > 0 ? '+' : '') + v)}</b></div>`).join('');
  return `<div class="rp-res"><div class="rup">${badge(b, '')}<span class="arrow">${getLang() === 'en' ? '→' : '←'}</span>${badge(a, 'lg')}
    <div style="display:grid;text-align:start"><span class="up">${esc(title)}</span><b class="${tierClass(a)}" style="font-size:18px">${esc(rankName(a))}</b><span class="gain ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}">${L((d > 0 ? '+' : '') + d + ' RP')}</span></div></div>
    <div class="parts">${parts}<div style="border-top:1px solid rgba(255,255,255,.15);padding-top:4px"><span>${esc(t('total'))}</span><b class="${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}">${L((d > 0 ? '+' : '') + d + ' RP')}</b></div></div>
    ${a.placed ? `<div class="rpbar" style="width:min(360px,100%)"><i style="width:${Math.round((a.pct || 0) * 100)}%"></i></div>` : ''}<span class="muted" style="font-size:12.5px">${esc(nextText(a))}</span></div>`;
}

export class SocialUI {
  /** app: { acc, audio, toast, show(screen), joinRoom(code), enterRanked(go), screen(), requireAccount() → Promise<bool>, inPrivateLobby() → code|null } */
  constructor(app) {
    this.app = app; this.acc = app.acc;
    this.page = null; this.arg = null;
    this.lb = { board: 'kills', period: 'season', scope: 'global' };
    this.rankedSize = 3; this.chatSel = 0; this.meProfile = null; this.found = null;
    this.pages = {};                  // extra pages registered by other modules: name → { title, render, needsAcc }
    const A = this.acc;
    A.on('status', () => { this.renderHome(); this.refreshPage(); });
    A.on('account', () => { this.meProfile = null; this.renderHome(); });
    A.on('me', () => this.loadMe());
    A.on('info', () => this.renderHome());
    A.on('friends', () => { this.renderHome(); if (this.page === 'friends') this.renderFriends(false); if (this.page === 'ranked') this.render(); if (this.page === 'profile') this.render(); });
    A.on('chat', (id) => { this.renderHome(); if (this.page === 'friends') { if (id === this.chatSel) { this.acc.unread.delete(id); this.renderMsgs(); } this.renderFriends(false); } });
    A.on('party', () => { if (this.page === 'ranked') this.render(); });
    A.on('queue', (q) => { this.queueUI(); if (this.page === 'ranked') this.render(); if (q.state === 'idle' && q.reason === 'party_changed') this.app.toast(t('e_member_offline')); });
    A.on('notify', (n) => this.notify(n));
    A.on('partyDeclined', () => {});
    A.on('found', (m) => this.showFound(m));
    A.on('foundUpdate', (m) => this.foundUpdate(m));
    A.on('foundCancel', (m) => { this.hideFound(); this.app.toast(m.requeued ? t('foundCancel') : t('foundOut'), 3500); });
    A.on('go', (m) => { this.hideFound(); this.app.enterRanked(m); });
    $('btnBack').addEventListener('click', () => { this.app.audio.play('click'); this.back(); });
    $('queueCancel').addEventListener('click', () => { this.app.audio.play('click'); this.acc.req({ t: 'unqueue' }); });
    $('meCard').addEventListener('click', () => this.go('profile', this.acc.id));
    $('friendsMini').addEventListener('click', () => this.go('friends'));
    $('navProfile').addEventListener('click', () => this.go('profile', this.acc.id));
    $('navBoards').addEventListener('click', () => this.go('boards'));
    $('navFriends').addEventListener('click', () => this.go('friends'));
    this.qTimer = setInterval(() => this.tick(), 500);
  }

  /* ---------------- navigation ---------------- */
  async go(page, arg) {
    this.app.audio.play('click');
    const needsAcc = page === 'profile' || page === 'friends' || page === 'ranked' || !!(this.pages[page] && this.pages[page].needsAcc);
    if (needsAcc && !(await this.app.requireAccount())) return;
    if (page === 'profile' && !arg) arg = this.acc.id;
    this.page = page; this.arg = arg;
    if (page === 'friends' && arg) this.chatSel = arg;
    this.app.show('page');
    $('scr-page').scrollTop = 0;
    this.render();
  }
  back() { this.page = null; this.app.show('menu'); this.renderHome(); this.loadMe(); }
  refreshPage() { if (this.app.screen() === 'page' && this.page) this.render(); }
  render() {
    const titles = { profile: 'navProfile', boards: 'lbTitle', friends: 'fTitle', ranked: 'rankedTitle', modes: 'modesBtn', ranks: 'tiersTitle' };
    const X = this.pages[this.page];
    $('pageTitle').textContent = t(X ? X.title : titles[this.page] || 'back');
    const body = $('pageBody');
    if (X) { if (!this.acc.online && X.needsAcc) body.innerHTML = `<div class="card empty">${esc(this.acc.reachable === false ? t('e_offline_srv') : t('loadingDots'))}</div>`; else X.render(body); this.queueUI(); return; }
    if (this.page !== 'modes' && this.page !== 'ranks' && this.page !== 'boards' && !this.acc.online) {
      body.innerHTML = `<div class="card empty">${esc(this.acc.reachable === false ? t('e_offline_srv') : t('loadingDots'))}</div>`;
      if (this.page !== 'profile') return;
    }
    ({ profile: () => this.renderProfile(), boards: () => this.renderBoards(), friends: () => this.renderFriends(true), ranked: () => this.renderRanked(), modes: () => this.renderModes(), ranks: () => this.renderRanks() })[this.page]?.();
    this.queueUI();
  }

  /* ---------------- home ---------------- */
  async loadMe() {
    if (!this.acc.has || !this.acc.reachable) return;
    try { this.meProfile = await this.acc.api('/api/me'); } catch (e) { return; }
    this.renderHome();
  }
  renderHome() {
    const A = this.acc, info = A.info;
    const qm = info ? info.quickMode : quickModeOf();
    $('quickHint').textContent = t('quickSub');
    const s = info ? info.season : seasonInfo();
    $('seasonLine').textContent = t('seasonLine', { n: s.n, d: s.daysLeft }) + (info && info.online ? ' · ' + t('onlineN', { n: info.online }) : '');
    const idl = $('idLine');
    idl.hidden = !A.has; if (A.has) idl.innerHTML = `${esc(t('pid'))}: <b>${esc(A.acc.name)}#${esc(A.acc.tag)}</b>`;
    const card = $('meCard'), mini = $('friendsMini');
    const off = A.reachable === false;
    for (const id of ['navProfile', 'navFriends']) $(id).disabled = off;
    $('navBoards').disabled = off;
    if (off) { card.innerHTML = `<p class="side-note">${esc(t('offlineNote'))}</p>`; mini.hidden = true; $('frBadge').hidden = true; return; }
    if (!A.has) { card.innerHTML = `<p class="side-note">${esc(t('setName'))}</p>`; mini.hidden = true; $('frBadge').hidden = true; return; }
    const p = this.meProfile, r = p ? p.rank : null, ss = p ? p.season_stats : null;
    card.innerHTML = `<p class="lbl" style="margin:0">${esc(t('navProfile'))}</p>
      <div class="me-row">${badge(r, '')}<div class="who"><div class="nm"><span class="ltr">${esc(A.acc.name)}<small>#${esc(A.acc.tag)}</small></span></div>
      <div class="rk ${tierClass(r)}">${esc(rankName(r))}${r && r.placed ? ' · ' + L(r.rp + ' RP') : ''}</div>
      ${r && r.placed ? `<div class="rpbar"><i style="width:${Math.round((r.pct || 0) * 100)}%"></i></div>` : ''}
      <div class="nx">${esc(nextText(r))}</div></div></div>
      ${ss ? `<div class="stat-strip"><span>${esc(t('kills'))} <b>${ss.kills}</b></span><span>${esc(t('wins'))} <b>${ss.wins}</b></span><span>${esc(t('kd'))} <b>${(ss.kills / Math.max(1, ss.deaths)).toFixed(2)}</b></span></div>` : ''}`;
    const on = A.friends.filter(f => f.st && f.st.s !== 'offline');
    mini.hidden = !A.online;
    mini.innerHTML = `<p class="lbl" style="margin:0">${esc(t('friendsOn'))} · ${L(on.length)}</p>` + (on.length ? on.slice(0, 4).map(f => `<div class="row"><span class="dot ${dotClass(f.st)}"></span><span class="n">${L(f.name)}</span><small>${esc(statusText(f.st))}</small></div>`).join('') : `<div class="row"><small style="margin:0">${esc(t('noFriendsOn'))}</small></div>`);
    const n = A.unreadTotal(); $('frBadge').hidden = !n; $('frBadge').textContent = n;
  }

  /* ---------------- profile ---------------- */
  async renderProfile() {
    const id = this.arg, body = $('pageBody'), mine = id === this.acc.id;
    if (!body.dataset.pid || body.dataset.pid !== String(id)) body.innerHTML = `<div class="card empty">${esc(t('loadingDots'))}</div>`;
    let p; try { p = await this.acc.profile(id); } catch (e) { body.innerHTML = `<div class="card empty">${esc(t('e_not_found'))}</div>`; return; }
    if (this.page !== 'profile' || this.arg !== id) return;
    body.dataset.pid = String(id);
    const r = p.rank, ss = p.season_stats, at = p.all_time, rel = p.relation;
    const f = this.acc.friend(id), online = f && f.st && f.st.s !== 'offline';
    let acts = '';
    if (mine) acts += `<button class="btn sm" data-a="rename">${esc(t('changeName'))}</button><button class="btn sm ghost" data-a="city">${esc(t('changeCity'))}</button>`;
    if (!mine) {
      if (rel === 'none') acts += `<button class="btn sm" data-a="add">${esc(t('addFriend'))}</button>`;
      if (rel === 'sent') acts += `<button class="btn sm" disabled>${esc(t('reqSent'))}</button>`;
      if (rel === 'incoming') acts += `<button class="btn sm" data-a="accept">${esc(t('accept'))}</button>`;
      if (rel === 'friends') acts += `<button class="btn sm" data-a="msg">${esc(t('message'))}</button>` + (online ? `<button class="btn sm" data-a="squad">${esc(t('inviteSquad'))}</button>` : '') + `<button class="btn sm ghost" data-a="remove">${esc(t('removeFriend'))}</button>`;
      acts += rel === 'blocked' ? `<button class="btn sm ghost" data-a="unblock">${esc(t('unblock'))}</button>` : `<button class="btn sm ghost" data-a="block">${esc(t('block'))}</button>`;
      acts += `<button class="btn sm ghost" data-a="report">${esc(t('report'))}</button>`;
    }
    const kd = (s) => (s.kills / Math.max(1, s.deaths)).toFixed(2), wr = (s) => s.matches ? Math.round(s.wins / s.matches * 100) + '%' : '–';
    const best = r.best ? { placed: true, tier: r.best.tier, div: r.best.div } : null;
    body.innerHTML = `
      <div class="card"><div class="prof-head">${badge(r, 'lg')}
        <div class="info"><div class="nm">${L(p.name)}</div>
          <div class="row"><span class="idbox"><small>${esc(t('pid'))}</small>${L(p.name + '#' + p.tag)}<button type="button" data-a="copy">${esc(t('copyId'))}</button></span>
          ${rel === 'friends' ? `<span class="pill rk">${esc(t('relFriends'))}</span>` : rel === 'incoming' ? `<span class="pill new">${esc(t('relIncoming'))}</span>` : ''}</div>
          <div class="${tierClass(r)}" style="font-weight:700">${esc(rankName(r))}${r.placed ? ' · ' + L(r.rp + ' RP') : ''}</div>
          <div class="muted" style="font-size:13px">${esc(nextText(r))} · ${esc(t('since', { d: fmtDate(p.created) }))}${p.city ? ' · ' + esc(cityName(p.city)) : ''}</div></div>
        <div class="prof-actions">${acts}</div></div></div>
      <div class="cols">
        <div class="card"><p class="lbl">${esc(t('seasonStats'))} · ${esc(t('seasonLine', { n: p.season.n, d: p.season.daysLeft }))}</p>
          <div class="stats">
            ${[[ss.kills, 'kills'], [ss.wins, 'wins'], [ss.matches, 'matches'], [kd(ss), 'kd'], [wr(ss), 'wr']].map(x => `<div class="stat"><b>${L(x[0])}</b><span>${esc(t(x[1]))}</span></div>`).join('')}
            <div class="stat"><b class="${tierClass(best)}" style="font-size:19px">${best ? esc(rankName(best)) : '–'}</b><span>${esc(t('best'))}</span></div></div>
          <div class="stat-strip" style="margin-top:12px"><span>${esc(t('allTimeStats'))}:</span><span>${esc(t('kills'))} <b>${at.kills}</b></span><span>${esc(t('wins'))} <b>${at.wins}</b></span><span>${esc(t('matches'))} <b>${at.matches}</b></span></div>
          <div class="stat-strip" style="margin-top:6px">${p.fav_map ? `<span>${esc(t('favMap'))}: <b>${esc(t(MAPK[p.fav_map] || 'mapHawler'))}</b></span>` : ''}${p.fav_mode ? `<span>${esc(t('favMode'))}: <b>${esc(p.fav_mode === 'ranked' ? t('rankedMode') : modeName(p.fav_mode))}</b></span>` : ''}</div>
          <p class="sub" style="font-size:12.5px;margin-top:10px">${esc(t('statsNote'))}</p></div>
        ${p.garage ? `<div class="card"><p class="lbl">${esc(t('theirTanks'))} · ${L(p.garage.owned + '/' + p.garage.total)}</p>
          <div class="pg-tanks">${p.garage.tanks.map(k => {
            const A2 = ABILITIES[abilityOf(k.id)];
            return `<div class="pg-tank${k.id === p.garage.sel ? ' cur' : ''}">
              <img alt="" src="${this.app.tankImg(k.id)}">
              <b>${esc(t('tk_' + k.id))}</b>
              <span class="lv">${esc(t('lv', { n: k.level }))}</span>
              <span class="st">${'★'.repeat(Math.max(1, Math.ceil(k.level / 2)))}${'☆'.repeat(5 - Math.max(1, Math.ceil(k.level / 2)))}</span>
              ${A2 ? `<span class="ab" title="${esc(t('ab_' + abilityOf(k.id)))}">${A2.icon} ${esc(t('ab_' + abilityOf(k.id)))} ${L(k.ab + '/5')}</span>` : ''}
              ${k.id === p.garage.sel ? `<span class="pill rk">${esc(t('playingNow'))}</span>` : ''}</div>`;
          }).join('')}</div></div>` : ''}
        <div class="card"><p class="lbl">${esc(t('recent'))}</p><div class="hist">${p.recent.length ? p.recent.map(m => `<div class="h"><span class="${m.left ? 'x' : m.won ? 'w' : 'l'}">${esc(t(m.left ? 'resLeft' : m.won ? 'resW' : 'resL'))}</span><span>${esc(t(MAPK[m.map] || 'mapHawler'))} <small>· ${esc(m.kind === 'ranked' ? t('rankedMode') : modeName(m.mode))}</small></span><span class="num">${L(m.k + ' / ' + m.d)}</span><span class="num ${m.rp > 0 ? 'pos' : m.rp < 0 ? 'neg' : 'muted'}">${m.rp != null ? L((m.rp > 0 ? '+' : '') + m.rp + ' RP') : '–'}</span></div>`).join('') : `<div class="empty">${esc(t('noMatches'))}</div>`}</div></div>
      </div>`;
    body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => this.profileAction(b.dataset.a, p)));
  }
  async profileAction(a, p) {
    this.app.audio.play('click');
    const A = this.acc; let r;
    if (a === 'copy') return this.copy(`${p.name}#${p.tag}`);
    if (a === 'rename') {
      const v = await this.prompt(t('changeName'), A.acc.name, 14);
      if (v == null || !v.trim()) return;
      try { await A.ensure(v.trim()); this.app.toast(t('nameChanged')); this.render(); }
      catch (e) { this.app.toast(e.code === 'name_wait' ? t('e_name_wait', { n: e.days }) : t('e_' + (e.code || 'server'))); }
      return;
    }
    if (a === 'city') {
      const v = await this.prompt(t('changeCity'), p.city || '', 24);
      if (v == null) return;
      try { await A.setCity(v.trim()); this.app.toast(t('cityChanged')); this.render(); } catch (e) { this.app.toast(t('e_server')); }
      return;
    }
    if (a === 'add') r = await A.req({ t: 'friendReq', to: p.id ? `${p.name}#${p.tag}` : '' });
    if (a === 'accept') r = await A.req({ t: 'friendAccept', id: p.id });
    if (a === 'msg') return this.go('friends', p.id);
    if (a === 'squad') { r = await A.req({ t: 'partyInvite', to: p.id }); if (r.t === 'ok') this.app.toast(this.iLead() ? t('sqInvSent', { name: p.name }) : t('sqAskSent', { who: p.name })); }
    if (a === 'remove') { if (!(await this.confirm(t('removeFriend') + '?'))) return; r = await A.req({ t: 'friendRemove', id: p.id }); }
    if (a === 'block') { if (!(await this.confirm(t('blockConfirm', { name: p.name })))) return; r = await A.req({ t: 'block', id: p.id }); }
    if (a === 'unblock') r = await A.req({ t: 'unblock', id: p.id });
    if (a === 'report') return this.reportDialog(p);
    if (r && r.t === 'err') this.app.toast(t('e_' + r.code) !== 'e_' + r.code ? t('e_' + r.code) : t('e_server'));
    this.render();
  }
  copy(text) {
    const done = () => this.app.toast(t('idCopied', { id: text }));
    try { navigator.clipboard.writeText(text).then(done, done); } catch (e) { done(); }
  }

  /* ---------------- leaderboards ---------------- */
  async renderBoards() {
    const body = $('pageBody'), S = this.lb;
    const seg = (key, opts) => `<span class="seg" data-k="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S[key] === v}">${esc(t(l))}</button>`).join('')}</span>`;
    const head = `<div class="lb-tabs">${seg('board', [['kills', 'lbKills'], ['wins', 'lbWins'], ['rank', 'lbRank']])}<span class="row">${seg('period', [['season', 'thisSeason'], ['all', 'allTime']])}${this.acc.has ? seg('scope', [['global', 'global'], ['friends', 'friendsOnly']]) : ''}</span></div>`;
    body.innerHTML = head + `<div class="card tbl-wrap" id="lbTable"><div class="empty">${esc(t('loadingDots'))}</div></div>`;
    body.querySelectorAll('.seg[data-k]').forEach(sg => sg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.app.audio.play('click'); S[sg.dataset.k] = b.dataset.v; this.renderBoards(); }));
    let d; try { d = await this.acc.leaderboard(S.board, S.period, S.scope); } catch (e) { $('lbTable').innerHTML = `<div class="empty">${esc(t('e_offline_srv'))}</div>`; return; }
    if (this.page !== 'boards') return;
    const val = (row) => S.board === 'rank' ? L(row.value + ' RP') : L(row.value);
    const colName = S.board === 'rank' ? 'rank' : S.board === 'wins' ? 'wins' : 'kills';
    const tr = (row, me) => `<tr class="${row.pos && row.pos <= 3 ? 'p' + row.pos : ''} ${me ? 'me' : ''}" data-id="${row.id}"><td class="pos-c num">${row.pos ? L(row.pos) : '–'}</td><td>${idText(row)}${me ? ` <span class="pill rk">${esc(t('you'))}</span>` : ''}</td><td><span class="pc">${badge(row.rank, 'sm')}<span class="${tierClass(row.rank)}">${esc(rankName(row.rank))}</span></span></td><td class="n">${val(row)}</td></tr>`;
    const rows = d.rows.map(r => tr(r, r.id === this.acc.id)).join('');
    const meRow = d.me && !d.rows.some(r => r.id === d.me.id) ? `<tr><td colspan="4" style="text-align:center;color:var(--mute2)">⋯</td></tr>` + tr(d.me, true) : '';
    $('lbTable').innerHTML = d.rows.length ? `<table class="lbt"><thead><tr><th>#</th><th>${esc(t('player'))}</th><th>${esc(t('rank'))}</th><th class="n">${esc(t(colName))}</th></tr></thead><tbody>${rows}${meRow}</tbody></table>` : `<div class="empty">${esc(t('lbEmpty'))}</div>`;
    $('lbTable').querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => this.go('profile', Number(r.dataset.id))));
  }

  /* ---------------- friends + chat ---------------- */
  renderFriends(full) {
    const A = this.acc, body = $('pageBody');
    if (!A.online) return;
    const sorted = [...A.friends].sort((a, b) => ((b.st?.s !== 'offline') - (a.st?.s !== 'offline')) || a.name.localeCompare(b.name));
    if (!this.chatSel && sorted.length) this.chatSel = sorted[0].id;
    const list = `
      <div class="card" style="display:grid;gap:10px">
        <div class="row"><span class="idbox"><small>${esc(t('pid'))}</small>${L(A.idText)}<button type="button" id="cpMine">${esc(t('copyId'))}</button></span></div>
        <form class="addrow" id="addForm"><input class="inp sm" id="addId" autocomplete="off" spellcheck="false" dir="ltr" placeholder="${esc(t('addPh'))}" aria-label="${esc(t('addPh'))}"><button class="btn sm" type="submit">${esc(t('add'))}</button></form>
        ${A.incoming.length ? `<p class="lbl" style="margin:4px 0 0">${esc(t('requests'))} · ${L(A.incoming.length)}</p>` + A.incoming.map(c => `<div class="req">${badge(c.rank, 'sm')}<b>${idText(c)}</b><span class="spacer"></span><button class="btn sm" data-acc="${c.id}">${esc(t('accept'))}</button><button class="btn sm ghost" data-dec="${c.id}">${esc(t('decline'))}</button></div>`).join('') : ''}
        ${A.outgoing.length ? `<p class="lbl" style="margin:4px 0 0">${esc(t('sentReqs'))}</p>` + A.outgoing.map(c => `<div class="req"><b>${idText(c)}</b><span class="spacer"></span><button class="btn sm ghost" data-dec="${c.id}">${esc(t('cancel'))}</button></div>`).join('') : ''}
        <p class="lbl" style="margin:4px 0 0">${esc(t('fTitle'))} · ${L(A.friends.length)}</p>
        <div class="flist">${sorted.length ? sorted.map(f => { const u = A.unread.get(f.id) || 0; return `<div class="fitem ${f.id === this.chatSel ? 'sel' : ''}" data-f="${f.id}"><span class="dot ${dotClass(f.st)}"></span>${badge(f.rank, 'sm')}<div class="who"><b>${idText(f)}</b><small>${esc(statusText(f.st))}</small></div>${u ? `<b class="badge-n">${u}</b>` : ''}<button type="button" class="fprof" data-prof="${f.id}" title="${esc(t('viewProfile'))}" aria-label="${esc(t('viewProfile'))}">☰</button></div>`; }).join('') : `<div class="empty">${esc(t('noFriends'))}</div>`}</div>
        ${A.blocked.length ? `<details><summary class="lbl" style="cursor:pointer">${esc(t('blockedT'))} · ${A.blocked.length}</summary>${A.blocked.map(c => `<div class="req"><b>${idText(c)}</b><span class="spacer"></span><button class="btn sm ghost" data-unb="${c.id}">${esc(t('unblock'))}</button></div>`).join('')}</details>` : ''}
      </div>`;
    if (full || !$('chatPanel')) {
      body.innerHTML = `<div class="fr"><div id="frList">${list}</div><div class="card chat" id="chatPanel"></div></div>`;
      this.renderChat(true);
    } else { const keep = $('addId') ? $('addId').value : ''; $('frList').innerHTML = list; $('addId').value = keep; this.renderChatHead(); }
    const L2 = $('frList');
    $('cpMine').onclick = () => this.copy(A.idText);
    $('addForm').onsubmit = async (e) => { e.preventDefault(); const v = $('addId').value.trim(); if (!v) return; const r = await A.req({ t: 'friendReq', to: v }); if (r.t === 'err') this.app.toast(t('e_' + r.code)); else { $('addId').value = ''; this.app.toast(t('reqSent')); } };
    L2.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { await A.req({ t: 'friendAccept', id: Number(b.dataset.acc) }); });
    L2.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => { await A.req({ t: 'friendRemove', id: Number(b.dataset.dec) }); });
    L2.querySelectorAll('[data-unb]').forEach(b => b.onclick = async () => { await A.req({ t: 'unblock', id: Number(b.dataset.unb) }); A.req({ t: 'friends' }); });
    L2.querySelectorAll('[data-prof]').forEach(b => b.onclick = (e) => { e.stopPropagation(); this.app.audio.play('click'); this.go('profile', Number(b.dataset.prof)); });
    L2.querySelectorAll('[data-f]').forEach(el => el.onclick = () => { this.chatSel = Number(el.dataset.f); this.app.audio.play('click'); this.renderFriends(false); this.renderChat(true); if (innerWidth < 820) $('chatPanel').scrollIntoView({ behavior: 'smooth' }); });
  }
  renderChatHead() {
    const f = this.acc.friend(this.chatSel), h = $('chatHead'); if (!h || !f) return;
    h.querySelector('.dot').className = 'dot ' + dotClass(f.st); h.querySelector('.st').textContent = statusText(f.st);
  }
  async renderChat(load) {
    const A = this.acc, P = $('chatPanel'); if (!P) return;
    const f = A.friend(this.chatSel);
    if (!f) { P.innerHTML = `<div class="empty">${esc(A.friends.length ? t('pickChat') : t('noFriends'))}</div>`; return; }
    const room = this.app.inPrivateLobby();
    P.innerHTML = `<div class="chat-h" id="chatHead"><span class="dot ${dotClass(f.st)}"></span><button type="button" class="who" style="background:none;border:0;color:#fff;cursor:pointer;padding:0" id="chatWho">${idText(f)}</button><span class="muted st" style="font-size:12px">${esc(statusText(f.st))}</span>
        <span class="tools">${room ? `<button class="btn sm" id="chatInv">${esc(t('inviteBtn'))}</button>` : ''}<button class="btn sm ghost" id="chatRep">${esc(t('report'))}</button><button class="btn sm ghost" id="chatBlk">${esc(t('block'))}</button></span></div>
      <div class="msgs" id="msgs"></div>
      <div class="quick">${['q1', 'q2', 'q3', 'q4'].map(k => `<button type="button" data-q="${k}">${esc(t(k))}</button>`).join('')}</div>
      <form class="send" id="sendForm"><input class="inp sm" id="msgInp" maxlength="200" autocomplete="off" dir="auto" placeholder="${esc(t('typeMsg'))}" aria-label="${esc(t('typeMsg'))}"><button class="btn sm primary" type="submit">${esc(t('send'))}</button></form>
      <p class="safe">${esc(t('safe'))}</p>`;
    const send = (text) => { if (!text.trim()) return; A.send({ t: 'chat', to: f.id, text }); };
    $('sendForm').onsubmit = (e) => { e.preventDefault(); send($('msgInp').value); $('msgInp').value = ''; };
    P.querySelectorAll('[data-q]').forEach(b => b.onclick = () => send(t(b.dataset.q)));
    $('chatWho').onclick = () => this.go('profile', f.id);
    $('chatRep').onclick = () => this.reportDialog(f);
    $('chatBlk').onclick = async () => { if (await this.confirm(t('blockConfirm', { name: f.name }))) { await A.req({ t: 'block', id: f.id }); this.chatSel = 0; this.renderFriends(true); } };
    if ($('chatInv')) $('chatInv').onclick = () => { A.send({ t: 'invite', to: f.id, code: room }); this.app.toast(t('invSent', { name: f.name })); };
    if (load) { await A.history(f.id); this.renderHome(); }
    this.renderMsgs();
    if (innerWidth >= 820) $('msgInp').focus({ preventScroll: true });
  }
  renderMsgs() {
    const box = $('msgs'); if (!box) return;
    const list = this.acc.chats.get(this.chatSel) || [], me = this.acc.id;
    box.innerHTML = list.map(m => m.kind === 'invite'
      ? `<div class="inv ${m.from === me ? 'me' : ''}"><div><div class="muted" style="font-size:12px">${esc(t('roomInvite'))}</div><b>${L(m.text)}</b></div>${m.from === me ? '' : `<button class="btn sm primary" data-join="${esc(m.text)}">${esc(t('join'))}</button>`}</div>`
      : `<div class="m ${m.from === me ? 'me' : ''}">${esc(m.text)}<small>${hhmm(m.ts)}</small></div>`).join('');
    box.querySelectorAll('[data-join]').forEach(b => b.onclick = () => this.app.joinRoom(b.dataset.join));
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- ranked ---------------- */
  renderRanked() {
    const A = this.acc, body = $('pageBody'); if (!A.online) return;
    const p = this.meProfile, r = p ? p.rank : null;
    const party = A.party, leader = !party || party.leader === A.id, q = A.queue;
    const size = GAME.RANKED.SIZE;
    const W = A.wallet, myTank = W ? { id: W.sel, level: W.tanks[W.sel].level } : null;
    const members = party ? party.members : [{ ...(A.me || { id: A.id, name: A.acc.name, tag: A.acc.tag }), rank: r, online: true, tank: myTank }];
    const slots = members.map(m => `<div class="slot">${badge(m.rank, 'sm')}<span class="n">${idText(m)}${m.tank ? `<span class="tkn">${esc(t('tk_' + m.tank.id))} ${esc(t('lv', { n: m.tank.level }))}</span>` : ''}</span>${party && m.id === party.leader ? `<span class="pill rk">${esc(t('leaderLbl'))}</span>` : ''}<span class="r ${tierClass(m.rank)}">${esc(rankName(m.rank))}</span></div>`).join('')
      // Empty places are shown but not clickable here: a squad is built in one place only —
      // the + beside your tank on the menu, or the Friends page.
      + Array.from({ length: Math.max(0, size - members.length) }, () => `<div class="slot empty">${esc(t('sqOpen'))}</div>`).join('');
    const searching = q.state === 'searching';
    body.innerHTML = `
      <div class="card"><div class="row">${badge(r)}<div style="display:grid;gap:2px"><span class="lbl" style="margin:0">${esc(t('rank'))}</span><b class="${tierClass(r)}" style="font-size:18px">${esc(rankName(r))}${r && r.placed ? ' · ' + L(r.rp + ' RP') : ''}</b><span class="muted" style="font-size:12.5px">${esc(nextText(r))}</span></div><span class="spacer"></span><button class="btn sm ghost" id="tiersBtn">${esc(t('tiersBtn'))}</button></div></div>
      <div class="cols">
        <div style="display:grid;gap:14px">
          <div class="card"><p class="lbl">${esc(t('rankedPlays'))}</p>
            <div class="rk-modes">${GAME.RANKED.MODES.map(m => `<span class="rk-mode">${esc(t('m_' + m))}</span>`).join('')}</div>
            <p class="sub" style="font-size:13px;margin-top:8px">${esc(t('rankedRandom', { n: size }))}</p></div>
          <div class="card"><p class="lbl">${esc(t('squad'))}</p><div class="squad">${slots}</div>
            <p class="sub" style="font-size:13px;margin-top:8px">${esc(t('solo'))}</p>
            ${party ? `<button class="btn sm ghost" id="leaveSq" style="margin-top:8px">${esc(t('leaveSquad'))}</button>` : ''}</div>
          ${searching ? `<div class="card search-box"><span class="row"><span class="spin"></span><b>${esc(t('searchingT', { n: size, t: '' }))}</b></span><span class="timer" id="qTimer">0:00</span>${leader ? `<button class="btn sm" id="qCancel">${esc(t('cancel'))}</button>` : ''}</div>`
            : `<button class="btn primary" id="findBtn" ${leader ? '' : 'disabled'}><span>${esc(t('find'))}</span><small class="ltr">${size}v${size}</small></button>`}
        </div>
        <div class="card"><p class="lbl">${esc(t('rulesT'))}</p><ul class="rules">${['rr1', 'rr2', 'rr6', 'rr3', 'rr4', 'rr5'].map(k => `<li>${esc(t(k))}</li>`).join('')}</ul></div>
      </div>`;
    $('tiersBtn').onclick = () => this.go('ranks');
    if ($('leaveSq')) $('leaveSq').onclick = async () => { await A.req({ t: 'partyLeave' }); };
    if ($('findBtn')) $('findBtn').onclick = async () => { this.app.audio.play('click'); const res = await A.req({ t: 'queue' }); if (res.t === 'err') this.app.toast(t('e_' + res.code)); };
    if ($('qCancel')) $('qCancel').onclick = () => A.req({ t: 'unqueue' });
    this.tick();
  }
  /** Open the "pick a friend" dialog from anywhere (the + beside your tank uses this). */
  invite() { return this.friendPicker(); }

  /**
   * What you can do with one member of your squad: look at their profile, hand them the
   * squad, or put them out of it. The last two are the leader's to do, and never to yourself.
   */
  memberMenu(id) {
    const A = this.acc, party = A.party;
    if (!party) return;
    const m = party.members.find((q) => q && q.id === id);
    if (!m) return;
    const iLead = party.leader === A.id, self = id === A.id;
    const card = $('dlgCard');
    card.innerHTML = `<h4>${esc(m.name)}${party.leader === id ? ` <span class="pill rk">${esc(t('sqLeader'))}</span>` : ''}</h4>
      <div class="row" style="flex-direction:column;gap:8px;align-items:stretch">
        <button class="btn sm" id="smProfile">${esc(t('sqProfile'))}</button>
        ${iLead && !self ? `<button class="btn sm" id="smLead">${esc(t('sqMakeLead'))}</button>` : ''}
        ${iLead && !self ? `<button class="btn sm ghost danger-t" id="smKick">${esc(t('sqKick'))}</button>` : ''}
        <button class="btn ghost" id="smNo">${esc(t('cancel'))}</button>
      </div>`;
    $('dlg').hidden = false;
    const close = () => { $('dlg').hidden = true; };
    $('smNo').onclick = close;
    $('smProfile').onclick = () => { close(); this.go('profile', id); };
    if ($('smLead')) $('smLead').onclick = async () => {
      close(); const r = await A.req({ t: 'partyPromote', id });
      if (r.t === 'ok') this.app.toast(t('sqNowLead', { name: m.name }));
    };
    if ($('smKick')) $('smKick').onclick = async () => {
      close(); const r = await A.req({ t: 'partyKick', id });
      if (r.t === 'ok') this.app.toast(t('sqRemoved', { name: m.name }));
    };
  }
  /** True when you are on your own, or you are the one leading the squad. */
  iLead() { const p = this.acc && this.acc.party; return !p || !p.members || p.members.length < 2 || p.leader === this.acc.id; }
  async friendPicker() {
    const on = this.acc.friends.filter(f => f.st && f.st.s !== 'offline' && !(this.acc.party?.members || []).some(m => m.id === f.id));
    const card = $('dlgCard');
    card.innerHTML = `<h4>${esc(t('pickFriend'))}</h4><div class="dlg-list">${on.length ? on.map(f => `<label><input type="radio" name="pf" value="${f.id}">${badge(f.rank, 'sm')}<span>${idText(f)}</span></label>`).join('') : `<div class="empty">${esc(t('noFriendsOn'))}</div>`}</div>
      <div class="row"><button class="btn primary" id="pfOk" ${on.length ? '' : 'disabled'} style="flex:1;justify-content:center">${esc(t('inviteSquad'))}</button><button class="btn ghost" id="pfNo" style="flex:1;justify-content:center">${esc(t('cancel'))}</button></div>`;
    $('dlg').hidden = false;
    $('pfNo').onclick = () => { $('dlg').hidden = true; };
    $('pfOk').onclick = async () => {
      const v = card.querySelector('input[name=pf]:checked'); if (!v) return;
      $('dlg').hidden = true;
      const f = this.acc.friend(Number(v.value)); const r = await this.acc.req({ t: 'partyInvite', to: Number(v.value) });
      const nm = f ? f.name : '';
      this.app.toast(r.t === 'err' ? t('e_' + r.code)
        : this.iLead() ? t('sqInvSent', { name: nm }) : t('sqAskSent', { who: nm }));
    };
  }
  inviteFriendsToRoom(code) {
    const on = this.acc.friends.filter(f => f.st && f.st.s !== 'offline');
    const card = $('dlgCard');
    card.innerHTML = `<h4>${esc(t('inviteFriends'))}</h4><div class="dlg-list">${on.length ? on.map(f => `<label><input type="checkbox" value="${f.id}">${badge(f.rank, 'sm')}<span>${idText(f)}</span></label>`).join('') : `<div class="empty">${esc(this.acc.online ? t('noFriendsOn') : t('e_offline_srv'))}</div>`}</div>
      <div class="row"><button class="btn primary" id="rfOk" ${on.length ? '' : 'disabled'} style="flex:1;justify-content:center">${esc(t('send'))}</button><button class="btn ghost" id="rfNo" style="flex:1;justify-content:center">${esc(t('cancel'))}</button></div>`;
    $('dlg').hidden = false;
    $('rfNo').onclick = () => { $('dlg').hidden = true; };
    $('rfOk').onclick = () => {
      const picked = [...card.querySelectorAll('input:checked')].map(i => Number(i.value));
      for (const id of picked) this.acc.send({ t: 'invite', to: id, code });
      $('dlg').hidden = true;
      if (picked.length) this.app.toast(t('invSent', { name: picked.map(id => this.acc.friend(id)?.name).filter(Boolean).join(', ') }));
    };
  }

  /* ---------------- modes + rank tiers ---------------- */
  renderModes() {
    const wk = this.acc.info ? this.acc.info.quickMode : quickModeOf();
    const pl = { tdm: 'pl28', ffa: 'pl28', ctf: 'pl48', koh: 'pl48', lts: 'pl610', rush: 'pl28', convoy: 'pl48', jugg: 'pl28', ball: 'pl36', surv: 'pl13', potato: 'pl28', bounty: 'pl36' };
    $('pageBody').innerHTML = `<p class="sub">${esc(t('modesSub'))}</p><div class="modes">${GAME.MODE_IDS.map(m => `<div class="card mode">${modeArt(m)}<div class="bd"><div class="meta">${m === wk ? `<span class="pill wk">${esc(t('tagWeek'))}</span>` : ''}${GAME.RANKED.MODES.includes(m) ? `<span class="pill rk">${esc(t('tagRanked'))}</span>` : ''}${['convoy', 'jugg', 'ball', 'surv', 'potato', 'bounty'].includes(m) ? `<span class="pill nw">${esc(t('tagNew'))}</span>` : ''}<span class="pl">${esc(t(pl[m]))}</span></div><h3>${esc(modeName(m))}</h3><p>${esc(t('d_' + m))}</p></div></div>`).join('')}</div>`;
  }
  renderRanks() {
    const T = TIERS.map(([k, start], i) => [k, `${start}–${i < TIERS.length - 1 ? TIERS[i + 1][1] - 1 : ''}`.replace(/–$/, '+')]);
    $('pageBody').innerHTML = `<p class="sub">${esc(t('tiersSub'))}</p><div class="tiers">${T.map(([k, rg]) => `<div class="card tier">${badge({ placed: true, tier: k, div: 1 }, 'lg')}<b class="tc-${k}">${esc(t(k))}</b><span>${L(rg + ' RP')}</span><div class="divs">${[3, 2, 1].map(d => badge({ placed: true, tier: k, div: d }, 'sm')).join('')}</div></div>`).join('')}
      <div class="card tier" style="border-color:rgba(254,189,17,.5)">${badge({ placed: true, tier: 'legend' }, 'lg')}<b class="tc-legend">${esc(t('legend'))}</b><span>${esc(t('legendR'))}</span></div></div>
      <div class="card"><ul class="rules">${['pWin', 'pLoss', 'pMvp', 'pPlace', 'pSeason'].map(k => `<li>${esc(t(k))}</li>`).join('')}</ul></div>`;
  }

  /* ---------------- overlays ---------------- */
  tick() {
    const q = this.acc.queue;
    if (q && q.state === 'searching') {
      const s = Math.max(0, Math.floor((Date.now() - q.since) / 1000)), txt = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if ($('qTimer')) $('qTimer').textContent = txt;
      $('queueTxt').textContent = t('searchingT', { n: q.size, t: txt });
    }
    if (this.found && $('foundBar')) { const k = Math.max(0, (this.found.until - performance.now()) / (this.found.acceptS * 1000)); $('foundBar').style.width = (k * 100).toFixed(1) + '%'; }
  }
  queueUI() {
    const q = this.acc.queue, sc = this.app.screen();
    $('queueBar').hidden = !(q && q.state === 'searching') || (sc === 'page' && this.page === 'ranked') || sc === 'game';
    $('queueCancel').hidden = !!(this.acc.party && this.acc.party.leader !== this.acc.id);
    this.tick();
  }
  showFound(m) {
    this.found = { ...m, until: performance.now() + m.acceptS * 1000, accepted: new Set(), mine: false };
    this.app.audio.play('spawn'); setTimeout(() => this.app.audio.play('spawn'), 250);
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {}
    this.renderFound(); $('foundModal').hidden = false;
  }
  renderFound() {
    const F = this.found; if (!F) return;
    const side = (list, cls) => `<div class="side ${cls}">${list.map(c => `<div class="${F.accepted.has(c.id) ? 'ok' : ''}">${badge(c.rank, 'sm')}<span>${idText(c)}</span></div>`).join('')}</div>`;
    const all = F.teams.blue.length + F.teams.red.length;
    $('foundCard').innerHTML = `<h3>${esc(t('found'))}</h3>
      <p class="sub" style="text-align:center">${esc(t('map'))}: ${esc(t(MAPK[F.map] || 'mapHawler'))} · <span class="ltr">${F.size}v${F.size}</span> · ${esc(modeName(F.mode || 'lts'))}</p>
      ${F.unrated ? `<p class="note" style="margin:0">${esc(t('unratedNote'))}</p>` : ''}
      <div class="vs">${side(F.teams.blue, 'b')}<div class="xx">VS</div>${side(F.teams.red, 'r')}</div>
      <div class="found-bar"><i id="foundBar"></i></div>
      <p class="sub" style="text-align:center;font-size:13px">${esc(t('acceptedN', { n: F.accepted.size, of: all }))}</p>
      ${F.mine ? '' : `<div class="row"><button class="btn primary" id="fAccept" style="flex:2;justify-content:center">${esc(t('accept'))}</button><button class="btn ghost" id="fDecline" style="flex:1;justify-content:center">${esc(t('decline'))}</button></div>`}`;
    if ($('fAccept')) $('fAccept').onclick = () => { this.app.audio.play('click'); F.mine = true; this.acc.send({ t: 'accept', match: F.match }); this.renderFound(); };
    if ($('fDecline')) $('fDecline').onclick = () => { this.app.audio.play('click'); this.acc.send({ t: 'decline', match: F.match }); this.hideFound(); };
    this.tick();
  }
  foundUpdate(m) { if (!this.found || this.found.match !== m.match) return; this.found.accepted = new Set(m.accepted); if (m.accepted.includes(this.acc.id)) this.found.mine = true; this.renderFound(); }
  hideFound() { this.found = null; $('foundModal').hidden = true; }

  notify(n) {
    const box = $('notifs'); const el = document.createElement('div'); el.className = 'ntf';
    let text = '', acts = '';
    const nm = (c) => c ? c.name : '';
    if (n.kind === 'friendReq') { text = t('nFriendReq', { name: `${nm(n.card)}#${n.card.tag}` }); acts = `<button class="btn sm primary" data-x="acc">${esc(t('accept'))}</button><button class="btn sm ghost" data-x="view">${esc(t('view'))}</button>`; }
    if (n.kind === 'friendAdded') text = t('nFriendAdd', { name: nm(n.card) });
    if (n.kind === 'partyInvite') { text = t('sqInvite', { name: nm(n.card) }); acts = `<button class="btn sm primary" data-x="join">${esc(t('join'))}</button><button class="btn sm ghost" data-x="no">${esc(t('decline'))}</button>`; }
    if (n.kind === 'partyAsk') { text = t('sqAskLead', { name: nm(n.card), who: nm(n.who) }); acts = `<button class="btn sm primary" data-x="ok">${esc(t('approve'))}</button><button class="btn sm ghost" data-x="nope">${esc(t('decline'))}</button>`; }
    if (n.kind === 'partyAskOk') text = t('sqAskOk', { who: nm(n.card) });
    if (n.kind === 'partyAskNo') text = t('sqAskNo', { who: nm(n.card) });
    if (n.kind === 'msg') { if (this.page === 'friends' && this.chatSel === n.msg.from && this.app.screen() === 'page') return; text = `${n.name}: ${n.msg.text}`; acts = this.app.screen() === 'game' ? '' : `<button class="btn sm" data-x="chat">${esc(t('message'))}</button>`; }
    if (n.kind === 'roomInvite') { text = t('nRoomInv', { name: n.name, code: n.msg.text }); acts = `<button class="btn sm primary" data-x="room">${esc(t('join'))}</button>`; }
    el.innerHTML = `<div class="t"><span>${esc(text)}</span><button class="x" type="button" aria-label="Close">×</button></div>${acts ? `<div class="acts">${acts}</div>` : ''}`;
    const close = () => el.remove();
    el.querySelector('.x').onclick = close;
    el.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
      const x = b.dataset.x; close();
      if (x === 'acc') await this.acc.req({ t: 'friendAccept', id: n.card.id });
      if (x === 'view') this.go('profile', n.card.id);
      if (x === 'join') { const r = await this.acc.req({ t: 'partyAccept', leader: n.card.id }); if (r.t === 'err') this.app.toast(t('e_' + r.code)); else this.go('ranked'); }
      if (x === 'no') this.acc.send({ t: 'partyDecline', leader: n.card.id });
      if (x === 'ok') { const r = await this.acc.req({ t: 'partyApprove', to: n.who.id }); if (r.t === 'err') this.app.toast(t('e_' + r.code)); }
      if (x === 'nope') this.acc.send({ t: 'partyReject', to: n.who.id });
      if (x === 'chat') this.go('friends', n.msg.from);
      if (x === 'room') this.app.joinRoom(n.msg.text);
    });
    box.prepend(el); while (box.children.length > 4) box.lastChild.remove();
    this.app.audio.play('pickup', null, 0.5);
    setTimeout(close, acts ? 20000 : 7000);
    this.renderHome();
  }
  showRankDialog(res) {
    const card = $('dlgCard');
    card.innerHTML = `<h4>${esc(t('rpTitle'))}</h4>${rankResultHTML(res)}<button class="btn primary" id="rdOk" style="justify-content:center">${esc(t('done'))}</button>`;
    $('dlg').hidden = false; $('rdOk').onclick = () => { $('dlg').hidden = true; };
  }
  confirm(text) {
    return new Promise((res) => {
      const card = $('dlgCard');
      card.innerHTML = `<p class="sub" style="color:#fff">${esc(text)}</p><div class="row"><button class="btn primary" id="cfY" style="flex:1;justify-content:center">${esc(t('yes'))}</button><button class="btn ghost" id="cfN" style="flex:1;justify-content:center">${esc(t('no'))}</button></div>`;
      $('dlg').hidden = false;
      $('cfY').onclick = () => { $('dlg').hidden = true; res(true); };
      $('cfN').onclick = () => { $('dlg').hidden = true; res(false); };
    });
  }
  /** A small box asking for one line of text. Resolves to the text, or null if cancelled. */
  prompt(title, value = '', max = 24) {
    return new Promise((res) => {
      const card = $('dlgCard');
      card.innerHTML = `<h4>${esc(title)}</h4>
        <input class="inp" id="pmIn" maxlength="${max}" autocomplete="off" spellcheck="false" dir="auto" value="${esc(value)}">
        <div class="row"><button class="btn primary" id="pmOk" style="flex:1;justify-content:center">${esc(t('save'))}</button><button class="btn ghost" id="pmNo" style="flex:1;justify-content:center">${esc(t('cancel'))}</button></div>`;
      $('dlg').hidden = false;
      const inp = $('pmIn'); setTimeout(() => { inp.focus(); inp.select(); }, 40);
      const done = (v) => { $('dlg').hidden = true; res(v); };
      $('pmOk').onclick = () => done(inp.value);
      $('pmNo').onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
    });
  }
  reportDialog(p) {
    const card = $('dlgCard');
    card.innerHTML = `<h4>${esc(t('reportTitle', { name: p.name }))}</h4><div class="dlg-list">${['rCheat', 'rAbuse', 'rName', 'rOther'].map((k, i) => `<label><input type="radio" name="rr" value="${k}" ${i === 1 ? 'checked' : ''}>${esc(t(k))}</label>`).join('')}
      <label><input type="checkbox" id="rBlock">${esc(t('alsoBlock'))}</label></div>
      <div class="row"><button class="btn primary" id="rOk" style="flex:1;justify-content:center">${esc(t('sendReport'))}</button><button class="btn ghost" id="rNo" style="flex:1;justify-content:center">${esc(t('cancel'))}</button></div>`;
    $('dlg').hidden = false;
    $('rNo').onclick = () => { $('dlg').hidden = true; };
    $('rOk').onclick = async () => {
      const reason = card.querySelector('input[name=rr]:checked').value, block = $('rBlock').checked;
      $('dlg').hidden = true;
      await this.acc.req({ t: 'report', id: p.id, reason, block });
      this.app.toast(t('reportDone'));
      if (block) { this.chatSel = 0; this.render(); }
    };
  }
}
