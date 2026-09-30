/** A flick transfers recent hand motion. Holding still produces a simple drop. */
export function throwVelocity(history, now) {
  const recent=history.filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.z)&&Number.isFinite(point.t)&&point.t>=now-160);
  if(recent.length<2)return {x:0,z:0,y:0};
  const first=recent[0],last=recent.at(-1),dt=Math.max(.02,(last.t-first.t)/1000);
  let x=(last.x-first.x)/dt,z=(last.z-first.z)/dt;
  const speed=Math.hypot(x,z);
  if(speed<1)return {x:0,z:0,y:0};
  if(speed>35){x*=35/speed;z*=35/speed;}
  return {x,z,y:Math.min(1.5,Math.hypot(x,z)*.04)};
}
