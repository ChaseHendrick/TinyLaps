import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readContentPacks, generateContentCatalog, scaffoldPack, previewMaps, projectRoot } from '../tools/content.mjs';

const temp = await mkdtemp(resolve(tmpdir(), 'tinylaps-content-'));
const starter = JSON.parse(await readFile(new URL('../content/packs/starter-kit.json', import.meta.url), 'utf8'));
const cli = (...args) => spawnSync(process.execPath, [resolve(projectRoot, 'tools/content.mjs'), ...args], { encoding:'utf8' });
try {
  const packs = resolve(temp, 'packs');
  await mkdir(resolve(packs, 'nested'), { recursive:true });
  const file = resolve(packs, 'nested/working.json');
  await writeFile(file, JSON.stringify(starter));
  const installed = await readContentPacks({ directory:packs });
  assert.equal(Object.keys(installed.catalog.maps).length, 20);
  assert.equal(installed.entries[0].file, file);
  const result = cli('check', '--dir', packs, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mapCount, 20);
  // A file already discovered is not installed a second time.
  assert.equal((await readContentPacks({ directory:packs, extraFile:file })).packs.length, 1);
  const preview = await previewMaps(installed.catalog, resolve(temp, 'previews'));
  assert.equal(preview.length, 2);
  assert((await readFile(preview[1].file, 'utf8')).includes('<line'));
  assert(preview.every(map => map.lengthMeters > 160));
  const cfg = installed.catalog.maps['starter-kit/workshop-orchard'];
  const collidingNames = await previewMaps({ maps:{'a--b/c':cfg, 'a/b--c':cfg} }, resolve(temp, 'unique-previews'));
  assert.notEqual(collidingNames[0].file, collidingNames[1].file);
  assert((await readFile(collidingNames[0].file, 'utf8')).includes('a--b/c'));
  assert((await readFile(collidingNames[1].file, 'utf8')).includes('a/b--c'));
  const scaffold = resolve(temp, 'my-workshop.json');
  await scaffoldPack('my-workshop', scaffold);
  const newPack = JSON.parse(await readFile(scaffold, 'utf8'));
  assert.equal(newPack.id, 'my-workshop');
  assert(newPack.maps[0].cars[0].startsWith('my-workshop/'));
  assert(!JSON.stringify(newPack).includes('starter-kit/'));
  const hyphens = resolve(temp, 'hyphens.json');
  await scaffoldPack('my--pack-', hyphens);
  assert.equal(JSON.parse(await readFile(hyphens, 'utf8')).name, 'My Pack Workshop');
  await assert.rejects(scaffoldPack('my-workshop', scaffold), { code:'EEXIST' });
  await assert.rejects(scaffoldPack('../escape', resolve(temp, 'escape.json')));
  const combined = await readContentPacks({ directory:packs, extraFile:scaffold });
  assert.equal(Object.keys(combined.catalog.maps).length, 22);
  await writeFile(resolve(packs, 'duplicate.json'), JSON.stringify(starter));
  await assert.rejects(readContentPacks({ directory:packs }), /already installed/);
  await rm(resolve(packs, 'duplicate.json'));
  // A bad installed pack gives a failing machine-readable command and cannot
  // overwrite the previous generated catalog. Build calls this same boundary.
  const registry = resolve(projectRoot, 'content/catalog.generated.json');
  const before = await readFile(registry);
  await writeFile(resolve(packs, 'broken.json'), '{ not JSON');
  const broken = cli('check', '--dir', packs, '--json');
  assert.equal(broken.status, 1);
  const diagnostics = JSON.parse(broken.stderr);
  assert.equal(diagnostics.valid, false);
  assert(diagnostics.errors.some(d => d.path.endsWith('broken.json') && d.message.includes('Invalid JSON')));
  await assert.rejects(generateContentCatalog({ directory:packs }), /Invalid JSON/);
  assert.deepEqual(await readFile(registry), before);
  console.log('Content tools: nested discovery, machine diagnostics, previews, references, scaffold protection and failure atomicity passed.');
} finally {
  await rm(temp, { recursive:true, force:true });
}
