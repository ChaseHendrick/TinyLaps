import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RaceSimulation, CAR_LENGTH, CAR_WIDTH, PHYSICS_STEP } from '../race.js';
import { TRACKS } from '../tracks.js';

const mod = (x,n) => ((x%n)+n)%n;

import { buildTrack } from '../track.js';

// Independent polygon SAT check against the physical heading, rather than the
// track tangent. A small solver slop is allowed at the instant of a contact.
function corners(car) {
  const sx=Math.sin(car.heading),cz=Math.cos(car.heading);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([side,fore])=>({
    x:car.x+cz*side*CAR_WIDTH*.5+sx*fore*CAR_LENGTH*.5,
    z:car.z-sx*side*CAR_WIDTH*.5+cz*fore*CAR_LENGTH*.5 }));
}
function penetration(a,b) {
  const polygons=[corners(a),corners(b)];
  let minimum=Infinity;
  for(const polygon of polygons)for(let edge=0;edge<2;edge++){
    const dx=polygon[edge+1].x-polygon[edge].x,dz=polygon[edge+1].z-polygon[edge].z;
    const norm=Math.hypot(dx,dz),nx=-dz/norm,nz=dx/norm;
    const ranges=polygons.map(vertices=>{
      const values=vertices.map(v=>v.x*nx+v.z*nz);
      return [Math.min(...values),Math.max(...values)];
    });
    const depth=Math.min(ranges[0][1],ranges[1][1])-Math.max(ranges[0][0],ranges[1][0]);
    if(depth<=0)return 0;
    minimum=Math.min(minimum,depth);
  }
  return minimum;
}

const reports=[];
for(const [key,cfg] of Object.entries(TRACKS)) {
  const track=buildTrack(cfg);
  const sim=new RaceSimulation(track.length,track.sampleAtDistance);
  let maxPenetration=0,maxLane=0,maxStoppedDuration=0;
  const stopped=Array(10).fill(0),overlapDurations=new Map();
  let longestOverlap=0,gripSaturation=0,brakingSamples=0;
  assert.ok(sim.cars.every(c=>c.progress<=0&&c.speed===0&&c.damage.total===0));
  sim.update(PHYSICS_STEP);
  assert.ok(sim.cars.every(c=>c.speed>0),'drivers launch on the first physical step');
  for(let tick=0;tick<180*60;tick++){
    sim.update(1/60);
    const ranking=[...sim.cars].sort((a,b)=>b.progress-a.progress||a.id-b.id);
    ranking.forEach((car,i)=>assert.equal(car.rank,i+1));
    for(const car of sim.cars){
      for(const field of ['x','y','z','vx','vz','vy','heading','yawRate','speed','progress','distance',
        'lane','currentLapTime','steering','slip'])assert.ok(Number.isFinite(car[field]),`${key}: ${field}`);
      assert.ok(car.mass>0&&car.inertia>0);
      assert.ok(car.distance>=0&&car.distance<track.length);
      assert.ok(car.speed<35&&car.speed>=0);
      assert.ok(car.y>=.17-1e-9);
      assert.ok(Math.abs(car.lane)<4.5,'intact barriers keep drivers near the road');
      assert.ok(car.laps>=0&&car.currentLapTime>=0);
      assert.ok(car.damage.total>=0&&car.damage.total<=1);
      maxLane=Math.max(maxLane,Math.abs(car.lane));
      stopped[car.id]=car.speed<.6?stopped[car.id]+1/60:0;
      if(sim.elapsed>5)maxStoppedDuration=Math.max(maxStoppedDuration,stopped[car.id]);
      if(car.brake>.2)brakingSamples++;
      const frontCombined=Math.hypot(car.frontForce,car.frontLongitudinalForce);
      const rearCombined=Math.hypot(car.rearForce,car.rearLongitudinalForce);
      assert.ok(frontCombined<=car.tireLimitFront+1e-6,'front tire force obeys friction circle');
      assert.ok(rearCombined<=car.tireLimitRear+1e-6,'rear tire force obeys friction circle');
      if(frontCombined>car.tireLimitFront*.97||rearCombined>car.tireLimitRear*.97)gripSaturation++;
    }
    for(let i=0;i<10;i++)for(let j=i+1;j<10;j++){
      const depth=penetration(sim.cars[i],sim.cars[j]);
      maxPenetration=Math.max(maxPenetration,depth);
      const pair=`${i}:${j}`;
      const duration=depth>.035?(overlapDurations.get(pair)||0)+1/60:0;
      overlapDurations.set(pair,duration);
      longestOverlap=Math.max(longestOverlap,duration);
    }
  }
  assert.ok(sim.cars.every(c=>c.laps>=3&&c.bestLap>0),'every autonomous driver completes timed laps');
  assert.ok(sim.cars.reduce((sum,c)=>sum+c.overtakes,0)>=10,'drivers make competitive passes');
  assert.ok(maxStoppedDuration<12,'drivers recover instead of grinding a wall indefinitely');
  assert.ok(longestOverlap<.2,'contact bodies separate promptly');
  assert.ok(maxPenetration<.18,'collision correction limits body penetration');
  assert.ok(brakingSamples>0&&gripSaturation>0,'braking and grip limits are exercised');
  const maxCurvature=Math.max(...track.samples.map(p=>Math.abs(p.curvature)));
  let nearestNonadjacent=Infinity;
  for(let i=0;i<1800;i+=3)for(let j=i+3;j<1800;j+=3){
    const arc=Math.min(j-i,1800-(j-i))/1800*track.length;
    if(arc>15)nearestNonadjacent=Math.min(nearestNonadjacent,
      Math.hypot(track.samples[i].x-track.samples[j].x,track.samples[i].z-track.samples[j].z));
  }
  assert.ok(nearestNonadjacent>=7,'roads do not nearly intersect');
  reports.push({track:cfg.name,seconds:180,laps:sim.cars.map(c=>c.laps),
    overtakes:sim.cars.reduce((sum,c)=>sum+c.overtakes,0),
    impacts:sim.cars.reduce((sum,c)=>sum+c.impacts,0),
    maxPenetration:+maxPenetration.toFixed(4),longestOverlap:+longestOverlap.toFixed(3),
    maxStoppedDuration:+maxStoppedDuration.toFixed(2),maxLane:+maxLane.toFixed(2),
    minimumCurveRadius:+(1/maxCurvature).toFixed(3),
    nearestNonadjacent:+nearestNonadjacent.toFixed(3)});
}

