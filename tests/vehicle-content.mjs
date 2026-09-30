import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAR_PROFILES, CAR_LENGTH, CAR_WIDTH, RaceSimulation, normalizeCarProfiles, normalizeCarModel } from '../race.js';
import { createCar, updateCarDamage, updateCarEffects } from '../cars.js';
import { CityTraffic, createCityTraffic } from '../city.js';
import { captureRace, restoreRace } from '../persistence.js';

const context = { clearRect(){}, beginPath(){}, arc(){}, fill(){}, stroke(){}, fillText(){}, fillRect(){},
  createRadialGradient(){ return { addColorStop(){} }; } };
globalThis.document = { createElement:() => ({ width:0, height:0, getContext:() => context }) };
const circumference = Math.PI * 60;
const sample = distance => { const t = distance / 30; return {x:30*Math.sin(t), y:0, z:30*Math.cos(t), tx:Math.cos(t), tz:-Math.sin(t), curvature:1/30}; };
const roster = () => CAR_PROFILES.map((profile, i) => ({ ...profile, contentId:`test-kit/driver-${i}`, contentPack:'test-kit',
  mass:500+i*40, model:{body:['roadster','coupe','pickup'][i%3], scale:[.85+i*.03, 1.15-i*.03, .9+i*.02], stripeColor:'#eeeeaa', accentColor:'#bbbbbb'} }));
const sim = () => new RaceSimulation(circumference,sample,{carProfiles:roster(),contentRevision:'test-kit:revision-1'});
const close = (a,b,label) => assert(Math.abs(a-b)<1e-10,label);
const finiteCars = race => { for (const car of race.cars) for (const key of ['x','y','z','vx','vz','yawRate','speed','steering']) assert(Number.isFinite(car[key]),`${car.name} ${key}`); };

// Stock racers retain their profiles, dimensions, mass, and physical baselines.
const stock = new RaceSimulation(circumference,sample);
assert.equal(stock.cars.length,10);
stock.cars.forEach((car,i) => {
  assert.equal(car.profile,CAR_PROFILES[i]);
  assert.equal(car.mass,690+i*5);
  assert.equal(car.length,CAR_LENGTH); assert.equal(car.width,CAR_WIDTH);
  assert.equal(car.wheelbase,1.22); assert.equal(car.frontAxle,.64);
  close(car.rearAxle,.58,'Stock rear axle');
  assert.equal(car.cgHeight,.27); assert.equal(car.corneringFactor,1);
  assert.equal(car.inertia,car.mass*(CAR_LENGTH**2+CAR_WIDTH**2)/12);
});
const builtin = new RaceSimulation(circumference,sample,{carProfiles:CAR_PROFILES.map((p,i)=>({...p,contentId:`builtin/driver-${i}`}))});
assert(builtin.cars.every(car=>car.corneringFactor===1),'Catalog builtin cars preserve legacy cornering');

