// Точка входа: загрузка, постройка зала, игровой цикл.

import { COUNTERS, ATMS, ZONES, SAVE_EVERY } from './balance.js';
import { S, bootState, loadLocal, save, rollDaily, onChange } from './state.js';
import * as scene from './scene.js';
import * as actors from './actors.js';
import * as game from './game.js';
import * as ui from './ui.js';
import * as screens from './screens.js';
import * as district from './district.js';
import { initTG, loadCloud, isTG, pay } from './tg.js';
import { fmt } from './core.js';
import * as fx from './fx.js';

const views = { counters: new Map(), atms: new Map(), zones: new Map(), piles: new Map(), pads: new Map() };
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
  district.ensure();
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
  district.advanceOffline(away);
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

  window.__ready = true;          // сигнал для тестов: сцена собрана
  requestAnimationFrame(loop);
  setInterval(() => save(), SAVE_EVERY);
  setInterval(() => { district.ensure(); screens.updateBadges(); }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true); else onReturn();
  });
  window.addEventListener('pagehide', () => save(true));
}

function onReturn() {
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  S.lastSeen = Date.now();
  district.ensure();
  district.advanceOffline(away);
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
    if (open && cur) fx.popIn(v);       // новая стойка выпрыгивает на место
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
    if (open && cur) fx.popIn(v);
    views.atms.set(a.id, v);
    if (!views.piles.has(a.id)) views.piles.set(a.id, scene.buildCashPile());
  }
  for (const z of ZONES) {
    const open = !!S.zones?.[z.id]?.open;
    const cur = views.zones.get(z.id);
    if (cur && cur.__open === open) continue;
    if (cur) scene.removeView(cur);
    const v = scene.buildZone(z, open);
    v.__open = open;
    if (open && cur) fx.popIn(v);
    views.zones.set(z.id, v);
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
    const v = scene.buildPad(p.x, p.y, p.w, p.h, p.color);
    v.__id = p.id;
    views.pads.set(p.id, v);
  }
  for (const [id, v] of views.pads) {
    if (!seen.has(id)) { scene.removeView(v); views.pads.delete(id); }
  }
}

function onEvent(what) {
  if (what === 'build') { rebuildObjects(); }
  if (what === 'upgrade') syncPads();
  if (what === 'levelup') {
    ui.toast(`Уровень ${S.level}`); ui.haptic('success');
    fx.burst(actors.player.x, actors.player.y, 8, { size: 0.34 });
    fx.punch(7);
  }
  if (what === 'build') ui.haptic('success');
  if (screens.isOpen()) screens.refresh();
}

// ── Цикл ─────────────────────────────────────────────────────────────────────

let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const P = window.__prof;            // включается только из инструментов замера
  const t0 = P ? performance.now() : 0;

  actors.movePlayer(ui.joy.dx, ui.joy.dy, dt);
  actors.tickCustomers(dt, (k) => {
    game.onServed(k);
    district.addServed(1);
    const v = views.counters.get(k.counter);
    if (v && S.settings.fx) fx.pulse(v, 0.06);
  });
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

  const t1 = P ? performance.now() : 0;

  // площадки: заполнение и подсветка активной
  for (const p of game.pads()) {
    const v = views.pads.get(p.id);
    if (v) scene.setPadFill(v, (S.padPaid?.[p.id] || 0) / p.cost,
                            game.padState.id === p.id && game.padState.short);
  }
  district.tick(dt);
  scene.tickTraffic(dt);
  scene.pulsePads([...views.pads.values()], dt, game.padState.id);
  fx.tick(dt);
  const ins = ui.hudInsets();
  scene.follow(actors.player.x, actors.player.y, ins.top, ins.bottom);
  scene.sortItems();
  const t2 = P ? performance.now() : 0;
  ui.tickHud(dt);
  ui.tickWorldTags();
  if (P) {
    const t3 = performance.now();
    P.sim += t1 - t0; P.draw += t2 - t1; P.ui += t3 - t2; P.n++;
  }

  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.querySelector('.boot-in').innerHTML =
    `<b>Не удалось запустить</b><div style="color:#F3E0BC;font-size:calc(12 * var(--du));margin-top:calc(10 * var(--du))">${e.message}</div>`;
});

// отладочный доступ для тестов
window.__game = { S, game, actors, scene, ui, screens, district };
