// Продвижение пункта в соцсетях.
//
// Нанятый смм-щик ведёт страницу: сам факт живой страницы даёт постоянную
// прибавку к охвату, а каждый его пост коротко подбрасывает поток клиентов.
// Пост появляется в общей ленте наравне с отзывами и новостями района.

import { SMM, SMM_POSTS } from './balance.js';
import { S, save, emit } from './state.js';
import * as reviews from './reviews.js';
import { aiPromo } from './net.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function ensure() {
  if (!S.smm) S.smm = { lvl: 0, t: 0, boost: 0 };
  if (S.smm.boost == null) S.smm.boost = 0;
}

export function level() { ensure(); return S.smm.lvl; }
export function title() { ensure(); return SMM.titles[Math.min(S.smm.lvl, SMM.titles.length - 1)]; }
export function maxed() { ensure(); return S.smm.lvl >= SMM.maxLvl; }

export function cost() {
  ensure();
  return Math.ceil(SMM.cost * SMM.grow ** S.smm.lvl);
}

/** Как часто выходит пост на текущем уровне. */
export function postEvery() {
  ensure();
  return SMM.postEvery * SMM.postSpeed ** (S.smm.lvl - 1);
}

/** Постоянный охват плюс временный всплеск от свежего поста. */
export function reachMult() {
  ensure();
  const base = 1 + SMM.reachPerLvl * S.smm.lvl;
  return base * (S.smm.boost > 0 ? 1 + SMM.boost : 1);
}

export function boostLeft() { ensure(); return Math.max(0, S.smm.boost); }

export function hire() {
  ensure();
  if (maxed()) return null;
  const price = cost();
  if (S.cash < price) return null;
  S.cash -= price;
  S.smm.lvl++;
  S.smm.t = Math.min(S.smm.t, 6);          // первый пост почти сразу — видно, за что платили
  emit('smm');
  save(true);
  return { lvl: S.smm.lvl, price };
}

/** Отсчитываем время до следующего поста и держим всплеск. */
export function tick(dt) {
  ensure();
  if (S.smm.boost > 0) S.smm.boost = Math.max(0, S.smm.boost - dt);
  if (!S.smm.lvl) return;
  S.smm.t -= dt;
  if (S.smm.t > 0) return;
  S.smm.t = postEvery();
  post();
}

async function post() {
  const likes = Math.round((SMM.likeBase + SMM.likePerLvl * S.smm.lvl) * (0.7 + Math.random() * 0.8));
  reviews.addPromo(pick(SMM_POSTS), likes);
  S.smm.boost = SMM.boostFor;
  save();
  // Живой текст просим у модели: заготовки быстро приедаются, а пост тут
  // читают чаще всего. Не ответила — остаётся заготовка.
  const rev = S.reviews[0];
  const text = await aiPromo({ has: reviews.services(), stars: reviews.stars() });
  if (text && rev) { rev.text = text; rev.ai = true; emit('rep'); }
}
