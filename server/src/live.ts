// A live session: the people who have one shared project open at once, and the messages between them.
// The owner lifted the rule against a held-open connection for this on 2026-10-20. The room keeps
// nothing: no project, no edit, no name beyond the username of each person connected while they are.
//
// Everything here is a plain function over the people in the room, so the same rules run in the
// Cloudflare Durable Object below and in the local runner (dev.ts) the tests use.
//
// What the room passes on, all as JSON text:
//   from a person                       to whom
//   op       one edit, with its keys    everyone, the sender too, in the room's one order
//   replace  a whole project (undo)     everyone, the sender too
//   state    a whole project for `to`   that one person only (someone joining)
//   presence where the sender is        everyone else
//   transport play, stop, tempo         everyone else
// and what the room says itself:
//   welcome  to someone joining: who they are and who is there
//   join / leave                        to everyone else
//   send-state  to the person longest in the room, asking them to send it to someone joining

export interface Member { id: string; user: string; colour: number; since: number }
export interface Peer extends Member { send(text: string): void }

export const MAX_MESSAGE = 600_000;
export const COLOURS = 8;
const RELAYED = new Set(['op', 'replace', 'state', 'presence', 'transport']);

const member = ({ id, user, colour, since }: Member): Member => ({ id, user, colour, since });
const say = (peer: Peer, message: unknown) => { try { peer.send(JSON.stringify(message)); } catch { /* gone */ } };

// The first colour nobody in the room has.
export function freeColour(peers: Member[]): number {
  for (let colour = 0; colour < COLOURS; colour++) if (!peers.some(peer => peer.colour === colour)) return colour;
  return peers.length % COLOURS;
}

// Someone has joined. `peers` holds everyone, them included.
export function joined(peers: Peer[], peer: Peer) {
  const others = peers.filter(entry => entry.id !== peer.id);
  say(peer, { t: 'welcome', you: member(peer), members: others.map(member) });
  for (const other of others) say(other, { t: 'join', member: member(peer) });
  // The one longest in the room sends the project; with nobody else there, the joiner's own copy is it.
  const host = [...others].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))[0];
  if (host) say(host, { t: 'send-state', to: peer.id });
}

// Someone has left. `peers` holds those still there.
export function left(peers: Peer[], gone: Member) {
  for (const peer of peers) say(peer, { t: 'leave', id: gone.id });
}

// A message from someone in the room, passed on as the table above says. Anything else is dropped.
export function received(peers: Peer[], from: Peer, text: string) {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE) return;
  let message: Record<string, unknown>;
  try { message = JSON.parse(text); } catch { return; }
  if (!message || typeof message !== 'object' || Array.isArray(message) || !RELAYED.has(message.t as string)) return;
  const out = { ...message, from: from.id };
  if (message.t === 'op' || message.t === 'replace') { for (const peer of peers) say(peer, out); return; }
  if (message.t === 'state') {
    const to = peers.find(peer => peer.id === message.to);
    if (to && to.id !== from.id) say(to, out);
    return;
  }
  for (const peer of peers) if (peer.id !== from.id) say(peer, out);
}

// ---------------------------------------------------------------- the Durable Object
// One for each shared project, reached by the Worker after it has checked who is connecting. It uses
// the hibernation API, so a room nobody is talking in costs nothing, and keeps each person's details
// on their own connection, which outlasts the object being put to sleep.

interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface State { acceptWebSocket(socket: Socket): void; getWebSockets(): Socket[] }
declare const WebSocketPair: { new (): { 0: Socket; 1: Socket } };

export class LiveRoomObject {
  constructor(private ctx: State) {}

  private peers(): Peer[] {
    return this.ctx.getWebSockets().flatMap(socket => {
      const details = socket.deserializeAttachment() as Member | null;
      return details ? [{ ...details, send: (text: string) => socket.send(text) }] : [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    const user = request.headers.get('X-Live-User') || '';
    if (!user || request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a live connection.', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const before = this.peers();
    const details: Member = { id: crypto.randomUUID().slice(0, 8), user, colour: freeColour(before), since: Date.now() };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(details);
    joined(this.peers(), { ...details, send: text => server.send(text) });
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'discobot' } } as ResponseInit);
  }

  webSocketMessage(socket: Socket, message: string | ArrayBuffer) {
    const from = socket.deserializeAttachment() as Member | null;
    if (!from || typeof message !== 'string') return;
    received(this.peers(), { ...from, send: text => socket.send(text) }, message);
  }

  webSocketClose(socket: Socket) {
    const gone = socket.deserializeAttachment() as Member | null;
    socket.serializeAttachment(null);
    if (gone) left(this.peers().filter(peer => peer.id !== gone.id), gone);
  }

  webSocketError(socket: Socket) { this.webSocketClose(socket); }
}
