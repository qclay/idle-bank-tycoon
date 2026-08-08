// Прогон симуляции в headless-браузере: проверяем, что конвейер реально доносит
// деньги до хранилища, что нет NaN/Infinity и что вехи считаются.
// node tools/sim.mjs [минут]
import { chromium } from 'playwright';

const minutes = Number(process.argv[2] || 10);
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(URL);
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

const out = await p.evaluate((mins) => {
  const { S, engine } = window.__game;
  const log = [];
  const bad = [];
  const check = (label) => {
    const vals = [S.cash, S.gold, engine.incomePerSec()];
    for (const v of vals) if (!isFinite(v)) bad.push(`${label}: не число ${v}`);
  };

  // Чистый старт
  S.cash = 0; S.gold = 0;
  S.banks[0].floors.forEach((f, i) => { f.lvl = i === 0 ? 1 : 0; f.mgr = false; f.stack = 0; f.prog = 0; f.run = false; });
  S.banks[0].elev = { lvl: 1, mgr: true, load: 0, pos: 0, dir: 1, run: false, phase: 'idle', t: 0 };
  S.banks[0].vault = { lvl: 1, mgr: true, load: 0, prog: 0, run: false };
  S.banks[0].floors[0].mgr = true;
  engine.invalidateBonuses();

  const dt = 0.05;
  const steps = Math.round((mins * 60) / dt);
  let lastCash = 0;
  for (let k = 0; k < steps; k++) {
    engine.step(dt, 0);
    // Раз в 10 игровых секунд играем как живой игрок:
    // сначала вкладываемся в узкое место, потом открываем новые отделы.
    if (k % Math.round(10 / dt) === 0 && k > 0) {
      for (let pass = 0; pass < 200; pass++) {
        let any = false;
        const neck = engine.bottleneck(0);
        // Новый отдел — всегда в приоритете: так играет живой человек
        const next = S.banks[0].floors.findIndex((f) => f.lvl === 0);
        if (next >= 0 && S.cash >= engine.floorUnlockCost(next)) { engine.unlockFloor(next); any = true; }
        else if (neck === 'elev' && S.cash >= engine.elevUpCost(1)) { engine.upgradeElev(1); any = true; }
        else if (neck === 'vault' && S.cash >= engine.vaultUpCost(1)) { engine.upgradeVault(1); any = true; }
        else {
          {
            // иначе качаем самый доходный из открытых
            let best = -1, bestCost = Infinity;
            for (let i = 0; i < 15; i++) {
              const f = S.banks[0].floors[i];
              if (f.lvl <= 0) continue;
              const c = engine.floorUpCost(i, 1);
              if (c <= S.cash && c < bestCost) { best = i; bestCost = c; }
            }
            if (best >= 0) { engine.upgradeFloor(best, 1); any = true; }
          }
        }
        // менеджеры — как только становятся доступны без ущерба
        for (let i = 0; i < 15; i++) {
          const f = S.banks[0].floors[i];
          if (f.lvl > 0 && !f.mgr && S.cash >= engine.floorMgrCost(i) * 2) { engine.hireFloorMgr(i); any = true; }
        }
        if (!any) break;
      }
      if (k % Math.round(60 / dt) !== 0) continue;
      log.push({
        min: Math.round(k * dt / 60),
        cash: S.cash, inc: engine.incomePerSec(),
        floors: S.banks[0].floors.filter((f) => f.lvl > 0).length,
        maxLvl: Math.max(...S.banks[0].floors.map((f) => f.lvl)),
        elev: S.banks[0].elev.lvl, vault: S.banks[0].vault.lvl,
        neck: engine.bottleneck(0),
      });
      check('мин ' + Math.round(k * dt / 60));
      lastCash = S.cash;
    }
  }
  return { log, bad, totalEarned: S.stats.totalEarned, milestones: S.stats.milestones, level: S.level };
}, minutes);

console.log('минута | наличные | доход/с | отделов | макс.ур | лифт | хранил | узкое место');
for (const r of out.log) {
  console.log(
    String(r.min).padStart(6),
    '|', fmtN(r.cash).padStart(9),
    '|', fmtN(r.inc).padStart(8),
    '|', String(r.floors).padStart(7),
    '|', String(r.maxLvl).padStart(7),
    '|', String(r.elev).padStart(4),
    '|', String(r.vault).padStart(6),
    '|', r.neck,
  );
}
console.log('\nвсего заработано:', fmtN(out.totalEarned), '· вех:', out.milestones, '· уровень:', out.level);
console.log('проблемы:', out.bad.length ? out.bad : 'нет');
console.log('ошибки страницы:', errs.length ? errs : 'нет');
await b.close();

function fmtN(v) {
  if (!isFinite(v)) return String(v);
  if (v === 0) return '0';
  if (v < 1e6) return v.toFixed(1);
  return v.toExponential(2);
}
