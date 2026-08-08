// Сквозной прокликивающий тест: открывает все экраны, жмёт все кнопки,
// проверяет ключевые игровые действия и ловит ошибки страницы.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const checks = [];
const ok = (name, cond, extra = '') => checks.push({ name, pass: !!cond, extra });

await p.goto(URL);
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.evaluate(() => { window.__game.S.tut = 99; window.__game.ui.renderTutorial(); });
await p.waitForTimeout(400);

// 1. Тап по сцене приносит деньги в стопку
const tapRes = await p.evaluate(async () => {
  const { S, engine } = window.__game;
  S.banks[0].floors[0].stack = 0;
  engine.tapFloor(0);
  return S.banks[0].floors[0].stack;
});
ok('тап по отделу кладёт деньги в стопку', tapRes > 0, `stack=${tapRes}`);

// 2. Конвейер доносит деньги до наличных
const pipe = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.cash = 0; S.stats.totalEarned = 0;
  const b = S.banks[0];
  b.floors[0].mgr = true; b.elev.mgr = true; b.vault.mgr = true;
  for (let i = 0; i < 60 / 0.05; i++) engine.step(0.05, 0);
  return S.cash;
});
ok('конвейер доносит деньги до кассы', pipe > 0, `+${pipe.toFixed(2)}`);

// 3. Апгрейды, открытие отделов, менеджеры
const up = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.cash = 1e12;
  const before = S.banks[0].floors[0].lvl;
  engine.upgradeFloor(0, 10);
  const afterUp = S.banks[0].floors[0].lvl;
  engine.unlockFloor(3);
  engine.hireFloorMgr(3);
  engine.upgradeElev(5); engine.upgradeVault(5);
  return { before, afterUp, f3: S.banks[0].floors[3].lvl, mgr3: S.banks[0].floors[3].mgr,
           elev: S.banks[0].elev.lvl, vault: S.banks[0].vault.lvl };
});
ok('апгрейд x10 работает', up.afterUp === up.before + 10, JSON.stringify(up));
ok('открытие отдела работает', up.f3 === 1);
ok('найм менеджера работает', up.mgr3 === true);
ok('лифт и хранилище качаются', up.elev >= 6 && up.vault >= 6);

// 4. MAX-апгрейд
const mx = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.cash = 1e9;
  const before = S.banks[0].floors[0].lvl;
  engine.upgradeFloor(0, 'max');
  return { gained: S.banks[0].floors[0].lvl - before, cashLeft: S.cash };
});
ok('MAX покупает много уровней', mx.gained > 20, `+${mx.gained}`);
ok('MAX не уводит баланс в минус', mx.cashLeft >= 0, `осталось ${mx.cashLeft}`);

// 5. Сундук
const chest = await p.evaluate(() => {
  const { S } = window.__game;
  S.gold = 5000;
  const loot = window.__game.screens ? null : null;
  return import('./js/meta.js').then((m) => {
    const l = m.openChest('gold');
    return { items: l ? l.length : 0, cards: Object.keys(S.sm.cards).length };
  });
});
ok('золотой сейф выдаёт лут', chest.items > 0, `предметов ${chest.items}`);
ok('карты кадров начисляются', chest.cards > 0, `карт ${chest.cards}`);

// 6. Бусты
const boost = await p.evaluate(() => import('./js/meta.js').then((m) => {
  const { S, engine } = window.__game;
  S.gold = 5000;
  const inc0 = engine.incomePerSec();
  m.activateBoost('income2x');
  engine.invalidateBonuses();
  return { inc0, inc1: engine.incomePerSec(), left: engine.boostLeft('income2x') };
}));
ok('буст ×2 удваивает доход', Math.abs(boost.inc1 / boost.inc0 - 2) < 0.01, `${boost.inc0} → ${boost.inc1}`);
ok('у буста есть таймер', boost.left > 0);

// 7. Открытие банка и переключение
const bank = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.cash = 1e30;
  const okUnlock = engine.unlockBank(1);
  const okSwitch = engine.switchBank(1);
  const inc = engine.incomePerSec(1);
  engine.switchBank(0);
  return { okUnlock, okSwitch, open: S.banks[1].open, inc };
});
ok('новый банк открывается', bank.okUnlock && bank.open);
ok('переключение между банками', bank.okSwitch);

