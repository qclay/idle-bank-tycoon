// Юзабилити: попасть пальцем, найти раздел, понять первые минуты.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(1400);

// ── 1. В любую кнопку можно попасть пальцем ──────────────────────────────────

const MIN = 44;
const taps = await p.evaluate((min) => {
  const bad = [];
  let all = 0;
  for (const e of document.querySelectorAll('button, .bub')) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    if (!r.width || e.hidden || s.display === 'none' || s.visibility === 'hidden'
        || s.pointerEvents === 'none') continue;
    all++;
    if (Math.min(r.width, r.height) < min) {
      bad.push(`${e.id || e.className.split(' ')[0]} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return { all, bad };
}, MIN);
ok(`во все кнопки можно попасть пальцем (${MIN}px)`, taps.bad.length === 0,
   taps.bad.length ? taps.bad.join(', ') : `проверено ${taps.all}`);

// ── 2. Каждый раздел подписан и находится ────────────────────────────────────

const nav = await p.evaluate(() => [...document.querySelectorAll('.nav-btn')]
  .map((e) => ({ tab: e.dataset.tab, label: e.querySelector('b')?.textContent || '' })));
ok('в нижней навигации всё подписано словами',
   nav.length === 5 && nav.every((n) => /[а-яё]{3}/i.test(n.label)),
   nav.map((n) => n.label).join(' · '));

await p.evaluate(() => window.__openTab('more'));
await p.waitForTimeout(600);
const more = await p.evaluate(() => [...document.querySelectorAll('.row--tap')].map((e) => ({
  name: e.querySelector('.row__name')?.textContent || '',
  sub: e.querySelector('.row__sub')?.textContent || '',
  locked: e.classList.contains('is-locked'),
})));
ok('за «Ещё» лежат все остальные разделы', more.length === 5, more.map((m) => m.name).join(' · '));
ok('у каждого есть объяснение, что внутри', more.every((m) => m.sub.length > 12),
   more.map((m) => `${m.name}: ${m.sub.slice(0, 24)}…`).join(' | '));
ok('закрытый раздел объясняет, когда откроется',
   more.filter((m) => m.locked).every((m) => /Откроется/.test(m.sub)),
   more.filter((m) => m.locked).map((m) => m.name).join(', ') || 'закрытых нет');
await p.screenshot({ path: `${OUT}/ux-more.png` });

// каждый раздел действительно открывается
const opened = [];
for (const t of ['social', 'coop', 'shop', 'settings']) {
  await p.evaluate((tab) => window.__openTab(tab), t);
  await p.waitForTimeout(450);
  opened.push(await p.evaluate(() => document.querySelector('.win__head h2')?.textContent || '—'));
}
ok('каждый раздел открывается и подписан заголовком',
   opened.every((x) => x !== '—') && new Set(opened).size === opened.length, opened.join(' · '));
await p.evaluate(() => window.__game.screens.close(true));

// ── 3. Первые минуты игрок ведён за руку ─────────────────────────────────────

const tutor = await p.evaluate(async () => {
  const { S } = window.__game;
  const wait = () => new Promise((r) => setTimeout(r, 260));
  const текст = () => document.querySelector('.goal__t').textContent;
  const шаги = [];
  шаги.push(текст());
  S.stats.served = 1; S.counters.c1.cash = 200; await wait(); шаги.push(текст());
  S.carry = 40; await wait(); шаги.push(текст());
  S.carry = 0; S.cash = 900; S.stats.deposits = 1; await wait(); шаги.push(текст());
  S.counters.c2.open = true; await wait(); шаги.push(текст());
  S.counters.c1.clerk = 1; await wait();
  return { шаги, конец: S.tut };
});
ok('обучение ведёт по одному шагу за раз',
   new Set(tutor.шаги).size === tutor.шаги.length && tutor.шаги.length === 5,
   tutor.шаги.join(' → '));
ok('и заканчивается, когда всё показано', tutor.конец >= 5, `шаг ${tutor.конец}`);

// ── 4. Подсказка о том, что делать, только одна ──────────────────────────────

const hints = await p.evaluate(() => ({
  цель: document.querySelectorAll('#goal:not([hidden])').length,
  вМире: [...document.querySelectorAll('.wtag--hint')].filter((e) => !e.classList.contains('is-off')).length,
}));
ok('указание, что делать, на экране одно', hints.цель === 1 && hints.вМире === 0,
   `нижняя строка ${hints.цель}, в зале ${hints.вМире}`);

// ── 5. Новичку не показывают недостижимые ценники ────────────────────────────

const tags = await p.evaluate(() => {
  const { S, game } = window.__game;
  S.cash = 0;
  const pads = game.pads();
  const дорогих = pads.filter((x) => x.cost > 1e6).length;
  return { всего: pads.length, дорогих, цены: pads.map((x) => x.cost) };
});
ok('в зале предлагают только посильное', tags.дорогих === 0,
   `${tags.всего} предложений, самое дорогое ${Math.max(...tags.цены)}`);

// ── 6. Ничего не наезжает друг на друга ──────────────────────────────────────

const overlap = await p.evaluate(() => {
  const boxes = [];
  for (const sel of ['#goal', '.strip', '.hud-row', '#nav', '#carry']) {
    const e = document.querySelector(sel);
    if (!e || e.hidden) continue;
    const r = e.getBoundingClientRect();
    if (r.width) boxes.push({ sel, r });
  }
  const bad = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, c = boxes[j].r;
      if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) {
        bad.push(`${boxes[i].sel} × ${boxes[j].sel}`);
      }
    }
  }
  return bad;
});
ok('элементы интерфейса не наезжают друг на друга', overlap.length === 0, overlap.join(', '));

await p.screenshot({ path: `${OUT}/ux-start.png` });

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
