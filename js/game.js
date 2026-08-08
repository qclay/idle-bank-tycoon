// Экономика зала: обслуживание, наличные, пады покупки, апгрейды, оффлайн.

import {
  COUNTERS, ATMS, UPGRADES, COUNTER_UP, CUSTOMER, STAFF, VAULT, XP, xpForLevel,
  OFFLINE, BOOSTS, SAFES, ACHIEVEMENTS, DAILY_POOL, DAILY_ALL,
} from './balance.js';
import { S, save, emit } from './state.js';
import { clamp, dist } from './core.js';
import * as scene from './scene.js';
import * as fx from './fx.js';
import {
  player, customers, clerks, runner, bagCap, clerkSpot, pickSpot, trayPos,
  atmPick, atmTray, counterDef, frontCustomer, syncStaff, refreshSolids,
} from './actors.js';

// ── Формулы ──────────────────────────────────────────────────────────────────

export function counterPay(def) {
  const st = S.counters[def.id];
  return def.base * COUNTER_UP.payGrow ** (st.lvl - 1) * vaultMult() * moneyBoost();
}
export function counterUpCost(def) {
  const st = S.counters[def.id];
  const base = def.cost || 300;
  return Math.ceil(base * COUNTER_UP.costRatio * COUNTER_UP.grow ** (st.lvl - 1));
}
export function trayCap(def) { return counterPay(def) * 14; }

export function atmRate(def) {
  const st = S.atms[def.id];
  return def.rate * COUNTER_UP.payGrow ** (st.lvl - 1) * vaultMult() * moneyBoost();
}
export function atmUpCost(def) {
  const st = S.atms[def.id];
  return Math.ceil(def.cost * COUNTER_UP.costRatio * COUNTER_UP.grow ** (st.lvl - 1));
}
export function atmCap(def) { return atmRate(def) * 90; }

export function upCost(key) {
  const u = UPGRADES[key];
  return Math.ceil(u.cost * u.grow ** (S.ups[key] || 0));
}
export function upValue(key) {
  const u = UPGRADES[key];
  return u.base + u.step * (S.ups[key] || 0);
}
export function vaultMult() { return upValue('vault'); }

export function clerkCost(def) {
  const st = S.counters[def.id];
  return Math.ceil(STAFF.clerk.cost * STAFF.clerk.grow ** st.clerk * (1 + COUNTERS.indexOf(def) * 0.6));
}
export function clerkSpeed(def) {
  const st = S.counters[def.id];
  return STAFF.clerk.speedBase + STAFF.clerk.speedStep * (st.clerk - 1);
}
export function runnerCost() { return Math.ceil(STAFF.runner.cost * STAFF.runner.grow ** S.runner); }

export function boostOn(id) { const b = S.boosts[id]; return !!(b && b.until > Date.now()); }
export function boostLeft(id) { const b = S.boosts[id]; return b ? Math.max(0, (b.until - Date.now()) / 1000) : 0; }
function moneyBoost() { return boostOn('money2x') ? BOOSTS.money2x.mult : 1; }

// ── Пады в зале ──────────────────────────────────────────────────────────────

export function pads() {
  const out = [];
  for (const c of COUNTERS) {
    if (S.counters[c.id].open) continue;
    const prev = COUNTERS[COUNTERS.indexOf(c) - 1];
    if (prev && !S.counters[prev.id].open) continue;      // по порядку
    out.push({ id: 'buy_' + c.id, kind: 'counter', ref: c, cost: c.cost,
               x: c.x + 0.3, y: c.y + 0.9, w: 1.4, h: 1.4, title: c.name, color: 0x5fd35f });
  }
  for (const a of ATMS) {
    if (S.atms[a.id].open) continue;
    out.push({ id: 'buy_' + a.id, kind: 'atm', ref: a, cost: a.cost,
               x: a.x - 0.05, y: a.y + 0.75, w: 1.3, h: 1.3, title: a.name, color: 0x5fd35f });
  }
  for (const k of Object.keys(UPGRADES)) {
    const u = UPGRADES[k];
    const lvl = S.ups[k] || 0;
    if (lvl >= u.max) continue;
    out.push({ id: 'up_' + k, kind: 'up', ref: u, cost: upCost(k),
               x: u.x, y: u.y, w: 1.4, h: 1.4, title: u.name, color: 0x63b9ff, up: k });
  }
  return out;
}

