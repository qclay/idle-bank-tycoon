// Проверка подписи Telegram initData.
//
// Без неё любой мог бы прислать чужой id и выдать себя за другого игрока,
// поэтому весь разговор с сервером начинается отсюда.

const enc = new TextEncoder();

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

const hex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Сравнение без утечки времени. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Возвращает данные игрока, если подпись верна, иначе null.
 * maxAgeSec защищает от переигрывания старой строки.
 */
export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const sign = hex(await hmac(secret, check));
  if (!same(sign, hash)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { /* нет профиля */ }
  if (!user?.id) return null;

  return {
    id: String(user.id),
    name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Игрок',
    username: user.username || '',
    photo: user.photo_url || '',
    lang: user.language_code || 'ru',
  };
}
