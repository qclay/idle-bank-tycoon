// Telegram Mini App: полный экран, безопасные зоны, тема, профиль, облачный сейв.

import { S, setCloud } from './state.js';
import { SAVE_KEY } from './balance.js';

let tg = null;
export function isTG() { return !!tg; }

/** Скрипт telegram-web-app.js подключается всегда и вне Telegram создаёт заглушку
 *  с версией 6.0 — её нужно отличать от настоящего клиента. */
function real(w) {
  if (!w || !w.initDataUnsafe) return false;
  if (typeof w.initData === 'string' && w.initData.length > 0) return true;
  if (w.initDataUnsafe.user?.id) return true;
  return !!w.platform && w.platform !== 'unknown';
}

function tryCall(fn) { try { return fn(); } catch { return undefined; } }

export function initTG() {
  const w = window.Telegram?.WebApp;
  applyVh();
  if (!real(w)) { tg = null; applySafe(0, 0); return false; }
  tg = w;

  tryCall(() => tg.ready());
  tryCall(() => tg.expand());
  tryCall(() => tg.requestFullscreen?.());
  tryCall(() => tg.disableVerticalSwipes?.());
  tryCall(() => tg.enableClosingConfirmation?.());
  tryCall(() => tg.setHeaderColor?.('#0c1b2a'));
  tryCall(() => tg.setBackgroundColor?.('#0c1b2a'));
  tryCall(() => tg.setBottomBarColor?.('#0c1b2a'));

  const u = tg.initDataUnsafe?.user;
  if (u) S.tg = { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '),
                  username: u.username || '', photo: u.photo_url || '', lang: u.language_code || 'ru' };

  const sync = () => {
    const sa = tg.safeAreaInset || {};
    const ca = tg.contentSafeAreaInset || {};
    applySafe((sa.top || 0) + (ca.top || 0), (sa.bottom || 0) + (ca.bottom || 0));
    applyVh(tg.viewportStableHeight);
    window.dispatchEvent(new Event('resize'));
  };
  sync();
  for (const ev of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
    tryCall(() => tg.onEvent(ev, sync));
  }
  setCloud(cloudApi());
  return true;
}

function applySafe(top, bottom) {
  const r = document.documentElement.style;
  r.setProperty('--sat', `${Math.max(0, top)}px`);
  r.setProperty('--sab', `${Math.max(0, bottom)}px`);
}

function applyVh(h) {
  const v = h || window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${v}px`);
}

// ── Облачный сейв (по 3800 байт на ключ) ─────────────────────────────────────

const CHUNK = 3800;

function cloudApi() {
  if (!tg?.CloudStorage) return null;
  let pending = null, busy = false;
  const flush = () => {
    const json = pending; pending = null; busy = false;
    if (!json) return;
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    if (parts.length > 8) return;
    tryCall(() => tg.CloudStorage.setItem(`${SAVE_KEY}_n`, String(parts.length), () => {}));
    parts.forEach((p, i) => tryCall(() => tg.CloudStorage.setItem(`${SAVE_KEY}_${i}`, p, () => {})));
  };
  return {
    write(json) {
      pending = json;
      if (busy) return;
      busy = true;
      setTimeout(flush, 2500);
    },
  };
}

export function loadCloud() {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => fin(null), 2500);
    if (!tg?.CloudStorage) return fin(null);
    tryCall(() => tg.CloudStorage.getItem(`${SAVE_KEY}_n`, (err, n) => {
      const count = Number(n);
      if (err || !count) return fin(null);
      const keys = Array.from({ length: count }, (_, i) => `${SAVE_KEY}_${i}`);
      tryCall(() => tg.CloudStorage.getItems(keys, (e2, map) => {
        if (e2 || !map) return fin(null);
        try { const j = keys.map((k) => map[k] || '').join(''); fin(j ? JSON.parse(j) : null); }
        catch { fin(null); }
      })) ?? fin(null);
    })) ?? fin(null);
  });
}

/** Оплата звёздами: ссылку на счёт может выдать только бот.
 *  Пропишите адрес бэкенда в PAY_API — тогда кнопки магазина заработают. */
export const PAY_API = '';

export async function pay(item, onDone) {
  if (!PAY_API) return { ok: false, why: 'Оплата звёздами подключается' };
  if (!tg?.openInvoice) return { ok: false, why: 'Покупки работают только в Telegram' };
  try {
    const res = await fetch(`${PAY_API}/invoice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, item: item.id, stars: item.stars, title: item.title }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { link } = await res.json();
    tg.openInvoice(link, (st) => { if (st === 'paid') onDone(item); });
    return { ok: true };
  } catch {
    return { ok: false, why: 'Не удалось открыть оплату' };
  }
}
