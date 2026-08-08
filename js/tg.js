// Telegram Mini App: полный экран, безопасные зоны, тема, профиль игрока.

import { S } from './state.js';

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

// Облачного сейва здесь нет намеренно: состояние игрока живёт на сервере,
// а не на устройстве.

/** Подпись Telegram — ею сервер удостоверяет игрока. */
export function initDataRaw() { return tg?.initData || ''; }

/** Пришли по ссылке-приглашению: startapp=room_<id> владельца пункта. */
export function startParam() { return tg?.initDataUnsafe?.start_param || ''; }

/** Позвать друга в свой пункт. */
export function invite(myId, botName = '') {
  // Прямая ссылка на бота со startapp открывает главное мини-приложение —
  // не зависит от короткого имени приложения в BotFather.
  const link = `https://t.me/${botName}?startapp=room_${myId}`;
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}`
    + `&text=${encodeURIComponent('Помоги мне на пункте выдачи — заходи!')}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

export function tgHaptic(kind) {
  try {
    if (['success', 'error', 'warning'].includes(kind)) tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind || 'light');
  } catch { /* вне телеграма */ }
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
