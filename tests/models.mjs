import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createCar, updateCarDamage, updateCarEffects } from '../cars.js';

// CanvasTexture needs a canvas but these tests do not need WebGL or a browser.
const context = {
  clearRect() {},
  beginPath() {},
  arc() {},
  fill() {},
  stroke() {},
  fillText() {},
  fillRect() {},
  createRadialGradient() { return { addColorStop() {} }; },
};
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext: () => context };
  },
};

const clean = { total: 0, front: 0, rear: 0, left: 0, right: 0 };

function exactArray(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i], expected[i], `${label}, coordinate ${i}`);
  }
}

function finiteArray(array, label) {
  for (let i = 0; i < array.length; i++) {
    assert.ok(Number.isFinite(array[i]), `${label}, coordinate ${i}`);
  }
}

const car = createCar('#e74f42', 9, 1);
const body = car.userData.body.geometry;
const pristinePositions = body.attributes.position.array.slice();
const pristineColors = body.attributes.color.array.slice();
const pristineNormals = body.attributes.normal.array.slice();
const pristineDecal = car.userData.numberDecal.geometry.attributes.position.array.slice();
assert.equal(car.userData.wheels.length, 4);
assert.equal(car.userData.selectionRing.visible, false);

// A front impact shortens the nose while the rear half stays intact.
const frontHit = { ...clean, total: 0.7, front: 0.8 };
updateCarDamage(car, frontHit);
let movedFront = 0;
let noseBefore = 0;
let noseAfter = 0;
let noseCount = 0;
for (let i = 0; i < pristinePositions.length; i += 3) {
  const z = pristinePositions[i + 2];
  if (z < -0.3) {
    assert.equal(body.attributes.position.array[i], pristinePositions[i], 'Front hit leaves rear X intact');
    assert.equal(body.attributes.position.array[i + 1], pristinePositions[i + 1], 'Front hit leaves rear Y intact');
    assert.equal(body.attributes.position.array[i + 2], z, 'Front hit leaves rear Z intact');
  }
  if (z > 0.8 && pristinePositions[i + 1] < 0.56) {
    noseBefore += z;
    noseAfter += body.attributes.position.array[i + 2];
    noseCount++;
    if (body.attributes.position.array[i + 2] < z) movedFront++;
  }
}
assert.ok(noseCount > 100 && movedFront > 100, 'Front impact deforms substantial nose geometry');
assert.ok((noseBefore - noseAfter) / noseCount > 0.10, 'Front nose crush exceeds ten centimeters');
assert.ok(body.attributes.color.array.some((value, i) => value !== pristineColors[i]), 'Impact scuffs paint');
finiteArray(body.attributes.position.array, 'Damaged positions');
finiteArray(body.attributes.normal.array, 'Damaged normals');
finiteArray(body.attributes.color.array, 'Damaged colors');

// Repeated unchanged damage must not upload vertices or recompute normals.
const version = body.attributes.position.version;
const normalVersion = body.attributes.normal.version;
updateCarDamage(car, frontHit);
assert.equal(body.attributes.position.version, version, 'Unchanged damage skips geometry work');
assert.equal(body.attributes.normal.version, normalVersion, 'Unchanged damage skips normals');
updateCarDamage(car, { ...frontHit, front: 0.804 });
assert.equal(body.attributes.position.version, version, 'Tiny damage increments are batched');

// Side damage changes only the struck side, with tire misalignment on a mount.
updateCarDamage(car, clean);
const wheel = car.userData.wheels.find(item => item.userData.side < 0 && item.userData.axle === 'front');
wheel.rotation.x = 7;
wheel.rotation.y = 0.1;
updateCarDamage(car, { ...clean, total: 0.6, left: 0.8 });
let struckSideMoved = 0;
for (let i = 0; i < pristinePositions.length; i += 3) {
  const x = pristinePositions[i];
  if (x > 0.16) {
    assert.equal(body.attributes.position.array[i], x, 'Left hit leaves right side intact');
  }
  if (x < -0.3 && body.attributes.position.array[i] > x + 0.03) struckSideMoved++;
}
assert.ok(struckSideMoved > 100, 'Left panel crumples toward the center');
assert.equal(wheel.rotation.x, 7, 'Damage preserves tire spin');
assert.equal(wheel.rotation.y, 0.1, 'Damage preserves steering');
assert.ok(Math.abs(wheel.userData.mount.rotation.z) > 0.05, 'Impact changes tire camber');
assert.ok(Math.abs(wheel.userData.mount.rotation.y) > 0.05, 'Impact changes tire toe');
finiteArray(body.attributes.normal.array, 'Side damage normals');

