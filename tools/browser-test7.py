# Each new party mode in a practice match (mock three.js): starts, runs, shows its objective, no errors.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8798; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
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
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': tempfile.mkdtemp()}, stdout=subprocess.PIPE); time.sleep(0.9)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            c = await br.new_context(viewport={'width': 1280, 'height': 720}, service_workers='block'); p = await c.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            p.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate('n => __tf.setName(n)', 'Tester'); await p.click('#btnPractice'); await p.wait_for_selector('#scr-lobby:not([hidden])')
            await p.wait_for_function("__tf.room && __tf.room.players.length >= 6", timeout=8000)
            await p.screenshot(path=f'{OUT}/m00-lobby-modes.png')
            for mode in ['convoy', 'jugg', 'ball', 'surv', 'potato', 'bounty']:
                await setup_pick(p, f'#lbModeSeg [data-mode={mode}]'); await p.wait_for_function(f"__tf.room.mode === '{mode}'", timeout=4000)
                await p.click('#btnStart'); await p.wait_for_selector('#hud:not([hidden])', timeout=8000)
                for i in range(8): await p.keyboard.press('Space'); await p.wait_for_timeout(500)
                res[mode] = await p.evaluate("({obj: !document.getElementById('objLine').hidden, txt: document.getElementById('objLine').textContent.slice(0, 60), props: __tf.game.mp ? Object.keys(__tf.game.mp) : [], score: document.getElementById('sBlue').textContent + '-' + document.getElementById('sRed').textContent})")
                await p.screenshot(path=f'{OUT}/m-{mode}.png')
                await p.keyboard.press('Escape'); await p.click('#btnEndMatch'); await p.wait_for_selector('#endcard:not([hidden])', timeout=6000)
                await p.wait_for_function("__tf.room.state === 'lobby'", timeout=20000)
                await p.wait_for_selector('#scr-lobby:not([hidden])', timeout=6000)
            await p.click('#btnLeave'); await menuClick(p, '#btnModes'); await p.wait_for_timeout(500); await p.screenshot(path=f'{OUT}/m-modes-page.png', full_page=True)
            res['modeCards'] = await p.evaluate("document.querySelectorAll('.mode').length")
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, ensure_ascii=False, indent=1)); print('ERRORS', len(errs)); [print(e) for e in errs[:20]]
asyncio.run(main())
