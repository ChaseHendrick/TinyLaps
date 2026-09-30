import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildScenery } from '../scenery.js';
import { TRACKS } from '../tracks.js';
import { RaceSimulation } from '../race.js';

function circuitFor(config) {
  const curve = new THREE.CatmullRomCurve3(config.points.map(point => new THREE.Vector3(...point)), true, 'centripetal');
  curve.arcLengthDivisions = 4000;
  curve.updateArcLengths();
  const length = curve.getLength();
  const sampleAtDistance = distance => {
    const u = ((distance % length) + length) % length / length;
    const point = curve.getPointAt(u), tangent = curve.getTangentAt(u);
    const a = curve.getTangentAt((u - .002 + 1) % 1), b = curve.getTangentAt((u + .002) % 1);
    const magnitude = Math.hypot(tangent.x, tangent.z);
    return {
      x: point.x, y: Math.max(.17, point.y), z: point.z,
      tx: tangent.x / magnitude, tz: tangent.z / magnitude,
      curvature: Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / (length * .004),
    };
  };
  return { length, sampleAtDistance, samples: Array.from({ length: 300 }, (_, i) => sampleAtDistance(i / 300 * length)) };
}

function finiteArray(array, label) {
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i])) assert.fail(`${label}: nonfinite coordinate ${i}`);
  }
}

function closeArray(actual, expected, label, tolerance = 1e-5) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || Math.abs(actual[i] - expected[i]) > tolerance) {
      assert.fail(`${label}: coordinate ${i}, expected ${expected[i]}, received ${actual[i]}`);
    }
  }
}

function snapshotGeometry(group) {
  const snapshot = [];
  group.traverse(object => {
    if (!object.isMesh) return;
    const arrays = {};
    for (const key of ['position', 'normal', 'color']) {
      if (object.geometry.attributes[key]) arrays[key] = object.geometry.attributes[key].array.slice();
    }
    snapshot.push({ object, arrays });
  });
  return snapshot;
}

function checkGeometry(group, label) {
  let meshCount = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    meshCount++;
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) finiteArray(attribute.array, `${label}: ${name}`);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      assert.ok(!material.vertexColors || object.geometry.attributes.color, `${label}: a vertex-color material requires a color attribute, including animated props`);
    }
    if (object.isInstancedMesh) finiteArray(object.instanceMatrix.array, `${label}: instance transforms`);
  });
  assert.ok(meshCount < 150, `${label}: preserve the scenery draw budget`);
}

function debrisMeshes(group) {
  const result = [];
  group.traverse(object => { if (object.isInstancedMesh && object.name === 'Physics debris') result.push(object); });
  assert.equal(result.length, 2, 'Debris shares two instanced draw calls');
  return result;
}

function debrisSnapshot(group) {
  return debrisMeshes(group).map(mesh => ({ count: mesh.count, matrix: mesh.instanceMatrix.array.slice(0, mesh.count * 16) }));
}

function firstDebrisHeight(group) {
  const mesh = debrisMeshes(group).find(item => item.count > 0);
  assert.ok(mesh, 'Impact creates visible debris instances');
  return mesh.instanceMatrix.array[13];
}

function assertDebrisEqual(actual, expected, label) {
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].count, expected[i].count, `${label}: visible count`);
    closeArray(actual[i].matrix, expected[i].matrix, label, 0);
  }
}

function disposeFixture(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  group.clear();
}

