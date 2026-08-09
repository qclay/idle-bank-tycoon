// Интерфейс: шапка одной полосой, зал без каши из ценников, крупные карточки.
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

// ── 1. Шапка — один ряд денег и одна полоса состояния ────────────────────────

const hud = await p.evaluate(() => {
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    strip: box('.strip'), rep: box('#repPill'), lvl: box('.strip__lvl'), coop: box('#coopChip'),
    floaters: document.querySelectorAll('#hud > *').length,
  };
});
ok('состояние собрано в одну полосу', !!hud.strip && hud.floaters === 2,
   `плавающих блоков в шапке: ${hud.floaters}`);
ok('рейтинг, уровень и «сколько нас» на одной линии',
   hud.rep && hud.lvl && hud.coop && hud.rep.y === hud.lvl.y && hud.lvl.y === hud.coop.y,
   `y: ${hud.rep?.y}/${hud.lvl?.y}/${hud.coop?.y}`);
ok('полоса не наезжает на деньги',
   hud.strip.y >= 40, `полоса начинается на y=${hud.strip.y}`);

// ── 2. Зал не завален ценниками ──────────────────────────────────────────────

const tags = await p.evaluate(() => new Promise((res) => {
  const { actors, nav } = window.__game;
  actors.player.x = 12; actors.player.y = 11;      // торговый зал
  setTimeout(() => {
    const all = [...document.querySelectorAll('.wtag')];
    res({
      room: nav.roomAt(actors.player.x, actors.player.y)?.name,
      всего: all.length,
      подробно: all.filter((e) => !e.classList.contains('is-far') && !e.classList.contains('is-off')).length,
      точкой: all.filter((e) => e.classList.contains('is-far')).length,
      скрыто: all.filter((e) => e.classList.contains('is-off')).length,
    });
  }, 700);
}));
ok('в чужих комнатах ценники не висят', tags.скрыто > 0,
   `подробно ${tags.подробно}, точкой ${tags.точкой}, скрыто ${tags.скрыто}`);
ok('подробных ценников на экране единицы', tags.подробно <= 2,
   `подробно ${tags.подробно} в комнате «${tags.room}»`);

// ── 3. При входе в комнату видно, куда попал ─────────────────────────────────

const title = await p.evaluate(() => new Promise((res) => {
  const { actors } = window.__game;
  actors.player.x = 25.5; actors.player.y = 7.3;     // склад
  setTimeout(() => {
    const e = document.querySelector('.roomttl');
    res({ text: e?.textContent || '', on: e?.classList.contains('is-on') });
  }, 500);
}));
ok('название комнаты появляется при входе', title.on && /Склад/.test(title.text), title.text);

const faded = await p.evaluate(() => new Promise((res) => {
  setTimeout(() => res(document.querySelector('.roomttl')?.classList.contains('is-on')), 3200);
}));
ok('и само уходит, не мозоля глаза', !faded);

// ── 4. Карточки объектов — с иллюстрацией и одной главной кнопкой ────────────

await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.cash = 5e6; S.counters.c1.open = true; S.counters.c2.open = true; S.counters.c1.clerk = 2;
  S.atms.a1.open = true;
  actors.refreshSolids(); actors.syncStaff();
  window.__openTab('staff');
});
await p.waitForTimeout(700);
const cards = await p.evaluate(() => {
  const list = [...document.querySelectorAll('.bcard')];
  const art = list[0]?.querySelector('.bcard__art');
  const r = art?.getBoundingClientRect();
  const main = list[0]?.querySelector('.btn--main')?.getBoundingClientRect();
  const second = [...(list[0]?.querySelectorAll('.bcard__acts .btn') || [])][1]?.getBoundingClientRect();
  return {
    n: list.length,
    art: r ? Math.round(r.width) : 0,
    lvl: !!list[0]?.querySelector('.bcard__lvl'),
    mainW: main ? Math.round(main.width) : 0,
    secondW: second ? Math.round(second.width) : 0,
    tone: art ? getComputedStyle(art).backgroundImage.includes('gradient') : false,
  };
});
ok('в карточке есть место под иллюстрацию', cards.art >= 40, `${cards.art}px`);
ok('иллюстрация окрашена в цвет объекта', cards.tone);
ok('уровень виден прямо на иллюстрации', cards.lvl);
ok('главная кнопка заметно крупнее второстепенной', cards.mainW > cards.secondW * 1.3,
   `${cards.mainW}px против ${cards.secondW}px`);
