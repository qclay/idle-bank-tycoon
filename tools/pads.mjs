// Проверка надёжности площадок: подходим к каждой с разных сторон
// настоящей ходьбой (не телепортом) и смотрим, что оплата идёт.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.waitForTimeout(800);

const res = await p.evaluate(async () => {
  const { S, game, actors } = window.__game;
  const out = [];
  S.cash = 1e9;

  // подходим к паду с 8 сторон и держимся на нём 1.2 секунды
  // подходим с 8 сторон и стоим совсем недолго: важно, что оплата ПОШЛА,
  // а не что покупка успела завершиться
  const approach = (pad, angle) => {
    const cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2;
    actors.player.x = cx + Math.cos(angle) * 2.6;
    actors.player.y = cy + Math.sin(angle) * 2.6;
    actors.player.vx = 0; actors.player.vy = 0;
    let paid = 0, minD = 99;
    for (let i = 0; i < 2.0 / 0.03; i++) {
      const dx = cx - actors.player.x, dy = cy - actors.player.y;
      const d = Math.hypot(dx, dy);
      minD = Math.min(minD, d);
      actors.movePlayer(d > 0.12 ? dx / d : 0, d > 0.12 ? dy / d : 0, 0.03);
      game.tick(0.03, { toast() {} });
      paid = Math.max(paid, S.padPaid[pad.id] || 0);
    }
    return { paid, dist: minD };
  };

  const list = game.pads();
  for (const pad of list) {
    let arrived = 0, okCount = 0;
    const blocked = [];
    for (let a = 0; a < 8; a++) {
      S.padPaid[pad.id] = 0;
      const r = approach(pad, (a / 8) * Math.PI * 2);
      const got = r.dist < 0.9;   // дошёл вплотную
      if (got) arrived++; else blocked.push(Math.round((a / 8) * 360));
      if (got && r.paid > 0) okCount++;
    }
    S.padPaid[pad.id] = 0;
    out.push({ id: pad.id, title: pad.title, arrived, okCount, blocked });
  }
  return out;
});

let bad = 0;
for (const r of res) {
  const ok = r.okCount === r.arrived && r.arrived > 0;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${r.title.padEnd(16)} оплата пошла ${r.okCount}/${r.arrived} подходов` +
    (r.blocked.length ? `  (загорожено с ${r.blocked.join('°, ')}°)` : ''));
}
console.log(bad ? `\n✗ проблемных площадок: ${bad}` : '\n✓ площадки срабатывают везде, куда можно дойти');
console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
process.exit(bad ? 1 : 0);
