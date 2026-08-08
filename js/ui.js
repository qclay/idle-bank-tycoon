// HUD, панели этажей, нижняя навигация, модалки, тосты, туториал.

import { fmt, money, int, dur, clock, pct } from './fmt.js';
import {
  FLOOR_DEFS, BANKS, UPGRADE_STEPS, BOOSTS, TUTORIAL, CURVE,
} from './balance.js';
import { S, bank, save, emit, onChange } from './state.js';
import {
  floorUpCost, floorUnlockCost, floorMgrCost, floorStats, floorMaxLevels,
  elevUpCost, elevMgrCost, elevStats, elevMaxLevels,
  vaultUpCost, vaultMgrCost, vaultStats, vaultMaxLevels,
  upgradeFloor, upgradeElev, upgradeVault, unlockFloor,
  hireFloorMgr, hireElevMgr, hireVaultMgr,
  incomePerSec, openFloors, bonuses, boostLeft, milestonesUpTo, nextMilestone,
  canRenovate, bottleneck,
} from './engine.js';
import { xpForLevel } from './balance.js';
import * as scene from './scene.js';
import { badgeCounts } from './meta.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let els = {};
let floorEls = new Map();
let elevEl = null, vaultEl = null;
let dirty = true;

export function markDirty() { dirty = true; }

export function initUI() {
  els = {
    hud: $('#hud'), cash: $('#cash'), gold: $('#gold'), shares: $('#shares'),
    income: $('#income'), lvlNum: $('#lvlNum'), lvlFill: $('#lvlFill'),
    bankName: $('#bankName'), bankCity: $('#bankCity'), bankChip: $('#bankChip'),
    boostStrip: $('#boostStrip'), floorUI: $('#floorUI'), steps: $('#steps'),
    upAll: $('#upAll'), upAllCost: $('#upAllCost'), nav: $('#nav'),
    modalRoot: $('#modalRoot'), toasts: $('#toasts'),
    tutorial: $('#tutorial'), tutText: $('#tutText'), tutOk: $('#tutOk'),
    bankFlag: $('.chip-flag'),
  };

  buildSteps();
  els.upAll.addEventListener('click', doUpgradeAll);
  onChange(() => { dirty = true; });

  els.nav.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (!b) return;
    openTab(b.dataset.tab);
  });

  els.bankChip.addEventListener('click', () => window.__screens.banks());
  $('#goldBtn').addEventListener('click', () => openTab('shop'));
  $('#btnBoost').addEventListener('click', () => window.__screens.boosts());
  $('#btnRenov').addEventListener('click', () => window.__screens.renovation());
  $('#btnSettings').addEventListener('click', () => window.__screens.settings());

  els.tutOk.addEventListener('click', nextTutorial);
  renderTutorial();
}

function openTab(tab) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  const s = window.__screens;
  if (tab === 'bank') { closeModal(); return; }
  if (tab === 'tasks') s.tasks();
  else if (tab === 'chests') s.chests();
  else if (tab === 'staff') s.staff();
  else if (tab === 'shop') s.shop();
}

export function resetNav() {
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === 'bank'));
}

// ── Множитель апгрейда ────────────────────────────────────────────────────────

function buildSteps() {
  els.steps.innerHTML = '';
  for (const st of UPGRADE_STEPS) {
    const b = document.createElement('button');
    b.textContent = st === 'max' ? 'MAX' : 'x' + st;
    b.dataset.step = st;
    b.addEventListener('click', () => { S.upStep = st; save(); syncSteps(); dirty = true; });
    els.steps.appendChild(b);
  }
  syncSteps();
}

function syncSteps() {
  $$('#steps button').forEach((b) => b.classList.toggle('on', String(S.upStep) === b.dataset.step));
}

function stepN() { return S.upStep === 'max' ? 'max' : Number(S.upStep); }
function stepLabel() { return S.upStep === 'max' ? 'MAX' : 'x' + S.upStep; }

