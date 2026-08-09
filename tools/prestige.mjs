// Сеть магазинов: клапан жанра. Проверяем и математику, и то, что игрок
// понимает, на что меняет прогресс.
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
await p.waitForTimeout(700);

// ── 1. Пока бизнес мал, нового района нет ────────────────────────────────────

const early = await p.evaluate(() => {
  const { game } = window.__game;
  return { ready: game.prestigeReady(), кнопка: !document.getElementById('netPill').hidden };
});
ok('в начале игры сеть не предлагают', !early.ready && !early.кнопка);

await p.evaluate(() => window.__openTab('network'));
await p.waitForTimeout(500);
const gate = await p.evaluate(() => [...document.querySelectorAll('.note')].map((e) => e.textContent).join(' | '));
ok('но объясняют, при каких условиях откроется', /Новый район|позже/.test(gate), gate);
await p.evaluate(() => window.__game.screens.close(true));

// ── 2. Дорос — появляется кнопка и превью ────────────────────────────────────

await p.evaluate(() => {
  const { S, actors } = window.__game;
  for (const [i, id] of ['c1', 'c2', 'c3', 'c4'].entries()) { S.counters[id].open = true; S.counters[id].lvl = 8 + i; }
  S.level = 16; S.cash = 5e8;
  S.stats.lifetime = 4e10;
  actors.refreshSolids(); actors.syncStaff();
});
await p.waitForTimeout(400);
const ready = await p.evaluate(() => {
  const { game } = window.__game;
  return {
    ready: game.prestigeReady(), gain: game.prestigeGain(),
    кнопка: !document.getElementById('netPill').hidden,
    множитель: document.getElementById('netV').textContent,
  };
});
ok('когда бизнес дорос, сеть появляется в шапке', ready.ready && ready.кнопка);
ok('доли за оборот начисляются', ready.gain > 0, `${ready.gain} долей за оборот 4e10`);

await p.evaluate(() => window.__openTab('network'));
await p.waitForTimeout(600);
const preview = await p.evaluate(() => ({
  строки: [...document.querySelectorAll('.netgain__row')].map((e) => e.textContent.trim()),
  кнопка: document.querySelector('.btn--wide .btn__t')?.textContent || '',
}));
ok('превью показывает, что игрок получит',
   preview.строки.length === 3 && preview.строки.some((s) => /Доход станет/.test(s)),
   preview.строки.join(' | '));
ok('видно, сколько осталось до удвоения долей',
   preview.строки.some((s) => /До удвоения/.test(s)), preview.строки[2] || '');
await p.screenshot({ path: `${OUT}/prestige.png` });

// ── 3. Передача магазина ─────────────────────────────────────────────────────

const before = await p.evaluate(() => {
  const { S } = window.__game;
  return { gold: S.gold, rep: S.rep, отзывы: (S.reviews || []).length,
           стоек: Object.values(S.counters).filter((c) => c.open).length,
           уровень: S.level, кэш: S.cash };
});
await p.evaluate(() => document.querySelector('.btn--wide').click());
await p.waitForTimeout(500);
await p.evaluate(() => [...document.querySelectorAll('.btn--wide')]
  .find((b2) => b2.textContent.includes('Открыть новый')).click());
await p.waitForTimeout(800);

const after = await p.evaluate(() => {
  const { S, game } = window.__game;
  return { gold: S.gold, rep: S.rep, отзывы: (S.reviews || []).length,
           стоек: Object.values(S.counters).filter((c) => c.open).length,
           уровень: S.level, кэш: S.cash, доли: S.prestige.points,
           множитель: +game.prestigeMult().toFixed(2), район: game.prestigeName(),
           круг: S.prestige.runs, ups: Object.values(S.ups).reduce((a, b2) => a + b2, 0) };
});
ok('доли начислены', after.доли >= ready.gain, `${after.доли} долей`);
ok('доход навсегда вырос', after.множитель > 1, `×${after.множитель}`);
ok('витрины, улучшения и уровень начались заново',
   after.стоек === 1 && after.уровень === 1 && after.кэш === 0 && after.ups === 0,
   `стоек ${after.стоек}, уровень ${after.уровень}, улучшений ${after.ups}`);
ok('кристаллы, репутация и отзывы переехали',
   after.gold === before.gold && after.rep === before.rep && after.отзывы === before.отзывы,
   `кристаллы ${before.gold}→${after.gold}, рейтинг ${before.rep}→${after.rep}`);
ok('магазин теперь в новом районе', after.круг === 1 && after.район !== 'Первый магазин', after.район);

// ── 4. Множитель действительно поднимает доход ───────────────────────────────

const income = await p.evaluate(() => {
  const { S, game } = window.__game;
  const B = window.__balance;
  const c = B.COUNTERS[0];
  const было = S.prestige.points;
  const сМножителем = game.counterPay(c);
  S.prestige.points = 0;
  const без = game.counterPay(c);
  S.prestige.points = было;
  return { без, сМножителем, доли: было };
});
ok('доли реально умножают чек клиента', income.сМножителем > income.без * 1.05,
   `${income.без.toFixed(0)} → ${income.сМножителем.toFixed(0)} за клиента`);

// ── 5. Второй круг требует кратно большего оборота ───────────────────────────

const cycle = await p.evaluate(() => {
  const { S, game } = window.__game;
  S.stats.lifetime = 4e10;
  const сразу = game.prestigeGain();
  S.stats.lifetime = 1.6e11;         // вчетверо больше
  const вчетверо = game.prestigeGain();
  return { сразу, вчетверо, доли: S.prestige.points };
});
ok('сразу после круга новых долей почти нет', cycle.сразу === 0, `${cycle.сразу} долей`);
ok('вчетверо больший оборот удваивает долю',
   cycle.вчетверо >= cycle.доли * 0.8 && cycle.вчетверо <= cycle.доли * 1.4,
   `было ${cycle.доли}, при вчетверо большем обороте дадут ещё ${cycle.вчетверо}`);

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
