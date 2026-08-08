// Форматирование чисел в стиле idle-игр: 1.24K, 15.6M, 3.09aa …
// Суффиксы: K M B T, затем aa ab ac … az ba bb … (двухбуквенные), потом трёхбуквенные.

const SMALL = ['', 'K', 'M', 'B', 'T'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const suffixCache = new Map();

function suffixFor(tier) {
  // tier 0 = единицы, 1 = K … 4 = T, 5 = aa, 6 = ab …
  if (tier < SMALL.length) return SMALL[tier];
  if (suffixCache.has(tier)) return suffixCache.get(tier);
  let n = tier - SMALL.length; // 0 → aa
  let out = '';
  // Двухбуквенный блок: 26*26 = 676 комбинаций, дальше трёхбуквенные.
  let len = 2;
  let block = 26 ** len;
  while (n >= block) {
    n -= block;
    len += 1;
    block = 26 ** len;
  }
  for (let i = len - 1; i >= 0; i--) {
    out += LETTERS[Math.floor(n / 26 ** i) % 26];
  }
  suffixCache.set(tier, out);
  return out;
}

/** Основной формат денег: 0 → «0», 999 → «999», 1234 → «1.23K». */
export function fmt(value) {
  const v = Number(value) || 0;
  if (!isFinite(v)) return '∞';
  const neg = v < 0;
  let n = Math.abs(v);
  if (n < 1000) {
    const s = n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
    return neg ? '-' + s : s;
  }
  const tier = Math.floor(Math.log10(n) / 3);
  n = n / 10 ** (tier * 3);
  // Три значащих знака, как в Idle-тайкунах.
  let s;
  if (n >= 100) s = n.toFixed(0);
  else if (n >= 10) s = n.toFixed(1);
  else s = n.toFixed(2);
  // Убираем хвостовые нули: 1.00K → 1K, 1.50K → 1.5K
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return (neg ? '-' : '') + s + suffixFor(tier);
}

/** Деньги с префиксом валюты. */
export function money(v) {
  return '$' + fmt(v);
}

/** Целые: уровни, количества. */
export function int(v) {
  const n = Math.floor(Number(v) || 0);
  if (n < 1e6) return n.toLocaleString('ru-RU').replace(/ /g, ' ');
  return fmt(n);
}

/** Время в компактном виде: 4ч 12м, 45с, 2д 3ч. */
export function dur(seconds) {
  let s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

/** Время в виде таймера 01:23:45 / 23:45. */
export function clock(seconds) {
  let s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Проценты: 0.25 → «+25%». */
export function pct(x, withSign = true) {
  const v = x * 100;
  const s = Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString();
  return (withSign && v > 0 ? '+' : '') + s + '%';
}

/** Множитель: 2 → «x2», 1.5 → «x1.5». */
export function mult(x) {
  const s = x % 1 === 0 ? String(x) : x.toFixed(2).replace(/0$/, '');
  return 'x' + s;
}
