# The squad on the menu: the leader decides what everyone plays and which map they all look at,
# a passenger can wander the menu instead of being dragged along, name plates never sit on top of
# each other, and everything that is not "play now" lives behind the one corner button.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8824; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b22-')
SIZES = [(844, 390), (740, 360), (667, 375)]

# A squad of two where I am NOT the leader.
PASSENGER = """() => {
  __tf.acc.party = { leader: 'boss', map: 'desert', members: [
    { id: 'boss', name: 'Hemin',  tank: { id: 'safeen', level: 3 } },
    { id: __tf.acc.id, name: 'Solomon', tank: { id: 'zagros', level: 4 } } ] };
  __tf.acc.emit('party', __tf.acc.party); }"""
# The same squad with me in charge.
LEADER = """() => {
  __tf.acc.party = { leader: __tf.acc.id, map: null, members: [
    { id: __tf.acc.id, name: 'Solomon', tank: { id: 'zagros', level: 4 } },
    { id: 'p2', name: 'Hemin', tank: { id: 'safeen', level: 3 } } ] };
  __tf.acc.emit('party', __tf.acc.party); }"""

# Every plate and + on the stage, as boxes, so we can see whether any two overlap.
BOXES = """() => [...document.querySelectorAll('#stageNames .splate, #stageAdds .stage-add')]
  .filter(e => !e.hidden)
  .map(e => { const r = e.getBoundingClientRect();
    return { t: (e.textContent || '').trim().slice(0, 12),
             l: r.left, r: r.right, tp: r.top, b: r.bottom }; })"""

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
            ctx = await br.new_context(viewport={'width': 844, 'height': 390}, service_workers='block')
            p = await ctx.new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await p.wait_for_function('window.__tf && window.__tf.stage', timeout=20000)
            await p.evaluate("__tf.setName('Solomon')")
            await p.wait_for_timeout(900)

            # ---------- on your own, everything is yours to press ----------
            ok(await p.evaluate("!document.getElementById('btnQuick').disabled"), 'on your own you can start a match')
            ok(await p.evaluate("document.getElementById('leadNote').hidden"), 'and nothing tells you otherwise')

            # ---------- a passenger cannot start anything ----------
            await p.evaluate("__tf.setMenuMap('hawler')"); await p.wait_for_timeout(300)
            await p.evaluate(PASSENGER); await p.wait_for_timeout(900)
            locked = await p.evaluate("""() => ['btnQuick','btnRanked','btnCreate','btnJoin','btnPractice']
              .filter(id => !document.getElementById(id).disabled)""")
            ok(not locked, f'a squad member cannot start a match on their own ({locked or "all locked"})')
            ok(not await p.evaluate("document.getElementById('leadNote').hidden"),
               'and is told who can')
            note = await p.evaluate("document.getElementById('leadNote').textContent")
            ok('Hemin' in note, f'by name ({note.strip()[:52]})')

            # ---------- and is LEFT ALONE while the leader plans ----------
            # What the leader picks is a plan, carried by the party as data. It is not a command to
            # redraw everyone's screen: a member part-way through a chest or an upgrade had the
            # ground change under them, which is the bug this replaces.
            shown = await p.evaluate("__tf.stage.W.map.id")
            ok(shown == 'hawler', f"the member's own menu map is left alone ({shown})")
            saved = await p.evaluate("JSON.parse(localStorage.getItem('trackfire-settings') || '{}').lastMap")
            ok(saved in (None, 'hawler'), f'and so is their saved preference ({saved})')

            # the leader moving to another map still does not touch the member's screen
            await p.evaluate("__tf.acc.party.map = 'forest'; __tf.acc.emit('party', __tf.acc.party);")
            await p.wait_for_timeout(800)
            ok(await p.evaluate("__tf.stage.W.map.id") == 'hawler', 'the leader changing map does not move the member')

            # nor does it drag them off whatever page they were on
            await p.evaluate("__tf.social.go('ranked')"); await p.wait_for_timeout(500)
            await p.evaluate(PASSENGER)          # the server never really knew about this squad
            await p.evaluate("__tf.acc.party.map = 'desert'; __tf.acc.emit('party', __tf.acc.party);")
            await p.wait_for_timeout(700)
            ok(await p.is_visible('#scr-page'), 'a member browsing a page stays on it while the leader plans')
            await p.evaluate("__tf.social.back()"); await p.wait_for_timeout(400)

            # ---------- as leader you get it all back ----------
            await p.evaluate(LEADER); await p.wait_for_timeout(800)
            ok(await p.evaluate("!document.getElementById('btnQuick').disabled"), 'the leader can start a match')
            ok(await p.evaluate("document.getElementById('leadNote').hidden"), 'and gets no warning')
            ok(await p.evaluate("__tf.stage.W.map.id") == 'hawler',
               'and the menu is still on their own map, as it was throughout')
            await ctx.close()

            # ---------- the corner menu, at every phone size and in every language ----------
            for (W, H) in SIZES:
                for lang in ('en', 'ar', 'ku'):
                    ctx = await br.new_context(viewport={'width': W, 'height': H}, has_touch=True,
                                               is_mobile=True, service_workers='block')
                    p = await ctx.new_page()
                    p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
                    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
                    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
                    await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
                    await p.wait_for_function('window.__tf && window.__tf.stage', timeout=20000)
                    await p.evaluate(f"__tf.setLang('{lang}')")
                    await p.evaluate("__tf.setName('Solomon')")
                    await p.wait_for_timeout(900)
                    tag = f'{W}x{H} {lang}'

                    if lang == 'en' and W == 844:
                        # the middle of the screen belongs to the tanks
                        gap = await p.evaluate("""() => {
                          const L = document.querySelector('#scr-menu .menu-col').getBoundingClientRect();
                          const R = document.getElementById('homeSide').getBoundingClientRect();
                          return Math.round(R.left > L.right ? R.left - L.right : L.left - R.right); }""")
                        ok(gap > 260, f'there is a wide clear strip down the middle for the tanks ({gap}px)')

                        # the drawer is shut to begin with and holds the secondary buttons
                        ok(await p.evaluate("document.getElementById('mnDrawer').hidden"), 'the corner menu starts closed')
                        inside = await p.evaluate("""() => ['btnShop','btnQuests','btnGoals','btnDaily','btnWheel',
                          'navProfile','navBoards','navFriends','btnModes','btnSettings']
                          .filter(id => document.getElementById('mnDrawer').contains(document.getElementById(id)))""")
                        ok(len(inside) == 10, f'and holds all ten of the secondary buttons ({len(inside)})')
                        # the ones you actually play with stayed outside it
                        outside = await p.evaluate("""() => ['btnQuick','btnRanked','btnCreate','btnPractice','btnJoin','tankCard']
                          .filter(id => !document.getElementById('mnDrawer').contains(document.getElementById(id)))""")
                        ok(len(outside) == 6, f'while the play buttons and your tank stay in the open ({len(outside)}/6)')

                        await p.click('#btnMore'); await p.wait_for_timeout(350)
                        ok(not await p.evaluate("document.getElementById('mnDrawer').hidden"), 'the corner button opens it')
                        # and the things in it really work
                        await p.click('#btnModes'); await p.wait_for_timeout(700)
                        ok(await p.is_visible('#scr-page'), 'a button inside it still does its job')
                        ok(await p.evaluate("document.getElementById('mnDrawer').hidden"), 'and it shuts behind you')
                        await p.click('#btnBack'); await p.wait_for_selector('#scr-menu:not([hidden])')
                        await p.wait_for_timeout(500)

                    # the corner button is reachable and big enough to hit with a thumb
                    box = await p.evaluate("""() => { const b = document.getElementById('btnMore').getBoundingClientRect();
                      return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left),
                               r: Math.round(b.right), vw: innerWidth }; }""")
                    ok(box['h'] >= 36 and box['w'] >= 44, f'the corner button is thumb-sized — {tag} ({box["w"]}x{box["h"]})')
                    ok(box['l'] >= -1 and box['r'] <= box['vw'] + 1, f'and fully on screen — {tag}')

                    # the drawer fits without scrolling
                    await p.click('#btnMore'); await p.wait_for_timeout(350)
                    dr = await p.evaluate("""() => { const d = document.getElementById('mnDrawer');
                      return { need: d.scrollHeight, have: d.clientHeight,
                               bottom: Math.round(d.getBoundingClientRect().bottom), vh: innerHeight }; }""")
                    ok(dr['need'] <= dr['have'] + 2, f'the corner menu fits without scrolling — {tag} ({dr["need"]} in {dr["have"]})')
                    ok(dr['bottom'] <= dr['vh'] + 1, f'and does not run off the bottom — {tag}')
                    await p.click('#btnMoreClose'); await p.wait_for_timeout(250)

                    # ---------- name plates never sit on top of each other ----------
                    await p.evaluate("""() => { __tf.acc.party = { leader: __tf.acc.id, map: null, members: [
                        { id: __tf.acc.id, name: 'Solomon', tank: { id: 'zagros', level: 4 } },
                        { id: 'p2', name: 'Hemin',   tank: { id: 'safeen', level: 3 } },
                        { id: 'p3', name: 'Dilan',   tank: { id: 'korek',  level: 2 } },
                        { id: 'p4', name: 'Aram',    tank: { id: 'newroz', level: 5 } } ] };
                      __tf.acc.emit('party', __tf.acc.party); }""")
                    await p.wait_for_timeout(1100)
                    boxes = await p.evaluate(BOXES)
                    clash = []
                    for i in range(len(boxes)):
                        for j in range(i + 1, len(boxes)):
                            a, b = boxes[i], boxes[j]
                            if (min(a['r'], b['r']) - max(a['l'], b['l']) > 3
                                    and min(a['b'], b['b']) - max(a['tp'], b['tp']) > 3):
                                clash.append(f'"{a["t"]}" over "{b["t"]}"')
                    ok(not clash, f'a full squad name plate set stays apart — {tag}' 
                       + ('' if not clash else ' -> ' + '; '.join(clash[:2])))
                    ok(len(boxes) >= 4, f'and all four are on screen — {tag} ({len(boxes)})')
                    await ctx.close()
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test22: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
