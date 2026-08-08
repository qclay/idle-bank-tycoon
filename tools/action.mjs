// Кадры в движении: сбор наличных, сдача в хранилище, покупка на площадке.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(1000);

// разгоняем банк
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.cash = 4e6; S.gold = 500; S.level = 9;
  for (const id of ['c1', 'c2', 'c3']) { S.counters[id].open = true; S.counters[id].lvl = 7; }
  S.counters.c1.clerk = 2; S.counters.c2.clerk = 1;
  S.atms.a1.open = true;
  S.ups.bag = 6; S.ups.boots = 4; S.ups.vault = 3;
  actors.refreshSolids(); actors.syncStaff();
});
await p.reload();
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(600);

const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
const goto = async (x, y, ms = 2200) => {
  await p.evaluate(([tx, ty]) => { window.__drive = { x: tx, y: ty }; }, [x, y]);
  await p.waitForTimeout(ms);
};

// маленький автопилот прямо в странице: ведём героя джойстиком
await p.evaluate(() => {
  const { actors } = window.__game;
  window.__drive = null;
  const step = () => {
    if (window.__drive) {
      const dx = window.__drive.x - actors.player.x;
      const dy = window.__drive.y - actors.player.y;
      const d = Math.hypot(dx, dy);
      window.__game.ui.joy.dx = d > 0.15 ? dx / d : 0;
      window.__game.ui.joy.dy = d > 0.15 ? dy / d : 0;
    }
    requestAnimationFrame(step);
  };
  step();
});

// 1. Копим наличные у стойки и забираем
await p.evaluate(() => { window.__game.S.counters.c1.cash = window.__game.game.trayCap(
  window.__game.actors.counterDef('c1')) * 0.9; });
await goto(7, 3.0, 2600);
await shot('a1-pickup');

// 2. Несём в хранилище
await goto(2.3, 3.6, 3400);
await shot('a2-deposit');

// 3. Встаём на площадку покупки
await p.evaluate(() => { window.__game.S.cash = 4e6; });
const pad = await p.evaluate(() => {
  const p0 = window.__game.game.pads().find((x) => x.kind === 'counter');
  return p0 ? [p0.x + p0.w / 2, p0.y + p0.h / 2] : null;
});
if (pad) { await goto(pad[0], pad[1], 1400); await shot('a3-pad'); await p.waitForTimeout(1400); await shot('a4-built'); }

// 4. Общий вид зала в работе
await goto(9, 5.2, 2600);
await shot('a5-hall');

console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
