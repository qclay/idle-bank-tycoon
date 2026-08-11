// Изометрическая сцена банка на PixiJS.
// Арт собирается из изометрических примитивов (как в iso.js фермы): у коробки
// три грани — верх светлее, левая средняя, правая тёмная, всё с тёмным контуром.

// spine-pixi должен импортироваться ДО создания рендерера, иначе его render-pipe
// не регистрируется и Spine на сцене падает с validateRenderable.
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

import { TW, TH, ZU, px, depth, shade, clamp } from './core.js';
import * as fx from './fx.js';
import { HALL, VAULT, COUNTERS, ATMS, ZONES, STREET, DOOR, DISTRICT, ROOMS, WALLS, WALL_T, DOORWAYS } from './balance.js';
import { ISO } from './iso-meta.js';

export const INK = 0x3f2b18;

let app = null;
export let world = null;      // контейнер мира (двигается камерой)
let ground = null;            // статичный пол и улица
let shell = null;             // внешние стены: всегда за предметами, но перед улицей
let items = null;             // объекты и актёры, сортируются по глубине
let fxLayer = null;           // эффекты поверх
export const cam = { x: 0, y: 0, scale: 1 };
const tex = {};

export function getApp() { return app; }

/** Порядок слоёв мира: пол → внешние стены → предметы → эффекты. */
export function layers() {
  return { ground: world.getChildIndex(ground), shell: world.getChildIndex(shell),
           items: world.getChildIndex(items), fx: world.getChildIndex(fxLayer) };
}

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

let backdrop = null;
function drawBackdropNow() { if (backdrop) drawBackdrop(backdrop); }

/** Комната под точкой — камере нужно знать её границы. */
function roomOf(x, y) {
  for (const r of ROOMS) if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
  return null;
}

// ── Запуск ───────────────────────────────────────────────────────────────────

export async function initScene(host, onProgress = () => {}) {
  app = new Application();
  // Телефон греется не от нашей математики, а от рисования: чем больше
  // физических пикселей и чем чаще кадры, тем горячее. Поэтому пиксель
  // ограничиваем, сглаживание включаем только там, где точки крупные (на
  // плотном экране MSAA всё равно не видно, а стоит дорого), и просим у
  // системы экономичный режим GPU.
  const dpr = window.devicePixelRatio || 1;
  const res = Math.min(dpr, 2);
  await app.init({
    background: 0x171029,
    antialias: res < 1.75,
    resolution: res,
    autoDensity: true,
    resizeTo: host,
    preference: 'webgl',
    powerPreference: 'low-power',
    clearBeforeRender: true,
  });
  host.appendChild(app.canvas);
  initQuality();

  onProgress(0.15);
  await loadTextures(onProgress);

  const back = new Graphics();
  app.stage.addChild(back);
  backdrop = back;
  drawBackdrop(back);
  app.renderer.on('resize', () => drawBackdrop(back));

  world = new Container();
  ground = new Container();
  shell = new Container();          // внешние стены здания
  items = new Container();
  items.sortableChildren = true;
  fxLayer = new Container();
  world.addChild(ground, shell, items, fxLayer);
  app.stage.addChild(world);

  buildGround();
  buildWalls();
  buildDark();
  fx.initFx(fxLayer, document.getElementById('worldUI'), tex.coin, screenOf);
  buildTraffic();
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
    // изометрические текстуры от художника; метрика — в assets/iso/meta.json
    isoFloor: './assets/iso/floor.png',
    isoWallF: './assets/iso/wall-front.png',
    isoWallS: './assets/iso/wall-side.png',
    isoCounter: './assets/iso/counter.png',
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
  g.rect(0, 0, w, h).fill(0x171029);
  // мягкое пятно света по центру — зал не висит в пустоте
  const steps = 7;
  for (let i = steps; i > 0; i--) {
    const k = i / steps;
    g.ellipse(w / 2, h * 0.48, w * 0.95 * k, h * 0.62 * k)
      .fill({ color: 0x3B1E7A, alpha: 0.15 });
  }
}

// ── Пол, стены, декор ────────────────────────────────────────────────────────

// Пол — самый тихий и самый тёмный слой сцены, мебель — самый светлый и
// насыщенный. Раньше всё лежало в одном диапазоне светлоты, глазу было не за
// что зацепиться, и картинка читалась как каша.
const FLOOR_A = 0xC9C0DC;      // плитка: средняя по светлоте, приглушённая
const FLOOR_B = 0xC1B7D6;
const CARPET = 0x8B5CF6;       // фирменная дорожка к стойкам
const WALL = 0xE8E2F2;         // дальние стены — фон, не герой
const SHELF = 0xA895CC;        // стеллажи
const PARCEL = [0xF4A261, 0xE9C46A, 0x8ECae6, 0xB5E48C, 0xF2A6C2, 0xC7B9F5];

/** Пол из текстуры: плита 8×8 тайлов, разложенная по всему залу и обрезанная
 *  по его границам. Рисованную клетку оставляем запасным вариантом — если
 *  текстура не загрузилась, зал не должен исчезнуть. */
function buildFloor() {
  const TILE = ISO.floor?.tiles || 8;          // сколько тайлов покрывает кусок
  const box = new Container();
  const src = tex.isoFloor;
  // По ширине и по высоте масштабируем отдельно: у картинки пропорция 1.977
  // вместо ровно 2, и при едином масштабе плиты расходились бы с сеткой на
  // несколько пикселей к дальнему краю.
  const kx = (TILE * TW) / src.width;
  const ky = (TILE * TH) / src.height;
  for (let y = 0; y < HALL.h; y += TILE) {
    for (let x = 0; x < HALL.w; x += TILE) {
      const sp = new Sprite(src);
      sp.anchor.set(0.5, 0);                  // верхняя вершина ромба
      sp.scale.set(kx, ky);
      const p = px(x, y, 0);
      sp.x = p.x; sp.y = p.y;
      box.addChild(sp);
    }
  }
  // обрезаем по контуру зала: плиты кладём с запасом, наружу торчать нечему
  const m = new Graphics();
  isoRhomb(m, 0, 0, HALL.w, HALL.h, 0, 0xffffff);
  box.addChild(m);
  box.mask = m;
  ground.addChild(box);
  return box;
}

