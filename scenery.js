import * as THREE from 'three';
import { floatForce } from './water.js';
import { createCityPlan, cityPoint } from './city.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A small model-making kit. Static pieces are baked together by material so
// trees, roof tiles, window frames and flower patches stay inexpensive to draw.
export function buildScenery({ group, theme = 'harbor', river:hasRiver = theme === 'harbor', samples, seed = 17, city = null, authoredProps = [] }) {
  const palettes = {
    harbor: { grass: '#9caf83', dark: '#50766b', leaf: '#78987a', light: '#bac89b', roof: '#bd775f', roof2: '#667e8b', wall: '#f3e6ca', wall2: '#dfb798', accent: '#e29c76', pond: '#83beb8', hill: '#96ad83' },
    alpine: { grass: '#98ad89', dark: '#4e776e', leaf: '#709382', light: '#b1c399', roof: '#967365', roof2: '#627b82', wall: '#f0e5ce', wall2: '#c7bda4', accent: '#d9a17e', pond: '#8bbdc1', hill: '#9bac8e' },
    sunset: { grass: '#acb68b', dark: '#697f70', leaf: '#8b9c7b', light: '#c7cb9f', roof: '#bc7979', roof2: '#877d98', wall: '#f7e4cd', wall2: '#e5c09e', accent: '#eba58c', pond: '#a9b7c8', hill: '#aab690' },
  };
  const cityPlan=city?createCityPlan(city):null;
  const p = palettes[theme] || palettes.harbor;
  let state = seed >>> 0;
  const rnd = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const range = (a, b) => a + rnd() * (b - a);
  const materials = {};
  const mat = (name, color, roughness = .85) => materials[name] = new THREE.MeshStandardMaterial({ color, roughness, metalness: name === 'metal' ? .22 : 0 });
  mat('grass', p.grass); mat('hill', p.hill); mat('leaf', p.leaf); mat('darkLeaf', p.dark); mat('lightLeaf', p.light);
  mat('trunk', '#8d7663'); mat('cream', p.wall); mat('ochre', p.wall2); mat('roof', p.roof); mat('roof2', p.roof2);
  mat('coral', p.accent); mat('white', '#fff2d9'); mat('stone', '#b0b3a4'); mat('rock', '#929f99');
  mat('wood', '#ad8c70'); mat('metal', '#607d79', .58); mat('glass', '#627f87', .28);
  mat('yellow', '#f0cc81'); mat('pink', '#dd9c9a'); mat('flower', '#ead6ae'); mat('pond', p.pond, .34);
  mat('path', '#d9c8a5'); mat('stripe', '#df9783');
  const batches = new Map();
  let frame = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const occupied = [];
  const animations = [];
  const colliders = [];
  const props = new Map();
  let activeProp = null;
  let previousTime = 0;
  let getVehicles=()=>[], strikeVehicle=()=>{}, disturbance=()=>{};
  const physics = { gravity: 9.81, restitution: .26 };
  let waterSampler=null;
  let groundSampler = (x, z) => x * x / (64 * 64) + z * z / (47 * 47) < 1 ? 0 : -3;
  const dynamic = new THREE.Group();
  group.add(dynamic);

  function createProp(kind, x, z, radius, mass, height, contentId) {
    const collider = { id: contentId || `${theme}-${kind}-${colliders.length}`, x, y: 0, z, radius, health: 1, mass, height, kind, solid: true };
    const prop = { collider, origin:{x,y:0,z}, held:false,moving:false,vx:0,vy:0,vz:0,cooldown:0, ranges: [], dynamic: [], angle: 0, angularVelocity: 0, collapse: 0, collapseVelocity: 0, directionX: 1, directionZ: 0, damage: 0, dirty: false, settled: false };
    colliders.push(collider); props.set(collider.id, prop); return prop;
  }
  function attachDynamic(prop, object) {
    prop.dynamic.push({ object, position: object.position.clone(), quaternion: object.quaternion.clone() });
  }

  function merge(geometries) {
    const prepared = geometries.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
    const result = mergeGeometries(prepared, false);
    prepared.forEach((geometry, i) => { if (geometry !== geometries[i]) geometry.dispose(); });
    return result;
  }

  function add(geometry, material, pos = [0, 0, 0], size = [1, 1, 1], rot = [0, 0, 0]) {
    position.fromArray(pos); scale.fromArray(size); rotation.setFromEuler(new THREE.Euler(...rot));
    matrix.compose(position, rotation, scale).premultiply(frame);
    geometry.applyMatrix4(matrix);
    geometry.userData.propId = activeProp?.collider.id;
    const bucket = batches.get(material) || [];
    bucket.push(geometry); batches.set(material, bucket);
  }
  function inFrame(x, y, z, yaw, fn) {
    const before = frame;
    frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    fn(); frame = before;
  }
  const box = (w, h, d, material, x, y, z, radius = .12, rot) => add(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, [x, y, z], [1, 1, 1], rot);
  const ball = (x, y, z, sx, sy, sz, material, detail = 12) => add(new THREE.SphereGeometry(1, detail, 8), material, [x, y, z], [sx, sy, sz]);
  const cylinder = (top, bottom, h, material, x, y, z, segments = 14, rot) => add(new THREE.CylinderGeometry(top, bottom, h, segments), material, [x, y, z], [1, 1, 1], rot);
  function rod(a, b, radius, material) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), direction = bv.clone().sub(av);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const geo = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
    geo.applyQuaternion(q); geo.translate(...av.add(bv).multiplyScalar(.5).toArray()); add(geo, material);
  }
  function distanceToRoad(x, z) {
    let closest = Infinity;
    for (const point of samples || []) closest = Math.min(closest, Math.hypot(point.x - x, point.z - z));
    return closest;
  }
  const river = [[12, -40], [24, -28], [33, -16], [45, -12], [64, -5]];
  function distanceToRiver(x, z) {
    let closest = Infinity;
    for (let i = 1; i < river.length; i++) {
      const [ax, az] = river[i - 1], [bx, bz] = river[i];
      const dx = bx - ax, dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      closest = Math.min(closest, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
    return closest;
  }
  function clear(x, z, radius = 1, extra = 0) {
    return (x * x / (60 * 60) + z * z / (43 * 43) < .93)
      && distanceToRoad(x, z) > 6.5 + radius
      && (!hasRiver || distanceToRiver(x, z) > 4 + radius)
      && !occupied.some(o => Math.hypot(x - o.x, z - o.z) < radius + o.r + extra);
  }
  function reserve(x, z, radius) { occupied.push({ x, z, r: radius }); }
  function findPlace(candidates, radius) {
    for (const [x, z] of candidates) if (clear(x, z, radius)) { reserve(x, z, radius); return [x, z]; }
    return null;
  }

  function gable(w, rise, depth, material, y) {
    const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(0, rise); shape.lineTo(w / 2, 0); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .045, bevelSize: .07, bevelSegments: 2, steps: 1, curveSegments: 2 });
    geometry.translate(0, 0, -depth / 2); add(geometry, material, [0, y, 0]);
  }
  function windowAt(x, y, z, width = .62, height = .72) {
    box(width + .15, height + .15, .11, materials.white, x, y, z, .08);
    box(width, height, .06, materials.glass, x, y, z + .075, .06);
    box(.045, height, .07, materials.white, x, y, z + .12, .01);
    box(width, .045, .07, materials.white, x, y, z + .12, .01);
    box(width + .22, .10, .23, materials.wood, x, y - height / 2 - .12, z + .08, .03);
  }
  function house(x, z, yaw, index = 0, large = false) {
    const w = large ? 5.3 : range(2.6, 3.8), d = large ? 3.7 : range(2.5, 3.4), h = large ? 3.9 : range(2.0, 3.2);
    if(clashesWithAuthored(x,z,Math.hypot(w+1.8,d+1.2)*.5))return;
    const prop = createProp('building', x, z, Math.hypot(w, d) * .5, large ? 1750 : 1050, h + w * .38);
    const beforeProp = activeProp; activeProp = prop;
    inFrame(x, 0, z, yaw, () => {
      box(w + .36, .3, d + .36, materials.stone, 0, .15, 0, .13);
      box(w, h, d, index % 3 === 0 ? materials.ochre : materials.cream, 0, h / 2 + .22, 0, .18);
      const roofMat = index % 3 === 1 ? materials.roof2 : materials.roof;
      gable(w + .55, w * .38, d + .6, roofMat, h + .18);
      for (const zi of [-d / 2 - .34, d / 2 + .34]) {
        rod([-w / 2 - .27, h + .18, zi], [0, h + .18 + w * .38, zi], .06, materials.white);
        rod([0, h + .18 + w * .38, zi], [w / 2 + .27, h + .18, zi], .06, materials.white);
      }
      box(.56, .96, .56, materials.ochre, w * .26, h + w * .28, -d * .25, .08);
      box(.7, .12, .7, materials.white, w * .26, h + w * .28 + .53, -d * .25, .03);
      box(.82, 1.34, .13, materials.wood, 0, .91, d / 2 + .09, .25);
      ball(.22, .9, d / 2 + .18, .045, .045, .03, materials.yellow, 6);
      box(1.1, .17, .56, materials.stone, 0, .17, d / 2 + .35, .04);
      if (large) {
        windowAt(-1.65, 1.6, d / 2 + .07, .75, .85); windowAt(1.65, 1.6, d / 2 + .07, .75, .85);
        for (const wx of [-1.65, 0, 1.65]) windowAt(wx, 3.0, d / 2 + .07, .72, .76);
        box(w + .05, .16, d + .05, materials.white, 0, 2.42, 0, .04);
        const canopy = new THREE.CylinderGeometry(.72, .72, 2.2, 12, 1, false, 0, Math.PI);
        add(canopy, materials.coral, [0, 1.95, d / 2 + .63], [1, 1, 1], [0, 0, Math.PI / 2]);
      } else {
        for (const wx of [-w * .30, w * .30]) windowAt(wx, h * .64 + .2, d / 2 + .07, .53, .65);
      }
      // A small round side window and climbing shrub soften the facades.
      cylinder(.3, .3, .09, materials.white, w / 2 + .08, h * .64, 0, 16, [0, 0, Math.PI / 2]);
      cylinder(.23, .23, .1, materials.glass, w / 2 + .14, h * .64, 0, 16, [0, 0, Math.PI / 2]);
      ball(-w / 2 - .3, .62, d / 2, .58, .7, .52, materials.leaf);
      ball(w / 2 + .22, .38, d / 2, .42, .46, .44, materials.lightLeaf);
    });
    activeProp = beforeProp;
  }

  // Authored scenery shares the existing collision, grab, damage and save paths.
  // Reserve its footprint first so generated buildings and trees leave room.
  const authoredFootprints = [];
  for (const placement of authoredProps) {
    const definition = placement.definition;
    const footprint = {x:placement.x,z:placement.z,r:definition.collider.radius};
    authoredFootprints.push(footprint);reserve(footprint.x,footprint.z,footprint.r);
    const id = `content/${placement.prop}/${placement.id || `${placement.x}:${placement.z}`}`;
    const prop = createProp(definition.kind || 'custom',placement.x,placement.z,definition.collider.radius,definition.collider.mass,definition.collider.height,id);
    prop.collider.contentId = placement.prop;prop.collider.name = definition.name;
    const previousProp = activeProp;activeProp = prop;
    inFrame(placement.x,0,placement.z,placement.yaw || 0,()=>{
      for(const part of definition.parts){
        const colorKey=`content:${part.color}`;
        const paint=materials[colorKey] || mat(colorKey,part.color);
        const geometry=part.shape==='box'?new THREE.BoxGeometry(...part.size):part.shape==='sphere'?new THREE.SphereGeometry(1,12,8):new THREE.CylinderGeometry(part.size[0],part.size[2],part.size[1],12);
        add(geometry,paint,part.position,part.shape==='sphere'?part.size:[1,1,1],part.rotation || [0,0,0]);
      }
    });
    activeProp = previousProp;
  }
  const clashesWithAuthored = (x,z,radius) => authoredFootprints.some(part=>Math.hypot(x-part.x,z-part.z)<radius+part.r+.25);

  if(!cityPlan){
  // Reserve the alpine skyline first, then let the village settle around it.
  const alpineHills = [];
  if (theme === 'alpine') {
    const candidates = [[16, 0, 6, 8], [-25, 4, 4, 5], [7, 13, 4.5, 6], [-20, 13, 3.8, 5.2], [24, 4, 4.5, 6.5]];
    for (const candidate of candidates) {
      const [x, z, radius] = candidate;
      if (!clear(x, z, radius)) continue;
      reserve(x, z, radius); alpineHills.push(candidate);
      if (alpineHills.length === 2) break;
    }
  }

  // The little town has breathing room and an organic layout inside the track.
  const village = [[-12, 7], [-5, 13], [4, 12], [12, 7], [20, 5], [-20, 5], [-19, -4], [-10, -6], [0, -10], [11, -9], [21, -6], [-29, 12]];
  let houseIndex = 0;
  for (const [x, z] of village) {
    const large = houseIndex === 0;
    if (!clear(x, z, large ? 4.1 : 3.1)) continue;
    reserve(x, z, large ? 4.1 : 3.1);
    house(x, z, Math.atan2(-x * .08, 1) + range(-.25, .25), houseIndex++, large);
  }
  // Inward turns can occupy the original town center. Find a few small houses
  // in the remaining clear pockets without putting foundations on the road.
  for (let z=-26;z<=26&&houseIndex<5;z+=10) for (let x=-36;x<=36&&houseIndex<5;x+=12) {
    if (!clear(x,z,3.1)) continue;
    reserve(x,z,3.1);house(x,z,Math.atan2(-x*.08,1),houseIndex++);
  }

  // Hills are buried ellipsoids rather than cones; stone crests give the
  // alpine version a different silhouette without making a wall of blocks.
  const hillCandidates = theme === 'alpine' ? alpineHills : [[4, -1, 5.2, 3], [16, -15, 4.4, 2.8], [-6, -13, 3.6, 2.1]];
  for (const [x, z, radius, height] of hillCandidates) {
    if (theme !== 'alpine') {
      if (!clear(x, z, radius)) continue;
      reserve(x, z, radius);
    }
    ball(x, -.5, z, radius, height, radius * .85, materials.hill, 24);
    if (theme === 'alpine') {
      add(new THREE.IcosahedronGeometry(1, 2), materials.rock, [x, height * .55, z], [radius * .51, height * .38, radius * .48], [0, range(0, 2), .07]);
      ball(x - .28, height * .91, z - .3, radius * .31, height * .13, radius * .28, materials.white, 16);
    }
  }

  function tree(x, z, size, pine = false) {
    const prop = createProp('tree', x, z, size * .14 + .10, Math.max(50, size * size * 58), size * 1.9);
    const beforeProp = activeProp; activeProp = prop;
    const trunkHeight = size * .85;
    cylinder(size * .055, size * .08, trunkHeight, materials.trunk, x, trunkHeight / 2, z, 6);
    if (pine) {
      for (let j = 0; j < 3; j++) {
        const r = size * (.54 - j * .11);
        add(new THREE.ConeGeometry(r, size * .92, 12, 1), j === 2 ? materials.leaf : materials.darkLeaf, [x, size * (.71 + j * .34), z]);
        ball(x, size * (1.13 + j * .29), z, r * .24, size * .21, r * .24, materials.darkLeaf, 8);
      }
    } else {
      const leaf = rnd() < .28 ? materials.lightLeaf : rnd() < .25 ? materials.darkLeaf : materials.leaf;
      ball(x, size * 1.16, z, size * .6, size * .72, size * .58, leaf);
      ball(x - size * .32, size * .95, z + size * .06, size * .43, size * .48, size * .43, leaf);
      ball(x + size * .28, size * 1.09, z - size * .1, size * .43, size * .51, size * .42, leaf);
    }
    activeProp = beforeProp;
  }

  // Animated windmill, including thin batten strips across its sails.
  const millPlace = findPlace([[-26, 12], [25, 12], [-24, -6], [8, 21], [-35, -5]], 4.5);
  if (millPlace) {
    const [x, z] = millPlace;
    const yaw = -.15;
    const millProp = createProp('windmill', x, z, 2.35, 1950, 9.2);
    activeProp = millProp;
    inFrame(x, 0, z, yaw, () => {
      cylinder(1.8, 2.35, .45, materials.stone, 0, .225, 0);
      cylinder(1.26, 1.87, 7.0, materials.cream, 0, 3.8, 0, 24);
      cylinder(1.4, 1.5, .22, materials.wood, 0, 7.05, 0, 24);
      add(new THREE.ConeGeometry(1.9, 2.1, 24), materials.roof, [0, 8.1, 0]);
      box(.87, 1.5, .13, materials.wood, 0, 1.18, 1.83, .25);
      windowAt(0, 3.8, 1.58, .53, .68);
      windowAt(0, 5.65, 1.40, .43, .6);
      cylinder(.44, .44, .4, materials.wood, 0, 6.45, 1.65, 12, [Math.PI / 2, 0, 0]);
    });
    activeProp = null;
    const mill = new THREE.Group(); mill.name = 'Windmill sails'; mill.position.set(x, 6.45, z); mill.rotation.y = yaw; dynamic.add(mill);
    attachDynamic(millProp, mill);
    const rotor = new THREE.Group(); rotor.position.z = 1.95; mill.add(rotor);
    const sailGeos = [], battenGeos = [];
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2;
      const make = (geo, px, py, pz, list) => { geo.translate(px, py, pz); geo.rotateZ(a); list.push(geo); };
      make(new RoundedBoxGeometry(.78, 3.45, .16, 2, .07), .10, 2.26, 0, sailGeos);
      make(new THREE.CylinderGeometry(.055, .055, 4.1, 6), -.25, 2.0, .12, battenGeos);
      for (let k = 0; k < 7; k++) make(new RoundedBoxGeometry(.98, .055, .06, 1, .012), .1, .78 + k * .49, .13, battenGeos);
    }
    for (const [geos, material] of [[sailGeos, materials.white], [battenGeos, materials.wood]]) {
      const mesh = new THREE.Mesh(merge(geos), material); mesh.castShadow = true; rotor.add(mesh); geos.forEach(g => g.dispose());
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(.33, 12, 8), materials.coral); hub.position.z = .22; rotor.add(hub);
    let millTime = 0;
    animations.push(time => {
      const dt = Math.max(0, time - millTime); millTime = time;
      if (millProp.collider.health > 0) rotor.rotation.z -= dt * .24 * (.35 + millProp.collider.health * .65);
    });
  }

  // A miniature fairground with level gondolas, no matter how the wheel turns.
  const wheelPlace = findPlace([[27, -3], [-8, 20], [17, 18], [-28, -3], [-3, 0], [-18, 17]], 5.9);
  if (wheelPlace) {
    const [x, z] = wheelPlace, radius = 4.6, center = 5.7, yaw = -.25;
    const wheelProp = createProp('fairground', x, z, 4.5, 2000, center + radius);
    activeProp = wheelProp;
    inFrame(x, 0, z, yaw, () => {
      cylinder(5.7, 5.8, .17, materials.path, 0, .09, 0, 40);
      for (const zz of [-.77, .77]) {
        rod([-2.8, .2, zz], [0, center, zz], .17, materials.white);
        rod([2.8, .2, zz], [0, center, zz], .17, materials.white);
      }
      box(2.4, .3, 1.5, materials.wood, 0, .25, 2.6, .08);
      box(1.8, 1.9, 1.5, materials.cream, 3.1, .95, 2.1, .1);
      add(new THREE.ConeGeometry(1.43, 1.03, 4), materials.coral, [3.1, 2.4, 2.1], [1, 1, .83], [0, Math.PI / 4, 0]);
      windowAt(3.1, 1.27, 2.91, .76, .62);
    });
    activeProp = null;
    const fair = new THREE.Group(); fair.name = 'Ferris wheel'; fair.position.set(x, 0, z); fair.rotation.y = yaw; dynamic.add(fair);
    attachDynamic(wheelProp, fair);
    const wheel = new THREE.Group(); wheel.position.y = center; fair.add(wheel);
    const ringGeos = [];
    for (const zz of [-.43, .43]) {
      const ring = new THREE.TorusGeometry(radius, .10, 6, 64); ring.translate(0, 0, zz); ringGeos.push(ring);
      for (let j = 0; j < 10; j++) {
        const a = j * Math.PI / 5;
        const spoke = new THREE.CylinderGeometry(.041, .041, radius, 5); spoke.rotateZ(a - Math.PI / 2); spoke.translate(Math.cos(a) * radius / 2, Math.sin(a) * radius / 2, zz); ringGeos.push(spoke);
      }
    }
    const ringMesh = new THREE.Mesh(merge(ringGeos), materials.white); ringMesh.castShadow = true; wheel.add(ringMesh); ringGeos.forEach(g => g.dispose());
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.37, .37, 1.55, 16), materials.yellow); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    const cabGeometry = new RoundedBoxGeometry(1.18, .52, .92, 2, .17); cabGeometry.translate(0, -.60, 0);
    const cabMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .75 });
    const cabins = new THREE.InstancedMesh(cabGeometry, cabMat, 10); cabins.castShadow = true; fair.add(cabins);
    const canopyGeometry = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); canopyGeometry.scale(.66, .22, .51); canopyGeometry.translate(0, .08, 0);
    const canopies = new THREE.InstancedMesh(canopyGeometry, materials.white, 10); fair.add(canopies);
    const uprights = [];
    for (const xx of [-.48, .48]) {
      const support = new THREE.CylinderGeometry(.035, .035, .66, 5); support.translate(xx, -.19, 0); uprights.push(support);
    }
    const rails = new THREE.InstancedMesh(merge(uprights), materials.metal, 10); fair.add(rails); uprights.forEach(g => g.dispose());
    const colors = [p.accent, '#edcf88', '#91b8a7', '#b7a3be'];
    for (let j = 0; j < 10; j++) cabins.setColorAt(j, new THREE.Color(colors[j % colors.length]));
    const temp = new THREE.Object3D();
    let wheelTime = 0, wheelTurn = 0;
    animations.push(time => {
      const dt = Math.max(0, time - wheelTime); wheelTime = time;
      if (wheelProp.collider.health > 0) wheelTurn += dt * .12 * (.35 + wheelProp.collider.health * .65);
      const turn = wheelTurn; wheel.rotation.z = turn;
      for (let j = 0; j < 10; j++) {
        const a = j * Math.PI / 5 + turn;
        temp.position.set(Math.cos(a) * radius, center + Math.sin(a) * radius, 0);
        temp.rotation.set(0, 0, Math.sin(time * .65 + j) * .027); temp.updateMatrix();
        cabins.setMatrixAt(j, temp.matrix); canopies.setMatrixAt(j, temp.matrix); rails.setMatrixAt(j, temp.matrix);
      }
      cabins.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = rails.instanceMatrix.needsUpdate = true;
    });
  }

  if (theme === 'harbor') {
    const lighthousePlace = findPlace([[52, -17], [53, -12], [-53, -12], [48, 22], [-48, 22]], 2.8);
    if (lighthousePlace) {
      const [x, z] = lighthousePlace;
      const lighthouseProp = createProp('lighthouse', x, z, 2.1, 2000, 12.5);
      activeProp = lighthouseProp;
      inFrame(x, 0, z, .18, () => {
        cylinder(2.5, 2.75, .45, materials.stone, 0, .22, 0, 28);
        cylinder(1.03, 1.58, 9.3, materials.white, 0, 4.9, 0, 28);
        for (const yy of [2.6, 5.4, 8.2]) cylinder(1.59 - yy * .057, 1.65 - yy * .057, .76, materials.coral, 0, yy, 0, 28);
        cylinder(1.85, 1.85, .22, materials.wood, 0, 9.67, 0, 28);
        cylinder(.99, .99, 1.4, materials.glass, 0, 10.44, 0, 20);
        for (let j = 0; j < 8; j++) {
          const a = j * Math.PI / 4;
          cylinder(.045, .045, 1.48, materials.white, Math.sin(a) * 1.01, 10.46, Math.cos(a) * 1.01, 5);
          cylinder(.04, .04, .67, materials.white, Math.sin(a) * 1.66, 10.05, Math.cos(a) * 1.66, 5);
        }
        add(new THREE.TorusGeometry(1.66, .04, 5, 28), materials.white, [0, 10.35, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
        add(new THREE.ConeGeometry(1.47, 1.2, 28), materials.roof, [0, 11.76, 0]);
        ball(0, 12.48, 0, .17, .2, .17, materials.yellow);
        box(.71, 1.32, .1, materials.wood, 0, 1.03, 1.58, .22);
        for (const yy of [3.5, 6.5]) windowAt(0, yy, 1.59 - yy * .059, .36, .55);
        ball(0, 10.44, 0, .33, .39, .33, materials.yellow, 12);
      });
      activeProp = null;
    }
  }

  const pondPlace = findPlace([[3, 22], [-27, -9], [31, 13], [-3, -3]], 3.5);
  if (pondPlace) {
    const [x, z] = pondPlace;
    add(new THREE.CircleGeometry(1, 48), materials.pond, [x, .045, z], [3.3, 2.1, 1], [-Math.PI / 2, 0, .45]);
    for (let j = 0; j < 13; j++) {
      const a = j / 13 * Math.PI * 2;
      const px=x+Math.cos(a)*3.4,pz=z+Math.sin(a)*2.28;
      const sx=range(.3,.53),sz=range(.22,.4);
      if(!clashesWithAuthored(px,pz,Math.max(sx,sz)))ball(px,.17,pz,sx,.22,sz,materials.stone,8);
    }
    for (let j = 0; j < 4; j++) {
      const px = x + range(-1.8, 1.8), pz = z + range(-1.0, 1.0);
      cylinder(.21, .21, .024, materials.leaf, px, .08, pz, 8);
      ball(px, .13, pz, .095, .07, .095, materials.pink, 6);
    }
  }

  // A mix of trees at the edge and little garden clusters in the town.
  let trees = 0;
  for (let attempt = 0; attempt < 620 && trees < 92; attempt++) {
    const x = range(-56, 56), z = range(-39, 39), size = range(1.1, 2.2);
    if (!clear(x, z, size * .52, .2) || clashesWithAuthored(x,z,size*.77)) continue;
    tree(x, z, size, theme === 'alpine' ? rnd() < .78 : rnd() < .12);
    reserve(x, z, size * .43); trees++;
  }
  for (let attempt = 0; attempt < 170; attempt++) {
    const x = range(-53, 53), z = range(-38, 38);
    if (!clear(x, z, .45) || clashesWithAuthored(x,z,.88)) continue;
    if (rnd() < .45) {
      ball(x, .32, z, .58, .35, .49, materials.lightLeaf, 8);
      ball(x + .34, .28, z + .17, .42, .3, .4, materials.leaf, 8);
    } else {
      const flowerMat = [materials.yellow, materials.pink, materials.flower][Math.floor(rnd() * 3)];
      for (let j = 0; j < 4; j++) {
        const px = x + range(-.46, .46), pz = z + range(-.4, .4), h = range(.19, .35);
        cylinder(.018, .018, h, materials.darkLeaf, px, h / 2, pz, 4);
        ball(px, h, pz, .12, .075, .12, flowerMat, 6);
      }
    }
  }
  for (let j = 0; j < 27; j++) {
    const x = range(-55, 55), z = range(-39, 39);
    if (!clear(x, z, .8)) continue;
    activeProp = createProp('rock', x, z, .60, 160, .75);
    add(new THREE.IcosahedronGeometry(1, 1), j % 2 ? materials.stone : materials.rock, [x, .23, z], [range(.4, .8), range(.24, .52), range(.36, .7)], [range(0, .3), range(0, 6), range(0, .3)]);
    activeProp = null;
  }

  function balloon(x, altitude, z, radius, color, phase) {
    const balloonGroup = new THREE.Group(); balloonGroup.name = 'Hot air balloon'; balloonGroup.position.set(x, altitude, z); dynamic.add(balloonGroup);
    const colored = [], pale = [];
    for (let j = 0; j < 8; j++) {
      const panel = new THREE.SphereGeometry(radius, 6, 16, j * Math.PI / 4, Math.PI / 4, 0, Math.PI);
      panel.scale(1, 1.27, 1); (j % 2 ? colored : pale).push(panel);
    }
    const balloonMat = new THREE.MeshStandardMaterial({ color, roughness: .72 });
    for (const [geos, material] of [[colored, balloonMat], [pale, materials.white]]) {
      const mesh = new THREE.Mesh(merge(geos), material); mesh.castShadow = true; balloonGroup.add(mesh); geos.forEach(g => g.dispose());
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(radius * .26, radius * .2, .4, 14), balloonMat); neck.position.y = -radius * 1.2; balloonGroup.add(neck);
    const basket = new THREE.Mesh(new RoundedBoxGeometry(.80, .65, .73, 2, .13), materials.wood); basket.position.y = -radius * 1.27 - 1.08; basket.castShadow = true; balloonGroup.add(basket);
    const ropes = [];
    for (const xx of [-.29, .29]) for (const zz of [-.25, .25]) {
      const rope = new THREE.CylinderGeometry(.02, .02, .97, 4); rope.translate(xx, -radius * 1.27 - .53, zz); ropes.push(rope);
    }
    balloonGroup.add(new THREE.Mesh(merge(ropes), materials.white)); ropes.forEach(g => g.dispose());
    animations.push(time => {
      balloonGroup.position.y = altitude + Math.sin(time * .31 + phase) * .85;
      balloonGroup.position.x = x + Math.sin(time * .13 + phase) * 1.15;
      balloonGroup.rotation.z = Math.sin(time * .22 + phase) * .035;
    });
  }
  balloon(-32, 19.5, -11, 1.85, p.accent, .2);
  balloon(17, 22, -17, 2.05, '#e2bf78', 2.4);
  balloon(33, 17.5, 14, 1.45, '#93b0b5', 4.5);

  function sailboat(x, z, yaw, color, phase) {
    const boat = new THREE.Group(); boat.name = 'Sailboat'; boat.position.set(x, -3, z); boat.rotation.y = yaw; dynamic.add(boat);
    const boatProp = createProp('boat', x, z, 2.65, 450, 4.6); boatProp.collider.y = -3; boatProp.origin.y = -3; attachDynamic(boatProp, boat);
    const hullGeometry = new THREE.SphereGeometry(1, 28, 14);
    const hullPositions = hullGeometry.attributes.position;
    for (let i = 0; i < hullPositions.count; i++) {
      const y = hullPositions.getY(i);
      hullPositions.setXYZ(i, hullPositions.getX(i) * 2.65, y * (y > 0 ? .25 : .68) + .11, hullPositions.getZ(i) * .90);
    }
    hullGeometry.computeVertexNormals();
    const hullMaterial = new THREE.MeshStandardMaterial({ color, roughness: .66 });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial); hull.castShadow = true; boat.add(hull);
    const deckGeometry = new RoundedBoxGeometry(3.60, .17, 1.12, 3, .13); deckGeometry.translate(-.08, .33, 0);
    const deck = new THREE.Mesh(deckGeometry, materials.wood); deck.castShadow = true; boat.add(deck);
    const rig = [];
    const rigRod = (a, b, radius) => {
      const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), direction = bv.clone().sub(av);
      const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 8);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
      geometry.translate(...av.add(bv).multiplyScalar(.5).toArray()); rig.push(geometry);
    };
    rigRod([-.22, .35, 0], [-.22, 4.6, 0], .055);
    rigRod([-.22, .69, 0], [2.18, .69, 0], .043);
    rigRod([-.22, 4.52, 0], [-2.2, .35, 0], .014);
    rigRod([-.22, 4.52, 0], [2.3, .35, 0], .014);
    rigRod([-1.78, .40, -.43], [-1.78, .40, .43], .042);
    const mast = new THREE.Mesh(merge(rig), materials.metal); mast.castShadow = true; boat.add(mast); rig.forEach(g => g.dispose());
    function cloth(a, b, c) {
      const positions = [], uv = [], indices = [], row = [], steps = 10;
      for (let i = 0; i <= steps; i++) {
        row[i] = [];
        for (let j = 0; j <= steps - i; j++) {
          row[i][j] = positions.length / 3;
          const u = i / steps, v = j / steps, w = 1 - u - v;
          positions.push(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * Math.sin(Math.PI * w) * .45);
          uv.push(u, v);
        }
      }
      for (let i = 0; i < steps; i++) for (let j = 0; j < steps - i; j++) {
        indices.push(row[i][j], row[i + 1][j], row[i][j + 1]);
        if (i + j < steps - 1) indices.push(row[i + 1][j], row[i + 1][j + 1], row[i][j + 1]);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
      return geometry;
    }
    const sails = [cloth([-.18, .74, .01], [-.18, 4.42, .01], [2.05, .74, .01]), cloth([-.3, .73, .01], [-.3, 3.77, .01], [-2.05, .73, .01])];
    const sailMaterial = new THREE.MeshStandardMaterial({ color: '#fff1d4', roughness: .82, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(merge(sails), sailMaterial); sail.castShadow = true; boat.add(sail); sails.forEach(g => g.dispose());
    const cabinGeometry = new RoundedBoxGeometry(1.05, .34, .72, 2, .14); cabinGeometry.translate(-.66, .58, 0);
    const cabin = new THREE.Mesh(cabinGeometry, materials.white); cabin.castShadow = true; boat.add(cabin);
    animations.push(time => {
      if (boatProp.collider.health < 1) return;
      boat.position.y = -3 + Math.sin(time * .80 + phase) * .085;
      boat.rotation.x = Math.sin(time * .56 + phase) * .025;
      boat.rotation.z = Math.sin(time * .71 + phase) * .035;
      boat.rotation.y = yaw + Math.sin(time * .09 + phase) * .045;
    });
  }
  if (theme === 'harbor') {
    sailboat(-72, 0, -.35, p.roof2, .6);
    sailboat(68, 24, 2.3, p.accent, 2.8);
  }

  }else{
    function urbanBuilding(x,z,w,d,h,index){
      if(clashesWithAuthored(x,z,Math.hypot(w+.5,d+.5)*.5))return;
      const prop=createProp('building',x,z,Math.hypot(w,d)*.5,700+h*180,h+.8),before=activeProp;activeProp=prop;
      const historic=city.style==='historic',roofMat=index%3===0?materials.roof:materials.roof2;
      add(new THREE.BoxGeometry(w+.15,.23,d+.15),materials.stone,[x,.13,z]);
      add(new THREE.BoxGeometry(w,h,d),index%4===0?materials.ochre:materials.cream,[x,h*.5+.22,z]);
      if(historic||h<4.2)inFrame(x,0,z,0,()=>gable(w+.24,.65,d+.23,roofMat,h+.21));
      else {add(new THREE.BoxGeometry(w+.13,.19,d+.13),roofMat,[x,h+.31,z]);add(new THREE.BoxGeometry(w*.35,.34,d*.25),materials.metal,[x+w*.2,h+.55,z]);}
      const floors=Math.floor(h/1.15);
      for(let level=0;level<floors;level++)for(const side of [-1,1]){
        const y=.95+level*1.12;
        for(const off of [-.26,.26])add(new THREE.BoxGeometry(w*.18,.52,.035),materials.glass,[x+off*w,y,z+side*(d*.5+.024)]);
        add(new THREE.BoxGeometry(.035,.52,d*.34),materials.glass,[x+side*(w*.5+.024),y,z]);
      }
      add(new THREE.BoxGeometry(.38,.68,.045),materials.wood,[x,.57,z+d*.5+.035]);
      if(index%5===0)add(new THREE.BoxGeometry(w*.9,.15,.35),materials.coral,[x,.95,z+d*.5+.18]);
      activeProp=before;
    }
    let building=0;
    for(const block of cityPlan.blocks){
      if(block.park){
        const p=cityPoint(block,.5,.5),sizeX=Math.abs(block.corners[1].x-block.corners[0].x)-7,sizeZ=Math.abs(block.corners[3].z-block.corners[0].z)-7;
        add(new THREE.BoxGeometry(sizeX,.035,sizeZ),materials.lightLeaf,[p.x,.018,p.z]);
        add(new THREE.BoxGeometry(.65,.05,sizeZ),materials.path,[p.x,.065,p.z]);
        for(const side of [-1,1]){if(clashesWithAuthored(p.x+side*1.8,p.z-.1,.7))continue;add(new THREE.BoxGeometry(1.2,.18,.35),materials.wood,[p.x+side*1.8,.39,p.z]);add(new THREE.BoxGeometry(1.2,.43,.10),materials.wood,[p.x+side*1.8,.65,p.z-.2]);}
        continue;
      }
      for(const u of [.30,.5,.70])for(const v of [.34,.66]){
        const p=cityPoint(block,u,v),w=2.15+range(-.15,.17),d=2.45+range(-.12,.15);
        const downtown=city.style==='modern'&&block.i>=2&&block.j<=1||city.style==='garden'&&block.i>=2&&block.j>=2;
        const h=city.style==='historic'?range(2.7,5):downtown?range(6,12.5):range(2.5,5.5);
        urbanBuilding(p.x,p.z,w,d,h,building++);
      }
    }
    for(const e of cityPlan.edges){
      const a=cityPlan.nodes[e.a],b=cityPlan.nodes[e.b],dx=(b.x-a.x)/e.length,dz=(b.z-a.z)/e.length;
      for(const t of [.27,.73]){
        const x=a.x+(b.x-a.x)*t+dz*(cityPlan.width*.5+.7),z=a.z+(b.z-a.z)*t-dx*(cityPlan.width*.5+.7);
        if(clashesWithAuthored(x,z,.6))continue;
        const prop=createProp('tree',x,z,.17,75,2.8),before=activeProp;activeProp=prop;
        add(new THREE.CylinderGeometry(.055,.08,1.4,6),materials.trunk,[x,.7,z]);ball(x,1.9,z,.53,.85,.5,materials.leaf,8);activeProp=before;
      }
      if(e.id%2===0){const x=(a.x+b.x)*.5-dz*(cityPlan.width*.5+.8),z=(a.z+b.z)*.5+dx*(cityPlan.width*.5+.8);if(!clashesWithAuthored(x,z,.13)){add(new THREE.CylinderGeometry(.035,.055,3.2,6),materials.metal,[x,1.6,z]);ball(x,3.15,z,.13,.12,.13,materials.yellow,6);}}
    }
    // Signals are part of the simulated street graph rather than scenery props.
    for(const n of cityPlan.nodes){const x=n.x+cityPlan.width*.58,z=n.z+cityPlan.width*.58;if(clashesWithAuthored(x,z,.16))continue;add(new THREE.CylinderGeometry(.04,.06,2.3,6),materials.metal,[x,1.15,z]);add(new THREE.BoxGeometry(.22,.55,.2),materials.wood,[x,2.22,z]);}
  }
  for (const [material, geometries] of batches) {
    const geometry = merge(geometries);
    if (!geometry) continue;
    const hasDamageColors = geometries.some(part => part.userData.propId);
    const batchMaterial = hasDamageColors ? material.clone() : material;
    const mesh = new THREE.Mesh(geometry, batchMaterial);
    mesh.castShadow = material !== materials.pond;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    let start = 0;
    for (const part of geometries) {
      const count = part.index ? part.index.count : part.attributes.position.count;
      const prop = props.get(part.userData.propId);
      if (prop) prop.ranges.push({ mesh, start, count, positions: geometry.attributes.position.array.slice(start * 3, (start + count) * 3), normals: geometry.attributes.normal.array.slice(start * 3, (start + count) * 3) });
      start += count;
    }
    if (hasDamageColors) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
      batchMaterial.vertexColors = true; batchMaterial.needsUpdate = true;
    }
    group.add(mesh);
    geometries.forEach(g => g.dispose());
  }

  // Debris follows translational and angular motion. The two shared draw calls
  // hold up to eighty live bodies, including settled fragments left on land.
  const debris = [];
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .93 });
  const debrisMeshes = [
    new THREE.InstancedMesh(new RoundedBoxGeometry(.8, .23, .25, 2, .06), debrisMaterial, 80),
    new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.48, 1), debrisMaterial, 80),
  ];
  for (const mesh of debrisMeshes) { mesh.name = 'Physics debris'; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); dynamic.add(mesh); }
  const debrisDummy = new THREE.Object3D();
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), axis = new THREE.Vector3(), tilt = new THREE.Quaternion();
  const changedMeshes = new Set();
  function spawnDebris(prop, event, count) {
    const collider = prop.collider;
    const speed = Math.min(13, Math.max(1, (Math.abs(Number(event.impulse) || 0) / Math.max(30, collider.mass)) * 2 + (Number(event.severity) || 0) * 4));
    const isWood = collider.kind === 'tree' || collider.kind === 'boat';
    for (let j = 0; j < count; j++) {
      if (debris.length >= 80) debris.shift();
      const size = isWood ? range(.7, 1.6) : range(.48, 1.25);
      const direction = range(-Math.PI, Math.PI), radial = range(.15, collider.radius * .85);
      debris.push({
        type: isWood ? 0 : 1, x: collider.x + Math.cos(direction) * radial, z: collider.z + Math.sin(direction) * radial,
        y: collider.y + groundSampler(collider.x, collider.z) + range(.45, Math.min(3, collider.height * .65)),
        vx: prop.directionX * speed * .55 + Math.cos(direction) * range(1, speed), vz: prop.directionZ * speed * .55 + Math.sin(direction) * range(1, speed), vy: range(1.2, 4.8),
        rx: range(0, 6), ry: range(0, 6), rz: range(0, 6), wx: range(-4, 4), wy: range(-4, 4), wz: range(-4, 4),
        size, radius: (isWood ? .18 : .43) * size, mass: collider.mass / Math.max(8, count * 3), restitution: isWood ? .31 : .22, friction: isWood ? .67 : .80,
        color: new THREE.Color(isWood ? '#97745c' : j % 3 === 0 ? p.roof : j % 3 === 1 ? p.wall : '#a7aa9b'), sleeping: false,
      });
    }
  }
  function renderProp(prop) {
    const c = prop.collider, damage = 1 - c.health;
    const isTree = c.kind === 'tree';
    const heightScale = isTree ? 1 : Math.max(.13, 1 - prop.collapse * .86);
    const spread = isTree ? 1 : 1 + prop.collapse * .16;
    axis.set(prop.directionZ, 0, -prop.directionX).normalize();
    tilt.setFromAxisAngle(axis, isTree ? prop.angle : damage * .08 * (1 - prop.collapse));
    for (const range of prop.ranges) {
      const positions = range.mesh.geometry.attributes.position;
      const normals = range.mesh.geometry.attributes.normal;
      const colors = range.mesh.geometry.attributes.color;
      for (let i = 0; i < range.positions.length; i += 3) {
        const x = range.positions[i] - prop.origin.x, y = range.positions[i + 1] - prop.origin.y, z = range.positions[i + 2] - prop.origin.z;
        const level = THREE.MathUtils.clamp(y / Math.max(1, c.height), 0, 1);
        point.set(x * spread, y * heightScale, z * spread);
        if (!isTree) {
          const crease = Math.sin(x * 4.2 + z * 3.7 + y * 2.4) * damage * .11;
          point.x += prop.directionX * damage * level * .28 + crease;
          point.z += prop.directionZ * damage * level * .28 + crease * .48;
          point.y += Math.abs(crease) * prop.collapse;
        }
        point.applyQuaternion(tilt);
        const destination = range.start * 3 + i;
        positions.array[destination] = point.x + c.x;
        positions.array[destination + 1] = point.y + c.y;
        positions.array[destination + 2] = point.z + c.z;
        normal.set(range.normals[i] / spread, range.normals[i + 1] / heightScale, range.normals[i + 2] / spread).applyQuaternion(tilt).normalize();
        normals.array[destination] = normal.x; normals.array[destination + 1] = normal.y; normals.array[destination + 2] = normal.z;
        if (colors) {
          const abrasion = damage * (.11 + .12 * Math.abs(Math.sin(x * 14 + z * 19)));
          colors.array[destination] = 1 - abrasion; colors.array[destination + 1] = 1 - abrasion * 1.15; colors.array[destination + 2] = 1 - abrasion * 1.3;
        }
      }
      changedMeshes.add(range.mesh);
    }
    for (const item of prop.dynamic) {
      point.copy(item.position).sub(new THREE.Vector3(prop.origin.x, prop.origin.y, prop.origin.z));
      point.x *= spread; point.y *= heightScale; point.z *= spread; point.applyQuaternion(tilt);
      item.object.position.set(c.x + point.x, c.y + point.y, c.z + point.z);
      item.object.quaternion.copy(tilt).multiply(item.quaternion);
      item.object.scale.set(spread, heightScale, spread);
    }
    prop.dirty = false;
  }
  function applyImpact(colliderId, event = {}) {
    const prop = props.get(typeof colliderId === 'object' ? colliderId.id : colliderId);
    if (!prop || prop.collider.health <= 0) return false;
    const c = prop.collider;
    const impulse = Math.abs(Number(event.impulse) || 0), severity = THREE.MathUtils.clamp(Number(event.severity) || 0, 0, 1);
    const energy = Math.max(0, Number.isFinite(event.energy) ? event.energy : impulse * impulse / (2 * Math.max(30, c.mass)));
    const strength = c.kind === 'tree' ? .95 : c.kind === 'rock' ? 3 : 1.55;
    const damage = THREE.MathUtils.clamp(severity * .32 + energy / (Math.max(50, c.mass) * strength + 90), 0, 1);
    if (damage < .002) return false;
    const vx = Number(event.vx), vz = Number(event.vz);
    const eventX = Number(event.x), eventZ = Number(event.z);
    let dx = Number.isFinite(vx) ? vx : Number.isFinite(eventX) ? c.x - eventX : 1;
    let dz = Number.isFinite(vz) ? vz : Number.isFinite(eventZ) ? c.z - eventZ : 0;
    const length = Math.hypot(dx, dz) || 1; prop.directionX = dx / length; prop.directionZ = dz / length;
    if (!Math.hypot(prop.directionX, prop.directionZ)) prop.directionX = 1;
    const previousHealth = c.health;
    c.health = Math.max(0, c.health - damage); c.solid = c.health > 0; prop.damage = 1 - c.health; prop.dirty = true;
    if (c.health <= 0) {
      prop.angle = Math.max(prop.angle, .085);
      prop.angularVelocity += Math.min(2.6, impulse / Math.max(40, c.mass * c.height * .3) + .25);
      prop.collapseVelocity += Math.min(2.1, impulse / Math.max(60, c.mass * c.height) * .6 + .14);
      prop.settled = false;
      spawnDebris(prop, { ...event, severity: Math.max(.35, severity) }, c.kind === 'tree' ? 7 : c.kind === 'rock' ? 5 : 17);
    } else if (previousHealth - c.health > .13) spawnDebris(prop, event, c.kind === 'tree' ? 2 : 4);
    return { id: c.id, health: c.health, destroyed: !c.solid, damage: previousHealth - c.health };
  }
  function damageAt(x, z, radius = 6, energy = 1200) {
    const impacts = [];
    if (![x, z, radius, energy].every(Number.isFinite) || radius <= 0) return impacts;
    for (const c of colliders) {
      const distance = Math.hypot(c.x - x, c.z - z);
      if (distance > radius + c.radius || c.health <= 0) continue;
      const falloff = Math.max(.12, 1 - distance / Math.max(.01, radius + c.radius));
      const result = applyImpact(c.id, { x, z, energy: Math.max(0, energy) * falloff, impulse: Math.sqrt(Math.max(0, 2 * c.mass * energy * falloff)), severity: Math.min(1, energy / 1600) * falloff, vx: c.x - x, vz: c.z - z });
      if (result) impacts.push(result);
    }
    return impacts;
  }
  function pickProp(hit){
    if(!hit?.object)return null;
    for(const prop of props.values()){
      if(prop.ranges.some(r=>r.mesh===hit.object&&hit.face&&hit.face.a>=r.start&&hit.face.a<r.start+r.count))return prop.collider;
      for(const item of prop.dynamic){let object=hit.object;while(object){if(object===item.object)return prop.collider;object=object.parent;}}
    }
    return null;
  }
  function liftProp(id,height){const prop=props.get(id);if(!prop||!Number.isFinite(height))return false;prop.held=true;prop.moving=true;prop.collider.held=true;prop.collider.y=height;prop.vx=prop.vy=prop.vz=0;prop.dirty=true;renderProp(prop);updatePhysics(0);return prop.collider;}
  function moveProp(id,x,z,y){const prop=props.get(id);if(!prop?.held||![x,z,y].every(Number.isFinite))return false;Object.assign(prop.collider,{x,z,y});prop.dirty=true;renderProp(prop);updatePhysics(0);return true;}
  function releaseProp(id,velocity){const prop=props.get(id);if(!prop?.held)return false;prop.held=false;prop.collider.held=false;prop.moving=true;for(const [key,value] of Object.entries({vx:velocity.x,vy:velocity.y,vz:velocity.z}))prop[key]=Number.isFinite(value)?THREE.MathUtils.clamp(value,-35,35):0;return true;}
  function translateProp(prop,step){
    const c=prop.collider;if(prop.held||!prop.moving||step<=0)return;
    const substeps=Math.max(1,Math.ceil(step/.016)),dt=step/substeps;
    for(let i=0;i<substeps;i++){
      prop.cooldown=Math.max(0,prop.cooldown-dt);prop.vy-=physics.gravity*dt;const wet=waterSampler?.(c.x,c.z);if(wet)floatForce({get y(){return c.y},get vy(){return prop.vy},set vy(v){prop.vy=v},get vx(){return prop.vx},set vx(v){prop.vx=v},get vz(){return prop.vz},set vz(v){prop.vz=v}},wet,dt,physics.gravity,c.kind==='boat'?.24:.7,c.kind==='boat'||c.kind==='tree'?1:.2);prop.vx*=Math.exp(-dt*.2);prop.vz*=Math.exp(-dt*.2);
      c.x+=prop.vx*dt;c.y+=prop.vy*dt;c.z+=prop.vz*dt;prop.dirty=true;
      for(const other of colliders){
        if(other===c||other.health<=0||other.held||c.y>other.y+other.height||c.y+c.height<other.y)continue;
        const dx=c.x-other.x,dz=c.z-other.z,d=Math.hypot(dx,dz),radius=c.radius+other.radius;
        if(d>=radius)continue;const nx=dx/(d||1),nz=dz/(d||1),closing=-(prop.vx*nx+prop.vz*nz);
        c.x=other.x+nx*(radius+.03);c.z=other.z+nz*(radius+.03);
        if(closing>1&&prop.cooldown===0){const energy=.5*c.mass*closing*closing;applyImpact(c.id,{energy:energy*.45,severity:closing/12,vx:prop.vx,vz:prop.vz});applyImpact(other.id,{energy:energy*.45,severity:closing/12,vx:prop.vx,vz:prop.vz});disturbance(c.x,c.z,c.radius+7,closing);prop.cooldown=.12;}
        if(closing>0){prop.vx+=nx*closing*(1+physics.restitution);prop.vz+=nz*closing*(1+physics.restitution);}
      }
      for(const car of getVehicles()){
        const dx=car.x-c.x,dz=car.z-c.z,d=Math.hypot(dx,dz);
        if(car.held||d>c.radius+1||car.y+.8<c.y||car.y>c.y+c.height)continue;
        const nx=dx/(d||1),nz=dz/(d||1),closing=(prop.vx-car.vx)*nx+(prop.vz-car.vz)*nz;
        if(closing>1){const impulse=closing*(1+physics.restitution)/(1/c.mass+1/car.mass);strikeVehicle(car.id,{x:nx*impulse,z:nz*impulse},impulse);prop.vx-=nx*impulse/c.mass;prop.vz-=nz*impulse/c.mass;applyImpact(c.id,{energy:.5*impulse*closing,severity:closing/15,vx:prop.vx,vz:prop.vz});disturbance(c.x,c.z,c.radius+7,closing);}
      }
      const floor=groundSampler(c.x,c.z);
      if(c.y<floor){
        c.y=floor;const speed=Math.abs(prop.vy);
        if(speed>3){applyImpact(c.id,{energy:.5*c.mass*speed*speed*.12,severity:speed/20,vx:prop.vx,vz:prop.vz});disturbance(c.x,c.z,c.radius+7,speed);}
        prop.vy=speed>1?speed*physics.restitution:0;prop.vx*=.65;prop.vz*=.65;
        if(Math.hypot(prop.vx,prop.vz)<.18&&prop.vy<.3){prop.moving=false;prop.vx=prop.vy=prop.vz=0;}
      }
    }
  }
  function updatePhysics(dt) {
    const step = Math.min(.10, Math.max(0, dt));
    for (const prop of props.values()) {
      const c = prop.collider;
      if(waterSampler&&c.kind==='boat'&&!prop.held)prop.moving=true;
      translateProp(prop,step);
      if(prop.dynamic.length&&Math.hypot(c.x-prop.origin.x,c.y-prop.origin.y,c.z-prop.origin.z)>.001)prop.dirty=true;
      if (c.health === 1 && !prop.dirty) continue;
      if (c.kind === 'tree') {
        const previousAngle = prop.angle;
        if (step > 0 && c.health <= 0 && !prop.settled) {
          const limit = Math.PI * .5 - .12;
          prop.angularVelocity += 3 * physics.gravity / (2 * Math.max(1.5, c.height)) * Math.sin(prop.angle) * step;
          const nextAngle = prop.angle + prop.angularVelocity * step;
          if (nextAngle >= limit) {
            prop.angle = limit; prop.angularVelocity *= -physics.restitution * .6;
            if (Math.abs(prop.angularVelocity) < .12) { prop.angularVelocity = 0; prop.settled = true; }
          } else prop.angle = Math.max(.025, nextAngle);
        } else if (c.health > 0) prop.angle += ((1 - c.health) * .37 - prop.angle) * (1 - Math.exp(-step * 5));
        if (Math.abs(previousAngle - prop.angle) > .00002) prop.dirty = true;
      } else {
        const previousCollapse = prop.collapse;
        if (c.health <= 0 && prop.collapse < 1) { prop.collapseVelocity += physics.gravity / Math.max(1, c.height) * step; prop.collapse = Math.min(1, prop.collapse + prop.collapseVelocity * step); }
        else if (c.health > 0) prop.collapse += ((1 - c.health) * .20 - prop.collapse) * (1 - Math.exp(-step * 5));
        if (Math.abs(previousCollapse - prop.collapse) > .00002) prop.dirty = true;
      }
      if (prop.dirty) renderProp(prop);
    }
    for (const mesh of changedMeshes) { mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.normal.needsUpdate = true; if (mesh.geometry.attributes.color) mesh.geometry.attributes.color.needsUpdate = true; mesh.geometry.computeBoundingSphere(); }
    changedMeshes.clear();
    const counts = [0, 0];
    for (const body of debris) {
      if (step > 0 && body.sleeping && Math.abs(body.y - groundSampler(body.x, body.z) - body.radius) > .045) body.sleeping = false;
      if (step > 0 && !body.sleeping) {
        body.vy -= physics.gravity * step;
        const wet=waterSampler?.(body.x,body.z);if(wet)floatForce(body,wet,step,physics.gravity,body.radius*.8,body.type===0?1:.15);
        const airDrag = Math.exp(-step * .13); body.vx *= airDrag; body.vz *= airDrag;
        body.x += body.vx * step; body.y += body.vy * step; body.z += body.vz * step;
        body.rx += body.wx * step; body.ry += body.wy * step; body.rz += body.wz * step;
        const floor = groundSampler(body.x, body.z) + body.radius;
        if (body.y < floor) {
          body.y = floor;
          if (body.vy < -.45) body.vy = -body.vy * Math.min(1, physics.restitution * (body.type === 0 ? 1.2 : .85)); else body.vy = 0;
          const friction = Math.max(0, 1 - body.friction * physics.gravity * step / Math.max(.25, Math.hypot(body.vx, body.vz)));
          body.vx *= friction; body.vz *= friction; body.wx *= .62; body.wy *= .62; body.wz *= .62;
          if (Math.hypot(body.vx, body.vz) < .08 && Math.abs(body.vy) < .12) { body.sleeping = true; body.wx = body.wy = body.wz = 0; }
        }
      }
      const mesh = debrisMeshes[body.type], index = counts[body.type]++;
      debrisDummy.position.set(body.x, body.y, body.z); debrisDummy.rotation.set(body.rx, body.ry, body.rz); debrisDummy.scale.setScalar(body.size); debrisDummy.updateMatrix();
      mesh.setMatrixAt(index, debrisDummy.matrix); mesh.setColorAt(index, body.color);
    }
    debrisMeshes.forEach((mesh, i) => { mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
  }
  function reset() {
    debris.length = 0;
    for (const prop of props.values()) { Object.assign(prop.collider,prop.origin,{held:false});prop.held=prop.moving=false;prop.vx=prop.vy=prop.vz=prop.cooldown=0;prop.collider.health = 1; prop.collider.solid = true; prop.damage = prop.angle = prop.angularVelocity = prop.collapse = prop.collapseVelocity = 0; prop.settled = false; prop.dirty = true; renderProp(prop); }
    updatePhysics(0);
  }
  const update = (time, dt = Math.max(0, time - previousTime)) => {
    animations.forEach(animation => animation(time));
    updatePhysics(Number.isFinite(dt) ? dt : 0);
    previousTime = time;
  };
  const configurePhysics = values => {
    if (Number.isFinite(values?.gravity)) physics.gravity = THREE.MathUtils.clamp(values.gravity, 0, 30);
    if (Number.isFinite(values?.restitution)) physics.restitution = THREE.MathUtils.clamp(values.restitution, 0, 1);
  };
  update(0);
  const setGroundSampler = fn => {
    if (typeof fn !== 'function') return;
    groundSampler = (x, z) => {
      const wet=waterSampler?.(x,z);if(wet&&wet.depth>.08)return wet.bed;
      if(cityPlan?Math.abs(x)>64||Math.abs(z)>47:x*x/(64*64)+z*z/(47*47)>1)return -3;
      const height = fn(x, z); return Number.isFinite(height) ? height : 0;
    };
  };
  function exportState() {
    return {
      props: [...props.values()].filter(prop => prop.collider.health < 1 || prop.moving || Math.hypot(prop.collider.x-prop.origin.x,prop.collider.y-prop.origin.y,prop.collider.z-prop.origin.z)>.001).map(prop => ({ id: prop.collider.id, health: prop.collider.health, x:prop.collider.x,y:prop.collider.y,z:prop.collider.z,moving:prop.moving,vx:prop.vx,vy:prop.vy,vz:prop.vz, ...Object.fromEntries(['angle', 'angularVelocity', 'collapse', 'collapseVelocity', 'directionX', 'directionZ', 'settled'].map(key => [key, prop[key]])) })),
      debris: debris.map(body => ({ ...body, color: body.color.getHex() })),
    };
  }
  function restoreState(saved) {
    if (!saved || !Array.isArray(saved.props) || saved.props.length > props.size) return false;
    for (const item of saved.props) {
      const prop = props.get(item?.id);
      if (!prop || !Number.isFinite(item.health)) continue;
      prop.collider.health = THREE.MathUtils.clamp(item.health, 0, 1);
      prop.collider.solid = prop.collider.health > 0;
      for(const key of ['x','y','z'])if(Number.isFinite(item[key])&&Math.abs(item[key])<500)prop.collider[key]=item[key];
      for(const key of ['vx','vy','vz'])if(Number.isFinite(item[key])&&Math.abs(item[key])<=35)prop[key]=item[key];
      prop.held=false;prop.collider.held=false;prop.moving=item.moving===true;
      prop.damage = 1 - prop.collider.health;
      for (const key of ['angle', 'angularVelocity', 'collapse', 'collapseVelocity', 'directionX', 'directionZ']) if (Number.isFinite(item[key]) && Math.abs(item[key]) < 100) prop[key] = item[key];
      prop.settled = item.settled === true;
      prop.dirty = true;
      renderProp(prop);
    }
    if (Array.isArray(saved.debris)) {
      const keys = ['type','x','y','z','vx','vy','vz','rx','ry','rz','wx','wy','wz','size','radius','mass','restitution','friction'];
      for (const item of saved.debris.slice(0, 80)) {
        if (!item || !keys.every(key => Number.isFinite(item[key]) && Math.abs(item[key]) < 1e6) || !Number.isInteger(item.color)) continue;
        debris.push({ ...Object.fromEntries(keys.map(key => [key, item[key]])), color: new THREE.Color(item.color & 0xffffff), sleeping: item.sleeping === true });
      }
    }
    updatePhysics(0);
    return true;
  }
  const pedestrianHomes = colliders.filter(c=>c.kind==='building').map(c=>({x:c.x,z:c.z,radius:c.radius}));
  const isWalkable = (x,z) => (cityPlan?Math.abs(x)<45&&Math.abs(z)<33&&(cityPlan.distanceToRoad(x,z)>cityPlan.width*.5+.2||cityPlan.crossing(x,z)):clear(x,z,.28,-.1))&&colliders.every(c=>!c.solid||c.held||c.y>1.5||Math.hypot(c.x-x,c.z-z)>c.radius+.3);
  return { update, colliders, cityPlan, residentCount:city?.residents??36, pickProp, liftProp, moveProp, releaseProp, setInteractionHandlers:({vehicles,strike,react})=>{getVehicles=vehicles;strikeVehicle=strike;disturbance=react;}, applyImpact, damageAt, reset, configurePhysics, setWaterSampler:fn=>{waterSampler=fn;}, setGroundSampler, exportState, restoreState, pedestrianHomes, isWalkable, get debrisCount() { return debris.length; } };
}