const radius=45,length=radius*Math.PI*2;
const sample=distance=>{
  const a=mod(distance,length)/radius;
  return {x:radius*Math.cos(a),y:.17,z:radius*Math.sin(a),tx:-Math.sin(a),tz:Math.cos(a),curvature:1/radius};
};
const fresh=env=>new RaceSimulation(length,sample,env);

// A head-on vehicle impulse transfers momentum, reduces kinetic energy, and
// damages the correct parts. Reset and repair clear all accumulated damage.
{
  const sim=fresh(),a=sim.cars[0],b=sim.cars[1];
  Object.assign(a,{x:0,z:0,heading:0,vx:0,vz:10,yawRate:0});
  Object.assign(b,{x:0,z:1.9,heading:0,vx:0,vz:0,yawRate:0});
  const momentum=a.mass*a.vz+b.mass*b.vz,energy=.5*a.mass*a.vz**2;
  assert.equal(sim._collision(a,b),true);
  assert.ok(a.vz<10&&b.vz>0,'contact changes both physical velocities');
  assert.ok(Math.abs(a.mass*a.vz+b.mass*b.vz-momentum)<1e-7,'linear momentum is conserved');
  assert.ok(.5*a.mass*a.vz**2+.5*b.mass*b.vz**2<energy,'inelastic collision dissipates energy');
  assert.ok(a.damage.front>0&&b.damage.rear>0);
  assert.ok(a.damage.total>0&&a.impacts===1&&sim.events[0].type==='collision');
  sim.repairCar(0);assert.equal(a.damage.total,0);assert.equal(a.impacts,0);
  sim.reset();assert.ok(sim.cars.every(c=>c.damage.total===0&&c.impacts===0));assert.equal(sim.events.length,0);
}

