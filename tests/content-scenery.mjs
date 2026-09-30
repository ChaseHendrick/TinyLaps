import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { TRACKS } from '../tracks.js';
import { CAR_PROFILES } from '../race.js';
import { buildTrack } from '../track.js';
import { createContentCatalog } from '../content/index.js';
import { buildScenery } from '../scenery.js';
import { createPedestrians } from '../pedestrians.js';

const starter=JSON.parse(fs.readFileSync(new URL('../content/packs/starter-kit.json',import.meta.url),'utf8'));
const catalog=createContentCatalog(TRACKS,CAR_PROFILES,[starter]);
const terrain={heightAt:()=>0};
function fixture(config) {
  const group=new THREE.Group(),track=buildTrack(config);
  const scenery=buildScenery({group,theme:config.setting,river:!!config.river,samples:track.samples.filter((_,i)=>i%6===0),seed:config.seed,city:config.city,authoredProps:config.props});
  scenery.setGroundSampler(terrain.heightAt);
  return {group,track,scenery};
}
function geometrySnapshot(group) {
  const result=[];group.traverse(object=>{if(!object.isMesh||object.isInstancedMesh)return;result.push({object,positions:object.geometry.attributes.position.array.slice()});});return result;
}
function finiteScene(group) {
  let draws=0;
  group.traverse(object=>{if(!object.isMesh)return;draws++;for(const attribute of Object.values(object.geometry.attributes))assert(attribute.array.every(Number.isFinite),'Authored scene geometry is finite');if(object.isInstancedMesh)assert(object.instanceMatrix.array.every(Number.isFinite),'Authored scene instances are finite');});
  assert(draws<150,'Custom content preserves batched scenery draw budget');
}
function assertPristine(snapshot) {
  for(const {object,positions} of snapshot){const actual=object.geometry.attributes.position.array;assert.equal(actual.length,positions.length);for(let i=0;i<positions.length;i++)assert(Math.abs(actual[i]-positions[i])<1e-5,'Reset exactly repairs authored and procedural vertices');}
}
function pickAt(group,scenery,collider) {
  group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(collider.x,collider.y+collider.height+3,collider.z),new THREE.Vector3(0,-1,0));
  return ray.intersectObject(group,true).map(hit=>scenery.pickProp(hit)).find(hit=>hit?.id===collider.id);
}
const authoredId=placement=>`content/${placement.prop}/${placement.id||`${placement.x}:${placement.z}`}`;
function assertReserved(world,authored){world.group.traverse(mesh=>{if(!mesh.isMesh||mesh.isInstancedMesh)return;const positions=mesh.geometry.attributes.position;for(let index=0;index<positions.count;index++){const x=positions.getX(index),y=positions.getY(index),z=positions.getZ(index);for(const c of authored){if(y<=.15||y>c.height+.05||Math.hypot(x-c.x,z-c.z)>=c.radius-.03)continue;const owner=world.scenery.pickProp({object:mesh,face:{a:index}});assert.equal(owner?.id,c.id,'Procedural buildings, plants, rocks and decor leave authored volume clear');}}});}
for(const mapId of catalog.packs[0].mapIds) {
  const config=catalog.maps[mapId],world=fixture(config),{group,scenery}=world;
  const pristine=geometrySnapshot(group),authored=config.props.map(p=>scenery.colliders.find(c=>c.id===authoredId(p)));
  assert.equal(authored.length,config.props.length);
  assert.equal(new Set(scenery.colliders.map(c=>c.id)).size,scenery.colliders.length,'Every authored and generated collider ID is unique');
  for(let i=0;i<authored.length;i++) {
    const c=authored[i],p=config.props[i];assert(c,'Compiled placement has a physical collider');
    assert.equal(c.contentId,p.prop);assert.equal(c.name,p.definition.name);assert.equal(c.kind,p.definition.kind);
    assert.equal(c.mass,p.definition.collider.mass);assert.equal(c.height,p.definition.collider.height);assert.equal(c.radius,p.definition.collider.radius);
    assert.equal(pickAt(group,scenery,c),c,'Real mesh raycast resolves authored batch ranges for grabbing');
    for(const procedural of scenery.colliders.filter(c=>!c.contentId))assert(Math.hypot(c.x-procedural.x,c.z-procedural.z)>c.radius+procedural.radius,'Generated colliders respect every authored footprint');
  }
  // Broad collision footprints also reserve positive-height decorative pieces.
  assertReserved(world,authored);
  finiteScene(group);
  const crowd=createPedestrians({group,scenery,terrain,seed:config.seed});
  if(config.city)assert.equal(crowd.stats.population,config.city.residents,'Authored city population is honored');
  assert(!scenery.isWalkable(authored[0].x,authored[0].z),'A grounded authored collider excludes foot traffic');
  const c=authored[0],original={x:c.x,y:c.y,z:c.z};
  assert(scenery.liftProp(c.id,5));assert.equal(c.held,true);assert.equal(c.y,5);
  assert(scenery.moveProp(c.id,c.x+.5,c.z+.3,5));assert.equal(c.x,original.x+.5);
  assert.equal(pickAt(group,scenery,c),c,'Batched authored mesh picking follows its lifted transform');
  assert(scenery.releaseProp(c.id,{x:.25,y:0,z:.1}));assert.equal(c.held,false);
  for(let i=0;i<20;i++)scenery.update((i+1)/60,1/60);
  assert(c.y<5 && c.y>0,'Released authored body falls under scenery gravity');
  const impact=scenery.applyImpact(c.id,{energy:c.mass*.25,severity:.4,vx:4,vz:1});
  assert(impact && c.health<1 && c.health>0,'Custom body damage uses authored mass');
  scenery.update(1,0);const save=scenery.exportState();
  assert(save.props.some(p=>p.id===c.id),'Stable authored collider ID is persisted');
  const copy=fixture({...config,props:[...config.props].reverse()});assert(copy.scenery.restoreState(save),'Authored state resolves stable IDs even if placement array order changes');
  const restored=copy.scenery.colliders.find(p=>p.id===c.id);
  for(const key of ['x','y','z','health'])assert.equal(restored[key],c[key],`Authored ${key} restores`);
  assert.equal(restored.kind,c.kind);assert.equal(restored.mass,c.mass);assert.equal(restored.held,false,'Restored grab never remains held');
  assert.equal(copy.scenery.debrisCount,scenery.debrisCount,'Authored impact debris restores');finiteScene(copy.group);
  scenery.reset();assert.deepEqual({x:c.x,y:c.y,z:c.z},original);assert.equal(c.health,1);assert.equal(c.solid,true);assert.equal(scenery.debrisCount,0);assertPristine(pristine);
  const destroyed=scenery.applyImpact(c.id,{energy:c.mass*10,severity:1,impulse:c.mass*4,vx:5,vz:0});
  assert.equal(destroyed.destroyed,true);assert.equal(c.solid,false);assert(scenery.debrisCount>0,'Authored body releases physical debris');
  scenery.update(2,.1);finiteScene(group);scenery.reset();assertPristine(pristine);
}

