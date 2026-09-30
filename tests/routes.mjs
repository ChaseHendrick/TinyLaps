import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { TRACKS } from '../tracks.js';
import { CAR_PROFILES, RaceSimulation } from '../race.js';
import { buildTrack } from '../track.js';
import { createCityPlan, CityTraffic, buildCityRoads } from '../city.js';
import { createContentCatalog } from '../content/index.js';
import { buildScenery } from '../scenery.js';
import { TerrainSystem } from '../terrain.js';

const pack = JSON.parse(await readFile(new URL('../content/packs/starter-kit.json', import.meta.url), 'utf8'));
const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [pack]);
const reports = [];
const dispose = group => group.traverse(object => {
  object.geometry?.dispose();
  for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) material.dispose();
});
// Independent polygon projection uses physical dimensions, including custom
// car scaling, and does not call the collision solver being checked.
function overlap(a, b) {
  const corners = c => {
    const width = c.width ?? .86, length = c.length ?? 1.66, s = Math.sin(c.heading), z = Math.cos(c.heading);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, fore]) => ({
      x: c.x + z * side * width / 2 + s * fore * length / 2,
      z: c.z - s * side * width / 2 + z * fore * length / 2 }));
  };
  const polygons = [corners(a), corners(b)];
  let depth = Infinity;
  for (const polygon of polygons) for (let i = 0; i < 2; i++) {
    const dx = polygon[i + 1].x - polygon[i].x, dz = polygon[i + 1].z - polygon[i].z, n = Math.hypot(dx, dz);
    const nx = -dz / n, nz = dx / n;
    const ranges = polygons.map(points => { const q = points.map(p => p.x * nx + p.z * nz); return [Math.min(...q), Math.max(...q)]; });
    const value = Math.min(ranges[0][1], ranges[1][1]) - Math.max(ranges[0][0], ranges[1][0]);
    if (value <= 0) return 0;
    depth = Math.min(depth, value);
  }
  return depth;
}

// A parked racer beside an approach can block the candidate move after the
// junction has been reserved. The reservation must roll back with that move.
{
  const plan = createCityPlan(TRACKS.foundry.city), traffic = new CityTraffic({ plan, count: 1 });
  const car = traffic.cars[0];
  car.travel = traffic.length(car) - traffic.turnRadius - 1.35;
  car.speed = 3;
  traffic.clock = 7;
  car.next = plan.nodes[car.b].neighbors.find(id => id !== car.a);
  traffic.position(car);
  const before = { x: car.x, z: car.z, travel: car.travel }, junction = car.b;
  const parked = { id: 0, x: car.x + 1.4, z: car.z - 1.2, y: car.y,
    heading: 0, vx: 0, vz: 0, speed: 0, mass: 690, damage: { total: 0, front: 0 } };
  traffic.update(.05, [parked]);
  assert.deepEqual({ x: car.x, z: car.z, travel: car.travel }, before, 'Blocked candidate rolls back its physical movement');
  assert.equal(car.junction, -1, 'Blocked candidate keeps no phantom junction ownership');
  assert.equal(traffic.locks.has(junction), false, 'Rolled-back acquisition releases the junction for other traffic');
  for (let i = 0; i < 1800; i++) traffic.update(.05);
  assert(car.visits >= 4, 'Traffic resumes successive streets after the parked obstruction leaves');
  assert(traffic.locks.get(junction) !== car.id || car.junction === junction, 'No orphan reservation survives subsequent route transitions');
}

