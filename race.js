/** Tiny Laps: force-based vehicles, autonomous drivers and impact damage. */
const personalities = [
  ['The attacker', 'Commits to small gaps and brakes late.', .94, .94, .65, .68],
  ['The tactician', 'Plans a clean exit before making a pass.', .73, .84, .72, .96],
  ['The daredevil', 'Carries speed into corners and takes chances.', .98, .98, .50, .58],
  ['The opportunist', 'Waits for a mistake, then slips through.', .78, .89, .58, .91],
  ['The scrapper', 'Defends a position and fights for the inside.', .91, .89, .96, .70],
  ['The precision driver', 'Keeps momentum with smooth, accurate inputs.', .70, .90, .64, .98],
  ['The late braker', 'Makes a move at the last braking marker.', .96, .96, .71, .65],
  ['The comeback kid', 'Stays composed and attacks after a setback.', .85, .88, .68, .88],
  ['The defender', 'Protects the racing line when a rival closes.', .87, .85, .98, .80],
  ['The hothead', 'Pursues every opening, sometimes overcommitting.', 1, .97, .85, .54],
];

export const CAR_PROFILES = Object.freeze([
  { name:'Cherry', color:'#ee6f68', topSpeed:22.3, cornering:11.7, acceleration:6.3 },
  { name:'Bluebell', color:'#6da9ee', topSpeed:21.9, cornering:12.2, acceleration:6.0 },
  { name:'Clementine', color:'#f4a557', topSpeed:22.7, cornering:10.7, acceleration:6.4 },
  { name:'Minty', color:'#8ad7ba', topSpeed:21.5, cornering:12.7, acceleration:5.9 },
  { name:'Buttercup', color:'#f2d36b', topSpeed:22.1, cornering:11.4, acceleration:6.2 },
  { name:'Lilac', color:'#b6a0e5', topSpeed:21.7, cornering:12.4, acceleration:6.1 },
  { name:'Pebble', color:'#e8ddd0', topSpeed:22.5, cornering:11.0, acceleration:6.5 },
  { name:'Rosie', color:'#e79db5', topSpeed:21.4, cornering:13.0, acceleration:5.8 },
  { name:'Sprout', color:'#9cbe67', topSpeed:22.0, cornering:11.9, acceleration:6.0 },
  { name:'Inky', color:'#788bba', topSpeed:22.6, cornering:10.9, acceleration:6.3 },
].map((profile, id) => {
  const [label, description, aggression, bravery, defensiveness, awareness] = personalities[id];
  return Object.freeze({ ...profile, personality:Object.freeze({ label, description,
    aggression, bravery, defensiveness, awareness }) });
}));

export const CAR_LENGTH = 1.95;
export const CAR_WIDTH = 1.08;
export const PHYSICS_STEP = 1 / 120;
const WHEELBASE = 1.22;
const FRONT_AXLE = .64;
const REAR_AXLE = WHEELBASE - FRONT_AXLE;
const CG_HEIGHT = .27;
const G = 9.81;
const LANES = [-1.55, 0, 1.55];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (v, d) => ((v % d) + d) % d;
const angle = v => mod(v + Math.PI, Math.PI * 2) - Math.PI;
const approach = (v, target, amount) => v + clamp(target - v, -amount, amount);
const dot = (a, b) => a.x * b.x + a.z * b.z;
const yawCross = (a, b) => a.z * b.x - a.x * b.z;
const axes = car => ({ f:{ x:Math.sin(car.heading), z:Math.cos(car.heading) },
  r:{ x:Math.cos(car.heading), z:-Math.sin(car.heading) } });

export class RaceSimulation {
  /** sampleAtDistance(distance) returns {x,y,z,tx,tz,curvature}; units are meters. */
  constructor(trackLength, sampleAtDistance, environment = {}) {
    if (!Number.isFinite(trackLength) || trackLength < 24) throw new RangeError('Track length must be at least 24 meters.');
    if (typeof sampleAtDistance !== 'function') throw new TypeError('A track sampler is required.');
    this.trackLength = trackLength;
    this.sampleAtDistance = sampleAtDistance;
    this.environment = environment || {};
    this.physics = { gravity:9.81, grip:1, restitution:.12, damageScale:1, enginePower:1 };
    this.aggression = .85;
    this._sampleCount = Math.max(160, Math.ceil(trackLength / .28));
    this._track = Array.from({ length:this._sampleCount }, (_, i) => this._sample(i / this._sampleCount * trackLength));
    this.reset();
  }

  _sample(distance) {
    const p = this.sampleAtDistance(mod(distance, this.trackLength));
    const norm = Math.hypot(p.tx, p.tz) || 1;
    return { x:p.x, y:p.y || 0, z:p.z, tx:p.tx / norm, tz:p.tz / norm,
      curvature:p.curvature || 0 };
  }

