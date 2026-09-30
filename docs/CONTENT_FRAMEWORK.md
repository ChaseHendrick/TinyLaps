# Add maps, cars, and scenery

TinyLaps accepts plain JSON content packs. The same versioned schema and semantic validator run in the authoring tools, build, and game. An LLM can create a pack without changing scene code, physics, or the browser UI. The working starter adds Workshop Orchard and Workshop Quarter, Copper Coupe and Meadow Pickup, a pavilion, and a garden marker.

## Quick workflow

Use Node.js 22.12 or newer, then:

```sh
npm ci
npm run content:new -- my-worlds
# Edit content/packs/my-worlds.json.
npm run content:check -- --json
npm run content:check -- --smoke
npm run content:preview
npm test
npm run build
npm start
```

Open `http://127.0.0.1:8765` and choose a new world. The scaffolder creates working examples and rewrites internal references. It never overwrites a file. Every `.json` file under `content/packs/`, including nested folders, is discovered in sorted order. Keep incomplete drafts outside that directory. Discovery rejects symlinks, more than 64 packs, and files larger than 1 MiB.

`npm run content:check -- --file /path/to/draft.json --json` validates a draft alongside installed packs. `--dir /path/to/packs` chooses a different pack directory. JSON diagnostics contain `valid`, `errors` with file/field paths, or counts and warnings on success. Failed commands return a nonzero exit code. Preview accepts `--out /path/to/previews`; scaffold accepts `--output /path/to/new.json`.

Preview SVGs show actual sampled routes, city streets, start positions, and prop footprints. `catalog.json` records lengths and IDs. The `--smoke` option runs each authored map's ten-racer road/vehicle simulation for 60 simulated seconds and checks finite state and forward progress. It does not include every scenery contact, traffic situation, or browser interaction. Full tests and browser play checks remain necessary.

## Pack and identity

The authoritative contract is [the schema](../schemas/content-pack.schema.json). [The starter pack](../content/packs/starter-kit.json) demonstrates all three content types. Read them before authoring. Use `schemaVersion: 1`, a lowercase slug `id`, and a display `name`. Optional `maps`, `cars`, and `props` arrays can be omitted, but at least one must be nonempty. Unknown fields, scripts, functions, and nonfinite values are rejected. The schema's own `$schema` property is not an allowed property in a content pack.

Local IDs start with a letter and contain lowercase letters, digits, and hyphens, up to 48 characters. `builtin` is reserved. Runtime IDs are `pack-id/local-id`; this lets independent packs reuse local names. Maps retain the original built-in keys. Names and descriptions are plain text. Colors are six-digit hex strings.

Car and prop references may point to another installed pack. The complete catalog must resolve all references atomically. Cars-only and props-only packs are supported. Removing a dependency fails validation rather than silently changing the world.

## Maps

Each map needs `id`, `name`, and `description`. It uses exactly one of these route forms:

| Route form | Fields | Meaning |
| --- | --- | --- |
| Circuit | `points: [[x,y,z], ...]` | Closed centripetal spline. At least six control points; do not repeat the first at the end. |
| City | `city` and `cityRoute: [[i,j], ...]` | Connected street route through the configured grid. Indices address `city.xs` and `city.zs`. |

Coordinates use meters, with y up. Circuits must fit the fixed island, road width, slope, separation, and closure constraints. Validation uses the sampled track, not only the control points. Custom circuit curvature is capped at 0.22 per meter, city curvature at 0.5 per meter, and nonadjacent sampled road centers need 8.4 meters of clearance so road shoulders remain separate. Sparse points can still produce overshoot or tight bends, so inspect previews.

City grids need sorted, sufficiently separated x/z streets. The current grid limits are four to nine x streets and three to seven z streets. Street width is fixed at seven meters. City routes must connect intersections on one row or column, form a simple loop without reused intersections or U-turns, and remain inside the street footprint after turns are rounded. Build routes through the interior neighborhoods. Civilian traffic uses the connected street graph independently of the race loop.

