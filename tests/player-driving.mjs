import assert from 'node:assert/strict';
import { RaceSimulation, PHYSICS_STEP } from '../race.js';

const mod = (value,length) => ((value%length)+length)%length;
const directionSpeed = car => car.vx*Math.sin(car.heading)+car.vz*Math.cos(car.heading);
const headingChange = (before,after) => Math.atan2(Math.sin(after-before),Math.cos(after-before));
const fixture = (radius=500,alone=true,environment={}) => {
  const length = radius*Math.PI*2;
  const sample = distance => {
    const a = mod(distance,length)/radius;
    return {x:radius*Math.cos(a),y:.17,z:radius*Math.sin(a),tx:-Math.sin(a),tz:Math.cos(a),curvature:1/radius};
  };
  const sim = new RaceSimulation(length,sample,{barrierAt:()=>({solid:false}),...environment});
  if (alone) sim.cars = [sim.cars[0]];
  const car = sim.cars[0];
  sim.teleportCar(0,radius,0,0);
  assert.equal(sim.playerCarId,null);
  assert.equal(sim.setPlayerCar(0),true);
  return {sim,car,sample};
};

// The input API clears transient controls and rejects invalid selections without
// changing the currently controlled car. Malformed axes cannot poison physics.
{
  const {sim,car} = fixture(500,false);
  assert.deepEqual(sim.setPlayerInput({steer:-4,accelerate:3,reverse:-1,brake:NaN}),
    {steer:-1,accelerate:1,reverse:0,brake:0});
  for (const id of [-1,10,1.2,NaN,undefined,'0']) assert.equal(sim.setPlayerCar(id),false);
  assert.equal(sim.playerCarId,0);
  assert.equal(sim.playerInput.accelerate,1);
  assert.deepEqual(sim.setPlayerInput({steer:Infinity,accelerate:'1',reverse:null,brake:undefined}),
    {steer:0,accelerate:0,reverse:0,brake:0});
  sim.setPlayerInput({accelerate:1,steer:1});sim.update(.4);
  assert.equal(sim.setPlayerCar(1),true);
  assert.equal(sim.playerCarId,1);
  assert.deepEqual(sim.playerInput,{steer:0,accelerate:0,reverse:0,brake:0});
  assert.ok(car.throttle>0,'previous car immediately receives autonomous controls');
  sim.update(PHYSICS_STEP);
  assert.equal(sim.cars[1].throttle,0,'switching racers does not carry a held accelerator');
  assert.equal(sim.setPlayerCar(null),true);
  assert.equal(sim.playerCarId,null);
  assert.ok(sim.cars[1].throttle>0,'handback resumes the selected racer without another input event');
  sim.setPlayerCar(0);sim.setPlayerInput({accelerate:1,steer:-1});sim.reset();
  assert.equal(sim.playerCarId,null);
  assert.deepEqual(sim.playerInput,{steer:0,accelerate:0,reverse:0,brake:0});
}

// A neutral player receives no lane guidance, automatic throttle, or reversing
// recovery. Acceleration and coasting continue to use the ordinary engine model.
{
  const {sim,car} = fixture();
  car.targetLane=1.55;car.reverseUntil=100;car.stuckTime=10;
  sim.update(4);
  assert.equal(car.throttle,0);assert.equal(car.brake,0);assert.equal(car.steering,0);
  assert.equal(car.gear,1);assert.equal(car.speed,0,'neutral inputs keep an intact car at rest');
  assert.equal(car.reverseUntil,0);assert.equal(car.stuckTime,0);
  assert.equal(car.intent,'You are driving');
  sim.setPlayerInput({accelerate:1});sim.update(2);
  assert.ok(directionSpeed(car)>8,'the accelerator propels the actual rigid body');
  const beforeSpeed=car.speed,beforePosition={x:car.x,z:car.z};
  sim.setPlayerInput({});sim.update(.6);
  assert.equal(car.throttle,0);assert.equal(car.brake,0);
  assert.ok(car.speed<beforeSpeed&&car.speed>beforeSpeed*.8,'released pedals coast through drag rather than brake');
  assert.ok(Math.hypot(car.x-beforePosition.x,car.z-beforePosition.z)>4,'neutral coasting keeps moving');
}

// Neither constant rolling resistance nor held brakes may manufacture reverse
// movement when there is no throttle. Test both forward and backward coasting.
for (const sign of [-1,1]) for (const brake of [0,1]) {
  const {sim,car}=fixture();
  Object.assign(car,{vx:0,vz:sign*.035,gear:sign});
  sim.setPlayerInput({brake});
  for (let i=0;i<120;i++) {
    sim.update(PHYSICS_STEP);
    assert.ok(directionSpeed(car)*sign>=-1e-8,'resistance cannot create motion in the opposite direction');
  }
  assert.ok(car.speed<1e-8,'low-speed coasting and held brakes settle at rest');
  const position={x:car.x,z:car.z};sim.update(1);
  assert.ok(Math.hypot(car.x-position.x,car.z-position.z)<1e-8,'braking at rest does not creep');
}

