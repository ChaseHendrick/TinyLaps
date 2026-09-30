import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp=THREE.MathUtils.clamp;
export function segmentDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);}
/** Deterministic fictional districts. No real-world geographic accuracy is implied. */
export function createCityPlan(config){
  const {xs,zs,warp=0,width=4.2}=config;
  const nodes=[],edges=[],blocks=[];
  const index=(i,j)=>j*xs.length+i;
  for(let j=0;j<zs.length;j++)for(let i=0;i<xs.length;i++)nodes.push({id:index(i,j),x:xs[i]+warp*Math.sin(zs[j]*.1),z:zs[j]+warp*.3*Math.sin(xs[i]*.09),neighbors:[]});
  function connect(a,b){const id=edges.length;edges.push({id,a,b,length:Math.hypot(nodes[a].x-nodes[b].x,nodes[a].z-nodes[b].z)});nodes[a].neighbors.push(b);nodes[b].neighbors.push(a);}
  for(let j=0;j<zs.length;j++)for(let i=0;i<xs.length;i++){if(i+1<xs.length)connect(index(i,j),index(i+1,j));if(j+1<zs.length)connect(index(i,j),index(i,j+1));}
  for(let j=0;j+1<zs.length;j++)for(let i=0;i+1<xs.length;i++){
    const corners=[nodes[index(i,j)],nodes[index(i+1,j)],nodes[index(i+1,j+1)],nodes[index(i,j+1)]];
    const park=config.parks.some(([x,z])=>x===i&&z===j);
    blocks.push({id:blocks.length,i,j,corners,park});
  }
  const spurs=[];
  for(const [i,j,x,z] of [[0,2,-52,0],[xs.length-1,2,52,0],[2,0,xs[2],-35],[3,zs.length-1,xs[3],35]]){
    const a=nodes[index(i,j)],b={x,z};spurs.push({a,b});
  }
  const distanceToRoad=(x,z)=>Math.min(...edges.map(e=>segmentDistance(x,z,nodes[e.a],nodes[e.b])),...spurs.map(e=>segmentDistance(x,z,e.a,e.b)));
  const crossing=(x,z)=>nodes.some(n=>Math.hypot(n.x-x,n.z-z)<width*.95);
  return {config,width,nodes,edges,blocks,spurs,distanceToRoad,crossing};
}
export function cityPoint(block,u,v){const [a,b,c,d]=block.corners;return{x:(a.x*(1-u)+b.x*u)*(1-v)+(d.x*(1-u)+c.x*u)*v,z:(a.z*(1-u)+b.z*u)*(1-v)+(d.z*(1-u)+c.z*u)*v};}

export function buildCityRoads({group,plan,terrain}){
  const buckets=new Map();
  const materials={sidewalk:new THREE.MeshStandardMaterial({color:'#c9c7b9',roughness:.95}),asphalt:new THREE.MeshStandardMaterial({color:'#5f6b69',roughness:.92}),paint:new THREE.MeshStandardMaterial({color:'#ede7ce',roughness:.85})};
  for(const m of Object.values(materials)){m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-2;}
  function part(geo,mat,x,y,z,yaw=0){geo.rotateY(yaw);geo.translate(x,y,z);const list=buckets.get(mat)||[];list.push(geo.toNonIndexed());geo.dispose();buckets.set(mat,list);}
  function road(a,b){const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    part(new THREE.BoxGeometry(plan.width+2.2,.14,len+plan.width+2.2),materials.sidewalk,x,.075,z,yaw);
    part(new THREE.BoxGeometry(plan.width,.04,len+plan.width),materials.asphalt,x,.16,z,yaw);
    for(let d=3.8;d<len-3.5;d+=4){const t=d/len;part(new THREE.BoxGeometry(.07,.016,.85),materials.paint,a.x+dx*t,.191,a.z+dz*t,yaw);}
  }
  for(const e of plan.edges)road(plan.nodes[e.a],plan.nodes[e.b]);for(const s of plan.spurs)road(s.a,s.b);
  for(const n of plan.nodes){
    // Clear a neat intersection; crossings belong just outside its center.
    part(new THREE.BoxGeometry(plan.width+.15,.05,plan.width+.15),materials.asphalt,n.x,.174,n.z);
    for(const direction of [0,Math.PI/2])for(const sign of [-1,1])for(let stripe=-2;stripe<=2;stripe++){
      const d=plan.width*.65,along=stripe*.52,px=direction?sign*d:along,pz=direction?along:sign*d;
      part(new THREE.BoxGeometry(direction?.9:.25,.018,direction?.25:.9),materials.paint,n.x+px,.21,n.z+pz);
    }
  }
  for(const [mat,geos] of buckets){const geometry=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,mat);mesh.name='City '+(mat===materials.paint?'crosswalks':mat===materials.asphalt?'streets':'sidewalks');mesh.receiveShadow=true;group.add(mesh);terrain.registerMesh(mesh);}
}