await p.screenshot({ path: `${OUT}/ui-cards.png` });

// ── 5. Ничего не уехало за экран ─────────────────────────────────────────────

const overflow = await p.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const bad = [];
  for (const e of document.querySelectorAll('#hud *, .win *, #nav *')) {
    const r = e.getBoundingClientRect();
    if (r.width && (r.x < -1 || r.x + r.width > w + 1)) bad.push(e.className || e.id);
  }
  return { w, bad: bad.slice(0, 5), n: bad.length };
});
ok('ничего не вылезает за края экрана', overflow.n === 0, overflow.bad.join(', '));

// ── 6. Фокус: своя комната светится, соседние отступают ──────────────────────

const focus = await p.evaluate(() => new Promise((res) => {
  const { actors, scene, nav } = window.__game;
  actors.player.x = 12; actors.player.y = 11;
  setTimeout(() => {
    const alphas = {};
    for (const r of window.__balance.ROOMS) alphas[r.name] = +scene.veilOf(r.id).toFixed(2);
    res({ комната: nav.roomAt(actors.player.x, actors.player.y)?.name, alphas });
  }, 1500);
}));
ok('комната игрока не притенена', focus.alphas['Торговый зал'] < 0.05,
   `вуаль ${focus.alphas['Торговый зал']}`);
ok('соседние помещения уходят в тень', focus.alphas['Пункт выдачи'] > 0.2,
   JSON.stringify(focus.alphas));
ok('склад темнее всех', focus.alphas['Склад'] > focus.alphas['Пункт выдачи'],
   `склад ${focus.alphas['Склад']}`);

// ── 7. Камера показывает глубину комнаты целиком ─────────────────────────────

const cam = await p.evaluate(() => {
  const { scene } = window.__game;
  const B = window.__balance;
  const H = scene.viewH();
  const r = B.ROOMS.find((x) => x.id === 'sales');
  let top = 1e9, bot = -1e9;
  for (let y = r.y0; y <= r.y1; y += 0.5) for (let x = r.x0; x <= r.x1; x += 0.5) {
    const s = scene.screenOf(x, y, 0);
    top = Math.min(top, s.y); bot = Math.max(bot, s.y);
  }
  return { масштаб: +scene.cam.scale.toFixed(2), глубинаНаЭкране: Math.round(bot - top), экран: Math.round(H) };
});
ok('вся глубина комнаты влезает в экран', cam.глубинаНаЭкране < cam.экран,
   `${cam.глубинаНаЭкране}px при экране ${cam.экран}px`);
ok('но люди не превращаются в горошины', cam.масштаб >= 0.55, `масштаб ${cam.масштаб}`);

// ── 8. Подсказка в мире ровно одна ───────────────────────────────────────────

const hints = await p.evaluate(() => new Promise((res) => {
  const { S } = window.__game;
  S.carry = 50; S.stats.served = 0; S.counters.c1.open = true; S.counters.c1.clerk = 0;
  setTimeout(() => res([...document.querySelectorAll('.wtag--hint')]
    .filter((e) => !e.classList.contains('is-off')).map((e) => e.textContent)), 600);
}));
ok('подсказка показывается одна за раз', hints.length === 1, hints.join(' | ') || 'ни одной');

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
if (errs.length) console.log('ошибки страницы:', errs.slice(0, 6).join(' | '));
await b.close();
process.exit(bad ? 1 : 0);
