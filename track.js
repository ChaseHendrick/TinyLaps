import * as THREE from 'three';

const mod=(x,n)=>((x%n)+n)%n;

// Junction turns stay in the street footprint. A broad interpolating spline
// through sparse grid corners would sweep through the neighboring buildings.
function streetCurve(points){
  const vertices=points.map(p=>new THREE.Vector3(...p)),corners=[];
  for(let i=0;i<vertices.length;i++){
    const p=vertices[i],previous=vertices[mod(i-1,vertices.length)],next=vertices[(i+1)%vertices.length];
    const incoming=p.clone().sub(previous),outgoing=next.clone().sub(p);
    const cut=Math.min(5,incoming.length()*.36,outgoing.length()*.36);
    incoming.normalize();outgoing.normalize();
    const entry=p.clone().addScaledVector(incoming,-cut),exit=p.clone().addScaledVector(outgoing,cut);
    const k=.55228475*cut;
    corners.push({entry,exit,turn:new THREE.CubicBezierCurve3(entry,entry.clone().addScaledVector(incoming,k),exit.clone().addScaledVector(outgoing,-k),exit)});
  }
  const curve=new THREE.CurvePath();
  for(let i=0;i<corners.length;i++){
    curve.add(new THREE.LineCurve3(corners[mod(i-1,corners.length)].exit,corners[i].entry));
    curve.add(corners[i].turn);
  }
  // Put the grid and finish line on the long boulevard after the first turn.
  const start=curve.curves[0].getLength()+curve.curves[1].getLength()+20;
  return {curve,start};
}

export function buildTrack(config){
  const points=Array.isArray(config)?config:config.points,city=!Array.isArray(config)&&!!config.city;
  const path=city?streetCurve(points):{curve:new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),true,'centripetal'),start:0};
  const {curve,start}=path;curve.arcLengthDivisions=4000;curve.updateArcLengths();
  const length=curve.getLength(),samples=[],count=1800;
  for(let i=0;i<count;i++){
    const u=mod(i/count+start/length,1),p=curve.getPointAt(u),t=curve.getTangentAt(u),a=curve.getTangentAt(mod(u-.002,1)),b=curve.getTangentAt(mod(u+.002,1));
    if(p.y<.17){p.y=.17;t.y=0;}
    samples.push({x:p.x,y:p.y,z:p.z,tx:t.x,tz:t.z,ty:t.y,curvature:Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z)/(length*.004)});
  }
  function sampleAtDistance(distance){
    const q=mod(distance,length)/length*count,i=Math.floor(q),f=q-i,a=samples[i],b=samples[(i+1)%count],p={};
    for(const key of Object.keys(a))p[key]=a[key]+(b[key]-a[key])*f;
    const norm=Math.hypot(p.tx,p.tz);p.tx/=norm;p.tz/=norm;return p;
  }
  return {curve,length,samples,sampleAtDistance};
}
