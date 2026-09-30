# Online features in a real browser (mock three.js): accounts, home card, profile, leaderboards,
# friends + chat, squad + ranked queue (bots fill after 4 s) + match found + ranked match,
# private CTF / KOH / LTS rooms with bots, in English, Kurdish and Arabic. Screenshots → OUT.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b3-')
async def mk(br, errs, tag, **kw):
    c = await br.new_context(**kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p
async def shot(p, name): await p.screenshot(path=f'{OUT}/{name}.png')
async def lang(p, l):
    await p.evaluate(f"document.querySelector('#scr-menu [data-lang-seg] button[data-lang=\"{l}\"]').click()")
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

# Map, mode and time now live in the match-setup step, not in the team lobby. From the lobby the
# host reopens it with CHANGE, picks, and comes back.
async def setup_pick(pg, sel):
    await pg.click('#lbEditSetup')
    await pg.wait_for_selector('#scr-setup:not([hidden])')
    await pg.click(sel)
    await pg.click('#btnSuGo')
    await pg.wait_for_selector('#scr-lobby:not([hidden])')

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'RANKED_BOTS_AFTER_S': '4', 'REG_LIMIT': '100'}, stdout=subprocess.PIPE); time.sleep(0.9)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'A', viewport={'width': 1366, 'height': 800})
            B = await mk(br, errs, 'B', viewport={'width': 400, 'height': 860}, has_touch=True, is_mobile=True)
            for p in (A, B):
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            await lang(A, 'en'); await lang(B, 'ku')
            await shot(A, 'o01-menu-noacc-en')
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Solomon'); await menuClick(A, '#navProfile')
            await A.wait_for_selector('#scr-page:not([hidden]) .prof-head', timeout=8000); await A.wait_for_timeout(400)
            await shot(A, 'o02-profile-en')
            await B.wait_for_function('window.__tf'); await B.evaluate('n => __tf.setName(n)', 'Lina'); await menuClick(B, '#navFriends')
            await B.wait_for_selector('#addForm', timeout=8000)
            aid = await A.evaluate('__tf.acc.idText'); bid = await B.evaluate('__tf.acc.idText'); res['ids'] = [aid, bid]
            await B.fill('#addId', aid); await B.click('#addForm button[type=submit]')
            await A.wait_for_selector('.ntf [data-x=acc]', timeout=6000); await shot(A, 'o03-notify-friendreq-en')
            await A.click('.ntf [data-x=acc]'); await A.wait_for_timeout(500)
            await A.click('#btnBack'); await A.wait_for_timeout(1100)
            if await A.is_visible('#ecoModal'): await A.click('#ecoCard .mclose')
            await menuClick(A, '#navFriends'); await A.wait_for_selector('#msgInp', timeout=6000)
            await A.fill('#msgInp', 'Ranked 3v3 tonight?'); await A.press('#msgInp', 'Enter')
            await B.wait_for_timeout(700); await B.click('.fitem'); await B.wait_for_selector('#msgInp')
            await B.fill('#msgInp', 'بەڵێ! کاز بهێنە'); await B.press('#msgInp', 'Enter'); await B.wait_for_timeout(600)
            await shot(A, 'o04-friends-chat-en'); await shot(B, 'o05-friends-chat-ku-phone')
            res['chatA'] = await A.evaluate("[...document.querySelectorAll('#msgs .m')].map(e=>e.firstChild.textContent)")
            # leaderboard + modes + tiers (Arabic on A)
            await A.click('#btnBack'); await lang(A, 'ar'); await A.wait_for_timeout(200)
            await shot(A, 'o06-home-ar')
            await menuClick(A, '#navBoards'); await A.wait_for_selector('#lbTable table, #lbTable .empty', timeout=6000); await A.wait_for_timeout(300); await shot(A, 'o07-boards-ar')
            await A.click('#btnBack'); await menuClick(A, '#btnModes'); await A.wait_for_timeout(300); await shot(A, 'o08-modes-ar')
            # squad + ranked. A squad is built in one place only now: the + standing beside your
            # tank on the menu (the Friends page is the other way in). The Ranked page just shows
            # who is in the squad.
            await A.click('#btnBack'); await A.wait_for_selector('#scr-menu:not([hidden])')
            await A.wait_for_selector('#stageAdds .stage-add:not([hidden])', timeout=10000)
            await A.click('#stageAdds .stage-add:not([hidden])')
            await A.wait_for_selector('#pfOk'); await A.click('.dlg-list input'); await A.click('#pfOk')
            await B.wait_for_selector('.ntf [data-x=join]', timeout=6000); await shot(B, 'o09-squad-invite-ku-phone')
            await B.click('.ntf [data-x=join]'); await B.wait_for_timeout(600)
            await A.click('#btnRanked'); await A.wait_for_selector('#findBtn', timeout=6000)
            await B.wait_for_selector('#pageBody .squad', timeout=6000) if await B.is_visible('#pageBody') else None
            await A.wait_for_timeout(600); await shot(A, 'o10-ranked-squad-ar')
            await A.click('#findBtn'); await A.wait_for_timeout(800); await shot(A, 'o11-ranked-searching-ar')
            await A.wait_for_selector('#foundModal:not([hidden])', timeout=12000); await B.wait_for_selector('#foundModal:not([hidden])', timeout=4000)
            await shot(A, 'o12-found-ar'); await shot(B, 'o13-found-ku-phone')
            await A.click('#fAccept'); await B.click('#fAccept')
            await A.wait_for_selector('#hud:not([hidden])', timeout=45000); await A.wait_for_timeout(2500)
            await shot(A, 'o14-ranked-hud-ar')
            res['ranked'] = await A.evaluate("({kind: __tf.room.kind, mode: __tf.room.mode, players: __tf.room.players.length, obj: document.getElementById('objLine').innerText, lbl: document.getElementById('modeLbl').textContent})")
            await A.keyboard.press('Escape'); await A.click('#btnQuit'); await A.wait_for_selector('#cfY', timeout=3000); await shot(A, 'o14b-ranked-quit-warning-ar'); await A.click('#cfY'); await A.wait_for_timeout(500)
            await B.evaluate("document.getElementById('btnQuit').click()"); await B.wait_for_selector('#cfY', timeout=3000); await B.evaluate("document.getElementById('cfY').click()"); await B.wait_for_timeout(400)
            # private rooms: CTF, KOH, LTS with bots (English)
            await lang(A, 'en')
            for mode in ['ctf', 'koh', 'lts']:
                if await A.is_visible('#scr-page'): await A.click('#btnBack')
                await A.click('#btnCreate')
                # match setup comes first now: mode, map and time, then open the lobby
                await A.wait_for_selector('#scr-setup:not([hidden])'); await A.click('#btnSuGo')
                await A.wait_for_selector('#scr-lobby:not([hidden])'); await A.wait_for_function('__tf.room && __tf.room.code')
                if mode == 'ctf':
                    # Solomon and Lina are still squadded up from the ranked section above, so Lina
                    # is taken into the room behind him without being asked — and counts as ready,
                    # since she never chose to come and should not have to press anything.
                    await B.wait_for_function("__tf.room && __tf.room.kind === 'private'", timeout=8000)
                    same = await B.evaluate("__tf.room.code") == await A.evaluate("__tf.room.code")
                    res['squadPulled'] = same
                    res['squadReady'] = await A.evaluate(
                        "(() => { const r = __tf.room, me = __tf.net.myId;"
                        " return r.players.filter(p => !p.bot && p.id !== me).every(p => p.ready); })()")
                await setup_pick(A, f'#lbModeSeg [data-mode={mode}]'); await A.wait_for_timeout(200)
                for _ in range(5): await A.click('#btnAddBot'); await A.wait_for_timeout(60)
                if mode == 'ctf': await shot(A, 'o15-lobby-modes-en')
                await A.click('#btnStart'); await A.wait_for_selector('#hud:not([hidden])', timeout=8000); await A.wait_for_timeout(3500)
                await shot(A, f'o16-{mode}-hud-en')
                res[mode] = await A.evaluate("({obj: document.getElementById('objLine').innerText, score: document.getElementById('hScore').innerText.replace(/\\n/g,' '), flags: !!__tf.game.flagMeshes, zone: !!__tf.game.zoneMesh})")
                await A.keyboard.press('Escape'); await A.click('#btnQuit'); await A.wait_for_timeout(400)
            sample = {'won': True, 'delta': 36, 'parts': [['win', 26], ['mvp', 5], ['streak', 5]], 'before': {'rp': 590, 'rank': {'placed': True, 'tier': 'silver', 'div': 1, 'rp': 590, 'pct': .9}}, 'after': {'rp': 626, 'rank': {'placed': True, 'tier': 'gold', 'div': 3, 'rp': 626, 'pct': .26, 'next': {'tier': 'gold', 'div': 2, 'need': 74}}}}
            await A.evaluate(f"__tf.social.showRankDialog({json.dumps(sample)})"); await A.wait_for_timeout(200); await shot(A, 'o18-rankup-en')
            await A.click('#rdOk'); await lang(A, 'ku'); await A.evaluate(f"__tf.social.showRankDialog({json.dumps(sample)})"); await A.wait_for_timeout(200); await shot(A, 'o19-rankup-ku'); await A.click('#rdOk')
            await menuClick(A, '#navProfile'); await A.wait_for_selector('.prof-head'); await A.wait_for_timeout(500); await shot(A, 'o20-profile-ku')
            await A.click('#btnBack'); await A.click('#btnRanked'); await A.wait_for_timeout(300); await A.click('#tiersBtn'); await A.wait_for_timeout(300); await shot(A, 'o21-tiers-ku')
            await A.click('#btnBack')
            res['overflowA'] = await A.evaluate('document.documentElement.scrollWidth > innerWidth')
            await B.click('#btnBack') if await B.is_visible('#btnBack') else None
            await B.wait_for_timeout(300); await shot(B, 'o17-home-ku-phone')
            res['overflowB'] = await B.evaluate('document.documentElement.scrollWidth > innerWidth')
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print('ERRORS', len(errs)); [print(e) for e in errs[:30]]
asyncio.run(main())
