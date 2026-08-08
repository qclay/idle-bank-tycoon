// Мета-прогресс: ежедневные задания, достижения, вход по дням,
// сейфы, супер-менеджеры, бусты, оффлайн-награда.

import {
  DAILY_POOL, DAILY_ALL_BONUS, ACHIEVEMENTS, DAILY_LOGIN, CHESTS,
  SUPER_MANAGERS, RARITY, SM_LEVEL_POWER, SM_SLOTS, BOOSTS, OFFLINE, XP,
} from './balance.js';
import { S, save, emit, todayKey, rollDaily } from './state.js';
import { addCash, addGold, addXp, incomePerSec, invalidateBonuses, spendGold, offlineCapUpCost } from './engine.js';

// ── Ежедневные задания ────────────────────────────────────────────────────────

export function dailyDef(id) { return DAILY_POOL.find((d) => d.id === id); }

/** Абсолютная цель задания (для «заработать доход за N минут» считается от текущего дохода). */
export function dailyGoal(task) {
  const def = dailyDef(task.id);
  if (!def) return 1;
  if (!def.rel) return def.goal;
  if (!task.goalAbs) {
    const inc = incomePerSec();
    if (inc > 0) { task.goalAbs = inc * def.rel; save(); }
    else return Infinity;
  }
  return task.goalAbs;
}

export function dailyProgress(task) {
  const def = dailyDef(task.id);
  if (!def) return 0;
  const c = S.daily.counters || {};
  const key = def.rel ? 'earnedRaw' : def.stat;
  return c[key] || 0;
}

export function dailyDone(task) {
  return dailyProgress(task) >= dailyGoal(task);
}

export function claimDaily(task) {
  if (task.claimed || !dailyDone(task)) return null;
  const def = dailyDef(task.id);
  task.claimed = true;
  const got = grant(def.reward);
  addXp(XP.perTask);
  emit('daily');
  save();
  return got;
}

export function dailyAllDone() {
  return S.daily.tasks.length > 0 && S.daily.tasks.every((t) => t.claimed);
}

export function claimDailyAll() {
  if (S.daily.allClaimed || !dailyAllDone()) return null;
  S.daily.allClaimed = true;
  const got = grant(DAILY_ALL_BONUS);
  emit('daily');
  save();
  return got;
}

export function refreshDaily() {
  if (rollDaily()) { emit('daily'); save(); return true; }
  return false;
}

// ── Достижения ────────────────────────────────────────────────────────────────

export function achvState(a) {
  const tier = S.achv[a.id] || 0;
  const maxed = tier >= a.tiers.length;
  const goal = maxed ? a.tiers[a.tiers.length - 1] : a.tiers[tier];
  const cur = S.stats[a.stat] || 0;
  return { tier, maxed, goal, cur, done: !maxed && cur >= goal, gold: maxed ? 0 : a.gold[tier] };
}

export function claimAchv(a) {
  const st = achvState(a);
  if (!st.done) return null;
  S.achv[a.id] = st.tier + 1;
  addGold(st.gold);
  addXp(XP.perTask);
  emit('achv');
  save();
  return { gold: st.gold };
}

export function achvPending() {
  return ACHIEVEMENTS.filter((a) => achvState(a).done).length;
}

// ── Вход по дням ──────────────────────────────────────────────────────────────

export function loginAvailable() {
  return S.login.date !== todayKey();
}

export function loginDay() {
  return Math.min(DAILY_LOGIN.length, (S.login.day % DAILY_LOGIN.length) + 1);
}

export function claimLogin() {
  if (!loginAvailable()) return null;
  const d = DAILY_LOGIN[loginDay() - 1];
  S.login.day = S.login.day + 1;
  S.login.date = todayKey();
  const got = grant(rewardOf(d));
  emit('login');
  save();
  return { day: d.day, got };
}

function rewardOf(d) {
  if (d.type === 'cash') return { cashHours: d.hours };
  if (d.type === 'gold') return { gold: d.amount };
  if (d.type === 'boost') return { boost: d.boost };
  if (d.type === 'chest') return { chest: d.chest };
  return {};
}