// ── Панели этажей ─────────────────────────────────────────────────────────────

function makeFloorEl(i) {
  const el = document.createElement('div');
  el.className = 'fbar';
  el.dataset.i = i;
  el.innerHTML = `
    <div class="fbar-in">
      <div class="fbar-ic"></div>
      <div class="fbar-txt"><b></b><i></i><div class="ms-bar"><i></i></div></div>
      <button class="btn btn-up"><b></b><i></i></button>
      <button class="btn btn-mgr">👔</button>
    </div>
    <button class="btn btn-unlock"></button>`;
  el.querySelector('.btn-up').addEventListener('click', (e) => {
    e.stopPropagation();
    if (upgradeFloor(i, stepN())) { fxTap(e.currentTarget); haptic('light'); }
    dirty = true;
  });
  el.querySelector('.btn-mgr').addEventListener('click', (e) => {
    e.stopPropagation();
    window.__screens.manager('floor', i);
  });
  el.querySelector('.btn-unlock').addEventListener('click', (e) => {
    e.stopPropagation();
    if (unlockFloor(i)) { toast(`Открыт отдел «${FLOOR_DEFS[i].name}»`); haptic('medium'); scene.clampCam(); }
    else toast('Не хватает денег');
    dirty = true;
  });
  els.floorUI.appendChild(el);
  return el;
}

function makeUnitEl(kind) {
  const el = document.createElement('div');
  el.className = 'fbar fbar-wide';
  el.innerHTML = `
    <div class="fbar-in">
      <div class="fbar-ic">${kind === 'elev' ? '🛗' : '🔒'}</div>
      <div class="fbar-txt"><b>${kind === 'elev' ? 'Лифт' : 'Хранилище'}</b><i></i><div class="ms-bar"><i></i></div></div>
      <button class="btn btn-up"><b></b><i></i></button>
      <button class="btn btn-mgr">👔</button>
    </div>`;
  el.querySelector('.btn-up').addEventListener('click', (e) => {
    e.stopPropagation();
    const ok = kind === 'elev' ? upgradeElev(stepN()) : upgradeVault(stepN());
    if (ok) { fxTap(e.currentTarget); haptic('light'); }
    dirty = true;
  });
  el.querySelector('.btn-mgr').addEventListener('click', (e) => {
    e.stopPropagation();
    window.__screens.manager(kind);
  });
  els.floorUI.appendChild(el);
  return el;
}

function syncFloorEls() {
  const n = scene.visibleFloors();
  for (const [i, el] of floorEls) {
    if (i >= n) { el.remove(); floorEls.delete(i); }
  }
  for (let i = 0; i < n; i++) {
    if (!floorEls.has(i)) floorEls.set(i, makeFloorEl(i));
  }
  if (!elevEl) elevEl = makeUnitEl('elev');
  if (!vaultEl) vaultEl = makeUnitEl('vault');
}

function positionBars() {
  const H = scene.viewH();
  for (const [i, el] of floorEls) {
    const y = scene.floorBarTop(i);
    const off = y < -60 || y > H + 10;
    el.style.visibility = off ? 'hidden' : 'visible';
    if (!off) el.style.transform = `translateY(${y.toFixed(1)}px)`;
  }
  // Панели лифта и хранилища стоят в самом низу мира: 46..92 и 0..46
  const yv = scene.worldToScreen(46), ye = scene.worldToScreen(scene.LAYOUT.barsH);
  for (const [el, y] of [[vaultEl, yv], [elevEl, ye]]) {
    if (!el) continue;
    const off = y < -60 || y > H + 10;
    el.style.visibility = off ? 'hidden' : 'visible';
    if (!off) el.style.transform = `translateY(${y.toFixed(1)}px)`;
  }
}

