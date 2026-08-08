// Игровой движок: экономика, симуляция конвейера отдел → лифт → хранилище,
// апгрейды, менеджеры, вехи, оффлайн-доход.

import {
  CURVE, FLOOR_DEFS, FLOOR_COUNT, BANKS, XP, xpForLevel, BOOSTS, OFFLINE,
  SUPER_MANAGERS, RARITY, SM_LEVEL_POWER, BOARD_UPGRADES, PRESTIGE, sharesFor,
  milestonesUpTo, nextMilestone, MILESTONE_EFFECT, CONTRACTS, MAX_LEVEL,
  floorBase, floorTrip, floorCapBase, elevCapBase, vaultCapBase,
} from './balance.js';
import { S, bank, bankDef, save, emit } from './state.js';

// ── Бонусы ────────────────────────────────────────────────────────────────────

let bonusCache = null;
export function invalidateBonuses() { bonusCache = null; }

export function bonuses() {
  if (bonusCache) return bonusCache;
  const b = {
    floorSpeed: 1, floorCap: 1, elevAll: 1, vaultAll: 1,
    allIncome: 1, offline: 1, tapValue: 1, costCut: 0, startFloors: 0,
  };
  // Супер-менеджеры в слотах
  for (const id of S.sm.equipped) {
    if (!id) continue;
    const def = SUPER_MANAGERS.find((m) => m.id === id);
    const card = S.sm.cards[id];
    if (!def || !card) continue;
    const power = RARITY[def.rarity].power * (SM_LEVEL_POWER[card.level - 1] || 1);
    const v = def.bonus.v * power;
    if (def.bonus.kind === 'costCut') b.costCut += v;
    else b[def.bonus.kind] += v;
  }
  // Совет директоров
  for (const u of BOARD_UPGRADES) {
    const lvl = S.board[u.id] || 0;
    if (!lvl) continue;
    if (u.kind === 'costCut') b.costCut += u.v * lvl;
    else if (u.kind === 'startFloors') b.startFloors += u.v * lvl;
    else b[u.kind] += u.v * lvl;
  }
  // Акции
  b.allIncome += S.shares * PRESTIGE.bonusPerShare;
  b.costCut = Math.min(0.6, b.costCut);
  bonusCache = b;
  return b;
}

export function boostMult() {
  const now = Date.now();
  let m = 1;
  const inc = S.boosts[BOOSTS.income2x.id];
  if (inc && inc.until > now) m *= BOOSTS.income2x.mult;
  return m;
}

export function turboMult() {
  const now = Date.now();
  const t = S.boosts[BOOSTS.turbo.id];
  return t && t.until > now ? BOOSTS.turbo.mult : 1;
}

export function boostLeft(id) {
  const b = S.boosts[id];
  return b ? Math.max(0, (b.until - Date.now()) / 1000) : 0;
}

// ── Стоимости ─────────────────────────────────────────────────────────────────

export function bankMult(bi = S.bankIdx) { return BANKS[bi].mult; }
function costK() { return 1 - bonuses().costCut; }

const floorBaseCost = floorBase;

export function floorUnlockCost(i, bi = S.bankIdx) {
  return floorBaseCost(i) * bankMult(bi) * costK();
}

export function floorUpCostAt(i, lvl, bi = S.bankIdx) {
  return floorBaseCost(i) * CURVE.floorUpCostRatio * CURVE.floorUpCostGrow ** (lvl - 1)
    * bankMult(bi) * costK();
}

/** Цена n уровней подряд, начиная с текущего. */
export function floorUpCost(i, n, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  if (f.lvl <= 0) return floorUnlockCost(i, bi);
  const g = CURVE.floorUpCostGrow;
  const first = floorUpCostAt(i, f.lvl, bi);
  return first * (g ** n - 1) / (g - 1);
}

/** Сколько уровней можно купить на сумму cash. */
export function floorMaxLevels(i, cash, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  if (f.lvl <= 0) return cash >= floorUnlockCost(i, bi) ? 1 : 0;
  const g = CURVE.floorUpCostGrow;
  const first = floorUpCostAt(i, f.lvl, bi);
  if (cash < first) return 0;
  const n = Math.floor(Math.log(1 + (cash * (g - 1)) / first) / Math.log(g));
  return Math.max(0, Math.min(n, MAX_LEVEL - f.lvl));
}

function unitCost(base, grow, lvl, bi) { return base * grow ** (lvl - 1) * bankMult(bi) * costK(); }

