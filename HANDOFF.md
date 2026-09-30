# Kurdish Tank: handoff document

_Written 29 September 2026, at the end of a long build session, for a fresh AI picking this project up with no prior context._

The owner is **Solomon** (goes by solomon max). He is a solo indie developer in Iraq (Kurdistan region). He is not a professional programmer. He describes features in plain language, sometimes with typos, and expects the AI to design, code, test and package everything. He tests on his phone and PC and reports bugs back.

**Project names:** the project folder is still called `trackfire-game`, and the code and Render URLs still say "Trackfire" in places. That was the working title. The game is now **Kurdish Tank** (کوردی تانک).

---

## 1. Project overview

### What the game is

- **Genre:** a multiplayer online tank battle arena. Low-poly 3D, top-down/three-quarter chase camera, arcade handling. Think a small, mobile-friendly *Tanki Online / World of Tanks Blitz lite* with party modes.
- **Theme:** Kurdistan.
  - Maps:
    - **Hawler City:** Erbil, with the Citadel on its mound, the ring road, Shar Park, the bazaar and clock towers.
    - **Dune Crossing:** desert.
    - **Pinewood Ford:** forest, with a river and one bridge.
  - Kurdish flags fly on every map and on every tank antenna.
  - Tank names are Kurdish places and words (Zagros, Baz, Halgurd, Rashaba, Safeen, Bradost, Korek, Newroz).
  - About half of the bot names are Kurdish.
- **Languages:** Kurdish (Sorani), Arabic and English. Kurdish and Arabic switch the whole UI to right-to-left. The in-game HUD keeps the same corners in every language; only the text is mirrored.
- **Platforms:**
  - It runs in any modern browser on PC and phones, with no install and no build step.
  - There is an installable PWA (manifest + service worker).
  - There is a small hand-built Android APK: a full-screen WebView that opens the server URL.
  - Planned: Google Play (developer account already bought). iOS and Steam are "coming soon" ideas only.
- **Audience:** originally Solomon and his friends. Now aimed at a public launch for players in Iraq/Kurdistan and the wider Arabic-speaking region, with mobile first.

### Core loop

1. Open the game. On first launch, pick a name, birth year (only the age group is kept) and city.
2. Pick one of:
   - **Quick match:** random mode + random map, bots fill empty seats.
   - **Ranked:** 4v4, random mode among 6, random map, with a "draw" reel animation.
   - **Private room:** 5-letter code or invite link; the host picks map, mode, bots and day/night.
   - **Practice:** offline vs bots. The whole server Room runs in a Web Worker.
3. Fight. Drive, aim, shoot, grab power-up pads, and charge your tank's **special power by damaging enemies**, then aim and place it.
4. End screen: scores, **MVP for each team**, and rewards (coins, parts, gems, RP, chests, rank-up tank unlocks).
5. Spend: upgrade tanks (5 stats × 0–5, plus the power level 1–5) with coins + parts, open chests, spin the wheel, claim daily rewards, daily quests and **100 long-term goals**.
6. Social: friends by ID (`Name#1234`), presence, private chat, squads, profiles with stats and garage, leaderboards, report/block. **Voice chat** in matches (WebRTC).

### Current state

**Works today** (all covered by automated tests that pass: 11 Node suites and 14 browser suites):

- **Netcode:**
  - Server-authoritative 30 Hz simulation, client prediction and reconciliation, snapshot interpolation.
  - Reconnect (45 s slot hold); latency simulator.
- **Maps and objects:** 3 maps, day/night, destructible props, debris.
- **12 modes:**
  - Classic: Team Battle (`tdm`), Free-for-all (`ffa`), Capture the Flag (`ctf`), King of the Citadel (`koh`), Last Tank Standing (`lts`), Power-up Rush (`rush`).
  - Party: Convoy Escort (`convoy`), Juggernaut (`jugg`), Tank Ball (`ball`), Survival Waves (`surv`), Hot Potato (`potato`), Bounty Hunt (`bounty`).
- **Power-ups:** shield, speed, full health, one-shot, plus homing rockets.
- **Bots:** A* navigation, three skill levels, use of tank powers.
- **Tanks and powers:** 8 tanks, each with a stat identity and **one special power**, upgradeable to level 5 and charged by damage:

  | Tank | Power |
  |---|---|
  | Zagros | wall |
  | Baz | suicide drone car |
  | Halgurd | dome shield |
  | Rashaba | 3 s invisibility |
  | Safeen | guided missile, steered with the move stick, camera follows |
  | Bradost | freeze cage |
  | Korek | heal shot: full heal on allies, half damage on enemies, green ring and pluses when armed |
  | Newroz | black hole |

- **Accounts:** no password. A random secret is kept in localStorage. SQLite on the server; Supabase Storage backup of the DB file.
- **Ranks and ranked:**
  - Ranks: Bronze → Commander with III/II/I divisions, plus Legend (top 100). Placements, 2-month seasons.
  - Ranked queue: one 4v4 queue with ACCEPT, squads, and bots fill after 60 s (those matches are unrated).
  - **Each new rank unlocks a tank**, weakest to strongest; if already owned you get parts.
