# Night matches, bot variety, touch layout editor (phone) and the chest-opening sequence — mock three.js.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8797; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
async def mk(br, errs, tag, **kw):
    c = await br.new_context(service_workers='block', **kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
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

# Map, mode and time now live in the match-setup step, not in the team lobby. From the lobby the
# host reopens it with CHANGE, picks, and comes back.
async def setup_pick(pg, sel):
    await pg.click('#lbEditSetup')
    await pg.wait_for_selector('#scr-setup:not([hidden])')
    await pg.click(sel)
    await pg.click('#btnSuGo')
    await pg.wait_for_selector('#scr-lobby:not([hidden])')

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': tempfile.mkdtemp(), 'PAYMENTS_TEST': '1', 'REG_LIMIT': '100'}, stdout=subprocess.PIPE); time.sleep(0.9)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'A', viewport={'width': 1366, 'height': 800})
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            # practice room: night on, bots with random tanks/names
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Night'); await A.click('#btnPractice'); await A.wait_for_selector('#scr-lobby:not([hidden])')
            await A.wait_for_function("__tf.room && __tf.room.players.length >= 6", timeout=8000)
            res['todSegVisible'] = await A.is_visible('#lbEditSetup')
            await setup_pick(A, '#lbTodSeg [data-v=night]'); await A.wait_for_function("__tf.room.tod === 'night'", timeout=4000)
            await A.screenshot(path=f'{OUT}/n01-lobby-night.png')
            bots = await A.evaluate("__tf.room.players.filter(p => p.bot).map(p => [p.name, p.tank, p.lvl])"); res['bots'] = bots
            res['botTankKinds'] = len(set(b[1] for b in bots))
            await A.click('#btnStart'); await A.wait_for_selector('#hud:not([hidden])', timeout=8000); await A.wait_for_timeout(2500)
            res['roomNight'] = await A.evaluate("__tf.room.night"); res['worldNight'] = await A.evaluate("__tf.game.W.night")
            res['alive'] = await A.evaluate("__tf.net.meAlive")
            # fire a few shots so FX (sprites, lights, scorch) run
            for i in range(4): await A.keyboard.press('Space'); await A.wait_for_timeout(700)
            await A.wait_for_timeout(1500)
            await A.keyboard.press('Escape'); await A.click('#btnQuit'); await A.wait_for_selector('#scr-menu:not([hidden])', timeout=6000)
            res['nightOffInMenu'] = await A.evaluate("Object.values(__tf.game.W ? {a: __tf.game.W} : {}).every(W => !W.night)")
            # chest opening sequence
            await menuClick(A, '#btnShop'); await A.wait_for_selector('.shop-grid', timeout=8000)
            if await A.is_visible('#ecoModal'): await A.click('#ecoCard .mclose')
            await A.click('[data-buy=common][data-cur=coins]'); await A.wait_for_selector('#chestOpen.shaking', timeout=5000)
            res['preHidden'] = await A.evaluate("!!document.querySelector('.opened.pre')")
            await A.wait_for_selector('#chestOpen.open', timeout=4000); await A.wait_for_timeout(600)
            res['revealed'] = await A.evaluate("!document.querySelector('.opened.pre')")
            await A.screenshot(path=f'{OUT}/n02-chest-open.png'); await A.click('#ecoCard .mclose')
            # phone: touch layout editor
            B = await mk(br, errs, 'B', viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            await B.goto(f'http://localhost:{PORT}/'); await B.wait_for_selector('#scr-menu:not([hidden])'); await B.wait_for_timeout(900)
            if await B.is_visible('#ecoModal'): await B.click('#ecoCard .mclose')
            await menuClick(B, '#btnSettings'); await B.click('#btnTouchEdit'); await B.wait_for_selector('#tedit:not([hidden])')
            box = await B.evaluate("(() => { const r = document.getElementById('moveBase').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
            await B.mouse.move(box[0], box[1]); await B.mouse.down(); await B.mouse.move(box[0] + 150, box[1] - 90, steps=6); await B.mouse.up()
            await B.fill('#teSize', '140'); await B.dispatch_event('#teSize', 'input')
            await B.fill('#teAlpha', '30'); await B.dispatch_event('#teAlpha', 'input')
            await B.click('#teSel [data-v=fire]'); await B.fill('#teSize', '70'); await B.dispatch_event('#teSize', 'input')
            await B.screenshot(path=f'{OUT}/n03-touch-editor.png')
            res['layoutSaved'] = await B.evaluate("JSON.parse(localStorage.getItem('trackfire-settings')).touchLayout")
            await B.click('#teDone'); res['editorClosed'] = await B.is_hidden('#tedit'); res['settingsBack'] = await B.is_visible('#settings')
            await B.reload(); await B.wait_for_selector('#scr-menu:not([hidden])')
            res['layoutAfterReload'] = await B.evaluate("__tf && JSON.parse(localStorage.getItem('trackfire-settings')).touchLayout.move")
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, ensure_ascii=False, indent=1)); print('ERRORS', len(errs)); [print(e) for e in errs[:30]]
asyncio.run(main())
