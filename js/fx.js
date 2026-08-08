// Эффекты: летящие монеты, всплывающие числа, «выпрыг» построек, толчок камеры.
// Спрайты берутся из пула — на каждый кадр ничего не создаётся.

import { Sprite, Container } from 'pixi.js';
import { px, clamp } from './core.js';

let layer = null;      // контейнер поверх сцены (в мировых координатах)
let dom = null;        // слой DOM для чисел
let coinTex = null;
let screenOf = null;

const pool = [];
const live = [];
const texts = [];
const pops = [];
export const shake = { x: 0, y: 0, t: 0, power: 0 };

export function initFx(pixiLayer, domLayer, texture, screenFn) {
  layer = pixiLayer; dom = domLayer; coinTex = texture; screenOf = screenFn;
}

function take() {
  const s = pool.pop() || new Sprite(coinTex);
  s.anchor.set(0.5);
  s.visible = true;
  s.alpha = 1;
  layer.addChild(s);
  return s;
}

function give(s) {
  s.visible = false;
  if (s.parent) s.parent.removeChild(s);
  if (pool.length < 90) pool.push(s); else s.destroy();
}

/** Монеты летят по дуге из точки в точку. onEach — на каждое прибытие. */
export function coins(fx, fy, tx, ty, n = 1, o = {}) {
  if (!layer) return;
  const count = clamp(Math.round(n), 1, 8);
  for (let i = 0; i < count; i++) {
    const s = take();
    const a = px(fx, fy, o.fromZ ?? 0.9);
    const b = px(tx, ty, o.toZ ?? 0.9);
    s.scale.set(o.size ?? 0.3);
    s.x = a.x; s.y = a.y;
    live.push({
      s, ax: a.x + (Math.random() - 0.5) * 16, ay: a.y + (Math.random() - 0.5) * 10,
      bx: b.x, by: b.y,
      t: -i * 0.05, life: (o.life ?? 0.42) + Math.random() * 0.1,
      arc: (o.arc ?? 46) + Math.random() * 18,
      spin: (Math.random() - 0.5) * 6,
      onDone: i === count - 1 ? o.onDone : null,
    });
  }
}

/** Монеты разлетаются и падают — короткий салют на месте события. */
export function burst(x, y, n = 4, o = {}) {
  if (!layer) return;
  const count = clamp(Math.round(n), 1, 8);
  const a = px(x, y, o.z ?? 1.0);
  for (let i = 0; i < count; i++) {
    const s = take();
    s.scale.set(o.size ?? 0.26);
    s.x = a.x; s.y = a.y;
    const ang = (-0.25 - Math.random() * 0.5) * Math.PI;
    const sp = 70 + Math.random() * 70;
    live.push({
      s, free: true, x: a.x, y: a.y,
      vx: Math.cos(ang) * sp * (Math.random() < 0.5 ? -1 : 1),
      vy: Math.sin(ang) * sp,
      t: 0, life: 0.55 + Math.random() * 0.25,
      spin: (Math.random() - 0.5) * 10,
    });
  }
}

/** Всплывающее число над точкой мира. */
export function popText(x, y, str, kind = '') {
  if (!dom) return;
  const el = document.createElement('div');
  el.className = 'fxnum' + (kind ? ' fxnum--' + kind : '');
  el.textContent = str;
  dom.appendChild(el);
  texts.push({ el, x, y, t: 0, life: 1.0, dx: (Math.random() - 0.5) * 16 });
}

/** «Выпрыг» построенного объекта. */
export function popIn(obj, delay = 0) {
  if (!obj) return;
  obj.scale.set(0.01);
  pops.push({ obj, t: -delay, life: 0.52 });
}

/** Быстрый «отклик» объекта: чуть подпрыгнул и вернулся. */
const pulses = [];
export function pulse(obj, amount = 0.12) {
  if (!obj) return;
  const cur = pulses.find((x) => x.obj === obj);
  if (cur) { cur.t = 0; cur.a = amount; return; }
  pulses.push({ obj, t: 0, life: 0.26, a: amount });
}

/** Короткий толчок камеры. */
export function punch(power = 6) {
  shake.power = Math.max(shake.power, power);
  shake.t = 0.28;
}

export function tick(dt) {
  // монеты
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.t += dt;
    if (f.t < 0) continue;
    f.s.rotation += f.spin * dt;
    if (f.free) {
      f.vy += 620 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.s.x = f.x; f.s.y = f.y;
      const k = f.t / f.life;
      f.s.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      if (k >= 1) { give(f.s); live.splice(i, 1); }
      continue;
    }
    const k = Math.min(1, f.t / f.life);
    const e = k * k * (3 - 2 * k);
    f.s.x = f.ax + (f.bx - f.ax) * e;
    f.s.y = f.ay + (f.by - f.ay) * e - Math.sin(e * Math.PI) * f.arc;
    if (k >= 1) { f.onDone?.(); give(f.s); live.splice(i, 1); }
  }

  // всплывающие числа
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.t += dt;
    const k = t.t / t.life;
    if (k >= 1) { t.el.remove(); texts.splice(i, 1); continue; }
    const p = screenOf(t.x, t.y, 1.1);
    t.el.style.transform =
      `translate(${Math.round(p.x + t.dx * k)}px, ${Math.round(p.y - 46 * k)}px) translate(-50%,-100%) scale(${1 + 0.25 * Math.sin(Math.min(1, k * 3) * Math.PI / 2)})`;
    t.el.style.opacity = k > 0.6 ? String(1 - (k - 0.6) / 0.4) : '1';
  }

  // выпрыг построек
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt;
    if (p.t < 0) continue;
    const k = Math.min(1, p.t / p.life);
    // упругая кривая: перелёт и возврат
    const s = k < 0.6 ? (k / 0.6) * 1.18 : 1.18 - ((k - 0.6) / 0.4) * 0.18;
    p.obj.scale.set(s);
    if (k >= 1) { p.obj.scale.set(1); pops.splice(i, 1); }
  }

  // отклик объектов
  for (let i = pulses.length - 1; i >= 0; i--) {
    const q = pulses[i];
    q.t += dt;
    const k = Math.min(1, q.t / q.life);
    q.obj.scale.set(1 + Math.sin(k * Math.PI) * q.a);
    if (k >= 1) { q.obj.scale.set(1); pulses.splice(i, 1); }
  }

  // толчок камеры
  if (shake.t > 0) {
    shake.t -= dt;
    const k = Math.max(0, shake.t / 0.28);
    const a = shake.power * k;
    shake.x = (Math.random() - 0.5) * a;
    shake.y = (Math.random() - 0.5) * a;
    if (shake.t <= 0) { shake.x = 0; shake.y = 0; shake.power = 0; }
  }
}

export function clearFx() {
  pulses.length = 0;
  for (const f of live) give(f.s);
  live.length = 0;
  for (const t of texts) t.el.remove();
  texts.length = 0;
  pops.length = 0;
}
