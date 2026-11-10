// Serves the trial page on http://localhost:8790/ from the folder given (the downloaded artifact's web/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const root = process.argv[2] ?? '.';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.fxp': 'application/octet-stream' };
createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.includes('..')) { response.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(root, path || 'index.html'));
    response.writeHead(200, { 'content-type': TYPES[extname(path || 'index.html')] ?? 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(8790, '127.0.0.1', () => console.log('Surge trial on http://localhost:8790/'));