  reset() {
    this.elapsed = 0;
    this._accumulator = 0;
    this.events = [];
    this._eventId = 0;
    this._contacts = new Map();
    this.cars = CAR_PROFILES.map((profile, id) => {
      const progress = -1.5 - Math.floor(id / 2) * 3.55 - (id % 2) * .20;
      const lane = id % 2 ? 1.15 : -1.15;
      const p = this._sample(progress);
      const mass = 690 + id * 5;
      return {
        id, name:profile.name, color:profile.color, profile,
        personality:profile.personality, aggression:0,
        mass, inertia:mass * (CAR_LENGTH ** 2 + CAR_WIDTH ** 2) / 12,
        progress, distance:mod(progress, this.trackLength), lane, targetLane:lane,
        preferredLane:LANES[id % LANES.length] * .65,
        x:p.x - p.tz * lane, y:p.y, z:p.z + p.tx * lane,
        vx:0, vz:0, vy:0, airborne:false, groundHeight:p.y,
        heading:Math.atan2(p.tx, p.tz), yawRate:0,
        speed:0, tx:p.tx, tz:p.tz, curvature:p.curvature,
        laps:0, rank:id + 1, bestLap:null, lastLap:null, currentLapTime:0,
        lapStartedAt:null, nextLapLine:0, overtakes:0,
        throttle:0, brake:0, steering:0, slip:0, frontSlip:0, rearSlip:0,
        longitudinalSpeed:0, lateralSpeed:0, longitudinalAcceleration:0,
        lateralAcceleration:0, frontLoad:mass * G * REAR_AXLE / WHEELBASE,
        rearLoad:mass * G * FRONT_AXLE / WHEELBASE,
        frontForce:0, rearForce:0, tireLimitFront:0, tireLimitRear:0,
        frontLongitudinalForce:0, rearLongitudinalForce:0,
        surface:'road', grip:1.12, gear:1, intent:'Launching', passing:false,
        bank:0, wheelAngle:0, damage:{ total:0, front:0, rear:0, left:0, right:0,
          engine:0, suspension:0 }, impacts:0,
        laneCooldown:1 + id * .12, laneHoldUntil:0, reverseUntil:0,
        stuckTime:0, lastPassAt:-10, lastImpactAt:-10, held:false,
      };
    });
    this.setAggression(this.aggression);
    return this;
  }

  setAggression(level) {
    this.aggression = clamp(Number.isFinite(level) ? level : .85, 0, 1);
    for (const car of this.cars || []) car.aggression = clamp(car.personality.aggression * (.35 + this.aggression * .8), 0, 1);
    return this;
  }

  configurePhysics(settings = {}) {
    const bounds = { gravity:[1,25],grip:[.15,3],restitution:[0,.85],damageScale:[0,5],enginePower:[0,3] };
    for (const [key,[min,max]] of Object.entries(bounds)) {
      if (Number.isFinite(settings[key])) this.physics[key] = clamp(settings[key],min,max);
    }
    return this.physics;
  }

