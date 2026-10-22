// Recording a session as audio (roadmap V24): what this browser hears (the music, everyone's notes
// in a live session, guests), taken from the engine's output by the browser's own MediaRecorder and
// compressed as it goes. When it stops the take is a file, which the studio keeps as a recording and
// puts on an audio track. Nothing leaves the browser. One recording at a time; its state is kept
// here, outside React, and read with useSyncExternalStore.

// Formats the browser may record in, best first: each is one the same browser can decode again.
export const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
// Longer than any jam is likely to be, and at about 128 kb/s well under what a sample may hold.
export const MAX_RECORDING_MS = 30 * 60 * 1000;

export function recordingType(supported: (type: string) => boolean): string | null {
  return RECORDING_TYPES.find(type => { try { return supported(type); } catch { return false; } }) ?? null;
}

export const extensionFor = (type: string) => (type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm');

// "Session 2026-10-22 21.05" from when it began; the file's own ending says what it is.
export function takeName(started: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `Session ${started.getFullYear()}-${two(started.getMonth() + 1)}-${two(started.getDate())} ${two(started.getHours())}.${two(started.getMinutes())}`;
}

export interface RecordingState { recording: boolean; startedAt: number }
const IDLE: RecordingState = { recording: false, startedAt: 0 };

let state: RecordingState = IDLE;
const listeners = new Set<() => void>();
const tell = (next: RecordingState) => { state = next; listeners.forEach(listener => listener()); };

let current: { recorder: MediaRecorder; chunks: Blob[]; release: () => void; type: string; limit: ReturnType<typeof setTimeout>; done: Promise<File | null>; finish: (file: File | null) => void } | null = null;

export const sessionRecorder = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  supported: () => typeof MediaRecorder !== 'undefined' && recordingType(type => MediaRecorder.isTypeSupported(type)) !== null,
  // Starts recording `source` (the engine's output). `onLimit` is told when MAX_RECORDING_MS stops it.
  start(source: { stream: MediaStream; release: () => void }, onLimit: () => void): boolean {
    if (current || typeof MediaRecorder === 'undefined') return false;
    const type = recordingType(candidate => MediaRecorder.isTypeSupported(candidate));
    if (!type) { source.release(); return false; }
    const recorder = new MediaRecorder(source.stream, { mimeType: type, audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [], started = new Date();
    let finish: (file: File | null) => void = () => {};
    const done = new Promise<File | null>(resolve => { finish = resolve; });
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      source.release();
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      finish(blob.size > 0 ? new File([blob], `${takeName(started)}.${extensionFor(type)}`, { type: blob.type }) : null);
    };
    recorder.start(1000);
    current = { recorder, chunks, release: source.release, type, limit: setTimeout(onLimit, MAX_RECORDING_MS), done, finish };
    tell({ recording: true, startedAt: started.getTime() });
    return true;
  },
  // Stops, and answers the take as a file, or null when nothing was recorded.
  async stop(): Promise<File | null> {
    const recording = current;
    if (!recording) return null;
    current = null;
    clearTimeout(recording.limit);
    tell(IDLE);
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
    else { recording.release(); recording.finish(null); }
    return recording.done;
  },
};

// Minutes and seconds since a time, for the running clock on the button.
export function elapsed(since: number, now = Date.now()): string {
  const whole = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
