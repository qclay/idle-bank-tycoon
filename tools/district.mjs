// Гонка за район: соперник должен догонять, но обгоняться при активной игре,
// неделя должна закрываться с наградой, а награда — забираться один раз.
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const res = await p.evaluate(() => {
  const { S, district } = window.__game;
  S.level = window.__balance.DISTRICT.needLevel;   // гонка открывается с 15-го уровня
  const out = [];
  const sim = (mySpeed, secs) => {
    for (let i = 0; i < secs; i++) { district.addServed(mySpeed); district.tick(1); }
  };

  // 1. играем активно — должны вести
  district.ensure();
  S.district.my = 0; S.district.foe = 0; S.district.startedAt = Date.now() - 60000;
  sim(1.0, 3600);
  out.push({ t: 'активная игра — ведём', ok: S.district.my > S.district.foe,
             info: `вы ${Math.round(S.district.my)} против ${Math.round(S.district.foe)}` });

  // 2. забросили — соперник догоняет
  S.district.my = 0; S.district.foe = 0; S.district.startedAt = Date.now() - 60000;
  sim(1.0, 600);
  const before = S.district.my - S.district.foe;
  for (let i = 0; i < 3600; i++) district.tick(1);      // сутки без нас
  const after = S.district.my - S.district.foe;
  out.push({ t: 'бросили играть — отрыв тает', ok: after < before,
             info: `отрыв ${Math.round(before)} → ${Math.round(after)}` });

  // 3. соперник идёт даже при нулевой игре
  S.district.my = 0; S.district.foe = 0; S.district.startedAt = Date.now() - 60000;
  for (let i = 0; i < 3600; i++) district.tick(1);
  out.push({ t: 'соперник работает всегда', ok: S.district.foe > 0,
             info: `${Math.round(S.district.foe)} заказов` });

  // 4. закрытие недели: победа даёт награду
  S.district.my = 500; S.district.foe = 100;
  S.district.week -= 1;                     // как будто неделя кончилась
  const g0 = S.gold;
  district.ensure();
  const pend = district.pending();
  out.push({ t: 'неделя закрывается с итогом', ok: !!pend && pend.won,
             info: pend ? `победа, ${pend.gold} кристаллов` : 'итога нет' });
  const claimed = district.claim();
  out.push({ t: 'награда забирается', ok: !!claimed && S.gold === g0 + claimed.gold,
             info: `+${claimed ? claimed.gold : 0}` });
  out.push({ t: 'награда не забирается дважды', ok: district.claim() === null });

  // 5. поражение ослабляет соперника, победа усиливает
  const lvl0 = S.district.foeLvl;
  S.district.my = 0; S.district.foe = 900;
  S.district.week -= 1;
  district.ensure();
  district.claim();
  out.push({ t: 'после поражения соперник слабеет', ok: S.district.foeLvl < lvl0,
             info: `уровень ${lvl0} → ${S.district.foeLvl}` });

  // 6. оффлайн — вполсилы
  S.district.my = 0; S.district.foe = 0; S.district.startedAt = Date.now() - 3600e3;
  S.district.my = 600;
  const f0 = S.district.foe;
  district.advanceOffline(3600);
  const gained = S.district.foe - f0;
  const full = district.foeRate() * 3600;
  out.push({ t: 'офлайн соперник идёт вполсилы', ok: gained > 0 && gained < full * 0.6,
             info: `${Math.round(gained)} против ${Math.round(full)} в полную силу` });

  return out;
});

let bad = 0;
for (const r of res) { if (!r.ok) bad++; console.log(`${r.ok ? '✓' : '✗'} ${r.t.padEnd(36)} ${r.info || ''}`); }
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ гонка за район работает как задумано');
console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
process.exit(bad ? 1 : 0);