- **Economy:** coins, gems, parts; chests with shown odds; lucky wheel; 7-day daily reward; daily quests; tank quests; shop; Google Play Billing server-side verification (not yet live).
- **Goals and MVP:** 100 achievements; MVP per team.
- **Friends and chat:** friends, chat with a bad-word filter (EN/AR/KU), squads, reports, blocks, profiles, leaderboards, account deletion (in-game plus a web page for Google Play).
- **Voice chat:** WebRTC mesh; talk to team/all and listen to team/all as separate settings; push-to-talk or open mic; per-player mute. Off for under-13 accounts.
- **Controls:**
  - Touch: dual sticks, FIRE, power button, mic button, and a **layout editor** (drag and resize every control, opacity, follow-thumb).
  - PC: Direction or Classic driving.
- **Graphics and performance:** quality defaults to best; the HUD, minimap, scoreboard, kill feed and debug panel (F3) all work; perf test passes (about 0.14 ms per tick for the worst mode, about 6.4 KB/s per player).
- **First-run flow:** name → age → city. Name and city can be changed from the profile (name once per 30 days). This flow also triggers when a brand-new player presses PRACTICE first.
- **Test button:** the **SECRET BUTTON** row in Settings, tapped 13 times, reveals +10,000 gems, 100,000 coins and 5,000 parts. It counts down from the fifth tap and is remembered per device. **ON by default** (see Known issues).
- **Extras:**
  - Promo tools: `client/studio.html` (promo image studio for TikTok/square/wide shots) and `client/trailer.html` (a deterministic 54 s trailer rendered with game code, in Kurdish or Arabic).
  - Store graphics in `store/`.
  - `deploy/vps-setup.sh`: one command sets up a VPS (Node 22, systemd, Caddy HTTPS, firewall).

- **Leader authority:** only the squad leader can start anything or pick the map; `iLead()` and
  `mayStart()` in main.js, `partyMap` on the server. Members get BROWSE MENU to wander without leaving.
- **Corner menu:** all secondary buttons live in `#mnDrawer` behind `#btnMore`. A browser test that
  clicks one of them must open the drawer first — `menuClick(page, sel)` in the test files does it.
- **Squad panel:** leave, see the leader, promote, kick, open a profile (`partyPromote` on the server).
- **Lobby maps:** each map has a second copy (`getLobbyMap`) with the staging area swept clear, plus
  a moving background (cars, jets, distant gunfire) that is skipped entirely on low quality.
- **Menu stage:** four standing spots in Shar Park with the Citadel behind; you take the middle one,
  empty spots show a + that opens your friends list, and name plates show each player's pick live.
  A squad follows its leader into any non-ranked room automatically and arrives ready.
  `client/js/game/lobbystage.js`. The menu buttons sit in two columns around it.

**Half-built or not live yet:**

- **Real-money gems:** the code is done. Google Play merchant accounts are **not available in Iraq**, so the shop hides itself when payments aren't configured. The plan is to launch free and sell later via a payments profile in another country.
- **Android app:**
  - The APK works, but it is a plain WebView. **It cannot give the microphone to the page**, because that needs a `WebChromeClient.onPermissionRequest` subclass, which the hand-written DEX doesn't have. So voice chat does not work inside the APK yet; it works in the mobile browser over HTTPS.
  - `PUBLISHING.md` still describes the PWABuilder/TWA route, which is the planned Play Store route. The hand-built APK is for sideloading and testing.
  - A Capacitor build was mentioned as the future path, but it has not been started.
- **AdMob ads:** planned (Solomon confirmed AdMob pays out in Iraq). Nothing implemented. Note that PUBLISHING.md currently says "Ads: No" for the Play form.
- **Low-ping hosting:** planned move to a VPS in Kurdistan (Erbil/Baghdad). The script and docs are ready. **Not bought yet**; Solomon said he won't buy until he publishes.
- **TURN relay for voice:** not set up. Players on strict mobile NATs may fail to connect voice.

**Not started (ideas he has mentioned):**

- Linking game accounts to social media (also the real fix for password-less accounts).
- A TikTok account to test interest.
- iOS and Steam releases.

---

## 2. Tech stack and architecture

### Languages and libraries

- **JavaScript (ES modules) everywhere.** No TypeScript, no bundler, no transpiler, **no build step**. The browser loads the source files directly.
- **Server:** Node.js **22.13+**, with **zero npm dependencies** (there is no `node_modules`). It uses built-ins only:
  - `node:http` for static files and a JSON API;
  - a hand-written RFC 6455 WebSocket in `server/ws.js`;
  - `node:sqlite` (`DatabaseSync`) for the database, which is why Node 22.13+ is required;
  - `node:crypto`.
- **Client rendering:** **Three.js r149** (0.149.0), loaded from the jsDelivr CDN through the single re-export file `client/js/three.js`. Everything is low-poly geometry built in code: no model files and no texture files, except small JPG mode thumbnails and icons.
- **Audio:** procedural Web Audio sound effects and music (`client/js/audio/audio.js`); no audio files.
- **Voice:** WebRTC peer-to-peer mesh, signalled through the game WebSocket.
- **Tests:** Node scripts in `tools/*.js`, and Python Playwright browser tests in `tools/browser-test*.py`, which use headless Chromium and a stand-in for Three.js (`tools/mock-three.js`).
- **Android:** `tools/android/build_apk.py` is pure Python with no Android SDK. It writes the DEX, the binary manifest, resources.arsc and the v2 APK signature by hand.

### Folder map

