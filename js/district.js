// Гонка за район: через дорогу работает конкурирующий пункт выдачи.
// Считаем выданные заказы за неделю и раз в неделю подводим итог.
//
// Соперник — бот, но темп он берёт от вашего: если играть больше, вы
// выигрываете, если забросить — обгонит. С каждой победой он злее.

import { DISTRICT } from './balance.js';
import { S, save, emit } from './state.js';
import * as reviews from './reviews.js';

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

/** Гонка за район открыта. До этого дом напротив пустует. */
export function unlocked() { return (S.level || 1) >= DISTRICT.needLevel; }

export function ensure() {
  if (!unlocked()) return;
  if (!S.district) {
    S.district = fresh(weekNo());
    // Открытие соперника — событие: о нём говорят и в ленте, и тостом.
    reviews.addNews(`Через дорогу открылся «${DISTRICT.name}» — теперь у вас есть сосед`,
                    'Новости квартала');
    emit('foe');
    return;
  }
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
  newsWeek(res);
  if (next.foeLvl > d.foeLvl) newsFoeLevel(next.foeLvl);
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
  if (!unlocked()) return;
  if (!S.district) ensure();
  if (!S.district) return;
  S.district.my += n;
  S.district.acc = (S.district.acc || 0) + n;
}

export function tick(dt) {
  if (!unlocked()) return;
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
  newsTick(d, dt);
}

// ── Новости района ───────────────────────────────────────────────────────────
// Гонка должна быть слышна, а не только видна в цифрах: смена лидера и рывки
// соперника попадают в ленту как городские новости.

let newsCool = 0;
function newsTick(d, dt) {
  newsCool = Math.max(0, newsCool - dt);
  const lead = d.my >= d.foe;
  if (d.lastLead == null) { d.lastLead = lead; return; }
  if (lead === d.lastLead || newsCool > 0) return;
  d.lastLead = lead;
  newsCool = 180;                       // не чаще раза в три минуты
  const my = Math.floor(d.my), foe = Math.floor(d.foe);
  reviews.addNews(lead
    ? `Ваш пункт вышел вперёд в гонке квартала: ${my} против ${foe} у «${DISTRICT.name}»`
    : `«${DISTRICT.name}» обошёл вас: ${foe} против ваших ${my}`, 'Гонка за район');
}

/** Итог недели — тоже новость, её видно в ленте вместе с отзывами. */
export function newsWeek(res) {
  reviews.addNews(res.won
    ? `Квартал за вами: ${res.my} выдач против ${res.foe} у «${DISTRICT.name}»`
    : `Неделя за «${DISTRICT.name}»: ${res.foe} выдач против ваших ${res.my}`, 'Итог недели');
}

/** Соперник подтянулся — об этом пишут раньше, чем вы это заметите. */
export function newsFoeLevel(lvl) {
  reviews.addNews(`«${DISTRICT.name}» расширился: у соседей теперь ${lvl}-я смена и больше касс`, 'Конкурент');
}

/** Пока игрока не было, соперник работал — но вполсилы. */
export function advanceOffline(sec) {
  if (!unlocked()) return;
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
