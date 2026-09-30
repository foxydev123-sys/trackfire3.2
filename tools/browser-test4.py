# Economy UI in a real browser (mock three.js): daily reward, lucky wheel, shop, chest opening,
# test gem purchase, garage + upgrade, quests, match reward card — desktop (EN/AR) and phone (KU).
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8793; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b4-')
async def mk(br, errs, tag, **kw):
    c = await br.new_context(**kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
async def shot(p, name): await p.screenshot(path=f'{OUT}/{name}.png')
async def lang(p, l): await p.evaluate(f"document.querySelector('#scr-menu [data-lang-seg] button[data-lang=\"{l}\"]').click()")
async def overflow(p): return await p.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
async def close_modal(p):
    if await p.is_visible('#ecoModal'): await p.click('#ecoCard [data-close]'); await p.wait_for_timeout(150)
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
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'PAYMENTS_TEST': '1', 'REG_LIMIT': '100'}, stdout=subprocess.PIPE); time.sleep(0.9)
    errs = []; res = {}; ov = []
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'A', viewport={'width': 1366, 'height': 800})
            B = await mk(br, errs, 'B', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            for p in (A, B):
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await lang(A, 'en'); await lang(B, 'ku')
            # --- A: account via Garage
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Solomon'); await menuClick(A, '#navProfile'); await A.wait_for_selector('.prof-head', timeout=8000)
            await A.click('#btnBack'); await A.wait_for_selector('#ecoModal:not([hidden])', timeout=6000)   # daily pops up by itself
            await shot(A, 'e01-daily-en'); await A.click('#dClaim'); await A.wait_for_selector('.gotbox'); await shot(A, 'e02-daily-got-en'); await close_modal(A)
            await shot(A, 'e03-home-en')
            res['walletA'] = await A.evaluate('({c: __tf.acc.wallet.coins, g: __tf.acc.wallet.gems})')
            # wheel
            await menuClick(A, '#btnWheel'); await A.wait_for_selector('#wheelSvg'); await shot(A, 'e04-wheel-en')
            await A.click('#spinFree'); await A.wait_for_selector('.gotbox', timeout=8000); await shot(A, 'e05-wheel-got-en'); await close_modal(A)
            # shop: chest (coins), odds, test purchase
            await menuClick(A, '#btnShop'); await A.wait_for_selector('.shop-grid'); await A.wait_for_timeout(200); await shot(A, 'e06-shop-en')
            await A.click('[data-odds=rare]'); await A.wait_for_selector('.odds'); await shot(A, 'e07-odds-en'); await close_modal(A)
            await A.click('[data-buy=common][data-cur=coins]'); await A.wait_for_selector('.opened'); await A.wait_for_timeout(2600); await shot(A, 'e08-chest-open-en'); await close_modal(A)
            await A.click('[data-gem=gems_500]'); await A.wait_for_selector('.gotbox', timeout=6000); await shot(A, 'e09-gems-bought-en'); await close_modal(A)
            res['afterBuy'] = await A.evaluate('({c: __tf.acc.wallet.coins, g: __tf.acc.wallet.gems})')
            # get cards: buy a rare chest with gems (confirm dialog), then garage
            await A.click('[data-buy=rare][data-cur=gems]'); await A.wait_for_selector('#cfY'); await A.click('#cfY'); await A.wait_for_selector('.opened'); await A.wait_for_timeout(1500); await close_modal(A)
            await A.click('#btnBack'); await A.click('#btnGarage'); await A.wait_for_selector('.tk-grid'); await A.wait_for_timeout(200); await shot(A, 'e10-garage-en')
            up = await A.evaluate("[...document.querySelectorAll('.tk-card')].find(b => b.querySelector('.tk-up'))?.dataset.t || null")
            res['upgradable'] = up
            if up:
                await A.click(f'.tk-card[data-t={up}]'); await A.wait_for_timeout(150); await shot(A, 'e10b-garage-stats-en')
                await A.click('#tkDetail [data-up]:not([disabled])'); await A.wait_for_selector('.lvup', timeout=5000); await shot(A, 'e11-levelup-en'); await close_modal(A)
                res['statUpgrade'] = await A.evaluate(f"__tf.acc.wallet.tanks['{up}'].mods")
            locked = await A.evaluate("document.querySelector('.tk-card.locked')?.dataset.t || null")
            if locked: await A.click(f'.tk-card[data-t={locked}]'); await A.wait_for_timeout(150); await shot(A, 'e12-garage-locked-en')
            # quests
            await A.click('#btnBack'); await menuClick(A, '#btnQuests'); await A.wait_for_selector('.qlist'); await shot(A, 'e13-quests-en')
            # Arabic garage + shop
            await A.click('#btnBack'); await lang(A, 'ar'); await A.click('#btnGarage'); await A.wait_for_selector('.tk-grid'); await shot(A, 'e14-garage-ar')
            await A.click('#btnBack'); await menuClick(A, '#btnShop'); await A.wait_for_selector('.shop-grid'); await shot(A, 'e15-shop-ar')
            ov.append(('A-ar-shop', await overflow(A)))
            # practice match → end → reward card (practice gives none; then show a sample reward)
            await A.click('#btnBack'); await lang(A, 'en'); await A.click('#btnPractice'); await A.wait_for_selector('#scr-lobby:not([hidden])')
            await A.wait_for_function("__tf.room && __tf.room.players.length >= 6", timeout=8000); await A.click('#btnStart'); await A.wait_for_selector('#hud:not([hidden])', timeout=8000)
            await A.wait_for_timeout(1200); res['practiceTank'] = await A.evaluate("__tf.room.players.find(p => p.id === __tf.net.myId).tank")
            await A.keyboard.press('Escape'); await A.click('#btnEndMatch'); await A.wait_for_selector('#endcard:not([hidden])', timeout=5000)
            await A.evaluate("__tf.hud.showReward({coins: 72, gems: 2, chests: ['common'], quests: [{id:'kills', prog: 5, need: 8}, {id:'play', prog: 3, need: 3}]})"); await A.wait_for_timeout(200); await shot(A, 'e16-endcard-reward-en')
            # --- B: phone, Kurdish
            await B.wait_for_function('window.__tf'); await B.evaluate('n => __tf.setName(n)', 'Lina'); await B.click('#btnGarage'); await B.wait_for_selector('.tk-grid', timeout=8000)
            await close_modal(B); await shot(B, 'e20-garage-ku-phone'); ov.append(('B-garage', await overflow(B)))
            await B.click('#btnBack'); await B.wait_for_timeout(900); await close_modal(B); await B.wait_for_timeout(300); await shot(B, 'e21-home-ku-phone'); ov.append(('B-home', await overflow(B)))
            await menuClick(B, '#btnDaily'); await B.wait_for_selector('.daily'); await shot(B, 'e22-daily-ku-phone'); await close_modal(B)
            await menuClick(B, '#btnWheel'); await B.wait_for_selector('#wheelSvg'); await shot(B, 'e23-wheel-ku-phone'); ov.append(('B-wheel', await overflow(B))); await close_modal(B)
            await menuClick(B, '#btnShop'); await B.wait_for_selector('.shop-grid'); await shot(B, 'e24-shop-ku-phone'); ov.append(('B-shop', await overflow(B)))
            await B.click('[data-buy=common][data-cur=coins]'); await B.wait_for_selector('.opened'); await B.wait_for_timeout(2600); await shot(B, 'e25-chest-ku-phone'); await close_modal(B)
            await B.click('#btnBack'); await menuClick(B, '#btnQuests'); await B.wait_for_selector('.qlist'); await shot(B, 'e26-quests-ku-phone'); ov.append(('B-quests', await overflow(B)))
            await br.close()
    finally:
        srv.terminate()
    res['overflow'] = [o for o in ov if o[1]]
    print(json.dumps(res, ensure_ascii=False, indent=1)); print('ERRORS', len(errs)); [print(e) for e in errs[:30]]
asyncio.run(main())
