// HUD, джойстик, подсказки над падами, тосты, нижняя навигация.

import { fmt, du, clamp } from './core.js';
import { S, save } from './state.js';
import { xpForLevel } from './balance.js';
import { pads, padState } from './game.js';
import { COUNTERS, VAULT, DISTRICT } from './balance.js';
import * as district from './district.js';
import * as reviews from './reviews.js';
import { coop, others, visiting } from './coop.js';
import { clerkSpot } from './actors.js';
import { player } from './actors.js';
import { bagCap } from './actors.js';
import { dist } from './core.js';
import * as scene from './scene.js';

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
  $('#gearBtn').addEventListener('click', () => window.__openTab('settings'));
  $('#repPill').addEventListener('click', () => window.__openTab('social'));
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
  tickFoeMarker();
  tickNameTags();
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

    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // Рядом — полная подпись, издалека — компактный ценник: иначе таблички
    // наезжают друг на друга и закрывают зал.
    const near = dist(player.x, player.y, cx, cy) < 2.9;
    t.classList.toggle('is-far', !near);
    // рядом поднимаем повыше, иначе табличка накрывает героя
    const s = scene.screenOf(cx, cy, near ? 1.35 : 0.4);
    t.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-100%)`;
  }
  // Две подсказки по ситуации: где обслуживать и куда нести выручку.
  const c1 = COUNTERS[0];
  if (S.stats.served < 3 && S.counters[c1.id].open && !S.counters[c1.id].clerk) {
    const sp = clerkSpot(c1);
    hint('serve', 'Встаньте сюда', sp.x, sp.y, seen);
  }
  if (S.carry > 0.5) hint('drop', 'Сдать выручку', VAULT.drop.x, VAULT.drop.y, seen);

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

/** Кто сейчас в зале. В своём пункте зовёт друга, в гостях — уводит домой. */
export function showCoop() {
  let el = document.getElementById('coopChip');
  if (!el) {
    el = document.createElement('button');
    el.id = 'coopChip';
    el.className = 'coopchip';
    el.addEventListener('click', () => {
      if (visiting()) window.__goHome?.();
      else window.__invite?.();
    });
    document.getElementById('hud').appendChild(el);
  }
  const list = others();
  const away = visiting();
  const ic = (id) => `<span class="ic"><svg><use href="#i-${id}"/></svg></span>`;
  if (away) {
    const host = list.find((p) => p.id === coop.roomId);
    el.innerHTML = `${ic('staff')}В гостях${host ? ` у ${host.name}` : ''} · выйти`;
  } else if (list.length) {
    el.innerHTML = `${ic('staff')}${list.map((p) => p.name).join(', ')} помогает`;
  } else {
    el.innerHTML = `${ic('staff')}Позвать друга`;
  }
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
