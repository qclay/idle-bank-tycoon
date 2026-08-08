// Скриншоты всех экранов в headless-Chromium (Chrome пользователя не трогаем).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(1500);
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });

await shot('01-start');

// разгоняем банк: всё открыто, персонал нанят, клиенты в зале
await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  S.cash = 5e7; S.gold = 900; S.level = 12;
  for (const id of ['c1', 'c2', 'c3', 'c4']) { S.counters[id].open = true; S.counters[id].lvl = 8; }
  S.atms.a1.open = true;
  S.ups.bag = 8; S.ups.boots = 5; S.ups.vault = 4;
  S.counters.c1.clerk = 3; S.counters.c2.clerk = 2; S.counters.c3.clerk = 1;
  S.runner = 2;
  S.stats.opened = 6; S.stats.hires = 4;
  actors.refreshSolids(); actors.syncStaff();
  window.dispatchEvent(new Event('resize'));
});
await p.evaluate(() => window.__game.S).catch(() => {});
await p.reload();
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(400);
await p.evaluate(() => { window.__game.actors.player.x = 9; window.__game.actors.player.y = 4.6; });
await p.waitForTimeout(4000);
await shot('02-hall');

// вид у стоек
await p.evaluate(() => { window.__game.actors.player.x = 11; window.__game.actors.player.y = 3.2; });
await p.waitForTimeout(2500);
await shot('03-counters');

// сумка полная — идём к хранилищу
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.carry = actors.bagCap() * 0.8;
  actors.player.x = 3.4; actors.player.y = 4.4;
});
await p.waitForTimeout(1500);
await shot('04-vault');

for (const [name, tab] of [['05-tasks', 'tasks'], ['06-staff', 'staff'], ['07-safes', 'safes'], ['08-shop', 'shop']]) {
  await p.click(`.nav-btn[data-tab="${tab}"]`);
  await p.waitForTimeout(500);
  await shot(name);
  const tabs = await p.$$('.win__tab');
  if (tabs[1]) { await tabs[1].click(); await p.waitForTimeout(400); await shot(name + 'b'); }
  await p.click('.win__close');
  await p.waitForTimeout(300);
}

console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
