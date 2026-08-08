// HUD, джойстик, подсказки над падами, тосты, нижняя навигация.

import { fmt, du, clamp } from './core.js';
import { S, save } from './state.js';
import { xpForLevel } from './balance.js';
import { pads } from './game.js';
import { COUNTERS, VAULT } from './balance.js';
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
    joy: $('#joy'), base: $('#joyBase'), knob: $('#joyKnob'),
    worldUI: $('#worldUI'), toasts: $('#toasts'), nav: $('#nav'), hud: $('#hud'),
  };
  bindJoystick();
  els.nav.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (b) window.__openTab(b.dataset.tab);
  });
  $('#goldPill').addEventListener('click', () => window.__openTab('shop'));
}

export function setNav(tab) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
}

// ── Джойстик ─────────────────────────────────────────────────────────────────

function bindJoystick() {
  let id = null, ox = 0, oy = 0;
  const R = () => 52 * du();

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
    if (d < 6) { joy.dx = 0; joy.dy = 0; return; }
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
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    els.joy.addEventListener(ev, (e) => { if (id === e.pointerId) end(); });
  }
}

// ── HUD ──────────────────────────────────────────────────────────────────────

let hudAcc = 0;
export function tickHud(dt) {
  hudAcc += dt;
  if (hudAcc < 0.08) return;
  hudAcc = 0;
  els.cash.textContent = fmt(S.cash);
  els.gold.textContent = fmt(S.gold);
  els.lvlN.textContent = S.level;
  els.lvlFill.style.width = `${clamp((S.xp / xpForLevel(S.level)) * 100, 0, 100)}%`;

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

export function tickWorldTags() {
  const list = pads();
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let t = tags.get(p.id);
    if (!t) {
      t = document.createElement('div');
      t.className = 'wtag' + (p.kind === 'up' ? '' : ' wtag--buy');
      t.innerHTML = `<div class="wtag__sign">
        <div class="wtag__t"></div>
        <div class="wtag__p"><img src="./assets/ui/coin.png" alt=""><b></b></div>
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

    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const near = dist(player.x, player.y, cx, cy) < 4.2;
    t.classList.toggle('is-far', !near);
    const s = scene.screenOf(cx, cy, 0.1);
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
  const s = scene.screenOf(x, y, 0.1);
  t.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-100%)`;
}

export function clearTags() { for (const [, el] of tags) el.remove(); tags.clear(); }

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

export function setBadge(tab, n) {
  const b = $(`.nav-btn[data-tab="${tab}"] .badge`);
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
}

export function hudInsets() {
  const d = du();
  return { top: 56 * d + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0),
           bottom: 76 * d + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0) };
}
