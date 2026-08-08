// Изометрическая сцена банка на PixiJS.
// Арт собирается из изометрических примитивов (как в iso.js фермы): у коробки
// три грани — верх светлее, левая средняя, правая тёмная, всё с тёмным контуром.

// spine-pixi должен импортироваться ДО создания рендерера, иначе его render-pipe
// не регистрируется и Spine на сцене падает с validateRenderable.
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';

import { TW, TH, ZU, px, depth, shade, clamp } from './core.js';
import * as fx from './fx.js';
import { HALL, VAULT, COUNTERS, ATMS, UPGRADES } from './balance.js';

export const INK = 0x3f2b18;

let app = null;
export let world = null;      // контейнер мира (двигается камерой)
let ground = null;            // статичный пол и стены
let items = null;             // объекты и актёры, сортируются по глубине
let fxLayer = null;           // эффекты поверх
export const cam = { x: 0, y: 0, scale: 1 };
const tex = {};

export function getApp() { return app; }

// ── Примитивы ────────────────────────────────────────────────────────────────

function poly(g, pts, color, alpha = 1) {
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color, alpha });
}

function outline(g, pts, w = 2, color = INK, alpha = 1) {
  g.poly(pts.flatMap((p) => [p.x, p.y])).stroke({ width: w, color, alpha, join: 'round' });
}

/** Изометрическая коробка: основной кирпич всего арта. */
export function isoBox(g, x0, y0, x1, y1, z0, h, base, o = {}) {
  const z1 = z0 + h;
  const T = [px(x0, y0, z1), px(x1, y0, z1), px(x1, y1, z1), px(x0, y1, z1)];
  const L = [px(x0, y1, z1), px(x1, y1, z1), px(x1, y1, z0), px(x0, y1, z0)];
  const R = [px(x1, y0, z1), px(x1, y1, z1), px(x1, y1, z0), px(x1, y0, z0)];
  const ow = o.ow ?? 2;
  const top = o.top ?? shade(base, 0.2);
  const left = o.left ?? base;
  const right = o.right ?? shade(base, -0.26);
  if (h > 0.001) {
    poly(g, L, left); poly(g, R, right);
    if (ow) { outline(g, L, ow); outline(g, R, ow); }
  }
  if (o.noTop !== true) {
    poly(g, T, top);
    if (ow) outline(g, T, ow);
    // мягкий блик по верхней грани
    if (o.sheen !== false) poly(g, T, 0xffffff, 0.10);
  }
  return g;
}

/** Плоский ромб на полу. */
export function isoRhomb(g, x0, y0, x1, y1, z, color, o = {}) {
  const P = [px(x0, y0, z), px(x1, y0, z), px(x1, y1, z), px(x0, y1, z)];
  poly(g, P, color, o.alpha ?? 1);
  if (o.ow) outline(g, P, o.ow, o.oc ?? INK, o.oa ?? 1);
  return g;
}

/** Изометрический «цилиндр» — колонна, вазон, тумба. */
function isoCyl(g, cx, cy, r, z0, h, base) {
  const steps = 18;
  const ring = (z) => {
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push(px(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
    }
    return pts;
  };
  const bot = ring(z0), top = ring(z0 + h);
  // боковая поверхность
  const side = [...top, ...bot.slice().reverse()];
  poly(g, side, base);
  outline(g, side, 2);
  poly(g, top, shade(base, 0.22));
  outline(g, top, 2);
}

// ── Запуск ───────────────────────────────────────────────────────────────────

export async function initScene(host, onProgress = () => {}) {
  app = new Application();
  await app.init({
    background: 0x101f31,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    resizeTo: host,
    preference: 'webgl',
  });
  host.appendChild(app.canvas);

  onProgress(0.15);
  await loadTextures(onProgress);

  const back = new Graphics();
  app.stage.addChild(back);
  drawBackdrop(back);
  app.renderer.on('resize', () => drawBackdrop(back));

  world = new Container();
  ground = new Container();
  items = new Container();
  items.sortableChildren = true;
  fxLayer = new Container();
  world.addChild(ground, items, fxLayer);
  app.stage.addChild(world);

  buildGround();
  fx.initFx(fxLayer, document.getElementById('worldUI'), tex.coin, screenOf);
  fitCamera();
  window.addEventListener('resize', () => fitCamera(insets.top, insets.bottom));
  onProgress(1);
  return app;
}

async function loadTextures(onProgress) {
  const list = {
    coin: './assets/ui/coin.png',
    coinS: './assets/ui/hud_coin.png',
    star: './assets/ui/hud_star.png',
    plant: './assets/nature/bush.png',
  };
  for (const d of ['se', 'sw', 'ne', 'nw']) {
    for (let i = 0; i < 4; i++) list[`${d}${i}`] = `./assets/char/${d}_${i}.png`;
  }
  const keys = Object.keys(list);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    try { tex[k] = await Assets.load(list[k]); } catch { tex[k] = Texture.EMPTY; }
    done++; onProgress(0.15 + 0.55 * (done / keys.length));
  }));

  // Spine-утка — главный герой
  try {
    Assets.add({ alias: 'duck-skel', src: './assets/spine/duck/duck.json' });
    Assets.add({ alias: 'duck-atlas', src: './assets/spine/duck/duck.atlas' });
    await Assets.load(['duck-skel', 'duck-atlas']);
    tex.duckReady = true;
  } catch (e) {
    console.warn('Spine-утка не загрузилась', e);
    tex.duckReady = false;
  }
  onProgress(0.85);
}

