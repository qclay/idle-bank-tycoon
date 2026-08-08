// Покупки за звёзды Telegram.
//
// Мини-апп — статика, счёт на звёзды может выставить только бот.
// Поэтому здесь: если задан адрес бэкенда (PAY_API), просим у него ссылку на счёт
// и открываем через Telegram.WebApp.openInvoice. Если бэкенда нет — честно говорим,
// что оплата ещё не подключена, и ничего не выдаём.

import { S, save } from './state.js';
import { grant } from './meta.js';
import { toast, haptic, markDirty } from './ui.js';

// Адрес бота-бэкенда, который умеет createInvoiceLink. Пусто — оплата выключена.
export const PAY_API = '';

export async function pay(item) {
  const tg = window.Telegram?.WebApp;

  if (!PAY_API) {
    toast('Оплата звёздами подключается — нужен бот-бэкенд', 2600);
    return false;
  }
  if (!tg?.openInvoice) {
    toast('Покупки доступны только внутри Telegram', 2400);
    return false;
  }

  try {
    const res = await fetch(`${PAY_API}/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        item: item.id,
        kind: item.kind,
        stars: item.stars,
        title: item.title,
      }),
    });
    if (!res.ok) throw new Error('invoice ' + res.status);
    const { link } = await res.json();
    tg.openInvoice(link, (status) => {
      if (status === 'paid') applyPurchase(item);
      else if (status === 'failed') toast('Оплата не прошла');
    });
    return true;
  } catch (e) {
    toast('Не удалось открыть оплату');
    return false;
  }
}

/** Выдаёт товар. Вызывается только после подтверждённой оплаты. */
export function applyPurchase(item) {
  grant(item.give || {});
  if (item.once) S.stats[`offer_${item.id}`] = 1;
  save(true);
  toast(`Покупка зачислена: ${item.title}`);
  haptic('success');
  markDirty();
}