// Braking, surface friction, combined tire limits, and damage alter the force
// response even with the autonomous controller bypassed for the measurement.
{
  const sim=fresh(),road=sim.cars[0],grass=sim.cars[1],damaged=sim.cars[2];
  for(const car of [road,grass,damaged])Object.assign(car,{heading:0,vx:0,vz:12,lane:0,
    throttle:0,brake:1,steering:.25,longitudinalAcceleration:0});
  grass.lane=3.2;
  damaged.damage.suspension=.8;
  sim._integrate(road,PHYSICS_STEP);sim._integrate(grass,PHYSICS_STEP);sim._integrate(damaged,PHYSICS_STEP);
  assert.ok(road.vz<12,'braking reduces forward velocity');
  assert.ok(grass.grip<road.grip&&grass.vz>road.vz,'grass gives less braking traction');
  assert.ok(damaged.grip<road.grip,'suspension damage reduces grip');
  assert.ok(road.frontLoad+road.rearLoad>0&&road.frontLoad!==road.rearLoad);
  const staticFrontLoad=road.frontLoad;
  for(let i=0;i<30;i++)sim._integrate(road,PHYSICS_STEP);
  assert.ok(road.frontLoad>staticFrontLoad,'braking transfers normal load to the front axle');
  const normal=fresh(),weak=fresh();weak.cars[0].damage.engine=.8;
  for(const s of [normal,weak]){const car=s.cars[0];Object.assign(car,{heading:0,throttle:1,brake:0,steering:0,lane:0});s._integrate(car,PHYSICS_STEP);}
  assert.ok(weak.cars[0].vz<normal.cars[0].vz,'engine damage reduces acceleration');
}

// World position is integrated, never replaced by the racing spline.
{
  const sim=fresh(),car=sim.cars[0];sim.cars=[car];
  const before={x:car.x+.8,z:car.z};car.x=before.x;
  sim._updateProgress(car,PHYSICS_STEP,0);
  assert.equal(car.x,before.x);assert.equal(car.z,before.z);
  const vx=car.vx;sim.applyImpulse(0,{x:car.mass*3,z:0});assert.equal(car.vx-vx,3);
  car.held=true;const held={x:car.x,z:car.z};sim.update(.5);
  assert.equal(car.x,held.x);assert.equal(car.z,held.z);car.held=false;
  sim.teleportCar(0,sample(20).x,sample(20).z);assert.equal(car.speed,0);
  assert.ok(Math.abs(car.lane)<.02);
  const config=sim.configurePhysics({gravity:999,grip:-1,restitution:999,damageScale:0,enginePower:1.3});
  assert.equal(config.gravity,25);assert.equal(config.grip,.15);assert.equal(config.restitution,.85);
  assert.equal(config.damageScale,0);assert.equal(config.enginePower,1.3);
}

// Environment contacts use the same impulse mechanics and delegate health to
// the scene owner. Removed props and broken barriers stop blocking the car.
{
  const obstacle={id:'tree-test',x:0,z:1.8,radius:.35,health:1,mass:1200,solid:true};
  let impacts=0,scars=0;
  const sim=fresh({colliders:[obstacle],impact:(prop,event)=>{impacts++;prop.health=0;prop.solid=false;assert.equal(event.colliderId,'tree-test');},
    damageTerrain:()=>scars++,sampleSurface:(x,z,base)=>({height:base+x*.04,grip:.72,roughness:.3})});
  const car=sim.cars[0];Object.assign(car,{x:0,z:.55,heading:0,vx:0,vz:10,yawRate:0});
  sim._environmentContacts(car);
  assert.ok(car.vz<10&&impacts===1&&scars===1&&car.damage.front>0);
  assert.equal(sim.events[0].type,'environment');
  const velocity=car.vz;sim._environmentContacts(car);assert.equal(car.vz,velocity);
  sim.teleportCar(0,sample(12).x,sample(12).z);sim._updateProgress(car,PHYSICS_STEP,0);
  assert.ok(Math.abs(car.y-(sample(car.distance).y+car.x*.04))<.02,'terrain modifies vehicle ground height');
  car.throttle=1;car.brake=0;sim._integrate(car,PHYSICS_STEP);
  assert.ok(car.grip<1.12,'deformed surface grip affects tire forces');
  Object.assign(car,{x:0,z:0,heading:0,vx:0,vz:0,yawRate:0,lane:0,throttle:0,brake:0,steering:0});
  sim._integrate(car,PHYSICS_STEP);
  assert.ok(car.vx<0,'the slope of altered terrain applies a downhill force');
  const barrier={id:'rail-test',health:0,solid:false};
  const broken=fresh({barrierAt:()=>barrier}),c=broken.cars[0];
  const p=sample(20);Object.assign(c,{x:p.x-p.tz*5,z:p.z+p.tx*5,distance:20,lane:5});
  const before={x:c.x,z:c.z};broken._barrier(c);assert.equal(c.x,before.x);assert.equal(c.z,before.z);
  barrier.health=1;barrier.solid=true;let railHit=false;
  broken.environment.impact=(cell,event)=>{railHit=true;cell.health=0;cell.solid=false;assert.equal(event.type,'barrier');};
  Object.assign(c,{x:p.x-p.tz*3.8,z:p.z+p.tx*3.8,vx:-p.tz*4,vz:p.tx*4,heading:Math.atan2(p.tx,p.tz)});
  broken._barrier(c);
  assert.ok(railHit&&barrier.health===0&&c.damage.total>0,'physical rail impacts damage destructible barrier cells');
}

