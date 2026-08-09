// Дорога по магазину: из комнаты в комнату через дверные проёмы.
//
// Ходят все одинаково — шагом к цели по прямой. Пока зал был одним
// прямоугольником, этого хватало; со стенами прямая упирается в стену, поэтому
// маршрут собирается заранее: комнаты — вершины графа, проёмы — рёбра.

import { ROOMS, WALLS, WALL_T, DOORWAYS, HALL } from './balance.js';

/** В какой комнате точка. Снаружи здания — null. */
export function roomAt(x, y) {
  for (const r of ROOMS) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
  }
  return null;
}

export function roomById(id) { return ROOMS.find((r) => r.id === id) || null; }

/** Стены как прямоугольники — их же используют столкновения. */
export function wallRects() {
  const t = WALL_T / 2;
  return WALLS.map((w) => (w.x != null
    ? { x0: w.x - t, y0: w.y0, x1: w.x + t, y1: w.y1 }
    : { x0: w.x0, y0: w.y - t, x1: w.x1, y1: w.y + t }));
}

// Граф комнат строим один раз: планировка при игре не меняется.
const graph = new Map();
for (const d of DOORWAYS) {
  if (!graph.has(d.a)) graph.set(d.a, []);
  if (!graph.has(d.b)) graph.set(d.b, []);
  graph.get(d.a).push({ to: d.b, door: d });
  graph.get(d.b).push({ to: d.a, door: d });
}

/** Точка сразу ЗА проёмом, если войти в него из комнаты fromId. Отступаем на
 *  полшага, иначе актёр цепляется плечом за косяк. */
function doorPoint(door, fromId) {
  const step = 0.55;
  if (isVertical(door)) {
    const a = roomById(door.a), b = roomById(door.b);
    const leftId = a.x1 <= door.x ? a.id : b.id;
    const dir = fromId === leftId ? 1 : -1;
    return { x: door.x + dir * step, y: door.y };
  }
  const a = roomById(door.a), b = roomById(door.b);
  const topId = a.y1 <= door.y ? a.id : b.id;
  const dir = fromId === topId ? 1 : -1;
  return { x: door.x, y: door.y + dir * step };
}

/** Проём вертикальный, если он лежит на вертикальной стене. */
function isVertical(door) {
  const a = roomById(door.a), b = roomById(door.b);
  return Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(b.x1 - a.x0) < 1e-6;
}

/** Путь по комнатам: список точек, последняя — сама цель.
 *  Комната одна и та же — идём напрямую, как раньше. */
export function path(fromX, fromY, toX, toY) {
  // Клиент приходит с улицы: комнаты под ним нет, но идёт он через вход.
  const a = roomAt(fromX, fromY) || roomAt(fromX, Math.min(fromY, HALL.h - 0.5));
  const b = roomAt(toX, toY);
  if (!a || !b || a.id === b.id) return [{ x: toX, y: toY }];

  const prev = new Map([[a.id, null]]);
  const queue = [a.id];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === b.id) break;
    for (const e of graph.get(cur) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, door: e.door });
      queue.push(e.to);
    }
  }
  if (!prev.has(b.id)) return [{ x: toX, y: toY }];   // связи нет — идём как умеем

  const chain = [];
  let cur = b.id;
  while (prev.get(cur)) {
    const step = prev.get(cur);
    chain.unshift({ door: step.door, from: step.from, to: cur });
    cur = step.from;
  }

  const out = [];
  for (const link of chain) {
    // точка «за проёмом со стороны to» — это подход, «за проёмом со стороны
    // from» — это выход. Две точки подряд заставляют пройти проём насквозь.
    out.push(doorPoint(link.door, link.to));
    out.push(doorPoint(link.door, link.from));
  }
  out.push({ x: toX, y: toY });
  return out;
}

/** Точка внутри здания: пригодится, чтобы не отправить никого в стену. */
export function inside(x, y) {
  return x > 0.2 && y > 0.2 && x < HALL.w - 0.2 && y < HALL.h - 0.2 && !!roomAt(x, y);
}
