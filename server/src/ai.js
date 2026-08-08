// Отзывы и реплики клиентов от модели. Ключ живёт только на сервере:
// из мини-аппа его вызывать нельзя — он бы утёк в открытый код.

const SYSTEM = `Ты пишешь короткие отзывы клиентов о пункте выдачи заказов в Узбекистане.
Правила: одна фраза, живой разговорный русский, без эмодзи, без кавычек,
до 90 символов. Пиши от первого лица. Не выдумывай названий брендов.
Упоминай только те услуги, которые перечислены в задании: если примерочной
в списке нет — её в пункте не существует, писать о ней нельзя.`;

const PROMO_SYSTEM = `Ты ведёшь страницу пункта выдачи заказов в соцсети.
Пиши рекламный пост от лица пункта: одна живая фраза, разговорный русский,
без эмодзи, без кавычек, до 90 символов. Зови людей забрать заказ.
Упоминай только перечисленные услуги — другого в пункте нет.`;

/** Пост для страницы пункта: его пишет смм-щик, нанятый игроком. */
export async function promo(env, ctx) {
  if (!env.OPENAI_KEY) return { error: 'нет ключа модели' };
  const user = [
    ctx.has?.length ? `В пункте есть: ${ctx.has.join(', ')}.` : 'В пункте только выдача заказов.',
    ctx.stars ? `Рейтинг пункта ${Number(ctx.stars).toFixed(1)} из 5.` : '',
    'Напиши пост для страницы пункта.',
  ].filter(Boolean).join(' ');
  return ask(env, PROMO_SYSTEM, user, 200);
}

/** Общий вызов модели: один системный текст, одна просьба, одна фраза в ответ. */
async function ask(env, system, user, tokens) {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-5.6-luna',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_completion_tokens: tokens,
      }),
    });
    if (!r.ok) return { error: `модель ответила ${r.status}`, detail: (await r.text()).slice(0, 200) };
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: 'пустой ответ', detail: j.choices?.[0]?.finish_reason || '' };
    return { text: text.replace(/^[«"']|[»"']$/g, '').slice(0, 120) };
  } catch (e) {
    return { error: 'запрос не ушёл', detail: String(e).slice(0, 200) };
  }
}

/** Один отзыв по ситуации. Возвращает строку или null, если модель недоступна. */
export async function review(env, ctx) {
  if (!env.OPENAI_KEY) return { error: 'нет ключа модели' };
  const mood = ctx.kind === 'good' ? 'доволен' : ctx.kind === 'solved' ? 'сначала расстроился, но всё уладили' : 'недоволен';
  const user = [
    `Стойка: ${ctx.at || 'выдача заказов'}.`,
    `Клиент ${mood}.`,
    ctx.reason ? `Что случилось: ${ctx.reason}.` : '',
    ctx.waited > 0.6 ? 'Он долго стоял в очереди.' : '',
    ctx.has?.length ? `В пункте есть только: ${ctx.has.join(', ')}.` : '',
    ctx.outcome ? `Итог разбора: ${ctx.outcome}.` : '',
    'Напиши его отзыв.',
  ].filter(Boolean).join(' ');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-5.6-luna',
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        max_completion_tokens: 200,
      }),
    });
    if (!r.ok) return { error: `модель ответила ${r.status}`, detail: (await r.text()).slice(0, 200) };
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: 'пустой ответ', detail: j.choices?.[0]?.finish_reason || '' };
    return { text: text.replace(/^[«"']|[»"']$/g, '').slice(0, 120) };
  } catch (e) {
    return { error: 'запрос не ушёл', detail: String(e).slice(0, 200) };
  }
}

/** Пачка отзывов за один вызов — дешевле, чем по одному. */
export async function reviewBatch(env, list) {
  if (!env.OPENAI_KEY || !list?.length) return { error: 'нет ключа или пустой список' };
  const has = list.find((c) => c.has?.length)?.has;
  const head = has ? `В пункте есть только: ${has.join(', ')}. Другого там нет.\n` : '';
  const items = head + list.slice(0, 8).map((c, i) => {
    const mood = c.kind === 'good' ? 'доволен' : c.kind === 'solved' ? 'проблему уладили' : 'недоволен';
    return `${i + 1}. стойка «${c.at || 'выдача'}», клиент ${mood}${c.reason ? `, причина: ${c.reason}` : ''}`;
  }).join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-5.6-luna',
        messages: [
          { role: 'system', content: `${SYSTEM}\nВерни ровно столько строк, сколько ситуаций, по одной на строку, без нумерации.` },
          { role: 'user', content: items },
        ],
        max_completion_tokens: 120 * list.length,
      }),
    });
    if (!r.ok) return { error: `модель ответила ${r.status}`, detail: (await r.text()).slice(0, 200) };
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    const lines = text.split('\n').map((s) => s.replace(/^\s*\d+[.)]\s*/, '').replace(/^[«"']|[»"']$/g, '').trim())
      .filter(Boolean);
    return lines.length ? { lines } : { error: 'пустой ответ' };
  } catch (e) {
    return { error: 'запрос не ушёл', detail: String(e).slice(0, 200) };
  }
}