// Install props at former forest and stone positions, so noncity scatter must
// honor authored footprints instead of relying on the starter's central village.
const baseMap=catalog.maps['starter-kit/workshop-orchard'];
const bare=fixture({...baseMap,props:[]});
const scatter=structuredClone(starter);scatter.maps=scatter.maps.slice(0,1);scatter.maps[0].props=[];
for(const c of bare.scenery.colliders.filter(c=>c.kind==='tree'||c.kind==='rock')){if(scatter.maps[0].props.length>=16)break;if(scatter.maps[0].props.some(p=>Math.hypot(c.x-p.x,c.z-p.z)<2))continue;scatter.maps[0].props.push({id:`reserved-${scatter.maps[0].props.length}`,prop:'starter-kit/garden-marker',x:c.x,z:c.z});}
assert.equal(scatter.maps[0].props.length,16);
const scatterMap=createContentCatalog(TRACKS,CAR_PROFILES,[scatter]).maps['starter-kit/workshop-orchard'];
const reserved=fixture(scatterMap),reservedColliders=reserved.scenery.colliders.filter(c=>c.contentId);
assertReserved(reserved,reservedColliders);finiteScene(reserved.group);

// A map may explicitly request a quiet city without creating fallback families.
const zero={...catalog.maps['starter-kit/workshop-quarter'],city:{...catalog.maps['starter-kit/workshop-quarter'].city,residents:0}};
const quiet=fixture(zero),empty=createPedestrians({group:quiet.group,scenery:quiet.scenery,terrain,seed:0});
assert.equal(quiet.scenery.residentCount,0);assert.equal(empty.stats.population,0);
empty.update(.1,[],9.81);empty.react(0,0);empty.blast(0,0,10);empty.reset();assert(empty.restoreState(empty.exportState()));finiteScene(quiet.group);

// Generic parts are destructibles, without being silently promoted to homes.
const generic=structuredClone(starter);generic.id='generic-kit';generic.maps=generic.maps.slice(0,1);generic.maps[0].cars=undefined;delete generic.maps[0].cars;
generic.props[0].kind='custom';generic.maps[0].props=generic.maps[0].props.map(p=>({...p,prop:p.prop.replace('starter-kit/','generic-kit/')}));
const genericCatalog=createContentCatalog(TRACKS,CAR_PROFILES,[generic]);
const genericWorld=fixture(genericCatalog.maps['generic-kit/workshop-orchard']);
const object=genericWorld.scenery.colliders.find(c=>c.contentId==='generic-kit/workshop-pavilion');
assert.equal(object.kind,'custom');assert(!genericWorld.scenery.pedestrianHomes.some(home=>home.x===object.x&&home.z===object.z),'Generic destructibles do not become family homes');
assert(genericWorld.scenery.applyImpact(object.id,{energy:object.mass*10,severity:1}).destroyed,'Generic destructibles participate in impact and collapse');
genericWorld.scenery.update(1,.1);finiteScene(genericWorld.group);
console.log('Authored scenery checks passed: compiled starter batching/picking, collision reservations, grabbing and gravity, impact/debris, stable save/restore/reset, generic destructibles, and zero-resident cities.');
