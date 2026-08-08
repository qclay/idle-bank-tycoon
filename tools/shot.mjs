// Скриншоты игры в headless-Chromium (Chrome пользователя не трогаем).
// node tools/shot.mjs            — снимает весь набор экранов
// node tools/shot.mjs start      — только стартовый экран
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const only = process.argv[2] || '';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await p.goto(URL);
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.waitForTimeout(1200);

const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); };

if (only === 'start' || !only) await shot('01-start');

// Проходим туториал
await p.evaluate(() => { window.__game.S.tut = 99; window.__game.ui.renderTutorial(); });

if (!only) {
  await p.waitForTimeout(300);
  await shot('02-fresh');

  // Разгоняем прогресс: деньги, отделы, менеджеры
  await p.evaluate(() => {
    const { S, engine, scene } = window.__game;
    S.cash = 5e9; S.gold = 900;
    for (let i = 0; i < 6; i++) { engine.unlockFloor(i); engine.upgradeFloor(i, 30); engine.hireFloorMgr(i); }
    engine.upgradeElev(120); engine.hireElevMgr();
    engine.upgradeVault(120); engine.hireVaultMgr();
    S.cash = 5e7;
    scene.clampCam();
  });
  await p.waitForTimeout(2500);
  await shot('03-played');

  // Прокрутка вверх по зданию
  await p.evaluate(() => { window.__game.scene.scrollToFloor(3, true); });
  await p.waitForTimeout(900);
  await shot('04-floors');

  const screens = [
    ['05-tasks', 'tasks'], ['06-chests', 'chests'], ['07-staff', 'staff'],
    ['08-shop', 'shop'], ['09-banks', 'banks'], ['10-renov', 'renovation'],
    ['11-settings', 'settings'],
  ];
  for (const [name, fn] of screens) {
    await p.evaluate((f) => { window.__screens[f](); }, fn);
    await p.waitForTimeout(450);
    await shot(name);
    await p.evaluate(() => window.__game.ui.closeModal());
    await p.waitForTimeout(200);
  }

  // Открытие сейфа
  await p.evaluate(() => {
    const loot = window.__game.screens && window.__game.S;
    window.__screens.chests();
  });
  await p.waitForTimeout(400);
  await shot('12-chest-tab');
}

console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
