/* =====================================================================
   KURDISH TANK — app entry: screens (menu → lobby → match), wiring between
   the network client, the 3D game, HUD, input, audio and settings.
   ===================================================================== */
import { settings, saveSettings, useTouch, getToken, CAMERA, QUALITY } from './settings.js';
import { NetClient } from './net/netclient.js';
import { workerTransport, LAT_SIM } from './net/connection.js';
import { HUD } from './ui/hud.js';
import { Input } from './input/input.js';
import { TouchControls } from './input/touch.js';
import { VoiceChat } from './audio/voice.js';
import { GameAudio } from './audio/audio.js';
import { GAME } from '../shared/config.js';
import { getMap, getLobbyMap, MAP_IDS } from '../shared/maps.js';
import { t, th, setLang, detectLang } from './i18n.js';
import { Account } from './account.js';
import { SocialUI } from './ui/social.js';
import { EcoUI } from './ui/eco.js';
import { TANKS, TANK_IDS } from '../shared/tanks.js';

const _els = new Map();
const $ = (id) => { let e = _els.get(id); if (e === undefined || !e || !e.isConnected) { e = document.getElementById(id); _els.set(id, e); } return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let THREE, buildWorld, Game;
let renderer, camera, game, net = null, hud, input, touch, audio;
let screen = 'loading';            // loading | menu | lobby | page | game
let acc = null, social = null, eco = null;
const tankImages = {};
// Fallback picture (before the 3D engine has drawn the real one)
const TANK_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect x="18" y="48" width="84" height="22" rx="5" fill="#3a4a3a"/><rect x="38" y="34" width="40" height="18" rx="4" fill="#4a5a4a"/><rect x="76" y="40" width="36" height="6" fill="#5b6064"/></svg>');
const tankImg = (id) => tankImages[id] || TANK_FALLBACK;
let room = null, worlds = {}, menuWorld = null, menuAngle = 0, practice = false;
let pulledTo = null;                    // a room code we were taken into by our squad leader
let LobbyStage = null, stage = null;   // the tanks standing on the menu screen (loaded with the engine)
let LobbyLife = null, life = null;     // the moving things behind them

const params = new URLSearchParams(location.search);
const SERVER_URL = params.get('server') || window.TRACKFIRE_SERVER || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const API_BASE = SERVER_URL.replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
const HUB_URL = SERVER_URL.replace(/\/ws\/?$/, '/hub');

function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function showErr(msg) { const e = $('menuErr'); e.textContent = msg; e.hidden = !msg; }

/* ---------------- language ---------------- */
function applyLang(l) {
  settings.lang = l; saveSettings(); setLang(l); document.documentElement.style.setProperty('--letgo', JSON.stringify(t('letGo')));
  for (const b of document.querySelectorAll('[data-lang-seg] button')) b.setAttribute('aria-pressed', b.dataset.lang === l ? 'true' : 'false');
  if (social) { social.renderHome(); social.refreshPage(); }
  if (eco) eco.renderHome();
  // the plates over the tanks, the + and the squad panel all carry text too
  if (stage) { renderStageNames(); renderSquadBar(); }
  updateLeaderUI();
  if (renderer) { renderLobby(); if (room && net && screen === 'game') { hud.setRoom(room, net.myId); hud.renderFeed(); if (room.state === 'ended') hud.showEnd(room, net.myId); } }
}
for (const b of document.querySelectorAll('[data-lang-seg] button')) b.addEventListener('click', () => { audio && audio.play('click'); applyLang(b.dataset.lang); });
applyLang(detectLang(settings.lang));
$('loadMsg').textContent = t('loading3d');

/* ---------------- boot ---------------- */
async function boot() {
  try {
    THREE = await import('./three.js');
    ({ buildWorld } = await import('./game/world.js'));
    ({ Game } = await import('./game/game.js'));
    ({ LobbyStage } = await import('./game/lobbystage.js'));
    stage = new LobbyStage();
    ({ LobbyLife } = await import('./game/lobbylife.js'));
    life = new LobbyLife();
  } catch (e) {
    $('loadMsg').textContent = t('noEngine'); console.error(e); return;
  }
  $('loadMsg').textContent = t('loadingMaps');
  await new Promise(r => setTimeout(r, 20));
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
  } catch (e) { $('loadMsg').textContent = t('noWebgl'); return; }
  renderer.shadowMap.enabled = true;
  camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, 1, 400);
  hud = new HUD(); input = new Input($('view')); input.mode = settings.controls;
  touch = new TouchControls($('touch'), { moveBase: $('moveBase'), moveKnob: $('moveKnob'), aimBase: $('aimBase'), aimKnob: $('aimKnob'), fire: $('fireBtn') });
  touch.getScale = () => parseFloat(getComputedStyle($('touch')).getPropertyValue('--ts')) || 1;
  touch.bindAbility($('abBtn')); touch.bindMic($('vcBtn'));
  hud.touchCtl = touch;                              // so the HUD can tell the power stick it is ready
  touch.onAbility = () => audio.play('click');
  touch.onAbilityDenied = () => audio.play('deny');
  voice = new VoiceChat({
    settings,
    send: (m) => { if (net) net.sendJSON(m); },
    myId: () => (net ? net.myId : 0),
    players: () => (room ? room.players : []),
    teamOf: (id) => { const p = room && room.players.find(q => q.id === id); return p ? p.team : ''; },
    onState: () => { hud.voice(voiceState()); },
  });
  hud.onVoiceToggle = async () => { const okv = await voice.toggle(); settings.voice = !!okv; saveSettings(); hud.voice(voiceState()); if (!okv && voice.error) toast(t('vcErr_' + voice.error), 3500); };
  hud.onVoicePush = (v) => voice.setTalking(v);
  hud.onVoiceMute = (id, v) => voice.mute(id, v);
  // hold V to talk (ignored while typing in a box)
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat && !typing(e) && screen === 'game' && settings.voiceMode === 'push') voice.setTalking(true); });
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyV') voice.setTalking(false); });
  window.addEventListener('blur', () => voice && voice.setTalking(false));
  audio = new GameAudio(); applyAudio();
  hud.audio = audio;                               // so the result card can play its own sting
  acc = new Account(API_BASE, HUB_URL);
  social = new SocialUI({ acc, audio, toast, show, joinRoom, enterRanked, screen: () => screen, requireAccount, tankImg, inPrivateLobby: () => (screen === 'lobby' && room && room.kind === 'private' && !practice ? room.code : null) });
  eco = new EcoUI({ acc, audio, toast, screen: () => screen, tankImg, requireAccount }, social);
  acc.on('rp', onRankResult);
  if (window.TRACKFIRE_PRACTICE_ONLY) { acc.reachable = false; social.renderHome(); }
  else { acc.ping().then((ok) => { if (ok && acc.has) acc.connect(); social.loadMe(); }); setInterval(() => { if (screen !== 'game') acc.ping(); }, 60000); }
  game = new Game({ renderer, camera, net: null, hud, input, audio, getWorld });
  applyTouchMode();
  setMenuMap(settings.lastMap || 'hawler');
  updateLeaderUI();
  // the line-up follows whatever you and your squad have picked
  // Your squad leader walked into a room, so you go with them — no invite to accept.
  acc.on('pull', (m) => {
    if (!m || !m.code) return;
    if (screen === 'game' || practice) return;              // never yank someone out of a match
    if (room && room.code === m.code) return;               // already there
    if (pulledTo === m.code) return;                        // already on the way
    pulledTo = m.code;                                      // and mark yourself ready on arrival
    toast(t('sqPulled'));
    joinRoom(m.code);
  });
  acc.on('wallet', refreshStage);
  acc.on('party', () => { refreshStage(); syncMenuMap(); updateLeaderUI(); });
  acc.on('friends', refreshMoreDot); acc.on('notify', refreshMoreDot);
  acc.on('account', refreshStage);
  acc.on('status', refreshStage);
  renderThumbs();
  renderTankImages();
  game.W = null;
  $('nameInp').value = (acc.acc && acc.acc.name) || settings.name || '';
  const code = (params.get('room') || '').toUpperCase().slice(0, 5);
  if (code) $('codeInp').value = code;
  social.renderHome();
  if (window.TRACKFIRE_PRACTICE_ONLY) {
    for (const id of ['btnQuick', 'btnRanked', 'btnCreate', 'homeSide']) $(id).hidden = true;
    document.querySelector('.join').hidden = true; $('menuNote').hidden = false;
    $('btnPractice').classList.add('primary');
  }
  $('loading').remove();
  show('menu');
  if (code && settings.name && !window.TRACKFIRE_PRACTICE_ONLY) joinRoom(code);
  window.addEventListener('resize', onResize); onResize();
  // Handy for debugging from the browser console: __tf.net.st, __tf.game …
  window.__tf = { get net() { return net; }, game, hud, get room() { return room; }, LAT_SIM, acc, social, eco,
    // practice only: jump into any tank to try its special power
    tryTank: (id, ab = 5) => net && net.sendJSON({ t: 'tryTank', id, ab }),
    get voice() { return voice; }, get touch() { return touch; }, setLang: applyLang, get stage() { return stage; }, get life() { return life; }, setMenuMap, worlds,
    setVoice: (o) => { for (const k in o) { settings[k] = o[k]; settingChanged(k); } },
    // tests: act as a returning player who already picked a name (skips the first-run screen)
    setName: (n) => { settings.name = n; saveSettings(); testNamed = true; $('nameInp').value = n; } };
  requestAnimationFrame(loop);
}

const mapThumbs = {};
function getWorld(id) {
  if (!worlds[id]) worlds[id] = buildWorld(getMap(id), { lowDetail: (QUALITY[settings.quality] || QUALITY.medium).lowDetail, sun: settings.sun });
  return worlds[id];
}
/**
 * The menu's own copy of a map, with the staging area swept clear so the line-up of tanks is
 * never hidden behind a rock or standing in the river. Built only for a map you actually look
 * at, so a player who never changes map only ever pays for one.
 */