export function texture(k) { return tex[k]; }

function drawBackdrop(g) {
  const w = app.screen.width, h = app.screen.height;
  g.clear();
  g.rect(0, 0, w, h).fill(0x0f1e2f);
  // мягкое пятно света по центру — зал не висит в пустоте
  const steps = 7;
  for (let i = steps; i > 0; i--) {
    const k = i / steps;
    g.ellipse(w / 2, h * 0.48, w * 0.95 * k, h * 0.62 * k)
      .fill({ color: 0x1d3350, alpha: 0.16 });
  }
}

// ── Пол, стены, декор ────────────────────────────────────────────────────────

const FLOOR_A = 0xe8e2d4;
const FLOOR_B = 0xdcd4c2;
const CARPET = 0x9d5b52;
const WALL = 0xf2ece0;
const DECOR = [[0.6, 12.2], [17.3, 0.6], [17.3, 12.2], [0.6, 10.6]];

function buildGround() {
  const g = new Graphics();

  // плитка
  for (let y = 0; y < HALL.h; y++) {
    for (let x = 0; x < HALL.w; x++) {
      const c = (x + y) % 2 ? FLOOR_A : FLOOR_B;
      isoRhomb(g, x, y, x + 1, y + 1, 0, c);
    }
  }
  // ковровая дорожка: от входа вдоль зала и к стойкам
  isoRhomb(g, 5.2, 4.2, 16.6, 5.6, 0.002, CARPET, { alpha: 0.85 });
  isoRhomb(g, 14.6, 5.6, 16.6, 12.2, 0.002, CARPET, { alpha: 0.85 });
  isoRhomb(g, 5.2, 4.2, 16.6, 5.6, 0.003, 0, { alpha: 0, ow: 2, oc: 0x7d4038, oa: 0.45 });
  isoRhomb(g, 14.6, 5.6, 16.6, 12.2, 0.003, 0, { alpha: 0, ow: 2, oc: 0x7d4038, oa: 0.45 });

  // контур пола
  isoRhomb(g, 0, 0, HALL.w, HALL.h, 0.004, 0x000000, { alpha: 0, ow: 2.5, oc: 0x6b5a44, oa: 0.35 });

  // задние стены: по y = 0 и по x = 0
  isoBox(g, 0, -0.22, HALL.w, 0, 0, 2.6, WALL, { right: shade(WALL, -0.16), left: shade(WALL, -0.04), sheen: false });
  isoBox(g, -0.22, 0, 0, HALL.h, 0, 2.6, WALL, { right: shade(WALL, -0.16), left: shade(WALL, -0.04), sheen: false });
  // плинтус
  isoBox(g, 0, -0.22, HALL.w, 0, 0, 0.14, 0x8d7a61);
  isoBox(g, -0.22, 0, 0, HALL.h, 0, 0.14, 0x8d7a61);

  // окна на дальней стене
  for (let x = 3.4; x < HALL.w - 1.5; x += 3.4) {
    isoBox(g, x, -0.24, x + 1.7, -0.2, 1.05, 1.15, 0x9fd6f2, { ow: 2 });
  }
  for (let y = 3.4; y < HALL.h - 1.5; y += 3.4) {
    isoBox(g, -0.24, y, -0.2, y + 1.7, 1.05, 1.15, 0x9fd6f2, { ow: 2 });
  }

  ground.addChild(g);

  // вазоны по углам зала
  const dec = new Graphics();
  for (const [x, y] of DECOR) {
    isoCyl(dec, x, y, 0.32, 0, 0.42, 0xb9743f);
  }
  ground.addChild(dec);
  for (const [x, y] of DECOR) {
    const s = new Sprite(tex.plant);
    s.anchor.set(0.5, 1);
    const p = px(x, y, 0.42);
    s.x = p.x; s.y = p.y;
    s.scale.set(0.26);
    ground.addChild(s);
  }

  // входная зона
  const dg = new Graphics();
  isoRhomb(dg, 15.1, 11.5, 17.4, 12.96, 0.006, 0x6f8fb5, { alpha: 0.45, ow: 2, oc: 0x44607f, oa: 0.6 });
  ground.addChild(dg);
}

