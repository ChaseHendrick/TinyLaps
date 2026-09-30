# TinyLaps content authoring

Do not use em dashes in documentation or UI copy.

When asked to create maps, cars, or scenery, add or edit JSON files under `content/packs/`. Use the existing engine unless the user explicitly requests an engine feature. Do not edit `index.html` or `content/catalog.generated.json` by hand.

1. Read `docs/CONTENT_FRAMEWORK.md`, `schemas/content-pack.schema.json`, and `content/packs/starter-kit.json`.
2. Scaffold with `npm run content:new -- unique-pack-id`. The command refuses to overwrite existing files. Adapt its working examples instead of guessing the data shape.
3. Use stable lowercase IDs. References are `pack-id/local-id`, including `builtin/cherry` for a stock racer. Keep placement IDs stable so saves retain object identity.
4. Coordinates and dimensions are meters: x/z are horizontal, y is up. Rotations are radians. Circuits close automatically. City routes contain grid indices and must follow streets through the city interior.
5. Car rosters cycle to ten racers. Use bounded tuning and supported roadster, coupe, or pickup silhouettes. Scenery must fit its declared collision radius and height.
6. Run `npm run content:check -- --json` and fix errors. Use `--smoke` for a 60-second road/vehicle check and `npm run content:preview` for layout previews in `work/content-previews/`.
7. Run `npm test`, then `npm run build`. Inspect the built game in a browser, including map selection, driving, custom props, and reload persistence. Simulation smoke checks do not prove complete gameplay quality.

Pack discovery is deterministic and recursive. There are no executable content hooks. Custom definitions are compiled into the standalone offline HTML. A changed custom map, roster, palette, or prop definition invalidates its old world save, so preserve IDs and explain meaningful compatibility changes.

Use `docs/AI_CONTENT_PROMPT.md` as a reusable task template. Do not commit generated previews, temporary test packs, credentials, or unrelated files.
