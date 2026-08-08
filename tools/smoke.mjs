// Сквозная проверка игрового цикла: ходьба, обслуживание, инкассация,
// покупка на падах, найм, окна, сейв. Гоняется по собранной версии в docs/.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
// Браузер сам просит /favicon.ico; на Pages его нет — это не ошибка игры.
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text()); });
p.on('response', (r) => {
  if (r.status() >= 400 && !/favicon/i.test(r.url())) errs.push(`${r.status()} ${r.url()}`);
});

const checks = [];
const ok = (name, cond, extra = '') => checks.push({ name, pass: !!cond, extra });

await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(1200);

// сцена и герой
const scene0 = await p.evaluate(() => {
  const { actors, scene } = window.__game;
  return { hasPlayer: !!actors.player.view, spine: !!actors.player.view?.__isSpine,
           canvas: !!document.querySelector('#stage canvas') };
});
ok('сцена и герой созданы', scene0.hasPlayer && scene0.canvas);
ok('главный герой — Spine-скелет', scene0.spine);

// 1. Телепорт к стойке и обслуживание
const serve = await p.evaluate(async () => {
  const { S, actors, game } = window.__game;
  const c = window.__game.game.pads; // прогрев
  const def = { x: 6, y: 2, id: 'c1' };
  const spot = actors.clerkSpot(def);
  actors.player.x = spot.x; actors.player.y = spot.y;
  S.counters.c1.cash = 0;
  const before = S.stats.served;
  // ждём, пока придёт клиент и его обслужат
  for (let i = 0; i < 60 / 0.05; i++) {
    actors.tickCustomers(0.05, game.onServed);
    game.tick(0.05, null);
  }
  return { served: S.stats.served - before, cash: S.counters.c1.cash };
});
ok('клиенты приходят и обслуживаются', serve.served > 0, `обслужено ${serve.served}`);
ok('наличные копятся на стойке', serve.cash > 0, `на стойке ${serve.cash.toFixed(0)}`);

// 2. Игрок забирает наличные
const grab = await p.evaluate(() => {
  const { S, actors, game } = window.__game;
  const def = { x: 6, y: 2 };
  const sp = actors.pickSpot(def);
  actors.player.x = sp.x; actors.player.y = sp.y;
  S.carry = 0;
  for (let i = 0; i < 40; i++) game.tick(0.05, null);
  return { carry: S.carry, left: S.counters.c1.cash, cap: actors.bagCap() };
});
ok('игрок забирает наличные в сумку', grab.carry > 0, `в сумке ${grab.carry.toFixed(0)} из ${grab.cap}`);

// 3. Сдача в хранилище
const dep = await p.evaluate(() => {
  const { S, actors, game } = window.__game;
  const V = { x: 2.3, y: 3.5 };
  actors.player.x = V.x; actors.player.y = V.y;
  const before = S.cash;
  for (let i = 0; i < 60; i++) game.tick(0.05, null);
  return { gained: S.cash - before, carry: S.carry };
});
ok('выручка сдаётся в хранилище', dep.gained > 0, `+${dep.gained.toFixed(0)}`);
ok('сумка пустеет', dep.carry < 0.5);

// 4. Пад покупки: стоим — платим
const pad = await p.evaluate(() => {
  const { S, actors, game } = window.__game;
  S.cash = 1e6;
  const list = game.pads();
  const buy = list.find((x) => x.kind === 'counter');
  actors.player.x = buy.x + buy.w / 2; actors.player.y = buy.y + buy.h / 2;
  for (let i = 0; i < 120; i++) game.tick(0.05, { toast() {} });
  return { id: buy.ref.id, open: S.counters[buy.ref.id].open };
});
ok('стойка покупается стоянием на паде', pad.open, pad.id);

// 5. Пад апгрейда
const upg = await p.evaluate(() => {
  const { S, actors, game } = window.__game;
  S.cash = 1e6;
  const before = S.ups.bag;
  const list = game.pads();
  const u = list.find((x) => x.kind === 'up');
  actors.player.x = u.x + u.w / 2; actors.player.y = u.y + u.h / 2;
  for (let i = 0; i < 120; i++) game.tick(0.05, { toast() {} });
  return { gained: (S.ups[u.up] || 0) - (u.up === 'bag' ? before : 0), key: u.up, lvl: S.ups[u.up] };
});
ok('апгрейд покупается на паде', upg.lvl > 0, `${upg.key} ур. ${upg.lvl}`);

// 6. Найм кассира и инкассатора
const hire = await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  S.cash = 1e9;
  const c = window.__game.game;
  const defs = window.__game.actors;
  const c1 = { id: 'c1' };
  const okClerk = c.hireClerk(window.__game.actors.counterDef('c1'));
  const okRunner = c.hireRunner();
  return { okClerk, okRunner, clerk: S.counters.c1.clerk, runner: S.runner,
           clerkActor: actors.clerks.size, runnerActive: actors.runner.active };
});
ok('кассир нанимается и появляется в зале', hire.okClerk && hire.clerkActor > 0);
ok('инкассатор нанимается', hire.okRunner && hire.runnerActive);

