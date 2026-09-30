import assert from 'node:assert/strict';
import { ChannelFlow,floatForce } from '../water.js';
import { createCityPlan,CityTraffic } from '../city.js';
import { TRACKS } from '../tracks.js';
// Independent rectangular SAT, based on the rendered car body dimensions.
function penetration(a,b){
  const corners=c=>{const width=c.id<10?1.08:.86,length=c.id<10?1.95:1.66,s=Math.sin(c.heading),z=Math.cos(c.heading);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([side,fore])=>({x:c.x+z*side*width/2+s*fore*length/2,z:c.z-s*side*width/2+z*fore*length/2}));};
  const polygons=[corners(a),corners(b)];let depth=Infinity;
  for(const polygon of polygons)for(let i=0;i<2;i++){const dx=polygon[i+1].x-polygon[i].x,dz=polygon[i+1].z-polygon[i].z,n=Math.hypot(dx,dz),nx=-dz/n,nz=dx/n,ranges=polygons.map(p=>{const q=p.map(v=>v.x*nx+v.z*nz);return [Math.min(...q),Math.max(...q)];});const overlap=Math.min(ranges[0][1],ranges[1][1])-Math.max(ranges[0][0],ranges[1][0]);if(overlap<=0)return 0;depth=Math.min(depth,overlap);}
  return depth;
}
const reports=[];
for(const [key,cfg] of Object.entries(TRACKS).filter(([,c])=>c.city)){
  const plan=createCityPlan(cfg.city),visited=new Set([0]),queue=[0];
  while(queue.length)for(const id of plan.nodes[queue.shift()].neighbors)if(!visited.has(id)){visited.add(id);queue.push(id);}
  assert.equal(visited.size,plan.nodes.length);
  const traffic=new CityTraffic({plan,count:cfg.city.traffic}),edges=new Set(),nodes=new Set(),previous=traffic.cars.map(c=>({...c}));
  let maxOverlap=0,maxTurn=0,maxDistance=0,interiorSamples=0,turnSamples=0,maxWait=0;
  for(let tick=0;tick<7200;tick++){
    traffic.update(.05);
    for(let i=0;i<traffic.cars.length;i++){
      const c=traffic.cars[i],old=previous[i];
      assert([c.x,c.y,c.z,c.vx,c.vz,c.heading].every(Number.isFinite));
      edges.add([c.a,c.b].sort((a,b)=>a-b).join(':'));nodes.add(c.a);
      if(plan.nodes[c.a].neighbors.length===4)interiorSamples++;
      if(c.turning)turnSamples++;
      maxDistance=Math.max(maxDistance,plan.distanceToRoad(c.x,c.z));
      maxWait=Math.max(maxWait,c.wait);
      const turn=Math.abs(Math.atan2(Math.sin(c.heading-old.heading),Math.cos(c.heading-old.heading)));
      maxTurn=Math.max(maxTurn,turn);
      assert(turn<.16,`${key}: turn heading changes continuously`);
      assert(Math.hypot(c.x-old.x,c.z-old.z)<.2,`${key}: cars move continuously instead of snapping across intersections`);
      for(let j=i+1;j<traffic.cars.length;j++){const depth=penetration(c,traffic.cars[j]);maxOverlap=Math.max(maxOverlap,depth);assert(depth<1e-8,`${key}: grounded traffic bodies do not overlap`);}
      previous[i]={...c};
    }
  }
  assert.equal(edges.size,plan.edges.length,`${key}: every street is driven`);
  assert.equal(nodes.size,plan.nodes.length,`${key}: every intersection is visited`);
  assert(interiorSamples>traffic.cars.length*7200*.2,`${key}: substantial traffic runs through the city's interior`);
  assert(traffic.cars.every(c=>c.visits>20),`${key}: every car keeps moving through junctions`);
  assert(turnSamples>1000&&maxTurn>.03,`${key}: curved junction paths are exercised`);
  assert(maxDistance<plan.width/2-.6,`${key}: car bodies stay within streets`);
  assert(maxWait<60,`${key}: junction reservations cannot gridlock traffic`);
  const copy=new CityTraffic({plan,count:cfg.city.traffic});
  assert(copy.restoreState(JSON.parse(JSON.stringify(traffic.exportState()))));
  assert.deepEqual(JSON.parse(JSON.stringify(copy.exportState())),JSON.parse(JSON.stringify(traffic.exportState())));
  for(let i=0;i<200;i++){traffic.update(.05);copy.update(.05);}
  assert.deepEqual(JSON.parse(JSON.stringify(copy.exportState())),JSON.parse(JSON.stringify(traffic.exportState())),'save restores route decisions and junction ownership');
  const legacy=JSON.parse(JSON.stringify(traffic.exportState()));for(const c of legacy.cars)for(const field of ['next','turning','turnDistance','junction'])delete c[field];
  const migrated=new CityTraffic({plan,count:cfg.city.traffic});assert(migrated.restoreState(legacy));migrated.update(.05);assert(migrated.cars.every(c=>[c.x,c.y,c.z].every(Number.isFinite)));
  traffic.lift(10,12);traffic.impulse(10,{x:1200,y:300,z:1000});for(let i=0;i<300;i++)traffic.update(.05);assert(!traffic.cars[0].airborne);
  reports.push({city:cfg.name,streets:edges.size,junctions:nodes.size,maxOverlap,maxTurn:+maxTurn.toFixed(3),maximumWait:+maxWait.toFixed(2)});
}
// An actual race/local traffic impact transfers momentum and separates bodies.
{
  const plan=createCityPlan(TRACKS.foundry.city),traffic=new CityTraffic({plan,count:1}),car=traffic.cars[0];
  const racer={id:0,x:car.x+1.7,z:car.z,y:car.y,heading:-Math.PI/2,vx:-10,vz:0,mass:690,speed:10,damage:{total:0,front:0}};
  const momentum=car.mass*car.vx+racer.mass*racer.vx;
  assert(penetration(car,racer)>0);assert(traffic.racerContact(car,racer));
  assert(Math.abs(car.mass*car.vx+racer.mass*racer.vx-momentum)<1e-7);
  assert(penetration(car,racer)<1e-8);assert(car.health<1&&racer.damage.total>0);
  assert(car.vx<0&&racer.vx>-10,'both vehicles respond physically');
  // The normal public update also resolves an embedded stationary racer.
  car.airborne=false;car.recovering=false;traffic.position(car);Object.assign(racer,{x:car.x+1.6,z:car.z,vx:0,vz:0});traffic.update(.01,[racer]);assert(penetration(car,racer)<1e-8);
}
// Autonomous local traffic pulls to the curb before a fast racer passes.
{
  const plan=createCityPlan(TRACKS.foundry.city),traffic=new CityTraffic({plan,count:1}),car=traffic.cars[0];
  car.travel=8;traffic.position(car);
  const racer={id:0,x:car.x-20,z:car.z,y:car.y,heading:Math.PI/2,vx:12,vz:0,mass:690,speed:12,damage:{total:0,front:0}};
  let maximumLane=car.lane;
  for(let i=0;i<100;i++){racer.x+=racer.vx*.05;traffic.update(.05,[racer]);maximumLane=Math.max(maximumLane,car.lane);assert(penetration(car,racer)<1e-8,'an anticipated racer passes without an impact');}
  assert(maximumLane>2.7&&car.health===1&&racer.damage.total===0,'local traffic yields with curb clearance');
  const copy=new CityTraffic({plan,count:1});assert(copy.restoreState(JSON.parse(JSON.stringify(traffic.exportState()))));assert.equal(copy.cars[0].lane,car.lane);assert.equal(copy.cars[0].yieldUntil,car.yieldUntil);
  for(let i=0;i<80;i++)traffic.update(.05,[]);assert(Math.abs(car.lane-traffic.lane)<1e-8,'normal street lane returns after the racer has passed');
}
// Crossing traffic waits outside the junction for an approaching fast racer.
{
  const plan=createCityPlan(TRACKS.foundry.city),traffic=new CityTraffic({plan,count:1}),car=traffic.cars[0],node=plan.nodes[car.b];
  car.travel=traffic.length(car)-6;traffic.position(car);
  const racer={id:0,x:node.x,z:node.z-16,y:car.y,heading:0,vx:0,vz:12,mass:690,speed:12,damage:{total:0,front:0}};
  for(let i=0;i<30;i++)traffic.update(.05,[racer]);
  assert(!car.turning&&!traffic.locks.has(car.b),'fast crossing racer has junction priority');
  assert(traffic.length(car)-car.travel>=traffic.turnRadius+1.3-.01,'local car waits before the crosswalk');
}
const lake=new ChannelFlow({count:60,length:40,closed:true,bedAt:s=>-.7+.25*Math.cos(s*10)}),initial=lake.volume;for(let i=0;i<400;i++)lake.update(.05);assert(Math.abs(lake.volume-initial)<1e-8);assert(lake.q.every(q=>Math.abs(q)<1e-8),'lake at rest stays at rest');let dam=0;const river=new ChannelFlow({bedAt:s=>-1-.8*s+(s>.48&&s<.54?dam:0)});for(let i=0;i<600;i++)river.update(.05);assert(river.q.some(q=>q>.1));const before=river.sample(.43).surface;dam=2;for(let i=0;i<600;i++)river.update(.05);assert(river.sample(.43).surface>before+.05,'raised bed backs water upstream');assert(river.h.every(h=>Number.isFinite(h)&&h>=0));const save=river.exportState(),clock=river.clock;river.update(0);assert.deepEqual(river.exportState(),save);const copy=new ChannelFlow();assert(copy.restoreState(save));assert.equal(copy.clock,clock);assert(!copy.restoreState({h:[NaN],q:[Infinity]}));
const wood={y:-3.2,vx:0,vy:0,vz:0},stone={...wood},water={surface:-3,vx:1,vz:.3};floatForce(wood,water,.05,9.81,.2,1);floatForce(stone,water,.05,9.81,.2,.15);assert(wood.vy>stone.vy);assert(wood.vx>0&&wood.vz>0);console.table(reports);console.log('Interior street coverage, continuous turns, separated traffic bodies, racer impact physics, save/throw recovery, water conservation, lake balance, dam response, and buoyancy passed.');
