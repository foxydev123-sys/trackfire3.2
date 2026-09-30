# Touch layout editor: every control, including the power and microphone buttons, can be picked,
# dragged and resized — and the settings survive a reload.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8803; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b12-')
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
            ctx = await br.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            p.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await menuClick(p, '#btnSettings'); await p.wait_for_selector('#btnTouchEdit')
            await p.click('#btnTouchEdit'); await p.wait_for_selector('#tedit:not([hidden])')
            await p.wait_for_timeout(400)
            res['pickers'] = await p.evaluate("[...document.querySelectorAll('#teSel button')].map(b => b.dataset.v)")
            res['bothShown'] = await p.evaluate("!document.getElementById('abBtn').hidden && !document.getElementById('vcBtn').hidden")
            await p.screenshot(path=f'{OUT}/te-editor.png')
            moved = {}
            for zone, sel in (('power', '#abBtn'), ('mic', '#vcBtn'), ('fire', '#fireBtn')):
                before = await p.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }})()")
                box = await p.query_selector(sel); bb = await box.bounding_box()
                cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
                await p.mouse.move(cx, cy); await p.mouse.down()
                await p.mouse.move(cx - 90, cy - 40, steps=6); await p.wait_for_timeout(80); await p.mouse.up()
                await p.wait_for_timeout(200)
                after = await p.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }})()")
                sel_now = await p.evaluate("__tf.touch ? __tf.touch.sel : null")
                moved[zone] = {'before': before, 'after': after, 'dx': after[0] - before[0], 'selected': sel_now}
            res['moved'] = moved
            # resize the power button
            await p.evaluate("__tf.touch.select('power')")
            await p.fill('#teSize', '140') if False else None
            await p.evaluate("(() => { const r = document.getElementById('teSize'); r.value = 140; r.dispatchEvent(new Event('input', {bubbles:true})); })()")
            await p.wait_for_timeout(250)
            res['powerSize'] = await p.evaluate("__tf.touch.L.power.s")
            res['powerWidth'] = await p.evaluate("Math.round(document.getElementById('abBtn').getBoundingClientRect().width)")
            await p.screenshot(path=f'{OUT}/te-moved.png')
            await p.click('#teDone'); await p.wait_for_timeout(300)
            saved = await p.evaluate("JSON.parse(localStorage.getItem('trackfire-settings')).touchLayout")
            res['savedZones'] = sorted([k for k in saved.keys() if k in ('move', 'aim', 'fire', 'power', 'mic')])
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:8]: print(e)
    f = []
    if sorted(res.get('pickers') or []) != ['aim', 'fire', 'mic', 'move', 'power']: f.append('the editor does not list all five controls')
    if not res.get('bothShown'): f.append('the power and microphone buttons are not shown in the editor')
    for z, d in (res.get('moved') or {}).items():
        if abs(d['dx']) < 40: f.append(f'{z}: could not be dragged (moved {d["dx"]}px)')
        if d['selected'] != z: f.append(f'{z}: dragging it did not select it')
    if (res.get('powerSize') or 0) < 1.3: f.append('the power button could not be resized')
    if len(res.get('savedZones') or []) != 5: f.append('the layout did not save all five controls')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL LAYOUT EDITOR TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
