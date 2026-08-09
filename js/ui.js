// HUD, джойстик, подсказки над падами, тосты, нижняя навигация.

import { fmt, du, clamp, plural } from './core.js';
import { S, save } from './state.js';
import { xpForLevel } from './balance.js';
import { pads, padState } from './game.js';
import * as game from './game.js';
import { COUNTERS, VAULT, DISTRICT } from './balance.js';
import * as district from './district.js';
import * as reviews from './reviews.js';
import { coop, others, visiting } from './coop.js';
import { clerkSpot, player, bagCap } from './actors.js';
import * as actors from './actors.js';
import { dist } from './core.js';
import * as scene from './scene.js';
import * as nav from './nav.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let els = {};
export const joy = { dx: 0, dy: 0, active: false };

export function initUI() {
  els = {
    cash: $('#cash'), gold: $('#gold'), lvlN: $('#lvlN'), lvlFill: $('#lvlFill'),
    carry: $('#carry'), carryFill: $('#carryFill'), carryTxt: $('#carryTxt'),
    xpNum: $('#xpNum'), cashChip: $('.cap--cash'),
    joy: $('#joy'), base: $('#joyBase'), knob: $('#joyKnob'),
    worldUI: $('#worldUI'), toasts: $('#toasts'), nav: $('#nav'), hud: $('#hud'),
    repV: $('#repV'), repPill: $('#repPill'), repBadge: $('#repBadge'),
  };
  bindJoystick();
  els.nav.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (b) window.__openTab(b.dataset.tab);
  });
  $('#goldPill').addEventListener('click', () => window.__openTab('shop'));
  $('#repPill').addEventListener('click', () => window.__openTab('social'));
  $('#netPill').addEventListener('click', () => window.__openTab('network'));
}

export function setNav(tab) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
}

// ── Джойстик ─────────────────────────────────────────────────────────────────

function bindJoystick() {
  let id = null, ox = 0, oy = 0;
  const R = () => 58 * du();

  const start = (x, y, pid) => {
    id = pid; ox = x; oy = y;
    els.joy.classList.add('is-on');
    els.base.style.left = `${x}px`; els.base.style.top = `${y}px`;
    els.knob.style.left = `${x}px`; els.knob.style.top = `${y}px`;
    joy.active = true;
  };
  const move = (x, y) => {
    let dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy);
    const r = R();
    if (d > r) { dx = (dx / d) * r; dy = (dy / d) * r; }
    els.knob.style.left = `${ox + dx}px`; els.knob.style.top = `${oy + dy}px`;
    const k = Math.min(1, d / r);
    if (d < 5) { joy.dx = 0; joy.dy = 0; return; }
    // экранное направление → мировое (обратная изометрия)
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const wx = (ny / (1 / 2) + nx) / 2;
    const wy = (ny / (1 / 2) - nx) / 2;
    const wl = Math.hypot(wx, wy) || 1;
    joy.dx = (wx / wl) * k;
    joy.dy = (wy / wl) * k;
  };
  const end = () => {
    id = null; joy.dx = 0; joy.dy = 0; joy.active = false;
    els.joy.classList.remove('is-on');
  };

  els.joy.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    els.joy.setPointerCapture(e.pointerId);
    start(e.clientX, e.clientY, e.pointerId);
  });
  els.joy.addEventListener('pointermove', (e) => {
    if (id !== e.pointerId) return;
    move(e.clientX, e.clientY);
  });
  // pointerleave не слушаем: палец заходит на HUD и управление обрывалось
  for (const ev of ['pointerup', 'pointercancel']) {
    els.joy.addEventListener(ev, (e) => { if (id === e.pointerId) end(); });
  }
  window.addEventListener('blur', end);
}

// ── HUD ──────────────────────────────────────────────────────────────────────

