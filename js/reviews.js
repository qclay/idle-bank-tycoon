// Репутация пункта, настроение клиентов и разбор претензий.
//
// Клиент, которого что-то не устроило, не уходит молча: он останавливается
// с недовольным значком и ждёт, пока вы подойдёте. Разобрались — репутация
// растёт, ушёл неразобранным — падает и появляется плохой отзыв.

import {
  REP, INCIDENTS, REVIEW_NAMES, REVIEW_GOOD, REVIEW_BAD, REVIEW_SOLVED, REVIEW_WALKOUT, REVIEW_MAX,
  COUNTERS, ZONES, NEWS_SOURCES,
} from './balance.js';
import { S, save, emit } from './state.js';
import { aiReviewBatch } from './net.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function ensure() {
  if (S.rep == null) S.rep = REP.start;
  if (!S.reviews) S.reviews = [];
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (st && st.morale == null) st.morale = 1;
  }
}

export function stars() { return clamp(S.rep ?? REP.start, REP.min, REP.max); }

/** Репутация выше трёх звёзд гонит поток клиентов, ниже — отпугивает. */
export function spawnMult() { return 1 + (stars() - 3) * REP.spawnPerStar; }
export function payMult() { return 1 + (stars() - 3) * REP.payPerStar; }

export function morale(counterId) {
  const st = S.counters[counterId];
  return clamp(st?.morale ?? 1, REP.moraleMin, REP.moraleMax);
}

function addRep(d) {
  S.rep = clamp((S.rep ?? REP.start) + d, REP.min, REP.max);
}

function addReview(kind, text, counterId, reason = '') {
  const c = COUNTERS.find((x) => x.id === counterId);
  const rev = {
    id: Math.random().toString(36).slice(2, 8),
    kind, text, who: pick(REVIEW_NAMES),
    at: c ? c.name : '',
    stars: kind === 'good' ? 5 : kind === 'solved' ? 4 : 1 + Math.floor(Math.random() * 2),
    t: Date.now(),
  };
  S.reviews.unshift(rev);
  if (S.reviews.length > REVIEW_MAX) S.reviews.length = REVIEW_MAX;
  queueAi(rev, reason);
  return rev;
}

// ── Живые тексты от модели ───────────────────────────────────────────────────
// Отзыв появляется сразу с заготовкой, иначе лента ждала бы сеть. Как только
// модель ответит, текст подменяется на написанный ею — пачкой, чтобы не жечь
// по запросу на каждого клиента.

const pending = [];
let aiTimer = 0;

/** Что в пункте действительно есть. Без этого списка модель сочиняет услуги,
 *  которых игрок ещё не построил, — и в ленте появлялись отзывы о примерочной
 *  у тех, у кого её нет. */
export function services() {
  const list = COUNTERS.filter((c) => S.counters[c.id]?.open).map((c) => c.name);
  for (const z of ZONES) if (S.zones?.[z.id]?.open) list.push(z.name);
  return list;
}

function queueAi(rev, reason) {
  pending.push({ id: rev.id, kind: rev.kind, at: rev.at, reason });
  if (pending.length >= 5) flushAi();
  else if (!aiTimer) aiTimer = setTimeout(flushAi, 12000);
}

async function flushAi() {
  clearTimeout(aiTimer); aiTimer = 0;
  const batch = pending.splice(0, 8);
  if (!batch.length) return;
  const has = services();
  const lines = await aiReviewBatch(batch.map(({ kind, at, reason }) => ({ kind, at, reason, has })));
  if (!lines) return;                       // модель недоступна — остаются заготовки
  batch.forEach((b, i) => {
    const line = lines[i];
    if (!line) return;
    const rev = S.reviews.find((x) => x.id === b.id);
    if (rev) { rev.text = line; rev.ai = true; }
  });
  emit('rep');
}

/** Клиента обслужили. Решаем, доволен он или будет претензия. */
export function onServed(k, counterId) {
  ensure();
  const st = S.counters[counterId];
  const waited = clamp(k.waited || 0, 0, 1);
  const m = morale(counterId);
  let p = REP.upsetBase + REP.upsetPerWait * waited + REP.upsetMoraleWeight * (1 - m);
  if (!st?.clerk) p += 0.02;
  if (Math.random() < clamp(p, 0, 0.6)) {
    const inc = pick(INCIDENTS);
    return { upset: true, incident: inc, counterId };
  }
  if (Math.random() < 0.14) { addRep(REP.goodDelta); addReview('good', pick(REVIEW_GOOD), counterId, 'всё прошло быстро'); emit('rep'); }
  return { upset: false };
}

/** Терпение на исходе: 0 — всё хорошо, 1 — мрачнеет, 2 — злится.
 *  Настроение висит над головой, чтобы очередь было видно издалека. */
export function waitMood(waited) {
  if (waited >= REP.angryAt) return 2;
  if (waited >= REP.moodAt) return 1;
  return 0;
}