function renderFloorBar(i) {
  const el = floorEls.get(i);
  if (!el) return;
  const f = bank().floors[i];
  const fd = FLOOR_DEFS[i];
  const inEl = el.querySelector('.fbar-in');
  const lockEl = el.querySelector('.btn-unlock');

  if (f.lvl <= 0) {
    inEl.style.display = 'none';
    lockEl.style.display = '';
    const cost = floorUnlockCost(i);
    const can = S.cash >= cost;
    lockEl.classList.toggle('off', !can);
    lockEl.innerHTML = `<span>🔓 ${fd.name}</span>&nbsp;·&nbsp;<span>${money(cost)}</span>`;
    return;
  }
  inEl.style.display = '';
  lockEl.style.display = 'none';

  const st = floorStats(i);
  el.querySelector('.fbar-ic').textContent = fd.icon;
  el.querySelector('.fbar-txt b').textContent = fd.short;
  el.querySelector('.fbar-txt i').textContent = `ур. ${int(f.lvl)} · ${money(st.rate)}/с`;

  const nm = nextMilestone(f.lvl);
  const prev = prevMilestoneLvl(f.lvl);
  const p = (f.lvl - prev) / (nm.lvl - prev);
  el.querySelector('.ms-bar i').style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;

  const nStep = stepN();
  const count = nStep === 'max' ? Math.max(1, floorMaxLevels(i, S.cash)) : nStep;
  const cost = floorUpCost(i, count);
  const can = S.cash >= cost && (nStep !== 'max' || floorMaxLevels(i, S.cash) > 0);
  const up = el.querySelector('.btn-up');
  up.classList.toggle('off', !can);
  up.querySelector('b').textContent = money(cost);
  up.querySelector('i').textContent = nStep === 'max' ? `MAX +${int(count)}` : `+${int(count)} ур.`;

  const mgr = el.querySelector('.btn-mgr');
  mgr.classList.toggle('hired', f.mgr);
  mgr.textContent = f.mgr ? '✅' : '👔';
}

function prevMilestoneLvl(lvl) {
  const ms = milestonesUpTo(lvl);
  return ms.length ? ms[ms.length - 1].lvl : 0;
}

function renderUnitBar(kind) {
  const el = kind === 'elev' ? elevEl : vaultEl;
  if (!el) return;
  const b = bank();
  const u = kind === 'elev' ? b.elev : b.vault;
  const st = kind === 'elev' ? elevStats() : vaultStats();
  el.querySelector('.fbar-txt i').textContent = `ур. ${int(u.lvl)} · ${money(st.rate)}/с`;

  const nm = nextMilestone(u.lvl);
  const prev = prevMilestoneLvl(u.lvl);
  el.querySelector('.ms-bar i').style.width = `${Math.max(0, Math.min(1, (u.lvl - prev) / (nm.lvl - prev))) * 100}%`;

  const nStep = stepN();
  const maxN = kind === 'elev' ? elevMaxLevels(S.cash) : vaultMaxLevels(S.cash);
  const count = nStep === 'max' ? Math.max(1, maxN) : nStep;
  const cost = kind === 'elev' ? elevUpCost(count) : vaultUpCost(count);
  const can = S.cash >= cost && (nStep !== 'max' || maxN > 0);
  const up = el.querySelector('.btn-up');
  up.classList.toggle('off', !can);
  up.querySelector('b').textContent = money(cost);
  up.querySelector('i').textContent = nStep === 'max' ? `MAX +${int(count)}` : `+${int(count)} ур.`;

  const mgr = el.querySelector('.btn-mgr');
  mgr.classList.toggle('hired', u.mgr);
  mgr.textContent = u.mgr ? '✅' : '👔';

  // подсветка узкого места
  const bn = bottleneck();
  el.querySelector('.fbar-in').style.boxShadow =
    (bn === kind) ? '0 0 0 2px #ec5b4a, 0 2px 0 rgba(0,0,0,.18)' : '0 2px 0 rgba(0,0,0,.18)';
}

// ── Улучшить всё ──────────────────────────────────────────────────────────────

