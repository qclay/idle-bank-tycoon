// Сборка в docs/: бандл + css + картинки + index.html с правкой пути на app.js.
//
// К ссылкам на бандл и стили подставляем отпечаток содержимого. Без него
// вебвью Telegram держит старые файлы месяцами: игрок обновляет приложение и
// не видит ничего нового.
import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = 'docs';
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build();

await cp('css', `${OUT}/css`, { recursive: true });
await cp('assets', `${OUT}/assets`, { recursive: true });

const mark = async (file) => createHash('sha256')
  .update(await readFile(file)).digest('hex').slice(0, 10);

const vJs = await mark(`${OUT}/js/app.js`);
const vCss = await mark(`${OUT}/css/ui.css`);

let html = await readFile('index.html', 'utf8');
html = html.replace('./js/main.js', `./js/app.js?v=${vJs}`);
html = html.replace('./css/ui.css', `./css/ui.css?v=${vCss}`);
await writeFile(`${OUT}/index.html`, html);

// чтобы GitHub Pages не прогонял файлы через Jekyll
await writeFile(`${OUT}/.nojekyll`, '');

console.log('собрано в', OUT, `· app.js?v=${vJs}`);
