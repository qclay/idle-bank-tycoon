// Бэкенд игры «Пункт выдачи»: авторизация Telegram, прогресс, рейтинг,
// комнаты совместной игры и отзывы от модели.

import { verifyInitData } from './auth.js';
import { review, reviewBatch } from './ai.js';
export { Room } from './room.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Init-Data',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

/** Каждый запрос начинается с проверки подписи Telegram. */
async function who(req, env) {
  const initData = req.headers.get('X-Init-Data') || new URL(req.url).searchParams.get('initData') || '';
  return verifyInitData(initData, env.BOT_TOKEN);
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, name TEXT, username TEXT, photo TEXT,
      created INTEGER, seen INTEGER, room TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY, data TEXT, rev INTEGER DEFAULT 0, updated INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY, name TEXT, served INTEGER DEFAULT 0,
      earned REAL DEFAULT 0, rep REAL DEFAULT 0, week INTEGER, updated INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS friends (
      a TEXT, b TEXT, created INTEGER, PRIMARY KEY (a, b))`),
  ]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (path === '/' || path === '/health') {
      return json({ ok: true, service: 'pvz-backend', model: env.AI_MODEL || 'gpt-5.6-luna' });
    }

    try { await ensureSchema(env); } catch (e) { return json({ error: 'база недоступна: ' + e.message }, 500); }

    // ── вход ──────────────────────────────────────────────────────────────────
    if (path === '/auth' && req.method === 'POST') {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO players (id,name,username,photo,created,seen) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username,
           photo=excluded.photo, seen=excluded.seen`,
      ).bind(u.id, u.name, u.username, u.photo, now, now).run();
      return json({ player: u });
    }

    // ── прогресс ──────────────────────────────────────────────────────────────
    if (path === '/state' && req.method === 'GET') {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const row = await env.DB.prepare('SELECT data, rev, updated FROM saves WHERE id=?').bind(u.id).first();
      return json({ save: row ? JSON.parse(row.data) : null, rev: row?.rev || 0,
                     updated: row?.updated || 0, now: Date.now() });
    }

    if (path === '/state' && req.method === 'POST') {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const body = await req.json().catch(() => null);
      if (!body?.save) return json({ error: 'нет данных' }, 400);
      const now = Date.now();
      const cur = await env.DB.prepare('SELECT rev FROM saves WHERE id=?').bind(u.id).first();
      const rev = (cur?.rev || 0) + 1;
      // Клиент присылает свою ревизию: расходится — значит играли с другого
      // устройства, и мы отдаём серверную версию вместо тихой перезаписи.
      if (cur && body.rev != null && body.rev < cur.rev) {
        const row = await env.DB.prepare('SELECT data, rev FROM saves WHERE id=?').bind(u.id).first();
        return json({ conflict: true, save: JSON.parse(row.data), rev: row.rev }, 409);
      }
      await env.DB.prepare(
        `INSERT INTO saves (id,data,rev,updated) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET data=excluded.data, rev=excluded.rev, updated=excluded.updated`,
      ).bind(u.id, JSON.stringify(body.save), rev, now).run();

      const s = body.stats || {};
      await env.DB.prepare(
        `INSERT INTO scores (id,name,served,earned,rep,week,updated) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, served=excluded.served,
           earned=excluded.earned, rep=excluded.rep, week=excluded.week, updated=excluded.updated`,
      ).bind(u.id, u.name, Math.floor(s.served || 0), Number(s.earned || 0),
             Number(s.rep || 0), Math.floor(Date.now() / (7 * 86400e3)), now).run();

      return json({ ok: true, rev });
    }

    // ── рейтинг ───────────────────────────────────────────────────────────────
    if (path === '/leaders' && req.method === 'GET') {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const week = Math.floor(Date.now() / (7 * 86400e3));
      const { results } = await env.DB.prepare(
        `SELECT id,name,served,earned,rep FROM scores WHERE week=? ORDER BY served DESC LIMIT 50`,
      ).bind(week).all();
      const me = results.findIndex((r) => r.id === u.id);
      return json({ week, top: results, place: me >= 0 ? me + 1 : null });
    }

    // ── отзывы от модели ──────────────────────────────────────────────────────
    if (path === '/review' && req.method === 'POST') {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const body = await req.json().catch(() => ({}));
      const r = Array.isArray(body.list) ? await reviewBatch(env, body.list) : await review(env, body);
      return json(r);
    }

    // ── комната совместной игры ───────────────────────────────────────────────
    if (path.startsWith('/room/')) {
      const u = await who(req, env);
      if (!u) return json({ error: 'подпись не сошлась' }, 401);
      const roomId = path.slice('/room/'.length).split('/')[0] || u.id;
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      const fwd = new URL(req.url);
      fwd.searchParams.set('id', u.id);
      fwd.searchParams.set('name', u.name);
      fwd.searchParams.set('room', roomId);
      return stub.fetch(new Request(fwd, req));
    }

    return json({ error: 'нет такого маршрута' }, 404);
  },
};
