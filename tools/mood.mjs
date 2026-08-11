// Настроение клиентов и разбор претензий: недовольный ждёт, репутация
// реагирует на решения, мораль оператора меняется и восстанавливается.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const res = await p.evaluate(() => {
  const { S, reviews, actors, game } = window.__game;
  const B = window.__balance;
  const out = [];
  reviews.ensure();

  // 1. репутация влияет на поток и чек
  S.rep = 5;
  const hi = { spawn: reviews.spawnMult(), pay: reviews.payMult() };
  S.rep = 1;
  const lo = { spawn: reviews.spawnMult(), pay: reviews.payMult() };
  out.push({ t: 'репутация двигает поток и чек', ok: hi.spawn > lo.spawn && hi.pay > lo.pay,
             info: `5★ ×${hi.spawn.toFixed(2)} против 1★ ×${lo.spawn.toFixed(2)}` });
  S.rep = B.REP.start;

  // 2. Претензия — редкое событие, и между двумя обязательно проходит время.
  // Считаем шанс в чистом виде, обходя выдержку: иначе она сразу обрубит счёт.
  S.counters.c1.clerk = 1; S.counters.c1.morale = 1;
  const chance = (waited) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      window.__game.reviews.resetIncidentGap();
      if (reviews.onServed({ waited }, 'c1').upset) n++;
    }
    return n;
  };
  const долго = chance(1);
  const быстро = chance(0);
  out.push({ t: 'долгое ожидание рождает претензии чаще быстрого',
             ok: долго > быстро * 2 && долго < 400 * 0.3,
             info: `${долго} из 400 при долгом ожидании против ${быстро} при быстром` });

  // выдержка: подряд две претензии невозможны
  window.__game.reviews.resetIncidentGap();
  let upsets = 0;
  for (let i = 0; i < 400; i++) {
    const r = reviews.onServed({ waited: 1 }, 'c1');
    if (r.upset) upsets++;
  }
  out.push({ t: 'подряд претензии не сыплются — между ними выдержка', ok: upsets <= 2,
             info: `${upsets} из 400` });

  let calm = 0;
  for (let i = 0; i < 400; i++) if (reviews.onServed({ waited: 0 }, 'c1').upset) calm++;
  out.push({ t: 'без ожидания претензий меньше', ok: calm < upsets,
             info: `${calm} против ${upsets}` });

  // 3. ушёл неразобранным — репутация падает и появляется отзыв
  S.rep = 4; S.reviews = [];
  reviews.onAbandoned('c1');
  out.push({ t: 'ушёл без разбора — репутация вниз', ok: S.rep < 4 && S.reviews.length === 1,
             info: `${S.rep.toFixed(2)}★, отзывов ${S.reviews.length}` });

  // 4. штраф: деньги в кассу, мораль вниз
  S.rep = 4; S.cash = 0; S.counters.c1.morale = 1;
  const f = reviews.fine('c1');
  out.push({ t: 'штраф пополняет кассу', ok: S.cash > 0 && f.sum > 0, info: `+${Math.round(f.sum)}` });
  out.push({ t: 'штраф роняет мораль', ok: S.counters.c1.morale < 1,
             info: `×${S.counters.c1.morale.toFixed(2)}` });

  // 5. мораль влияет на скорость оператора
  const c1 = B.COUNTERS[0];
  S.counters.c1.morale = 1.25;
  const fast = game.clerkSpeed(c1);
  S.counters.c1.morale = 0.45;
  const slow = game.clerkSpeed(c1);
  out.push({ t: 'мораль меняет скорость', ok: fast > slow, info: `${fast.toFixed(2)} против ${slow.toFixed(2)}` });

  // 6. мораль восстанавливается
  S.counters.c1.morale = 0.5;
  for (let i = 0; i < 600; i++) reviews.tick(1);
  out.push({ t: 'мораль сама возвращается', ok: S.counters.c1.morale > 0.5,
             info: `×${S.counters.c1.morale.toFixed(2)} за 10 минут` });

  // 7. извинение стоит денег и поднимает репутацию сильнее штрафа
  S.rep = 3; S.cash = 1e9;
  const before = S.rep;
  reviews.apologize('c1');
  const dApo = S.rep - before;
  S.rep = 3;
  reviews.fine('c1');
  const dFine = S.rep - 3;
  out.push({ t: 'извинение выгоднее штрафа для репутации', ok: dApo > dFine,
             info: `${dApo.toFixed(3)} против ${dFine.toFixed(3)}` });

  // 8. лента не растёт бесконечно
  for (let i = 0; i < 80; i++) reviews.onAbandoned('c1');
  out.push({ t: 'лента отзывов ограничена', ok: S.reviews.length <= B.REVIEW_MAX,
             info: `${S.reviews.length} записей` });

  return out;
});

let bad = 0;
for (const r of res) { if (!r.ok) bad++; console.log(`${r.ok ? '✓' : '✗'} ${r.t.padEnd(42)} ${r.info || ''}`); }
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ настроение и разборы работают как задумано');
console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
process.exit(bad ? 1 : 0);
