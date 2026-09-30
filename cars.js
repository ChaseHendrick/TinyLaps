import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeCarModel } from './race.js';

// All dimensions are in the same units as the road. The car's nose faces +Z.
const bodyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.48,
  metalness: 0.16,
});
const wheelMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.72,
  metalness: 0.15,
});
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#b6e7ed',
  transparent: true,
  opacity: 0.52,
  roughness: 0.12,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const selectionMaterial = new THREE.MeshBasicMaterial({
  color: '#ffe5a0',
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const selectionGeometry = new THREE.RingGeometry(1.26, 1.31, 64);
const numbers = new Map();
const damageDirections = ['total', 'front', 'rear', 'left', 'right'];
const deformationPoint = new Float32Array(3);
let smokeTexture;

function coloredPart(geometry, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  let result = geometry.clone();
  if (result.index) result = result.toNonIndexed();
  result.scale(...scale);
  result.rotateX(rotation[0]);
  result.rotateY(rotation[1]);
  result.rotateZ(rotation[2]);
  result.translate(...position);
  const rgb = new THREE.Color(color);
  const array = new Float32Array(result.attributes.position.count * 3);
  for (let i = 0; i < array.length; i += 3) {
    array[i] = rgb.r;
    array[i + 1] = rgb.g;
    array[i + 2] = rgb.b;
  }
  result.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return result;
}

const rounded = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
const sphere = new THREE.SphereGeometry(1, 12, 8);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
const tire = new THREE.TorusGeometry(0.168, 0.044, 8, 20);

function combine(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return geometry;
}

function makeWheelGeometry() {
  const parts = [];
  // The torus rounds the tire shoulders. All wheel parts share one draw call.
  parts.push(coloredPart(tire, '#222a2f', [0, 0, 0], [1, 1, 1.65], [0, Math.PI / 2, 0]));
  parts.push(coloredPart(cylinder, '#252d32', [0, 0, 0], [0.18, 0.10, 0.18], [0, 0, Math.PI / 2]));
  parts.push(coloredPart(cylinder, '#bec9c7', [0, 0, 0], [0.12, 0.143, 0.12], [0, 0, Math.PI / 2]));
  parts.push(coloredPart(cylinder, '#647271', [0, 0, 0], [0.086, 0.146, 0.086], [0, 0, Math.PI / 2]));
  parts.push(coloredPart(cylinder, '#dfdac2', [0, 0, 0], [0.037, 0.153, 0.037], [0, 0, Math.PI / 2]));
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    parts.push(coloredPart(cylinder, '#d6ddda', [0, Math.sin(angle) * 0.07, Math.cos(angle) * 0.07], [0.014, 0.15, 0.014], [0, 0, Math.PI / 2]));
  }
  return combine(parts);
}
const wheelGeometry = makeWheelGeometry();

function numberMaterial(number) {
  const key = String(number);
  if (numbers.has(key)) return numbers.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff9e7';
  ctx.beginPath();
  ctx.arc(128, 128, 119, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#23333c';
  ctx.stroke();
  ctx.font = `900 ${key.length > 2 ? 100 : 134}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#23333c';
  ctx.fillText(key, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.55,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  numbers.set(key, material);
  return material;
}

export function createCar(color, number, variant = 0, model = {}) {
  const definition = normalizeCarModel(model);
  const car = new THREE.Group();
  car.name = `${definition.body[0].toUpperCase()}${definition.body.slice(1)} ${number}`;
  const paint = new THREE.Color(color);
  const darkPaint = paint.clone().multiplyScalar(0.56);
  const cream = definition.stripeColor ?? '#fff4d6';
  const metal = definition.accentColor ?? '#c5d0cc';
  const rubber = '#27323a';
  const parts = [];
  const box = (c, p, s, r) => parts.push(coloredPart(rounded, c, p, s, r));
  const ball = (c, p, s, r) => parts.push(coloredPart(sphere, c, p, s, r));
  const tube = (c, p, s, r) => parts.push(coloredPart(cylinder, c, p, s, r));

  // A low bathtub body with round wheel arches and a gently raised bonnet.
  box(darkPaint, [0, 0.23, 0], [0.89, 0.19, 1.77]);
  box(paint, [0, 0.325, 0], [0.85, 0.24, 1.77]);
  box(paint, [0, 0.424, 0.47], [0.77, 0.18, 0.76]);
  box(paint, [0, 0.408, -0.64], [0.81, 0.22, 0.48]);
  for (const side of [-1, 1]) {
    box(paint, [side * 0.355, 0.426, -0.17], [0.14, 0.18, 0.55]);
    for (const z of [-0.59, 0.59]) {
      ball(paint, [side * 0.374, 0.326, z], [0.135, 0.145, 0.26]);
    }
  }
  if (definition.body === 'roadster') {
    box(rubber, [0, 0.43, -0.14], [0.55, 0.10, 0.57]);
    box('#4c554d', [0, 0.492, -0.22], [0.25, 0.13, 0.24]);
    box('#4c554d', [0, 0.535, -0.38], [0.28, 0.20, 0.07], [-0.13, 0, 0]);
  }

  // Two ivory racing stripes run over the bonnet and rounded tail.
  for (const side of [-1, 1]) {
    box(cream, [side * 0.058, 0.517, 0.47], [0.055, 0.007, 0.64]);
    box(cream, [side * 0.058, 0.521, -0.66], [0.055, 0.007, 0.30]);
  }
  box(metal, [0, 0.245, 0.916], [0.65, 0.045, 0.057]);
  box(metal, [0, 0.245, -0.909], [0.68, 0.045, 0.053]);
  box(rubber, [0, 0.338, 0.90], [0.34, 0.085, 0.027]);
  for (let i = -2; i <= 2; i++) {
    box(metal, [i * 0.051, 0.338, 0.919], [0.018, 0.073, 0.014]);
  }
  for (const side of [-1, 1]) {
    // Small chrome bezels frame warm headlamps and red tail lamps.
    ball(metal, [side * 0.285, 0.392, 0.837], [0.104, 0.086, 0.057]);
    ball('#fff0bd', [side * 0.285, 0.395, 0.875], [0.083, 0.067, 0.025]);
    box('#f56752', [side * 0.29, 0.365, -0.879], [0.105, 0.052, 0.025]);
    // Tiny wing mirrors and a polished exhaust are visible when zoomed in.
    tube(metal, [side * 0.435, 0.535, 0.057], [0.012, 0.105, 0.012], [0, 0, side * -0.8]);
    ball(metal, [side * 0.462, 0.568, 0.061], [0.05, 0.032, 0.034]);
    box('#35545d', [side * 0.463, 0.568, 0.039], [0.05, 0.033, 0.008]);
  }
  tube(metal, [0.29, 0.185, -0.871], [0.032, 0.19, 0.032], [Math.PI / 2, 0, 0]);
  tube(rubber, [0.29, 0.185, -0.969], [0.022, 0.007, 0.022], [Math.PI / 2, 0, 0]);

  if (definition.body === 'roadster') {
    // A helmeted driver keeps the scene playful at close range.
    ball(darkPaint, [0, 0.563, -0.245], [0.135, 0.135, 0.10]);
    ball(cream, [0, 0.725, -0.265], [0.123, 0.128, 0.12]);
    box(paint, [0, 0.837, -0.267], [0.039, 0.010, 0.075]);
    box('#284756', [0, 0.735, -0.159], [0.188, 0.062, 0.048]);
    ball(cream, [-0.1, 0.565, -0.09], [0.043, 0.038, 0.037]);
    ball(cream, [0.1, 0.565, -0.09], [0.043, 0.038, 0.037]);
    parts.push(coloredPart(new THREE.TorusGeometry(0.092, 0.013, 6, 16), rubber, [0, 0.57, -0.055], [1, 1, 1], [-0.33, 0, 0]));

    // A slim windshield with rounded corners and a simple chrome frame.
    box(metal, [0, 0.545, 0.133], [0.62, 0.024, 0.031]);
    box(metal, [0, 0.682, 0.08], [0.59, 0.018, 0.025]);
    for (const side of [-1, 1]) {
      box(metal, [side * 0.292, 0.61, 0.105], [0.018, 0.153, 0.024], [-0.34, 0, 0]);
    }

    if (variant % 3 === 1) {
      for (const side of [-1, 1]) {
        box(darkPaint, [side * 0.24, 0.515, -0.725], [0.035, 0.14, 0.035]);
      }
      box(paint, [0, 0.582, -0.735], [0.88, 0.043, 0.13], [-0.08, 0, 0]);
    } else if (variant % 3 === 2) {
      // A rounded roll hoop gives another silhouette without extra draw calls.
      parts.push(coloredPart(new THREE.TorusGeometry(0.17, 0.023, 6, 16, Math.PI), metal, [0, 0.52, -0.46]));
      for (const side of [-1, 1]) tube(metal, [side * 0.17, 0.492, -0.46], [0.023, 0.075, 0.023]);
    }
  } else if (definition.body === 'coupe') {
    // A closed two-door cabin adds an actual roof and framed side windows.
    box(paint, [0, .795, -.16], [.69, .10, .73]);
    for (const side of [-1, 1]) {
      box(paint, [side * .323, .652, -.15], [.026, .24, .64]);
      box(metal, [side * .322, .649, .174], [.026, .25, .027], [-.24, 0, 0]);
      box(paint, [side * .322, .645, -.476], [.034, .24, .032], [.18, 0, 0]);
      box(metal, [side * .435, .46, -.20], [.013, .026, .10]);
    }
    box(metal, [0, .552, .187], [.62, .024, .029]);
    box(metal, [0, .764, .134], [.62, .02, .025]);
    for (const side of [-1, 1]) box(cream, [side * .058, .85, -.16], [.055, .008, .65]);
  } else {
    // A forward cab and open bed distinguish the pickup without changing the
    // shared wheel mounts, chassis envelope, panel damage, or driving controls.
    box(paint, [0, .79, .08], [.70, .10, .48]);
    box(paint, [0, .635, -.16], [.70, .25, .042]);
    for (const side of [-1, 1]) {
      box(paint, [side * .335, .64, .072], [.035, .25, .44]);
      box(metal, [side * .323, .64, .29], [.025, .25, .025], [-.13, 0, 0]);
      box(paint, [side * .36, .52, -.51], [.08, .19, .59]);
      box(metal, [side * .42, .46, .015], [.012, .025, .09]);
    }
    box(darkPaint, [0, .447, -.515], [.63, .028, .58]);
    box(paint, [0, .52, -.805], [.70, .19, .038]);
    for (let i = -2; i <= 2; i++) box(metal, [i * .095, .465, -.52], [.012, .016, .54]);
    box(metal, [0, .53, .307], [.64, .024, .028]);
    box(metal, [0, .761, .275], [.62, .02, .025]);
  }

  const body = new THREE.Mesh(combine(parts), bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  car.add(body);

  const screen = definition.body === 'roadster' ? { height:.127, y:.61, z:.105, angle:-.34 }
    : definition.body === 'coupe' ? { height:.195, y:.65, z:.16, angle:-.24 }
    : { height:.21, y:.645, z:.293, angle:-.13 };
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(0.568, screen.height, 0.014, 2, 0.006), glassMaterial);
  windshield.position.set(0, screen.y, screen.z);
  windshield.rotation.x = screen.angle;
  car.add(windshield);
  if (definition.body !== 'roadster') {
    const windows = [];
    const centerZ = definition.body === 'coupe' ? -.15 : .07;
    const length = definition.body === 'coupe' ? .54 : .37;
    for (const side of [-1, 1]) windows.push(coloredPart(rounded, '#ffffff', [side * .34, .652, centerZ], [.015, .17, length]));
    windows.push(coloredPart(rounded, '#ffffff', [0, .655, definition.body === 'coupe' ? -.473 : -.183], [.57, .17, .012]));
    car.add(new THREE.Mesh(combine(windows), glassMaterial));
  }

  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30), numberMaterial(number));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(0, 0.523, 0.51);
  car.add(decal);

  const wheels = [];
  for (const side of [-1, 1]) {
    for (const z of [-0.59, 0.59]) {
      const mount = new THREE.Group();
      mount.position.set(side * 0.464, 0.212, z);
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.order = 'YXZ';
      wheel.userData.side = side;
      wheel.userData.axle = z > 0 ? 'front' : 'rear';
      wheel.userData.mount = mount;
      wheel.castShadow = true;
      mount.add(wheel);
      car.add(mount);
      wheels.push(wheel);
    }
  }

  const selectionRing = new THREE.Mesh(selectionGeometry, selectionMaterial);
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.012;
  selectionRing.visible = false;
  selectionRing.renderOrder = 2;
  car.add(selectionRing);
  car.userData.wheels = wheels;
  car.userData.selectionRing = selectionRing;
  car.userData.number = number;
  car.userData.wheelRadius = 0.212;
  car.userData.model = definition;
  car.userData.windshieldBase = screen;
  car.userData.body = body;
  car.userData.windshield = windshield;
  car.userData.numberDecal = decal;
  car.userData.damageState = { total: 0, front: 0, rear: 0, left: 0, right: 0 };
  car.userData.damageGeometry = {
    positions: body.geometry.attributes.position.array.slice(),
    colors: body.geometry.attributes.color.array.slice(),
    normals: body.geometry.attributes.normal.array.slice(),
    decalPositions: decal.geometry.attributes.position.array.slice(),
    applied: new Float32Array(5),
  };
  body.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  body.geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  body.geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  decal.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  // Scaling the complete group includes glass, decals, wheel mounts, selection,
  // and future smoke. Damage still operates in its unchanged local coordinates.
  car.scale.set(...definition.scale);
  return car;
}

function clampDamage(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function smoothStep(a, b, value) {
  const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The crush is local to the hit panel. The cockpit and driver remain protected.
// Original coordinates make the deformation reproducible and fully reversible.
function deformPoint(x, y, z, damage, out) {
  const bodyHeight = 1 - smoothStep(0.56, 0.76, y);
  const front = damage.front * smoothStep(0.20, 0.96, z) * bodyHeight;
  const rear = damage.rear * smoothStep(0.25, 0.97, -z) * bodyHeight;
  const left = damage.left * smoothStep(0.16, 0.49, -x) * bodyHeight;
  const right = damage.right * smoothStep(0.16, 0.49, x) * bodyHeight;
  const longitudinal = front + rear;
  const lateral = left + right;
  const stress = Math.min(1, longitudinal + lateral);
  const fold = Math.sin(z * 24 + x * 11) * Math.cos(x * 17 - y * 5);
  const ridge = Math.sin(z * 13 - x * 9);
  const lowPanel = smoothStep(0.12, 0.26, y);
  out[0] = x + 0.145 * (left - right) + longitudinal * (x * 0.055 + ridge * 0.021);
  out[1] = Math.max(0.095, y + lowPanel * (stress * fold * 0.035 + longitudinal * smoothStep(0.32, 0.5, y) * 0.055 - lateral * 0.022));
  out[2] = z - front * (0.275 + fold * 0.034) + rear * (0.22 + ridge * 0.026) + lateral * Math.sin(z * 21) * 0.017;
  return stress;
}

/** Apply accumulated damage in [0, 1]. Left is local -X; front is local +Z. */
export function updateCarDamage(car, damage = {}) {
  const cache = car.userData.damageGeometry;
  if (!cache) return;
  const state = car.userData.damageState;
  let changed = false;
  let anyDamage = false;
  for (let i = 0; i < damageDirections.length; i++) {
    const key = damageDirections[i];
    state[key] = clampDamage(damage[key]);
    const difference = Math.abs(state[key] - cache.applied[i]);
    if (difference >= 0.008 || (state[key] === 0 && cache.applied[i] !== 0)) changed = true;
    if (state[key] !== 0) anyDamage = true;
  }
  if (!changed) return;
  for (let i = 0; i < damageDirections.length; i++) cache.applied[i] = state[damageDirections[i]];
  const body = car.userData.body;
  const positions = body.geometry.attributes.position;
  const colors = body.geometry.attributes.color;

  if (!anyDamage) {
    positions.array.set(cache.positions);
    colors.array.set(cache.colors);
    body.geometry.attributes.normal.array.set(cache.normals);
    body.geometry.attributes.normal.needsUpdate = true;
  } else {
    for (let i = 0; i < cache.positions.length; i += 3) {
      const x = cache.positions[i];
      const y = cache.positions[i + 1];
      const z = cache.positions[i + 2];
      const stress = deformPoint(x, y, z, state, deformationPoint);
      positions.array[i] = deformationPoint[0];
      positions.array[i + 1] = deformationPoint[1];
      positions.array[i + 2] = deformationPoint[2];
      const grain = 0.5 + 0.5 * Math.sin(x * 137 + y * 83) * Math.sin(z * 111 - y * 53);
      const scuff = Math.min(0.82, stress * (0.28 + grain * 0.56));
      // Abrasion darkens the struck panel; sharp folds expose dull bare metal.
      const bareMetal = stress > 0.48 && grain > 0.84;
      const r = bareMetal ? 0.25 : 0.038;
      const g = bareMetal ? 0.27 : 0.044;
      const b = bareMetal ? 0.26 : 0.042;
      colors.array[i] = cache.colors[i] * (1 - scuff) + r * scuff;
      colors.array[i + 1] = cache.colors[i + 1] * (1 - scuff) + g * scuff;
      colors.array[i + 2] = cache.colors[i + 2] * (1 - scuff) + b * scuff;
    }
    body.geometry.computeVertexNormals();
  }
  positions.needsUpdate = true;
  colors.needsUpdate = true;
  body.geometry.computeBoundingSphere();

  // Keep the painted number attached to the bonnet as the metal folds.
  const decal = car.userData.numberDecal;
  const decalPositions = decal.geometry.attributes.position;
  if (!anyDamage) {
    decalPositions.array.set(cache.decalPositions);
  } else {
    for (let i = 0; i < cache.decalPositions.length; i += 3) {
      const x = cache.decalPositions[i];
      const z = 0.51 - cache.decalPositions[i + 1];
      deformPoint(x, 0.523, z, state, deformationPoint);
      decalPositions.array[i] = deformationPoint[0];
      decalPositions.array[i + 1] = 0.51 - deformationPoint[2];
      decalPositions.array[i + 2] = deformationPoint[1] - 0.523;
    }
  }
  decalPositions.needsUpdate = true;
  decal.geometry.computeVertexNormals();

  const windshield = car.userData.windshield;
  const screen = car.userData.windshieldBase;
  const glassStress = Math.max(0, state.front - 0.35);
  windshield.rotation.set(screen.angle - glassStress * 0.48, (state.right - state.left) * 0.10, (state.left - state.right) * 0.11);
  windshield.position.set((state.left - state.right) * 0.013, screen.y - glassStress * 0.034, screen.z - glassStress * 0.026);
  windshield.visible = state.front < 0.93;
  if (state.front <= 0.4 && car.userData.engineSmoke) car.userData.engineSmoke.visible = false;
  for (const wheel of car.userData.wheels) {
    const mount = wheel.userData.mount;
    const sideDamage = wheel.userData.side < 0 ? state.left : state.right;
    const axleDamage = state[wheel.userData.axle];
    const suspensionDamage = Math.max(sideDamage * 0.9, axleDamage * 0.6);
    mount.rotation.z = -wheel.userData.side * suspensionDamage * 0.23;
    mount.rotation.y = wheel.userData.side * suspensionDamage * (wheel.userData.axle === 'front' ? 0.20 : -0.12);
    mount.position.x = wheel.userData.side * (0.464 - sideDamage * 0.036);
    mount.position.z = (wheel.userData.axle === 'front' ? 0.59 : -0.59) + (wheel.userData.axle === 'front' ? -1 : 1) * axleDamage * 0.045;
  }
}

function createEngineSmoke(car) {
  if (!smokeTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(110, 112, 110, 0.75)');
    gradient.addColorStop(0.45, 'rgba(118, 121, 117, 0.40)');
    gradient.addColorStop(1, 'rgba(128, 131, 127, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    smokeTexture = new THREE.CanvasTexture(canvas);
    smokeTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const smoke = new THREE.Group();
  smoke.name = 'Engine smoke';
  for (let i = 0; i < 5; i++) {
    const material = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    sprite.userData.phase = i / 5;
    smoke.add(sprite);
  }
  car.add(smoke);
  car.userData.engineSmoke = smoke;
  return smoke;
}

/** Animate smoke in seconds. This changes only transforms and opacity. */
export function updateCarEffects(car, time, damage = car.userData.damageState) {
  if (!damage) return;
  const engineDamage = clampDamage(damage.front);
  const intensity = Math.max(0, (engineDamage - 0.4) / 0.6);
  let smoke = car.userData.engineSmoke;
  if (intensity <= 0) {
    if (smoke) smoke.visible = false;
    return;
  }
  if (!smoke) smoke = createEngineSmoke(car);
  smoke.visible = true;
  const seed = Number(car.userData.number) || 1;
  for (const sprite of smoke.children) {
    const life = ((time * 0.42 + sprite.userData.phase + seed * 0.013) % 1 + 1) % 1;
    const drift = Math.sin(time * 0.9 + sprite.userData.phase * 11 + seed) * 0.05;
    sprite.position.set(drift + life * 0.19, 0.52 + life * 0.92, 0.50 - life * 0.28);
    sprite.scale.setScalar(0.16 + life * 0.50);
    sprite.material.opacity = intensity * 0.48 * Math.sin(Math.PI * life);
    sprite.material.rotation = sprite.userData.phase * 4 + life * 0.65;
  }
}