  applyImpulse(id, impulse, point) {
    const car = this.cars[id];
    if (!car || !Number.isFinite(impulse?.x) || !Number.isFinite(impulse?.z)) return false;
    car.vx += impulse.x / car.mass;
    car.vz += impulse.z / car.mass;
    if (Number.isFinite(impulse.y)) {
      car.vy += impulse.y / car.mass;
      if (car.vy > .1) car.airborne = true;
    }
    if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) {
      car.yawRate += yawCross({ x:point.x-car.x,z:point.z-car.z },impulse) / car.inertia;
    }
    car.speed = Math.hypot(car.vx,car.vz);
    return true;
  }

  strikeCar(id,impulse,magnitude){const car=this.cars[id];if(!car)return false;this.applyImpulse(id,impulse);const length=Math.hypot(impulse.x,impulse.z)||1;this._damage(car,{x:impulse.x/length,z:impulse.z/length},magnitude);return true;}

  teleportCar(id,x,z,heading) {
    const car = this.cars[id];
    if (!car || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    car.x = x; car.z = z;
    const p = this._project(car,true);
    const delta = mod(p.distance-car.distance+this.trackLength*.5,this.trackLength)-this.trackLength*.5;
    car.progress += delta;
    car.distance = p.distance;
    car.lane = p.lane;
    car.tx = p.tx; car.tz = p.tz; car.curvature = p.curvature;
    car.y = p.y;
    car.heading = Number.isFinite(heading) ? angle(heading) : Math.atan2(p.tx,p.tz);
    car.vx = car.vz = car.vy = car.yawRate = car.speed = car.slip = 0;
    car.airborne = false;car.groundHeight=p.y;
    car.nextLapLine = Math.max(car.nextLapLine,(Math.floor(car.progress/this.trackLength)+1)*this.trackLength);
    car.intent = 'Recovering';
    return true;
  }

  repairCar(id) {
    const car = this.cars[id];
    if (!car) return false;
    for (const key of Object.keys(car.damage)) car.damage[key] = 0;
    car.impacts = 0;
    return true;
  }

  get leaderboard() { return [...this.cars].sort((a,b) => a.rank - b.rank); }

  /** Fixed 120 Hz integration. Carries the remainder into the next update. */
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return this;
    this._accumulator += dt;
    while (this._accumulator >= PHYSICS_STEP - 1e-10) {
      this._step(PHYSICS_STEP);
      this._accumulator -= PHYSICS_STEP;
    }
    return this;
  }

  _project(car,global = false) {
    const n = this._sampleCount;
    const cell = this.trackLength / n;
    const center = Math.floor(mod(car.distance, this.trackLength) / cell);
    const radius = Math.ceil((8 + car.speed * .08) / cell);
    let best = Infinity;
    let result = null;
    const check = index => {
      const i = mod(index, n);
      const a = this._track[i];
      const b = this._track[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const fraction = clamp(((car.x - a.x) * dx + (car.z - a.z) * dz) / Math.max(1e-8, dx * dx + dz * dz), 0, 1);
      const x = a.x + dx * fraction;
      const z = a.z + dz * fraction;
      const dist2 = (car.x - x) ** 2 + (car.z - z) ** 2;
      if (dist2 >= best) return;
      best = dist2;
      let tx = a.tx + (b.tx - a.tx) * fraction;
      let tz = a.tz + (b.tz - a.tz) * fraction;
      const norm = Math.hypot(tx, tz) || 1;
      tx /= norm; tz /= norm;
      result = { x, z, tx, tz, y:a.y + (b.y - a.y) * fraction,
        curvature:a.curvature + (b.curvature - a.curvature) * fraction,
        distance:mod((i + fraction) * cell, this.trackLength),
        lane:(car.x - x) * -tz + (car.z - z) * tx };
    };
    for (let offset = -radius; offset <= radius; offset++) check(center + offset);
    if (global || best > 100) for (let i = 0; i < n; i++) check(i);
    return result;
  }

  _signedGap(a,b) {
    const gap = mod(b.distance - a.distance, this.trackLength);
    return gap > this.trackLength * .5 ? gap - this.trackLength : gap;
  }

  _front(car, lane = car.lane) {
    let other = null;
    let gap = Infinity;
    for (const candidate of this.cars) {
      if (candidate === car || Math.abs(candidate.lane - lane) > 1.25) continue;
      const distance = mod(candidate.distance - car.distance, this.trackLength);
      if (distance < gap) { gap = distance; other = candidate; }
    }
    return { car:other, gap };
  }

  _clearLane(car, target) {
    for (const other of this.cars) {
      if (other === car) continue;
      const gap = this._signedGap(car, other);
      const sweptMin = Math.min(car.lane,target)-.65;
      const sweptMax = Math.max(car.lane,target)+.65;
      if (gap > -2.6 && gap < 3.2 && other.lane > sweptMin && other.lane < sweptMax) return false;
      const lateral = Math.abs(other.lane - target);
      const targetDifference = Math.abs(other.targetLane - target);
      if (Math.min(lateral, targetDifference) > 1.25) continue;
      const rearBuffer = 2.8 + Math.max(0, other.speed - car.speed) * (.75 - car.aggression * .25);
      if (gap > -rearBuffer && gap < 3.1 - car.aggression * .35) return false;
    }
    return true;
  }

  _driver(car, dt) {
    const { f, r } = axes(car);
    const u = car.vx * f.x + car.vz * f.z;
    const v = car.vx * r.x + car.vz * r.z;
    car.longitudinalSpeed = u;
    car.lateralSpeed = v;
    const trackHeading = Math.atan2(car.tx, car.tz);
    const headingError = angle(trackHeading - car.heading);
    const recovering = Math.abs(car.lane) > 2.8 || Math.abs(headingError) > 1.15 || car.slip > .65;
    car.laneCooldown = Math.max(0, car.laneCooldown - dt);
    car.passing = false;
    const front = this._front(car, car.targetLane);
    const catching = front.car && front.gap < 6.5 + car.speed * .65
      && (front.car.speed < car.speed + 1.2 || front.gap < 4);

    if (recovering) {
      car.targetLane = 0;
      car.laneHoldUntil = this.elapsed + 1.0;
    } else if (car.laneCooldown <= 0) {
      if (catching) {
        let bestLane = car.targetLane;
        let bestScore = Math.min(front.gap, 24);
        for (const lane of LANES) {
          if (Math.abs(lane - car.targetLane) < .3 || !this._clearLane(car, lane)) continue;
          const next = this._front(car, lane);
          const inside = Math.sign(car.curvature) * lane;
          const score = Math.min(next.gap, 25) - Math.abs(lane - car.lane) * .8
            + inside * car.aggression * .55;
          if (score > bestScore + 1.2) { bestScore = score; bestLane = lane; }
        }
        if (bestLane !== car.targetLane) {
          car.targetLane = bestLane;
          car.laneHoldUntil = this.elapsed + 2.0;
          car.laneCooldown = .8 + (1 - car.aggression) * 1.5;
          car.passing = true;
        }
      } else if (this.elapsed > car.laneHoldUntil) {
        const behind = this.cars.find(other => other !== car && this._signedGap(car,other) < -2.5
          && this._signedGap(car,other) > -8 && other.speed > car.speed + .6);
        if (behind && car.personality.defensiveness * car.aggression > .63
          && this._clearLane(car, clamp(behind.targetLane, -1.55, 1.55))) {
          car.targetLane = clamp(behind.targetLane, -1.55, 1.55);
          car.laneHoldUntil = this.elapsed + 1.2;
          car.intent = 'Defending';
        } else if (this._clearLane(car,car.preferredLane)) car.targetLane = car.preferredLane;
        car.laneCooldown = .5;
      }
    }

    // Anticipate the grip needed by each upcoming bend. Braver drivers leave
    // less braking room and use more of the available tire friction.
    const damageGrip = 1 - car.damage.suspension * .34;
    const baseGrip = 1.12 * damageGrip * this.physics.grip;
    const bravery = .65 + .20 * car.personality.bravery + .055 * car.aggression;
    const brakingRoom = 4.1 + car.aggression * 1.4;
    let desiredSpeed = car.profile.topSpeed * (1 - car.damage.engine * .45);
    let worstCurvature = Math.abs(car.curvature);
    for (const ahead of [0, 2, 4, 7, 11, 17, 25]) {
      const p = this._sample(car.distance + ahead);
      const radiusFactor = Math.max(.48, 1 - p.curvature * car.targetLane);
      const curvature = Math.abs(p.curvature) / radiusFactor;
      worstCurvature = Math.max(worstCurvature, curvature);
      const bendSpeed = Math.sqrt(baseGrip * this.physics.gravity / Math.max(.005,curvature)) * bravery;
      const permitted = Math.sqrt(bendSpeed ** 2 + 2 * brakingRoom * Math.max(0,ahead - .8));
      desiredSpeed = Math.min(desiredSpeed, permitted);
    }
    const localFront = this._front(car);
    if (localFront.car && localFront.gap < 19) {
      const compression = Math.max(.45, 1 - car.curvature * car.lane);
      const spacing = (2.9 + (1 - car.aggression) * 1.6
        + Math.max(0,car.speed-localFront.car.speed)*.45) / compression;
      const followSpeed = localFront.car.speed + (localFront.gap - spacing) * 1.7;
      desiredSpeed = Math.min(desiredSpeed, Math.max(0,followSpeed));
    }
    if (recovering) desiredSpeed = Math.min(desiredSpeed, 5.2);
    if (Math.abs(headingError) > .65) desiredSpeed = Math.min(desiredSpeed, 6.5);

    car.stuckTime = car.speed < .65 && this.elapsed > 3 ? car.stuckTime + dt : 0;
    if ((Math.abs(headingError) > 1.8 || car.stuckTime > 2.4) && car.speed < 1.8
      && this.elapsed > car.reverseUntil + 1.0) {
      car.reverseUntil = this.elapsed + 1.25;
      car.stuckTime = 0;
    }
    const reversing = this.elapsed < car.reverseUntil;
    car.gear = reversing ? -1 : 1;

    const lookahead = recovering ? 3.2 : clamp(1.7 + Math.abs(u) * (.27 + (1 - car.aggression) * .12), 2.5, 7.2);
    const target = this._sample(car.distance + lookahead);
    const targetX = target.x - target.tz * car.targetLane;
    const targetZ = target.z + target.tx * car.targetLane;
    const dx = targetX - car.x;
    const dz = targetZ - car.z;
    const lateralTarget = dx * r.x + dz * r.z;
    const pursuit = Math.atan2(2 * WHEELBASE * lateralTarget, Math.max(1,dx * dx + dz * dz));
    let steering = pursuit;
    if (reversing) steering = -Math.sign(headingError || car.lane || 1) * .67;
    // Countersteer a rear slide. Better awareness catches it earlier.
    if (car.slip > .2 && !reversing) steering += clamp(v / (Math.abs(u) + 3), -.5,.5)
      * car.personality.awareness * .36;
    const steeringBias = (car.damage.right - car.damage.left) * .018;
    const maxSteer = .70 - car.damage.suspension * .12;
    car.steering = approach(car.steering, clamp(steering + steeringBias,-maxSteer,maxSteer),
      (2.0 + car.aggression * 1.0) * dt);

    const speedError = (reversing ? 2.2 : desiredSpeed) - Math.abs(u);
    car.throttle = clamp(speedError * .62 + .12, 0, 1);
    car.brake = clamp(-speedError * .42, 0, 1);
    if (!reversing && u < -.8) { car.throttle = 0; car.brake = .65; }
    if (car.slip > .55 && !reversing) car.throttle *= .4;
    if (recovering || reversing) car.intent = 'Recovering';
    else if (car.passing || (catching && Math.abs(car.lane - car.targetLane) > .5)) car.intent = 'Overtaking';
    else if (car.brake > .15) car.intent = car.aggression > .87 ? 'Late braking' : 'Braking';
    else if (worstCurvature > .045) car.intent = 'Cornering';
    else if (car.intent !== 'Defending' || this.elapsed > car.laneHoldUntil) car.intent = 'Flat out';
  }

  _integrate(car, dt) {
    const { f, r } = axes(car);
    const u = dot({ x:car.vx,z:car.vz },f);
    const v = dot({ x:car.vx,z:car.vz },r);
    if (car.airborne) {
      car.vy -= this.physics.gravity*dt;
      car.vx *= Math.exp(-.025*dt);car.vz *= Math.exp(-.025*dt);
      car.x += car.vx*dt;car.z += car.vz*dt;car.y += car.vy*dt;
      car.yawRate *= Math.exp(-.12*dt);car.heading=angle(car.heading+car.yawRate*dt);
      car.speed=Math.hypot(car.vx,car.vz);car.intent='Airborne';
      car.frontForce=car.rearForce=car.frontLongitudinalForce=car.rearLongitudinalForce=0;
      return;
    }
    const footprintEdge = Math.abs(car.lane) + CAR_WIDTH * .5;
    car.surface = footprintEdge > 3.55 ? 'grass' : footprintEdge > 3.25 ? 'curb' : 'road';
    const surfaceGrip = car.surface === 'grass' ? .53 : car.surface === 'curb' ? .84 : 1.12;
    const roadHeight = this._sample(car.distance).y;
    const environmentSurface = this.environment.sampleSurface?.(car.x,car.z,roadHeight) || {};
    const roughness = clamp(environmentSurface.roughness || 0,0,1);
    car.grip = surfaceGrip * (1 - car.damage.suspension * .34) * this.physics.grip
      * clamp(environmentSurface.grip ?? 1,.1,2) * (1-roughness*.22);
    const gravity = this.physics.gravity;
    const transfer = clamp(car.mass * car.longitudinalAcceleration * CG_HEIGHT / WHEELBASE,
      -car.mass * gravity * .22, car.mass * gravity * .22);
    const frontLoad = car.mass * gravity * REAR_AXLE / WHEELBASE - transfer;
    const rearLoad = car.mass * gravity - frontLoad;
    car.frontLoad = frontLoad;
    car.rearLoad = rearLoad;
    const frontLimit = car.grip * frontLoad;
    const rearLimit = car.grip * rearLoad;
    car.tireLimitFront = frontLimit;
    car.tireLimitRear = rearLimit;

    const engineForce = car.throttle * car.mass * (car.profile.acceleration * .82)
      * Math.max(.12,1 - (Math.abs(u) / (car.profile.topSpeed + 4)) ** 2)
      * (1 - car.damage.engine * .72) * car.gear * this.physics.enginePower;
    const direction = Math.abs(u) > .05 ? Math.sign(u) : car.gear;
    const brakeForce = car.brake * car.mass * 9.4 * direction;
    const frontFx = clamp(-brakeForce * .64,-frontLimit,frontLimit);
    const rearFx = clamp(engineForce - brakeForce * .36,-rearLimit,rearLimit);
    const active = clamp(Math.abs(u) / 1.2,0,1);
    const safeU = Math.max(1.8,Math.abs(u));
    const frontSlip = Math.atan2(v + FRONT_AXLE * car.yawRate,safeU) - car.steering * Math.sign(u || car.gear);
    const rearSlip = Math.atan2(v - REAR_AXLE * car.yawRate,safeU);
    const stiffnessPenalty = 1 - car.damage.suspension * .28;
    const frontAvailable = Math.sqrt(Math.max(0,frontLimit ** 2 - frontFx ** 2));
    const rearAvailable = Math.sqrt(Math.max(0,rearLimit ** 2 - rearFx ** 2));
    const frontFy = clamp(-frontSlip * 29000 * stiffnessPenalty * active,-frontAvailable,frontAvailable);
    const rearFy = clamp(-rearSlip * 33000 * stiffnessPenalty * active,-rearAvailable,rearAvailable);
    car.frontSlip = frontSlip;
    car.rearSlip = rearSlip;
    car.slip = Math.max(Math.abs(frontSlip),Math.abs(rearSlip));
    car.frontForce = frontFy;
    car.rearForce = rearFy;
    car.frontLongitudinalForce = frontFx;
    car.rearLongitudinalForce = rearFx;
    const steer = car.steering * Math.sign(u || car.gear);
    const frontForward = frontFx * Math.cos(steer) - frontFy * Math.sin(steer);
    const frontLateral = frontFx * Math.sin(steer) + frontFy * Math.cos(steer);
    const drag = .47 * u * Math.abs(u) + direction * (car.surface === 'grass' ? 190 : 70);
    const lateralRolling = v * (car.surface === 'grass' ? 130 : 35);
    const longitudinal = frontForward + rearFx - drag;
    const lateral = frontLateral + rearFy - lateralRolling;
    let forceX = f.x * longitudinal + r.x * lateral;
    let forceZ = f.z * longitudinal + r.z * lateral;
    if (this.environment.sampleSurface && Number.isFinite(environmentSurface.height)) {
      const aheadHeight = this._sample(car.distance + dot(f,{x:car.tx,z:car.tz})*.6).y;
      const sideHeight = this._sample(car.distance + dot(r,{x:car.tx,z:car.tz})*.6).y;
      const aheadSurface = this.environment.sampleSurface(car.x + f.x*.6,car.z + f.z*.6,aheadHeight) || {};
      const sideSurface = this.environment.sampleSurface(car.x + r.x*.6,car.z + r.z*.6,sideHeight) || {};
      const gradeF = clamp(((aheadSurface.height ?? environmentSurface.height)-environmentSurface.height)/.6,-.65,.65);
      const gradeR = clamp(((sideSurface.height ?? environmentSurface.height)-environmentSurface.height)/.6,-.65,.65);
      forceX -= car.mass * gravity * (f.x*gradeF+r.x*gradeR);
      forceZ -= car.mass * gravity * (f.z*gradeF+r.z*gradeR);
    }
    const yawTorque = FRONT_AXLE * frontLateral - REAR_AXLE * rearFy - car.yawRate * car.inertia * .55;
    car.vx += forceX / car.mass * dt;
    car.vz += forceZ / car.mass * dt;
    car.yawRate = clamp(car.yawRate + yawTorque / car.inertia * dt,-12,12);
    car.heading = angle(car.heading + car.yawRate * dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.speed = Math.hypot(car.vx,car.vz);
    car.longitudinalAcceleration = approach(car.longitudinalAcceleration,longitudinal / car.mass,18 * dt);
    car.lateralAcceleration = lateral / car.mass;
    car.bank = clamp(-car.lateralAcceleration * .0045 + roughness*.018*Math.sin(car.progress*3),-.065,.065);
    car.wheelAngle = mod(car.wheelAngle + u / .212 * dt,Math.PI * 2);
  }

  _event(type, cars, x,z,impulse,severity,collider) {
    const key = `${type}:${collider?.id || ''}:${cars.map(car=>car.id).sort().join(':')}`;
    const previous = this._contacts.get(key) ?? -10;
    if (this.elapsed - previous < .45) return;
    this._contacts.set(key,this.elapsed);
    const event = { id:++this._eventId,time:this.elapsed,type,
      carIds:cars.map(car=>car.id),x,z,impulse,severity,colliderId:collider?.id,
      vx:cars[0]?.vx || 0,vz:cars[0]?.vz || 0 };
    this.events.push(event);
    if (this.events.length > 50) this.events.shift();
    for (const car of cars) { car.impacts++; car.lastImpactAt = this.elapsed; }
    if (collider) this.environment.impact?.(collider,event);
    this.environment.damageTerrain?.(x,z,severity);
    return event;
  }

  _damage(car, normal, impulse) {
    const { f,r } = axes(car);
    const impactSpeed = impulse / car.mass;
    const energy = .5 * impactSpeed ** 2;
    const severity = clamp((energy - .08) / 30 * this.physics.damageScale,0,.85);
    if (severity <= 0) return 0;
    const forward = dot(normal,f);
    const right = dot(normal,r);
    const zones = { front:Math.max(0,forward),rear:Math.max(0,-forward),
      right:Math.max(0,right),left:Math.max(0,-right) };
    for (const [key,weight] of Object.entries(zones)) {
      car.damage[key] = clamp(car.damage[key] + severity * weight,0,1);
    }
    car.damage.total = clamp(1 - (1 - car.damage.total) * (1 - severity * .85),0,1);
    car.damage.engine = clamp(car.damage.front * .62 + car.damage.rear * .22 + car.damage.total * .16,0,1);
    car.damage.suspension = clamp((car.damage.left + car.damage.right) * .36 + car.damage.total * .28,0,1);
    return severity;
  }

  _collision(a,b,correctOnly = false) {
    if (Math.abs(a.y-b.y) > .8) return false;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 6.4) return false;
    const aa = axes(a), ba = axes(b);
    let depth = Infinity, normal = null;
    for (const axis of [aa.f,aa.r,ba.f,ba.r]) {
      const aExtent = Math.abs(dot(axis,aa.f)) * CAR_LENGTH * .5 + Math.abs(dot(axis,aa.r)) * CAR_WIDTH * .5;
      const bExtent = Math.abs(dot(axis,ba.f)) * CAR_LENGTH * .5 + Math.abs(dot(axis,ba.r)) * CAR_WIDTH * .5;
      const centerDistance = dx * axis.x + dz * axis.z;
      const overlap = aExtent + bExtent - Math.abs(centerDistance);
      if (overlap <= 0) return false;
      if (overlap < depth) { depth = overlap; const sign = centerDistance < 0 ? -1 : 1;
        normal = { x:axis.x * sign,z:axis.z * sign }; }
    }
    const invA = a.held ? 0 : 1 / a.mass, invB = b.held ? 0 : 1 / b.mass;
    if (invA + invB === 0) return false;
    const yawInvA = a.held ? 0 : 1 / a.inertia, yawInvB = b.held ? 0 : 1 / b.inertia;
    const contact = { x:(a.x + b.x) * .5,z:(a.z + b.z) * .5 };
    const ra = { x:contact.x - a.x,z:contact.z - a.z };
    const rb = { x:contact.x - b.x,z:contact.z - b.z };
    const relative = { x:b.vx + b.yawRate * rb.z - a.vx - a.yawRate * ra.z,
      z:b.vz - b.yawRate * rb.x - a.vz + a.yawRate * ra.x };
    const closing = dot(relative,normal);
    if (!correctOnly && closing < 0) {
      const crossA = yawCross(ra,normal), crossB = yawCross(rb,normal);
      const denominator = invA + invB + crossA ** 2 * yawInvA + crossB ** 2 * yawInvB;
      const impulse = -((1+this.physics.restitution) * closing) / denominator;
      a.vx -= normal.x * impulse * invA; a.vz -= normal.z * impulse * invA;
      b.vx += normal.x * impulse * invB; b.vz += normal.z * impulse * invB;
      a.yawRate -= crossA * impulse * yawInvA;
      b.yawRate += crossB * impulse * yawInvB;
      const tangent = { x:-normal.z,z:normal.x };
      const ctA = yawCross(ra,tangent), ctB = yawCross(rb,tangent);
      const tangentDenominator = invA + invB + ctA ** 2 * yawInvA + ctB ** 2 * yawInvB;
      const friction = clamp(-dot(relative,tangent) / tangentDenominator,-impulse * .34,impulse * .34);
      a.vx -= tangent.x * friction * invA; a.vz -= tangent.z * friction * invA;
      b.vx += tangent.x * friction * invB; b.vz += tangent.z * friction * invB;
      a.yawRate -= ctA * friction * yawInvA;
      b.yawRate += ctB * friction * yawInvB;
      if (Math.abs(closing) > .6 && impulse > 130) {
        const severityA = this._damage(a,normal,impulse);
        const severityB = this._damage(b,{ x:-normal.x,z:-normal.z },impulse);
        this._event('collision',[a,b],contact.x,contact.z,impulse,Math.max(severityA,severityB));
      }
    }
    const correction = Math.max(0,depth - .003) * .75 / (invA + invB);
    a.x -= normal.x * correction * invA; a.z -= normal.z * correction * invA;
    b.x += normal.x * correction * invB; b.z += normal.z * correction * invB;
    return true;
  }

  _barrier(car) {
    const p = this._project(car);
    if (car.airborne && car.y > p.y+.85) return;
    const side = Math.sign(p.lane) || 1;
    const barrier = this.environment.barrierAt?.(p.distance,side);
    if (barrier && (barrier.health <= 0 || barrier.solid === false)) return;
    const outward = { x:-p.tz * side,z:p.tx * side };
    const { f,r } = axes(car);
    const fSign = Math.sign(dot(outward,f));
    const rSign = Math.sign(dot(outward,r));
    const reach = Math.abs(dot(outward,f)) * CAR_LENGTH * .5 + Math.abs(dot(outward,r)) * CAR_WIDTH * .5;
    const penetration = Math.abs(p.lane) + reach - 4.1;
    if (penetration <= 0) return;
    const offset = { x:f.x * fSign * CAR_LENGTH * .5 + r.x * rSign * CAR_WIDTH * .5,
      z:f.z * fSign * CAR_LENGTH * .5 + r.z * rSign * CAR_WIDTH * .5 };
    const contact = { x:car.x + offset.x,z:car.z + offset.z };
    const pointVelocity = { x:car.vx + car.yawRate * offset.z,z:car.vz - car.yawRate * offset.x };
    const outwardSpeed = dot(pointVelocity,outward);
    if (outwardSpeed > 0) {
      const cross = yawCross(offset,outward);
      const impulse = outwardSpeed * (1+this.physics.restitution*.5) / (1 / car.mass + cross ** 2 / car.inertia);
      car.vx -= outward.x * impulse / car.mass;
      car.vz -= outward.z * impulse / car.mass;
      car.yawRate -= cross * impulse / car.inertia;
      const tangent = { x:p.tx,z:p.tz };
      const slide = clamp(dot(pointVelocity,tangent) * car.mass * .2,-impulse * .25,impulse * .25);
      car.vx -= tangent.x * slide / car.mass;
      car.vz -= tangent.z * slide / car.mass;
      if (outwardSpeed > .65 && impulse > 140) {
        const severity = this._damage(car,outward,impulse);
        this._event('barrier',[car],contact.x,contact.z,impulse,severity,barrier);
      }
    }
    const correction = Math.min(.45,penetration * .85);
    car.x -= outward.x * correction;
    car.z -= outward.z * correction;
    car.targetLane = 0;
    car.laneHoldUntil = this.elapsed + 1.4;
  }

  _environmentContacts(car) {
    const { f,r } = axes(car);
    for (const obstacle of this.environment.colliders || []) {
      if (obstacle.health <= 0 || obstacle.solid === false || !(obstacle.radius > 0)) continue;
      const base=Number.isFinite(obstacle.y)?obstacle.y:car.groundHeight;
      if(car.y+.8<base||car.y>base+(obstacle.height||1.2))continue;
      const dx = obstacle.x-car.x, dz = obstacle.z-car.z;
      const broad = obstacle.radius + 1.2;
      if (dx*dx+dz*dz > broad*broad) continue;
      const localF = dx*f.x+dz*f.z, localR = dx*r.x+dz*r.z;
      let closestF = clamp(localF,-CAR_LENGTH*.5,CAR_LENGTH*.5);
      let closestR = clamp(localR,-CAR_WIDTH*.5,CAR_WIDTH*.5);
      let nx = dx-f.x*closestF-r.x*closestR;
      let nz = dz-f.z*closestF-r.z*closestR;
      let distance = Math.hypot(nx,nz);
      let penetration = obstacle.radius-distance;
      if (penetration <= 0) continue;
      if (distance < 1e-6) {
        const gapF = CAR_LENGTH*.5-Math.abs(localF), gapR = CAR_WIDTH*.5-Math.abs(localR);
        if (gapF < gapR) { nx=f.x*Math.sign(localF || 1); nz=f.z*Math.sign(localF || 1); closestF=CAR_LENGTH*.5*Math.sign(localF || 1); penetration+=gapF; }
        else { nx=r.x*Math.sign(localR || 1); nz=r.z*Math.sign(localR || 1); closestR=CAR_WIDTH*.5*Math.sign(localR || 1); penetration+=gapR; }
        distance=1;
      }
      const normal = { x:nx/distance,z:nz/distance };
      const offset = { x:f.x*closestF+r.x*closestR,z:f.z*closestF+r.z*closestR };
      const pointVelocity = { x:car.vx+car.yawRate*offset.z,z:car.vz-car.yawRate*offset.x };
      const closing = dot(pointVelocity,normal);
      if (closing > 0) {
        const cross = yawCross(offset,normal);
        const otherInverseMass = Number.isFinite(obstacle.mass) && obstacle.mass > 0 ? 1/obstacle.mass : 0;
        const impulse = closing*(1+this.physics.restitution) / (1/car.mass+cross**2/car.inertia+otherInverseMass);
        car.vx -= normal.x*impulse/car.mass; car.vz -= normal.z*impulse/car.mass;
        car.yawRate -= cross*impulse/car.inertia;
        if (impulse > 100) {
          const severity = this._damage(car,normal,impulse);
          this._event('environment',[car],car.x+offset.x,car.z+offset.z,impulse,severity,obstacle);
        }
      }
      const correction = Math.min(.6,Math.max(0,penetration-.003)*.85);
      car.x -= normal.x*correction; car.z -= normal.z*correction;
      car.targetLane=0; car.laneHoldUntil=this.elapsed+1;
    }
  }

  _updateProgress(car, dt, startTime) {
    const projection = this._project(car);
    const previous = car.progress;
    const delta = angle((projection.distance - car.distance) / this.trackLength * Math.PI * 2)
      / (Math.PI * 2) * this.trackLength;
    car.progress += delta;
    car.distance = projection.distance;
    car.lane = projection.lane;
    const environmentSurface = this.environment.sampleSurface?.(car.x,car.z,projection.y);
    car.groundHeight = Number.isFinite(environmentSurface?.height) ? environmentSurface.height : projection.y;
    if (!car.airborne) { car.y=car.groundHeight;car.vy=0; }
    else if (car.y <= car.groundHeight && car.vy <= 0) {
      const landingSpeed=-car.vy;
      car.y=car.groundHeight;car.vy=0;car.airborne=false;
      const severity=clamp((landingSpeed**2*.5-2)/80*this.physics.damageScale,0,.65);
      if(severity>0){
        car.damage.total=clamp(1-(1-car.damage.total)*(1-severity*.6),0,1);
        car.damage.suspension=clamp(car.damage.suspension+severity*.5,0,1);
        this._event('landing',[car],car.x,car.z,landingSpeed*car.mass,severity);
      }
    }
    car.tx = projection.tx;
    car.tz = projection.tz;
    car.curvature = projection.curvature;
    car.speed = Math.hypot(car.vx,car.vz);
    if (delta > 0 && car.progress >= car.nextLapLine && previous < car.nextLapLine) {
      const crossing = startTime + dt * clamp((car.nextLapLine - previous) / delta,0,1);
      if (car.nextLapLine > 0 && car.lapStartedAt !== null) {
        const lap = crossing - car.lapStartedAt;
        car.lastLap = lap;
        car.bestLap = car.bestLap === null ? lap : Math.min(car.bestLap,lap);
        car.laps++;
      }
      car.lapStartedAt = crossing;
      car.nextLapLine += this.trackLength;
    }
    car.currentLapTime = car.lapStartedAt === null ? 0 : this.elapsed - car.lapStartedAt;
  }

  _step(dt) {
    const startTime = this.elapsed;
    for (const car of this.leaderboard) if (!car.held) this._driver(car,dt);
    for (const car of this.cars) if (!car.held) this._integrate(car,dt);
    this.elapsed += dt;
    for (const car of this.cars) if (!car.held) { this._barrier(car); this._environmentContacts(car); }
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
        this._collision(this.cars[i],this.cars[j],pass > 0);
      }
    }
    for (const car of this.cars) this._updateProgress(car,dt,startTime);
    const ranked = [...this.cars].sort((a,b) => b.progress - a.progress || a.id - b.id);
    ranked.forEach((car,i) => {
      const rank = i + 1;
      if (rank < car.rank && this.elapsed - car.lastPassAt > .7) {
        car.overtakes += car.rank - rank;
        car.lastPassAt = this.elapsed;
      }
      car.rank = rank;
    });
  }
}
