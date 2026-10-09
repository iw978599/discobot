// Guest instruments: another creator's web instrument, shown in a frame as a rack unit.
// The frame is loaded from the creator's own address, so the browser keeps it apart from
// Discobot: it cannot read projects or the signed-in session. The two talk only through
// the messages described in docs/GUEST_PROTOCOL.md.

export interface Guest {
  id: string;
  // The page to load. Always another site's https address (or a local one, for development).
  url: string;
  name: string;
  volume: number;
  muted: boolean;
  // Whatever the guest last reported as its state. Opaque to Discobot; handed back on load.
  state?: unknown;
}

export const MAX_GUESTS = 2;
export const MAX_GUEST_STATE_CHARS = 100_000;
export const GUEST_PROTOCOL = 1;
// How far ahead of the beat a guest plays, and how long its audio is held before it is heard.
// The two cancel out, which is what lets sound cross from the frame and still land on the beat.
export const GUEST_LATENCY_MS = 120;
// A transport that starts this far in the future gives a guest time to hear about it and schedule.
export const GUEST_START_LEAD_SECONDS = 0.35;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// Returns the address in a normal form, or null if it is not one a guest may be loaded from.
// `ownOrigin` is refused: a page from Discobot's own address would not be kept apart from it.
export function guestUrl(value: unknown, ownOrigin?: string): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return null;
  if (ownOrigin && url.origin === ownOrigin) return null;
  url.hash = '';
  return url.toString();
}

export const guestOrigin = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

function guestState(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    const text = JSON.stringify(value);
    return text.length <= MAX_GUEST_STATE_CHARS ? JSON.parse(text) : undefined;
  } catch { return undefined; }
}

const unit = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback);
const label = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, 60);

// Guests read from storage, a file, a link or the account are untrusted like the rest of a project.
export function sanitizeGuests(value: unknown, ownOrigin?: string): Guest[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const guests: Guest[] = [];
  for (const entry of value) {
    const input = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const url = guestUrl(input.url, ownOrigin);
    const id = typeof input.id === 'string' && /^[0-9a-f-]{36}$/.test(input.id) ? input.id : '';
    if (!url || !id || seen.has(id) || guests.length >= MAX_GUESTS) continue;
    seen.add(id);
    const state = guestState(input.state);
    guests.push({ id, url, name: label(input.name, new URL(url).hostname), volume: unit(input.volume, 0.8), muted: input.muted === true, ...(state !== undefined ? { state } : {}) });
  }
  return guests;
}

export function patchGuest(guest: Guest, patch: Record<string, unknown>): Guest {
  const next: Guest = { ...guest };
  if ('name' in patch) next.name = label(patch.name, guest.name);
  if ('volume' in patch) next.volume = unit(patch.volume, guest.volume);
  if ('muted' in patch) next.muted = patch.muted === true;
  if ('state' in patch) {
    const state = guestState(patch.state);
    if (state === undefined) delete next.state; else next.state = state;
  }
  return next;
}

// ---- which sites this browser has agreed to load guests from

const TRUST_KEY = 'discobot_guest_origins_v1';

function trusted(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(TRUST_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}
export const isTrustedOrigin = (origin: string) => trusted().includes(origin);
export function trustOrigin(origin: string) {
  if (!origin || isTrustedOrigin(origin)) return;
  try { localStorage.setItem(TRUST_KEY, JSON.stringify([...trusted(), origin].slice(-50))); } catch { /* asked again next time */ }
}

// ---- the shared clock and the transport as guests hear about it

// Milliseconds on the computer's clock. A frame and its host agree on this, which is what
// their two separate audio clocks are lined up against.
export const wallNow = () => performance.timeOrigin + performance.now();

// The audio-clock time at which sound scheduled now for `wall` is heard, and back again.
export function contextTimeAtWall(context: AudioContext, wall: number): number {
  const stamp = context.getOutputTimestamp?.();
  if (stamp && stamp.performanceTime && stamp.contextTime) return stamp.contextTime + (wall - (performance.timeOrigin + stamp.performanceTime)) / 1000;
  return context.currentTime + (wall - wallNow()) / 1000;
}
export function wallAtContextTime(context: AudioContext, time: number): number {
  const stamp = context.getOutputTimestamp?.();
  if (stamp && stamp.performanceTime && stamp.contextTime) return performance.timeOrigin + stamp.performanceTime + (time - stamp.contextTime) * 1000;
  return wallNow() + (time - context.currentTime) * 1000;
}

// Beat `anchorBeat` happens at `anchorWall`; beats follow at `bpm` until the next message.
export type GuestTransport = { playing: false } | { playing: true; bpm: number; anchorWall: number; anchorBeat: number };

let transport: GuestTransport = { playing: false };
const transportListeners = new Set<(state: GuestTransport) => void>();

export const guestLink = {
  transport: () => transport,
  announce(next: GuestTransport) {
    transport = next;
    transportListeners.forEach(listener => listener(next));
  },
  subscribe(listener: (state: GuestTransport) => void) {
    transportListeners.add(listener);
    return () => { transportListeners.delete(listener); };
  },
};

// Where a block of guest audio goes on the host's audio clock, in frames. Blocks that follow
// on from the last one are placed end to end so tiny clock-reading differences cannot click;
// a real gap or jump (a stall, a restart) is honoured.
export function placeBlock(expectedFrame: number | null, targetFrame: number, sampleRate: number): number {
  if (expectedFrame !== null && Math.abs(targetFrame - expectedFrame) < sampleRate * 0.03) return expectedFrame;
  return Math.round(targetFrame);
}

// Linear resampling, for a guest whose audio runs at a different rate from the host's.
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const length = Math.max(1, Math.round(input.length * to / from));
  const output = new Float32Array(length);
  const step = (input.length - 1) / Math.max(1, length - 1);
  for (let index = 0; index < length; index++) {
    const position = index * step, low = Math.floor(position), high = Math.min(input.length - 1, low + 1);
    output[index] = input[low] + (input[high] - input[low]) * (position - low);
  }
  return output;
}
