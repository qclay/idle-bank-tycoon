// Игрок, клиенты и персонал: движение по залу и поведение.

import { HALL, VAULT, DOOR, START, COUNTERS, ATMS, ZONES, CUSTOMER, STAFF, UPGRADES } from './balance.js';
import { S } from './state.js';
import { isoDir, clamp, dist } from './core.js';
import * as scene from './scene.js';
import * as reviews from './reviews.js';
import { REP } from './balance.js';

// ── Геометрия объектов ───────────────────────────────────────────────────────

export function counterDef(id) { return COUNTERS.find((c) => c.id === id); }

/** Место кассира — за стойкой. */
export function clerkSpot(def) { return { x: def.x + 1, y: def.y - 0.95 }; }
/** Место клиента в очереди. */
export function queueSpot(def, i) { return { x: def.x + 1, y: def.y + 1.2 + i * 0.8 }; }
/** Куда падает наличка со стойки. */
export function trayPos(def) { return { x: def.x + 1.55, y: def.y + 0.25 }; }
/** Точка, где игрок забирает наличку со стойки. */
export function pickSpot(def) { return { x: def.x + 1, y: def.y + 0.95 }; }
export function atmPick(def) { return { x: def.x + 0.36, y: def.y + 1.0 }; }
export function atmTray(def) { return { x: def.x + 0.36, y: def.y + 0.35 }; }

/** Непроходимые прямоугольники зала. */
function solids() {
  const out = [{ x0: VAULT.x, y0: VAULT.y, x1: VAULT.x + VAULT.w, y1: VAULT.y + VAULT.h + 0.2 }];
  for (const c of COUNTERS) out.push({ x0: c.x, y0: c.y, x1: c.x + 2, y1: c.y + 0.62 });
  for (const a of ATMS) if (S.atms[a.id]?.open) out.push({ x0: a.x, y0: a.y, x1: a.x + 0.8, y1: a.y + 0.66 });
  for (const z of ZONES) if (S.zones?.[z.id]?.open) out.push({ x0: z.x, y0: z.y, x1: z.x + 2.2, y1: z.y + 1.2 });
  return out;
}
let SOLIDS = null;
export function refreshSolids() { SOLIDS = solids(); }

const R = 0.34;   // радиус актёра в тайлах

function collide(p) {
  if (!SOLIDS) refreshSolids();
  p.x = clamp(p.x, 0.4, HALL.w - 0.4);
  p.y = clamp(p.y, 0.4, HALL.h - 0.4);
  for (const s of SOLIDS) {
    const nx = clamp(p.x, s.x0, s.x1);
    const ny = clamp(p.y, s.y0, s.y1);
    const dx = p.x - nx, dy = p.y - ny;
    const d = Math.hypot(dx, dy);
    if (d < R) {
      if (d < 1e-4) { p.y = s.y1 + R; continue; }
      p.x = nx + (dx / d) * R;
      p.y = ny + (dy / d) * R;
    }
  }
}

// ── Игрок ────────────────────────────────────────────────────────────────────

export const player = {
  x: START.x, y: START.y, vx: 0, vy: 0, moving: false,
  frame: 0, ft: 0, dir: 'se', view: null,
};

export function playerSpeed() {
  const u = UPGRADES.boots;
  let s = u.base + u.step * (S.ups.boots || 0);
  if (boostOn('sprint')) s *= 1.6;
  return s;
}

export function bagCap() {
  const u = UPGRADES.bag;
  let c = u.base + u.step * (S.ups.bag || 0);
  if (boostOn('sprint')) c *= 2;
  return c;
}

function boostOn(id) { const b = S.boosts[id]; return b && b.until > Date.now(); }

export function initPlayer() {
  player.view = scene.makePlayerView();
  player.x = START.x; player.y = START.y;
  scene.placeActor(player.view, player.x, player.y);
}

