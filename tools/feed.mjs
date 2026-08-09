// Лента соцсети: отзывы, новости района и посты продвижения в одном потоке.
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
await p.waitForTimeout(800);

// ── 1. Модель узнаёт, что в пункте есть на самом деле ────────────────────────

const has = await p.evaluate(() => {
  const { S, reviews } = window.__game;
  for (const [id, st] of Object.entries(S.counters)) st.open = id === 'c1';
  for (const st of Object.values(S.zones || {})) st.open = false;
  return reviews.services();
});
ok('модель получает список только открытых услуг',
   has.length === 1 && has[0] === 'Выдача заказов', JSON.stringify(has));

const withFit = await p.evaluate(() => {
  window.__game.S.counters.c2.open = true;
  return window.__game.reviews.services();
});
ok('открыли примерочную — она появляется в списке',
   withFit.includes('Примерочная'), JSON.stringify(withFit));
await p.evaluate(() => { window.__game.S.counters.c2.open = false; });

// ── 2. В ленте три разных типа записей ───────────────────────────────────────

await p.evaluate(() => {
  const { S, reviews } = window.__game;
  S.reviews = [];
  reviews.addNews('«СкороПункт» обошёл вас: 120 против ваших 96', 'Гонка за район');
  reviews.addPromo('Заказ ждёт вас на полке — забирайте без очереди', 340);
  S.reviews.push({ id: 'r1', kind: 'bad', text: 'Долго ждал в очереди', who: 'Азиз',
                   at: 'Выдача заказов', stars: 2, t: Date.now() - 6e4 });
  S.seenReviews = 0;
});
await p.click('#repPill');
await p.waitForTimeout(600);
const cards = await p.evaluate(() => [...document.querySelectorAll('.post')].map((e) => ({
  kind: [...e.classList].find((c) => c.startsWith('post--'))?.slice(6),
  who: e.querySelector('.post__h b').textContent,
  text: e.querySelector('.post__x').textContent,
  likes: e.querySelector('.post__likes')?.textContent.trim() || '',
  stars: e.querySelectorAll('.post__stars .st.is-on').length,
})));
ok('в ленте и новость, и пост пункта, и отзыв', cards.length === 3, JSON.stringify(cards.map((c) => c.kind)));
ok('новость выглядит новостью', cards.some((c) => c.kind === 'news' && /СкороПункт/.test(c.text)),
   cards.find((c) => c.kind === 'news')?.who || '—');
ok('у поста пункта видны лайки', cards.some((c) => c.kind === 'smm' && c.likes === '340'),
   cards.find((c) => c.kind === 'smm')?.likes || '—');
ok('у отзыва видны звёзды, а у новости их нет',
   cards.find((c) => c.kind === 'bad')?.stars === 2 && cards.find((c) => c.kind === 'news')?.stars === 0);
await p.screenshot({ path: `${OUT}/feed.png` });

// ── 3. Наём смм-щика ─────────────────────────────────────────────────────────

await p.evaluate(() => document.querySelectorAll('.win__tab')[1].click());
await p.waitForTimeout(400);
const before = await p.evaluate(() => ({
  lvl: window.__game.smm.level(),
  reach: window.__game.smm.reachMult(),
  title: document.querySelector('.promo__h b').textContent,
  btn: document.querySelector('.btn--wide')?.textContent.trim(),
  off: document.querySelector('.btn--wide')?.disabled,
}));
ok('без смм-щика страницу никто не ведёт', before.lvl === 0 && /никто не ведёт/.test(before.title), before.title);
ok('без денег нанять нельзя', before.off === true, before.btn);

await p.evaluate(() => { window.__game.S.cash = 5e5; });
await p.evaluate(() => window.__game.screens.refresh());
await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('.btn--wide').click());
await p.waitForTimeout(500);
const after = await p.evaluate(() => ({
  lvl: window.__game.smm.level(),
  reach: +window.__game.smm.reachMult().toFixed(3),
  cash: Math.round(window.__game.S.cash),
  title: document.querySelector('.promo__h b').textContent,
}));
ok('смм-щик нанимается за деньги', after.lvl === 1 && after.cash < 5e5,
   `${after.title}, осталось ${after.cash}`);