let hudAcc = 0;
export function tickHud(dt) {
  hudAcc += dt;
  if (hudAcc < 0.08) return;
  hudAcc = 0;
  const cashTxt = fmt(S.cash);
  if (els.cash.textContent !== cashTxt) {
    els.cash.textContent = cashTxt;
    // счётчик подпрыгивает на приход денег — иначе прибавка незаметна
    els.cashChip.classList.remove('bump');
    void els.cashChip.offsetWidth;
    els.cashChip.classList.add('bump');
  }
  els.gold.textContent = fmt(S.gold);
  els.lvlN.textContent = S.level;
  const need = xpForLevel(S.level);
  els.lvlFill.style.width = `${clamp((S.xp / need) * 100, 0, 100)}%`;
  els.xpNum.textContent = `${fmt(S.xp)} / ${fmt(need)}`;

  // Рейтинг всегда на виду: он тянет за собой и поток клиентов, и средний чек.
  const rep = reviews.stars();
  const repTxt = rep.toFixed(1);
  if (els.repV.textContent !== repTxt) els.repV.textContent = repTxt;
  els.repPill.classList.toggle('is-bad', rep < 3.5);
  // Сеть показывается, только когда в ней уже есть смысл: до первого нового
  // района этой кнопки на экране нет.
  const net = $('#netPill');
  const gain = game.prestigeGain();
  const show = (S.prestige?.points || 0) > 0 || game.prestigeReady();
  net.hidden = !show;
  if (show) {
    net.querySelector('b').textContent = '×' + game.prestigeMult().toFixed(2);
    net.querySelector('.badge').hidden = gain <= 0;
  }

  const unread = Math.max(0, (S.reviews?.length || 0) - (S.seenReviews || 0));
  els.repBadge.hidden = unread === 0;
  if (unread) els.repBadge.textContent = unread > 9 ? '9+' : String(unread);

  const cap = bagCap();
  const has = S.carry > 0.01;
  els.carry.hidden = !has;
  if (has) {
    const k = clamp(S.carry / cap, 0, 1);
    els.carryFill.style.width = `${k * 100}%`;
    els.carryTxt.textContent = fmt(S.carry);
    els.carry.classList.toggle('is-full', k > 0.995);
  }
}

// ── Подсказки над падами ─────────────────────────────────────────────────────

const tags = new Map();

// Подписи держатся за точки в мире, поэтому двигаются каждый кадр вместе с
// камерой. Реже нельзя: на фоне плавного зала они начинают дёргаться, и это
// читается как тормоза. Текст переписываем только когда он изменился.
export function tickWorldTags() {
  tickGoal();
  tickRoomTitle();
  tickFoeMarker();
  tickNameTags();
  tickMoods();
  const list = pads();
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let t = tags.get(p.id);
    if (!t) {
      t = document.createElement('div');
      t.className = 'wtag ' + (p.kind === 'up' ? 'wtag--up' : 'wtag--buy');
      t.innerHTML = `<div class="wtag__sign">
        <div class="wtag__t"></div>
        <div class="wtag__p"><span class="ic"><svg><use href="#i-coin"/></svg></span><b></b></div>
        <div class="wtag__bar"><i></i></div></div>`;
      els.worldUI.appendChild(t);
      tags.set(p.id, t);
    }
    const paid = S.padPaid?.[p.id] || 0;
    const left = Math.max(0, p.cost - paid);
    const title = p.kind === 'up' ? `${p.title} · ур. ${(S.ups[p.up] || 0) + 1}` : p.title;
    const tt = t.querySelector('.wtag__t');
    if (tt.textContent !== title) tt.textContent = title;
    const nb = t.querySelector('.wtag__p b');
    const txt = fmt(left);
    if (nb.textContent !== txt) nb.textContent = txt;
    t.querySelector('.wtag__bar i').style.width = `${(paid / p.cost) * 100}%`;
    t.classList.toggle('wtag--done', S.cash < left && paid === 0);
    // Вдвоём на одной площадке стройка идёт вдвое быстрее — это надо видеть.
    t.classList.toggle('wtag--crew', padState.id === p.id && padState.crew > 1);

    // Три состояния вместо двух. Раньше все ценники висели во весь рост
    // одновременно и зал превращался в кашу из табличек. Теперь подробности
    // видно там, где стоит игрок, соседние помещения показывают только
    // кружок-подсказку, а дальние — ничего.
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const here = nav.roomAt(cx, cy);
    const my = nav.roomAt(player.x, player.y);
    const d = dist(player.x, player.y, cx, cy);
    const sameRoom = here && my && here.id === my.id;
    const near = d < 3.4 && sameRoom;
    const mode = near ? 'full' : (sameRoom || d < 6) ? 'dot' : 'off';
    t.classList.toggle('is-far', mode === 'dot');
    t.classList.toggle('is-off', mode === 'off');
    if (mode === 'off') continue;
    // рядом поднимаем повыше, иначе табличка накрывает героя
    const s = scene.screenOf(cx, cy, near ? 1.35 : 0.4);
    t.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-100%)`;
  }
  // Подсказок в мире больше нет: куда идти, говорит нижняя строка цели. Две
  // подсказки об одном и том же только спорили друг с другом.

  for (const [id, el] of tags) {
    if (!seen.has(id)) { el.remove(); tags.delete(id); }
  }
}

function hint(id, text, x, y, seen) {
  // подсказки всегда компактные
  seen.add(id);
  let t = tags.get(id);
  if (!t) {
    t = document.createElement('div');
    t.className = 'wtag wtag--hint';
    t.innerHTML = '<div class="wtag__sign"><div class="wtag__t"></div></div>';
    els.worldUI.appendChild(t);
    tags.set(id, t);
  }
  const tt = t.querySelector('.wtag__t');
  if (tt.textContent !== text) tt.textContent = text;
  const s = scene.screenOf(x, y, 0.75);
  t.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-100%)`;
}

