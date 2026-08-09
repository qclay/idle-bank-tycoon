// Жизнь сотрудников: походы на склад, темнота и проверка на месте.
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
await p.waitForTimeout(800);

// Открываем стойку с оператором и отправляем его за товаром прямо сейчас.
const setup = async (slack) => p.evaluate((sl) => {
  const { S, actors } = window.__game;
  S.counters.c1.open = true; S.counters.c1.clerk = 1; S.counters.c1.morale = 1;
  actors.refreshSolids(); actors.syncStaff();
  const a = actors.clerkList().find((x) => x.id === 'c1');
  a.job = 'desk'; a.t = 0.05; a.path = null;
  window.__forceSlack = sl;
  return !!a;
}, slack);

// подменяем случайность: тест не должен зависеть от броска монеты
await p.evaluate(() => {
  const { actors } = window.__game;
  const orig = Math.random;
  window.__rnd = orig;
  Math.random = () => (window.__forceSlack == null ? orig() : (window.__forceSlack ? 0.01 : 0.99));
  void actors;
});

// ── 1. Оператор уходит на склад и стойка встаёт ──────────────────────────────

await setup(false);
const gone = await p.evaluate(() => new Promise((res) => {
  const { actors, S } = window.__game;
  const B = window.__balance;
  const t0 = setInterval(() => {
    const a = actors.clerkList().find((x) => x.id === 'c1');
    if (a.job === 'search') {
      clearInterval(t0);
      const room = window.__game.nav.roomAt(a.x, a.y);
      res({ job: a.job, room: room?.id, away: actors.clerkAway('c1'), slack: a.slack,
            spots: B.STOCK_SPOTS.map((s) => `${s.x},${s.y}`) });
    }
  }, 120);
  setTimeout(() => { clearInterval(t0); res(null); }, 25000);
  void S;
}));
ok('оператор сам уходит на склад', gone && gone.room === 'stock', gone ? `дошёл до склада, ищет` : 'не дошёл');
ok('пока его нет, стойка считается пустой', gone?.away === true);

const serveOff = await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  S.counters.c1.cash = 0;
  actors.player.x = 12; actors.player.y = 11;      // игрок далеко
  const before = S.counters.c1.cash;
  for (let i = 0; i < 240; i++) game.tick(1 / 60, null);
  return S.counters.c1.cash - before;
});
ok('без оператора выручка не капает', serveOff < 1, `накапало ${Math.round(serveOff)}`);

// ── 2. Снаружи не видно, чем он занят ────────────────────────────────────────

const dark = await p.evaluate(() => new Promise((res) => {
  const { actors, scene } = window.__game;
  actors.player.x = 12; actors.player.y = 11;
  setTimeout(() => {
    const a = actors.clerkList().find((x) => x.id === 'c1');
    res({ seen: actors.clerkSeen(a), bubbles: document.querySelectorAll('.bub--work,.bub--slack').length,
          dark: scene.darkAlpha() });
  }, 900);
}));
ok('со стороны склад тёмный', dark.dark > 0.6, `затемнение ${dark.dark.toFixed(2)}`);
ok('издалека не видно, чем занят оператор', !dark.seen && dark.bubbles === 0,
   `значков ${dark.bubbles}`);
await p.screenshot({ path: `${OUT}/stock-dark.png` });

// ── 3. Зашёл — свет включился, занятие видно ─────────────────────────────────

const inside = await p.evaluate(() => new Promise((res) => {
  const { actors, scene } = window.__game;
  const a = actors.clerkList().find((x) => x.id === 'c1');
  actors.player.x = a.x + 0.9; actors.player.y = a.y + 0.9;
  setTimeout(() => res({ seen: actors.clerkSeen(a), dark: scene.darkAlpha(),
                         work: document.querySelectorAll('.bub--work').length,
                         slack: document.querySelectorAll('.bub--slack').length }), 900);
}));
ok('внутри склада включается свет', inside.dark < 0.15, `затемнение ${inside.dark.toFixed(2)}`);
ok('видно, что оператор действительно ищет', inside.work === 1 && inside.slack === 0,
   `ищет ${inside.work}, залип ${inside.slack}`);
await p.screenshot({ path: `${OUT}/stock-light.png` });

// ── 4. Помощь ускоряет поиск и радует оператора ──────────────────────────────