let lobbyWorldId = null;                 // only ever one menu world is kept
function getLobbyWorld(id) {
  const key = 'lobby:' + id;
  if (!worlds[key]) {
    // Borrow the ground from the map you actually play on — it is the same terrain, and it is
    // the expensive part (about 24,000 triangles). Only the props differ.
    const play = getWorld(id);
    worlds[key] = buildWorld(getLobbyMap(id), {
      lowDetail: (QUALITY[settings.quality] || QUALITY.medium).lowDetail, sun: settings.sun,
      sharedGround: play.ground && play.ground.geometry,
    });
    worlds[key].isLobby = true;
  }
  // The menu shows one map at a time, so the last one is thrown away rather than piling up.
  if (lobbyWorldId && lobbyWorldId !== key) disposeWorld(lobbyWorldId);
  lobbyWorldId = key;
  return worlds[key];
}
/** Free a menu world. The ground is borrowed from the playing world, so it is left alone. */
function disposeWorld(key) {
  const W = worlds[key]; if (!W) return;
  delete worlds[key];
  W.scene.traverse((o) => {
    if (o === W.ground && W.borrowedGround) return;      // not ours to free
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
    else if (m && m.dispose) m.dispose();
  });
}
/* ---------------- who is in charge of the squad ----------------
   On your own you decide everything. In a squad only the leader picks the map, the mode and
   when to play; everyone else follows what he picked and is free to wander the menu meanwhile. */
/** True when nobody else's plans depend on you: solo, or the leader of your squad. */
function iLead() { const p = acc && acc.party; return !p || !p.members || p.members.length < 2 || p.leader === acc.id; }
/**
 * The map the menu should be showing: always your own.
 *
 * The leader's pick used to be forced onto everyone's menu, so while he browsed maps the rest of
 * the squad had the ground change under their feet — mid-chest-opening, mid-upgrade. What the
 * leader picks is a PLAN, and the party carries it as data (`party.map`, shown on the squad panel
 * and used when the lobby is actually created). It is not a command to redraw anybody's screen.
 * Members are moved only when the lobby really opens, and that goes through `pull`.
 */
function menuMapId() { return settings.lastMap || 'hawler'; }
/** Put the menu on your own map, and tell the squad what you picked if the squad is yours. */
function syncMenuMap() {
  setMenuMap(menuMapId());
  if (acc && acc.party && acc.party.members && acc.party.members.length > 1 && acc.party.leader === acc.id) {
    const mine = mapForMenu(settings.lastMap || 'hawler');
    if (acc.party.map !== mine) acc.req({ t: 'partyMap', map: mine }).catch(() => {});
  }
}
/** Show the menu on `id`'s staging ground, rebuilding the line-up on the new map. */
function setMenuMap(id) {
  const W = getLobbyWorld(mapForMenu(id));
  if (menuWorld === W) return;
  menuWorld = W;
  if (stage) { stage.attach(W); refreshStage(); }
  if (life) life.attach(W, settings.quality);
}
function mapForMenu(id) { return MAP_IDS.includes(id) ? id : 'hawler'; }

/* ---------------- match setup: what to play, decided before the room exists ----------------
   Choosing a map used to happen inside the team lobby, mixed in with READY, teams, bots and
   LEAVE ROOM — so people were readying up while the host was still browsing, and "leave" sat
   one thumb away from a map button. Setup is now its own step: mode, map and time, then BACK or
   CREATE LOBBY. BACK means back to the menu. It does not touch the squad. */
const setup = { map: 'hawler', mode: 'tdm', tod: 'random', editing: false };
function openSetup(editing) {
  setup.editing = !!editing;
  if (editing && room) { setup.map = room.pickedMap || room.map; setup.mode = room.mode; setup.tod = room.tod || 'random'; }
  else { setup.map = settings.lastMap || 'hawler'; setup.mode = settings.lastMode || 'tdm'; setup.tod = settings.lastTod || 'random'; }
  renderSetup();
  show('setup');
}
function renderSetup() {
  $('btnSuGo').textContent = t(setup.editing ? 'back' : 'createLobby');
  const ball = setup.mode === 'ball';
  for (const b of document.querySelectorAll('#lbMaps .map')) {
    const st = b.dataset.map === 'stadium';
    b.hidden = st !== ball;                                  // Tank Ball is always in the stadium
    b.setAttribute('aria-pressed', b.dataset.map === setup.map ? 'true' : 'false');
    b.disabled = ball;
  }
  for (const b of document.querySelectorAll('#lbModeSeg button')) b.setAttribute('aria-pressed', b.dataset.mode === setup.mode ? 'true' : 'false');
  for (const b of document.querySelectorAll('#lbTodSeg button')) b.setAttribute('aria-pressed', b.dataset.v === setup.tod ? 'true' : 'false');
}
/** A choice made in setup: remembered, and sent on if the room already exists. */
function pickSetup(k, v) {
  setup[k] = v;
  if (k === 'mode' && v === 'ball') setup.map = 'stadium';
  else if (k === 'mode' && setup.map === 'stadium') setup.map = 'hawler';
  if (setup.editing && net && room && room.host === net.myId) {
    if (k === 'mode') net.sendJSON({ t: 'mode', mode: setup.mode });
    if (k === 'tod') net.sendJSON({ t: 'tod', v: setup.tod });
    net.sendJSON({ t: 'map', map: setup.map });
  }
  renderSetup();
}
/** What the lobby shows instead of the pickers: the choices, and a way back to them for the host. */
function renderSetupLine(r, host) {
  const el = $('lbSetup'); if (!el) return;
  const priv = r.kind === 'private' || r.kind === 'practice';
  el.hidden = !priv;
  if (!priv) { el.innerHTML = ''; return; }
  const mapName = t({ hawler: 'mapHawler', desert: 'mapDesert', forest: 'mapForest', stadium: 'mapStadium' }[r.map] || 'mapHawler');
  const bits = `<b>${th(t('m_' + r.mode))}</b><span>${th(mapName)}</span><span>${th(t('tod' + (r.tod || 'random').replace(/^./, (c) => c.toUpperCase())))}</span>`;
  el.innerHTML = bits + (host ? `<button class="btn sm ghost" id="lbEditSetup" type="button">${esc(t('change'))}</button>` : '');
  const b = $('lbEditSetup');
  if (b) b.onclick = () => { audio.play('click'); openSetup(true); };
}
function renderThumbs() {
  const tc = new THREE.PerspectiveCamera(40, 16 / 9, 1, 400);
  renderer.setPixelRatio(1); renderer.setSize(480, 270, false);
  for (const id of ['hawler', 'desert', 'forest', 'stadium']) {
    const W = getWorld(id); tc.position.set(0, 70, 52); tc.lookAt(0, 0, -4); W.follow(new THREE.Vector3(0, 0, 0));
    renderer.render(W.scene, tc);
    const el = $({ hawler: 'thHawler', desert: 'thDesert', forest: 'thForest', stadium: 'thStadium' }[id]);
    if (el) el.src = renderer.domElement.toDataURL('image/jpeg', 0.82);
    mapThumbs[id] = el && el.src;
  }
  onResize();
}

