// Соцсеть и настроение: рейтинг на виду, лента открывается, очередь мрачнеет.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

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

// ── 1. Рейтинг видно с первого экрана ────────────────────────────────────────

const pill = await p.evaluate(() => {
  const e = document.getElementById('repPill');
  const r = e.getBoundingClientRect();
  return { txt: document.getElementById('repV').textContent, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) };
});
ok('рейтинг всегда на экране', pill.w > 30 && pill.h > 15 && parseFloat(pill.txt) > 0,
   `${pill.txt} ★, ${pill.w}×${pill.h} на y=${pill.y}`);

// ── 2. Лента открывается и показывает отзывы ─────────────────────────────────

await p.evaluate(() => {
  const { S, game } = window.__game;
  S.counters.c1.open = true; S.counters.c2.open = true;
  S.reviews = [
    { id: 'a', kind: 'bad', text: 'Прождал и ушёл ни с чем', who: 'Азиз', at: 'Выдача 1', stars: 1, t: Date.now() - 4e5 },
    { id: 'b', kind: 'good', text: 'Забрал заказ за минуту, спасибо', who: 'Дилноза', at: 'Выдача 2', stars: 5, t: Date.now() - 9e4 },
    { id: 'c', kind: 'solved', text: 'Была накладка, но всё уладили', who: 'Тимур', at: 'Выдача 1', stars: 4, t: Date.now() - 3e3 },
  ];
  S.seenReviews = 0;
  S.rep = 3.9;
  S.stats.checks = 4; S.stats.fines = 2; S.stats.apologies = 1; S.stats.walkouts = 3;
  S.counters.c1.morale = 0.62; S.counters.c2.morale = 1.12;
  S.counters.c1.clerk = 1;
  void game;
});
await p.waitForTimeout(300);
const badge = await p.evaluate(() => {
  const e = document.getElementById('repBadge');
  return { hidden: e.hidden, txt: e.textContent };
});
ok('о новых отзывах говорит значок', !badge.hidden && badge.txt === '3', `значок: ${badge.txt}`);

await p.click('#repPill');
await p.waitForTimeout(600);
const feed = await p.evaluate(() => ({
  title: document.querySelector('.win__head h2')?.textContent,
  posts: [...document.querySelectorAll('.post')].map((e) => e.querySelector('.post__x').textContent),
  rating: document.querySelector('.repcard__n')?.textContent,
  effect: document.querySelector('.repcard__s')?.textContent,
  stars: document.querySelectorAll('.repcard__stars .st.is-on').length,
}));
ok('соцсеть открывается с рейтинга', feed.title === 'Соцсеть' && feed.rating === '3.9', JSON.stringify(feed.rating));
ok('видно, на что влияет рейтинг', /Поток клиентов .* средний чек/.test(feed.effect || ''), feed.effect);
ok('лента показывает все отзывы', feed.posts.length === 3, feed.posts.join(' | '));
ok('звёзды соответствуют оценке', feed.stars === 4, `закрашено ${feed.stars}`);
await p.screenshot({ path: `${OUT}/social-feed.png` });

// ── 3. Вкладка смены ─────────────────────────────────────────────────────────

await p.evaluate(() => document.querySelectorAll('.win__tab')[2].click());
await p.waitForTimeout(500);
const shift = await p.evaluate(() => ({
  rows: [...document.querySelectorAll('.mrow')].map((e) => ({
    name: e.querySelector('.mrow__t b').textContent,
    mood: e.querySelector('.mrow__m').textContent,
    tone: e.className,
  })),
  stats: [...document.querySelectorAll('.stat')].map((e) => `${e.querySelector('i').textContent}=${e.querySelector('b').textContent}`),
}));
ok('видно настроение каждой смены', shift.rows.length === 2, JSON.stringify(shift.rows.map((r) => r.mood)));
ok('подавленный оператор помечен', shift.rows.some((r) => r.tone.includes('bad') || r.tone.includes('warn')),
   shift.rows.map((r) => `${r.mood}/${r.tone}`).join(' '));
