// Состояние игры и сохранение.

import { COUNTERS, ATMS, ZONES, UPGRADES, DAILY_POOL, DAILY_COUNT } from './balance.js';

export const S = {};
const subs = new Set();
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit(what) { for (const f of subs) f(what); }

export function defaultState() {
  const counters = {};
  COUNTERS.forEach((c, i) => { counters[c.id] = { open: i === 0, lvl: 1, cash: 0, clerk: 0, morale: 1 }; });
  const atms = {};
  ATMS.forEach((a) => { atms[a.id] = { open: false, lvl: 1, cash: 0 }; });
  const ups = {};
  Object.keys(UPGRADES).forEach((k) => { ups[k] = 0; });
  const zones = {};
  ZONES.forEach((z) => { zones[z.id] = { open: false, lvl: 1 }; });

  return {
    v: 2,
    created: Date.now(),
    lastSeen: Date.now(),

    cash: 0,
    gold: 25,
    carry: 0,
    level: 1,
    xp: 0,

    counters, atms, zones, ups,
    runner: 0,                 // уровень инкассатора, 0 — не нанят

    stats: { served: 0, deposits: 0, earned: 0, upgrades: 0, opened: 1, hires: 0,
             boosts: 0, safes: 0, steps: 0 },
    daily: { date: '', tasks: [], allDone: false, counters: {} },
    achv: {},

    rep: null,                 // репутация пункта в звёздах, заводится в reviews.js
    reviews: [],               // лента отзывов
    district: null,            // гонка за район, заводится в district.js
    safe: { freeAt: 0 },
    boosts: {},
    freeBoost: {},
    offlineUps: 0,
    offlinePending: null,

    settings: { haptics: true, fx: true, quality: 'auto' },
    tut: 0,
    tg: null,
  };
}

export function bootState(raw) {
  const base = defaultState();
  Object.assign(S, raw && typeof raw === 'object' ? merge(base, raw) : base);
  // объекты могли добавиться в новой версии
  for (const c of COUNTERS) if (!S.counters[c.id]) S.counters[c.id] = { open: false, lvl: 1, cash: 0, clerk: 0 };
  for (const a of ATMS) if (!S.atms[a.id]) S.atms[a.id] = { open: false, lvl: 1, cash: 0 };
  for (const z of ZONES) if (!S.zones?.[z.id]) { S.zones = S.zones || {}; S.zones[z.id] = { open: false, lvl: 1 }; }
  for (const k of Object.keys(UPGRADES)) if (S.ups[k] == null) S.ups[k] = 0;
}

function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = {};
    for (const k of Object.keys(base)) out[k] = k in (over || {}) ? merge(base[k], over[k]) : base[k];
    for (const k of Object.keys(over || {})) if (!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined ? base : over;
}

// Состояние живёт только в памяти вкладки и на сервере: ничего не пишем
// на устройство — ни localStorage, ни CloudStorage.
let push = null;
export function setSync(fn) { push = fn; }

/** Пометить, что состояние изменилось. now — отправить немедленно. */
export function save(now = false) {
  S.lastSeen = Date.now();
  push?.(now);
}

export function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }

export function rollDaily() {
  const key = todayKey();
  if (S.daily.date === key && S.daily.tasks.length) return false;
  let r = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pool = DAILY_POOL.slice();
  const picked = [];
  while (picked.length < DAILY_COUNT && pool.length) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  S.daily = { date: key, tasks: picked.map((t) => ({ id: t.id, done: false })), allDone: false, counters: {} };
  return true;
}