// Rear impacts shorten the tail without moving the nose.
updateCarDamage(car, { ...clean, total: 0.6, rear: 0.8 });
let tailMoved = 0;
for (let i = 0; i < pristinePositions.length; i += 3) {
  const z = pristinePositions[i + 2];
  if (z > 0.3) assert.equal(body.attributes.position.array[i + 2], z, 'Rear hit leaves nose intact');
  if (z < -0.8 && body.attributes.position.array[i + 2] > z + 0.05) tailMoved++;
}
assert.ok(tailMoved > 100, 'Rear impact crushes the tail');

// Engine smoke starts above the front-damage threshold and fades during its life.
updateCarEffects(car, 2, { ...clean, front: 0.4 });
assert.equal(car.userData.engineSmoke, undefined, 'Threshold damage does not allocate smoke');
updateCarEffects(car, 2, { ...clean, front: 0.8 });
assert.equal(car.userData.engineSmoke.visible, true, 'Severe front damage emits smoke');
assert.ok(car.userData.engineSmoke.children.some(sprite => sprite.material.opacity > 0), 'Smoke has visible particles');
for (const sprite of car.userData.engineSmoke.children) {
  assert.ok(Number.isFinite(sprite.position.y) && sprite.position.y > 0.5, 'Smoke rises above bonnet');
}
updateCarEffects(car, 3, { ...clean, front: 0.3 });
assert.equal(car.userData.engineSmoke.visible, false, 'Smoke stops below threshold');

// Zero repair restores the original arrays exactly, including colors and normals.
updateCarDamage(car, { total: 1, front: 1, rear: 0.7, left: 0.8, right: 0.6 });
updateCarEffects(car, 4);
assert.equal(car.userData.windshield.visible, false, 'Severe front damage can break the windscreen');
updateCarDamage(car, clean);
exactArray(body.attributes.position.array, pristinePositions, 'Pristine repaired positions');
exactArray(body.attributes.color.array, pristineColors, 'Pristine repaired colors');
exactArray(body.attributes.normal.array, pristineNormals, 'Pristine repaired normals');
exactArray(car.userData.numberDecal.geometry.attributes.position.array, pristineDecal, 'Pristine repaired number decal');
assert.equal(car.userData.windshield.visible, true, 'Repair restores glass');
assert.equal(car.userData.windshield.position.y, 0.61, 'Repair restores windscreen height');
assert.equal(car.userData.windshield.position.z, 0.105, 'Repair restores windscreen position');
assert.equal(car.userData.windshield.rotation.x, -0.34, 'Repair restores windscreen angle');
assert.equal(car.userData.engineSmoke.visible, false, 'Repair immediately shuts off smoke');
for (const item of car.userData.wheels) {
  assert.equal(Math.abs(item.userData.mount.rotation.z), 0, 'Repair restores tire camber');
  assert.equal(Math.abs(item.userData.mount.rotation.y), 0, 'Repair restores tire toe');
  assert.equal(item.userData.mount.position.x, item.userData.side * 0.464, 'Repair restores wheel track');
  assert.equal(item.userData.mount.position.z, item.userData.axle === 'front' ? 0.59 : -0.59, 'Repair restores axle position');
}
assert.equal(wheel.rotation.x, 7, 'Repair preserves tire spin');
assert.equal(wheel.rotation.y, 0.1, 'Repair preserves steering');

// Steering points the axle in one direction regardless of tire spin angle.
wheel.rotation.x = 0;
const unspunAxis = new Vector3(1, 0, 0).applyQuaternion(wheel.quaternion);
for (const angle of [0.7, 2, 4.8]) {
  wheel.rotation.x = angle;
  const spunAxis = new Vector3(1, 0, 0).applyQuaternion(wheel.quaternion);
  assert.ok(unspunAxis.distanceTo(spunAxis) < 1e-12, 'Wheel spin must not wobble its steered axle');
}

// All shape variants remain finite under asymmetric collision damage.
for (const variant of [0, 2]) {
  const model = createCar('#50aa89', 20 + variant, variant);
  updateCarDamage(model, { total: 0.9, front: 0.2, rear: 0.8, left: 0.1, right: 0.7 });
  finiteArray(model.userData.body.geometry.attributes.position.array, `Variant ${variant} positions`);
  finiteArray(model.userData.body.geometry.attributes.normal.array, `Variant ${variant} normals`);
}

console.log('Model checks passed: directional crush, finite normals, paint, wheel alignment, smoke, and exact repair.');
