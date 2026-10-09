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

export const MAX_GUESTS = 4;

// Instruments whose creators have agreed to be offered here by name. Each is still another
// site's page, loaded only when the user adds it.
export const FEATURED_GUESTS: Array<{ name: string; by: string; about: string; url: string }> = [
  { name: 'Choir', by: 'Aaron Van Dorn', about: 'A generative choral synthesizer: a melody that slowly mutates, sung in vowels', url: 'https://aaronvandorn.github.io/Choir/' },
  { name: 'Logic Rhythm', by: 'Aaron Van Dorn', about: 'A drum machine sequenced by logic gates', url: 'https://aaronvandorn.github.io/Logic-Rhythm/' },
  { name: 'Boolean Melody Machine', by: 'Aaron Van Dorn', about: 'Melody and harmony from Boolean logic and Euclidean clocks', url: 'https://aaronvandorn.github.io/Boolean-Melody-Machine/' },
  { name: 'Tape Loop Deck', by: 'Aaron Van Dorn', about: 'A tape loop simulator with a mixing deck and effects', url: 'https://aaronvandorn.github.io/Tape-Loop-Deck/' },
];
export const MAX_GUEST_STATE_CHARS = 100_000;
export const GUEST_PROTOCOL = 1;
// How far ahead of the beat a guest plays, and how long its audio is held before it is heard.
// The two cancel out, which is what lets sound cross from the frame and still land on the beat.
export const GUEST_LATENCY_MS = 120;
// If a guest's audio keeps arriving too late to play, it is asked to play earlier still, up to this.
export const MAX_GUEST_LATENCY_MS = 480;
export const GUEST_LATENCY_STEP_MS = 60;
// On top of its latency, a guest needs this long to hear about a start and schedule its first beat.
const GUEST_REACTION_SECONDS = 0.23;
// The first start after a guest loads is slower: it has yet to switch its audio on.
const COLD_START_LEAD_SECONDS = 0.9;

// The latency to use once a run of blocks has arrived late by up to `lateSeconds`: enough to
// cover what was missing, with a little to spare, in whole steps.
export function latencyAfterLateBlocks(current: number, lateSeconds: number): number {
  const needed = Math.max(0, lateSeconds) * 1000 + 20;
  return Math.min(MAX_GUEST_LATENCY_MS, current + Math.ceil(needed / GUEST_LATENCY_STEP_MS) * GUEST_LATENCY_STEP_MS);
}

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

// The guest settings a scene carries, by guest id, checked like any other stored guest data.
export function sanitizeSceneGuests(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [id, state] of Object.entries(value).slice(0, MAX_GUESTS * 2)) {
    const clean = /^[0-9a-f-]{36}$/.test(id) ? guestState(state) : undefined;
    if (clean !== undefined) kept[id] = clean;
  }
  return Object.keys(kept).length ? kept : undefined;
}

// The level and mute a scene holds for each guest.
export function sanitizeGuestMix(value: unknown): Record<string, { volume: number; muted: boolean }> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const kept: Record<string, { volume: number; muted: boolean }> = {};
  for (const [id, mix] of Object.entries(value).slice(0, MAX_GUESTS * 2)) {
    if (!/^[0-9a-f-]{36}$/.test(id) || !mix || typeof mix !== 'object') continue;
    kept[id] = { volume: unit((mix as { volume?: unknown }).volume, 0.8), muted: (mix as { muted?: unknown }).muted === true };
  }
  return Object.keys(kept).length ? kept : undefined;
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

// The guests that are connected: how early each plays, and whether it has been started before.
const connected = new Map<string, { latencyMs: number; warm: boolean }>();
// For each connected guest, a way to fetch its settings right now and save them.
const captures = new Map<string, () => Promise<void>>();

export const guestLink = {
  connect(id: string, latencyMs: number) { connected.set(id, { latencyMs, warm: connected.get(id)?.warm ?? false }); },
  disconnect(id: string) { connected.delete(id); captures.delete(id); },
  onCapture(id: string, capture: () => Promise<void>) { captures.set(id, capture); },
  // Asks every guest for its settings and waits, briefly, for them to be saved. Run before the
  // open scene is left, so what the guest was just set to is recorded in that scene and not the next.
  async captureAll(): Promise<void> { await Promise.all([...captures.values()].map(capture => capture().catch(() => {}))); },
  // How far ahead the transport should place its first beat so every connected guest can make it.
  startLead(): number {
    let lead = 0;
    for (const guest of connected.values()) lead = Math.max(lead, guest.warm ? guest.latencyMs / 1000 + GUEST_REACTION_SECONDS : COLD_START_LEAD_SECONDS);
    return lead;
  },
  transport: () => transport,
  announce(next: GuestTransport) {
    transport = next;
    // Once started, a guest has its audio running and can start promptly from then on.
    if (next.playing) for (const guest of connected.values()) guest.warm = true;
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

// ---- recording guests for export
//
// An export is rendered faster than real time, and a guest cannot do that. So for an export
// the arrangement is played through once and each guest's audio is kept as it arrives, placed
// by its time stamp against the start of the transport.

export interface GuestTake { left: Float32Array; right: Float32Array }

let capture: { anchorWall: number; sampleRate: number; frames: number; takes: Map<string, GuestTake>; expected: Map<string, number> } | null = null;

export const guestCapture = {
  active: () => capture !== null,
  // `anchorWall` is when the arrangement's first beat is heard.
  start(anchorWall: number, seconds: number, sampleRate = 44100) {
    capture = { anchorWall, sampleRate, frames: Math.ceil(seconds * sampleRate), takes: new Map(), expected: new Map() };
  },
  feed(guestId: string, wall: number, rate: number, left: Float32Array, right: Float32Array, latencyMs = GUEST_LATENCY_MS) {
    if (!capture) return;
    let take = capture.takes.get(guestId);
    if (!take) { take = { left: new Float32Array(capture.frames), right: new Float32Array(capture.frames) }; capture.takes.set(guestId, take); }
    const l = resample(left, rate, capture.sampleRate), r = resample(right, rate, capture.sampleRate);
    // The guest played this early by the agreed latency; add it back to get the time in the song.
    const target = (wall + latencyMs - capture.anchorWall) / 1000 * capture.sampleRate;
    const start = placeBlock(capture.expected.get(guestId) ?? null, target, capture.sampleRate);
    capture.expected.set(guestId, start + l.length);
    for (let index = 0; index < l.length; index++) {
      const frame = start + index;
      if (frame < 0 || frame >= capture.frames) continue;
      take.left[frame] = l[index];
      take.right[frame] = r[index];
    }
  },
  stop(): Map<string, GuestTake> {
    const takes = capture?.takes ?? new Map<string, GuestTake>();
    capture = null;
    return takes;
  },
};