ok('видно, как решались споры', shift.stats.join(' ').includes('Ушли не дождавшись=3'), shift.stats.join(' '));
await p.screenshot({ path: `${OUT}/social-shift.png` });
await p.evaluate(() => window.__game.screens.close(true));
await p.waitForTimeout(400);

// ── 4. Прочитанное перестаёт мигать ──────────────────────────────────────────

const after = await p.evaluate(() => document.getElementById('repBadge').hidden);
ok('прочитанные отзывы больше не мигают', after);

// ── 5. Очередь мрачнеет от долгого ожидания ──────────────────────────────────

const mood = await p.evaluate(async () => {
  const { actors, S } = window.__game;
  const { CUSTOMER } = window.__balance;
  // сажаем клиента в очередь и прокручиваем его терпение
  S.counters.c1.open = true;
  const seen = [];
  const k = actors.customers[0] || null;
  return { patience: CUSTOMER.patience, has: !!k, seen };
});
ok('в зале есть клиенты', mood.has);

const stages = await p.evaluate(() => new Promise((res) => {
  const { actors, scene } = window.__game;
  const out = [];
  const k = actors.customers.find((c) => c.state === 'wait') || actors.customers[0];
  // подкручиваем только время ожидания — остальное считает игра сама
  const steps = [0.1, 0.5, 0.85];
  let i = 0;
  const step = () => {
    if (i >= steps.length) return res(out);
    const { CUSTOMER } = window.__balance;
    k.state = 'wait'; k.t = CUSTOMER.patience * steps[i];
    setTimeout(() => {
      out.push({ waited: +(k.waited || 0).toFixed(2), mood: k.mood ?? null });
      i++; step();
    }, 260);
  };
  step();
  void scene;
}));
ok('короткая очередь никого не расстраивает', stages[0].mood == null, JSON.stringify(stages[0]));
ok('от ожидания клиент мрачнеет', stages[1].mood === 'meh', JSON.stringify(stages[1]));
ok('под конец терпения — злится', stages[2].mood === 'bad', JSON.stringify(stages[2]));

// ── 6. Ушёл не дождавшись — бьёт по репутации и попадает в ленту ─────────────

const walkout = await p.evaluate(() => new Promise((res) => {
  const { actors, S } = window.__game;
  const { CUSTOMER } = window.__balance;
  const before = { rep: S.rep, n: S.reviews.length, out: S.stats.walkouts || 0 };
  const k = actors.customers.find((c) => c.state === 'wait') || actors.customers[0];
  k.state = 'wait'; k.t = CUSTOMER.patience + 0.5;
  setTimeout(() => res({
    before,
    rep: S.rep, n: S.reviews.length, out: S.stats.walkouts || 0,
    top: S.reviews[0]?.text || '', kind: S.reviews[0]?.kind || '',
  }), 400);
}));
ok('уход без выдачи роняет рейтинг', walkout.rep < walkout.before.rep,
   `${walkout.before.rep.toFixed(2)} → ${walkout.rep.toFixed(2)}`);
ok('такой уход попадает в ленту отдельным отзывом',
   walkout.n > walkout.before.n && walkout.kind === 'bad', walkout.top);
ok('счётчик ушедших растёт', walkout.out === walkout.before.out + 1, `${walkout.before.out} → ${walkout.out}`);

await p.screenshot({ path: `${OUT}/social-hud.png` });

// ── 7. Тексты отзывов пишет модель ───────────────────────────────────────────
// Вне Telegram подписи нет и сервер недоступен — заготовки остаются заготовками.
// Поэтому для этой проверки открываем вкладку с настоящей подписью.

const BOT = (process.env.BOT_TOKEN
  || (readFileSync(new URL('../server/.dev.vars', import.meta.url), 'utf8')
      .match(/BOT_TOKEN=(.+)/) || [])[1] || '').trim();