// 7. Инкассатор сам носит выручку
const auto = await p.evaluate(() => {
  const { S, actors, game } = window.__game;
  actors.player.x = 10; actors.player.y = 11;   // игрок в стороне
  S.counters.c1.cash = 0;
  S.cash = 0;
  for (let i = 0; i < 120 / 0.05; i++) {
    actors.tickCustomers(0.05, game.onServed);
    actors.tickRunner(0.05, game.takeFromSource, game.deposit);
    game.tick(0.05, null);
  }
  return { cash: S.cash, income: game.autoIncome() };
});
ok('инкассатор носит выручку без игрока', auto.cash > 0, `+${auto.cash.toFixed(0)}`);
ok('считается автодоход', auto.income > 0, `${auto.income.toFixed(1)}/сек`);

// 8. Оффлайн
const off = await p.evaluate(() => window.__game.game.computeOffline(3600 * 8));
ok('оффлайн-доход считается', off && off.amount > 0, off ? `+${off.amount.toFixed(0)}` : 'null');
ok('оффлайн ограничен потолком', off && off.capped === true);

// 9. Джойстик реально двигает героя
const walk = await p.evaluate(async () => {
  const { actors, ui } = window.__game;
  actors.player.x = 10; actors.player.y = 10;
  const x0 = actors.player.x, y0 = actors.player.y;
  for (let i = 0; i < 30; i++) actors.movePlayer(1, 0, 0.05);
  return { moved: Math.hypot(actors.player.x - x0, actors.player.y - y0) };
});
ok('герой ходит', walk.moved > 1, `прошёл ${walk.moved.toFixed(1)} тайла`);

const drag = await p.evaluate(() => {
  const { actors } = window.__game;
  actors.player.x = 10; actors.player.y = 10;
  return { x: actors.player.x, y: actors.player.y };
});
await p.mouse.move(195, 560);
await p.mouse.down();
await p.mouse.move(255, 620, { steps: 6 });
await p.waitForTimeout(700);
await p.mouse.up();
const after = await p.evaluate(() => ({ x: window.__game.actors.player.x, y: window.__game.actors.player.y }));
ok('джойстик по экрану ведёт героя', Math.hypot(after.x - drag.x, after.y - drag.y) > 0.4,
   `сдвиг ${Math.hypot(after.x - drag.x, after.y - drag.y).toFixed(2)}`);

// 9б. Разворот героя по направлению движения
const face = await p.evaluate(() => {
  const { actors } = window.__game;
  const read = () => actors.player.view.__body.scale.x;
  actors.player.x = 9; actors.player.y = 9; actors.player.vx = 0; actors.player.vy = 0;
  // вправо по экрану = +x, -y в мире
  for (let i = 0; i < 25; i++) actors.movePlayer(0.7, -0.7, 0.05);
  const right = read();
  actors.player.vx = 0; actors.player.vy = 0;
  for (let i = 0; i < 25; i++) actors.movePlayer(-0.7, 0.7, 0.05);
  const left = read();
  return { right, left };
});
// скелет нарисован смотрящим влево: взгляд вправо = отрицательный масштаб
ok('идём вправо — герой смотрит вправо', face.right < 0, `scaleX ${face.right.toFixed(3)}`);
ok('идём влево — герой смотрит влево', face.left > 0, `scaleX ${face.left.toFixed(3)}`);

// 10. Окна
for (const tab of ['tasks', 'staff', 'safes', 'shop']) {
  await p.click(`.nav-btn[data-tab="${tab}"]`);
  await p.waitForTimeout(400);
  const okWin = await p.$('.win.is-open');
  ok(`окно «${tab}» открывается`, !!okWin);
  const tabs = await p.$$('.win__tab');
  for (const t of tabs) { await t.click(); await p.waitForTimeout(200); }
  await p.click('.win__close');
  await p.waitForTimeout(250);
}
const closed = await p.$('.win.is-open');
ok('окно закрывается', !closed);

// 11. Сейв
await p.evaluate(() => { const s = window.__game; s.S.gold = 777; localStorage.setItem('idlebank2', JSON.stringify(s.S)); });
await p.reload();
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(1200);
const loaded = await p.evaluate(() => ({ gold: window.__game.S.gold, c1: window.__game.S.counters.c1.open }));
ok('сейв читается после перезагрузки', loaded.gold === 777, `gold=${loaded.gold}`);

console.log('');
let failed = 0;
for (const c of checks) { if (!c.pass) failed++; console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.extra ? '  — ' + c.extra : ''}`); }
console.log(`\nпройдено ${checks.length - failed} из ${checks.length}`);
console.log('ошибки страницы:', errs.length ? errs : 'нет');
await b.close();
process.exit(failed || errs.length ? 1 : 0);
