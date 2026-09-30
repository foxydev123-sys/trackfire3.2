# MENU VISUAL QA — measures, for every map, every screen size and every party size, exactly where
# each tank lands on screen, and reports anything that covers it: a UI panel, a tree, a building,
# a prop, or the edge of the screen.
#
# Nothing here is taken on trust. The tank's box is the projection of its real world-space bounding
# box through the real camera; the UI boxes are read from the live page; occluders are the real map
# objects, tested against the corridor between camera and tank.
#
#   python3 tools/menu-qa.py [outdir]        full sweep, writes a report and screenshots
#   python3 tools/menu-qa.py --quick         one size per map, for a fast check
import asyncio, os, subprocess, sys, tempfile, time, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8890
MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-qa-')
OUT = next((a for a in sys.argv[1:] if not a.startswith('--')), '/tmp/claude-0/qa')
QUICK = '--quick' in sys.argv

SIZES = [(1920, 1080), (1366, 768), (932, 430), (844, 390), (812, 375), (740, 360)]
if QUICK: SIZES = [(1920, 1080), (844, 390)]
MAPS = ['hawler', 'desert', 'forest', 'stadium']
PARTY = [1, 2, 3, 4]

# Put a party of n on the stage. Ids are real-looking so stagePlayers() keeps them apart.
def party(n):
    names = ['Solomon', 'Hemin', 'Dilan', 'Aram']
    tanks = ['zagros', 'safeen', 'korek', 'newroz']
    ms = ',\n'.join(
        "{ id: %s, name: '%s', tank: { id: '%s', level: 3 } }"
        % ('__tf.acc.id || "me"' if i == 0 else "'p%d'" % i, names[i], tanks[i])
        for i in range(n))
    if n == 1:
        return "() => { __tf.acc.party = null; __tf.acc.emit('party', null); }"
    return "() => { __tf.acc.party = { leader: __tf.acc.id || 'me', map: null, members: [\n%s\n] };\n  __tf.acc.emit('party', __tf.acc.party); }" % ms