```
trackfire-game/
├─ server/            Node server (runs on the host)
│  ├─ index.js        entry: HTTP static + JSON API + WebSocket rooms (/ws) + social hub (/hub) + tick loop; env config
│  ├─ ws.js           minimal WebSocket server implementation
│  ├─ store.js        SQLite schema + queries: accounts, friends, blocks, messages, matches, match_players, reports, delete_requests
│  ├─ social.js       live hub: presence, chat, friend requests, squads, ranked queue/matchmaking, eco ops over the hub
│  ├─ economy.js      wallet, garage, upgrades, chests, wheel, daily, quests, achievements, rank rewards, Play purchase verification, cheat()
│  ├─ backup.js       Supabase Storage backup/restore of the .db file
│  └─ filter.js       bad-word + name filter (EN/AR/KU)
├─ client/            everything the browser loads (served as static files)
│  ├─ index.html      the whole UI markup (menu, lobby, HUD, touch controls, modals, settings, welcome)
│  ├─ css/style.css   all styles (dense, one file)
│  ├─ shared/         code that runs on BOTH server and client (the key idea of the architecture)
│  │  ├─ config.js    gameplay + network numbers (NET, GAME, MODES, RANKED, QUICK_MODES, POWERUPS…)
│  │  ├─ sim.js       deterministic tank/shell physics + collision (used by server AND client prediction)
│  │  ├─ room.js      the authoritative match: join/leave, inputs, bots, damage, modes, scoring, snapshots, MVP, end
│  │  ├─ modes2.js    rules for party modes (convoy, jugg, ball, surv, potato, bounty)
│  │  ├─ protocol.js  binary input + snapshot encoding, flags
│  │  ├─ maps.js      deterministic map generation (obstacles, spawns, pads, props)
│  │  ├─ tanks.js     the 8 tanks: stats, rarity, upgrade costs, modsOf()
│  │  ├─ abilities.js the 8 powers: numbers per level, charge needed, aim type, range, map-effect helpers
│  │  ├─ abrun.js     server runtime of the powers (use, missiles, drones, walls, domes, holes, freeze, heal, bot policy)
│  │  ├─ achievements.js 100 long-term goals
│  │  ├─ economy.js   reward tables, chest odds, wheel, daily, quests, shop, GEM_PRODUCTS, TIER_TANK
│  │  ├─ ranks.js     rank tiers, divisions, seasons (+ legacy weekly quick mode)
│  │  ├─ bot.js, nav.js  bot brain + A* grid
│  │  └─ math.js
│  ├─ js/
│  │  ├─ main.js      app entry: screens, wiring, first-run welcome, connect/practice, settings, voice wiring, test hooks (window.__tf)
│  │  ├─ account.js   player account in localStorage + hub connection
│  │  ├─ settings.js  settings object (localStorage 'trackfire-settings') + CAMERA constants
│  │  ├─ i18n.js      ALL UI strings in en / ar / ku (t('key'))
│  │  ├─ three.js     single Three.js import (CDN)
│  │  ├─ practice-worker.js  runs shared/room.js in a Web Worker for offline practice
│  │  ├─ net/         connection.js (transport + latency sim), netclient.js (prediction, reconciliation, interpolation, message handling)
│  │  ├─ game/        game.js (frame loop, camera, world wiring), world.js, prefabs.js, tank.js, shells.js, rockets.js, fx.js, fxtex.js, debris.js, batch.js, modeprops.js, abilityfx.js
│  │  ├─ input/       input.js (keyboard/mouse + latched taps), touch.js (sticks, buttons, layout editor)
│  │  ├─ ui/          hud.js, social.js, eco.js, icons3d.js, icon-urls.js
│  │  ├─ audio/       audio.js (procedural SFX/music), voice.js (WebRTC voice)
│  │  ├─ studio.js / trailer.js / trailer-audio.js   promo tools
│  ├─ img/modes/      12 small mode thumbnails (jpg)
│  ├─ icons/          app icons
│  ├─ sw.js           service worker (cache name 'kt-v7': BUMP on every release)
│  ├─ manifest.webmanifest, privacy.html, delete-account.html, studio.html, trailer.html
│  └─ server-config.js  optional external server address (empty = same origin)
├─ tools/             tests, bots, perf, APK builder (see README "Tests and tools")
│  └─ android/        build_apk.py, check_apk.py, release-key.pem (SECRET: never share/zip)
├─ deploy/vps-setup.sh
├─ store/             Play Store icon + feature graphic
├─ data/              runtime SQLite DB (git-ignored, never ship)
├─ README.md          player-facing features, controls, networking explanation, tests, layout
├─ DEPLOY.md          hosting options, env vars, backup, voice, powers, test button
├─ PUBLISHING.md      Google Play / TWA steps, store texts, Play form answers
├─ render.yaml, Dockerfile, fly.toml, package.json
```

### How the pieces talk

