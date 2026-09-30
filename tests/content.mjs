import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContentCatalog, validateContentPack, ContentValidationError, contentPackSchema } from '../content/index.js';
import { TRACKS } from '../tracks.js';
import { CAR_PROFILES } from '../race.js';

const starter = JSON.parse(fs.readFileSync(new URL('../content/packs/starter-kit.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
let passed = 0;
function test(name, check) {
  check();
  passed++;
  console.log(`PASS content: ${name}`);
}
function altered(change) {
  const pack = copy(starter);
  change(pack);
  return pack;
}
function rejected(pack, path, message) {
  const result = validateContentPack(pack);
  assert.equal(result.valid, false, 'The invalid pack must be rejected');
  assert.ok(result.errors.some(error => error.path.includes(path) && message.test(error.message)), JSON.stringify(result.errors));
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, [pack]), ContentValidationError);
  return result;
}
function carPack(id = 'extra-cars') {
  return { schemaVersion: 1, id, name: 'Extra racers', cars: [{ ...copy(starter.cars[0]), id: 'copper' }] };
}
function propPack(id = 'extra-props') {
  return { schemaVersion: 1, id, name: 'Extra scenery', props: [{ ...copy(starter.props[1]), id: 'marker' }] };
}
function circuitPack() {
  const map = copy(starter.maps[0]);
  delete map.cars;
  delete map.props;
  return { schemaVersion: 1, id: 'circuit', name: 'Independent circuit', maps: [{ ...map, id: 'loop' }] };
}

test('starter is valid and is not mutated during compilation', () => {
  const before = JSON.stringify(starter), builtinBefore = JSON.stringify(TRACKS), profilesBefore = JSON.stringify(CAR_PROFILES);
  assert.deepEqual(validateContentPack(starter), { valid: true, errors: [], warnings: [] });
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [starter]);
  assert.equal(JSON.stringify(starter), before);
  assert.equal(JSON.stringify(TRACKS), builtinBefore);
  assert.equal(JSON.stringify(CAR_PROFILES), profilesBefore);
  assert.equal(Object.keys(catalog.maps).length, Object.keys(TRACKS).length + 2);
  for (const [id, map] of Object.entries(TRACKS)) assert.equal(catalog.maps[id], map, 'Legacy map object and key are preserved');
  assert.equal(catalog.packs[0].id, 'starter-kit');
  assert.deepEqual(catalog.packs[0].mapIds, ['starter-kit/workshop-orchard', 'starter-kit/workshop-quarter']);
});
test('schema file matches exported validation schema', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/content-pack.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(contentPackSchema, schema);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.ok(Object.isFrozen(contentPackSchema.$defs.car.properties));
  assert.throws(() => { contentPackSchema.properties.schemaVersion.const = 2; }, TypeError);
});
test('empty catalog retains all builtins and original car values', () => {
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES);
  assert.deepEqual(catalog.maps, TRACKS);
  assert.equal(Object.keys(catalog.cars).length, 10);
  assert.equal(Object.keys(catalog.props).length, 0);
  assert.deepEqual(catalog.packs, []);
  for (const profile of CAR_PROFILES) {
    const actual = catalog.cars[`builtin/${profile.name.toLowerCase()}`];
    for (const [field, value] of Object.entries(profile)) assert.deepEqual(actual[field], value);
  }
});
test('car roster cycles to exactly ten stable racer slots', () => {
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [starter]);
  for (const map of Object.values(catalog.maps).filter(map => map.contentPack)) {
    assert.equal(map.cars.length, 10);
    for (let i = 0; i < 5; i++) assert.equal(map.cars[i], map.cars[i + 5]);
  }
  const car = catalog.cars['starter-kit/copper-coupe'];
  assert.equal(car.contentId, 'starter-kit/copper-coupe');
  assert.equal(car.model.body, 'coupe');
  assert.equal(car.mass, 740);
  assert.equal(car.personality.awareness, .96);
});
test('maps without roster preserve the original racers by omitting overrides', () => {
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [circuitPack()]);
  assert.equal(catalog.maps['circuit/loop'].cars, undefined);
});
test('car-only packs register usable standalone car definitions', () => {
  const pack = carPack();
  delete pack.cars[0].personality;
  delete pack.cars[0].model.scale;
  assert.equal(validateContentPack(pack).valid, true);
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [pack]);
  assert.deepEqual(catalog.maps, TRACKS);
  assert.equal(catalog.cars['extra-cars/copper'].model.body, 'coupe');
  assert.deepEqual(catalog.cars['extra-cars/copper'].model.scale, [1, 1, 1]);
  assert.deepEqual(catalog.cars['extra-cars/copper'].personality, CAR_PROFILES[0].personality);
});
test('prop-only packs register collision-backed standalone scenery definitions', () => {
  const pack = propPack();
  delete pack.props[0].kind;
  const catalog = createContentCatalog(TRACKS, CAR_PROFILES, [pack]);
  assert.deepEqual(catalog.maps, TRACKS);
  assert.equal(catalog.props['extra-props/marker'].kind, 'custom');
  assert.deepEqual(catalog.props['extra-props/marker'].parts[0].rotation, [0, 0, 0]);
});
test('default map and city values are normalized without falsy-value replacement', () => {
  const pack = altered(pack => {
    const map = pack.maps[1];
    delete map.setting;
    delete map.difficulty;
    delete map.routeRevision;
    map.seed = 0;
    map.city = { xs: map.city.xs, zs: map.city.zs, residents: 0, traffic: 0 };
  });
  const map = createContentCatalog(TRACKS, CAR_PROFILES, [pack]).maps['starter-kit/workshop-quarter'];
  assert.equal(map.setting, 'harbor');
  assert.equal(map.difficulty, 'City');
  assert.equal(map.seed, 0);
  assert.equal(map.city.seed, 0);
  assert.equal(map.city.traffic, 0);
  assert.equal(map.city.residents, 0);
  assert.equal(map.city.width, 7);
  assert.deepEqual(map.city.parks, []);
});
test('palette overrides compile hex colors while retaining unspecified setting colors', () => {
  const pack = altered(pack => { pack.maps[0].palette = { grass: '#112233', water: '#ABCDEF' }; });
  const map = createContentCatalog(TRACKS, CAR_PROFILES, [pack]).maps['starter-kit/workshop-orchard'];
  assert.equal(map.grass, 0x112233);
  assert.equal(map.water, 0xabcdef);
  assert.equal(map.sky, TRACKS.alpine.sky);
  rejected(altered(pack => { pack.maps[0].palette = { gras: '#112233' }; }), '.palette.gras', /Unknown field/);
});
test('cross-pack references resolve regardless of installation order', () => {
  const pack = circuitPack();
  pack.maps[0].cars = ['extra-cars/copper', 'builtin/cherry'];
  pack.maps[0].props = [{ id: 'marker', prop: 'extra-props/marker', x: 0, z: 0 }];
  const result = validateContentPack(pack);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 2, 'Standalone validation explains dependency requirements');
  const forward = createContentCatalog(TRACKS, CAR_PROFILES, [pack, carPack(), propPack()]);
  const reversed = createContentCatalog(TRACKS, CAR_PROFILES, [propPack(), carPack(), pack]);
  const map = forward.maps['circuit/loop'];
  assert.equal(map.cars[0].contentId, 'extra-cars/copper');
  assert.equal(map.props[0].definition.contentId, 'extra-props/marker');
  assert.equal(map.props[0].id, 'marker');
  assert.equal(map.contentRevision, reversed.maps['circuit/loop'].contentRevision);
});
test('missing cross-pack dependencies reject the entire catalog with paths', () => {
  const pack = circuitPack();
  pack.maps[0].cars = ['missing/car'];
  pack.maps[0].props = [{ prop: 'missing/prop', x: 0, z: 0 }];
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, [carPack(), pack]), error => {
    assert.equal(error.name, 'ContentValidationError');
    assert.ok(error.errors.some(error => error.path === '$[1].maps[0].cars[0]' && /No installed pack/.test(error.message)));
    assert.ok(error.errors.some(error => error.path === '$[1].maps[0].props[0].prop'));
    return true;
  });
});
test('malformed, unsupported, empty and reserved packs are rejected', () => {
  for (const value of [null, [], 'content', 12, { schemaVersion: 1, id: 'empty', name: 'Empty' }]) assert.equal(validateContentPack(value).valid, false);
  rejected(altered(pack => { pack.schemaVersion = 2; }), '.schemaVersion', /Must equal 1/);
  rejected(altered(pack => { pack.id = 'Bad_Pack'; }), '.id', /Must match/);
  rejected(altered(pack => { pack.id = 'builtin'; }), '.id', /reserved/);
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, {}), ContentValidationError);
  assert.throws(() => createContentCatalog(TRACKS, [], []), /ten builtin/);
});
test('unknown fields and resource URLs are refused at every authored level', () => {
  const mutations = [
    [pack => { pack.script = 'alert(1)'; }, '.script'],
    [pack => { pack.maps[0].pointz = []; }, '.pointz'],
    [pack => { pack.cars[0].texture = 'https://example.com/car.png'; }, '.texture'],
    [pack => { pack.cars[0].model.meshUrl = 'car.glb'; }, '.meshUrl'],
    [pack => { pack.props[0].parts[0].code = 'function(){}'; }, '.code'],
    [pack => { pack.maps[1].city.resident = 2; }, '.resident'],
    [pack => { pack.maps[0].props[0].y = 1; }, '.y'],
  ];
  for (const [change, path] of mutations) rejected(altered(change), path, /Unknown field/);
});
test('non-finite and out-of-range numeric inputs are refused', () => {
  for (const value of [Infinity, -Infinity, NaN]) rejected(altered(pack => { pack.cars[0].topSpeed = value; }), '.topSpeed', /finite/);
  for (const [field, value] of [['topSpeed', 33], ['cornering', 4], ['acceleration', 11], ['mass', 1201]]) rejected(altered(pack => { pack.cars[0][field] = value; }), `.${field}`, /at (least|most)/);
  rejected(altered(pack => { pack.maps[0].seed = -1; }), '.seed', /at least/);
  rejected(altered(pack => { pack.maps[0].points[0][0] = 57; }), '.points[0][0]', /at most/);
  rejected(altered(pack => { pack.cars[0].model.scale = [1.2, 1, 1]; }), '.scale[0]', /at most/);
  rejected(altered(pack => { pack.cars[0].personality.awareness = 2; }), '.awareness', /at most/);
});
test('plain JSON validation rejects code, cycles, sparse arrays and reserved keys', () => {
  rejected(altered(pack => { pack.maps[0].seed = () => 0; }), '.seed', /executable/);
  const cycle = copy(starter);
  cycle.loop = cycle;
  assert.equal(validateContentPack(cycle).valid, false);
  const sparse = copy(starter);
  delete sparse.maps[0].points[2];
  assert.ok(validateContentPack(sparse).errors.some(error => /Sparse/.test(error.message)));
  const reserved = JSON.parse(JSON.stringify(starter).replace('"schemaVersion":1', '"__proto__":{},"schemaVersion":1'));
  assert.ok(validateContentPack(reserved).errors.some(error => /Reserved/.test(error.message)));
  const withDate = copy(starter);
  withDate.maps[0].seed = new Date();
  assert.ok(validateContentPack(withDate).errors.some(error => /plain JSON objects/.test(error.message)));
});
test('validation does not run object accessors and rejects hidden/symbol/array fields', () => {
  let calls = 0;
  const pack = copy(starter);
  Object.defineProperty(pack, 'script', { enumerable: true, get() { calls++; throw new Error('Executed getter'); } });
  assert.ok(validateContentPack(pack).errors.some(error => /Accessors/.test(error.message)));
  assert.equal(calls, 0);
  const hidden = copy(starter);
  Object.defineProperty(hidden, 'secret', { value: 3 });
  assert.equal(validateContentPack(hidden).valid, false);
  const symbols = copy(starter);
  symbols[Symbol('script')] = () => {};
  assert.equal(validateContentPack(symbols).valid, false);
  const arrayField = copy(starter);
  arrayField.maps.extra = 'ignored otherwise';
  assert.equal(validateContentPack(arrayField).valid, false);
});
test('duplicate pack/local/placement identities and unknown builtin references are refused', () => {
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, [starter, starter]), /already installed/);
  for (const section of ['maps', 'cars', 'props']) rejected(altered(pack => { pack[section].push(copy(pack[section][0])); }), `.${section}`, /Duplicate local ID/);
  rejected(altered(pack => { pack.maps[0].props[1].id = pack.maps[0].props[0].id; }), '.props[1].id', /unique/);
  rejected(altered(pack => { pack.maps[0].cars[0] = 'builtin/missing'; }), '.cars[0]', /Unknown car/);
  rejected(altered(pack => { pack.maps[0].cars[0] = 'starter-kit/missing'; }), '.cars[0]', /Unknown car/);
  rejected(altered(pack => { pack.maps[0].props[0].prop = 'builtin/tree'; }), '.props[0].prop', /Unknown prop/);
  rejected(altered(pack => { pack.maps[0].props[0].prop = 'starter-kit/missing'; }), '.props[0].prop', /Unknown prop/);
});
test('circuits and city routes use exclusive representation with no repeat closing point', () => {
  rejected(altered(pack => { pack.maps[0].city = copy(pack.maps[1].city); pack.maps[0].cityRoute = copy(pack.maps[1].cityRoute); }), '.maps[0]', /either points/);
  rejected(altered(pack => { delete pack.maps[0].points; }), '.maps[0]', /either points/);
  rejected(altered(pack => { pack.maps[0].points.push(copy(pack.maps[0].points[0])); }), '.points', /separation|closing point/);
});
test('self-crossing, shoulder escape, short loops and steep gradients are refused', () => {
  rejected(altered(pack => { [pack.maps[0].points[2], pack.maps[0].points[7]] = [pack.maps[0].points[7], pack.maps[0].points[2]]; }), '.points', /cross or touch/);
  rejected(altered(pack => { pack.maps[0].points[1] = [0, .17, 38]; pack.maps[0].points[2] = [48, .17, 33]; }), '.maps[0]', /island|shoulder/);
  rejected(altered(pack => { pack.maps[0].points = Array.from({ length: 8 }, (_, i) => [10 * Math.cos(i * Math.PI / 4), .17, 10 * Math.sin(i * Math.PI / 4)]); }), '.maps[0]', /100 and 2000/);
  rejected(altered(pack => { pack.maps[0].points = [[-35,.17,20],[-28,4,20],[0,.17,28],[35,.17,20],[35,.17,-20],[0,.17,-28],[-35,.17,-20]]; }), '.points', /gradient/);
});
test('smoothly sampled bends and neighboring shoulders cannot fold or overlap', () => {
  const sharp = circuitPack();
  sharp.maps[0].points = [[-45,23],[-20,31],[7,29],[38,22],[48,0],[32,-25],[9,-31],[-2,-19],[16,-6],[4,6],[-21,-2],[-41,-22],[-49,-2]].map(([x,z]) => [x,.17,z]);
  rejected(sharp, '.maps[0]', /bends or climbs too sharply/);
  const narrow = circuitPack();
  narrow.maps[0].points = [[-38,4],[-19,4],[19,4],[38,4],[45,0],[38,-4],[19,-4],[-19,-4],[-38,-4],[-45,0]].map(([x,z]) => [x,.17,z]);
  rejected(narrow, '.maps[0]', /8.4 meters apart/);
});
test('city grids validate dimensions, ordering, capacity, parks and route indices', () => {
  rejected(altered(pack => { pack.maps[1].city.xs = [-30, 0, 30]; }), '.city.xs', /at least 4/);
  rejected(altered(pack => { pack.maps[1].city.zs = [-14, 14]; }), '.city.zs', /at least 3/);
  rejected(altered(pack => { pack.maps[1].city.xs[2] = -22; }), '.city.xs[2]', /at least 12/);
  rejected(altered(pack => { pack.maps[1].city.width = 9; }), '.city.width', /Must equal 7/);
  rejected(altered(pack => { pack.maps[1].city.traffic = 41; }), '.city.traffic', /at most 40/);
  rejected(altered(pack => { pack.maps[1].city.residents = 151; }), '.city.residents', /at most 150/);
  rejected(altered(pack => { pack.maps[1].city.parks = [[5,4]]; }), '.city.parks', /existing block/);
  rejected(altered(pack => { pack.maps[1].city.parks = [[1,1],[1,1]]; }), '.city.parks[1]', /already listed/);
  rejected(altered(pack => { pack.maps[1].cityRoute[2] = [9,0]; }), '.cityRoute[2]', /existing street intersection/);
});
test('city races reject diagonal shortcuts, U-turns and reused intersections', () => {
  rejected(altered(pack => { pack.maps[1].cityRoute[1] = [4,2]; }), '.cityRoute', /same row or column/);
  rejected(altered(pack => { pack.maps[1].cityRoute.splice(2, 0, [2,1]); }), '.cityRoute', /U-turn|reuses or crosses/);
  rejected(altered(pack => { pack.maps[1].cityRoute.push([0,1]); }), '.cityRoute', /different|reuses or crosses/);
});
test('invalid props do not suppress independent invalid city route diagnostics', () => {
  const result = validateContentPack(altered(pack => {
    pack.props[0].collider.radius = .5;
    pack.maps[1].cityRoute[1] = [4,2];
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.includes('$.props[0]')));
  assert.ok(result.errors.some(error => error.path.includes('$.maps[1].cityRoute') && /same row or column/.test(error.message)));
});
test('prop visual extents including rotation must fit their physical collider', () => {
  rejected(altered(pack => { pack.props[0].collider.radius = .5; }), '.parts', /radius must enclose/);
  rejected(altered(pack => { pack.props[0].parts[1].position[1] = .1; }), '.parts[1]', /ground height/);
  rejected(altered(pack => { pack.props[0].collider.height = 2; }), '.parts', /collider height/);
  rejected(altered(pack => { pack.props[0].parts[1].rotation = [Math.PI / 4, 0, 0]; }), '.parts[1]', /ground height|collider height|radius/);
  rejected(altered(pack => { pack.props[1].parts[0].size[0] = 2; }), '.parts[0]', /radius must enclose/);
  rejected(altered(pack => { pack.props[1].parts[1].size[1] = 2; }), '.parts[1]', /ground height|collider height/);
});
test('exact upright sphere and cylinder radii are accepted rather than box-corner estimates', () => {
  const pack = propPack();
  pack.props[0].collider = { radius: 1, height: 2, mass: 100 };
  pack.props[0].parts = [{ shape: 'sphere', size: [1,1,1], position: [0,1,0], color: '#112233' }];
  assert.equal(validateContentPack(pack).valid, true);
  pack.props[0].parts = [{ shape: 'cylinder', size: [1,2,1], position: [0,1,0], color: '#112233' }];
  assert.equal(validateContentPack(pack).valid, true);
});
test('a schema-maximum primitive library fits the JSON validation budget', () => {
  const primitive = { shape: 'box', size: [.1,.1,.1], position: [0,.05,0], rotation: [0,0,0], color: '#112233' };
  const pack = { schemaVersion: 1, id: 'primitive-library', name: 'Primitive library', props: Array.from({ length: 64 }, (_, i) => ({
    id: `prop-${i}`, name: `Prop ${i}`, collider: { radius: 1, height: 1, mass: 100 }, parts: Array.from({ length: 32 }, () => copy(primitive)),
  })) };
  assert.deepEqual(validateContentPack(pack), { valid: true, errors: [], warnings: [] });
});
test('authored colliders must avoid circuit shoulders, city streets, island edges and one another', () => {
  rejected(altered(pack => { pack.maps[0].props[0].x = 0; pack.maps[0].props[0].z = 29; }), '.props[0]', /overlaps a street/);
  rejected(altered(pack => { pack.maps[1].props[0].x = -8; }), '.props[0]', /overlaps a street/);
  rejected(altered(pack => { pack.maps[0].props[0].x = 56; pack.maps[0].props[0].z = 38; }), '.props[0]', /fit on the island/);
  rejected(altered(pack => { pack.maps[0].props[1].x = -10; pack.maps[0].props[1].z = 0; }), '.props[1]', /overlaps the physical footprint/);
});
test('cross-pack prop placements receive the same collision checks', () => {
  const pack = circuitPack();
  pack.maps[0].props = [{ prop: 'extra-props/marker', x: 0, z: 29 }];
  assert.equal(validateContentPack(pack).valid, true, 'A standalone pack cannot know an external prop radius');
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, [pack, propPack()]), /overlaps a street/);
});
test('revisions are deterministic under object key order and include geometry, cars and props', () => {
  const revision = pack => createContentCatalog(TRACKS, CAR_PROFILES, [pack]).maps['starter-kit/workshop-orchard'].contentRevision;
  const original = revision(starter);
  assert.match(original, /^v1-[0-9a-f]{8}$/);
  assert.equal(original, revision(copy(starter)));
  const reordered = JSON.parse(JSON.stringify(starter, (key, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(original, revision(reordered));
  assert.notEqual(original, revision(altered(pack => { pack.maps[0].points[1][0] += .1; })));
  assert.notEqual(original, revision(altered(pack => { pack.cars[0].topSpeed += .1; })));
  assert.notEqual(original, revision(altered(pack => { pack.props[1].collider.mass += 1; })));
  assert.notEqual(original, revision(altered(pack => { pack.maps[0].props[1].x += .1; })));
  assert.notEqual(original, revision(altered(pack => { pack.maps[0].palette = { sky: '#AABBCC' }; })));
  assert.equal(original, revision(altered(pack => { pack.description = 'An unrelated pack description'; })));
});
test('diagnostics are deterministic and expose actionable paths instead of partial output', () => {
  const pack = altered(pack => { pack.maps[0].unknown = 2; pack.cars[0].topSpeed = 100; });
  assert.deepEqual(validateContentPack(pack), validateContentPack(pack));
  assert.throws(() => createContentCatalog(TRACKS, CAR_PROFILES, [starter, pack]), error => {
    assert.equal(error.name, 'ContentValidationError');
    assert.ok(Array.isArray(error.errors));
    assert.ok(error.message.includes('$[1].maps[0].unknown'));
    assert.ok(error.message.includes('$[1].cars[0].topSpeed'));
    return true;
  });
});

console.log(`TinyLaps content contract passed ${passed} checks.`);
