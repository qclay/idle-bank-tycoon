// Отрисовка банка: вертикальный разрез здания, ходящие клерки, лифт, хранилище.
// Один canvas на весь экран, вертикальный скролл, поверх — DOM-панели этажей (ui.js).

import { FLOOR_DEFS, FLOOR_COUNT, BANKS } from './balance.js';
import { S, bank } from './state.js';
import {
  floorStats, elevStats, vaultStats, lastOpenIndex, openFloors,
  tapFloor, tapElev, tapVault, bonuses,
} from './engine.js';

export const LAYOUT = {
  floorH: 150,      // высота ряда этажа
  roomH: 104,       // из них — комната
  barH: 46,         // из них — панель управления
  vaultH: 200,      // высота блока хранилища снизу
  barsH: 92,        // из них — две DOM-панели (лифт и хранилище) в самом низу
  roofH: 150,       // крыша + небо сверху
  shaftW: 58,       // ширина шахты лифта слева
  pad: 6,
};

const A = {};       // загруженные картинки
let tinted = {};    // подкрашенные варианты клерков
let ready = false;

const CHAR_DIRS = ['se', 'sw', 'ne', 'nw'];
const CLERK_TINTS = ['#ffffff', '#bfe0ff', '#ffe0c2', '#d9ffd2', '#f0d5ff'];

export function loadAssets() {
  const list = [];
  const add = (key, src) => {
    const img = new Image();
    img.src = src;
    A[key] = img;
    list.push(new Promise((res) => { img.onload = res; img.onerror = res; }));
  };
  for (const d of CHAR_DIRS) for (let f = 0; f < 4; f++) add(`${d}${f}`, `assets/char/${d}_${f}.png`);
  add('coin', 'assets/ui/coin.png');
  add('star', 'assets/ui/hud_star.png');
  return Promise.all(list).then(() => { buildTints(); ready = true; });
}

function buildTints() {
  tinted = {};
  for (const d of CHAR_DIRS) {
    for (let f = 0; f < 4; f++) {
      const img = A[`${d}${f}`];
      if (!img || !img.width) continue;
      tinted[`${d}${f}`] = CLERK_TINTS.map((c) => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        if (c !== '#ffffff') {
          g.globalCompositeOperation = 'source-atop';
          g.globalAlpha = 0.42;
          g.fillStyle = c;
          g.fillRect(0, 0, cv.width, cv.height);
        }
        return cv;
      });
    }
  }
}

// ── Геометрия мира ────────────────────────────────────────────────────────────
// Мировая ось Y направлена вверх, 0 — пол хранилища.

export function visibleFloors() {
  const last = lastOpenIndex();
  return Math.min(FLOOR_COUNT, last + 2);   // открытые + одна следующая
}

export function floorWorldY(i) { return LAYOUT.vaultH + i * LAYOUT.floorH; }
export function worldHeight() { return LAYOUT.vaultH + visibleFloors() * LAYOUT.floorH + LAYOUT.roofH; }

export const cam = { y: 0, target: 0, vel: 0 };

let cv, ctx, W = 0, H = 0, dpr = 1;
let bottomInset = 110;   // высота нижних панелей — низ здания не должен под них уезжать
let t = 0;
const floats = [];      // всплывающие «+$…»
const puffs = [];

export function initScene(canvas) {
  cv = canvas;
  ctx = cv.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  bindInput();
}

export function resize() {
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nav = document.getElementById('nav');
  const sb = document.getElementById('stepbar');
  bottomInset = (nav?.offsetHeight || 64) + (sb?.offsetHeight || 46) - 6;
  clampCam();
}

function viewport() { return Math.max(120, H - bottomInset); }

export function clampCam() {
  const max = Math.max(0, worldHeight() - viewport());
  cam.y = Math.max(0, Math.min(max, cam.y));
  cam.target = Math.max(0, Math.min(max, cam.target));
}

/** Экранная Y для мировой Y (низ здания стоит над нижними панелями). */
function sy(worldY) { return H - bottomInset - (worldY - cam.y); }
export const worldToScreen = sy;

export function scrollToFloor(i, instant = false) {
  const y = floorWorldY(i) - viewport() / 2 + LAYOUT.floorH / 2;
  cam.target = y;
  if (instant) cam.y = y;
  clampCam();
}