export function movePlayer(dx, dy, dt) {
  const sp = playerSpeed();
  const len = Math.hypot(dx, dy);
  // Разгон и торможение: раньше скорость включалась рывком и управление
  // ощущалось деревянным.
  const tx = len > 0.02 ? (dx / len) * sp * Math.min(1, len) : 0;
  const ty = len > 0.02 ? (dy / len) * sp * Math.min(1, len) : 0;
  const k = 1 - Math.exp(-16 * dt);
  player.vx += (tx - player.vx) * k;
  player.vy += (ty - player.vy) * k;
  const v = Math.hypot(player.vx, player.vy);
  player.moving = v > 0.12;
  if (v > 0.001) {
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    collide(player);
    if (player.moving) player.dir = isoDir(player.vx, player.vy);
    S.stats.steps += v * dt;
  }
  player.t = (player.t || 0) + dt;
  // анимация
  if (player.view.__isSpine) {
    scene.setPlayerAnim(player.view, player.moving ? 'Walk' : 'Idle');
    if (player.moving) scene.setPlayerFlip(player.view, (player.vx - player.vy) >= 0);
    scene.bobPlayer(player.view, player.t, player.moving);
  } else {
    player.ft += dt * (player.moving ? 9 : 0);
    player.frame = Math.floor(player.ft) % 4;
    scene.setCharFrame(player.view, player.dir, player.moving ? player.frame : 0);
  }
  scene.setCarryStack(player.view, S.carry / bagCap());
  scene.placeActor(player.view, player.x, player.y);
}

// ── Клиенты ──────────────────────────────────────────────────────────────────

export const customers = [];
let spawnTimer = 0;

const TINTS = [0xffffff, 0xffd9c2, 0xd6e8ff, 0xd9ffd6, 0xf0dcff, 0xfff2c2];

export function spawnRate() {
  const open = COUNTERS.filter((c) => S.counters[c.id].open).length;
  let t = CUSTOMER.spawnBase * CUSTOMER.spawnPerCounter ** Math.max(0, open - 1);
  let coffee = 0;
  for (const z of ZONES) {
    const zs = S.zones?.[z.id];
    if (zs?.open && z.effect === 'spawn') coffee += z.step * zs.lvl;
  }
  t /= (1 + coffee) * reviews.spawnMult();
  if (boostOn('rush')) t /= 3;
  return Math.max(CUSTOMER.minSpawn, t);
}

function freeCounter() {
  const list = COUNTERS.filter((c) => S.counters[c.id].open);
  let best = null, bestN = 99;
  for (const c of list) {
    const n = queueLen(c.id);
    if (n < CUSTOMER.maxQueue && n < bestN) { best = c; bestN = n; }
  }
  return best;
}

export function tickCustomers(dt, onServed) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = spawnRate();
    const c = freeCounter();
    if (c && customers.length < 26) spawn(c);
  }

  for (let i = customers.length - 1; i >= 0; i--) {
    const k = customers[i];
    k.t += dt;

    if (k.state === 'walk') {
      const idx = queueIndex(k);
      const q = queueSpot(counterDef(k.counter), idx);
      if (stepTo(k, q.x, q.y, CUSTOMER.speed, dt)) { k.state = 'wait'; k.t = 0; }
    } else if (k.state === 'wait') {
      const idx = queueIndex(k);
      const q = queueSpot(counterDef(k.counter), idx);
      stepTo(k, q.x, q.y, CUSTOMER.speed, dt);
      k.waited = Math.min(1, k.t / CUSTOMER.patience);
      // Чем дольше очередь стоит, тем мрачнее лица: это видно с другого конца
      // зала и подсказывает, куда бежать.
      const m = reviews.waitMood(k.waited);
      scene.setMood(k.view, m === 2 ? 'bad' : m === 1 ? 'meh' : null);
      if (k.t > CUSTOMER.patience) {
        // Ушёл, не дождавшись выдачи: заказ не забран, отзыв будет злым.
        reviews.onWalkedOut(k.counter);
        scene.setMood(k.view, 'bad');
        k.state = 'leave'; k.angry = true; k.t = 0;
        dequeue(k); scene.setServeRing(k.view, -1);
      }
    } else if (k.state === 'serve') {
      if (k.waited < REP.moodAt) scene.setMood(k.view, null);
      k.serve += dt * k.serveSpeed;
      if (k.serve >= CUSTOMER.serveTime) {
        onServed(k);
        dequeue(k); scene.setServeRing(k.view, -1);
        const r = reviews.onServed(k, k.counter);
        if (r.upset) {
          k.state = 'upset'; k.t = 0; k.incident = r.incident;
          k.spot = { x: k.x + 0.9, y: k.y + 0.9 };
          scene.setMood(k.view, 'bad');
        } else { k.state = 'leave'; k.t = 0; }
      }
    } else if (k.state === 'upset') {
      stepTo(k, k.spot.x, k.spot.y, 1.2, dt);
      if (k.t > REP.waitTimeout) {
        reviews.onAbandoned(k.counter);
        scene.setMood(k.view, null);
        k.state = 'leave'; k.t = 0; k.angry = true;
      }
    } else if (k.state === 'leave') {
      // уходим наружу: столкновения выключены, иначе клипается о границу зала
      stepTo(k, DOOR.x, HALL.h + 1.2, CUSTOMER.walkOff, dt, false);
      k.view.alpha = Math.max(0, Math.min(1, (HALL.h + 0.4 - k.y) / 1.2));
      if (k.y > HALL.h + 0.3) { kill(i); continue; }
    }
    draw(k, dt);
  }
}

