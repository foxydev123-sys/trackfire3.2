# Friends' profiles: open a friend from the list, see their rank, stats, recent matches and their tanks + powers.
import asyncio, os, subprocess, time, sys, tempfile, json, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8801; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b10-')
def api(path, body=None, acc=None):
    req = urllib.request.Request(f'http://localhost:{PORT}{path}', method='POST' if body else 'GET',
        data=json.dumps(body).encode() if body else None, headers={'Content-Type': 'application/json', **({'Authorization': f"Bearer {acc['id']}.{acc['secret']}"} if acc else {})})
    return json.loads(urllib.request.urlopen(req).read())
async def mk(br, errs, tag, **kw):
    c = await br.new_context(**kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p

async def closeDaily(p):
    """The daily-reward popup opens by itself for an account that has not claimed today."""
    try:
        if await p.is_visible('#ecoModal'):
            for sel in ['#ecoCard .mclose', '#ecoCard [data-close]']:
                el = await p.query_selector(sel)
                if el: await el.click(); break
            else: await p.evaluate("document.getElementById('ecoModal').hidden = true")
            await p.wait_for_timeout(200)
    except Exception:
        pass

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
        friend = api('/api/register', {'name': 'Lina'})
        res['friendProfileApi'] = api(f"/api/profile?id={friend['id']}").get('garage')
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'desktop', viewport={'width': 1366, 'height': 860})
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Hemin')
            await A.wait_for_timeout(400); await closeDaily(A)
            await menuClick(A, '#navFriends'); await A.wait_for_selector('#addForm', timeout=10000)
            # become friends: Hemin asks, Lina accepts (over the API)
            await A.fill('#addId', f"{friend['name']}#{friend['tag']}"); await A.click('#addForm button')
            await A.wait_for_timeout(700)
            me = await A.evaluate('__tf.acc.id')
            await A.wait_for_timeout(100)
            res['requested'] = True
            # Lina accepts in her own tab
            B = await mk(br, errs, 'friend', viewport={'width': 1200, 'height': 800})
            seed = json.dumps({'id': friend['id'], 'secret': friend['secret'], 'name': friend['name'], 'tag': friend['tag']})
            await B.add_init_script(f"try {{ localStorage.setItem('kt-account', JSON.stringify({seed})); }} catch (e) {{}}")
            await B.goto(f'http://localhost:{PORT}/'); await B.wait_for_selector('#scr-menu:not([hidden])')
            await B.wait_for_timeout(900); await closeDaily(B)
            await menuClick(B, '#navFriends'); await B.wait_for_selector('#addForm', timeout=10000)
            await B.wait_for_timeout(600)
            acc_btn = await B.query_selector('[data-acc]')
            if acc_btn: await acc_btn.click()
            await B.wait_for_timeout(800)
            # Hemin: open his friend's profile from the list
            await A.wait_for_selector('.fitem [data-prof]', timeout=10000)
            await A.click('.fitem [data-prof]')
            await A.wait_for_selector('.prof-head', timeout=10000)
            await A.wait_for_timeout(700)
            res['profileName'] = await A.evaluate("document.querySelector('.prof-head .nm')?.textContent || null")
            res['hasStats'] = await A.evaluate("document.querySelectorAll('.stats .stat').length")
            res['hasRecent'] = await A.evaluate("!!document.querySelector('.hist')")
            res['tankCards'] = await A.evaluate("document.querySelectorAll('.pg-tank').length")
            res['tankAbility'] = await A.evaluate("document.querySelector('.pg-tank .ab')?.textContent?.trim() || null")
            res['playingNow'] = await A.evaluate("!!document.querySelector('.pg-tank.cur')")
            await A.screenshot(path=f'{OUT}/friend-profile.png', full_page=True)
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:10]: print(e)
    f = []
    if not res.get('friendProfileApi'): f.append('the profile API does not return the garage')
    if res.get('profileName') != 'Lina': f.append("the friend's profile did not open")
    if not res.get('hasStats'): f.append('no stats on the profile')
    if not res.get('hasRecent'): f.append('no recent matches on the profile')
    if not res.get('tankCards'): f.append('their tanks are not shown')
    if not res.get('tankAbility'): f.append('their tank power is not shown')
    if not res.get('playingNow'): f.append('the tank they play is not marked')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL FRIEND PROFILE TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
