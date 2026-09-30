# The Newroz black hole: it builds all its pieces, turns and pulls sparks inward while it is
# open, and collapses in on itself when the server takes it away instead of vanishing.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8818; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b18-')

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
            ctx = await br.new_context(viewport={'width': 900, 'height': 420}, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Newroz')")
            await p.click('#btnPractice'); await p.wait_for_selector('#scr-lobby:not([hidden])')
            await p.wait_for_function("__tf.room && __tf.room.players.length>=4", timeout=15000)
            await p.click('#btnStart'); await p.wait_for_selector('#hud:not([hidden])', timeout=15000)
            await p.wait_for_timeout(1200)
            await p.evaluate("__tf.tryTank('newroz', 5)"); await p.wait_for_timeout(800)

            # arm the power and place it out in front
            await p.evaluate("""() => {
              const n = __tf.net; n.ab.chg = n.ab.need;
              __tf.game.input.aimWorld = { x: n.me.x + 22, z: n.me.z + 22 };
              // the power has its own control: hold it to aim, let go to use it
              __tf.game.input.abDown = true;
              setTimeout(() => { __tf.game.input.abDown = false; __tf.game.input.abFired = true; }, 90);
            }""")
            await p.wait_for_function("__tf.game.W && __tf.game.W.abfx.holes.size > 0", timeout=8000)
            ok(True, 'a black hole opens when the power is fired')

            parts = await p.evaluate("""() => {
              const o = [...__tf.game.W.abfx.holes.values()][0], u = o.g.userData;
              return { core: !!u.core, ring: !!u.ring, ring2: !!u.ring2, glow: !!u.glow, shell: !!u.shell,
                       well: !!u.well, rune: !!u.rune, tendrils: u.tendrils.length,
                       spin: u.spin.length, bolts: u.bolts.length,
                       sparks: u.sparks.geometry.attributes.position.count, children: o.g.children.length };
            }""")
            ok(all([parts['core'], parts['ring'], parts['ring2'], parts['glow'], parts['shell'], parts['well'], parts['rune']]),
               'it has a dark core, its hot rings, a glow, an outer shell and the marked ground')
            ok(parts['tendrils'] >= 4, f"tendrils of matter wound round it ({parts['tendrils']})")
            ok(parts['sparks'] >= 40, f"sparks falling inward ({parts['sparks']})")
            ok(parts['bolts'] >= 2, f"bolts flicking out of it ({parts['bolts']})")

            # it animates: things turn, and the sparks move inward
            before = await p.evaluate("""() => {
              const o = [...__tf.game.W.abfx.holes.values()][0], u = o.g.userData;
              const P = u.sparks.geometry.attributes.position;
              return { ring: u.ring.rotation.z, spin: u.spin[0].o.rotation.y, tend: u.tendrils[0].m.rotation.z,
                       s0: [P.getX(0), P.getZ(0)], scale: o.g.scale.x };
            }""")
            await p.wait_for_timeout(600)
            after = await p.evaluate("""() => {
              const o = [...__tf.game.W.abfx.holes.values()][0], u = o.g.userData;
              const P = u.sparks.geometry.attributes.position;
              return { ring: u.ring.rotation.z, spin: u.spin[0].o.rotation.y, tend: u.tendrils[0].m.rotation.z,
                       s0: [P.getX(0), P.getZ(0)], scale: o.g.scale.x };
            }""")
            ok(after['ring'] != before['ring'] and after['tend'] != before['tend'], 'its rings and tendrils turn')
            ok(after['spin'] != before['spin'], 'the marks scratched into the ground turn too')
            ok(after['s0'] != before['s0'], 'the sparks are moving')
            ok(after['scale'] > 0.9, f"it has finished opening ({after['scale']:.2f})")

            # when the server drops it, it collapses rather than blinking out
            await p.evaluate("__tf.game.W.abfx.setFx({ w: [], d: [], h: [] })")
            await p.wait_for_timeout(120)
            mid = await p.evaluate("""() => { const m = __tf.game.W.abfx.holes; if (!m.size) return null;
              const o = [...m.values()][0]; return { dying: !!o.dying, scale: o.g.scale.x }; }""")
            ok(mid is not None and mid['dying'], 'taking it away starts it collapsing instead of removing it at once')
            ok(mid is not None and mid['scale'] < 0.98, f"it is shrinking ({mid['scale']:.2f})" if mid else 'shrinking')
            await p.wait_for_timeout(700)
            ok(await p.evaluate("__tf.game.W.abfx.holes.size === 0"), 'and then it is gone')
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test18: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
