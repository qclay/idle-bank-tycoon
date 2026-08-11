// Планировка: ничего не поставлено в стену, в мебель, на площадку покупки или
// в дверной проём. Раньше это проверялось глазами по скриншотам, и стеллаж
// уезжал в витрину, а куст вставал прямо на площадку улучшения.
import { chromium } from 'playwright';

const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

const res = await p.evaluate(() => {
  const { S, game, actors, nav, scene } = window.__game;
  const B = window.__balance;
  for (const c of Object.values(S.counters)) c.open = true;
  for (const a of Object.values(S.atms)) a.open = true;
  for (const z of Object.values(S.zones)) z.open = true;
  actors.refreshSolids();

  const solid = [];
  const add = (n, x0, y0, x1, y1) => solid.push({ n, x0, y0, x1, y1 });
  for (const w of nav.wallRects()) add('стена', w.x0, w.y0, w.x1, w.y1);
  for (const c of B.COUNTERS) add(`витрина «${c.name}»`, c.x, c.y, c.x + 2, c.y + 0.62);
  for (const a of B.ATMS) add('постамат', a.x, a.y, a.x + 0.8, a.y + 0.66);
  for (const z of B.ZONES) add(`зона «${z.name}»`, z.x, z.y, z.x + 2.2, z.y + 1.2);
  add('касса', B.VAULT.x, B.VAULT.y, B.VAULT.x + B.VAULT.w, B.VAULT.y + B.VAULT.h);

  const pads = game.pads().map((x) => ({ n: `площадка «${x.title}»`, x0: x.x, y0: x.y,
                                         x1: x.x + x.w, y1: x.y + x.h }));
  const doors = B.DOORWAYS.map((d) => {
    const vert = Math.abs(d.x % 1) < 1e-6;
    return { n: `проём ${d.a}→${d.b}`,
             x0: vert ? d.x - 0.6 : d.x - d.w / 2, x1: vert ? d.x + 0.6 : d.x + d.w / 2,
             y0: vert ? d.y - d.w / 2 : d.y - 0.6, y1: vert ? d.y + d.w / 2 : d.y + 0.6 };
  });

  const cross = (a, c) => a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1;
  const decor = scene.decorFootprints();
  const вМебели = [], наПлощадках = [], вПроёмах = [], внеКомнат = [];
  for (const d of decor) {
    for (const s of solid) if (cross(d, s)) вМебели.push(s.n);
    for (const s of pads) if (cross(d, s)) наПлощадках.push(s.n);
    for (const s of doors) if (cross(d, s)) вПроёмах.push(s.n);
    if (!nav.roomAt((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2)) внеКомнат.push('предмет');
  }

  // мебель между собой тоже не должна пересекаться
  const мебельВМебели = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (solid[i].n === solid[j].n) continue;
      if (cross(solid[i], solid[j])) мебельВМебели.push(`${solid[i].n} × ${solid[j].n}`);
    }
  }
  return { всего: decor.length, вМебели, наПлощадках, вПроёмах, внеКомнат, мебельВМебели,
           площадок: pads.length };
});

ok('обстановка не стоит в стенах и мебели', res.вМебели.length === 0,
   res.вМебели.join(', ') || `проверено ${res.всего} предметов`);
ok('обстановка не стоит на площадках покупки', res.наПлощадках.length === 0,
   res.наПлощадках.join(', ') || `проверено ${res.площадок} площадок`);
ok('обстановка не перекрывает дверные проёмы', res.вПроёмах.length === 0, res.вПроёмах.join(', '));
ok('вся обстановка внутри помещений', res.внеКомнат.length === 0, res.внеКомнат.join(', '));
ok('мебель не пересекается между собой', res.мебельВМебели.length === 0, res.мебельВМебели.join(', '));

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
await b.close();
process.exit(bad ? 1 : 0);
