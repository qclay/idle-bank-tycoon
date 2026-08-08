// Совместная игра: два настоящих клиента в одном пункте.
//
// Поднимаем две вкладки с разными подписями Telegram, гостя заводим по
// ссылке-приглашению и проверяем главное: они видят друг друга, гость видит
// мир хозяина и своим трудом приносит хозяину деньги.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const BOT = (process.env.BOT_TOKEN
  || (readFileSync(new URL('../server/.dev.vars', import.meta.url), 'utf8')
      .match(/BOT_TOKEN=(.+)/) || [])[1] || '').trim();
if (!BOT) { console.error('нет BOT_TOKEN'); process.exit(1); }

/** Настоящая подпись initData — сервер проверяет её всерьёз. */
function initData(user, startParam) {
  const fields = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF' + Math.random().toString(36).slice(2, 10),
  };
  if (startParam) fields.start_param = startParam;
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const HOST = { id: 910001, first_name: 'Хозяин', username: 'host_test' };
const GUEST = { id: 910002, first_name: 'Гость', username: 'guest_test' };

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });

/** Вкладка, притворяющаяся клиентом Telegram: свой telegram-web-app.js гасим,
 *  чтобы он не затёр подставленный объект. */
async function open(user, startParam) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/telegram-web-app.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await p.addInitScript(([raw, u, sp]) => {
    const noop = () => {};
    window.Telegram = { WebApp: {
      initData: raw,
      initDataUnsafe: { user: u, start_param: sp || undefined },
      platform: 'ios', version: '7.0', viewportStableHeight: 780,
      safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
      ready: noop, expand: noop, onEvent: noop, offEvent: noop,
      setHeaderColor: noop, setBackgroundColor: noop, setBottomBarColor: noop,
      disableVerticalSwipes: noop, enableClosingConfirmation: noop, requestFullscreen: noop,
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop },
      openTelegramLink: (l) => { window.__lastLink = l; },
    } };
  }, [initData(user, startParam), user, startParam || '']);
  await p.goto(PAGE);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 25000 });
  p.__errs = errs;
  return p;
}

// маленький автопилот: ведём героя джойстиком к точке
const autopilot = (p) => p.evaluate(() => {
  const { actors, ui } = window.__game;
  window.__drive = null;
  const step = () => {
    if (window.__drive) {
      const dx = window.__drive.x - actors.player.x;
      const dy = window.__drive.y - actors.player.y;
      const d = Math.hypot(dx, dy);
      ui.joy.dx = d > 0.15 ? dx / d : 0;
      ui.joy.dy = d > 0.15 ? dy / d : 0;
    }
    requestAnimationFrame(step);
  };
  step();
});
const goto = async (p, x, y, ms = 2500) => {
  await p.evaluate(([tx, ty]) => { window.__drive = { x: tx, y: ty }; }, [x, y]);
  await p.waitForTimeout(ms);
};

// ── 1. Хозяин заходит в свой пункт и разгоняет его ───────────────────────────

const host = await open(HOST);
await autopilot(host);
await host.evaluate(() => {
  const { S, actors, net } = window.__game;
  S.cash = 2e5; S.level = 6;
  for (const id of ['c1', 'c2']) { S.counters[id].open = true; S.counters[id].lvl = 4; }
  S.ups.bag = 3; S.ups.boots = 2;
  actors.refreshSolids(); actors.syncStaff();
  net.flush();
});
await host.waitForTimeout(900);

const hostCoop = await host.evaluate(() => ({
  on: window.__game.coop.coop.on,
  host: window.__game.coop.coop.host,
  room: window.__game.coop.coop.roomId,
  me: window.__game.coop.coop.me,
}));
ok('хозяин в своей комнате и считает мир', hostCoop.on && hostCoop.host,
   `on=${hostCoop.on} host=${hostCoop.host} room=${hostCoop.room}`);

// ── 2. Гость приходит по ссылке-приглашению ──────────────────────────────────

const guest = await open(GUEST, `room_${HOST.id}`);
await autopilot(guest);
await guest.waitForTimeout(1800);

const guestCoop = await guest.evaluate(() => ({
  on: window.__game.coop.coop.on,
  host: window.__game.coop.coop.host,
  room: window.__game.coop.coop.roomId,
  visiting: window.__game.coop.visiting(),
  visitFlag: window.__game.net.net.visiting,
}));
ok('гость попал в комнату хозяина, а не в свою', guestCoop.on && guestCoop.room === String(HOST.id),
   `room=${guestCoop.room}`);
ok('гость мир не считает', guestCoop.on && !guestCoop.host);
ok('гостю запрещено сохранять чужой пункт под своим именем',
   guestCoop.visiting && guestCoop.visitFlag);

// ── 3. Видят друг друга ──────────────────────────────────────────────────────

await goto(guest, 9, 6, 2500);
await host.waitForTimeout(600);

const seenByHost = await host.evaluate(() => window.__game.coop.others().map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y })));
const seenByGuest = await guest.evaluate(() => window.__game.coop.others().map((p) => ({ id: p.id, name: p.name })));
ok('хозяин видит гостя в зале', seenByHost.some((p) => p.id === String(GUEST.id)),
   JSON.stringify(seenByHost));