if (!S.padPaid) S.padPaid = {};

// ── Взаимодействие игрока ────────────────────────────────────────────────────

const PICK_R = 1.25;
const DROP_R = 1.4;
const SERVE_R = 1.35;

let pickAcc = 0;
let depAcc = 0;
let depTick = 0;

function addCarry(v) {
  const room = bagCap() - S.carry;
  const got = Math.min(room, v);
  S.carry += got;
  return got;
}

export function tick(dt, ui) {
  if (!S.padPaid) S.padPaid = {};

  // 1. Банкоматы копят наличные
  for (const a of ATMS) {
    const st = S.atms[a.id];
    if (!st.open) continue;
    st.cash = Math.min(atmCap(a), st.cash + atmRate(a) * dt);
  }

  // 2. Обслуживание клиентов
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open) continue;
    const k = frontCustomer(c.id);
    if (!k) continue;
    if (st.cash >= trayCap(c)) { if (k.state === 'serve') k.state = 'wait'; continue; }

    let speed = 0;
    if (st.clerk > 0) speed = clerkSpeed(c);
    else {
      const sp = clerkSpot(c);
      if (dist(player.x, player.y, sp.x, sp.y) < SERVE_R) speed = 1;
    }
    if (speed > 0) {
      if (k.state === 'wait') { k.state = 'serve'; k.serve = 0; }
      k.serveSpeed = speed;
    } else if (k.state === 'serve') {
      k.state = 'wait';
    }
  }

  // 3. Игрок забирает наличные со стоек и банкоматов
  pickAcc += dt;
  const canCarry = S.carry < bagCap() - 1e-6;
  if (canCarry) {
    for (const c of COUNTERS) {
      const st = S.counters[c.id];
      if (!st.open || st.cash <= 0) continue;
      const p = pickSpot(c);
      if (dist(player.x, player.y, p.x, p.y) > PICK_R) continue;
      grab(st, trayPos(c), dt);
    }
    for (const a of ATMS) {
      const st = S.atms[a.id];
      if (!st.open || st.cash <= 0) continue;
      const p = atmPick(a);
      if (dist(player.x, player.y, p.x, p.y) > PICK_R) continue;
      grab(st, atmTray(a), dt);
    }
  }

  // 4. Сдача в хранилище
  if (S.carry > 0 && dist(player.x, player.y, VAULT.drop.x, VAULT.drop.y) < DROP_R) {
    const rate = Math.max(bagCap() * 2.0, 30);
    const give = Math.min(S.carry, rate * dt);
    S.carry -= give;
    deposit(give);
    depAcc += give;
    depTick += dt;
    if (S.settings.fx && depTick > 0.1) {
      depTick = 0;
      fx.coins(player.x, player.y - 0.25, VAULT.x + VAULT.w / 2, VAULT.y + VAULT.h, 1,
               { size: 0.32, life: 0.3, arc: 40, toZ: 1.1 });
    }
    if (depAcc > 0 && (S.carry < 1e-6 || depAcc > bagCap() * 0.5)) {
      if (S.settings.fx) fx.popText(VAULT.x + VAULT.w / 2, VAULT.y + VAULT.h, '+' + fmtShort(depAcc), 'cash');
      depAcc = 0;
    }
    if (S.carry < 1e-6) { S.carry = 0; }
  }

  // 5. Пады
  tickPads(dt, ui);

  // 6. Инкассатор
  return null;
}

let grabTick = 0;
function grab(st, from, dt) {
  const rate = Math.max(bagCap() * 1.6, 22);
  const want = Math.min(st.cash, rate * dt);
  const got = addCarry(want);
  if (got <= 0) return;
  st.cash -= got;
  grabTick += dt;
  if (S.settings.fx && grabTick > 0.1) {
    grabTick = 0;
    fx.coins(from.x, from.y, player.x, player.y - 0.25, 1, { size: 0.3, life: 0.28, arc: 30 });
  }
}

export function deposit(v) {
  if (!(v > 0)) return;
  S.cash += v;
  S.stats.earned += v;
  S.stats.deposits += 1 / 30;
  bumpDaily('deposits', 1 / 30);
  addXp(XP.perDeposit * 0.05);
  emit('cash');
}

/** Инкассатор забирает наличные с объекта. */
export function takeFromSource(src, room) {
  const st = src.kind === 'counter' ? S.counters[src.id] : S.atms[src.id];
  const got = Math.min(st.cash, room);
  st.cash -= got;
  return got;
}

