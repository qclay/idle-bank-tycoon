// Совместная игра: несколько игроков в одном пункте.
//
// Мир считает хозяин пункта (хост) и рассылает снимок. Гости мир не
// симулируют — они его отрисовывают и помогают: встают за стойку, носят
// выручку. Хост применяет их действия по присланным координатам, поэтому
// подделать что-то со стороны гостя нельзя.

import { API } from './net.js';
import { COUNTERS, ATMS, ZONES } from './balance.js';
import { S } from './state.js';
import { setVisiting } from './net.js';

export const coop = {
  on: false,          // подключены к комнате
  host: false,        // мы считаем мир
  me: '',
  roomId: '',
  players: new Map(), // id → { id, name, x, y, dir, carry, view }
  snap: null,         // последний снимок от хоста (для гостя)
  hostOnline: false,  // хозяин пункта на связи — иначе смотреть не на что
  error: '',
};

let ws = null;
let initData = '';
let sendTimer = 0;
let retry = 0;
const subs = new Set();
export function onCoop(fn) { subs.add(fn); return () => subs.delete(fn); }
const tell = () => { for (const f of subs) f(coop); };

/** Подключиться к комнате. roomId — id владельца пункта. */
export function join(tgInitData, roomId, myId) {
  initData = tgInitData;
  coop.roomId = roomId;
  coop.me = myId;
  if (!initData || !roomId) return;
  if (String(roomId) !== String(myId)) stash();   // гостим — свой пункт откладываем
  open();
}

// Пока мы у друга, в памяти лежит его пункт. Свой прячем до возвращения и
// запрещаем отправку на сервер, чтобы визит не затёр собственный прогресс.
let mine = null;
function stash() {
  if (mine) return;
  mine = {
    counters: structuredClone(S.counters), atms: structuredClone(S.atms),
    zones: structuredClone(S.zones), cash: S.cash, rep: S.rep,
  };
  setVisiting(true);
}

/** Вернуться в свой пункт: состояние друга выбрасываем целиком. */
export function leave() {
  close();
  coop.roomId = '';
  coop.snap = null;
  coop.players.clear();
  if (mine) {
    S.counters = mine.counters; S.atms = mine.atms; S.zones = mine.zones;
    S.cash = mine.cash; S.rep = mine.rep;
    mine = null;
  }
  setVisiting(false);
  tell();
}

/** Мы в гостях у другого игрока (а не просто не хост в своём пункте). */
export function visiting() { return !!mine; }

function open() {
  close();
  const url = `${API.replace('https://', 'wss://')}/room/${encodeURIComponent(coop.roomId)}`
    + `?initData=${encodeURIComponent(initData)}`;
  try { ws = new WebSocket(url); } catch { schedule(); return; }

  ws.onopen = () => { retry = 0; coop.on = true; coop.error = ''; tell(); };
  ws.onclose = () => { coop.on = false; tell(); schedule(); };
  ws.onerror = () => { coop.error = 'нет связи с комнатой'; tell(); };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
}

function schedule() {
  if (sendTimer) return;
  retry = Math.min(retry + 1, 6);
  sendTimer = setTimeout(() => { sendTimer = 0; if (coop.roomId) open(); }, 800 * retry);
}

export function close() {
  if (ws) { try { ws.close(); } catch { /* уже закрыт */ } ws = null; }
  coop.on = false;
  for (const p of coop.players.values()) p.gone = true;
}

function handle(m) {
  if (m.t === 'hello') {
    // Считать мир может только владелец пункта. Проверяем это и у себя, а не
    // только на сервере: чужой бизнес не должен зависеть от нашей симуляции.
    coop.host = m.host === coop.me && String(coop.roomId) === String(coop.me);
    coop.hostOnline = String(m.host || '') === String(coop.roomId);
    for (const p of m.players || []) if (p.id !== coop.me) upsert(p);
    if (!coop.host && m.snap) coop.snap = m.snap;
    tell();
  } else if (m.t === 'join') {
    if (m.player?.id !== coop.me) upsert(m.player);
    tell();
  } else if (m.t === 'left') {
    const p = coop.players.get(m.id);
    if (p) { p.gone = true; }
    tell();
  } else if (m.t === 'host') {
    coop.host = m.id === coop.me && String(coop.roomId) === String(coop.me);
    coop.hostOnline = String(m.id || '') === String(coop.roomId);
    tell();
  } else if (m.t === 'sync') {
    for (const p of m.players || []) if (p.id !== coop.me) upsert(p);
  } else if (m.t === 'snap') {
    if (!coop.host) coop.snap = m.s;
  }
}

