// Дорога до кассы: по пути никто не должен забирать деньги,
// а проходы должны быть проходимыми.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const res = await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  const out = [];

  // общий шаг: ведём героя в точку, возвращаем, дошёл ли и сколько потерял
  const walkTo = (tx, ty, secs = 14) => {
    const cash0 = S.cash, carry0 = S.carry;
    let stuck = 0, prev = 99;
    for (let i = 0; i < secs / 0.03; i++) {
      const dx = tx - actors.player.x, dy = ty - actors.player.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.35) break;
      if (Math.abs(d - prev) < 0.0005) stuck++; else stuck = 0;
      prev = d;
      actors.movePlayer(dx / d, dy / d, 0.03);
      game.tick(0.03, { toast() {} });
      if (stuck > 40) break;
    }
    return {
      dist: Math.hypot(tx - actors.player.x, ty - actors.player.y),
      lost: (cash0 + carry0) - (S.cash + S.carry),
    };
  };

  const reset = () => {
    S.cash = 0; S.carry = 0;
    for (const k of Object.keys(S.padPaid || {})) S.padPaid[k] = 0;
  };

  // 1. Несём полную тележку от дальней стойки до кассы
  reset();
  const V = { x: 2.3, y: 3.5 };
  for (const c of [{ x: 6, y: 2 }, { x: 10, y: 2 }, { x: 14, y: 2 }, { x: 10, y: 7 }]) {
    reset();
    S.carry = actors.bagCap();
    actors.player.x = c.x + 1; actors.player.y = c.y + 0.95;
    actors.player.vx = 0; actors.player.vy = 0;
    const r = walkTo(V.x, V.y);
    out.push({ t: `дойти до кассы от стойки (${c.x},${c.y})`, ok: r.dist < 0.5 && r.lost <= 0.01,
               info: `дошёл на ${r.dist.toFixed(2)}, потеряно по пути ${Math.round(r.lost)}` });
  }

  // 2. Проходимость узких мест
  const gaps = [
    ['мимо постаматов с запада', 1.0, 4.5, 1.0, 11.0],
    ['между постаматами', 3.2, 7.3, 0.9, 7.3],
    ['за стойками верхнего ряда', 5.0, 1.2, 17.0, 1.2],
    ['между стойками нижнего ряда', 9.0, 9.0, 9.0, 5.6],
  ];
  for (const [name, sx, sy, tx, ty] of gaps) {
    reset();
    actors.player.x = sx; actors.player.y = sy;
    actors.player.vx = 0; actors.player.vy = 0;
    const r = walkTo(tx, ty, 18);
    out.push({ t: 'проход: ' + name, ok: r.dist < 0.6, info: `не дошёл ${r.dist.toFixed(2)} тайла` });
  }

  // 3. Проход насквозь через площадку не должен списывать
  reset();
  S.carry = 500;
  const pad = game.pads().find((x) => x.kind === 'up');
  const cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2;
  actors.player.x = cx - 3; actors.player.y = cy;
  actors.player.vx = 0; actors.player.vy = 0;
  const thru = walkTo(cx + 3, cy, 8);
  out.push({ t: 'пройти насквозь площадку', ok: thru.lost <= 0.01, info: `списано ${Math.round(thru.lost)}` });

  // 4. Встать на площадку — списывает
  reset();
  S.carry = 500;
  actors.player.x = cx; actors.player.y = cy;
  actors.player.vx = 0; actors.player.vy = 0;
  for (let i = 0; i < 60; i++) game.tick(0.05, { toast() {} });
  out.push({ t: 'встать на площадку', ok: (S.padPaid[pad.id] || 0) > 0,
             info: `оплачено ${Math.round(S.padPaid[pad.id] || 0)}` });

  return out;
});

let bad = 0;
for (const r of res) { if (!r.ok) bad++; console.log(`${r.ok ? '✓' : '✗'} ${r.t.padEnd(38)} ${r.info}`); }
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ дорога до кассы чистая, проходы проходимы');
console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
process.exit(bad ? 1 : 0);
