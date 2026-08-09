// Темп игры: сколько раз в минуту от игрока требуется действие. Он должен
// оставаться примерно ровным на всём развитии — рост показывают деньги, а не
// беготня. Когда сумка росла линейно, а доход экспоненциально, здесь были
// тысячи ходок в минуту, и игра превращалась в суету.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8199/index.html');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
const r = await p.evaluate(() => {
  const { S, game, actors, reviews, smm } = window.__game;
  const B = window.__balance;
  const out = [];
  const stages = [
    ['старт',      1, 1, 0, 0, 0],
    ['3 стойки',   3, 4, 1, 0, 0],
    ['5 стоек',    5, 9, 3, 6, 2],
    ['всё открыто',6, 16, 6, 12, 5],
  ];
  for (const [name, nc, lvl, clerk, coffee, smmL] of stages) {
    for (const [i, c] of B.COUNTERS.entries()) {
      S.counters[c.id].open = i < nc; S.counters[c.id].lvl = lvl; S.counters[c.id].clerk = clerk;
    }
    S.zones.z_coffee.open = coffee > 0; S.zones.z_coffee.lvl = coffee || 1;
    S.smm.lvl = smmL;
    S.ups.bag = lvl * 3;
    const t = actors.spawnRate();
    const perMin = 60 / t;
    // сколько раз в минуту игроку надо подойти к стойке и отнести в кассу
    let trips = 0, income = 0;
    for (const c of B.COUNTERS.filter((_, i) => i < nc)) {
      const pay = game.counterPay(c);
      const cap = game.trayCap(c);
      const share = perMin / nc;                  // клиентов на стойку в минуту
      trips += (share * pay) / cap;               // столько раз лоток наполнится
      income += share * pay;
    }
    const bag = actors.bagCap();
    const vaultTrips = income / bag;              // столько ходок до кассы
    out.push({ этап: name, клиентовВМинуту: +perMin.toFixed(0),
               подходовКСтойкам: +trips.toFixed(1), ходокВКассу: +vaultTrips.toFixed(1),
               всегоДействий: +(trips + vaultTrips).toFixed(1),
               доходВСек: Math.round(income / 60) });
  }
  return out;
});
console.table(r);

const checks = [];
const ok = (n, c, i = '') => checks.push({ n, c: !!c, i });
const late = r[r.length - 1], mid = r[1];
ok('поток людей упирается в потолок', late.клиентовВМинуту <= 70,
   `${late.клиентовВМинуту} клиентов в минуту`);
ok('к концу игры действий не больше, чем в начале',
   late.всегоДействий <= r[0].всегоДействий,
   `старт ${r[0].всегоДействий}, финал ${late.всегоДействий} в минуту`);
ok('темп не разгоняется по ходу развития', late.всегоДействий <= mid.всегоДействий,
   `середина ${mid.всегоДействий}, финал ${late.всегоДействий}`);
ok('но и совсем без дела не оставляет', late.всегоДействий >= 2,
   `${late.всегоДействий} действий в минуту`);
ok('доход при этом растёт на порядки', late.доходВСек > r[0].доходВСек * 100,
   `${r[0].доходВСек} → ${late.доходВСек} в секунду`);

for (const c of checks) console.log(`${c.c ? '✓' : '✗'} ${c.n}${c.i ? '  — ' + c.i : ''}`);
const bad = checks.filter((c) => !c.c).length;
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ темп ровный: рост виден по деньгам, а не по беготне');
await b.close();
process.exit(bad ? 1 : 0);
