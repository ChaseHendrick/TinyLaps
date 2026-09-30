# Reusable content task

Copy this prompt and replace the bracketed requests:

> Create a TinyLaps content pack named [name], with stable pack ID [slug]. Add [maps, cars, and scenery requested]. Read AGENTS.md, docs/CONTENT_FRAMEWORK.md, schemas/content-pack.schema.json, and content/packs/starter-kit.json first. Scaffold a new pack without overwriting existing files. Author data under content/packs rather than modifying engine code. Use real connected street routes through city interiors, correct meters/radians and primitive dimensions, bounded car tuning, conservative prop colliders, and stable IDs. Preserve all existing worlds and saves. Run content:check with JSON diagnostics and smoke checks, generate and inspect previews, run the relevant full tests, and build. Inspect the built browser game, including route motion, manual driving, prop interactions, and reload persistence. Fix discovered problems and report what was actually verified. Do not push, deploy, or change repository visibility unless this task separately authorizes it.

Useful narrower requests:

- A cars-only pack with three supported silhouettes and restrained personalities.
- A city map with a route that visits interior blocks, two parks, light traffic, and a landmark clear of the streets.
- A scenery library containing reusable buildings and markers, with collider extents matching the assemblies.
- A circuit map that references another installed pack's cars and props.

Do not ask an agent to hide arbitrary JavaScript inside JSON, bypass the validator, or invent unsupported schema fields. For a new engine feature, make that a separate implementation request with coordinated schema and regression changes.
