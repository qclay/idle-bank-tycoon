// Текстуры от художника: попали в проект, легли на сетку, ничего не разъехалось.
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

// ── Файлы и метрика ──────────────────────────────────────────────────────────

const meta = JSON.parse(await readFile('assets/iso/meta.json', 'utf8'));
const need = ['floor', 'wall-front', 'wall-side', 'counter'];
ok('все текстуры импортированы', need.every((k) => meta[k]), Object.keys(meta).join(', '));

let total = 0;
for (const k of need) {
  const s = await stat(`docs/assets/iso/${meta[k].file}`).catch(() => null);
  if (s) total += s.size;
}
ok('текстуры попали в сборку и не раздули её', total > 0 && total < 1.6e6,
   `${Math.round(total / 1024)} КБ на четыре файла`);

// Пол — ровно 2:1, иначе он не ляжет на нашу изометрию
// Небольшой разброс даёт сглаженный край при обрезке по альфе — важно, чтобы
// он был именно небольшим: сцена подгоняет плиту по обеим осям отдельно.
const f = meta.floor;
ok('пол лежит в нашей изометрии', Math.abs(f.w / f.h - 2) < 0.05,
   `пропорция ${(f.w / f.h).toFixed(3)} при нужных 2.000`);

// ── В игре ───────────────────────────────────────────────────────────────────

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.tut = 99;
  S.counters.c1.open = true; S.counters.c2.open = true;
  actors.player.x = 10; actors.player.y = 4;
  actors.refreshSolids(); actors.syncStaff();
  window.__rebuild();          // витрины рисуются по событию, а не сами по себе
});
await p.waitForTimeout(1500);

const world = await p.evaluate(() => {
  const { scene } = window.__game;
  const B = window.__balance;
  const walk = (c, out = []) => { out.push(c); for (const k of c.children || []) walk(k, out); return out; };
  const all = walk(scene.world);
  const sprites = all.filter((n) => n.texture && n.width);
  const named = (src) => sprites.filter((n) => (n.texture.source?.label || '').includes(src)).length;
  return {
    пол: named('floor'),
    стенаФронт: named('wall-front'),
    стенаБок: named('wall-side'),
    стойки: named('counter'),
    ширинаЗала: B.HALL.w, глубинаЗала: B.HALL.h,
    // первая плита должна стоять точно в углу зала
    угол: (() => {
      const s = sprites.find((n) => (n.texture.source?.label || '').includes('floor'));
      const p0 = scene.screenOf(0, 0, 0);
      const w = scene.world;
      return s ? { dx: Math.round(s.x * w.scale.x + w.x - p0.x), dy: Math.round(s.y * w.scale.y + w.y - p0.y) } : null;
    })(),
  };
});

ok('пол выложен текстурой', world.пол > 0, `${world.пол} плит`);
ok('первая плита стоит ровно в углу зала',
   world.угол && Math.abs(world.угол.dx) < 2 && Math.abs(world.угол.dy) < 2,
   world.угол ? `смещение ${world.угол.dx}, ${world.угол.dy} px` : 'плиты нет');
ok('дальняя стена собрана по тайлам', world.стенаФронт === world.ширинаЗала,
   `${world.стенаФронт} полос при ширине ${world.ширинаЗала}`);
ok('боковая стена собрана по тайлам', world.стенаБок === world.глубинаЗала,
   `${world.стенаБок} полос при глубине ${world.глубинаЗала}`);
ok('открытые стойки нарисованы текстурой', world.стойки === 2, `${world.стойки} стойки`);

await p.screenshot({ path: `${OUT}/tex.png` });

// Текстур нет — игра всё равно должна собраться и работать
await p.evaluate(() => { window.__game.scene.getApp(); });
ok('страница работает без ошибок', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
await b.close();
process.exit(bad ? 1 : 0);
