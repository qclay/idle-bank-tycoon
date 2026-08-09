// Точка входа: загрузка, постройка зала, игровой цикл.

import * as BAL from './balance.js';
import { COUNTERS, ATMS, ZONES, SAVE_EVERY } from './balance.js';
import { S, bootState, save, rollDaily, onChange, setSync } from './state.js';
import * as scene from './scene.js';
import * as actors from './actors.js';
import * as game from './game.js';
import * as ui from './ui.js';
import * as screens from './screens.js';
import * as district from './district.js';
import * as reviews from './reviews.js';
import * as smm from './smm.js';
import * as nav from './nav.js';
import { initTG, isTG, pay, initDataRaw, startParam, invite } from './tg.js';
import * as coop from './coop.js';
import * as net from './net.js';
import { fmt } from './core.js';

const BOT_NAME = 'mycoolreminder_bot';   // сюда ведут ссылки-приглашения
import * as fx from './fx.js';

const views = { counters: new Map(), atms: new Map(), zones: new Map(), piles: new Map(), pads: new Map() };
let vaultView = null;

window.__openTab = (tab, sub) => {
  if (tab === 'coop') {
    if (screens.isOpen()) screens.close(true);
    screens.together();
    return;
  }
  if (tab === 'social') {
    if (screens.isOpen()) screens.close(true);
    screens.social(sub);
    return;
  }
  if (tab === 'settings') {
    if (screens.isOpen()) screens.close(true);
    screens.settings();
    return;
  }
  // В гостях строят руками — вставая на площадки в зале. Меню найма и покупок
  // остаётся за хозяином: это его пункт и его кристаллы.
  if (coop.visiting() && tab !== 'bank') {
    ui.toast('Стройте вместе на площадках в зале — вдвоём вдвое быстрее');
    return;
  }
  if (tab === 'bank') { screens.close(); ui.setNav('bank'); return; }
  if (screens.isOpen()) screens.close(true);
  if (tab === 'tasks') screens.tasks(sub);
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

  // Прогресс живёт на сервере. Вне Telegram подписи нет — играем в памяти
  // вкладки и ничего никуда не сохраняем.
  const authed = await net.connect(initDataRaw());
  let raw = null, away = 0;
  if (authed) {
    const got = await net.load();
    raw = got?.save || null;
    away = got?.away || 0;          // сколько нас не было — по часам сервера
  }
  bootState(raw);
  setSync((now) => net.markDirty(now));
  net.bind(
    () => ({ save: S, stats: { served: S.stats.served, earned: S.stats.earned, rep: S.rep || 0 } }),
    (serverSave) => { if (serverSave) { bootState(serverSave); ui.toast('Прогресс подтянут с другого устройства'); } },
  );
  rollDaily();
  district.ensure();
  reviews.ensure();
  smm.ensure();
  if (!S.padPaid) S.padPaid = {};

  await scene.initScene(document.getElementById('stage'), prog);
  ui.initUI();
  buildWorld();
  actors.refreshSolids();
  actors.initPlayer();
  actors.syncStaff();
  onChange(onEvent);

  // оффлайн: время отсутствия считает сервер, а не часы устройства
  district.advanceOffline(away);
  if (raw && away > 60) {
    const p = game.computeOffline(away);
    if (p) setTimeout(() => screens.offline(p, () => {
      S.cash += p.amount; save(); ui.toast(`+${fmt(p.amount)}`);
    }), 400);
  }
  // Совместная игра: по умолчанию свой пункт, по ссылке-приглашению — чужой.
  if (authed && net.net.player) {
    const sp = startParam();
    const room = sp.startsWith('room_') ? sp.slice(5) : net.net.player.id;
    coop.join(initDataRaw(), room, net.net.player.id);
    window.__invite = () => invite(net.net.player.id, BOT_NAME);
    // Зайти к другу по коду: комната названа номером его пункта.
    window.__visit = (code) => {
      if (!code || String(code) === String(net.net.player.id)) return;
      coop.leave();
      coop.join(initDataRaw(), String(code), String(net.net.player.id));
      ui.toast('Заходим в гости…');
      ui.showCoop();
    };
    window.__goHome = async () => {
      coop.leave();
      coop.join(initDataRaw(), net.net.player.id, net.net.player.id);
      ui.toast('Вы вернулись в свой пункт');
      ui.showCoop();
    };
    coop.onCoop(() => ui.showCoop());
  }
  ui.showCoop();

  prog(1);
  const b = document.getElementById('boot');
  b.classList.add('hide');
  setTimeout(() => b.remove(), 450);

  applyQuality();
  window.__ready = true;          // сигнал для тестов: сцена собрана
  scene.onFrame(loop);
  setInterval(() => net.flush(), SAVE_EVERY);
  setInterval(() => { district.ensure(); screens.updateBadges(); }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) net.flush(); else onReturn();
  });
  window.addEventListener('pagehide', () => net.flushBeacon());
  net.onNet(ui.showNet);
  ui.showNet(net.net);
}

