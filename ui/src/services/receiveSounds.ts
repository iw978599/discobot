import type { DrumInstrument } from '../types';
import { MAX_KIT_FILES, matchKit } from './kitImport';
import { guestUrl } from './guests';

// Drum sounds sent from another web app, shown in Import Kit (docs/SEND_PROTOCOL.md). The sender
// opens Discobot with `#receive`, or is a guest in a frame on the rack; either way it is told
// `ready`, sends `sounds`, and is answered `done` or `error`. Everything in a message is untrusted,
// and nothing is stored until the dialog's Import.

export const RECEIVE_HASH = '#receive';
export const MAX_SENT_BYTES = 8 * 1024 * 1024;
const MAX_FROM_CHARS = 60;
const LANES: readonly DrumInstrument[] = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash'];

export interface SentFile { name: string; lane: DrumInstrument | null; data: ArrayBuffer }
export interface SentSounds { from: string; files: SentFile[]; offered: number }
export type Reply = (message: { type: 'done'; imported: number } | { type: 'error'; message: string }) => void;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const tidy = (text: string, most: number) => text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, most);

// A message of this handshake, kept apart from a guest's `discobotGuest` ones.
export function importMessage(data: unknown): Record<string, unknown> | null {
  const message = record(data);
  return message && message.discobotImport === 1 && typeof message.type === 'string' ? message : null;
}

// A sender must be https, or this machine while developing, and never Discobot itself.
export function senderOrigin(origin: string, ownOrigin: string): boolean {
  if (!guestUrl(origin, ownOrigin)) return false;
  try { return new URL(origin).origin === origin; } catch { return false; }
}

export const siteOf = (origin: string) => { try { return new URL(origin).host; } catch { return origin; } };

// A file's name as a sample's is kept: no path or control characters, and ending in .wav.
function fileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = tidy(value.replace(/^.*[\\/]/, ''), 200);
  if (!name) return null;
  return /\.wav$/i.test(name) ? name : `${name.slice(0, 196)}.wav`;
}

// The checks on a `sounds` message: its version, the sender's name, and each file's name, lane and
// bytes. A file that fails is left out; a message with none left is an error to answer.
export function readSounds(data: unknown): SentSounds | { error: string } {
  const message = record(data);
  if (!message || message.v !== 1) return { error: 'This version of the message is not one Discobot understands.' };
  if (!Array.isArray(message.files) || message.files.length === 0) return { error: 'No sounds were sent.' };
  const from = (typeof message.from === 'string' ? tidy(message.from, MAX_FROM_CHARS) : '') || 'another app';
  const files: SentFile[] = [];
  for (const value of message.files.slice(0, MAX_KIT_FILES)) {
    const entry = record(value);
    const name = fileName(entry?.name);
    const bytes = entry?.data;
    if (!name || !(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > MAX_SENT_BYTES) continue;
    const lane = LANES.includes(entry!.lane as DrumInstrument) ? entry!.lane as DrumInstrument : null;
    files.push({ name, lane, data: bytes });
  }
  if (files.length === 0) return { error: 'None of the sounds could be used: each must be a WAV file of up to 8 MB.' };
  return { from, files, offered: message.files.length };
}

// The file each lane starts with in the dialog: the lane a file was sent for, the first such
// when two ask for one lane (the other is left on no lane), and then for the files sent for no
// lane, what their names suggest, on the lanes still free.
export function kitChoice(files: Array<{ name: string; lane: DrumInstrument | null }>): Partial<Record<DrumInstrument, number>> {
  const choice: Partial<Record<DrumInstrument, number>> = {};
  const unplaced: number[] = [];
  files.forEach((file, index) => {
    if (file.lane === null) unplaced.push(index);
    else if (choice[file.lane] === undefined) choice[file.lane] = index;
  });
  const guessed = matchKit(unplaced.map(index => files[index].name));
  for (const lane of LANES) {
    const at = guessed[lane];
    if (at !== undefined && choice[lane] === undefined) choice[lane] = unplaced[at];
  }
  return choice;
}

// Whether the browser can play a file. Done on its own context, so the app's audio is not started.
export async function canDecode(data: ArrayBuffer): Promise<boolean> {
  try {
    await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data.slice(0));
    return true;
  } catch {
    return false;
  }
}

