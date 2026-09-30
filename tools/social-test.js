/* End-to-end test of accounts, friends, chat, squads, ranked matchmaking,
   ranked results and quick match, against a real server + throwaway database.
     node tools/social-test.js */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { GAME } from '../client/shared/config.js';

const PORT = 9300 + Math.floor(Math.random() * 400), BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA, RANKED_BOTS_AFTER_S: '0', REG_LIMIT: '100' }, stdio: ['ignore', 'pipe', 'inherit'] });
srv.stdout.on('data', (d) => { if (process.env.V) process.stdout.write(d); });
await sleep(900);
const api = async (p, body, a) => { const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(a ? { Authorization: `Bearer ${a.id}.${a.secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
function hub(a) {
  const ws = new WebSocket(WS + '/hub'); const inbox = []; let rid = 1; const waits = new Map();
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', id: a.id, secret: a.secret }));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); inbox.push(m); if (m.rid && waits.has(m.rid)) { waits.get(m.rid)(m); waits.delete(m.rid); } };
  const h = { ws, inbox, a,
    req: (o) => new Promise(res => { const r = rid++; waits.set(r, res); ws.send(JSON.stringify({ ...o, rid: r })); }),
    send: (o) => ws.send(JSON.stringify(o)),
    wait: async (pred, ms = 5000) => { const t0 = Date.now(); for (;;) { const m = inbox.find(pred); if (m) { inbox.splice(inbox.indexOf(m), 1); return m; } if (Date.now() - t0 > ms) return null; await sleep(25); } } };
  return h;
}
function game(a, action, code) {
  const ws = new WebSocket(WS + '/ws'); ws.binaryType = 'arraybuffer'; const inbox = [];
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, name: a ? a.name : 'Guest', token: 'tok' + Math.random(), action, code, auth: a ? { id: a.id, secret: a.secret } : null }));
  ws.onmessage = (e) => { if (typeof e.data !== 'string') return; const m = JSON.parse(e.data); inbox.push(m); if (m.t === 'load') setTimeout(() => ws.send(JSON.stringify({ t: 'loaded' })), 50); };   // like the game: map loaded
  return { ws, inbox, last: (t) => [...inbox].reverse().find(m => m.t === t), wait: async (pred, ms = 8000) => { const t0 = Date.now(); for (;;) { const m = inbox.find(pred); if (m) return m; if (Date.now() - t0 > ms) return null; await sleep(25); } } };
}
try {
  // ---- accounts
  const names = ['Solomon', 'Lina', 'Rashid', 'Kaz', 'Mo_7', 'Yousef', 'Dilan', 'Aram', 'Shad'];
  const acc = [];
  for (const n of names) acc.push(await api('/api/register', { name: n }));
  ok(acc.every(a => a.id && /^\d{4}$/.test(a.tag) && a.secret), `register ${names.length} accounts with Name#1234 IDs`);
  const dup = await api('/api/register', { name: 'solomon' });
  ok(dup.id && dup.tag !== acc[0].tag, `same name gets a different tag (${acc[0].name}#${acc[0].tag} vs ${dup.name}#${dup.tag})`);
  ok((await api('/api/register', { name: 'fuckface' })).error === 'name_bad', 'bad name refused');
  ok((await api('/api/register', { name: 'هەولێر' })).tag, 'Kurdish name allowed');
  const rn = await api('/api/rename', { name: 'Solo' }, acc[0]); ok(rn.name === 'Solo' && rn.tag === acc[0].tag, 'rename keeps the tag');
  const rn2 = await api('/api/rename', { name: 'Solomon' }, acc[0]); ok(rn2.error === 'name_wait' && rn2.days === 30, 'second rename within 30 days refused (' + rn2.days + ' days left)');
  ok((await api('/api/me', null, acc[0])).name === 'Solo', '/api/me works');
  ok((await api('/api/me', null, { id: acc[0].id, secret: 'wrong' })).status === 401, 'wrong secret rejected');

  // ---- hub: friends, presence, chat
  const SZ = GAME.RANKED.SIZE;
  const H = acc.map(hub);
  for (const h of H) ok(!!(await h.wait(m => m.t === 'hello')), `hub hello for ${h.a.name}`);
  const [A, B, C, D, E, F, G, I2, J2] = H;
  let r = await A.req({ t: 'friendReq', to: `lina#${acc[1].tag}` }); ok(r.t === 'ok', 'friend request by Name#tag (any case)');
  ok(!!(await B.wait(m => m.t === 'friendReq' && m.from.id === acc[0].id)), 'Lina sees the request live');
  r = await B.req({ t: 'friendAccept', id: acc[0].id }); ok(r.t === 'ok', 'Lina accepts');
  ok(!!(await A.wait(m => m.t === 'friendAdded')), 'Solomon told the request was accepted');
  const fl = await A.req({ t: 'friends' }); ok(fl.friends.length === 1 && fl.friends[0].st.s === 'menu', 'friend list shows Lina online');
  r = await A.req({ t: 'friendReq', to: 'Nobody#0000' }); ok(r.code === 'not_found', 'unknown ID → not_found');
  r = await A.req({ t: 'chat', to: acc[2].id, text: 'hi' }); ok(r.code === 'not_friends', 'cannot message non-friends');
  A.send({ t: 'chat', to: acc[1].id, text: 'Ranked 3v3 tonight? you b1tch' });
  const msg = await B.wait(m => m.t === 'msg'); ok(msg && msg.m.text === 'Ranked 3v3 tonight? you *****', 'chat delivered and filtered: ' + (msg && msg.m.text));
  B.send({ t: 'chat', to: acc[0].id, text: 'بەڵێ! کاز بهێنە' });
  ok(!!(await A.wait(m => m.t === 'msg' && m.m.text === 'بەڵێ! کاز بهێنە')), 'Kurdish chat delivered');
  A.send({ t: 'invite', to: acc[1].id, code: 'f7k2q' });
  ok(!!(await B.wait(m => m.t === 'msg' && m.m.kind === 'invite' && m.m.text === 'F7K2Q')), 'room invite delivered');
  const hist = await A.req({ t: 'history', id: acc[1].id }); ok(hist.msgs.length === 3, 'chat history saved (3 messages)');
  r = await G.req({ t: 'friendReq', to: `Solo#${acc[0].tag}` }); await A.wait(m => m.t === 'friendReq');
  r = await A.req({ t: 'block', id: acc[6].id }); ok(r.t === 'ok', 'block');
  r = await G.req({ t: 'friendReq', to: `Solo#${acc[0].tag}` }); ok(r.code === 'blocked', 'blocked player cannot send requests');
  r = await A.req({ t: 'report', id: acc[1].id, reason: 'test' }); ok(r.t === 'ok', 'report saved');

  // ---- squad + ranked queue (A+B squad, the rest solo) — one queue, random mode and map
  r = await A.req({ t: 'partyInvite', to: acc[1].id }); ok(r.t === 'ok', 'squad invite');
  const pinv = await B.wait(m => m.t === 'partyInvite'); ok(!!pinv, 'Lina gets squad invite');
  r = await B.req({ t: 'partyAccept', leader: acc[0].id }); ok(r.t === 'ok', 'Lina joins squad');
  const party = await A.wait(m => m.t === 'party' && m.party && m.party.members.length === 2); ok(!!party, 'squad has 2 members');
  // The squad must survive moving around the menu. The party lives on the server, keyed by
  // player, so picking a different tank in the garage — or anything else a player does between
  // matches — must not break it up; the server just re-sends the party with the new tank.
  {
    r = await B.req({ t: 'eco', op: 'select', tank: 'zagros' });
    ok(r.t === 'ok', 'a squad member picks a tank in the garage');
    const still = await A.wait(m => m.t === 'party' && m.party && m.party.members.length === 2, 2500);
    ok(!!still, 'the squad is still together, and the leader sees the new pick');
  }
  // The leader walks into a custom room and the squad is taken along with them.
  {
    const ws = new WebSocket(`${WS}/ws`);
    await new Promise(r => ws.addEventListener('open', r));
    ws.send(JSON.stringify({ t: 'hello', name: acc[0].name, action: 'create', map: 'hawler', auth: { id: acc[0].id, secret: acc[0].secret } }));
    const pulled = await B.wait(m => m.t === 'pull' && m.code, 3000);
    ok(!!pulled, `the squad is pulled into the leader's room (${pulled && pulled.code})`);
    ok(pulled && pulled.by === acc[0].id, 'and told who took them there');
    try { ws.close(); } catch (e) {}
    await sleep(200);
  }
  // Handing the squad over: the party is keyed by its leader, so it has to move key and take
  // everyone's pointer with it. Only the leader may do it, and only to a member.
  {
    // The hub drops anything over 12 messages in 2 seconds, so these are paced apart.
    const easy = () => sleep(320);
    ok((await B.req({ t: 'partyPromote', id: acc[0].id })).t === 'ok', 'a member asking to promote is answered but changes nothing');
    await easy();
    ok((await A.req({ t: 'partyPromote', id: acc[1].id })).t === 'ok', 'the leader hands the squad to Lina');
    const moved = await B.wait(m => m.t === 'party' && m.party && m.party.leader === acc[1].id, 2500);
    ok(!!moved, 'and everyone is told she leads it now');
    await easy();
    ok((await A.req({ t: 'queue' })).code === 'not_leader', 'the old leader can no longer queue for the squad');
    await easy();
    ok((await B.req({ t: 'queue' })).t === 'ok', 'and the new leader can');
    await easy();
    await B.req({ t: 'unqueue' });
    await easy();
    ok((await B.req({ t: 'partyPromote', id: acc[0].id })).t === 'ok', 'she hands it back');
    await A.wait(m => m.t === 'party' && m.party && m.party.leader === acc[0].id, 2500);
    await easy();
  }
  // A member may put a friend forward, but it is the leader who decides whether the invitation
  // is actually sent — and the friend still has to accept it for themselves.
  {
    const easy = () => sleep(320);
    // The member has to be friends with whoever they are putting forward, so make those first.
    for (const [who, idx] of [[C, 2], [D, 3]]) {
      await who.req({ t: 'friendReq', to: `${acc[1].name}#${acc[1].tag}` }); await easy();
      await B.req({ t: 'friendAccept', id: acc[idx].id }); await easy();
    }
    { const rr = await B.req({ t: 'partyInvite', to: acc[2].id }); ok(rr.t === 'ok', 'a member may ask for a friend to be brought in' + (rr.t === 'ok' ? '' : ' -> ' + rr.code)); }
    const ask = await A.wait(m => m.t === 'partyAsk', 2500);
    ok(!!ask, 'the leader is asked to approve it');
    ok(ask && ask.by && ask.by.id === acc[1].id && ask.who && ask.who.id === acc[2].id,
       'and told who asked and who for');
    ok(!(await C.wait(m => m.t === 'partyInvite', 700)), 'the friend hears nothing until the leader says so');
    await easy();
    ok((await B.req({ t: 'partyInvite', to: acc[2].id })).code === 'already_asked', 'asking twice is refused');
    await easy();
    ok((await B.req({ t: 'partyApprove', to: acc[2].id })).code === 'not_leader', 'a member cannot approve their own request');
    await easy();
    ok((await A.req({ t: 'partyApprove', to: acc[2].id })).t === 'ok', 'the leader approves');
    ok(!!(await C.wait(m => m.t === 'partyInvite', 2500)), 'and NOW the friend gets a real invitation');
    ok(!!(await B.wait(m => m.t === 'partyAskOk', 2500)), 'the member is told it went out');
    await easy();
    ok((await C.req({ t: 'partyAccept', leader: acc[0].id })).t === 'ok', 'the friend accepts for themselves');
    ok(!!(await A.wait(m => m.t === 'party' && m.party && m.party.members.length === 3, 2500)), 'the squad is three');
    await easy();
    // ...and a refusal reaches nobody but the member who asked
    ok((await B.req({ t: 'partyInvite', to: acc[3].id })).t === 'ok', 'a second request goes up');
    await A.wait(m => m.t === 'partyAsk', 2500);
    await easy();
    ok((await A.req({ t: 'partyReject', to: acc[3].id })).t === 'ok', 'the leader turns this one down');
    ok(!!(await B.wait(m => m.t === 'partyAskNo', 2500)), 'the member is told no');
    ok(!(await D.wait(m => m.t === 'partyInvite', 700)), 'and the friend is never troubled at all');
    await easy();
    ok((await A.req({ t: 'partyApprove', to: acc[3].id })).code === 'no_request', 'a decided request cannot be approved after the fact');
    await easy();
    // put the squad back to two for the queue tests that follow
    await C.req({ t: 'partyLeave' });
    await A.wait(m => m.t === 'party' && m.party && m.party.members.length === 2, 2500);
    await easy();
  }
  r = await B.req({ t: 'queue' }); ok(r.code === 'not_leader', 'only the squad leader can queue');
  r = await A.req({ t: 'queue' }); ok(r.t === 'ok', `squad queued for ranked ${SZ}v${SZ}`);
  for (const h of [C, D, E, F, I2, J2]) ok((await h.req({ t: 'queue' })).t === 'ok', `${h.a.name} queued`);
  const six = [A, B, C, D, E, F, I2, J2];
  const found = []; for (const h of six) found.push(await h.wait(m => m.t === 'found', 4000));
  ok(found.every(f => f && f.size === SZ && f.teams.blue.length === SZ && f.teams.red.length === SZ), `MATCH FOUND sent to all ${six.length} with ${SZ}v${SZ} teams`);
  const f0 = found[0];
  const sameTeam = (f0.teams.blue.some(c => c.id === acc[0].id) && f0.teams.blue.some(c => c.id === acc[1].id)) || (f0.teams.red.some(c => c.id === acc[0].id) && f0.teams.red.some(c => c.id === acc[1].id));
  ok(sameTeam, 'squad kept on the same team');
  for (const h of six) h.send({ t: 'accept', match: f0.match });
  const go = []; for (const h of six) go.push(await h.wait(m => m.t === 'go', 4000));
  ok(go.every(g => g && g.code === go[0].code), 'everyone accepted → sent to the same ranked room ' + (go[0] && go[0].code));
  // outsider can't join the ranked room
  const intruder = game(acc[6], 'join', go[0].code); const ie = await intruder.wait(m => m.t === 'error');
  ok(ie && ie.code === 'not_yours', 'a player who was not matched cannot join');
  const G6 = six.map(h => game(h.a, 'join', go[0].code));
  const started = await G6[0].wait(m => m.t === 'start', 8000); ok(!!started, `ranked match starts when all ${six.length} are in`);
  const info = G6[0].last('room'); ok(info && info.kind === 'ranked' && GAME.RANKED.MODES.includes(info.mode) && GAME.RANKED.MAPS.includes(info.map) && info.max === SZ * 2, `ranked room for ${six.length} picked a random mode and map (${info && info.mode} on ${info && info.map})`);
  ok(G6.every(g => g.inbox.some(m => m.t === 'load')), 'everyone got the loading screen before the start');
  const st = await H[2].req({ t: 'friends' }); // just to flush
  // presence: Lina (friend) should see Solomon "in a match"
  const pres = await B.wait(m => m.t === 'presence' && m.id === acc[0].id && m.st.s === 'match', 3000); ok(!!pres, 'friends see "in a match" presence');
  // red team leaves → forfeit after 30 s
  const redIds = new Set(f0.teams.red.map(c => c.id));
  six.forEach((h, i) => { if (redIds.has(h.a.id)) G6[i].ws.send(JSON.stringify({ t: 'leave' })); });
  console.log('   (waiting 31 s for the forfeit rule…)');
  const blueIdx = six.findIndex(h => !redIds.has(h.a.id)), redIdx = six.findIndex(h => redIds.has(h.a.id));
  const rpWin = await H[blueIdx].wait(m => m.t === 'rp', 40000);
  const rpLose = await H[redIdx].wait(m => m.t === 'rp', 5000);
  ok(rpWin && rpWin.won && rpWin.delta > 0, `winners gain RP (placement doubles it): ${rpWin && rpWin.delta} · parts ${rpWin && JSON.stringify(rpWin.parts)}`);
  ok(rpLose && rpLose.left && rpLose.delta === -60, `leavers lose 30 RP ×2 in placement: ${rpLose && rpLose.delta}`);
  const prof = await api(`/api/profile?id=${acc[blueIdx].id}`);
  ok(prof.recent && prof.recent.length === 1 && prof.recent[0].won && prof.recent[0].kind === 'ranked', 'profile shows the ranked match');
  ok(prof.rank && prof.rank.placed === false && prof.rank.games === 1, 'placement 1 of 5 shown');
  const lbFr = await api('/api/leaderboard?board=wins&period=season&scope=friends', null, acc[0]);
  ok(Array.isArray(lbFr.rows) && lbFr.me && lbFr.me.id === acc[0].id, 'friends leaderboard works');
  const lb = await api('/api/leaderboard?board=wins&period=season');
  ok(lb.rows.length >= 3 && lb.rows[0].value === 1, `wins leaderboard lists the 3 winners (top value ${lb.rows[0] && lb.rows[0].value})`);

  // ---- quick match: two players land in the same public room, bots fill it
  const q1 = game(acc[6], 'quick'), q2 = game(null, 'quick');
  const w1 = await q1.wait(m => m.t === 'welcome'), w2 = await q2.wait(m => m.t === 'welcome');
  ok(w1 && w2 && w1.code === w2.code && w1.kind === 'quick', 'quick match puts players in the same public room');
  const qs = await q1.wait(m => m.t === 'start', 16000);
  const qi = q1.last('room');
  ok(!!qs && qi.players.length >= 6 && qi.players.filter(p => p.bot).length >= 4, `quick match starts by itself with bots (${qi && qi.players.length} tanks, mode ${qi && qi.mode})`);
  const infoApi = await api('/api/info'); ok(infoApi.season && infoApi.season.n >= 1 && infoApi.quickMode, `season ${infoApi.season.n}, ${infoApi.season.daysLeft} days left, quick mode this week: ${infoApi.quickMode}`);
} catch (e) { console.error(e); fails++; }
srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nALL SOCIAL TESTS PASS');
process.exit(fails ? 1 : 0);