// ── Пады: стоишь — платишь ───────────────────────────────────────────────────

/** Активная площадка под игроком: её же подсвечивает интерфейс. */
export const padState = { id: null, short: false };

let coinTick = 0;

/** Сколько денег доступно на покупку: счёт плюс то, что игрок несёт в руках.
 *  Раньше площадка списывала только со счёта — игрок стоял с полной сумкой,
 *  и по его ощущению площадка просто не работала. */
export function spendable() { return S.cash + S.carry; }

function payFrom(amount) {
  let left = amount;
  const fromCash = Math.min(S.cash, left);
  S.cash -= fromCash; left -= fromCash;
  if (left > 1e-9 && S.carry > 0) {
    const fromBag = Math.min(S.carry, left);
    S.carry -= fromBag; left -= fromBag;
    // деньги из рук тоже засчитываем как выручку, иначе ломается статистика
    S.stats.earned += fromBag;
    S.stats.deposits += 1 / 60;
    bumpDaily('deposits', 1 / 60);
  }
  return amount - left;
}

function tickPads(dt, ui) {
  const list = pads();
  padState.id = null; padState.short = false;
  for (const p of list) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // Круг с запасом: по прямоугольнику игрок постоянно промахивался мимо зоны.
    const r = Math.max(p.w, p.h) / 2 + 0.62;
    if (dist(player.x, player.y, cx, cy) > r) continue;
    const paid = S.padPaid[p.id] || 0;
    if (paid >= p.cost) continue;
    padState.id = p.id;
    const have = spendable();
    if (have < 1) { padState.short = true; continue; }
    const rate = Math.max(p.cost / 2.2, 14);
    const want = Math.min(rate * dt, p.cost - paid, have);
    const pay = payFrom(want);
    if (pay <= 0) { padState.short = true; continue; }
    S.padPaid[p.id] = paid + pay;
    // монеты сыплются из рук в площадку
    coinTick += dt;
    if (S.settings.fx && coinTick > 0.09) {
      coinTick = 0;
      fx.coins(player.x, player.y - 0.2, cx, cy, 1, { size: 0.26, life: 0.3, arc: 34, toZ: 0.05 });
    }
    if (S.padPaid[p.id] >= p.cost - 1e-6) finishPad(p, ui);
  }
}

function finishPad(p, ui) {
  S.padPaid[p.id] = 0;
  if (S.settings.fx) {
    fx.burst(p.x + p.w / 2, p.y + p.h / 2, 8, { size: 0.32 });
    fx.punch(9);
  }
  if (p.kind === 'counter') {
    S.counters[p.ref.id].open = true;
    S.stats.opened++;
    bumpDaily('opened');
    addXp(XP.perBuy);
    ui?.toast(`Открыто: ${p.ref.name}`);
    refreshSolids();
    emit('build');
  } else if (p.kind === 'atm') {
    S.atms[p.ref.id].open = true;
    S.stats.opened++;
    bumpDaily('opened');
    addXp(XP.perBuy);
    ui?.toast(`Открыт ${p.ref.name}`);
    refreshSolids();
    emit('build');
  } else if (p.kind === 'up') {
    S.ups[p.up] = (S.ups[p.up] || 0) + 1;
    S.stats.upgrades++;
    bumpDaily('upgrades');
    addXp(XP.perUpgrade);
    ui?.toast(`${p.ref.name} — уровень ${S.ups[p.up]}`);
    emit('upgrade');
  }
  save();
}

// ── Покупки из окон ──────────────────────────────────────────────────────────

export function upgradeCounter(def) {
  const st = S.counters[def.id];
  const cost = counterUpCost(def);
  if (S.cash < cost) return false;
  S.cash -= cost;
  st.lvl++;
  S.stats.upgrades++;
  bumpDaily('upgrades');
  addXp(XP.perUpgrade);
  emit('upgrade'); save();
  return true;
}

export function upgradeAtm(def) {
  const st = S.atms[def.id];
  const cost = atmUpCost(def);
  if (S.cash < cost) return false;
  S.cash -= cost;
  st.lvl++;
  S.stats.upgrades++;
  bumpDaily('upgrades');
  addXp(XP.perUpgrade);
  emit('upgrade'); save();
  return true;
}

