// Точка входа: загрузка сейва, игровой цикл, склейка модулей.

import { TICK_MS, SAVE_EVERY_MS, TUTORIAL } from './balance.js';
import { S, hydrate, loadLocal, save, rollDaily, onChange, bank } from './state.js';
import * as engine from './engine.js';
import * as scene from './scene.js';
import * as ui from './ui.js';
import { screens } from './screens.js';
import { initTG, loadCloud, isTG } from './tg.js';
import { refreshDaily } from './meta.js';
import { money } from './fmt.js';

window.__screens = screens;
// Отладочный доступ (используется tools/shot.mjs и ручной проверкой в консоли)
window.__game = { S, engine, scene, ui, screens };

async function boot() {
  try { initTG(); } catch (e) { console.warn('TG init', e); }

  // Локальный сейв приоритетнее, если он свежее облачного.
  const local = loadLocal();
  let raw = local;
  if (isTG()) {
    const cloud = await loadCloud().catch(() => null);
    if (cloud && (!local || (cloud.lastSeen || 0) > (local.lastSeen || 0) + 5000)) raw = cloud;
  }
  hydrate(raw);
  rollDaily();

  await scene.loadAssets();
  scene.initScene(document.getElementById('cv'));
  ui.initUI();

  // Стартуем у хранилища — как в оригинале, вид снизу здания.
  scene.cam.y = 0; scene.cam.target = 0;
  scene.clampCam();

  scene.onTap(onSceneTap);
  onChange(onGameEvent);

  // Оффлайн-доход
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  if (away > 60 && raw) {
    const p = engine.computeOffline(away);
    if (p) { S.offlinePending = p; setTimeout(() => screens.offline(p), 500); }
  }
  S.lastSeen = Date.now();

  document.getElementById('boot').classList.add('hide');
  setTimeout(() => document.getElementById('boot').remove(), 500);

  requestAnimationFrame(loop);
  setInterval(() => save(), SAVE_EVERY_MS);
  setInterval(dayWatch, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true);
    else onReturn();
  });
  window.addEventListener('pagehide', () => save(true));
}

let lastDay = new Date().getDate();
function dayWatch() {
  const d = new Date().getDate();
  if (d !== lastDay) { lastDay = d; refreshDaily(); ui.markDirty(); }
}

function onReturn() {
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  S.lastSeen = Date.now();
  if (away < 120) return;
  const p = engine.computeOffline(away);
  if (p) { S.offlinePending = p; screens.offline(p); }
}

// ── Реакция на тапы по сцене ──────────────────────────────────────────────────

function onSceneTap(ev) {
  if (ev.kind === 'locked') {
    ui.toast('Отдел ещё закрыт — откройте его кнопкой ниже');
    return;
  }
  ui.haptic('light');
  if (ev.kind === 'floor') {
    const st = engine.floorStats(ev.i);
    const y = scene.floorBarTop(ev.i) - 12;
    scene.floatText(scene.viewW() * 0.62, y, '+' + money(st.capacity * engine.bonuses().tapValue * 0.25));
  }
  // Прогресс туториала по действию
  const step = TUTORIAL[S.tut];
  if (step) {
    if ((step.target === 'floor0' && ev.kind === 'floor')
      || (step.target === 'elevator' && ev.kind === 'elev')
      || (step.target === 'vault' && ev.kind === 'vault')) {
      S.tut++; ui.renderTutorial(); save();
    }
  }
}

function onGameEvent(what) {
  // Уровень поднимается часто и пачками — показываем тост, а не окно.
  if (what === 'levelup') { ui.toast(`Уровень ${S.level}! Награда зачислена`); ui.haptic('success'); }
  if (what === 'upgrade' || what === 'unlock' || what === 'manager') {
    const step = TUTORIAL[S.tut];
    if (step && ((step.target?.startsWith('upgrade') && what === 'upgrade')
      || (step.target?.startsWith('manager') && what === 'manager')
      || (step.target?.startsWith('unlock') && what === 'unlock'))) {
      S.tut++; ui.renderTutorial(); save();
    }
  }
  if (what === 'upgrade' || what === 'unlock' || what === 'bank' || what === 'renovate') {
    engine.invalidateBonuses();
    scene.clampCam();
  }
  if (['board', 'sm', 'boost'].includes(what)) engine.invalidateBonuses();
  screens.refreshOpen();
}

// ── Игровой цикл ──────────────────────────────────────────────────────────────

let last = performance.now();
let acc = 0;

function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  // Симуляция фиксированным шагом — чтобы результат не зависел от FPS
  acc += dt;
  const stepS = TICK_MS / 1000;
  let guard = 0;
  while (acc >= stepS && guard++ < 12) {
    for (let bi = 0; bi < S.banks.length; bi++) {
      if (!S.banks[bi].open) continue;
      // Чужие банки считаем упрощённо: только если там есть менеджеры
      if (bi === S.bankIdx) engine.step(stepS, bi);
      else stepIdleBank(stepS, bi);
    }
    acc -= stepS;
  }

  scene.draw(dt);
  ui.tickUI(dt);
  requestAnimationFrame(loop);
}

/** Банк, в котором игрок не находится: считаем доход по пропускной способности. */
function stepIdleBank(dt, bi) {
  const inc = engine.incomePerSec(bi, true);
  if (inc > 0) engine.addCash(inc * dt);
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<div class="boot-in"><div class="boot-logo">⚠️</div>
    <b>Не удалось запустить</b><div style="font-size:12px;opacity:.7;margin-top:8px;max-width:280px">${e.message}</div></div>`;
});