export function clearTags() { for (const [, el] of tags) el.remove(); tags.clear(); }

// ── Куда идти сейчас ─────────────────────────────────────────────────────────
// Единственная подсказка на экране: стрелка в сторону дела, название дела и
// расстояние. Когда дел нет — прямо говорим об этом: игроку важно понимать,
// что можно ничего не делать, а не искать, что он упустил.

let goalEl = null;
let goalCalm = 0;
let goalTab = null;
function tickGoal() {
  if (!goalEl) {
    goalEl = document.getElementById('goal');
    goalEl.addEventListener('click', () => {
      haptic('light');
      if (goalTab) window.__openTab(goalTab);
    });
  }
  const g = game.nextGoal();
  if (!g) {
    goalCalm += 1 / 60;
    if (goalCalm > 1.2) {                       // не мигаем на каждую секунду затишья
      goalEl.hidden = false;
      goalEl.className = 'is-calm';
      goalEl.querySelector('.goal__t').textContent = 'Всё под контролем';
      goalEl.querySelector('.goal__d').textContent = '';
      goalEl.querySelector('.goal__arrow').style.transform = 'rotate(0deg)';
    }
    return;
  }
  goalCalm = 0;
  goalEl.hidden = false;
  goalEl.className = (g.hot ? 'is-hot' : '') + (g.tutor ? ' is-tutor' : '');
  const t2 = goalEl.querySelector('.goal__t');
  if (t2.textContent !== g.label) t2.textContent = g.label;
  goalTab = g.tab || null;
  // Шаг обучения может звать не в точку зала, а в раздел меню — тогда стрелки
  // нет, а по самой подсказке открывается нужный экран.
  if (g.x == null) {
    goalEl.querySelector('.goal__d').textContent = 'нажмите';
    goalEl.querySelector('.goal__arrow').style.opacity = '0';
    goalEl.classList.add('is-here');
    return;
  }
  goalEl.querySelector('.goal__arrow').style.opacity = '1';
  const dx = g.x - player.x, dy = g.y - player.y;
  const d = Math.hypot(dx, dy);
  goalEl.querySelector('.goal__d').textContent = d < 1.4 ? 'вы на месте' : `${Math.round(d)} шагов`;
  // стрелку поворачиваем в экранных координатах, а не в тайловых
  const a = scene.screenOf(g.x, g.y, 0), b2 = scene.screenOf(player.x, player.y, 0);
  goalEl.querySelector('.goal__arrow').style.transform =
    `rotate(${Math.atan2(a.y - b2.y, a.x - b2.x) * 180 / Math.PI}deg)`;
  goalEl.classList.toggle('is-here', d < 1.4);
}

// ── Название комнаты ─────────────────────────────────────────────────────────
// Вместо постоянных подписей по всему залу — короткая плашка при входе в
// помещение. Так понятно, где ты находишься, и ничего не висит над головой
// всю игру.

