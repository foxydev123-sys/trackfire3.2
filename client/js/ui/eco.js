/* =====================================================================
   Economy UI: wallet bar, home tank card + buttons, Garage (tanks and
   upgrades), Shop (chests, tank packs, coins, gems), Quests, and the
   Daily reward / Lucky wheel / chest-opening pop-ups. Every action is
   decided by the server; this file only shows things and asks.
   ===================================================================== */
import { t, getLang } from '../i18n.js';
import { TANKS, TANK_IDS, MAX_LEVEL, STATS, MAX_STAT, STAT_STEP, statCost, tankStats, statBars, RARITY_COLOR } from '../../shared/tanks.js';
import { ABILITIES, abilityOf, abCost, abNeed, MAX_AB } from '../../shared/abilities.js';
import { ACH, ACH_FAMILIES, ACH_MODES } from '../../shared/achievements.js';
import { CHESTS, CHEST_IDS, WHEEL, DAILY, QUESTS, QUEST_BONUS, TANK_QUESTS, PACK_GEMS, PACK_CARDS, COIN_PACKS, PARTS_PACKS, GEM_PRODUCTS } from '../../shared/economy.js';
import { esc } from './social.js';

const $ = (id) => document.getElementById(id);
const L = (s) => `<span class="ltr">${esc(s)}</span>`;
const fmt = (n) => Number(n).toLocaleString('en-US');
import { ICON_URL } from './icon-urls.js';
// Icons are 3D renders (see icons3d.js) handed over as CSS variables; the flat SVGs below are only the fallback.
export const COIN = '<i class="ic i3 i-coin" aria-hidden="true"></i>';
export const GEM = '<i class="ic i3 i-gem" aria-hidden="true"></i>';
export const PARTS = '<i class="ic i3 i-parts" aria-hidden="true"></i>';
// Parts (the second currency, for upgrades): a steel cog with a bolt
const PARTS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M8.6 1.5h2.8l.5 2.3 1.6.7 2-1.3 2 2-1.3 2 .7 1.6 2.3.5v2.8l-2.3.5-.7 1.6 1.3 2-2 2-2-1.3-1.6.7-.5 2.3H8.6l-.5-2.3-1.6-.7-2 1.3-2-2 1.3-2-.7-1.6-2.3-.5V8.6l2.3-.5.7-1.6-1.3-2 2-2 2 1.3 1.6-.7z" fill="#9aa6ae" stroke="#46525a" stroke-width="1"/><circle cx="10" cy="10" r="3.2" fill="#e8b64a" stroke="#7a5a10" stroke-width="1"/></svg>';
const COIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="#f2c14e" stroke="#9a6a24" stroke-width="1.5"/><circle cx="10" cy="10" r="4.8" fill="none" stroke="#c9912a" stroke-width="1.6"/></svg>';
const GEM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M4 7.2 7.2 3h5.6L16 7.2 10 17.5z" fill="#46c8ff" stroke="#1b6f9a" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 7.2h12M7.2 3 10 17.5 12.8 3" stroke="#1b6f9a" stroke-width=".8" fill="none"/></svg>';
const CHEST_COL = { common: ['#8d969d', '#b7c0c7'], rare: ['#3d7fd0', '#6aa6ef'], epic: ['#8a45d0', '#b07cf0'], legendary: ['#d8951a', '#f5c24a'] };
function chestFlat(type) {
  const [a, b] = CHEST_COL[type] || CHEST_COL.common;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 56"><rect x="6" y="25" width="52" height="27" rx="3" fill="${a}"/><path d="M6 26 Q6 8 32 8 Q58 8 58 26Z" fill="${b}"/><rect x="5" y="23" width="54" height="5" rx="1" fill="#3a2a1a"/><rect x="27" y="20" width="10" height="13" rx="2" fill="#febd11" stroke="#7a5a10" stroke-width="1.5"/></svg>`;
}
const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
if (typeof document !== 'undefined') {
  const r = document.documentElement.style;
  r.setProperty('--ic-coin', svgUrl(COIN_SVG)); r.setProperty('--ic-gem', svgUrl(GEM_SVG)); r.setProperty('--ic-parts', svgUrl(PARTS_SVG));
  for (const k of Object.keys(CHEST_COL)) { r.setProperty('--ch-' + k, svgUrl(chestFlat(k))); r.setProperty('--cho-' + k, svgUrl(chestFlat(k))); }
}
export function chestSVG(type, cls = '') {
  const k = CHEST_COL[type] ? type : 'common';
  return `<i class="chest c3 ${cls}" style="--c:var(--ch-${k});--co:var(--cho-${k})" aria-hidden="true"></i>`;
}
// For places that need a real image URL (the wheel is an SVG).
const iconUrl = (kind, n) => kind === 'parts' ? 'data:image/svg+xml,' + encodeURIComponent(PARTS_SVG) : kind === 'coins' ? (ICON_URL.coin || 'data:image/svg+xml,' + encodeURIComponent(COIN_SVG)) : kind === 'gems' ? (ICON_URL.gem || 'data:image/svg+xml,' + encodeURIComponent(GEM_SVG)) : (ICON_URL['ch-' + n] || 'data:image/svg+xml,' + encodeURIComponent(chestFlat(n)));
const itemHTML = (r) => r.kind === 'coins' ? `${COIN}<b>${L(fmt(r.n))}</b>` : r.kind === 'parts' ? `${PARTS}<b>${L(fmt(r.n))}</b>` : r.kind === 'gems' ? `${GEM}<b>${L(fmt(r.n))}</b>` : `${chestSVG(r.n, 'sm')}<b>${esc(t('ch_' + r.n))}</b>`;
const tname = (id) => t('tk_' + id);
const rname = (id) => t('r_' + TANKS[id].rarity);