// ── Объекты зала ─────────────────────────────────────────────────────────────

/** Хранилище — толстая дверь-сейф в дальнем углу. */
export function buildVault() {
  const c = new Container();
  const g = new Graphics();
  const { x, y, w, h } = VAULT;
  isoBox(g, x, y, x + w, y + h, 0, 1.9, 0x51617a);
  isoBox(g, x + 0.1, y + 0.1, x + w - 0.1, y + h - 0.1, 1.9, 0.12, 0x6a7c96);
  // дверь на фронтальной грани
  isoBox(g, x + 0.4, y + h, x + w - 0.4, y + h + 0.14, 0.25, 1.3, 0x8f9fb5);
  c.addChild(g);

  const wheel = new Graphics();
  wheel.circle(0, 0, 15).fill(0xc9d5e6).stroke({ width: 3, color: INK });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    wheel.moveTo(0, 0).lineTo(Math.cos(a) * 22, Math.sin(a) * 22 * 0.62)
      .stroke({ width: 5, color: 0xc9d5e6 });
  }
  wheel.circle(0, 0, 7).fill(0x8f9fb5);
  const wp = px(x + w / 2, y + h + 0.14, 0.92);
  wheel.x = wp.x; wheel.y = wp.y;
  c.addChild(wheel);
  c.zIndex = depth(x + w / 2, y + h);
  c.__wheel = wheel;
  items.addChild(c);
  return c;
}

/** Стойка: тумба + столешница + стеклянный экран + лоток для налички. */
export function buildCounter(def, opened) {
  const c = new Container();
  const g = new Graphics();
  const x = def.x, y = def.y;
  if (opened) {
    isoBox(g, x, y, x + 2, y + 0.62, 0, 0.86, def.tone);
    isoBox(g, x - 0.08, y - 0.08, x + 2.08, y + 0.7, 0.86, 0.1, shade(def.tone, 0.45));
    // стеклянная перегородка: прозрачная, иначе прячет кассира
    const gl = new Graphics();
    isoBox(gl, x + 0.15, y - 0.02, x + 1.85, y + 0.02, 0.96, 0.62, 0xcfeeff, { ow: 1.4 });
    gl.alpha = 0.55;
    c.addChild(gl);
    // табличка
    isoBox(g, x + 0.6, y + 0.64, x + 1.4, y + 0.68, 0.96, 0.34, shade(def.tone, -0.1), { ow: 1.6 });
  } else {
    // место под будущую стойку: только контур на полу + бледный силуэт
    isoBox(g, x, y, x + 2, y + 0.62, 0, 0.86, def.tone, { ow: 0, sheen: false });
    c.__ghost = true;
    isoRhomb(g, x, y, x + 2, y + 0.62, 0.012, 0, { alpha: 0, ow: 2, oc: 0xffffff, oa: 0.35 });
  }
  c.addChild(g);
  if (c.__ghost) c.alpha = 0.16;
  c.zIndex = depth(x + 1, y + 0.62);
  items.addChild(c);
  return c;
}

