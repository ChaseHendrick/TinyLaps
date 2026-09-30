import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RaceSimulation } from './race.js';
import { buildScenery } from './scenery.js';
import { createCar, updateCarDamage, updateCarEffects } from './cars.js';
import { TerrainSystem } from './terrain.js';
import { setupDevTools } from './devtools.js';
import { buildCityRoads, createCityTraffic } from './city.js';
import { createWater } from './water.js';
import { TRACKS } from './tracks.js';
import { buildTrack } from './track.js';
import { createPedestrians } from './pedestrians.js';
import { readRace, restoreRace, writeRace } from './persistence.js';
import { setupDrivingInput } from './driving-input.js';

const $ = id => document.getElementById(id);
const mod = (x,n) => ((x%n)+n)%n;
const themes = TRACKS;
let renderer,scene,camera,controls,world,sim,scenery,track,carModels=[],carMeshes=[],selected=0,mode='orbit',theme='harbor',paused=false,speed=1,elapsed=0,lastUI=0,worldTime=0,soundEnabled=false,audio=null,tourAngle=.9,uiHidden=false,aggression=.85;
let skidMesh,sparkMesh,skidIndex=0,skidClock=0,lastEventId=-1,sparks=[];
let terrain,devTools,environment,barriers=[],barrierMesh,people,traffic,water;
const effectDummy=new THREE.Object3D();
let followDistance=10,followElevation=5,followAzimuth=0,tourRadius=130,drag=null,lastPinch=null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const down = new THREE.Vector2();
const cameraGoal = new THREE.Vector3(), lookGoal=new THREE.Vector3(), smoothedLook=new THREE.Vector3();
const sun = new THREE.DirectionalLight(0xffedd2,3.2);
const hemisphere = new THREE.HemisphereLight(0xeef7ff,0x68815a,1.65);
let selectionRing;
let toastTimer;
let boardPreference=null,detailsPreference=null,pauseBeforeMaps=false,uiReturnFocus=null;
let savedRace=null,lastSave=0,storageWarned=false;
let drivingInput;
try{savedRace=readRace(localStorage,themes)}catch{storageWarned=true;queueMicrotask(()=>toast('The previous save could not be loaded. A fresh race is ready.'))}
function saveRace(){if(!sim||!terrain||!scenery)return;try{writeRace(localStorage,{sim,terrain,scenery,barriers,people,traffic,water,view:{theme,selected,mode,driving:sim.playerCarId!==null,paused:$('world-dialog').open?pauseBeforeMaps:paused,speed,worldTime,boardPreference,detailsPreference,camera:camera.position.toArray(),target:controls.target.toArray(),followDistance,followElevation,followAzimuth,tourRadius,tourAngle}})}catch{if(!storageWarned){storageWarned=true;toast('Browser storage is unavailable. This race stays in this session.')}}}
const compactUI=matchMedia('(max-width:700px), (max-height:560px)');
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2300)}
function material(color,roughness=.82){return new THREE.MeshStandardMaterial({color,roughness})}
function surfaceLayer(mat,layer=1){mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-layer;return mat}
function mesh(geometry,mat,parent,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.receiveShadow=true;parent.add(m);return m}
function batch(parts,mat,parent){const gs=parts.map(p=>{p.updateMatrix();return p.geometry.clone().applyMatrix4(p.matrix)});if(!gs.length)return;const m=mesh(mergeGeometries(gs),mat,parent);m.castShadow=true;gs.forEach(g=>g.dispose());return m}
function rounded(w,h,d,r=.1){return new RoundedBoxGeometry(w,h,d,2,r)}