// One validated definition drives both the complete model scale and contacts.
const race = sim();
race.cars.forEach((car,i) => {
  const p = roster()[i], [sx,sy,sz] = p.model.scale;
  assert.equal(car.contentProfileId,p.contentId);
  assert.equal(car.mass,p.mass);
  close(car.length,CAR_LENGTH*sz,'Scaled length'); close(car.width,CAR_WIDTH*sx,'Scaled width');
  close(car.wheelbase,1.22*sz,'Scaled wheelbase'); close(car.frontAxle,.64*sz,'Scaled front axle');
  close(car.cgHeight,.27*sy,'Scaled center of gravity'); close(car.wheelRadius,.212*sy,'Scaled tire radius');
  close(car.inertia,car.mass*(car.length**2+car.width**2)/12,'Scaled inertia');
  const model = createCar(car.color,i+1,i,car.profile.model);
  assert.deepEqual(model.scale.toArray(),p.model.scale);
  assert.equal(model.userData.model.body,p.model.body);
  assert.equal(model.userData.wheels.length,4);
  assert.equal(model.userData.windshield.visible,true);
  model.updateMatrixWorld(true);
  const envelope = new THREE.Box3().setFromObject(model.userData.body);
  assert(envelope.min.x>=-car.width/2-.02 && envelope.max.x<=car.width/2+.02,'Body fits its collider width');
  assert(envelope.min.z>=-car.length/2-.02 && envelope.max.z<=car.length/2+.02,'Body fits its collider length');
  const baseline = model.userData.damageGeometry.positions.slice();
  updateCarDamage(model,{total:.8,front:.7,rear:.4,left:.2,right:.6});
  updateCarEffects(model,3);
  assert.equal(model.userData.engineSmoke.visible,true);
  assert(model.userData.body.geometry.attributes.position.array.every(Number.isFinite));
  for (const wheel of model.userData.wheels) assert(wheel.userData.mount.position.toArray().every(Number.isFinite));
  updateCarDamage(model,{});
  assert.deepEqual(model.userData.body.geometry.attributes.position.array,baseline,'Custom model repair restores every vertex');
  assert.equal(model.userData.windshield.position.y,model.userData.windshieldBase.y,'Custom screen repair restores its own cabin');
});
const shapes = ['roadster','coupe','pickup'].map(body => createCar('#ee6f68',80,0,{body}));
const roofs = shapes.map(model => {
  const vertices = model.userData.body.geometry.attributes.position.array;
  let count = 0; for(let i=0;i<vertices.length;i+=3) if(Math.abs(vertices[i])>.24 && vertices[i+1]>.77) count++;
  return count;
});
assert.equal(roofs[0],0,'Roadster stays open');
assert(roofs[1]>100 && roofs[2]>100,'Coupe and pickup have real cabin roofs');
assert.notDeepEqual(shapes[1].userData.damageGeometry.positions,shapes[2].userData.damageGeometry.positions,'Silhouettes differ beyond paint');

// Oversize contacts must use authored dimensions instead of stock constants.
const largeRoster = roster().map(p=>({...p,model:{body:'pickup',scale:[1.15,1,1.15]}}));
const contacts = new RaceSimulation(circumference,sample,{carProfiles:largeRoster});
const [a,b] = contacts.cars;
Object.assign(a,{x:0,y:0,z:0,heading:0,vx:0,vz:0});
Object.assign(b,{x:1.18,y:0,z:0,heading:0,vx:0,vz:0});
assert(contacts._collision(a,b,true),'Scaled racers collide outside the stock width');
const obstacle = {id:'post',x:1.00,y:0,z:0,radius:.4,height:2,health:1};
contacts.environment.colliders=[obstacle]; a.x=a.z=0;
contacts._environmentContacts(a);
assert(a.x<0,'Scenery contacts use the wider chassis');
const plan = {width:7,nodes:[{id:0,x:0,z:0,neighbors:[1]},{id:1,x:0,z:30,neighbors:[0]}],edges:[{a:0,b:1,length:30}]};
const traffic = new CityTraffic({plan,count:1});
Object.assign(traffic.cars[0],{x:0,y:0,z:0,heading:0,vx:0,vz:0});
Object.assign(a,{x:1.01,y:0,z:0,heading:0,vx:0,vz:0});
assert(traffic.racerContact(traffic.cars[0],a),'City traffic sees the authored racer width');
const emptyTraffic=createCityTraffic({group:new THREE.Group(),plan:{...plan,blocks:[],config:{traffic:0,seed:0}},terrain:{heightAt:()=>0},scenery:{colliders:[],applyImpact(){}}});
assert.equal(emptyTraffic.cars.length,0,'Authored zero traffic does not spawn fallback cars');
assert.equal(emptyTraffic.model.seed,0,'Authored seed zero is preserved');
emptyTraffic.update(.1,contacts.cars,9.81);emptyTraffic.reset();