if (BOT) {
  const user = { id: 910003, first_name: 'Отзывы', username: 'rev_test' };
  const f = { user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)),
              query_id: 'AAF' + Math.random().toString(36).slice(2, 10) };
  const check = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  const raw = new URLSearchParams({ ...f, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();

  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const tp = await ctx.newPage();
  await tp.route('**/telegram-web-app.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await tp.addInitScript(([rd, u]) => {
    const n = () => {};
    window.Telegram = { WebApp: { initData: rd, initDataUnsafe: { user: u }, platform: 'ios', version: '7.0',
      viewportStableHeight: 780, safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
      ready: n, expand: n, onEvent: n, offEvent: n, setHeaderColor: n, setBackgroundColor: n, setBottomBarColor: n,
      disableVerticalSwipes: n, enableClosingConfirmation: n, requestFullscreen: n,
      HapticFeedback: { impactOccurred: n, notificationOccurred: n }, openTelegramLink: n } };
  }, [raw, user]);
  await tp.goto(PAGE);
  await tp.waitForFunction(() => window.__ready === true, null, { timeout: 25000 });
  await tp.waitForTimeout(600);

  // пять уходов подряд — этого хватает, чтобы пачка ушла в модель сразу
  const texts = await tp.evaluate(async () => {
    const { S, reviews } = window.__game;
    S.counters.c1.open = true;
    S.reviews = [];
    for (let i = 0; i < 5; i++) reviews.onWalkedOut('c1');
    const was = S.reviews.map((r) => r.text);
    for (let i = 0; i < 40 && !S.reviews.some((r) => r.ai); i++) await new Promise((s) => setTimeout(s, 500));
    return { was, now: S.reviews.map((r) => ({ text: r.text, ai: !!r.ai })) };
  });
  const live = texts.now.filter((r) => r.ai);
  ok('тексты отзывов приходят от модели', live.length > 0,
     live[0]?.text || 'модель не ответила');
  ok('заготовки подменяются, а не дублируются', texts.now.length === 5,
     `в ленте ${texts.now.length}`);
  await ctx.close();
} else {
  ok('тексты отзывов приходят от модели', false, 'нет BOT_TOKEN — проверка пропущена');
}

// ── 8. Разбор открывается нажатием на значок, а не подходом ─────────────────

const bubble = await p.evaluate(() => new Promise((res) => {
  const { actors, S } = window.__game;
  S.counters.c1.open = true;
  const k = actors.customers[0];
  actors.player.x = 2.5; actors.player.y = 3.6;      // игрок в другом конце зала
  k.state = 'upset'; k.t = 0; k.mood = 'upset';
  k.incident = { id: 'wrong', text: 'Выдали не тот заказ', blame: 'staff' };
  k.spot = { x: k.x, y: k.y };
  setTimeout(() => {
    const el = document.querySelector('.bub--upset');
    res({ есть: !!el, далеко: Math.hypot(actors.player.x - k.x, actors.player.y - k.y) > 4 });
  }, 400);
}));
ok('над недовольным появляется кнопка-значок', bubble.есть && bubble.далеко,
   bubble.далеко ? 'игрок в другом конце зала' : 'игрок рядом');

await p.click('.bub--upset');
await p.waitForTimeout(600);
const dialog = await p.evaluate(() => ({
  title: document.querySelector('.win__head h2')?.textContent || '',
  buttons: [...document.querySelectorAll('.win .btn .btn__t')].map((e) => e.textContent),
}));
ok('нажатие открывает разбор, подходить не нужно', /Претензия|Разбор|заказ/i.test(dialog.title)
   || dialog.buttons.length > 0, `${dialog.title} · ${dialog.buttons.join(', ')}`);
await p.screenshot({ path: `${OUT}/bubble-tap.png` });

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
