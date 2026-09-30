# Putting Kurdish Tank online

The game is one small Node.js server. It serves the web page **and** runs the
multiplayer rooms over WebSockets, so you deploy one thing and send your friends one URL.
It has no npm dependencies and no build step.

## Important: keep your players' progress (accounts, coins, tanks, ranks)

Everything players earn is saved in one file: `data/kurdish-tank.db`. **Render's free plan deletes
that file every time the server goes to sleep** (after ~15 minutes with nobody playing) or restarts.
That's why progress disappeared when players left and came back. Two fixes — use one or both:

### Fix 1 (free): automatic cloud backup with Supabase

The server keeps a copy of the save file in Supabase Storage (free plan: 1 GB, far more than needed).
Every minute it uploads the latest copy if something changed, it uploads once more when Render puts it
to sleep, and when it wakes up on an empty disk it downloads the copy **before** anyone connects.

1. Go to https://supabase.com → sign up (free) → **New project** (any name, e.g. `kurdish-tank`,
   choose a region near Frankfurt, set any database password — you won't need it).
2. When the project is ready open **Project Settings → API** (or **Data API**) and copy:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - a **secret** key: either the new *Secret key* (starts with `sb_secret_`, under **API Keys**) or the
     older **service_role** key (click *Reveal*). Both work. Keep it secret: it only goes on Render,
     never in the game files or the Android app.
3. On Render open your service → **Environment** → **Add Environment Variable**:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_KEY` = the service_role key
   Save — Render restarts the server.
4. Open the **Logs** tab. You should see `backup: created private bucket "kurdish-tank"` (first time)
   and `backup: cloud copy is up to date`. After a restart you'll see `backup: restored … KB of saved progress`.

The server creates a private bucket named `kurdish-tank` by itself (you can see the files in Supabase →
**Storage**). Besides `kurdish-tank.db` it keeps one copy per weekday (`daily/Mon.db` …) so you can go
back a few days if something ever goes wrong. Optional settings: `SUPABASE_BUCKET` (bucket name) and
`BACKUP_EVERY_S` (seconds between uploads, default 60). At worst the last minute of play before a crash
can be lost; a normal sleep or redeploy loses nothing.

### Fix 2 (paid, most reliable): a real disk

- **Render Starter ($7/month) + a 1 GB disk (about $0.25/month):**
  1. In the service, open *Disks* and add a disk with mount path `/opt/render/project/src/data`.
  2. Under *Environment*, add `DATA_DIR=/opt/render/project/src/data`.
  (`render.yaml` has these lines ready, commented out.) A paid instance also never sleeps, so
  nobody waits a minute for the server to wake up. Keeping the Supabase backup on as well is a good idea.
- **A small VPS** (for example Hetzner CX23, about €5/month, datacenter in Germany or
  Finland): the disk is permanent. Install Node 22, copy this folder, and run
  `node server/index.js` (use `pm2` or a systemd service to keep it running).
- **Fly.io:** `fly.toml` already mounts a volume at `/data`. Create it once with
  `fly volumes create kt_data --size 1`.

**Backups:** copy `kurdish-tank.db` somewhere safe now and then (for example once a day).

### Settings (environment variables)

| Name | Default | What it does |
|---|---|---|
| `DATA_DIR` | `./data` | Folder for the database |
| `SUPABASE_URL` | (none) | Your Supabase project URL — turns on the cloud backup of player progress |
| `SUPABASE_KEY` | (none) | The Supabase **service_role** key (secret, server only) |
| `SUPABASE_BUCKET` | `kurdish-tank` | Storage bucket for the backup (created automatically) |
| `BACKUP_EVERY_S` | `60` | Seconds between backups (only uploads when something changed) |
| `ADMIN_KEY` | (none) | Set a secret word, then open `/api/admin/reports?key=THAT_WORD` to read player reports |
| `RANKED_BOTS_AFTER_S` | `60` | When too few people are searching for ranked, empty seats are filled with bots after this many seconds. Those matches are *unrated* (no RP change). Set `0` once you have enough players. |
| `PORT` | `8080` | Port to listen on |
| `PAYMENTS_TEST` | (off) | `1` makes gem purchases free, for testing only. **Never turn this on for real players.** |
| `PLAY_PACKAGE` | (none) | Your Android app's package name, e.g. `com.kurdishtank.app` |
| `GOOGLE_SERVICE_ACCOUNT` | (none) | The Google service-account key (the JSON text or a file path), used to check real purchases |
| `CONTACT_EMAIL` | (none) | Email shown on the privacy and delete-account pages (Google Play requires a contact) |
| `ANDROID_PACKAGE` | `PLAY_PACKAGE` | Android package name served in `/.well-known/assetlinks.json` |
| `ANDROID_SHA256` | (none) | SHA-256 signing fingerprints, comma separated: the upload key **and** the Play App Signing key |

### Real-money gems (Google Play)

Real purchases only work inside the Android app, through Google Play Billing. The
server checks every purchase with Google before it adds gems, and each purchase can
only be used once.

1. In Google Play Console → *Monetize → Products → In-app products*, create these
   products with exactly these IDs: `gems_80`, `gems_500`, `gems_1200`,
   `gems_2600`, `gems_7000`, `starter_pack`. Set your prices there. The game shows
   Google's local prices automatically.
2. In Google Cloud, create a *service account*, give it access in Play Console →
   *Users and permissions* ("View financial data" and "Manage orders"), and download
   its JSON key.
3. On the server, set `PLAY_PACKAGE` and `GOOGLE_SERVICE_ACCOUNT`.

The gem amounts per product are in `client/shared/economy.js` (`GEM_PRODUCTS`).


## Option A: Render (free, easiest)

1. Create a free GitHub account if you don't have one, make a new repository, and
   upload this folder to it (drag and drop in the GitHub web page works).
2. Sign up at https://render.com with your GitHub account.
3. Click **New → Blueprint**, pick your repository, and confirm. Render reads
   `render.yaml` and creates a free web service. (Or choose **New → Web Service**
   with *Build command* `echo ok` and *Start command* `node server/index.js`.)
   If you're asked for a region, pick the one closest to you and your friends
   (Frankfurt is usually best from the Middle East).
4. After a minute or two you get a URL like `https://trackfire-xyz.onrender.com`.
   That's your game. Send it to your friends.