// Game-mode pictures: a small scene of each mode rendered once with the real
// maps and tanks, then used by the Modes page and the room's mode buttons
// (through CSS variables). Saved pictures in img/modes/ show until then.
function renderModeImages(TankView, MP) {
  if (!THREE.REVISION) return;                       // test stand-in without WebGL
  const B = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
  const S = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7 });
  const mesh = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
  const flag = (x, y, z, team) => {
    const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6), S(0xdddddd), x, y + 2.6, z));
    [[0xed2024, 4.9], [0xf7f7f2, 4.4], [0x278e43, 3.9]].forEach(([c, h]) => g.add(mesh(new THREE.BoxGeometry(2.4, 0.5, 0.06), S(c), x + 1.3, y + h, z)));
    const r = mesh(new THREE.RingGeometry(1.1, 1.5, 24), B(team === 'blue' ? 0x62a2ff : 0xff6250, 0.85), x, y + 0.12, z); r.rotation.x = -Math.PI / 2; g.add(r); return g;
  };
  const glow = (x, y, z, c, r) => mesh(new THREE.SphereGeometry(r, 12, 8), B(c, 0.9), x, y, z);
  const SC = {
    tdm:  { map: 'hawler', at: [22, 20], tanks: [['zagros', 'blue', 17, 24, 0.6, 0.9], ['halgurd', 'blue', 14, 18, 0.9, 1.0], ['baz', 'red', 29, 15, -2.3, -2.2], ['bradost', 'red', 27, 22, -2.0, -1.9]], extra: (H) => [glow(22, H(22, 19.5) + 1.5, 19.5, 0xffc060, 0.45)] },
    ffa:  { map: 'desert', at: [4, -4], tanks: [['zagros', 'ffa0', -2, -2, 0.5, 1.0], ['baz', 'ffa1', 8, -8, -2, -2.4], ['korek', 'ffa2', 10, 2, -1.6, -2.6], ['newroz', 'ffa3', 0, -11, 0.2, 0.6], ['rashaba', 'ffa4', -6, -9, 1.4, 0.9]] },
    ctf:  { map: 'forest', at: [-48, 0], tanks: [['zagros', 'blue', -50, 5, 2.4, 2.0], ['baz', 'red', -43, -3, -1.2, -2.0]], extra: (H) => [flag(-52, H(-52, 0), 0, 'blue')] },
    koh:  { map: 'hawler', at: [0, -9], tanks: [['halgurd', 'blue', -3, -5, 0.4, 0.2], ['zagros', 'blue', 4, -7, -0.3, -0.6], ['bradost', 'red', 7, -14, -2.6, -2.8]],
            extra: (H) => { const y = H(0, -6.5) + 0.15, a = mesh(new THREE.RingGeometry(6, 6.7, 48), B(0xffd23a, 0.9), 0, y, -6.5), b = mesh(new THREE.CircleGeometry(6, 48), B(0xffd23a, 0.18), 0, y - 0.02, -6.5); a.rotation.x = b.rotation.x = -Math.PI / 2; return [a, b]; } },
    lts:  { map: 'forest', at: [-20, 12], tanks: [['safeen', 'blue', -26, 14, 1.2, 1.4], ['korek', 'red', -13, 9, -1.8, -1.9]], extra: (H) => [glow(-19, H(-19, 7) + 1.2, 7, 0xff8a30, 1.3), glow(-19, H(-19, 7) + 1.3, 7, 0xfff0b0, 0.6)] },
    rush: { map: 'desert', at: [9, 2], tanks: [['baz', 'blue', 4, 4, 1.2, 1.4], ['rashaba', 'red', 14, -2, -1.5, -1.7]],
            extra: (H) => { const y = H(9, 2); const box = mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), B(0xffd23a), 9, y + 1.8, 2); box.rotation.set(0.6, 0.7, 0.3);
              return [mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.22, 16), S(0x2b2f33), 9, y + 0.11, 2), box, glow(9, y + 1.8, 2, 0xffe27a, 0.2)]; } },
    convoy: { map: 'hawler', at: [-5, 32], tanks: [['zagros', 'blue', -12, 33, 1.57, 1.2], ['korek', 'blue', -9, 27, 1.57, 0.4], ['rashaba', 'red', 8, 38, -2.2, -2.0], ['bradost', 'red', 10, 24, -1.2, -1.4]],
              extra: (H) => { const g = MP.makeTruck(); g.position.set(-3, H(-3, 30.5), 30.5); g.rotation.y = Math.PI / 2; return [g]; } },
    jugg:   { map: 'desert', at: [0, 2], tanks: [['zagros', 'ffa0', -11, -6, 0.7, 0.9], ['baz', 'ffa2', 11, -7, -0.6, -0.7], ['korek', 'ffa3', -10, 11, 2.0, 2.2]],
              extra: (H) => { const v = new TankView(new THREE.Scene(), 0x8a5bb8, 0xffffff, false, 'newroz'); v.setPose(0, 3, 0.3, 2.6, H, 0.016, 0); v.body.scale.setScalar(1.7); return [v.root]; } },
    ball:   { map: 'stadium', at: [40, 0], tanks: [['baz', 'blue', 32, 2, 1.57, 1.57], ['zagros', 'blue', 29, -6, 1.2, 1.3], ['rashaba', 'red', 47, 5, -1.57, -1.8]],
              extra: () => { const b = MP.makeBall(2.4); b.position.set(40, 0, -1); return [b]; } },
    surv:   { map: 'hawler', at: [1, 15], tanks: [['zagros', 'blue', -3, 11, 0, 0.3], ['halgurd', 'blue', 5, 9, 0.3, 0.1], ['baz', 'red', -11, 21, 2.6, 2.8], ['bradost', 'red', 12, 20, -2.4, -2.6], ['rashaba', 'red', 2, 25, 3.1, 3.0]],
              extra: (H) => { const y = H(0, 12) + 0.15, a = mesh(new THREE.RingGeometry(8.5, 9, 48), B(0x62a2ff, 0.9), 0, y, 12); a.rotation.x = -Math.PI / 2; return [a, glow(2, H(2, 19) + 1.5, 19, 0xffc060, 0.5)]; }, night: true },
    potato: { map: 'forest', at: [22, -12], tanks: [['baz', 'ffa1', 23, -12, 0.8, 0.9], ['zagros', 'ffa0', 16, -7, 2.2, 2.4], ['korek', 'ffa2', 28, -6, -2.5, -2.3], ['safeen', 'ffa3', 15, -18, 0.9, 1.0]],
              extra: (H) => { const b = MP.makeBomb(); b.position.set(23, H(23, -12) + 4.4, -12); b.scale.setScalar(1.3); return [b]; } },
    bounty: { map: 'desert', at: [20, -10], tanks: [['newroz', 'red', 26, -14, -1.0, -1.2], ['zagros', 'blue', 12, -6, 2.0, 2.1], ['baz', 'blue', 16, -2, 2.4, 2.6], ['rashaba', 'red', 30, -4, -2.2, -2.3]],
              extra: (H) => { const out = []; for (let i = 0; i < 5; i++) { const st = mesh(new THREE.OctahedronGeometry(0.55, 0), B(0xffd23a), 24 + i * 1.1, H(26, -14) + 5.2, -14); st.scale.set(1, 1, 0.35); out.push(st); } return out; } },
  };
  const cam = new THREE.PerspectiveCamera(CAMERA.FOV, 16 / 9, 1, 400);
  renderer.setPixelRatio(1); renderer.setSize(480, 270, false);
  const root = document.documentElement.style;
  for (const [id, s] of Object.entries(SC)) {
    const W = getWorld(s.map), H = (x, z) => W.map.height(x, z), add = [];
    for (const [kind, team, x, z, yaw, tur] of s.tanks) {
      const ffa = team.startsWith('ffa'), col = ffa ? [0x4a78b8, 0xc24b3c, 0x5d8f45, 0xd09a2f, 0x8a5bb8][+team[3]] : team === 'blue' ? 0x4a78b8 : 0xc24b3c;
      const v = new TankView(W.scene, col, 0xffffff, false, kind); v.setPose(x, z, yaw, tur, H, 0.016, 0); add.push(v);
    }
    const ex = s.extra ? s.extra(H) : []; for (const o of ex) W.scene.add(o);
    if (s.night && W.setNight) W.setNight(true);
    const [tx, tz] = s.at, ty = H(tx, tz), p = CAMERA.PITCH_DEG * Math.PI / 180, d = 36;
    cam.position.set(tx, ty + d * Math.sin(p), tz + d * Math.cos(p)); cam.lookAt(tx, ty, tz); W.follow(new THREE.Vector3(tx, ty, tz));
    renderer.render(W.scene, cam);
    try { root.setProperty('--mode-' + id, `url(${renderer.domElement.toDataURL('image/jpeg', 0.84)})`); } catch (e) {}
    if (s.night && W.setNight) W.setNight(false);
    for (const v of add) v.dispose();
    for (const o of ex) { W.scene.remove(o); o.traverse(m => { if (m.geometry) m.geometry.dispose(); }); }
  }
}

// Garage pictures: every tank type rendered once with the real 3D model.
async function renderTankImages() {
  const { TankView } = await import('./game/tank.js');
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404850, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(6, 10, 7); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 4 / 3, 1, 100); cam.position.set(8.5, 6.2, 9.5); cam.lookAt(0, 0.9, 0.3);
  renderer.setPixelRatio(1); renderer.setSize(320, 240, false); renderer.setClearColor(0x1b2024, 1);
  const shadow = renderer.shadowMap.enabled; renderer.shadowMap.enabled = false;
  for (const id of TANK_IDS) {
    const v = new TankView(scene, 0xf0c24a, 0xffe0a0, false, id);
    if (v.teamRing) v.teamRing.visible = false;
    v.setPose(0, 0, -0.5, -0.25, () => 0, 0.016, 0);
    renderer.render(scene, cam);
    try { tankImages[id] = renderer.domElement.toDataURL('image/png'); } catch (e) {}
    v.dispose();
  }
  renderer.shadowMap.enabled = shadow; renderer.setClearColor(0x000000, 1);
  try { renderModeImages(TankView, await import('./game/modeprops.js')); } catch (e) { console.warn('mode pictures', e); }
  onResize();
  // 3D icons (chests, coin, gem, menu buttons): rendered once, then used everywhere through CSS.
  try {
    const { renderIcons3D } = await import('./ui/icons3d.js');
    await renderIcons3D((sc) => { const v = new TankView(sc, 0xf0c24a, 0xffe0a0, false, 'zagros'); if (v.teamRing) v.teamRing.visible = false; return v; });
  } catch (e) { console.warn('3D icons unavailable', e); }
  if (eco) { eco.renderHome(); eco.refreshPage(); }
}

/* ---------------- screens ---------------- */
function show(s) {
  screen = s;
  $('scr-menu').hidden = s !== 'menu';
  if (s !== 'menu') openDrawer(false);
  document.body.classList.toggle('on-menu', s === 'menu');   // the stage name plates only show here
  if ((s === 'menu' || s === 'page') && stage && menuWorld && !stage.views.size) refreshStage();
  $('scr-lobby').hidden = s !== 'lobby';
  $('scr-setup').hidden = s !== 'setup';
  $('scr-page').hidden = s !== 'page';
  hud.show(s === 'game');
  $('touch').hidden = !(s === 'game' && hud.touch);
  document.body.classList.toggle('aiming', s === 'game' && !hud.touch);
  if (s !== 'game') { $('pause').hidden = true; hud.toggleScores(false); }
  if (s === 'game') { audio.stopMusic(); } else if (audio.ctx) audio.startMusic();
  if (s !== 'game') for (const W of Object.values(worlds)) W.setNight && W.setNight(false);
  checkRotate();
  if (social) social.queueUI();
  if (eco) { eco.renderBar(); if (s === 'menu') eco.maybeDaily(); }
}
function onResize() {
  if (!renderer) return;
  if (screen === 'game') game.resize();
  else { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); hud.layout(); }
  checkRotate();
}
function checkRotate() { $('rotate').hidden = !(screen === 'game' && hud && hud.touch && innerHeight > innerWidth); }

/* ---------------- networking ---------------- */
function playerName() {
  const n = ((acc && acc.acc && acc.acc.name) || settings.name || '').trim().slice(0, 14);
  return n || null;                      // no name yet: the first-run screen asks for one
}
// Online features need an account: created (or renamed) from the name field.
/* =====================================================================
   FIRST RUN — three short steps: name, age group, city. It only ever
   appears once, before the first online match.

   We ask for the year of birth but store only the GROUP it falls in
   (under 13 / 13-17 / 18+). The date itself never leaves the phone.
   Under 13 turns voice chat off, which is what the app stores expect.
   ===================================================================== */
