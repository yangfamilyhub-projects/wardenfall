// Wardenfall multiplayer relay. It only keeps rooms and forwards messages:
// the boss runs in the host's browser, so this never needs to change with the game.
//
// Client -> relay                         Relay -> client
//   {t:'list'}         watch open rooms     {t:'rooms', rooms:[{id,name,players,meta}]}
//   {t:'host', name}   open a room          {t:'hosted', room, you}
//   {t:'meta', meta}   host updates listing
//   {t:'join', room, name}                  {t:'joined', room, you, host, peers:[{id,name}]} or {t:'error', msg}
//   {t:'to', to, d}    to: 'all' | 'host' | peer id      {t:'msg', from, d}
//   {t:'leave'}                             {t:'peer+', id, name} / {t:'peer-', id} / {t:'closed'}
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3410;
const BIND = process.env.BIND || '127.0.0.1';
const MAX_PLAYERS = 4, MAX_ROOMS_PER_SITE = 40, MAX_MSG = 64 * 1024;
const RATE = 90, BURST = 180;   // messages per second per socket (the game sends ~30), with headroom for bursts
const ORIGIN_OK = /^https?:\/\/((.+\.)?zizzy\.name|localhost|127\.0\.0\.1)(:\d+)?$/;

const sites = new Map();   // Host header -> { rooms: Map(id -> room), watchers: Set(socket) }
let nextId = 1;

function site(name) {
  let s = sites.get(name);
  if (!s) { s = { rooms: new Map(), watchers: new Set() }; sites.set(name, s); }
  return s;
}
function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
const clean = (v, n) => String(v == null ? '' : v).replace(/[^\w .'-]/g, '').slice(0, n);

function listing(s) {
  return [...s.rooms.values()].map(r => ({ id: r.id, name: r.name, players: r.members.size, full: r.members.size >= MAX_PLAYERS, meta: r.meta }));
}
function pushRooms(s) { const rooms = listing(s); for (const w of s.watchers) send(w, { t: 'rooms', rooms }); }

function leave(ws) {
  const r = ws.room; if (!r) return;
  ws.room = null; r.members.delete(ws.id);
  const s = site(ws.site);
  if (r.host === ws) {
    for (const m of r.members.values()) { m.room = null; send(m, { t: 'closed' }); }
    s.rooms.delete(r.id);
  } else {
    for (const m of r.members.values()) send(m, { t: 'peer-', id: ws.id });
  }
  pushRooms(s);
}

function onMessage(ws, raw) {
  if (raw.length > MAX_MSG) return;
  const now = Date.now();
  ws.tokens = Math.min(BURST, ws.tokens + (now - ws.lastAt) / 1000 * RATE); ws.lastAt = now;
  if (ws.tokens < 1) return;   // flooding: drop
  ws.tokens -= 1;
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  const s = site(ws.site), r = ws.room;
  switch (m.t) {
    case 'list':
      s.watchers.add(ws); send(ws, { t: 'rooms', rooms: listing(s) }); break;
    case 'unlist':
      s.watchers.delete(ws); break;
    case 'host': {
      leave(ws); s.watchers.delete(ws);
      if (s.rooms.size >= MAX_ROOMS_PER_SITE) { send(ws, { t: 'error', msg: 'Too many fights open right now' }); break; }
      let id; do { id = crypto.randomBytes(3).toString('hex'); } while (s.rooms.has(id));
      ws.name = clean(m.name, 24) || 'Hunter';
      const room = { id, name: ws.name, host: ws, members: new Map([[ws.id, ws]]), meta: {} };
      s.rooms.set(id, room); ws.room = room;
      send(ws, { t: 'hosted', room: id, you: ws.id }); pushRooms(s); break;
    }
    case 'meta':
      if (r && r.host === ws && m.meta && typeof m.meta === 'object') { r.meta = m.meta; pushRooms(s); }
      break;
    case 'join': {
      const room = s.rooms.get(String(m.room));
      if (!room) { send(ws, { t: 'error', msg: 'That fight has ended' }); break; }
      if (room.members.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'That fight is full' }); break; }
      leave(ws); s.watchers.delete(ws);
      ws.name = clean(m.name, 24) || 'Hunter';
      const peers = [...room.members.values()].map(p => ({ id: p.id, name: p.name }));
      for (const p of room.members.values()) send(p, { t: 'peer+', id: ws.id, name: ws.name });
      room.members.set(ws.id, ws); ws.room = room;
      send(ws, { t: 'joined', room: room.id, you: ws.id, host: room.host.id, peers }); pushRooms(s); break;
    }
    case 'to': {
      if (!r) break;
      const out = JSON.stringify({ t: 'msg', from: ws.id, d: m.d });
      if (m.to === 'all') { for (const p of r.members.values()) if (p !== ws && p.readyState === 1) p.send(out); }
      else { const p = m.to === 'host' ? r.host : r.members.get(m.to); if (p && p !== ws && p.readyState === 1) p.send(out); }
      break;
    }
    case 'leave':
      leave(ws); break;
  }
}

const server = http.createServer((req, res) => { res.writeHead(426, { 'Content-Type': 'text/plain' }); res.end('WebSocket only\n'); });
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || '';
  if (!ORIGIN_OK.test(origin)) { ws.close(1008, 'origin'); return; }
  ws.id = nextId++; ws.site = String(req.headers.host || '').toLowerCase(); ws.room = null; ws.alive = true;
  ws.tokens = BURST; ws.lastAt = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', data => onMessage(ws, data.toString()));
  ws.on('close', () => { leave(ws); site(ws.site).watchers.delete(ws); });
  ws.on('error', () => {});
});
// Drop sockets that stop answering pings (closed laptops, dead mobile connections)
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [name, s] of sites) if (!s.rooms.size && !s.watchers.size) sites.delete(name);
}, 15000).unref();

server.listen(PORT, BIND, () => console.log(`wardenfall relay on ${BIND}:${PORT}`));
