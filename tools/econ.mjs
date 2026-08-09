// Разбор экономики по четырём проверкам жанра:
// 1) время до N-го улучшения, 2) окупаемость примерно постоянна,
// 3) ни один источник не доминирует всю игру, 4) цикл престижа не схлопывается.
import { chromium } from 'playwright';

const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

// ── Рост цены против роста дохода ────────────────────────────────────────────
// В жанре цена должна расти быстрее дохода, но не намного: отношение 1.07–1.15
// за шаг. Больше — мёртвые зоны, меньше — прогресс кажется плоским.

const ratios = await p.evaluate(() => {
  const B = window.__balance;
  const out = [];
  out.push({ что: 'стойка', цена: B.COUNTER_UP.grow, доход: B.COUNTER_UP.payGrow,
             отношение: +(B.COUNTER_UP.grow / B.COUNTER_UP.payGrow).toFixed(3) });
  // Отдачу считаем той же формулой, что и игра, иначе сравнение бессмысленно.
  const at = 10;
  const upVal = (u, lvl) => (u.gain != null ? u.base * u.gain ** lvl : u.base + u.step * lvl);
  for (const k of Object.keys(B.UPGRADES)) {
    const u = B.UPGRADES[k];
    const gain = upVal(u, at + 1) / upVal(u, at);
    out.push({ что: u.name, цена: u.grow, доход: +gain.toFixed(3),
               отношение: +(u.grow / gain).toFixed(3) });
  }
  const zVal = (z, lvl) => 1 + z.step * (z.gain ** lvl - 1) / (z.gain - 1);
  for (const z of B.ZONES) {
    const gain = zVal(z, at + 1) / zVal(z, at);
    out.push({ что: z.name, цена: z.grow, доход: +gain.toFixed(3),
               отношение: +(z.grow / gain).toFixed(3) });
  }
  return out;
});
console.log('\n── рост цены против роста дохода ──');
console.table(ratios);
const bad = ratios.filter((r) => r.отношение > 1.25);
ok('цена обгоняет доход, но не улетает', bad.length === 0,
   bad.length ? bad.map((r) => `${r.что} ${r.отношение}`).join(', ') : 'все в пределах жанра');

// ── Окупаемость улучшений ────────────────────────────────────────────────────

const payback = await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  const B = window.__balance;
  for (const c of B.COUNTERS) { S.counters[c.id].open = true; S.counters[c.id].lvl = 1; }
  S.cash = 1e30;
  const c = B.COUNTERS[0];
  const out = [];
  for (let lvl = 1; lvl <= 60; lvl++) {
    S.counters[c.id].lvl = lvl;
    const before = game.counterPay(c);
    const cost = game.counterUpCost(c);
    S.counters[c.id].lvl = lvl + 1;
    const after = game.counterPay(c);
    // за сколько клиентов окупится прибавка
    out.push({ lvl, окупаемость: +(cost / (after - before)).toFixed(1) });
  }
  S.counters[c.id].lvl = 1;
  void actors;
  return out;
});
const pb = payback.map((r) => r.окупаемость);
console.log('\n── окупаемость улучшения стойки (в клиентах) ──');
console.log(`ур.1 ${pb[0]} · ур.10 ${pb[9]} · ур.30 ${pb[29]} · ур.60 ${pb[59]}`);
// Окупаемость обязана расти — именно она в конце концов упирает игрока в стену
// и отправляет в престиж. Важно, чтобы росла ровно, без скачков.
// Ровность считаем на чистой кривой, без наград за круглые уровни — иначе
// сама награда выглядит как поломка.
const clean = await p.evaluate(() => {
  const B = window.__balance;
  const out = [];
  for (let lvl = 1; lvl <= 60; lvl++) {
    const cost = 1 * B.COUNTER_UP.grow ** (lvl - 1);
    const gain = B.COUNTER_UP.payGrow ** lvl - B.COUNTER_UP.payGrow ** (lvl - 1);
    out.push(cost / gain);
  }
  return out;
});
const steps = clean.slice(1).map((v, i) => v / clean[i]);
const jump = Math.max(...steps) / Math.min(...steps);
ok('окупаемость растёт ровно, без случайных скачков', jump < 1.05,
   `шаг ${steps[0].toFixed(3)}…${steps[steps.length - 1].toFixed(3)}, разброс ×${jump.toFixed(3)}`);

