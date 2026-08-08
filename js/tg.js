// Интеграция с Telegram Mini App: полный экран, безопасные зоны, тема,
// профиль игрока, облачный сейв.

import { S, setCloud } from './state.js';
import { SAVE_KEY as KEY } from './balance.js';

let tg = null;

export function isTG() { return !!tg; }

/** Скрипт telegram-web-app.js подключается всегда и вне Telegram создаёт заглушку
 *  с версией 6.0 — её нужно отличать от настоящего клиента. */
function realTelegram(w) {
  if (!w || !w.initDataUnsafe) return false;
  if (typeof w.initData === 'string' && w.initData.length > 0) return true;
  if (w.initDataUnsafe.user && w.initDataUnsafe.user.id) return true;
  return !!w.platform && w.platform !== 'unknown';
}

/** Безопасный вызов метода SDK: неподдержанные версии кидают исключение. */
function tryCall(fn) {
  try { return fn(); } catch { return undefined; }
}

export function initTG() {
  const w = window.Telegram?.WebApp;
  if (!realTelegram(w)) { tg = null; applySafeArea(0, 0); return false; }
  tg = w;

  tryCall(() => tg.ready());
  tryCall(() => tg.expand());
  tryCall(() => tg.requestFullscreen?.());
  tryCall(() => tg.disableVerticalSwipes?.());
  tryCall(() => tg.enableClosingConfirmation?.());
  tryCall(() => tg.setHeaderColor?.('#16283f'));
  tryCall(() => tg.setBackgroundColor?.('#0f1b2b'));
  tryCall(() => tg.setBottomBarColor?.('#16283c'));

  const u = tg.initDataUnsafe?.user;
  if (u) {
    S.tg = {
      id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '),
      username: u.username || '', photo: u.photo_url || '', lang: u.language_code || 'ru',
    };
  }

  const sync = () => {
    const sa = tg.safeAreaInset || {};
    const ca = tg.contentSafeAreaInset || {};
    applySafeArea((sa.top || 0) + (ca.top || 0), (sa.bottom || 0) + (ca.bottom || 0));
    window.dispatchEvent(new Event('resize'));
  };
  sync();
  for (const ev of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
    tryCall(() => tg.onEvent(ev, sync));
  }

  setCloud(cloudApi());
  return true;
}

function applySafeArea(top, bottom) {
  const r = document.documentElement.style;
  r.setProperty('--sat', `${Math.max(top, 0)}px`);
  r.setProperty('--sab', `${Math.max(bottom, 0)}px`);
}

// ── Облачный сейв ─────────────────────────────────────────────────────────────
// CloudStorage хранит до 4096 байт на ключ, поэтому режем сейв на части.

const CHUNK = 3800;

function cloudApi() {
  if (!tg?.CloudStorage) return null;
  let pending = null, busy = false;

  const write = (json) => {
    pending = json;
    if (busy) return;
    busy = true;
    setTimeout(flush, 2500);   // не чаще раза в 2.5 с
  };

  const flush = () => {
    const json = pending; pending = null; busy = false;
    if (!json) return;
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    if (parts.length > 8) return;   // слишком большой сейв — остаётся только локальный
    tryCall(() => tg.CloudStorage.setItem(`${KEY}_n`, String(parts.length), () => {}));
    parts.forEach((p, i) => tryCall(() => tg.CloudStorage.setItem(`${KEY}_${i}`, p, () => {})));
  };

  return { write };
}

export function loadCloud() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(null), 2500);   // не ждём вечно
    if (!tg?.CloudStorage) return done(null);
    tryCall(() => tg.CloudStorage.getItem(`${KEY}_n`, (err, n) => {
      const count = Number(n);
      if (err || !count) return done(null);
      const keys = Array.from({ length: count }, (_, i) => `${KEY}_${i}`);
      tryCall(() => tg.CloudStorage.getItems(keys, (e2, map) => {
        if (e2 || !map) return done(null);
        try {
          const json = keys.map((k) => map[k] || '').join('');
          done(json ? JSON.parse(json) : null);
        } catch { done(null); }
      })) ?? done(null);
    })) ?? done(null);
  });
}

export function tgHaptic(kind) {
  try {
    if (['success', 'error', 'warning'].includes(kind)) tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind || 'light');
  } catch { /* ничего */ }
}

export function shareGame(text) {
  const url = window.location.href.split('?')[0];
  const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(link);
  else window.open(link, '_blank');
}