export class EcoUI {
  /** app: { acc, audio, toast, screen(), tankImg(id) } · social: SocialUI (page system + dialogs) */
  constructor(app, social) {
    this.app = app; this.social = social; this.acc = app.acc; this.gSel = null; this.wheelRot = 0; this.dailyAuto = false;
    social.pages.garage = { title: 'garage', needsAcc: true, render: (b) => this.renderGarage(b) };
    social.pages.shop = { title: 'shop', needsAcc: true, render: (b) => this.renderShop(b) };
    social.pages.quests = { title: 'quests', needsAcc: true, render: (b) => this.renderQuests(b) };
    social.pages.goals = { title: 'goals', needsAcc: true, render: (b) => this.renderGoals(b) };
    this.acc.on('wallet', () => { this.renderBar(); this.renderHome(); this.refreshPage(); this.maybeDaily(); });
    this.acc.on('status', () => { this.renderBar(); this.renderHome(); });
    this.acc.on('account', () => { this.renderBar(); this.renderHome(); });
    $('wbCoins').onclick = () => this.go('shop', 'coins');
    $('wbGems').onclick = () => this.go('shop', 'gems');
    $('wbParts').onclick = () => this.go('shop', 'parts');
    $('tankCard').onclick = () => this.go('garage');
    $('btnGarage').onclick = () => this.go('garage');
    $('btnShop').onclick = () => this.go('shop');
    $('btnQuests').onclick = () => this.go('quests');
    $('btnGoals').onclick = () => this.go('goals');
    $('btnDaily').onclick = () => this.openDaily();
    $('btnWheel').onclick = () => this.openWheel();
    $('ecoModal').addEventListener('click', (e) => { if (e.target.id === 'ecoModal' && !this.busy) this.closeModal(); });
    this.payments = new Payments(this);
    setInterval(() => { if (this.social.page === 'quests' && this.app.screen() === 'page') { const el = $('qTimer2'); if (el) el.textContent = this.untilMidnight(); } }, 30000);
  }
  get W() { return this.acc.wallet; }
  async go(page, section) {
    this.section = section || null;
    if (!(await this.app.requireAccount())) return;
    for (let i = 0; i < 40 && !this.W; i++) await new Promise(r => setTimeout(r, 100));   // new account: wallet arrives with the hub hello
    await this.social.go(page);
  }
  refreshPage() { if (this.app.screen() === 'page' && ['garage', 'shop', 'quests'].includes(this.social.page) && !this.busy) this.social.render(); }
  err(r) { this.app.audio.play('error'); const k = 'e_' + (r.code || 'bad'); this.app.toast(t(k) !== k ? t(k) : t('e_bad')); }

