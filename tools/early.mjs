// Первые минуты игры. Здесь легче всего ошибиться: в жанре начало тихое —
// один человек раз в несколько секунд, — а разгон приходит вместе с делом.
// Раньше эта часть не проверялась вовсе, и клиент приходил каждые 1.8 секунды
// с первой же секунды: очередь мгновенно забивалась и стояла полной.
import { chromium } from 'playwright';

const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => { window.__game.S.tut = 99; });

// ── Как часто приходят люди на старте ────────────────────────────────────────

const start = await p.evaluate(() => {
  const { actors, S } = window.__game;
  return { интервал: +actors.spawnRate().toFixed(2), стоек: 1,
           чек: +window.__game.game.counterPay(window.__balance.COUNTERS[0]).toFixed(0),
           void: S };
});
ok('в начале игры человек приходит раз в несколько секунд',
   start.интервал >= 5 && start.интервал <= 12, `${start.интервал} с между приходами`);

// ── Зал не забивается ────────────────────────────────────────────────────────

const hall = await p.evaluate(() => new Promise((res) => {
  const { actors } = window.__game;
  const пики = [];
  const t0 = performance.now();
  const iv = setInterval(() => {
    пики.push(actors.customers.filter((k) => k.state === 'wait' || k.state === 'walk').length);
    if (performance.now() - t0 > 45000) {
      clearInterval(iv);
      res({ макс: Math.max(...пики), средне: +(пики.reduce((a, b2) => a + b2, 0) / пики.length).toFixed(1) });
    }
  }, 500);
}));
ok('в зале одновременно не толпа, а один-два человека',
   hall.средне <= 2.6, `в среднем ${hall.средне}, самое большее ${hall.макс}`);

// ── Поток разгоняется вместе с делом ─────────────────────────────────────────

const growth = await p.evaluate(() => {
  const { S, actors } = window.__game;
  const начало = actors.spawnRate();
  for (const c of Object.values(S.counters)) { c.open = true; c.lvl = 20; }
  S.zones.z_coffee.open = true; S.zones.z_coffee.lvl = 10;
  S.smm.lvl = 5;
  const конец = actors.spawnRate();
  for (const [i, id] of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].entries()) {
    S.counters[id].open = i === 0; S.counters[id].lvl = 1;
  }
  S.zones.z_coffee.open = false; S.smm.lvl = 0;
  return { начало: +начало.toFixed(2), конец: +конец.toFixed(2) };
});
ok('к концу игры поток вырастает в разы, а не в проценты',
   growth.начало / growth.конец >= 4,
   `${growth.начало} с в начале против ${growth.конец} с в конце — в ${(growth.начало / growth.конец).toFixed(1)} раза чаще`);

// ── Первый шаг делается быстро ───────────────────────────────────────────────

const first = await p.evaluate(() => {
  const { actors, game } = window.__game;
  const B = window.__balance;
  const вМинуту = 60 / actors.spawnRate();
  const доход = вМинуту * game.counterPay(B.COUNTERS[0]);
  return {
    вМинуту: +вМинуту.toFixed(1), доход: Math.round(доход),
    тележка: +(B.UPGRADES.bag.cost / доход).toFixed(1),
    витрина: +(B.COUNTERS[1].cost / доход).toFixed(1),
    оператор: +(B.STAFF.clerk.cost / доход).toFixed(1),
  };
});
console.log(`\nна старте: ${first.вМинуту} клиентов в минуту, ${first.доход} в минуту дохода`);
console.log(` первая тележка через ~${first.тележка} мин, вторая витрина ~${first.витрина} мин,`
  + ` первый оператор ~${first.оператор} мин`);
ok('первая покупка по карману в первые минуты', first.тележка <= 2.5, `${first.тележка} мин`);
ok('вторая витрина открывается в первые минуты', first.витрина <= 8, `${first.витрина} мин`);
ok('автоматизация приходит в первые десять минут', first.оператор <= 12, `${first.оператор} мин`);

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 4).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