/** Small local traffic on a connected graph, with signals, following distances, and recoverable throws. */
export class CityTraffic {
  constructor({plan,count=28,seed=17,groundAt=()=>0,obstacles=()=>[],strike=()=>{}}){
    Object.assign(this,{plan,seed:seed>>>0,groundAt,obstacles,strike,clock:0});this.cars=[];
    for(let i=0;i<count;i++){const edge=plan.edges[i%plan.edges.length],reverse=i%2===1,a=reverse?edge.b:edge.a,b=reverse?edge.a:edge.b;this.cars.push({id:i+10,name:`City car ${i+1}`,a,b,previous:-1,travel:(i*.618%1)*edge.length,x:0,y:.18,z:0,heading:0,speed:0,maxSpeed:2.3+(i%5)*.33,vx:0,vz:0,vy:0,mass:600,held:false,airborne:false,recovering:false,health:1,damage:{total:0},wait:0,visits:0,wheelAngle:0});}
    this.cars.forEach(c=>this.position(c));this.initial=this.exportState();
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  length(c){const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b];return Math.hypot(b.x-a.x,b.z-a.z);}
  position(c){const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b],length=this.length(c),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,t=clamp(c.travel/length,0,1),lane=.78*Math.min(1,c.travel/2.3,(length-c.travel)/2.3);c.x=a.x+(b.x-a.x)*t+dz*lane;c.z=a.z+(b.z-a.z)*t-dx*lane;c.y=this.groundAt(c.x,c.z)+.18;c.heading=Math.atan2(dx,dz);c.vx=dx*c.speed;c.vz=dz*c.speed;}
  signal(node,vertical){const phase=(this.clock+node.id*.41)%12;return vertical?phase<5.5:phase>=6&&phase<11.5;}
  lift(id,height){const c=this.cars.find(c=>c.id===id);if(!c||!Number.isFinite(height))return false;c.held=c.airborne=true;c.y=height;c.vx=c.vy=c.vz=c.speed=0;return true;}
  teleport(id,x,z){const c=this.cars.find(c=>c.id===id);if(!c||![x,z].every(Number.isFinite))return false;c.x=x;c.z=z;c.vx=c.vz=c.vy=0;return true;}
  impulse(id,impulse){const c=this.cars.find(c=>c.id===id);if(!c)return false;c.held=false;c.airborne=true;c.vx+=(impulse.x||0)/c.mass;c.vz+=(impulse.z||0)/c.mass;c.vy+=(impulse.y||0)/c.mass;return true;}
  hurt(c,speed){c.health=clamp(c.health-Math.max(0,speed-2)*.025,.15,1);c.damage.total=1-c.health;}
  recover(c){let nearest=0,d=Infinity;this.plan.nodes.forEach((n,i)=>{const next=Math.hypot(c.x-n.x,c.z-n.z);if(next<d){d=next;nearest=i;}});c.a=nearest;c.b=this.plan.nodes[nearest].neighbors[0];c.travel=0;c.recovering=true;}
  update(dt,racers=[],gravity=9.81){
    if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(.1,dt);this.clock+=dt;
    for(const c of this.cars){
      if(c.held)continue;
      if(c.airborne){const n=Math.ceil(dt/.016),step=dt/n;for(let i=0;i<n;i++){c.vy-=gravity*step;c.x+=c.vx*step;c.z+=c.vz*step;c.y+=c.vy*step;
        for(const p of this.obstacles()){if(!p.solid||p.held||c.y+.7<p.y||c.y>p.y+p.height)continue;const dx=c.x-p.x,dz=c.z-p.z,d=Math.hypot(dx,dz),r=p.radius+.7;if(d>=r)continue;const nx=dx/(d||1),nz=dz/(d||1),closing=-(c.vx*nx+c.vz*nz);c.x=p.x+nx*(r+.02);c.z=p.z+nz*(r+.02);if(closing>0){this.hurt(c,closing);c.vx+=nx*closing*1.2;c.vz+=nz*closing*1.2;this.strike(p.id,{energy:.5*c.mass*closing**2,severity:closing/14,vx:c.vx,vz:c.vz});}}
        const floor=this.groundAt(c.x,c.z)+.18;if(c.y<floor){c.y=floor;this.hurt(c,Math.hypot(c.vx,c.vy,c.vz));c.vx=c.vy=c.vz=0;c.airborne=false;this.recover(c);break;}}
        continue;
      }
      if(c.recovering){const node=this.plan.nodes[c.a],dx=node.x-c.x,dz=node.z-c.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*1.4);c.x+=dx/Math.max(.001,d)*step;c.z+=dz/Math.max(.001,d)*step;c.y=this.groundAt(c.x,c.z)+.18;c.heading=Math.atan2(dx,dz);c.speed=1.4;if(d<.2){c.recovering=false;c.travel=0;}continue;}
      const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b],length=this.length(c),remaining=length-c.travel;
      let target=c.maxSpeed*(.45+c.health*.55);
      if(remaining<3&&!this.signal(b,Math.abs(b.z-a.z)>Math.abs(b.x-a.x)))target=0;
      for(const other of [...this.cars,...racers]){if(other===c||other.held||other.airborne)continue;const dx=other.x-c.x,dz=other.z-c.z,forward=dx*Math.sin(c.heading)+dz*Math.cos(c.heading),side=Math.abs(dx*Math.cos(c.heading)-dz*Math.sin(c.heading));if(forward>0&&forward<3.3&&side<.8)target=0;if(remaining<3&&Math.hypot(other.x-b.x,other.z-b.z)<2&&other.id<c.id&&other.speed>.3)target=0;}
      if(this.obstacles().some(p=>p.solid&&!p.held&&p.y<.8&&Math.hypot(p.x-c.x,p.z-c.z)<p.radius+1))target=0;
      c.speed+=clamp(target-c.speed,-dt*6,dt*2);c.travel+=c.speed*dt;c.wheelAngle+=c.speed*dt/.18;c.wait=target===0?c.wait+dt:0;
      if(c.travel>=length){const choices=b.neighbors.filter(n=>n!==c.a),next=choices.length?choices[Math.floor(this.random()*choices.length)]:c.a;c.previous=c.a;c.a=c.b;c.b=next;c.travel=0;c.visits++;}
      if(c.wait>18){const old=c.a;c.a=c.b;c.b=old;c.travel=length-c.travel;c.wait=0;c.speed=.4;}
      this.position(c);
    }
  }
  exportState(){return{clock:this.clock,seed:this.seed,cars:this.cars.map(c=>({...c,damage:{...c.damage}}))};}
  restoreState(saved){if(!saved||!Array.isArray(saved.cars)||saved.cars.length!==this.cars.length)return false;for(let i=0;i<this.cars.length;i++){const s=saved.cars[i],c=this.cars[i];if(!s||!Number.isInteger(s.a)||!Number.isInteger(s.b)||!this.plan.nodes[s.a]?.neighbors.includes(s.b))continue;for(const key of ['a','b','previous','travel','x','y','z','heading','speed','vx','vy','vz','health','wait','visits','wheelAngle'])if(Number.isFinite(s[key])&&Math.abs(s[key])<10000)c[key]=s[key];c.travel=clamp(c.travel,0,this.length(c));c.health=clamp(c.health,.15,1);c.damage.total=1-c.health;c.held=false;c.airborne=s.airborne===true||s.held===true;c.recovering=s.recovering===true;}if(Number.isFinite(saved.clock)&&saved.clock>=0)this.clock=saved.clock;if(Number.isInteger(saved.seed))this.seed=saved.seed>>>0;return true;}
  reset(){this.restoreState(this.initial);}
}

