/* =====================================================================
   SOCIAL HUB — one WebSocket per signed-in player (/hub), open while the
   game is running (menus and matches). It carries:
     · presence (online / in a match) to friends
     · friend requests, blocks, private chat, room invites, reports
     · squads (party) and the ranked queue (one size, random mode and map)
     · "match found" → everyone presses ACCEPT → ranked room is created
   ===================================================================== */
import { GAME } from '../client/shared/config.js';

const R = GAME.RANKED;
const QUICK_MSGS = 200;               // max chat length

export class Social {
  /** opts: { store, log, createRanked({map, reserved, fillBots, unrated}) → code, botsAfterS } */
  constructor(opts) {
    this.store = opts.store; this.log = opts.log || (() => {});
    this.createRanked = opts.createRanked; this.botsAfterS = opts.botsAfterS ?? 60; this.eco = opts.economy || null;
    this.conns = new Map();             // accountId → Set(ws)
    this.status = new Map();            // accountId → { s: 'menu'|'match'|'queue', mode, map, kind }
    this.parties = new Map();           // leaderId → { leader, members: [ids], invites: Set }
    this.partyOf = new Map();           // accountId → leaderId
    this.queue = new Map();             // leaderId → { leader, members, size, rp, since }
    this.pending = new Map();           // matchId → pending match
    this.inQueueOrMatch = new Map();    // accountId → matchId (while a "found" is open)
    this.matchSeq = 1;
    this.timer = setInterval(() => { try { this.tickQueue(); } catch (e) { this.log('queue error', e); } }, 1000);
  }
  stop() { clearInterval(this.timer); }
  /** Account deleted: leave squad/queue and close its live connections. */
  dropAccount(id) { this.leaveParty(id, true); const set = this.conns.get(id); if (set) for (const ws of [...set]) try { ws.close(); } catch (e) {} }
  online(id) { return this.conns.has(id); }
  onlineCount() { return this.conns.size; }