```
 Browser (client/js)                                   Node server (server/)
 ┌──────────────────────────┐   HTTP GET static files  ┌────────────────────────────┐
 │ main.js  screens/UI       │ ───────────────────────► │ index.js static + /api/*   │
 │ account.js ──/api/register, /api/me, /api/profile… ─►│ store.js (SQLite)          │
 │            ──WS /hub (presence, chat, squads, ───────►│ social.js + economy.js     │
 │                ranked queue, eco ops, goals)         │                            │
 │ netclient.js ─WS /ws  hello{name,token,action,code} ─►│ Room (client/shared/room.js)│
 │   13-byte binary input every 1/30 s ────────────────►│   30 Hz tick: sim.js,       │
 │   ◄──── binary snapshots 30/s + JSON events ─────────│   abrun.js, modes2.js, bots │
 │ game.js renders at display fps with Three.js         │                            │
 │ voice.js ◄──WebRTC audio peer-to-peer──► other players (signalling relayed as {t:'rtc'})
 └──────────────────────────┘                          └────────────────────────────┘
 Practice mode: the same Room class runs inside practice-worker.js; netclient talks to it via postMessage.
```

- **Shared-code principle.** `client/shared/` is imported by the server (via relative paths from `server/`) and by the browser. Movement physics (`sim.js`) must stay **deterministic and identical** on both sides; prediction depends on it. Never put browser-only or Node-only APIs in `shared/`.
- **Authority.** Clients send only inputs. The server decides movement, hits, damage, kills, power effects, scores and rewards. Never trust the client for economy or combat.
- **Input packet (13 bytes).** Move direction, aim angle, buttons (`BTN_FIRE=1`, `BTN_AB=2`), sequence number, and byte 12 = `abd` (power placement distance as a fraction of its range). 12-byte packets are still accepted for compatibility.
- **Snapshots.** Binary, about 18 bytes plus 18 per tank. Flags include `FLAG_CLOAK=32` and `FLAG_FROZEN=64`. Cloaked tanks are **removed from enemies' snapshots** (per-viewer bodies are built only when someone is cloaked). Names, teams and scores come as JSON only when they change.
- **Events.** JSON messages on the same socket, for example:
  - kill feed;
  - `fx` (walls, domes and holes state);
  - `ab` (a power was used);
  - `abc` / `abReady` (charge);
  - `carBoom` (drone explosion; renamed from `boom` because Hot Potato already used `boom`);
  - `heal`;
  - `ae` stream (missile/drone entity positions);
  - `rtc` / `vc` (voice signalling and state);
  - `mvp`.
- **Map effects.** `map.fx = {walls, domes, holes}` is created by `attachFx`, which **wraps `map.near`** so power walls act as normal colliders. Walls live in `fx`, not the static obstacle list. `fxForces` (black-hole pull) runs inside `stepTank`; `domeBlock` inside `stepShell` stops shells at a dome skin.
- **Power flow:**
  1. Charge fills from damage dealt (`p.abChg` vs `abNeed(ab, level)`); the server pushes `{t:'abc'}`.
  2. The player taps Q / the power button to **arm** (client-side `net.ab.armed`).
  3. They aim with the mouse or the aim stick. A ghost preview shows placement and distance.
  4. FIRE sends the `ab` bit + `abd`.
  5. The server runs `abUse`.

  Aim types: `ground` (placed at a spot), `dir` (a direction), `shot` (arms the next shell: heal, freeze) and `self` (instant: cloak). For Safeen's missile the tank holds still while the player steers it with the move stick, and the camera rides the missile (`rideK`).
- **Accounts.** `POST /api/register` returns `{id, secret}`, stored in localStorage. The server stores only `sha(secret)`. The hub and room hello carry `auth:{id, secret}`. No email and no password.
- **Persistence.** One SQLite file `data/kurdish-tank.db` (`DATA_DIR` env). On Render free the disk is wiped on sleep, so `backup.js` uploads the file to Supabase Storage every 60 s when it has changed, and restores it on boot before accepting players. Economy state is stored per account as JSON (`eco`, including `eco.prog` lifetime counters for goals).
- **Rendering.** `game.js` owns the frame loop and chase camera. `world.js` and `prefabs.js` build the maps from the deterministic `maps.js` layout. `batch.js` merges static geometry. Tanks are `TankView` objects (`tank.js`). Particles and effects live in `fx.js` / `fxtex.js`, and powers in `abilityfx.js`. The HUD is DOM (`hud.js`), not WebGL.
- **Input.** `input.js` samples at 30 Hz but **latches quick taps** (`abTap`, `firePulse`) so a tap between samples isn't lost. `touch.js` has the sticks and buttons (MOVE, AIM, FIRE, POWER, MIC) and the layout editor; `TOUCH_DEFAULT` sizes are 0.8.

---

## 3. Key files

**Read these first (★):**

| File | Why |
|---|---|
| ★ `README.md` | Features, controls, networking explanation, test commands, layout. Mostly current. |
| ★ `DEPLOY.md` | Hosting, all env vars, backup, voice/HTTPS, powers, **test button warning**. |
| ★ `client/shared/config.js` | All tunable gameplay and network numbers; ranked and quick settings. |
| ★ `client/shared/room.js` | Heart of the game: the authoritative match (≈880 dense lines). |
| ★ `client/shared/sim.js` | Deterministic physics shared with prediction. Change with great care. |
| ★ `client/js/main.js` | App wiring, screens, first run, connect/practice flows, test hooks. |
| ★ `client/js/net/netclient.js` | Prediction, reconciliation, interpolation, all incoming message handling. |
| ★ `server/index.js` | Routes, env flags (`TEST_CHEATS`, payments, admin), room creation, quick/ranked. |

**Others:**

