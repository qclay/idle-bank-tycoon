// Связь с сервером. Источник правды — сервер, на устройстве не храним ничего.
//
// Вне Telegram (браузер разработчика, автотесты) подписи нет и авторизоваться
// нечем: тогда игра идёт в памяти вкладки и никуда не сохраняется.

export const API = 'https://pvz-backend.qclay-pvz.workers.dev';

export const net = {
  online: false,       // есть ли живая связь с сервером
  guest: false,        // играем без сервера, состояние только в памяти
  player: null,
  rev: 0,
  lastError: '',
  pending: false,
  visiting: false,     // мы в гостях: чужой пункт своим прогрессом не считаем
};

/** Пока гостим у друга, состояние в памяти — чужое. Сохранять его под своим
 *  именем нельзя, иначе визит затрёт собственный пункт. */
export function setVisiting(v) {
  net.visiting = !!v;
  tell();
}

let initData = '';
let listeners = new Set();
export function onNet(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function tell() { for (const f of listeners) f(net); }

function headers() {
  return { 'Content-Type': 'application/json', 'X-Init-Data': initData };
}

async function call(path, opts = {}, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
      const body = await r.json().catch(() => null);
      if (r.status === 409) return { conflict: true, ...body };
      if (!r.ok) { last = body?.error || `код ${r.status}`; if (r.status < 500) break; }
      else return body;
    } catch (e) {
      last = 'нет сети';
    }
    await new Promise((s) => setTimeout(s, 400 * (i + 1)));
  }
  net.online = false;
  net.lastError = last || 'сервер недоступен';
  tell();
  return null;
}

/** Входим на сервер. Возвращает false, если подписи нет — играем гостем. */
export async function connect(tgInitData) {
  initData = tgInitData || '';
  if (!initData) {
    net.guest = true; net.online = false;
    net.lastError = 'вне Telegram: прогресс не сохраняется';
    tell();
    return false;
  }
  const r = await call('/auth', { method: 'POST' });
  if (!r?.player) { net.guest = true; tell(); return false; }
  net.player = r.player;
  net.online = true;
  net.guest = false;
  net.lastError = '';
  tell();
  return true;
}

/** Забираем состояние с сервера. Время отсутствия считает тоже сервер. */
export async function load() {
  if (net.guest) return null;
  const r = await call('/state', { method: 'GET' });
  if (!r) return null;
  net.rev = r.rev || 0;
  net.online = true;
  tell();
  const away = r.updated ? Math.max(0, ((r.now || Date.now()) - r.updated) / 1000) : 0;
  return { save: r.save, away };
}

// ── Отправка состояния ───────────────────────────────────────────────────────
// Копим изменения и шлём пачкой: сервер не должен получать по запросу на кадр.

let dirty = false;
let timer = 0;
let inFlight = false;
let getState = null;
let onServerWins = null;

export function bind(readState, adoptServerState) {
  getState = readState;
  onServerWins = adoptServerState;
}

export function markDirty(now = false) {
  if (net.guest || net.visiting) return;
  dirty = true;
  if (now) return flush();
  if (!timer) timer = setTimeout(() => { timer = 0; flush(); }, 8000);
  return null;
}

export async function flush() {
  if (net.guest || net.visiting || inFlight || !dirty || !getState) return null;
  inFlight = true;
  dirty = false;
  net.pending = true;
  tell();
  const { save, stats } = getState();
  const r = await call('/state', { method: 'POST', body: JSON.stringify({ save, stats, rev: net.rev }) });
  inFlight = false;
  net.pending = false;
  if (!r) { dirty = true; tell(); return null; }      // не ушло — попробуем позже
  if (r.conflict) {
    // На другом устройстве играли позже: серверная версия важнее нашей.
    net.rev = r.rev || 0;
    onServerWins?.(r.save);
    net.online = true;
    tell();
    return { conflict: true };
  }
  net.rev = r.rev || net.rev;
  net.online = true;
  net.lastError = '';
  tell();
  return r;
}

/** Последняя попытка сохраниться при уходе со страницы. */
export function flushBeacon() {
  if (net.guest || net.visiting || !getState || !dirty) return;
  try {
    const { save, stats } = getState();
    const blob = new Blob([JSON.stringify({ save, stats, rev: net.rev, initData })],
      { type: 'application/json' });
    navigator.sendBeacon?.(`${API}/state?beacon=1`, blob);
  } catch { /* уходим молча */ }
}

export async function leaders() { return call('/leaders', { method: 'GET' }, 1); }

/** Отзыв от модели. Пусто — значит сервер недоступен, покажем шаблонный. */
export async function aiReview(ctx) {
  if (net.guest) return null;
  const r = await call('/review', { method: 'POST', body: JSON.stringify(ctx) }, 1);
  return r?.text || null;
}

/** Пост для страницы пункта — его пишет тот же сервер, ключ модели у него. */
export async function aiPromo(ctx) {
  if (net.guest || net.visiting) return null;
  const r = await call('/review', { method: 'POST', body: JSON.stringify({ promo: ctx }) }, 1);
  return r?.text || null;
}

export async function aiReviewBatch(list) {
  if (net.guest) return null;
  const r = await call('/review', { method: 'POST', body: JSON.stringify({ list }) }, 1);
  return r?.lines || null;
}
