import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { generateContentCatalog } from './tools/content.mjs';

const base = new URL('./', import.meta.url);
const { catalog } = await generateContentCatalog();
const result = await build({
  entryPoints: [new URL('app.js', base).pathname],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
  legalComments: 'inline',
});
const css = await readFile(new URL('style.css', base), 'utf8');
const template = await readFile(new URL('template.html', base), 'utf8');
const html = template
  .replace('/* STYLES */', css)
  .replace('/* APP */', () => result.outputFiles[0].text.replaceAll('</script>', '<\\/script>'));
const license = await readFile(new URL('node_modules/three/LICENSE', base), 'utf8');
await writeFile(new URL('index.html', base), html.replace('<head>', '<head>\n<!-- Bundled Three.js license:\n' + license + '\n-->'));
console.log(`Built offline index.html: ${Math.round(Buffer.byteLength(html) / 1024)} KiB`);
console.log(`Included ${Object.keys(catalog.maps).length} maps and ${catalog.packs.length} content packs.`);