export function elevUpCost(n = 1, bi = S.bankIdx) {
  const g = CURVE.elevCostGrow;
  const first = unitCost(CURVE.elevCostBase, g, S.banks[bi].elev.lvl, bi);
  return first * (g ** n - 1) / (g - 1);
}
export function vaultUpCost(n = 1, bi = S.bankIdx) {
  const g = CURVE.vaultCostGrow;
  const first = unitCost(CURVE.vaultCostBase, g, S.banks[bi].vault.lvl, bi);
  return first * (g ** n - 1) / (g - 1);
}
export function elevMaxLevels(cash, bi = S.bankIdx) {
  const g = CURVE.elevCostGrow;
  const first = unitCost(CURVE.elevCostBase, g, S.banks[bi].elev.lvl, bi);
  if (cash < first) return 0;
  return Math.max(0, Math.min(MAX_LEVEL - S.banks[bi].elev.lvl,
    Math.floor(Math.log(1 + (cash * (g - 1)) / first) / Math.log(g))));
}
export function vaultMaxLevels(cash, bi = S.bankIdx) {
  const g = CURVE.vaultCostGrow;
  const first = unitCost(CURVE.vaultCostBase, g, S.banks[bi].vault.lvl, bi);
  if (cash < first) return 0;
  return Math.max(0, Math.min(MAX_LEVEL - S.banks[bi].vault.lvl,
    Math.floor(Math.log(1 + (cash * (g - 1)) / first) / Math.log(g))));
}

export function floorMgrCost(i, bi = S.bankIdx) {
  return floorBaseCost(i) * CURVE.managerCostRatio * bankMult(bi) * costK();
}
export function elevMgrCost(bi = S.bankIdx) { return CURVE.elevManagerCost * bankMult(bi) * costK(); }
export function vaultMgrCost(bi = S.bankIdx) { return CURVE.vaultManagerCost * bankMult(bi) * costK(); }

// ── Характеристики юнитов ─────────────────────────────────────────────────────

// Счёт вех вызывается каждый кадр для каждого объекта — кешируем по уровню.
const msCache = new Map();
function msCounts(lvl) {
  const hit = msCache.get(lvl);
  if (hit) return hit;
  let worker = 0, speed = 0, cap = 0;
  for (const m of milestonesUpTo(lvl)) {
    if (m.type === 'worker') worker++;
    else if (m.type === 'speed') speed++;
    else cap++;
  }
  const r = { worker, speed, cap };
  if (msCache.size > 4000) msCache.clear();
  msCache.set(lvl, r);
  return r;
}

/** Страховка: в игре не должно появляться NaN/Infinity. */
function safe(v, fallback = 0) { return Number.isFinite(v) ? v : fallback; }
const MAX_NUM = 1e300;
function clamp(v) { return Math.min(safe(v), MAX_NUM); }

export function floorStats(i, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  const B = bonuses();
  if (f.lvl <= 0) return { locked: true, workers: 0, capacity: 0, trip: 1, rate: 0, stackCap: 0 };
  const ms = msCounts(f.lvl);
  let workers = 1 + ms.worker;
  let capMs = ms.cap;
  if (workers > CURVE.maxWorkers) { capMs += workers - CURVE.maxWorkers; workers = CURVE.maxWorkers; }
  const capacity = clamp(floorCapBase(i) * CURVE.floorCapLevelGrow ** (f.lvl - 1)
    * 2 ** capMs * bankMult(bi) * B.floorCap);
  const speedMult = Math.min(CURVE.maxSpeedMult, MILESTONE_EFFECT.speed ** ms.speed);
  const trip = Math.max(CURVE.minTripTime,
    floorTrip(i) / speedMult / B.floorSpeed / turboMult());
  return {
    locked: false, workers, capacity, trip,
    rate: clamp((workers * capacity) / trip),
    stackCap: clamp(workers * capacity * 8),
    ms,
  };
}

export function elevStats(bi = S.bankIdx) {
  const e = S.banks[bi].elev;
  const B = bonuses();
  const ms = msCounts(e.lvl);
  const capMs = ms.cap + ms.worker * 0.585;  // «клерк» у лифта = ×1.5 к вместимости
  const capacity = clamp(elevCapBase() * CURVE.elevCapGrow ** (e.lvl - 1)
    * 2 ** capMs * bankMult(bi) * B.elevAll);
  const speedMult = Math.min(CURVE.maxSpeedMult, MILESTONE_EFFECT.speed ** ms.speed);
  const trip = Math.max(1.0, CURVE.elevTripBase / speedMult / turboMult());
  return { capacity, trip, rate: clamp(capacity / trip), ms };
}