// 8. Реновация
const ren = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.stats.runEarned = 1e14;
  const shares = engine.renovationShares();
  const can = engine.canRenovate();
  const got = engine.renovate();
  return { shares, can, got, cash: S.cash, lvl0: S.banks[0].floors[0].lvl,
           bank1open: S.banks[1].open, sharesTotal: S.shares };
});
ok('реновация даёт акции', ren.got > 0, `+${ren.got}`);
ok('реновация обнуляет прогресс', ren.cash === 0 && ren.lvl0 === 1 && !ren.bank1open);

// 9. Оффлайн-доход
const off = await p.evaluate(() => {
  const { S, engine } = window.__game;
  S.banks[0].floors[0].mgr = true; S.banks[0].elev.mgr = true; S.banks[0].vault.mgr = true;
  engine.upgradeFloor(0, 1);
  const p = engine.computeOffline(3600 * 5);
  return p;
});
ok('оффлайн-доход считается', off && off.amount > 0, off ? `+${off.amount.toFixed(0)} за ${off.seconds}с` : 'null');
ok('оффлайн ограничен потолком', off && off.capped === true);

// 10. Прокликиваем весь UI
const tabs = ['tasks', 'chests', 'staff', 'shop'];
for (const t of tabs) {
  await p.click(`.nav-btn[data-tab="${t}"]`);
  await p.waitForTimeout(350);
  const sheet = await p.$('.sheet');
  ok(`вкладка «${t}» открывается`, !!sheet);
  // жмём все внутренние табы
  const inner = await p.$$('.tabs button');
  for (let i = 0; i < inner.length; i++) {
    await inner[i].click();
    await p.waitForTimeout(180);
  }
  await p.click('.sheet .x');
  await p.waitForTimeout(200);
}

// шапка и инструменты
for (const sel of ['#bankChip', '#goldBtn', '#btnBoost', '#btnRenov', '#btnSettings']) {
  await p.click(sel);
  await p.waitForTimeout(320);
  const sheet = await p.$('.sheet');
  ok(`кнопка ${sel} открывает окно`, !!sheet);
  const x = await p.$('.sheet .x');
  if (x) await x.click();
  await p.waitForTimeout(180);
}

// множители апгрейда
for (const step of ['1', '10', '100', 'max']) {
  await p.click(`#steps button[data-step="${step}"]`);
  await p.waitForTimeout(120);
}
const stepOn = await p.$eval('#steps button.on', (e) => e.dataset.step);
ok('переключение множителя апгрейда', stepOn === 'max', stepOn);

// Улучшить всё
await p.evaluate(() => { window.__game.S.cash = 1e9; window.__game.ui.markDirty(); });
await p.waitForTimeout(250);
await p.click('#upAll');
await p.waitForTimeout(300);
const afterAll = await p.evaluate(() => window.__game.S.banks[0].floors[0].lvl);
ok('кнопка «Улучшить всё» работает', afterAll > 1, `ур. ${afterAll}`);

// тап по сцене
await p.mouse.click(240, 500);
await p.waitForTimeout(200);
await p.mouse.click(30, 600);
await p.waitForTimeout(200);
ok('тапы по сцене не роняют игру', true);

// сохранение/загрузка
const persist = await p.evaluate(async () => {
  const { S } = window.__game;
  const st = await import('./js/state.js');
  S.cash = 12345; S.gold = 777;
  st.save(true);
  const raw = st.loadLocal();
  return { cash: raw?.cash, gold: raw?.gold };
});
ok('сейв пишется в localStorage', persist.cash === 12345 && persist.gold === 777, JSON.stringify(persist));

await p.reload();
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.waitForTimeout(800);
const loaded = await p.evaluate(() => ({ gold: window.__game.S.gold }));
ok('сейв читается после перезагрузки', loaded.gold === 777, `gold=${loaded.gold}`);

console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
}
console.log(`\nпройдено ${checks.length - failed} из ${checks.length}`);
console.log('ошибки страницы:', errs.length ? errs : 'нет');
await b.close();
process.exit(failed || errs.length ? 1 : 0);
