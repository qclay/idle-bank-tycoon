// Экономика зала: обслуживание, наличные, пады покупки, апгрейды, оффлайн.

import {
  COUNTERS, ATMS, ZONES, UPGRADES, COUNTER_UP, CUSTOMER, STAFF, VAULT, XP, xpForLevel,
  OFFLINE, BOOSTS, SAFES, ACHIEVEMENTS, DAILY_POOL, DAILY_ALL, PAD_DWELL, PAD_STOP_SPEED,
  PRESTIGE,
} from './balance.js';
import { S, save, emit, streakBonus } from './state.js';
import { clamp, dist } from './core.js';
import * as scene from './scene.js';
import * as fx from './fx.js';
import * as reviews from './reviews.js';
import {
  player, customers, clerks, runner, bagCap, clerkSpot, pickSpot, trayPos,
  atmPick, atmTray, counterDef, frontCustomer, syncStaff, refreshSolids, clerkAway, clerkList,
} from './actors.js';

// ── Зоны: постоянные бонусы на весь бизнес ───────────────────────────────────

/** Суммарный бонус зон нужного типа: spawn | pay | speed | offline. */
/** Прибавка зоны растёт долями от уровня к уровню, а не одинаковыми шагами:
 *  иначе цена уходит вверх кратно быстрее пользы и уровни перестают окупаться. */
export function zoneGain(z, lvl) {
  return z.step * (z.gain ** lvl - 1) / (z.gain - 1);
}

export function zoneBonus(effect) {
  let b = 0;
  for (const z of ZONES) {
    const st = S.zones?.[z.id];
    if (st?.open && z.effect === effect) b += zoneGain(z, st.lvl);
  }
  return b;
}
export function zoneUpCost(z) {
  const st = S.zones[z.id];
  return Math.ceil(z.cost * 0.45 * z.grow ** (st.lvl - 1));
}
export function upgradeZone(z) {
  const st = S.zones[z.id];
  if (st.lvl >= z.max) return false;
  const cost = zoneUpCost(z);
  if (S.cash < cost) return false;
  S.cash -= cost;
  st.lvl++;
  S.stats.upgrades++;
  bumpDaily('upgrades');
  addXp(XP.perUpgrade);
  emit('upgrade'); save();
  return true;
}

// ── Формулы ──────────────────────────────────────────────────────────────────

export function counterPay(def) {
  const st = S.counters[def.id];
  return def.base * COUNTER_UP.payGrow ** (st.lvl - 1) * milestoneMult(st.lvl)
    * vaultMult() * moneyBoost() * (1 + zoneBonus('pay')) * reviews.payMult()
    * prestigeMult() * (1 + streakBonus());
}
export function counterUpCost(def) {
  const st = S.counters[def.id];
  const base = def.cost || 300;
  return Math.ceil(base * COUNTER_UP.costRatio * COUNTER_UP.grow ** (st.lvl - 1));
}
/** Круглые уровни дают скачок ×2. Игрок видит порог, докупает до него и
 *  получает рывок — без этих ступеней прокачка ощущается ровной кашей. */
export function milestoneMult(lvl) {
  let m = 1;
  for (const t of COUNTER_UP.milestones) if (lvl >= t) m *= 2;
  return m;
}

export function nextMilestone(lvl) {
  return COUNTER_UP.milestones.find((t) => t > lvl) || null;
}

export function trayCap(def) { return counterPay(def) * 14; }

/** Во сколько раз выросла экономика с самого начала. Сумка и тележка
 *  администратора считаются от неё: иначе доход растёт в разы, а унести можно
 *  всё те же копейки, и игра превращается в бесконечную беготню. */
export function payScale() {
  let best = COUNTERS[0].base;
  for (const c of COUNTERS) {
    if (!S.counters[c.id]?.open) continue;
    best = Math.max(best, counterPay(c));
  }
  return Math.max(1, best / COUNTERS[0].base);
}

export function atmRate(def) {
  const st = S.atms[def.id];
  return def.rate * COUNTER_UP.payGrow ** (st.lvl - 1) * milestoneMult(st.lvl)
    * vaultMult() * moneyBoost() * prestigeMult();
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
  const lvl = S.ups[key] || 0;
  // Множители растут долями, простые прибавки — шагами: скорость ходьбы не
  // может умножаться, иначе герой улетит через весь зал.
  return u.gain != null ? u.base * u.gain ** lvl : u.base + u.step * lvl;
}
export function vaultMult() { return upValue('vault'); }

