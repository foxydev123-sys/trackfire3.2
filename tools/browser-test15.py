# The "Secret button" row in Settings: it is visible and labelled in all three languages,
# 13 taps reveal the gem button, fewer than 13 do not, the gem button actually pays out,
# and once found it stays revealed after a reload.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8815; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b15-')

async def taps(p, n):
    for _ in range(n):
        await p.click('#stBrand'); await p.wait_for_timeout(60)   # well inside the 2.5 s window

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
            ctx = await br.new_context(viewport={'width': 844, 'height': 390}, has_touch=True,
                                       is_mobile=True, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Hemin')")

            await menuClick(p, '#btnSettings'); await p.wait_for_selector('#settings:not([hidden])')

            # 1. the row is there, visible and labelled in every language
            ok(await p.is_visible('#stBrand'), 'the Secret button row is visible in Settings')
            for lang, want in (('en', 'SECRET'), ('ar', 'السري'), ('ku', 'نهێنی')):
                await p.evaluate(f"__tf.setLang('{lang}')")
                txt = await p.inner_text('#stBrand')
                ok(want in txt, f'it is labelled in {lang} ({txt.strip()})')
            await p.evaluate("__tf.setLang('en')")

            # 2. fewer than 13 taps does nothing
            await taps(p, 12)
            ok(await p.get_attribute('#btnCheat', 'hidden') is not None, '12 taps do not reveal the gem button')

            # 3. the 13th reveals it
            await taps(p, 1)
            await p.wait_for_selector('#btnCheat:not([hidden])', timeout=3000)
            ok(True, 'the 13th tap reveals the gem button')

            # 4. pressing it sends the request and says something back. What the server actually
            # pays out is covered by cheat-test.js and economy-test.js, which drive a real account.
            await p.evaluate("window.__ecoOps = []; const a = __tf.acc, r = a.eco.bind(a); a.eco = (op, d) => { window.__ecoOps.push(op); return r(op, d); };")
            await p.click('#btnCheat'); await p.wait_for_timeout(700)
            ok(await p.evaluate("window.__ecoOps.includes('cheat')"), 'pressing it asks the server for the test gems')
            ok(await p.is_visible('#toast'), 'and it tells you what happened')

            # 5. still revealed after a reload, with no re-tapping
            await p.reload(); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf')
            await menuClick(p, '#btnSettings'); await p.wait_for_selector('#settings:not([hidden])')
            ok(await p.get_attribute('#btnCheat', 'hidden') is None, 'it stays revealed after a reload')

            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test15: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