function upgradeAllPlan() {
  const b = bank();
  const items = [];
  const nStep = stepN();
  const n = nStep === 'max' ? 1 : nStep;
  for (let i = 0; i < b.floors.length; i++) {
    if (b.floors[i].lvl <= 0) continue;
    items.push({ kind: 'floor', i, cost: floorUpCost(i, n) });
  }
  items.push({ kind: 'elev', cost: elevUpCost(n) });
  items.push({ kind: 'vault', cost: vaultUpCost(n) });
  items.sort((a, c) => a.cost - c.cost);
  return items;
}

function doUpgradeAll() {
  const nStep = stepN();
  let bought = 0;
  if (nStep === 'max') {
    // покупаем по кругу, пока хватает денег
    for (let pass = 0; pass < 60; pass++) {
      let any = false;
      const b = bank();
      for (let i = 0; i < b.floors.length; i++) {
        if (b.floors[i].lvl > 0 && S.cash >= floorUpCost(i, 1)) { upgradeFloor(i, 1); any = true; bought++; }
      }
      if (S.cash >= elevUpCost(1)) { upgradeElev(1); any = true; bought++; }
      if (S.cash >= vaultUpCost(1)) { upgradeVault(1); any = true; bought++; }
      if (!any) break;
    }
  } else {
    for (const it of upgradeAllPlan()) {
      if (S.cash < it.cost) continue;
      if (it.kind === 'floor') upgradeFloor(it.i, nStep);
      else if (it.kind === 'elev') upgradeElev(nStep);
      else upgradeVault(nStep);
      bought++;
    }
  }
  if (bought) { haptic('medium'); toast(`Улучшено объектов: ${bought}`); }
  else toast('Не хватает денег');
  dirty = true;
}