export function vaultStats(bi = S.bankIdx) {
  const v = S.banks[bi].vault;
  const B = bonuses();
  const ms = msCounts(v.lvl);
  const capMs = ms.cap + ms.worker * 0.585;
  const capacity = clamp(vaultCapBase() * CURVE.vaultCapGrow ** (v.lvl - 1)
    * 2 ** capMs * bankMult(bi) * B.vaultAll);
  const speedMult = Math.min(CURVE.maxSpeedMult, MILESTONE_EFFECT.speed ** ms.speed);
  const time = Math.max(0.35, CURVE.vaultTimeBase / speedMult / turboMult());
  return { capacity, time, rate: clamp(capacity / time), cap: clamp(capacity * 4), ms };
}

export function openFloors(bi = S.bankIdx) {
  return S.banks[bi].floors.filter((f) => f.lvl > 0).length;
}

/** Узкое место конвейера: 'floors' | 'elev' | 'vault'. */
export function bottleneck(bi = S.bankIdx) {
  const fr = S.banks[bi].floors.reduce((a, _, i) => a + floorStats(i, bi).rate, 0);
  const er = elevStats(bi).rate;
  const vr = vaultStats(bi).rate;
  const m = Math.min(fr, er, vr);
  if (m === vr && vr < er) return 'vault';
  if (m === er) return 'elev';
  if (m === vr) return 'vault';
  return 'floors';
}

/** Доход в секунду с учётом всех множителей (то, что показываем в шапке). */
export function incomePerSec(bi = S.bankIdx, requireManagers = false) {
  const b = S.banks[bi];
  let fr = 0;
  for (let i = 0; i < FLOOR_COUNT; i++) {
    if (b.floors[i].lvl <= 0) continue;
    if (requireManagers && !b.floors[i].mgr) continue;
    fr += floorStats(i, bi).rate;
  }
  const er = requireManagers && !b.elev.mgr ? 0 : elevStats(bi).rate;
  const vr = requireManagers && !b.vault.mgr ? 0 : vaultStats(bi).rate;
  const raw = Math.min(fr, er, vr);
  return raw * bonuses().allIncome * boostMult();
}

// ── Изменение состояния ───────────────────────────────────────────────────────

export function addCash(v) {
  if (!(v > 0) || !Number.isFinite(v)) return;
  S.cash = clamp(S.cash + v);
  S.stats.totalEarned = clamp(S.stats.totalEarned + v);
  S.stats.runEarned = clamp(S.stats.runEarned + v);
  bank().earned = clamp(bank().earned + v);
  bumpDaily('earnedRaw', v);
}

export function spendCash(v) {
  if (!Number.isFinite(v) || S.cash < v) return false;
  S.cash -= v;
  return true;
}

export function addGold(v) { S.gold += v; }
export function spendGold(v) { if (S.gold < v) return false; S.gold -= v; return true; }

export function addXp(v) {
  S.xp += v;
  let leveled = 0;
  while (S.xp >= xpForLevel(S.level)) {
    S.xp -= xpForLevel(S.level);
    S.level++;
    leveled++;
    S.gold += XP.goldPerLevel;
    if (S.level % XP.goldBonusEvery === 0) S.gold += XP.goldBonus;
  }
  if (leveled) emit('levelup');
}

function bumpDaily(key, v = 1) {
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters[key] = (S.daily.counters[key] || 0) + v;
}

function bumpStat(key, v = 1) {
  S.stats[key] = (S.stats[key] || 0) + v;
  bumpDaily(key, v);
}

// ── Действия игрока ───────────────────────────────────────────────────────────

export function unlockFloor(i, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  if (f.lvl > 0) return false;
  const cost = floorUnlockCost(i, bi);
  if (!spendCash(cost)) return false;
  f.lvl = 1;
  bumpStat('floorsOpen');
  addXp(XP.perUnlock);
  emit('unlock');
  save();
  return true;
}