| File | Responsibility |
|---|---|
| `client/shared/abilities.js` | Numbers for the 8 powers per level, charge cost, aim type, range; fx helpers. |
| `client/shared/abrun.js` | Server-side power behaviour, missiles/drones stepping, bot power policy. |
| `client/shared/modes2.js` | Party mode rules. |
| `client/shared/tanks.js` | Tank stats, rarity, upgrade costs. `modsOf` must keep `ab` (it once dropped it; bug fixed). |
| `client/shared/economy.js` | Reward tables, chest odds, shop, `GEM_PRODUCTS`, `TIER_TANK` (rank → tank). |
| `client/shared/achievements.js` | The 100 goals (18 families + 11 mode goals). |
| `client/shared/protocol.js` | Binary formats; keep client and server in sync. |
| `client/shared/maps.js` | Deterministic maps; `buildMap(id)` / `getMap`. |
| `server/economy.js` | All wallet mutations, `cheat()`, achievements, rank rewards, purchase checks. |
| `server/social.js` | Hub protocol, ranked queue (one SIZE=4 queue), squads, profile incl. garage. |
| `server/store.js` | Schema + migrations (adds columns with `ALTER TABLE` if missing), `ageGroup()`. |
| `server/backup.js` | Supabase backup. |
| `client/js/game/game.js` | Frame loop, camera (incl. missile ride camera), world and effects wiring, perf caches. |
| `client/js/game/abilityfx.js` | Visuals of walls, domes, holes, missile, drone, cage; placement ghost. |
| `client/js/ui/hud.js` | HUD, nametags with strength stars, power chip, voice panel, end screen with MVP. |
| `client/js/ui/eco.js` | Garage (incl. power card), shop, chests, wheel, daily, quests, goals page. |
| `client/js/ui/social.js` | Profile (own: rename/city), friends, chat, leaderboards, ranked page. |
| `client/js/input/touch.js` | Touch controls + layout editor (all 5 controls draggable). |
| `client/js/audio/voice.js` | `VoiceChat` class (WebRTC mesh, team/all routing via cloned tracks). |
| `client/js/i18n.js` | Every string in 3 languages. Any new UI text needs all three. |
| `client/sw.js` | Offline cache; bump `CACHE` each release or phones keep old files. |
| `tools/android/build_apk.py` | APK builder; version name/code defaults are set here (now 2.3 / 14). |
| `deploy/vps-setup.sh` | VPS installer. |

---

## 4. Decisions and constraints (with reasons)

### Architecture decisions

1. **Plain JS, no framework, no bundler, no npm dependencies.**
   - *Why:* Solomon deploys by uploading the folder to GitHub (web UI) and Render. No build means nothing to break, no `npm install`, and a tiny attack surface.
   - *Rejected:* Unity or Godot (heavy, needs installs, no instant browser play), React/Vite (build step), Socket.IO / `ws` package (dependencies; a small RFC 6455 implementation is enough).
2. **Node 22 built-in `node:sqlite`** instead of Postgres or a hosted DB.
   - *Why:* zero dependencies, one file, trivially backed up.
   - *Trade-off:* the Render free disk is wiped, hence the Supabase file backup. A hosted Postgres was rejected as unnecessary cost and complexity.
3. **Server-authoritative + shared deterministic sim + client prediction + interpolation.**
   - *Why:* the first prototype moved remote tanks only when packets arrived and felt jerky. The three-clock design fixed it: render at display fps, sim 30 Hz, snapshots 30/s.
   - *Rejected:* peer-to-peer or client authority (cheating, desync).
4. **Tick rate 30 Hz, not 60.** Solomon asked why. A tank game with shell travel time doesn't need 60. 30 halves CPU and bandwidth, fits many rooms on a $5 VPS core, and interpolation keeps visuals smooth. It can be raised in `config.js` if ever needed.
5. **Binary inputs and snapshots** to keep mobile data low (about 6 KB/s per player).
6. **Practice = the real Room in a Web Worker.** One code path for rules, and it works offline.
7. **Password-less accounts** (random secret in localStorage).
   - *Why:* zero friction for kids and friends; no email collection (privacy and Play forms are simpler).
   - *Trade-off:* clearing browser data loses the account. Social-media account linking is the planned fix.
8. **Voice as a WebRTC mesh.** The server only relays signalling, so it costs no bandwidth and nothing is stored. It needs HTTPS. No TURN server yet (cost); add one only if connection failures become common.
9. **Low-poly geometry built in code**, with no model or texture files: tiny download, fast on cheap phones, and fits the style.
10. **Hosting path:**
    - Now: Render free (Frankfurt, the closest region), about 80–110 ms from Iraq. URL `https://trackfire1-7.onrender.com/`, which replaced `trackfire1-6`. The GitHub repo is `trackfire` under account `foxydev123-sys`; the upload was done via the website, with the 100-files-per-upload limit worked around by uploading in batches.
    - Plan: a VPS in Kurdistan (Erbil/Baghdad listings were discussed, for example 1 vCPU/1 GB for about $4.50, 4 cores/8 GB for about $30) for 5–25 ms ping. If a VPS is used, **Render is not needed**. Linux (Ubuntu 24.04) was recommended because it is cheaper, is what the setup script targets, and runs Node services best. Capacity estimate: about 100–150 concurrent players per core.
    - He will buy the VPS **only when publishing**.
