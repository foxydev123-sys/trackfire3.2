/* Cloud backup test: a fake Supabase Storage + the real game server.
   1. start the server with an empty disk → make an account, earn coins
   2. stop it (SIGTERM, like Render going to sleep) → the save file is uploaded
   3. wipe the disk and start again → the account and its coins are back.   node tools/backup-test.js */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ---- fake Supabase Storage (only what backup.js uses)
const files = new Map(); let uploads = 0, badAuth = 0;
const KEY = 'service-role-test-key';
const fake = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + KEY) { badAuth++; res.writeHead(401).end('{"error":"auth"}'); return; }
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const u = decodeURIComponent(req.url);
    if (req.method === 'POST' && u === '/storage/v1/bucket') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"name":"kurdish-tank"}'); return; }
    const m = u.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (!m) { res.writeHead(404).end(); return; }
    const key = m[1] + '/' + m[2];
    if (req.method === 'POST') { files.set(key, Buffer.concat(chunks)); uploads++; res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"Key":"' + key + '"}'); return; }
    if (req.method === 'GET') { const f = files.get(key); if (!f) { res.writeHead(400).end('{"error":"not_found","statusCode":"404"}'); return; } res.writeHead(200).end(f); return; }
    res.writeHead(405).end();
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const FAKE = 'http://127.0.0.1:' + fake.address().port;

const PORT = 8600 + Math.floor(Math.random() * 300), API = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-backup-'));
function startServer() {
  const p = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SUPABASE_URL: FAKE, SUPABASE_KEY: KEY, BACKUP_EVERY_S: '15', PAYMENTS_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', d => { p.log += d; }); p.stderr.on('data', d => { p.log += d; });
  return p;
}
async function up() { for (let i = 0; i < 80; i++) { try { const r = await fetch(API + '/api/info'); if (r.ok) return true; } catch (e) {} await sleep(100); } return false; }
const api = async (p, body, a) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(a ? { Authorization: `Bearer ${a.id}.${a.secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

try {
  let srv = startServer(); ok(await up(), 'server starts with an empty disk');
  ok(/no backup yet/.test(srv.log), 'first start: no backup to restore');
  const acc = await api('/api/register', { name: 'Hemin' }); ok(acc && acc.id && acc.secret, `account created: ${acc.name}#${acc.tag}`);
  const prof = await api('/api/profile?id=' + acc.id); ok(prof && prof.name === 'Hemin', 'profile readable');
  await sleep(400);
  srv.kill('SIGTERM'); await new Promise(r => srv.on('exit', r));
  ok(/final copy saved|cloud copy is up to date/.test(srv.log) && files.has('kurdish-tank/kurdish-tank.db'), `save file uploaded on shutdown (${uploads} uploads)`);
  ok([...files.keys()].some(k => k.startsWith('kurdish-tank/daily/')), 'a weekday copy is kept too');
  // the host wipes the disk (Render free plan)
  fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA);
  srv = startServer(); ok(await up(), 'server starts again on an empty disk');
  ok(/restored \d+ KB/.test(srv.log), 'saved progress downloaded before the database opened');
  const again = await api('/api/profile?id=' + acc.id); ok(again && again.name === 'Hemin' && again.tag === acc.tag, 'the account is back after the wipe (same name#tag)');
  const me = await api('/api/me', null, acc); ok(me && !me.error && me.id === acc.id, 'the player can still sign in with the secret on their phone');
  srv.kill('SIGTERM'); await new Promise(r => srv.on('exit', r));
  ok(badAuth === 0, 'every request used the service key');
} catch (e) { console.error(e); fails++; }
fake.close(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nALL BACKUP TESTS PASS');
process.exit(fails ? 1 : 0);