let roomNow = '';
let roomEl = null;
let roomT = 0;
function tickRoomTitle() {
  const r = nav.roomAt(player.x, player.y);
  const id = r?.id || '';
  if (!roomEl) {
    roomEl = document.createElement('div');
    roomEl.className = 'roomttl';
    els.worldUI.appendChild(roomEl);
  }
  if (id !== roomNow) {
    roomNow = id;
    roomT = id ? 2.4 : 0;
    if (id) {
      roomEl.innerHTML = `<b>${r.name}</b>${r.dark ? '<i>тут не горит свет</i>' : ''}`;
      roomEl.classList.remove('is-on');
      void roomEl.offsetWidth;
      roomEl.classList.add('is-on');
    }
  }
  if (roomT > 0) {
    roomT -= 1 / 60;
    if (roomT <= 0) roomEl.classList.remove('is-on');
  }
}

// ── Настроение клиентов ──────────────────────────────────────────────────────
// Значок над головой — не картинка, а кнопка: по нему и разбирают претензию.
// Бегать через весь зал к каждому недовольному было мучением.

const moodEls = new Map();
const FACE = { upset: 'i-sad', bad: 'i-sad', meh: 'i-meh', good: 'i-happy',
               work: 'i-box', slack: 'i-phone' };

/** Что показать над сотрудником на складе. В темноте — ничего: чтобы узнать,
 *  надо подойти. */
function stockBubbles() {
  const out = [];
  for (const a of actors.clerkList()) {
    if (a.job !== 'search' || !actors.clerkSeen(a)) continue;
    out.push({ id: 'clerk_' + a.id, x: a.x, y: a.y, mood: a.slack ? 'slack' : 'work', clerk: a });
  }
  return out;
}

function tickMoods() {
  const live = new Set();
  const list = [...actors.customers, ...actors.ghostList(), ...stockBubbles()];
  for (const k of list) {
    if (!k.mood) continue;
    live.add(k.id);
    let el = moodEls.get(k.id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'bub';
      el.innerHTML = '<span class="bub__f"><svg><use/></svg></span>';
      el.addEventListener('click', (e) => { e.stopPropagation(); onMoodTap(k); });
      els.worldUI.appendChild(el);
      moodEls.set(k.id, el);
    }
    if (el.__m !== k.mood) {
      el.__m = k.mood;
      el.className = `bub bub--${k.mood}`;
      el.querySelector('use').setAttribute('href', `#${FACE[k.mood] || 'i-meh'}`);
    }
    const p = scene.screenOf(k.x, k.y, 2.0);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%,-100%)`;
  }
  for (const [id, el] of moodEls) if (!live.has(id)) { el.remove(); moodEls.delete(id); }
}

function onMoodTap(k) {
  haptic('light');
  if (k.clerk) { window.__errand?.(k.clerk); return; }
  if (k.remote) { toast('Разбирается хозяин пункта'); return; }
  if (k.mood === 'upset') { window.__incident?.(k); return; }
  const c = COUNTERS.find((x) => x.id === k.counter);
  const sec = Math.round((k.t || 0));
  toast(`Ждёт ${sec} ${plural(sec, 'секунду', 'секунды', 'секунд')}${c ? ` · ${c.name}` : ''}`);
}

// ── Подписи над гостями ──────────────────────────────────────────────────────

const nameTags = new Map();
function tickNameTags() {
  const live = new Set();
  for (const p of others()) {
    live.add(p.id);
    let el = nameTags.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'nametag';
      el.textContent = p.name;
      els.worldUI.appendChild(el);
      nameTags.set(p.id, el);
    }
    const s = scene.screenOf(p.x, p.y, 1.5);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-100%)`;
    el.classList.toggle('is-busy', (p.carry || 0) > 0.5);
  }
  for (const [id, el] of nameTags) if (!live.has(id)) { el.remove(); nameTags.delete(id); }
}

/** Сколько нас в зале — короткой цифрой в полосе состояния. Подробности и
 *  приглашение живут на своём экране, в шапке им не место. */
