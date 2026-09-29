# Tiny Laps

A little world, always in motion. Ten autonomous racers compete around smooth miniature island circuits, with close-up cameras, aggressive driving personalities, collision damage, destructible scenery and terrain, and a developer control room.

**[Watch the race](https://chasehendrick.github.io/TinyLaps/)**

Open `index.html` directly in a modern browser. It is a portable offline build with no asset downloads, accounts, API keys, or external service calls.

## Explore

- **Pebble Bay:** a coastal village, river bridge, lighthouse and sailboats.
- **Clover Hills:** rounded peaks, forest and a winding circuit.
- **Sundown:** warm evening light over a miniature valley.
- Drag to orbit, scroll or pinch to zoom, and use the zoom buttons for close views.
- Select a car in the world or standings. **Follow** trails it, **Ride** faces along its actual heading, and **Tour** slowly circles the island.
- Racers keep competing. Each has a distinct autonomous driving policy: attackers, late brakers, defenders, opportunists and hotheads. The temperament selector changes their appetite for risk.
- The condition meter, contact count and driving intent show what is happening. Impacts visibly crumple panels, mark paint, bend glass and alter wheel alignment. Heavy front damage produces engine smoke.

## God powers and developer tools

Open the wrench in the lower right or press **D**.

| Power | Effect |
| --- | --- |
| Drop a meteor | A falling body strikes the world, deforms ground, damages scenery and pushes nearby cars. |
| Shockwave | Applies radial impulses to cars and breaks nearby objects and barriers. |
| Raise / lower terrain | Sculpt the real terrain mesh and roadway. The changed height, slope, roughness and grip affect driving. |
| Repair ground | Restores the terrain in a brush radius. |
| Grab & throw | Pick up a racer, move it, and release it with an impulse based on your drag. |
| Boost / spin racer | Apply a forward or off-center impulse to the selected body. |
| Repair racer | Restore its body, engine and suspension condition. |
| Restore whole world | Rebuild the scenery, terrain, barriers and all racers. |

The **Physics** tab exposes gravity, tire grip, impact restitution, damage intensity, engine power and simulation speed. Freeze time to inspect a moment. The **Inspect** tab shows body outlines, obstacle colliders, velocity vectors, steering, throttle, braking, slip and damage.

Buildings crumple into rubble, trees fall, and broken props become nonsolid. Debris uses gravity, bounce, angular motion and ground friction. Roads deform with the terrain, and segmented guardrails retain damage until the world is restored.

## Controls

| Key | Action |
| --- | --- |
| `1` / `2` / `3` / `4` | Explore / Follow / Ride / Tour camera |
| `←` / `→` | Select previous / next racer |
| `+` / `−` | Zoom |
| `Space` | Pause / resume |
| `H` | Hide / show the main controls |
| `D` | Developer tools and god powers |
| `Escape` | Close god tools and return to exploration |

Optional ambient audio starts only after you enable it. The camera button saves a postcard of the current view. Fullscreen uses the browser's fullscreen feature.

## How it works

The scene is procedurally modeled with Three.js. Vehicles use a fixed 120 Hz simulation with finite mass and yaw inertia, front and rear tire slip, friction limits shared between steering and braking, longitudinal weight transfer, engine force, drag, braking and surface friction. Autonomous drivers steer, choose passing lines, defend positions, plan braking and recover from mistakes.

Car contacts use oriented rectangles, contact impulses, angular response, friction and penetration correction. Throws and shockwaves can launch cars into ballistic flight, with gravity, air drag, height-aware contacts and landing damage. Tire forces stop while a car is airborne. Static scenery uses approximate circular colliders. Impact severity accumulates directional body damage and reduces engine power, tire stiffness and grip. World damage shares the vehicle simulation's surface and obstacle data.

This is a stylized physics model for a miniature world. It is not calibrated to a particular real vehicle, and the procedural panel deformation is not a finite element or soft-body crash simulation. Terrain is a bounded height field, so it supports craters and hills rather than caves or arbitrary topology. Decorative hills and water are scenery; buildings and trees have simplified colliders. Debris has its own gravity and ground contact model.

## Develop

```sh
npm ci
npm test
npm run build
npm start
```

Open `http://127.0.0.1:8765`. The local server command requires Python 3. Rebuild and reload after changing source files. The checked-in `index.html` contains all JavaScript, styles and the Three.js license, so it can also be shared as a single file.

| File | Role |
| --- | --- |
| `app.js` | Scene, cameras, UI and system integration |
| `race.js` | Vehicle dynamics, contacts, driving AI and lap timing |
| `cars.js` | Rounded roadsters, directional damage and smoke |
| `scenery.js` | Village, vegetation, animation, destructible props and debris |
| `terrain.js` | Mutable height field, road deformation and surface sampling |
| `devtools.js` | God tools, physics controls and live inspection |
| `tracks.js` | Shared circuit definitions |
| `build.mjs` | Portable offline build |

Tests cover vehicle dynamics and collision damage, model deformation and exact repair, terrain and roadway displacement, and destructible scenery. GitHub Actions runs the tests and verifies that the committed offline build matches the source.

## Reference

Inspired by the miniature-world racing concept in [Christopher J. DiMarco's video](https://x.com/chrisjdimarco/status/2104598205417591120). The scene, vehicle meshes and implementation here are original procedural work. No media or source code from that demonstration is included.

Third-party licensing is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
