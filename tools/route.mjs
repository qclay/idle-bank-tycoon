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
  const { S, game, actors, nav } = window.__game;
  const B = window.__balance;
  const out = [];

  // Игрок ходит сам, поэтому ведём его так же, как повёл бы человек: от проёма
  // к проёму. Если по такому маршруту не дойти — планировка непроходима.
  const reset = () => {
    S.cash = 0; S.carry = 0; S.padPaid = {};
    for (const c of B.COUNTERS) S.counters[c.id].cash = 0;
    for (const a of B.ATMS) S.atms[a.id].cash = 0;
  };

  const drive = (tx, ty, sec = 26) => {
    const p0 = actors.player;
    const start = S.cash + S.carry;
    let lost = 0;
    let path = nav.path(p0.x, p0.y, tx, ty);
    let i = 0;
    for (let n = 0; n < sec * 60; n++) {
      const w = path[Math.min(i, path.length - 1)];
      const dx = w.x - p0.x, dy = w.y - p0.y;
      const d = Math.hypot(dx, dy);
      const last = i >= path.length - 1;
      if (d < (last ? 0.25 : 0.35)) { if (last) break; i++; continue; }
      actors.movePlayer(dx / d, dy / d, 1 / 60);
      game.tick(1 / 60, null);
      lost = Math.max(lost, start - (S.cash + S.carry));
    }
    return { dist: Math.hypot(p0.x - tx, p0.y - ty), lost };
  };

  // 1. С каждой стойки можно дойти до кассы и ничего не потерять по пути
  const V = B.VAULT.drop;
  for (const c of B.COUNTERS) {
    reset();
    S.carry = actors.bagCap();
    const sp = actors.pickSpot(c);
    actors.player.x = sp.x; actors.player.y = sp.y;
    actors.player.vx = 0; actors.player.vy = 0;
    const r = drive(V.x, V.y);
    out.push({ t: `до кассы от «${c.name}»`, ok: r.dist < 0.6 && r.lost <= 0.01,
               info: `дошёл на ${r.dist.toFixed(2)}, потеряно ${Math.round(r.lost)}` });
  }

  // 2. Каждый проём проходим в обе стороны
  for (const d of B.DOORWAYS) {
    const a = B.ROOMS.find((r) => r.id === d.a), b = B.ROOMS.find((r) => r.id === d.b);
    // Центр комнаты может оказаться занят мебелью (в кассе там сейф), поэтому
    // ищем ближайшую к центру свободную точку.
    const mid = (r) => {
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      let best = { x: cx, y: cy }, bd = 1e9;
      for (let y = r.y0 + 0.6; y < r.y1 - 0.6; y += 0.4) {
        for (let x = r.x0 + 0.6; x < r.x1 - 0.6; x += 0.4) {
          if (actors.blocked(x, y)) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
      return best;
    };
    for (const [from, to] of [[a, b], [b, a]]) {
      reset();
      const s0 = mid(from), s1 = mid(to);
      actors.player.x = s0.x; actors.player.y = s0.y;
      actors.player.vx = 0; actors.player.vy = 0;
      const r = drive(s1.x, s1.y);
      out.push({ t: `проём ${from.name} → ${to.name}`, ok: r.dist < 0.8,
                 info: `не дошёл ${r.dist.toFixed(2)}` });
    }
  }

  // 3. Через площадку можно пройти насквозь и не заплатить
  reset();
  S.cash = 5e6;
  const pad = game.pads()[0];
  actors.player.x = pad.x + pad.w / 2; actors.player.y = pad.y + pad.h + 1.6;
  const before = S.cash;
  for (let n = 0; n < 150; n++) { actors.movePlayer(0, -1, 1 / 60); game.tick(1 / 60, null); }
  out.push({ t: 'пройти насквозь площадку', ok: before - S.cash < 1,
             info: `списано ${Math.round(before - S.cash)}` });

  // 4. А если встать — заплатить
  reset();
  S.cash = 5e6;
  actors.player.x = pad.x + pad.w / 2; actors.player.y = pad.y + pad.h / 2;
  actors.player.vx = 0; actors.player.vy = 0;
  for (let n = 0; n < 90; n++) { actors.movePlayer(0, 0, 1 / 60); game.tick(1 / 60, null); }
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
