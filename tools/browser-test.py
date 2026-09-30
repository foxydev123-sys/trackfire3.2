# End-to-end browser test (Playwright + Chromium, stand-in 3D engine).
# Two desktop browsers + one phone: create room, join by link, start match,
# drive in circles while firing, measure remote smoothness in browser B.
import asyncio, json, subprocess, sys, os, time, statistics
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765
MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'

async def page_for(browser, errs, tag, **ctx):
    c = await browser.new_context(**ctx)
    p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e} {e.stack[:400] if hasattr(e, "stack") and e.stack else ""}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type in ('error',) else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE)
    time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            A = await page_for(br, errs, 'A', viewport={'width': 1366, 'height': 768})
            await A.goto(f'http://localhost:{PORT}/')
            await A.wait_for_selector('#scr-menu:not([hidden])', timeout=15000)
            await A.wait_for_function('window.__tf'); await A.evaluate('n => __tf.setName(n)', 'Alice'); await A.click('#btnCreate')
            # match setup comes first now: mode, map and time, then open the lobby
            await A.wait_for_selector('#scr-setup:not([hidden])'); await A.click('#btnSuGo')
            await A.wait_for_function("document.getElementById('lbCode').textContent.trim().length===5 && !/[·-]/.test(document.getElementById('lbCode').textContent)", timeout=10000)
            code = (await A.inner_text('#lbCode')).strip()
            print('room code', code)
            await A.screenshot(path=f'{OUT}/01-lobby.png')
            B = await page_for(br, errs, 'B', viewport={'width': 1280, 'height': 720})
            await B.goto(f'http://localhost:{PORT}/?room={code}')
            await B.wait_for_selector('#scr-menu:not([hidden])')
            await B.wait_for_function('window.__tf'); await B.evaluate('n => __tf.setName(n)', 'Bob'); await B.click('#btnJoin')
            await A.wait_for_function("document.querySelectorAll('#lbPlayers li').length===2", timeout=10000)
            # phone (iPhone-ish landscape, touch)
            C = await page_for(br, errs, 'C', viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True, device_scale_factor=3)
            await C.goto(f'http://localhost:{PORT}/?room={code}')
            await C.wait_for_selector('#scr-menu:not([hidden])')
            await C.wait_for_function('window.__tf'); await C.evaluate('n => __tf.setName(n)', 'Phone'); await C.click('#btnJoin')
            await A.wait_for_function("document.querySelectorAll('#lbPlayers li').length===3", timeout=10000)
            for X in (B, C): await X.click('#btnReady')          # private rooms start only when everyone is ready
            await A.wait_for_function("__tf.room.players.filter(p => p.ready).length >= 2", timeout=6000)
            await A.click('#btnStart')
            for p in (A, B, C):
                await p.wait_for_selector('#hud:not([hidden])', timeout=10000)
            await asyncio.sleep(1.2)
            aid = await A.evaluate('__tf.net.myId')
            # B records A's interpolated pose every rendered frame
            await B.evaluate("""(aid)=>{ window.__rec=[]; const f=()=>{ const n=__tf.net; const p=n.remotePose(aid); if(p) __rec.push([performance.now(),p.x,p.z,p.v,p.alive?1:0]); requestAnimationFrame(f);}; requestAnimationFrame(f); }""", aid)
            # A drives in circles (direction mode: rotate the pressed key set) and fires
            await A.mouse.move(900, 300)
            seq = [['KeyW'], ['KeyW','KeyD'], ['KeyD'], ['KeyS','KeyD'], ['KeyS'], ['KeyS','KeyA'], ['KeyA'], ['KeyW','KeyA']]
            t_end = time.time() + 8
            i = 0; held = []
            # phone: push left stick to drive
            await C.evaluate("""()=>{const t=document.getElementById('touch'); const ev=(type,x,y)=>t.dispatchEvent(new PointerEvent(type,{pointerId:7,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true}));
                ev('pointerdown',150,300); window.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,pointerType:'touch',clientX:150,clientY:230,bubbles:true}));}""")
            c0 = await C.evaluate('[__tf.net.me.x,__tf.net.me.z]')
            while time.time() < t_end:
                for k in held: await A.keyboard.up(k)
                held = seq[i % len(seq)]; i += 1
                for k in held: await A.keyboard.down(k)
                if i % 3 == 0: await A.mouse.down(); await asyncio.sleep(0.05); await A.mouse.up()
                await asyncio.sleep(0.35)
            for k in held: await A.keyboard.up(k)
            c1 = await C.evaluate('[__tf.net.me.x,__tf.net.me.z]')
            rec = await B.evaluate('__rec')
            await A.screenshot(path=f'{OUT}/02-desktop-A.png'); await B.screenshot(path=f'{OUT}/03-desktop-B.png'); await C.screenshot(path=f'{OUT}/04-phone.png')
            await A.keyboard.down('Tab'); await A.screenshot(path=f'{OUT}/05-scoreboard.png'); await A.keyboard.up('Tab')
            await A.keyboard.press('F3'); await asyncio.sleep(0.5); await A.screenshot(path=f'{OUT}/06-debug.png')
            stats = await A.evaluate('({fps:__tf.game.perf.fps, rtt:__tf.net.st.rttAvg, snaps:__tf.net.st.snapsPS, corr:__tf.net.st.corrections, shells:__tf.game.W.shells.list.length, renders: window.__renders})')
            # smoothness of A as seen by B
            stalls = jumps = moving = 0; gaps = []
            for (t0,x0,z0,v0,a0),(t1,x1,z1,v1,a1) in zip(rec, rec[1:]):
                if not (a0 and a1): continue
                dt = t1 - t0; gaps.append(dt); d = ((x1-x0)**2 + (z1-z0)**2) ** 0.5; e = abs(v1) * dt / 1000
                if e < 0.03: continue
                moving += 1
                if d < e * 0.2: stalls += 1
                if d > e * 2.5 + 0.05: jumps += 1
            res = {'frames_recorded_by_B': len(rec), 'moving_frames': moving, 'stalls': stalls, 'jumps': jumps,
                   'avg_frame_ms': round(statistics.mean(gaps), 2) if gaps else None, 'A_stats': stats,
                   'phone_moved_m': round(((c1[0]-c0[0])**2 + (c1[1]-c0[1])**2) ** 0.5, 2),
                   'touch_ui_on_phone': await C.evaluate("document.body.classList.contains('touchui')"),
                   'hud_desktop_visible': await A.evaluate("!document.getElementById('hud').hidden")}
            # leave → menu
            await B.keyboard.press('Escape'); await B.click('#btnQuit'); await B.wait_for_selector('#scr-menu:not([hidden])', timeout=5000)
            res['B_left_ok'] = True
            await A.wait_for_timeout(400)
            res['room_players_after_leave'] = await A.evaluate('__tf.room.players.length')
            print(json.dumps(res, indent=1))
            await br.close()
    finally:
        srv.terminate()
    print('\n'.join(errs[:30]) if errs else 'NO BROWSER ERRORS')
asyncio.run(main())