async function onReturn() {
  // вернулись во вкладку: спрашиваем сервер, сколько нас не было
  const got = await net.load();
  const away = got?.away || 0;
  if (got?.save && got.away > 5) bootState(got.save);
  district.ensure();
  reviews.ensure();
  district.advanceOffline(away);
  if (away < 120) return;
  const p = game.computeOffline(away);
  if (p) screens.offline(p, () => { S.cash += p.amount; save(); ui.toast(`+${fmt(p.amount)}`); });
}

/** Плавность выбирает игрок: «Плавно» греет сильнее, «Экономно» — меньше всего.
 *  По умолчанию решаем сами, глядя на то, как устройство держит кадры. */
export function applyQuality() {
  const q = S.settings.quality || 'auto';
  scene.setAutoQuality(q === 'auto');
  if (q === 'high') { scene.setMaxFps(60); scene.setPixelScale(1); }
  else if (q === 'saver') { scene.setMaxFps(30); scene.setPixelScale(0.7); }
  else {
    // Авто начинает с полной картинки и убавляет только по факту: гадать по
    // числу ядер нельзя, иначе нормальный телефон без причины получит мыло.
    scene.setMaxFps(60);
    scene.setPixelScale(1);
  }
}
window.__applyQuality = applyQuality;

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

// Разбор открывается нажатием на значок над головой клиента: бегать через
// весь зал к каждому недовольному было мучением, а окно вылетало само собой
// прямо на бегу.
let incidentOpen = false;
// Разговор с оператором на складе — тоже по нажатию на значок.
let errandOpen = false;
window.__errand = (a) => {
  if (errandOpen || screens.isOpen() || !a || a.job !== 'search') return;
  errandOpen = true;
  screens.errand(a, () => { errandOpen = false; });
};

window.__incident = (k) => {
  if (incidentOpen || screens.isOpen() || !k || k.state !== 'upset') return;
  incidentOpen = true;
  screens.incident(k, () => { incidentOpen = false; });
};

// Деньги в стройку списывает хозяин, поэтому у гостя монетки из рук сами не
// полетят. Без них непонятно, что твой вклад вообще считается, — рисуем их по
// растущему счётчику площадки.
const padSeen = new Map();
function guestPadFx(dt) {
  const p = actors.player;
  for (const pad of game.pads()) {
    const cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2;
    const paid = S.padPaid?.[pad.id] || 0;
    const was = padSeen.get(pad.id) ?? paid;
    padSeen.set(pad.id, paid);
    if (paid <= was) continue;
    if (Math.hypot(p.x - cx, p.y - cy) > Math.max(pad.w, pad.h) / 2 + 0.62) continue;
    padFxTick += dt;
    if (!S.settings.fx || padFxTick < 0.09) continue;
    padFxTick = 0;
    fx.coins(p.x, p.y - 0.2, cx, cy, 1, { size: 0.26, life: 0.3, arc: 34, toZ: 0.05 });
  }
}
let padFxTick = 0;

// Свет на складе зажигается, когда игрок туда заходит, и гаснет, когда уходит.
// Из-за этого проверить сотрудника можно только ногами — как и просили.
let lightK = 0;
function tickStock(dt) {
  const r = nav.roomAt(actors.player.x, actors.player.y);
  const want = r?.dark ? 1 : 0;
  lightK += (want - lightK) * Math.min(1, dt * 4);
  scene.setDark(lightK);
  for (const a of actors.clerkList()) {
    if (a.job === 'search') scene.setMood(a.view, null);
  }
}