for (const [id, config] of Object.entries(catalog.maps)) {
  const track = buildTrack(config);
  const samples = track.samples;
  const step = track.length / samples.length;
  assert.equal(samples.length, 1800, `${id}: road is sampled consistently`);
  assert(samples.every(p => Object.values(p).every(Number.isFinite)), `${id}: finite road geometry`);
  assert(track.length > 100, `${id}: starting grid has room`);
  const closure = track.sampleAtDistance(0);
  for (const distance of [track.length, -track.length, track.length * 8]) {
    const p = track.sampleAtDistance(distance);
    assert(Math.hypot(p.x - closure.x, p.z - closure.z) < 1e-8, `${id}: sampler closes and wraps`);
  }
  let maxStep = 0, minNonadjacent = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i], b = samples[(i + 1) % samples.length];
    maxStep = Math.max(maxStep, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    assert(Math.hypot(a.tx, a.tz) > .95, `${id}: tangent follows the road`);
  }
  assert(maxStep < step * 1.2, `${id}: visible closed road has no seam or skipped segment`);
  for (let i = 0; i < samples.length; i += 6) for (let j = i + 6; j < samples.length; j += 6) {
    const arc = Math.min(j - i, samples.length - (j - i)) * step;
    if (arc > 15) minNonadjacent = Math.min(minNonadjacent, Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z));
  }
  assert(minNonadjacent >= 7, `${id}: road ribbons do not cross or overlap`);
  const report = { id, length: +track.length.toFixed(2), seamStep: +maxStep.toFixed(4), separation: +minNonadjacent.toFixed(2) };
  if (config.city) {
    const plan = createCityPlan(config.city);
    assert(samples.every(p => plan.distanceToRoad(p.x, p.z) < plan.width / 2 - .3), `${id}: race follows visible streets through every rounded corner`);
    // Read actual rendered asphalt from an independent raycast, rather than
    // only checking against the same abstract road graph as the sampler.
    const group = new THREE.Group(), terrain = new TerrainSystem();
    buildCityRoads({ group, plan, terrain });
    group.updateMatrixWorld(true);
    const asphalt = group.children.find(mesh => mesh.name === 'City streets');
    const ray = new THREE.Raycaster();
    for (let i = 0; i < samples.length; i += 6) {
      const p = samples[i];
      ray.set(new THREE.Vector3(p.x, 5, p.z), new THREE.Vector3(0, -1, 0));
      assert(ray.intersectObject(asphalt, false).length > 0, `${id}: rendered asphalt supports sample ${i}`);
    }
    const inner = new Set();
    for (const p of samples) {
      const e = plan.edges.reduce((best, e) => {
        const a = plan.nodes[e.a], b = plan.nodes[e.b], dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
        const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
        return d < best.d ? { e, d } : best;
      }, { d: Infinity }).e;
      const a = plan.nodes[e.a], b = plan.nodes[e.b];
      if (a.neighbors.length === 4 && b.neighbors.length === 4) inner.add(e.id);
    }
    assert(inner.size >= 4, `${id}: racers enter multiple interior streets`);
    report.innerEdges = inner.size;
    dispose(group);
    terrain.mesh.geometry.dispose();
    terrain.mesh.material.dispose();
  }
  const group = new THREE.Group();
  const scenery = config.city ? buildScenery({ group, theme: config.setting, city: config.city, seed: config.seed,
    samples: samples.filter((_, i) => i % 6 === 0), authoredProps: config.props }) : null;
  let traffic;
  const sim = new RaceSimulation(track.length, track.sampleAtDistance, {
    carProfiles: config.cars, colliders: scenery?.colliders || [],
    ...(config.city ? { barrierAt: () => ({ solid: false }), speedLimit: 12, cornerSafety: .82 } : {}),
    vehicles: () => traffic?.cars || [],
  });
  if (scenery) traffic = new CityTraffic({ plan: scenery.cityPlan, count: config.city.traffic,
    seed: config.seed, obstacles: () => scenery.colliders });
  const stopped = Array(10).fill(0), longestStopped = Array(10).fill(0), onRoad = Array(10).fill(0);
  let checks = 0;
  for (let tick = 0; tick < 120 * 30; tick++) {
    sim.update(1 / 30);
    traffic?.update(1 / 30, sim.cars, sim.physics.gravity);
    if (tick % 3 !== 0) continue;
    checks++;
    for (const car of sim.cars) {
      assert([car.x, car.y, car.z, car.speed, car.progress, car.heading].every(Number.isFinite), `${id}: autonomous racer stays finite`);
      stopped[car.id] = car.speed < .6 ? stopped[car.id] + .1 : 0;
      longestStopped[car.id] = Math.max(longestStopped[car.id], stopped[car.id]);
      if (scenery && scenery.cityPlan.distanceToRoad(car.x, car.z) < config.city.width / 2 + .25) onRoad[car.id]++;
    }
  }
  assert(sim.cars.every(car => car.laps >= 1), `${id}: every racer completes the actual route`);
  assert(longestStopped.every(value => value < 12), `${id}: normal AI does not shuttle or remain stuck against scenery`);
  if (scenery) assert(onRoad.every(value => value / checks > .94), `${id}: all racers remain on the city streets`);
  report.laps = sim.cars.map(car => car.laps);
  report.longestStop = +Math.max(...longestStopped).toFixed(2);
  dispose(group);
  reports.push(report);
}

// Starter content runs through the same connected graph, signals, curved turns
// and collision checks as the built-in cities, without a custom engine branch.
const config = catalog.maps['starter-kit/workshop-quarter'];
const plan = createCityPlan(config.city), traffic = new CityTraffic({ plan, count: config.city.traffic, seed: config.seed });
const edges = new Set(), nodes = new Set();
let maxOverlap = 0, maxTurn = 0;
let previous = traffic.cars.map(car => ({ ...car }));
for (let tick = 0; tick < 360 * 20; tick++) {
  traffic.update(.05);
  for (let i = 0; i < traffic.cars.length; i++) {
    const car = traffic.cars[i], old = previous[i];
    edges.add([car.a, car.b].sort((a, b) => a - b).join(':'));
    nodes.add(car.a);
    assert(plan.nodes[car.a].neighbors.includes(car.b), 'Local traffic transitions between connected streets');
    assert.notEqual(car.next, car.a, 'Normal local traffic does not reverse and shuttle along one street');
    assert(Math.hypot(car.x - old.x, car.z - old.z) < .2, 'Local traffic transitions have no position jumps');
    const turn = Math.abs(Math.atan2(Math.sin(car.heading - old.heading), Math.cos(car.heading - old.heading)));
    maxTurn = Math.max(maxTurn, turn);
    assert(turn < .16, 'Local traffic turns continuously');
    assert(plan.distanceToRoad(car.x, car.z) < plan.width / 2 - .6, 'Local car footprints stay on visible streets');
    for (let j = i + 1; j < traffic.cars.length; j++) {
      const depth = overlap(car, traffic.cars[j]);
      maxOverlap = Math.max(maxOverlap, depth);
      assert(depth < 1e-8, 'Local traffic never clips through another grounded car');
    }
    for (const [junction, owner] of traffic.locks) assert(traffic.cars.some(car => car.id === owner && car.junction === junction), 'Every junction reservation has a live owner');
    previous[i] = { ...car };
  }
}
assert.equal(edges.size, plan.edges.length, 'Starter city traffic reaches every street');
assert.equal(nodes.size, plan.nodes.length, 'Starter city traffic reaches every intersection');
assert(traffic.cars.every(car => car.visits > 20), 'Every local car continues through many streets');
console.log(JSON.stringify({ routes: reports, starterTraffic: { streets: edges.size, intersections: nodes.size,
  maxOverlap, maxTurn: +maxTurn.toFixed(4), visits: traffic.cars.map(car => car.visits) } }, null, 2));