const WC_CITIES = ['Hawler', 'Silemani', 'Duhok', 'Kirkuk', 'Halabja', 'Zakho', 'Ranya', 'Soran', 'Baghdad', 'Mosul', 'Basra', 'Other'];
let wcStep = 0, wcData = { name: '', birthYear: 0, city: '' }, wcDone = null;
function welcomeOpen() {
  return new Promise((resolve) => {
    wcDone = resolve; wcStep = 0;
    wcData = { name: settings.name || '', birthYear: 0, city: '' };
    $('wcName').value = wcData.name;
    // years: this year back 60 years, newest first
    const now = new Date().getUTCFullYear();
    $('wcYears').innerHTML = Array.from({ length: 61 }, (_, i) => now - i)
      .map(y => `<button type="button" data-y="${y}">${y}</button>`).join('');
    $('wcCities').innerHTML = WC_CITIES.map(c => `<button type="button" data-c="${esc(c)}">${esc(t('city_' + c.toLowerCase()) !== 'city_' + c.toLowerCase() ? t('city_' + c.toLowerCase()) : c)}</button>`).join('');
    $('wcCityOther').hidden = true; $('wcCityOther').value = '';
    $('welcome').hidden = false;
    welcomeShow();
  });
}
function welcomeShow() {
  for (const el of document.querySelectorAll('.wc-step')) el.hidden = Number(el.dataset.step) !== wcStep;
  document.querySelectorAll('.wc-steps i').forEach((el, i) => el.classList.toggle('on', i <= wcStep));
  $('wcBack').hidden = wcStep === 0;
  $('wcSkip').hidden = wcStep !== 2;
  $('wcNext').textContent = t(wcStep === 2 ? 'wcStart' : 'wcNext');
  $('wcErr').hidden = true;
  if (wcStep === 0) setTimeout(() => $('wcName').focus(), 50);
}
function welcomeNext() {
  if (wcStep === 0) {
    const n = cleanNameLocal($('wcName').value);
    if (n.length < 2) { $('wcErr').textContent = t('enterName'); $('wcErr').hidden = false; return; }
    wcData.name = n; settings.name = n; saveSettings();
  }
  if (wcStep === 1 && !wcData.birthYear) { $('wcErr').textContent = t('wcPickYear'); $('wcErr').hidden = false; return; }
  if (wcStep === 2) { if (!$('wcCityOther').hidden) wcData.city = $('wcCityOther').value.trim(); return welcomeFinish(); }
  wcStep++; audio.play('click'); welcomeShow();
}
function welcomeFinish() {
  $('welcome').hidden = true;
  audio.play('levelup');
  const d = wcDone; wcDone = null; if (d) d(wcData);
}
const cleanNameLocal = (v) => String(v || '').replace(/[^\p{L}\p{N}_\- .]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);

let testNamed = false;
async function requireAccount() {
  if (window.TRACKFIRE_PRACTICE_ONLY) { toast(t('offlineNote'), 3500); return false; }
  if (acc.reachable === false && !(await acc.ping())) { toast(t('e_offline_srv'), 3000); return false; }
  // first time online: ask for a name, an age group and a city
  if (!acc.has && !testNamed) {
    const d = await welcomeOpen();
    if (!d || !d.name) return false;
    try {
      await acc.ensure(d.name, { birthYear: d.birthYear, city: d.city });
      if (acc.ageGroup === 'kid' && settings.voice) { settings.voice = false; saveSettings(); }   // voice chat off for under 13
      social.renderHome(); return true;
    } catch (e) {
      showErr(t('e_' + (e.code || 'server')) !== 'e_' + e.code ? t('e_' + e.code) : t('e_server')); return false;
    }
  }
  const name = playerName(); if (!name) return false;
  try { await acc.ensure(name); $('nameInp').value = acc.acc.name; social.renderHome(); return true; }
  catch (e) {
    if (e.code === 'name_wait') { nameWait(e); return true; }
    showErr(t('e_' + (e.code || 'server')) !== 'e_' + e.code ? t('e_' + e.code) : t('e_server')); if (screen !== 'menu') show('menu'); return false; }
}
function makeNet(openTransport) {
  if (net) { net.wantOnline = false; try { net.conn && net.conn.close(); } catch (e) {} }
  net = new NetClient({
    name: (acc && acc.acc && acc.acc.name) || settings.name, token: getToken(), openTransport,
    handlers: {
      onWelcome: (m) => { if (!practice) { try { localStorage.setItem('trackfire-last-room', m.code); } catch (e) {} } history.replaceState(null, '', practice ? location.pathname : '?room=' + m.code + (params.get('server') ? '&server=' + encodeURIComponent(params.get('server')) : '')); },
      onRoom: onRoom,
      onEvent: onNetEvent,
      onError: (msg, code) => { const c = (net && net.code) || ''; toMenu(); showErr(code === 'no_room' ? t('noRoom', { code: c }) : code === 'full' ? t('roomFull') : code === 'lost' ? t('lostConn') : code === 'need_account' ? t('e_need_account') : code === 'not_yours' ? t('e_not_yours') : msg); },
      onStatus: (s) => { if (screen === 'lobby') $('lbNote').textContent = s === 'online' ? '' : s === 'reconnecting' ? t('connLost') : s === 'connecting' ? t('connecting') : ''; },
    },
  });
  game.net = net;
  return net;
}
async function connect(action, code, extra = {}) {
  audio.unlock(); showErr('');
  // Online: make sure there is an account first — that is what asks a new player for
  // a name, an age group and a city.
  if (acc.reachable !== false && !window.TRACKFIRE_PRACTICE_ONLY) { if (!(await requireAccount())) return; }
  else if (!playerName()) { const d = await welcomeOpen(); if (!d || !d.name) return; }
  practice = false;
  makeNet(() => new WebSocket(SERVER_URL)).connect(action, code, { ...extra, auth: acc.auth() });
  $('lbNote').textContent = t('connecting');
  room = null; showLobbySkeleton(code);
}
function joinRoom(code) {
  code = (code || '').toUpperCase().trim();
  if (code.length !== 5) { showErr(t('codeLen')); return; }
  connect('join', code);
}
async function startPractice() {
  audio.unlock(); showErr('');
  // A brand-new player can press PRACTICE first: ask for the name (and age / city) here too.
  if (!playerName()) {
    const d = await welcomeOpen(); if (!d || !d.name) return;
    if (acc.reachable !== false && !window.TRACKFIRE_PRACTICE_ONLY && !acc.has) {
      // in the background: practice must not wait for the server
      acc.ensure(d.name, { birthYear: d.birthYear, city: d.city })
        .then(() => { if (acc.ageGroup === 'kid' && settings.voice) { settings.voice = false; saveSettings(); } social.renderHome(); })
        .catch(() => { /* offline or refused: practice still works with just the name */ });
    }
  }
  const name = playerName(); if (!name) return;
  practice = true;
  const worker = new Worker(new URL('./practice-worker.js', import.meta.url), { type: 'module' });
  const W = acc && acc.wallet, tank = W ? { id: W.sel, level: W.tanks[W.sel].level, mods: W.tanks[W.sel].mods } : null;
  makeNet(() => workerTransport(worker)).connect('create', null, { map: settings.lastMap || 'hawler', tank });
  showLobbySkeleton('SOLO');
  let added = false;
  const orig = net.h.onRoom;
  net.h.onRoom = (r) => { orig(r); if (!added && r.host === net.myId) { added = true; for (let i = 0; i < 5; i++) net.sendJSON({ t: 'addBot' }); } };
}
function enterRanked(go) {
  if (net) { net.wantOnline = false; try { net.leave(); } catch (e) {} net = null; }
  hud.rankRes = null;
  connect('join', go.code);
}
function toMenu() {
  if (voice) voice.disable();
  vcOn.clear();
  if (net) { net.leave(); net = null; game.net = null; }
  room = null; practice = false; game.clearViews && game.W && game.clearViews(); game.W && game.clearObjective(); game.lastObjMsg = null;
  history.replaceState(null, '', location.pathname + (params.get('server') ? '?server=' + encodeURIComponent(params.get('server')) : ''));
  show('menu'); social.renderHome(); social.loadMe();
}

/* ---------------- room / lobby ---------------- */
function showLobbySkeleton(code) {
  $('lbCode').textContent = code || '·····';
  $('lbPlayers').innerHTML = ''; $('lbLink').textContent = '';
  show('lobby');
}
// Loading screen: shown while every player loads the map; the match starts when all are in.
let loadSent = false;
/* =====================================================================
   THE DRAW — before every quick / ranked match the server has already
   picked the mode and the map at random. Two reels spin and land on them,
   then the loading screen takes over. (In a private room the host picked
   them himself, so there is nothing to reveal.)
   ===================================================================== */
