/* =====================================================================
   KURDISH TANK — shared configuration.
   Used by BOTH the server and the browser client, so gameplay rules and
   network timing can never drift apart. Edit values here, restart the
   server, and reload the page.
   ===================================================================== */

/* ---------------------------------------------------------------------
   NETWORK TIMING — three separate clocks:

   1. CLIENT RENDER RATE — every browser renders as fast as it can
      (requestAnimationFrame, normally 60 fps). Nothing below limits it.

   2. SERVER SIMULATION RATE (TICK_RATE) — the server advances the game
      in fixed steps of 1/TICK_RATE seconds. Each client input message
      covers exactly one of these steps, so the client and server run
      the same movement code with the same dt (needed for prediction).

   3. NETWORK SNAPSHOT RATE (TICK_RATE / SNAPSHOT_EVERY) — how often the
      server sends positions to clients. Remote tanks are drawn between
      two snapshots (interpolation), so they move smoothly at the render
      rate even though snapshots arrive only 30 times a second.
   --------------------------------------------------------------------- */
export const NET = {
  TICK_RATE: 30,            // server simulation steps per second
  SNAPSHOT_EVERY: 1,        // send a snapshot every N ticks (1 → 30/s, 2 → 15/s)

  // Remote tanks are drawn this far in the past, so there are always two
  // snapshots to blend between. 100 ms = ~3 snapshots of safety margin at
  // 30/s. The client raises it automatically when the connection is jittery.
  INTERP_DELAY_MS: 100,
  INTERP_DELAY_MAX_MS: 260,

  // If snapshots stop arriving (lag spike), keep remote tanks moving along
  // their last velocity for at most this long, then hold them still.
  EXTRAPOLATE_MAX_MS: 220,

  // Server-side input jitter buffer: each player's inputs are queued and
  // consumed one per tick. If the queue runs dry the server waits for up to
  // this many buffered inputs before resuming, which smooths out bursty
  // connections for everyone watching that tank.
  INPUT_BUFFER_MIN: 1,
  INPUT_BUFFER_MAX: 4,
  MAX_INPUTS_PER_TICK: 3,   // catch-up limit (also blocks speed hacks)
  MAX_INPUT_QUEUE: 20,

  // Local prediction: if the server disagrees with our predicted position
  // by more than this, snap instead of smoothing.
  SNAP_DISTANCE: 4,
  CORRECTION_HALF_LIFE_MS: 60, // how fast small corrections are blended out

  RECONNECT_GRACE_MS: 45000, // a dropped player's slot is kept this long
  PING_INTERVAL_MS: 1000,
};

/* --------------------------------------------------------------------
   GAMEPLAY — tweak freely.
   -------------------------------------------------------------------- */