function renderUpAll() {
  const nStep = stepN();
  if (nStep === 'max') {
    els.upAllCost.textContent = 'MAX';
    els.upAll.classList.toggle('off', S.cash < Math.min(...upgradeAllPlan().map((x) => x.cost)));
    return;
  }
  const plan = upgradeAllPlan();
  let sum = 0, left = S.cash;
  for (const it of plan) { if (left >= it.cost) { sum += it.cost; left -= it.cost; } }
  els.upAllCost.textContent = sum > 0 ? money(sum) : money(plan[0]?.cost || 0);
  els.upAll.classList.toggle('off', sum <= 0);
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function renderHud() {
  const def = BANKS[S.bankIdx];
  els.cash.textContent = money(S.cash);
  els.gold.textContent = int(S.gold);
  els.shares.textContent = int(S.shares);
  els.income.textContent = money(incomePerSec()) + '/сек';
  els.bankName.textContent = def.name;
  els.bankCity.textContent = def.city;
  els.bankFlag.textContent = def.flag;
  els.lvlNum.textContent = S.level;
  els.lvlFill.style.width = `${Math.min(100, (S.xp / xpForLevel(S.level)) * 100)}%`;

  // Бусты
  const strip = els.boostStrip;
  const active = Object.entries(S.boosts).filter(([, b]) => b.until > Date.now());
  if (active.length !== strip.children.length) strip.innerHTML = '';
  active.forEach(([id], k) => {
    let c = strip.children[k];
    if (!c) { c = document.createElement('div'); c.className = 'bchip'; strip.appendChild(c); }
    c.innerHTML = `<span>${BOOSTS[id]?.icon || '⚡'}</span>${clock(boostLeft(id))}`;
  });
  if (!active.length) strip.innerHTML = '';

  // Значки
  const bc = badgeCounts();
  setBadge('tasks', bc.tasks);
  setBadge('chests', bc.presents);
  setBadge('staff', 0);
  $('#btnRenov').classList.toggle('fx-pop', canRenovate());
  const dot = $('#btnBoost .dot');
  dot.hidden = !Object.values(S.freeBoost || {}).some((t) => t <= Date.now())
    && Object.keys(S.freeBoost || {}).length >= 3;
  dot.hidden = !hasFreeBoost();
}

function hasFreeBoost() {
  for (const id of Object.keys(BOOSTS)) if ((S.freeBoost[id] || 0) <= Date.now()) return true;
  return false;
}

function setBadge(tab, n) {
  const b = $(`.nav-btn[data-tab="${tab}"] .badge`);
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : n;
}

// ── Главный цикл отрисовки UI ─────────────────────────────────────────────────

let acc = 0;
export function tickUI(dt) {
  syncFloorEls();
  positionBars();
  acc += dt;
  if (acc > 0.12 || dirty) {
    acc = 0; dirty = false;
    renderHud();
    for (const i of floorEls.keys()) renderFloorBar(i);
    renderUnitBar('elev');
    renderUnitBar('vault');
    renderUpAll();
  }
}

// ── Модалки ───────────────────────────────────────────────────────────────────

let modalStack = [];

export function openModal({ title, sub, body, tabs, onClose, wide }) {
  closeModal(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet-head">
      <div class="grow"><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <button class="x">✕</button>
    </div>
    ${tabs ? '<div class="tabs"></div>' : ''}
    <div class="sheet-body"></div>`;
  const bodyEl = sheet.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  if (tabs) {
    const tb = sheet.querySelector('.tabs');
    tabs.forEach((t, k) => {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.className = k === 0 ? 'on' : '';
      b.addEventListener('click', () => {
        $$('button', tb).forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        bodyEl.innerHTML = '';
        const c = t.render();
        if (typeof c === 'string') bodyEl.innerHTML = c;
        else bodyEl.appendChild(c);
        bodyEl.scrollTop = 0;
      });
      tb.appendChild(b);
    });
    bodyEl.innerHTML = '';
    const c = tabs[0].render();
    if (typeof c === 'string') bodyEl.innerHTML = c;
    else bodyEl.appendChild(c);
  }

  scrim.addEventListener('click', () => closeModal());
  sheet.querySelector('.x').addEventListener('click', () => closeModal());
  els.modalRoot.appendChild(scrim);
  els.modalRoot.appendChild(sheet);
  modalStack = [{ scrim, sheet, onClose }];
  return { sheet, body: bodyEl, refresh: (html) => { bodyEl.innerHTML = html; } };
}

export function closeModal(silent = false) {
  for (const m of modalStack) {
    m.scrim.remove(); m.sheet.remove();
    if (!silent && m.onClose) m.onClose();
  }
  modalStack = [];
  if (!silent) resetNav();
}

export function isModalOpen() { return modalStack.length > 0; }

// ── Тосты ─────────────────────────────────────────────────────────────────────

export function toast(text, ms = 1900) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = text;
  els.toasts.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

export function fxTap(el) {
  if (!el || !S.settings.showFx) return;
  el.classList.remove('fx-pop');
  void el.offsetWidth;
  el.classList.add('fx-pop');
}

export function haptic(style = 'light') {
  if (!S.settings.haptics) return;
  const tg = window.Telegram?.WebApp;
  try {
    if (style === 'success' || style === 'error' || style === 'warning') tg?.HapticFeedback?.notificationOccurred(style);
    else tg?.HapticFeedback?.impactOccurred(style);
  } catch { /* вне телеграма */ }
  if (!tg && navigator.vibrate) navigator.vibrate(style === 'medium' ? 18 : 8);
}

// ── Туториал ──────────────────────────────────────────────────────────────────

export function renderTutorial() {
  const step = TUTORIAL[S.tut];
  if (!step) { els.tutorial.hidden = true; return; }
  els.tutorial.hidden = false;
  els.tutText.textContent = step.text;
}

function nextTutorial() {
  S.tut++;
  save();
  renderTutorial();
}

export function skipTutorial() { S.tut = TUTORIAL.length; save(); renderTutorial(); }
