// Темп развития. Считаем экономику по формулам самой игры, без беготни героя:
// это верхняя граница скорости — быстрее пройти нельзя.
//
// node tools/pace.mjs [часов] [активных_минут_в_сутки]
import { chromium } from 'playwright';

const HOURS = Number(process.argv[2] || 72);
const ACTIVE = Number(process.argv[3] || 60);   // сколько минут в сутки играем руками
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

const out = await p.evaluate(([hours, activeMin]) => {
  const { S, game } = window.__game;
  const B = window.__balance;
  const log = [];

  // чистый старт
  for (const c of B.COUNTERS) S.counters[c.id] = { open: c.id === 'c1', lvl: 1, cash: 0, clerk: 0 };
  for (const a of B.ATMS) S.atms[a.id] = { open: false, lvl: 1, cash: 0 };
  for (const z of B.ZONES) S.zones[z.id] = { open: false, lvl: 1 };
  for (const k of Object.keys(B.UPGRADES)) S.ups[k] = 0;
  S.cash = 0; S.carry = 0; S.gold = 25; S.runner = 0; S.level = 1; S.xp = 0;

  let t = 0;                       // секунд с начала
  const seen = new Set();
  const mark = (what) => {
    const h = Math.floor(t / 3600), m = Math.round((t % 3600) / 60);
    log.push({ when: h ? `${h} ч ${m} м` : `${m} м`, what, inc: income() });
  };

  const openCounters = () => B.COUNTERS.filter((c) => S.counters[c.id].open);

  /** Пропускная способность: клиенты приходят, стойки их разбирают. */
  function income(active = true) {
    const list = openCounters();
    if (!list.length) return 0;
    const spawn = 1 / spawnSec();
    let cap = 0, pay = 0;
    let manned = false;
    for (const c of list) {
      const st = S.counters[c.id];
      let sp = st.clerk > 0 ? game.clerkSpeed(c) : 0;
      if (sp === 0 && active && !manned) { sp = 1; manned = true; }   // игрок за одной стойкой
      if (sp <= 0) continue;
      const thr = sp / B.CUSTOMER.serveTime;
      cap += thr;
      pay += thr * game.counterPay(c);
    }
    let inc = 0;
    if (cap > 0) inc = (pay / cap) * Math.min(spawn, cap);
    for (const a of B.ATMS) if (S.atms[a.id].open) inc += game.atmRate(a);
    return inc;
  }
  function spawnSec() {
    const n = openCounters().length;
    let z = 0;
    for (const zz of B.ZONES) { const st = S.zones[zz.id]; if (st.open && zz.effect === 'spawn') z += zz.step * st.lvl; }
    return Math.max(B.CUSTOMER.minSpawn,
      B.CUSTOMER.spawnBase * B.CUSTOMER.spawnPerCounter ** Math.max(0, n - 1) / (1 + z));
  }

  /** Тратим деньги как разумный игрок: новые объекты → персонал → уровни. */
  function spend() {
    let did = false;
    for (let guard = 0; guard < 40; guard++) {
      let acted = false;

      // следующий объект по порядку
      const nc = B.COUNTERS.find((c) => !S.counters[c.id].open);
      const na = B.ATMS.find((a) => !S.atms[a.id].open);
      const nz = B.ZONES.find((z) => !S.zones[z.id].open);
      const cands = [];
      if (nc) cands.push({ cost: nc.cost, go: () => { S.counters[nc.id].open = true; mark('стойка: ' + nc.name); } });
      if (na) cands.push({ cost: na.cost, go: () => { S.atms[na.id].open = true; mark('постамат'); } });
      if (nz) cands.push({ cost: nz.cost, go: () => { S.zones[nz.id].open = true; mark('зона: ' + nz.name); } });
      cands.sort((x, y) => x.cost - y.cost);
      if (cands.length && S.cash >= cands[0].cost) { S.cash -= cands[0].cost; cands[0].go(); acted = true; }

      if (!acted && S.runner === 0 && S.cash >= game.runnerCost()) {
        S.cash -= game.runnerCost(); S.runner = 1; mark('администратор'); acted = true;
      }
      if (!acted) {
        for (const c of openCounters()) {
          const st = S.counters[c.id];
          if (st.clerk === 0 && S.cash >= game.clerkCost(c)) {
            S.cash -= game.clerkCost(c); st.clerk = 1; mark('оператор: ' + c.name); acted = true; break;
          }
        }
      }
      if (!acted) {
        // самый дешёвый уровень
        let best = null, cost = Infinity;
        for (const c of openCounters()) {
          const q = game.counterUpCost(c);
          if (q < cost) { cost = q; best = c; }
        }
        if (best && S.cash >= cost) { S.cash -= cost; S.counters[best.id].lvl++; acted = true; }
      }
      if (!acted) break;
      did = true;
    }
    return did;
  }

  // бесплатная посылка раз в 3 часа
  let giftAt = 0;
  const step = 1;                                  // секунда
  const dayActive = activeMin * 60;
  for (; t < hours * 3600; t += step) {
    const inDay = t % 86400;
    const active = inDay < dayActive;              // играем в начале суток
    const inc = income(active);
    S.cash += inc * step * (active ? 1 : B.OFFLINE.rate);
    if (t >= giftAt) {
      giftAt = t + B.SAFES.free.cd;
      const s = B.SAFES.free;
      const base = Math.max(income(false), 4);
      S.cash += base * 3600 * (s.cashMin + s.cashMax) / 2;
      if (t === 0) mark('стартовая посылка');
    }
    spend();
  }

  return {
    log,
    end: {
      counters: openCounters().length, atms: B.ATMS.filter((a) => S.atms[a.id].open).length,
      zones: B.ZONES.filter((z) => S.zones[z.id].open).length,
      lvl: Math.max(...B.COUNTERS.map((c) => S.counters[c.id].lvl)),
      inc: income(false), cash: S.cash,
    },
  };
}, [HOURS, ACTIVE]);

const f = (v) => (v >= 1e6 ? v.toExponential(2) : Math.round(v).toLocaleString('ru-RU'));
console.log(`активная игра ${ACTIVE} мин в сутки, горизонт ${HOURS} ч\n`);
console.log('когда        | что открылось                | доход/с после');
for (const r of out.log) console.log(r.when.padEnd(12), '|', r.what.padEnd(28), '|', f(r.inc));
const e = out.end;
console.log(`\nитог: стоек ${e.counters}/6, постаматов ${e.atms}/4, зон ${e.zones}/4, макс. уровень ${e.lvl}`);
console.log('доход', f(e.inc), 'в секунду');
console.log('ошибки:', errs.length ? errs : 'нет');
await b.close();