function ribbon(width,offset=0,yOffset=0){
 const pos=[],indices=[],N=track.samples.length;
 for(let i=0;i<=N;i++){const p=track.samples[i%N],nx=p.tz,nz=-p.tx;for(const s of [-1,1]){const d=offset+width*.5*s;pos.push(p.x+nx*d,p.y+yOffset,p.z+nz*d)}if(i<N){let j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3)}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function buildRoad(){
 if(!themes[theme].city){
 mesh(ribbon(8.3,0,-.04),material(0xd6ceb4),world);
 const asphalt=mesh(ribbon(7.0),material(0x5f6b69),world);asphalt.receiveShadow=true;
 const paint=material(0xecebd5),red=material(0xca755e);
 const linePaint=surfaceLayer(paint.clone(),2);mesh(ribbon(.1,-3.15,.012),linePaint,world);mesh(ribbon(.1,3.15,.012),linePaint,world);
 const dashes=[],kerbsA=[],kerbsB=[],posts=[],rails=[];
 const geo=new THREE.BoxGeometry(.1,.028,1.15);
 for(let d=0;d<track.length;d+=4){const p=track.sampleAtDistance(d);const m=new THREE.Mesh(geo);m.position.set(p.x,p.y+.025,p.z);m.rotation.y=Math.atan2(p.tx,p.tz);dashes.push(m)}batch(dashes,paint,world);
 const curbGeo=new THREE.BoxGeometry(.42,.1,.92);
 for(let d=0;d<track.length;d+=1.0){const p=track.sampleAtDistance(d);if(Math.abs(p.curvature)>.045)for(const side of [-1,1]){const m=new THREE.Mesh(curbGeo);m.position.set(p.x+p.tz*3.45*side,p.y+.025,p.z-p.tx*3.45*side);m.rotation.y=Math.atan2(p.tx,p.tz);(Math.floor(d)%2?kerbsA:kerbsB).push(m)}}batch(kerbsA,paint,world);batch(kerbsB,red,world);
 for(let d=0;d<track.length;d+=5.0){const p=track.sampleAtDistance(d);if(p.y>.7){const m=new THREE.Mesh(new THREE.CylinderGeometry(.4,.52,p.y+3.32,10));m.position.set(p.x,-3.4+(p.y+3.32)*.5,p.z);posts.push(m)}}
 batch(posts,material(0xc4c3b6),world);
 }
 const paint=material(0xecebd5);
 const start=track.sampleAtDistance(0);const line=new THREE.Group();line.position.set(start.x,start.y+.027,start.z);line.rotation.y=Math.atan2(start.tx,start.tz);world.add(line);const black=material(0x2f3e3b);let dark=[],light=[];
 for(let x=0;x<12;x++)for(let z=0;z<2;z++){const m=new THREE.Mesh(new THREE.BoxGeometry(7/12,.025,.42));m.position.set(-3.5+(x+.5)*7/12,0,z*.42);((x+z)%2?dark:light).push(m)}batch(dark,black,line);batch(light,paint,line);
 const arch=new THREE.Group();arch.position.set(start.x,start.y,start.z);arch.rotation.y=line.rotation.y;world.add(arch);
 for(const x of [-4.9,4.9])mesh(new THREE.CylinderGeometry(.16,.2,4.7,12),paint,arch,x,2.35,0).castShadow=true;
 const banner=mesh(rounded(10.7,1,.3,.12),material(0xd58b6b),arch,0,4.55,0);banner.castShadow=true;
 const c=document.createElement('canvas');c.width=768;c.height=96;const cx=c.getContext('2d');cx.fillStyle='#d58b6b';cx.fillRect(0,0,768,96);cx.fillStyle='#fff6df';cx.textAlign='center';cx.font='600 44px sans-serif';cx.fillText('T I N Y   L A P S',384,66);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;mesh(new THREE.PlaneGeometry(8,.85),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}),arch,0,4.55,.16);
}
function islandShape(scale=1){const s=new THREE.Shape();if(themes[theme]?.city){const x=64*scale,z=47*scale,r=6*scale;s.moveTo(-x+r,-z);s.lineTo(x-r,-z);s.quadraticCurveTo(x,-z,x,-z+r);s.lineTo(x,z-r);s.quadraticCurveTo(x,z,x-r,z);s.lineTo(-x+r,z);s.quadraticCurveTo(-x,z,-x,z-r);s.lineTo(-x,-z+r);s.quadraticCurveTo(-x,-z,-x+r,-z);return s;}for(let i=0;i<=120;i++){const a=i/120*Math.PI*2,r=1+.032*Math.sin(a*3+.2)+.022*Math.cos(a*5);const x=Math.cos(a)*64*r*scale,z=Math.sin(a)*47*r*scale;if(i===0)s.moveTo(x,-z);else s.lineTo(x,-z)}return s}
function buildIsland(config){
 const g=new THREE.ExtrudeGeometry(islandShape(),{depth:3.4,bevelEnabled:true,bevelSegments:5,steps:1,bevelSize:1.5,bevelThickness:1.1,curveSegments:64});g.rotateX(-Math.PI/2);g.translate(0,-4.64,0);const retained=[];const normal=g.attributes.normal;for(let i=0;i<normal.count;i+=3){if(normal.getY(i)>.97&&g.attributes.position.getY(i)>-.2)continue;retained.push(i,i+1,i+2)}g.setIndex(retained);mesh(g,material(config.sand),world);
 terrain=new TerrainSystem({group:world,grassColor:config.grass,sandColor:config.sand,shape:config.city?'tile':'island'});
 const ocean=mesh(new THREE.PlaneGeometry(2000,2000),material(config.water,.32),world,0,-3,0);ocean.rotation.x=-Math.PI/2;
 const white=surfaceLayer(new THREE.MeshBasicMaterial({color:0xf5f4dd,transparent:true,opacity:.26,depthWrite:false}),1);const waves=[];const random=seeded(123);
 for(let i=0;i<180;i++){const x=(random()-.5)*350,z=(random()-.5)*270;if((x*x/69**2+z*z/52**2)<1.1)continue;const m=new THREE.Mesh(new THREE.PlaneGeometry(1+random()*3,.12));m.rotation.x=-Math.PI/2;m.rotation.z=random()*.25;m.position.set(x,-2.97,z);waves.push(m)}const waveMesh=batch(waves,white,world);if(waveMesh)waveMesh.castShadow=false;
 if(config.city)return;
 // Pale beaches hug the rounded edge of the island.
 const shore=new THREE.BufferGeometry(),pos=[],ind=[];for(let i=0;i<=200;i++){const a=i/200*Math.PI*2,r=1+.032*Math.sin(a*3+.2)+.022*Math.cos(a*5);for(const q of [.966,1.037])pos.push(Math.cos(a)*64*r*q,.015,Math.sin(a)*47*r*q);if(i<200){const j=i*2;ind.push(j,j+2,j+1,j+1,j+2,j+3)}}shore.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));shore.setIndex(ind);shore.computeVertexNormals();terrain.registerMesh(mesh(shore,surfaceLayer(material(0xe2cfaa),2),world));
}
function buildRiver(){
 const river=new THREE.CatmullRomCurve3([[12,-40],[24,-28],[33,-16],[45,-12],[64,-5]].map(([x,z])=>new THREE.Vector3(x,.038,z)));
 const strip=(width,y)=>{const pos=[],ind=[];for(let i=0;i<=200;i++){const p=river.getPointAt(i/200),t=river.getTangentAt(i/200);for(const side of [-1,1])pos.push(p.x+t.z*width*.5*side,y,p.z-t.x*width*.5*side);if(i<200){const j=i*2;ind.push(j,j+2,j+1,j+1,j+2,j+3)}}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(ind);geo.computeVertexNormals();return geo};
  terrain.registerMesh(mesh(strip(6.2,.026),surfaceLayer(material(0xd0c9a4),3),world));
}
function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296}}
function disposeWorld(){if(!world)return;const geos=new Set(),mats=new Set(),textures=new Set();world.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geos.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:o.material?[o.material]:[])){mats.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());scene.remove(world)}
function makeWorld(key){
 drivingInput?.clear();
 theme=key;const cfg=themes[key],setting=cfg.setting||key;disposeWorld();world=new THREE.Group();scene.add(world);scene.background=new THREE.Color(cfg.sky);scene.fog=new THREE.Fog(cfg.sky,180,600);sun.color.setHex(cfg.sun);sun.position.set(setting==='sunset'?-65:-40,setting==='sunset'?55:85,45);hemisphere.groundColor.setHex(setting==='sunset'?0x9c7858:0x68815a);
 track=buildTrack(cfg);buildIsland(cfg);if(cfg.river)buildRiver();water=createWater({group:world,terrain,river:!!cfg.river});const roadStart=world.children.length;buildRoad();world.updateMatrixWorld(true);world.children.slice(roadStart).forEach(o=>o.traverse(m=>{if(m.isMesh)terrain.registerMesh(m)}));buildBarriers();scenery=buildScenery({group:world,theme:setting,river:!!cfg.river,samples:track.samples.filter((_,i)=>i%6===0),seed:cfg.seed||17,city:cfg.city});scenery.setGroundSampler((x,z)=>terrain.heightAt(x,z));scenery.setWaterSampler(water.sample);people=createPedestrians({group:world,scenery,terrain,seed:cfg.seed||17});traffic=null;if(scenery.cityPlan){buildCityRoads({group:world,plan:scenery.cityPlan,terrain});traffic=createCityTraffic({group:world,plan:scenery.cityPlan,terrain,scenery});}environment={colliders:scenery.colliders,sampleSurface:(x,z,y)=>terrain.sampleSurface(x,z,y),barrierAt:(distance,side)=>barriers[Math.floor(mod(distance,track.length)/track.length*(barriers.length/2))*2+(side>0?1:0)],impact:(collider,event)=>{if(event.severity>.1)people.react(event.x,event.z,9,'car');if(collider.kind==='barrier'){collider.health=Math.max(0,collider.health-event.severity*2.2);updateBarriers()}else scenery.applyImpact(collider.id,event);if(event.severity>.2)terrain.impact(event.x,event.z,event.severity*.14,1.2)},vehicles:()=>traffic?.cars||[],routeRevision:cfg.routeRevision||1,speedLimit:cfg.city?12:undefined,cornerSafety:cfg.city?.82:1,damageTerrain:(x,z,severity)=>terrain.impact(x,z,severity*.05,.9)};sim=new RaceSimulation(track.length,track.sampleAtDistance,environment);sim.setAggression(aggression);scenery.setInteractionHandlers({vehicles:()=>allCars(),strike:(id,impulse,magnitude)=>{if(id<10)sim.strikeCar(id,impulse,magnitude);else{traffic.model.impulse(id,impulse);traffic.model.hurt(carById(id),magnitude/carById(id).mass);}},react:(x,z,r,force)=>people.blast(x,z,r,Math.min(1,force/18))});elapsed=0;carModels=[];carMeshes=[];
 sim.cars.forEach((car,i)=>{const g=createCar(car.color,i+1,i);g.rotation.order='YXZ';g.userData.carId=i;g.traverse(c=>{if(c.isMesh&&c!==g.userData.selectionRing){c.userData.carId=i;carMeshes.push(c)}});world.add(g);carModels.push(g)});
 selectionRing=mesh(new THREE.RingGeometry(1.14,1.22,48),new THREE.MeshBasicMaterial({color:0xffefd4,side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false}),world);selectionRing.rotation.x=-Math.PI/2;
 buildEffects();
 $('map-title').textContent=cfg.name;$('current-world').textContent=cfg.name;document.querySelectorAll('[data-theme]').forEach(b=>{b.classList.toggle('active',b.dataset.theme===key);b.setAttribute('aria-pressed',String(b.dataset.theme===key))});buildLeaderboard();updateCarModels(0);setMode('orbit');homeCamera();updateUI();
}
function allCars(){return [...sim.cars,...(traffic?.cars||[])];}
function carById(id){return id<10?sim.cars[id]:traffic?.cars.find(c=>c.id===id);}
function impulseCar(id,impulse){return id<10?sim.applyImpulse(id,impulse):traffic?.model.impulse(id,impulse);}
function teleportCar(id,x,z,heading){return id<10?sim.teleportCar(id,x,z,heading):traffic?.model.teleport(id,x,z);}
function buildBarriers(){
 const count=Math.ceil(track.length/5),length=track.length/count;barriers=[];
 const rail=new THREE.BoxGeometry(.13,.15,length*.97);rail.translate(0,.54,0);const post=new THREE.CylinderGeometry(.055,.065,.59,6);post.translate(0,.295,0);barrierMesh=new THREE.InstancedMesh(mergeGeometries([rail.toNonIndexed(),post.toNonIndexed()]),material(0xb6c0b5),count*2);barrierMesh.castShadow=true;barrierMesh.receiveShadow=true;world.add(barrierMesh);
 for(let i=0;i<count;i++){const p=track.sampleAtDistance((i+.5)*length);for(const side of [-1,1])barriers.push({id:`barrier-${i}-${side}`,kind:'barrier',side,health:1,radius:.2,mass:1200,x:p.x-p.tz*4.1*side,z:p.z+p.tx*4.1*side,y:p.y,heading:Math.atan2(p.tx,p.tz),distance:(i+.5)*length})}if(themes[theme].city){for(const b of barriers){b.health=0;b.solid=false;b.junction=true;}}updateBarriers();
}
function updateBarriers(){if(!barrierMesh)return;barriers.forEach((b,i)=>{effectDummy.position.set(b.x,b.y+terrain.heightAt(b.x,b.z),b.z);effectDummy.rotation.set(0,b.heading,b.health<=0?b.side*1.35:(1-b.health)*b.side*.4);effectDummy.scale.setScalar(b.junction?0:1);if(b.health<=0)effectDummy.position.y-=.16;effectDummy.updateMatrix();barrierMesh.setMatrixAt(i,effectDummy.matrix)});barrierMesh.instanceMatrix.needsUpdate=true}
function damageWorldAt(x,z,radius,energy){scenery.damageAt(x,z,radius,energy);for(const b of barriers){const d=Math.hypot(b.x-x,b.z-z);if(d<radius)b.health=Math.max(0,b.health-(1-d/radius)*energy/16000)}updateBarriers()}
function buildLeaderboard(){
 $('leaderboard').innerHTML=sim.cars.map(car=>`<button class="racer" data-car="${car.id}" aria-label="Follow ${car.name}"><span class="rank"></span><span class="car-dot" style="background:${new THREE.Color(car.color).getStyle()}"></span><span class="name">${car.name}<i class="damage-warning"></i></span><span class="gap"></span></button>`).join('');
 $('leaderboard').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>selectCar(Number(b.dataset.car),true)));
}
function selectCar(id,follow=false){const driving=sim.playerCarId!==null;selected=mod(id,sim.cars.length);if(driving){drivingInput?.clear();sim.setPlayerCar(selected);$('world').focus();}if(follow)setMode('follow');updateUI()}
function setDriving(value,{restore=false}={}){
 drivingInput?.clear();if(value){devTools?.close();sim.setPlayerCar(selected);if(!restore){setDetailsExpanded(false);if(compactUI.matches)setBoardCollapsed(true);setMode('follow');setSpeed(1);setPaused(false);if(uiHidden)toggleUI();$('world').focus();toast(`You are driving ${sim.cars[selected].name}. WASD or arrows steer, accelerate, and reverse.`);}}
 else{sim.setPlayerCar(null);if(!restore)toast('The autonomous driver is back at the wheel');}
 updateUI();if(!restore)saveRace();
}
function recoverDriver(){
 if(sim.playerCarId===null)return;drivingInput?.clear();const car=sim.cars[selected],step=track.length/1800;
 for(let offset=0;offset<40;offset++){
  const distance=car.distance+offset*step*3,p=track.sampleAtDistance(distance);
  const clear=!allCars().some(c=>c!==car&&!c.held&&Math.hypot(c.x-p.x,c.z-p.z)<3)
    &&!scenery.colliders.some(c=>c.solid&&!c.held&&Math.hypot(c.x-p.x,c.z-p.z)<c.radius+1.3);
  if(clear){sim.teleportCar(car.id,p.x,p.z,Math.atan2(p.tx,p.tz));updateCarModels(0);updateUI();saveRace();toast('Back on the road. Your car keeps its damage.');return;}
 }
 toast('The road is busy. Try returning when there is a gap.');
}
function formatTime(s){return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}
function updateUI(){
 const order=[...sim.cars].sort((a,b)=>b.progress-a.progress),leader=order[0],car=sim.cars[selected];
 order.forEach((c,i)=>{const b=$('leaderboard').querySelector(`[data-car="${c.id}"]`);b.style.order=i;b.classList.toggle('selected',c.id===selected);b.querySelector('.rank').textContent=String(i+1).padStart(2,'0');b.querySelector('.gap').textContent=i===0?'LEAD':`+${((leader.progress-c.progress)/Math.max(leader.speed,1)).toFixed(1)}`;b.querySelector('.damage-warning').textContent=c.damage.total>.25?'!':'';b.querySelector('.car-dot').classList.toggle('damaged',c.damage.total>.25)});
 $('race-time').textContent=formatTime(elapsed);$('lap').textContent=`LAP ${Math.max(...sim.cars.map(c=>c.laps))+1}`;
 $('selected-name').textContent=car.name;$('selected-color').style.background=new THREE.Color(car.color).getStyle();$('selected-number').textContent='#'+String(car.id+1).padStart(2,'0');$('car-speed').textContent=Math.round(car.speed*3.6);$('car-laps').textContent=car.laps;$('car-position').textContent=order.findIndex(c=>c.id===selected)+1;
 const driving=sim.playerCarId!==null;document.body.classList.toggle('driving-mode',driving);$('drive-racer').textContent=driving?'Let AI drive':'Drive this car';$('drive-racer').setAttribute('aria-pressed',String(driving));$('driving-controls').hidden=!driving;$('driving-name').textContent=car.name;$('driving-help').textContent=paused?'Paused. Resume to drive.':'WASD or arrows · Shift to brake · Space to pause';
 $('best-lap').textContent=car.bestLap&&Number.isFinite(car.bestLap)?`Best lap · ${car.bestLap.toFixed(2)}s`:'Best lap · waiting for a lap';$('selected-mode').textContent=driving?'YOU ARE DRIVING':mode==='ride'?'RIDING WITH':mode==='follow'?'FOLLOWING':'IN THE SPOTLIGHT';drawMap();
 $('driver-personality').textContent=car.personality.label;$('driver-description').textContent=car.personality.description;$('driver-intent').textContent=car.intent||'Looking for a gap';const condition=Math.round((1-car.damage.total)*100);$('car-condition').textContent=condition+'%';$('condition-fill').style.width=condition+'%';$('condition-fill').style.background=condition<45?'#bd725b':condition<75?'#c5a366':'#83a873';$('car-contacts').textContent=car.impacts?`${car.impacts} contact${car.impacts===1?'':'s'}`:'No contacts yet';$('car-surface').textContent=car.airborne?'In the air':car.held?'Held by you':car.surface==='grass'?'In the grass':car.slip>.2?'Tires slipping':'On the tarmac';
}
function drawMap(){const c=$('minimap'),ctx=c.getContext('2d'),W=c.width,H=c.height,s=2.42,ox=W/2,oz=H/2+3;ctx.clearRect(0,0,W,H);if(scenery.cityPlan){ctx.lineWidth=3;ctx.strokeStyle='#c8cebb';for(const e of scenery.cityPlan.edges){const a=scenery.cityPlan.nodes[e.a],b=scenery.cityPlan.nodes[e.b];ctx.beginPath();ctx.moveTo(ox+a.x*s,oz+a.z*s);ctx.lineTo(ox+b.x*s,oz+b.z*s);ctx.stroke();}for(const c of traffic.cars){ctx.fillStyle='#a5aaa0';ctx.fillRect(ox+c.x*s-1,oz+c.z*s-1,2,2);}}ctx.beginPath();track.samples.forEach((p,i)=>{const x=ox+p.x*s,z=oz+p.z*s;i?ctx.lineTo(x,z):ctx.moveTo(x,z)});ctx.closePath();ctx.lineWidth=11;ctx.strokeStyle='#dce0ce';ctx.stroke();ctx.lineWidth=5;ctx.strokeStyle='#96a48e';ctx.stroke();sim.cars.forEach(car=>{const p=car;const x=ox+p.x*s,y=oz+p.z*s;if(car.id===selected){ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.strokeStyle='#375b49';ctx.lineWidth=2;ctx.stroke()}ctx.beginPath();ctx.arc(x,y,car.id===selected?4.2:3.2,0,Math.PI*2);ctx.fillStyle=new THREE.Color(car.color).getStyle();ctx.fill()})}
function homeCamera(){camera.position.set(95,100,123).multiplyScalar(Math.max(1,1.45/camera.aspect));controls.target.set(0,0,0);controls.update();smoothedLook.set(0,0,0)}
function setMode(next){mode=next;controls.enabled=next==='orbit'&&!devTools?.active();controls.autoRotate=false;if(next==='orbit')controls.target.copy(smoothedLook);if(next==='follow'){followDistance=10;followElevation=5;followAzimuth=0}if(next==='tour')tourAngle=Math.atan2(camera.position.z,camera.position.x);document.querySelectorAll('[data-camera]').forEach(b=>{b.classList.toggle('active',b.dataset.camera===next);b.setAttribute('aria-pressed',String(b.dataset.camera===next))});$('hint').innerHTML=next==='orbit'?'Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a car to follow':next==='follow'?'Drag to orbit your racer <span>·</span> Scroll to get closer':next==='ride'?'The best seat in the little world <span>·</span> ← → change racer':'Sit back. Take the scenic route.';updateUI();focusDriver();}
function focusDriver(){if(sim?.playerCarId!=null)$('world').focus();}
function zoom(f){if(mode==='orbit'){camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update()}else if(mode==='follow')followDistance=THREE.MathUtils.clamp(followDistance*f,3,35);else if(mode==='tour'){tourRadius=THREE.MathUtils.clamp(tourRadius*f,30,260)}else toast('Choose Follow or Explore to zoom')}
function updateCarModels(dt){sim.cars.forEach(car=>{
 const p=track.sampleAtDistance(car.distance),g=carModels[car.id],fx=Math.sin(car.heading),fz=Math.cos(car.heading);
 const grade=(p.ty||0)*(p.tx*fx+p.tz*fz);
 let pitch=-Math.atan(grade),roll=car.bank;
 if(terrain&&!car.airborne){
  const front=terrain.heightAt(car.x+fx*.65,car.z+fz*.65),rear=terrain.heightAt(car.x-fx*.65,car.z-fz*.65);
  const right=terrain.heightAt(car.x+fz*.5,car.z-fx*.5),left=terrain.heightAt(car.x-fz*.5,car.z+fx*.5);
  pitch=-Math.atan(grade+(front-rear)/1.3);roll+=Math.atan(right-left);
 }
 g.position.set(car.x,car.y+.025,car.z);g.rotation.set(THREE.MathUtils.clamp(pitch,-.5,.5),car.heading,THREE.MathUtils.clamp(roll,-.45,.45));
 for(const w of g.userData.wheels||[]){w.rotation.x=car.wheelAngle;if(w.userData.axle==='front')w.rotation.y=car.steering||0}
 if(g.userData.selectionRing)g.userData.selectionRing.visible=false;updateCarDamage(g,car.damage);updateCarEffects(g,worldTime,car.damage)
 });const g=carModels[selected];selectionRing.position.set(g.position.x,g.position.y+.006,g.position.z);selectionRing.visible=mode!=='ride'}
