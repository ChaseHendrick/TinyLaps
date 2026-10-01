import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_LENGTH,CAR_WIDTH } from './race.js';

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
const trafficLength=1.66,trafficWidth=.86;
function trafficContact(a,b){
  if(Math.abs(a.y-b.y)>Math.max(.85,a.collisionHeight??0,b.collisionHeight??0))return null;
  const dx=b.x-a.x,dz=b.z-a.z;if(dx*dx+dz*dz>12)return null;
  const basis=c=>[{x:Math.sin(c.heading),z:Math.cos(c.heading)},{x:Math.cos(c.heading),z:-Math.sin(c.heading)}];
  const aa=basis(a),bb=basis(b),size=c=>c.id<10?[c.length??CAR_LENGTH,c.width??CAR_WIDTH]:[trafficLength,trafficWidth],as=size(a),bs=size(b);
  let depth=Infinity,normal;
  for(const axis of [...aa,...bb]){
    const projection=dx*axis.x+dz*axis.z;
    const extent=(axes,s)=>Math.abs(axis.x*axes[0].x+axis.z*axes[0].z)*s[0]/2+Math.abs(axis.x*axes[1].x+axis.z*axes[1].z)*s[1]/2;
    const overlap=extent(aa,as)+extent(bb,bs)-Math.abs(projection);
    if(overlap<=0)return null;
    if(overlap<depth){depth=overlap;const sign=projection<0?-1:1;normal={x:axis.x*sign,z:axis.z*sign};}
  }
  return {depth,normal};
}
// A throw or a racer shove can leave two bodies touching. Such a touch may only
// shrink; rejecting every move that still touches would freeze both forever.
function worsens(after,before,other){const now=trafficContact(after,other);if(!now)return false;const was=trafficContact(before,other);return !was||now.depth>was.depth+1e-6;}
export class CityTraffic {
  constructor({plan,count=28,seed=17,groundAt=()=>0,obstacles=()=>[],strike=()=>{}}){
    Object.assign(this,{plan,seed:seed>>>0,groundAt,obstacles,strike,clock:0});this.cars=[];this.locks=new Map();
    this.lane=Math.min(1.6,plan.width*.23);this.turnRadius=Math.min(3.6,plan.width*.52);
    for(let i=0;i<count;i++){
      const edge=plan.edges[i%plan.edges.length],reverse=i%2===1,a=reverse?edge.b:edge.a,b=reverse?edge.a:edge.b;
      const c={id:i+10,name:`City car ${i+1}`,a,b,next:-1,previous:-1,travel:(i*.618%1)*edge.length,turning:false,turnDistance:0,junction:-1,lane:this.lane,yieldUntil:0,x:0,y:.18,z:0,heading:0,speed:0,maxSpeed:2.3+(i%5)*.33,vx:0,vz:0,vy:0,mass:600,held:false,airborne:false,recovering:false,health:1,damage:{total:0},wait:0,visits:0,wheelAngle:0};
      c.next=this.chooseNext(c);c.travel=clamp(c.travel,2.1,edge.length-this.turnRadius-1.3);this.position(c);
      for(let attempt=0;attempt<80&&this.cars.some(o=>trafficContact(c,o));attempt++){c.travel=2.1+(attempt%12)/11*(this.length(c)-this.turnRadius-3.4);if(attempt%12===11){const e=plan.edges[(i+Math.floor(attempt/12)+1)%plan.edges.length];c.a=e.a;c.b=e.b;c.next=this.chooseNext(c);}this.position(c);}
      this.cars.push(c);
    }
    this.initial=this.exportState();
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  length(c){const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b];return Math.hypot(b.x-a.x,b.z-a.z);}
  chooseNext(c){const options=this.plan.nodes[c.b].neighbors.filter(n=>n!==c.a);return options.length?options[Math.floor(this.random()*options.length)]:c.a;}
  exitClear(c,next){return !this.cars.some(o=>o!==c&&!o.held&&!o.airborne&&!o.recovering&&o.a===c.b&&o.b===next&&o.travel<this.turnRadius+4.5);}
  racerPriority(node,racers){return racers.some(r=>{if(r.held||r.airborne||r.speed<2)return false;const dx=node.x-r.x,dz=node.z-r.z,forward=dx*Math.sin(r.heading)+dz*Math.cos(r.heading),side=Math.abs(dx*Math.cos(r.heading)-dz*Math.sin(r.heading));return forward>-4&&forward<Math.max(12,r.speed*4)&&side<5;});}
  turn(c){
    const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b],n=this.plan.nodes[c.next],length=this.length(c),outLength=Math.hypot(n.x-b.x,n.z-b.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,ox=(n.x-b.x)/outLength,oz=(n.z-b.z)/outLength,r=Math.min(this.turnRadius,length*.3,outLength*.3),lane=c.lane;
    const p0={x:b.x-dx*r+dz*lane,z:b.z-dz*r-dx*lane},p2={x:b.x+ox*r+oz*lane,z:b.z+oz*r-ox*lane};
    const cross=dx*oz-dz*ox;
    let p1;
    if(Math.abs(cross)<.12)p1={x:(p0.x+p2.x)/2,z:(p0.z+p2.z)/2};
    else{const t=((p2.x-p0.x)*oz-(p2.z-p0.z)*ox)/cross;p1={x:p0.x+dx*t,z:p0.z+dz*t};}
    const sample=t=>({x:(1-t)**2*p0.x+2*(1-t)*t*p1.x+t*t*p2.x,z:(1-t)**2*p0.z+2*(1-t)*t*p1.z+t*t*p2.z});
    let arc=0,prev=p0;const lengths=[0];for(let i=1;i<=24;i++){const p=sample(i/24);arc+=Math.hypot(p.x-prev.x,p.z-prev.z);lengths.push(arc);prev=p;}
    return {r,p0,p1,p2,length:arc,lengths,sample};
  }
  position(c){
    const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b],length=this.length(c);let dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    if(c.turning){const path=this.turn(c),distance=clamp(c.turnDistance,0,path.length);let i=1;while(i<24&&path.lengths[i]<distance)i++;const t=(i-1+(distance-path.lengths[i-1])/Math.max(.001,path.lengths[i]-path.lengths[i-1]))/24,p=path.sample(t);c.x=p.x;c.z=p.z;dx=2*((1-t)*(path.p1.x-path.p0.x)+t*(path.p2.x-path.p1.x));dz=2*((1-t)*(path.p1.z-path.p0.z)+t*(path.p2.z-path.p1.z));const norm=Math.hypot(dx,dz)||1;dx/=norm;dz/=norm;}
    else{const t=clamp(c.travel/length,0,1);c.x=a.x+(b.x-a.x)*t+dz*c.lane;c.z=a.z+(b.z-a.z)*t-dx*c.lane;}
    c.y=this.groundAt(c.x,c.z)+.18;c.heading=Math.atan2(dx,dz);c.vx=dx*c.speed;c.vz=dz*c.speed;
  }
  signal(node,vertical){const phase=(this.clock+node.id*.41)%12;return vertical?phase<5.5:phase>=6&&phase<11.5;}
  lift(id,height){const c=this.cars.find(c=>c.id===id);if(!c||!Number.isFinite(height))return false;this.release(c);c.held=c.airborne=true;c.y=height;c.vx=c.vy=c.vz=c.speed=0;return true;}
  teleport(id,x,z){const c=this.cars.find(c=>c.id===id);if(!c||![x,z].every(Number.isFinite))return false;c.x=x;c.z=z;c.vx=c.vz=c.vy=0;return true;}
  impulse(id,impulse){const c=this.cars.find(c=>c.id===id);if(!c)return false;this.release(c);c.held=false;c.airborne=true;c.vx+=(impulse.x||0)/c.mass;c.vz+=(impulse.z||0)/c.mass;c.vy+=(impulse.y||0)/c.mass;return true;}
  hurt(c,speed){c.health=clamp(c.health-Math.max(0,speed-2)*.025,.15,1);c.damage.total=1-c.health;}
  release(c){if(this.locks.get(c.junction)===c.id)this.locks.delete(c.junction);c.junction=-1;}
  recover(c){this.release(c);let best=Infinity;for(const e of this.plan.edges)for(const reverse of [false,true]){const a=reverse?e.b:e.a,b=reverse?e.a:e.b,s={...c,a,b,turning:false,travel:0};const aa=this.plan.nodes[a],bb=this.plan.nodes[b],length=e.length;s.travel=clamp(((c.x-aa.x)*(bb.x-aa.x)+(c.z-aa.z)*(bb.z-aa.z))/length,2,length-this.turnRadius-1.3);this.position(s);const distance=Math.hypot(s.x-c.x,s.z-c.z);if(distance<best){best=distance;c.a=a;c.b=b;c.travel=s.travel;}}c.next=this.chooseNext(c);c.turning=false;c.turnDistance=0;c.recovering=true;}
  /** A recovery blocked for seconds takes the nearest free lane spot, never one touching another body. */
  settle(c,racers=[]){let best=null,bestDistance=Infinity;c.wait=0;for(const e of this.plan.edges)for(const reverse of [false,true]){const s={...c,a:reverse?e.b:e.a,b:reverse?e.a:e.b,turning:false,lane:this.lane,speed:0};for(let travel=2;travel<=e.length-this.turnRadius-1.3;travel+=.75){s.travel=travel;this.position(s);const distance=Math.hypot(s.x-c.x,s.z-c.z);if(distance>=bestDistance||this.cars.some(o=>o!==c&&!o.held&&!o.airborne&&trafficContact(s,o))||racers.some(r=>!r.airborne&&trafficContact(s,r)))continue;best={a:s.a,b:s.b,travel};bestDistance=distance;}}
    if(!best)return false;Object.assign(c,best,{turning:false,turnDistance:0,lane:this.lane,speed:0,recovering:false});c.next=this.chooseNext(c);this.position(c);return true;}
  racerContact(c,racer){
    const contact=trafficContact(c,racer);if(!contact)return false;const {normal:n,depth}=contact;
    const closing=(racer.vx-c.vx)*n.x+(racer.vz-c.vz)*n.z,invC=1/c.mass,invR=racer.held?0:1/racer.mass;
    c.x-=n.x*(depth+.01);c.z-=n.z*(depth+.01);
    if(closing<-.2){const impulse=-closing*1.12/(invC+invR);c.vx-=n.x*impulse*invC;c.vz-=n.z*impulse*invC;if(!racer.held){racer.vx+=n.x*impulse*invR;racer.vz+=n.z*impulse*invR;racer.speed=Math.hypot(racer.vx,racer.vz);if(racer.id<10){const severity=clamp((closing*closing-4)*.012,0,.6);racer.damage.total=clamp(1-(1-racer.damage.total)*(1-severity),0,1);racer.damage.front=clamp(racer.damage.front+severity*.5,0,1);}else{this.hurt(racer,-closing);racer.airborne=true;racer.recovering=false;this.release(racer);}}this.hurt(c,-closing);}
    c.speed=0;c.airborne=true;c.recovering=false;this.release(c);return true;
  }
  update(dt,racers=[],gravity=9.81){
    if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(.1,dt);this.clock+=dt;
    for(const c of this.cars){
      if(c.held)continue;
      for(const racer of racers)this.racerContact(c,racer);
      if(c.airborne){const n=Math.ceil(dt/.016),step=dt/n;for(let i=0;i<n;i++){c.vy-=gravity*step;c.x+=c.vx*step;c.z+=c.vz*step;c.y+=c.vy*step;
        for(const other of [...this.cars,...racers])if(other!==c&&!other.held)this.racerContact(c,other);
        for(const p of this.obstacles()){if(!p.solid||p.held||c.y+.7<p.y||c.y>p.y+p.height)continue;const dx=c.x-p.x,dz=c.z-p.z,d=Math.hypot(dx,dz),r=p.radius+.7;if(d>=r)continue;const nx=dx/(d||1),nz=dz/(d||1),closing=-(c.vx*nx+c.vz*nz);c.x=p.x+nx*(r+.02);c.z=p.z+nz*(r+.02);if(closing>0){this.hurt(c,closing);c.vx+=nx*closing*1.2;c.vz+=nz*closing*1.2;this.strike(p.id,{energy:.5*c.mass*closing**2,severity:closing/14,vx:c.vx,vz:c.vz});}}
        const floor=this.groundAt(c.x,c.z)+.18;if(c.y<floor){c.y=floor;this.hurt(c,Math.hypot(c.vx,c.vy,c.vz));c.vx=c.vy=c.vz=0;c.airborne=false;this.recover(c);break;}}
        continue;
      }
      if(c.recovering){const target={...c};this.position(target);const dx=target.x-c.x,dz=target.z-c.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*1.4),candidate={...c,x:c.x+dx/Math.max(.001,d)*step,z:c.z+dz/Math.max(.001,d)*step,heading:d>.05?Math.atan2(dx,dz):target.heading};if(!this.cars.some(o=>o!==c&&!o.held&&!o.airborne&&!o.recovering&&worsens(candidate,c,o))){c.x=candidate.x;c.z=candidate.z;c.heading=candidate.heading;c.speed=1.4;c.wait=0;c.y=this.groundAt(c.x,c.z)+.18;if(d<.05){c.recovering=false;this.position(c);}}else{c.speed=0;c.wait+=dt;if(c.wait>4)this.settle(c,racers);}continue;}
      const a=this.plan.nodes[c.a],b=this.plan.nodes[c.b],length=this.length(c),remaining=length-c.travel;
      if(c.junction===c.a&&!c.turning&&c.travel>this.turnRadius+1.2)this.release(c);
      const before={...c};
      // Only a racer closing on the car counts. One already driving away needs no curb.
      const approaching=racers.some(r=>{if(r.held||r.airborne||r.speed<2)return false;const dx=r.x-c.x,dz=r.z-c.z,side=Math.abs(dx*Math.cos(c.heading)-dz*Math.sin(c.heading)),alignment=Math.abs(Math.cos(r.heading-c.heading)),vx=r.vx??Math.sin(r.heading)*r.speed,vz=r.vz??Math.cos(r.heading)*r.speed;return Math.hypot(dx,dz)<Math.max(25,r.speed*3)&&side<this.plan.width*.65&&alignment>.65&&dx*vx+dz*vz<0;});
      if(approaching)c.yieldUntil=this.clock+2;
      const yielding=this.clock<c.yieldUntil;
      if(!c.turning)c.lane+=clamp((yielding?Math.min(this.plan.width/2-.65,2.85):this.lane)-c.lane,-dt*2.5,dt*2.5);
      const path=this.turn(c),stopDistance=path.r+1.3;
      let target=c.maxSpeed*(.45+c.health*.55);
      if(c.turning)target=Math.min(target,2.1);
      else if(yielding)target=0;
      let ahead=false;for(const other of [...this.cars,...racers]){if(other===c||other.held||other.airborne)continue;const dx=other.x-c.x,dz=other.z-c.z,forward=dx*Math.sin(c.heading)+dz*Math.cos(c.heading),side=Math.abs(dx*Math.cos(c.heading)-dz*Math.sin(c.heading));if(forward>0&&forward<3.1+c.speed*.3&&side<1.0){target=0;ahead=true;}}
      // A car that landed in front of a reservation holder cannot enter until the holder lets go.
      if(ahead&&!c.turning&&c.junction===c.b)this.release(c);
      if(!c.turning&&remaining<stopDistance+1.5&&this.locks.get(c.b)!==c.id){
        if(!this.exitClear(c,c.next)){const options=b.neighbors.filter(n=>n!==c.a&&this.exitClear(c,n));if(options.length)c.next=options[Math.floor(this.random()*options.length)];}
        const clear=!this.locks.has(c.b)&&this.signal(b,Math.abs(b.z-a.z)>Math.abs(b.x-a.x))&&this.exitClear(c,c.next)&&!this.racerPriority(b,racers)&&Math.abs(c.lane-this.lane)<.05;
        if(clear&&target>0){this.locks.set(c.b,c.id);c.junction=c.b;}
        else target=0;
      }
      if(!c.turning&&remaining<stopDistance+1.5&&this.racerPriority(b,racers)){target=0;if(c.junction===c.b)this.release(c);}
      if(this.obstacles().some(p=>p.solid&&!p.held&&p.y<.8&&Math.hypot(p.x-c.x,p.z-c.z)<p.radius+1))target=0;
      c.speed+=clamp(target-c.speed,-dt*6,dt*2);const move=c.speed*dt;
      if(c.turning)c.turnDistance+=move;
      else{
        c.travel+=move;
        if(this.locks.get(c.b)!==c.id)c.travel=Math.min(c.travel,length-stopDistance);
        if(c.travel>=length-path.r){c.turning=true;c.turnDistance=c.travel-(length-path.r);}
      }
      if(c.turning&&c.turnDistance>=path.length){c.previous=c.a;c.a=c.b;c.b=c.next;c.travel=path.r+c.turnDistance-path.length;c.turning=false;c.turnDistance=0;c.visits++;c.next=this.chooseNext(c);}
      this.position(c);
      const blocked=this.cars.some(o=>o!==c&&!o.held&&!o.airborne&&worsens(c,before,o))||racers.some(o=>!o.airborne&&trafficContact(c,o));
      if(blocked){
        // A movement rollback must also undo a reservation acquired during
        // that move. Otherwise the car forgets which junction it owns and
        // leaves an invisible permanent obstruction for the other traffic.
        if(c.junction!==before.junction&&this.locks.get(c.junction)===c.id)this.locks.delete(c.junction);
        Object.assign(c,before);
        // A priority racer may have released the previous reservation before
        // the collision check. Do not restore ownership that no longer exists.
        if(c.junction>=0&&this.locks.get(c.junction)!==c.id)c.junction=-1;
        c.speed=c.vx=c.vz=0;
      }
      c.wheelAngle+=c.speed*dt/.18;c.wait=target===0||blocked?c.wait+dt:0;
      // A blocked exit can be rerouted while still on the approach lane.
      if(c.wait>15&&!c.turning&&c.junction===c.b){c.next=this.chooseNext(c);c.wait=0;}
    }
  }
  exportState(){return{clock:this.clock,seed:this.seed,cars:this.cars.map(c=>({...c,damage:{...c.damage}}))};}
  restoreState(saved){if(!saved||!Array.isArray(saved.cars)||saved.cars.length!==this.cars.length)return false;this.locks.clear();for(let i=0;i<this.cars.length;i++){const s=saved.cars[i],c=this.cars[i];if(!s||!Number.isInteger(s.a)||!Number.isInteger(s.b)||!this.plan.nodes[s.a]?.neighbors.includes(s.b))continue;for(const key of ['a','b','previous','travel','x','y','z','heading','speed','vx','vy','vz','health','wait','visits','wheelAngle','turnDistance','lane','yieldUntil'])if(Number.isFinite(s[key])&&Math.abs(s[key])<10000)c[key]=s[key];c.lane=Number.isFinite(s.lane)?clamp(s.lane,.5,this.plan.width/2-.5):this.lane;c.yieldUntil=Number.isFinite(s.yieldUntil)?Math.max(0,s.yieldUntil):0;c.next=Number.isInteger(s.next)&&this.plan.nodes[c.b].neighbors.includes(s.next)?s.next:this.chooseNext(c);c.turning=s.turning===true;c.turnDistance=clamp(c.turnDistance,0,this.turn(c).length);c.junction=Number.isInteger(s.junction)&&s.junction>=0&&s.junction<this.plan.nodes.length?s.junction:-1;if(c.junction>=0&&!this.locks.has(c.junction))this.locks.set(c.junction,c.id);else c.junction=-1;c.travel=clamp(c.travel,0,this.length(c));c.health=clamp(c.health,.15,1);c.damage.total=1-c.health;c.held=false;c.airborne=s.airborne===true||s.held===true;c.recovering=s.recovering===true;if(!c.airborne&&!c.recovering)this.position(c);}if(Number.isFinite(saved.clock)&&saved.clock>=0)this.clock=saved.clock;if(Number.isInteger(saved.seed))this.seed=saved.seed>>>0;return true;}
  reset(){this.restoreState(this.initial);}
}