// Invalid generation fails at the constructor boundary with actionable errors.
assert.throws(()=>normalizeCarProfiles(roster().slice(1)),/exactly 10/);
for (const bad of [
  {topSpeed:Infinity},{topSpeed:33},{cornering:0},{acceleration:-1},{mass:0},
  {color:'url(evil)'},{model:{body:'tank'}},{model:{scale:[1,1]}},{model:{scale:[1,1,9]}},
  {model:{accentColor:'red'}},{personality:{aggression:2}},
]) { const profiles=roster();Object.assign(profiles[0],bad);assert.throws(()=>new RaceSimulation(circumference,sample,{carProfiles:profiles})); }
const duplicate=roster();duplicate[1].contentId=duplicate[0].contentId;
assert.equal(normalizeCarProfiles(duplicate)[1].contentId,duplicate[0].contentId,'Multiple racer slots may use one car definition');
assert.throws(()=>normalizeCarModel(null),/object/);
const source=roster(),normalized=normalizeCarProfiles(source);source[0].model.scale[0]=99;
assert.equal(normalized[0].model.scale[0],.85,'Generated source cannot mutate normalized content');
assert(Object.isFrozen(normalized[0].model.scale));

// Mixed presets run both autonomous drivers and manual tire forces.
const starts=race.cars.map(c=>c.progress);
race.setPlayerCar(0);race.setPlayerInput({accelerate:1});race.update(3);finiteCars(race);
assert(race.cars[0].speed>1,'Custom racer accelerates with player input');
assert(race.cars.slice(1).every((c,i)=>c.progress>starts[i+1]+1),'Other custom racers continue autonomously');
race.setPlayerInput({accelerate:1,steer:.4});race.update(1);finiteCars(race);
race.setPlayerCar(null);race.update(6);finiteCars(race);
race.reset();assert.equal(race.playerCarId,null);assert.equal(race.cars[0].contentProfileId,'test-kit/driver-0');

// Save identity and physical definitions stay authored, and stale packs are atomic.
const world = () => ({sim:sim(),terrain:{exportState:()=>({}),restoreState:()=>true},
  scenery:{exportState:()=>({}),restoreState(){}},barriers:[],view:{theme:'test-city'}});
const original=world();original.sim.update(2);original.sim.cars[0].damage.front=.4;
const save=captureRace(original);assert.equal(save.contentRevision,'test-kit:revision-1');
for(const key of ['id','contentProfileId','profile','length','width','mass','inertia','wheelbase','corneringFactor']) assert(!Object.hasOwn(save.cars[0],key),`Save excludes fixed ${key}`);
Object.assign(save.cars[0],{id:900,contentProfileId:'hostile/car',profile:{topSpeed:999},length:999,width:999,mass:1,inertia:0,wheelbase:999});
const restored=world(),defined=restored.sim.cars[0];assert(restoreRace(save,restored));
assert.equal(defined.id,0);assert.equal(defined.contentProfileId,'test-kit/driver-0');
assert.equal(defined.length,CAR_LENGTH*.9);assert.equal(defined.width,CAR_WIDTH*.85);assert.equal(defined.mass,500);
assert.equal(defined.profile.topSpeed,CAR_PROFILES[0].topSpeed);assert.equal(defined.damage.front,.4);
assert.equal(defined.x,original.sim.cars[0].x,'Dynamic state still restores');
let terrainTouched=false,sceneryTouched=false;
const stale=world();stale.sim.environment.contentRevision='test-kit:revision-2';
stale.terrain.restoreState=()=>{terrainTouched=true;return true;};stale.scenery.restoreState=()=>{sceneryTouched=true;};
const before=stale.sim.cars.map(c=>({x:c.x,z:c.z}));
assert.equal(restoreRace(save,stale),false);assert.equal(terrainTouched,false);assert.equal(sceneryTouched,false);
assert.deepEqual(stale.sim.cars.map(c=>({x:c.x,z:c.z})),before);
const legacy=world();delete legacy.sim.environment.contentRevision;
const oldSave=captureRace(legacy);assert(restoreRace(oldSave,legacy),'Legacy/default revision remains compatible');
console.log('Vehicle content checks passed: validated rosters, three silhouettes, scaled tire/vehicle dynamics and contacts, custom AI/player movement, identity-safe saves, and atomic content revision rejection.');
