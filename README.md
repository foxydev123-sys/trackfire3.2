# Kurdish Tank

A private, browser-based multiplayer tank game for you and your friends. It uses
low-poly 3D, runs on PC and phones, and needs no install. You create a room,
send the 5-letter code (or the invite link), and play.

- **Maps:** Hawler City (the Citadel on its mound, the ring road, Shar Park with its pools and round fountain, the bazaar arcades with clock towers, and the city skyline), Dune Crossing (desert) and Pinewood Ford (forest, with a river and a single bridge). Kurdish flags fly on every map and on every tank's antenna.
- **Power-ups:** six glowing pads per map. Drive over one to collect it; it refills after 15 s.
  - **Shield** (blue): blocks all damage for 5 s. Firing doesn't cancel it.
  - **Speed** (yellow): 1.5× top speed and acceleration for 6 s.
  - **Full health** (green): back to 100 HP instantly.
  - **One-shot round** (red): your next shell destroys any tank in one hit (a shield still blocks it).
- **Modes:** Team Battle (first team to 20 kills), Free-for-all (most kills in 7 min), Capture the Flag (bring the enemy's Kurdish flag to your base, first to 3), King of the Citadel (hold the zone, first to 100 points), Last Tank Standing (rounds, no respawns, first to 4 rounds) and Power-up Rush (pads refill every 5 s).
- **Play online:**
  - **Quick match** puts you in a public match right away, on a random mode and a random map. Bots fill the empty places.
  - **Ranked 4v4** plays a random mode (Capture the Flag, King of the Citadel, Convoy Escort, Bounty Hunt, Team Battle or Last Tank Standing) on a random map, shown by a draw animation before the match. You search alone or with your squad, and you're matched with players near your rank. Everyone must press ACCEPT. You only earn Rank Points (RP).
  - **Private rooms** use a code. The host picks the map and any mode, and can add bots. Up to 8 players.
- **Ranks:** Bronze, Silver, Gold, Platinum, Diamond and Commander, each with divisions III → II → I (100 RP each). Legend is the top 100 Commanders. You get your first rank after 5 placement matches. A win gives +20 to +30 RP and a loss −15 to −25. There's +5 for the best player and +5 for a streak of 3+ wins. Leaving a match early costs −30. Seasons last 2 months.
- **Tanks:** 8 types. Each has five upgrades you pick yourself — Power, Armour, Speed, Range, Reload (0–5 each). The tank's level (1–10) shows how far it is upgraded overall.

  | Tank | Rarity | Type | Special |
  |---|---|---|---|
  | Zagros | Common | All-rounder | Starter tank |
  | Baz | Common | Scout | Very fast, softer hits |
  | Halgurd | Rare | Heavy | 145 health, blocks 15% of damage, slow to reload |
  | Rashaba | Rare | Rapid fire | Twin guns, shoots every 0.75 s, small hits |
  | Safeen | Epic | Sniper | 62 m range, heavy hits, fragile |
  | Bradost | Epic | Shotgun | 3 shells per shot, short range |
  | Korek | Epic | Repair | Heals itself after 3 s without damage |
  | Newroz | Legendary | Explosive | Shells also damage nearby tanks |

  Upgrades cost coins **and parts** (the second currency); each step costs more, and rarer tanks cost more. Parts come from every Quick/Ranked match, chests, the wheel, the shop, and spare tank cards (every card after the first becomes parts). You unlock a tank with its first card from a chest, by finishing its tank quest, or by buying its pack with gems.
- **Coins and gems:**
  - Coins come from Quick match and Ranked (more for wins and kills), daily rewards, the wheel, quests and chests. After 25 matches in a day, match coins are halved.
  - Gems are bought with real money in the Android app. A few also come from ranked wins, the wheel, day 3 and day 7 of the daily reward, and chests.
  - Private rooms and practice give no rewards.
- **Daily reward:** a 7-day cycle (coins, gems, chests). Missing a day starts again from day 1.
- **Lucky wheel:** one free spin a day, plus up to 5 more for 10 gems each.
- **Chests:** Common, Rare, Epic and Legendary. They can be bought with coins or gems, and also come from rewards. The chance for every card rarity is shown in the game (Google Play requires this for random items).
- **Quests:**
  - 3 daily quests, plus a bonus chest for finishing all 3.
  - Tank quests unlock tanks for free, for example "Win 5 matches" for Baz or "Log in 7 days in a row" for Newroz.
- **Ranked rewards:** coins, 2 gems per win, and a chest the first time you reach each tier in a season.
- **Profiles:** every player gets a unique ID like `Solomon#4821`. The profile shows rank, season and all-time stats, favourite map and mode, and recent matches.
- **Leaderboards:** most kills, most wins and highest rank. Each can show this season or all time, worldwide or only your friends. Kills against bots don't count.
- **Friends and chat:**
  - Add friends by ID and see who's online or in a match.
  - Chat privately, invite friends to your room or your ranked squad.
  - A bad-word filter covers English, Arabic and Kurdish.
  - Players can report and block (required by Apple and Google for games with chat).
- **Languages:** Kurdish (Sorani, کوردی), Arabic (العربية) and English. Arabic and Kurdish switch the whole game to right-to-left. The language follows the phone's language the first time and can be changed on the main menu or in Settings. All texts are in `client/js/i18n.js` if you want to change a word.
- **Practice:** play offline against bots. The full game server runs inside your browser.

## Run it on your computer

You need Node.js 22.13 or newer (it has the SQLite database built in). There are no npm packages to install.
Accounts, ranks, friends and chat are saved in `data/kurdish-tank.db` (change the folder with `DATA_DIR`).

```bash
node server/index.js
# → Trackfire server on http://localhost:8080
```

Open http://localhost:8080. Friends on the same Wi-Fi can open `http://<your-computer's-IP>:8080`.
To play over the internet, see **DEPLOY.md**.

## Controls

| | PC | Phone / tablet (landscape) |
|---|---|---|
| Drive | **WASD** / arrows | Left thumb (a stick appears where you touch) |
| Aim turret | Mouse | Right thumb stick |
| Fire | Left click or Space (hold to keep firing) | Hold **FIRE** |
| Tank power | **Q** (or right click) to pick it up, aim, then fire | Purple ⚡ button, then **FIRE** |
| Talk (voice chat) | Hold **V** | Hold the green 🎤 button |
| Scoreboard | Hold **Tab** | ☰ button |
| Menu | **Esc** | ⚙ button |
| Debug panel | **F3** | Settings → Debug panel |

**Phone layout:** Settings → *Touch layout → EDIT* lets you drag the MOVE stick, AIM stick
and FIRE button anywhere, make each one smaller or bigger, and lower their visibility so
they are faint but still there. "Stick follows your thumb" makes a stick jump to where
your thumb lands; turn it off to keep the sticks fixed. Saved on the device.

**Night:** about 1 in 3 matches is played at night (moonlight, lit windows and street
lamps, headlights on every tank, muzzle flashes that light up the area). In a private
room the host picks *Day*, *Night* or *Random time*.

**Party modes** (besides the 6 classic ones): Convoy Escort (push a supply truck, then swap sides),
Juggernaut (one giant tank; the final hit makes you the giant), Tank Ball (shoot a huge ball into
the goal; shells knock tanks back), Survival Waves (co-op against bot waves, upgrade between waves,
boss every 5th wave), Hot Potato (bump to pass the bomb; last tank wins) and Bounty Hunt (kills
raise your bounty; big bounties show on the map). Rules live in `client/shared/modes2.js`.

**Breakable things:** shells break crates, barrels, tyres, sandbags, small walls, tents and poles
(ramming breaks the light ones); tanks flatten bushes, grass, fences and market umbrellas. The
pieces stay on the ground and get pushed around. Buildings, the citadel, rocks and trees never break.

**Homing rockets** power-up: 3 slow rockets that steer toward the nearest enemy in front. They
turn gently, so a fast or swerving tank can dodge them.

**Phone aiming:** push the aim stick far enough and a glowing ball appears; let go to fire.
Settings has move/aim stick sensitivity and a switch for this. Names can be changed once every 30 days.

**Bots** each get a random skill (weak, average or sharp), a random tank near your
level, and a name (half Kurdish, 30% Arabic, 20% English).

Settings → *PC controls* switches between **Direction** (the default: the tank turns
toward the WASD direction and drives) and **Classic** (W/S for throttle, A/D to rotate).
Try both and keep the one you prefer.

## How the networking works (the important part)

The previous version you tried moved remote tanks only when a packet arrived. This one
separates three clocks:

| Clock | Rate | Where it's set |
|---|---|---|
| Client rendering | As fast as the screen allows (usually 60 fps) | `requestAnimationFrame` |
| Server simulation | 30 fixed ticks per second | `NET.TICK_RATE` in `client/shared/config.js` |
| Network snapshots | 30 per second (set `SNAPSHOT_EVERY: 2` for 15) | `NET.SNAPSHOT_EVERY` |

- **Your own tank uses client-side prediction.** Every tick, your controls are sent
  to the server and the *same* movement code (`client/shared/sim.js`) runs locally
  straight away, so the tank reacts on the next frame. Snapshots report which of
  your inputs the server has applied. The client resets to the server's state,
  replays the rest, and blends any small difference out over about 60 ms
  (reconciliation, in `client/js/net/netclient.js`).
- **Other tanks use a snapshot buffer and interpolation.** They're drawn about 100 ms
  in the past (`INTERP_DELAY_MS`), blended between the two snapshots around that
  moment on every rendered frame. The delay grows automatically on a jittery
  connection. If snapshots stop arriving, tanks keep moving along their last
  velocity for up to 220 ms and then hold still. The game never freezes.
- **The server is authoritative.** Clients only send inputs (move direction, aim
  angle, fire button). The server moves tanks, fires shells, and decides hits,
  damage, kills and respawns. A client can't claim a hit.
- **Server input jitter buffer.** If a player's input arrives late, the server keeps
  their tank moving on its last input and pays that step back later, so nobody else
  sees a stall (`client/shared/room.js`).
- **Compact binary packets.** An input is 13 bytes (the last byte is how far away a tank power is placed). A snapshot is 18 bytes plus 18 per
  tank, sent as binary WebSocket frames with TCP_NODELAY on. Names, teams and
  scores are sent only when they change. With 8 tanks that's about 5 KB/s down and
  0.6 KB/s up per player.
- **Reconnect.** If a connection drops, the client reconnects on its own and gets its
  old slot and stats back (kept for 45 s). Reloading the page mid-match also puts
  you back in.

## Tests and tools

```bash
npm test                              # multiplayer acceptance test (headless, all latency profiles)
node tools/modes-test.js              # every mode on every map, bots only: flags captured, zone held, rounds won
node tools/backup-test.js             # Supabase cloud backup: save → wipe the disk → restore
node tools/social-test.js             # accounts, friends, chat filter, blocks, squads, ranked queue + results, quick match
node tools/economy-test.js            # daily streak, wheel + chest odds, upgrades, packs, quests, match rewards, purchases
node tools/tanks-test.js 40           # each tank's special rule + 1v1 bot duels for balance
node tools/powerup-test.js            # checks all four power-ups on the real server logic
node tools/lobbymap-test.js          # the menu's staging ground on every map: clear, dry, level, and the Citadel walls on their mound
node tools/ability-test.js            # the eight tank powers: charge by damage, aiming, black-hole damage, and what each one does
node tools/cheat-test.js              # the SECRET BUTTON test tool: on by default, TEST_CHEATS=0 switches it off
node tools/goals-test.js              # the 100 long-term goals and the tank each new rank unlocks
node tools/perf-test.js               # speed budget: server time per tick, bytes per player, map build time
python3 tools/browser-test8.py        # the powers in a real browser: buttons, visuals, camera ride, garage upgrade
python3 tools/browser-test15.py       # the SECRET BUTTON row in Settings: 13 taps, all 3 languages, remembered
python3 tools/browser-test16.py       # placing a power far away with the aim stick (release-to-fire distance)
python3 tools/browser-test17.py       # menu and first-run text fits in English, Arabic and Kurdish at phone sizes
python3 tools/browser-test18.py       # the black hole: all its pieces, it turns and pulls, and collapses when it ends
python3 tools/browser-test19.py       # every power throws its own burst and makes its own sound
python3 tools/browser-test20.py       # the menu stage: the line-up, squad slots, name plates, the + to invite
python3 tools/browser-test21.py       # each map's lobby copy: clear ground for the tanks, and the moving background
python3 tools/browser-test22.py       # the squad on the menu: only the leader starts, his map wins, plates never overlap, the corner menu
python3 tools/browser-test23.py       # the result card: fits every screen, win/loss/draw music plays once
python3 tools/menu-qa.py              # menu visual QA: every map, screen size and squad size — is any tank hidden?
python3 tools/menu-qa.py --quick      # …the same, two screen sizes, for a quick check
python3 tools/browser-test9.py        # the mode + map draw before a match, and the ranked screen
python3 tools/browser-test10.py       # opening a friend's profile: rank, stats, recent matches, their tanks
python3 tools/browser-test11.py       # voice chat between two browsers: link, push-to-talk, team only, mute
python3 tools/browser-test12.py       # touch layout editor: every button (mic and power too) can be moved and resized
python3 tools/browser-test13.py       # Kurdish / Arabic / English: the kill feed and HUD stay in the same place
python3 tools/browser-test14.py       # first run: name → age → city, age group only, profile rename, practice first
node tools/net-test.js 100 20         # one profile: 100 ms ping, ±20 ms jitter
node tools/bots.js F7K2Q 5            # 5 network bots join room F7K2Q (to watch from your browser)
node tools/bots.js F7K2Q 5 ws://localhost:8080/ws 150 30   # …with 150 ms ping and ±30 ms jitter
SIM_LATENCY_MS=75 node server/index.js                     # server adds delay to everything it sends
```

In the game, Settings → *Network test tools* adds a simulated ping (20/50/100/150 ms)
and jitter to your own browser. Press F3 to see FPS, ping, tick rate, snapshots per
second, interpolation delay, buffered snapshots, jitter, corrections and bandwidth.

**Measured results** (`npm test`: client A drives in continuous circles while firing;
client B renders A at 60 fps; 2 more clients and 2 bots are in the room):

| Simulated network | Frames rendered at 60 fps | Stalled frames | Teleports | Largest local correction |
|---|---|---|---|---|
| 0 ms | ~490 | 0 | 0 | 0 m |
| 20 ms ±5 | ~490 | 0 | 0 | 0.03 m |
| 50 ms ±10 | ~490 | 2 (0.4%) | 0 | 0.03 m |
| 100 ms ±20 | ~490 | 0 | 0 | 0.03 m |
| 150 ms ±30 | ~490 | 0 | 0 | 0.17 m |
| 100 ms ±60 (heavy jitter) | ~490 | 3 (0.6%) | 0 | 0.37 m |

A "stalled frame" means A moved less than 20% of what its speed implies during
one frame, for example while it was pushed against a rock. Corrections are
blended out over about 60 ms, so you don't see them as jumps.

Server load: 32 simulated players across 4 rooms used about 6% of one CPU core and 77 MB of RAM.

`tools/browser-test7.py` plays each party mode in practice; `tools/browser-test6.py` checks night matches, bot names and tanks, the chest-opening
sequence and the phone touch-layout editor (saved and restored after a reload).

`tools/browser-test3.py` drives two browsers (desktop in English/Arabic, phone in Kurdish) through
accounts, friends, chat, squad invites, the ranked search, MATCH FOUND, a ranked match, and private
CTF / King of the Citadel / Last Tank Standing rooms.

The browser tests (`tools/browser-test.py`, `tools/browser-test2.py`, which need Python
Playwright) cover two desktop browsers plus a phone joining by link, touch driving,
the smoothness check, practice mode with bots, reconnecting after a reload, and the
end-of-match screen. They run the real client with a stand-in for the 3D engine.

## Project layout

```
server/index.js        HTTP static files + JSON API + WebSocket rooms (/ws) + social hub (/hub) + 30 Hz tick loop
server/store.js        SQLite database: accounts, stats, ranks, seasons, friends, chat, matches, reports
server/social.js       live hub: presence, chat, friend requests, squads, ranked matchmaking
server/filter.js       chat + name filter (English, Arabic, Kurdish) — add words here
server/economy.js      coins, gems, garage, chests, wheel, daily, quests, shop, Google Play purchase checks
server/ws.js           minimal WebSocket implementation (RFC 6455)
client/index.html      the whole UI (menu, lobby, HUD, touch controls, settings)
client/css/style.css
client/shared/         runs on BOTH server and browser
  config.js            ← gameplay and network numbers you can tweak
  sim.js               tank movement, collision, shells (used for prediction too)
  room.js              server-authoritative match logic (also powers practice mode)
  protocol.js          binary packet format
  maps.js              deterministic map layouts (obstacles and spawns)
  ranks.js             rank tiers and seasons
  tanks.js             ← the 8 tanks: stats, rarity, upgrade costs
  abilities.js         ← one special power per tank + its five upgrade levels
  abrun.js             the server side of the powers (walls, domes, black holes, guided shells, cars)
  economy.js           ← rewards, chests + odds, wheel, daily, quests, shop prices
  nav.js               bot path-finding grid (A*)
  bot.js, math.js
client/js/
  main.js              screens and wiring
  net/                 connection (and latency simulator), prediction, interpolation
  game/                3D world, prefabs, tanks, shells, particles, camera and frame loop
  input/               keyboard/mouse, touch sticks
  ui/hud.js            HUD, scoreboard, minimap, objectives, debug panel
  ui/social.js         profile, leaderboards, friends + chat, ranked, modes, rank tiers, match found
  ui/eco.js            wallet, garage, shop, chest opening, lucky wheel, daily reward, quests, gem purchases
  account.js           the player's account + live hub connection
  audio/audio.js       procedural Web Audio sound effects and music
  audio/voice.js       voice chat: player-to-player (WebRTC), team or everyone, push to talk
  game/abilityfx.js    what the eight powers look like on screen
  practice-worker.js   offline mode: the server Room inside a Web Worker
deploy/vps-setup.sh    one command to set the game up on your own VPS (Node, service, firewall, HTTPS)
tools/                 acceptance tests, bots, load and browser tests
```

## Tweaking

Everything gameplay-related is in `client/shared/config.js`: power-up durations (`POWERUPS`), health (100), damage
(25–40), reload (2.2 s), shell speed and range, respawn time, spawn protection,
tank speed, acceleration, turning, turret speed, score limits and match time, every mode's rules
(`MODES`, `CTF`, `KOH`), the quick-match mode pool (`QUICK_MODES`) and ranked settings (`RANKED`).
Camera angle and zoom are in `client/js/settings.js` (`CAMERA`). Restart the server
after changing shared values.