const MAP_IDS_UI = ['hawler', 'desert', 'forest', 'stadium'];
const MAP_KEY = { hawler: 'mapHawler', desert: 'mapDesert', forest: 'mapForest', stadium: 'mapStadium' };
let revealKey = '', revealT = [];
function revealScreen(r) {
  const key = r.code + '|' + r.mode + '|' + r.map + '|' + (r.startedAt || '') + '|' + r.state;
  if (revealKey === key) return;
  revealKey = key;
  for (const h of revealT) clearTimeout(h); revealT = [];
  let el = $('revScr');
  if (!el) {
    el = document.createElement('div'); el.id = 'revScr';
    el.innerHTML = `<div class="rev-box">
      <div class="rev-col"><span class="rev-lbl" data-i18n="revMode">MODE</span><div class="rev-win"><div class="rev-reel" id="revModes"></div></div></div>
      <div class="rev-col"><span class="rev-lbl" data-i18n="revMap">MAP</span><div class="rev-win"><div class="rev-reel" id="revMaps"></div></div></div>
    </div><p class="rev-sub" id="revSub"></p>`;
    document.body.appendChild(el);
  }
  el.hidden = false; el.classList.remove('done');
  el.querySelector('#revSub').textContent = t('revDrawing');
  for (const q of el.querySelectorAll('.rev-lbl')) q.textContent = t(q.dataset.i18n === 'revMode' ? 'revMode' : 'revMap');
  // build the two reels: the list repeated a few times, ending on the real pick
  const modes = (r.kind === 'ranked' ? GAME.RANKED.MODES : GAME.MODE_IDS).filter(m => GAME.MODES[m]);
  const maps = MAP_IDS_UI.filter(m => m !== 'stadium' || r.map === 'stadium');
  const reel = (host, list, pick, tile) => {
    const LOOPS = 4, idx = Math.max(0, list.indexOf(pick));
    host.style.transition = 'none'; host.style.transform = 'translateY(0)';
    host.innerHTML = Array.from({ length: LOOPS }, () => list.map(tile).join('')).join('') + list.map(tile).join('');
    return { n: list.length, stop: LOOPS * list.length + idx };
  };
  const modeTile = (m) => `<div class="rev-tile"><span class="pic" style="background-image:var(--mode-${m},url(img/modes/${m}.jpg))"></span><b>${esc(t('m_' + m))}</b></div>`;
  // If the map pictures are not rendered yet, each map still gets its own colour.
  const MAP_BG = { hawler: 'linear-gradient(160deg,#6b6153,#3b3a33)', desert: 'linear-gradient(160deg,#c8a163,#7a5c32)', forest: 'linear-gradient(160deg,#4e7a46,#27412a)', stadium: 'linear-gradient(160deg,#3f7d4e,#1f4a2c)' };
  const mapTile = (m) => `<div class="rev-tile"><span class="pic" style="${mapThumbs[m] ? `background-image:url(${mapThumbs[m]})` : `background:${MAP_BG[m] || '#2a3038'}`}"></span><b>${esc(t(MAP_KEY[m] || m))}</b></div>`;
  const mEl = $('revModes'), pEl = $('revMaps');
  const A = reel(mEl, modes, r.mode, modeTile), B = reel(pEl, maps, r.map, mapTile);
  const spin = (host, info, ms) => {
    requestAnimationFrame(() => {
      const h = host.firstChild ? host.firstChild.getBoundingClientRect().height : 120;
      host.style.transition = `transform ${ms}ms cubic-bezier(.12,.72,.18,1)`;
      host.style.transform = `translateY(${-info.stop * h}px)`;
    });
  };
  spin(mEl, A, 1250); spin(pEl, B, 2050);
  // ticking while they spin, then a thud as each one lands
  let gap = 55;
  const tick = (until) => { if (performance.now() > until) return; audio.play('wheelTick', null, 0.5); gap = Math.min(190, gap * 1.085); revealT.push(setTimeout(() => tick(until), gap)); };
  tick(performance.now() + 2000);
  revealT.push(setTimeout(() => { mEl.parentElement.classList.add('land'); audio.play('pop', null, 0.9); }, 1260));
  revealT.push(setTimeout(() => { pEl.parentElement.classList.add('land'); audio.play('reward', null, 0.8); $('revSub').textContent = t('m_' + r.mode) + ' · ' + t(MAP_KEY[r.map] || r.map); }, 2060));
  revealT.push(setTimeout(() => { el.classList.add('done'); }, 2700));
  revealT.push(setTimeout(() => { el.hidden = true; el.classList.remove('done'); for (const q of el.querySelectorAll('.rev-win')) q.classList.remove('land'); }, 3100));
}
function hideReveal() { const el = $('revScr'); if (el && !el.hidden) el.hidden = true; for (const h of revealT) clearTimeout(h); revealT = []; revealKey = ''; }

function loadingScreen(r) {
  let el = $('loadScr');
  if (!r || r.state !== 'loading') { if (el) el.hidden = true; loadSent = false; if (!r || r.state !== 'playing') hideReveal(); return; }
  if (r.kind === 'quick' || r.kind === 'ranked') revealScreen(r);   // the draw plays on top while the map builds
  if (!el) { el = document.createElement('div'); el.id = 'loadScr'; el.innerHTML = '<div class="box"><div class="img"></div><h2></h2><p class="sub"></p><div class="bar"><i></i></div><ul></ul></div>'; document.body.appendChild(el); }
  el.hidden = false;
  const mapKey = MAP_KEY[r.map] || 'mapHawler';
  el.querySelector('.img').style.backgroundImage = `var(--mode-${r.mode}, url(img/modes/${r.mode}.jpg))`;
  el.querySelector('h2').textContent = t('m_' + r.mode);
  const humans = r.players.filter(p => !p.bot && p.conn), done = humans.filter(p => p.ld).length;
  el.querySelector('.sub').textContent = t(mapKey) + ' · ' + t('loadingPlayers', { a: done, b: humans.length }) + (r.loadLeft != null ? ' · ' + r.loadLeft + ' ' + t('sec') : '');
  el.querySelector('.bar i').style.width = (humans.length ? done / humans.length * 100 : 100) + '%';
  el.querySelector('ul').innerHTML = humans.map(p => `<li class="${p.team}"><span>${esc(p.name)}</span><span class="${p.ld ? 'ok' : 'wt'}">${p.ld ? '✔ ' + esc(t('ready')) : '…'}</span></li>`).join('');
  if (!loadSent) {                                   // build the map now (it may already be built), then tell the server
    loadSent = true;
    setTimeout(() => { try { getWorld(r.map); if (game) game.useMap(r.map); } catch (e) { console.warn(e); } if (net) net.sendJSON({ t: 'loaded' }); }, 30);
  }
}
function onRoom(r) {
  const prev = room; room = r;
  if (pulledTo && r.code !== pulledTo) pulledTo = null;
  if (r.state === 'closed') { if (!prev || prev.state !== 'closed') { toMenu(); toast(t('closedMatch')); social.go('ranked'); } return; }
  loadingScreen(r);
  if (r.state === 'playing' && screen !== 'game') { enterGame(); }
  else if (r.state === 'lobby' && screen === 'game') { hud.hideEnd(); game.clearObjective(); game.lastObjMsg = null; show('lobby'); menuWorld = getWorld(r.map); }
  else if (r.state === 'ended' && screen === 'game' && (!prev || prev.state !== 'ended')) hud.showEnd(r, net.myId);
  if (screen === 'game') { game.room = r; hud.setRoom(r, net.myId); }
  if (voice) { voice.sync(); hud.voice(voiceState()); }
  renderLobby();
}
function renderLobby() {
  if (!room || !net) return;
  const r = room, host = r.host === net.myId, me = r.players.find(p => p.id === net.myId);
  const priv = r.kind === 'private' || r.kind === 'practice';
  $('lbCode').textContent = practice ? 'SOLO' : r.code;
  $('lbKind').hidden = priv;
  renderSetupLine(r, host);          // the choices, as a line of text — the pickers live in setup now
  if (!priv) $('lbKind').textContent = r.kind === 'ranked' ? t('lobbyRanked', { n: r.max / 2 }) + ' · ' + t('m_' + r.mode) : t('lobbyQuick', { mode: t('m_' + r.mode) });
  for (const id of ['btnReady', 'btnTeam']) $(id).hidden = !priv;
  $('btnInvite').hidden = !(r.kind === 'private' && !practice && acc.online);
  const link = location.origin + location.pathname + '?room=' + r.code + (params.get('server') ? '&server=' + encodeURIComponent(params.get('server')) : '');
  $('lbLink').textContent = practice ? t('practiceLink') : link;
  $('btnCopy').hidden = practice || r.kind === 'ranked'; $('lbLink').hidden = r.kind === 'ranked';
  // Tank Ball is always in the stadium; the stadium is only for Tank Ball
  $('lbCount').textContent = t('players', { n: r.players.length, max: r.max || GAME.MAX_PLAYERS });
  const crown = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 5l3 3 3-5 3 5 3-3-1 8H3z"/></svg>';
  $('lbPlayers').innerHTML = r.players.map(p => `<li class="${p.id === net.myId ? 'me' : ''}"><span>${p.id === r.host ? crown : ''}</span><span class="nm">${esc(p.name)}${p.tank ? `<span class="tkn">${esc(t('tk_' + p.tank))} ${esc(t('lv', { n: p.lvl }))}</span>` : ''}${p.bot ? `<small>${t('bot')}</small>` : ''}${p.id === net.myId ? `<small>${t('you')}</small>` : ''}${!p.conn ? `<small>${t('offline')}</small>` : ''}</span><span class="chip ${p.team}">${p.team === 'ffa' ? 'FFA' : t(p.team)}</span><span class="pg">${p.bot ? '' : p.ping + ' ms'}</span><span class="rd ${p.ready || p.bot ? 'y' : 'n'}">${p.ready || p.bot ? t('ready') : t('waiting')}</span></li>`).join('');
  // Pulled in behind your squad leader? You are counted ready the moment you arrive — you
  // were taken along without being asked, so you should not also have to press a button.
  if (pulledTo && r.code === pulledTo && me && !me.ready && r.kind === 'private') {
    pulledTo = null;
    net.sendJSON({ t: 'ready', v: true });
  }
  $('btnReady').textContent = me && me.ready ? t('notReady') : t('ready');
  if (priv) $('btnTeam').hidden = !GAME.MODES[r.mode].team;
  for (const id of ['btnStart', 'btnAddBot', 'btnDelBot']) $(id).hidden = !host || !priv;
  // A passenger is not stuck watching the host pick a map: they can go and browse the menu
  // while staying in the room, and the watchdog takes them into the match when it starts.
  $('btnWait').hidden = host || !priv;
  $('btnStart').disabled = r.state !== 'lobby';
  if (net.status === 'online') {
    $('lbNote').textContent = r.state === 'ended' ? t('matchDone') : r.kind === 'quick' ? (r.startIn != null ? t('startsIn', { n: r.startIn }) : '') : r.kind === 'ranked' ? t('waitPlayers', { n: r.players.filter(p => p.conn && !p.bot).length, of: r.max }) : host ? (r.players.length < 2 ? t('hostAlone') : t('hostReady')) : t('waitingHost');
  }
  if (menuWorld !== getWorld(r.map) && screen === 'lobby') menuWorld = getWorld(r.map);
  // Only the person setting the room up keeps its map as their own. A squad member taken along
  // used to have their menu — and their saved preference — overwritten by the leader's choice.
  if (host || iLead()) { settings.lastMap = r.map; saveSettings(); }
  syncMenuMap();
}

/* ---------------- match ---------------- */
function enterGame() {
  hud.setTouch(useTouch());
  $('pause').hidden = true; $('settings').hidden = true; input.enabled = true;   // never start a match with the controls switched off
  if (settings.voice && voice && !voice.on) voice.enable().then(() => hud.voice(voiceState()));
  game.startMatch(room);
  if (game.lastObjMsg) game.onObjective({ ...game.lastObjMsg, ev: null });
  hud.setRoom(room, net.myId);
  show('game');
  game.resize();
  if (room.state === 'ended') hud.showEnd(room, net.myId);
}
function onNetEvent(ev) {
  if (ev.t === 'start') { hud.hideEnd(); hud.rankRes = null; hud.reward = null; game.lastObjMsg = null; return; }
  if (ev.t === 'rp') return;                 // ranked result also arrives on the hub (handled once there)
  if (ev.t === 'notReady') { toast(t('waitReady', { names: (ev.names || []).join(', ') }), 3000); return; }
  if (ev.t === 'load') return;               // the loading screen follows the room state
  if (ev.t === 'rtc') { voice.onSignal(ev); return; }                       // voice: two players saying hello
  if (ev.t === 'vc') { vcOn.set(ev.id, { on: ev.on, talk: ev.talk }); hud.voice(voiceState()); return; }
  if (ev.t === 'reward') { hud.showReward(ev); return; }
  if (ev.t === 'obj') game.lastObjMsg = ev;
  if (ev.t === 'obj' || ev.t === 'round') { if (screen === 'game') game.onObjective(ev); return; }
  if (ev.t === 'end') return;              // room info with winner follows
  if (screen === 'game') game.onEvent(ev);
}