export function createCityTraffic({group,plan,terrain,scenery}){
  const traffic=new CityTraffic({plan,count:plan.config.traffic??28,seed:plan.config.seed??17,groundAt:(x,z)=>terrain.heightAt(x,z),obstacles:()=>scenery.colliders,strike:(...args)=>scenery.applyImpact(...args)});
  const root=new THREE.Group();root.name='City traffic';group.add(root);
  const mat=new THREE.MeshStandardMaterial({roughness:.64});
  const count=traffic.cars.length;
  function part(name,geometry,total){const m=new THREE.InstancedMesh(geometry,mat,total);m.name=name;m.userData.cityTraffic=true;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.castShadow=m.receiveShadow=true;m.frustumCulled=false;root.add(m);return m;}
  const body=part('City car bodies',new THREE.BoxGeometry(.86,.36,1.66),count),roof=part('City car windows',new THREE.BoxGeometry(.7,.29,.75),count),wheels=part('City car wheels',new THREE.CylinderGeometry(.18,.18,.11,8),count*4);
  const colors=['#bf7860','#839e9a','#dcbb75','#718996','#b693a6','#dcd5bc'];const dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){roof.setColorAt(i,new THREE.Color('#54736f'));for(let j=0;j<4;j++)wheels.setColorAt(i*4+j,new THREE.Color('#35413b'));}
  function render(){traffic.cars.forEach((c,i)=>{dummy.position.set(c.x,c.y+.3,c.z);dummy.rotation.set(0,c.heading,0);dummy.scale.setScalar(1);dummy.updateMatrix();body.setMatrixAt(i,dummy.matrix);body.setColorAt(i,new THREE.Color(colors[i%colors.length]).multiplyScalar(.7+c.health*.3));dummy.position.y+=.27;dummy.updateMatrix();roof.setMatrixAt(i,dummy.matrix);for(let j=0;j<4;j++){const x=(j%2?1:-1)*.47,z=(j<2?1:-1)*.5;dummy.position.set(c.x+Math.cos(c.heading)*x+Math.sin(c.heading)*z,c.y+.18,c.z-Math.sin(c.heading)*x+Math.cos(c.heading)*z);dummy.rotation.set(0,c.heading,Math.PI/2);dummy.updateMatrix();wheels.setMatrixAt(i*4+j,dummy.matrix);}});for(const m of root.children){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}if(body.instanceColor)body.instanceColor.needsUpdate=true;}
  function pick(hit){return traffic.cars[hit.object===wheels?Math.floor(hit.instanceId/4):hit.instanceId]?.id;}
  render();return{model:traffic,cars:traffic.cars,targets:[body,roof,wheels],pick,update:(dt,cars,gravity)=>{traffic.update(dt,cars,gravity);render();},reset:()=>{traffic.reset();render();},exportState:()=>traffic.exportState(),restoreState:s=>{const r=traffic.restoreState(s);render();return r;},get stats(){return{vehicles:count,intersections:plan.nodes.length,blocks:plan.blocks.length};}};
}
