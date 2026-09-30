/* =====================================================================
   CLOUD BACKUP — keeps a copy of the save file (accounts, coins, tanks,
   ranks, friends…) in Supabase Storage, so a server that loses its disk
   (Render's free plan wipes it every time it goes to sleep) gets every
   player's progress back when it starts again.

   Turn it on with two environment variables (Supabase → Project Settings → API):
     SUPABASE_URL   https://xxxx.supabase.co
     SUPABASE_KEY   the "service_role" secret key (never put it in the game's web files)
   Optional: SUPABASE_BUCKET (default "kurdish-tank"), BACKUP_EVERY_S (default 60).

   How it works
     start:   if there is no local save file yet, download the backup first
     running: every BACKUP_EVERY_S seconds, if anything changed, upload a snapshot
     stop:    (Render sends SIGTERM before sleeping) upload one last snapshot
   Plus one copy per weekday (daily/Mon.db …) to go back to if something goes wrong.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const FILE = 'kurdish-tank.db';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function backupConfigFromEnv() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = (process.env.SUPABASE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key, bucket: (process.env.SUPABASE_BUCKET || 'kurdish-tank').trim(), everyS: Math.max(15, Number(process.env.BACKUP_EVERY_S) || 60) };
}

export class CloudBackup {
  constructor(cfg, log = console.log) { this.cfg = cfg; this.log = log; this.lastChanges = -1; this.busy = false; this.day = null; }
  headers(extra = {}) { return { Authorization: 'Bearer ' + this.cfg.key, apikey: this.cfg.key, ...extra }; }
  objUrl(name) { return `${this.cfg.url}/storage/v1/object/${encodeURIComponent(this.cfg.bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`; }

  /** Before the database opens: bring the save file back if this disk has none. → true if restored */
  async restore(dir) {
    const file = path.join(dir, FILE);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) { this.log('backup: local save file found, not restoring'); return false; }
    try {
      const r = await fetch(this.objUrl(FILE), { headers: this.headers() });
      if (r.status === 404 || r.status === 400) { this.log('backup: no backup yet (first start)'); return false; }
      if (!r.ok) { this.log('backup: download failed', r.status, (await r.text()).slice(0, 200)); return false; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100 || buf.subarray(0, 15).toString() !== 'SQLite format 3') { this.log('backup: downloaded file is not a database, ignored'); return false; }
      fs.mkdirSync(dir, { recursive: true });
      for (const ext of ['-wal', '-shm']) try { fs.unlinkSync(file + ext); } catch (e) {}
      fs.writeFileSync(file, buf);
      this.log(`backup: restored ${(buf.length / 1024).toFixed(0)} KB of saved progress`);
      return true;
    } catch (e) { this.log('backup: restore error', e.message); return false; }
  }

  async ensureBucket() {
    try {
      const r = await fetch(`${this.cfg.url}/storage/v1/bucket`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: this.cfg.bucket, name: this.cfg.bucket, public: false }) });
      if (r.ok) this.log(`backup: created private bucket "${this.cfg.bucket}"`);
    } catch (e) { /* exists already, or offline: uploads will say */ }
  }

  /** Copy the live database into one consistent file and upload it (only if something changed, unless force). */
  async snapshot(store, force = false) {
    if (this.busy) return false;
    let changes = 0;
    try { changes = store.db.prepare('SELECT total_changes() AS n').get().n; } catch (e) { changes = -2; }
    if (!force && changes === this.lastChanges) return false;
    this.busy = true;
    const tmp = path.join(path.dirname(store.file), '.backup-' + process.pid + '.db');
    try {
      try { fs.unlinkSync(tmp); } catch (e) {}
      store.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const buf = fs.readFileSync(tmp);
      await this.upload(FILE, buf);
      const day = DAYS[new Date().getUTCDay()];
      if (this.day !== day) { this.day = day; await this.upload('daily/' + day + '.db', buf).catch(() => {}); }
      this.lastChanges = changes;
      return true;
    } catch (e) { this.log('backup: upload failed', e.message); return false; }
    finally { this.busy = false; try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  async upload(name, buf) {
    const r = await fetch(this.objUrl(name), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: buf });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
  }

  /** Start the timer. Call stop() before exiting. */
  start(store) {
    this.store = store;
    this.ensureBucket().then(() => this.snapshot(store, true)).then(ok => ok && this.log('backup: cloud copy is up to date'));
    this.timer = setInterval(() => this.snapshot(store), this.cfg.everyS * 1000);
    this.timer.unref && this.timer.unref();
  }
  async stop() {
    clearInterval(this.timer);
    for (let i = 0; i < 20 && this.busy; i++) await new Promise(r => setTimeout(r, 100));
    if (this.store) { const ok = await this.snapshot(this.store); if (ok) this.log('backup: final copy saved'); }
  }
}