export function hireClerk(def) {
  const st = S.counters[def.id];
  if (st.clerk >= STAFF.clerk.maxLvl) return false;
  const cost = clerkCost(def);
  if (S.cash < cost) return false;
  S.cash -= cost;
  st.clerk++;
  S.stats.hires++;
  bumpDaily('hires');
  addXp(XP.perBuy);
  syncStaff();
  emit('staff'); save();
  return true;
}

export function hireRunner() {
  if (S.runner >= STAFF.runner.maxLvl) return false;
  const cost = runnerCost();
  if (S.cash < cost) return false;
  S.cash -= cost;
  S.runner++;
  S.stats.hires++;
  bumpDaily('hires');
  addXp(XP.perBuy);
  syncStaff();
  emit('staff'); save();
  return true;
}

// ── Обслуженный клиент ───────────────────────────────────────────────────────

export function onServed(k) {
  const def = counterDef(k.counter);
  const st = S.counters[def.id];
  const pay = counterPay(def);
  st.cash = Math.min(trayCap(def), st.cash + pay);
  S.stats.served++;
  bumpDaily('served');
  addXp(XP.perServe);
  if (S.settings.fx) {
    const t = trayPos(def);
    fx.coins(k.x, k.y - 0.3, t.x, t.y, 2, { size: 0.26, life: 0.34, arc: 34, toZ: 1.0 });
  }
}

/** Короткая запись суммы для всплывающих чисел. */
function fmtShort(v) {
  if (v < 1000) return String(Math.round(v));
  const u = ['', 'K', 'M', 'B', 'T', 'aa', 'ab'];
  let i = 0, n = v;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '') + u[i];
}

// ── Опыт и уровень ───────────────────────────────────────────────────────────

let xpAcc = 0;
export function addXp(v) {
  xpAcc += v;
  if (xpAcc < 1) return;
  const whole = Math.floor(xpAcc);
  xpAcc -= whole;
  S.xp += whole;
  let up = false;
  while (S.xp >= xpForLevel(S.level)) {
    S.xp -= xpForLevel(S.level);
    S.level++;
    S.gold += XP.goldPerLevel;
    up = true;
  }
  if (up) emit('levelup');
}

export function bumpDaily(key, v = 1) {
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters[key] = (S.daily.counters[key] || 0) + v;
}

// ── Оффлайн ──────────────────────────────────────────────────────────────────

export function offlineCapSec() {
  return Math.min(OFFLINE.maxCapHours, OFFLINE.capHours + S.offlineUps * OFFLINE.upHours) * 3600;
}
export function offlineUpCost() {
  return Math.round(OFFLINE.upGoldBase * OFFLINE.upGoldGrow ** S.offlineUps);
}

/** Доход в секунду при полной автоматизации (нужны кассиры и инкассатор). */
export function autoIncome() {
  if (S.runner <= 0) return 0;
  let cap = 0, payWeight = 0;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open || st.clerk <= 0) continue;
    const thr = clerkSpeed(c) / CUSTOMER.serveTime;
    cap += thr;
    payWeight += thr * counterPay(c);
  }
  let inc = 0;
  if (cap > 0) {
    const spawnThr = 1 / spawnSeconds();
    const eff = Math.min(spawnThr, cap);
    inc += (payWeight / cap) * eff;
  }
  for (const a of ATMS) if (S.atms[a.id].open) inc += atmRate(a);
  return inc;
}

function spawnSeconds() {
  const open = COUNTERS.filter((c) => S.counters[c.id].open).length;
  return Math.max(CUSTOMER.minSpawn,
    CUSTOMER.spawnBase * CUSTOMER.spawnPerCounter ** Math.max(0, open - 1));
}

/** Оценка текущего дохода для интерфейса (учитывает ручную игру). */
export function shownIncome() {
  const auto = autoIncome();
  if (auto > 0) return auto;
  // без инкассатора считаем то, что копится на стойках
  let inc = 0;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open) continue;
    if (st.clerk > 0) inc += counterPay(c) * (clerkSpeed(c) / CUSTOMER.serveTime);
  }
  for (const a of ATMS) if (S.atms[a.id].open) inc += atmRate(a);
  return inc;
}

export function computeOffline(sec) {
  const t = Math.min(sec, offlineCapSec());
  if (t < 60) return null;
  const amount = autoIncome() * t * OFFLINE.rate;
  if (amount <= 0) return null;
  return { amount, seconds: t, capped: sec > offlineCapSec() };
}