export interface Offer {
  from: string;
  site: string;
  files: File[];
  picked: number;
  initial: Partial<Record<DrumInstrument, number>>;
}

// The one set of sent sounds on show, outside React: a second sender while one is shown is
// told so. `finish` is called when the dialog closes, with how many files it kept.
export function createSoundInbox(decode: (data: ArrayBuffer) => Promise<boolean> = canDecode) {
  let current: Offer | null = null, reply: Reply | null = null, busy = false;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  return {
    current: () => current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async take(data: unknown, origin: string, answer: Reply): Promise<void> {
      if (busy || current) { answer({ type: 'error', message: 'Discobot is already showing sounds sent to it. Finish with those first.' }); return; }
      const read = readSounds(data);
      if ('error' in read) { answer({ type: 'error', message: read.error }); return; }
      busy = true;
      const kept: SentFile[] = [];
      try {
        for (const file of read.files) if (await decode(file.data)) kept.push(file);
      } finally {
        busy = false;
      }
      if (kept.length === 0) { answer({ type: 'error', message: 'None of the sounds is a WAV file this browser can play.' }); return; }
      current = {
        from: read.from,
        site: siteOf(origin),
        files: kept.map(file => new File([file.data], file.name, { type: 'audio/wav' })),
        picked: Math.max(read.offered, kept.length),
        initial: kitChoice(kept),
      };
      reply = answer;
      changed();
    },
    finish(imported: number) {
      if (!current) return;
      const answer = reply;
      current = null; reply = null;
      changed();
      answer?.({ type: 'done', imported });
    },
  };
}

export type SoundInbox = ReturnType<typeof createSoundInbox>;
export const soundInbox = createSoundInbox();

// Takes `#receive` off the address at once, so a reload or a bookmark does not wait for a sender
// and the page is chosen as it always is. Whether this page was opened to receive: the address
// had it and there is a page that opened this one.
export function takeReceiveLink(win: Pick<Window, 'location' | 'history' | 'opener'> = window): boolean {
  if (win.location.hash !== RECEIVE_HASH) return false;
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return Boolean(win.opener);
}

type Listening = Pick<Window, 'opener' | 'addEventListener' | 'removeEventListener'> & { location: { origin: string } };

// Listens to the page that opened this one, takes the first `sounds` it sends and nothing after,
// and tells it `ready`. Answers go to the origin the sounds came from.
export function listenToOpener(win: Listening, inbox: SoundInbox): () => void {
  const opener = win.opener as Window | null;
  if (!opener) return () => {};
  let taken = false;
  const onMessage = (event: MessageEvent) => {
    if (taken || event.source !== opener) return;
    const message = importMessage(event.data);
    if (!message || message.type !== 'sounds' || !senderOrigin(event.origin, win.location.origin)) return;
    taken = true;
    const origin = event.origin;
    void inbox.take(message, origin, answer => opener.postMessage({ discobotImport: 1, ...answer }, origin));
  };
  win.addEventListener('message', onMessage);
  // The sender's address is not known yet, and the message carries nothing.
  opener.postMessage({ discobotImport: 1, type: 'ready' }, '*');
  return () => win.removeEventListener('message', onMessage);
}

// `#receive` is read before the first render (main.tsx), and the opener listened to from when the
// studio has its project for the rest of the page's life: once, whatever renders twice.
let receiving = false;
export const startReceiveLink = () => { receiving = takeReceiveLink(); };
export function receiveFromOpener() {
  if (!receiving) return;
  receiving = false;
  listenToOpener(window, soundInbox);
}
