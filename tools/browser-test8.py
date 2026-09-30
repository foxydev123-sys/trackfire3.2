# Tank abilities in a real browser (mock three.js): the power button, pressing Q with every tank,
# the wall / dome / black hole appearing, the guided-shell camera ride, the cage, and the stars over tanks.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8798; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b8-')
ABIL = [('zagros', 'wall'), ('baz', 'drone'), ('halgurd', 'dome'), ('rashaba', 'cloak'),
        ('safeen', 'homing'), ('bradost', 'freeze'), ('korek', 'heal'), ('newroz', 'hole')]

async def mk(br, errs, tag, **kw):
    c = await br.new_context(**kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs = []; res = {}; used = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            A = await mk(br, errs, 'desktop', viewport={'width': 1366, 'height': 800})
            P = await mk(br, errs, 'phone', viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
            for p in (A, P):
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
            # ---------- desktop: practice match, every tank's power in turn ----------
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Hemin')
            await A.click('#btnPractice'); await A.wait_for_selector('#scr-lobby:not([hidden])')
            await A.wait_for_function("__tf.room && __tf.room.players.length >= 4", timeout=10000)
            await A.click('#btnStart'); await A.wait_for_selector('#hud:not([hidden])', timeout=10000)
            await A.wait_for_function("__tf.net && __tf.net.meAlive", timeout=10000)
            res['abChipVisible'] = await A.evaluate("!document.getElementById('abChip').hidden")
            res['abChipName'] = await A.evaluate("document.getElementById('abChipName').textContent")
            res['barStartsEmptyish'] = await A.evaluate("(() => { const n = __tf.net; return n.ab.need > 0; })()")
            res['keyHintQ'] = await A.evaluate("document.getElementById('keys').innerText.includes('Q')")
            for tank, ab in ABIL:
                # give ourselves that tank, respawn with it, then press Q
                await A.evaluate(f"__tf.tryTank('{tank}', 5)")
                await A.wait_for_function(f"__tf.net.meAlive && __tf.net.ab.id === '{ab}' && __tf.net.abReady()", timeout=8000)
                # hold Q to aim the power (a preview shows where it lands), let go to use it.
                # The trigger is never involved: the power has its own control now.
                # (bots are shooting at us in practice, so if we get killed mid-way, try again)
                held = ghost = False
                # Catch the moment the bar empties. Reading it again after the dust settles is a
                # race: by then a fast power has already started recharging, and a cast that
                # worked perfectly well reads as one that never happened.
                spentNow = False
                for attempt in range(4):
                    await A.evaluate(f"__tf.tryTank('{tank}', 5)")
                    await A.wait_for_function(f"__tf.net.meAlive && __tf.net.ab.id === '{ab}' && __tf.net.abReady()", timeout=8000)
                    await A.keyboard.down('KeyQ'); await A.wait_for_timeout(220)
                    held = held or await A.evaluate("!!__tf.net.ab.armed")
                    ghost = ghost or await A.evaluate("!!(__tf.game.W.abfx.ghost && __tf.game.W.abfx.ghost.visible)")
                    await A.mouse.move(820, 300); await A.wait_for_timeout(200)
                    if ab in ('wall', 'hole') and attempt == 0: await A.screenshot(path=f'{OUT}/ab-{ab}-aiming.png')
                    await A.keyboard.up('KeyQ')
                    try:
                        await A.wait_for_function("__tf.net.ab.chg === 0 && !__tf.net.ab.armed", timeout=4000)
                        spentNow = True
                        break
                    except Exception: pass
                await A.wait_for_timeout(600)
                used[ab] = await A.evaluate("""(() => {
                    const n = __tf.net, W = __tf.game.W, fx = (n.map.fx || {walls:[],domes:[],holes:[]});
                    return { ability: n.ab.id, spent: n.ab.chg === 0,
                             walls: fx.walls.length, domes: fx.domes.length, holes: fx.holes.length,
                             missiles: W.abfx.ms.size, cars: W.abfx.dr.size,
                             wallMeshes: W.abfx.walls.size, domeMeshes: W.abfx.domes.size, holeMeshes: W.abfx.holes.size,
                             riding: !!__tf.game.riding, heldToAim: false, ghostShown: false };
                })()""")
                used[ab]['spent'] = used[ab]['spent'] or spentNow
                used[ab]['heldToAim'] = held
                used[ab]['ghostShown'] = ghost
                await A.screenshot(path=f'{OUT}/ab-{ab}.png')
            # the guided shell: does the camera really leave the tank and ride it?
            await A.evaluate("__tf.tryTank('safeen', 5)")
            await A.wait_for_function("__tf.net.meAlive && __tf.net.ab.id === 'homing' && __tf.net.abReady()", timeout=8000)
            await A.keyboard.down('KeyQ'); await A.wait_for_timeout(150); await A.keyboard.up('KeyQ')
            ride = await A.evaluate("""(async () => {
                const g = __tf.game, seen = { rode: false, maxMissiles: 0, camFarFromTank: 0 };
                for (let i = 0; i < 140; i++) {          // long enough for the shell to fly and hit
                  seen.maxMissiles = Math.max(seen.maxMissiles, g.W.abfx.ms.size);
                  if (g.riding) {
                    seen.rode = true;
                    const m = g.W.abfx.myMissile(__tf.net.myId);
                    if (m) seen.camFarFromTank = Math.max(seen.camFarFromTank, Math.hypot(m.x - __tf.net.me.x, m.z - __tf.net.me.z));
                  }
                  await new Promise(r => setTimeout(r, 50));
                }
                seen.backOnTank = !g.riding;
                return seen;
              })()""")
            res['guidedShellCamera'] = ride
            await A.screenshot(path=f'{OUT}/ab-homing-ride.png')
            res['perAbility'] = used
            res['starsOnTags'] = await A.evaluate("[...document.querySelectorAll('.tag u')].filter(u => u.textContent.includes('★')).length")
            # ---------- the garage: upgrading a power ----------
            await A.keyboard.press('Escape'); await A.wait_for_selector('#btnQuit')
            await A.click('#btnQuit'); await A.wait_for_selector('#scr-menu:not([hidden])', timeout=15000)
            await A.wait_for_timeout(400)
            if await A.is_visible('#ecoModal'): await A.click('#ecoCard [data-close]')
            await A.click('#btnGarage'); await A.wait_for_selector('.tk-grid', timeout=8000)
            await A.wait_for_timeout(400)
            res['garageAbCard'] = await A.evaluate("!!document.querySelector('.ab-card')")
            res['garageAbName'] = await A.evaluate("document.querySelector('.ab-card .ab-txt b')?.textContent || null")
            await A.screenshot(path=f'{OUT}/ab-garage.png')
            before = await A.evaluate("__tf.acc.wallet.tanks[__tf.eco.gSel].mods.ab")
            btn = await A.query_selector('.ab-card [data-up="ab"]:not([disabled])')
            if btn:
                await btn.click(); await A.wait_for_timeout(900)
                res['abUpgraded'] = await A.evaluate("__tf.acc.wallet.tanks[__tf.eco.gSel].mods.ab")
                await A.screenshot(path=f'{OUT}/ab-upgraded.png')
                if await A.is_visible('#ecoCard'): await A.click('#ecoCard [data-close]')
            res['abBefore'] = before
            # ---------- phone: the round power button next to FIRE ----------
            await P.wait_for_function('window.__tf'); await P.evaluate('n => __tf.setName(n)', 'Lina')
            await P.click('#btnPractice'); await P.wait_for_selector('#scr-lobby:not([hidden])')
            await P.wait_for_function("__tf.room && __tf.room.players.length >= 4", timeout=10000)
            await P.click('#btnStart'); await P.wait_for_selector('#hud:not([hidden])', timeout=10000)
            await P.wait_for_function("__tf.net && __tf.net.meAlive", timeout=10000)
            await P.wait_for_timeout(600)
            res['phoneBtnVisible'] = await P.evaluate("!document.getElementById('abBtn').hidden")
            box = await P.evaluate("(() => { const r = document.getElementById('abBtn').getBoundingClientRect(); return {w: Math.round(r.width), onScreen: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top > 0}; })()")
            res['phoneBtn'] = box
            await P.evaluate("__tf.tryTank('zagros', 5)")
            await P.wait_for_function("__tf.net.meAlive && __tf.net.abReady()", timeout=8000)
            # Hold the power control, drag to aim, let go — the FIRE button is never touched.
            pbox = await P.locator('#abBtn').bounding_box()
            pcx, pcy = pbox['x'] + pbox['width'] / 2, pbox['y'] + pbox['height'] / 2
            await P.evaluate("""([cx, cy]) => {
              const ev = (type, tgt, x, y) => tgt.dispatchEvent(new PointerEvent(type, {
                pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
                clientX: x, clientY: y }));
              ev('pointerdown', document.getElementById('abBtn'), cx, cy);
              for (let i = 1; i <= 6; i++) ev('pointermove', window, cx, cy - i * 12);
            }""", [pcx, pcy])
            await P.wait_for_timeout(300)
            res['phoneAiming'] = await P.evaluate("!!__tf.net.ab.armed && __tf.touch.abHold === true")
            # pressing FIRE while aiming must not let the power off — they are separate systems
            await P.tap('#fireBtn'); await P.wait_for_timeout(400)
            res['phoneFireDidNotCast'] = await P.evaluate("__tf.net.ab.chg > 0")
            await P.evaluate("""([cx, cy]) => {
              window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'touch',
                isPrimary: true, bubbles: true, cancelable: true, clientX: cx, clientY: cy - 80 }));
            }""", [pcx, pcy])
            await P.wait_for_timeout(900)
            res['phoneUsedPower'] = await P.evaluate("__tf.net.ab.chg === 0 && !__tf.net.ab.armed")
            await P.screenshot(path=f'{OUT}/ab-phone.png')
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    bad = [e for e in errs if 'remotePose' not in e]
    for e in bad[:12]: print(e)
    fails = []
    if not res.get('abChipVisible'): fails.append('the power panel is not shown on desktop')
    if not res.get('phoneBtnVisible') or not res.get('phoneBtn', {}).get('onScreen'): fails.append('the power button is missing or off-screen on the phone')
    if not res.get('phoneAiming'): fails.append('holding the power stick on the phone did not start aiming it')
    if not res.get('phoneFireDidNotCast'): fails.append('pressing FIRE let the power off — the two must be independent')
    if not res.get('phoneUsedPower'): fails.append('letting go of the power stick did not use the power')
    if not res.get('starsOnTags'): fails.append('no stars over other tanks')
    if not res.get('garageAbCard'): fails.append('the garage does not show the tank power')
    if res.get('abUpgraded') is not None and res.get('abUpgraded') <= res.get('abBefore', 0): fails.append('upgrading the power did not save')
    for ab, d in used.items():
        if not d.get('spent'): fails.append(f'{ab}: the power was not used (bar not spent)')
    for ab in ('wall', 'dome', 'hole', 'drone', 'homing'):
        d = used.get(ab) or {}
        if not d.get('heldToAim'): fails.append(f'{ab}: holding Q did not start aiming the power')
        if not d.get('ghostShown'): fails.append(f'{ab}: no preview showed where it would go')
    if not (used.get('cloak') or {}).get('spent'): fails.append('Vanish did not go off on a quick tap')
    if used.get('wall', {}).get('wallMeshes', 0) < 1: fails.append('no wall was drawn')
    if used.get('dome', {}).get('domeMeshes', 0) < 1: fails.append('no dome was drawn')
    if used.get('hole', {}).get('holeMeshes', 0) < 1: fails.append('no black hole was drawn')
    if used.get('drone', {}).get('cars', 0) < 1: fails.append('no suicide car was drawn')
    r = res.get('guidedShellCamera') or {}
    if not r.get('rode'): fails.append('the camera never rode the guided shell')
    if r.get('camFarFromTank', 0) < 3: fails.append('the camera stayed on the tank instead of following the shell')
    if not r.get('backOnTank'): fails.append('the camera never came back to the tank')
    if bad: fails.append(f'{len(bad)} page errors')
    print('\n'.join('FAIL ' + f for f in fails) if fails else 'ALL BROWSER ABILITY TESTS PASS')
    sys.exit(1 if fails else 0)
asyncio.run(main())