export function showCoop() {
  const el = document.getElementById('coopChip');
  if (!el) return;
  const list = others();
  const away = visiting();
  el.querySelector('b').textContent = away && !coop.hostOnline ? '—' : String(list.length + 1);
  el.classList.toggle('is-live', list.length > 0);
  el.classList.toggle('is-away', away);
}

// ── Указатель на соперника ───────────────────────────────────────────────────
// Здание стоит через дорогу и часто вне кадра — без указателя игрок его
// просто не находит.

let foeEl = null;
export function tickFoeMarker() {
  if (!foeEl) {
    foeEl = document.createElement('button');
    foeEl.className = 'foemark';
    foeEl.innerHTML = `<i class="foemark__arrow"></i>
      <span class="foemark__body">
        <b class="foemark__t"></b>
        <span class="foemark__s"><i class="me"></i><i class="foe"></i></span>
      </span>`;
    foeEl.addEventListener('click', () => window.__openTab('tasks', 'district'));
    els.worldUI.appendChild(foeEl);
  }
  // Пока гонка не началась, указатель на соперника только мешает: он висит
  // посреди экрана с нулями и спорит с названием комнаты.
  const d0 = S.district;
  const race = d0 && (d0.my > 0 || d0.foe > 0);
  foeEl.hidden = !race;
  if (!race) return;
  const F = scene.FOE;
  const p = scene.screenOf((F.x0 + F.x1) / 2, F.door.y, 3.4);
  const W = scene.viewW(), H = scene.viewH();
  const ins = hudInsets();
  const pad = 26 * du();
  // Метка растёт вверх от точки, поэтому в верхний упор закладываем её высоту —
  // иначе она наползает на полоску уровня.
  const minY = ins.top + pad + (foeEl.offsetHeight || 34 * du());
  const maxY = H - ins.bottom - pad;
  const minX = pad, maxX = W - pad;
  const off = p.x < minX || p.x > maxX || p.y < minY || p.y > maxY;
  const x = Math.max(minX, Math.min(maxX, p.x));
  const y = Math.max(minY, Math.min(maxY, p.y));
  foeEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%,-100%)`;
  foeEl.classList.toggle('is-off', off);
  if (off) {
    const a = Math.atan2(p.y - y, p.x - x) * 180 / Math.PI;
    foeEl.querySelector('.foemark__arrow').style.transform = `rotate(${a}deg)`;
  }
  const d = S.district;
  if (d) {
    const my = Math.floor(d.my), foe = Math.floor(d.foe);
    const tt = foeEl.querySelector('.foemark__t');
    const txt = `${DISTRICT.name} · ${fmt(my)} : ${fmt(foe)}`;
    if (tt.textContent !== txt) tt.textContent = txt;
    const total = Math.max(1, my + foe);
    foeEl.querySelector('.me').style.width = `${(my / total) * 100}%`;
    foeEl.classList.toggle('is-lead', my >= foe);
  }
}

// ── Тосты ────────────────────────────────────────────────────────────────────

export function toast(text, ms = 1800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  els.toasts.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

export function haptic(kind = 'light') {
  if (!S.settings.haptics) return;
  const tg = window.Telegram?.WebApp;
  try {
    if (['success', 'error', 'warning'].includes(kind)) tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch { /* вне телеграма */ }
}

/** Состояние связи с сервером: игрок должен видеть, что прогресс не уходит. */
let netEl = null;
export function showNet(n) {
  if (!netEl) {
    netEl = document.createElement('div');
    netEl.className = 'netbar';
    document.getElementById('app').appendChild(netEl);
  }
  const bad = n.guest || !n.online;
  netEl.hidden = !bad;
  netEl.className = 'netbar' + (n.guest ? ' is-guest' : '');
  netEl.textContent = n.guest
    ? 'Демо-режим: прогресс не сохраняется'
    : (n.lastError || 'Нет связи с сервером');
}

export function setBadge(tab, n) {
  const b = $(`.nav-btn[data-tab="${tab}"] .badge`);
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
}

export function hudInsets() {
  const d = du();
  // 56 — шапка с деньгами, дальше полоска уровня, ноша и плашка «кто в пункте».
  return { top: 146 * d + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0),
           bottom: 90 * d + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0) };
}
