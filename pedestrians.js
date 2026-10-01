import * as THREE from 'three';

/** Walkable town paths, small daily routines, and short-lived reactions to disturbances. */
export class TownCrowd {
  constructor({ walkable, homes, seed = 17, count = 36, groundAt = () => 0, obstacles = () => [] }) {
    this.walkable = walkable; this.groundAt = groundAt; this.obstacles = obstacles;
    this.clock = 0;this.blood=[];
    this.seed = seed >>> 0;
    this.nodes = [];
    const grid = new Map();
    for (let x = -42; x <= 42; x += 2) for (let z = -32; z <= 32; z += 2) {
      if (!walkable(x, z)) continue;
      grid.set(`${x},${z}`, this.nodes.length);
      this.nodes.push({ x, z, neighbors: [] });
    }
    for (const node of this.nodes) for (const [dx, dz] of [[2,0],[-2,0],[0,2],[0,-2],[2,2],[2,-2],[-2,2],[-2,-2]]) {
      const index = grid.get(`${node.x+dx},${node.z+dz}`);
      if (index !== undefined && [.25,.5,.75].every(t => walkable(node.x+dx*t,node.z+dz*t))) node.neighbors.push(index);
    }
    const available = this.nodes.map((node,index)=>({node,index})).filter(({node})=>node.neighbors.length);
    this.people = [];
    if (!available.length || !homes.length) return;
    for (let id = 0; id < count; id++) {
      const home = homes[Math.floor(Math.floor(id/4)/Math.ceil(count/4)*homes.length)];
      const nearby = available.filter(({node})=>Math.hypot(node.x-home.x,node.z-home.z)<12);
      const choices = nearby.length ? nearby : available;
      let {node,index} = choices[Math.floor(this.random()*choices.length)];
      if(id%4===3){index=this.people[Math.floor(id/4)*4].node;node=this.nodes[index];}
      this.people.push({id,child:id%4===3,parent:Math.floor(id/4)*4,health:1,held:false,airborne:false,y:0,vx:0,vy:0,vz:0,roll:0,pitch:0,recovery:0,x:node.x,z:node.z,homeX:home.x,homeZ:home.z,node:index,goal:index,previous:-1,heading:this.random()*Math.PI*2,phase:this.random()*Math.PI*2,speed:.5+this.random()*.35,wait:this.random()*2,timer:0,state:'stroll',threatX:0,threatZ:0,moving:false});
    }
    this.initial=this.people.map(p=>({...p}));
  }
  random() { this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296; }
  react(x,z,radius=18,type='meteor') {
    if (![x,z,radius].every(Number.isFinite)) return 0;
    let affected = 0;
    for (const person of this.people) {
      if (Math.hypot(person.x-x,person.z-z)>radius) continue;
      person.threatX=x;person.threatZ=z;person.wait=0;
      if(type==='repair'&&!person.child&&!person.held&&!person.airborne){person.health=1;person.recovery=0;person.roll=person.pitch=0;}
      if(person.held||person.airborne||person.recovery>0){affected++;continue;}
      person.state=type==='repair'?'curious':'panic';
      person.timer=type==='repair'?2:4+this.random()*3;
      person.goal=person.node;
      affected++;
    }
    return affected;
  }
  chooseGoal(person) {
    const choices = this.nodes[person.node]?.neighbors;
    if (!choices?.length) return;
    let best = choices[0], bestScore = -Infinity;
    for (const index of choices) {
      const node = this.nodes[index];
      let score = this.random()*.8 + (index===person.previous?-1:0);
      if (person.state==='panic') score += Math.hypot(node.x-person.threatX,node.z-person.threatZ)*2;
      else if(person.child){const parent=this.people[person.parent];score-=Math.hypot(node.x-parent.x,node.z-parent.z)*1.2;}
      else if (Math.hypot(person.x-person.homeX,person.z-person.homeZ)>10) score -= Math.hypot(node.x-person.homeX,node.z-person.homeZ);
      if (score>bestScore) {bestScore=score;best=index;}
    }
    person.goal=best;
  }
  nearestNode(x,z){let nearest=0,distance=Infinity;for(let i=0;i<this.nodes.length;i++){const n=this.nodes[i],d=Math.hypot(n.x-x,n.z-z);if(d<distance&&this.walkable(n.x,n.z)){distance=d;nearest=i;}}return nearest;}
  lift(id,height){const p=this.people[id];if(!p||p.child||!Number.isFinite(height))return false;p.held=true;p.airborne=true;p.y=height;p.vx=p.vy=p.vz=0;p.recovery=0;p.state='panic';p.moving=false;return p;}
  move(id,x,z,height){const p=this.people[id];if(!p?.held||![x,z,height].every(Number.isFinite))return false;p.x=x;p.z=z;p.y=height;return true;}
  release(id,velocity){const p=this.people[id];if(!p?.held)return false;p.held=false;p.airborne=true;for(const [key,value] of Object.entries({vx:velocity.x,vy:velocity.y,vz:velocity.z}))p[key]=Number.isFinite(value)?THREE.MathUtils.clamp(value,-35,35):0;return true;}
  impact(p,speed){if(p.child)return;const injury=Math.max(0,speed-3)*.035;if(injury>.03){for(let i=0;i<5;i++){if(this.blood.length>=48)this.blood.shift();const a=this.random()*Math.PI*2;this.blood.push({adult:p.id,x:p.x,y:this.groundAt(p.x,p.z)+.4,z:p.z,vx:Math.cos(a)*(.3+this.random()),vy:.4+this.random(),vz:Math.sin(a)*(.3+this.random()),life:3});}}p.health=Math.max(.1,p.health-Math.max(0,speed-3)*.035);p.recovery=Math.max(p.recovery,1.5+Math.min(5,speed*.12));p.state='fallen';p.roll=Math.PI*.48;p.pitch=.1;}
  blast(x,z,radius,energy=1){if(![x,z,radius,energy].every(Number.isFinite)||radius<=0)return;this.react(x,z,radius+8,'shockwave');for(const p of this.people){const dx=p.x-x,dz=p.z-z,d=Math.hypot(dx,dz);if(p.child||p.held||d>radius)continue;const speed=(1-d/radius)*energy*9;p.vx=dx/Math.max(.1,d)*speed;p.vz=dz/Math.max(.1,d)*speed;p.vy=speed*.45;p.airborne=true;p.y=Math.max(p.y,this.groundAt(p.x,p.z)+.05);this.impact(p,speed);}}
  update(dt,cars=[],gravity=9.81) {
    if (!Number.isFinite(dt)||dt<=0) return;
    dt=Math.min(dt,.1);this.clock+=dt;
    for(const drop of this.blood){drop.life-=dt;drop.vy-=gravity*dt;drop.x+=drop.vx*dt;drop.z+=drop.vz*dt;drop.y=Math.max(this.groundAt(drop.x,drop.z)+.012,drop.y+drop.vy*dt);if(drop.y<=this.groundAt(drop.x,drop.z)+.013)drop.vx=drop.vy=drop.vz=0;}this.blood=this.blood.filter(drop=>drop.life>0);
    for (const person of this.people) {
      person.moving=false;
      if(person.held)continue;
      if(person.airborne){
        const substeps=Math.max(1,Math.ceil(dt/.016)),step=dt/substeps;
        for(let j=0;j<substeps;j++){
          person.vy-=gravity*step;person.x+=person.vx*step;person.z+=person.vz*step;person.y+=person.vy*step;
          person.pitch+=person.vz*step*.15;person.roll+=person.vx*step*.15;
          for(const c of this.obstacles()){
            if(!c.solid||person.y+.8<c.y||person.y>c.y+c.height)continue;
            const dx=person.x-c.x,dz=person.z-c.z,d=Math.hypot(dx,dz),r=c.radius+.23;
            if(d>=r)continue;const nx=dx/(d||1),nz=dz/(d||1),closing=-(person.vx*nx+person.vz*nz);
            person.x=c.x+nx*(r+.02);person.z=c.z+nz*(r+.02);
            if(closing>0){this.impact(person,closing);person.vx+=nx*closing*1.2;person.vz+=nz*closing*1.2;}
          }
          const floor=this.groundAt(person.x,person.z);
          if(person.y<=floor){person.y=floor;this.impact(person,Math.hypot(person.vx,person.vy,person.vz));person.vx*=.45;person.vz*=.45;person.vy=0;person.airborne=false;break;}
        }
        continue;
      }
      if(person.recovery>0){person.recovery=Math.max(0,person.recovery-dt);if(!person.recovery){person.node=this.nearestNode(person.x,person.z);const n=this.nodes[person.node];person.x=n.x;person.z=n.z;person.goal=person.node;person.roll=person.pitch=0;person.state='stroll';}continue;}
      for (const car of cars) {
        if (!(car.speed>6||car.held||car.airborne)||Math.hypot(person.x-car.x,person.z-car.z)>4) continue;
        if(!person.child&&car.speed>3&&Math.hypot(person.x-car.x,person.z-car.z)<1&&Math.abs(car.y-this.groundAt(person.x,person.z))<1.4){person.vx=car.vx*.45;person.vz=car.vz*.45;person.vy=2;person.y=this.groundAt(person.x,person.z)+.05;person.airborne=true;this.impact(person,car.speed);}
        person.state='panic';person.timer=Math.max(person.timer,2);person.threatX=car.x;person.threatZ=car.z;person.wait=0;
      }
      if (person.timer>0) {person.timer=Math.max(0,person.timer-dt);if(!person.timer)person.state='stroll';}
      person.moving=false;
      if (person.state==='curious') {person.heading=Math.atan2(person.threatX-person.x,person.threatZ-person.z);continue;}
      if (person.wait>0&&person.state!=='panic') {person.wait-=dt;continue;}
      if(person.goal===person.node)this.chooseGoal(person);
      const goal=this.nodes[person.goal];if(!goal)continue;
      const dx=goal.x-person.x,dz=goal.z-person.z,distance=Math.hypot(dx,dz);
      const step=Math.min(distance,dt*(person.state==='panic'?2.2:person.speed));
      // A prop dropped on a walker leaves no walkable step from inside it, so the walker steps out to the nearest path point.
      if(distance>.001){const nextX=person.x+dx/distance*step,nextZ=person.z+dz/distance*step;if(!this.walkable(nextX,nextZ)){person.node=this.nearestNode(person.x,person.z);person.goal=person.node;if(!this.walkable(person.x,person.z)){const n=this.nodes[person.node];person.x=n.x;person.z=n.z;}continue;}person.x=nextX;person.z=nextZ;person.heading=Math.atan2(dx,dz);person.phase+=step*(person.state==='panic'?7:5);person.moving=true;}
      if(distance<=step+.001){person.previous=person.node;person.node=person.goal;person.goal=person.node;if(person.state!=='panic'&&this.random()<.2)person.wait=.6+this.random()*2.5;}
    }
  }
  reset() { this.people=this.initial?.map(p=>({...p}))||[];this.clock=0;this.blood=[]; }
  exportState() { return {clock:this.clock,seed:this.seed,people:this.people.map(person=>({...person}))}; }
  restoreState(saved) {
    if(!saved||!Array.isArray(saved.people)||saved.people.length!==this.people.length)return false;
    for(let i=0;i<this.people.length;i++){
      const item=saved.people[i];if(!item||!Number.isFinite(item.x)||!Number.isFinite(item.z)||Math.abs(item.x)>500||Math.abs(item.z)>500||!Number.isInteger(item.node)||!Number.isInteger(item.goal)||!this.nodes[item.node]||!this.nodes[item.goal])continue;
      const person=this.people[i];
      for(const key of ['x','y','z','vx','vy','vz','roll','pitch','recovery','health','heading','phase','speed','wait','timer','threatX','threatZ'])if(Number.isFinite(item[key])&&Math.abs(item[key])<1e6)person[key]=item[key];
      person.held=false;person.airborne=!person.child&&(item.airborne===true||item.held===true);person.health=person.child?1:THREE.MathUtils.clamp(person.health,.1,1);person.speed=THREE.MathUtils.clamp(person.speed,.3,1.2);person.recovery=THREE.MathUtils.clamp(person.recovery,0,10);person.wait=THREE.MathUtils.clamp(person.wait,0,10);person.timer=THREE.MathUtils.clamp(person.timer,0,10);
      person.node=item.node;person.goal=item.goal;person.previous=Number.isInteger(item.previous)?item.previous:-1;person.state=['stroll','panic','curious','fallen'].includes(item.state)?item.state:'stroll';person.moving=item.moving===true;
    }
    for(const person of this.people)if(person.child){person.held=person.airborne=false;person.health=1;person.recovery=person.roll=person.pitch=person.vx=person.vy=person.vz=0;if(person.state==='fallen')person.state='panic';}
    if(Number.isFinite(saved.clock)&&saved.clock>=0)this.clock=saved.clock;
    if(Number.isInteger(saved.seed))this.seed=saved.seed>>>0;
    return true;
  }
  get stats() {return {population:this.people.length,adults:this.people.filter(p=>!p.child).length,children:this.people.filter(p=>p.child).length,injured:this.people.filter(p=>p.health<1).length,walking:this.people.filter(p=>p.moving).length,panicking:this.people.filter(p=>p.state==='panic').length,curious:this.people.filter(p=>p.state==='curious').length};}
}

