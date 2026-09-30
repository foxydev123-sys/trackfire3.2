# Placing a power with the POWER stick: hold it, drag far, let go, and the power must land far
# away in that direction — not on top of your own tank. Regression test for the release latch
# (the live push is zeroed on release before the input tick reads it, which without the latch
# collapses the placement distance to its minimum and drops the power on your own head).
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8816; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b16-')

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
            ctx = await br.new_context(viewport={'width': 844, 'height': 390}, has_touch=True,
                                       is_mobile=True, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Hemin')")
            # Zagros places a wall on the ground — the clearest "did it land far away" power.
            await p.evaluate("__tf.tryTank && __tf.tryTank('zagros')")
            await p.click('#btnPractice'); await p.wait_for_selector('#scr-lobby:not([hidden])')
            await p.wait_for_function("__tf.room && __tf.room.players.length>=4", timeout=15000)
            await p.click('#btnStart'); await p.wait_for_selector('#hud:not([hidden])', timeout=15000)
            await p.wait_for_timeout(1500)
            ok(await p.is_visible('#abBtn'), 'the power control is on screen')
            # it only comes alive on a full bar, which is what a player would have to wait for
            await p.evaluate("() => { const n = __tf.net; n.ab.chg = n.ab.need; }")
            await p.wait_for_timeout(120)
            ok(await p.evaluate("__tf.touch.abOk === true"), 'and wakes up once the power is charged')

            # Push the power stick to its edge and let go, the way a player places a power.
            # Real touch-type pointer events: the control ignores pointerType 'mouse'.
            box = await p.locator('#abBtn').bounding_box()
            cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            await p.evaluate("""([cx, cy]) => {
              const ev = (type, tgt, x, y) => tgt.dispatchEvent(new PointerEvent(type, {
                pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
                clientX: x, clientY: y }));
              const base = document.getElementById('abBtn');
              ev('pointerdown', base, cx, cy);
              for (let i = 1; i <= 8; i++) ev('pointermove', window, cx + i * 15, cy);
            }""", [cx, cy])
            await p.wait_for_timeout(80)
            live = await p.evaluate("__tf.touch.abPush")
            ok(live > 0.6, f'the stick reads as pushed far while held (abPush {live:.2f})')
            ok(await p.evaluate("__tf.touch.abHold === true"), 'and it knows it is being held')

            await p.evaluate("""([cx, cy]) => {
              window.dispatchEvent(new PointerEvent('pointerup', {
                pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
                clientX: cx + 120, clientY: cy }));
            }""", [cx, cy])
            await p.wait_for_timeout(30)

            held = await p.evaluate("__tf.touch.abPush")
            latched = await p.evaluate("__tf.touch.abDist()")
            ok(held == 0, 'the live stick value drops to 0 on release, as before')
            ok(latched > 0.6, f'but the placement distance survives the release (abDist {latched:.2f})')

            abd = await p.evaluate("__tf.game.input.abDist(__tf.net.me)")
            ok(abd > 0.6, f'the input tick sends a far placement (abd {abd:.2f})')

            # and a fresh touch on the stick clears the latch again
            await p.evaluate("""([cx, cy]) => {
              document.getElementById('abBtn').dispatchEvent(new PointerEvent('pointerdown', {
                pointerId: 8, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
                clientX: cx, clientY: cy }));
              window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, pointerType: 'touch',
                isPrimary: true, bubbles: true, cancelable: true, clientX: cx + 3, clientY: cy }));
            }""", [cx, cy])
            await p.wait_for_timeout(40)
            ok(await p.evaluate("__tf.touch.abDist()") < 0.3, 'a new drag on it starts from zero again')
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test16: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
