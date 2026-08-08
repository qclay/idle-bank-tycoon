// Точка входа: загрузка, постройка зала, игровой цикл.

import { COUNTERS, ATMS, SAVE_EVERY } from './balance.js';
import { S, bootState, loadLocal, save, rollDaily, onChange } from './state.js';
import * as scene from './scene.js';
import * as actors from './actors.js';
import * as game from './game.js';
import * as ui from './ui.js';
import * as screens from './screens.js';
import { initTG, loadCloud, isTG, pay } from './tg.js';
import { fmt } from './core.js';

const views = { counters: new Map(), atms: new Map(), piles: new Map(), pads: new Map() };
let vaultView = null;

window.__openTab = (tab) => {
  if (tab === 'bank') { screens.close(); ui.setNav('bank'); return; }
  if (screens.isOpen()) screens.close(true);
  if (tab === 'tasks') screens.tasks();
  else if (tab === 'staff') screens.staff();
  else if (tab === 'safes') screens.safes();
  else if (tab === 'shop') screens.shop();
};

window.__pay = async (item) => {
  const r = await pay(item, (it) => {
    S.gold += it.give?.gold || 0;
    save(true); ui.toast('Покупка зачислена'); screens.refresh();
  });
  if (!r.ok) ui.toast(r.why);
};

async function boot() {
  const bar = document.getElementById('bootBar');
  const prog = (k) => { bar.style.width = `${Math.round(k * 100)}%`; };

  try { initTG(); } catch (e) { console.warn(e); }

  const local = loadLocal();
  let raw = local;
  if (isTG()) {
    const cloud = await loadCloud().catch(() => null);
    if (cloud && (!local || (cloud.lastSeen || 0) > (local.lastSeen || 0) + 5000)) raw = cloud;
  }
  bootState(raw);
  rollDaily();
  if (!S.padPaid) S.padPaid = {};

  await scene.initScene(document.getElementById('stage'), prog);
  ui.initUI();
  buildWorld();
  actors.refreshSolids();
  actors.initPlayer();
  actors.syncStaff();
  onChange(onEvent);

  // оффлайн
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  if (raw && away > 60) {
    const p = game.computeOffline(away);
    if (p) setTimeout(() => screens.offline(p, () => {
      S.cash += p.amount; save(); ui.toast(`+${fmt(p.amount)}`);
    }), 400);
  }
  S.lastSeen = Date.now();

  prog(1);
  const b = document.getElementById('boot');
  b.classList.add('hide');
  setTimeout(() => b.remove(), 450);

  requestAnimationFrame(loop);
  setInterval(() => save(), SAVE_EVERY);
  setInterval(() => screens.updateBadges(), 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true); else onReturn();
  });
  window.addEventListener('pagehide', () => save(true));
}

function onReturn() {
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  S.lastSeen = Date.now();
  if (away < 120) return;
  const p = game.computeOffline(away);
  if (p) screens.offline(p, () => { S.cash += p.amount; save(); ui.toast(`+${fmt(p.amount)}`); });
}

// ── Постройка зала ───────────────────────────────────────────────────────────

function buildWorld() {
  vaultView = scene.buildVault();
  rebuildObjects();
}

function rebuildObjects() {
  for (const c of COUNTERS) {
    const open = S.counters[c.id].open;
    const cur = views.counters.get(c.id);
    if (cur && cur.__open === open) continue;
    if (cur) scene.removeView(cur);
    const v = scene.buildCounter(c, open);
    v.__open = open;
    views.counters.set(c.id, v);
    if (!views.piles.has(c.id)) views.piles.set(c.id, scene.buildCashPile());
  }
  for (const a of ATMS) {
    const open = S.atms[a.id].open;
    const cur = views.atms.get(a.id);
    if (cur && cur.__open === open) continue;
    if (cur) scene.removeView(cur);
    const v = scene.buildAtm(a, open);
    v.__open = open;
    views.atms.set(a.id, v);
    if (!views.piles.has(a.id)) views.piles.set(a.id, scene.buildCashPile());
  }
  syncPads();
  scene.sortItems();
}

function syncPads() {
  const list = game.pads();
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    if (views.pads.has(p.id)) continue;
    views.pads.set(p.id, scene.buildPad(p.x, p.y, p.w, p.h, p.color));
  }
  for (const [id, v] of views.pads) {
    if (!seen.has(id)) { scene.removeView(v); views.pads.delete(id); }
  }
}

function onEvent(what) {
  if (what === 'build') { rebuildObjects(); }
  if (what === 'upgrade') syncPads();
  if (what === 'levelup') { ui.toast(`Уровень ${S.level}`); ui.haptic('success'); }
  if (screens.isOpen()) screens.refresh();
}

// ── Цикл ─────────────────────────────────────────────────────────────────────

let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  actors.movePlayer(ui.joy.dx, ui.joy.dy, dt);
  actors.tickCustomers(dt, game.onServed);
  actors.tickClerks(dt);
  actors.tickRunner(dt, game.takeFromSource, game.deposit);
  game.tick(dt, ui);

  // стопки наличных на объектах
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    const pile = views.piles.get(c.id);
    if (!pile) continue;
    if (!st.open) { pile.visible = false; continue; }
    const t = actors.trayPos(c);
    scene.drawCashPile(pile, t.x, t.y, 0.96, st.cash / game.trayCap(c));
  }
  for (const a of ATMS) {
    const st = S.atms[a.id];
    const pile = views.piles.get(a.id);
    if (!pile) continue;
    if (!st.open) { pile.visible = false; continue; }
    const t = actors.atmTray(a);
    scene.drawCashPile(pile, t.x, t.y, 0.1, st.cash / game.atmCap(a));
  }

  scene.pulsePads([...views.pads.values()], dt);
  scene.tickFx(dt);
  const ins = ui.hudInsets();
  scene.follow(actors.player.x, actors.player.y, ins.top, ins.bottom);
  scene.sortItems();
  ui.tickHud(dt);
  ui.tickWorldTags();

  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.querySelector('.boot-in').innerHTML =
    `<b>Не удалось запустить</b><div style="color:#F3E0BC;font-size:calc(12 * var(--du));margin-top:calc(10 * var(--du))">${e.message}</div>`;
});

// отладочный доступ для тестов
window.__game = { S, game, actors, scene, ui, screens };
