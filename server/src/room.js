// Комната пункта: держит вебсокеты игроков и рассылает их движение.
//
// Один Durable Object на пункт. Внутри — авторитетный список присутствующих;
// позиции игроков расходятся всем, кто в комнате.

const TICK_MS = 100;          // как часто рассылаем сводку позиций
const IDLE_MS = 45000;        // молчит дольше — считаем, что отвалился

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map();   // ws → { id, name, x, y, dir, carry, seen }
    this.timer = null;
    this.host = null;         // чей это пункт: он считает мир, остальные смотрят
    this.snap = null;         // последний снимок мира от хоста
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/who')) {
      return Response.json({ count: this.peers.size, players: this.list() });
    }
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('нужен websocket', { status: 426 });
    }

    const id = url.searchParams.get('id') || '';
    const name = url.searchParams.get('name') || 'Игрок';
    const room = url.searchParams.get('room') || '';
    if (!id) return new Response('нет игрока', { status: 400 });
    // Комната названа по владельцу пункта, и считать мир может только он.
    // Гость чужой бизнес не симулирует: иначе он бы решал, что там происходит.
    if (room && room === id) this.host = id;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // один игрок — одно соединение: старое закрываем
    for (const [ws, p] of this.peers) {
      if (p.id === id) { try { ws.close(1000, 'переподключение'); } catch { /* уже закрыт */ } this.peers.delete(ws); }
    }
    this.peers.set(server, { id, name, x: 12, y: 11, dir: 1, carry: 0, seen: Date.now() });

    server.addEventListener('message', (e) => this.onMessage(server, e));
    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));

    this.send(server, { t: 'hello', you: id, host: this.host, players: this.list(), snap: this.snap });
    this.broadcast({ t: 'join', player: this.peers.get(server) }, server);
    this.start();

    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, e) {
    const p = this.peers.get(ws);
    if (!p) return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    p.seen = Date.now();
    if (m.t === 'move') {
      p.x = Math.max(-8, Math.min(40, Number(m.x) || 0));
      p.y = Math.max(-8, Math.min(40, Number(m.y) || 0));
      p.dir = m.dir === -1 ? -1 : 1;
      p.carry = Math.max(0, Number(m.carry) || 0);
    } else if (m.t === 'emote') {
      this.broadcast({ t: 'emote', id: p.id, kind: String(m.kind || '').slice(0, 12) }, ws);
    } else if (m.t === 'snap' && p.id === this.host) {
      // снимок мира рассылаем всем, кроме самого хоста
      this.snap = m.s;
      this.broadcast({ t: 'snap', s: m.s }, ws);
    } else if (m.t === 'ping') {
      this.send(ws, { t: 'pong' });
    }
  }

  drop(ws) {
    const p = this.peers.get(ws);
    this.peers.delete(ws);
    if (p) this.broadcast({ t: 'left', id: p.id });
    // Ушёл хозяин — пункт замирает. Передавать его гостю нельзя: это чужой
    // бизнес, и решать за него никто, кроме владельца, не должен.
    if (p && p.id === this.host) {
      this.host = null;
      this.snap = null;
      this.broadcast({ t: 'host', id: null });
    }
    if (!this.peers.size) this.stop();
  }

  list() {
    return [...this.peers.values()].map(({ id, name, x, y, dir, carry }) => ({ id, name, x, y, dir, carry }));
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* закрыт */ } }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.peers.keys()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { this.peers.delete(ws); }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [ws, p] of this.peers) {
        if (now - p.seen > IDLE_MS) { try { ws.close(1000, 'тишина'); } catch { /* уже закрыт */ } this.drop(ws); }
      }
      if (this.peers.size > 1) this.broadcast({ t: 'sync', players: this.list() });
    }, TICK_MS);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
