// Импорт изометрических текстур в проект.
//
// Художник отдаёт PNG по 2500×2500 — в бандл такое класть нельзя. Здесь их
// обрезаем по непрозрачному краю, уменьшаем до разумного размера и складываем
// в assets/iso вместе с метрикой: где у картинки опорная точка и сколько
// тайлов она занимает. Сцена берёт эти числа и ничего не подбирает на глаз.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const run = promisify(execFile);
const SRC = process.argv[2] || '/Users/falins/Downloads/Telegram Desktop/textures';
const OUT = 'assets/iso';

// Что откуда берём и как это ложится на сетку.
//  tiles — длина по своей оси в тайлах (её задал художник пропорцией картинки)
//  anchor — опорная точка в долях картинки: чем сажаем на тайл
const PLAN = [
  { src: 'floor.PNG',         out: 'floor.png',      w: 1024, tiles: 8,
    anchor: [0.5, 0], note: 'ромб 8×8, сажается верхней вершиной в угол участка' },
  { src: 'wall front.PNG',    out: 'wall-front.png', w: 1024, tiles: 8,
    anchor: [0, 0], note: 'панель вдоль оси x, левый верхний угол — начало стены' },
  { src: 'wall side.PNG',     out: 'wall-side.png',  w: 1024, tiles: 8,
    anchor: [1, 0], note: 'панель вдоль оси y, правый верхний угол — начало стены' },
  { src: 'cash register.PNG', out: 'counter.png',    w: 768,  tiles: 2,
    anchor: [0.5, 1], note: 'стойка 2×1, сажается низом за середину' },
];

await mkdir(OUT, { recursive: true });
const meta = {};

for (const p of PLAN) {
  const from = `${SRC}/${p.src}`;
  if (!existsSync(from)) { console.log(`нет файла: ${p.src}`); continue; }
  const to = `${OUT}/${p.out}`;
  // sips умеет обрезать по альфе только через промежуточный шаг, поэтому
  // границы считаем питоном, а сжимает пусть тот же питон — он уже есть.
  // Кроме обрезки и сжатия снимаем опорные точки: где у стены низ ближнего
  // столбца и где у пола верхняя вершина. Ставить картинки по этим числам
  // надёжнее, чем подбирать смещения на глаз.
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(from)}).convert('RGBA')
bb = im.split()[3].getbbox()
im = im.crop(bb)
w, h = im.size
k = ${p.w} / w
im = im.resize((${p.w}, max(1, round(h * k))), Image.LANCZOS)
im.save(${JSON.stringify(to)}, optimize=True)
a = im.split()[3]
W, H = im.size
def col(x):
    ys = [y for y in range(H) if a.getpixel((x, y)) > 128]
    return (ys[0], ys[-1]) if ys else (0, 0)
left = col(2)
right = col(W - 3)
# верхняя вершина: самый верхний непрозрачный пиксель и его x
top = None
for y in range(H):
    xs = [x for x in range(0, W, 2) if a.getpixel((x, y)) > 128]
    if xs:
        top = (sum(xs) / len(xs) / W, y / H)
        break
print(W, H, bb[2]-bb[0], bb[3]-bb[1], left[1]/H, right[1]/H, top[0], top[1])
`;
  const { stdout } = await run('python3', ['-c', py]);
  const [w, h, ow, oh, leftBase, rightBase, topX, topY] = stdout.trim().split(/\s+/).map(Number);
  meta[p.out.replace('.png', '')] = {
    file: p.out, w, h, tiles: p.tiles, anchor: p.anchor, note: p.note,
    leftBase: +leftBase.toFixed(4),    // низ левого столбца, доля высоты
    rightBase: +rightBase.toFixed(4),  // низ правого столбца
    topX: +topX.toFixed(4), topY: +topY.toFixed(4),
  };
  console.log(`${p.src} → ${p.out}  ${ow}×${oh} → ${w}×${h}  низ слева ${leftBase.toFixed(3)}, справа ${rightBase.toFixed(3)}`);
}

await writeFile(`${OUT}/meta.json`, JSON.stringify(meta, null, 2) + '\n');

// Тот же набор — модулем, чтобы сцена не ходила за ним по сети.
const js = `// Метрика изометрических текстур. Файл собирается tools/textures.mjs —
// править руками бессмысленно, перезапустите npm run textures.

export const ISO = ${JSON.stringify(meta, null, 2)};
`;
await writeFile('js/iso-meta.js', js);
console.log(`\nметрика в ${OUT}/meta.json и js/iso-meta.js`);
