// Гонка за район: через дорогу работает конкурирующий пункт выдачи.
// Считаем выданные заказы за неделю и раз в неделю подводим итог.
//
// Соперник — бот, но темп он берёт от вашего: если играть больше, вы
// выигрываете, если забросить — обгонит. С каждой победой он злее.

import { DISTRICT } from './balance.js';
import { S, save, emit } from './state.js';

/** Номер текущей недели — простое ведро по 7 суток, без часовых поясов. */
export function weekNo(t = Date.now()) { return Math.floor(t / (7 * 86400e3)); }

export function weekEndsAt() { return (weekNo() + 1) * 7 * 86400e3; }
export function weekLeft() { return Math.max(0, (weekEndsAt() - Date.now()) / 1000); }

function fresh(week) {
  return {
    week,
    my: 0,               // выдано заказов мной за неделю
    foe: 0,              // выдано соперником
    elapsed: 0,          // прожито секунд недели (своё время, не настенные часы)
    acc: 0,              // заказов накопилось с прошлого шага
    paceEma: 0,          // сглаженный текущий темп игрока
    pace: 0,             // «на что вы способны»: медленно затухающий максимум
    foeLvl: S.district?.foeLvl || 1,
    wins: S.district?.wins || 0,
    losses: S.district?.losses || 0,
    streak: S.district?.streak || 0,
    startedAt: Date.now(),
    pending: null,       // итог прошедшей недели, ждёт награды
  };
}

export function ensure() {
  if (!S.district) { S.district = fresh(weekNo()); return; }
  if (S.district.week !== weekNo()) closeWeek();
}

/** Подводим итог недели и открываем новую. */
function closeWeek() {
  const d = S.district;
  const won = d.my >= d.foe;
  const res = {
    week: d.week, my: Math.floor(d.my), foe: Math.floor(d.foe), won,
    gold: won ? Math.round(DISTRICT.winGold + DISTRICT.streakGold * Math.min(d.streak, 6))
              : DISTRICT.loseGold,
  };
  const next = fresh(weekNo());
  next.wins = d.wins + (won ? 1 : 0);
  next.losses = d.losses + (won ? 0 : 1);
  next.streak = won ? d.streak + 1 : 0;
  next.foeLvl = Math.max(1, d.foeLvl + (won ? 1 : -1));
  next.pending = res;
  S.district = next;
  emit('district');
  save();
}

/** Насколько соперник сильнее вашего темпа на текущем уровне злости. */
export function foeFactor() {
  const d = S.district;
  return DISTRICT.baseFactor + DISTRICT.factorPerLvl * ((d?.foeLvl || 1) - 1);
}

/** Темп соперника: он равняется на то, что вы уже показали.
 *  Поэтому бросить игру нельзя — он продолжит идти вашим же темпом. */
export function foeRate() {
  const d = S.district;
  if (!d) return 0;
  return Math.max(DISTRICT.minRate, (d.pace || 0) * foeFactor());
}

/** Вы выдали заказ — засчитываем в район. */
export function addServed(n = 1) {
  if (!S.district) ensure();
  S.district.my += n;
  S.district.acc = (S.district.acc || 0) + n;
}

export function tick(dt) {
  const d = S.district;
  if (!d || dt <= 0) return;
  d.elapsed = (d.elapsed || 0) + dt;

  // мгновенный темп → сглаживаем, чтобы не дёргался
  const inst = (d.acc || 0) / dt;
  d.acc = 0;
  const k = 1 - Math.exp(-dt / DISTRICT.paceTau);
  d.paceEma = (d.paceEma || 0) + (inst - (d.paceEma || 0)) * k;

  // «на что вы способны»: держим максимум и очень медленно его отпускаем
  const decay = Math.pow(0.5, dt / (DISTRICT.paceHalfLifeH * 3600));
  d.pace = Math.max(d.paceEma, (d.pace || 0) * decay);

  d.foe += foeRate() * dt;
}

/** Пока игрока не было, соперник работал — но вполсилы. */
export function advanceOffline(sec) {
  const d = S.district;
  if (!d || sec < 60) return;
  const t = Math.min(sec, DISTRICT.offlineCapH * 3600);
  d.elapsed = (d.elapsed || 0) + t;
  d.foe += foeRate() * t * DISTRICT.offlineRate;
  d.pace = (d.pace || 0) * Math.pow(0.5, t / (DISTRICT.paceHalfLifeH * 3600));
}

export function pending() { return S.district?.pending || null; }

export function claim() {
  const p = pending();
  if (!p) return null;
  S.gold += p.gold;
  S.district.pending = null;
  emit('district');
  save();
  return p;
}

export function lead() {
  const d = S.district;
  if (!d) return 0;
  const total = d.my + d.foe;
  return total <= 0 ? 0.5 : d.my / total;
}