function onRankResult(res) {
  if (screen === 'game' && room && room.kind === 'ranked') hud.showRankResult(res);
  else social.showRankDialog(res);
  social.loadMe();
}

/* ---------------- voice chat ---------------- */
let voice = null; const vcOn = new Map();          // playerId → {on, talk} as the server reports it
function voiceState() {
  if (!voice) return null;
  const me = net ? net.myId : 0, out = { on: voice.on, live: !!voice.live, error: voice.error, mode: settings.voiceMode, talk: settings.voiceTalk, hear: settings.voiceHear, players: [] };
  for (const p of (room ? room.players : [])) {
    if (p.bot || p.id === me) continue;
    const st = vcOn.get(p.id) || {};
    out.players.push({ id: p.id, name: p.name, team: p.team, mic: !!(st.on || p.vc), talking: voice.peers.get(p.id)?.talking || (!!st.talk && voice.canHear(p.id)),
      heard: voice.canHear(p.id), muted: voice.muted.has(p.id), linked: voice.isConnected(p.id) });
  }
  return out;
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(250, t - last); last = t;
  if (voice && voice.on) { voice.frame(); }
  if (room && room.state === 'playing' && screen !== 'game' && net && net.status === 'online') enterGame();   // never get stuck outside a running match
  if (screen === 'game' && net) { game.frame(dt); return; }
  if (net) net.update(dt, () => ({ mode: 0, dir: 0, mag: 0, aim: 0, fire: false }), false); // keep pings / clock alive in lobby
  if (!menuWorld || !stage) return;
  if (screen === 'menu' || screen === 'page') {
    // The menu, and the pages that open over it: your tank and your squad's on the ground.
    stage.attach(menuWorld);
    // Opening a tab used to tear the line-up down, and coming back never rebuilt it, because
    // attach() does nothing when the world has not changed. Rebuild whenever it is empty.
    if (!stage.views.size) refreshStage();
    // Hand the camera the strip the UI leaves free, so it frames the tanks into THAT rather
    // than into the whole window — otherwise a squad's outer tanks end up under the panels.
    // while the shot is being worked out, measure the panels afresh — they move on the same
    // frame the squad does, and a shot framed around last frame's layout is framed wrong
    stage.setSafe(stageRects(stage.snapFor > 0 || stage.urgent), innerWidth, innerHeight);
    if (life) { life.attach(menuWorld, settings.quality); life.frame(dt / 1000); }
    if (!_stageAt) _stageAt = new THREE.Vector3();
    const at = stage.frame(dt / 1000, camera);
    menuWorld.follow(_stageAt.set(at.x, 0, at.z));
    placeNamePlates();
  } else {
    // A room lobby gets the slow orbit over whichever map was picked; the line-up is only
    // taken down here, never when you simply open a tab over the menu.
    stage.clear();
    if (life) life.clear();
    if (!_stageAt) _stageAt = new THREE.Vector3();
    menuAngle += dt / 1000 * 0.045;
    camera.position.set(Math.sin(menuAngle) * 62, 40, Math.cos(menuAngle) * 62); camera.lookAt(0, 0, 0);
    menuWorld.follow(_stageAt.set(0, 0, 0));
  }
  renderer.render(menuWorld.scene, camera);
}
// THREE is imported lazily at start-up, so these are made on first use, not at module load.
let _stageAt = null, _plateV = null;

/** Who is standing on the menu stage: you first, then your squad, in join order. */
function stagePlayers() {
  const W = acc && acc.wallet, mine = (W && W.sel) || 'zagros';
  const meId = (acc && acc.id) || 'me';
  const out = [{ id: meId, tank: mine }];
  const party = acc && acc.party;
  if (party && party.members) {
    for (const m of party.members) {
      if (!m || m.id === meId) continue;
      out.push({ id: m.id, tank: (m.tank && m.tank.id) || 'zagros' });
    }
  }
  return out.slice(0, 4);
}
function refreshStage() { if (menuWorld && stage) { stage.attach(menuWorld); stage.setPlayers(stagePlayers()); renderStageNames(); } renderSquadBar(); }

/**
 * The squad panel on the menu: everyone in it, a crown on whoever leads it, and a way out.
 * Tapping a member opens what you can do with them — profile, hand over the squad, remove.
 */