// ── Универсальная выдача наград ───────────────────────────────────────────────

export function hourlyCash(hours) {
  const inc = incomePerSec();
  // Пока доход нулевой — компенсируем небольшой суммой, чтобы награда не пропадала.
  const base = inc > 0 ? inc : 1.5;
  return base * 3600 * hours;
}

export function grant(reward = {}) {
  const out = [];
  if (reward.gold) { addGold(reward.gold); out.push({ kind: 'gold', amount: reward.gold }); }
  if (reward.cashHours) {
    const v = hourlyCash(reward.cashHours);
    addCash(v); out.push({ kind: 'cash', amount: v, hours: reward.cashHours });
  }
  if (reward.cash) { addCash(reward.cash); out.push({ kind: 'cash', amount: reward.cash }); }
  if (reward.boost) { activateBoost(reward.boost, true); out.push({ kind: 'boost', id: reward.boost }); }
  if (reward.shards) {
    for (const [id, n] of Object.entries(reward.shards)) addShards(id, n);
    out.push({ kind: 'shards', shards: reward.shards });
  }
  if (reward.chest) {
    const n = reward.chestCount || 1;
    out.push({ kind: 'chest', id: reward.chest, count: n });
  }
  save();
  return out;
}

// ── Сейфы (сундуки) ───────────────────────────────────────────────────────────

export function chestReady(id) {
  const def = CHESTS[id];
  if (!def.cd) return true;
  return Date.now() >= (S.chest.freeAt || 0);
}

export function chestLeft(id) {
  const def = CHESTS[id];
  if (!def.cd) return 0;
  return Math.max(0, ((S.chest.freeAt || 0) - Date.now()) / 1000);
}