export function clerkCost(def) {
  const st = S.counters[def.id];
  return Math.ceil(STAFF.clerk.cost * STAFF.clerk.grow ** st.clerk * (1 + COUNTERS.indexOf(def) * 0.6));
}
export function clerkSpeed(def) {
  const st = S.counters[def.id];
  return (STAFF.clerk.speedBase + STAFF.clerk.speedStep * (st.clerk - 1))
    * (1 + zoneBonus('speed')) * reviews.morale(def.id);
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
  for (const z of ZONES) {
    if (S.zones?.[z.id]?.open) continue;
    out.push({ id: 'buy_' + z.id, kind: 'zone', ref: z, cost: z.cost,
               x: z.x, y: z.y + 1.5, w: 1.5, h: 1.5, title: z.name, color: 0x5fd35f });
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

// ── Что делать прямо сейчас ──────────────────────────────────────────────────
// Магазин большой, денег в нём копится сразу в нескольких местах, и игрок
// теряется: бежать к стойке, в кассу, к недовольному клиенту или на площадку?
// Поэтому игра сама выбирает одно самое ценное дело и показывает только его.
// Когда дел нет — так и говорит, чтобы можно было спокойно выдохнуть.

const GOAL = { bagFull: 0.85, trayFull: 0.55 };

export function nextGoal() {
  // 1. Полная тележка — деньги в руках не работают
  const cap = bagCap();
  if (S.carry >= cap * GOAL.bagFull) {
    return { kind: 'vault', x: VAULT.drop.x, y: VAULT.drop.y, label: 'Сдать выручку', hot: true };
  }
  // 2. Недовольный клиент — репутация тает, пока к нему не подошли
  for (const k of customers) {
    if (k.state === 'upset') return { kind: 'upset', x: k.x, y: k.y, label: 'Разобраться с клиентом', hot: true };
  }
  // 3. Оператор залип на складе — стойка стоит
  for (const a of clerkList()) {
    if (a.job === 'search' && a.slack) {
      return { kind: 'stock', x: a.x, y: a.y, label: 'Проверить склад', hot: true };
    }
  }
  // 4. Самый полный лоток
  let best = null, bestFill = GOAL.trayFull;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open) continue;
    const fill = st.cash / trayCap(c);
    if (fill > bestFill) { bestFill = fill; const p = pickSpot(c); best = { kind: 'pick', x: p.x, y: p.y, label: `Забрать: ${c.name}` }; }
  }
  for (const a of ATMS) {
    const st = S.atms[a.id];
    if (!st.open) continue;
    const fill = st.cash / atmCap(a);
    if (fill > bestFill) { bestFill = fill; const p = atmPick(a); best = { kind: 'pick', x: p.x, y: p.y, label: 'Забрать: постамат' }; }
  }
  if (best) return best;
  // 5. Очередь стоит без оператора, а вы свободны
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open || (st.clerk > 0 && !clerkAway(c.id))) continue;
    if (!frontCustomer(c.id)) continue;
    const sp = clerkSpot(c);
    return { kind: 'serve', x: sp.x, y: sp.y, label: `Обслужить: ${c.name}` };
  }
  // 6. Есть деньги на покупку — самая дешёвая из доступных
  let buy = null;
  for (const p of pads()) {
    const left = p.cost - (S.padPaid[p.id] || 0);
    if (left > S.cash + S.carry) continue;
    if (!buy || left < buy.left) buy = { left, p };
  }
  if (buy) {
    const p = buy.p;
    return { kind: 'buy', x: p.x + p.w / 2, y: p.y + p.h / 2,
             label: p.kind === 'up' ? `Улучшить: ${p.title}` : `Открыть: ${p.title}` };
  }
  return null;
}

// ── Престиж ──────────────────────────────────────────────────────────────────
// Сколько долей в сети даст закрытие пункта прямо сейчас и что они дают.

export function prestigeEnsure() {
  if (!S.prestige) S.prestige = { runs: 0, points: 0, spentLifetime: 0 };
  if (S.stats.lifetime == null) S.stats.lifetime = S.stats.earned || 0;
}

/** Доли за весь оборот минус те, что уже получены за прошлые круги. */
export function prestigeGain() {
  prestigeEnsure();
  const total = Math.floor(PRESTIGE.k * Math.sqrt(Math.max(0, S.stats.lifetime) / PRESTIGE.unit));
  return Math.max(0, total - S.prestige.points);
}

/** Постоянный множитель дохода от уже полученных долей. */
export function prestigeMult() {
  prestigeEnsure();
  return 1 + S.prestige.points * PRESTIGE.perPoint;
}

/** Пункт открывается, когда бизнес дорос: иначе престиж превращается в
 *  доминирующую стратегию и игрок пропускает содержание игры. */