function renderSquadBar() {
  const el = $('squadBar'); if (!el) return;
  const party = acc && acc.party;
  if (!party || !party.members || party.members.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const meId = acc.id, iLead = party.leader === meId;
  const crown = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 5l3 3 3-5 3 5 3-3-1 8H3z"/></svg>';
  el.innerHTML =
    `<div class="sq-head"><span class="lbl">${th(t('sqSquad'))} ${party.members.length}/4</span>` +
    `<button type="button" class="btn sm ghost danger-t" id="sqLeave">${th(t('sqLeave'))}</button></div>` +
    party.members.map((m) => {
      const lead = m.id === party.leader, self = m.id === meId;
      return `<button type="button" class="sq-row${self ? ' me' : ''}" data-id="${m.id}">` +
        `<span class="sq-crown${lead ? ' on' : ''}">${lead ? crown : ''}</span>` +
        `<span class="sq-name">${th(m.name)}${self ? ` <small>${th(t('you'))}</small>` : ''}</span>` +
        `<span class="sq-tank">${m.tank ? th(t('tk_' + m.tank.id)) : ''}</span>` +
        `${!self && iLead ? '<span class="sq-more" aria-hidden="true">⋯</span>' : ''}</button>`;
    }).join('');
  $('sqLeave').onclick = async () => {
    audio.play('click');
    await acc.req({ t: 'partyLeave' });
    toast(t('sqLeftIt'));
  };
  for (const b of el.querySelectorAll('.sq-row')) b.onclick = () => { audio.play('click'); social.memberMenu(+b.dataset.id); };
}

/** The name plate over each tank: who it is and which tank they picked. */
function renderStageNames() {
  const host = $('stageNames'); if (!host || !stage) return;
  const meId = (acc && acc.id) || 'me';
  const party = acc && acc.party;
  const nameOf = (id) => {
    if (id === meId) return (acc && acc.acc && acc.acc.name) || t('you');
    const m = party && party.members && party.members.find((q) => q && q.id === id);
    return (m && m.name) || '…';
  };
  // Built from the tanks that are actually on the stage, never from the player list — a plate
  // was showing for someone whose tank had not been made, leaving a name floating over grass.
  const rows = [...stage.views.entries()].map(([id, e]) => ({ id, slot: e.slot, me: !!e.me, kind: e.kind }));
  host.innerHTML = rows.map((r) =>
    `<div class="splate${r.me ? ' me' : ''}" data-slot="${r.slot}" hidden>` +
    `<b>${th(nameOf(r.id))}</b><i>${th(t('tk_' + r.kind))}</i></div>`).join('');
  // one "+" per empty standing spot, the way a squad line-up shows its open places
  const adds = $('stageAdds'); if (!adds) return;
  const open = stage.openSlots();
  adds.innerHTML = open.map((i) =>
    `<button class="stage-add" type="button" data-slot="${i}" hidden>` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>` +
    `<span>${th(t('sqAdd'))}</span></button>`).join('');
  for (const b of adds.children) b.addEventListener('click', onStageAdd);
  // Measure the plates now so the per-frame placement never has to touch the layout.
  for (const el of host.children) {
    const was = el.hidden; el.hidden = false;
    const r = el.getBoundingClientRect();
    el.dataset.w = Math.max(60, Math.round(r.width));
    el.dataset.h = Math.max(20, Math.round(r.height));
    el.hidden = was;
  }
}
function onStageAdd() {
  audio.unlock(); audio.play('click');
  if (!acc || !acc.has) { toast(t('noAccount')); return; }
  if (acc.reachable === false) { toast(t('offlineNote')); return; }
  social.invite();                       // pick a friend right here, without leaving the menu
}

/** The clear band between the two menu columns. Nothing on the stage may stray under them. */
/* Every panel the menu paints over the 3D scene, as screen rectangles. The stage frames the
   line-up around THESE rather than around one narrow strip, so the tanks can use the width below
   a column that stops halfway down the screen. Re-measured a few times a second: layout only
   moves when the drawer opens, the squad changes or the phone turns. */
const UI_SEL = ['#scr-menu .menu-col', '#homeSide', '.wallet-bar', '#btnMore', '#mnDrawer',
                '#squadBar', '#seasonLine', '#leadNote', '.mn-logo'];
let _rects = null, _rectsAt = -1e9;
function stageRects(force) {
  const now = performance.now();
  if (!force && _rects && now - _rectsAt < 60) return _rects;
  _rectsAt = now;
  const out = [];
  for (const sel of UI_SEL) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.hidden) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
    }
  }
  return (_rects = out);
}

function stageBand() {
  const L = document.querySelector('#scr-menu .menu-col'), R = $('homeSide');
  const lr = L ? L.getBoundingClientRect() : null, rr = R ? R.getBoundingClientRect() : null;
  const side = innerWidth > innerHeight;          // in portrait the columns stack, so no band
  let x0 = 8, x1 = innerWidth - 8;
  if (side && lr && rr) {
    x0 = Math.min(lr.right, rr.right) + 10;
    x1 = Math.max(lr.left, rr.left) - 10;
    if (lr.left < rr.left) { x0 = lr.right + 10; x1 = rr.left - 10; }
    else { x0 = rr.right + 10; x1 = lr.left - 10; }
  }
  return { x0, x1, y0: 8, y1: innerHeight - 8 };
}

/** Keep the plates over their tanks and the "+"s on their spots as the camera drifts. */
function placeNamePlates() {
  const host = $('stageNames'); if (!host || !stage) return;
  if (!_plateV) _plateV = new THREE.Vector3();
  const band = stageBand();
  // How far a thing sitting at this height on screen may reach before it meets a panel. The same
  // answer the stage frames the tanks with, so a plate keeps company with the tank it names: the
  // columns stop partway down, and clamping every plate into the narrow strip between them left
  // the names huddled in the middle while their tanks stood out at the edges.
  const clear = (top, bot) => (stage && stage.safe && stage.safe.rects
    ? stage.clearAt(top, bot) : { x0: band.x0, x1: band.x1 });
  // Nudged into the clear space rather than hidden when it strays under a column: on a phone with
  // big safe-area insets that space is narrow, and hiding meant the + never appeared at all.
  const put = (el, p, pad) => {
    el.hidden = !p.on;
    if (!p.on) return;
    const c = clear(p.y - 34, p.y);
    const lo = c.x0 + pad, hi = c.x1 - pad;
    const x = hi > lo ? Math.max(lo, Math.min(hi, p.x)) : (c.x0 + c.x1) / 2;
    const y = Math.max(band.y0 + pad, Math.min(band.y1 - pad, p.y));
    el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px';
  };
  // Two tanks close together on screen used to stack their plates on top of each other, which on
  // a phone made both unreadable. Pack them into rows: sort left to right, start a new row when
  // the next one will not fit across the clear strip, then sit each row over the tanks it names.
  // Widths are measured once when the line-up changes (renderStageNames), never per frame.
  const PAD = 8;
  const all = [...host.children].map((el) => ({
    el, w: +el.dataset.w || 96, h: +el.dataset.h || 34,
    p: stage.slotScreen(+el.dataset.slot, camera, _plateV, 3.4),
  }));
  for (const q of all) if (!q.p.on) q.el.hidden = true;
  const live = all.filter((q) => q.p.on).sort((x, y) => x.p.x - y.p.x);
  // the room the first row of plates has, at the height the plates actually sit
  const yTop = live.length ? Math.min(...live.map((q) => q.p.y)) : band.y0 + 40;
  const C0 = clear(yTop - 40, yTop);
  const BW = Math.max(120, C0.x1 - C0.x0 - 16);
  for (const q of all) q.w = Math.min(q.w, BW);
  const rows = [];
  for (const q of live) {
    const row = rows[rows.length - 1];
    const used = row ? row.reduce((n, o) => n + o.w, 0) + PAD * row.length : 0;
    if (!row || used + q.w > BW) rows.push([q]); else row.push(q);
  }
  let below = 0;                                   // bottom edge of the last row placed
  rows.forEach((row) => {
    const wide = row.reduce((n, q) => n + q.w, 0) + PAD * (row.length - 1);
    const tall = Math.max(...row.map((q) => q.h));
    // Each plate wants to sit over its own tank, not shoulder to shoulder in the middle of the
    // row: on a wide screen the tanks stand far apart, and packing the names together left them
    // huddled in the centre pointing at nothing.
    for (const q of row) q.cx = q.p.x;
    for (let i = 1; i < row.length; i++)
      row[i].cx = Math.max(row[i].cx, row[i - 1].cx + (row[i - 1].w + row[i].w) / 2 + PAD);
    // A plate hangs above its anchor (translate -100%), so y is its BOTTOM edge: this row must
    // start a full plate height below where the last one ended.
    const want_y = Math.max(row[0].p.y, below ? below + tall + 4 : 0);
    const y = Math.max(band.y0 + tall, Math.min(band.y1 - 6, want_y));
    below = y;
    // and keep the row out of whatever panels reach down to its own height
    const c = clear(y - tall, y);
    const last = row[row.length - 1], first = row[0];
    const over = (last.cx + last.w / 2) - (c.x1 - 8);
    if (over > 0) for (const q of row) q.cx -= over;
    const under = (c.x0 + 8) - (first.cx - first.w / 2);
    if (under > 0) for (const q of row) q.cx += Math.min(under, Math.max(0, c.x1 - 8 - (last.cx + last.w / 2)));
    for (const q of row) {
      q.el.hidden = false;
      q.el.style.left = q.cx.toFixed(1) + 'px';
      q.el.style.top = y.toFixed(1) + 'px';
    }
  });
  const adds = $('stageAdds');
  if (adds) for (const el of adds.children) put(el, stage.slotScreen(+el.dataset.slot, camera, _plateV, 1.4), 32);
}

/* ---------------- settings ---------------- */
function applyAudio() { audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, sfx: settings.sfx / 100, mute: settings.mute }); }
function applyTouchMode() { hud.setTouch(useTouch()); document.body.classList.toggle('aiming', screen === 'game' && !hud.touch); $('touch').hidden = !(screen === 'game' && hud.touch); input.touch = hud.touch ? touch : null; touch.active = hud.touch; }
function syncSettingsUI() {
  for (const seg of document.querySelectorAll('#settings .seg[data-set]')) for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(settings[seg.dataset.set]) === b.dataset.v ? 'true' : 'false');
  for (const t of document.querySelectorAll('#settings .tg[data-set]')) t.setAttribute('aria-pressed', settings[t.dataset.set] ? 'true' : 'false');
  for (const r of document.querySelectorAll('#settings input[data-set]')) { r.value = settings[r.dataset.set]; r.nextElementSibling.textContent = r.value + (['renderScale', 'moveSens', 'aimSens', 'voiceVol'].includes(r.dataset.set) ? '%' : ''); }
  for (const b of document.querySelectorAll('#simPing button')) b.setAttribute('aria-pressed', String(LAT_SIM.oneWay * 2) === b.dataset.v ? 'true' : 'false');
  for (const b of document.querySelectorAll('#simJit button')) b.setAttribute('aria-pressed', String(LAT_SIM.jitter) === b.dataset.v ? 'true' : 'false');
}
function settingChanged(key) {
  saveSettings();
  if (['master', 'music', 'sfx', 'mute'].includes(key)) applyAudio();
  if (key === 'controls') input.mode = settings.controls;
  if (key === 'touch') { applyTouchMode(); hud.layout(); }
  if (key === 'debug') $('debug').hidden = !settings.debug;
  if (key === 'sun') for (const W of Object.values(worlds)) W.setSun(settings.sun);
  if (['quality', 'shadows', 'particles', 'renderScale', 'sun'].includes(key) && game.W) game.applyQuality();
  if (key === 'quality') toast(t('mapDetail'));
  if (key === 'voice' && voice) {
    if (settings.voice) voice.enable().then(okv => { if (!okv) { settings.voice = false; saveSettings(); syncSettingsUI(); if (voice.error) toast(t('vcErr_' + voice.error), 3500); } hud.voice(voiceState()); });
    else { voice.disable(); hud.voice(voiceState()); }
  }
  if (['voiceMode', 'voiceTalk', 'voiceHear', 'voiceVol'].includes(key) && voice) {
    if (key === 'voiceMode' && settings.voiceMode === 'push') voice.setTalking(false);
    voice.applyTalk(); voice.applyHear(); hud.voice(voiceState());
  }
  syncSettingsUI();
}
function openSettings() { syncSettingsUI(); $('settings').hidden = false; }
// Test tool: tap the "Secret button" row in Settings 13 times to reveal the gem button.
// Once found it stays revealed on this device (remembered in localStorage), so you only ever
// tap 13 times once. The gem button itself only works when the server runs with TEST_CHEATS=1
// (the default while building) — on a TEST_CHEATS=0 server it answers "not available".
const SECRET_TAPS = 13, SECRET_GAP = 2500, SECRET_KEY = 'kt-secret-found';
function revealCheat(sound) {
  const b = $('btnCheat'); if (!b) return;
  b.hidden = false; try { localStorage.setItem(SECRET_KEY, '1'); } catch (e) {}
  if (sound) { audio.play('levelup'); toast(t('cheatFound')); }
}
try { if (localStorage.getItem(SECRET_KEY) === '1') revealCheat(false); } catch (e) {}
let brandTaps = 0, brandT = 0;
if ($('stBrand')) $('stBrand').addEventListener('click', () => {
  const el = $('stBrand'), now = Date.now();
  if (now - brandT > SECRET_GAP) brandTaps = 0;       // too slow: start counting again
  brandT = now;
  if (++brandTaps >= SECRET_TAPS) {
    brandTaps = 0; el.classList.remove('hot'); revealCheat(true); return;
  }
  const left = SECRET_TAPS - brandTaps;
  if (left <= 8) { el.classList.add('hot'); toast(t('secretTaps').replace('{n}', left)); }
});
if ($('btnCheat')) $('btnCheat').addEventListener('click', async () => {
  const r = await acc.eco('cheat', {});
  if (r.t === 'err') return toast(r.code === 'not_available' ? t('cheatOff') : t('e_' + r.code));
  audio.play('reward'); toast(t('cheatDone'));
});

/* ---------------- UI wiring ---------------- */
function click(id, fn) { $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('click'); fn(e); }); }
/**
 * Only the squad leader decides what the squad plays. A member pressing one of these used to
 * start a match on their own and leave the rest of the squad standing in the menu.
 * Returns true when you may go ahead.
 */
function mayStart() {
  if (iLead()) return true;
  const p = acc.party, l = p.members.find((m) => m && m.id === p.leader);
  toast(t('sqLeaderOnly', { name: (l && l.name) || '' }));
  audio.play('deny');
  return false;
}
/** Grey out everything a passenger is not allowed to press, and say why. */
function updateLeaderUI() {
  const lead = iLead();
  for (const id of ['btnQuick', 'btnRanked', 'btnCreate', 'btnJoin', 'btnPractice', 'codeInp']) {
    const el = $(id); if (!el) continue;
    el.disabled = !lead;
    el.classList.toggle('not-lead', !lead);
  }
  const note = $('leadNote');
  if (note) {
    const p = acc && acc.party;
    const l = p && p.members && p.members.find((m) => m && m.id === p.leader);
    note.hidden = lead;
    if (!lead) note.textContent = t('sqLeaderOnly', { name: (l && l.name) || '' });
  }
}
click('btnQuick', () => { if (mayStart()) connect('quick', null); });
click('btnDelAcc', async () => {
  if (!acc || !acc.has) { toast(t('noAccount')); return; }
  $('settings').hidden = true;
  if (!(await social.confirm(t('deleteConfirm', { id: acc.idText })))) { $('settings').hidden = false; return; }
  try { await acc.deleteAccount(); toast(t('deletedAcc'), 3000); setTimeout(() => location.reload(), 1500); }
  catch (e) { toast(t('e_server')); }
});
click('btnRanked', () => { if (mayStart()) social.go('ranked'); });
click('btnModes', () => social.go('modes'));
click('btnInvite', () => room && social.inviteFriendsToRoom(room.code));
// Names can change once every 30 days: put the current name back and say when the next change is allowed.
function nameWait(e) { if (acc.acc) { $('nameInp').value = acc.acc.name; settings.name = acc.acc.name; saveSettings(); } toast(t('e_name_wait', { n: e.days || 30 }), 4000); }
click('btnCreate', () => { if (mayStart()) openSetup(false); });
click('btnJoin', () => { if (mayStart()) joinRoom($('codeInp').value); });
click('btnPractice', () => { if (mayStart()) startPractice(); });
$('codeInp').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeInp').value); });
$('codeInp').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
click('btnSettings', openSettings); click('btnSettings2', openSettings); click('btnSettings3', openSettings);
click('btnCloseSettings', () => { $('settings').hidden = true; });
/* ---------------- the corner menu ----------------
   Everything that is not "play now" lives behind one button in the corner, so the middle of the
   screen stays clear. Opening it does not change what is underneath, and picking anything in it
   closes it again. */
function openDrawer(on) {
  const d = $('mnDrawer'), b = $('btnMore');
  if (!d || !b) return;
  d.hidden = !on;
  b.setAttribute('aria-expanded', String(!!on));
  document.body.classList.toggle('drawer-open', !!on);
  if (on) audio.play('whoosh');
}
click('btnMore', () => openDrawer($('mnDrawer').hidden));
click('btnMoreClose', () => openDrawer(false));
// anything pressed inside the drawer takes you somewhere, so shut it behind you
$('mnDrawer').addEventListener('click', (e) => { if (e.target.closest('button') && e.target.id !== 'btnMoreClose') openDrawer(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mnDrawer').hidden) openDrawer(false); });
/** A dot on the corner button when anything tucked inside it is asking to be looked at. */
function refreshMoreDot() {
  const dot = $('moreDot'); if (!dot) return;
  dot.hidden = !$('mnDrawer').querySelector('.ebtn .bdg:not([hidden]), .nav-row .bdg:not([hidden]), #frBadge:not([hidden])');
}
click('btnLeave', toMenu);
click('btnWait', () => { show('menu'); toast(t('sqWaitNote')); });   // menu, but still in the room
click('btnReady', () => { const me = room && room.players.find(p => p.id === net.myId); net.sendJSON({ t: 'ready', v: !(me && me.ready) }); });
click('btnTeam', () => { const me = room && room.players.find(p => p.id === net.myId); if (me) net.sendJSON({ t: 'team', team: me.team === 'blue' ? 'red' : 'blue' }); });
click('btnAddBot', () => net.sendJSON({ t: 'addBot' }));
click('btnDelBot', () => net.sendJSON({ t: 'removeBot' }));
click('btnStart', () => net.sendJSON({ t: 'start' }));
click('btnCopy', async (e) => {
  const link = $('lbLink').textContent;
  try { await navigator.clipboard.writeText(link); toast(t('copied')); }
  catch (err) { const r = document.createRange(); r.selectNodeContents($('lbLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast(t('copyManual')); }
});
for (const b of document.querySelectorAll('#lbMaps .map')) b.addEventListener('click', () => { audio.play('click'); pickSetup('map', b.dataset.map); });
for (const b of document.querySelectorAll('#lbTodSeg button')) b.addEventListener('click', () => { audio.play('click'); pickSetup('tod', b.dataset.v); });
for (const b of document.querySelectorAll('#lbModeSeg button')) b.addEventListener('click', () => { audio.play('click'); pickSetup('mode', b.dataset.mode); });
// BACK leaves the setup step, and nothing else: it is not "leave room" and never "leave squad".
click('btnSuBack', () => { audio.play('click'); show(setup.editing && room ? 'lobby' : 'menu'); });
click('btnSuGo', () => {
  audio.play('click');
  if (setup.editing) { show('lobby'); return; }
  settings.lastMap = setup.map; settings.lastMode = setup.mode; settings.lastTod = setup.tod; saveSettings();
  connect('create', null, { map: setup.map, mode: setup.mode, tod: setup.tod });
});
// pause menu
function togglePause(on) { $('pause').hidden = !on; $('btnEndMatch').hidden = !(room && net && room.host === net.myId); input.enabled = !on; }
click('btnPause', () => togglePause(true));
click('btnResume', () => togglePause(false));
click('btnQuit', async () => { togglePause(false); if (room && room.kind === 'ranked' && room.state === 'playing' && !(await social.confirm(t('rr5') + ' ' + t('leaveMatch') + '?'))) return; toMenu(); });
click('btnEndMatch', () => { net.sendJSON({ t: 'stop' }); togglePause(false); });
click('btnFullscreen', async () => {
  try { if (!document.fullscreenElement) { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); try { await window.screen.orientation.lock('landscape'); } catch (e) {} } else await document.exitFullscreen(); }
  catch (e) { toast(t('noFullscreen')); }
});
$('btnScores').addEventListener('pointerdown', (e) => { e.stopPropagation(); hud.toggleScores($('scoreboard').hidden); });
// settings controls
for (const seg of document.querySelectorAll('#settings .seg[data-set]')) seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; settings[seg.dataset.set] = b.dataset.v; settingChanged(seg.dataset.set); });
for (const t of document.querySelectorAll('#settings .tg[data-set]')) t.addEventListener('click', () => { settings[t.dataset.set] = !settings[t.dataset.set]; settingChanged(t.dataset.set); });
for (const r of document.querySelectorAll('#settings input[data-set]')) r.addEventListener('input', () => { settings[r.dataset.set] = Number(r.value); settingChanged(r.dataset.set); });
// touch layout editor: drag the sticks and FIRE anywhere, resize them, make them faint
function syncTouchEdit() {
  const L = touch.L, sel = touch.sel;
  for (const b of document.querySelectorAll('#teSel button')) b.setAttribute('aria-pressed', b.dataset.v === sel ? 'true' : 'false');
  $('teSize').value = Math.round(L[sel].s * 100); $('teSize').nextElementSibling.textContent = $('teSize').value + '%';
  $('teAlpha').value = Math.round(L.alpha * 100); $('teAlpha').nextElementSibling.textContent = $('teAlpha').value + '%';
  $('teFloat').setAttribute('aria-pressed', L.float ? 'true' : 'false');
}
function touchEdit(on) {
  $('settings').hidden = on; $('tedit').hidden = !on;
  $('touch').hidden = !(on || (screen === 'game' && hud.touch));
  // while editing, show the power and microphone buttons too, so they can be moved
  if (on) { $('abBtn').hidden = false; $('vcBtn').hidden = false; }
  else if (screen !== 'game') { $('abBtn').hidden = true; $('vcBtn').hidden = true; }
  if (on) hud.layout();
  touch.onEdit = syncTouchEdit; touch.setEditing(on); syncTouchEdit();
}
click('wcNext', () => welcomeNext());
click('wcBack', () => { if (wcStep > 0) { wcStep--; audio.play('click'); welcomeShow(); } });
click('wcSkip', () => { wcData.city = ''; welcomeFinish(); });
$('wcYears').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  wcData.birthYear = Number(b.dataset.y); audio.play('click');
  for (const x of $('wcYears').children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
  $('wcErr').hidden = true; });
$('wcCities').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  audio.play('click');
  for (const x of $('wcCities').children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
  const other = b.dataset.c === 'Other';
  $('wcCityOther').hidden = !other; wcData.city = other ? '' : b.dataset.c;
  if (other) setTimeout(() => $('wcCityOther').focus(), 50); });
$('wcName').addEventListener('keydown', (e) => { if (e.key === 'Enter') welcomeNext(); });
click('btnTouchEdit', () => touchEdit(true));
click('teDone', () => touchEdit(false));
click('teReset', () => touch.reset());
click('teFloat', () => { touch.setFloat(!touch.L.float); syncTouchEdit(); });
$('teSel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { audio.play('click'); touch.select(b.dataset.v); } });
$('teSize').addEventListener('input', (e) => { touch.setSize(Number(e.target.value) / 100); syncTouchEdit(); });
$('teAlpha').addEventListener('input', (e) => { touch.setAlpha(Number(e.target.value) / 100); syncTouchEdit(); });
$('simPing').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; LAT_SIM.oneWay = Number(b.dataset.v) / 2; syncSettingsUI(); toast(b.dataset.v === '0' ? 'Network simulation off' : `Simulating ${b.dataset.v} ms ping`); });
$('simJit').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; LAT_SIM.jitter = Number(b.dataset.v); syncSettingsUI(); });
// keyboard shortcuts in game
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (screen !== 'game') return;
  if (e.code === 'Tab') { e.preventDefault(); hud.toggleScores(true); }
  if (e.code === 'F3') { e.preventDefault(); settings.debug = !settings.debug; $('debug').hidden = !settings.debug; saveSettings(); }
  if (e.code === 'Escape') { if (!$('settings').hidden) $('settings').hidden = true; else if (screen === 'game') togglePause($('pause').hidden); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Tab' && screen === 'game') hud.toggleScores(false); });
window.addEventListener('pointerdown', () => audio && audio.unlock(), { once: false, passive: true });
$('debug').hidden = !settings.debug;
// Switch to touch UI automatically the first time someone touches the screen.
window.addEventListener('touchstart', () => { if (settings.touch === 'auto' && hud && !hud.touch) applyTouchMode(); }, { passive: true });

boot();
// Offline support + installable app (needed for the Play Store version). Not in the offline preview.
if ('serviceWorker' in navigator && !window.TRACKFIRE_PRACTICE_ONLY && (location.protocol === 'https:' || location.hostname === 'localhost'))
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