const helped = await p.evaluate(() => {
  const { actors, S } = window.__game;
  const a = actors.clerkList().find((x) => x.id === 'c1');
  a.t = 40;
  const m0 = S.counters.c1.morale;
  actors.helpClerk(a);
  return { t: a.t, m0, m1: S.counters.c1.morale };
});
ok('помощь резко сокращает поиск', helped.t <= 2.5, `осталось ${helped.t.toFixed(1)} с`);
ok('и поднимает настроение оператора', helped.m1 > helped.m0,
   `${helped.m0.toFixed(2)} → ${helped.m1.toFixed(2)}`);

// ── 5. Залипший ищет дольше, его можно оштрафовать ───────────────────────────

await p.evaluate(() => { const a = window.__game.actors.clerkList().find((x) => x.id === 'c1'); a.job = 'desk'; a.t = 0.05; });
await setup(true);
const slack = await p.evaluate(() => new Promise((res) => {
  const { actors } = window.__game;
  const B = window.__balance;
  const t0 = setInterval(() => {
    const a = actors.clerkList().find((x) => x.id === 'c1');
    if (a.job === 'search') {
      clearInterval(t0);
      actors.player.x = a.x + 0.9; actors.player.y = a.y + 0.9;
      setTimeout(() => res({ slack: a.slack, t: a.t, norm: B.ERRAND.search,
                             bub: document.querySelectorAll('.bub--slack').length }), 900);
    }
  }, 120);
  setTimeout(() => { clearInterval(t0); res(null); }, 25000);
}));
ok('залипший ищет заметно дольше', slack && slack.slack && slack.t > slack.norm * 1.5,
   slack ? `${Math.round(slack.t)} с против обычных ${slack.norm}` : 'не дождались');
ok('над ним висит телефон, а не коробка', slack?.bub === 1, `значков ${slack?.bub}`);

await p.click('.bub--slack');
await p.waitForTimeout(600);
const dialog = await p.evaluate(() => ({
  title: document.querySelector('.win__head h2')?.textContent || '',
  acts: [...document.querySelectorAll('.win .btn .btn__t')].map((e) => e.textContent),
}));
ok('нажатие открывает разговор', /телефоном/.test(dialog.title), dialog.title);
ok('штраф предлагается только залипшему', dialog.acts.includes('Штраф'), dialog.acts.join(', '));
await p.screenshot({ path: `${OUT}/stock-talk.png` });

const fined = await p.evaluate(() => {
  const { S, actors } = window.__game;
  const before = { cash: S.cash, m: S.counters.c1.morale };
  [...document.querySelectorAll('.win .btn')].find((b) => b.textContent.includes('Штраф')).click();
  const a = actors.clerkList().find((x) => x.id === 'c1');
  return { before, cash: S.cash, m: S.counters.c1.morale, job: a.job };
});
ok('штраф идёт в кассу', fined.cash > fined.before.cash, `+${Math.round(fined.cash - fined.before.cash)}`);
ok('но настроение оператора падает', fined.m < fined.before.m,
   `${fined.before.m.toFixed(2)} → ${fined.m.toFixed(2)}`);
ok('после штрафа он возвращается к стойке', fined.job === 'back', fined.job);

// ── 6. Пустая стойка бесит очередь быстрее ───────────────────────────────────

const anger = await p.evaluate(() => {
  const { S, actors } = window.__game;
  const B = window.__balance;
  const a = actors.clerkList().find((x) => x.id === 'c1');
  const k = actors.customers.find((c) => c.counter === 'c1') || actors.customers[0];
  k.counter = 'c1'; k.state = 'wait'; k.t = 0;
  // сначала оператор на месте
  a.job = 'desk';
  for (let i = 0; i < 60; i++) actors.tickCustomers(1 / 60, () => {});
  const calm = k.t;
  k.t = 0;
  a.job = 'search'; a.t = 30;
  for (let i = 0; i < 60; i++) actors.tickCustomers(1 / 60, () => {});
  return { calm, angry: k.t, penalty: B.ERRAND.waitPenalty };
});
ok('без оператора терпение тает быстрее', anger.angry > anger.calm * 1.5,
   `за секунду ${anger.calm.toFixed(2)} против ${anger.angry.toFixed(2)}`);

await p.evaluate(() => { Math.random = window.__rnd; });

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
