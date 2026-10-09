import { createServer } from 'node:http';
import { handle, type Env } from './src/index.ts';
import { createLocalDatabase } from './src/localDatabase.ts';

// Runs the API on this machine with a database that lives in memory, for development and
// the browser tests. `POST /__reset` empties it; that route does not exist in the Worker.
const port = Number(process.env.PORT || 8787);
const env = (): Env => ({
  DB: createLocalDatabase(),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:4173,http://localhost:4173',
  OWNER_INVITE: process.env.OWNER_INVITE || 'local-owner-invite',
});
let current = env();

createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
  const method = incoming.method || 'GET';
  let response: Response;
  if (method === 'POST' && incoming.url === '/__reset') {
    current = env();
    response = new Response('reset');
  } else {
    response = await handle(new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method, headers, body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : Buffer.concat(chunks),
    }), current);
  }
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`Discobot API (local, in memory) on http://127.0.0.1:${port}`));
