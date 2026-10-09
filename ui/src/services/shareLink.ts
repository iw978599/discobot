// A share link carries a whole project inside the address, after the #. Nothing is uploaded:
// whoever has the link has the song, and nobody else does.

export const SHARE_PREFIX = '#song=';
// Browsers and chat apps start to truncate or refuse addresses well before this.
export const MAX_SHARE_LENGTH = 60000;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Things a link does not need: each lane's pattern list repeats its open pattern.
function slim(file: unknown): unknown {
  const copy = structuredClone(file) as { project?: { synths?: Array<{ patterns?: unknown }>; savedPatterns?: unknown } };
  if (copy.project) {
    copy.project.savedPatterns = [];
    copy.project.synths?.forEach(synth => { delete synth.patterns; });
  }
  return copy;
}

export async function encodeShare(file: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(slim(file)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

// Throws if the text is not a share payload. The result is untrusted and still has to go
// through the project store's own checks.
export async function decodeShare(payload: string): Promise<unknown> {
  if (payload.length > MAX_SHARE_LENGTH * 2) throw new Error('Link too long');
  const bytes = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Link too large');
  return JSON.parse(new TextDecoder().decode(bytes));
}

// A published song: the link holds a short code and the song is fetched from the account server.
export const SHORT_PREFIX = '#s=';
export const shortUrl = (code: string, base: string) => `${base.split('#')[0]}${SHORT_PREFIX}${code}`;
export const shortCode = (hash: string) => (hash.startsWith(SHORT_PREFIX) ? hash.slice(SHORT_PREFIX.length).trim().toLowerCase() : null);
// What gets stored or put in a link: the project without what a listener does not need.
export const slimProject = (file: unknown) => slim(file);

export const shareUrl = (payload: string, base: string) => `${base.split('#')[0]}${SHARE_PREFIX}${payload}`;

export const sharePayload = (hash: string) => (hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null);
