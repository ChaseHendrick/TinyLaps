import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RaceSimulation, PHYSICS_STEP } from '../race.js';
import { TRACKS } from '../tracks.js';
import { buildTrack } from '../track.js';
import { buildScenery } from '../scenery.js';

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const mod = (value, length) => ((value % length) + length) % length;
const city = TRACKS.foundry, cityTrack = buildTrack(city), cityLength = cityTrack.length;
const scenery = buildScenery({ group:new THREE.Group(), theme:city.setting, city:city.city, seed:city.seed,
  samples:cityTrack.samples.filter((_, i) => i % 6 === 0) });

// A lone player car in Foundry City. Every city barrier is open in the game,
// so the driver can turn down any street, and real buildings stay solid.
function cityDriver() {
  const sim = new RaceSimulation(cityLength, cityTrack.sampleAtDistance, { colliders:scenery.colliders, barrierAt:() => ({ solid:false }) });
  sim.cars = [sim.cars[0]];
  const car = sim.cars[0];
  const run = { sim, car, maxStep:0, driven:0, left:false };
  run.steerTo = (x, z, speed, steer) => {
    const error = wrap(Math.atan2(x - car.x, z - car.z) - car.heading);
    sim.setPlayerInput({ steer:steer ?? Math.max(-1, Math.min(1, error * 2.5)),
      accelerate:car.speed < speed ? 1 : 0, brake:car.speed > speed + 1.5 ? .6 : 0 });
  };
  run.followRoute = speed => { const p = cityTrack.sampleAtDistance(car.distance + 4); run.steerTo(p.x, p.z, speed); };
  run.drive = (seconds, control, until = () => false) => {
    for (let i = 0; i < seconds / PHYSICS_STEP && !until(); i++) {
      control();
      const progress = car.progress, x = car.x, z = car.z;
      sim.update(PHYSICS_STEP);
      run.maxStep = Math.max(run.maxStep, Math.abs(car.progress - progress));
      run.driven += Math.hypot(car.x - x, car.z - z);
      run.left ||= car.offRoute;
      const drift = mod(car.progress - car.distance, cityLength);
      assert(Math.min(drift, cityLength - drift) < 1e-6, 'progress stays on the physical route position');
    }
  };
  return run;
}
// Start 3 m before the line, heading along the opening boulevard.
function atLine(run) {
  const p = cityTrack.sampleAtDistance(cityLength - 3);
  run.sim.teleportCar(0, p.x, p.z, Math.atan2(p.tx, p.tz));
  run.sim.setPlayerCar(0);
}

// Circling one city block can no longer turn a 48 m loop into full laps.
{
  const run = cityDriver(), { car } = run;
  atLine(run);
  const loop = [[4,-14],[8,-10],[8,-4],[4,0],[-4,0],[-8,-4],[-8,-10],[-4,-14]];
  let waypoint = 0;
  run.drive(70, () => {
    if (Math.hypot(loop[waypoint % 8][0] - car.x, loop[waypoint % 8][1] - car.z) < 2.5) waypoint++;
    run.steerTo(...loop[waypoint % 8], 4.5);
  });
  assert(waypoint >= 40, 'the driver circles the block several times');
  assert.equal(car.laps, 0, 'circling a block earns no laps');
  assert.equal(car.bestLap, null, 'circling a block sets no lap time');
  assert(car.lapCuts >= 4 && car.progress < cityLength, 'each loop is recorded as a cut');
}

// A side street that skips most of the route is a cut. The lap does not count,
// the circuit must be completed again, and that lap cannot set a time.
{
  const run = cityDriver(), { car } = run;
  atLine(run);
  const cut = [[4,-14],[8,-10],[8,-3]];
  let waypoint = 0;
  run.drive(20, () => {
    if (waypoint < 3 && Math.hypot(cut[waypoint][0] - car.x, cut[waypoint][1] - car.z) < 2.5) waypoint++;
    if (waypoint < 3) run.steerTo(...cut[waypoint], 4); else run.followRoute(5);
  }, () => car.lapCuts > 0);
  assert.equal(car.lapCuts, 1, 'rejoining 150 m ahead is a cut');
  assert(car.lapCut && car.progress < 0, 'the cut lap must be driven again');
  const skipped = run.driven;
  run.drive(150, () => run.followRoute(6), () => car.laps > 0);
  assert.equal(car.laps, 1, 'the next full circuit counts');
  assert(run.driven - skipped > cityLength * 1.3, 'the counted lap needed the rest of the cut lap plus a full circuit');
  assert.equal(car.lastLap, null, 'the untimed lap records no last lap');
  assert.equal(car.bestLap, null, 'a cut lap never becomes a best lap');
  assert.equal(car.lapCut, false);
}