export function createCityTraffic({group,plan,terrain,scenery}){
  const traffic=new CityTraffic({plan,count:plan.config.traffic||28,seed:plan.config.seed||17,groundAt:(x,z)=>terrain.heightAt(x,z),obstacles:()=>scenery.colliders,strike:(...args)=>scenery.applyImpact(...args)});
  const root=new THREE.Group();root.name='City traffic';group.add(root);
  const mat=new THREE.MeshStandardMaterial({roughness:.64});
  const count=traffic.cars.length;
  function part(name,geometry,total){const m=new THREE.InstancedMesh(geometry,mat,total);m.name=name;m.userData.cityTraffic=true;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.castShadow=m.receiveShadow=true;m.frustumCulled=false;root.add(m);return m;}
  const body=part('City car bodies',new THREE.BoxGeometry(.86,.36,1.66),count),roof=part('City car windows',new THREE.BoxGeometry(.7,.29,.75),count),wheels=part('City car wheels',new THREE.CylinderGeometry(.18,.18,.11,8),count*4);
  const colors=['#bf7860','#839e9a','#dcbb75','#718996','#b693a6','#dcd5bc'];const dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){roof.setColorAt(i,new THREE.Color('#54736f'));for(let j=0;j<4;j++)wheels.setColorAt(i*4+j,new THREE.Color('#35413b'));}
  function render(){traffic.cars.forEach((c,i)=>{dummy.position.set(c.x,c.y+.3,c.z);dummy.rotation.set(0,c.heading,0);dummy.scale.setScalar(1);dummy.updateMatrix();body.setMatrixAt(i,dummy.matrix);body.setColorAt(i,new THREE.Color(colors[i%colors.length]).multiplyScalar(.7+c.health*.3));dummy.position.y+=.27;dummy.updateMatrix();roof.setMatrixAt(i,dummy.matrix);for(let j=0;j<4;j++){const x=(j%2?1:-1)*.47,z=(j<2?1:-1)*.5;dummy.position.set(c.x+Math.cos(c.heading)*x+Math.sin(c.heading)*z,c.y+.18,c.z-Math.sin(c.heading)*x+Math.cos(c.heading)*z);dummy.rotation.set(0,c.heading,Math.PI/2);dummy.updateMatrix();wheels.setMatrixAt(i*4+j,dummy.matrix);}});for(const m of root.children){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}body.instanceColor.needsUpdate=true;}
  function pick(hit){return traffic.cars[hit.object===wheels?Math.floor(hit.instanceId/4):hit.instanceId]?.id;}
  render();return{model:traffic,cars:traffic.cars,targets:[body,roof,wheels],pick,update:(dt,cars,gravity)=>{traffic.update(dt,cars,gravity);render();},reset:()=>{traffic.reset();render();},exportState:()=>traffic.exportState(),restoreState:s=>{const r=traffic.restoreState(s);render();return r;},get stats(){return{vehicles:count,intersections:plan.nodes.length,blocks:plan.blocks.length};}};
}
