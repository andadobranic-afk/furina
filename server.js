// Сервер для игры: комнаты, позиции игроков, общие блоки, общее время суток.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const rooms = new Map();          // название комнаты -> { t0, edits, clients }
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Furina server OK. Комнат: ' + rooms.size);
});
const wss = new WebSocketServer({ server });

const send = (c, m) => { if (c.readyState === 1) c.send(JSON.stringify(m)); };
const bcast = (r, m, except) => {
  const s = JSON.stringify(m);
  for (const c of r.clients) if (c !== except && c.readyState === 1) c.send(s);
};
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) { r = { t0: Date.now(), edits: new Map(), clients: new Set() }; rooms.set(name, r); }
  return r;
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 30000) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join' && !ws.room) {
      const name = String(m.room || 'lobby').slice(0, 24).replace(/[^\w\-а-яА-ЯёЁ]/g, '') || 'lobby';
      const r = getRoom(name);
      ws.room = r; ws.rname = name; ws.id = nextId++;
      r.clients.add(ws);
      send(ws, { t: 'hello', id: ws.id, now: Date.now(), t0: r.t0, n: r.clients.size });
      const all = [...r.edits].map(([k, v]) => [...k.split(',').map(Number), v]);
      for (let i = 0; i < all.length; i += 200) send(ws, { t: 'b', b: all.slice(i, i + 200) });
      bcast(r, { t: 'n', n: r.clients.size });
      return;
    }
    if (!ws.room) return;

    if (m.t === 'p') {                       // поза игрока
      const p = { t: 'p', id: ws.id, k: m.k | 0, mv: m.mv ? 1 : 0, run: m.run ? 1 : 0, gr: m.gr ? 1 : 0 };
      for (const k of ['x', 'y', 'z', 'r', 'vy']) p[k] = +m[k] || 0;
      bcast(ws.room, p, ws);
    } else if (m.t === 'b' && Array.isArray(m.b)) {   // правки блоков
      const ok = [];
      for (const e of m.b.slice(0, 200)) {
        if (Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)) {
          ws.room.edits.set(e[0] + ',' + e[1] + ',' + e[2], e[3]); ok.push(e);
        }
      }
      if (ok.length) bcast(ws.room, { t: 'b', b: ok }, ws);
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong' });
    }
  });
  ws.on('close', () => {
    const r = ws.room; if (!r) return;
    r.clients.delete(ws);
    bcast(r, { t: 'l', id: ws.id });
    bcast(r, { t: 'n', n: r.clients.size });
    if (!r.clients.size) setTimeout(() => {      // пустую комнату держим 10 минут
      if (!r.clients.size && rooms.get(ws.rname) === r) rooms.delete(ws.rname);
    }, 600000);
  });
});

// не даём соединениям «зависать»
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; c.ping(); }
}, 25000);

server.listen(PORT, () => console.log('Furina server listening on', PORT));