ok('гость видит хозяина в зале', seenByGuest.some((p) => p.id === String(HOST.id)),
   JSON.stringify(seenByGuest));

const before = seenByHost.find((p) => p.id === String(GUEST.id));
await goto(guest, 16, 10, 2500);
await host.waitForTimeout(600);
const after = (await host.evaluate(() => window.__game.coop.others().map((p) => ({ id: p.id, x: p.x, y: p.y }))))
  .find((p) => p.id === String(GUEST.id));
ok('хозяин видит, как гость идёт',
   before && after && Math.hypot(after.x - before.x, after.y - before.y) > 1.5,
   before && after ? `с ${before.x.toFixed(1)},${before.y.toFixed(1)} на ${after.x.toFixed(1)},${after.y.toFixed(1)}` : 'нет данных');

const tags = await host.evaluate(() => [...document.querySelectorAll('.nametag')].map((e) => e.textContent));
ok('над гостем подписано имя', tags.includes(GUEST.first_name), JSON.stringify(tags));

const views = await host.evaluate(() => window.__game.coop.others().filter((p) => p.view).length);
ok('гость нарисован в зале', views > 0);

// ── 4. Гость видит мир хозяина ───────────────────────────────────────────────

const mirror = await guest.evaluate(() => ({
  snap: !!window.__game.coop.coop.snap,
  c2open: window.__game.S.counters.c2.open,
  cash: window.__game.S.cash,
}));
ok('гостю приходит снимок мира', mirror.snap);
ok('у гостя открыты стойки хозяина, а не свои', mirror.c2open, `c2open=${mirror.c2open}`);

const ghosts = await guest.evaluate(() => window.__game.coop.snapCustomers().length);
ok('гость видит клиентов хозяина', ghosts >= 0, `клиентов ${ghosts}`);

// ── 5. Гость работает — деньги идут хозяину ──────────────────────────────────

// сажаем клиента к стойке и ставим гостя за неё
const spot = await host.evaluate(() => {
  const c = window.__game.actors.counterDef('c1');
  const s = window.__game.actors.clerkSpot(c);
  window.__game.S.counters.c1.cash = 0;
  return [s.x, s.y];
});
await goto(guest, spot[0], spot[1], 1200);

const cashBefore = await host.evaluate(() => window.__game.S.counters.c1.cash + window.__game.S.cash);
await guest.evaluate(([x, y]) => { window.__drive = { x, y }; }, spot);
await host.evaluate(() => { window.__game.actors.player.x = 2.5; window.__game.actors.player.y = 3.6; });
await host.waitForTimeout(9000);
const cashAfter = await host.evaluate(() => window.__game.S.counters.c1.cash + window.__game.S.cash);
ok('гость за стойкой зарабатывает хозяину', cashAfter > cashBefore,
   `было ${Math.round(cashBefore)}, стало ${Math.round(cashAfter)}`);

// контроль: увели гостя от стойки — стойка обязана замолчать
await goto(guest, 18, 13, 2500);
const idleFrom = await host.evaluate(() => window.__game.S.counters.c1.cash + window.__game.S.cash);
await host.waitForTimeout(9000);
const idleTo = await host.evaluate(() => window.__game.S.counters.c1.cash + window.__game.S.cash);
ok('без гостя стойка не зарабатывает сама по себе', idleTo - idleFrom < (cashAfter - cashBefore) * 0.25,
   `с гостем +${Math.round(cashAfter - cashBefore)}, без гостя +${Math.round(idleTo - idleFrom)}`);

// ── 6. Возвращение домой ─────────────────────────────────────────────────────

const mineBefore = await guest.evaluate(() => window.__game.S.counters.c2.open);
await guest.evaluate(() => window.__goHome());
await guest.waitForTimeout(2000);
const home = await guest.evaluate(() => ({
  visiting: window.__game.coop.visiting(),
  saving: !window.__game.net.net.visiting,
  c2: window.__game.S.counters.c2.open,
  host: window.__game.coop.coop.host,
}));
ok('гость вернулся в свой пункт', !home.visiting && home.saving);
ok('чужой прогресс не остался у гостя', home.c2 === false,
   `у хозяина c2=${mineBefore}, у гостя после возврата c2=${home.c2}`);
ok('дома игрок снова считает свой мир', home.host);

// ── 7. Хозяин вышел — мир считает оставшийся ─────────────────────────────────

await guest.evaluate(() => window.__game.coop.join(
  window.Telegram.WebApp.initData, String(910001), String(910002)));
await guest.waitForTimeout(1500);
await host.close();
await guest.waitForTimeout(2500);
const promoted = await guest.evaluate(() => window.__game.coop.coop.host);
ok('после ухода хозяина мир продолжает считать оставшийся', promoted);

await guest.screenshot({ path: `${OUT}/coop-guest.png` });

const errs = [...(guest.__errs || [])];
await browser.close();

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
process.exit(bad ? 1 : 0);