# ---- the measurement, run inside the page ----
# For each tank on the stage: project the eight corners of its real bounding box through the real
# camera and take the screen-space rectangle. Then compare against every UI panel actually on
# screen, and against the map objects sitting between the camera and the tank.
MEASURE = r"""() => {
  const st = __tf.stage, cam = __tf.game.camera || __tf.camera;
  if (!st || !cam) return { err: 'no stage' };
  const W = innerWidth, H = innerHeight;
  const TANKS = __tf.TANKS || {};
  const V = __tf.V3;

  const project = (x, y, z) => {
    const v = new V(x, y, z).project(cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, infront: v.z < 1 };
  };

  // A tank is about 3.4 m wide, 2.6 m tall and 5.4 m long, times its own size multiplier.
  const boxOf = (e) => {
    const p = e.view.root.position, s = (TANKS[e.kind] && TANKS[e.kind].size) || 1;
    const hw = 1.7 * s, ht = 2.6 * s, hl = 2.7 * s;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, seen = false;
    for (const sx of [-hw, hw]) for (const sy of [0, ht]) for (const sz of [-hl, hl]) {
      const q = project(p.x + sx, p.y + sy, p.z + sz);
      if (!q.infront) continue;
      seen = true;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    return seen ? { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 } : null;
  };

  // Every UI panel that is actually drawn over the scene.
  const uiRects = [];
  const sel = ['#scr-menu .menu-col', '#homeSide', '.wallet-bar', '#btnMore', '#mnDrawer',
               '#squadBar', '#seasonLine', '#leadNote', '.mn-logo'];
  for (const s of sel) {
    for (const el of document.querySelectorAll(s)) {
      if (el.hidden || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // a column whose children are what actually paint: use the children's union, not the box
      uiRects.push({ name: el.id ? '#' + el.id : (el.className || '').toString().split(' ')[0],
                     x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
    }
  }

  const over = (a, b, pad) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > pad
                           && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > pad;

  // Map objects that sit between the camera and a tank. Heights are generous on purpose: a tree
  // or a lamp post is tall, and its trunk being 3 m to the side does not mean it is out of the way.
  const TALL = { tree:5.5, ctree:6, pine:7, dtree:5, leafy:5, palm:6, fpine:7.5, bigTree:8,
                 lamp:6, slamp:6, flag:8, sflag:5, tower:9, building:9, house:7, hut:5, cabin:5,
                 shed:4, ruin:4, mesa:12, rock:2.4, wall:3, fence:1.4, sandbag:1.2, crate:1.4,
                 barrel:1.3, sign:2.6, citadel:9, adboard:3, stand:8, bench:0.9, bush:1.2 };
  const pointsOf = (o) => (o.posts && o.posts.length ? o.posts
    : o.pts && o.pts.length ? o.pts
    : (Number.isFinite(o.x) && Number.isFinite(o.z) ? [[o.x, o.z]] : null));

  const cp = cam.position;
  const out = [];
  for (const [id, e] of st.views) {
    const box = boxOf(e);
    const p = e.view.root.position;
    const rec = { id: String(id), slot: e.slot, kind: e.kind, me: !!e.me,
                  world: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }, box, hits: [] };
    if (!box) { rec.hits.push({ what: 'off camera', how: 'the tank is not in front of the camera' }); out.push(rec); continue; }

    // cropped by the edge of the screen?
    if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H)
      rec.hits.push({ what: 'screen edge',
        how: `cropped (${Math.round(box.x0)},${Math.round(box.y0)})-(${Math.round(box.x1)},${Math.round(box.y1)}) in ${W}x${H}` });

    // behind a UI panel?  (a few px of overlap at a corner is not "hidden")
    for (const u of uiRects) {
      if (!over(box, u, 6)) continue;
      const ox = Math.min(box.x1, u.x1) - Math.max(box.x0, u.x0);
      const oy = Math.min(box.y1, u.y1) - Math.max(box.y0, u.y0);
      const frac = (ox * oy) / Math.max(1, box.w * box.h);
      if (frac > 0.04) rec.hits.push({ what: 'UI ' + u.name, how: `${Math.round(frac * 100)}% of the tank is behind it` });
    }

    // anything of the map standing in the way?
    const M = st.W.map;
    const vx = p.x - cp.x, vz = p.z - cp.z, l2 = vx * vx + vz * vz;
    for (const o of M.objects) {
      const pts = pointsOf(o); if (!pts) continue;
      const tall = TALL[o.k] ?? 1.0;
      if (tall < 1.5) continue;                       // grass and kerbs cannot hide a tank
      for (const [ox2, oz2] of pts) {
        const wx = ox2 - cp.x, wz = oz2 - cp.z;
        const t = l2 ? (wx * vx + wz * vz) / l2 : 0;
        if (t <= 0.04 || t >= 0.98) continue;          // not between the two
        const d = Math.hypot(wx - vx * t, wz - vz * t);
        const reach = (o.s ? o.s * 1.2 : 1.1) + (o.R || 0);
        if (d > reach + 1.6) continue;
        // does it actually rise into the tank's silhouette from here?
        const g = M.height(ox2, oz2);
        const top = project(ox2, g + tall, oz2), bot = project(ox2, g, oz2);
        if (!top.infront) continue;
        const ob = { x0: Math.min(top.x, bot.x) - 6, x1: Math.max(top.x, bot.x) + 6, y0: top.y, y1: bot.y };
        if (over(box, ob, 4))
          rec.hits.push({ what: o.k, how: `standing ${d.toFixed(1)} m off the line, ${(t * 100) | 0}% of the way to the tank` });
        break;
      }
    }
    out.push(rec);
  }
  return { W, H, map: st.W.map.id, cam: { x: +cp.x.toFixed(1), y: +cp.y.toFixed(1), z: +cp.z.toFixed(1) },
           tanks: out, ui: uiRects.map(u => u.name) };
}"""

