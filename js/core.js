// Изометрия, форматирование чисел, мелкие утилиты.

// ── Изометрическая проекция ───────────────────────────────────────────────────
// Мир — сетка тайлов. Ось X уходит вправо-вниз, ось Y — влево-вниз (2:1).

export const TW = 76;   // ширина тайла на экране
export const TH = 38;   // высота тайла
export const ZU = 44;   // на сколько пикселей вверх поднимает единица высоты

/** тайл (x, y, z) → экранные координаты сцены */
export function px(x, y, z = 0) {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) - z * ZU };
}

/** экранные координаты сцены → тайл (обратная проекция, z = 0) */
export function unpx(sx, sy) {
  return { x: (sy / (TH / 2) + sx / (TW / 2)) / 2, y: (sy / (TH / 2) - sx / (TW / 2)) / 2 };
}

/** глубина для сортировки: чем дальше по x+y, тем ближе к зрителю */
export function depth(x, y, z = 0) { return (x + y) * 1000 + z; }

/** Направление движения → одно из 4 изометрических (для покадровых спрайтов). */
export function isoDir(dx, dy) {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return 'se';
  // экранное направление
  const sx = (dx - dy);
  const sy = (dx + dy);
  if (sy >= 0) return sx >= 0 ? 'se' : 'sw';
  return sx >= 0 ? 'ne' : 'nw';
}

// ── Числа ─────────────────────────────────────────────────────────────────────

const SMALL = ['', 'K', 'M', 'B', 'T'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const sufCache = new Map();

function suffix(tier) {
  if (tier < SMALL.length) return SMALL[tier];
  if (sufCache.has(tier)) return sufCache.get(tier);
  let n = tier - SMALL.length, len = 2, block = 676;
  while (n >= block) { n -= block; len++; block = 26 ** len; }
  let out = '';
  for (let i = len - 1; i >= 0; i--) out += LETTERS[Math.floor(n / 26 ** i) % 26];
  sufCache.set(tier, out);
  return out;
}

export function fmt(v) {
  const val = Number(v) || 0;
  if (!isFinite(val)) return '∞';
  const neg = val < 0;
  let n = Math.abs(val);
  if (n < 1000) return (neg ? '-' : '') + String(Math.floor(n));
  const tier = Math.floor(Math.log10(n) / 3);
  n /= 10 ** (tier * 3);
  let s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return (neg ? '-' : '') + s + suffix(tier);
}

export function dur(sec) {
  let s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}д ${h}ч`;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s}с`;
  return `${s}с`;
}

export function clock(sec) {
  let s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Размер одной единицы макета в пикселях (--du из CSS). */
export function du() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--du');
  return parseFloat(v) || 1;
}

/** Осветлить/затемнить hex-цвет. */
export function shade(hex, k) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function plural(n, a, b, c) {
  const m = n % 100;
  if (m >= 11 && m <= 14) return c;
  const k = n % 10;
  return k === 1 ? a : k >= 2 && k <= 4 ? b : c;
}