// ── Ввод ──────────────────────────────────────────────────────────────────────

let drag = null;
const tapListeners = [];
export function onTap(fn) { tapListeners.push(fn); }

function bindInput() {
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  const down = (e) => {
    if (e.target !== cv) return;
    const p = pt(e);
    drag = { x: p.x, y: p.y, sy: cam.y, moved: 0, t: performance.now(), last: p.y, vel: 0 };
  };
  const move = (e) => {
    if (!drag) return;
    const p = pt(e);
    const dy = p.y - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dy) + Math.abs(p.x - drag.x));
    cam.y = drag.sy + dy;          // тянем вниз — едем вверх по зданию
    cam.target = cam.y;
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.vel = (p.y - drag.last) / dt * 16;
    drag.last = p.y; drag.t = now;
    clampCam();
    if (drag.moved > 8 && e.cancelable) e.preventDefault();
  };
  const up = () => {
    if (!drag) return;
    if (drag.moved < 8) hit(drag.x, drag.y);
    else cam.vel = drag.vel;
    drag = null;
  };

  cv.addEventListener('touchstart', down, { passive: true });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', up);
  cv.addEventListener('touchcancel', () => { drag = null; });
  cv.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  cv.addEventListener('wheel', (e) => {
    cam.target -= e.deltaY; cam.y = cam.target; clampCam(); e.preventDefault();
  }, { passive: false });
}

function hit(x, y) {
  const wy = cam.y + (H - bottomInset - y);
  // Хранилище
  if (wy < LAYOUT.vaultH) {
    tapVault();
    pop(x, y, 'vault');
    fire({ kind: 'vault' });
    return;
  }
  const i = Math.floor((wy - LAYOUT.vaultH) / LAYOUT.floorH);
  if (i < 0 || i >= visibleFloors()) return;
  const local = (wy - LAYOUT.vaultH) % LAYOUT.floorH;
  if (local < LAYOUT.barH) return;          // это зона DOM-панели, canvas не реагирует
  if (x < LAYOUT.shaftW) { tapElev(); pop(x, y, 'elev'); fire({ kind: 'elev' }); return; }
  const f = bank().floors[i];
  if (f.lvl <= 0) { fire({ kind: 'locked', i }); return; }
  tapFloor(i);
  pop(x, y, 'floor');
  fire({ kind: 'floor', i });
}

function fire(ev) { for (const fn of tapListeners) fn(ev); }

function pop(x, y) {
  if (!S.settings.showFx) return;
  puffs.push({ x, y, t: 0, life: 0.45 });
}

export function floatText(worldX, worldY, text, color = '#ffe680') {
  if (!S.settings.showFx) return;
  floats.push({ x: worldX, y: worldY, text, color, t: 0, life: 1.1 });
}

// ── Рисование ─────────────────────────────────────────────────────────────────

export function draw(dt) {
  if (!ctx) return;
  t += dt;

  // инерция скролла
  if (!drag && Math.abs(cam.vel) > 0.1) {
    cam.y += cam.vel; cam.target = cam.y;
    cam.vel *= 0.92;
    clampCam();
  } else if (!drag) {
    cam.y += (cam.target - cam.y) * Math.min(1, dt * 8);
  }

  const def = BANKS[S.bankIdx];
  ctx.clearRect(0, 0, W, H);
  drawSky(def);

  const nVis = visibleFloors();
  const firstVisible = Math.max(0, Math.floor((cam.y - LAYOUT.vaultH) / LAYOUT.floorH) - 1);
  const lastVisible = Math.min(nVis - 1, Math.ceil((cam.y + H - LAYOUT.vaultH) / LAYOUT.floorH));

  drawBuildingShell(def, nVis);
  for (let i = firstVisible; i <= lastVisible; i++) drawFloor(i, def, dt);
  drawShaft(def, nVis);
  if (sy(LAYOUT.vaultH) > -20) drawVault(def, dt);
  drawRoof(def, nVis);

  drawFx(dt);
}

function drawSky(def) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, def.sky[0]);
  g.addColorStop(1, def.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // силуэт города на фоне
  const topY = sy(worldHeight() - LAYOUT.roofH);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#0b2a49';
  const base = Math.min(H, Math.max(0, topY + 120));
  let x = -20;
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (x < W + 40) {
    const w = 18 + rnd() * 34;
    const h = 40 + rnd() * 150;
    ctx.fillRect(x, base - h, w, h);
    x += w + 6 + rnd() * 10;
  }
  ctx.restore();
}