function pickRarity(boost = 0) {
  const entries = Object.values(RARITY);
  const weights = entries.map((r) => {
    if (r.id === 'common') return Math.max(1, r.weight - boost * 12);
    if (r.id === 'rare') return r.weight + boost * 4;
    if (r.id === 'epic') return r.weight + boost * 5;
    return r.weight + boost * 3;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < entries.length; i++) { r -= weights[i]; if (r <= 0) return entries[i].id; }
  return 'common';
}

export function openChest(id) {
  const def = CHESTS[id];
  if (!def) return null;
  if (def.cd) {
    if (!chestReady(id)) return null;
    S.chest.freeAt = Date.now() + def.cd * 1000;
  } else if (def.gold > 0) {
    if (!spendGold(def.gold)) return null;
  }
  const loot = [];
  const [h0, h1] = def.loot.cashHours;
  const cash = hourlyCash(h0 + Math.random() * (h1 - h0));
  addCash(cash);
  loot.push({ kind: 'cash', amount: cash });

  const [g0, g1] = def.loot.gold;
  const gold = Math.round(g0 + Math.random() * (g1 - g0));
  addGold(gold);
  loot.push({ kind: 'gold', amount: gold });

  for (let i = 0; i < def.cards; i++) {
    const rarity = pickRarity(def.loot.rarityBoost);
    const pool = SUPER_MANAGERS.filter((m) => m.rarity === rarity);
    const card = pool[Math.floor(Math.random() * pool.length)];
    const n = 1 + Math.floor(Math.random() * (rarity === 'common' ? 4 : rarity === 'rare' ? 3 : 2));
    const res = addShards(card.id, n);
    loot.push({ kind: 'card', id: card.id, shards: n, isNew: res.isNew, levelUp: res.levelUp });
  }
  S.stats.chests = (S.stats.chests || 0) + 1;
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters.chests = (S.daily.counters.chests || 0) + 1;
  emit('chest');
  save();
  return loot;
}

export function addShards(id, n) {
  const def = SUPER_MANAGERS.find((m) => m.id === id);
  if (!def) return { isNew: false, levelUp: false };
  let c = S.sm.cards[id];
  let isNew = false;
  if (!c) {
    c = S.sm.cards[id] = { shards: 0, level: 1 };
    isNew = true;
    S.stats.smCards = Object.keys(S.sm.cards).length;
    // Первая карта автоматически встаёт в свободный слот.
    const free = S.sm.equipped.findIndex((x, i) => i < S.sm.slots && !x);
    if (free >= 0) { S.sm.equipped[free] = id; invalidateBonuses(); }
  }
  c.shards += n;
  let levelUp = false;
  const need = RARITY[def.rarity].shards;
  while (c.level < SM_LEVEL_POWER.length && c.shards >= need[c.level - 1]) {
    c.shards -= need[c.level - 1];
    c.level++;
    levelUp = true;
  }
  if (levelUp) invalidateBonuses();
  return { isNew, levelUp };
}

export function smNeed(id) {
  const def = SUPER_MANAGERS.find((m) => m.id === id);
  const c = S.sm.cards[id];
  if (!def || !c) return 0;
  if (c.level >= SM_LEVEL_POWER.length) return 0;
  return RARITY[def.rarity].shards[c.level - 1];
}

export function smPower(id) {
  const def = SUPER_MANAGERS.find((m) => m.id === id);
  const c = S.sm.cards[id];
  if (!def || !c) return 0;
  return def.bonus.v * RARITY[def.rarity].power * (SM_LEVEL_POWER[c.level - 1] || 1);
}

export function equipSm(id, slot) {
  if (slot >= S.sm.slots) return false;
  const cur = S.sm.equipped.indexOf(id);
  if (cur >= 0) S.sm.equipped[cur] = null;
  S.sm.equipped[slot] = id;
  invalidateBonuses();
  emit('sm'); save();
  return true;
}

export function unequipSm(slot) {
  S.sm.equipped[slot] = null;
  invalidateBonuses(); emit('sm'); save();
  return true;
}

export function unlockSmSlot() {
  const next = SM_SLOTS[S.sm.slots];
  if (!next) return false;
  if (!spendGold(next.gold)) return false;
  S.sm.slots++;
  emit('sm'); save();
  return true;
}

// ── Бусты ─────────────────────────────────────────────────────────────────────

export function boostFreeLeft(id) {
  return Math.max(0, ((S.freeBoost[id] || 0) - Date.now()) / 1000);
}

export function activateBoost(id, free = false) {
  const def = BOOSTS[id];
  if (!def) return false;
  if (!free) {
    if (!spendGold(def.gold)) return false;
  }
  if (id === 'instant') {
    const v = hourlyCash(def.hours);
    addCash(v);
  } else {
    const now = Date.now();
    const cur = S.boosts[id];
    const from = cur && cur.until > now ? cur.until : now;
    S.boosts[id] = { until: from + def.dur * 1000 };
  }
  S.stats.boosts = (S.stats.boosts || 0) + 1;
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters.boosts = (S.daily.counters.boosts || 0) + 1;
  emit('boost'); save();
  return true;
}

export function claimFreeBoost(id) {
  if (boostFreeLeft(id) > 0) return false;
  const def = BOOSTS[id];
  S.freeBoost[id] = Date.now() + def.freeCd * 1000;
  return activateBoost(id, true);
}

// ── Оффлайн ───────────────────────────────────────────────────────────────────

export function upgradeOfflineCap() {
  const cost = offlineCapUpCost();
  if (!spendGold(cost)) return false;
  S.offlineUps++;
  emit('offline'); save();
  return true;
}

export function claimOffline(double = false) {
  const p = S.offlinePending;
  if (!p) return null;
  let amount = p.amount;
  if (double) {
    if (!spendGold(OFFLINE.doubleGold)) return null;
    amount *= 2;
  }
  addCash(amount);
  S.offlinePending = null;
  emit('offline'); save();
  return amount;
}

// ── Сколько «красных точек» показывать на вкладках ────────────────────────────

export function badgeCounts() {
  const daily = S.daily.tasks.filter((t) => !t.claimed && dailyDone(t)).length
    + (dailyAllDone() && !S.daily.allClaimed ? 1 : 0);
  const achv = achvPending();
  const chests = chestReady('free') ? 1 : 0;
  const login = loginAvailable() ? 1 : 0;
  return { tasks: daily + achv, presents: chests + login, shop: 0, total: daily + achv + chests + login };
}
