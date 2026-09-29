import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerrainSystem } from '../terrain.js';

const group = new THREE.Group();
const terrain = new TerrainSystem({ group });
const pristinePositions = terrain.mesh.geometry.attributes.position.array.slice();
const pristineColors = terrain.mesh.geometry.attributes.color.array.slice();
const pristineNormals = terrain.mesh.geometry.attributes.normal.array.slice();

function near(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
}
function finite(array, message) {
  for (let i = 0; i < array.length; i++) assert.ok(Number.isFinite(array[i]), `${message}, index ${i}`);
}
function exact(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message} length`);
  for (let i = 0; i < actual.length; i++) assert.equal(actual[i], expected[i], `${message}, index ${i}`);
}

assert.equal(terrain.heightAt(0, 0), 0);
assert.deepEqual(terrain.sampleSurface(0, 0), { height: 0.17, grip: 1, roughness: 0 });
assert.equal(terrain.heightAt(200, 200), 0, 'Outside the island has no invented ground offset');
assert.ok(terrain.mesh.geometry.index.count > 50000, 'Ground is a dense indexed terrain mesh');

// Grid triangles clip at the scalloped oval rather than leaving a box of ground.
for (let i = 0; i < pristinePositions.length; i += 3) {
  const x = pristinePositions[i] / terrain.radiusX;
  const z = pristinePositions[i + 2] / terrain.radiusZ;
  const a = Math.atan2(z, x);
  const edge = 1 + 0.032 * Math.sin(3 * a + 0.2) + 0.022 * Math.cos(5 * a);
  assert.ok(Math.hypot(x, z) <= edge + 2e-6, 'Terrain follows the island boundary');
}

assert.ok(terrain.impact(0, 0, 1, 4) > 0, 'Impact touches height samples');
assert.ok(terrain.heightAt(0, 0) < -0.3, 'Impact physically depresses the crater center');
assert.ok(terrain.heightAt(3.28, 0) > 0.015, 'Displaced soil forms a raised rim');
const crater = terrain.sampleSurface(0, 0, 0.6);
assert.ok(crater.height < 0.3, 'Surface height includes the original elevated road height');
assert.ok(crater.grip < 0.9 && crater.grip >= 0.6, 'Damaged soil reduces tire grip');
assert.ok(crater.roughness > 0, 'Broken surface is rough');
assert.ok(terrain.mesh.geometry.attributes.color.array.some((value, i) => value !== pristineColors[i]), 'Impact changes grass into exposed soil');
finite(terrain.mesh.geometry.attributes.normal.array, 'Crater normals');
assert.ok(terrain.stats.damagedSamples > 0, 'Terrain reports persistent damage');

terrain.sculpt(0, 0, 0.8, 5);
assert.ok(terrain.heightAt(0, 0) > 0.3, 'Sculpt raises actual ground');
terrain.sculpt(0, 0, -10, 5);
near(terrain.heightAt(0, 0), -2.2, 1e-6, 'Digging respects the depth limit');
terrain.sculpt(0, 0, 10, 5);
near(terrain.heightAt(0, 0), 3, 1e-6, 'Raising respects the height limit');
terrain.repairAt(0, 0, 10);
assert.equal(terrain.heightAt(0, 0), 0, 'Repair restores the center');
assert.equal(terrain.sampleSurface(0, 0).grip, 1, 'Repair restores soil grip');

// A rotated and tilted road under a transformed parent must follow world Y.
terrain.reset();
const parent = new THREE.Group();
parent.position.set(-2, 0.1, 1);
parent.rotation.y = -0.6;
group.add(parent);
const roadGeometry = new THREE.PlaneGeometry(8, 6, 8, 6);
roadGeometry.rotateX(-Math.PI / 2);
const road = new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial());
road.position.set(3, 0.7, -4);
road.rotation.set(0.15, 0.42, 0.28);
parent.add(road);
group.updateMatrixWorld(true);
const originalLocal = road.geometry.attributes.position.array.slice();
const originalMatrix = road.matrixWorld.clone();
const originalWorld = [];
for (let i = 0; i < originalLocal.length; i += 3) {
  originalWorld.push(new THREE.Vector3(originalLocal[i], originalLocal[i + 1], originalLocal[i + 2]).applyMatrix4(originalMatrix));
}
assert.equal(terrain.registerMesh(road), true, 'Road mesh can register');
assert.equal(terrain.registerMesh(road), false, 'A mesh only registers once');
assert.notEqual(road.geometry, roadGeometry, 'Registration does not mutate shared source primitives');
const center = new THREE.Vector3().applyMatrix4(originalMatrix);
terrain.sculpt(center.x, center.z, 1.2, 5);
let roadMoved = 0;
for (let i = 0; i < originalWorld.length; i++) {
  const array = road.geometry.attributes.position.array;
  const after = new THREE.Vector3(array[i * 3], array[i * 3 + 1], array[i * 3 + 2]).applyMatrix4(originalMatrix);
  const before = originalWorld[i];
  near(after.x, before.x, 1e-6, 'Tilted road deformation preserves world X');
  near(after.z, before.z, 1e-6, 'Tilted road deformation preserves world Z');
  near(after.y - before.y, terrain.heightAt(before.x, before.z), 1e-6, 'Tilted road moves by the terrain height offset');
  if (after.y > before.y + 0.05) roadMoved++;
}
assert.ok(roadMoved > 10, 'Registered roadway physically deforms');
finite(road.geometry.attributes.normal.array, 'Deformed road normals');
exact(roadGeometry.attributes.position.array, originalLocal, 'Shared original geometry stays pristine');

// Updates are mutation-driven, with remote edits leaving unaffected road buffers alone.
const roadVersion = road.geometry.attributes.position.version;
terrain.impact(-35, 20, 1, 3);
assert.equal(road.geometry.attributes.position.version, roadVersion, 'Remote impacts do not upload unrelated road geometry');
terrain.reset();
exact(terrain.mesh.geometry.attributes.position.array, pristinePositions, 'Terrain reset positions');
exact(terrain.mesh.geometry.attributes.color.array, pristineColors, 'Terrain reset colors');
exact(terrain.mesh.geometry.attributes.normal.array, pristineNormals, 'Terrain reset normals');
exact(road.geometry.attributes.position.array, originalLocal, 'Road reset positions');
assert.equal(terrain.stats.damagedSamples, 0, 'Reset clears scars');
assert.equal(terrain.stats.registeredMeshes, 1, 'Reset preserves mesh registration');
finite(terrain.mesh.geometry.attributes.normal.array, 'Restored terrain normals');

console.log('Terrain checks passed: clipped island, crater and rim, grip, sculpt, repair, rotated roadway deformation, and exact reset.');