export function prestigeReady() {
  prestigeEnsure();
  const opened = COUNTERS.filter((c) => S.counters[c.id].open).length;
  return opened >= PRESTIGE.needCounters && S.level >= PRESTIGE.needLevel;
}

/** Сколько ещё оборота до удвоения долей — по этой подсказке и решают, когда
 *  закрывать пункт. Правило жанра: уходить, когда доля удваивается. */
export function prestigeDouble() {
  prestigeEnsure();
  const have = S.prestige.points + prestigeGain();
  const want = Math.max(1, have * 2);
  const need = (want / PRESTIGE.k) ** 2 * PRESTIGE.unit;
  return Math.max(0, need - S.stats.lifetime);
}

export function prestigeName(run = null) {
  prestigeEnsure();
  const n = PRESTIGE.districts;
  return n[Math.min(run ?? S.prestige.runs, n.length - 1)];
}

/** Передать магазин управляющему и открыть следующий в новом районе. Кристаллы,
 *  репутация, награды и доли остаются с вами — иначе ресет ощущается
 *  наказанием, а не шагом вперёд. */
export function prestigeDo() {
  prestigeEnsure();
  const gain = prestigeGain();
  if (!prestigeReady() || gain <= 0) return null;
  S.prestige.points += gain;
  S.prestige.runs++;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    st.open = c.cost === 0; st.lvl = 1; st.clerk = 0; st.cash = 0; st.morale = 1;
  }
  for (const a of ATMS) { const st = S.atms[a.id]; st.open = false; st.lvl = 1; st.cash = 0; }
  for (const z of ZONES) { if (S.zones[z.id]) { S.zones[z.id].open = false; S.zones[z.id].lvl = 1; } }
  for (const k of Object.keys(S.ups)) S.ups[k] = 0;
  S.cash = 0; S.carry = 0; S.padPaid = {};
  S.level = 1; S.xp = 0;
  S.runner = 0;
  if (S.smm) S.smm.lvl = 0;
  syncStaff(); refreshSolids();
  emit('prestige'); emit('build');
  save(true);
  return { gain, points: S.prestige.points, mult: prestigeMult() };
}

// ── Взаимодействие игрока ────────────────────────────────────────────────────