/** Апгрейд отдела на n уровней ('max' — сколько хватит денег). */
export function upgradeFloor(i, n, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  if (f.lvl <= 0) return unlockFloor(i, bi);
  let count = n === 'max' ? floorMaxLevels(i, S.cash, bi) : n;
  if (count <= 0) return false;
  let cost = floorUpCost(i, count, bi);
  if (cost > S.cash) {
    count = floorMaxLevels(i, S.cash, bi);
    if (count <= 0) return false;
    cost = floorUpCost(i, count, bi);
  }
  if (!spendCash(cost)) return false;
  const before = f.lvl;
  f.lvl += count;
  countMilestones(before, f.lvl);
  bumpStat('upgrades', count);
  S.stats.maxFloorLvl = Math.max(S.stats.maxFloorLvl, f.lvl);
  addXp(XP.perUpgrade * Math.min(count, 50));
  emit('upgrade');
  save();
  return true;
}

export function upgradeElev(n, bi = S.bankIdx) {
  const e = S.banks[bi].elev;
  let count = n === 'max' ? elevMaxLevels(S.cash, bi) : n;
  if (count <= 0) return false;
  let cost = elevUpCost(count, bi);
  if (cost > S.cash) { count = elevMaxLevels(S.cash, bi); if (count <= 0) return false; cost = elevUpCost(count, bi); }
  if (!spendCash(cost)) return false;
  const before = e.lvl;
  e.lvl += count;
  countMilestones(before, e.lvl);
  bumpStat('elevUp', count);
  bumpStat('upgrades', count);
  addXp(XP.perUpgrade * Math.min(count, 50));
  emit('upgrade');
  save();
  return true;
}

export function upgradeVault(n, bi = S.bankIdx) {
  const v = S.banks[bi].vault;
  let count = n === 'max' ? vaultMaxLevels(S.cash, bi) : n;
  if (count <= 0) return false;
  let cost = vaultUpCost(count, bi);
  if (cost > S.cash) { count = vaultMaxLevels(S.cash, bi); if (count <= 0) return false; cost = vaultUpCost(count, bi); }
  if (!spendCash(cost)) return false;
  const before = v.lvl;
  v.lvl += count;
  countMilestones(before, v.lvl);
  bumpStat('vaultUp', count);
  bumpStat('upgrades', count);
  addXp(XP.perUpgrade * Math.min(count, 50));
  emit('upgrade');
  save();
  return true;
}

function countMilestones(from, to) {
  const a = milestonesUpTo(from).length;
  const b = milestonesUpTo(to).length;
  if (b > a) { bumpStat('milestones', b - a); emit('milestone'); }
}

export function hireFloorMgr(i, bi = S.bankIdx) {
  const f = S.banks[bi].floors[i];
  if (f.mgr || f.lvl <= 0) return false;
  if (!spendCash(floorMgrCost(i, bi))) return false;
  f.mgr = true; f.run = true;
  bumpStat('managers');
  addXp(XP.perManager);
  emit('manager');
  save();
  return true;
}
export function hireElevMgr(bi = S.bankIdx) {
  const e = S.banks[bi].elev;
  if (e.mgr) return false;
  if (!spendCash(elevMgrCost(bi))) return false;
  e.mgr = true; e.run = true;
  bumpStat('managers'); addXp(XP.perManager); emit('manager'); save();
  return true;
}
export function hireVaultMgr(bi = S.bankIdx) {
  const v = S.banks[bi].vault;
  if (v.mgr) return false;
  if (!spendCash(vaultMgrCost(bi))) return false;
  v.mgr = true; v.run = true;
  bumpStat('managers'); addXp(XP.perManager); emit('manager'); save();
  return true;
}

/** Ручное обслуживание: тап по стойке отдела. */
export function tapFloor(i, bi = S.bankIdx) {
  const b = S.banks[bi];
  const f = b.floors[i];
  if (f.lvl <= 0) return false;
  const st = floorStats(i, bi);
  if (!f.mgr) { f.run = true; }
  else { f.prog = Math.min(0.999, f.prog + 0.35); }
  // Бонус за ручное обслуживание
  const extra = st.capacity * bonuses().tapValue * 0.25;
  f.stack = Math.min(st.stackCap, f.stack + extra);
  bumpStat('taps');
  return true;
}

export function tapElev(bi = S.bankIdx) {
  const e = S.banks[bi].elev;
  if (!e.mgr) e.run = true;
  bumpStat('taps');
  return true;
}

export function tapVault(bi = S.bankIdx) {
  const v = S.banks[bi].vault;
  if (!v.mgr) v.run = true;
  bumpStat('taps');
  return true;
}

// ── Симуляция ─────────────────────────────────────────────────────────────────

