import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TownCrowd, createPedestrians } from '../pedestrians.js';
import { buildScenery } from '../scenery.js';
import { throwVelocity } from '../grab.js';
import { TRACKS } from '../tracks.js';

assert.deepEqual(throwVelocity([{x:0,z:0,t:0},{x:5,z:0,t:80}],300),{x:0,z:0,y:0},'Holding still must drop without launching');
assert.deepEqual(throwVelocity([{x:1,z:2,t:20},{x:1,z:2,t:100}],100),{x:0,z:0,y:0});
assert.equal(Math.hypot(...Object.values(throwVelocity([{x:0,z:0,t:0},{x:10,z:0,t:20}],20)).slice(0,2)),35);
assert.deepEqual(throwVelocity([{x:NaN,z:1,t:10}],20),{x:0,z:0,y:0});
const makeCrowd=()=>new TownCrowd({walkable:(x,z)=>Math.abs(x)<44&&Math.abs(z)<34,homes:[{x:0,z:0}],seed:17});
const crowd=makeCrowd();assert.equal(crowd.stats.population,36);assert.equal(crowd.stats.children,9);
for(let i=0;i<600;i++)crowd.update(1/60);
assert(crowd.stats.walking>0,'Town has pedestrians on ordinary daily walks');
const p=crowd.people[0];const before=Math.hypot(p.x,p.z);crowd.react(p.x-.5,p.z-.5,5,'meteor');assert(crowd.stats.panicking>0);
const panicPosition={x:p.x,z:p.z};for(let i=0;i<90;i++)crowd.update(1/60);assert(Math.hypot(p.x-panicPosition.x,p.z-panicPosition.z)>1,'People actually run from disturbance');
for(let i=0;i<600;i++)crowd.update(1/60);assert.equal(crowd.stats.panicking,0,'Panic fades and routines return');
assert.equal(crowd.lift(3,4),false,'Children remain non-graphic background town life');
crowd.lift(0,4);crowd.move(0,0,0,4);const held=crowd.exportState();crowd.update(1/60);assert.equal(p.y,4,'Held person stays attached to pointer');
crowd.release(0,{x:12,z:0,y:1});for(let i=0;i<75;i++)crowd.update(1/60);assert(p.x>4&&p.health<1&&p.recovery>0,'Thrown adult lands with stylized injury and a recovery pose');
for(let i=0;i<600;i++)crowd.update(1/60);assert.equal(p.recovery,0);assert.equal(p.state,'stroll');crowd.react(p.x,p.z,2,'repair');assert.equal(p.health,1);
crowd.blast(0,0,100,2);assert(crowd.people.filter(p=>p.child).every(p=>p.health===1&&!p.airborne),'Children react without injuries');
const restored=makeCrowd();assert(restored.restoreState(held));assert(!restored.people[0].held&&restored.people[0].airborne,'A saved grab resumes as a drop');
const bad=structuredClone(held);bad.people[0].node=.5;restored.restoreState(bad);assert(Number.isFinite(restored.people[0].x));
for(const [key,cfg] of Object.entries(TRACKS)){
  const group=new THREE.Group(),curve=new THREE.CatmullRomCurve3(cfg.points.map(p=>new THREE.Vector3(...p)),true,'centripetal');
  const samples=Array.from({length:300},(_,i)=>{const p=curve.getPointAt(i/300);return{x:p.x,z:p.z};});
  const scenery=buildScenery({group,samples,theme:cfg.setting||key,river:!!cfg.river,seed:cfg.seed||17});
  const people=createPedestrians({group,scenery,terrain:{heightAt:()=>0},seed:cfg.seed||17});assert.equal(people.stats.population,36,`${key}: populated town`);
  for(let i=0;i<120;i++)people.update(1/60,[]);assert(people.crowd.people.every(p=>scenery.isWalkable(p.x,p.z)),`${key}: walkers avoid buildings and roads`);
  group.traverse(m=>{if(m.isInstancedMesh){for(const n of m.instanceMatrix.array)assert(Number.isFinite(n),`${key}: finite bodies`);}});
  if(key==='harbor'){
    const house=scenery.colliders.find(c=>c.kind==='building'),x=house.x,z=house.z;
    scenery.liftProp(house.id,3.5);scenery.moveProp(house.id,x+5,z,3.5);scenery.update(1,0);
    assert.equal(house.x,x+5);assert.equal(house.y,3.5,'Paused pointer still moves a prop');
    const moved=scenery.exportState();assert(moved.props.some(p=>p.id===house.id));
    scenery.releaseProp(house.id,{x:0,z:0,y:0});for(let i=0;i<240;i++)scenery.update(2+i/60,1/60);
    assert(house.health<1&&house.y>=0&&house.y<.1,'Dropped building lands, takes damage, and settles');
    scenery.reset();assert.equal(house.x,x);assert.equal(house.z,z);assert.equal(house.health,1);
    scenery.restoreState(moved);assert.equal(house.x,x+5);assert(!house.held,'Saved building never gets stuck held');
    scenery.reset();const other=scenery.colliders.find(c=>c.kind==='building'&&c!==house);
    scenery.liftProp(house.id,.4);scenery.moveProp(house.id,other.x-house.radius-other.radius-3,other.z,.4);scenery.releaseProp(house.id,{x:20,z:0,y:0});
    for(let i=0;i<45;i++)scenery.update(6+i/60,1/60);
    assert(house.health<1&&other.health<1,'Thrown building damages both structures');assert(scenery.debrisCount>0);
    group.traverse(m=>{if(m.isMesh&&m.geometry.attributes.position)for(const n of m.geometry.attributes.position.array)assert(Number.isFinite(n));});
  }
  const geometries=new Set(),materials=new Set();group.traverse(m=>{if(m.isInstancedMesh)m.dispose();if(m.geometry)geometries.add(m.geometry);for(const mat of Array.isArray(m.material)?m.material:m.material?[m.material]:[])materials.add(mat);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
console.log('World interaction checks passed: all 15 populated circuits, family routines, fleeing, adult drop/throw/recovery, child reactions, finite articulated bodies, building drops/collisions/destruction, and saved positions.');
