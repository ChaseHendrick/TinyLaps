import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RaceSimulation } from '../race.js';
import { TerrainSystem } from '../terrain.js';
import { buildScenery } from '../scenery.js';
import { SAVE_KEY, readRace, writeRace, restoreRace } from '../persistence.js';

const length = 200;
const sample = distance => { const angle = distance / length * Math.PI * 2; return {x:30*Math.sin(angle),y:0,z:30*Math.cos(angle),tx:Math.cos(angle),tz:-Math.sin(angle),curvature:1/30}; };
const samples = Array.from({length:300},(_,i)=>sample(i/300*length));
function world() {
  const group = new THREE.Group();
  return {sim:new RaceSimulation(length,sample),terrain:new TerrainSystem({group}),scenery:buildScenery({group,samples,theme:'harbor'}),barriers:[{health:1}],view:{theme:'harbor',mode:'follow',selected:4,paused:true,speed:2}};
}
const original = world();
original.sim.update(4);
original.sim.cars[4].damage.engine = .42;
original.sim.cars[4].laps = 3;
original.sim.cars[4].bestLap = 12.35;
original.sim.cars[4].held = true;
original.sim.configurePhysics({gravity:4,grip:.8});
original.terrain.sculpt(0,0,1.2,6);
const prop = original.scenery.colliders[0];
original.scenery.applyImpact(prop.id,{energy:500,severity:.8,x:prop.x-1,z:prop.z});
original.scenery.update(1,1);
original.barriers[0].health = .37;
const records = new Map();
const storage = {getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
writeRace(storage,original);
const save = readRace(storage,{harbor:{}});
const restored = world();
assert.equal(restoreRace(save,restored),true);
for (const key of ['x','y','z','progress','distance','laps','bestLap','currentLapTime']) assert.equal(restored.sim.cars[4][key],original.sim.cars[4][key],key);
assert.equal(restored.sim.cars[4].damage.engine,.42);
assert.equal(restored.sim.cars[4].held,false,'A pointer grab cannot remain stuck after reopening');
assert.equal(restored.sim.elapsed,original.sim.elapsed);
assert.deepEqual(restored.sim.physics,original.sim.physics);
assert.deepEqual(restored.terrain.exportState(),original.terrain.exportState());
assert.deepEqual(restored.scenery.exportState().props,original.scenery.exportState().props);
assert.equal(restored.scenery.debrisCount,original.scenery.debrisCount);
assert.equal(restored.barriers[0].health,.37);
assert.deepEqual(save.view,original.view);
assert.ok(records.get(SAVE_KEY).length<200000,'Sparse terrain keeps saves small');
records.set(SAVE_KEY,'broken');assert.throws(()=>readRace(storage,{harbor:{}}));
records.set(SAVE_KEY,JSON.stringify({...save,view:{theme:'__proto__'}}));assert.throws(()=>readRace(storage,{harbor:{}}));
records.set(SAVE_KEY,JSON.stringify({...save,version:99}));assert.throws(()=>readRace(storage,{harbor:{}}));
const bad = structuredClone(save);bad.cars[0].x=Infinity;assert.equal(restoreRace(bad,world()),false);
assert.equal(restored.terrain.restoreState({columns:160,rows:120,cells:[[999999,0,0]]}),false);
assert.throws(()=>writeRace({setItem(){throw new Error('Quota exceeded')}},original),/Quota/);
console.log('Save checks passed: race position and laps, damage, physics, terrain, scenery, debris, barriers, view settings, malformed data, and unavailable storage.');

// A city route revision cannot restore cars onto the retired outer circuit.
const revised=world();revised.sim.environment.routeRevision=2;
const newGrid=revised.sim.cars.map(c=>({x:c.x,z:c.z,progress:c.progress}));
assert(restoreRace({...save,routeRevision:1},revised));
assert(revised.sim.migratedRoute);
assert.equal(revised.sim.elapsed,0);
assert.deepEqual(revised.sim.cars.map(c=>({x:c.x,z:c.z,progress:c.progress})),newGrid);
assert.equal(revised.sim.cars[4].damage.engine,.42);
assert.deepEqual(revised.terrain.exportState(),original.terrain.exportState());
assert.deepEqual(revised.scenery.exportState().props,original.scenery.exportState().props);
const revisedSave={...save,routeRevision:2};
assert(restoreRace(revisedSave,revised));
assert(!revised.sim.migratedRoute);
assert.equal(revised.sim.cars[4].progress,save.cars[4].progress);
console.log('Route migration preserves the world and damage without restoring racers outside the new city streets.');

// A save from before lap integrity has no route peak, cut, or placement
// fields. The racers resume from their restored progress with nothing voided.
{
  const old=structuredClone(save);
  for (const car of old.cars) for (const key of ['progressPeak','teleportGain','offRoute','offRouteDriven','lapCut','lapCuts']) delete car[key];
  const resumed=world();
  assert(restoreRace(old,resumed));
  const car=resumed.sim.cars[4];
  assert.equal(car.progress,save.cars[4].progress);
  assert.equal(car.lapCuts,0);assert.equal(car.lapCut,false);assert.equal(car.offRoute,false);
  assert.equal(car.progressPeak,null,'the missing peak is measured from the restored progress, not the starting grid');
  resumed.sim.update(1);
  assert(car.progressPeak>=save.cars[4].progress&&car.progressPeak-car.progress<1e-9,'the route peak starts at the restored progress');
  assert.equal(car.lapCuts,0,'resuming an old save is not a cut');
  const fresh=world();assert(restoreRace(save,fresh));
  assert.equal(fresh.sim.cars[4].progressPeak,save.cars[4].progressPeak,'new saves keep the route peak');
  console.log('Saves without lap integrity fields resume from their restored progress.');
}