/** Банкомат. */
export function buildAtm(def, opened) {
  const c = new Container();
  const g = new Graphics();
  const x = def.x, y = def.y;
  if (opened) {
    isoBox(g, x, y, x + 0.72, y + 0.6, 0, 1.45, def.tone);
    isoBox(g, x + 0.08, y + 0.6, x + 0.64, y + 0.64, 0.85, 0.45, 0x2e3d52, { ow: 1.6 });
    isoBox(g, x + 0.12, y + 0.6, x + 0.6, y + 0.63, 0.92, 0.3, 0x63d2ff, { ow: 1.2 });
  } else {
    isoBox(g, x, y, x + 0.72, y + 0.6, 0, 1.45, def.tone, { ow: 0, sheen: false });
    c.__ghost = true;
    isoRhomb(g, x, y, x + 0.72, y + 0.6, 0.012, 0, { alpha: 0, ow: 2, oc: 0xffffff, oa: 0.35 });
  }
  c.addChild(g);
  if (c.__ghost) c.alpha = 0.16;
  c.zIndex = depth(x + 0.36, y + 0.6);
  items.addChild(c);
  return c;
}

/** Пад на полу: покупка объекта или апгрейд. */
export function buildPad(x, y, w, h, color) {
  const c = new Container();
  const g = new Graphics();
  isoRhomb(g, x, y, x + w, y + h, 0.008, 0x1b2740, { alpha: 0.32 });
  isoRhomb(g, x, y, x + w, y + h, 0.009, 0, { alpha: 0, ow: 3.5, oc: color, oa: 0.95 });
  c.addChild(g);

  const fill = new Graphics();
  c.addChild(fill);

  // стрелка «встань сюда»
  const arrow = new Graphics();
  const cx = x + w / 2, cy = y + h / 2;
  const a = px(cx, cy - 0.2, 0.02), b2 = px(cx - 0.24, cy + 0.08, 0.02), d = px(cx + 0.24, cy + 0.08, 0.02);
  arrow.poly([a.x, a.y, b2.x, b2.y, d.x, d.y]).fill({ color: 0xffffff, alpha: 0.9 });
  c.addChild(arrow);
  c.zIndex = depth(x, y) - 500;      // пады всегда под актёрами
  items.addChild(c);
  Object.assign(c, { __box: { x, y, w, h, color }, __fill: fill, __arrow: arrow, __v: -1, __short: null, __t: 0 });
  return c;
}

/** Заполнение площадки по мере оплаты + состояние «денег не хватает». */
export function setPadFill(pad, ratio, short) {
  if (!pad || (Math.abs(ratio - pad.__v) < 0.02 && pad.__short === short)) return;
  pad.__v = ratio; pad.__short = short;
  const { x, y, w, h, color } = pad.__box;
  const g = pad.__fill;
  g.clear();
  if (short) {
    isoRhomb(g, x, y, x + w, y + h, 0.011, 0xE23A0F, { alpha: 0.3 });
  }
  if (ratio > 0.001) {
    const k = Math.min(1, ratio);
    const iw = w * k, ih = h * k;
    const ox = x + (w - iw) / 2, oy = y + (h - ih) / 2;
    isoRhomb(g, ox, oy, ox + iw, oy + ih, 0.012, color, { alpha: 0.85 });
  }
}

/** Пульсация площадок: под ногами — ярче, чтобы было видно, что она работает. */
export function pulsePads(list, dt, activeId) {
  for (const c of list) {
    c.__t = (c.__t || 0) + dt;
    const active = c.__id && c.__id === activeId;
    const base = active ? 1 : 0.8;
    c.alpha = base + Math.sin(c.__t * (active ? 7 : 3)) * (active ? 0.08 : 0.16);
    if (c.__arrow) c.__arrow.y = -Math.abs(Math.sin(c.__t * (active ? 7 : 3))) * (active ? 7 : 4);
  }
}

/** Стопка наличных: 12 спрайтов создаются один раз и только прячутся/показываются.
 *  Раньше стопка пересобиралась каждый кадр — от этого сцена дёргалась. */
const PILE_MAX = 12;
export function buildCashPile() {
  const c = new Container();
  c.__coins = [];
  for (let i = 0; i < PILE_MAX; i++) {
    const s = new Sprite(tex.coin);
    s.anchor.set(0.5);
    s.scale.set(0.23);
    s.visible = false;
    c.addChild(s);
    c.__coins.push(s);
  }
  c.__n = -1;
  c.__key = '';
  items.addChild(c);
  return c;
}