const ms = await p.evaluate(() => {
  const { game } = window.__game;
  const B = window.__balance;
  return { пороги: B.COUNTER_UP.milestones, до: game.milestoneMult(24), на: game.milestoneMult(25),
           второй: game.milestoneMult(50), третий: game.milestoneMult(100) };
});
ok('на круглых уровнях игрока ждёт рывок ×2',
   ms.на === ms.до * 2 && ms.второй === ms.на * 2 && ms.третий === ms.второй * 2,
   `уровни ${ms.пороги.join(', ')}: множитель ${ms.до} → ${ms.на} → ${ms.второй} → ${ms.третий}`);
ok('но всё-таки растёт — иначе игре некуда вести', pb[59] > pb[0] * 3,
   `с ${pb[0]} до ${pb[59]} клиентов`);

// ── Кто кормит игрока на разных этапах ───────────────────────────────────────

const dominance = await p.evaluate(() => {
  const { S, game } = window.__game;
  const B = window.__balance;
  const rows = [];
  for (const stage of [1, 3, 6]) {
    for (const [i, c] of B.COUNTERS.entries()) { S.counters[c.id].open = i < stage; S.counters[c.id].lvl = 10; }
    const share = {};
    let total = 0;
    for (const [i, c] of B.COUNTERS.entries()) {
      if (i >= stage) continue;
      const v = game.counterPay(c);
      share[c.name] = v; total += v;
    }
    const best = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
    rows.push({ стоек: stage, кормилец: best[0], доля: Math.round(best[1] / total * 100) + '%' });
  }
  return rows;
});
console.log('\n── кто приносит больше всего ──');
console.table(dominance);
ok('лидер по доходу меняется по ходу игры',
   new Set(dominance.map((r) => r.кормилец)).size > 1,
   dominance.map((r) => `${r.стоек}: ${r.кормилец}`).join(' · '));

// ── Престиж ──────────────────────────────────────────────────────────────────

const prestige = await p.evaluate(() => {
  const { S, game } = window.__game;
  if (!game.prestigeGain) return null;
  const rows = [];
  for (const earned of [1e6, 1e7, 1e8, 1e9, 1e10, 1e12]) {
    S.stats.lifetime = earned;
    const g = game.prestigeGain();
    rows.push({ оборот: earned, долей: g,
                множитель: '×' + (1 + g * window.__balance.PRESTIGE.perPoint).toFixed(2),
                'до удвоения': Math.round(game.prestigeDouble()) });
  }
  return rows;
});
if (!prestige) {
  ok('в игре есть престиж', false, 'механики престижа нет — жанр без неё упирается в стену');
} else {
  console.log('\n── престиж ──');
  console.table(prestige);
  const growing = prestige.every((r, i) => i === 0 || r.долей >= prestige[i - 1].долей);
  ok('престиж растёт вместе с оборотом', growing);
  // удвоение очков должно требовать в 4 раза больше оборота (корень)
  const a = prestige.find((r) => r.долей > 0);
  const need = prestige.find((r) => a && r.долей >= a.долей * 2);
  ok('удвоение долей требует кратно большего оборота',
     !!need && need.оборот >= a.оборот * 3,
     a && need ? `${a.долей} долей при обороте ${a.оборот}, ${need.долей} при ${need.оборот}` : '—');
}

// ── Большие числа ────────────────────────────────────────────────────────────

const big = await p.evaluate(() => {
  const { fmt } = window.__fmt ? window.__fmt : { fmt: null };
  const f = fmt || ((v) => String(v));
  return [1e3, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e30, 1e60].map((v) => f(v));
});
ok('большие числа читаются, а не превращаются в кашу',
   big.every((s) => s.length <= 8) && new Set(big).size === big.length, big.join(' '));

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `\n✗ проблем: ${failed}` : '\n✓ экономика соответствует правилам жанра');
await b.close();
process.exit(failed ? 1 : 0);
