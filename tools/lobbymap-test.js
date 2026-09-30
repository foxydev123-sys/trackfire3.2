/* The menu's own copy of each map: the four tanks stand on clear, dry, level ground, the camera
   can see them, and the Citadel's walls sit ON its mound rather than hanging over the edge.
     node tools/lobbymap-test.js */
import { getMap, getLobbyMap, LOBBY, MAP_IDS } from '../client/shared/maps.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The same shape the menu stage uses (lobbystage.js): four spots on a shallow arc.
const SPACING = 6.6, ARC = 1.2, SLOTS = 4;
const spots = (L) => Array.from({ length: SLOTS }, (_, i) => {
  const off = i - (SLOTS - 1) / 2;
  return { x: L.stage.x + off * SPACING, z: L.stage.z - Math.abs(off) * ARC };
});
// Every point an object covers: a fence or a road is a run of posts with no single centre.
const pointsOf = (o) => (o.posts && o.posts.length ? o.posts
  : o.pts && o.pts.length ? o.pts
  : (Number.isFinite(o.x) && Number.isFinite(o.z) ? [[o.x, o.z]] : null));
const segDist = (x, z, pts) => {
  let m = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return m;
};

console.log('--- the staging ground of every map is clear, dry and level');
for (const id of MAP_IDS) {
  const M = getLobbyMap(id), L = M.lobby, S = spots(L);

  // 1. nothing of the map is standing where a tank stands
  let near = 1e9, nearK = '';
  for (const o of M.objects) {
    const pts = pointsOf(o); if (!pts) continue;
    for (const [x, z] of pts) for (const s of S) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < near) { near = d; nearK = o.k; }
    }
  }
  ok(near > 5, `${id}: nothing stands on the line-up (nearest ${nearK} ${near.toFixed(1)} m)`);

  // 2. no tank is standing in water
  if (M.river) {
    let wet = 1e9;
    for (const s of S) wet = Math.min(wet, segDist(s.x, s.z, M.river) - M.riverW);
    ok(wet > 3, `${id}: every tank is on dry land (closest is ${wet.toFixed(1)} m from the water)`);
  }

  // 3. the ground under the line-up is level enough that tanks do not lean drunkenly
  const hs = S.map((s) => M.height(s.x, s.z));
  const drop = Math.max(...hs) - Math.min(...hs);
  ok(drop < 2.2, `${id}: the ground under them is level (${drop.toFixed(2)} m across the line)`);

  // 4. the spots are inside the map
  ok(S.every((s) => Math.abs(s.x) < M.bound && Math.abs(s.z) < M.bound), `${id}: the whole line-up is inside the map`);
}

console.log('\n--- the menu copy never touches the map you actually play on');
for (const id of MAP_IDS) {
  const play = getMap(id), lob = getLobbyMap(id);
  ok(play.objects.length > lob.objects.length,
    `${id}: the playing map keeps what the menu copy sweeps away (${play.objects.length} vs ${lob.objects.length})`);
}

console.log('\n--- the Citadel walls stand on the mound, not over its edge');
{
  const M = getMap('hawler'), C = M.citadel;
  const h = (r) => M.height(C.x + r, C.z);
  const wallOuter = C.T + 0.2 + 0.9;                 // the ring sits at T+0.2; each block is 1.8 deep
  ok(Math.abs(h(wallOuter) - C.H) < 0.2,
    `the ground is still full height at the wall's outer face (r=${wallOuter.toFixed(1)}, ${h(wallOuter).toFixed(2)} m of ${C.H})`);
  // and there is a visible apron of ground beyond the wall before the slope starts
  let apron = 0;
  for (let r = wallOuter; r < C.R; r += 0.1) { if (Math.abs(h(r) - C.H) > 0.2) break; apron = r - wallOuter; }
  ok(apron > 0.7, `with ground still showing outside the wall before it falls away (${apron.toFixed(1)} m)`);
  // the foot must stay clear of the ring road, whose inner edge is 3.5 m inside the lane at r=24
  ok(C.R <= 20.4, `and the foot of the mound stays off the ring road (foot ${C.R}, road edge 20.5)`);
}

console.log('\n--- the forest camera can see the ford it is pointed at');
{
  const L = LOBBY.forest;
  const cam = { x: L.stage.x + L.shot.side, z: L.stage.z + L.shot.dist };
  const bridge = { x: 0, z: 0 };
  const toLook = Math.hypot(L.look.x - cam.x, L.look.z - cam.z);
  const toBridge = Math.hypot(bridge.x - cam.x, bridge.z - cam.z);
  ok(toBridge < 70, `the bridge is within view of the camera (${toBridge.toFixed(0)} m)`);
  ok(L.look.z < cam.z && L.look.x < cam.x, 'and the camera is pointed back across the ford at it');
  ok(toLook > 20, `with the line-up between the two (${toLook.toFixed(0)} m to the aim point)`);
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL LOBBY MAP CHECKS PASS');
process.exit(fails ? 1 : 0);
