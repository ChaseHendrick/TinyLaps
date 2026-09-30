import { readdir, lstat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentCatalog, validateContentPack, ContentValidationError } from '../content/index.js';
import { TRACKS } from '../tracks.js';
import { CAR_PROFILES, RaceSimulation } from '../race.js';
import { buildTrack } from '../track.js';
import { createCityPlan } from '../city.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDirectory = resolve(projectRoot, 'content/packs');
const error = (path, message) => new ContentValidationError([{ path, message }]);
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));

/** Sorted, bounded discovery keeps builds reproducible and errors actionable. */
export async function readContentPacks({ directory = defaultDirectory, extraFile } = {}) {
  const files = [];
  async function visit(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw error(path, 'Content discovery does not follow symbolic links.');
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(resolve(path, entry));
    } else if (path.endsWith('.json')) {
      if (!info.isFile()) throw error(path, 'Content must be a regular JSON file.');
      files.push(resolve(path));
    }
  }
  await visit(resolve(directory));
  if (extraFile && !files.includes(resolve(extraFile))) {
    const info = await lstat(resolve(extraFile));
    if (!info.isFile() || info.isSymbolicLink()) throw error(extraFile, 'Content must be a regular JSON file.');
    files.push(resolve(extraFile));
  }
  files.sort();
  if (files.length > 64) throw error(directory, 'Install at most 64 content packs.');
  const entries = [], errors = [], warnings = [];
  for (const file of files) {
    if ((await lstat(file)).size > 1024 * 1024) { errors.push({ path:file, message:'A pack must be at most 1 MiB.' }); continue; }
    let pack;
    try { pack = JSON.parse(await readFile(file, 'utf8')); }
    catch (cause) { errors.push({ path:file, message:`Invalid JSON: ${cause.message}` }); continue; }
    const result = validateContentPack(pack);
    errors.push(...result.errors.map(d => ({ ...d, path:`${file}:${d.path}` })));
    warnings.push(...result.warnings.map(d => ({ ...d, path:`${file}:${d.path}` })));
    entries.push({ file, pack });
  }
  if (errors.length) throw new ContentValidationError(errors);
  const packs = entries.map(entry => entry.pack);
  let catalog;
  try { catalog = createContentCatalog(TRACKS, CAR_PROFILES, packs); }
  catch (cause) {
    if (!(cause instanceof ContentValidationError)) throw cause;
    throw new ContentValidationError(cause.errors.map(d => {
      const match = /^\$\[(\d+)\](.*)$/.exec(d.path);
      return { ...d, path:match ? `${entries[Number(match[1])].file}:$${match[2]}` : d.path };
    }));
  }
  return { entries, packs, catalog, warnings:warnings.filter(d => !d.message.startsWith('Another installed pack must provide')) };
}

export async function generateContentCatalog(options = {}) {
  const result = await readContentPacks(options);
  const file = resolve(projectRoot, 'content/catalog.generated.json');
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(result.packs, null, 2) + '\n');
  await rename(temp, file);
  return result;
}

export async function scaffoldPack(id, output = resolve(defaultDirectory, `${id}.json`)) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id) || id === 'builtin') throw error('id', 'Use a unique lowercase slug, up to 48 characters, excluding builtin.');
  const source = JSON.parse(await readFile(resolve(defaultDirectory, 'starter-kit.json'), 'utf8'));
  const pack = JSON.parse(JSON.stringify(source).replaceAll('starter-kit/', `${id}/`));
  pack.id = id;
  pack.name = id.split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ') + ' Workshop';
  pack.description = 'A working starter for custom maps, racers, and physical scenery. Edit these definitions to make it your own.';
  pack.maps.forEach(map => { map.name = `${pack.name}: ${map.name.replace('Workshop ', '')}`; });
  await mkdir(dirname(resolve(output)), { recursive:true });
  await writeFile(resolve(output), JSON.stringify(pack, null, 2) + '\n', { flag:'wx' });
  return resolve(output);
}

export function smokeMaps(catalog) {
  const reports = [];
  for (const [id, cfg] of Object.entries(catalog.maps).filter(([, cfg]) => cfg.contentPack)) {
    const track = buildTrack(cfg);
    const sim = new RaceSimulation(track.length, track.sampleAtDistance, {
      carProfiles:cfg.cars, contentRevision:cfg.contentRevision,
      speedLimit:cfg.city ? 12 : undefined, cornerSafety:cfg.city ? .82 : 1,
    });
    const initial = sim.cars.map(car => car.progress);
    for (let step = 0; step < 60 * 60; step++) {
      sim.update(1 / 60);
      if (!sim.cars.every(car => [car.x, car.y, car.z, car.speed, car.progress, car.heading].every(Number.isFinite))) throw error(id, 'Vehicle smoke check produced a nonfinite state.');
    }
    const progress = sim.cars.map((car, i) => car.progress - initial[i]);
    if (progress.some(value => value < track.length * .05)) throw error(id, 'A driver made insufficient forward progress in the 60-second road/vehicle smoke check.');
    reports.push({ id, simulatedSeconds:60, minProgressMeters:+Math.min(...progress).toFixed(2) });
  }
  return reports;
}