function spawn(c) {
  const k = {
    id: Math.random().toString(36).slice(2),
    x: DOOR.x, y: HALL.h + 0.6,
    counter: c.id, state: 'walk', t: 0, serve: 0, serveSpeed: 1,
    view: scene.makeCharView(TINTS[Math.floor(Math.random() * TINTS.length)]),
    dir: 'nw', frame: 0, ft: 0, moving: true, ring: -1, waited: 0, incident: null,
  };
  customers.push(k);
  enqueue(k);
}

function kill(i) { dequeue(customers[i]); scene.removeView(customers[i].view); customers.splice(i, 1); }

export function killAllCustomers() { while (customers.length) kill(0); }

const queues = new Map();          // counterId → массив клиентов по порядку

function enqueue(k) {
  if (!queues.has(k.counter)) queues.set(k.counter, []);
  queues.get(k.counter).push(k);
}
function dequeue(k) {
  const q = queues.get(k.counter);
  if (!q) return;
  const i = q.indexOf(k);
  if (i >= 0) q.splice(i, 1);
}
function queueIndex(k) {
  const q = queues.get(k.counter);
  const i = q ? q.indexOf(k) : -1;
  return i < 0 ? 0 : i;
}
export function queueLen(counterId) {
  const q = queues.get(counterId);
  return q ? q.length : 0;
}