// Check steering against world movement and body heading, rather than only the
// input variable. The actual front tire angle has the requested left/right sign.
for (const steer of [-1,1]) {
  const {sim,car} = fixture();
  sim.setPlayerInput({accelerate:1});sim.update(1.5);
  const before=car.heading,beforeX=car.x;
  sim.setPlayerInput({steer,accelerate:.4});sim.update(.55);
  assert.equal(Math.sign(car.steering),steer);
  assert.ok(headingChange(before,car.heading)*steer>.15,`${steer}: steering turns the physical body in the right direction`);
  assert.ok((car.x-beforeX)*steer>.1,`${steer}: front tire forces bend the path in the right direction`);
  const angleAtCitySpeed=Math.abs(car.steering);
  Object.assign(car,{vx:Math.sin(car.heading)*24,vz:Math.cos(car.heading)*24});
  sim._playerDriver(car,1);
  assert.ok(Math.abs(car.steering)<angleAtCitySpeed,'full steering tapers at high speed');
  sim.setPlayerInput({});sim._playerDriver(car,1);assert.equal(car.steering,0,'release centers the wheels');
}

// Reverse first brakes forward motion. Forward does the same while rolling
// backward, while Shift or opposing pedals always remove engine throttle.
{
  const {sim,car} = fixture();
  sim.setPlayerInput({accelerate:1});sim.update(2);
  const speed=directionSpeed(car);
  sim.setPlayerInput({reverse:1});sim.update(.2);
  assert.equal(car.throttle,0);assert.equal(car.brake,1);assert.equal(car.gear,1);
  assert.ok(directionSpeed(car)<speed-1);assert.ok(directionSpeed(car)>0);
  assert.equal(car.intent,'You are braking');
  sim.update(2);
  assert.equal(car.gear,-1);assert.equal(car.brake,0);assert.equal(car.throttle,1);
  assert.ok(directionSpeed(car)<-3);assert.equal(car.intent,'You are reversing');
  sim.setPlayerInput({accelerate:1});sim.update(.1);
  assert.equal(car.throttle,0);assert.equal(car.brake,1);assert.equal(car.gear,-1);
  sim.update(2);
  assert.equal(car.gear,1);assert.ok(directionSpeed(car)>3);
  sim.setPlayerInput({accelerate:1,reverse:1});sim.update(.1);
  assert.equal(car.throttle,0);assert.equal(car.brake,1);
  sim.setPlayerInput({accelerate:1,brake:.7});sim.update(.1);
  assert.equal(car.throttle,0);assert.equal(car.brake,.7);
}

// Player control preserves engine damage penalties, momentum transfer, impact
// damage, held bodies, and ballistic launches through the same physics path.
{
  const normal=fixture(),weak=fixture();weak.car.damage.engine=.9;
  for (const state of [normal,weak]) { state.sim.setPlayerInput({accelerate:1});state.sim.update(1); }
  assert.ok(directionSpeed(weak.car)<directionSpeed(normal.car)*.55,'engine damage weakens player acceleration');
  const {sim,car}=fixture(500,false);
  const target=sim.cars[1];
  Object.assign(car,{x:500,z:0,vx:0,vz:10,heading:0,yawRate:0});
  Object.assign(target,{x:500,z:1.94,vx:0,vz:0,heading:0,yawRate:0,held:true});
  for (const other of sim.cars.slice(2)) { other.x+=100;other.held=true; }
  sim.setPlayerInput({accelerate:1});sim.update(PHYSICS_STEP);
  assert.ok(car.damage.front>0&&car.damage.total>0&&car.speed<10,'a driven car still takes collision damage');
  assert.ok(sim.events.some(event=>event.type==='collision'&&event.carIds.includes(car.id)));
  const launched=fixture();launched.sim.setPlayerInput({accelerate:1});
  launched.car.held=true;
  const held={x:launched.car.x,z:launched.car.z};launched.sim.update(.4);
  assert.equal(launched.car.x,held.x);assert.equal(launched.car.z,held.z);
  launched.car.held=false;
  launched.sim.applyImpulse(0,{x:0,z:0,y:launched.car.mass*7});launched.sim.update(.4);
  assert.ok(launched.car.airborne&&launched.car.y>1.5);
  assert.equal(launched.car.frontForce,0);assert.equal(launched.car.rearForce,0);
  assert.ok(launched.car.speed<.02,'pressing the accelerator in flight cannot create tire thrust');
  launched.sim.update(1.4);
  assert.equal(launched.car.airborne,false);
  assert.ok(launched.car.damage.suspension>0,'a player launch retains landing damage');
}

// All other racers continue to race while the selected car remains parked.
{
  const {sim,car} = fixture(45,false);
  sim.teleportCar(0,65,0,0);
  const position={x:car.x,z:car.z};
  sim.update(60);
  assert.ok(Math.hypot(car.x-position.x,car.z-position.z)<.1);
  assert.equal(car.throttle,0);
  assert.ok(sim.cars.slice(1).every(other=>other.laps>=2&&other.bestLap>0),'the other nine drivers still complete timed laps');
  sim.setPlayerCar(null);sim.update(5);
  assert.ok(car.speed>1&&Math.hypot(car.x-position.x,car.z-position.z)>2,'autonomous recovery resumes after handback');
}

console.log('Player driving checks passed: bounded transient input, left/right physical steering, speed-sensitive wheel angles, acceleration/coasting, brake-to-reverse and brake-to-forward, independent brake priority, handback/reset, engine and impact damage, held/airborne bodies, and nine continuing autonomous racers.');