Notes about the free tier:
- A free service goes to sleep after about 15 minutes with no traffic. The first
  person to open it wakes it up, which can take up to a minute. After that it's normal.
- Render keeps free services awake while WebSocket messages are flowing, so a match
  won't be cut off mid-game.
- Pick the region closest to you and your friends for the lowest ping.

## Option B: Fly.io (small monthly cost, always on, you choose the region)

Fly.io no longer has a free tier for new accounts, but a tiny machine for this
game costs a few dollars a month. Install `flyctl`, then:

```bash
fly launch --copy-config --no-deploy   # edit the app name / region in fly.toml
fly deploy
```

## Option C: Your own VPS — best ping for players in Iraq (recommended)

A small VPS in Erbil or Baghdad gives local players a ping of roughly 5–25 ms,
where Render (Frankfurt) gives 80–110 ms. A 1-core / 1 GB machine (about
$5 a month) holds roughly 100–150 players at once; 2 cores about 250–300.

1. Rent the cheapest **Ubuntu 24.04** VPS in the city closest to your players.
2. Copy this folder to the server (or `git clone` it there).
3. On the server, as root:

```bash
bash deploy/vps-setup.sh play.yourdomain.com     # with a domain (recommended)
bash deploy/vps-setup.sh                         # no domain: plain http, testing only
```

