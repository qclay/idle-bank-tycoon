// Куда идти сейчас: подсказка должна быть ровно одна, выбирать самое важное и
// честно молчать, когда дел нет. Плюс камера не должна дёргать масштабом.
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
await p.waitForTimeout(900);

// ── Камера ───────────────────────────────────────────────────────────────────

const cam = await p.evaluate(async () => {
  const { actors, scene, nav } = window.__game;
  const out = [];
  for (const [x, y] of [[12, 11], [12, 3], [2, 2], [2, 10], [22, 7], [26, 7]]) {
    actors.player.x = x; actors.player.y = y;
    await new Promise((s) => setTimeout(s, 500));
    out.push({ комната: nav.roomAt(x, y)?.name, k: +scene.cam.scale.toFixed(3) });
  }
  return out;
});
const scales = new Set(cam.map((r) => r.k));
ok('камера не меняет масштаб между комнатами', scales.size === 1,
   [...scales].join(', ') + ` на ${cam.length} помещениях`);

// ── Подсказка одна и по делу ─────────────────────────────────────────────────

const setup = (fn) => p.evaluate(fn);
const goalNow = () => p.evaluate(() => new Promise((res) => setTimeout(() => {
  const e = document.getElementById('goal');
  res({ text: e.querySelector('.goal__t').textContent, hidden: e.hidden,
        hot: e.classList.contains('is-hot'), calm: e.classList.contains('is-calm'),
        сколько: document.querySelectorAll('#goal').length,
        kind: window.__game.game.nextGoal()?.kind || null });
}, 400)));

await setup(() => {
  const { S, actors } = window.__game;
  S.counters.c1.open = true; S.counters.c1.clerk = 1; S.cash = 0; S.carry = 0;
  for (const c of Object.values(S.counters)) c.cash = 0;
  actors.player.x = 12; actors.player.y = 11;
  actors.refreshSolids(); actors.syncStaff();
});

// 1. полная тележка важнее всего
let g = await setup(() => {
  const { S, actors } = window.__game;
  S.carry = actors.bagCap();
  S.counters.c1.cash = window.__game.game.trayCap(window.__balance.COUNTERS[0]);
}) || await goalNow();
g = await goalNow();
ok('с полной тележкой зовут в кассу', g.kind === 'vault' && /кассу|выручку/i.test(g.text), g.text);
ok('срочное дело подсвечено', g.hot);

// 2. недовольный клиент важнее лотка
await setup(() => {
  const { S, actors } = window.__game;
  S.carry = 0;
  const k = actors.customers[0];
  if (k) { k.state = 'upset'; k.mood = 'upset'; k.t = 0; k.spot = { x: k.x, y: k.y };
           k.incident = { id: 'wrong', text: 'Выдали не тот заказ', blame: 'staff' }; }
});
g = await goalNow();
ok('недовольный клиент важнее полного лотка', g.kind === 'upset', `${g.kind}: ${g.text}`);

// 3. лоток, когда больше ничего не горит
await setup(() => {
  const { S, actors } = window.__game;
  for (const k of actors.customers) { k.state = 'leave'; k.mood = null; }
  S.carry = 0;
  S.counters.c1.cash = window.__game.game.trayCap(window.__balance.COUNTERS[0]);
});
g = await goalNow();
ok('иначе зовут к самому полному лотку', g.kind === 'pick', `${g.kind}: ${g.text}`);

// 4. тишина — так и говорим
await setup(() => {
  const { S, actors } = window.__game;
  S.carry = 0; S.cash = 0;
  for (const c of Object.values(S.counters)) c.cash = 0;
  for (const a of Object.values(S.atms)) a.cash = 0;
  for (const k of actors.customers) { k.state = 'leave'; k.mood = null; }
  for (const a of actors.clerkList()) { a.job = 'desk'; a.t = 90; }
});
await p.waitForTimeout(1600);
g = await goalNow();
ok('когда дел нет, игра говорит об этом прямо', g.calm && /под контролем/i.test(g.text), g.text);

// 5. подсказка всегда одна
ok('подсказка на экране ровно одна', g.сколько === 1, `${g.сколько} штук`);
await p.screenshot({ path: `${OUT}/goal.png` });

// ── Сброс прогресса ──────────────────────────────────────────────────────────

await p.evaluate(() => {
  const { S } = window.__game;
  S.cash = 5e6; S.gold = 90; S.level = 12;
  S.counters.c2.open = true; S.counters.c3.open = true;
  S.prestige.points = 40; S.stats.lifetime = 1e9;
});
await p.evaluate(() => window.__openTab('settings'));
await p.waitForTimeout(600);
const danger = await p.evaluate(() => !!document.querySelector('.setrow--danger'));
ok('в настройках есть кнопка «Начать заново»', danger);

await p.evaluate(() => document.querySelector('.setrow--danger').click());
await p.waitForTimeout(500);
const asked = await p.evaluate(() => ({
  title: document.querySelector('.win__head h2')?.textContent || '',
  acts: [...document.querySelectorAll('.win .btn .btn__t')].map((e) => e.textContent),
}));
ok('перед сбросом спрашивают ещё раз', /Начать заново/.test(asked.title) && asked.acts.length === 2,
   asked.acts.join(' / '));

await p.evaluate(() => [...document.querySelectorAll('.win .btn')]
  .find((x) => x.textContent.includes('стереть')).click());
await p.waitForTimeout(1200);
const fresh = await p.evaluate(() => {
  const { S } = window.__game;
  return { cash: S.cash, gold: S.gold, level: S.level, доли: S.prestige?.points || 0,
           стоек: Object.values(S.counters).filter((c) => c.open).length,
           оборот: S.stats.lifetime || 0 };
});
ok('прогресс действительно обнулён',
   fresh.cash === 0 && fresh.level === 1 && fresh.доли === 0 && fresh.стоек === 1 && fresh.оборот === 0,
   JSON.stringify(fresh));

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