Optional fields include `setting` (`harbor`, `alpine`, or `sunset`), `difficulty`, deterministic `seed`, `routeRevision`, `palette`, `cars`, and `props`. Setting selects the base palette and scenery style. Authored maps do not add rivers in schema version 1. Seed zero is valid. Palette can override grass, sand, water, sky, and sun with hex colors.

City fields include `xs`, `zs`, `width`, `warp`, `parks`, `style`, `residents`, `traffic`, and `seed`. Park entries identify grid blocks. Zero residents and zero traffic are supported. Defaults and exact bounds are recorded in the schema and normalizer.

## Cars

A custom car needs `id`, `name`, `color`, `topSpeed`, `cornering`, `acceleration`, and `model`. Optional `mass` and `personality` configure physics and driving style.

| Parameter | Units or accepted values |
| --- | --- |
| `topSpeed` | Meters per second, 8 to 32 |
| `cornering` | Grip tuning, 5 to 18; stock behavior is preserved |
| `acceleration` | Acceleration tuning, 2 to 10 |
| `mass` | Kilograms, 450 to 1200 |
| `model.body` | `roadster`, `coupe`, or `pickup` |
| `model.scale` | `[x,y,z]`, each 0.85 to 1.15 |
| `model.stripeColor`, `model.accentColor` | Optional hex colors |

Model scale changes visual geometry and physical dimensions together. The supported bodies share the stock chassis architecture. Arbitrary external meshes are not part of this format.

Personality contains a label, description, and aggression, bravery, defensiveness, and awareness values from zero to one. Omission supplies a stock driver personality.

Map `cars` contains one to ten namespaced references. The list cycles to ten active racers, so two definitions can make an alternating grid. Repeated definitions are allowed; numeric racer IDs remain 0 through 9. Examples of stock references are `builtin/cherry`, `builtin/bluebell`, `builtin/clementine`, and `builtin/inky`. Omit the roster to retain all ten stock racers.

## Scenery and collisions

A prop needs `id`, `name`, `collider`, and `parts`. `kind` defaults to `custom`, with `building`, `tree`, and `rock` also supported. Collider fields are radius, mass, and height. The collision radius/height must contain the entire visual assembly, including rotated parts. The engine uses a circular horizontal footprint and height, with its existing grabbing, impact, breakage, debris, and save system.

| Part shape | `size` interpretation |
| --- | --- |
| `box` | Full width, height, depth |
| `sphere` | Ellipsoid x, y, z radii |
| `cylinder` | Top radius, height, bottom radius |

Parts also have local `position: [x,y,z]`, optional XYZ Euler `rotation` in radians, and `color`. Local y zero is ground. Map placement uses `{id, prop, x, z, yaw}`. `prop` is a namespaced definition reference; yaw is radians. Use stable placement IDs. If omitted, identity uses the definition and original x/z coordinates. Placements must fit the island, remain clear of roads, and avoid one another. Procedural scenery reserves space for authored objects.

These colliders are stylized rigid-body approximations. Decorative parts do not each become an independent convex physics body. Do not claim engineering accuracy from successful validation.

## Build, saves, and extension boundaries

`content/index.js` exports `validateContentPack`, `createContentCatalog`, `ContentValidationError`, and `contentPackSchema`. Catalog compilation returns maps, cars, props, and pack metadata. Resolved definitions use `contentId`. Map `cars` contains resolved profiles, and prop placements include resolved `definition` objects.

Build validates all source packs, generates `content/catalog.generated.json`, and bundles them into the standalone `index.html`. Do not edit either generated file manually. Invalid packs fail before overwriting the previous game. Visitors require no content server or new network dependency, and exported HTML remains offline capable.

Stable built-in identities and legacy saves are preserved. A custom map has a deterministic `contentRevision` covering its normalized definition, palette, resolved roster, and prop definitions. Changing those definitions rejects the old custom world save before any state is restored, starting a fresh compatible world. Cosmetic edits may also change the revision. Removing a saved map falls back to an available world.

For a feature outside schema version 1, extend the schema, runtime validator/compiler, engine integration, tests, and this document together. Keep errors specific enough that an agent can fix the offending field. Preserve the ten-racer convention and never evaluate executable code from content files.