/** Обмен с комнатой: свои координаты туда, чужие — в зал. */
function syncCoop(dt, guest) {
  if (!coop.coop.on) { game.setWorkers([]); return; }
  const p = actors.player;
  coop.sendMove(p.x, p.y, (p.vx - p.vy) >= 0 ? 1 : -1, S.carry);

  // Сеть отдаёт позиции 10 раз в секунду — между ними напарника догоняем сами,
  // иначе он телепортируется рывками.
  const list = coop.others();
  for (const r of list) {
    if (!r.view) { r.view = scene.makeRemoteView(); r.rx = r.x; r.ry = r.y; }
    const k = Math.min(1, dt * 12);
    const dx = r.x - r.rx, dy = r.y - r.ry;
    r.rx += dx * k; r.ry += dy * k;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.02;
    // Сеть шлёт координаты рывками десять раз в секунду, поэтому мгновенную
    // скорость держим затухающей — иначе между пакетами напарник «замирает»
    // и площадка начала бы списывать деньги прямо на ходу.
    const nvx = (r.x - (r.nx ?? r.x)) / Math.max(dt, 0.001);
    const nvy = (r.y - (r.ny ?? r.y)) / Math.max(dt, 0.001);
    r.nx = r.x; r.ny = r.y;
    r.spd = Math.max((r.spd || 0) * 0.82, Math.hypot(nvx, nvy));
    r.ft = (r.ft || 0) + dt;
    scene.setPlayerAnim(r.view, moving ? 'Walk' : 'Idle');
    scene.setPlayerFlip(r.view, r.dir !== -1);
    scene.bobPlayer(r.view, r.ft, moving);
    scene.setCarryStack(r.view, Math.min(1, (r.carry || 0) / Math.max(1, actors.bagCap())));
    scene.placeActor(r.view, r.rx, r.ry);
  }
  for (const r of coop.coop.players.values()) {
    if (r.gone && r.view) { scene.removeView(r.view); r.view = null; }
  }

  if (coop.coop.host) {
    // гости работают наравне: хост считает их действия по их координатам
    game.setWorkers(list.map((r) => ({
      id: r.id, x: r.x, y: r.y,
      get carry() { return r.carry || 0; },
      set carry(v) { r.carry = v; },
      speed: r.spd || 0,
      cap: actors.bagCap(), local: false,
    })));
    snapTick += dt;
    if (snapTick > 0.1) { snapTick = 0; coop.pushSnap(actors.customers); }
  } else {
    game.setWorkers([]);
    if (coop.applySnap(coop.coop.snap)) { rebuildObjects(); actors.refreshSolids(); }
  }
}

// ── Цикл ─────────────────────────────────────────────────────────────────────
// Логика и рисование живут на одном тикере Pixi: планка кадров тогда сдерживает
// и то, и другое, а телефон греется ровно настолько, насколько мы разрешили.

let snapTick = 0;

function loop(rawDt) {
  const dt = Math.min(0.05, rawDt);
  scene.tickQuality(dt);
  const guest = coop.coop.on && !coop.coop.host;
  const P = window.__prof;            // включается только из инструментов замера
  const t0 = P ? performance.now() : 0;

  actors.movePlayer(ui.joy.dx, ui.joy.dy, dt);
  syncCoop(dt, guest);
  if (!guest) actors.tickCustomers(dt, (k) => {
    game.onServed(k);
    district.addServed(1);
    const v = views.counters.get(k.counter);
    if (v && S.settings.fx) fx.pulse(v, 0.06);
  });
  actors.tickClerks(dt);
  tickStock(dt);
  if (!guest) {
    actors.tickRunner(dt, game.takeFromSource, game.deposit);
    game.tick(dt, ui);
  } else {
    actors.showGhosts(coop.snapCustomers());
    guestPadFx(dt);
  }

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
  if (!guest) { district.tick(dt); reviews.tick(dt); smm.tick(dt); }
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

}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.querySelector('.boot-in').innerHTML =
    `<b>Не удалось запустить</b><div style="color:#F3E0BC;font-size:calc(12 * var(--du));margin-top:calc(10 * var(--du))">${e.message}</div>`;
});

// отладочный доступ для тестов
window.__game = { S, game, actors, scene, ui, screens, district, reviews, smm, net, coop, nav };
window.__balance = BAL;   // для инструментов замера темпа