export async function previewMaps(catalog, output = resolve(projectRoot, 'work/content-previews')) {
  await mkdir(output, { recursive:true });
  const reports = [];
  for (const [id, cfg] of Object.entries(catalog.maps).filter(([, cfg]) => cfg.contentPack)) {
    const track = buildTrack(cfg), point = p => `${(p.x + 64).toFixed(2)},${(p.z + 47).toFixed(2)}`;
    let roads = '';
    if (cfg.city) {
      const plan = createCityPlan(cfg.city);
      roads = plan.edges.map(edge => `<line x1="${plan.nodes[edge.a].x + 64}" y1="${plan.nodes[edge.a].z + 47}" x2="${plan.nodes[edge.b].x + 64}" y2="${plan.nodes[edge.b].z + 47}"/>`).join('');
    }
    const route = track.samples.filter((_, i) => i % 3 === 0).map(point);
    route.push(route[0]);
    const start = track.sampleAtDistance(0);
    const props = (cfg.props || []).map(p => `<circle cx="${p.x + 64}" cy="${p.z + 47}" r="${p.definition.collider.radius}" fill="#a67650"><title>${escapeXML(p.definition.name)}</title></circle>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 110" width="1024" height="880"><title>${escapeXML(cfg.name)}</title><rect width="128" height="110" fill="#eeeade"/><rect x="1" y="1" width="126" height="92" rx="6" fill="#c8d4bc"/><g stroke="#66716a" stroke-width="7">${roads}</g><polyline points="${route.join(' ')}" fill="none" stroke="#66716a" stroke-width="${cfg.city ? 1.2 : 7}"/><polyline points="${route.join(' ')}" fill="none" stroke="#f7e7c5" stroke-width=".5"/>${props}<circle cx="${start.x + 64}" cy="${start.z + 47}" r="1.2" fill="#b75137"/><text x="4" y="99" font-family="sans-serif" font-size="3">${escapeXML(cfg.name)}</text><text x="4" y="105" font-family="sans-serif" font-size="2">${escapeXML(id)} · ${Math.round(track.length)} m · red: start · brown: prop footprints</text></svg>`;
    const file = resolve(output, `${id.replaceAll('/', '__')}.svg`);
    await writeFile(file, svg);
    reports.push({ id, name:cfg.name, lengthMeters:+track.length.toFixed(2), city:Boolean(cfg.city), props:cfg.props?.length || 0, file });
  }
  await writeFile(resolve(output, 'catalog.json'), JSON.stringify(reports, null, 2) + '\n');
  return reports;
}

async function main(args) {
  const command = args.shift() || 'check', options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--json', '--smoke'].includes(arg)) options[arg.slice(2)] = true;
    else if (['--file', '--dir', '--out', '--output'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw error(arg, 'Provide a path after this option.');
      options[arg.slice(2)] = resolve(args[++i]);
    } else if (arg.startsWith('-')) throw error(arg, 'Unknown option.');
    else positional.push(arg);
  }
  if (command === 'scaffold') {
    if (positional.length !== 1) throw error('command', 'Usage: npm run content:new -- my-pack [--output path]');
    const file = await scaffoldPack(positional[0], options.output);
    console.log(options.json ? JSON.stringify({ valid:true, file }) : `Created ${relative(projectRoot, file)}. Edit it, then run npm run content:check.`);
    return;
  }
  if (!['check', 'preview'].includes(command) || positional.length) throw error('command', 'Use check, preview, or scaffold.');
  const { catalog, entries, warnings } = await readContentPacks({ directory:options.dir, extraFile:options.file });
  const report = { valid:true, packCount:entries.length, mapCount:Object.keys(catalog.maps).length, cityCount:Object.values(catalog.maps).filter(cfg => cfg.city).length, warnings };
  if (options.smoke) report.smoke = smokeMaps(catalog);
  if (command === 'preview') report.previews = await previewMaps(catalog, options.out);
  console.log(options.json ? JSON.stringify(report) : `Content valid: ${report.packCount} packs, ${report.mapCount} maps, ${report.cityCount} cities.${report.smoke ? ' Road/vehicle smoke checks passed.' : ''}${report.previews ? ` Previews: ${report.previews.length}.` : ''}`);
  if (!options.json) for (const warning of warnings) console.warn(`${warning.path}: ${warning.message}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(cause => {
    const errors = cause.errors || [{ path:'command', message:cause.message }];
    console.error(process.argv.includes('--json') ? JSON.stringify({ valid:false, errors }) : errors.map(d => `${d.path}: ${d.message}`).join('\n'));
    process.exitCode = 1;
  });
}