export function step(dt, bi = S.bankIdx) {
  const b = S.banks[bi];
  const nOpen = openFloors(bi);
  if (!nOpen) return;

  // 1. Отделы
  for (let i = 0; i < FLOOR_COUNT; i++) {
    const f = b.floors[i];
    if (f.lvl <= 0) continue;
    const st = floorStats(i, bi);
    const active = f.mgr || f.run;
    if (!active) { f.prog = 0; continue; }
    if (f.stack >= st.stackCap) { continue; }   // некуда складывать — клерки ждут
    f.prog += dt / st.trip;
    while (f.prog >= 1) {
      f.prog -= 1;
      f.stack = Math.min(st.stackCap, f.stack + st.workers * st.capacity);
      if (!f.mgr) { f.run = false; f.prog = 0; break; }
    }
  }

  // 2. Лифт
  const e = b.elev;
  const est = elevStats(bi);
  const topFloor = lastOpenIndex(bi);
  const travel = Math.max(1, topFloor + 1);      // сколько «этажей» проезжает в одну сторону
  const speed = (2 * travel) / est.trip;          // этажей в секунду
  const active = e.mgr || e.run;
  if (active || e.phase !== 'idle') {
    if (e.phase === 'idle') { e.phase = 'up'; e.dir = 1; }
    if (e.phase === 'up') {
      e.pos += speed * dt;
      // забираем деньги с этажей, мимо которых проехали
      for (let i = 0; i <= topFloor; i++) {
        const f = b.floors[i];
        if (f.lvl <= 0 || f.stack <= 0) continue;
        if (e.pos >= i + 1 - 0.001) {
          const room = est.capacity - e.load;
          if (room > 0) {
            const take = Math.min(room, f.stack);
            f.stack -= take;
            e.load += take;
          }
        }
      }
      if (e.load >= est.capacity - 1e-9 || e.pos >= travel) { e.phase = 'down'; e.pos = Math.min(e.pos, travel); }
    } else if (e.phase === 'down') {
      e.pos -= speed * dt;
      if (e.pos <= 0) {
        e.pos = 0;
        const vst = vaultStats(bi);
        const room = vst.cap - b.vault.load;
        const put = Math.min(room, e.load);
        b.vault.load += put;
        e.load -= put;
        if (e.load <= 1e-9) {
          e.load = 0;
          e.phase = e.mgr ? 'up' : 'idle';
          if (!e.mgr) e.run = false;
        } else {
          e.phase = 'wait';    // хранилище переполнено, ждём
        }
      }
    } else if (e.phase === 'wait') {
      const vst = vaultStats(bi);
      const room = vst.cap - b.vault.load;
      if (room > 0) {
        const put = Math.min(room, e.load);
        b.vault.load += put; e.load -= put;
        if (e.load <= 1e-9) { e.load = 0; e.phase = e.mgr ? 'up' : 'idle'; if (!e.mgr) e.run = false; }
      }
    }
  }

  // 3. Хранилище
  const v = b.vault;
  const vst = vaultStats(bi);
  const vActive = v.mgr || v.run;
  if (vActive && v.load > 0) {
    v.prog += dt / vst.time;
    while (v.prog >= 1) {
      v.prog -= 1;
      const take = Math.min(v.load, vst.capacity);
      v.load -= take;
      addCash(take * bonuses().allIncome * boostMult());
      if (!v.mgr) { v.run = false; v.prog = 0; break; }
      if (v.load <= 0) { v.prog = 0; break; }
    }
  } else if (!vActive) v.prog = 0;
}

export function lastOpenIndex(bi = S.bankIdx) {
  const f = S.banks[bi].floors;
  let last = 0;
  for (let i = 0; i < FLOOR_COUNT; i++) if (f[i].lvl > 0) last = i;
  return last;
}

// ── Оффлайн ───────────────────────────────────────────────────────────────────

export function offlineCapSeconds() {
  return Math.min(OFFLINE.maxCapHours, OFFLINE.baseCapHours + S.offlineUps * OFFLINE.capUpgradeHours) * 3600;
}

export function offlineCapUpCost() {
  return Math.round(OFFLINE.capUpgradeGoldBase * OFFLINE.capUpgradeGoldGrow ** S.offlineUps);
}