function buildGround() {
  const g = new Graphics();

  if (tex.isoFloor && tex.isoFloor !== Texture.EMPTY) buildFloor();
  else {
    for (const r of ROOMS) {
      for (let y = Math.floor(r.y0); y < r.y1; y++) {
        for (let x = Math.floor(r.x0); x < r.x1; x++) {
          const c = (x + y) % 2 ? r.floor : shade(r.floor, -0.045);
          isoRhomb(g, x, y, x + 1, y + 1, 0, c);
        }
      }
    }
  }
  // Оттенок помещения поверх текстуры: комнаты должны различаться, но плитка
  // остаётся общей — так пол выглядит цельным, а не сшитым из кусков.
  for (const r of ROOMS) {
    isoRhomb(g, r.x0, r.y0, r.x1, r.y1, 0.0005, r.floor, { alpha: 0.3 });
    isoRhomb(g, r.x0, r.y0, r.x1, r.y1, 0.001, 0, { alpha: 0, ow: 1.6, oc: 0x8c7fb0, oa: 0.3 });
  }

  // фирменная дорожка: от входа через торговый зал к проёму в пункт выдачи
  isoRhomb(g, 11.1, 6.2, 13.1, 14.6, 0.002, CARPET, { alpha: 0.42 });
  isoRhomb(g, 5.2, 3.4, 18.6, 4.8, 0.002, CARPET, { alpha: 0.42 });
  isoRhomb(g, 11.1, 6.2, 13.1, 14.6, 0.003, 0, { alpha: 0, ow: 2, oc: 0x5B21B6, oa: 0.36 });
  isoRhomb(g, 5.2, 3.4, 18.6, 4.8, 0.003, 0, { alpha: 0, ow: 2, oc: 0x5B21B6, oa: 0.36 });

  // порожки в проёмах — глазу нужна подсказка, где проход
  for (const d of DOORWAYS) {
    const vertical = isVerticalDoor(d);
    if (vertical) isoRhomb(g, d.x - 0.16, d.y - d.w / 2, d.x + 0.16, d.y + d.w / 2, 0.004, 0xC4B5FD, { alpha: 0.8 });
    else isoRhomb(g, d.x - d.w / 2, d.y - 0.16, d.x + d.w / 2, d.y + 0.16, 0.004, 0xC4B5FD, { alpha: 0.8 });
  }

  // контур пола
  isoRhomb(g, 0, 0, HALL.w, HALL.h, 0.004, 0x000000, { alpha: 0, ow: 2.5, oc: 0x6b5a44, oa: 0.35 });

  // Задние стены: если текстуры есть — кладём их, иначе рисуем как раньше.
  if (!buildOuterWalls()) {
    isoBox(g, 0, -0.34, HALL.w, 0, 0, 2.6, WALL, { top: 0xE7E1F5, right: 0xCFC7E4, left: shade(WALL, -0.04), sheen: false });
    isoBox(g, -0.34, 0, 0, HALL.h, 0, 2.6, WALL, { top: 0xE7E1F5, right: 0xCFC7E4, left: shade(WALL, -0.04), sheen: false });
    isoBox(g, -0.34, -0.34, HALL.w, 0, 2.6, 0.3, 0x7C3AED, { sheen: false });
    isoBox(g, -0.34, 0, 0, HALL.h, 2.6, 0.3, 0x7C3AED, { sheen: false });
    isoBox(g, 0, -0.34, HALL.w, 0, 0, 0.14, 0x7C3AED);
    isoBox(g, -0.34, 0, 0, HALL.h, 0, 0.14, 0x7C3AED);
    for (let x = 3.4; x < HALL.w - 1.5; x += 3.4) {
      isoBox(g, x, -0.36, x + 1.7, -0.32, 1.05, 1.15, 0xcfe9ff, { ow: 2 });
    }
    for (let y = 3.4; y < HALL.h - 1.5; y += 3.4) {
      isoBox(g, -0.36, y, -0.32, y + 1.7, 1.05, 1.15, 0xcfe9ff, { ow: 2 });
    }
  }

  // стеллажи с посылками вдоль дальних стен
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rack = (x0, y0, x1, y1, vertical) => {
    isoBox(g, x0, y0, x1, y1, 0, 2.15, SHELF, { sheen: false });
    for (let lvl = 0; lvl < 3; lvl++) {
      const z = 0.5 + lvl * 0.62;
      isoBox(g, x0 - 0.04, y0 - 0.04, x1 + 0.04, y1 + 0.04, z, 0.07, shade(SHELF, -0.3));
      const n = vertical ? Math.round((y1 - y0) / 0.55) : Math.round((x1 - x0) / 0.55);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.22) continue;
        const c = PARCEL[Math.floor(rnd() * PARCEL.length)];
        const s2 = 0.3 + rnd() * 0.1;
        const px0 = vertical ? x0 + 0.08 : x0 + 0.12 + i * 0.55;
        const py0 = vertical ? y0 + 0.12 + i * 0.55 : y0 + 0.08;
        isoBox(g, px0, py0, px0 + (vertical ? 0.34 : s2), py0 + (vertical ? s2 : 0.34), z + 0.07, 0.34 + rnd() * 0.14, c);
      }
    }
  };
  // Стеллажи ставим перед дальней стеной, а не вплотную к ней: иначе они
  // оказываются за текстурной стеной и не видны. Заодно они разбивают
  // сплошную зелёную плоскость, которая иначе занимает треть экрана.
  rack(5.0, 0.55, 9.6, 1.0, false);
  rack(14.4, 0.55, 19.2, 1.0, false);
  rack(0.55, 6.4, 1.0, 10.4, true);

  // Склад: длинные стеллажи в два ряда, между ними проход — есть где потеряться
  // и есть что искать.
  rack(24.5, 1.4, 25.0, 6.2, true);
  rack(26.4, 1.4, 26.9, 6.2, true);
  rack(24.5, 8.6, 25.0, 13.6, true);
  rack(26.4, 8.6, 26.9, 13.6, true);
  // паллеты с товаром у прохода
  for (const [px0, py0] of [[25.3, 7.0], [26.1, 13.9]]) {
    isoBox(g, px0, py0, px0 + 0.9, py0 + 0.9, 0, 0.12, 0x8b7355);
    for (let i = 0; i < 3; i++) {
      const c = PARCEL[(i * 3 + 1) % PARCEL.length];
      isoBox(g, px0 + 0.1, py0 + 0.1, px0 + 0.8, py0 + 0.8, 0.12 + i * 0.3, 0.3, c);
    }
  }

  // Тени от перегородок и мебели на полу: без них изометрия читается как
  // коллаж наклеек, а не как помещение.
  const sh = new Graphics();
  const shadow = (x0, y0, x1, y1, k = 0.5) => {
    const o = k * 0.42;
    isoRhomb(sh, x0 + 0.18, y0 + 0.18, x1 + 0.55, y1 + 0.55, 0.006, 0x2A1F3D, { alpha: 0.16 });
  };
  for (const w of WALLS) {
    const t2 = WALL_T / 2;
    if (w.x != null) shadow(w.x - t2, w.y0, w.x + t2, w.y1);
    else shadow(w.x0, w.y - t2, w.x1, w.y + t2);
  }
  shadow(VAULT.x, VAULT.y, VAULT.x + VAULT.w, VAULT.y + VAULT.h);
  for (const c of COUNTERS) shadow(c.x, c.y, c.x + 2, c.y + 0.62);
  g.addChild(sh);

  // Торговый зал не должен быть голой плиткой: витрины, зелень и корзины
  // дают глазу опору и делают помещение обжитым.
  // Кадка с шаровидным кустом: три круглых яруса читаются как зелень, а
  // кубики из коробок — как коробки.
  const plant = (x, y, k = 1) => {
    isoCyl(g, x, y, 0.36 * k, 0, 0.4 * k, 0xC98F5A);
    isoCyl(g, x, y, 0.37 * k, 0.4 * k, 0.06 * k, 0xA9743F);
    isoCyl(g, x, y, 0.34 * k, 0.46 * k, 0.34 * k, 0x3F8F4C);
    isoCyl(g, x, y, 0.29 * k, 0.78 * k, 0.3 * k, 0x4FA85C);
    isoCyl(g, x, y, 0.2 * k, 1.06 * k, 0.24 * k, 0x63C46E);
  };
  const basket = (x, y) => {
    for (let i = 0; i < 4; i++) {
      isoBox(g, x, y, x + 0.5, y + 0.42, i * 0.13, 0.16, 0x8B5CF6, { ow: 1.6 });
    }
  };
  // витрины с товаром вдоль левой стены торгового зала
  rack(4.5, 6.8, 5.0, 11.4, true);
  rack(4.5, 12.2, 5.0, 14.4, true);
  // зелень по углам и у прохода
  plant(9.4, 6.9); plant(19.2, 14.1); plant(5.6, 14.2, 0.85); plant(19.2, 6.9, 0.85);
  // корзины у входа
  basket(13.9, 13.6); basket(14.6, 13.6);
  // низкая витрина-остров в центре зала
  isoBox(g, 8.2, 10.2, 10.6, 11.2, 0, 0.62, 0xF3EEFB, { ow: 2, top: 0xFFFFFF });
  for (let i = 0; i < 4; i++) {
    const c2 = PARCEL[i % PARCEL.length];
    isoBox(g, 8.4 + i * 0.55, 10.35, 8.84 + i * 0.55, 10.85, 0.62, 0.34, c2, { ow: 1.6 });
  }

  ground.addChild(g);

  // паллеты с посылками и скамья ожидания — вместо фермерского декора
  const dec = new Graphics();
  const pallet = (x, y) => {
    isoBox(dec, x, y, x + 1.1, y + 1.1, 0, 0.14, 0x8b7355);
    let h2 = 0.14;
    for (let i = 0; i < 3; i++) {
      const w2 = 0.9 - i * 0.12;
      const off = (1.1 - w2) / 2;
      const cc = PARCEL[(i + Math.round(x + y)) % PARCEL.length];
      isoBox(dec, x + off, y + off, x + off + w2, y + off + w2, h2, 0.38, cc);
      h2 += 0.38;
    }
  };
  pallet(0.5, 10.9);
  pallet(16.2, 0.6);
  // скамьи для ожидающих: ножки, сиденье, спинка
  const bench = (x, y) => {
    isoBox(dec, x + 0.06, y + 0.08, x + 0.18, y + 0.2, 0, 0.34, 0x6D28D9);
    isoBox(dec, x + 1.22, y + 0.08, x + 1.34, y + 0.2, 0, 0.34, 0x6D28D9);
    isoBox(dec, x, y, x + 1.4, y + 0.46, 0.34, 0.12, 0xA78BFA);
    isoBox(dec, x, y - 0.04, x + 1.4, y + 0.02, 0.46, 0.46, 0x8B5CF6);
  };
  bench(15.3, 6.5);
  bench(15.3, 9.1);
  ground.addChild(dec);

  buildStreet();

  // входная зона
  const dg = new Graphics();
  isoRhomb(dg, 15.1, 11.5, 17.4, 12.96, 0.006, 0x6f8fb5, { alpha: 0.45, ow: 2, oc: 0x44607f, oa: 0.6 });
  ground.addChild(dg);
}

