import * as THREE from 'three';
import schema from '../schemas/content-pack.schema.json' with { type: 'json' };
import { buildTrack } from '../track.js';
import { createCityPlan } from '../city.js';
import { CAR_PROFILES } from '../race.js';

// This same JSON Schema drives validation in Node and the browser. Semantic
// checks below additionally prove road, island, and collision compatibility.
const freezeJSON = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
};
export const contentPackSchema = freezeJSON(schema);
const builtinCarId = profile => `builtin/${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const builtinCars = new Set(CAR_PROFILES.map(builtinCarId));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const diagnostic = (list, path, message) => list.push({ path, message });
const clone = value => JSON.parse(JSON.stringify(value));
const mod = (n, length) => ((n % length) + length) % length;

function plainJSON(value, errors, path = '$', seen = new Set(), depth = 0, budget = { count: 0 }) {
  if (budget.stopped) return false;
  if (++budget.count > 100000) {
    budget.stopped = true;
    diagnostic(errors, path, 'Content exceeds the supported JSON size or nesting depth.');
    return false;
  }
  if (depth > 20) {
    diagnostic(errors, path, 'Content exceeds the supported JSON size or nesting depth.');
    return false;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true;
    diagnostic(errors, path, 'Numbers must be finite.');
    return false;
  }
  if (typeof value !== 'object') {
    diagnostic(errors, path, 'Only plain JSON values are allowed; executable values are forbidden.');
    return false;
  }
  if (![Array.isArray(value) ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    diagnostic(errors, path, 'Only plain JSON objects are allowed.');
    return false;
  }
  if (seen.has(value)) {
    diagnostic(errors, path, 'Circular objects are not JSON content.');
    return false;
  }
  seen.add(value);
  let valid = true;
  if (Object.getOwnPropertySymbols(value).length) {
    diagnostic(errors, path, 'Symbol keys are not JSON content.');
    valid = false;
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (budget.stopped) { valid = false; break; }
    if (Array.isArray(value) && key === 'length') continue;
    if (descriptor.get || descriptor.set) {
      diagnostic(errors, `${path}.${key}`, 'Accessors are executable values, not JSON content.');
      valid = false;
      continue;
    }
    if (!descriptor.enumerable || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) {
      diagnostic(errors, `${path}.${key}`, 'Only enumerable JSON fields and array indices are allowed.');
      valid = false;
      continue;
    }
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      diagnostic(errors, `${path}.${key}`, 'Reserved object keys are forbidden.');
      valid = false;
    } else if (!plainJSON(descriptor.value, errors, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, seen, depth + 1, budget)) valid = false;
  }
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!own(value, i)) {
    diagnostic(errors, `${path}[${i}]`, 'Sparse arrays are not JSON content.');
    valid = false;
  }
  seen.delete(value);
  return valid;
}

// Implements the finite subset of Draft 2020-12 used by the shipped schema.
// No remote refs, custom keywords, dynamic imports, or generated code exist.
function checkSchema(value, rule, path, errors) {
  if (rule.$ref) {
    const target = rule.$ref.split('/').slice(1).reduce((current, key) => current?.[key], schema);
    if (!target) throw new Error(`Unsupported content schema reference ${rule.$ref}`);
    checkSchema(value, target, path, errors);
    return;
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (rule.type && !(rule.type === 'integer' ? type === 'number' && Number.isInteger(value) : type === rule.type)) {
    diagnostic(errors, path, `Expected ${rule.type}.`);
    return;
  }
  if (own(rule, 'const') && value !== rule.const) diagnostic(errors, path, `Must equal ${JSON.stringify(rule.const)}.`);
  if (rule.enum && !rule.enum.includes(value)) diagnostic(errors, path, `Choose one of ${rule.enum.map(v => JSON.stringify(v)).join(', ')}.`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) diagnostic(errors, path, 'Numbers must be finite.');
    if (own(rule, 'minimum') && value < rule.minimum) diagnostic(errors, path, `Must be at least ${rule.minimum}.`);
    if (own(rule, 'maximum') && value > rule.maximum) diagnostic(errors, path, `Must be at most ${rule.maximum}.`);
    if (own(rule, 'exclusiveMinimum') && value <= rule.exclusiveMinimum) diagnostic(errors, path, `Must be greater than ${rule.exclusiveMinimum}.`);
  }
  if (typeof value === 'string') {
    if (own(rule, 'minLength') && [...value].length < rule.minLength) diagnostic(errors, path, `Must contain at least ${rule.minLength} characters.`);
    if (own(rule, 'maxLength') && [...value].length > rule.maxLength) diagnostic(errors, path, `Must contain at most ${rule.maxLength} characters.`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) diagnostic(errors, path, `Must match ${rule.pattern}.`);
  }
  if (Array.isArray(value)) {
    if (own(rule, 'minItems') && value.length < rule.minItems) diagnostic(errors, path, `Requires at least ${rule.minItems} items.`);
    if (own(rule, 'maxItems') && value.length > rule.maxItems) diagnostic(errors, path, `Allows at most ${rule.maxItems} items.`);
    value.forEach((child, i) => {
      const itemRule = rule.prefixItems?.[i] || rule.items;
      if (itemRule) checkSchema(child, itemRule, `${path}[${i}]`, errors);
    });
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required || []) if (!own(value, key)) diagnostic(errors, `${path}.${key}`, 'This field is required.');
    for (const [key, child] of Object.entries(value)) {
      if (rule.properties?.[key]) checkSchema(child, rule.properties[key], `${path}.${key}`, errors);
      else if (rule.additionalProperties === false) diagnostic(errors, `${path}.${key}`, 'Unknown field. Check the spelling or remove it.');
    }
  }
  const passes = branch => {
    const branchErrors = [];
    checkSchema(value, branch, path, branchErrors);
    return branchErrors.length === 0;
  };
  if (rule.anyOf && !rule.anyOf.some(passes)) diagnostic(errors, path, 'Provide at least one nonempty maps, cars, or props collection.');
  if (rule.oneOf && rule.oneOf.filter(passes).length !== 1) diagnostic(errors, path, 'Use either points for a circuit, or city and cityRoute for a street race, exclusively.');
  if (rule.not && passes(rule.not)) diagnostic(errors, path, 'This combination of fields is not allowed.');
}

function normalizedMap(map) {
  const seed = map.seed ?? 17;
  const result = {
    ...clone(map), setting: map.setting ?? 'harbor', difficulty: map.difficulty ?? (map.city ? 'City' : 'Flowing'),
    seed, routeRevision: map.routeRevision ?? 1,
  };
  if (map.city) {
    result.city = {
      width: 7, warp: 0, parks: [], style: 'modern', residents: 72, traffic: 20, seed,
      ...clone(map.city),
    };
    const plan = createCityPlan(result.city);
    result.points = map.cityRoute.map(([i, j]) => {
      const node = plan.nodes[j * result.city.xs.length + i];
      return [node.x, .18, node.z];
    });
  }
  result.props = (map.props || []).map(placement => ({ ...clone(placement), yaw: placement.yaw ?? 0 }));
  return result;
}

function islandContains(x, z, city) {
  if (city) return Math.hypot(Math.max(0, Math.abs(x) - 58), Math.max(0, Math.abs(z) - 41)) <= 6;
  const nx = x / 64, nz = z / 47, angle = Math.atan2(nz, nx);
  return Math.hypot(nx, nz) <= 1 + .032 * Math.sin(3 * angle + .2) + .022 * Math.cos(5 * angle);
}
function fitsIsland(x, z, radius, city) {
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12;
    if (!islandContains(x + Math.cos(a) * radius, z + Math.sin(a) * radius, city)) return false;
  }
  return true;
}
function segmentDistanceSquared(a, b, point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / Math.max(.00001, dx * dx + dz * dz)));
  return (point.x - a.x - t * dx) ** 2 + (point.z - a.z - t * dz) ** 2;
}
function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return Math.min(segmentDistanceSquared(a, b, c), segmentDistanceSquared(a, b, d), segmentDistanceSquared(c, d, a), segmentDistanceSquared(c, d, b)) < 1e-8;
}

function validateCity(map, path, errors) {
  const countBefore = errors.length;
  const city = map.city;
  for (const axis of ['xs', 'zs']) for (let i = 1; i < city[axis].length; i++) {
    if (city[axis][i] - city[axis][i - 1] < 12) diagnostic(errors, `${path}.city.${axis}[${i}]`, 'Street coordinates must increase with at least 12 meters between neighboring streets.');
  }
  const validCell = ([i, j], block = false) => i < city.xs.length - Number(block) && j < city.zs.length - Number(block);
  const parks = new Set();
  for (const [i, cell] of (city.parks || []).entries()) {
    if (!validCell(cell, true)) diagnostic(errors, `${path}.city.parks[${i}]`, 'Park indices must identify an existing block, not a street node.');
    const key = cell.join(',');
    if (parks.has(key)) diagnostic(errors, `${path}.city.parks[${i}]`, 'This park is already listed.');
    parks.add(key);
  }
  const route = map.cityRoute;
  for (const [i, cell] of route.entries()) if (!validCell(cell)) diagnostic(errors, `${path}.cityRoute[${i}]`, 'Route indices must identify an existing street intersection.');
  if (errors.length !== countBefore) return;
  const visited = new Set();
  for (let i = 0; i < route.length; i++) {
    const [x, z] = route[i], [nx, nz] = route[(i + 1) % route.length], [px, pz] = route[mod(i - 1, route.length)];
    if (x === nx && z === nz) diagnostic(errors, `${path}.cityRoute[${i}]`, 'Consecutive intersections must be different. Do not repeat the first point at the end.');
    else if (x !== nx && z !== nz) diagnostic(errors, `${path}.cityRoute[${i}]`, 'Connect intersections on the same row or column so the race follows a real street.');
    if ((x - px) * (nx - x) + (z - pz) * (nz - z) < 0 && ((x === px && x === nx) || (z === pz && z === nz))) diagnostic(errors, `${path}.cityRoute[${i}]`, 'The route reverses along the same street. Replace this U-turn with a block turn.');
    if (x === nx || z === nz) {
      const steps = Math.abs(nx - x) + Math.abs(nz - z);
      for (let n = 0; n < steps; n++) {
        const key = `${x + Math.sign(nx - x) * n},${z + Math.sign(nz - z) * n}`;
        if (visited.has(key)) diagnostic(errors, `${path}.cityRoute[${i}]`, 'The closed race route reuses or crosses an intersection. Use a simple loop without crossings.');
        visited.add(key);
      }
    }
  }
  if (errors.length !== countBefore) return;
  const normalized = normalizedMap(map), plan = createCityPlan(normalized.city);
  for (const edge of [...plan.edges.map(e => ({ a: plan.nodes[e.a], b: plan.nodes[e.b] })), ...plan.spurs]) {
    for (let n = 0; n <= 16; n++) {
      const x = edge.a.x + (edge.b.x - edge.a.x) * n / 16, z = edge.a.z + (edge.b.z - edge.a.z) * n / 16;
      if (!fitsIsland(x, z, 4.8, true)) {
        diagnostic(errors, `${path}.city`, 'A street or sidewalk leaves the 64 by 47 meter city island. Move the outer streets inward.');
        return;
      }
    }
  }
}

function validateMapGeometry(map, path, errors, warnings) {
  const countBefore = errors.length;
  if (map.city) validateCity(map, path, errors);
  if (errors.length !== countBefore) return;
  const compiled = normalizedMap(map), points = compiled.points.map(([x, y, z]) => ({ x, y, z }));
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], distance = Math.hypot(a.x - b.x, a.z - b.z);
    if (distance < 6) diagnostic(errors, `${path}.${map.city ? 'cityRoute' : 'points'}[${i}]`, 'Neighboring circuit points need at least 6 meters of separation. Do not repeat the closing point.');
    if (Math.abs(a.y - b.y) > distance * .22) diagnostic(errors, `${path}.points[${i}]`, 'This elevation change exceeds the safe road gradient. Use a longer approach or lower the height.');
  }
  if (errors.length !== countBefore) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (segmentsCross(a, b, points[j], points[(j + 1) % points.length])) {
        diagnostic(errors, `${path}.${map.city ? 'cityRoute' : 'points'}[${j}]`, 'Nonadjacent road segments cross or touch. Routes must be simple closed loops.');
        return;
      }
    }
  }
  if (errors.length !== countBefore) return;
  let track;
  try { track = buildTrack(compiled); }
  catch (error) {
    diagnostic(errors, path, `The track could not be built: ${error.message}`);
    return;
  }
  if (!Number.isFinite(track.length) || track.length < 100 || track.length > 2000) {
    diagnostic(errors, path, 'The closed track must measure between 100 and 2000 meters to safely fit ten racers.');
    return;
  }
  const samples = track.samples.filter((_, i) => i % 6 === 0);
  const plan = compiled.city ? createCityPlan(compiled.city) : null;
  for (const [i, point] of samples.entries()) {
    if (!Object.values(point).every(Number.isFinite) || Math.hypot(point.tx, point.tz) < .1) {
      diagnostic(errors, path, `Track sample ${i * 6} has an invalid tangent or curvature. Remove duplicate or folding points.`);
      return;
    }
    if (!fitsIsland(point.x, point.z, 4.4, !!compiled.city)) {
      diagnostic(errors, path, `Road sample ${i * 6} leaves the island or lacks a 4.4 meter shoulder margin. Move the outline inward.`);
      return;
    }
    // A circuit ribbon must not fold its inner shoulder onto itself. City
    // intersections use a street network rather than the circuit ribbon.
    if (Math.abs(point.curvature) > (compiled.city ? .5 : .22) || Math.abs(point.ty) > .3) {
      diagnostic(errors, path, `Road sample ${i * 6} bends or climbs too sharply for the vehicle physics. Use a smoother outline.`);
      return;
    }
    if (plan && plan.distanceToRoad(point.x, point.z) > plan.width * .5 - .3) {
      diagnostic(errors, `${path}.cityRoute`, `Rounded turn ${i * 6} leaves the city street footprint. Use a wider block turn.`);
      return;
    }
    for (let j = i + 1; j < samples.length; j++) {
      const arc = Math.min(j - i, samples.length - (j - i)) * track.length / samples.length;
      if (arc <= 12) continue;
      if (Math.hypot(point.x - samples[j].x, point.z - samples[j].z) < 8.4) {
        diagnostic(errors, path, `Nonadjacent road samples ${i * 6} and ${j * 6} are less than 8.4 meters apart. Separate the lanes to prevent overlapping roads and shoulders.`);
        return;
      }
    }
  }
  if (track.length < 160) diagnostic(warnings, path, 'This is a short ten-car circuit. Keep speeds conservative and test starting-grid congestion.');
}

function partExtents(part) {
  const rotation = new THREE.Euler(...(part.rotation || [0, 0, 0]));
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(axis => axis.applyEuler(rotation));
  const center = new THREE.Vector3(...part.position);
  if (part.shape === 'sphere') {
    // Largest eigenvalue of the horizontal ellipsoid projection. Adding the
    // center radius is a conservative enclosure when an ellipsoid is offset.
    const a = axes.reduce((sum, axis, i) => sum + (axis.x * part.size[i]) ** 2, 0);
    const b = axes.reduce((sum, axis, i) => sum + axis.x * axis.z * part.size[i] ** 2, 0);
    const d = axes.reduce((sum, axis, i) => sum + (axis.z * part.size[i]) ** 2, 0);
    const radius = Math.sqrt((a + d + Math.hypot(a - d, 2 * b)) / 2) + Math.hypot(center.x, center.z);
    const height = Math.sqrt(axes.reduce((sum, axis, i) => sum + (axis.y * part.size[i]) ** 2, 0));
    return { radius, minY: center.y - height, maxY: center.y + height };
  }
  if (part.shape === 'cylinder') {
    const radius = Math.max(part.size[0], part.size[2]), halfHeight = part.size[1] / 2;
    const radial = radius + halfHeight * Math.hypot(axes[1].x, axes[1].z) + Math.hypot(center.x, center.z);
    const height = radius * Math.hypot(axes[0].y, axes[2].y) + halfHeight * Math.abs(axes[1].y);
    return { radius: radial, minY: center.y - height, maxY: center.y + height };
  }
  const half = part.size.map(n => n / 2);
  const points = [];
  for (const x of [-half[0], half[0]]) for (const y of [-half[1], half[1]]) for (const z of [-half[2], half[2]]) {
    points.push(new THREE.Vector3(x, y, z).applyEuler(rotation).add(center));
  }
  return { radius: Math.max(...points.map(point => Math.hypot(point.x, point.z))), minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)) };
}
function validateProp(prop, path, errors) {
  for (const [i, part] of prop.parts.entries()) {
    const extents = partExtents(part);
    if (extents.radius > prop.collider.radius + 1e-6) {
      diagnostic(errors, `${path}.parts[${i}]`, 'The collider radius must enclose the entire rotated visual footprint. Increase its radius or shrink/recenter the part.');
    }
    if (extents.minY < -1e-6 || extents.maxY > prop.collider.height + 1e-6) {
      diagnostic(errors, `${path}.parts[${i}]`, 'Every rotated part must stay between ground height 0 and the collider height. Adjust position, size, or collider height.');
    }
  }
}

function uniqueIds(items, path, errors) {
  const ids = new Set();
  for (const [i, item] of items.entries()) {
    if (ids.has(item.id)) diagnostic(errors, `${path}[${i}].id`, `Duplicate local ID ${JSON.stringify(item.id)}.`);
    ids.add(item.id);
  }
}
function validateLocalReferences(pack, errors, warnings) {
  const cars = new Set((pack.cars || []).map(car => `${pack.id}/${car.id}`));
  const props = new Map((pack.props || []).map(prop => [`${pack.id}/${prop.id}`, prop]));
  for (const [i, map] of (pack.maps || []).entries()) {
    for (const [j, ref] of (map.cars || []).entries()) {
      if ((ref.startsWith(`${pack.id}/`) && !cars.has(ref)) || (ref.startsWith('builtin/') && !builtinCars.has(ref))) diagnostic(errors, `$.maps[${i}].cars[${j}]`, `Unknown car reference ${JSON.stringify(ref)}.`);
      else if (!cars.has(ref) && !builtinCars.has(ref)) diagnostic(warnings, `$.maps[${i}].cars[${j}]`, `Another installed pack must provide car ${JSON.stringify(ref)}.`);
    }
    const placementIds = new Set();
    for (const [j, placement] of (map.props || []).entries()) {
      if (placement.id && placementIds.has(placement.id)) diagnostic(errors, `$.maps[${i}].props[${j}].id`, 'Placement IDs must be unique within a map.');
      if (placement.id) placementIds.add(placement.id);
      if ((placement.prop.startsWith(`${pack.id}/`) && !props.has(placement.prop)) || placement.prop.startsWith('builtin/')) diagnostic(errors, `$.maps[${i}].props[${j}].prop`, `Unknown prop reference ${JSON.stringify(placement.prop)}. Props must be defined in a content pack.`);
      else if (!props.has(placement.prop)) diagnostic(warnings, `$.maps[${i}].props[${j}].prop`, `Another installed pack must provide prop ${JSON.stringify(placement.prop)}.`);
    }
    validatePlacements(map, props, `$.maps[${i}]`, errors);
  }
}

function validatePlacements(map, definitions, path, errors) {
  if (!(map.props || []).length) return;
  let compiled;
  try { compiled = normalizedMap(map); }
  catch { return; }
  const track = buildTrack(compiled), plan = compiled.city ? createCityPlan(compiled.city) : null;
  const samples = track.samples.filter((_, i) => i % 3 === 0), placements = map.props || [];
  for (const [i, placement] of placements.entries()) {
    const definition = definitions.get(placement.prop);
    if (!definition) continue;
    const radius = definition.collider.radius, point = { x: placement.x, z: placement.z };
    if (!fitsIsland(point.x, point.z, radius + .5, !!compiled.city)) diagnostic(errors, `${path}.props[${i}]`, 'The prop collider must fit on the island with at least half a meter of edge clearance.');
    const roadDistance = plan ? plan.distanceToRoad(point.x, point.z) : Math.sqrt(Math.min(...samples.map((a, j) => segmentDistanceSquared(a, samples[(j + 1) % samples.length], point))));
    if (roadDistance < radius + (plan ? 4.6 : 4.4) + .3) diagnostic(errors, `${path}.props[${i}]`, 'This collider overlaps a street, sidewalk, or race shoulder. Move it farther from the road.');
    for (let j = 0; j < i; j++) {
      const other = placements[j], otherDefinition = definitions.get(other.prop);
      if (otherDefinition && Math.hypot(point.x - other.x, point.z - other.z) < radius + otherDefinition.collider.radius + .1) diagnostic(errors, `${path}.props[${i}]`, `This prop overlaps the physical footprint of placement ${j}. Leave at least 0.1 meters between colliders.`);
    }
  }
}

/** Validate one pack without executing content or mutating its input. */
export function validateContentPack(pack) {
  const errors = [], warnings = [];
  if (!plainJSON(pack, errors)) return { valid: false, errors, warnings };
  checkSchema(pack, schema, '$', errors);
  if (errors.length) return { valid: false, errors, warnings };
  if (pack.id === 'builtin') diagnostic(errors, '$.id', 'The builtin namespace is reserved. Choose a different pack ID.');
  uniqueIds(pack.maps || [], '$.maps', errors);
  uniqueIds(pack.cars || [], '$.cars', errors);
  uniqueIds(pack.props || [], '$.props', errors);
  for (const [i, prop] of (pack.props || []).entries()) validateProp(prop, `$.props[${i}]`, errors);
  for (const [i, map] of (pack.maps || []).entries()) validateMapGeometry(map, `$.maps[${i}]`, errors, warnings);
  if (!errors.length) validateLocalReferences(pack, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export class ContentValidationError extends Error {
  constructor(errors) {
    super(`TinyLaps content is invalid:\n${errors.map(error => `${error.path}: ${error.message}`).join('\n')}`);
    this.name = 'ContentValidationError';
    this.errors = errors;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function revision(value) {
  let hash = 2166136261;
  for (const character of canonical(value)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return `v1-${hash.toString(16).padStart(8, '0')}`;
}
function resolvedCar(car, packId, fallback) {
  const result = {
    ...clone(car), contentId: `${packId}/${car.id}`, contentPack: packId,
    model: { scale: [1, 1, 1], stripeColor: '#fff4d6', accentColor: '#c5d0cc', ...clone(car.model) },
    personality: clone(car.personality || fallback.personality),
  };
  delete result.id;
  return result;
}

/**
 * Validate all packs atomically, then resolve stable pack/local identities.
 * Builtin map keys and objects are preserved. Authored rosters repeat to ten
 * cars, keeping city traffic IDs and saved racer slots compatible.
 */
export function createContentCatalog(baseTracks, baseCarProfiles, packs = []) {
  if (!baseTracks || typeof baseTracks !== 'object' || Array.isArray(baseTracks)) throw new TypeError('Builtin tracks must be an object.');
  if (!Array.isArray(baseCarProfiles) || baseCarProfiles.length !== 10) throw new TypeError('TinyLaps requires ten builtin car profiles.');
  if (!Array.isArray(packs)) throw new ContentValidationError([{ path: '$', message: 'The generated catalog must be an array of packs.' }]);
  const errors = [], usedPackIds = new Set();
  for (const [i, pack] of packs.entries()) {
    const result = validateContentPack(pack);
    errors.push(...result.errors.map(error => ({ path: `$[${i}]${error.path.slice(1)}`, message: error.message })));
    if (result.valid && usedPackIds.has(pack.id)) diagnostic(errors, `$[${i}].id`, `Pack ID ${JSON.stringify(pack.id)} is already installed.`);
    if (result.valid) usedPackIds.add(pack.id);
  }
  if (errors.length) throw new ContentValidationError(errors);
  const maps = { ...baseTracks }, cars = Object.create(null), props = Object.create(null), metadata = [];
  for (const profile of baseCarProfiles) cars[builtinCarId(profile)] = { ...profile, contentId: builtinCarId(profile), contentPack: 'builtin' };
  for (const pack of packs) {
    (pack.cars || []).forEach((car, i) => { cars[`${pack.id}/${car.id}`] = resolvedCar(car, pack.id, baseCarProfiles[i % baseCarProfiles.length]); });
    for (const prop of pack.props || []) props[`${pack.id}/${prop.id}`] = {
      ...clone(prop), kind: prop.kind || 'custom', contentId: `${pack.id}/${prop.id}`, contentPack: pack.id,
      parts: prop.parts.map(part => ({ ...clone(part), rotation: clone(part.rotation || [0, 0, 0]) })),
    };
  }
  for (const [packIndex, pack] of packs.entries()) {
    for (const [mapIndex, map] of (pack.maps || []).entries()) {
      const path = `$[${packIndex}].maps[${mapIndex}]`;
      for (const [i, ref] of (map.cars || []).entries()) if (!own(cars, ref)) diagnostic(errors, `${path}.cars[${i}]`, `No installed pack provides car ${JSON.stringify(ref)}.`);
      for (const [i, placement] of (map.props || []).entries()) if (!own(props, placement.prop)) diagnostic(errors, `${path}.props[${i}].prop`, `No installed pack provides prop ${JSON.stringify(placement.prop)}.`);
      validatePlacements(map, new Map(Object.entries(props)), path, errors);
    }
  }
  if (errors.length) throw new ContentValidationError(errors);
  for (const pack of packs) {
    for (const map of pack.maps || []) {
      const normalized = normalizedMap(map), setting = normalized.setting, sourcePalette = baseTracks[setting];
      if (!sourcePalette) throw new ContentValidationError([{ path: '$.setting', message: `Builtin palette ${setting} is unavailable.` }]);
      const id = `${pack.id}/${map.id}`;
      const compiled = {
        grass: sourcePalette.grass, sand: sourcePalette.sand, water: sourcePalette.water, sky: sourcePalette.sky, sun: sourcePalette.sun,
        ...normalized, contentId: id, contentPack: pack.id, river: false,
        sub: `${map.name.toUpperCase()} ${map.city ? 'STREET RACE' : 'CIRCUIT'}`,
        props: normalized.props.map(placement => ({ ...placement, definition: props[placement.prop] })),
      };
      for (const [key, color] of Object.entries(map.palette || {})) compiled[key] = parseInt(color.slice(1), 16);
      if (map.cars) compiled.cars = Array.from({ length: 10 }, (_, i) => cars[map.cars[i % map.cars.length]]);
      delete compiled.id;
      compiled.contentRevision = revision({ map: normalized, palette: { grass: compiled.grass, sand: compiled.sand, water: compiled.water, sky: compiled.sky, sun: compiled.sun }, cars: compiled.cars || baseCarProfiles, props: compiled.props });
      maps[id] = compiled;
    }
    metadata.push({
      id: pack.id, name: pack.name, description: pack.description || '',
      mapIds: (pack.maps || []).map(map => `${pack.id}/${map.id}`),
      carIds: (pack.cars || []).map(car => `${pack.id}/${car.id}`),
      propIds: (pack.props || []).map(prop => `${pack.id}/${prop.id}`),
    });
  }
  return { maps, cars, props, packs: metadata };
}
