/* =====================================================================
   Account + social hub connection (client side, no DOM).
   The account ({id, secret, name, tag}) is created the first time the
   player types a name and is kept in this browser (localStorage). The
   public ID others see is Name#1234.
   ===================================================================== */
const KEY = 'kt-account';

export class Account {
  /** base: 'https://host' of the game server (API), hubUrl: 'wss://host/hub' */
  constructor(base, hubUrl) {
    this.base = base; this.hubUrl = hubUrl;
    this.acc = null; try { this.acc = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    this.listeners = new Map(); this.ws = null; this.rid = 1; this.waits = new Map();
    this.online = false; this.reachable = null; this.tries = 0;
    this.me = null; this.friends = []; this.incoming = []; this.outgoing = []; this.blocked = [];
    this.party = null; this.queue = { state: 'idle' }; this.unread = new Map();   // friendId → count
    this.chats = new Map();              // friendId → [messages]
    this.info = null; this.wallet = null;
  }
  get id() { return this.acc ? this.acc.id : 0; }
  get has() { return !!this.acc; }
  get idText() { return this.acc ? `${this.acc.name}#${this.acc.tag}` : ''; }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.acc)); } catch (e) {} }
  auth() { return this.acc ? { id: this.acc.id, secret: this.acc.secret } : null; }

  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); return () => this.listeners.get(ev).delete(fn); }
  emit(ev, data) { for (const fn of this.listeners.get(ev) || []) try { fn(data); } catch (e) { console.error(e); } }

  /* ---------------- HTTP API ---------------- */
  async api(path, body) {
    const h = { 'Content-Type': 'application/json' };
    if (this.acc) h.Authorization = `Bearer ${this.acc.id}.${this.acc.secret}`;
    const r = await fetch(this.base + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path === '/api/me') { this.acc = null; this.save(); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'server'), { code: j.error || 'server', days: j.days });
    return j;
  }
  async ping() {
    try { this.info = await this.api('/api/info'); this.reachable = true; } catch (e) { this.reachable = false; }
    this.emit('info', this.info); return this.reachable;
  }
  /** Create the account (first time) or rename it. Returns {name, tag}. */
  async ensure(name, extra = {}) {
    if (!this.acc) {
      // extra: { birthYear, city } from the first-run screen. The server keeps only the
      // age GROUP the year falls in, never the year itself.
      const r = await this.api('/api/register', { name, birthYear: extra.birthYear || 0, city: extra.city || '' });
      this.acc = { id: r.id, secret: r.secret, name: r.name, tag: r.tag }; this.save();
      this.ageGroup = r.ageGroup || ''; this.city = r.city || '';
      this.connect(); this.emit('account', this.acc);
      return this.acc;
    }
    if (name && name !== this.acc.name) {
      const r = await this.api('/api/rename', { name });
      this.acc.name = r.name; this.acc.tag = r.tag; this.save(); this.emit('account', this.acc);
      if (this.me) { this.me.name = r.name; this.me.tag = r.tag; }
    }
    return this.acc;
  }
  /** Permanently deletes the account on the server and forgets it on this device. */
  async deleteAccount() {
    await this.api('/api/delete-account', {});
    this.acc = null; try { localStorage.removeItem(KEY); } catch (e) {}
    try { this.ws && this.ws.close(); } catch (e) {}
    this.wallet = null; this.me = null; this.friends = []; this.emit('account', null);
  }
  profile(id) { return this.api('/api/profile?id=' + encodeURIComponent(id)); }
  setCity(city) { return this.api('/api/profile-set', { city }); }
  leaderboard(board, period, scope) { return this.api(`/api/leaderboard?board=${board}&period=${period}&scope=${scope}`); }

  /* ---------------- hub (live) ---------------- */
  connect() {
    if (!this.acc || (this.ws && this.ws.readyState <= 1)) return;
    let ws; try { ws = new WebSocket(this.hubUrl); } catch (e) { return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', id: this.acc.id, secret: this.acc.secret }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.onMsg(m); };
    ws.onclose = () => {
      const was = this.online; this.online = false; this.ws = null;
      if (was) this.emit('status', false);
      if (!this.acc) return;
      this.tries++; setTimeout(() => this.connect(), Math.min(15000, 1000 * this.tries));
    };
  }
  req(o) {
    return new Promise((res) => {
      if (!this.ws || this.ws.readyState !== 1 || !this.online) return res({ t: 'err', code: 'offline_srv' });
      const rid = this.rid++; this.waits.set(rid, res); this.ws.send(JSON.stringify({ ...o, rid }));
      setTimeout(() => { if (this.waits.has(rid)) { this.waits.delete(rid); res({ t: 'err', code: 'server' }); } }, 8000);
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  setFriends(m) { this.friends = m.friends || []; this.incoming = m.incoming || []; this.outgoing = m.outgoing || []; this.blocked = m.blocked || []; this.emit('friends'); }
  friend(id) { return this.friends.find(f => f.id === id); }
  onMsg(m) {
    if (m.rid && this.waits.has(m.rid)) { this.waits.get(m.rid)(m); this.waits.delete(m.rid); }
    switch (m.t) {
      case 'authFail': this.acc = null; this.save(); this.emit('account', null); break;
      case 'hello':
        this.online = true; this.tries = 0; this.me = m.me;
        if (m.me) { this.acc.name = m.me.name; this.acc.tag = m.me.tag; this.save(); }
        this.setFriends(m); this.party = m.party; this.queue = m.queue || { state: 'idle' };
        if (m.wallet) { this.wallet = m.wallet; this.emit('wallet', this.wallet); }
        this.emit('status', true); this.emit('me', this.me); this.emit('party', this.party); this.emit('queue', this.queue);
        break;
      case 'friends': this.setFriends(m); break;
      case 'presence': { const f = this.friend(m.id); if (f) { f.st = m.st; this.emit('friends'); } break; }
      case 'friendReq': this.incoming = [m.from, ...this.incoming.filter(x => x.id !== m.from.id)]; this.emit('friends'); this.emit('notify', { kind: 'friendReq', card: m.from }); break;
      case 'friendAdded': this.emit('notify', { kind: 'friendAdded', card: m.card }); break;
      case 'msg': {
        const x = m.m, other = x.from === this.id ? x.to : x.from;
        const list = this.chats.get(other) || []; if (!list.some(y => y.id === x.id)) list.push(x); this.chats.set(other, list.slice(-200));
        if (x.from !== this.id) { this.unread.set(other, (this.unread.get(other) || 0) + 1); this.emit('notify', { kind: x.kind === 'invite' ? 'roomInvite' : 'msg', msg: x, name: x.fromCard?.name }); }
        this.emit('chat', other);
        break;
      }
      case 'party': this.party = m.party; this.emit('party', this.party); break;
      case 'pull': this.emit('pull', m); break;          // the squad leader went into a room

      case 'partyInvite': this.emit('notify', { kind: 'partyInvite', card: m.from }); break;
      // a squad-mate would like a friend of theirs brought in — the leader decides
      case 'partyAsk': this.emit('notify', { kind: 'partyAsk', card: m.by, who: m.who }); break;
      case 'partyAskOk': this.emit('notify', { kind: 'partyAskOk', card: m.who }); break;
      case 'partyAskNo': this.emit('notify', { kind: 'partyAskNo', card: m.who }); break;
      case 'partyDeclined': this.emit('partyDeclined', m.id); break;
      case 'queue': this.queue = m; this.emit('queue', m); break;
      case 'found': this.emit('found', m); break;
      case 'foundUpdate': this.emit('foundUpdate', m); break;
      case 'foundCancel': this.emit('foundCancel', m); break;
      case 'go': this.queue = { state: 'idle' }; this.emit('queue', this.queue); this.emit('go', m); break;
      case 'rp': this.emit('rp', m); break;
      case 'wallet': this.wallet = m.state; this.emit('wallet', this.wallet); break;
    }
  }
  /** Economy action (daily, spin, buyChest, open, upgrade, select, pack, coins, quest, questBonus, tankQuest, purchase). */
  async eco(op, args = {}) {
    const r = await this.req({ t: 'eco', op, ...args });
    if (r.state) { this.wallet = r.state; this.emit('wallet', this.wallet); }
    return r;
  }
  async history(id) { const r = await this.req({ t: 'history', id }); if (r.msgs) { this.chats.set(id, r.msgs); } this.unread.delete(id); return this.chats.get(id) || []; }
  unreadTotal() { let n = 0; for (const v of this.unread.values()) n += v; return n + this.incoming.length; }
}