function shellX() { return { x0: LAYOUT.pad, x1: W - LAYOUT.pad }; }

function drawBuildingShell(def, nVis) {
  const { x0, x1 } = shellX();
  const top = sy(LAYOUT.vaultH + nVis * LAYOUT.floorH);
  const bot = sy(0);
  ctx.fillStyle = '#e8eef5';
  ctx.fillRect(x0, top, x1 - x0, bot - top);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(x0, top, 6, bot - top);
  ctx.fillRect(x1 - 6, top, 6, bot - top);
}

function drawFloor(i, def, dt) {
  const wy = floorWorldY(i);
  const yTop = sy(wy + LAYOUT.floorH);      // верх ряда на экране
  const yBar = sy(wy + LAYOUT.barH);        // граница комнаты и панели
  const yBot = sy(wy);
  const { x0, x1 } = shellX();
  const rx0 = LAYOUT.shaftW;
  const f = bank().floors[i];
  const fd = FLOOR_DEFS[i];
  const locked = f.lvl <= 0;

  // Пол/потолок
  ctx.fillStyle = '#cfd8e2';
  ctx.fillRect(x0, yBar - 4, x1 - x0, 4);

  if (locked) {
    ctx.fillStyle = 'rgba(30,40,55,0.55)';
    ctx.fillRect(rx0, yTop, x1 - rx0, yBar - yTop);
    // строительная штриховка
    ctx.save();
    ctx.beginPath(); ctx.rect(rx0, yTop, x1 - rx0, yBar - yTop); ctx.clip();
    ctx.strokeStyle = 'rgba(255,205,60,0.22)';
    ctx.lineWidth = 10;
    for (let x = rx0 - 120; x < x1 + 120; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, yBar); ctx.lineTo(x + 90, yTop); ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Стена комнаты
  const grad = ctx.createLinearGradient(0, yTop, 0, yBar);
  grad.addColorStop(0, `hsl(${fd.hue} 32% 88%)`);
  grad.addColorStop(1, `hsl(${fd.hue} 26% 79%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(rx0, yTop, x1 - rx0, yBar - yTop);

  // Окно на дальней стене
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x1 - 74, yTop + 14, 54, 30);
  ctx.strokeStyle = 'rgba(60,80,105,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x1 - 74, yTop + 14, 54, 30);

  const floorY = yBar - 6;                  // линия пола, по которой ходят
  const st = floorStats(i);

  // Стойка обслуживания справа, за ней — очередь клиентов
  const deskW = 62;
  const deskX = x1 - 118;
  const qn = Math.min(2, 1 + (i % 2));
  for (let c = 0; c < qn; c++) {
    const bob = Math.sin(t * 2 + c * 1.7) * 1.5;
    drawChar('sw', Math.floor((t * 2.4 + c) % 4), deskX + deskW + 16 + c * 20, floorY + bob, 44, 2 + (c % 3));
  }
  drawDesk(deskX, floorY, fd, deskW);

  // Клерки: ходят от шахты к стойке и обратно
  const active = f.mgr || f.run;
  const lane = { a: rx0 + 16, b: deskX - 6 };
  for (let w = 0; w < st.workers; w++) {
    const ph = active ? ((f.prog + w / st.workers) % 1) : (w / st.workers) * 0.5;
    let x, dir, carry;
    if (ph < 0.5) { const u = ph / 0.5; x = lane.a + (lane.b - lane.a) * u; dir = 'se'; carry = false; }
    else { const u = (ph - 0.5) / 0.5; x = lane.b + (lane.a - lane.b) * u; dir = 'sw'; carry = true; }
    const frame = active ? Math.floor((t * 7 + w) % 4) : 0;
    drawChar(dir, frame, x, floorY, 52, w % CLERK_TINTS.length);
    if (carry) {
      const cs = 13;
      drawCoin(x + (dir === 'sw' ? -11 : 11), floorY - 30, cs);
    }
  }

  // Стопка денег у шахты
  const ratio = st.stackCap > 0 ? Math.min(1, f.stack / st.stackCap) : 0;
  drawStack(rx0 + 4, floorY, ratio, f.stack);

  // Подсветка «полно — нужен лифт»
  if (ratio > 0.985) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(t * 5) * 0.2;
    ctx.fillStyle = '#ff5f4a';
    ctx.fillRect(rx0, yTop, 4, yBar - yTop);
    ctx.restore();
  }
}

function drawDesk(x, floorY, fd, w = 62) {
  const h = 32;
  ctx.fillStyle = `hsl(${fd.hue} 40% 42%)`;
  ctx.fillRect(x, floorY - h, w, h);
  ctx.fillStyle = `hsl(${fd.hue} 45% 55%)`;
  ctx.fillRect(x, floorY - h, w, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  roundRect(x + 4, floorY - h - 30, w - 8, 25, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(40,60,80,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '15px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#20364d';
  ctx.fillText(fd.icon, x + w / 2, floorY - h - 17);
}

function drawStack(x, floorY, ratio, amount) {
  if (ratio <= 0.001) return;
  const rows = Math.max(1, Math.round(ratio * 6));
  for (let r = 0; r < rows; r++) {
    const cols = r < rows - 1 ? 3 : 1 + Math.floor(ratio * 2) % 3;
    for (let c = 0; c < cols; c++) {
      drawCoin(x + 8 + c * 11, floorY - 6 - r * 8, 15);
    }
  }
}

function drawCoin(x, y, size) {
  const img = A.coin;
  if (img && img.width) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  else { ctx.fillStyle = '#f2c33c'; ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7); ctx.fill(); }
}

function drawChar(dir, frame, x, footY, h, tint = 0) {
  const key = `${dir}${frame}`;
  const src = (tinted[key] && tinted[key][tint % CLERK_TINTS.length]) || A[key];
  if (!src || !src.width) {
    ctx.fillStyle = '#456'; ctx.fillRect(x - 7, footY - h, 14, h); return;
  }
  const w = h * (src.width / src.height);
  ctx.drawImage(src, x - w / 2, footY - h, w, h);
}

function drawShaft(def, nVis) {
  const top = sy(LAYOUT.vaultH + nVis * LAYOUT.floorH);
  const bot = sy(0);
  ctx.fillStyle = '#33455c';
  ctx.fillRect(LAYOUT.pad, top, LAYOUT.shaftW - LAYOUT.pad, bot - top);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let y = top; y < bot; y += 22) ctx.fillRect(LAYOUT.pad, y, LAYOUT.shaftW - LAYOUT.pad, 2);
  // тросы
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  const cx = LAYOUT.pad + (LAYOUT.shaftW - LAYOUT.pad) / 2;
  ctx.beginPath(); ctx.moveTo(cx - 12, top); ctx.lineTo(cx - 12, bot); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 12, top); ctx.lineTo(cx + 12, bot); ctx.stroke();

  // кабина: pos = 0 — на уровне приёмки хранилища, pos = i+1 — у стойки i-го этажа
  const e = bank().elev;
  const est = elevStats();
  const wy = LAYOUT.barsH + e.pos * LAYOUT.floorH;
  const y = sy(wy);
  const cw = LAYOUT.shaftW - LAYOUT.pad - 8, ch = 62;
  const x = LAYOUT.pad + 4;
  ctx.fillStyle = '#20304a';
  ctx.fillRect(x - 2, y - ch - 2, cw + 4, ch + 4);
  const g = ctx.createLinearGradient(x, y - ch, x, y);
  g.addColorStop(0, '#6f8ab0'); g.addColorStop(1, '#42597a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y - ch, cw, ch);
  // груз
  const load = est.capacity > 0 ? Math.min(1, e.load / est.capacity) : 0;
  if (load > 0) {
    const lh = Math.max(4, (ch - 12) * load);
    ctx.fillStyle = '#f2c33c';
    ctx.fillRect(x + 5, y - 5 - lh, cw - 10, lh);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 5, y - 5 - lh, cw - 10, 3);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y - ch + 0.5, cw - 1, ch - 1);
  // индикатор без менеджера
  if (!e.mgr) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.3;
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath(); ctx.arc(x + cw / 2, y - ch - 10, 5, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function drawVault(def, dt) {
  const { x1 } = shellX();
  const x0 = LAYOUT.shaftW;            // шахта лифта идёт до самого низа, не перекрываем
  const top = sy(LAYOUT.vaultH);
  const bot = sy(LAYOUT.barsH);        // ниже — DOM-панели лифта и хранилища
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, '#39506e'); g.addColorStop(1, '#25374f');
  ctx.fillStyle = g;
  ctx.fillRect(x0, top, x1 - x0, bot - top);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x0, top, x1 - x0, 5);

  const v = bank().vault;
  const vst = vaultStats();

  ctx.font = '700 11px system-ui';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const label = 'ХРАНИЛИЩЕ';
  ctx.fillText(label, x0 + 10, top + 18);
  const labelEnd = x0 + 10 + ctx.measureText(label).width;

  // Дверь сейфа справа
  const dh = 76, dw = 76;
  const dx = x1 - dw - 14, dy = bot - dh - 12;
  ctx.fillStyle = '#8a9bb2';
  roundRect(dx, dy, dw, dh, 10); ctx.fill();
  ctx.fillStyle = '#6d7f97';
  roundRect(dx + 7, dy + 7, dw - 14, dh - 14, 8); ctx.fill();
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  if ((v.mgr || v.run) && v.load > 0) ctx.rotate(t * 2.2);
  ctx.strokeStyle = '#cdd8e6'; ctx.lineWidth = 5;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(k * Math.PI / 2) * 22, Math.sin(k * Math.PI / 2) * 22);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fillStyle = '#cdd8e6'; ctx.fill();
  ctx.restore();

  // Приёмка: куча денег, которые лифт привёз
  const ratio = vst.cap > 0 ? Math.min(1, v.load / vst.cap) : 0;
  const px = x0 + 8;
  const pw = dx - px - 12;
  const py = bot - 58;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(px, py, pw, 44, 8); ctx.fill();
  if (ratio > 0) {
    ctx.save();
    ctx.beginPath(); roundRect(px + 3, py + 3, pw - 6, 38, 6); ctx.clip();
    const cols = Math.max(1, Math.round(ratio * (pw / 15)));
    for (let r = 0; r < 3; r++) for (let c = 0; c < cols; c++) {
      drawCoin(px + 12 + c * 14, py + 36 - r * 11, 16);
    }
    ctx.restore();
  }

  // Полоса обработки
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(px, bot - 10, pw, 6, 3); ctx.fill();
  ctx.fillStyle = '#7ee08a';
  roundRect(px, bot - 10, pw * Math.max(0, Math.min(1, v.prog)), 6, 3); ctx.fill();

  if (!v.mgr) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.3;
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath(); ctx.arc(labelEnd + 10, top + 14, 5, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function drawRoof(def, nVis) {
  const { x0, x1 } = shellX();
  const y = sy(LAYOUT.vaultH + nVis * LAYOUT.floorH);
  if (y > H + 10) return;
  ctx.fillStyle = '#c3cedb';
  ctx.fillRect(x0 - 6, y - 16, x1 - x0 + 12, 16);
  ctx.fillStyle = '#9fb0c4';
  ctx.fillRect(x0 + 24, y - 46, 42, 30);
  ctx.fillStyle = '#7f93ab';
  ctx.fillRect(x1 - 70, y - 62, 26, 46);
  // Вывеска банка
  const label = `${def.flag}  ${def.name.toUpperCase()}`;
  ctx.font = '700 15px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + 28;
  const bx = (x0 + x1) / 2 - tw / 2;
  ctx.fillStyle = def.accent;
  roundRect(bx, y - 96, tw, 30, 8); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, (x0 + x1) / 2, y - 81);
}

function drawFx(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    if (f.t > f.life) { floats.splice(i, 1); continue; }
    const k = f.t / f.life;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.font = '700 15px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,30,45,0.6)';
    ctx.strokeText(f.text, f.x, f.y - k * 34);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - k * 34);
    ctx.restore();
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.t += dt;
    if (p.t > p.life) { puffs.splice(i, 1); continue; }
    const k = p.t / p.life;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.6;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, 8 + k * 34, 0, 7); ctx.stroke();
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Экранная позиция ряда этажа — нужна DOM-панелям. */
export function floorScreenTop(i) { return sy(floorWorldY(i) + LAYOUT.floorH); }
export function floorBarTop(i) { return sy(floorWorldY(i) + LAYOUT.barH); }
export function viewH() { return H; }
export function viewW() { return W; }
export function isReady() { return ready; }