/** Улица ЗА дальними стенами: тротуар, дорога, фасады напротив.
 *  Именно за стенами — если вынести её вперёд, она закрывает зал. */
function buildStreet() {
  const g = new Graphics();
  const W = HALL.w, H = HALL.h;
  const w1 = STREET.walk, rd = STREET.road, fr = STREET.far;
  const a1 = -w1, a2 = -(w1 + rd), a3 = -(w1 + rd + fr), a4 = a3 - STREET.facade;

  // тротуар у здания
  isoRhomb(g, a4, a1, W + 2, 0, 0, 0xd8d3e6);
  isoRhomb(g, a1, a4, 0, H + 2, 0, 0xd8d3e6);
  // проезжая часть
  isoRhomb(g, a4, a2, W + 2, a1, 0, 0x4a4560);
  isoRhomb(g, a2, a4, a1, H + 2, 0, 0x4a4560);
  // разметка
  for (let x = a3; x < W + 2; x += 2.4) {
    isoRhomb(g, x, a1 - rd / 2 - 0.06, x + 1.2, a1 - rd / 2 + 0.06, 0.002, 0xe8e4f2);
  }
  for (let y = a3; y < H + 2; y += 2.4) {
    isoRhomb(g, a1 - rd / 2 - 0.06, y, a1 - rd / 2 + 0.06, y + 1.2, 0.002, 0xe8e4f2);
  }
  // дальний тротуар
  isoRhomb(g, a4, a3, W + 2, a2, 0, 0xd8d3e6);
  isoRhomb(g, a3, a4, a2, H + 2, 0, 0xd8d3e6);

  // фасады напротив — уходят вверх экрана, зал не загораживают
  const FAC = [0xB9A9D6, 0xA7BEE0, 0xCBB6C6, 0xB6CDBD, 0xD8C3A5];
  let seed = 21;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let x = a3; x < W + 2; x += 3.2) {
    if (x > FOE.x0 - 3.1 && x < FOE.x1) continue;      // здесь стоит конкурент
    const hh = 2.6 + rnd() * 2.6;
    const c = FAC[Math.floor(rnd() * FAC.length)];
    isoBox(g, x, a4, x + 2.8, a3, 0, hh, c, { sheen: false });
    for (let f = 0; f < Math.floor(hh / 1.15); f++) {
      isoBox(g, x + 0.35, a3 - 0.05, x + 2.45, a3 - 0.01, 0.6 + f * 1.15, 0.62, 0xF2EEFA, { ow: 1.2 });
    }
  }
  drawFoe(g, a3, a4);
  for (let y = a3; y < H + 2; y += 3.2) {
    const hh = 2.6 + rnd() * 2.6;
    const c = FAC[Math.floor(rnd() * FAC.length)];
    isoBox(g, a4, y, a3, y + 2.8, 0, hh, c, { sheen: false });
    for (let f = 0; f < Math.floor(hh / 1.15); f++) {
      isoBox(g, a3 - 0.05, y + 0.35, a3 - 0.01, y + 2.45, 0.6 + f * 1.15, 0.62, 0xF2EEFA, { ow: 1.2 });
    }
  }

  // фонари и деревья на ближнем тротуаре
  const lamp = (x, y) => {
    isoBox(g, x, y, x + 0.16, y + 0.16, 0, 2.0, 0x6b6480);
    isoBox(g, x - 0.22, y - 0.22, x + 0.38, y + 0.38, 2.0, 0.16, 0xF6E7A8);
  };
  const tree = (x, y) => {
    isoCyl(g, x, y, 0.14, 0, 0.75, 0x7a5a3c);
    isoCyl(g, x, y, 0.62, 0.7, 0.55, 0x3F8F4A);
    isoCyl(g, x, y, 0.44, 1.2, 0.45, 0x5FA855);
    isoCyl(g, x, y, 0.24, 1.6, 0.34, 0x7BC46A);
  };
  for (let x = 1.4; x < W; x += 4.6) { lamp(x, a1 + 0.5); tree(x + 2.2, a1 + 0.7); }
  for (let y = 1.4; y < H; y += 4.6) { lamp(a1 + 0.5, y); tree(a1 + 0.7, y + 2.2); }

  // тонкий тротуар по всему переднему краю: без него пол обрывается в пустоту
  isoRhomb(g, a1, H, W + 1.4, H + 1.3, 0, 0xd8d3e6);
  isoRhomb(g, W, a1, W + 1.3, H + 1.3, 0, 0xd8d3e6);
  isoBox(g, a1, H, W + 1.4, H + 0.1, 0, 0.1, 0xbfb8d4, { sheen: false });
  isoBox(g, W, a1, W + 0.1, H + 1.3, 0, 0.1, 0xbfb8d4, { sheen: false });

  ground.addChildAt(g, 0);
}