for (const [theme, config] of Object.entries(TRACKS)) {
  const circuit = circuitFor(config), group = new THREE.Group();
  const scenery = buildScenery({ group, theme:config.setting||theme, river:!!config.river, samples: circuit.samples, seed:config.seed||17 });
  const pristine = snapshotGeometry(group);
  let time = 0;
  const tick = (frames, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) { time += dt; scenery.update(time, dt); }
  };
  const assertReset = () => {
    scenery.reset();
    assert.ok(scenery.colliders.every(collider => collider.health === 1 && collider.solid), `${theme}: repair restores health and solidity`);
    assert.equal(scenery.debrisCount, 0, `${theme}: repair clears debris`);
    assert.equal(debrisMeshes(group).reduce((sum, mesh) => sum + mesh.count, 0), 0, `${theme}: repair hides all debris instances`);
    for (const { object, arrays } of pristine) {
      for (const [name, original] of Object.entries(arrays)) closeArray(object.geometry.attributes[name].array, original, `${theme}: restored ${name}`);
    }
  };

  checkGeometry(group, `${theme}: initial scene`);
  assert.ok(scenery.colliders.filter(collider => collider.kind === 'tree').length >= 30, `${theme}: physics includes the forest`);
  assert.ok(scenery.colliders.filter(collider => collider.kind === 'building').length >= 5, `${theme}: physics includes the village`);
  assert.equal(new Set(scenery.colliders.map(collider => collider.id)).size, scenery.colliders.length, `${theme}: collider IDs are unique`);
  assert.ok(scenery.colliders.every(collider => collider.mass >= 50 && collider.mass <= 2000 && collider.radius > 0), `${theme}: collider mass and footprint are physical`);
  assert.ok(!scenery.colliders.some(collider => collider.kind === 'hill'), `${theme}: smooth hills are terrain, not giant circle barriers`);

  const tree = scenery.colliders.filter(collider => collider.kind === 'tree').sort((a, b) => b.mass - a.mass)[0];
  const dent = scenery.applyImpact(tree.id, { impulse: 150, severity: .15, x: tree.x - 1, z: tree.z, vx: 6, vz: 0 });
  assert.ok(dent && tree.health > 0 && tree.health < 1 && tree.solid, `${theme}: a modest strike damages a standing tree`);
  tick(40);
  let moved = 0, meanX = 0, meanZ = 0;
  for (const { object, arrays } of pristine) {
    const original = arrays.position, current = object.geometry.attributes.position.array;
    for (let i = 0; i < original.length; i += 3) {
      const dx = current[i] - original[i], dz = current[i + 2] - original[i + 2];
      if (original[i + 1] > 1 && Math.hypot(dx, dz) > 1e-5) { moved++; meanX += dx; meanZ += dz; }
    }
  }
  assert.ok(moved > 100 && meanX / moved > .03, `${theme}: impact velocity bends substantial tree geometry toward positive X`);
  assert.ok(Math.abs(meanZ / moved) < 1e-4, `${theme}: an X strike does not invent sideways Z motion`);

  const destruction = scenery.applyImpact(tree.id, { impulse: 5000, severity: 1, x: tree.x - 1, z: tree.z, vx: 8, vz: 0 });
  assert.equal(destruction.destroyed, true, `${theme}: a large impact destroys the tree`);
  assert.equal(tree.health, 0, `${theme}: destruction exhausts health`);
  assert.equal(tree.solid, false, `${theme}: a fallen tree no longer blocks cars`);
  assert.equal(scenery.applyImpact(tree.id, { impulse: 5000, severity: 1 }), false, `${theme}: destroyed props cannot repeatedly emit impact debris`);
  const house = scenery.colliders.find(collider => collider.kind === 'building');
  scenery.applyImpact(house.id, { energy: 9000, impulse: 4000, severity: 1, x: house.x, z: house.z - 1, vx: 0, vz: 5 });
  assert.equal(house.solid, false, `${theme}: destroyed building foundations become nonsolid`);
  tick(45);
  assert.ok(scenery.debrisCount > 0, `${theme}: destruction emits physics debris`);
  const pausedDebris = debrisSnapshot(group), pausedGeometry = snapshotGeometry(group);
  for (let i = 0; i < 5; i++) { time += 1; scenery.update(time, 0); }
  assertDebrisEqual(debrisSnapshot(group), pausedDebris, `${theme}: dt=0 freezes debris`);
  for (const { object, arrays } of pausedGeometry) closeArray(object.geometry.attributes.position.array, arrays.position, `${theme}: dt=0 freezes structural motion`, 0);
  checkGeometry(group, `${theme}: damaged scene`);
  assertReset();

  if (theme === 'harbor') {
    // Gravity is measured through the rendered body trajectory, without
    // reaching into the implementation's private velocity or sleep state.
    scenery.configurePhysics({ gravity: 0, restitution: 0 });
    scenery.setGroundSampler(() => -.35);
    scenery.applyImpact(tree.id, { impulse: 2200, severity: 1, vx: 7, vz: 1 });
    tick(1, .01); const h0 = firstDebrisHeight(group);
    tick(1, .01); const h1 = firstDebrisHeight(group);
    tick(1, .01); const h2 = firstDebrisHeight(group);
    assert.ok(h1 > h0, 'Initial debris impulse gives it upward momentum');
    assert.ok(Math.abs((h2 - h1) - (h1 - h0)) < 1e-6, 'Zero gravity preserves vertical velocity');
    scenery.configurePhysics({ gravity: 20, restitution: .25 });
    tick(1, .01); const h3 = firstDebrisHeight(group);
    assert.ok((h3 - h2) < (h2 - h1) - .001, 'Increasing gravity bends the trajectory downward');
    tick(480);
    const settled = debrisSnapshot(group);
    tick(60);
    assertDebrisEqual(debrisSnapshot(group), settled, 'Ground friction and bounce settle debris');
    for (const mesh of debrisMeshes(group)) for (let i = 0; i < mesh.count; i++) {
      const height = mesh.instanceMatrix.array[i * 16 + 13];
      assert.ok(height >= -.35 && height < .2, 'Settled debris rests on the supplied deformed ground');
    }
    scenery.configurePhysics({ gravity: Infinity, restitution: NaN });
    checkGeometry(group, 'Invalid physics settings preserve finite motion');
    assertReset();

    scenery.configurePhysics({ gravity: 9.81, restitution: .26 });
    scenery.setGroundSampler(() => 0);
    const results = scenery.damageAt(0, 0, 110, 18000);
    assert.ok(results.length > 30, 'A world damage tool affects multiple props in its radius');
    scenery.update(time, 0);
    assert.equal(scenery.debrisCount, 80, 'Mass destruction caps live debris at eighty bodies');
    assert.equal(debrisMeshes(group).reduce((sum, mesh) => sum + mesh.count, 0), 80, 'The body cap also applies to rendered instances');
    checkGeometry(group, 'Mass destruction remains finite');
    assertReset();

    // The simulation calls the public environment callback with a contact
    // impulse. Scenery alone owns prop health and creates the resulting debris.
    const events = [];
    const simulation = new RaceSimulation(circuit.length, circuit.sampleAtDistance, {
      colliders: [tree],
      barrierAt: () => ({ health: 0, solid: false }),
      impact(collider, event) { events.push(event); scenery.applyImpact(collider.id, event); },
    });
    simulation.configurePhysics({ enginePower: 0, grip: .15 });
    for (const car of simulation.cars.slice(1)) { simulation.teleportCar(car.id, 500 + car.id * 10, 500, 0); car.held = true; }
    simulation.teleportCar(0, tree.x - tree.radius - .80, tree.z, Math.PI / 2);
    simulation.applyImpulse(0, { x: simulation.cars[0].mass * 11, z: 0 });
    simulation.update(1 / 120);
    assert.ok(events.some(event => event.type === 'environment' && event.colliderId === tree.id && event.impulse > 100), 'Vehicle contact reaches the scenery impact callback');
    assert.ok(tree.health < 1, 'A real simulation impulse damages the contacted prop');
    assert.ok(scenery.debrisCount > 0, 'A real simulation impulse releases prop debris');
    assertReset();
  }
  disposeFixture(group);
}

console.log('Scenery checks passed: all circuits, directional impacts, collapse, debris gravity/settling/pause/cap, material colors, geometry repair, and vehicle integration.');