That installs Node 22, runs the game as a service that restarts by itself and
survives reboots, opens the firewall, and — with a domain — sets up free HTTPS
(Caddy + Let's Encrypt) that renews itself.

**Use a domain.** Over plain `http://` the browser blocks the microphone, so
**voice chat will not work**, and neither will "add to home screen" or offline
play. A domain costs about $10 a year; point its A record at the server's IP.

Afterwards:

| Command | What it does |
| --- | --- |
| `systemctl status kurdish-tank` | is it running? |
| `systemctl restart kurdish-tank` | restart it |
| `journalctl -u kurdish-tank -f` | watch the log live |
| `nano /etc/kurdish-tank.env` | settings (port, backup keys) |

Player progress lives in `/opt/kurdish-tank/data` and is never touched by an
update. Turn the Supabase backup on as well (top of this file) — a VPS disk can
fail too.

## Option D: Host it from your own PC (free, best ping for you)

1. Run `node server/index.js` on your computer.
2. Install Cloudflare's free `cloudflared` and run:
   `cloudflared tunnel --url http://localhost:8080`
3. It prints a public `https://….trycloudflare.com` address. Send that to your friends.
   It only works while your PC and that command are running.

## Option E: Website and server hosted separately

If you want the page on a static host (Netlify, Cloudflare Pages, GitHub Pages)
and the server elsewhere:
1. Upload only the `client/` folder to the static host.
2. Put your server's address in `client/server-config.js`:
   `window.TRACKFIRE_SERVER = 'wss://your-server.example.com/ws';`
3. Run the server anywhere that supports WebSockets (options A to C).

You can also point any copy of the page at a server with `?server=wss://…/ws` in the URL.

## Custom domain

Render and Fly.io both let you add your own domain (for example `mytankgame.example`)
in the service settings and handle HTTPS for you.

## Checking it works

- `https://your-url/health` should show `{"ok":true}`.
- `https://your-url/stats` lists the rooms currently open.
- In the game, press **F3** to see ping, snapshots per second and interpolation delay.

## Loading Three.js from your own server (optional)

The 3D engine (Three.js r149) loads from the jsDelivr CDN. To host it yourself,
download `three.module.js` (version 0.149.0) into `client/vendor/` and change the one
line in `client/js/three.js`.

## Voice chat

Players can talk to each other during a match. The sound goes **straight from
one player's device to another** (WebRTC peer to peer) — your server only passes
the two "hello" messages along, so voice costs you no bandwidth and is never
stored anywhere.

What you need to know:

- **HTTPS is required.** Browsers only give a page the microphone on a secure
  address. Render and the VPS script with a domain both give you HTTPS.
- Each player turns it on in **Settings → Voice chat**. It is off until they do.
- They choose separately whether to **talk to** their team or everyone, and
  whether to **listen to** their team or everyone, and can mute any player from
  the voice list in the corner.
- Hold **V** on a PC, or hold the green microphone button on a phone. There is
  also an "always on" microphone mode.
- A few players behind strict mobile networks may fail to connect to each other
  (their entry shows "connecting…"). Everything else in the game still works.
  If that ever becomes common, the fix is a TURN relay server — ask then.

## Tank powers

Every tank has one special power. There is no timer on it: you **charge it by
damaging enemies**, and when the bar is full you press **Q** (the purple button
on phones) to pick it up, aim with the mouse or the aim stick, and **FIRE** to
place it. Vanish is instant; Repair Shot and Freeze Cage arm your next shell.

Each power has five upgrade levels bought with coins + parts in the garage; an
upgrade makes the power stronger *and* makes it fill after less damage.

Every power throws its own coloured burst from the tank when it goes off — and a
second, smaller one where a placed power lands — and has its own sound, so you can
tell the eight of them apart with your eyes shut.

**Newroz's Black Hole** does more than drag enemies in: anything enemy caught
inside loses health for as long as it stays there, and the closer it is dragged to
the middle the faster it goes. A level-0 hole takes about **4 health a second at
the rim, 10 halfway in and 20 dead centre**; it can finish a tank off, and the kill
goes to whoever opened it. Your own side is neither pulled nor hurt. The rate comes
from `dps` in `abilities.js` and the `HOLE_RIM`/`HOLE_CORE` scale next to it.

Nothing to configure on the server. All the numbers — how much damage each
power needs, how far it reaches, how strong it is — are in
`client/shared/abilities.js`.

## The menu screen

The menu is a live view of Hawler, not a picture. Your tank stands on the ground
south of the Citadel, turned about 35° so you see its front and one side, with
the city and the Citadel behind it. Pick a different tank in the garage and the
model on the menu changes at once.

When friends join your squad their tanks fall in beside yours and the camera
eases back so the whole line stays in frame — one tank up to four — and closes in
again when someone leaves. Each tank carries a name plate saying who it is and
which tank they picked, so everyone sees everyone else's choice live.

The buttons are laid out in two columns with the scene showing between them:
language, logo, the four play buttons, room code and JOIN, then GAME MODES and
SETTINGS down the left; wallet, your tank card, the shop/quests/goals buttons,
your player ID, PROFILE / LEADERBOARDS / FRIENDS and the season banner down the
right.

There are always **four standing spots**. You take the middle one and each empty spot
shows a **+** that opens the friend picker, so you can build a squad without leaving
the menu — the same shape as the squad slots in games like Brawl Stars. That + and the
Friends page are the only two ways into a squad; the Ranked page just shows who is in
one. The spots
sit just south of the two tall flags at (±5, 23.6), so the flags frame the shot from
behind instead of blocking it, and the camera sits low and looks north up the length
of Shar Park with the Citadel in the distance beyond.

**The leader decides.** In a squad only the leader can press QUICK MATCH, RANKED, CREATE ROOM,
JOIN or PRACTICE, and only his map choice counts: everyone's menu shows the map he is on, and a
member's own saved preference is left alone so it comes back when they leave the squad. The
others see the buttons dimmed with a line saying who can start. A member taken into the leader's
room can press BROWSE MENU to go and look at the garage or the shop **without leaving the room** —
they are still in it, and the match takes them in when it starts.

**The squad panel** on the menu lists everyone in the squad with a crown on whoever
leads it, and a LEAVE button. Tapping a member opens what you can do with them: open
their profile, hand them the squad, or remove them — the last two only if you lead it.
Handing over moves the party to its new leader on the server, so the queue, the room
and everything else follows.

Your squad lives on the server, not on the screen, so it survives everything you do
between matches — garage, shop, switching from ranked to a custom room — and only
breaks up when someone leaves or disconnects.

**The squad follows its leader.** Whatever room the leader walks into, the rest are
taken in behind them, with no invite to accept, and they count as ready the moment
they arrive — they never chose to come, so they should not have to press anything
either. Ranked is left alone: matchmaking already keeps squads on the same side.
Nobody is ever pulled out of a match they are already playing.

**Each map has its own lobby copy.** A playing map is built for a match — cover
everywhere, props in the open, a river where you would rather stand. The menu needs
the opposite, so `getLobbyMap()` in `shared/maps.js` builds a second copy of the map
and sweeps the staging area, and the camera's line of sight to it, clear of rocks,
trees, fences and props. The terrain, the landmarks and the skyline are untouched, so
it still looks like the map you are about to play, and the playing map itself is never
altered. Each map's staging ground — where the line-up stands, where the camera goes
and what it looks at — is the `LOBBY` table in the same file. A lobby copy is only
built for a map you actually look at, so a player who never changes map pays for one.

**The background is alive.** `client/js/game/lobbylife.js` sends a pair of jets across
the sky and keeps a firefight flickering over the horizon. It is deliberately small —
seven pieces in all, less than one tank — nothing casts a shadow, nothing is rebuilt
from frame to frame, and on **low** graphics quality none of it is added at all.
(Traffic was tried and cut: cars driven along a straight line take no notice of the
real roads, so they slid through the scenery.)

**The corner menu.** Everything that is not "play now" — shop, quests, goals, daily, wheel,
profile, leaderboards, friends, game modes, settings and the language switch — lives behind the
one MENU button in the top corner. That leaves the middle of the screen clear, so the line-up of
tanks is never behind a wall of buttons: about 39% of the width is open ground. The left column
is the four play buttons and the room code; the right is your tank, the garage, your squad and
the season. A red dot appears on the corner button when something inside it wants attention.

**What it costs.** The menu's copy borrows the ground from the map you play on — it is
the same terrain, and at ~24,000 triangles it is the expensive part — so only the props
are built twice. Just one menu world is ever kept: switching map throws the last one
away. Cycling all four maps leaves one, not four.

Nothing to configure. The stage lives in `client/js/game/lobbystage.js`; where the
tanks stand and how far the camera sits back are the `STAGE`, `SPACING` and
`SLOTS` and `FILL_ORDER` values at the top of that file decide the standing spots and
which one you get; the positions and the camera come from each map's `LOBBY` entry. It is loaded with the 3D engine, so a
browser with no engine still opens the menu and works offline.

## New players, goals and ranks

- **First run.** A new player is asked for a name, then their birth year, then
  their city (city can be skipped). The server keeps only an age group
  (under 13 / 13–17 / 18+), never the year. Under-13 accounts start with voice
  chat off. Names and cities are changed later from the player's own profile.
- **Quick match** picks a random mode and a random map every time.
- **Goals.** 100 long-term goals (matches, wins, kills, captures, powers used,
  MVPs …) with coin and gem rewards, on the GOALS button in the menu.
- **MVP.** Every match names the best player on each team.
- **Rank tanks.** Each new rank unlocks a tank, weakest to strongest:
  Bronze Baz, Silver Halgurd, Gold Rashaba, Platinum Bradost, Diamond Korek,
  Commander Safeen, Legend Newroz. Already own it? You get parts instead.

Nothing to set up on the server for any of these.

## Test button: free gems while you are still building

There is a row near the bottom of Settings called **SECRET BUTTON**. Tap it
**13 times** and "+10,000 GEMS (TEST)" appears next to it. It also gives 100,000
coins and 5,000 parts, so you can try every tank, every upgrade and every power.
From the fifth tap on it counts down for you, and once you have found it the gem
button stays there on that phone or browser, so you only tap 13 times once.

**It is ON by default** so you never have to think about it while building.

⚠️ **Switch it off the day you publish.** Any player who finds it gets free
gems, which would wipe out your Google Play income and your whole economy.

| Where | What to do before release |
| --- | --- |
| Render | Settings → Environment → add `TEST_CHEATS` = `0` |
| Your own VPS | add `TEST_CHEATS=0` to `/etc/kurdish-tank.env`, then `systemctl restart kurdish-tank` |
| Your own PC | `TEST_CHEATS=0 node server/index.js` |

With it off, the button answers "test mode is off" and gives nothing. The
server log prints a loud warning at every start while it is still on.