// ── Объекты зала ─────────────────────────────────────────────────────────────

/** Хранилище — толстая дверь-сейф в дальнем углу. */
export function buildVault() {
  const c = new Container();
  const g = new Graphics();
  const { x, y, w, h } = VAULT;
  // тумба кассы
  isoBox(g, x, y, x + w, y + h, 0, 0.9, 0x7C3AED);
  isoBox(g, x - 0.07, y - 0.07, x + w + 0.07, y + h + 0.07, 0.9, 0.12, 0xF3F0FA);
  // задняя стенка с логотипом-полосой
  // Спинка кассы была выше человека вдвое и забирала весь угол — опускаем.
  isoBox(g, x, y - 0.02, x + w, y + 0.02, 1.02, 0.86, 0xEDE9FE, { sheen: false });
  isoBox(g, x + 0.1, y - 0.04, x + w - 0.1, y - 0.01, 1.7, 0.26, 0x7C3AED);
  // монитор и терминал на столешнице
  isoBox(g, x + 0.25, y + 0.55, x + 0.95, y + 0.62, 1.07, 0.5, 0x2A2140);
  isoBox(g, x + 1.5, y + 0.6, x + 1.9, y + 0.95, 1.07, 0.22, 0x4C1D95);
  c.addChild(g);

  // денежный поддон, куда сдают выручку
  const tray = new Graphics();
  isoRhomb(tray, x + 0.2, y + h + 0.35, x + w - 0.2, y + h + 1.15, 0.012, 0x8B5CF6, { alpha: 0.35 });
  isoRhomb(tray, x + 0.2, y + h + 0.35, x + w - 0.2, y + h + 1.15, 0.013, 0,
    { alpha: 0, ow: 3, oc: 0x7C3AED, oa: 0.9 });
  c.addChild(tray);
  c.zIndex = depth(x + w / 2, y + h);
  items.addChild(c);
  return c;
}

/** Стойка: тумба + столешница + стеклянный экран + лоток для налички. */
// Стойка занимает два тайла вдоль оси x. Текстура нарисована ровно на эту
// длину, поэтому масштаб считается от неё, а не подбирается на глаз.
const COUNTER_TILES = 2;

export function buildCounter(def, opened) {
  const c = new Container();
  const g = new Graphics();
  const x = def.x, y = def.y;
  if (opened && tex.isoCounter && tex.isoCounter !== Texture.EMPTY) {
    const src = tex.isoCounter;
    // ширину картинки приравниваем к экранной ширине участка: два тайла вдоль
    // оси плюс один вглубь
    const want = (COUNTER_TILES + 1) * (TW / 2);
    const sp = new Sprite(src);
    sp.scale.set(want / src.width);
    sp.anchor.set(0.5, 1);
    sp.x = (px(x, y + 1).x + px(x + COUNTER_TILES, y).x) / 2;
    sp.y = px(x + COUNTER_TILES, y + 1, 0).y;
    // тень под стойкой, иначе она висит над полом
    const sh = new Graphics();
    isoRhomb(sh, x - 0.1, y - 0.1, x + COUNTER_TILES + 0.35, y + 1.05, 0.004, 0x2A1F3D, { alpha: 0.18 });
    c.addChild(sh, sp);
    // Глубина — по середине переднего края. Резать стойку на тайлы было хуже:
    // формально точнее, но человек, стоящий по центру перед ней, попадал за её
    // дальнюю половину и выглядел разрезанным.
    c.zIndex = depth(x + 1, y + 0.62);
    items.addChild(c);
    return c;
  }
  if (opened) {
    // тумба + белая столешница
    isoBox(g, x, y, x + 2, y + 0.62, 0, 0.86, def.tone);
    isoBox(g, x - 0.08, y - 0.08, x + 2.08, y + 0.7, 0.86, 0.1, 0xFBFAFF);
    // монитор и сканер на столе
    isoBox(g, x + 0.25, y + 0.12, x + 0.75, y + 0.18, 0.96, 0.42, 0x2A2140);
    isoBox(g, x + 1.45, y + 0.2, x + 1.75, y + 0.5, 0.96, 0.16, shade(def.tone, -0.3));
    // номер стойки на фронтальной грани
    isoBox(g, x + 0.7, y + 0.62, x + 1.3, y + 0.66, 0.28, 0.3, 0xFBFAFF, { ow: 1.4 });
    // короб с готовыми заказами рядом
    isoBox(g, x + 2.12, y + 0.05, x + 2.62, y + 0.55, 0, 0.42, 0xE9C46A);
    isoBox(g, x + 2.12, y + 0.05, x + 2.62, y + 0.55, 0.42, 0.36, 0xF4A261);
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
    // Постамат чуть выше человека, а не вдвое: 1.32 против прежних 2.05.
    isoBox(g, x, y, x + 0.8, y + 0.66, 0, 1.32, def.tone);
    // сетка ячеек на фронтальной грани
    for (let r = 0; r < 4; r++) {
      for (let cc = 0; cc < 2; cc++) {
        const zz = 0.1 + r * 0.3;
        const xx = x + 0.06 + cc * 0.36;
        isoBox(g, xx, y + 0.66, xx + 0.3, y + 0.69, zz, 0.3, shade(def.tone, 0.3), { ow: 1.2 });
      }
    }
    // экран сверху
    isoBox(g, x + 0.12, y + 0.66, x + 0.68, y + 0.7, 1.02, 0.22, 0x2A2140, { ow: 1.2 });
    isoBox(g, x + 0.16, y + 0.66, x + 0.64, y + 0.69, 1.05, 0.15, 0x67E8F9, { ow: 1 });
  } else {
    isoBox(g, x, y, x + 0.8, y + 0.66, 0, 2.05, def.tone, { ow: 0, sheen: false });
    c.__ghost = true;
    isoRhomb(g, x, y, x + 0.8, y + 0.66, 0.012, 0, { alpha: 0, ow: 2, oc: 0xffffff, oa: 0.35 });
  }
  c.addChild(g);
  if (c.__ghost) c.alpha = 0.16;
  c.zIndex = depth(x + 0.4, y + 0.66);
  items.addChild(c);
  return c;
}