/** Недовольный клиент рядом с игроком — с ним можно разобраться. */
export function upsetNear(r = 1.5) {
  let best = null, bd = r;
  for (const k of customers) {
    if (k.state !== 'upset') continue;
    const d = dist(player.x, player.y, k.x, k.y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Разбор закончен — клиент уходит довольным. */
export function resolveUpset(k) {
  if (!k || k.state !== 'upset') return;
  scene.setMood(k.view, 'good');
  k.state = 'leave'; k.t = 0;
}

/** Первый в очереди — только он обслуживается. */
export function frontCustomer(counterId) {
  const q = queues.get(counterId);
  if (!q || !q.length) return null;
  const k = q[0];
  return (k.state === 'wait' || k.state === 'serve') ? k : null;
}

function stepTo(k, tx, ty, sp, dt, solid = true) {
  const dx = tx - k.x, dy = ty - k.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.08) { k.moving = false; return true; }
  const step = Math.min(d, sp * dt);
  k.x += (dx / d) * step;
  k.y += (dy / d) * step;
  if (solid) collide(k);
  k.dir = isoDir(dx, dy);
  k.moving = true;
  return false;
}

function draw(k, dt) {
  k.ft += dt * (k.moving ? 8 : 0);
  k.frame = Math.floor(k.ft) % 4;
  scene.setCharFrame(k.view, k.dir, k.moving ? k.frame : 0);
  if (k.state === 'serve') {
    const v = Math.min(1, k.serve / CUSTOMER.serveTime);
    if (Math.abs(v - k.ring) > 0.05) { k.ring = v; scene.setServeRing(k.view, v); }
  } else if (k.ring >= 0) { k.ring = -1; scene.setServeRing(k.view, -1); }
  scene.placeActor(k.view, k.x, k.y);
}

// ── Клиенты у гостя ──────────────────────────────────────────────────────────
// Гость мир не считает: он рисует клиентов ровно так, как их прислал хост.

const ghosts = new Map();
export function showGhosts(list) {
  const live = new Set();
  for (const g of list) {
    live.add(g.id);
    let v = ghosts.get(g.id);
    if (!v) { v = { view: scene.makeCharView(TINTS[Math.abs(hash(g.id)) % TINTS.length]), ft: 0 }; ghosts.set(g.id, v); }
    v.ft += 0.12;
    scene.setCharFrame(v.view, g.dir, g.moving ? Math.floor(v.ft) % 4 : 0);
    if (g.state === 'upset') scene.setMood(v.view, 'bad');
    scene.placeActor(v.view, g.x, g.y);
  }
  for (const [id, v] of ghosts) if (!live.has(id)) { scene.removeView(v.view); ghosts.delete(id); }
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ── Персонал ─────────────────────────────────────────────────────────────────

export const clerks = new Map();   // counterId → актёр
export const runner = { active: false, x: 0, y: 0, state: 'idle', target: null, load: 0, view: null,
                        dir: 'se', frame: 0, ft: 0, moving: false };

export function syncStaff() {
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    const has = clerks.has(c.id);
    if (st.open && st.clerk > 0 && !has) {
      const spot = clerkSpot(c);
      clerks.set(c.id, { x: spot.x, y: spot.y, view: scene.makeCharView(0xcfe6ff), dir: 'se', frame: 0, ft: 0 });
    } else if ((!st.open || st.clerk <= 0) && has) {
      scene.removeView(clerks.get(c.id).view);
      clerks.delete(c.id);
    }
  }
  if (S.runner > 0 && !runner.active) {
    runner.active = true;
    runner.x = VAULT.drop.x; runner.y = VAULT.drop.y;
    runner.view = scene.makeCharView(0xffe0b8);
    runner.state = 'seek'; runner.load = 0;
  } else if (S.runner <= 0 && runner.active) {
    runner.active = false;
    scene.removeView(runner.view); runner.view = null;
  }
}

export function tickClerks(dt) {
  for (const [id, a] of clerks) {
    const busy = !!frontCustomer(id);
    a.ft += dt * (busy ? 7 : 2.2);
    a.frame = Math.floor(a.ft) % 4;
    scene.setCharFrame(a.view, 'se', busy ? a.frame : 0);
    // лёгкое покачивание, чтобы зал не выглядел замершим
    scene.bobChar(a.view, a.ft, busy);
    scene.placeActor(a.view, a.x, a.y);
  }
}

export function runnerBag() {
  const d = STAFF.runner;
  return d.bagBase + d.bagStep * (S.runner - 1);
}
export function runnerSpeed() {
  const d = STAFF.runner;
  return d.speedBase + d.speedStep * (S.runner - 1);
}

/** Инкассатор: собирает наличные со стоек и банкоматов, относит в хранилище. */
export function tickRunner(dt, takeFrom, deposit) {
  if (!runner.active) return;
  const sp = runnerSpeed();

  if (runner.state === 'seek') {
    const src = richestSource();
    if (!src || runner.load >= runnerBag()) {
      runner.state = runner.load > 0 ? 'drop' : 'wait';
    } else {
      runner.target = src;
      runner.state = 'go';
    }
  }
  if (runner.state === 'wait') {
    runner.moving = false;
    if (richestSource()) runner.state = 'seek';
  }
  if (runner.state === 'go') {
    const p = runner.target.pick;
    if (stepTo(runner, p.x, p.y, sp, dt)) {
      const room = runnerBag() - runner.load;
      const got = takeFrom(runner.target, room);
      runner.load += got;
      runner.state = got > 0 && runner.load < runnerBag() ? 'seek' : 'drop';
      if (got <= 0) runner.state = 'seek';
    }
  }
  if (runner.state === 'drop') {
    if (stepTo(runner, VAULT.drop.x, VAULT.drop.y, sp, dt)) {
      deposit(runner.load);
      runner.load = 0;
      runner.state = 'seek';
    }
  }
  runner.ft += dt * (runner.moving ? 8 : 0);
  runner.frame = Math.floor(runner.ft) % 4;
  scene.setCharFrame(runner.view, runner.dir, runner.moving ? runner.frame : 0);
  scene.placeActor(runner.view, runner.x, runner.y);
}

function richestSource() {
  let best = null, bestV = 0.5;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (st.open && st.cash > bestV) { bestV = st.cash; best = { kind: 'counter', id: c.id, pick: pickSpot(c) }; }
  }
  for (const a of ATMS) {
    const st = S.atms[a.id];
    if (st.open && st.cash > bestV) { bestV = st.cash; best = { kind: 'atm', id: a.id, pick: atmPick(a) }; }
  }
  return best;
}

