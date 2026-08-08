// Проверка бэкенда: подпись Telegram, прогресс, конфликт версий, рейтинг,
// отзыв от модели и комната совместной игры.
//
// Токен бота читается из server/.dev.vars — этот файл в репозиторий не попадает.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const BASE = process.env.API || 'https://pvz-backend.qclay-pvz.workers.dev';
const BOT = (process.env.BOT_TOKEN
  || (readFileSync(new URL('../server/.dev.vars', import.meta.url), 'utf8')
      .match(/BOT_TOKEN=(.+)/) || [])[1] || '').trim();
if (!BOT) { console.error('нет BOT_TOKEN'); process.exit(1); }

/** Собираем настоящую подпись initData, как это делает Telegram. */
function initData(user) {
  const fields = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF' + Math.random().toString(36).slice(2, 10),
  };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const A = initData({ id: 900001, first_name: 'Тест', username: 'tester' });
const Bp = initData({ id: 900002, first_name: 'Друг', username: 'friend' });

const call = async (path, opts = {}, id = A) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': id, ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await r.json(); } catch { /* не json */ }
  return { status: r.status, body };
};

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

// 1. вход
const auth = await call('/auth', { method: 'POST' });
ok('вход по подписи Telegram', auth.status === 200 && auth.body?.player?.id === '900001',
   auth.body?.player?.name || JSON.stringify(auth.body));

// 2. просроченная подпись должна отклоняться
const old = (() => {
  const fields = { user: JSON.stringify({ id: 7 }), auth_date: String(Math.floor(Date.now() / 1000) - 90000) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
})();
const oldRes = await call('/auth', { method: 'POST' }, old);
ok('старая подпись не проходит', oldRes.status === 401);

// 3. сохранение и чтение прогресса
const cur = await call('/state');
const save = { cash: 12345, rep: 4.4, counters: { c1: { open: true, lvl: 7 } } };
const put = await call('/state', { method: 'POST', body: JSON.stringify({ save, rev: cur.body?.rev || 0, stats: { served: 120, earned: 5e5, rep: 4.4 } }) });
ok('прогресс сохраняется', put.status === 200 && put.body?.rev >= 1, 'ревизия ' + put.body?.rev);

const get = await call('/state');
ok('прогресс читается обратно', get.body?.save?.cash === 12345, JSON.stringify(get.body?.save?.counters?.c1 || {}));

// 4. защита от затирания с другого устройства
const stale = await call('/state', { method: 'POST', body: JSON.stringify({ save: { cash: 1 }, rev: 0 }) });
ok('устаревшая версия не затирает свежую', stale.status === 409 && stale.body?.conflict === true,
   'вернулся конфликт, cash=' + stale.body?.save?.cash);

// 5. рейтинг
await call('/state', { method: 'POST', body: JSON.stringify({ save: { cash: 5 }, rev: 99, stats: { served: 40 } }) }, Bp);
const lead = await call('/leaders');
ok('рейтинг собирается', lead.status === 200 && lead.body?.top?.length >= 2,
   `игроков ${lead.body?.top?.length}, моё место ${lead.body?.place}`);
ok('первым идёт тот, кто выдал больше', lead.body?.top?.[0]?.served >= lead.body?.top?.[1]?.served,
   `${lead.body?.top?.[0]?.served} и ${lead.body?.top?.[1]?.served}`);

// 6. отзыв от модели
const rev = await call('/review', {
  method: 'POST',
  body: JSON.stringify({ kind: 'bad', at: 'Приём возвратов', reason: 'коробка помята', waited: 0.8 }),
});
ok('модель пишет отзыв', rev.status === 200 && typeof rev.body?.text === 'string' && rev.body.text.length > 8,
   rev.body?.text || `${rev.body?.error || 'пусто'} ${rev.body?.detail || ''}`);

const batch = await call('/review', {
  method: 'POST',
  body: JSON.stringify({ list: [
    { kind: 'good', at: 'Выдача заказов' },
    { kind: 'solved', at: 'Примерочная', reason: 'долго ждал' },
  ] }),
});
ok('пачка отзывов одним вызовом', Array.isArray(batch.body?.lines) && batch.body.lines.length >= 2,
   (batch.body?.lines || []).join(' | ').slice(0, 110) || `${batch.body?.error || ''} ${batch.body?.detail || ''}`);

// 7. комната: двое видят друг друга
const roomOk = await new Promise((resolve) => {
  const url = BASE.replace('https://', 'wss://') + '/room/testroom?initData=' + encodeURIComponent(A);
  const w1 = new WebSocket(url);
  let seenJoin = false, seenSync = false;
  const done = (v) => { try { w1.close(); w2 && w2.close(); } catch { /* уже закрыт */ } resolve(v); };
  let w2 = null;
  const timer = setTimeout(() => done({ seenJoin, seenSync }), 12000);
  w1.on('open', () => {
    w2 = new WebSocket(BASE.replace('https://', 'wss://') + '/room/testroom?initData=' + encodeURIComponent(Bp));
    w2.on('open', () => {
      w2.send(JSON.stringify({ t: 'move', x: 5, y: 6, dir: -1, carry: 3 }));
      w1.send(JSON.stringify({ t: 'move', x: 1, y: 2 }));
    });
  });
  w1.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'join') seenJoin = true;
    // ждём не первый sync, а тот, где видно, что игрок реально сдвинулся
    if (m.t === 'sync' && m.players?.length === 2) {
      const moved = m.players.some((pl) => Math.abs(pl.x - 12) > 0.5 || Math.abs(pl.y - 11) > 0.5);
      if (moved) { seenSync = true; clearTimeout(timer); done({ seenJoin, seenSync, players: m.players }); }
    }
  });
  w1.on('error', () => { clearTimeout(timer); done({ seenJoin, seenSync }); });
});
ok('второй игрок виден в комнате', roomOk.seenJoin, 'пришло событие входа');
ok('позиции расходятся всем', roomOk.seenSync,
   (roomOk.players || []).map((p) => `${p.name}(${p.x},${p.y})`).join(' '));

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log(`${c.pass ? '✓' : '✗'} ${c.name.padEnd(38)} ${c.info}`); }
console.log(bad ? `\n✗ проблем: ${bad}` : '\n✓ бэкенд работает целиком');
process.exit(bad ? 1 : 0);