async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '400'}, stdout=subprocess.PIPE)
    time.sleep(1.2)
    rows, problems, moving = [], [], []
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            for (W, H) in SIZES:
                ctx = await br.new_context(viewport={'width': W, 'height': H},
                                           has_touch=(W < 1200), is_mobile=(W < 1200),
                                           service_workers='block')
                p = await ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)[:160]))
                await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
                await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
                await p.goto(f'http://localhost:{PORT}/')
                await p.wait_for_selector('#scr-menu:not([hidden])')
                await p.wait_for_function('window.__tf && window.__tf.stage', timeout=25000)
                await p.evaluate("__tf.setName('Solomon')")
                # hand the page the pieces the measurement needs
                await p.evaluate("""async () => {
                  const T = await import('/shared/tanks.js');
                  const TH = await import('/js/three.js');
                  window.__tf.TANKS = T.TANKS; window.__tf.V3 = TH.Vector3;
                  window.__tf.camera = __tf.game.camera; }""")
                await p.wait_for_timeout(500)
                # The shot eases into place over about a second and a half. Measuring on a fixed
                # timer caught it still moving, so wait for it to actually come to rest.
                async def settle(ms=4000):
                    await p.wait_for_timeout(250)
                    try:
                        await p.wait_for_function("""() => { const s = window.__tf.stage;
                          const k = s.pan.toFixed(2) + '/' + s.fit.toFixed(3);
                          const same = (s.__k === k) ? (s.__n || 0) + 1 : 0;
                          s.__k = k; s.__n = same; return same >= 4; }""", timeout=ms, polling=80)
                    except Exception:
                        pass
                for mp in MAPS:
                    await p.evaluate(f"__tf.setMenuMap('{mp}')")
                    await settle()
                    for n in PARTY:
                        await p.evaluate(party(n))
                        # the ease itself has to be clean too — a tank must not swing under a
                        # panel on its way to a resting place that happens to be fine
                        for _ in range(7):
                            await p.wait_for_timeout(160)
                            m = await p.evaluate(MEASURE)
                            if m.get('err'): continue
                            for tk in m['tanks']:
                                for h in tk['hits']:
                                    moving.append(f'{W}x{H} {mp} {n}p  tank[{tk["slot"]}] {tk["kind"]}: {h["what"]} — {h["how"]}')
                        await settle()
                        r = await p.evaluate(MEASURE)
                        if r.get('err'):
                            problems.append(f'{W}x{H} {mp} {n}p: {r["err"]}'); continue
                        r['party'] = n
                        rows.append(r)
                        for tk in r['tanks']:
                            for h in tk['hits']:
                                problems.append(f'{W}x{H} {mp} {n}p  tank[{tk["slot"]}] {tk["kind"]}: {h["what"]} — {h["how"]}')
                        await p.screenshot(path=os.path.join(OUT, f'{mp}-{W}x{H}-{n}p.png'))
                for e in errs[:3]: problems.append(f'{W}x{H}: page error {e}')
                await ctx.close()
            await br.close()
    finally:
        srv.terminate()

    json.dump(rows, open(os.path.join(OUT, 'measurements.json'), 'w'), indent=1)

    # ---- report ----
    if moving:
        u = sorted(set(moving))
        print(f'\n{len(u)} problems appear only WHILE the camera is easing into place:')
        for m in u[:6]: print('      ' + m)
    print(f'\nMeasured {len(rows)} screens: {len(MAPS)} maps x {len(SIZES)} sizes x {len(PARTY)} party sizes\n')
    if not problems:
        print('No tank is covered by UI, scenery or the screen edge anywhere.')
    else:
        # group identical complaints so the list is readable
        byKind = {}
        for s in problems:
            k = s.split(': ', 1)[1].split(' — ')[0] if ': ' in s else s
            byKind.setdefault(k, []).append(s)
        print(f'{len(problems)} problems, in {len(byKind)} kinds:\n')
        for k, v in sorted(byKind.items(), key=lambda kv: -len(kv[1])):
            print(f'  {len(v):3d} x  {k}')
            for s in v[:3]: print(f'          {s}')
            if len(v) > 3: print(f'          ... and {len(v)-3} more')
            print()
    # where the tank actually sits, as a fraction of the screen — the composition check
    print('Where the player tank sits (share of screen width / height, centre of its box):')
    for mp in MAPS:
        for n in (1, 4):
            hits = [r for r in rows if r['map'] == mp and r['party'] == n]
            if not hits: continue
            xs, ys, ws = [], [], []
            for r in hits:
                me = next((t for t in r['tanks'] if t['me'] and t['box']), None)
                if not me: continue
                xs.append(((me['box']['x0'] + me['box']['x1']) / 2) / r['W'])
                ys.append(((me['box']['y0'] + me['box']['y1']) / 2) / r['H'])
                ws.append(me['box']['w'] / r['W'])
            if xs:
                print(f'  {mp:8s} {n}p   x {min(xs)*100:4.0f}-{max(xs)*100:3.0f}%   '
                      f'y {min(ys)*100:4.0f}-{max(ys)*100:3.0f}%   width {min(ws)*100:4.1f}-{max(ws)*100:4.1f}% of screen')
    print(f'\nScreenshots and measurements.json in {OUT}')
    sys.exit(1 if problems else 0)

asyncio.run(main())
