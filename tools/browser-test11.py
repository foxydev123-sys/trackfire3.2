# Voice chat between two real browsers: fake microphones, a peer-to-peer link through the game server's
# signalling only, push-to-talk, team vs everyone, and muting one player.
import asyncio, os, subprocess, time, sys, tempfile, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8802; MOCK = os.path.join(ROOT, 'tools', 'mock-three.js'); OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
DATA = tempfile.mkdtemp(prefix='kt-b11-')
FAKE = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']

async def mk(br, errs, tag, **kw):
    c = await br.new_context(permissions=['microphone'], service_workers='block', **kw); p = await c.new_page()
    p.on('pageerror', lambda e: errs.append(f'[{tag}] PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' else None)
    await p.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=MOCK, content_type='text/javascript'))
    await p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return p

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(PORT), 'DATA_DIR': DATA, 'REG_LIMIT': '100'}, stdout=subprocess.PIPE)
    time.sleep(0.9)
    errs = []; res = {}
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=FAKE)
            A = await mk(br, errs, 'host', viewport={'width': 1280, 'height': 800})
            B = await mk(br, errs, 'guest', viewport={'width': 1280, 'height': 800})
            for p, n in ((A, 'Hemin'), (B, 'Lina')):
                await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_selector('#scr-menu:not([hidden])')
                await p.wait_for_function('window.__tf'); await p.evaluate('n => __tf.setName(n)', n)
            # a private room with both players
            await A.click('#btnCreate')
            # match setup comes first now: mode, map and time, then open the lobby
            await A.wait_for_selector('#scr-setup:not([hidden])'); await A.click('#btnSuGo')
            await A.wait_for_function("document.getElementById('lbCode').textContent.trim().length===5 && !/[·-]/.test(document.getElementById('lbCode').textContent)", timeout=12000)
            code = (await A.inner_text('#lbCode')).strip()
            res['room'] = code
            await B.goto(f'http://localhost:{PORT}/?room={code}')
            await B.wait_for_function("(() => { const m = document.getElementById('scr-menu'), l = document.getElementById('scr-lobby'), w = document.getElementById('welcome'); return (w && !w.hidden) || (m && !m.hidden) || (l && !l.hidden); })()", timeout=15000)
            if await B.is_visible('#welcome'):
                # an invite link opened by someone new: the first-run screen asks name, age, city
                await B.fill('#wcName', 'Lina'); await B.click('#wcNext')
                await B.click('#wcYears button[data-y="1998"]'); await B.click('#wcNext')
                await B.click('#wcSkip')
                await B.wait_for_function("(() => { const m = document.getElementById('scr-menu'), l = document.getElementById('scr-lobby'); return (m && !m.hidden) || (l && !l.hidden); })()", timeout=15000)
            if await B.is_visible('#scr-menu:not([hidden])'):
                await B.wait_for_function('window.__tf'); await B.evaluate('n => __tf.setName(n)', 'Lina'); await B.click('#btnJoin')
            await B.wait_for_selector('#scr-lobby:not([hidden])', timeout=15000)
            await A.wait_for_function("__tf.room && __tf.room.players.filter(p => !p.bot).length === 2", timeout=10000)
            # both switch voice on (settings)
            await A.evaluate("__tf.setVoice({ voice: true, voiceMode: 'push', voiceTalk: 'all', voiceHear: 'all' })")
            await B.evaluate("__tf.setVoice({ voice: true, voiceMode: 'push', voiceTalk: 'all', voiceHear: 'all' })")
            await A.wait_for_timeout(1200)
            res['micOn'] = [await p.evaluate("__tf.voice.on") for p in (A, B)]
            res['micError'] = [await p.evaluate("__tf.voice.error") for p in (A, B)]
            # start the match, then wait for the peer link
            await B.click('#btnReady'); await A.wait_for_timeout(500)
            await A.click('#btnStart'); await A.wait_for_selector('#hud:not([hidden])', timeout=15000)
            await B.wait_for_selector('#hud:not([hidden])', timeout=15000)
            for p in (A, B):
                try:
                    await p.wait_for_function("(() => { const v = __tf.voice; return v && [...v.peers.values()].some(x => x.state === 'connected'); })()", timeout=25000)
                except Exception: pass
            res['linked'] = [await p.evaluate("(() => { const v = __tf.voice; return [...v.peers.values()].map(x => x.state); })()") for p in (A, B)]
            res['gotAudio'] = [await p.evaluate("(() => [...__tf.voice.peers.values()].filter(x => !!x.audio).length)()") for p in (A, B)]
            # push to talk: A holds V, B should see him talking
            await A.evaluate("__tf.voice.setTalking(true)")
            await A.wait_for_timeout(2200)
            res['aSending'] = await A.evaluate("(() => [...__tf.voice.peers.values()].map(p => !!(p.out && p.out.enabled)))()")
            res['bHearsLevel'] = await B.evaluate("(() => Math.max(0, ...[...__tf.voice.peers.values()].map(p => p.level || 0)))()")
            res['bSeesTalking'] = await B.evaluate("(() => [...__tf.voice.peers.values()].some(p => p.talking))()")
            res['bPanelTalking'] = await B.evaluate("!!document.querySelector('#vcList li.talk')")
            await B.screenshot(path=f'{OUT}/voice-talking.png')
            await A.evaluate("__tf.voice.setTalking(false)")
            await A.wait_for_timeout(600)
            res['aStopped'] = await A.evaluate("(() => [...__tf.voice.peers.values()].every(p => !(p.out && p.out.enabled)))()")
            # team-only talk: put them on different teams, A talks to team → B must NOT be sent audio
            await A.evaluate("__tf.setVoice({ voiceTalk: 'team' })")
            await A.evaluate("(() => { const me = __tf.net.myId; __tf.voice.teamOf = (id) => (id === me ? 'blue' : 'red'); })()")
            await A.evaluate("__tf.voice.setTalking(true)"); await A.wait_for_timeout(500)
            res['teamOnlyBlocks'] = await A.evaluate("(() => [...__tf.voice.peers.values()].every(p => !(p.out && p.out.enabled)))()")
            await A.evaluate("__tf.voice.setTalking(false)")
            # muting one player
            bid = await B.evaluate("__tf.net.myId")
            try: await A.wait_for_function(f"(() => {{ const p = __tf.voice.peers.get({bid}); return !!(p && p.audio); }})()", timeout=15000)
            except Exception: pass
            await A.evaluate(f"__tf.voice.mute({bid}, true)")
            res['muted'] = await A.evaluate(f"(() => {{ const p = __tf.voice.peers.get({bid}); return !!(p && p.audio && p.audio.muted); }})()")
            await A.evaluate(f"__tf.voice.mute({bid}, false)")
            res['unmuted'] = await A.evaluate(f"(() => {{ const p = __tf.voice.peers.get({bid}); return !!(p && p.audio && !p.audio.muted); }})()")
            # back on the same team, team-only talk must go through again
            await A.evaluate("(() => { __tf.voice.teamOf = () => 'blue'; })()")
            await A.evaluate("__tf.voice.setTalking(true)"); await A.wait_for_timeout(400)
            res['teamOnlyAllows'] = await A.evaluate("(() => [...__tf.voice.peers.values()].some(p => p.out && p.out.enabled))()")
            await A.evaluate("__tf.voice.setTalking(false)")
            await br.close()
    finally:
        srv.terminate()
    print(json.dumps(res, indent=1))
    for e in errs[:10]: print(e)
    f = []
    if not all(res.get('micOn') or []): f.append(f"a microphone did not start ({res.get('micError')})")
    if not any('connected' in (x or []) for x in (res.get('linked') or [[]])): f.append('the two players never linked up')
    if not all(res.get('gotAudio') or []): f.append('no incoming voice stream arrived')
    if not any(res.get('aSending') or []): f.append('holding the key did not send any voice')
    if not res.get('bSeesTalking') and not res.get('bPanelTalking'): f.append('the other player never showed as talking')
    if not res.get('aStopped'): f.append('letting go of the key did not stop sending')
    if not res.get('teamOnlyBlocks'): f.append('talking to team still reached the other team')
    if not res.get('teamOnlyAllows'): f.append('talking to team did not reach your own team')
    if not res.get('muted'): f.append('muting a player did not silence him')
    if not res.get('unmuted'): f.append('unmuting did not bring him back')
    if errs: f.append(f'{len(errs)} page errors')
    print('\n'.join('FAIL ' + x for x in f) if f else 'ALL VOICE TESTS PASS')
    sys.exit(1 if f else 0)
asyncio.run(main())