export function drawCashPile(cont, x, y, z, ratio) {
  const n = ratio <= 0.001 ? 0 : clamp(Math.round(ratio * PILE_MAX), 1, PILE_MAX);
  const key = `${x}|${y}|${z}`;
  if (cont.__n === n && cont.__key === key) return;
  cont.__n = n; cont.__key = key;
  cont.visible = n > 0;
  for (let i = 0; i < PILE_MAX; i++) {
    const s = cont.__coins[i];
    s.visible = i < n;
    if (!s.visible) continue;
    const row = Math.floor(i / 3), col = i % 3;
    const p = px(x + (col - 1) * 0.17, y, z + row * 0.085);
    s.x = p.x; s.y = p.y;
  }
  cont.zIndex = depth(x, y) + 1;
}

// ── Актёры ───────────────────────────────────────────────────────────────────

/** Игрок: Spine-утка. Поворот — зеркалим по направлению движения. */
export function makePlayerView() {
  const c = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 0, 20, 10).fill({ color: 0x000000, alpha: 0.22 });
  c.addChild(shadow);

  let body = null;
  if (tex.duckReady) {
    try {
      body = Spine.from({ skeleton: 'duck-skel', atlas: 'duck-atlas' });
      const b = body.getBounds();
      const want = 78;                        // высота героя на экране
      const k = b.height > 0 ? want / b.height : 0.3;
      body.scale.set(k);
      if (body.skeleton.data.findAnimation('Idle')) body.state.setAnimation(0, 'Idle', true);
      c.addChild(body);
    } catch (e) { console.warn('Spine не создался', e); body = null; }
  }
  if (!body) {                                 // запасной вариант — покадровый спрайт
    body = new Sprite(tex.se0);
    body.anchor.set(0.5, 1);
    body.scale.set(0.34);
    c.addChild(body);
  }
  const load = new Container();
  load.y = -84;
  c.addChild(load);
  c.__load = load;
  c.__loadN = -1;
  c.__body = body;
  c.__isSpine = !!tex.duckReady;
  c.__anim = '';
  items.addChild(c);
  return c;
}

/** Стопка наличных над героем: видно, сколько он несёт. */
export function setCarryStack(view, ratio) {
  const n = ratio <= 0.001 ? 0 : clamp(Math.ceil(ratio * 5), 1, 5);
  if (view.__loadN === n) return;
  view.__loadN = n;
  view.__load.removeChildren();
  for (let i = 0; i < n; i++) {
    const s = new Sprite(tex.coin);
    s.anchor.set(0.5, 0.5);
    s.scale.set(0.24);
    s.x = (i % 2 ? 3 : -3);
    s.y = -i * 7;
    view.__load.addChild(s);
  }
}

/** Клиент или сотрудник: изометрический спрайт человека на 4 направления. */
export function makeCharView(tint = 0) {
  const c = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 0, 14, 7).fill({ color: 0x000000, alpha: 0.2 });
  c.addChild(shadow);
  const s = new Sprite(tex.se0);
  s.anchor.set(0.5, 1);
  s.scale.set(0.3);
  if (tint) s.tint = tint;
  c.addChild(s);
  const ring = new Graphics();
  ring.visible = false;
  c.addChild(ring);
  c.__spr = s;
  c.__ring = ring;
  c.__ringV = -1;
  items.addChild(c);
  return c;
}

/** Кольцо прогресса обслуживания над клиентом. v < 0 — спрятать. */
export function setServeRing(view, v) {
  const g = view.__ring;
  if (!g) return;
  if (v < 0) { g.visible = false; view.__ringV = -1; return; }
  g.visible = true;
  view.__ringV = v;
  g.clear();
  const r = 11, y = -66;
  g.circle(0, y, r + 2.5).fill({ color: 0x1d2b3f, alpha: 0.78 });
  // Дугу обязательно начинаем с moveTo: иначе Pixi тянет линию из начала пути
  // и над клиентом появляется длинная зелёная палка.
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.min(0.999, v);
  g.moveTo(Math.cos(a0) * r, y + Math.sin(a0) * r);
  g.arc(0, y, r, a0, a1);
  g.stroke({ width: 4.5, color: 0x8FE642, cap: 'round' });
}

/** Покачивание NPC — зал не должен выглядеть замершим. */
export function bobChar(view, t, active) {
  const s = view.__spr;
  if (!s) return;
  s.y = active ? -Math.abs(Math.sin(t * 5)) * 3 : -Math.abs(Math.sin(t * 1.6)) * 1.4;
}