// Кто сейчас работает в зале: хозяин и его гости. Хост считает действия
// всех по их координатам — гость ничего не решает сам, подделать нечего.
let workers = [];
export function setWorkers(list) { workers = list || []; }
function allWorkers() {
  const me = {
    id: 'me',
    get x() { return player.x; }, get y() { return player.y; },
    get carry() { return S.carry; }, set carry(v) { S.carry = v; },
    get speed() { return Math.hypot(player.vx || 0, player.vy || 0); },
    cap: bagCap(), local: true,
  };
  return [me, ...workers];
}

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
    // Оператор ушёл на склад — стойка стоит, как если бы его и не нанимали.
    if (st.clerk > 0 && !clerkAway(c.id)) speed = clerkSpeed(c);
    else {
      const sp = clerkSpot(c);
      // за стойку может встать и гость — помощь считается так же
      for (const w of allWorkers()) {
        if (dist(w.x, w.y, sp.x, sp.y) < SERVE_R) { speed = 1; break; }
      }
    }
    if (speed > 0) {
      if (k.state === 'wait') { k.state = 'serve'; k.serve = 0; }
      k.serveSpeed = speed;
    } else if (k.state === 'serve') {
      k.state = 'wait';
    }
  }

  // 3. Выручку со стоек и постаматов забирает любой, кто рядом
  pickAcc += dt;
  for (const w of allWorkers()) {
    if (w.carry >= w.cap - 1e-6) continue;
    for (const c of COUNTERS) {
      const st = S.counters[c.id];
      if (!st.open || st.cash <= 0) continue;
      const p = pickSpot(c);
      if (dist(w.x, w.y, p.x, p.y) > PICK_R) continue;
      grab(st, trayPos(c), dt, w);
    }
    for (const a of ATMS) {
      const st = S.atms[a.id];
      if (!st.open || st.cash <= 0) continue;
      const p = atmPick(a);
      if (dist(w.x, w.y, p.x, p.y) > PICK_R) continue;
      grab(st, atmTray(a), dt, w);
    }
  }

  // 4. Сдача в кассу — тоже любым из работающих
  for (const w of allWorkers()) {
    if (w.carry <= 0 || dist(w.x, w.y, VAULT.drop.x, VAULT.drop.y) >= DROP_R) continue;
    const rate = Math.max(w.cap * 2.0, 30);
    const give = Math.min(w.carry, rate * dt);
    w.carry -= give;
    deposit(give);
    if (!w.local) continue;
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
function grab(st, from, dt, w) {
  const rate = Math.max(w.cap * 1.6, 22);
  const want = Math.min(st.cash, rate * dt, w.cap - w.carry);
  if (want <= 0) return;
  w.carry += want;
  st.cash -= want;
  if (!w.local) return;
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
  S.stats.lifetime = (S.stats.lifetime || 0) + v;
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
export const padState = { id: null, short: false, arming: false, crew: 0 };

let coinTick = 0;
const dwell = new Map();   // id площадки → сколько секунд игрок на ней стоит

/** Сколько денег доступно на покупку: счёт плюс то, что игрок несёт в руках.
 *  Раньше площадка списывала только со счёта — игрок стоял с полной сумкой,
 *  и по его ощущению площадка просто не работала. */
export function spendable() { return S.cash + S.carry; }

function payFrom(amount, w = null) {
  let left = amount;
  const fromCash = Math.min(S.cash, left);
  S.cash -= fromCash; left -= fromCash;
  const bag = w ? w.carry : S.carry;
  if (left > 1e-9 && bag > 0) {
    const fromBag = Math.min(bag, left);
    if (w) w.carry = bag - fromBag; else S.carry -= fromBag;
    left -= fromBag;
    // деньги из рук тоже засчитываем как выручку, иначе ломается статистика
    S.stats.earned += fromBag;
    S.stats.lifetime = (S.stats.lifetime || 0) + fromBag;
    S.stats.deposits += 1 / 60;
    bumpDaily('deposits', 1 / 60);
  }
  return amount - left;
}

// Стройку тянет вся смена: и хозяин, и гости. Каждый, кто встал на площадку,
// подливает деньги своим темпом, поэтому вдвоём витрина открывается вдвое
// быстрее — ради этого друга и зовут.
function tickPads(dt, ui) {
  const list = pads();
  padState.id = null; padState.short = false; padState.arming = false;
  padState.crew = 0;
  const alive = new Set();
  const crew = allWorkers();
  for (const p of list) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // Круг с запасом: по прямоугольнику игрок постоянно промахивался мимо зоны.
    const r = Math.max(p.w, p.h) / 2 + 0.62;
    if ((S.padPaid[p.id] || 0) >= p.cost) continue;

    let hands = 0;                 // сколько человек реально вкладывается сюда
    for (const w of crew) {
      if (dist(w.x, w.y, cx, cy) > r) continue;
      const key = `${w.id}|${p.id}`;
      alive.add(key);
      if (w.local) padState.id = p.id;

      // Списываем, только когда человек остановился на площадке: иначе деньги
      // утекали просто по дороге к кассе.
      if (w.speed > PAD_STOP_SPEED) { dwell.set(key, 0); if (w.local) padState.arming = true; continue; }
      const t0 = (dwell.get(key) || 0) + dt;
      dwell.set(key, t0);
      if (t0 < PAD_DWELL) { if (w.local) padState.arming = true; continue; }

      const paid = S.padPaid[p.id] || 0;
      if (paid >= p.cost) break;
      const have = S.cash + w.carry;
      if (have < 1) { if (w.local) padState.short = true; continue; }
      const rate = Math.max(p.cost / 2.2, 14);
      const want = Math.min(rate * dt, p.cost - paid, have);
      const pay = payFrom(want, w);
      if (pay <= 0) { if (w.local) padState.short = true; continue; }
      S.padPaid[p.id] = paid + pay;
      hands++;
      // монеты сыплются из рук в площадку
      coinTick += dt;
      if (S.settings.fx && coinTick > 0.09) {
        coinTick = 0;
        fx.coins(w.x, w.y - 0.2, cx, cy, 1, { size: 0.26, life: 0.3, arc: 34, toZ: 0.05 });
      }
      if (S.padPaid[p.id] >= p.cost - 1e-6) { finishPad(p, ui); break; }
    }
    if (padState.id === p.id) padState.crew = hands;
  }
  // сошёл с площадки — отсчёт начинается заново
  for (const k of [...dwell.keys()]) if (!alive.has(k)) dwell.delete(k);
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
  } else if (p.kind === 'zone') {
    S.zones[p.ref.id].open = true;
    S.stats.opened++;
    bumpDaily('opened');
    addXp(XP.perBuy);
    ui?.toast(`Открыта зона «${p.ref.name}»`);
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
    CUSTOMER.spawnBase * CUSTOMER.spawnPerCounter ** Math.max(0, open - 1)
      / ((1 + zoneBonus('spawn')) * reviews.spawnMult()));
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
  const amount = autoIncome() * t * OFFLINE.rate * (1 + zoneBonus('offline'));
  if (amount <= 0) return null;
  return { amount, seconds: t, capped: sec > offlineCapSec() };
}