/** Считает доход за время отсутствия по всем открытым банкам. */
export function computeOffline(seconds) {
  const cap = offlineCapSeconds();
  const t = Math.min(seconds, cap);
  if (t < 60) return null;
  let total = 0;
  for (let bi = 0; bi < S.banks.length; bi++) {
    if (!S.banks[bi].open) continue;
    total += incomePerSec(bi, true) * t;
  }
  total *= OFFLINE.rate * bonuses().offline;
  if (total <= 0) return null;
  return { amount: total, seconds: t, capped: seconds > cap, away: seconds };
}

// ── Банки ─────────────────────────────────────────────────────────────────────

export function bankUnlockCost(bi) { return BANKS[bi].unlock; }

export function unlockBank(bi) {
  if (S.banks[bi].open) return false;
  if (bi > 0 && !S.banks[bi - 1].open) return false;
  if (!spendCash(BANKS[bi].unlock)) return false;
  S.banks[bi].open = true;
  S.banks[bi].floors[0].lvl = 1;
  bumpStat('banksOpen');
  bumpStat('floorsOpen');
  emit('bank');
  save(true);
  return true;
}

export function switchBank(bi) {
  if (!S.banks[bi].open || bi === S.bankIdx) return false;
  S.bankIdx = bi;
  bumpStat('switches');
  emit('bank');
  save();
  return true;
}

// ── Реновация (престиж) ───────────────────────────────────────────────────────

export function renovationShares() {
  return sharesFor(S.stats.runEarned);
}

export function canRenovate() {
  return S.stats.runEarned >= PRESTIGE.minEarned && renovationShares() > 0;
}

export function renovate() {
  if (!canRenovate()) return 0;
  const gained = renovationShares();
  S.shares += gained;
  S.stats.renovations++;
  S.stats.runEarned = 0;
  S.cash = 0;
  const start = Math.min(FLOOR_COUNT, 1 + Math.floor(bonuses().startFloors));
  S.banks = S.banks.map((_, i) => {
    const nb = {
      open: i === 0,
      floors: Array.from({ length: FLOOR_COUNT }, (_, f) => ({
        lvl: i === 0 && f < start ? 1 : 0, mgr: false, stack: 0, prog: 0, run: false,
      })),
      elev: { lvl: 1, mgr: false, load: 0, pos: 0, dir: 1, run: false, phase: 'idle', t: 0 },
      vault: { lvl: 1, mgr: false, load: 0, prog: 0, run: false },
      contract: 0,
      earned: 0,
    };
    return nb;
  });
  S.bankIdx = 0;
  invalidateBonuses();
  emit('renovate');
  save(true);
  return gained;
}

export function boardCost(u) {
  const lvl = S.board[u.id] || 0;
  return Math.ceil(u.cost * u.grow ** lvl);
}

export function buyBoard(u) {
  const lvl = S.board[u.id] || 0;
  if (lvl >= u.max) return false;
  const cost = boardCost(u);
  if (S.shares < cost) return false;
  S.shares -= cost;
  S.board[u.id] = lvl + 1;
  invalidateBonuses();
  emit('board');
  save();
  return true;
}

// ── Контракты ─────────────────────────────────────────────────────────────────

export function contractProgress(bi = S.bankIdx) {
  const b = S.banks[bi];
  const def = CONTRACTS[b.contract];
  if (!def) return null;
  let cur = 0;
  switch (def.kind) {
    case 'floorsOpen': cur = openFloors(bi); break;
    case 'anyFloorLvl': cur = Math.max(...b.floors.map((f) => f.lvl)); break;
    case 'elevLvl': cur = b.elev.lvl; break;
    case 'vaultLvl': cur = b.vault.lvl; break;
    case 'managers': cur = b.floors.filter((f) => f.mgr).length + (b.elev.mgr ? 1 : 0) + (b.vault.mgr ? 1 : 0); break;
    case 'milestones': cur = b.floors.reduce((a, f) => a + milestonesUpTo(f.lvl).length, 0); break;
    default: cur = 0;
  }
  return { def, cur: Math.min(cur, def.goal), goal: def.goal, done: cur >= def.goal };
}

export function claimContract(bi = S.bankIdx) {
  const p = contractProgress(bi);
  if (!p || !p.done) return null;
  const r = p.def.reward;
  if (r.gold) addGold(r.gold);
  addXp(XP.perTask);
  S.banks[bi].contract++;
  S.contractsDone++;
  emit('contract');
  save();
  return r;
}

// ── Прочее ────────────────────────────────────────────────────────────────────

export function floorName(i) { return FLOOR_DEFS[i].name; }
export function nextMs(lvl) { return nextMilestone(lvl); }
export { nextMilestone, milestonesUpTo };