function upsert(p) {
  if (!p?.id) return;
  const cur = coop.players.get(p.id);
  if (cur) { Object.assign(cur, p); cur.gone = false; }
  else coop.players.set(p.id, { ...p, view: null, gone: false, ft: 0 });
}

export function others() {
  return [...coop.players.values()].filter((p) => !p.gone);
}

/** Код пункта — по нему друг заходит в гости, если ссылка не сработала. */
export function myCode() { return String(coop.me || ''); }

/** Наши координаты уходят в комнату — по ним хост считает наши действия. */
export function sendMove(x, y, dir, carry) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'move', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, dir, carry }));
}

// ── Снимок мира ──────────────────────────────────────────────────────────────

/** Хост упаковывает мир: что открыто, сколько выручки, где клиенты. */
export function makeSnap(customers) {
  return {
    c: COUNTERS.map((c) => {
      const st = S.counters[c.id];
      return [st.open ? 1 : 0, st.lvl, Math.round((st.cash / Math.max(1, st.cash + 1)) * 0), st.clerk, Math.round(st.cash)];
    }),
    a: ATMS.map((a) => { const st = S.atms[a.id]; return [st.open ? 1 : 0, st.lvl, Math.round(st.cash)]; }),
    z: ZONES.map((z) => { const st = S.zones?.[z.id]; return [st?.open ? 1 : 0, st?.lvl || 1]; }),
    k: customers.map((k) => [
      Math.round(k.x * 20), Math.round(k.y * 20),
      k.dir === 'se' ? 0 : k.dir === 'sw' ? 1 : k.dir === 'ne' ? 2 : 3,
      k.state === 'upset' ? 1 : k.state === 'serve' ? 2 : 0,
      k.moving ? 1 : 0,
    ]),
    m: [Math.round(S.cash), Math.round((S.rep || 0) * 100)],
    p: S.padPaid || {},          // сколько уже вложено в каждую стройку
    u: { ...S.ups },             // уровни улучшений — от них зависят площадки
  };
}

/** Гость раскладывает снимок обратно в своё состояние — только для показа. */
export function applySnap(s) {
  if (!s) return;
  COUNTERS.forEach((c, i) => {
    const v = s.c?.[i]; if (!v) return;
    const st = S.counters[c.id];
    st.open = !!v[0]; st.lvl = v[1] || 1; st.clerk = v[3] || 0; st.cash = v[4] || 0;
  });
  ATMS.forEach((a, i) => {
    const v = s.a?.[i]; if (!v) return;
    const st = S.atms[a.id];
    st.open = !!v[0]; st.lvl = v[1] || 1; st.cash = v[2] || 0;
  });
  ZONES.forEach((z, i) => {
    const v = s.z?.[i]; if (!v) return;
    if (!S.zones[z.id]) S.zones[z.id] = { open: false, lvl: 1 };
    S.zones[z.id].open = !!v[0]; S.zones[z.id].lvl = v[1] || 1;
  });
  if (s.m) { S.cash = s.m[0]; S.rep = s.m[1] / 100; }
  if (s.p) S.padPaid = s.p;
  if (s.u) Object.assign(S.ups, s.u);
  // Открылась новая витрина — зал у гостя нужно пересобрать, иначе он
  // продолжит смотреть на пустое место.
  const key = shape();
  const changed = key !== lastShape;
  lastShape = key;
  return changed;
}

let lastShape = '';
function shape() {
  return COUNTERS.map((c) => (S.counters[c.id].open ? 1 : 0)).join('')
    + ATMS.map((a) => (S.atms[a.id].open ? 1 : 0)).join('')
    + ZONES.map((z) => (S.zones?.[z.id]?.open ? 1 : 0)).join('')
    + Object.values(S.ups || {}).join(',');
}

export function snapCustomers() {
  const s = coop.snap;
  if (!s?.k) return [];
  const DIRS = ['se', 'sw', 'ne', 'nw'];
  return s.k.map((v, i) => ({
    id: 'r' + i,
    x: v[0] / 20, y: v[1] / 20,
    dir: DIRS[v[2]] || 'se',
    state: v[3] === 1 ? 'upset' : v[3] === 2 ? 'serve' : 'walk',
    moving: !!v[4],
  }));
}

export function pushSnap(customers) {
  if (!coop.host || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'snap', s: makeSnap(customers) }));
}
