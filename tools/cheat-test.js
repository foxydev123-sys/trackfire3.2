// The hidden test button works only when TEST_CHEATS=1, and gives exactly what it says.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const PORT = 8611, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-cheat-'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA, REG_LIMIT: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/info`)).ok) break; } catch (e) {} await sleep(100); }
const acc = await (await fetch(`http://127.0.0.1:${PORT}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Tester"}' })).json();
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/hub`); const inbox = []; let rid = 1;
ws.onmessage = (e) => inbox.push(JSON.parse(e.data)); await new Promise(r => ws.onopen = r);
ws.send(JSON.stringify({ t: 'auth', id: acc.id, secret: acc.secret }));
const wait = async (p) => { for (let i = 0; i < 200; i++) { const m = inbox.find(p); if (m) return m; await sleep(20); } return null; };
const hello = await wait(m => m.t === 'hello');
const op = async (o) => { const r = rid++; ws.send(JSON.stringify({ t: 'eco', rid: r, ...o })); return wait(m => m.rid === r); };
ok(hello.wallet.cheats === true, 'the client is told the test button is available');
const before = hello.wallet.gems;
const m = await op({ op: 'cheat' });
ok(m.t === 'ok' && m.state.gems === before + 10000, `+10,000 gems (${before} → ${m.t === 'ok' ? m.state.gems : '?'})`);
ok(m.t === 'ok' && m.state.parts >= 5000, 'and parts for upgrading');
ok(/TEST CHEATS ARE ON/.test(log), 'the server log warns that the test button is live');
// and it can be switched off for release
const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-cheat2-'));
const srv2 = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: 8612, DATA_DIR: DATA2, TEST_CHEATS: '0', REG_LIMIT: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8612/api/info')).ok) break; } catch (e) {} await sleep(100); }
const acc2 = await (await fetch('http://127.0.0.1:8612/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Live"}' })).json();
const ws2 = new WebSocket('ws://127.0.0.1:8612/hub'); const in2 = []; let r2 = 1;
ws2.onmessage = (e) => in2.push(JSON.parse(e.data)); await new Promise(r => ws2.onopen = r);
ws2.send(JSON.stringify({ t: 'auth', id: acc2.id, secret: acc2.secret }));
const w2 = async (p) => { for (let i = 0; i < 200; i++) { const m = in2.find(p); if (m) return m; await sleep(20); } return null; };
await w2(m => m.t === 'hello');
const rid2 = r2++; ws2.send(JSON.stringify({ t: 'eco', rid: rid2, op: 'cheat' }));
const off = await w2(m => m.rid === rid2);
ok(off && off.t === 'err' && off.code === 'not_available', 'TEST_CHEATS=0 switches it off for release');
ws2.close(); srv2.kill(); fs.rmSync(DATA2, { recursive: true, force: true });
ws.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nCHEAT BUTTON OK');
process.exit(fails ? 1 : 0);
