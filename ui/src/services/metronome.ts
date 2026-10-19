// The metronome: a click on every beat while the transport runs, and a bar of clicks before it
// starts. Both are kept per browser, not with the project: they are for the person playing, and
// are never in an export.
import { barQuarters, barTicks, onBeat } from './patternLength';

export interface MetronomeSettings {
  click: boolean;
  countIn: boolean;
  // how many bars the count-in lasts; absent is one, as it always was
  bars?: number;
  // how loud the click is, 0 to 1; absent is CLICK_LEVEL, the level it always had
  level?: number;
}

export const COUNT_IN_CHOICES = [1, 2, 4];
export const CLICK_LEVEL = 0.5;
const KEY = 'discobot_metronome_v1';

// Only what differs from how the metronome always was is kept, so settings from before read the same.
export function asMetronome(value: unknown): MetronomeSettings {
  const stored = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const bars = COUNT_IN_CHOICES.includes(stored.bars as number) && stored.bars !== 1 ? { bars: stored.bars as number } : {};
  const level = typeof stored.level === 'number' && Number.isFinite(stored.level) && stored.level !== CLICK_LEVEL
    ? { level: Math.max(0, Math.min(1, stored.level)) } : {};
  return { click: stored.click === true, countIn: stored.countIn === true, ...bars, ...level };
}

export const countInBars = (settings: MetronomeSettings) => settings.bars ?? 1;
export const clickLevel = (settings: MetronomeSettings) => settings.level ?? CLICK_LEVEL;

export function storedMetronome(): MetronomeSettings {
  try { return asMetronome(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return asMetronome(null); }
}

export function storeMetronome(settings: MetronomeSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(asMetronome(settings))); } catch { /* the next visit starts with it off */ }
}

// Whether a tick of a bar is clicked. A tick is a 32nd note. The beats are the time signature's:
// every eighth tick in 4/4, every twelfth in 6/8. The first of the bar is marked so the bar can
// be heard.
export function clickAt(tickInBar: number, signature?: unknown): 'bar' | 'beat' | null {
  if (!onBeat(signature, tickInBar, barTicks(signature))) return null;
  return tickInBar === 0 ? 'bar' : 'beat';
}

// How long the count-in lasts at a tempo, in seconds and in quarter notes, which is what a tempo
// counts and what guests are told.
export const countInBeats = (bars: number, signature?: unknown) => bars * barQuarters(signature);
export const countInSeconds = (bars: number, tempo: number, signature?: unknown) => countInBeats(bars, signature) * 60 / Math.max(20, tempo);