// Recover from a sideways departure by steering and throttle, without a reset.
{
  const sim=fresh(),car=sim.cars[0];sim.cars=[car];
  const p=sample(24);sim.teleportCar(0,p.x-p.tz*2.7,p.z+p.tx*2.7,Math.atan2(p.tx,p.tz)+1.2);
  sim.applyImpulse(0,{x:p.tx*car.mass*2,z:p.tz*car.mass*2});
  const progress=car.progress;sim.update(20);
  assert.ok(Math.abs(car.lane)<2.3&&car.progress>progress+20&&car.speed>2,'AI drives a disturbed car back into the race');
}

// A vertical launch is ballistic, has no tire forces in flight, clears other
// cars vertically, and lands back onto the actual terrain height.
{
  const sim=fresh(),car=sim.cars[0];sim.cars=[car];
  sim.applyImpulse(0,{x:0,z:0,y:car.mass*7});
  sim.update(.4);
  assert.ok(car.airborne&&car.y>1.5&&car.vy<7&&car.vy>0);
  assert.equal(car.frontForce,0);assert.equal(car.rearForce,0);
  const other={...car,y:car.y-1.5};assert.equal(sim._collision(car,other),false);
  sim.update(2);
  assert.equal(car.airborne,false);assert.equal(car.vy,0);
  assert.ok(Math.abs(car.y-car.groundHeight)<1e-8&&car.damage.suspension>0);
}

// Fixed-step outcomes match across frame rates, and reversing the start line
// cannot generate a lap. Aggression controls actually alter driver settings.
{
  const one=fresh(),many=fresh();one.update(2);for(let i=0;i<120;i++)many.update(1/60);
  one.cars.forEach((car,i)=>assert.ok(Math.hypot(car.x-many.cars[i].x,car.z-many.cars[i].z)<1e-8));
  const sim=fresh(),car=sim.cars[0];sim.cars=[car];
  const p=sample(1);Object.assign(car,{x:p.x,z:p.z,distance:1,progress:1,nextLapLine:length,
    laps:0,lapStartedAt:0,vx:-p.tx*2,vz:-p.tz*2});
  const back=sample(length-1);car.x=back.x;car.z=back.z;sim._updateProgress(car,PHYSICS_STEP,0);
  assert.equal(car.laps,0);assert.ok(car.progress<0);
  sim.setAggression(.55);const cautious=car.aggression;sim.setAggression(1);assert.ok(car.aggression>cautious);
}

console.log(JSON.stringify({ok:true,physics:'120 Hz force-based bicycle model with impulse contacts',
  checks:[`${Object.keys(TRACKS).length} 180-second autonomous races`,'finite rigid body state','rank and forward lap accounting',
    'friction circles','braking and weight loads','damage penalties','momentum and impact damage',
    'prompt contact separation','driver recovery','destructible environment and terrain grip',
    'held cars and impulses','ballistic vertical launches and landing','repair/reset','physics config bounds','frame-rate consistency'],circuits:reports},null,2));