11. **Android:**
    - The hand-built WebView APK exists so he can install and test without Android Studio.
    - The store route is a TWA via PWABuilder (see PUBLISHING.md) or a future Capacitor build.
    - **The signing key `tools/android/release-key.pem` must be kept and never shared or zipped.** Updates only install over the old app with the same key.
12. **Payments:** Google Play Billing with server-side verification. Iraq cannot hold a Google merchant account, so: **launch free**, and sell gems later through a payments profile in another country (Turkey, UAE, Jordan…). The gem shop hides itself when payments are unconfigured.

### Design decisions from Solomon (feature rules)

- **One power per tank**, upgradeable. It was first asked as levels 1–10, but implemented as **5 power levels** alongside the stat upgrades; the tank's overall level is 1–10.
- **Powers have no cooldown.** They charge by **damaging enemies**. The power button *selects* it; the player then places or aims it with the **shooting joystick** and fires.
- Voice is **player to player**, with separate "speak to all/team" and "hear all/team".
- Bounty: **kills build a bounty**.
- **Ranked:** random mode among CTF / King of Citadel / Convoy / Bounty / Team Battle / LTS, on a random map. **3v3 and 5v5 were removed**, leaving one 4v4 queue (it fills faster). There is a draw animation, then the loading screen.
- **Quick match:** random map, and a random mode from **all** modes (`QUICK_MODES`, 11 of them; `surv` is excluded because it is co-op). The old weekly rotation is gone.
- **First launch:**
  - Name → age → city. Store **only the age group** (`kid` <13, `teen`, `adult`) and never the birth year. Under-13 turns voice chat off.
  - The city list covers Kurdistan and Iraqi cities plus "Other", and city is skippable.
  - The **callsign box was removed from the menu**; renaming lives in the profile.
- **Rank tanks:** weakest to strongest (Bronze Baz → Legend Newroz).
- **Safeen missile:**
  - Starts at tank speed and accelerates, as he asked ("+0.3 per second" in his words; tuned to feel right: `spd0` 9.5, `acc` 5.5–8).
  - Steerable with the move stick while **the tank holds still**.
  - Smoother camera that sits a bit farther back, but not as far as the normal camera.
- **Korek heal:** full heal on a friend, **−50% damage** on enemies, a green circle and pluses when armed.
- **Invisibility** breaks on shooting and can't be used while carrying a flag. **Dome** (10 s) blocks shells through its skin. **Freeze cage** lasts 2.5 s.
- **Defaults:** best graphics quality, smaller touch buttons, and the **hidden test button always active** (his words: "make it active all the time").
- **Kill feed:** stays on the **right** in Kurdish and Arabic, the same as in English.

### Constraints

- **Budget:** near zero until launch. Free tiers (Render, Supabase). $25 already spent on the Play developer account. VPS about $5–30/month later.
- **Location:** Iraq. This affects hosting ping, Play merchant availability, and AdMob (supported).
- **Skill level:** he is not a coder. He can upload files to GitHub via the website, use the Render dashboard, and install an APK. Give him click-by-click instructions, never terminal-heavy workflows unless unavoidable.
- **Devices:** phones (Android) are the main target; performance on cheap phones matters.
- **Browser support:** modern Chrome/Safari/Firefox with WebGL, ES modules and WebRTC. Voice needs HTTPS.
- **Performance budget:** see `tools/perf-test.js`. About 0.14 ms/tick worst mode, about 6.4 KB/s per player, forest map build about 17 ms. "Optimise without losing quality" is a standing wish.
- **Privacy:** don't store birth year, email or location beyond the chosen city. Keep the delete-account flows working (Google Play requirement).

---

## 5. Conventions

- **Code style:**
  - Dense, compact JS: many statements per line, short names (`p` player, `sh` shell, `m` message, `E` eco, `ab` ability, `al` ability level, `chg` charge).
  - 2-space indent, single quotes, semicolons.
  - Block comments with `=====` banners at the top of files explaining intent in plain English.
  - Match the existing density when editing; don't reformat files.
- **Modules:** ES modules everywhere (`"type": "module"`). Shared code imports only other shared code.
- **Tunables:** gameplay numbers go in `client/shared/config.js`, `abilities.js`, `tanks.js` and `economy.js`, never hard-coded in logic.
- **Strings:** every visible string goes through `t('key')` with **en, ar and ku** entries in `i18n.js`. Keys use prefixes: `ab_*` / `abd_*` powers, `ac_*` goals, `mvp*`, `wc*` welcome, `city_*`, `vc*` voice, `rev*` draw, `e_*` errors, `cheat*`.
- **Messages:** JSON events are `{t:'name', ...}` with short field names. Binary for hot paths only.
- **Icons:** inline SVG with class `.bi` on buttons, matching the UI style (added to every menu/nav button).
- **RTL:** don't mirror HUD positions; mirror only text. Test all 3 languages (`browser-test13.py`).
- **Tests:** every feature or bug fix gets a test.
  - Node suites run the real server logic (`tools/*-test.js`).
  - Browser suites run the real client in headless Chromium with the Three.js mock (`tools/browser-test*.py`, Python Playwright, `service_workers='block'`).
  - Tests set a player name with the hook `await page.evaluate("n => __tf.setName(n)", 'Name')`, because the name box on the menu is hidden now. For invite-link flows, complete the `#welcome` modal (fill `#wcName` → Next → click a year → Next → `#wcSkip`).
  - Test hooks live on `window.__tf` (`tryTank`, `setVoice`, `setLang`, `setName`, `touch`, `voice`, `net`, `room`, `acc`, …).
