// Оплата площадки: работает и со счёта, и с денег в руках.
// Пустой кошелёк — единственный случай, когда площадка молчит.
import { chromium } from 'playwright';
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const r = await p.evaluate(() => {
  const { S, game, actors } = window.__game;
  const out = [];
  const pad = game.pads().find((x) => x.up === 'bag');
  const cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2;

  const stand = (label) => {
    S.padPaid[pad.id] = 0;
    actors.player.x = cx; actors.player.y = cy;
    actors.player.vx = 0; actors.player.vy = 0;
    for (let i = 0; i < 40; i++) game.tick(0.05, { toast() {} });
    out.push({ label, cash: Math.round(S.cash), carry: Math.round(S.carry),
               paid: Math.round(S.padPaid[pad.id] || 0), need: pad.cost });
  };

  // 1. деньги на счету
  S.cash = 5000; S.carry = 0;
  stand('деньги на счету');

  // 2. деньги только в руках (обычная ситуация новичка)
  S.cash = 0; S.carry = 5000;
  stand('деньги только в руках');

  // 3. пусто
  S.cash = 0; S.carry = 0;
  stand('пусто');
  return out;
});

let bad = 0;
for (const x of r) {
  const want = x.label !== 'пусто';          // при пустом кошельке оплаты быть не должно
  const okc = (x.paid > 0) === want;
  if (!okc) bad++;
  console.log(`${okc ? '✓' : '✗'} ${x.label.padEnd(24)} счёт ${String(x.cash).padStart(6)} · в руках ${String(x.carry).padStart(6)} → оплачено ${x.paid} из ${x.need}`);
}
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ оплата площадок работает как задумано');
await b.close();
process.exit(bad ? 1 : 0);
