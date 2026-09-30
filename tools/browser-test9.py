# The draw (mode + map reels) before a quick match, and the ranked screen after the one-queue rework.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b9-')
async def mk(br, errs, tag, **kw):
    c = await br.new_context(**kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100', 'QUICK_COUNTDOWN_S': '2'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'desktop', viewport={'width': 1366, 'height': 800})
            await A.goto(f'http://localhost:{PORT}/'); await A.wait_for_selector('#scr-menu:not([hidden])')
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Hemin')
            # ranked screen: one queue, the six modes listed, no size picker
            await A.click('#btnRanked'); await A.wait_for_selector('.rk-modes', timeout=10000)
            res['sizePickerGone'] = await A.evaluate("!document.getElementById('sizeSeg')")
            res['rankedModes'] = await A.evaluate("[...document.querySelectorAll('.rk-mode')].map(e => e.textContent)")
            await A.screenshot(path=f'{OUT}/rev-ranked.png')
            await A.click('#btnBack')
            # quick match → the draw plays before the loading screen
            await A.click('#btnQuick'); await A.wait_for_selector('#scr-lobby:not([hidden])', timeout=12000)
            watch = asyncio.create_task(A.evaluate("""(async () => {
                const out = { appeared: false, modeText: '', mapText: '', movedMode: false, movedMap: false, loadAfter: false, gone: false };
                const t0 = Date.now(); let m0 = null, p0 = null;
                while (Date.now() - t0 < 30000) {
                  const el = document.getElementById('revScr');
                  if (el && !el.hidden) {
                    out.appeared = true;
                    const m = document.getElementById('revModes'), p = document.getElementById('revMaps');
                    const my = m ? m.getBoundingClientRect().top : 0, py = p ? p.getBoundingClientRect().top : 0;
                    if (m0 === null) { m0 = my; p0 = py; }
                    if (Math.abs(my - m0) > 40) out.movedMode = true;
                    if (Math.abs(py - p0) > 40) out.movedMap = true;
                    out.modeText = document.querySelector('#revModes') ? (document.getElementById('revSub').textContent || '') : '';
                    const ls = document.getElementById('loadScr');
                    out.loadAfter = out.loadAfter || !!(ls && !ls.hidden);
                    window.__revSeen = (window.__revSeen || 0) + 1;
                  } else if (out.appeared) { out.gone = true; break; }
                  await new Promise(r => setTimeout(r, 60));
                }
                return out;
            })()"""))
            await A.wait_for_function("(() => { const e = document.getElementById('revScr'); return e && !e.hidden; })()", timeout=30000)
            await A.wait_for_timeout(700); await A.screenshot(path=f'{OUT}/rev-spin.png')
            await A.wait_for_timeout(1450); await A.screenshot(path=f'{OUT}/rev-land.png')
            seen = await watch
            res['draw'] = seen
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:10]: print(e)
    f = []
    d = res.get('draw') or {}
    if not res.get('sizePickerGone'): f.append('the 3v3 / 5v5 picker is still there')
    if len(res.get('rankedModes') or []) != 6: f.append('the ranked screen does not list the six modes')
    if not d.get('appeared'): f.append('the draw never appeared before the match')
    if not d.get('movedMode'): f.append('the mode reel did not spin')
    if not d.get('movedMap'): f.append('the map reel did not spin')
    if not d.get('gone'): f.append('the draw never went away')
    if not d.get('modeText'): f.append('the draw did not name the mode and map it landed on')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL DRAW TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