/** Клиент ушёл, не дождавшись выдачи. Самая дорогая потеря: и заказ не забрал,
 *  и отзыв напишет. */
export function onWalkedOut(counterId) {
  ensure();
  addRep(-REP.walkoutDelta);
  addReview('bad', pick(REVIEW_WALKOUT), counterId, 'не дождался выдачи и ушёл');
  S.stats.walkouts = (S.stats.walkouts || 0) + 1;
  emit('rep');
  save();
}

/** Клиент ушёл, так и не дождавшись разбора. */
export function onAbandoned(counterId) {
  ensure();
  addRep(-REP.badDelta);
  addReview('bad', pick(REVIEW_BAD), counterId);
  emit('rep');
  save();
}

// ── Разбор претензии ─────────────────────────────────────────────────────────

/** Сколько стоит штраф или извинение с бонусом. */
export function fineAmount(counterId, kind = 'fine') {
  const c = COUNTERS.find((x) => x.id === counterId);
  if (!c) return 0;
  const st = S.counters[c.id];
  const base = c.base * 1.125 ** ((st?.lvl || 1) - 1);
  return Math.ceil(base * 60 * (kind === 'fine' ? REP.fineShare : REP.bonusShare));
}

/** Оштрафовать оператора: скандал гаснет, но человек работает хуже. */
export function fine(counterId) {
  ensure();
  const st = S.counters[counterId];
  const sum = fineAmount(counterId, 'fine');
  S.cash += sum;                                   // штраф идёт в кассу
  if (st) st.morale = clamp((st.morale ?? 1) + REP.finePenalty, REP.moraleMin, REP.moraleMax);
  addRep(REP.fineDelta);
  addReview('solved', pick(REVIEW_SOLVED), counterId);
  S.stats.fines = (S.stats.fines || 0) + 1;
  emit('rep'); save();
  return { sum, morale: st?.morale ?? 1 };
}

/** Разобраться: иногда прав оператор, иногда клиент. */
export function investigate(counterId, incident) {
  ensure();
  const st = S.counters[counterId];
  let chance = REP.rightChance;
  if (incident?.blame === 'client') chance += 0.25;
  if (incident?.blame === 'staff') chance -= 0.25;
  chance += ((st?.clerk || 0) * 0.015);
  const staffRight = Math.random() < clamp(chance, 0.1, 0.9);
  if (staffRight) {
    if (st) st.morale = clamp((st.morale ?? 1) + REP.praiseBonus, REP.moraleMin, REP.moraleMax);
    addRep(REP.solvedDelta * 0.6);
    addReview('solved', pick(REVIEW_SOLVED), counterId);
  } else {
    addRep(-REP.badDelta * 0.4);
    addReview('bad', pick(REVIEW_BAD), counterId);
  }
  S.stats.checks = (S.stats.checks || 0) + 1;
  emit('rep'); save();
  return { staffRight };
}

/** Извиниться и дать бонус: дорого, но репутация растёт сильнее всего. */
export function apologize(counterId) {
  ensure();
  const sum = fineAmount(counterId, 'bonus');
  if (S.cash < sum) return null;
  S.cash -= sum;
  addRep(REP.solvedDelta);
  addReview('solved', pick(REVIEW_SOLVED), counterId);
  S.stats.apologies = (S.stats.apologies || 0) + 1;
  emit('rep'); save();
  return { sum };
}

/** Мораль сама возвращается к норме. */
export function tick(dt) {
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st || st.morale == null) continue;
    if (st.morale < 1) st.morale = Math.min(1, st.morale + REP.moraleRecover * dt);
    else if (st.morale > 1) st.morale = Math.max(1, st.morale - REP.moraleRecover * 0.5 * dt);
  }
}

// ── Городские новости и посты продвижения ────────────────────────────────────
// Лента — это не только отзывы: туда же падают новости района о конкуренте и
// посты нанятого смм-щика. Формат общий, отличает их только kind.

export function addNews(text, tag = '') {
  ensure();
  S.reviews.unshift({
    id: Math.random().toString(36).slice(2, 8),
    kind: 'news', text, who: pick(NEWS_SOURCES), at: tag, t: Date.now(), likes: 0,
  });
  if (S.reviews.length > REVIEW_MAX) S.reviews.length = REVIEW_MAX;
  emit('rep');
}

export function addPromo(text, likes) {
  ensure();
  S.reviews.unshift({
    id: Math.random().toString(36).slice(2, 8),
    kind: 'smm', text, who: 'Ваш пункт', at: '', t: Date.now(), likes,
  });
  if (S.reviews.length > REVIEW_MAX) S.reviews.length = REVIEW_MAX;
  emit('rep');
}

export function feed() { return S.reviews || []; }

/** Только отзывы клиентов — рейтинг считается по ним. */
export function onlyReviews() { return (S.reviews || []).filter((r) => r.kind !== 'news' && r.kind !== 'smm'); }