function buildEffects(){
 skidIndex=0;skidClock=0;lastEventId=-1;sparks=[];
 skidMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(.11,.65),new THREE.MeshBasicMaterial({color:0x2c332f,transparent:true,opacity:.2,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),1600);skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);skidMesh.frustumCulled=false;world.add(skidMesh);
 sparkMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.026,5,4),new THREE.MeshBasicMaterial({color:0xffd28b}),64);sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sparkMesh.frustumCulled=false;world.add(sparkMesh);effectDummy.scale.setScalar(0);effectDummy.updateMatrix();for(let i=0;i<1600;i++)skidMesh.setMatrixAt(i,effectDummy.matrix);for(let i=0;i<64;i++)sparkMesh.setMatrixAt(i,effectDummy.matrix);skidMesh.instanceMatrix.needsUpdate=true;sparkMesh.instanceMatrix.needsUpdate=true;
}
function resetRace(){
 drivingInput?.clear();
 terrain.reset();scenery.reset();people?.reset();traffic?.reset();water?.reset();barriers.forEach(b=>b.health=b.junction?0:1);updateBarriers();sim.reset();sim.setAggression(aggression);elapsed=0;lastEventId=-1;sparks=[];skidIndex=0;skidClock=0;
 effectDummy.scale.setScalar(0);effectDummy.updateMatrix();for(let i=0;i<1600;i++)skidMesh.setMatrixAt(i,effectDummy.matrix);for(let i=0;i<64;i++)sparkMesh.setMatrixAt(i,effectDummy.matrix);skidMesh.instanceMatrix.needsUpdate=true;sparkMesh.instanceMatrix.needsUpdate=true;
 updateCarModels(0);updateUI();toast('Fresh cars, repaired roads. A new race.')
}
function setPaused(value){drivingInput?.clear();paused=value;$('pause').setAttribute('aria-pressed',String(paused));$('pause').setAttribute('aria-label',paused?'Resume race':'Pause race');$('pause').title=paused?'Resume race':'Pause race';$('pause').innerHTML=paused?'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';document.querySelectorAll('.race-title .live-dot,.brand .live-dot').forEach(dot=>dot.classList.toggle('paused',paused));if(sim)updateUI();}
function setSpeed(value){speed=value;$('speed').textContent=speed+'×';$('speed').setAttribute('aria-label',`Race speed ${speed} times. Change speed`);$('speed').title=`Race speed: ${speed}×`}
function setBoardCollapsed(value){$('standings').classList.toggle('collapsed',value);$('collapse-board').textContent=value?'+':'−';$('collapse-board').setAttribute('aria-label',value?'Expand standings':'Collapse standings');$('collapse-board').setAttribute('aria-expanded',String(!value))}
function setDetailsExpanded(value){$('selected').classList.toggle('show-details',value);$('driver-details').hidden=!value;$('details-toggle').setAttribute('aria-expanded',String(value));$('details-toggle').textContent=value?'Less':'Details'}
function fitUI(){setBoardCollapsed(boardPreference??compactUI.matches);setDetailsExpanded(detailsPreference??!compactUI.matches)}
function sceneryPreview(city){return city.xs.map(x=>`<path class="world-streets" d="M${x+62} 16V72"/>`).join('')+city.zs.map(z=>`<path class="world-streets" d="M22 ${z+44}H102"/>`).join('');}
function buildWorldChooser(){
 $('world-count').textContent=Object.keys(themes).length+' worlds · 3 cities';
 $('world-grid').innerHTML=Object.entries(themes).sort((a,b)=>Number(!!b[1].city)-Number(!!a[1].city)).map(([key,cfg],i)=>{const preview=buildTrack(cfg);const line=Array.from({length:101},(_,j)=>{const p=preview.sampleAtDistance(preview.length*j/100);return `${j?'L':'M'}${(p.x+62).toFixed(1)},${(p.z+44).toFixed(1)}`}).join(' ')+'Z';return `<button class="world-option" data-theme="${key}" aria-pressed="${key===theme}" data-world-kind="${cfg.city?'city':'circuit'}"><svg viewBox="0 0 124 88" aria-hidden="true"><path class="world-land" d="M2 44C2 13 29 2 62 2S122 15 122 44S94 86 62 86S2 74 2 44Z"/><path class="world-track" d="${line}"/>${cfg.city?sceneryPreview(cfg.city):''}</svg><span class="world-option-title"><span>${String(i+1).padStart(2,'0')}</span><b>${cfg.name}</b></span><span class="world-option-description">${cfg.description}</span><span class="world-option-meta">${cfg.city?'City · Connected streets':cfg.difficulty+' · '+(cfg.setting==='alpine'?'Hills':cfg.setting==='sunset'?'Evening':'Coast')}</span></button>`}).join('');
 document.querySelectorAll('[data-world-filter]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-world-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('world-grid').querySelectorAll('[data-world-kind]').forEach(card=>card.hidden=button.dataset.worldFilter!=='all'&&card.dataset.worldKind!==button.dataset.worldFilter);});
 $('world-grid').querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{const key=button.dataset.theme;if(key!==theme){makeWorld(key);saveRace();toast(`Welcome to ${themes[key].name}`)}$('world-dialog').close()});
 $('choose-world').onclick=()=>{pauseBeforeMaps=paused;setPaused(true);$('choose-world').setAttribute('aria-expanded','true');$('world-dialog').showModal();$('world-grid').querySelector(`[data-theme="${theme}"]`).focus()};
 $('close-worlds').onclick=()=>$('world-dialog').close();$('world-dialog').addEventListener('close',()=>{setPaused(pauseBeforeMaps);$('choose-world').setAttribute('aria-expanded','false');$('choose-world').focus()});
 $('world-dialog').addEventListener('click',event=>{if(event.target!==$('world-dialog'))return;const r=$('world-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('world-dialog').close()});
}
function updateEffects(dt){
 skidClock+=dt;if(skidClock>.055&&!paused){skidClock=0;for(const c of sim.cars){if(c.airborne||c.held||c.speed<4||c.surface==='grass'||(Math.abs(c.slip)<.13&&c.brake<.75))continue;for(const side of [-1,1]){effectDummy.position.set(c.x+Math.cos(c.heading)*side*.46-Math.sin(c.heading)*.59,c.y+.035,c.z-Math.sin(c.heading)*side*.46-Math.cos(c.heading)*.59);effectDummy.rotation.set(-Math.PI/2,0,-c.heading);effectDummy.scale.set(1,Math.max(.2,c.speed*.06),1);effectDummy.updateMatrix();skidMesh.setMatrixAt(skidIndex++%1600,effectDummy.matrix)}}skidMesh.instanceMatrix.needsUpdate=true}
 for(const event of sim.events||[]){if(event.id<=lastEventId)continue;lastEventId=event.id;if(event.severity<.04)continue;const car=sim.cars[event.carIds.includes(selected)?selected:event.carIds[0]];for(let i=0;i<5;i++)sparks.push({x:event.x,y:car.y+.26,z:event.z,vx:(Math.random()-.5)*4,vy:1+Math.random()*2,vz:(Math.random()-.5)*4,life:.25+Math.random()*.2});if(event.carIds.includes(selected)&&event.severity>.22)toast(`${car.name} ${event.type==='barrier'?'clipped the barrier':'made contact'} · damage ${Math.round(car.damage.total*100)}%`)}
 sparks=sparks.filter(s=>s.life>0).slice(-64);for(let i=0;i<64;i++){const p=sparks[i];effectDummy.rotation.set(0,0,0);if(p){p.life-=dt;p.vy-=9.8*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;effectDummy.position.set(p.x,p.y,p.z);effectDummy.scale.setScalar(Math.min(1,p.life*7))}else effectDummy.scale.setScalar(0);effectDummy.updateMatrix();sparkMesh.setMatrixAt(i,effectDummy.matrix)}sparkMesh.instanceMatrix.needsUpdate=true;
}
function updateCamera(dt){
 if(mode==='orbit'){controls.update();smoothedLook.copy(controls.target);return}
 const car=sim.cars[selected],g=carModels[selected],p=track.sampleAtDistance(car.distance);const v=new THREE.Vector3(Math.sin(car.heading),0,Math.cos(car.heading));
 if(mode==='follow'){const angle=car.heading+followAzimuth;cameraGoal.set(g.position.x-Math.sin(angle)*followDistance,g.position.y+followElevation+followDistance*.12,g.position.z-Math.cos(angle)*followDistance);lookGoal.copy(g.position).addScaledVector(v,2.4);lookGoal.y+=.55}
 else if(mode==='ride'){cameraGoal.copy(g.position).addScaledVector(v,.17);cameraGoal.y+=.92;lookGoal.copy(g.position).addScaledVector(v,12);lookGoal.y+=.9}
 else {tourAngle+=dt*.035;cameraGoal.set(Math.cos(tourAngle)*tourRadius,tourRadius*.69+Math.sin(worldTime*.035)*12,Math.sin(tourAngle)*tourRadius);lookGoal.set(0,1,0)}
 const factor=1-Math.exp(-dt*(mode==='ride'?12:4.8));camera.position.lerp(cameraGoal,factor);smoothedLook.lerp(lookGoal,factor);camera.lookAt(smoothedLook);controls.target.copy(smoothedLook);
}
function initAudio(){const ctx=new (window.AudioContext||window.webkitAudioContext)();const gain=ctx.createGain();gain.gain.value=0;gain.connect(ctx.destination);const engine=ctx.createOscillator();engine.type='sawtooth';engine.frequency.value=75;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=210;const eg=ctx.createGain();eg.gain.value=.045;engine.connect(filter);filter.connect(eg);eg.connect(gain);engine.start();const length=ctx.sampleRate*4,buf=ctx.createBuffer(1,length,ctx.sampleRate),data=buf.getChannelData(0);let prev=0;for(let i=0;i<length;i++){prev=(prev+Math.random()*.04-.02)*.994;data[i]=prev*.7}const wind=ctx.createBufferSource();wind.buffer=buf;wind.loop=true;const wg=ctx.createGain();wg.gain.value=.12;wind.connect(wg);wg.connect(gain);wind.start();return{ctx,gain,engine,eg}}
function toggleSound(){try{if(!audio)audio=initAudio();audio.ctx.resume();soundEnabled=!soundEnabled;audio.gain.gain.setTargetAtTime(soundEnabled?.5:0,audio.ctx.currentTime,.25);$('sound').classList.toggle('active',soundEnabled);$('sound').setAttribute('aria-pressed',String(soundEnabled));$('sound').setAttribute('aria-label',soundEnabled?'Disable ambient sound':'Enable ambient sound');toast(soundEnabled?'A little breeze, a little engine hum':'Ambient sound off')}catch{toast('Sound is unavailable in this browser')}}
function toggleUI(){drivingInput?.clear();uiHidden=!uiHidden;if(uiHidden)uiReturnFocus=document.activeElement;$('ui').hidden=uiHidden;$('show-ui').hidden=!uiHidden;if(uiHidden)$('show-ui').focus();else(uiReturnFocus?.isConnected?uiReturnFocus:$('world')).focus()}
function init(){
 try{renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});}catch(e){$('loading').style.display='none';$('error').hidden=false;return}
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.5,800);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=2.8;controls.maxDistance=330;controls.maxPolarAngle=Math.PI*.49;controls.minPolarAngle=.035;controls.zoomSpeed=.75;controls.panSpeed=.7;controls.target.set(0,0,0);
 sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-82,right:82,top:66,bottom:-66,near:1,far:220});sun.shadow.bias=-.00015;sun.shadow.normalBias=.12;scene.add(sun,hemisphere);
 const fill=new THREE.DirectionalLight(0xd1e1df,.45);fill.position.set(65,45,-65);scene.add(fill);
 makeWorld(savedRace?.view.theme||'foundry');renderer.render(scene,camera);$('loading').style.opacity=0;setTimeout(()=>$('loading').remove(),650);
 buildWorldChooser();fitUI();compactUI.addEventListener('change',fitUI);
 document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.camera)));
 $('zoom-in').onclick=()=>{zoom(.8);focusDriver();};$('zoom-out').onclick=()=>{zoom(1.25);focusDriver();};$('home').onclick=()=>{setMode('orbit');homeCamera()};$('pause').onclick=()=>{setPaused(!paused);if(!paused)focusDriver();};setPaused(false);
 $('speed').onclick=()=>{setSpeed(speed===1?2:speed===2?.5:1);focusDriver();};setSpeed(1);$('restart').title='Restart race and restore the world';$('restart').setAttribute('aria-label','Restart race and restore the world');$('restart').onclick=()=>{resetRace();saveRace()};$('aggression').onchange=()=>{aggression=Number($('aggression').value);sim.setAggression(aggression);toast(`Drivers are feeling ${aggression===1?'merciless':aggression>.7?'aggressive':'competitive'}`)};
 $('previous-car').onclick=()=>selectCar(selected-1);$('next-car').onclick=()=>selectCar(selected+1);$('collapse-board').onclick=()=>{boardPreference=!$('standings').classList.contains('collapsed');setBoardCollapsed(boardPreference)};$('details-toggle').onclick=()=>{detailsPreference=!$('selected').classList.contains('show-details');setDetailsExpanded(detailsPreference)};$('sound').onclick=toggleSound;
 $('drive-racer').onclick=()=>setDriving(sim.playerCarId===null);$('stop-driving').onclick=()=>{setDriving(false);$('world').focus();};$('recover-driver').onclick=()=>{recoverDriver();$('world').focus();};
 drivingInput=setupDrivingInput({getSim:()=>sim,isPaused:()=>paused,isBlocked:()=>$('world-dialog').open||devTools?.active(),onBlur:()=>{if(sim.playerCarId!==null&&!paused){setPaused(true);saveRace();toast('Driving paused. Resume when you are ready.');}}});
 $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{toast('Use your browser’s fullscreen control')}};$('hide-ui').onclick=toggleUI;$('show-ui').onclick=toggleUI;
 $('photo').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download=`tiny-laps-${theme}.png`;a.click();toast('A little postcard, saved')};
 document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement));$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen')});
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
 const canvas=renderer.domElement;
 const pointers=new Set();let multiTouch=false;canvas.addEventListener('pointerdown',e=>{pointers.add(e.pointerId);if(pointers.size>1)multiTouch=true});
 canvas.addEventListener('pointerdown',e=>{down.set(e.clientX,e.clientY);if(mode==='follow'){drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)}if(mode==='tour'){setMode('orbit');controls.target.copy(smoothedLook)} });
 canvas.addEventListener('pointermove',e=>{if(drag&&mode==='follow'){followAzimuth-=(e.clientX-drag.x)*.009;followElevation=THREE.MathUtils.clamp(followElevation+(e.clientY-drag.y)*.03,1,20);drag={x:e.clientX,y:e.clientY}}});
 addEventListener('pointerup',e=>{drag=null;pointers.delete(e.pointerId);if(multiTouch){if(!pointers.size)multiTouch=false;return}if(down.distanceTo(new THREE.Vector2(e.clientX,e.clientY))>5||e.target!==canvas)return;mouse.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);raycaster.setFromCamera(mouse,camera);const hit=raycaster.intersectObjects(carMeshes,false)[0];if(hit&&!hit.object.userData.cityTraffic)selectCar(hit.object.userData.carId,true)});
 canvas.addEventListener('wheel',e=>{if(mode==='follow'){e.preventDefault();zoom(Math.exp(e.deltaY*.0015))}},{passive:false});
 canvas.addEventListener('touchmove',e=>{if(mode==='follow'&&e.touches.length===2){e.preventDefault();drag=null;const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(lastPinch)zoom(lastPinch/d);lastPinch=d}},{passive:false});canvas.addEventListener('touchend',()=>lastPinch=null);canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;lastPinch=null;multiTouch=false});
 addEventListener('keydown',e=>{if(e.altKey&&e.code==='KeyM'&&!$('world-dialog').open){e.preventDefault();$('choose-world').click();return}if(drivingInput.keydown(e))return;if($('world-dialog').open||e.target.closest('button,input,select,textarea,[contenteditable=true]'))return;if(e.code==='Space'){e.preventDefault();if(!e.repeat)$('pause').click()}else if(e.key==='ArrowRight'){e.preventDefault();selectCar(selected+1)}else if(e.key==='ArrowLeft'){e.preventDefault();selectCar(selected-1)}else if(e.key==='1')setMode('orbit');else if(e.key==='2')setMode('follow');else if(e.key==='3')setMode('ride');else if(e.key==='4')setMode('tour');else if(e.key==='h'||e.key==='H')toggleUI();else if(e.key==='+'||e.key==='=')zoom(.85);else if(e.key==='-')zoom(1.18);else if(e.key==='Escape'){if(sim.playerCarId!==null)setDriving(false);setMode('orbit');if(uiHidden)toggleUI()}});
 devTools=setupDevTools({getSim:()=>sim,getTerrain:()=>terrain,getScenery:()=>scenery,getWorld:()=>world,getCamera:()=>camera,getCanvas:()=>renderer.domElement,getControls:()=>controls,getMode:()=>mode,getCarMeshes:()=>[...carMeshes,...(traffic?.targets||[])],getCarId:hit=>hit.object.userData.cityTraffic?traffic.pick(hit):hit.object.userData.carId,getCar:carById,getAllCars:allCars,teleportCar,applyImpulse:impulseCar,getSelected:()=>selected,selectCar:id=>selectCar(id),setMode,onInteraction:()=>{if(sim.playerCarId!==null)setDriving(false);},reactPeople:(x,z,r,type)=>people.react(x,z,r,type),getPeople:()=>people,restoreWorld:()=>makeWorld(theme),refreshTerrain:()=>updateBarriers(),damageWorld:damageWorldAt,surfaceHeightAt:(x,z)=>{if(!terrain.contains(x,z))return -3;let base=0,nearest=3.8;for(let i=0;i<track.samples.length;i+=6){const p=track.samples[i],d=Math.hypot(p.x-x,p.z-z);if(d<nearest){base=p.y;nearest=d}}return base+terrain.heightAt(x,z)},setSpeed,togglePause:()=>$('pause').click(),toast});
 if(savedRace){if(restoreRace(savedRace,{sim,terrain,scenery,barriers,people,traffic,water})){
  const v=savedRace.view;selected=Number.isInteger(v.selected)&&v.selected>=0&&v.selected<10?v.selected:0;aggression=sim.aggression;$('aggression').value=String(aggression);elapsed=sim.elapsed;worldTime=Number.isFinite(v.worldTime)?v.worldTime:0;
  boardPreference=typeof v.boardPreference==='boolean'?v.boardPreference:null;detailsPreference=typeof v.detailsPreference==='boolean'?v.detailsPreference:null;
  setMode(['orbit','follow','ride','tour'].includes(v.mode)?v.mode:'orbit');setPaused(v.paused===true);setSpeed([.5,1,2].includes(v.speed)?v.speed:1);
  if(Array.isArray(v.camera)&&v.camera.length===3&&v.camera.every(n=>Number.isFinite(n)&&Math.abs(n)<10000))camera.position.fromArray(v.camera);
  if(Array.isArray(v.target)&&v.target.length===3&&v.target.every(n=>Number.isFinite(n)&&Math.abs(n)<10000)){controls.target.fromArray(v.target);smoothedLook.copy(controls.target)}
  followDistance=THREE.MathUtils.clamp(Number(v.followDistance)||10,3,35);followElevation=THREE.MathUtils.clamp(Number(v.followElevation)||5,1,20);followAzimuth=Number.isFinite(v.followAzimuth)?v.followAzimuth:0;tourRadius=THREE.MathUtils.clamp(Number(v.tourRadius)||130,30,260);tourAngle=Number.isFinite(v.tourAngle)?v.tourAngle:.9;
  if(v.driving===true)setDriving(true,{restore:true});
  updateBarriers();updateCarModels(0);fitUI();updateUI();toast(sim.migratedRoute?'City streets updated. Your world and car damage are saved; racers start on the new route.':'Your saved race is ready');
 }else toast('The previous race could not be restored. A fresh race is ready.');savedRace=null;}
 addEventListener('pagehide',saveRace);addEventListener('beforeunload',saveRace);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveRace()});
 window.__tinyLaps=Object.freeze({getSimulation:()=>sim,getTerrain:()=>terrain,getScenery:()=>scenery,getPeople:()=>people,getTraffic:()=>traffic,getWater:()=>water,getCamera:()=>camera,getView:()=>({theme,selected,mode,paused,speed,driving:sim.playerCarId!==null}),save:saveRace});
 let then=performance.now();function animate(now){requestAnimationFrame(animate);const dt=Math.max(0,Math.min((now-then)/1000,.08));then=now;worldTime+=dt;if(!paused){sim.update(dt*speed);elapsed=sim.elapsed}updateCarModels(paused?0:dt*speed);water?.update(paused?0:dt*speed);scenery.configurePhysics(sim.physics);scenery.update(worldTime,paused?0:dt*speed);traffic?.update(paused?0:dt*speed,sim.cars,sim.physics.gravity);people.update(paused?0:dt*speed,allCars(),sim.physics.gravity);devTools?.update(paused?0:dt*speed);updateEffects(paused?0:dt*speed);updateCamera(dt);
 // Wide island views need depth precision more than a tiny near plane. Ride
 // retains its close camera; decorative surfaces have their own depth layers.
 const near=mode==='ride'?.12:mode==='follow'?.25:Math.max(.5,camera.position.distanceTo(controls.target)*.008);if(Math.abs(camera.near-near)>.025){camera.near=near;camera.updateProjectionMatrix()}
 if(audio&&soundEnabled){audio.engine.frequency.setTargetAtTime(50+sim.cars[selected].speed*5,audio.ctx.currentTime,.08);audio.eg.gain.setTargetAtTime(paused?.008:mode==='ride'?.08:.035,audio.ctx.currentTime,.1)}renderer.render(scene,camera);if(now-lastUI>200){updateUI();lastUI=now}if(now-lastSave>2500){saveRace();lastSave=now}}
 requestAnimationFrame(animate);
}
try{init()}catch(e){console.error(e);$('loading').style.display='none';$('error').hidden=false;$('error').querySelector('h2').textContent='The little world could not start.';$('error').querySelector('p').textContent='Please reload, or open this file in a browser with WebGL enabled.'}
