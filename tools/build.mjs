// Сборка в docs/: бандл + css + картинки + index.html с правкой пути на app.js.
import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';

const OUT = 'docs';
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build();

await cp('css', `${OUT}/css`, { recursive: true });
await cp('assets', `${OUT}/assets`, { recursive: true });

let html = await readFile('index.html', 'utf8');
html = html.replace('./js/main.js', './app.js');
await writeFile(`${OUT}/index.html`, html);

// чтобы GitHub Pages не прогонял файлы через Jekyll
await writeFile(`${OUT}/.nojekyll`, '');

console.log('собрано в', OUT);
