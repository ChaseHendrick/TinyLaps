export const SAVE_KEY = 'tiny-laps-save-v1';
const finite = value => Number.isFinite(value) && Math.abs(value) < 1e9;
const fixedCarFields = new Set(['id', 'name', 'color', 'profile', 'personality', 'mass', 'inertia', 'held']);

export function captureRace({ sim, terrain, scenery, barriers, people, view }) {
  return {
    version: 1, savedAt: Date.now(), view,
    elapsed: sim.elapsed, physics: { ...sim.physics }, aggression: sim.aggression,
    cars: sim.cars.map(car => Object.fromEntries(Object.entries(car).filter(([key]) => !fixedCarFields.has(key)))),
    terrain: terrain.exportState(), scenery: scenery.exportState(), people: people?.exportState(),
    barriers: barriers.map(barrier => barrier.health),
  };
}

export function readRace(storage, themes) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  if (raw.length > 5_000_000) throw new Error('Save is too large');
  const save = JSON.parse(raw);
  if (save?.version !== 1 || !Object.hasOwn(themes, save.view?.theme) || !finite(save.elapsed) || save.elapsed < 0 || !Array.isArray(save.cars) || save.cars.length !== 10) throw new Error('Unrecognized save');
  return save;
}

export function restoreRace(save, { sim, terrain, scenery, barriers, people }) {
  if (!save || save.cars.length !== sim.cars.length) return false;
  for (const car of save.cars) {
    if (!car || typeof car !== 'object' || !['x', 'y', 'z', 'progress', 'distance', 'heading', 'laps'].every(key => finite(car[key])) || !car.damage || !Object.values(car.damage).every(value => finite(value) && value >= 0 && value <= 1)) return false;
  }
  if (!terrain.restoreState(save.terrain)) return false;
  scenery.restoreState(save.scenery);
  if (save.people) people?.restoreState(save.people);
  barriers.forEach((barrier, index) => { const health = save.barriers?.[index]; if (finite(health)) barrier.health = Math.max(0, Math.min(1, health)); });
  sim.configurePhysics(save.physics);
  sim.setAggression(save.aggression);
  sim.elapsed = save.elapsed;
  sim.cars.forEach((car, index) => {
    const saved = save.cars[index];
    for (const [key, original] of Object.entries(car)) {
      if (fixedCarFields.has(key)) continue;
      const value = saved[key];
      if (key === 'damage') { for (const part of Object.keys(car.damage)) if (finite(value[part])) car.damage[part] = Math.max(0, Math.min(1, value[part])); }
      else if (typeof original === 'number' && finite(value)) car[key] = value;
      else if (typeof original === 'boolean' && typeof value === 'boolean') car[key] = value;
      else if (typeof original === 'string' && typeof value === 'string' && value.length < 100) car[key] = value;
      else if (original === null && (value === null || finite(value))) car[key] = value;
    }
    car.held = false;
  });
  return true;
}

export function writeRace(storage, state) {
  storage.setItem(SAVE_KEY, JSON.stringify(captureRace(state)));
}