// A wrong turn costs only the time spent: straight through the first turn,
// a U-turn in the side street, then back onto the route where the car left.
{
  const run = cityDriver(), { car, sim } = run;
  sim.setPlayerCar(0);
  let phase = 'straight', farthest = 0;
  run.drive(120, () => {
    if (car.offRoute) farthest = Math.max(farthest, Math.abs(car.lane));
    if (phase === 'straight') {
      const slow = car.x > 22;
      run.steerTo(car.x < 12 ? car.x + 20 : 34, car.x < 12 ? car.z : -16.4, slow ? 2.2 : 7);
      if (car.x > 30) phase = 'turn';
    } else if (phase === 'turn') {
      sim.setPlayerInput({ steer:-1, accelerate:car.speed < 2 ? .5 : 0 });
      if (Math.abs(wrap(-Math.PI / 2 - car.heading)) < .35) phase = 'back';
    } else run.followRoute(6);
  }, () => car.laps > 0);
  assert(run.left && farthest > 8, 'the car really left the route');
  assert.equal(car.lapCuts, 0, 'returning where the car left is not a cut');
  assert.equal(car.laps, 1, 'the lap still counts');
  assert(car.lastLap > 0 && car.bestLap === car.lastLap, 'the lap is still timed');
  assert(run.maxStep < .5, 'progress never jumps while the car is off the route');
}

// Holding the accelerator through the first turn reaches the route 35 m
// ahead, which is a cut. Backing up to the turn undoes it and the lap counts.
{
  const run = cityDriver(), { car, sim } = run;
  sim.setPlayerCar(0);
  run.drive(5, () => sim.setPlayerInput({ accelerate:1 }));
  assert(car.lapCuts === 1 && car.lapCut, 'rejoining the route ahead is a cut');
  run.drive(20, () => sim.setPlayerInput({ reverse:1 }), () => car.x < 25);
  assert(!car.offRoute && !car.lapCut && car.progress > 30 && car.progress < 45, 'returning to the turn restores the lap');
  run.drive(120, () => {
    const forward = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
    if (forward < -.3) sim.setPlayerInput({ brake:1 }); else run.followRoute(6);
  }, () => car.laps > 0);
  assert(car.laps === 1 && car.lastLap > 0, 'the restored lap counts and is timed');
}

// Return to road over the line counts that lap without a time, and the next
// lap is timed over one circuit rather than two.
{
  const track = buildTrack(TRACKS.harbor), length = track.length;
  const sim = new RaceSimulation(length, track.sampleAtDistance), car = sim.cars[0];
  while (!(car.laps === 1 && car.progress > 2 * length - 1)) sim.update(PHYSICS_STEP);
  const p = track.sampleAtDistance(car.distance + 1.5), timed = car.lastLap;
  sim.teleportCar(0, p.x, p.z, Math.atan2(p.tx, p.tz));
  assert.equal(car.laps, 2, 'a recovery over the line completes the lap');
  assert.equal(car.lastLap, timed, 'that lap records no time');
  assert.equal(car.lapStartedAt, sim.elapsed, 'the next lap is timed from the recovery');
  while (car.laps < 3) sim.update(PHYSICS_STEP);
  const others = sim.cars.filter(other => other !== car).map(other => other.bestLap).sort((a, b) => a - b);
  assert(car.lastLap > others[0] * .9 && car.lastLap < others[4] * 1.3, 'the next lap time covers one circuit');
  assert.equal(car.laps, Math.floor(car.progress / length), 'lap count matches the route progress');

  // Grab moves place the car. Moving it well ahead in small hops voids the
  // lap time, and the lap still counts when it reaches the line.
  for (let i = 0; i < 12; i++) {
    const q = track.sampleAtDistance(car.distance + 1);
    sim.teleportCar(0, q.x, q.z, Math.atan2(q.tx, q.tz));
  }
  assert.equal(car.lapStartedAt, null, '12 m of placed ground cannot be timed');
  const laps = car.laps, last = car.lastLap;
  while (car.laps === laps) sim.update(PHYSICS_STEP);
  assert.equal(car.lastLap, last, 'the placed lap records no time');
  sim.update(30);
  assert(car.lastLap !== last && car.lastLap > 0, 'timing resumes on the following lap');
}

// AI racers thrown out of the city steer for the nearest road and rejoin
// without a cut. Only the player's driving can cut the route.
{
  const sim = new RaceSimulation(cityLength, cityTrack.sampleAtDistance, { colliders:scenery.colliders,
    barrierAt:() => ({ solid:false }), speedLimit:12, cornerSafety:.82 });
  sim.update(15);
  const car = sim.cars[3], p = cityTrack.sampleAtDistance(260);
  sim.teleportCar(3, p.x, p.z, Math.atan2(p.tx, p.tz));
  sim.update(.5);
  sim.applyImpulse(3, { x:p.tz * 28 * car.mass, z:-p.tx * 28 * car.mass, y:1.5 * car.mass });
  let left = false, back = null;
  for (let i = 0; i < 30 / PHYSICS_STEP && back === null; i++) {
    sim.update(PHYSICS_STEP);
    left ||= car.offRoute;
    if (left && !car.offRoute) back = sim.elapsed;
  }
  assert(left, 'the throw carries the racer off the route');
  assert(back !== null, 'the racer finds its way back onto the route');
  assert.equal(car.lapCuts, 0, 'a racer that did not choose to leave is never cut');
  const progress = car.progress;
  sim.update(20);
  assert(car.progress > progress + 50, 'the racer keeps racing after rejoining');
}

console.log('Lap integrity checks passed: block circling and side-street cuts earn no laps or lap times, a wrong turn and U-turn costs only time, backing out of a cut restores the lap, recovery over the line counts an untimed lap, placed ground voids timing, and thrown racers rejoin without a cut.');
