// Состояние игры, сейв/лоад, миграции.

import { BANKS, FLOOR_COUNT, SAVE_KEY, DAILY_POOL, DAILY_COUNT } from './balance.js';

export const S = {};              // единственный экземпляр состояния
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) fn(what); }

function freshBank(i) {
  return {
    open: i === 0,
    floors: Array.from({ length: FLOOR_COUNT }, (_, f) => ({
      lvl: i === 0 && f === 0 ? 1 : 0,   // 0 = отдел ещё не открыт
      mgr: false,
      stack: 0,        // деньги, ждущие лифт у стойки
      prog: 0,         // прогресс текущей ходки клерков 0..1
      run: false,      // цикл запущен (ручной запуск без менеджера)
    })),
    elev: { lvl: 1, mgr: false, load: 0, pos: 0, dir: 1, run: false, phase: 'idle', t: 0 },
    vault: { lvl: 1, mgr: false, load: 0, prog: 0, run: false },
    contract: 0,       // индекс текущего контракта
    earned: 0,         // заработано в этом банке за текущий забег
  };
}

export function defaultState() {
  return {
    v: 1,
    created: Date.now(),
    lastSeen: Date.now(),

    cash: 0,
    gold: 30,
    shares: 0,

    level: 1,
    xp: 0,

    bankIdx: 0,
    banks: BANKS.map((_, i) => freshBank(i)),

    stats: {
      totalEarned: 0, runEarned: 0, upgrades: 0, taps: 0, managers: 0,
      floorsOpen: 1, banksOpen: 1, renovations: 0, milestones: 0,
      maxFloorLvl: 1, smCards: 0, elevUp: 0, vaultUp: 0, boosts: 0, chests: 0, switches: 0,
    },
    // ежедневные счётчики, сбрасываются вместе с заданиями
    daily: { date: '', tasks: [], allClaimed: false, counters: {}, earnedAt: 0 },
    login: { day: 0, date: '' },

    achv: {},                      // id → сколько ступеней забрано
    contractsDone: 0,

    chest: { freeAt: 0 },
    sm: { cards: {}, equipped: [null, null, null], slots: 1 },
    board: {},
    boosts: {},                    // id → { until }
    freeBoost: {},                 // id → готово с этого времени
    offlineUps: 0,
    offlinePending: null,          // { amount, seconds } — окно «пока вас не было»

    upStep: 1,                     // множитель апгрейда 1 / 10 / 100 / 'max'
    tut: 0,
    settings: { sound: true, music: true, haptics: true, showFx: true },
    tg: null,
    seenBanks: {},
  };
}

export function bank(idx = S.bankIdx) { return S.banks[idx]; }
export function bankDef(idx = S.bankIdx) { return BANKS[idx]; }

// ── Сейв ──────────────────────────────────────────────────────────────────────

let saveTimer = 0;
let cloud = null;   // подставляется из tg.js

export function setCloud(api) { cloud = api; }

export function save(immediate = false) {
  S.lastSeen = Date.now();
  if (immediate) return doSave();
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = 0; doSave(); }, 400);
}

function doSave() {
  let json;
  try { json = JSON.stringify(S); } catch { return; }
  try { localStorage.setItem(SAVE_KEY, json); } catch { /* приватный режим */ }
  if (cloud) cloud.write(json);
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Аккуратно накладывает сейв на структуру по умолчанию — чтобы новые поля не терялись. */
export function hydrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') { Object.assign(S, base); return; }
  const merged = deepMerge(base, raw);
  // Банков могло стать больше — дополняем.
  while (merged.banks.length < BANKS.length) merged.banks.push(freshBank(merged.banks.length));
  merged.banks.length = BANKS.length;
  for (const b of merged.banks) {
    while (b.floors.length < FLOOR_COUNT) b.floors.push({ lvl: 0, mgr: false, stack: 0, prog: 0, run: false });
    b.floors.length = FLOOR_COUNT;
  }
  if (merged.bankIdx >= BANKS.length || !merged.banks[merged.bankIdx].open) merged.bankIdx = 0;
  Object.assign(S, merged);
}

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = {};
    for (const k of Object.keys(base)) {
      out[k] = k in (over || {}) ? deepMerge(base[k], over[k]) : base[k];
    }
    // ключи, которых нет в базовой схеме (динамические словари), сохраняем как есть
    for (const k of Object.keys(over || {})) if (!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined ? base : over;
}

// ── Ежедневные задания ────────────────────────────────────────────────────────

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function rollDaily() {
  const key = todayKey();
  if (S.daily.date === key && S.daily.tasks.length) return false;
  // Детерминированный выбор по дате — у всех игроков одинаковый набор дня.
  const seed = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pool = DAILY_POOL.slice();
  const picked = [];
  let r = seed;
  const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
  while (picked.length < DAILY_COUNT && pool.length) {
    picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  S.daily = {
    date: key,
    tasks: picked.map((t) => ({ id: t.id, prog: 0, claimed: false })),
    allClaimed: false,
    counters: {},
    earnedAt: 0,
  };
  return true;
}

export function resetGameState() {
  const keep = defaultState();
  Object.assign(S, keep);
}
