# The in-game HUD keeps the same corners in English, Arabic and Kurdish — the kill feed
# especially — and the lines inside it read the right way round.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8807; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b13-')
PANELS = {'killfeed': '#killfeed', 'health': '.h-health', 'minimap': '#minimap', 'roomInfo': '.topright'}
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
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Hemin')")
            await p.click('#btnPractice'); await p.wait_for_selector('#scr-lobby:not([hidden])')
            await p.wait_for_function("__tf.room && __tf.room.players.length>=4", timeout=10000)
            await p.click('#btnStart'); await p.wait_for_selector('#hud:not([hidden])', timeout=10000)
            await p.wait_for_timeout(1500)
            for lang in ('en', 'ar', 'ku'):
                await p.evaluate(f"__tf.setLang('{lang}')")
                await p.evaluate("""(() => { const h = __tf.hud, r = __tf.room;
                  const a = r.players[0], b = r.players[1] || r.players[0];
                  h.feed = [{ k: a, v: b, t: performance.now() }, { k: b, v: a, t: performance.now() }];
                  h.renderFeed(); })()""")
                await p.wait_for_timeout(350)
                res[lang] = await p.evaluate("""(() => {
                    const out = { dir: document.documentElement.dir || 'ltr', boxes: {} };
                    for (const [k, sel] of Object.entries(%s)) {
                      const e = document.querySelector(sel);
                      if (!e) continue;
                      const r = e.getBoundingClientRect();
                      out.boxes[k] = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
                    }
                    const kf = document.querySelector('.kf');
                    out.feedLines = document.querySelectorAll('.kf').length;
                    out.flipped = kf ? getComputedStyle(kf.querySelector('svg')).transform : '';
                    return out;
                  })()""" % json.dumps(PANELS))
                await p.screenshot(path=f'{OUT}/lang-hud-{lang}.png')
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:8]: print(e)
    f = []
    base = res.get('en', {}).get('boxes', {})
    for lang in ('ar', 'ku'):
        b = res.get(lang, {}).get('boxes', {})
        if res.get(lang, {}).get('dir') != 'rtl': f.append(f'{lang}: the page is not right-to-left')
        for k, v in base.items():
            if k not in b: f.append(f'{lang}: {k} is missing'); continue
            # a panel is pinned to one edge; the text length may change its width, not its corner
            W = 844
            side = 'l' if v['l'] < W - v['r'] else 'r'
            mine = b[k][side] if side == 'l' else W - b[k]['r']
            theirs = v[side] if side == 'l' else W - v['r']
            if abs(mine - theirs) > 4 or abs(b[k]['t'] - v['t']) > 4:
                f.append(f"{lang}: {k} moved (English {side}={theirs},{v['t']} vs {mine},{b[k]['t']})")
        if not res[lang].get('feedLines'): f.append(f'{lang}: the kill feed is empty')
        if 'matrix' not in (res[lang].get('flipped') or ''): f.append(f'{lang}: the kill feed shell is not mirrored')
    # nothing in the HUD may sit on top of anything else
    for lang, d in res.items():
        bx = list(d.get('boxes', {}).items())
        for i in range(len(bx)):
            for j in range(i + 1, len(bx)):
                (n1, a), (n2, c) = bx[i], bx[j]
                if a['l'] < c['r'] - 2 and c['l'] < a['r'] - 2 and a['t'] < c['b'] - 2 and c['t'] < a['b'] - 2:
                    f.append(f'{lang}: {n1} overlaps {n2}')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL LANGUAGE LAYOUT TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