- **Release checklist (each delivery):**
  1. Run all node and browser tests.
  2. Bump `client/sw.js` `CACHE` (currently `kt-v7`).
  3. Bump the APK version in `build_apk.py` and rebuild (now 2.3 / code 14, URL `https://trackfire1-7.onrender.com/`).
  4. Update README/DEPLOY.
  5. Zip without `data/`, `.git/`, `node_modules/`, the `.apk` or `release-key.pem`.
  6. Send the zip and APK to Solomon.
  7. Remind him about `TEST_CHEATS=0` before publishing.
- **Env flags** are read in `server/index.js`. Dangerous ones (`TEST_CHEATS` on, `PAYMENTS_TEST=1`) print loud warnings.

---

## 6. Known issues, fragile spots, tech debt

1. **⚠️ TEST_CHEATS is ON by default.** The +10k gems button works for anyone who taps the Settings "SECRET BUTTON" row 13 times — and that row is now labelled, so it is easier to stumble on than the old hidden one. **Must set `TEST_CHEATS=0` on the server before public release.** Solomon has been reminded; remind him again at publish time.
2. **Voice doesn't work inside the APK.** The WebView lacks `onPermissionRequest`. It works in mobile Chrome over HTTPS. The fix is a Capacitor/TWA build, or adding a WebChromeClient subclass to the hand-written DEX (hard).
3. **No TURN server.** Some mobile-network players can't connect voice ("connecting…").
4. **Password-less accounts:** clearing browser storage or switching device loses the account. There is no recovery or linking yet.
5. **Render free tier:** it sleeps after about 15 min (up to 1 min to wake; the APK start page shows a waiting screen) and wipes the disk (Supabase backup covers it; at worst the last ~60 s of progress is lost). Ping from Iraq is 80–110 ms.
6. **Stale docs:** PUBLISHING.md describes the PWABuilder TWA route and says "Ads: No". Update it when AdMob or Capacitor is decided. The **target audience section says 13+**, but the game now accepts under-13 players (age group `kid`). Before submitting to Play, decide whether to block under-13 or go through Google's Families policy (chat + purchases have extra rules). This is unresolved.
7. **Legacy weekly quick mode:** `QUICK_ROTATION` / `quickModeOf()` still exist, used by `/api/info` and to pick which mode-specific daily quest appears. Quick match itself is random now, so a mode-specific daily quest can be slower to finish. Candidate cleanup.
8. **Known flaky test:** `tools/modes-test.js` Tank Ball goal checks occasionally fail (bot-only randomness). Rerun before investigating.
9. **Fragile areas that broke before:**
   - Name plates and the "+"s are built from the tanks actually on the stage, never from the player
     list: a plate used to appear for someone whose tank had not been made, leaving a name floating
     over grass. They are also hidden if they would fall under either menu column.
   - Pulling a squad into the leader's room means the room now has a human who has not pressed
     READY, which blocks the host from starting. Pulled members are marked ready on arrival;
     `browser-test3.py` checks both that they are pulled in and that they are ready.
   - `stage.attach()` does nothing when the world has not changed, so anything that calls
     `stage.clear()` must also rebuild. Opening a tab cleared the line-up and coming back never
     brought it back; the loop now rebuilds whenever `views` is empty.
   - The hub drops anything over 12 messages in 2 seconds. A test that fires requests back to back
     will hang waiting for a reply that was never sent — pace them.
   - The daily-reward popup opens by itself for an account that has not claimed today, so any test
     that clicks menu buttons with a real account must dismiss `#ecoModal` first.
   - An `#id`-carrying rule beats `html[dir="rtl"] …`, so a menu override once un-hid the Latin
     wordmark on top of the Kurdish one. Scope such rules with `html:not([dir="rtl"])`.
   - Name plates are packed into rows using widths and heights measured once in `renderStageNames`;
     a plate is anchored at its BOTTOM (`translate(-50%,-100%)`), so a row's y is its bottom edge.
   - Anything drawn over the 3D scene must sit ABOVE `.screen` (z-index 10), which covers the whole
     viewport: the + buttons were unclickable for a release because they were below it.
   - The lobby sweep must read `posts`/`pts` as well as `x`/`z`. Fences and roads are a run of
     points with no centre, so an x/z-only sweep left a fence lying across the stage.
   - The menu's two columns are flex; flex items shrink by default, which on a phone squeezed every
     button below the height of its own text so the Kurdish and Arabic subtitles spilled out over
     the button beneath. `flex-shrink:0` on both columns' children; `browser-test17.py` catches it.
   - The menu layout is landscape-only. Portrait stacks the columns, so any rule that positions
     them must sit inside an `orientation` media query or it will win over the stacked one.
   - `main.js` must NOT statically import anything that imports Three.js. It loads the engine lazily so
     that a browser which cannot reach the CDN still opens the menu and registers the service worker.
     A static `import` of `lobbystage.js` broke offline start once; `browser-test5.py` catches it.
   - `modsOf` in `tanks.js` once dropped the power level `ab`.
   - Map overrides with `Object.create(map)` lose `fx` walls; use `map.near0` in tests.
   - Event-name clashes: the drone explosion had to be renamed `carBoom`, and a missing route in `netclient` meant no explosion effect when an enemy car hit you (fixed).
   - Quick taps between 30 Hz samples were lost (fixed with latching). Don't remove the latches.
   - "Frozen at match start" bug: fixed by resetting `input.enabled`/modals in `enterGame`, Escape only pausing in-game, a watchdog that calls `enterGame` if the room is playing but the screen isn't, and a server "starving input" escape. Watch for regressions.
   - A `// comment` inside the Economy constructor object in `server/index.js` once stopped the server from starting. Be careful with one-line edits there.
   - RTL CSS once moved the kill feed left; the rule now is that the HUD is never mirrored.
   - Bots walled themselves in with Zagros walls; fixed by the `botAbility` policy (walls only 16–60 m from the foe, placed 11 m toward it).