  /* ---------------- connections ---------------- */
  attach(ws) {
    let me = 0, lastMsg = 0, burst = 0;
    const authTimer = setTimeout(() => { if (!me) ws.close(1008); }, 10000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (!me) {
        if (m.t !== 'auth') return;
        const a = this.store.auth(m.id, m.secret);
        if (!a || a.banned) { ws.send(JSON.stringify({ t: 'authFail' })); ws.close(1008); return; }
        me = a.id; clearTimeout(authTimer);
        if (!this.conns.has(me)) this.conns.set(me, new Set());
        const first = this.conns.get(me).size === 0;
        this.conns.get(me).add(ws);
        if (!this.status.has(me)) this.status.set(me, { s: 'menu' });
        this.sendTo(ws, { t: 'hello', me: this.store.card(a), ...this.friendsPayload(me), party: this.partyPayload(me), queue: this.queuePayload(me), wallet: this.eco ? this.eco.state(me) : null });
        if (first) this.presence(me);
        return;
      }
      // simple flood guard: 12 messages per 2 seconds
      const now = Date.now(); if (now - lastMsg > 2000) { burst = 0; lastMsg = now; } if (++burst > 12) return;
      try { this.handle(me, ws, m); } catch (e) { this.log('hub error', e); this.sendTo(ws, { t: 'err', rid: m.rid, code: 'server' }); }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!me) return;
      const set = this.conns.get(me); if (set) { set.delete(ws); if (!set.size) { this.conns.delete(me); this.gone(me); } }
    });
  }
  gone(me) {
    this.leaveParty(me, true);
    this.status.delete(me);
    this.presence(me);
  }
  sendTo(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  push(id, obj) { const s = this.conns.get(id); if (!s) return false; const d = JSON.stringify(obj); for (const ws of s) try { ws.send(d); } catch (e) {} return true; }
  ok(ws, rid, extra = {}) { this.sendTo(ws, { t: 'ok', rid, ...extra }); }
  err(ws, rid, code) { this.sendTo(ws, { t: 'err', rid, code }); }

  /* ---------------- presence ---------------- */
  statusOf(id) { if (!this.online(id)) return { s: 'offline' }; return this.status.get(id) || { s: 'menu' }; }
  setStatus(id, st) { if (!id) return; this.status.set(id, st); this.presence(id); }
  presence(id) {
    const st = this.statusOf(id);
    for (const f of this.store.friendIds(id)) this.push(f, { t: 'presence', id, st });
  }
  friendsPayload(me) {
    const L = this.store.friendList(me);
    const add = (c) => ({ ...c, st: this.statusOf(c.id), lastSeen: this.store.get(c.id)?.last_seen || 0 });
    return { friends: L.friends.map(add), incoming: L.incoming, outgoing: L.outgoing, blocked: L.blocked };
  }

  /* ---------------- messages from a player ---------------- */
  handle(me, ws, m) {
    const S = this.store, rid = m.rid, other = Number(m.id) || 0;
    switch (m.t) {
      case 'friends': this.sendTo(ws, { t: 'friends', rid, ...this.friendsPayload(me) }); break;
      case 'friendReq': {
        const r = S.friendRequest(me, m.to);
        if (r.error) return this.err(ws, rid, r.error);
        this.ok(ws, rid, { auto: !!r.auto });
        this.push(r.id, r.auto ? { t: 'friendAdded', card: S.card(S.get(me)) } : { t: 'friendReq', from: S.card(S.get(me)) });
        this.refreshFriends(me); this.refreshFriends(r.id);
        break;
      }
      case 'friendAccept': {
        const r = S.friendAccept(me, other); if (r.error) return this.err(ws, rid, r.error);
        this.ok(ws, rid); this.push(other, { t: 'friendAdded', card: S.card(S.get(me)) });
        this.refreshFriends(me); this.refreshFriends(other); break;
      }
      case 'friendRemove': S.friendRemove(me, other); this.ok(ws, rid); this.refreshFriends(me); this.refreshFriends(other); break;
      case 'block': S.block(me, other); this.ok(ws, rid); this.refreshFriends(me); this.refreshFriends(other); if (this.partyOf.get(other) === this.partyOf.get(me)) this.leaveParty(other); break;
      case 'unblock': S.unblock(me, other); this.ok(ws, rid); this.refreshFriends(me); break;
      case 'history': this.sendTo(ws, { t: 'history', rid, with: other, msgs: S.history(me, other) }); break;
      case 'chat': case 'invite': {
        const to = Number(m.to) || 0;
        const text = m.t === 'invite' ? String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) : String(m.text || '').slice(0, QUICK_MSGS);
        const r = S.sendMessage(me, to, text, m.t === 'invite' ? 'invite' : 'text');
        if (r.error) return this.err(ws, rid, r.error);
        const msg = { t: 'msg', m: { ...r, fromCard: { id: me, name: S.get(me).name } } };
        this.push(me, msg); this.push(to, msg); this.ok(ws, rid);
        break;
      }
      case 'report': {
        const ctx = S.history(me, other, 20).map(x => ({ from: x.from, text: x.text, ts: x.ts }));
        S.report(me, other, m.reason, ctx); this.ok(ws, rid);
        if (m.block) { S.block(me, other); this.refreshFriends(me); this.refreshFriends(other); }
        break;
      }
      case 'status': break;   // presence is set by the game server itself
      case 'eco': this.ecoOp(me, ws, m); break;
      case 'profile': {
        const prof = S.profile(other || me, me);
        if (prof && this.eco) { try { prof.garage = this.eco.publicGarage(other || me); } catch (e) {} }
        this.sendTo(ws, { t: 'profile', rid, p: prof }); break;
      }
      // ---- squads
      case 'partyInvite': this.partyInvite(me, ws, rid, Number(m.to) || 0); break;
      case 'partyAccept': this.partyAccept(me, ws, rid, Number(m.leader) || 0); break;
      case 'partyDecline': { const p = this.parties.get(Number(m.leader)); if (p) { p.invites.delete(me); this.push(p.leader, { t: 'partyDeclined', id: me }); } this.ok(ws, rid); break; }
      case 'partyLeave': this.leaveParty(me); this.ok(ws, rid); break;
      // The leader's menu map, so the whole squad's menu shows the same place. Only he sets it.
      case 'partyMap': {
        const l = this.partyOf.get(me);
        if (l === me) { const p = this.parties.get(l); if (p && typeof m.map === 'string' && m.map.length < 20) { p.map = m.map; this.sendParty(p); } }
        this.ok(ws, rid); break;
      }
      // a member asked for a friend to be brought in; the leader says yes or no
      case 'partyApprove': this.partyAskAnswer(me, ws, rid, Number(m.to) || 0, true); break;
      case 'partyReject':  this.partyAskAnswer(me, ws, rid, Number(m.to) || 0, false); break;
      case 'partyPromote': { this.promote(me, other); this.ok(ws, rid); break; }
      case 'partyKick': { const l = this.partyOf.get(me); if (l === me && this.partyOf.get(other) === me && other !== me) this.leaveParty(other); this.ok(ws, rid); break; }
      // ---- ranked queue
      case 'queue': this.enqueue(me, ws, rid); break;
      case 'unqueue': this.dequeue(this.partyOf.get(me) || me, 'cancel'); this.ok(ws, rid); break;
      case 'accept': this.acceptMatch(me, Number(m.match), true); break;
      case 'decline': this.acceptMatch(me, Number(m.match), false); break;
    }
  }
  refreshFriends(id) { this.push(id, { t: 'friends', ...this.friendsPayload(id) }); }

  /* ---------------- coins, gems, garage, chests, quests, shop ---------------- */
  async ecoOp(me, ws, m) {
    const E = this.eco; if (!E) return this.err(ws, m.rid, 'server');
    const ops = {
      state: () => ({ ok: true }),
      daily: () => E.claimDaily(me),
      spin: () => E.spin(me, !!m.paid),
      buyChest: () => E.buyChest(me, m.type, m.cur),
      open: () => E.openOwned(me, m.type),
      upgrade: () => E.upgrade(me, m.tank, m.stat),
      parts: () => E.buyParts(me, m.pack),
      select: () => E.select(me, m.tank),
      pack: () => E.buyPack(me, m.tank),
      coins: () => E.buyCoins(me, m.pack),
      quest: () => E.claimQuest(me, m.id),
      questBonus: () => E.claimQuestBonus(me),
      tankQuest: () => E.claimTankQuest(me, m.tank),
      purchase: () => E.purchase(me, { provider: m.provider, product: m.product, token: m.token }),
      cheat: () => E.cheat(me),                     // testing only, off when TEST_CHEATS=0
      ach: () => E.claimAch(me, m.id),              // claim a finished achievement
    };
    if (!ops[m.op]) return this.err(ws, m.rid, 'bad');
    const res = await ops[m.op]();
    if (res && res.error) return this.err(ws, m.rid, res.error);
    const state = E.state(me);
    this.sendTo(ws, { t: 'ok', rid: m.rid, res, state });
    this.push(me, { t: 'wallet', state });
    if (m.op === 'select' || m.op === 'upgrade') { const l = this.partyOf.get(me); if (l) this.sendParty(this.parties.get(l)); }
  }

  /* ---------------- squads ---------------- */
  partyPayload(me) {
    const l = this.partyOf.get(me); const p = l && this.parties.get(l);
    if (!p) return null;
    return { leader: p.leader, map: p.map || null,
      members: p.members.map(id => ({ ...this.store.card(this.store.get(id)), online: this.online(id), tank: this.eco ? this.eco.loadout(id) : null })) };
  }
  sendParty(p) { for (const id of p.members) this.push(id, { t: 'party', party: this.partyPayload(id) }); }
  /**
   * Anyone in the squad may put a friend forward, but only the leader may actually bring one in.
   * A member's request goes to the leader to approve; the leader's own goes straight out. The
   * friend still has to accept for themselves either way — approving a request only sends it.
   */
  partyInvite(me, ws, rid, to) {
    if (!this.store.areFriends(me, to)) return this.err(ws, rid, 'not_friends');
    if (!this.online(to)) return this.err(ws, rid, 'offline');
    if (this.queue.has(this.partyOf.get(me) || me)) return this.err(ws, rid, 'in_queue');
    let l = this.partyOf.get(me);
    if (!l) { l = me; this.parties.set(me, { leader: me, members: [me], invites: new Set(), asks: new Map() }); this.partyOf.set(me, me); }
    const p = this.parties.get(l);
    if (!p) return this.err(ws, rid, 'no_party');
    if (p.members.length >= R.SIZE) return this.err(ws, rid, 'party_full');
    if (p.members.includes(to)) return this.err(ws, rid, 'already');
    if (!p.asks) p.asks = new Map();
    if (l !== me) {                                   // a member: the leader decides
      if (!this.online(l)) return this.err(ws, rid, 'offline');
      if (p.invites.has(to) || p.asks.has(to)) return this.err(ws, rid, 'already_asked');
      p.asks.set(to, me);
      this.push(l, { t: 'partyAsk', by: this.store.card(this.store.get(me)), who: this.store.card(this.store.get(to)) });
      return this.ok(ws, rid);
    }
    this.sendInvite(p, to);
    this.ok(ws, rid); this.sendParty(p);
  }
  /** Actually put the invitation in front of the friend. */
  sendInvite(p, to) {
    p.invites.add(to);
    if (p.asks) p.asks.delete(to);
    this.push(to, { t: 'partyInvite', from: this.store.card(this.store.get(p.leader)) });
  }
  /** The leader's verdict on a member's request. `yes` sends the real invitation. */
  partyAskAnswer(me, ws, rid, to, yes) {
    const l = this.partyOf.get(me);
    if (l !== me) return this.err(ws, rid, 'not_leader');
    const p = this.parties.get(l);
    if (!p || !p.asks || !p.asks.has(to)) return this.err(ws, rid, 'no_request');
    const by = p.asks.get(to);
    p.asks.delete(to);
    if (!yes) { this.push(by, { t: 'partyAskNo', who: this.store.card(this.store.get(to)) }); return this.ok(ws, rid); }
    if (p.members.length >= R.SIZE) return this.err(ws, rid, 'party_full');
    if (p.members.includes(to)) return this.err(ws, rid, 'already');
    if (!this.online(to)) return this.err(ws, rid, 'offline');
    if (this.queue.has(l)) return this.err(ws, rid, 'in_queue');
    this.sendInvite(p, to);
    this.push(by, { t: 'partyAskOk', who: this.store.card(this.store.get(to)) });
    this.ok(ws, rid); this.sendParty(p);
  }
  /** Forget every request a member had outstanding — they have left, or the squad has changed. */
  dropAsksBy(p, who) {
    if (!p || !p.asks) return;
    for (const [to, by] of [...p.asks]) if (by === who) p.asks.delete(to);
  }
  partyAccept(me, ws, rid, leader) {
    const p = this.parties.get(leader);
    if (!p || !p.invites.has(me)) return this.err(ws, rid, 'no_invite');
    if (p.members.length >= R.SIZE) return this.err(ws, rid, 'party_full');
    if (this.queue.has(leader)) return this.err(ws, rid, 'in_queue');
    this.leaveParty(me);
    p.invites.delete(me); if (p.asks) p.asks.delete(me);
    p.members.push(me); this.partyOf.set(me, leader);
    this.ok(ws, rid); this.sendParty(p);
  }
  /**
   * The leader has gone into a room, so the rest of the squad goes with them — no invite to
   * accept, they are simply taken along. Called by the game server the moment the leader's
   * room is known. Ranked is not routed through here: matchmaking already keeps squads together.
   * → how many members were told
   */
  pullParty(leaderId, code) {
    const l = this.partyOf.get(leaderId);
    if (!l || l !== leaderId) return 0;                 // only the leader takes people with them
    const p = this.parties.get(l);
    if (!p || !code) return 0;
    let n = 0;
    for (const id of p.members) {
      if (id === leaderId) continue;
      if (this.push(id, { t: 'pull', code, by: leaderId })) n++;
    }
    return n;
  }
  /**
   * Hand the squad over to another member. The party is keyed by its leader, so it moves to a
   * new key and everyone's pointer moves with it. Only the current leader may do this.
   */
  promote(me, to) {
    if (!to || to === me) return false;
    const l = this.partyOf.get(me);
    if (l !== me) return false;                       // only the leader hands it over
    const p = this.parties.get(me);
    if (!p || !p.members.includes(to)) return false;
    this.dequeue(me, 'party_changed');                // a queue belongs to whoever was leading
    this.parties.delete(me);
    if (p.asks) p.asks.clear();                       // requests were for the old leader to judge
    p.leader = to;
    this.parties.set(to, p);
    for (const id of p.members) this.partyOf.set(id, to);
    this.sendParty(p);
    return true;
  }
  leaveParty(me, offline = false) {
    const l = this.partyOf.get(me);
    if (!l) { this.dequeue(me, offline ? 'offline' : 'cancel'); return; }
    const p = this.parties.get(l);
    this.dequeue(l, 'party_changed');
    this.partyOf.delete(me);
    if (!p) return;
    p.members = p.members.filter(x => x !== me);
    this.dropAsksBy(p, me);
    this.push(me, { t: 'party', party: null });
    if (p.members.length <= 1 || me === l) {             // leader left or nobody left: disband
      for (const id of p.members) { this.partyOf.delete(id); this.push(id, { t: 'party', party: null }); }
      this.parties.delete(l);
    } else this.sendParty(p);
  }

  /* ---------------- ranked queue ---------------- */
  queuePayload(me) {
    const l = this.partyOf.get(me) || me; const q = this.queue.get(l);
    return q ? { state: 'searching', size: q.size, since: q.since } : { state: 'idle' };
  }
  enqueue(me, ws, rid) {
    const size = R.SIZE;
    const l = this.partyOf.get(me) || me;
    if (l !== me) return this.err(ws, rid, 'not_leader');
    const members = this.partyOf.get(me) ? this.parties.get(l).members.slice() : [me];
    if (members.length > size) return this.err(ws, rid, 'party_too_big');
    if (members.some(id => !this.online(id))) return this.err(ws, rid, 'member_offline');
    { const p = this.parties.get(l); if (p && p.asks) p.asks.clear(); }   // no new faces once we are queueing
    if (members.some(id => this.statusOf(id).s === 'match')) return this.err(ws, rid, 'in_match');
    if (members.some(id => this.inQueueOrMatch.has(id))) return this.err(ws, rid, 'in_queue');
    const rps = members.map(id => this.store.get(id)?.rp ?? R.START_RP);
    const pw = members.map(id => this.eco ? this.eco.power(id) : 1);     // tank level of each member's selected tank
    this.queue.set(l, { leader: l, members, size, rp: rps.reduce((a, b) => a + b, 0) / rps.length, power: pw.reduce((a, b) => a + b, 0) / pw.length, since: Date.now() });
    this.ok(ws, rid);
    for (const id of members) { this.push(id, { t: 'queue', ...this.queuePayload(id) }); this.setStatus(id, { s: 'queue', size }); }
  }
  dequeue(leader, reason) {
    const q = this.queue.get(leader); if (!q) return;
    this.queue.delete(leader);
    for (const id of q.members) { this.push(id, { t: 'queue', state: 'idle', reason }); if (this.online(id) && this.statusOf(id).s === 'queue') this.setStatus(id, { s: 'menu' }); }
  }
  tickQueue() {
    const now = Date.now();
    for (const [mid, pm] of this.pending) if (now > pm.deadline) this.cancelFound(mid, 'timeout');
    {
      const size = R.SIZE;
      const entries = [...this.queue.values()].filter(q => !q.members.some(id => this.inQueueOrMatch.has(id))).sort((a, b) => a.since - b.since);
      const used = new Set();
      for (const anchor of entries) {
        if (used.has(anchor.leader)) continue;
        const wait = (now - anchor.since) / 1000, win = Math.min(1500, 150 + 20 * wait), pwin = Math.min(9, 1 + wait / 15);
        // Matched by rank AND tank power (upgrade level): both windows widen the longer you wait.
        const cands = entries.filter(e => !used.has(e.leader) && Math.abs(e.rp - anchor.rp) <= win && Math.abs((e.power || 1) - (anchor.power || 1)) <= pwin).sort((a, b) => (a === anchor ? -1 : b === anchor ? 1 : Math.abs(a.rp - anchor.rp) - Math.abs(b.rp - anchor.rp)));
        const pick = []; let n = 0;
        for (const e of cands) if (n + e.members.length <= size * 2) { pick.push(e); n += e.members.length; if (n === size * 2) break; }
        let teams = n === size * 2 ? this.split(pick, size) : null;
        // Not enough players yet: after a while, fill the empty seats with bots (unrated match, no RP change).
        let unrated = false;
        if (!teams && this.botsAfterS > 0 && wait >= this.botsAfterS) { teams = this.split(pick, size, true); unrated = !!teams; }
        if (!teams) continue;
        for (const e of pick) used.add(e.leader);
        this.found(size, pick, teams, unrated);
      }
    }
  }
  // Put whole parties on two teams of `size`, as close in average RP as possible.
  split(entries, size, partial = false) {
    const k = entries.length; let best = null, bd = 1e9;
    for (let mask = 0; mask < (1 << k); mask++) {
      const A = [], B = []; for (let i = 0; i < k; i++) (mask >> i & 1 ? A : B).push(entries[i]);
      const na = A.reduce((s, e) => s + e.members.length, 0), nb = B.reduce((s, e) => s + e.members.length, 0);
      if (partial ? (na > size || nb > size || !na) : (na !== size || nb !== size)) continue;
      const avg = (T, k = 'rp') => T.length ? T.reduce((s, e) => s + (e[k] || 1) * e.members.length, 0) / Math.max(1, T.reduce((s, e) => s + e.members.length, 0)) : 0;
      const d = Math.abs(avg(A) - avg(B)) + Math.abs(avg(A, 'power') - avg(B, 'power')) * 60 + (partial ? Math.abs(na - nb) * 1000 : 0);
      if (d < bd) { bd = d; best = { blue: A.flatMap(e => e.members), red: B.flatMap(e => e.members) }; }
    }
    return best;
  }
  found(size, entries, teams, unrated) {
    const id = this.matchSeq++;
    const all = [...teams.blue, ...teams.red];
    const map = R.MAPS[Math.floor(Math.random() * R.MAPS.length)], mode = R.MODES[Math.floor(Math.random() * R.MODES.length)];
    const pm = { id, size, map, mode, teams, entries, unrated, accepted: new Set(), deadline: Date.now() + R.ACCEPT_S * 1000 };
    this.pending.set(id, pm);
    for (const a of all) this.inQueueOrMatch.set(a, id);
    const cards = (ids) => ids.map(x => this.store.card(this.store.get(x)));
    const msg = { t: 'found', match: id, size, map, mode, unrated, teams: { blue: cards(teams.blue), red: cards(teams.red) }, acceptS: R.ACCEPT_S };
    for (const a of all) this.push(a, msg);
    this.log(`ranked ${size}v${size} ${mode} on ${map} found #${id} (${all.length} players${unrated ? ', bots fill, unrated' : ''})`);
  }
  acceptMatch(me, mid, yes) {
    const pm = this.pending.get(mid); if (!pm || this.inQueueOrMatch.get(me) !== mid) return;
    if (!yes) { pm.declined = me; return this.cancelFound(mid, 'declined'); }
    pm.accepted.add(me);
    const all = [...pm.teams.blue, ...pm.teams.red];
    for (const a of all) this.push(a, { t: 'foundUpdate', match: mid, accepted: [...pm.accepted] });
    if (pm.accepted.size < all.length) return;
    // Everyone accepted → create the room and send everyone there.
    this.pending.delete(mid);
    for (const a of all) this.inQueueOrMatch.delete(a);
    for (const e of pm.entries) this.queue.delete(e.leader);
    for (const a of all) this.push(a, { t: 'queue', state: 'idle', reason: 'matched' });
    const reserved = new Map(); for (const t of ['blue', 'red']) for (const a of pm.teams[t]) reserved.set(a, t);
    const code = this.createRanked({ map: pm.map, mode: pm.mode, size: pm.size, reserved, fillBots: pm.unrated, unrated: pm.unrated });
    for (const a of all) this.push(a, { t: 'go', match: mid, code, map: pm.map, size: pm.size, unrated: pm.unrated });
  }
  cancelFound(mid, reason) {
    const pm = this.pending.get(mid); if (!pm) return;
    this.pending.delete(mid);
    const all = [...pm.teams.blue, ...pm.teams.red];
    for (const a of all) this.inQueueOrMatch.delete(a);
    // Whoever declined or didn't accept (and their squad) leaves the queue; everyone else keeps their place.
    for (const e of pm.entries) {
      const bad = e.members.some(a => a === pm.declined || (reason === 'timeout' && !pm.accepted.has(a)));
      if (bad) this.dequeue(e.leader, reason);
    }
    for (const a of all) this.push(a, { t: 'foundCancel', match: mid, reason, requeued: this.queue.has(this.partyOf.get(a) || a) });
  }
}
