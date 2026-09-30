# UI text fits in all three languages: nothing overflows its box, wraps onto an extra line, or
# falls outside the screen — on the menu and on the three first-run steps, at phone sizes.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8817; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b17-')
SIZES = [(844, 390), (800, 360), (740, 360), (720, 340), (667, 375), (390, 844)]   # the landscape widths real phones report, plus portrait

# Reports any element whose text spills out of its own box, and any control that sits
# outside the screen. Returns a list of plain-English complaints.
PROBE = """(sel) => {
  const bad = [];
  const vw = innerWidth;
  // Direction-agnostic checks. scrollWidth and Range rects both proved unreliable here: they get
  // clipped by the very overflow we want to detect, and behave differently in right-to-left
  // pages. Comparing real boxes against their parent's content box works the same either way.
  const contentBox = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { left: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
             right: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) };
  };
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const name = (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]);
    const txt = (el.textContent || '').trim().slice(0, 22);

    // an inline label gets one rect per line box, so >1 means the text wrapped
    if (cs.display.startsWith('inline') && !cs.whiteSpace.includes('nowrap')
        && el.getClientRects().length > 1 && !el.matches('.sub, p'))
      bad.push(name + ' wrapped onto another line ("' + txt + '")');

    // wider than the room its parent gives it — either clipped, or pushing the layout out
    const par = el.parentElement;
    if (par && getComputedStyle(par).overflowX !== 'auto' && getComputedStyle(par).overflowX !== 'scroll') {
      const pb = contentBox(par);
      if (r.left < pb.left - 2 || r.right > pb.right + 2)
        bad.push(name + ' does not fit its row ("' + txt + '")');
    }

    // pushed past the left or right edge of the screen (vertical scrolling is fine)
    if (r.right > vw + 1 || r.left < -1)
      bad.push(name + ' runs off the side of the screen ("' + txt + '")');
  }
  return bad;
}"""

# Nothing in the menu's two columns may sit on top of anything else, and neither column may run
# off the bottom of the screen. This is what broke on a phone: the columns are flex, and flex
# items shrink by default, so every button was squeezed below the height of its own text and the
# Kurdish and Arabic subtitles spilled out over the button beneath.
OVERLAP = """() => {
  const bad = [], boxes = [];
  for (const sel of ['#scr-menu .menu-col > *', '.home-side > *']) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.hasAttribute('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      boxes.push({ name: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0], r });
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3)
      bad.push(boxes[i].name + ' sits on top of ' + boxes[j].name);
  }
  // Side by side only in landscape, which is how the game is played. In portrait the two
  // columns stack on purpose and the page scrolls, so neither check applies.
  const L = document.querySelector('#scr-menu .menu-col'), R = document.querySelector('.home-side');
  if (L && R && innerWidth > innerHeight) {
    const a = L.getBoundingClientRect(), b = R.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3) bad.push('the two menu columns overlap each other');
    const gap = Math.max(b.left - a.right, a.left - b.right);
    if (gap < 90) bad.push('no room between the columns for the tank (' + Math.round(gap) + 'px)');
    for (const [n, el] of [['left column', L], ['right column', R]]) {
      if (el.getBoundingClientRect().bottom > innerHeight + 2) bad.push(n + ' runs off the bottom of the screen');
    }
  }
  return bad;
}"""

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '200'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs = []; fails = []
    def ok(c, m):
        print(('  ok   ' if c else '  FAIL ') + m)
        if not c: fails.append(m)
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            for (W, H) in SIZES:
                for lang in ('en', 'ar', 'ku'):
                    ctx = await br.new_context(viewport={'width': W, 'height': H}, has_touch=True,
                                               is_mobile=True, service_workers='block')
                    p = await ctx.new_page()
                    p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
                    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
                    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
                    await p.goto(f'http://localhost:{PORT}/')
                    await p.wait_for_selector('#scr-menu:not([hidden])')
                    await p.wait_for_function('window.__tf')
                    await p.evaluate(f"__tf.setLang('{lang}')")
                    await p.wait_for_timeout(250)
                    tag = f'{W}x{H} {lang}'

                    # --- the menu
                    bad = await p.evaluate(PROBE, '#scr-menu .btn, #scr-menu .btn small, #scr-menu .btn>span, #scr-menu .join, #scr-menu .langsel')
                    ok(not bad, f'menu fits — {tag}' + ('' if not bad else ' → ' + '; '.join(bad[:3])))
                    bad = await p.evaluate(OVERLAP)
                    ok(not bad, f'nothing in the menu overlaps — {tag}' + ('' if not bad else ' → ' + '; '.join(bad[:3])))

                    # --- the first-run steps (name → age → city), where the buttons were clipped
                    await p.evaluate("__tf.acc && __tf.acc.forget && __tf.acc.forget()")
                    await p.goto(f'http://localhost:{PORT}/?fresh=1')
                    await p.wait_for_function('window.__tf')
                    await p.evaluate(f"__tf.setLang('{lang}')")
                    shown = await p.evaluate("!document.getElementById('welcome').hidden")
                    if not shown:
                        await p.evaluate("document.getElementById('welcome').hidden = false")
                    await p.wait_for_timeout(200)
                    for step in (1, 2, 3):
                        if step > 1:
                            await p.evaluate("(() => { const b = document.getElementById('wcName'); if (b) b.value = 'Hemin'; })()")
                            try:
                                await p.click('#wcNext', timeout=1500)
                            except Exception:
                                pass
                            await p.wait_for_timeout(250)
                        bad = await p.evaluate(PROBE, '#welcome .wc-card, #welcome .wc-btns, #welcome .wc-btns .btn, #welcome .wc-step, #welcome .sub')
                        ok(not bad, f'first-run step {step} fits — {tag}' + ('' if not bad else ' → ' + '; '.join(bad[:3])))
                    await p.screenshot(path=os.path.join(OUT, f'ui-{W}x{H}-{lang}.png'))
                    await ctx.close()
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test17: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