ok('охват пункта вырос', after.reach > before.reach, `${before.reach} → ${after.reach}`);

// ── 4. Пост выходит сам и подбрасывает поток ─────────────────────────────────

const posted = await p.evaluate(() => new Promise((res) => {
  const { S, smm, actors } = window.__game;
  const n0 = S.reviews.filter((r) => r.kind === 'smm').length;
  S.smm.t = 0.05; S.smm.boost = 0;
  const slow = actors.spawnRate();
  const t0 = setInterval(() => {
    const n = S.reviews.filter((r) => r.kind === 'smm').length;
    if (n > n0) {
      clearInterval(t0);
      res({ n0, n, boost: Math.round(smm.boostLeft()), slow, fast: actors.spawnRate(),
            text: S.reviews[0].text, kind: S.reviews[0].kind });
    }
  }, 100);
  setTimeout(() => { clearInterval(t0); res(null); }, 8000);
}));
ok('смм-щик сам публикует пост', posted && posted.n > posted.n0, posted?.text || 'поста не было');
ok('после поста клиенты идут чаще', posted && posted.fast < posted.slow,
   posted ? `интервал ${posted.slow.toFixed(2)} → ${posted.fast.toFixed(2)} с` : '—');
ok('всплеск не вечный, у него есть срок', posted && posted.boost > 0 && posted.boost <= 110,
   posted ? `${posted.boost} с` : '—');

// ── 5. Смена лидера в районе попадает в новости ──────────────────────────────

const news = await p.evaluate(() => new Promise((res) => {
  const { S, district } = window.__game;
  S.reviews = [];
  S.district.my = 10; S.district.foe = 200; S.district.lastLead = null;
  district.tick(0.1);                         // запоминаем, что мы отстаём
  S.district.my = 500;                        // и вырываемся вперёд
  setTimeout(() => {
    district.tick(0.1);
    setTimeout(() => res(S.reviews.filter((r) => r.kind === 'news').map((r) => r.text)), 200);
  }, 100);
}));
ok('обгон соперника попадает в ленту новостью', news.length > 0 && /вперёд/.test(news[0] || ''),
   news[0] || 'новостей нет');

await p.evaluate(() => window.__game.screens.close(true));
await p.click('#repPill');
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/feed-news.png` });
await p.evaluate(() => document.querySelectorAll('.win__tab')[1].click());
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/feed-promo.png` });

// ── 6. Пост смм-щика пишет модель ────────────────────────────────────────────
// Заготовки быстро приедаются, а этот пост читают чаще всего. Проверяем на
// вкладке с настоящей подписью: без неё сервер недоступен и текст остаётся свой.

const BOT = (process.env.BOT_TOKEN
  || (readFileSync(new URL('../server/.dev.vars', import.meta.url), 'utf8')
      .match(/BOT_TOKEN=(.+)/) || [])[1] || '').trim();
if (BOT) {
  const user = { id: 910004, first_name: 'Промо', username: 'promo_test' };
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

  const promo = await tp.evaluate(async () => {
    const { S, smm } = window.__game;
    for (const [id, st] of Object.entries(S.counters)) st.open = id === 'c1';
    S.reviews = [];
    S.cash = 5e5;
    smm.hire();
    S.smm.t = 0.05;
    for (let i = 0; i < 60 && !S.reviews.some((r) => r.kind === 'smm' && r.ai); i++) {
      await new Promise((s) => setTimeout(s, 400));
    }
    const post = S.reviews.find((r) => r.kind === 'smm');
    return { text: post?.text || '', ai: !!post?.ai, likes: post?.likes || 0 };
  });
  ok('пост смм-щика пишет модель', promo.ai, promo.text || 'модель не ответила');
  ok('у поста есть лайки', promo.likes > 0, String(promo.likes));
  ok('модель не выдумывает услуг, которых нет',
     !/примероч|возврат|кофе|курьер/i.test(promo.text), promo.text);
  await ctx.close();
} else {
  ok('пост смм-щика пишет модель', false, 'нет BOT_TOKEN — проверка пропущена');
}

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