10. **The CDN dependency:** Three.js loads from jsDelivr. If the CDN is blocked in a region, the game won't render. Self-hosting instructions are in DEPLOY.md.
11. **Dense code** is hard to read. There is no linter or formatter; keep changes consistent.
12. **Ranked with few players:** bots fill after 60 s (`RANKED_BOTS_AFTER_S`) and those matches are unrated. Set it to 0 when the player base grows.

---

## 7. What's next

### Immediate state

The last batch ("batch 3") is **complete and delivered**: zip + APK v1.4. All tests pass. No task was left half-done. The very last fix made PRACTICE open the first-run screen for brand-new players, and the browser tests were updated for the hidden name box.

### Likely next steps (in the order Solomon seemed headed)

1. **Wait for his feedback** from playing batch 3 on phone and PC. He usually comes back with a numbered list of bugs and features. Handle all of them, test, and ship a new zip + APK.
2. **Pre-launch hardening:**
   - `TEST_CHEATS=0`;
   - `PAYMENTS_TEST` off;
   - set `ADMIN_KEY` and `CONTACT_EMAIL`;
   - decide the under-13 policy vs Play target audience (Known issues #6).
3. **Hosting move:** buy a Kurdistan VPS at publish time, run `deploy/vps-setup.sh <domain>`, point a domain at it (HTTPS is needed for voice and PWA), keep the Supabase backup on, rebuild the APK with the new URL (`--url`).
4. **Android for Play Store:**
   - Either a TWA via PWABuilder (PUBLISHING.md), which also needs `ANDROID_SHA256` for assetlinks,
   - or a Capacitor build, which also fixes mic permission for voice and is the natural place to add **AdMob**.
   - Then: closed test with 12 testers for 14 days, then production.
5. **AdMob:** decide placements (rewarded ads for chests or extra wheel spins fit the economy best), then update the Play "Ads" and Data safety answers.
6. **Account linking** (Google / social) so progress survives device changes.
7. **TikTok promo:** `client/studio.html` and `client/trailer.html` already produce promo images and a 54 s trailer.
8. Later: a TURN server for voice, iOS/Steam, gem sales via a foreign payments profile.

### Blocked

- **Gem sales:** blocked on a merchant account outside Iraq.
- **VPS:** blocked on his decision to publish; he said he won't buy until then.
- **Play production:** blocked on the 12-tester closed test.

---

## 8. Solomon's preferences (how to work with him)

- **He wants full, finished features, not suggestions.** He sends big batches ("batch 1/2/3") of features and bugs in one message, and expects all of them implemented, tested and packaged in one go. Keep a task list, work through everything, and don't stop halfway.
- **Ask only when it really matters**, and then use multiple-choice questions with a recommended option. He usually picks the recommended one (for example "Ask, store only the age group", "Weakest to strongest", "Tank holds still"). Otherwise choose sensible defaults and say what you chose.
- **Deliverables:** always end a batch with a **zip of the project** (excluding `data/`, `.git/`, `node_modules/`, the APK and `release-key.pem`) and a **rebuilt APK** with a bumped version. Send both as files.
- **Responses:** short and plain. When he asked for a VPS recommendation he said "simplify your answer". Use short summaries grouped as "Bugs fixed / New features" and one-line bullets. No long technical explanations unless he asks "why". When he asks why (Linux, tick rate 30), explain simply with a concrete reason.
- **Instructions for him** must be click-by-click for websites (GitHub web upload, Render dashboard, Supabase, Play Console). He doesn't use terminals much. He asked "should I do that in the app or" about GitHub, so be explicit about website vs app.
- **Language:** he writes to the AI in English (informal, with typos). The game itself must support Kurdish (Sorani), Arabic and English, and every new text needs all three.
- **Things he corrected or insisted on:**
  - Powers must be *selected then placed* with the shooting stick, not instant.
  - No cooldowns; charge by damage.
  - Best quality as the default.
  - Smaller buttons.
  - The hidden test button always active during development.
  - The kill feed on the right in every language.
  - No callsign on the menu.
  - The missile must be controllable and not too fast.
  - Bots must not block themselves.
- **Always remind him** of the release-critical switch: `TEST_CHEATS=0` before publishing.
- **Never** include the signing key in anything sent out, and never send his email to external services.
- He tests on real devices and reports bugs in plain words ("the player can't move or shoot"). Reproduce with a test first, then fix.
