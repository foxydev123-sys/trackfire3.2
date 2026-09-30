# Play Store readiness: privacy + delete-account pages (3 languages), account deletion in the game,
# asset links, service worker + offline start, and menus on a landscape phone.
import asyncio, os, subprocess, time, sys, tempfile, json, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8795; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b5-')
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
    env = {**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100', 'CONTACT_EMAIL': 'kurdishtank.help@example.com', 'ANDROID_PACKAGE': 'com.kurdishtank.app', 'ANDROID_SHA256': 'AA:BB:CC'}
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE); time.sleep(0.9)
    errs = []; res = {}
    B = f'http://localhost:{PORT}'
    try:
        res['assetlinks'] = json.loads(urllib.request.urlopen(B + '/.well-known/assetlinks.json').read())[0]['target']['package_name']
        res['swFiles'] = len(json.loads(urllib.request.urlopen(B + '/sw-files.json').read()))
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            ctx = await br.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
            await ctx.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            p = await ctx.new_page(); p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            for l in ['en', 'ar', 'ku']:
                await p.goto(f'{B}/privacy?lang={l}'); await p.wait_for_timeout(300); await p.screenshot(path=f'{OUT}/p-privacy-{l}.png', full_page=False)
            res['privacyMail'] = await p.evaluate("document.body.innerText.includes('kurdishtank.help@example.com')")
            await p.goto(f'{B}/delete-account?lang=ku'); await p.wait_for_timeout(300); await p.screenshot(path=f'{OUT}/p-delete-ku.png', full_page=True)
            await p.fill('#pid', 'Someone#1234'); await p.fill('#contact', 'me@example.com'); await p.click('#reqForm button'); await p.wait_for_timeout(400)
            res['requestSent'] = await p.evaluate("document.getElementById('reqMsg').className")
            # game: create account, then delete it from Settings
            await p.goto(B + '/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate('n => __tf.setName(n)', 'DeleteMe'); await menuClick(p, '#navProfile'); await p.wait_for_selector('.prof-head', timeout=8000)
            aid = await p.evaluate('__tf.acc.id'); await p.click('#btnBack'); await p.wait_for_timeout(1200)
            if await p.is_visible('#ecoModal'): await p.click('#ecoCard .mclose')
            await menuClick(p, '#btnSettings'); await p.wait_for_selector('#btnDelAcc'); await p.screenshot(path=f'{OUT}/p-settings.png')
            await p.click('#btnDelAcc'); await p.wait_for_selector('#cfY'); await p.screenshot(path=f'{OUT}/p-delete-confirm.png'); await p.click('#cfY')
            await p.wait_for_timeout(2500); await p.wait_for_selector('#scr-menu:not([hidden])')
            res['localAccountAfter'] = await p.evaluate("localStorage.getItem('kt-account')")
            try: urllib.request.urlopen(f'{B}/api/profile?id={aid}'); res['serverAccountAfter'] = 'still there'
            except Exception as e: res['serverAccountAfter'] = 'gone (' + str(getattr(e, 'code', e)) + ')'
            # service worker + offline start (own context: the worker fetches the real CDN, which this sandbox blocks)
            ctx2 = await br.new_context(viewport={'width': 1280, 'height': 800}); p = await ctx2.new_page()
            await p.goto(B + '/')
            # Wait for the worker to actually be in charge and finished saving its files, rather than
            # sleeping a fixed time — how long it takes depends on how many files the game has.
            try:
                await p.wait_for_function("navigator.serviceWorker.controller !== null", timeout=25000)
                await p.evaluate("navigator.serviceWorker.ready")
                await p.wait_for_function(
                    "(async () => { const ks = await caches.keys(); if (!ks.length) return false;"
                    " const c = await caches.open(ks[0]); const r = await c.keys(); return r.length > 10; })()",
                    timeout=25000)
            except Exception as e:
                print('  note: service worker did not settle in time —', str(e)[:80])
            res['swActive'] = await p.evaluate("navigator.serviceWorker.controller ? 'active' : 'none'")
            await ctx2.set_offline(True); await p.reload(); await p.wait_for_timeout(1500)
            res['offlineLoads'] = await p.evaluate("!!document.getElementById('scr-menu') && document.title")
            await ctx2.set_offline(False)
            # landscape phone menus (the Android app runs in landscape)
            ph = await br.new_page(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            await ph.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await ph.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await ph.goto(B + '/'); await ph.wait_for_selector('#scr-menu:not([hidden])'); await ph.evaluate("document.querySelector('#scr-menu [data-lang-seg] button[data-lang=\"ku\"]').click()")
            await ph.wait_for_function('window.__tf'); await ph.evaluate('n => __tf.setName(n)', 'Phone'); await ph.click('#btnGarage'); await ph.wait_for_selector('.tk-grid', timeout=8000)
            if await ph.is_visible('#ecoModal'): await ph.click('#ecoCard .mclose')
            await ph.screenshot(path=f'{OUT}/p-land-garage.png')
            await ph.click('#btnBack'); await ph.wait_for_timeout(700)
            if await ph.is_visible('#ecoModal'): await ph.screenshot(path=f'{OUT}/p-land-daily.png'); await ph.click('#ecoCard .mclose')
            await ph.screenshot(path=f'{OUT}/p-land-menu.png'); await ph.evaluate("document.getElementById('scr-menu').scrollTop = 9999"); await ph.wait_for_timeout(200); await ph.screenshot(path=f'{OUT}/p-land-menu-bottom.png')
            await menuClick(ph, '#btnShop'); await ph.wait_for_selector('.shop-grid'); await ph.screenshot(path=f'{OUT}/p-land-shop.png')
            res['gemsSectionShown'] = await ph.evaluate("!!document.getElementById('sec-gems')")
            res['landscapeOverflow'] = await ph.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, ensure_ascii=False, indent=1)); print('ERRORS', len(errs)); [print(e) for e in errs[:20]]
asyncio.run(main())
