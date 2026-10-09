// Password hashing, tokens and codes. Uses only Web Crypto, so it runs the same in a
// Cloudflare Worker and in Node.

// Cloudflare Workers refuse more than 100,000 PBKDF2 iterations.
export const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

export function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function pbkdf2(password: string, salt: BufferSource, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split('$');
  const count = Number(iterations);
  if (scheme !== 'pbkdf2' || !Number.isInteger(count) || count < 1 || count > PBKDF2_ITERATIONS || !salt || !hash) return false;
  return constantTimeEqual(await pbkdf2(password, fromBase64Url(salt), count), fromBase64Url(hash));
}

// For values that are already long and random (session tokens, recovery codes), where a
// slow hash adds nothing.
export async function sha256(text: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

export async function sameText(a: string, b: string) {
  return constantTimeEqual(fromBase64Url(await sha256(a)), fromBase64Url(await sha256(b)));
}

export function newToken() {
  return toBase64Url(randomBytes(32));
}

// No 0, O, 1, I or L, so a code survives being written down and read back.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(groups: number) {
  const characters: string[] = [];
  while (characters.length < groups * 5) {
    // Reject bytes past the last full multiple of the alphabet so every character is equally likely.
    for (const byte of randomBytes(32)) {
      if (byte < 248 && characters.length < groups * 5) characters.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
    }
  }
  return Array.from({ length: groups }, (_, group) => characters.slice(group * 5, group * 5 + 5).join('')).join('-');
}

export const newRecoveryCode = () => randomCode(5);
export const newInviteCode = () => randomCode(3);
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