export const GAME = {
  MAX_PLAYERS: 8,             // private rooms and quick match (ranked 5v5 rooms allow 10)
  TANK_RADIUS: 1.75,          // collision circle for a tank (m)

  HP: 100,
  DAMAGE_MIN: 25,
  DAMAGE_MAX: 40,
  RELOAD_S: 2.2,
  SHELL_SPEED: 48,            // m/s
  SHELL_RANGE: 40,            // m
  SHELL_RADIUS: 0.25,

  RESPAWN_S: 4,
  SPAWN_SHIELD_S: 2.5,        // spawn protection (ends early if you fire)

  // Movement
  MAX_SPEED: 9.5,             // forward m/s
  MAX_REVERSE: 5.5,           // reverse m/s
  ACCEL: 21,                  // m/s² when speeding up
  BRAKE: 30,                  // m/s² when slowing / changing direction
  COAST: 9,                   // m/s² drag with no throttle
  TURN_RATE: 2.3,             // hull rad/s at full steer
  TURN_MULT: 1.3,             // all hulls turn this much faster than their base stat (easier dodging)
  TURN_ACCEL: 20,             // rad/s²
  TURRET_SPEED: 3.4,          // turret rad/s
  REVERSE_ANGLE: 1.95,        // stick pointing more than ~112° behind → reverse

  // Power-ups: pads around each map. Drive over one to collect it.
  POWERUPS: {
    TYPES: ['shield', 'speed', 'health', 'oneshot', 'rocket'],
    PICKUP_RADIUS: 2.8,
    RESPAWN_S: 15,          // a pad refills this long after someone takes it
    SHIELD_S: 5,            // shield: blocks all damage (firing does NOT cancel it)
    SPEED_S: 6,             // speed boost duration
    SPEED_MULT: 1.5,        // ×1.5 top speed and acceleration
    // health: instantly back to full HP
    // oneshot: your next shell destroys any tank in one hit (shields still block it)
    // rocket: your next shots are slow homing rockets that steer toward the nearest enemy in front.
    // They turn gently, so a tank that keeps moving or swerves hard can make them miss.
    ROCKETS: 3, ROCKET_SPEED: 15, ROCKET_TURN: 2.0, ROCKET_LIFE: 3.6, ROCKET_SEEK: 48, ROCKET_CONE: 1.2, ROCKET_DMG: [34, 46],
  },

  // team: two teams (blue/red) · scoreLimit: kills, captures, zone points or rounds
  MODES: {
    tdm:  { team: true,  scoreLimit: 20,  timeLimitS: 600 },  // Team Battle: first team to 20 kills
    ffa:  { team: false, scoreLimit: 15,  timeLimitS: 420 },  // Free-for-all: most kills in 7 minutes
    ctf:  { team: true,  scoreLimit: 3,   timeLimitS: 600, pts: true },  // Capture the Flag: first to 3 captures
    koh:  { team: true,  scoreLimit: 150, timeLimitS: 600, moveEvery: 50, pts: true },  // King of the Citadel: 1 point per second in the zone; the zone moves every 50 points
    lts:  { team: true,  scoreLimit: 4,   timeLimitS: 1200, roundS: 90, breakS: 4, pts: true }, // Last Tank Standing: first to 4 rounds, no respawns
    rush: { team: true,  scoreLimit: 20,  timeLimitS: 420, padRespawnS: 5 },         // Power-up Rush: pads refill every 5 s
    // ---- party modes (rules in modes2.js). pts = the team score is points, not kills
    convoy: { team: true,  scoreLimit: 100, timeLimitS: 440, halfS: 210, truckSpeed: 3.2, pushR: 9, defMinDist: 30, pts: true }, // Convoy: % of the route, both halves
    jugg:   { team: false, scoreLimit: 90,  timeLimitS: 360, hpMult: 4, ms: true },  // Juggernaut: 90 s as the giant
    ball:   { team: true,  scoreLimit: 5,   timeLimitS: 360, ballR: 2.4, goalR: 6, friction: 0.42, maxSpeed: 24, pts: true }, // Tank Ball: first to 5 goals
    surv:   { team: true,  scoreLimit: 999, timeLimitS: 1800, breakS: 12, drain: 1.6, coop: true, pts: true }, // Survival: as many waves as you can
    potato: { team: false, scoreLimit: 1,   timeLimitS: 600, fuse: [14, 22], holderSpeed: 1.8, ms: true }, // Hot Potato: last tank alive (the bomb carrier drives 1.8× faster)
    bounty: { team: true,  scoreLimit: 30,  timeLimitS: 480, pts: true },           // Bounty Hunt: first team to 30 points
  },
  MODE_IDS: ['tdm', 'ffa', 'ctf', 'koh', 'lts', 'rush', 'convoy', 'jugg', 'ball', 'surv', 'potato', 'bounty'],
  // Quick match draws a mode and a map at random for every match — no waiting a week for
  // the mode you like. (QUICK_ROTATION is kept only for the old weekly label.)
  QUICK_MODES: ['tdm', 'ffa', 'ctf', 'koh', 'lts', 'rush', 'convoy', 'jugg', 'ball', 'potato', 'bounty'],
  QUICK_ROTATION: ['tdm', 'convoy', 'ctf', 'bounty', 'koh', 'ball', 'rush', 'jugg', 'ffa', 'potato', 'lts'],
  QUICK_FILL_TO: 6,           // quick match fills empty places with bots up to this many tanks
  QUICK_COUNTDOWN_S: 12,      // quick match starts this long after the first player arrives

  CTF: { TAKE_RADIUS: 3.6, CAPTURE_RADIUS: 5.5, BASE_R: 5.5, RETURN_S: 20 },
  KOH: { RADIUS: 8 },

  RANKED: {
    SIZE: 4,                  // one queue: 4 v 4 (one queue fills much faster than two)
    MAPS: ['hawler', 'desert', 'forest'],
    // Every ranked match picks one of these at random, on a random map — nobody picks, so
    // the queue never has to wait for two players to want the same thing.
    MODES: ['ctf', 'koh', 'convoy', 'bounty', 'tdm', 'lts'],
    ACCEPT_S: 12,             // time to press ACCEPT when a match is found
    START_RP: 300,            // new players start here (hidden until placement is done)
    PLACEMENT: 5,             // placement matches before you get a rank
    WIN: 25, LOSS: 20, SPREAD: 5, // win +20..+30, loss -15..-25 depending on the other team's rank
    MVP: 5, STREAK: 5,        // bonus for best player of the match / 3+ wins in a row
    LEAVE: 30,                // leaving a ranked match early
    START_WAIT_S: 40,         // ranked match starts when everyone is in, or after this long
  },
  END_SCREEN_S: 12,
  LOAD_WAIT_S: 20,            // a match starts when every player has loaded the map (or after this long)
  SPAWN_AWAY: { PAD: 11, ZONE: 12, FLAG: 16 },   // never respawn this close to a power-up, the zone or the enemy flag
};

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_CODE_LENGTH = 5;
