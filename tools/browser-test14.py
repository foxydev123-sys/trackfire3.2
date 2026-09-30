# First run: name → birth year → city, and what the server actually stores (an age group, never a date).
# Also: the callsign box is gone from the menu, and the name/city can be changed in the profile.
import asyncio, os, subprocess, time, sys, tempfile, json, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8808; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b14-')
async def mk(br, errs, tag, **kw):
    c = await br.new_context(service_workers='block', **kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
async def close_modal(p):
    for _ in range(4):
        if await p.is_visible('#ecoModal'):
            try: await p.click('#ecoCard .mclose', timeout=2000)
            except Exception:
                try: await p.click('#ecoCard [data-close]', timeout=2000)
                except Exception: await p.evaluate("document.getElementById('ecoModal').hidden = true")
            await p.wait_for_timeout(300)
        else: return
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
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'adult', viewport={'width': 1280, 'height': 820})
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            res['callsignGone'] = await A.evaluate("!document.querySelector('label[for=nameInp]')")
            res['menuIcons'] = await A.evaluate("document.querySelectorAll('#scr-menu .btn .bi').length")
            # the welcome screen appears the first time you try to play online
            await A.click('#btnQuick'); await A.wait_for_selector('#welcome:not([hidden])', timeout=10000)
            await A.screenshot(path=f'{OUT}/wc-1-name.png')
            res['step1'] = await A.evaluate("!!document.querySelector('.wc-step[data-step=\"0\"]:not([hidden])')")
            await A.click('#wcNext')                                  # empty name is refused
            res['emptyNameRefused'] = await A.evaluate("!document.getElementById('wcErr').hidden")
            await A.fill('#wcName', 'Hemin'); await A.click('#wcNext'); await A.wait_for_timeout(250)
            res['step2'] = await A.evaluate("!!document.querySelector('.wc-step[data-step=\"1\"]:not([hidden])')")
            await A.screenshot(path=f'{OUT}/wc-2-age.png')
            await A.click('#wcNext')                                  # no year picked yet
            res['noYearRefused'] = await A.evaluate("!document.getElementById('wcErr').hidden")
            await A.click('#wcYears button[data-y="2000"]'); await A.click('#wcNext'); await A.wait_for_timeout(250)
            res['step3'] = await A.evaluate("!!document.querySelector('.wc-step[data-step=\"2\"]:not([hidden])')")
            await A.click('.wc-cities button[data-c="Hawler"]')
            await A.screenshot(path=f'{OUT}/wc-3-city.png')
            await A.click('#wcNext')
            await A.wait_for_function("__tf.acc && __tf.acc.has", timeout=12000)
            res['account'] = await A.evaluate("({ name: __tf.acc.acc.name, group: __tf.acc.ageGroup, city: __tf.acc.city })")
            aid = await A.evaluate("__tf.acc.id")
            prof = json.loads(urllib.request.urlopen(f'http://localhost:{PORT}/api/profile?id={aid}').read())
            res['profileCity'] = prof.get('city')
            res['noBirthYearInProfile'] = 'birthYear' not in json.dumps(prof)
            # the welcome screen never comes back
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            await A.wait_for_timeout(900)
            res['welcomeHiddenSecondTime'] = await A.evaluate("document.getElementById('welcome').hidden")
            await close_modal(A)
            # change the name and the city from the profile
            await close_modal(A)
            await menuClick(A, '#navProfile'); await A.wait_for_selector('.prof-head', timeout=10000)
            await A.wait_for_timeout(400)
            await A.screenshot(path=f'{OUT}/wc-profile.png')
            res['editButtons'] = await A.evaluate("[...document.querySelectorAll('.prof-actions [data-a]')].map(b => b.dataset.a)")
            await close_modal(A)
            await A.click('.prof-actions [data-a="city"]'); await A.wait_for_selector('#pmIn')
            await A.fill('#pmIn', 'Duhok'); await A.click('#pmOk'); await A.wait_for_timeout(900)
            prof2 = json.loads(urllib.request.urlopen(f'http://localhost:{PORT}/api/profile?id={aid}').read())
            res['cityAfterEdit'] = prof2.get('city')
            # a child's account turns voice chat off
            B = await mk(br, errs, 'kid', viewport={'width': 1280, 'height': 820})
            await B.goto(f'http://localhost:{PORT}/'); await B.wait_for_selector('#scr-menu:not([hidden])')
            await B.evaluate("(() => { const s = JSON.parse(localStorage.getItem('trackfire-settings') || '{}'); s.voice = true; localStorage.setItem('trackfire-settings', JSON.stringify(s)); })()")
            await B.reload(); await B.wait_for_selector('#scr-menu:not([hidden])')
            await B.click('#btnQuick'); await B.wait_for_selector('#welcome:not([hidden])', timeout=10000)
            await B.fill('#wcName', 'Bawan'); await B.click('#wcNext'); await B.wait_for_timeout(200)
            await B.click('#wcYears button[data-y="2018"]'); await B.click('#wcNext'); await B.wait_for_timeout(200)
            await B.click('#wcSkip')
            await B.wait_for_function("__tf.acc && __tf.acc.has", timeout=12000)
            await B.wait_for_timeout(700)
            res['kid'] = await B.evaluate("({ group: __tf.acc.ageGroup, city: __tf.acc.city, voice: JSON.parse(localStorage.getItem('trackfire-settings')).voice })")
            # a new player who presses PRACTICE first gets the same first-run screen, then the lobby
            C = await mk(br, errs, 'practice', viewport={'width': 1280, 'height': 820})
            await C.goto(f'http://localhost:{PORT}/'); await C.wait_for_selector('#scr-menu:not([hidden])')
            await C.click('#btnPractice'); await C.wait_for_selector('#welcome:not([hidden])', timeout=8000)
            await C.fill('#wcName', 'Rebin'); await C.click('#wcNext'); await C.wait_for_timeout(200)
            await C.click('#wcYears button[data-y="1995"]'); await C.click('#wcNext'); await C.wait_for_timeout(200)
            await C.click('#wcSkip')
            try:
                await C.wait_for_selector('#scr-lobby:not([hidden])', timeout=10000); res['practiceFirst'] = True
            except Exception: res['practiceFirst'] = False
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:8]: print(e)
    f = []
    if not res.get('callsignGone'): f.append('the callsign box is still on the menu')
    if (res.get('menuIcons') or 0) < 6: f.append(f"the menu buttons are missing icons ({res.get('menuIcons')})")
    for k in ('step1', 'step2', 'step3'): 
        if not res.get(k): f.append(f'{k} of the welcome screen did not show')
    if not res.get('emptyNameRefused'): f.append('an empty name was accepted')
    if not res.get('noYearRefused'): f.append('it let us past the age step without a year')
    a = res.get('account') or {}
    if a.get('name') != 'Hemin': f.append('the name was not saved')
    if a.get('group') != 'adult': f.append(f"wrong age group for someone born in 2000 ({a.get('group')})")
    if res.get('profileCity') != 'Hawler': f.append(f"the city did not save ({res.get('profileCity')})")
    if not res.get('noBirthYearInProfile'): f.append('the birth year leaked into the profile')
    if not res.get('welcomeHiddenSecondTime'): f.append('the welcome screen came back a second time')
    if 'rename' not in (res.get('editButtons') or []): f.append('the profile has no name-change button')
    if res.get('cityAfterEdit') != 'Duhok': f.append(f"changing the city from the profile did not work ({res.get('cityAfterEdit')})")
    k = res.get('kid') or {}
    if k.get('group') != 'kid': f.append(f"wrong age group for someone born in 2018 ({k.get('group')})")
    if k.get('voice') is not False: f.append('voice chat was not switched off for an under-13 account')
    if k.get('city'): f.append('Skip still saved a city')
    if not res.get('practiceFirst'): f.append('pressing PRACTICE as a new player did not open the welcome screen and then the lobby')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL FIRST-RUN TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
