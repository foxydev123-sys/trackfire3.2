# The menu stage: your tank stands in the middle of the picture with an empty squad slot either
# side of it, the camera sits low and looks across Shar Park at the Citadel, and nothing on the
# stage — name plate or "+" — ever strays underneath the menu columns.
import asyncio, os, subprocess, time, sys, tempfile
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8822; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js')
DATA = tempfile.mkdtemp(prefix='kt-b20-')
SIZES = [(844, 390), (740, 360), (667, 375)]

CAM_HOOK = """() => { const st = __tf.stage, real = st.frame.bind(st);
  window.__cam = { x: 0, y: 0, z: 0 };
  st.frame = (dt, cam) => { const r = real(dt, cam);
    window.__cam = { x: cam.position.x, y: cam.position.y, z: cam.position.z }; return r; }; }"""

# Nothing on the stage may sit under either menu column, where it cannot be seen or pressed.
CLASH = """() => {
  const cols = ['#scr-menu .menu-col', '#homeSide'].map(s => document.querySelector(s)).filter(Boolean);
  const boxes = cols.map(c => c.getBoundingClientRect());
  const bad = [];
  for (const el of document.querySelectorAll('#stageNames .splate, #stageAdds .stage-add')) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    for (const b of boxes) {
      if (Math.min(r.right, b.right) - Math.max(r.left, b.left) > 2 &&
          Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 2)
        bad.push((el.className || '') + ' "' + el.textContent.trim().slice(0, 14) + '" is under a menu column');
    }
  }
  return bad;
}"""

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
            await p.wait_for_function('window.__tf'); await p.evaluate("__tf.setName('Solomon')")
            await p.wait_for_function("window.__tf.stage", timeout=15000)
            await p.evaluate(CAM_HOOK)
            await p.wait_for_timeout(900)

            ok(await p.evaluate("__tf.stage.views.size") == 1, 'your tank is on the stage on its own to begin with')

            # --- the camera: low, and looking across the park rather than down on it
            cam = await p.evaluate("window.__cam")
            ground = await p.evaluate("__tf.stage.groundY(window.__cam.x, window.__cam.z)")
            height = cam['y'] - ground
            ok(height < 8, f'the camera sits low over the ground ({height:.1f}m)')
            ok(cam['z'] > 40, f'and well back from the line-up ({cam["z"]:.0f})')

            # --- your tank is the middle of the picture
            pose = await p.evaluate("""() => { const e = [...__tf.stage.views.values()][0];
              return { x: e.view.root.position.x, z: e.view.root.position.z, yaw: e.view.root.rotation.y, slot: e.slot, me: !!e.me }; }""")
            ok(pose['me'], 'it is marked as yours')
            ok(0.35 < abs(pose['yaw']) < 1.1, f'turned about 35 degrees off the camera (yaw {pose["yaw"]:.2f})')
            # --- the two flags no longer stand between the camera and any tank
            blocked = await p.evaluate("""() => {
              const POLES = [[-5, 23.6], [5, 23.6]];
              const c = window.__cam, out = [];
              for (const e of __tf.stage.views.values()) {
                const t = e.view.root.position;
                for (const [px, pz] of POLES) {
                  const vx = t.x - c.x, vz = t.z - c.z, wx = px - c.x, wz = pz - c.z;
                  const L2 = vx * vx + vz * vz;
                  const s = L2 ? (wx * vx + wz * vz) / L2 : 0;
                  if (s < 0 || s > 1) continue;
                  const d = Math.hypot(wx - vx * s, wz - vz * s);
                  if (d < 3.5) out.push('a flag at ' + px + ',' + pz + ' blocks the view of a tank');
                }
              }
              return out;
            }""")
            ok(not blocked, 'the big flags stand behind the tanks, not in front of them'
               + ('' if not blocked else ' -> ' + '; '.join(blocked[:2])))

            # --- exactly one open place, with one "+" on it. The line-up is only as wide as
            # the squad needs, so three empty spots no longer crowd together on a phone.
            slots = await p.evaluate("__tf.stage.openSlots()")
            adds = await p.evaluate("""() => [...document.querySelectorAll('#stageAdds .stage-add')]
              .map(e => ({ slot: +e.dataset.slot, hidden: e.hidden,
                           x: parseFloat(e.style.left || 0), y: parseFloat(e.style.top || 0) }))""")
            ok(len(slots) == 1, f'there is one open place beside you ({len(slots)})')
            ok(len(adds) == 1 and not adds[0]['hidden'], f'with a single + standing on it ({len(adds)})')

            # that + must not sit on top of a tank
            onTank = await p.evaluate("""() => {
              const st = __tf.stage, V = new (window.__V3 || Object)();
              const b = document.querySelector('#stageAdds .stage-add:not([hidden])');
              if (!b) return 'no +';
              const r = b.getBoundingClientRect(), out = [];
              for (const e of st.views.values()) {
                const p = st.slotScreen(e.slot, __tf.game.camera, st._probe || (st._probe = new (e.view.root.position.constructor)()), 1.6);
                if (!p.on) continue;
                if (Math.abs(p.x - (r.left + r.width / 2)) < 46 && Math.abs(p.y - (r.top + r.height / 2)) < 46)
                  out.push('a tank is under the +');
              }
              return out; }""")
            ok(onTank == [] or onTank == 'no +', f'and not on top of a tank ({onTank})')

            # --- a name plate only ever exists where a tank actually stands
            plates = await p.evaluate("""() => [...document.querySelectorAll('#stageNames .splate')]
              .map(e => ({ slot: +e.dataset.slot, text: e.textContent.trim() }))""")
            taken = await p.evaluate("[...__tf.stage.views.values()].map(e => e.slot)")
            ok(len(plates) == len(taken) and all(pl['slot'] in taken for pl in plates),
               f'a name plate only appears over a real tank ({[pl["slot"] for pl in plates]} vs {taken})')

            # --- a squad of four fills every slot and the +s go
            await p.evaluate("""() => {
              __tf.acc.party = { leader: 'me', members: [
                { id: 'me', name: 'Solomon', tank: { id: 'zagros', level: 4 } },
                { id: 'p2', name: 'Hemin',   tank: { id: 'safeen', level: 3 } },
                { id: 'p3', name: 'Dilan',   tank: { id: 'korek',  level: 2 } },
                { id: 'p4', name: 'Aram',    tank: { id: 'newroz', level: 5 } } ] };
              __tf.acc.emit('party', __tf.acc.party); }""")
            await p.wait_for_timeout(700)
            ok(await p.evaluate("__tf.stage.views.size") == 4, 'a full squad puts four tanks on the stage')
            ok(await p.evaluate("__tf.stage.openSlots().length") == 0, 'with no places left open')
            ok(await p.evaluate("document.querySelectorAll('#stageAdds .stage-add').length") == 0,
               'and no + left to press')
            spread = await p.evaluate("[...__tf.stage.views.values()].map(e => +e.view.root.position.x.toFixed(1))")
            ok(len(set(spread)) == 4, f'each tank has its own place in the line ({spread})')

            # --- changing tank swaps the model
            before = await p.evaluate("[...__tf.stage.views.values()].map(e => e.kind)")
            await p.evaluate("""() => { __tf.acc.party.members[1].tank = { id: 'bradost', level: 1 };
              __tf.acc.emit('party', __tf.acc.party); }""")
            await p.wait_for_timeout(500)
            after = await p.evaluate("[...__tf.stage.views.values()].map(e => e.kind)")
            ok('bradost' in after and before != after, f'changing tank swaps the model ({before} -> {after})')
            await ctx.close()

            # --- at every phone size, nothing on the stage hides under the menu columns
            for (W, H) in SIZES:
                ctx = await br.new_context(viewport={'width': W, 'height': H}, has_touch=True,
                                           is_mobile=True, service_workers='block')
                p = await ctx.new_page()
                p.on('pageerror', lambda e: errs.append(f'PAGEERROR {e}'))
                await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
                await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
                await p.wait_for_function('window.__tf && window.__tf.stage', timeout=15000)
                await p.wait_for_timeout(1100)
                clash = await p.evaluate(CLASH)
                ok(not clash, f'nothing on the stage hides under the menu — {W}x{H}'
                   + ('' if not clash else ' -> ' + '; '.join(clash[:2])))
                await ctx.close()
            await br.close()
    finally:
        srv.terminate()
    for e in errs: print('  ' + e)
    bad = fails + errs
    print(('FAILED: %d' % len(bad)) if bad else 'browser-test20: all good')
    sys.exit(1 if bad else 0)

asyncio.run(main())