/** Instancing keeps the whole town to nine draw calls. */
export function createPedestrians({group,scenery,terrain,seed=17}) {
  const crowd=new TownCrowd({walkable:scenery.isWalkable,homes:scenery.pedestrianHomes,seed,count:scenery.residentCount??36,groundAt:(x,z)=>terrain.heightAt(x,z),obstacles:()=>scenery.colliders});
  const count=crowd.people.length;
  const root=new THREE.Group();root.name='Town life';group.add(root);
  const material=new THREE.MeshStandardMaterial({roughness:.9});
  function instances(name,geometry,total){const mesh=new THREE.InstancedMesh(geometry,material,total);mesh.name=name;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;root.add(mesh);return mesh;}
  const head=instances('People heads',new THREE.SphereGeometry(.17,8,6),count);
  const hair=instances('People hair',new THREE.SphereGeometry(.175,8,5,0,Math.PI*2,0,Math.PI*.52),count);
  const torso=instances('People coats',new THREE.CylinderGeometry(.16,.2,.43,8),count);
  const arms=instances('People arms',new THREE.CylinderGeometry(.055,.055,.215,6),count*4);
  const legs=instances('People legs',new THREE.CylinderGeometry(.07,.065,.245,6),count*4);
  const shoes=instances('People shoes',new THREE.BoxGeometry(.15,.1,.23),count*2);
  const mark=instances('People surprise marks',new THREE.CylinderGeometry(.032,.032,.28,6),count);
  const dot=instances('People surprise dots',new THREE.SphereGeometry(.045,6,4),count);
  const blood=instances('Adult impact flecks',new THREE.SphereGeometry(.028,5,4),48);blood.count=0;for(let i=0;i<48;i++)blood.setColorAt(i,new THREE.Color('#9e4c43'));
  const skins=['#e3b294','#bc8e6c','#91664d','#714f3e'];const coats=['#ca816b','#85a9b0','#e5bb71','#a3b28b','#a294b7','#dba69f'];
  for(let i=0;i<count;i++){const skin=new THREE.Color(skins[i%skins.length]),coat=new THREE.Color(coats[i%coats.length]);head.setColorAt(i,skin);hair.setColorAt(i,new THREE.Color(['#514239','#6b503e','#302e2b','#b99568'][i%4]));torso.setColorAt(i,coat);for(let side=0;side<2;side++){for(let joint=0;joint<2;joint++){arms.setColorAt(i*4+side*2+joint,coat);legs.setColorAt(i*4+side*2+joint,new THREE.Color('#4e615e'));}shoes.setColorAt(i*2+side,new THREE.Color('#39433d'));}mark.setColorAt(i,new THREE.Color('#edb854'));dot.setColorAt(i,new THREE.Color('#edb854'));}
  const dummy=new THREE.Object3D();
  const body=new THREE.Object3D(),local=new THREE.Object3D();
  function place(mesh,index,person,x,y,z,rotation=0,visible=true){local.position.set(x,y,z);local.rotation.set(rotation,0,0);local.scale.setScalar(visible?1:0);local.updateMatrix();dummy.matrix.multiplyMatrices(body.matrix,local.matrix);mesh.setMatrixAt(index,dummy.matrix);}
  function render(){for(const person of crowd.people){
    const i=person.id,bob=person.moving?Math.abs(Math.sin(person.phase))*.025:Math.sin(crowd.clock*1.7+person.phase)*.008;
    body.position.set(person.x,(person.airborne||person.held?person.y:terrain.heightAt(person.x,person.z))+(person.recovery>0&&!person.airborne?.22:0),person.z);body.rotation.set(person.pitch,person.heading,person.roll,'YXZ');body.scale.setScalar(person.child?.65:1);body.updateMatrix();
    place(head,i,person,0,1.27+bob,0);place(hair,i,person,0,1.28+bob,0);place(torso,i,person,0,.86+bob,0);
    const fallen=person.airborne||person.held||person.recovery>0;
    for(let side=0;side<2;side++){
      const sign=side?-1:1,swing=fallen?Math.sin(crowd.clock*9+side*2)*.6:person.moving?Math.sin(person.phase)*.5*sign:0,knee=fallen?.8+Math.sin(crowd.clock*7+side)*.5:Math.max(0,swing)*.7;
      const kneeY=.59-Math.cos(swing)*.245,kneeZ=-Math.sin(swing)*.245;
      place(legs,i*4+side*2,person,sign*.1,.59-Math.cos(swing)*.1225,-Math.sin(swing)*.1225,swing);
      place(legs,i*4+side*2+1,person,sign*.1,kneeY-Math.cos(swing-knee)*.1225,kneeZ-Math.sin(swing-knee)*.1225,swing-knee);
      place(shoes,i*2+side,person,sign*.1,kneeY-Math.cos(swing-knee)*.245+.035,kneeZ-Math.sin(swing-knee)*.245+.04,swing-knee);
      const raised=fallen?2+Math.sin(crowd.clock*11+side)*.5:person.state==='panic'?2.5+Math.sin(crowd.clock*12+person.phase)*.25:person.state==='curious'?1.8+Math.sin(crowd.clock*6)*.25:person.wait>1&&side===0?1.9:swing,elbow=fallen?.9+Math.sin(crowd.clock*8+side)*.5:.25;
      const elbowY=1.06-Math.cos(raised)*.215+bob,elbowZ=Math.sin(raised)*.215;
      place(arms,i*4+side*2,person,sign*.23,1.06-Math.cos(raised)*.1075+bob,Math.sin(raised)*.1075,-raised);
      place(arms,i*4+side*2+1,person,sign*.23,elbowY-Math.cos(raised+elbow)*.1075,elbowZ+Math.sin(raised+elbow)*.1075,-raised-elbow);
    }
    const alarm=person.state!=='stroll'&&!fallen;place(mark,i,person,0,1.92+bob+Math.sin(crowd.clock*8)*.035,0,0,alarm);place(dot,i,person,0,1.67+bob,0,0,alarm);
    torso.setColorAt(i,new THREE.Color(coats[i%coats.length]).multiplyScalar(.7+.3*person.health));
  }blood.count=crowd.blood.length;crowd.blood.forEach((drop,i)=>{dummy.position.set(drop.x,drop.y,drop.z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(Math.min(1,drop.life));dummy.updateMatrix();blood.setMatrixAt(i,dummy.matrix);});for(const mesh of root.children){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}if(torso.instanceColor)torso.instanceColor.needsUpdate=true;}
  function pick(hit){if(![head,hair,torso,arms,legs,shoes].includes(hit.object)||!Number.isInteger(hit.instanceId))return null;return crowd.people[[arms,legs].includes(hit.object)?Math.floor(hit.instanceId/4):hit.object===shoes?Math.floor(hit.instanceId/2):hit.instanceId];}
  render();
  return {crowd,targets:[head,hair,torso,arms,legs,shoes],pick,lift:(id,height)=>crowd.lift(id,height),move:(...args)=>crowd.move(...args),release:(...args)=>crowd.release(...args),blast:(...args)=>crowd.blast(...args),react:(...args)=>crowd.react(...args),update:(dt,cars,gravity)=>{crowd.update(dt,cars,gravity);render();},reset:()=>{crowd.reset();render();},exportState:()=>crowd.exportState(),restoreState:saved=>{const restored=crowd.restoreState(saved);render();return restored;},get stats(){return crowd.stats;}};
}
