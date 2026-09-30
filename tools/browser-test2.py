# Practice mode (Web Worker server + 5 bots) combat soak + reconnect-after-reload test.
import asyncio, json, subprocess, os, time, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8766; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
async def mk(br, errs, tag, **kw):
    c = await br.new_context(service_workers='block', **kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE); time.sleep(0.8)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            # --- practice
            P = await mk(br, errs, 'P', viewport={'width': 1280, 'height': 720})
            await P.goto(f'http://localhost:{PORT}/'); await P.wait_for_selector('#scr-menu:not([hidden])')
            await P.wait_for_function('window.__tf'); await P.evaluate('n => __tf.setName(n)', 'Solo'); await P.click('#btnPractice')
            await P.wait_for_function("document.querySelectorAll('#lbPlayers li').length===6", timeout=10000)
            await P.wait_for_timeout(300)
            await P.click('#btnStart'); await P.wait_for_selector('#hud:not([hidden])', timeout=8000)
            await P.keyboard.press('F3')
            await P.mouse.move(700, 300); await P.keyboard.down('KeyW')
            for i in range(40):
                await P.mouse.down(); await asyncio.sleep(0.1); await P.mouse.up(); await asyncio.sleep(0.4)
            await P.keyboard.up('KeyW')
            await P.screenshot(path=f'{OUT}/07-practice.png')
            res['practice'] = await P.evaluate("""({pads: __tf.game.W.pads.length, padsOn: __tf.room.pads.filter(x=>x>=0).length, logo: document.querySelector('.mn-logo').textContent, map: __tf.room.map, kills: __tf.room.players.reduce((a,p)=>a+p.k,0), deaths: __tf.room.players.reduce((a,p)=>a+p.d,0),
               feed: document.querySelectorAll('#killfeed .kf').length, fps: __tf.game.perf.fps, views: __tf.game.views.size, shellsLive: __tf.game.W.shells.list.length,
               fxActive: __tf.game.W.fx.act.length, snaps: __tf.net.st.snapsPS})""")
            # --- networked reconnect: create room, add bot, start, reload page, expect same player id back in game
            A = await mk(br, errs, 'A', viewport={'width': 1280, 'height': 720})
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Host'); await A.click('#btnCreate')
            # match setup comes first now: mode, map and time, then open the lobby
            await A.wait_for_selector('#scr-setup:not([hidden])'); await A.click('#btnSuGo')
            await A.wait_for_function("__tf.room && __tf.room.code", timeout=8000)
            await A.click('#btnAddBot'); await A.wait_for_timeout(300); await A.click('#btnStart')
            await A.wait_for_selector('#hud:not([hidden])'); await A.wait_for_timeout(1500)
            id1 = await A.evaluate('__tf.net.myId'); code = await A.evaluate('__tf.room.code')
            await A.reload(); await A.wait_for_selector('#hud:not([hidden])', timeout=10000); await A.wait_for_timeout(1500)
            res['reconnect'] = await A.evaluate(f"({{sameId: __tf.net.myId==={id1}, code: __tf.room.code==='{code}', players: __tf.room.players.length, alive: __tf.net.meAlive, state: __tf.room.state}})")
            # host ends match → end card → lobby
            await A.keyboard.press('Escape'); await A.click('#btnEndMatch')
            await A.wait_for_selector('#endcard:not([hidden])', timeout=5000); res['endcard'] = True
            await A.screenshot(path=f'{OUT}/08-endcard.png')
            await br.close()
    finally: srv.terminate()
    print(json.dumps(res, indent=1)); print('\n'.join(errs[:30]) if errs else 'NO BROWSER ERRORS')
asyncio.run(main())
