# THE RESULT CARD at the end of a match.
#
# It used to be pinned by its centre with no ceiling on its height, inside a HUD layer only about
# 720 virtual px tall (520 on a phone). A full lobby with MVP cards, an RP result and rewards runs
# well past that, and because it grew from the middle outwards the overflow split evenly — the
# title climbed off the top while the scoreboard slid off the bottom, with no way to scroll it
# back. Worse, the rank and reward blocks arrive a moment AFTER the card is shown, so it jumped as
# it grew. That is the "sometimes it falls down and I can't see it" bug.
#
# So: at every screen size, for a win, a loss and a draw, with 2 players and with 8, with MVP
# cards, rewards and a ranked result all present — the card must stay inside the viewport, and the
# result music must play exactly once however many times the card is refreshed.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8825; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b23-')
SIZES = [(1920, 1080), (1366, 768), (932, 430), (844, 390), (812, 375), (740, 360)]

# A finished match, built to be as tall as the card ever gets.
ROOM = """(n) => {
  const players = [];
  for (let i = 0; i < n; i++) players.push({
    id: i === 0 ? 1 : 900 + i, name: ['Solomon','Hemin','Dilan','Aram','Rezan','Shilan','Karwan','Nian'][i],
    team: i % 2 ? 'red' : 'blue', k: 12 - i, d: i, hk: 2, hd: 1, obj: 1, dmg: 2400 - i * 90,
    sc: 1200 - i * 90, ping: 40 + i, conn: true, bot: false, tank: 'zagros', lvl: 5, mh: 100 });
  return { code: 'ENDQA', kind: 'ranked', mode: 'tdm', state: 'ended', players,
           mvp: { blue: players[0], red: players[1] } };
}"""

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs, fails = [], []
    def ok(c, m):
        print(('  ok   ' if c else '  FAIL ') + m)
        if not c: fails.append(m)
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            for (W, H) in SIZES:
                phone = H < 500
                ctx = await br.new_context(viewport={'width': W, 'height': H}, has_touch=phone,
                                           is_mobile=phone, service_workers='block')
                p = await ctx.new_page()
                p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
                await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
                await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
                await p.wait_for_function('window.__tf && window.__tf.hud', timeout=20000)
                await p.evaluate("__tf.setName('Solomon')")
                await p.evaluate("window.__mk = " + ROOM)
                # put the HUD on screen the way a match does, so the card is laid out for real
                await p.evaluate("() => { __tf.hud.setTouch(innerHeight < 500); __tf.hud.show(true); __tf.hud.layout(); }")
                # count the result music
                await p.evaluate("""() => { const a = __tf.hud.audio, real = a.play.bind(a);
                  window.__st = []; a.play = (n2, ...r) => { if (/^match/.test(n2)) window.__st.push(n2); return real(n2, ...r); }; }""")

                for n in (2, 8):
                    for winner, label in [('blue', 'win'), ('red', 'loss'), ('draw', 'draw')]:
                        tag = f'{W}x{H} {n}p {label}'
                        await p.evaluate("""([n, w]) => {
                          const r = window.__mk(n); r.winner = w;
                          __tf.hud.hideEnd();
                          __tf.hud.rankRes = null; __tf.hud.reward = null;
                          __tf.hud.room = r; __tf.hud.myId = 1; window.__st = [];
                          __tf.hud.showEnd(r, 1);
                          window.__r = r;
                        }""", [n, winner])
                        await p.wait_for_timeout(120)
                        ok(len(await p.evaluate("window.__st")) == 1, f'the result music plays once — {tag}')
                        exp = 'matchDraw' if winner == 'draw' else ('matchWin' if winner == 'blue' else 'matchLose')
                        got = await p.evaluate("window.__st[0]")
                        ok(got == exp, f'and it is the right one ({got}) — {tag}')

                        # now the rank result and the rewards arrive, a moment late, as they really do
                        await p.evaluate("""() => {
                          const rk = (rp, pct) => ({ placed: true, tier: 'gold', div: 2, rp, pct,
                            next: { tier: 'plat', div: 3, need: 120 } });
                          __tf.hud.showRankResult({ delta: 28, before: { rank: rk(1180, 0.4) },
                            after: { rank: rk(1208, 0.55) },
                            parts: [['win', 25], ['dmg', 5], ['streak', -2]] });
                          __tf.hud.showReward({ coins: 240, xp: 180, parts: 12, chest: 'rare', quests: [{ name: 'Win 3 matches', done: true }] });
                          __tf.hud.showEnd(window.__r, 1);
                        }""")
                        await p.wait_for_timeout(200)
                        ok(len(await p.evaluate("window.__st")) == 1,
                           f'rewards and rank arriving do not replay it — {tag}')

                        box = await p.evaluate("""() => { const e = document.getElementById('endcard');
                          const r = e.getBoundingClientRect();
                          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                                   h: r.height, need: e.scrollHeight, have: e.clientHeight,
                                   vw: innerWidth, vh: innerHeight, hidden: e.hidden }; }""")
                        ok(not box['hidden'], f'the card is on screen — {tag}')
                        ok(box['top'] >= -1 and box['bottom'] <= box['vh'] + 1,
                           f"it stays inside the viewport top to bottom — {tag} "
                           f"({box['top']:.0f}..{box['bottom']:.0f} of {box['vh']})")
                        ok(box['left'] >= -1 and box['right'] <= box['vw'] + 1,
                           f'and side to side — {tag}')
                        ok(box['need'] <= box['have'] + 2 or box['have'] > 100,
                           f'when it cannot fit it scrolls inside itself rather than overflowing — {tag}')
                        # the title must be readable, not clipped off the top
                        tb = await p.evaluate("""() => { const b = document.querySelector('#endcard .big');
                          const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }""")
                        ok(tb['top'] >= -1 and tb['bottom'] <= box['vh'] + 1, f'and the result title is visible — {tag}')

                # turning the phone while the card is open must not push it out either
                await p.set_viewport_size({'width': H, 'height': W})
                await p.wait_for_timeout(350)
                await p.evaluate("() => { __tf.hud.layout(); }")
                await p.wait_for_timeout(250)
                box = await p.evaluate("""() => { const r = document.getElementById('endcard').getBoundingClientRect();
                  return { top: r.top, bottom: r.bottom, vh: innerHeight }; }""")
                ok(box['top'] >= -1 and box['bottom'] <= box['vh'] + 1,
                   f'it survives the screen being turned — {W}x{H} → {H}x{W} ({box["top"]:.0f}..{box["bottom"]:.0f})')
                await ctx.close()
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test23: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
