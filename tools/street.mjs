// Кадры улицы и зон: ставим героя к выходу и к восточной стене.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('[err]', e.message));
await p.goto(process.env.SHOT_URL || 'http://localhost:8199/index.html');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.cash = 5e8; S.gold = 900;
  for (const id of ['c1','c2','c3','c4','c5','c6']) { S.counters[id].open = true; S.counters[id].lvl = 10; S.counters[id].clerk = 2; }
  for (const a of ['a1','a2','a3','a4']) S.atms[a].open = true;
  for (const z of Object.keys(S.zones)) { S.zones[z].open = true; S.zones[z].lvl = 3; }
  S.runner = 3;
  actors.refreshSolids(); actors.syncStaff();
});
await p.reload();
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(2500);
const at = async (x, y, n, ms = 2200) => {
  await p.evaluate(([a,c]) => { window.__game.actors.player.x = a; window.__game.actors.player.y = c; }, [x,y]);
  await p.waitForTimeout(ms);
  await p.screenshot({ path: `${OUT}/${n}.png` });
};
await at(21, 14, 's1-exit');
await at(21.5, 7, 's2-zones');
await at(12, 14.4, 's3-street');
await at(3, 6, 's4-west');
console.log('готово');
await b.close();
