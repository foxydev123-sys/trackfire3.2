# Every power throws a visible burst in its own colour when it is let off, and asks for its own
# sound. Placed powers (wall, dome, black hole) burst where they land as well as at the tank.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8820; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b19-')
# tank → its power, and the sound it should ask for
POWERS = [('zagros','wall','abWall'), ('baz','drone','abDrone'), ('halgurd','dome','dome'),
          ('rashaba','cloak','cloak'), ('safeen','homing','abMissile'), ('bradost','freeze','abFreezeCast'),
          ('korek','heal','abHeal'), ('newroz','hole','blackhole')]
PLACED = {'wall', 'dome', 'hole'}

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
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Hemin')")
            await p.click('#btnPractice'); await p.wait_for_selector('#scr-lobby:not([hidden])')
            await p.wait_for_function("__tf.room && __tf.room.players.length>=4", timeout=15000)
            await p.click('#btnStart'); await p.wait_for_selector('#hud:not([hidden])', timeout=15000)
            await p.wait_for_timeout(1200)
            # record every sound the game asks for, without making any noise
            await p.evaluate("""() => { window.__snd = []; window.__cast = [];
              const a = __tf.game.audio, real = a.play.bind(a);
              a.play = (n, pos, v) => { window.__snd.push(n); try { return real(n, pos, v); } catch (e) {} };
              const fx = __tf.game.W.abfx, rc = fx.cast.bind(fx);
              fx.cast = (ab, x, y, z, sc) => { window.__cast.push({ ab, x, z, sc: sc || 1 }); return rc(ab, x, y, z, sc); };
            }""")

            for tank, ab, snd in POWERS:
                await p.evaluate("__tf.tryTank(arguments[0], 5)", tank) if False else await p.evaluate(f"__tf.tryTank('{tank}', 5)")
                await p.wait_for_timeout(700)
                await p.evaluate("window.__snd = []; window.__cast = [];")
                # The power has its own control now: hold it to aim, let go to use it. The gun
                # is not involved, so there is no FIRE here at all.
                await p.evaluate("""() => {
                  const n = __tf.net; n.ab.chg = n.ab.need;
                  __tf.game.input.aimWorld = { x: n.me.x + 18, z: n.me.z + 16 };
                  __tf.game.input.abDown = true;
                }""")
                await p.wait_for_timeout(120)
                await p.evaluate("() => { __tf.game.input.abDown = false; __tf.game.input.abFired = true; }")
                await p.wait_for_timeout(900)
                got = await p.evaluate("""() => ({ casts: window.__cast.length, cast: window.__cast.slice(),
                    snd: window.__snd.slice() })""")
                ok(got['casts'] >= 1, f'{tank}: {ab} throws a burst when let off ({got["casts"]})')
                ok(all(c['ab'] == ab for c in got['cast']), f'{tank}: the burst is coloured for {ab}')
                ok(snd in got['snd'], f'{tank}: it makes its own sound ({snd})' + ('' if snd in got['snd'] else f' — heard {got["snd"]}'))
                if ab in PLACED:
                    ok(got['casts'] >= 2, f'{tank}: and a second burst where it lands ({got["casts"]})')
                    if got['casts'] >= 2:
                        ok(any(c['sc'] < 1 for c in got['cast']), f'{tank}: the landing burst is the smaller of the two')

            # the bursts clear themselves away rather than piling up
            await p.wait_for_timeout(1200)
            ok(await p.evaluate("__tf.game.W.abfx.casts.length === 0"), 'bursts clear themselves once they finish')

            # ---- Safeen's guided rocket: one sound per rocket, and it stops the moment it lands
            await p.evaluate("""() => {
              const a = __tf.game.audio;
              window.__rk = { on: [], off: [], at: 0 };
              for (const k of ['rocketOn', 'rocketOff', 'rocketAt']) {
                const real = a[k].bind(a);
                a[k] = (id, ...rest) => { if (k === 'rocketAt') window.__rk.at++; else window.__rk[k === 'rocketOn' ? 'on' : 'off'].push(id); return real(id, ...rest); };
              }
              window.__gu = 0;
              const g = __tf.game.W.fx, rg = g.guided.bind(g);
              g.guided = (pt) => { window.__gu++; return rg(pt); };
            }""")
            fx = "__tf.game.W.abfx"
            # a rocket appears in the stream, flies for a few frames, then is gone
            await p.evaluate(f"{fx}.setEntities({{ m: [[7, 3, 3, 0, __tf.net.myId, 12]], d: [] }})")
            await p.wait_for_timeout(150)
            ok(await p.evaluate("window.__rk.on.length === 1"), 'a rocket that appears starts exactly one flight sound')
            ok(await p.evaluate("__tf.game.audio.rk.size === 1"), 'and one live loop is held for it')
            for step in range(3):
                await p.evaluate(f"{fx}.setEntities({{ m: [[7, {4 + step * 6}, 3, 0, __tf.net.myId, {16 + step * 8}]], d: [] }})")
                await p.wait_for_timeout(140)
            ok(await p.evaluate("window.__rk.on.length === 1"), 'flying does not start it again every frame')
            ok(await p.evaluate("window.__rk.at > 3"), 'it is kept following the rocket while it flies')
            # the server says it hit something, and marks it as the guided one
            await p.evaluate("window.__snd = []")
            await p.evaluate("__tf.game.onScheduled({ t: 'hit', s: -1007, o: __tf.net.myId, x: 22, z: 3, v: 0, dmg: 70, w: 1, gm: 1 })")
            await p.evaluate(f"{fx}.setEntities({{ m: [], d: [] }})")
            await p.wait_for_timeout(250)
            ok(await p.evaluate("window.__rk.off.length === 1"), 'the flight sound stops when the rocket is gone')
            ok(await p.evaluate("__tf.game.audio.rk.size === 0"), 'and nothing is left holding audio nodes')
            ok(await p.evaluate("window.__gu >= 1"), 'the impact throws the big guided blast')
            ok(await p.evaluate("window.__snd.includes('guidedImpact')"), 'with its own impact sound, not the shell one')
            # several rockets in a row must not pile loops up
            for i in range(4):
                await p.evaluate(f"{fx}.setEntities({{ m: [[{20 + i}, 5, 5, 0, 99, 20]], d: [] }})")
                await p.wait_for_timeout(70)
                await p.evaluate(f"{fx}.setEntities({{ m: [], d: [] }})")
                await p.wait_for_timeout(70)
            ok(await p.evaluate("__tf.game.audio.rk.size === 0"), 'four rockets later there is still nothing left running')
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test19: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
