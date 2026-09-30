import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACKS } from '../tracks.js';
import { buildTrack } from '../track.js';
import { buildScenery } from '../scenery.js';
import { RaceSimulation } from '../race.js';
import { CityTraffic } from '../city.js';

// Curb cars have room beside a racer. A car in its lane or turned across it
// still blocks the driver, using the real oriented vehicle footprint.
{
  const track=buildTrack(TRACKS.foundry),locals=[];
  const sim=new RaceSimulation(track.length,track.sampleAtDistance,{vehicles:()=>locals});
  const racer=sim.cars[0],p=track.sampleAtDistance(0),ahead=track.sampleAtDistance(3);
  sim.cars=[racer];Object.assign(racer,{distance:0,lane:1.55,targetLane:1.55,
    x:p.x-p.tz*1.55,z:p.z+p.tx*1.55});
  const local={id:10,x:0,z:0,heading:Math.atan2(ahead.tx,ahead.tz),vx:0,vz:0};locals.push(local);
  const sense=lane=>{local.x=ahead.x-ahead.tz*lane;local.z=ahead.z+ahead.tx*lane;sim._senseTrafficAt=0;sim._senseTraffic();};
  sense(2.85);assert.equal(sim._front(racer).car,null);assert(sim._clearLane(racer,1.55));
  sense(1.6);assert.equal(sim._front(racer).car?.id,10);assert(!sim._clearLane(racer,1.55));
  local.heading+=Math.PI/2;sense(2.65);assert.equal(sim._front(racer).car?.id,10);assert(!sim._clearLane(racer,1.55));
}

for(const cfg of Object.values(TRACKS).filter(c=>c.city)){
  const track=buildTrack(cfg),scenery=buildScenery({group:new THREE.Group(),theme:cfg.setting,city:cfg.city,seed:cfg.seed,samples:track.samples.filter((_,i)=>i%6===0)}),plan=scenery.cityPlan;
  // Every point follows an existing road, including the actual rounded turns.
  assert(track.samples.every(p=>plan.distanceToRoad(p.x,p.z)<plan.width*.5-.9),cfg.name+' route follows streets');
  const innerEdges=new Set();
  for(const p of track.samples){if(Math.abs(p.x)<30&&Math.abs(p.z)<21){const e=plan.edges.reduce((best,e)=>{const a=plan.nodes[e.a],b=plan.nodes[e.b],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz))),d=Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);return d<best.d?{id:e.id,d}:best;},{d:Infinity});innerEdges.add(e.id);}}
  assert(innerEdges.size>=8,cfg.name+' winds through distinct interior streets');
  let traffic;
  const sim=new RaceSimulation(track.length,track.sampleAtDistance,{colliders:scenery.colliders,barrierAt:()=>({solid:false}),vehicles:()=>traffic?.cars||[],routeRevision:cfg.routeRevision,speedLimit:12,cornerSafety:.82});
  traffic=new CityTraffic({plan,count:cfg.city.traffic,seed:cfg.seed,obstacles:()=>scenery.colliders});
  const interior=Array(10).fill(0),onRoad=Array(10).fill(0),stopped=Array(10).fill(0),maxStopped=Array(10).fill(0);let samples=0;
  for(let i=0;i<180*30;i++){
    sim.update(1/30);traffic.update(1/30,sim.cars,sim.physics.gravity);if(i%3!==0)continue;samples++;
    for(const c of sim.cars){
      assert([c.x,c.y,c.z,c.speed,c.progress,c.heading].every(Number.isFinite));
      if(Math.abs(c.x)<30&&Math.abs(c.z)<21)interior[c.id]++;
      if(plan.distanceToRoad(c.x,c.z)<plan.width*.5+.25)onRoad[c.id]++;
      stopped[c.id]=c.speed<.6?stopped[c.id]+.1:0;maxStopped[c.id]=Math.max(maxStopped[c.id],stopped[c.id]);
    }
  }
  const report={city:cfg.name,laps:sim.cars.map(c=>c.laps),interior:interior.map(v=>+(v/samples).toFixed(3)),onRoad:onRoad.map(v=>+(v/samples).toFixed(3)),maxStopped:maxStopped.map(v=>+v.toFixed(2)),innerEdges:innerEdges.size};
  console.log(JSON.stringify(report));
  assert(sim.cars.every(c=>c.laps>=2),cfg.name+' every racer completes the city route with real buildings');
  assert(interior.every(v=>v/samples>.2),cfg.name+' every racer drives through the interior');
  assert(onRoad.every(v=>v/samples>.94),cfg.name+' autonomous racers use the streets');
  assert(maxStopped.every(v=>v<12),cfg.name+' drivers do not remain blocked by buildings');
}