export function setCharFrame(view, dir, frame) {
  const t = tex[`${dir}${frame}`];
  if (t && view.__spr.texture !== t) view.__spr.texture = t;
}

export function setPlayerAnim(view, name) {
  if (!view.__isSpine || view.__anim === name) return;
  const b = view.__body;
  if (b?.skeleton?.data?.findAnimation?.(name)) {
    b.state.setAnimation(0, name, true);
    view.__anim = name;
  }
}

/** Скелет утки нарисован смотрящим ВЛЕВО, поэтому положительный масштаб —
 *  это взгляд влево. Чтобы повернуть героя вправо, масштаб инвертируем. */
export function setPlayerFlip(view, faceRight) {
  const b = view.__body;
  if (!b) return;
  const k = Math.abs(b.scale.x);
  b.scale.x = faceRight ? -k : k;
  view.__faceRight = faceRight;
}

/** Лёгкое покачивание на ходу — без него герой «плывёт» по полу. */
export function bobPlayer(view, t, moving) {
  const b = view.__body;
  if (!b) return;
  b.y = moving ? -Math.abs(Math.sin(t * 11)) * 4 : 0;
}

/** Поставить актёра в тайл. */
export function placeActor(view, x, y, z = 0) {
  const p = px(x, y, z);
  view.x = p.x; view.y = p.y;
  view.zIndex = depth(x, y, z);
}

export function removeView(v) { v?.parent?.removeChild(v); v?.destroy?.({ children: true }); }

// ── Камера ───────────────────────────────────────────────────────────────────

const WALL_Z = 2.6;

/** Габариты зала в координатах сцены — по ним считаем масштаб и упор камеры. */
function bounds() {
  return {
    left: px(0, HALL.h).x - 26,
    right: px(HALL.w, 0).x + 26,
    top: px(0, 0, WALL_Z).y - 20,
    bottom: px(HALL.w, HALL.h).y + 26,
  };
}

let viewH = 0;
const insets = { top: 0, bottom: 0 };

export function fitCamera(hudTop = 0, hudBottom = 0) {
  if (!app) return;
  const b = bounds();
  const h = Math.max(120, app.screen.height - hudTop - hudBottom);
  const w = app.screen.width;
  viewH = h;
  // Изометрический зал всегда шире, чем выше (2:1), поэтому в портрет он целиком
  // не влезает — камера ездит за игроком. Масштаб подбираем так, чтобы в кадре
  // было ~7 тайлов по ширине, но зал не оказался мельче экрана по высоте.
  const byWidth = w / (TW * 7);
  const minByHeight = h / (b.bottom - b.top);
  cam.scale = clamp(Math.max(byWidth, minByHeight * 0.92), 0.42, 1.3);
  world.scale.set(cam.scale);
}

export function follow(x, y, hudTop = 0, hudBottom = 0) {
  if (!app) return;
  insets.top = hudTop; insets.bottom = hudBottom;
  if (Math.abs(viewH - (app.screen.height - hudTop - hudBottom)) > 2) fitCamera(hudTop, hudBottom);
  const p = px(x, y, 0);
  const w = app.screen.width, h = app.screen.height;
  const s = cam.scale;
  const b = bounds();

  let tx = w / 2 - p.x * s;
  let ty = hudTop + (h - hudTop - hudBottom) / 2 - p.y * s;

  // не пускаем камеру за края зала
  const roomW = (b.right - b.left) * s;
  if (roomW <= w) tx = (w - roomW) / 2 - b.left * s;
  else tx = clamp(tx, w - b.right * s, -b.left * s);

  const roomH = (b.bottom - b.top) * s;
  const viewTop = hudTop, viewBot = h - hudBottom;
  if (roomH <= viewBot - viewTop) ty = viewTop + ((viewBot - viewTop) - roomH) / 2 - b.top * s;
  else ty = clamp(ty, viewBot - b.bottom * s, viewTop - b.top * s);

  cam.x += (tx - cam.x) * 0.22;
  cam.y += (ty - cam.y) * 0.22;
  world.x = Math.round(cam.x + fx.shake.x);
  world.y = Math.round(cam.y + fx.shake.y);
}

/** Экранная позиция тайла — нужна DOM-подсказкам над падами. */
export function screenOf(x, y, z = 0) {
  const p = px(x, y, z);
  return { x: world.x + p.x * cam.scale, y: world.y + p.y * cam.scale };
}

export function sortItems() { items.sortChildren(); }
