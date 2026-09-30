# The menu's own copy of each map: the line-up stands on ground swept clear of rocks, trees and
# props, the camera has its own shot per map, and the background is alive — cars going past,
# jets overhead, a firefight on the horizon — with none of it on low quality.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8823; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b21-')
MAPS = ['hawler', 'desert', 'forest', 'stadium']

# How close the nearest map object is to any tank on the stage, and to the camera's sight line.
NEAREST = """() => {
  const st = __tf.stage, W = st.W, L = W.map.lobby, cam = window.__cam;
  // Fences and roads are a run of points rather than one position — measure every point, or a
  // fence lying across the stage would be missed entirely.
  const pointsOf = (o) => o.posts && o.posts.length ? o.posts
    : o.pts && o.pts.length ? o.pts
    : (Number.isFinite(o.x) && Number.isFinite(o.z) ? [[o.x, o.z]] : null);
  let nearTank = 1e9, nearView = 1e9, counted = 0;
  for (const o of W.map.objects) {
    const pts = pointsOf(o); if (!pts) continue;
    counted++;
    for (const [x, z] of pts) {
      for (const e of st.views.values()) {
        const t = e.view.root.position;
        nearTank = Math.min(nearTank, Math.hypot(x - t.x, z - t.z));
      }
      const vx = L.stage.x - cam.x, vz = L.stage.z - cam.z, wx = x - cam.x, wz = z - cam.z;
      const l2 = vx * vx + vz * vz;
      const s = l2 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / l2)) : 0;
      nearView = Math.min(nearView, Math.hypot(wx - vx * s, wz - vz * s));
    }
  }
  return { nearTank, nearView, objects: W.map.objects.length, counted };
}"""


CAM_HOOK = """() => { const st = __tf.stage, real = st.frame.bind(st);
  window.__cam = { x: 0, y: 0, z: 0 };
  st.frame = (dt, cam) => { const r = real(dt, cam);
    window.__cam = { x: cam.position.x, y: cam.position.y, z: cam.position.z }; return r; }; }"""

async def menuClick(p, sel):
    """Press a menu button, opening the corner MENU drawer first when it lives in there."""
    ident = sel.lstrip('#')
    try:
        if await p.is_visible(sel):
            await p.click(sel); return
    except Exception:
        pass
    try:
        if await p.is_visible('#btnMore'):
            await p.click('#btnMore')
            await p.wait_for_selector('#mnDrawer:not([hidden])', timeout=4000)
            await p.wait_for_timeout(120)
    except Exception:
        pass
    await p.click(sel)

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs = []; fails = []
    def ok(c, m):
        print(('  ok   ' if c else '  FAIL ') + m)
        if not c: fails.append(m)
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            ctx = await br.new_context(viewport={'width': 844, 'height': 390}, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf && window.__tf.stage', timeout=15000)
            await p.evaluate(CAM_HOOK)
            await p.wait_for_timeout(700)

            for mp in MAPS:
                await p.evaluate(f"__tf.setMenuMap('{mp}')")
                await p.wait_for_timeout(900)
                info = await p.evaluate("({ id: __tf.stage.W.map.id, lobby: !!__tf.stage.W.isLobby, tanks: __tf.stage.views.size })")
                ok(info['id'] == mp and info['lobby'],
                   f"{mp}: the menu shows its own copy of the map, not the playing one")
                ok(info['tanks'] >= 1, f'{mp}: your tank is standing on it')

                near = await p.evaluate(NEAREST)
                ok(near['nearTank'] > 5, f"{mp}: nothing is standing on top of the tanks (nearest object {near['nearTank']:.1f}m)")
                ok(near['nearView'] > 4, f"{mp}: and nothing blocks the camera's view of them ({near['nearView']:.1f}m)")


            # the map a match is played on keeps every last rock
            untouched = await p.evaluate("""async () => {
              const m = await import('/shared/maps.js');
              return ['hawler','desert','forest','stadium'].map(id =>
                m.getMap(id).objects.length - m.getLobbyMap(id).objects.length); }""")
            ok(all(d > 0 for d in untouched),
               f'the playing maps still have everything the lobby copies swept away ({untouched})')

            # --- the menu keeps ONE map world, and borrows the ground from the playing one
            for mp in MAPS + ['hawler']:
                await p.evaluate(f"__tf.setMenuMap('{mp}')")
                await p.wait_for_timeout(420)
            kept = await p.evaluate("Object.keys(__tf.worlds).filter(k => k.startsWith('lobby:'))")
            ok(len(kept) == 1, f'after cycling every map only one menu world is kept ({kept})')
            shared = await p.evaluate("""() => { const a = __tf.worlds['hawler'], b = __tf.worlds['lobby:hawler'];
              return !!(a && b && a.ground.geometry === b.ground.geometry && b.borrowedGround); }""")
            ok(shared, 'and it borrows the ground from the map you play on rather than building a second one')

            # --- the line-up survives opening a tab and coming back
            before = await p.evaluate("__tf.stage.views.size")
            await menuClick(p, '#btnModes'); await p.wait_for_selector('#scr-page:not([hidden])', timeout=8000)
            await p.wait_for_timeout(600)
            during = await p.evaluate("__tf.stage.views.size")
            await p.click('#btnBack'); await p.wait_for_selector('#scr-menu:not([hidden])', timeout=8000)
            await p.wait_for_timeout(700)
            after = await p.evaluate("__tf.stage.views.size")
            ok(during == before and after == before,
               f'the tanks are still there after opening a tab ({before} -> {during} -> {after})')

            # --- the background moves
            await p.evaluate("__tf.setMenuMap('hawler')"); await p.wait_for_timeout(800)
            kinds = await p.evaluate("__tf.life.items.map(i => i.k)")
            ok('jet' in kinds and 'flash' in kinds,
               f'jets and gunfire are in the background ({sorted(set(kinds))})')
            ok('car' not in kinds,
               'and no traffic — cars driven along a straight line ignored the real roads')
            lit = await p.evaluate("""async () => { for (let i = 0; i < 90; i++) {
                await new Promise(r => requestAnimationFrame(r));
                if (__tf.life.items.some(x => x.k === 'flash' && x.g.material.opacity > 0)) return true; }
              return false; }""")
            ok(lit, 'the gunfire on the horizon flashes')

            # --- it stays small
            ok(len(kinds) <= 14, f'and the whole lot is only {len(kinds)} moving pieces')

            # --- nothing at all on a weak phone. Set the real graphics setting, not the module
            # directly: the menu loop re-applies the setting every frame.
            await p.evaluate("__tf.setVoice({ quality: 'low' })")
            await p.wait_for_timeout(500)
            ok(await p.evaluate("__tf.life.items.length") == 0, 'on low quality the background is left still')
            await p.evaluate("__tf.setVoice({ quality: 'high' })")
            await p.wait_for_timeout(600)
            ok(await p.evaluate("__tf.life.items.length") > 0, 'and comes back when quality goes up')
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test21: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