  /* ---------------- wallet bar + home ---------------- */
  renderBar() {
    const W = this.W, sc = this.app.screen();
    $('walletBar').hidden = !W || !this.acc.online || !(sc === 'menu' || sc === 'page');
    if (!W) return;
    if (this.holdWallet) return;          // wheel still spinning: show the new total only when the prize is shown
    this.animNum($('wbCoinsN'), W.coins, 'coin'); this.animNum($('wbGemsN'), W.gems, 'gem'); this.animNum($('wbPartsN'), W.parts || 0, 'parts');
  }
  // Numbers count up/down smoothly; a gain also sends little coins/gems flying into the wallet.
  animNum(el, to, kind) {
    const has = el.dataset.v !== undefined, from = has ? Number(el.dataset.v) : to; el.dataset.v = to;
    if (from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 800;
    const step = (n) => { const k = Math.min(1, (n - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    if (to > from && has) { const b = el.parentElement; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); this.fly(b, kind, Math.min(10, 3 + Math.round(Math.log10(to - from + 1) * 2))); }
  }
  fly(target, kind, n) {
    if ($('walletBar').hidden || !target.animate) return;
    const r = target.getBoundingClientRect(), tx = r.left + 16, ty = r.top + r.height / 2;
    const m = $('ecoModal'), src = !m.hidden ? $('ecoCard').getBoundingClientRect() : { left: innerWidth / 2 - 40, top: innerHeight / 2 - 40, width: 80, height: 80 };
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i'); el.className = `ic i3 i-${kind} flyer`;
      const sx = src.left + src.width / 2 + (Math.random() - 0.5) * 120, sy = src.top + src.height / 2 + (Math.random() - 0.5) * 80;
      el.style.left = sx + 'px'; el.style.top = sy + 'px'; document.body.appendChild(el);
      const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 160, my = Math.min(sy, ty) - 60 - Math.random() * 80;
      const a = el.animate([{ transform: 'translate(0,0) scale(.4)', opacity: 0 }, { transform: `translate(${(mx - sx) * 0.5}px,${(my - sy) * 0.6}px) scale(1.3)`, opacity: 1, offset: 0.35 }, { transform: `translate(${tx - sx}px,${ty - sy}px) scale(.8)`, opacity: 1 }],
        { duration: 700 + i * 60, delay: i * 70, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' });
      a.onfinish = () => { el.remove(); this.app.audio.play(kind === 'gem' ? 'gem' : 'coin', null, kind === 'parts' ? 0.5 : 0.8); };
    }
  }
  canUpgrade(id) {
    const W = this.W, h = W && W.tanks[id]; if (!h || !h.mods) return false;
    const afford = (c) => c && W.coins >= c.coins && (W.parts || 0) >= c.parts;
    if (afford(abCost(TANKS[id].rarity, h.mods.ab | 0))) return true;
    return STATS.some(k => afford(statCost(id, h.mods[k])));
  }
  questBadge() {
    const W = this.W; if (!W) return 0;
    let n = W.quests.list.filter(q => !q.claimed && q.prog >= q.need).length + (W.quests.list.every(q => q.claimed) && !W.quests.bonus ? 1 : 0);
    for (const [id, q] of Object.entries(W.tankQuests)) if (!q.done && q.prog >= q.need) n++;
    return n;
  }
  renderHome() {
    const W = this.W, on = this.acc.reachable !== false && !window.TRACKFIRE_PRACTICE_ONLY;
    $('ecoSide').hidden = !on;
    if (!on) return;
    const sel = W ? W.sel : 'zagros', lvl = W ? W.tanks[sel].level : 1;
    $('tankCard').innerHTML = `<img class="tk-img" alt="" src="${this.app.tankImg(sel)}"><div class="who"><span class="lbl" style="margin:0">${esc(t('yourTank'))}</span><b>${esc(tname(sel))}</b><span class="rare r-${TANKS[sel].rarity}">${esc(rname(sel))} · ${esc(t('lv', { n: lvl }))}</span></div>`;
    if (!W) { for (const id of ['bgGarage', 'bgQuests', 'bgGoals', 'bgDaily', 'bgWheel', 'bgShop']) $(id).hidden = true; return; }
    const badge = (id, n) => { const b = $(id); b.hidden = !n; b.textContent = n === true ? '!' : n; };
    badge('bgGarage', TANK_IDS.some(id => this.canUpgrade(id)) ? true : 0);
    badge('bgQuests', this.questBadge());
    badge('bgGoals', (W.ach && W.ach.ready) || 0);
    badge('bgDaily', W.daily.canClaim ? true : 0);
    badge('bgWheel', W.wheel.free ? true : 0);
    const nch = Object.values(W.chests || {}).reduce((a, b) => a + b, 0); badge('bgShop', nch);
  }
  maybeDaily() {
    if (this.dailyAuto || !this.W || !this.W.daily.canClaim || this.app.screen() !== 'menu' || !$('ecoModal').hidden) return;
    this.dailyAuto = true; setTimeout(() => { if (this.app.screen() === 'menu' && $('ecoModal').hidden && $('dlg').hidden && $('settings').hidden && $('foundModal').hidden) this.openDaily(); else this.dailyAuto = false; }, 700);
  }

  /* ---------------- garage ---------------- */
  renderGarage(body) {
    const W = this.W; if (!this.gSel || !TANKS[this.gSel]) this.gSel = W.sel;
    const cards = TANK_IDS.map(id => {
      const T = TANKS[id], h = W.tanks[id], up = this.canUpgrade(id);
      const pts = h && h.mods ? STATS.reduce((a, k) => a + h.mods[k], 0) : 0, all = STATS.length * MAX_STAT;
      const bar = h ? (pts < all ? `<div class="cbar ${up ? 'up' : ''}"><i style="width:${pts / all * 100}%"></i><span>${L(pts + '/' + all)}</span></div>` : `<div class="cbar max"><i style="width:100%"></i><span>${esc(t('maxLv'))}</span></div>`) : `<div class="cbar"><span>${esc(t('locked'))}</span></div>`;
      return `<button type="button" class="tk-card r-${T.rarity} ${h ? '' : 'locked'} ${id === this.gSel ? 'cur' : ''}" data-t="${id}">
        ${id === W.sel ? `<span class="pill rk tk-sel">${esc(t('selected'))}</span>` : ''}${up ? '<span class="tk-up" aria-hidden="true">▲</span>' : ''}
        <img class="tk-img" alt="" src="${this.app.tankImg(id)}"><b>${esc(tname(id))}</b><span class="rare r-${T.rarity}">${esc(rname(id))}${h ? ' · ' + esc(t('lv', { n: h.level })) : ''}</span>${bar}</button>`;
    }).join('');
    body.innerHTML = `<div class="garage"><div class="tk-grid">${cards}</div><div class="card tk-detail" id="tkDetail"></div></div>`;
    body.querySelectorAll('.tk-card').forEach(b => b.onclick = () => { this.app.audio.play('click'); this.gSel = b.dataset.t; body.querySelectorAll('.tk-card').forEach(x => x.classList.toggle('cur', x === b)); this.renderDetail(); if (innerWidth < 820) $('tkDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    this.renderDetail();
  }
  renderDetail() {
    const W = this.W, id = this.gSel, T = TANKS[id], h = W.tanks[id], mods = (h && h.mods) || {}, lvl = h ? h.level : 1, el = $('tkDetail');
    const S = tankStats(id, mods), cur = statBars(id, mods);
    const rows = [
      ['hp', cur.hp, `${S.hp}`], ['damage', cur.damage, `${S.dmg[0]}–${S.dmg[1]}${T.spread ? ' ×' + T.spread : ''}`],
      ['fireRate', cur.fireRate, `${S.reload} s`], ['speed', cur.speed, `${S.speed}`], ['range', cur.range, `${S.range} m`],
    ];
    if (T.armor) rows.push(['armor', T.armor / 0.3, `${Math.round(T.armor * 100)}%`]);
    const bars = rows.map(([k, a, v]) => `<div class="stbar"><span>${esc(t('st_' + k))}</span><div class="sb"><i style="width:${Math.min(100, a * 100)}%"></i></div><b>${L(v)}</b></div>`).join('');
    let acts = '', ups = '';
    if (h) {
      acts += id === W.sel ? `<button class="btn" disabled>${esc(t('selected'))}</button>` : `<button class="btn" id="tkSelect">${esc(t('selectTank'))}</button>`;
      // the tank's special power: what it does, how upgraded it is, and what the next level costs
      const ab = abilityOf(id), A = ab && ABILITIES[ab];
      if (A) {
        const n = mods.ab | 0, c = abCost(T.rarity, n), ok = c && W.coins >= c.coins && (W.parts || 0) >= c.parts;
        const pips = Array.from({ length: MAX_AB }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
        const cd = abNeed(ab, n);
        ups += `<p class="lbl" style="margin:8px 0 0">${esc(t('abPower'))}</p>
          <div class="ab-card ${c ? '' : 'max'}">
            <span class="ab-ic" aria-hidden="true">${A.icon}</span>
            <div class="ab-txt"><b>${esc(t('ab_' + ab))}</b><small>${esc(t('abd_' + ab))}</small><small class="ab-how">${esc(t('abCharge'))}</small>
              <span class="ab-meta"><span class="pips">${pips}</span><em class="ltr">${esc(t('abCool', { s: cd }))}</em></span></div>
            ${c ? `<button class="btn ${ok ? 'primary' : ''}" data-up="ab" ${ok ? '' : 'disabled'}><span>${esc(t('abUpgrade'))}</span><small class="cost">${COIN}${L(fmt(c.coins))} ${PARTS}${L(fmt(c.parts))}</small></button>`
                : `<button class="btn" disabled>${esc(t('abMax'))}</button>`}
          </div>`;
      }
      // one row per stat: its level, what the next step gives, and its price in coins + parts
      ups += `<p class="lbl" style="margin:8px 0 0">${esc(t('upPick'))}</p><div class="up-rows">` + STATS.map(k => {
        const n = mods[k] || 0, c = statCost(id, n), ok = c && W.coins >= c.coins && (W.parts || 0) >= c.parts;
        const pips = Array.from({ length: MAX_STAT }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
        const gain = k === 'rel' ? `−${Math.round(STAT_STEP[k] * 100)}%` : `+${Math.round(STAT_STEP[k] * 100)}%`;
        return `<div class="up-row ${c ? '' : 'max'}"><span class="nm"><b>${esc(t('up_' + k))}</b><small>${c ? esc(t('upNext', { v: gain })) : esc(t('maxLv'))}</small></span><span class="pips">${pips}</span>
          ${c ? `<button class="btn ${ok ? 'primary' : ''}" data-up="${k}" ${ok ? '' : 'disabled'}><span class="cost">${COIN}${L(fmt(c.coins))} ${PARTS}${L(fmt(c.parts))}</span></button>` : `<button class="btn" disabled>✔</button>`}</div>`;
      }).join('') + '</div>';
    } else {
      const q = W.tankQuests[id];
      acts += `<p class="lbl" style="margin:0">${esc(t('howUnlock'))}</p><ul class="rules"><li>${esc(t('unlockChest'))}</li>${q ? `<li>${esc(t('unlockQuest'))} ${esc(t('tq_' + q.stat, { n: q.need }))} <b class="ltr">(${Math.min(q.prog, q.need)}/${q.need})</b></li>` : ''}<li>${esc(t('unlockPack'))}</li></ul>
        <button class="btn primary" id="tkPack"><span>${esc(t('packDesc', { n: PACK_CARDS }))}</span><small class="cost">${GEM}${L(fmt(PACK_GEMS[T.rarity]))}</small></button>`;
    }
    // SELECT sits directly under the tank's name. It used to be the very last thing on the panel,
    // below every stat and upgrade row, so equipping a tank meant scrolling past all of it first —
    // on a phone that is a long way to go for the one button everybody actually came for.
    el.innerHTML = `<div class="tk-hero"><img class="tk-img big" alt="" src="${this.app.tankImg(id)}"><div><h3>${esc(tname(id))}</h3><span class="rare r-${T.rarity}">${esc(rname(id))}${h ? ' · ' + esc(t('lv', { n: lvl })) + ' / ' + MAX_LEVEL : ''}</span></div></div>
      <div class="tk-acts top">${acts}</div><p class="sub">${esc(t('td_' + id))}</p><div class="stbars">${bars}</div>${ups}`;
    if ($('tkSelect')) $('tkSelect').onclick = async () => { this.app.audio.play('click'); const r = await this.acc.eco('select', { tank: id }); if (r.t === 'err') this.err(r); };
    el.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => {
      this.app.audio.play('click'); b.disabled = true;
      const r = await this.acc.eco('upgrade', { tank: id, stat: b.dataset.up });
      if (r.t === 'err') { b.disabled = false; return this.err(r); }
      this.app.audio.play('levelup'); this.levelUp(id, r.res.level, r.res.stat, r.res.n);
    });
    if ($('tkPack')) $('tkPack').onclick = async () => {
      if (!(await this.social.confirm(`${tname(id)} · ${t('packDesc', { n: PACK_CARDS })} · ${PACK_GEMS[T.rarity]} ${t('gemsLbl')}?`))) return;
      const r = await this.acc.eco('pack', { tank: id }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened);
    };
  }
  levelUp(id, n, stat, k) {
    if (stat === 'ab') {
      const ab = abilityOf(id), A = ABILITIES[ab] || {};
      return this.modal(`<div class="lvup"><div class="lvup-ab" aria-hidden="true">${A.icon || '⚡'}</div><div class="lvup-t">${esc(t('ab_' + ab))} ${L(k + '/' + MAX_AB)}</div>
        <b class="ltr">${esc(t('abLvl', { n: k }))}</b><p class="sub">${esc(t('abd_' + ab))}</p><p class="sub ltr">${esc(t('abCool', { s: abNeed(ab, k) }))}</p>
        <button class="btn primary" data-close style="justify-content:center">${esc(t('done'))}</button></div>`);
    }
    this.modal(`<div class="lvup"><img class="tk-img big" alt="" src="${this.app.tankImg(id)}"><div class="lvup-t">${esc(stat ? t('up_' + stat) : t('upgrade'))} ${L(k + '/' + MAX_STAT)}</div><b class="ltr">${esc(t('lv', { n }))}</b><p class="sub">${esc(t('upgradedStat', { tank: tname(id), stat: t('up_' + stat) }))}</p><button class="btn primary" data-close style="justify-content:center">${esc(t('done'))}</button></div>`);
  }

  /* ---------------- shop ---------------- */
  renderShop(body) {
    const W = this.W, mine = Object.entries(W.chests || {}).filter(([, n]) => n > 0);
    const chest = (id) => { const C = CHESTS[id];
      return `<div class="card shop-chest r-${id}">${chestSVG(id, 'lg')}<b>${esc(t('ch_' + id))}</b><span class="muted" style="font-size:12.5px">${esc(t('chestHas', { n: C.cards, a: C.coins[0], b: C.coins[1] }))}</span>
        <div class="row" style="justify-content:center">${C.price.coins ? `<button class="btn sm price" data-buy="${id}" data-cur="coins">${COIN}${L(fmt(C.price.coins))}</button>` : ''}${C.price.gems ? `<button class="btn sm price" data-buy="${id}" data-cur="gems">${GEM}${L(fmt(C.price.gems))}</button>` : ''}</div>
        <button type="button" class="linkbtn" data-odds="${id}">${esc(t('chances'))}</button></div>`; };
    const packs = TANK_IDS.filter(id => !W.tanks[id]).map(id => `<div class="card shop-pack r-${TANKS[id].rarity}"><img class="tk-img" alt="" src="${this.app.tankImg(id)}"><b>${esc(tname(id))}</b><span class="rare r-${TANKS[id].rarity}">${esc(rname(id))}</span><span class="muted" style="font-size:12px">${esc(t('packDesc', { n: PACK_CARDS }))}</span><button class="btn sm price" data-pack="${id}">${GEM}${L(fmt(PACK_GEMS[TANKS[id].rarity]))}</button></div>`).join('');
    const coinPacks = COIN_PACKS.map(p => `<div class="card shop-coins"><div class="big-ic">${COIN}</div><b>${L(fmt(p.coins))}</b><button class="btn sm price" data-coins="${p.id}">${GEM}${L(fmt(p.gems))}</button></div>`).join('');
    const partsPacks = PARTS_PACKS.map(p => `<div class="card shop-coins"><div class="big-ic">${PARTS}</div><b>${L(fmt(p.parts))}</b><button class="btn sm price" data-parts="${p.id}">${GEM}${L(fmt(p.gems))}</button></div>`).join('');
    const gems = GEM_PRODUCTS.filter(p => !(p.once && W.starterBought)).map(p => `<div class="card shop-gems ${p.tag || ''}">${p.tag ? `<span class="pill ${p.tag === 'starter' ? 'new' : 'wk'}">${esc(t(p.tag === 'starter' ? 'starter' : p.tag === 'best' ? 'bestValue' : 'popular'))}</span>` : ''}<div class="big-ic">${p.chest ? chestSVG(p.chest, 'sm') : ''}${GEM}</div><b>${L(fmt(p.gems))}</b>${p.chest ? `<span class="muted" style="font-size:12px">${esc(t('starterDesc', { g: p.gems }))}</span>` : ''}<button class="btn sm primary price" data-gem="${p.id}">${L(this.payments.price(p))}</button></div>`).join('');
    const payNote = W.payments.test ? t('payTest') : this.payments.available() ? '' : t('payLater');
    body.innerHTML = `
      ${mine.length ? `<div class="card"><p class="lbl">${esc(t('myChests'))}</p><div class="row">${mine.map(([id, n]) => `<div class="mychest">${chestSVG(id, 'md')}<span>${esc(t('ch_' + id))} ×${n}</span><button class="btn sm primary" data-open="${id}">${esc(t('open'))}</button></div>`).join('')}</div></div>` : ''}
      <section id="sec-chests"><p class="lbl">${esc(t('chests'))}</p><div class="shop-grid">${CHEST_IDS.map(chest).join('')}</div><p class="sub" style="font-size:12.5px;margin-top:8px">${esc(t('randomNote'))}</p></section>
      ${packs ? `<section><p class="lbl">${esc(t('tankPacks'))}</p><div class="shop-grid">${packs}</div></section>` : ''}
      <section id="sec-coins"><p class="lbl">${esc(t('buyCoins'))}</p><div class="shop-grid">${coinPacks}</div></section>
      <section id="sec-parts"><p class="lbl">${esc(t('buyParts'))}</p><p class="sub" style="font-size:12.5px;margin:0 0 8px">${esc(t('partsNote'))}</p><div class="shop-grid">${partsPacks}</div></section>
      ${W.payments.play || W.payments.test ? `<section id="sec-gems"><p class="lbl">${esc(t('buyGems'))}</p>${payNote ? `<p class="note" style="margin:0 0 10px">${esc(payNote)}</p>` : ''}<div class="shop-grid">${gems}</div></section>` : ''}`;
    body.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
      const id = b.dataset.buy, cur = b.dataset.cur, price = CHESTS[id].price[cur];
      if (cur === 'gems' && !(await this.social.confirm(`${t('ch_' + id)} · ${price} ${t('gemsLbl')}?`))) return;
      const r = await this.acc.eco('buyChest', { type: id, cur }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened);
    });
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { const r = await this.acc.eco('open', { type: b.dataset.open }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened); });
    body.querySelectorAll('[data-odds]').forEach(b => b.onclick = () => this.showOdds(b.dataset.odds));
    body.querySelectorAll('[data-pack]').forEach(b => b.onclick = async () => {
      const id = b.dataset.pack; if (!(await this.social.confirm(`${tname(id)} · ${PACK_GEMS[TANKS[id].rarity]} ${t('gemsLbl')}?`))) return;
      const r = await this.acc.eco('pack', { tank: id }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened);
    });
    body.querySelectorAll('[data-coins]').forEach(b => b.onclick = async () => { const r = await this.acc.eco('coins', { pack: b.dataset.coins }); if (r.t === 'err') return this.err(r); this.app.audio.play('pickup'); this.showGot(r.res.got); });
    body.querySelectorAll('[data-parts]').forEach(b => b.onclick = async () => { const r = await this.acc.eco('parts', { pack: b.dataset.parts }); if (r.t === 'err') return this.err(r); this.app.audio.play('pickup'); this.showGot(r.res.got); });
    body.querySelectorAll('[data-gem]').forEach(b => b.onclick = () => this.payments.buy(b.dataset.gem));
    if (this.section) { const s = $('sec-' + this.section); this.section = null; if (s) setTimeout(() => s.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  }
  showOdds(id) {
    const C = CHESTS[id], pct = (p) => (Math.round(p * 1000) / 10) + '%';
    const g = Object.entries(C.guarantee || {}).map(([r, n]) => `<li>${esc(t('guaranteed', { n, r: t('r_' + r) }))}</li>`).join('');
    const rows = Object.entries(C.odds).map(([r, p]) => `<tr><td><span class="rare r-${r}">${esc(t('r_' + r))}</span><div class="muted" style="font-size:11.5px">${TANK_IDS.filter(x => TANKS[x].rarity === r).map(tname).map(esc).join(' · ')}</div></td><td class="n">${L(pct(p))}</td></tr>`).join('');
    this.modal(`<div class="odds">${chestSVG(id, 'md')}<h4>${esc(t('ch_' + id))}</h4><p class="sub" style="font-size:13px">${esc(t('chancesT'))}</p>
      <table class="lbt odds-t"><tbody>${rows}</tbody></table><ul class="rules">${g}<li>${esc(t('chestHas', { n: C.cards, a: C.coins[0], b: C.coins[1] }))}${C.gems[1] ? ` · ${L(C.gems[0] + '–' + C.gems[1])} ${esc(t('gemsLbl'))}` : ''}</li></ul>
      <button class="btn primary" data-close style="justify-content:center">${esc(t('done'))}</button></div>`);
  }

  /* ---------------- chest opening ---------------- */
  showOpened(o) {
    const isBox = !(o.type === 'pack' || o.type === 'quest');
    const cards = o.cards.map((c, i) => { const T = TANKS[c.tank];
      return `<div class="oc r-${T.rarity} ${c.new ? 'isnew' : ''}" style="animation-delay:${0.15 + i * 0.22}s">${c.new ? `<span class="newtag">${esc(t('newTank'))}</span>` : ''}<img class="tk-img" alt="" src="${this.app.tankImg(c.tank)}"><b>${esc(tname(c.tank))}</b><span class="n">${L('×' + c.n)}</span>${c.coins ? `<small>${COIN}${L('+' + c.coins)}</small>` : ''}${c.parts ? `<small>${PARTS}${L('+' + c.parts)}</small>` : ''}</div>`; }).join('');
    const extras = [o.coins ? `<span class="got">${COIN}<b>${L('+' + fmt(o.coins))}</b></span>` : '', o.gems ? `<span class="got">${GEM}<b>${L('+' + fmt(o.gems))}</b></span>` : '', o.parts ? `<span class="got">${PARTS}<b>${L('+' + fmt(o.parts))}</b></span>` : ''].join('');
    const k = CHEST_COL[o.type] ? o.type : 'common';
    const box = isBox ? `<div class="chest-open r-${k}" id="chestOpen"><div class="rays"></div><i class="chest c3 xl" style="--c:var(--ch-${k});--co:var(--cho-${k})"></i><div class="burst" id="chestBurst"></div></div>` : '';
    this.modal(`<div class="opened ${isBox ? 'pre' : ''}" id="openedBox">${box}<h4>${esc(t('youGot'))}</h4><div class="row" style="justify-content:center">${extras}</div><div class="oc-grid">${cards}</div>
      <button class="btn primary" data-close style="justify-content:center">${esc(t('done'))}</button></div>`, 'wide');
    const reveal = () => {
      const ob = $('openedBox'); if (!ob) return; ob.classList.remove('pre');
      o.cards.forEach((c, i) => setTimeout(() => this.app.audio.play('card'), 150 + i * 220));
      if (o.cards.some(c => c.new)) setTimeout(() => this.app.audio.play('win'), 250 + o.cards.length * 220);
    };
    if (!isBox) { this.app.audio.play('reward'); reveal(); return; }
    const A = this.app.audio, co = $('chestOpen');
    this.busy = true;
    A.play('chestShake'); setTimeout(() => A.play('chestShake'), 420); setTimeout(() => A.play('chestShake'), 760);
    co.classList.add('shaking');
    setTimeout(() => {
      if (!$('chestOpen')) { this.busy = false; return; }
      co.classList.remove('shaking'); co.classList.add('open'); A.play('chestOpen');
      const burst = $('chestBurst');
      for (let i = 0; i < 22; i++) { const s = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
        s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', Math.sin(a) * d * 0.8 - 30 + 'px'); s.style.animationDelay = (Math.random() * 0.12) + 's'; burst.appendChild(s); }
      setTimeout(() => { this.busy = false; reveal(); }, 380);
    }, 1050);
  }
  showGot(got) {
    if (!got) return;
    const items = [];
    if (got.coins) items.push({ kind: 'coins', n: got.coins }); if (got.gems) items.push({ kind: 'gems', n: got.gems }); if (got.parts) items.push({ kind: 'parts', n: got.parts });
    for (const c of got.chests || []) items.push({ kind: 'chest', n: c });
    const chests = got.chests || [];
    this.modal(`<div class="gotbox"><h4>${esc(t('youGot'))}</h4><div class="got-list">${items.map(r => `<div class="got">${itemHTML(r)}</div>`).join('')}</div>
      <div class="row">${chests.length ? `<button class="btn primary" id="gotOpen" style="flex:1;justify-content:center">${esc(t('open'))}</button>` : ''}<button class="btn ${chests.length ? 'ghost' : 'primary'}" data-close style="flex:1;justify-content:center">${esc(t('done'))}</button></div></div>`);
    if ($('gotOpen')) $('gotOpen').onclick = async () => { const r = await this.acc.eco('open', { type: chests[0] }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened); };
  }

  /* ---------------- daily reward ---------------- */
  async openDaily() {
    if (!(await this.app.requireAccount())) return;
    for (let i = 0; i < 40 && !this.W; i++) await new Promise(r => setTimeout(r, 100));
    const W = this.W; if (!W) return;
    const D = W.daily;
    const tiles = DAILY.map((rw, i) => { const past = D.canClaim ? i < D.day : i <= D.day, today = D.canClaim && i === D.day;
      return `<div class="dtile ${past ? 'past' : ''} ${today ? 'today' : ''} ${i === 6 ? 'big' : ''}"><span>${esc(t('dayN', { n: i + 1 }))}</span><div class="dt-items">${rw.map(r => `<div>${itemHTML(r)}</div>`).join('')}</div>${past ? '<i class="tick" aria-hidden="true">✓</i>' : ''}</div>`; }).join('');
    this.modal(`<div class="daily"><h4>${esc(t('daily'))}</h4><p class="sub" style="font-size:13px">${esc(t('dailySub'))}${W.daily.streak ? ' · ' + esc(t('streakN', { n: W.daily.streak })) : ''}</p><div class="dgrid">${tiles}</div>
      ${D.canClaim ? `<button class="btn primary" id="dClaim" style="justify-content:center">${esc(t('claim'))}</button>` : `<p class="sub" style="text-align:center">${esc(t('dailyDone', { n: (D.day + 1) % 7 + 1 }))}</p><button class="btn" data-close style="justify-content:center">${esc(t('done'))}</button>`}</div>`, 'wide');
    if ($('dClaim')) $('dClaim').onclick = async () => { const r = await this.acc.eco('daily'); if (r.t === 'err') return this.err(r); this.app.audio.play('reward'); this.showGot(r.res.got); };
  }

  /* ---------------- lucky wheel ---------------- */
  async openWheel() {
    if (!(await this.app.requireAccount())) return;
    for (let i = 0; i < 40 && !this.W; i++) await new Promise(r => setTimeout(r, 100));
    const W = this.W; if (!W) return;
    const n = WHEEL.segments.length, a = 360 / n;
    const P = (deg, r) => { const rad = (deg - 90) * Math.PI / 180; return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)]; };
    const segs = WHEEL.segments.map((s, i) => {
      const [x1, y1] = P(i * a, 96), [x2, y2] = P((i + 1) * a, 96), [lx, ly] = P(i * a + a / 2, 64);
      const label = s.kind === 'chest' ? '' : fmt(s.n);
      return `<path d="M100 100 L${x1.toFixed(2)} ${y1.toFixed(2)} A96 96 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z" fill="${s.color}" stroke="#1b1206" stroke-width="1.5"/>
        <g transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${(i * a + a / 2).toFixed(1)})"><image href="${iconUrl(s.kind, s.n)}" x="-13" y="-24" width="26" height="26"/><text y="14" text-anchor="middle" font-size="11" font-weight="700" fill="#1b1206" font-family="Chakra Petch, sans-serif">${label}</text></g>`;
    }).join('');
    const odds = WHEEL.segments.map(s => `<tr><td>${itemHTML({ kind: s.kind, n: s.n })}</td><td class="n">${L(s.p + '%')}</td></tr>`).join('');
    this.modal(`<div class="wheelbox"><h4>${esc(t('wheel'))}</h4>
      <div class="wheel-wrap"><div class="wheel-ptr" aria-hidden="true"></div><svg class="wheel" id="wheelSvg" viewBox="0 0 200 200" style="transform:rotate(${this.wheelRot}deg)">${segs}<circle cx="100" cy="100" r="15" fill="#1b1206" stroke="#f5a53c" stroke-width="3"/></svg></div>
      <div class="row" style="justify-content:center">${W.wheel.free ? `<button class="btn primary" id="spinFree">${esc(t('spinFree'))}</button>` : ''}<button class="btn ${W.wheel.free ? '' : 'primary'}" id="spinPaid" ${W.wheel.paidLeft > 0 ? '' : 'disabled'}>${esc(t('spinGems', { n: '' }))}${GEM}${L(WHEEL.spinGems)}</button></div>
      <p class="sub" style="text-align:center;font-size:12.5px">${W.wheel.free ? '' : esc(t('freeTomorrow')) + ' · '}${esc(t('spinsLeft', { n: W.wheel.paidLeft }))}</p>
      <details><summary class="linkbtn">${esc(t('chances'))}</summary><table class="lbt odds-t"><tbody>${odds}</tbody></table></details>
      <button class="btn ghost" data-close style="justify-content:center">${esc(t('done'))}</button></div>`);
    const spin = async (paid) => {
      if (this.busy) return; this.busy = true;
      this.holdWallet = true;
      const r = await this.acc.eco('spin', { paid });
      if (r.t === 'err') { this.busy = false; this.holdWallet = false; this.renderBar(); return this.err(r); }
      const i = r.res.index, target = 360 - (i * a + a / 2) + (Math.random() - 0.5) * a * 0.6;
      this.wheelRot = this.wheelRot - (this.wheelRot % 360) + 360 * 6 + target;
      const svg = $('wheelSvg'), from = this.wheelRot0 ?? 0, to = this.wheelRot; this.wheelRot0 = to;
      // ticks exactly when a segment edge passes the pointer (same easing curve as the CSS transition)
      const bez = (x1, y1, x2, y2) => (x) => { let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2, bx = 3 * m * (1 - m) * (1 - m) * x1 + 3 * m * m * (1 - m) * x2 + m * m * m; if (bx < x) lo = m; else hi = m; } const m = (lo + hi) / 2; return 3 * m * (1 - m) * (1 - m) * y1 + 3 * m * m * (1 - m) * y2 + m * m * m; };
      const ease = bez(0.12, 0.72, 0.1, 1), D = 4200; let lastSeg = Math.floor(from / a), lastT = -1e9; const timers = [];
      for (let ms = 0; ms <= D; ms += 8) { const ang = from + (to - from) * ease(ms / D), sg = Math.floor(ang / a); if (sg !== lastSeg) { lastSeg = sg; if (ms - lastT > 45) { lastT = ms; timers.push(setTimeout(() => { this.app.audio.play('wheelTick'); const p = document.querySelector('.wheel-ptr'); if (p) { p.classList.remove('tk'); void p.offsetWidth; p.classList.add('tk'); } }, ms)); } } }
      this.app.audio.play('click');
      requestAnimationFrame(() => { svg.style.transition = `transform ${D / 1000}s cubic-bezier(.12,.72,.1,1)`; svg.style.transform = `rotate(${this.wheelRot}deg)`; });
      // The wheel stops at D; the prize, the win sound and the wallet count-up all come together after a short pause.
      setTimeout(() => { this.busy = false; this.showGot(r.res.got); this.app.audio.play('win'); this.holdWallet = false; this.renderBar(); this.renderHome(); }, D + 700);
    };
    if ($('spinFree')) $('spinFree').onclick = () => spin(false);
    $('spinPaid').onclick = () => spin(true);
  }

  /* ---------------- quests ---------------- */
  untilMidnight() { const now = new Date(), m = Math.max(0, Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 60000)); return t('hours', { h: Math.floor(m / 60), m: m % 60 }); }
  renderQuests(body) {
    const W = this.W, Q = W.quests;
    const rw = (r) => `<span class="qrw">${itemHTML(r)}</span>`;
    const daily = Q.list.map(q => { const done = q.prog >= q.need;
      return `<div class="quest ${q.claimed ? 'claimed' : done ? 'done' : ''}"><div class="qt"><b>${esc(t('qt_' + q.id, { n: q.need }))}</b><div class="cbar"><i style="width:${Math.min(100, q.prog / q.need * 100)}%"></i><span>${L(Math.min(q.prog, q.need) + ' / ' + q.need)}</span></div></div>${rw(QUESTS[q.id].reward)}
        ${q.claimed ? `<span class="pill new">${esc(t('claimed'))}</span>` : `<button class="btn sm ${done ? 'primary' : ''}" data-q="${q.id}" ${done ? '' : 'disabled'}>${esc(t('claim'))}</button>`}</div>`; }).join('');
    const allDone = Q.list.every(q => q.claimed);
    const tq = Object.entries(W.tankQuests).map(([id, q]) => { const done = q.prog >= q.need;
      return `<div class="quest ${q.done ? 'claimed' : done ? 'done' : ''}"><img class="tk-img sm" alt="" src="${this.app.tankImg(id)}"><div class="qt"><b>${esc(tname(id))} <span class="rare r-${TANKS[id].rarity}">${esc(rname(id))}</span></b><span class="muted" style="font-size:13px">${esc(t('tq_' + q.stat, { n: q.need }))}</span><div class="cbar"><i style="width:${Math.min(100, q.prog / q.need * 100)}%"></i><span>${L(Math.min(q.prog, q.need) + ' / ' + q.need)}</span></div></div>
        ${q.done ? `<span class="pill new">${esc(t('claimed'))}</span>` : `<button class="btn sm ${done ? 'primary' : ''}" data-tq="${id}" ${done ? '' : 'disabled'}>${esc(W.tanks[id] ? t('claim') : t('unlockBtn'))}</button>`}</div>`; }).join('');
    body.innerHTML = `<div class="cols">
      <div class="card"><div class="row" style="justify-content:space-between"><p class="lbl" style="margin:0">${esc(t('dailyQuests'))}</p><span class="muted" style="font-size:12.5px">${esc(t('newQuestsIn', { t: '' }))}<span id="qTimer2">${esc(this.untilMidnight())}</span></span></div>
        <div class="qlist">${daily}</div>
        <div class="quest bonus ${Q.bonus ? 'claimed' : allDone ? 'done' : ''}"><div class="qt"><b>${esc(t('questBonus'))}</b></div>${rw(QUEST_BONUS)}${Q.bonus ? `<span class="pill new">${esc(t('claimed'))}</span>` : `<button class="btn sm ${allDone ? 'primary' : ''}" id="qBonus" ${allDone ? '' : 'disabled'}>${esc(t('claim'))}</button>`}</div>
        <p class="sub" style="font-size:12.5px;margin-top:10px">${esc(t('questsNote'))}</p></div>
      <div class="card"><p class="lbl">${esc(t('tankQuests'))}</p><p class="sub" style="font-size:13px;margin-bottom:10px">${esc(t('tankQuestsSub'))}</p><div class="qlist">${tq}</div></div></div>`;
    body.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => { const r = await this.acc.eco('quest', { id: b.dataset.q }); if (r.t === 'err') return this.err(r); this.app.audio.play('pickup'); this.showGot(r.res.got); });
    if ($('qBonus')) $('qBonus').onclick = async () => { const r = await this.acc.eco('questBonus'); if (r.t === 'err') return this.err(r); this.app.audio.play('pickup'); this.showGot(r.res.got); };
    body.querySelectorAll('[data-tq]').forEach(b => b.onclick = async () => { const r = await this.acc.eco('tankQuest', { tank: b.dataset.tq }); if (r.t === 'err') return this.err(r); this.showOpened(r.res.opened); });
  }

  /* ---------------- long-term goals (achievements) ---------------- */
  renderGoals(body) {
    const W = this.W, A = W.ach || { list: [], ready: 0, done: 0, total: ACH.length };
    const by = new Map(A.list.map(x => [x.id, x]));
    const fam = [...ACH_FAMILIES.map(f => f.stat), 'mode'];
    const nice = (n) => n >= 1000000 ? (n / 1000000) + 'M' : n >= 1000 ? (n / 1000) + 'K' : String(n);
    let html = '';
    for (const stat of fam) {
      const items = ACH.filter(a => a.stat === stat);
      if (!items.length) continue;
      const doneN = items.filter(a => (by.get(a.id) || {}).claimed).length;
      html += `<div class="card gl-fam"><div class="row" style="justify-content:space-between;align-items:baseline">
        <p class="lbl" style="margin:0">${esc(items[0].icon)} ${esc(t('ac_' + stat))}</p>
        <span class="muted" style="font-size:12px">${L(doneN + ' / ' + items.length)}</span></div><div class="gl-list">`;
      for (const a of items) {
        const st = by.get(a.id) || { prog: 0, claimed: false };
        const ready = !st.claimed && st.prog >= a.need;
        const label = a.stat === 'mode' ? t('ac_modeOne', { mode: t('m_' + a.mode), n: a.need })
          : a.stat === 'tier' ? t('ac_tierOne', { tier: t(['bronze', 'silver', 'gold', 'plat', 'dia', 'cmd', 'legend'][a.need]) })
          : t('ac_' + a.stat + 'One', { n: nice(a.need) });
        html += `<div class="goal ${st.claimed ? 'claimed' : ready ? 'ready' : ''}">
          <div class="gt"><b>${esc(label)}</b>
            <div class="cbar"><i style="width:${Math.min(100, st.prog / a.need * 100)}%"></i><span>${L(nice(Math.min(st.prog, a.need)) + ' / ' + nice(a.need))}</span></div></div>
          <span class="qrw">${itemHTML({ kind: 'coins', n: a.reward.coins })}${a.reward.gems ? itemHTML({ kind: 'gems', n: a.reward.gems }) : ''}</span>
          ${st.claimed ? `<span class="pill new">${esc(t('claimed'))}</span>`
            : `<button class="btn sm ${ready ? 'primary' : ''}" data-ach="${a.id}" ${ready ? '' : 'disabled'}>${esc(t('claim'))}</button>`}</div>`;
      }
      html += '</div></div>';
    }
    body.innerHTML = `<div class="card gl-head"><div><p class="lbl" style="margin:0">${esc(t('goalsTitle'))}</p>
        <p class="sub" style="margin:4px 0 0;font-size:13px">${esc(t('goalsNote'))}</p></div>
        <div class="gl-count"><b>${L(A.done + ' / ' + A.total)}</b><span>${esc(t('goalsDone'))}</span></div></div>
      <div class="gl-cols">${html}</div>`;
    body.querySelectorAll('[data-ach]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const r = await this.acc.eco('ach', { id: b.dataset.ach });
      if (r.t === 'err') { b.disabled = false; return this.err(r); }
      this.app.audio.play('reward'); this.showGot(r.res.got);
    });
  }

  /* ---------------- modal ---------------- */
  modal(html, cls = '') {
    const m = $('ecoModal'), c = $('ecoCard');
    if (m.hidden) this.app.audio.play('whoosh');
    c.className = 'card modal-card eco-card ' + cls; c.innerHTML = `<button type="button" class="mclose" data-close aria-label="Close">×</button>` + html; m.hidden = false;
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    c.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { this.app.audio.play('click'); this.closeModal(); });
  }
  closeModal() { $('ecoModal').hidden = true; this.refreshPage(); this.renderHome(); }
}

/* =====================================================================
   Real-money gems. Inside the Android app (Google Play) this uses Google
   Play Billing through the Digital Goods API; the server then checks the
   purchase with Google before adding gems. In a normal browser, buying
   is only possible when the server runs in TEST mode (PAYMENTS_TEST=1).
   ===================================================================== */
class Payments {
  constructor(ui) {
    this.ui = ui; this.service = null; this.prices = {};
    if ('getDigitalGoodsService' in window) {
      window.getDigitalGoodsService('https://play.google.com/billing').then(async (s) => {
        this.service = s;
        try {
          const d = await s.getDetails(GEM_PRODUCTS.map(p => p.id));
          for (const x of d) this.prices[x.itemId] = new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : getLang() === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-US', { style: 'currency', currency: x.price.currency }).format(Number(x.price.value));
          ui.refreshPage();
        } catch (e) { console.warn('price lookup failed', e); }
      }).catch(() => {});
    }
  }
  available() { return !!this.service; }
  price(p) { return this.prices[p.id] || '$' + p.usd.toFixed(2); }
  async buy(product) {
    const ui = this.ui, W = ui.W;
    if (this.service) {
      try {
        const req = new PaymentRequest([{ supportedMethods: 'https://play.google.com/billing', data: { sku: product } }], { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } });
        const resp = await req.show();
        const r = await ui.acc.eco('purchase', { provider: 'play', product, token: resp.details.purchaseToken });
        await resp.complete(r.t === 'ok' ? 'success' : 'fail');
        if (r.t === 'err') return ui.err(r);
        ui.app.audio.play('pickup'); ui.showGot(r.res.got);
      } catch (e) { if (e && e.name !== 'AbortError') ui.app.toast(t('payFail')); }
      return;
    }
    if (W && W.payments.test) {
      const r = await ui.acc.eco('purchase', { provider: 'test', product });
      if (r.t === 'err') return ui.err(r);
      ui.app.audio.play('pickup'); ui.showGot(r.res.got); return;
    }
    ui.app.toast(t('payLater'), 3500);
  }
}
