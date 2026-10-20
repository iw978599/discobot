import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { freeColour, joined, left, received, type Peer } from './src/live.ts';

// Live sessions for the local runner (dev.ts) and the browser tests: just enough of a WebSocket server
// (the handshake, and unfragmented text, ping and close frames) to run the same room rules as the
// Durable Object, with no dependency. Never deployed.

const rooms = new Map<string, Peer[]>();
export const resetRooms = () => rooms.clear();

export function acceptLive(request: IncomingMessage, socket: Duplex, room: string, user: string) {
  const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, 'Sec-WebSocket-Protocol: discobot', '', ''].join('\r\n'));
  const peers = rooms.get(room) ?? [];
  rooms.set(room, peers);
  const peer: Peer = { id: randomUUID().slice(0, 8), user, colour: freeColour(peers), since: Date.now(), send: text => socket.write(frame(Buffer.from(text))) };
  peers.push(peer);
  joined(peers, peer);

  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (let next = read(pending); next; next = read(pending)) {
      pending = pending.subarray(next.used);
      if (next.opcode === 8) { socket.end(frame(Buffer.alloc(0), 8)); return; }
      if (next.opcode === 9) socket.write(frame(next.payload, 10));
      else if (next.opcode === 1) received(peers, peer, next.payload.toString('utf8'));
    }
  });
  const gone = () => {
    const at = peers.indexOf(peer);
    if (at < 0) return;
    peers.splice(at, 1);
    left(peers, peer);
  };
  socket.on('close', gone);
  socket.on('error', gone);
}

function frame(payload: Buffer, opcode = 1): Buffer {
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x80 | opcode, length])
    : length < 65536 ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(length)); return size; })()]);
  return Buffer.concat([header, payload]);
}

function read(buffer: Buffer): { opcode: number; payload: Buffer; used: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f, masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f, at = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); at = 4; }
  else if (length === 127) { if (buffer.length < 10) return null; length = Number(buffer.readBigUInt64BE(2)); at = 10; }
  const mask = at;
  if (masked) at += 4;
  if (buffer.length < at + length) return null;
  const payload = Buffer.from(buffer.subarray(at, at + length));
  if (masked) for (let i = 0; i < length; i++) payload[i] ^= buffer[mask + (i % 4)];
  return { opcode, payload, used: at + length };
}
