# Headless smoke test of the trailer page: plays the timeline at 720p and records it (mock three.js, so the 3D is blank).
import asyncio, os, subprocess, time, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8767; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
LANG = sys.argv[2] if len(sys.argv) > 2 else 'ku'; FMT = sys.argv[3] if len(sys.argv) > 3 else 'h'
async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE); time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            p = await (await br.new_context(viewport={'width': 1280, 'height': 900})).new_page()
            p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
            p.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
            await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
            await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await p.goto(f'http://localhost:{PORT}/trailer.html')
            await p.wait_for_function("!document.getElementById('rec').disabled", timeout=20000)
            await p.click(f'#lang [data-v="{LANG}"]'); await p.click(f'#fmt [data-v="{FMT}"]'); await p.click('#res [data-v="720"]')
            await p.fill('#link', '@kurdishtank')
            await p.click('#rec')
            for s in [2.2, 6, 11, 16.5, 23, 27, 31, 36.5, 42, 44.2, 50]:
                await p.wait_for_function(f"parseFloat(document.getElementById('bar').style.width)>={s/54*100}", timeout=90000)
                await p.locator('#out').screenshot(path=f'{OUT}/tr-{LANG}{FMT}-{int(s*10):03d}.png')
            await p.wait_for_selector('#done:not([hidden])', timeout=30000)
            print('STATUS', await p.text_content('#status'))
            await br.close()
    finally:
        srv.terminate()
    print('ERRORS', len(errs)); [print(e) for e in errs[:20]]
asyncio.run(main())