/** Зона пункта: у каждой свой узнаваемый силуэт. */
export function buildZone(def, opened) {
  const c = new Container();
  const g = new Graphics();
  const x = def.x, y = def.y;
  if (!opened) {
    isoBox(g, x, y, x + 2.2, y + 1.2, 0, 1.2, def.tone, { ow: 0, sheen: false });
    c.addChild(g);
    c.alpha = 0.16;
    c.zIndex = depth(x + 1.1, y + 1.2);
    items.addChild(c);
    return c;
  }
  if (def.effect === 'spawn') {              // кофе-точка
    isoBox(g, x, y, x + 2.2, y + 0.8, 0, 0.9, def.tone);
    isoBox(g, x - 0.06, y - 0.06, x + 2.26, y + 0.86, 0.9, 0.1, 0xFBFAFF);
    isoBox(g, x + 0.2, y + 0.1, x + 0.7, y + 0.6, 1.0, 0.62, 0x5B4636);
    isoBox(g, x + 1.1, y + 0.2, x + 1.4, y + 0.5, 1.0, 0.3, 0xE9C46A);
    isoBox(g, x + 1.6, y + 0.2, x + 1.9, y + 0.5, 1.0, 0.3, 0xF4A261);
    isoBox(g, x + 0.5, y + 1.0, x + 1.7, y + 1.2, 0, 0.72, 0xC7B9F5);  // столик
  } else if (def.effect === 'pay') {         // примерочные
    for (let i = 0; i < 2; i++) {
      const cx = x + i * 1.15;
      isoBox(g, cx, y, cx + 1.0, y + 1.15, 0, 2.1, 0xF2EEFA, { sheen: false });
      isoBox(g, cx + 0.08, y + 1.15, cx + 0.92, y + 1.19, 0.1, 1.85, def.tone, { ow: 1.4 });
      isoBox(g, cx, y, cx + 1.0, y + 1.15, 2.1, 0.1, def.tone);
    }
  } else if (def.effect === 'speed') {       // сортировочный стол с коробками
    isoBox(g, x, y, x + 2.2, y + 1.0, 0, 0.8, 0x9C96B8);
    isoBox(g, x - 0.05, y - 0.05, x + 2.25, y + 1.05, 0.8, 0.1, def.tone);
    for (let i = 0; i < 4; i++) {
      const cc = PARCEL[i % PARCEL.length];
      isoBox(g, x + 0.15 + i * 0.5, y + 0.25, x + 0.55 + i * 0.5, y + 0.7, 0.9, 0.4, cc);
    }
  } else {                                    // погрузка: ворота и паллеты
    isoBox(g, x, y, x + 0.16, y + 1.4, 0, 2.4, 0x6B6390);
    isoBox(g, x + 2.0, y, x + 2.16, y + 1.4, 0, 2.4, 0x6B6390);
    isoBox(g, x, y, x + 2.16, y + 0.16, 2.2, 0.4, def.tone);
    isoBox(g, x + 0.3, y + 0.3, x + 1.9, y + 1.2, 0, 0.16, 0x8b7355);
    isoBox(g, x + 0.45, y + 0.45, x + 1.2, y + 1.05, 0.16, 0.5, PARCEL[2]);
    isoBox(g, x + 1.25, y + 0.5, x + 1.8, y + 1.0, 0.16, 0.38, PARCEL[0]);
  }
  c.addChild(g);
  c.zIndex = depth(x + 1.1, y + 1.2);
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

/** Пункт конкурента напротив: вывеска, витрина, вход и фургон. */
export const FOE = { x0: -5.2, x1: 0.8, door: { x: -2.2, y: 0 } };

function drawFoe(g, a3, a4) {
  const x0 = FOE.x0, x1 = FOE.x1;
  FOE.door.y = a3;
  const brand = 0xE24A6A;
  // корпус
  isoBox(g, x0, a4, x1, a3, 0, 3.8, 0xEDE7F5, { sheen: false });
  // цоколь и витрина
  isoBox(g, x0, a3 - 0.06, x1, a3 - 0.02, 0.2, 1.9, 0xBFE4F5, { ow: 1.6 });
  // вход
  isoBox(g, x0 + 2.6, a3 - 0.08, x0 + 4.0, a3 - 0.02, 0.0, 1.9, brand, { ow: 1.6 });
  // козырёк и вывеска
  isoBox(g, x0 - 0.2, a3 - 0.5, x1 + 0.2, a3 - 0.02, 2.3, 0.22, brand);
  isoBox(g, x0 + 0.4, a3 - 0.1, x1 - 0.4, a3 - 0.04, 2.7, 1.05, brand, { ow: 1.8 });
  // «буквы» на вывеске
  for (let i = 0; i < 7; i++) {
    const bx = x0 + 0.9 + i * 0.62;
    isoBox(g, bx, a3 - 0.12, bx + 0.34, a3 - 0.08, 3.0, 0.5, 0xFFFFFF);
  }
  // окна верхних этажей
  for (let f = 0; f < 2; f++) {
    for (let i = 0; i < 4; i++) {
      const bx = x0 + 0.5 + i * 1.45;
      isoBox(g, bx, a3 - 0.05, bx + 1.0, a3 - 0.01, 3.9 + f * 0, 0, 0xF2EEFA, { ow: 1 });
    }
  }
  // фургон у входа
  const vx = x1 + 0.4, vy = a3 + 0.7;
  isoBox(g, vx, vy, vx + 2.2, vy + 0.9, 0.02, 0.5, 0xF1F1F6);
  isoBox(g, vx + 0.1, vy + 0.1, vx + 1.3, vy + 0.8, 0.52, 0.75, 0xFBFBFF);
  isoBox(g, vx + 1.4, vy + 0.12, vx + 2.1, vy + 0.78, 0.52, 0.5, brand);
  isoCyl(g, vx + 0.5, vy + 0.9, 0.2, 0, 0.16, 0x2A2140);
  isoCyl(g, vx + 1.8, vy + 0.9, 0.2, 0, 0.16, 0x2A2140);
}

// ── Уличное движение ─────────────────────────────────────────────────────────

const traffic = [];

/** Прохожие и клиенты конкурента — улица должна жить. Машин нет намеренно:
 *  на карте и так плотно, они забирали внимание у зала. */
function buildTraffic() {
  // клиенты конкурента: идут по дальнему тротуару и заходят к нему
  for (let i = 0; i < 5; i++) {
    traffic.push({
      view: makeCharView(0xE9D5E8), kind: 'foe', t: i * 3.4, span: 18,
      speed: 0.85 + (i % 3) * 0.2, ft: 0,
    });
  }

  // прохожие по ближнему тротуару
  for (let i = 0; i < 6; i++) {
    const vertical = i % 2 === 1;
    const view = makeCharView(0xffffff);
    const span = vertical ? HALL.h + 4 : HALL.w + 4;
    traffic.push({
      view, kind: 'ped', vertical, t: (i / 6) * span, span,
      speed: 0.9 + (i % 3) * 0.25, dir: i % 4 < 2 ? 1 : -1,
      off: -(STREET.walk * (0.3 + (i % 2) * 0.4)),
      ft: 0,
    });
  }
}

export function tickTraffic(dt) {
  for (const t of traffic) {
    t.t += t.speed * dt;
    if (t.t > t.span + 4) t.t -= t.span + 8;
    let x, y;
    if (t.kind === 'foe') {
      // идут вдоль дальнего тротуара к двери конкурента и «заходят»
      const lane = -(STREET.walk + STREET.road + STREET.far * 0.5);
      const goal = FOE.door.x;
      const start = goal + 9;
      const x = start - t.t;
      t.ft += dt * 7;
      setCharFrame(t.view, 'sw', Math.floor(t.ft) % 4);
      const near = Math.max(0, Math.min(1, (x - goal) / 1.4));
      t.view.alpha = near;
      placeActor(t.view, Math.max(goal, x), lane);
      if (x < goal - 0.5) t.t = -Math.random() * 4;
    } else {
      const p0 = t.dir > 0 ? t.t - 2 : t.span - t.t;
      if (t.vertical) { x = t.off; y = p0; } else { x = p0; y = t.off; }
      t.ft += dt * 7;
      const dir = t.vertical ? (t.dir > 0 ? 'se' : 'nw') : (t.dir > 0 ? 'se' : 'nw');
      setCharFrame(t.view, dir, Math.floor(t.ft) % 4);
      placeActor(t.view, x, y);
    }
  }
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
      // Рост героя задаём от клиента, а не от балды: клиент на экране ~69 px,
      // и утка не должна быть выше человека на треть — иначе зал выглядит
      // разномасштабным.
      const want = 66;
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

// ── Внутренние перегородки ───────────────────────────────────────────────────
// Стена длиной в полкомнаты не может иметь одну глубину: актёр у её дальнего
// конца должен быть за ней, у ближнего — перед ней. Поэтому каждую стену
// режем на куски по тайлу и сортируем поштучно.

// Перегородки — это фон. Раньше они были самым ярким объектом кадра: длинные
// белые панели с насыщенным фиолетовым кантом сверху и снизу. Их на экране
// больше, чем всего остального, и внимание забирала пустая стена.
// Перегородки держим в тон текстурным стенам: мятный корпус, светлый кант.
const PART = 0xCFE3CE;
const PART_TOP = 0xE8F3E7;
const PART_H = 1.15;            // ниже: комнаты читаются, обзор не режется

function buildWalls() {
  const t = WALL_T / 2;
  for (const w of WALLS) {
    const vertical = w.x != null;
    const from = vertical ? w.y0 : w.x0;
    const to = vertical ? w.y1 : w.x1;
    for (let a = from; a < to - 1e-6; a += 1) {
      const b = Math.min(a + 1, to);
      const g = new Graphics();
      const x0 = vertical ? w.x - t : a;
      const x1 = vertical ? w.x + t : b;
      const y0 = vertical ? a : w.y - t;
      const y1 = vertical ? b : w.y + t;
      isoBox(g, x0, y0, x1, y1, 0, PART_H, PART,
             { top: shade(PART, 0.1), right: shade(PART, -0.18), left: shade(PART, -0.05),
               ow: 1.4, sheen: false });
      isoBox(g, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, PART_H, 0.07, PART_TOP,
             { ow: 1.4, sheen: false });
      const c = new Container();
      c.addChild(g);
      c.zIndex = depth(x1, y1, 0);
      items.addChild(c);
    }
  }
  // Косяки по краям проёмов: без них перегородка обрывается в воздухе.
  for (const d of DOORWAYS) {
    const vertical = isVerticalDoor(d);
    for (const sgn of [-1, 1]) {
      const g = new Graphics();
      const cx = vertical ? d.x : d.x + sgn * (d.w / 2 + 0.09);
      const cy = vertical ? d.y + sgn * (d.w / 2 + 0.09) : d.y;
      isoBox(g, cx - 0.13, cy - 0.13, cx + 0.13, cy + 0.13, 0, PART_H + 0.2, 0x7C3AED, { sheen: false });
      const c = new Container();
      c.addChild(g);
      c.zIndex = depth(cx + 0.14, cy + 0.14, 0);
      items.addChild(c);
    }
  }
}

// ── Темнота на складе ────────────────────────────────────────────────────────
// Свет на складе не горит: снаружи видно только силуэты. Зашёл — лампы
// включились, и стало ясно, кто ищет товар, а кто листает ленту.

// Затемнения соседних комнат больше нет: оно давило и мешало смотреть на зал.
// Осталась только темнота склада — на ней держится вся проверка сотрудников:
// снаружи не должно быть видно, ищет оператор товар или залип в телефоне.
const veils = new Map();
const VEIL_NEAR = 0.0;          // своя комната
const VEIL_FAR = 0.0;           // соседние помещения не приглушаем
const VEIL_DARK = 0.82;         // склад, пока в него не зашли

export function buildDark() {
  for (const r of ROOMS) {
    const g = new Graphics();
    isoRhomb(g, r.x0, r.y0, r.x1, r.y1, 0.02, 0x140F22, { alpha: 1 });
    const c = new Container();
    c.addChild(g);
    c.alpha = r.dark ? VEIL_DARK : VEIL_FAR;
    c.zIndex = 1e6;                     // поверх пола и мебели, под интерфейсом
    items.addChild(c);
    veils.set(r.id, c);
  }
}

/** Где сейчас игрок: его комнату открываем, остальные притеняем. */
export function litRoom(id, dt = 0.016) {
  for (const r of ROOMS) {
    const v = veils.get(r.id);
    if (!v) continue;
    const want = r.id === id ? VEIL_NEAR : (r.dark ? VEIL_DARK : VEIL_FAR);
    v.alpha += (want - v.alpha) * Math.min(1, dt * 5);
    if (Math.abs(want - v.alpha) < 0.004) v.alpha = want;
  }
}

/** Насколько притенено помещение — этим пользуются тесты. */
export function veilOf(id) { return veils.get(id)?.alpha ?? 0; }

/** Насколько сейчас темно на складе — этим пользуются тесты. */
export function darkAlpha() {
  const r = ROOMS.find((x) => x.dark);
  return r ? (veils.get(r.id)?.alpha ?? 0) : 0;
}

/** Задние стены из текстуры. Панель нарисована на восемь тайлов, поэтому режем
 *  её на вертикальные полосы по тайлу: каждая полоса — ровно один шаг сетки,
 *  и складываются они обратно в целую стену без единого шва. Заодно каждая
 *  полоса получает свою глубину, и актёры правильно заходят за стену. */
function wallSlices(metaKey, texKey, count, mirror, place) {
  const m = ISO[metaKey];
  const src = tex[texKey];
  if (!m || !src || src === Texture.EMPTY) return false;
  const sliceW = m.w / m.tiles;
  const k = (TW / 2) / sliceW;                 // одна полоса — один тайл вдоль оси
  const drop = sliceW / 2;                     // на столько опускается кромка за тайл
  for (let i = 0; i < count; i++) {
    // Крайние полосы панели — это её торцы. Внутри стены они не нужны, иначе
    // каждые восемь тайлов на ровной стене появлялся бы шов; торцы ставим
    // только по концам всей стены.
    const idx = i === 0 ? 0
      : i === count - 1 ? m.tiles - 1
      : 1 + ((i - 1) % Math.max(1, m.tiles - 2));
    // У боковой панели начало стены — правый край картинки, поэтому полосы
    // берём справа налево. Раньше они брались слева, и стена рассыпалась на
    // висящие в воздухе куски.
    const fx = mirror ? m.w - (idx + 1) * sliceW : idx * sliceW;
    const frame = new Rectangle(fx, 0, sliceW, m.h);
    const t = new Texture({ source: src.source, frame });
    const sp = new Sprite(t);
    sp.scale.set(k);
    const z = place(sp, i, m, idx, drop);
    const c = new Container();
    c.addChild(sp);
    c.zIndex = z;
    // Стены здания стоят по краю карты, и зайти за них некому: игрок и клиенты
    // прижаты к 0.4. Поэтому им место в отдельном слое — иначе прохожие с
    // улицы, у которых глубина больше, рисовались поверх стены.
    shell.addChild(c);
  }
  return true;
}

function buildOuterWalls() {
  const f = ISO['wall-front'], sd = ISO['wall-side'];
  if (!f || !sd) return false;
  // стена вдоль оси x (дальняя, «фронт»)
  const okF = wallSlices('wall-front', 'isoWallF', HALL.w, false, (sp, i, m, idx, drop) => {
    sp.anchor.set(0, (m.leftBase * m.h + idx * drop) / m.h);
    const p = px(i, 0, 0);
    sp.x = p.x; sp.y = p.y;
    return depth(i + 1, 0.02);
  });
  // стена вдоль оси y (левая, «бок»)
  const okS = wallSlices('wall-side', 'isoWallS', HALL.h, true, (sp, i, m, idx, drop) => {
    sp.anchor.set(1, (m.rightBase * m.h + idx * drop) / m.h);
    const p = px(0, i, 0);
    sp.x = p.x; sp.y = p.y;
    return depth(0.02, i + 1);
  });
  return okF && okS;
}

function isVerticalDoor(d) {
  const a = ROOMS.find((r) => r.id === d.a), b = ROOMS.find((r) => r.id === d.b);
  return Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(b.x1 - a.x0) < 1e-6;
}

/** Клиент или сотрудник: изометрический спрайт человека на 4 направления. */
export function makeCharView(tint = 0, size = 1) {
  const c = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 0, 14 * size, 7 * size).fill({ color: 0x000000, alpha: 0.24 });
  c.addChild(shadow);
  const s = new Sprite(tex.se0);
  s.anchor.set(0.5, 1);
  s.scale.set(0.3 * size);
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

/** Напарник в зале — та же утка, но с фирменной подсветкой под ногами,
 *  чтобы своего героя было ни с кем не спутать. */
export function makeRemoteView() {
  const c = makePlayerView();
  const ring = new Graphics();
  ring.ellipse(0, 0, 21, 10.5).fill({ color: 0x7C3AED, alpha: 0.32 });
  ring.ellipse(0, 0, 21, 10.5).stroke({ width: 2.4, color: 0xA78BFA, alpha: 0.95 });
  c.addChildAt(ring, 1);
  return c;
}

/** Значок настроения над клиентом: недовольство видно издалека. */
export function setMood(view, kind) {
  if (!view) return;
  if (view.__moodK === kind) return;         // тот же значок — не пересобираем
  view.__moodK = kind;
  if (view.__mood) { view.removeChild(view.__mood); view.__mood.destroy(); view.__mood = null; }
  if (!kind) return;
  const g = new Graphics();
  const y = -74, r = 13;
  const bg = kind === 'bad' ? 0xE24A6A : kind === 'meh' ? 0xF59E0B : 0x22C55E;
  g.roundRect(-r - 3, y - r - 3, (r + 3) * 2, (r + 3) * 2, 9).fill({ color: 0xFFFFFF, alpha: 0.95 });
  g.roundRect(-r - 3, y - r - 3, (r + 3) * 2, (r + 3) * 2, 9).stroke({ width: 2.4, color: bg });
  g.poly([-4, y + r + 3, 4, y + r + 3, 0, y + r + 10]).fill(0xFFFFFF);
  g.circle(-5, y - 4, 2.2).fill(bg);
  g.circle(5, y - 4, 2.2).fill(bg);
  if (kind === 'bad') {
    g.moveTo(-6, y + 7); g.arc(0, y + 12, 7, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke({ width: 2.6, color: bg, cap: 'round' });
  } else if (kind === 'meh') {
    g.moveTo(-6, y + 7); g.lineTo(6, y + 7);
    g.stroke({ width: 2.6, color: bg, cap: 'round' });
  } else {
    g.moveTo(-6, y + 3); g.arc(0, y - 2, 7, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke({ width: 2.6, color: bg, cap: 'round' });
  }
  view.addChild(g);
  view.__mood = g;
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

// ── Нагрев и расход батареи ──────────────────────────────────────────────────
// Кадры и плотность пикселя — единственные две ручки, которые реально меняют
// температуру телефона. Держим их под контролем и сами убавляем, если
// устройство не тянет.

const quality = { fps: 60, scale: 1, base: 1, auto: true, low: 0 };

function initQuality() {
  quality.base = app.renderer.resolution;
  quality.scale = 1;
  app.ticker.maxFPS = quality.fps;
  // В фоне рисовать нечего: вкладка свёрнута — останавливаем и кадры, и GPU.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) app.ticker.stop(); else app.ticker.start();
  });
}

/** Планка кадров: 60 — плавно, 40 — ощутимо холоднее, 30 — режим экономии.
 *
 *  Тикер Pixi пропускает кадр, если он пришёл хоть на волос раньше порога.
 *  Поставить порог ровно в 60 на 60-герцовом экране — верный способ получить
 *  рванину вдвое: половина кадров не дотягивает миллисекунду и выбрасывается.
 *  Поэтому «плавно» — это вообще без порога, а нижним планкам даём запас. */
export function setMaxFps(n) {
  quality.fps = n;
  if (app) app.ticker.maxFPS = n >= 58 ? 0 : n + 2;
}

/** Во сколько раз огрубляем картинку: 1 — как есть, 0.75 и 0.6 — экономнее. */
export function setPixelScale(k) {
  quality.scale = k;
  if (!app) return;
  const r = Math.max(1, quality.base * k);
  if (Math.abs(app.renderer.resolution - r) < 0.01) return;
  app.renderer.resolution = r;
  app.renderer.resize(app.screen.width, app.screen.height, r);
  drawBackdropNow();
  fitCamera(insets.top, insets.bottom);
}

export function setAutoQuality(on) { quality.auto = on; quality.low = 0; }
export function qualityInfo() { return { ...quality, res: app ? app.renderer.resolution : 0 }; }

/** Раз в пару секунд смотрим, вытягивает ли устройство картинку. Убавляем
 *  только по факту — и только пиксели: резать кадры значит делать игру хуже,
 *  а просили сделать холоднее. Отпустило — возвращаем как было. */
let qAcc = 0, qFrames = 0, qGood = 0;
export function tickQuality(dt) {
  if (!quality.auto || !app) return;
  qAcc += dt; qFrames++;
  if (qAcc < 2) return;
  const fps = qFrames / qAcc;
  qAcc = 0; qFrames = 0;
  if (fps < quality.fps * 0.75) {
    qGood = 0;
    quality.low++;
    if (quality.low >= 3 && quality.scale > 0.76) setPixelScale(0.75);
  } else {
    quality.low = 0;
    if (quality.scale < 0.99 && ++qGood >= 4) { qGood = 0; setPixelScale(1); }
  }
}

/** Кадр игры считаем на тикере Pixi — тогда планка кадров держит и логику. */
export function onFrame(fn) { app.ticker.add((t) => fn(t.deltaMS / 1000)); }

// ── Камера ───────────────────────────────────────────────────────────────────

const WALL_Z = 2.6;

/** Габариты зала в координатах сцены — по ним считаем масштаб и упор камеры. */
function bounds() {
  // Верх должен доставать до крыш домов напротив, иначе камера туда не едет
  // и соперника не увидеть.
  const far = STREET.walk + STREET.road + STREET.far + STREET.facade;
  return {
    left: px(-far, HALL.h + 1).x - 20,
    right: px(HALL.w + 1, -far).x + 20,
    top: px(-far, -far).y - 7 * ZU - 20,
    bottom: px(HALL.w + 1, HALL.h + 1.3).y + 20,
  };
}

let fitH = 0;                 // высота кадра, под которую подобран масштаб
const insets = { top: 0, bottom: 0 };

export function fitCamera(hudTop = 0, hudBottom = 0) {
  if (!app) return;
  fitH = Math.max(120, app.screen.height - hudTop - hudBottom);
  insets.top = hudTop; insets.bottom = hudBottom;
}

/** Масштаб один на весь магазин. Подгонять его под комнату было ошибкой: при
 *  каждом переходе камера наезжала и отъезжала, и от этого укачивало. Берём
 *  самое глубокое помещение и держим этот масштаб всегда — тогда камера просто
 *  едет за игроком, ничего не дёргается. */
function fixedScale(h) {
  let deepest = 0;
  for (const r of ROOMS) {
    const cs = [px(r.x0, r.y0), px(r.x1, r.y0), px(r.x1, r.y1), px(r.x0, r.y1)];
    deepest = Math.max(deepest, Math.max(...cs.map((c) => c.y)) - Math.min(...cs.map((c) => c.y)));
  }
  return clamp(h / (deepest + TH * 1.2 + ZU * 2.0), 0.5, 1.1);
}

export function follow(x, y, hudTop = 0, hudBottom = 0) {
  if (!app) return;
  insets.top = hudTop; insets.bottom = hudBottom;
  if (Math.abs(fitH - (app.screen.height - hudTop - hudBottom)) > 2) fitCamera(hudTop, hudBottom);
  const w = app.screen.width, h = app.screen.height;

  const want = fixedScale(Math.max(120, h - hudTop - hudBottom));
  if (cam.scale !== want) { cam.scale = want; world.scale.set(cam.scale); }

  const p = px(x, y, 0);
  const s = cam.scale;
  const b = bounds();

  let tx = w / 2 - p.x * s;
  // держим героя ниже центра: сверху должно оставаться место под улицу
  let ty = hudTop + (h - hudTop - hudBottom) * 0.62 - p.y * s;

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

/** Размеры кадра — нужны DOM-слою, чтобы прижимать указатели к краям. */
export function viewW() { return app ? app.screen.width : window.innerWidth; }
export function viewH() { return app ? app.screen.height : window.innerHeight; }
