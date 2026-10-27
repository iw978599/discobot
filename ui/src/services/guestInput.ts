import type { DrumRow, Scene } from '../types';
import type { ExportArrangement } from './wavExport';
import { DRUM_ROWS, DRUM_ROW_NAMES } from './drumKits';

// A voice of Discobot's own handed to a guest instrument (the `input` feature of the guest
// protocol, docs/GUEST_PROTOCOL.md): the guest asks for a synth lane, the whole kit or one drum,
// which then leaves the mix and its sends and is streamed into the guest, and comes back through
// the guest's own audio. This holds which voice is with which guest and how early it is played.
// It is outside React, like the playhead: the scheduler reads it on every tick, the guest unit on
// every block, and the units that show "→ <guest>" subscribe to it.

export type InputKind = 'synth' | 'drums' | 'drum';
export interface InputSource { id: string; name: string; kind: InputKind }
export interface HandOver { source: string; guestId: string; guestName: string; leadMs: number }

// A voice is played this much further ahead than the guest's own latency, to give the frame time
// to hear it, put it through and send it back.
export const INPUT_LEAD_EXTRA_MS = 120;
export const MAX_INPUT_LEAD_MS = 1000;
// When the guest says blocks arrive late, the lead goes up by what it said and this much more.
export const INPUT_LATE_MARGIN_MS = 20;

// The voices a guest may ask for, with ids that stay the same across reloads and devices: a guest
// saves its choice in its own settings. Never another guest or the whole mix.
export function inputSources(lanes: Array<{ id: number; model: string }>, drums: readonly DrumRow[] = DRUM_ROWS): InputSource[] {
  return [
    ...lanes.map(lane => ({ id: `synth:${lane.id}`, name: `Synth ${lane.id} · ${lane.model}`, kind: 'synth' as const })),
    { id: 'drums', name: 'Drums', kind: 'drums' as const },
    ...drums.map(drum => ({ id: `drum:${drum}`, name: DRUM_ROW_NAMES[drum], kind: 'drum' as const })),
  ];
}

export const leadAfterLate = (leadMs: number, lateMs: number) =>
  Math.min(MAX_INPUT_LEAD_MS, leadMs + Math.max(0, Math.min(MAX_INPUT_LEAD_MS, lateMs)) + INPUT_LATE_MARGIN_MS);

// An export plays the song through to record the guests, and a guest with a voice records it put
// through itself. The render then leaves that voice out, or it would be heard twice: in each bar
// of a song, the voices that were handed over when that bar was played (`byBar`, one list a bar,
// the last carrying on); in a scene, any voice handed over while it played.
export function leaveOutHanded(arrangement: ExportArrangement, byBar: string[][]): ExportArrangement {
  const all = [...new Set(byBar.flat())];
  if (all.length === 0) return arrangement;
  const laneOut = (handed: string[], id: number) => handed.includes(`synth:${id}`);
  const drumOut = (handed: string[], drum: string) => handed.includes('drums') || handed.includes(`drum:${drum}`);
  const silentDrums = <T extends Partial<Record<string, { steps: boolean[] }>>>(drums: T, handed: string[]): T => Object.fromEntries(Object.entries(drums).map(([drum, track]) =>
    [drum, track && drumOut(handed, drum) ? { ...track, steps: track.steps.map(() => false) } : track])) as T;
  if (arrangement.bars) {
    const bars = arrangement.bars.map((bar: Scene, index): Scene => {
      const handed = byBar[Math.min(index, byBar.length - 1)] ?? [];
      return {
        ...bar,
        lanes: Object.fromEntries(Object.entries(bar.lanes).map(([id, steps]) => [id, laneOut(handed, Number(id)) ? [] : steps])),
        drums: silentDrums(bar.drums, handed),
      };
    });
    return { ...arrangement, bars };
  }
  return {
    ...arrangement,
    synths: arrangement.synths.map(lane => (laneOut(all, lane.id) ? { ...lane, muted: true } : lane)),
    drumState: silentDrums(arrangement.drumState, all),
  };
}

type Listener = () => void;

export function createGuestInputs() {
  let sources: InputSource[] = [];
  const handed = new Map<string, HandOver>();
  // Each guest's tap, where a voice it has is sent: an audio node, which this file does not touch.
  const taps = new Map<string, unknown>();
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    sources: () => sources,
    // The voices there are now. A hand-over whose voice has gone is ended; the answer names
    // the guests that lost theirs, which must be told.
    setSources(next: InputSource[]): string[] {
      const changed = JSON.stringify(next) !== JSON.stringify(sources);
      sources = next;
      const ended: string[] = [];
      for (const [source, entry] of handed) {
        if (!next.some(candidate => candidate.id === source)) { handed.delete(source); ended.push(entry.guestId); }
      }
      if (changed || ended.length) notify();
      return ended;
    },
    // A guest asks for a voice, or none. Anything not offered is none, and a voice another guest
    // has stays with it. The answer is what the guest now has.
    select(guestId: string, guestName: string, source: unknown, latencyMs: number): string | null {
      const wanted = typeof source === 'string' && sources.some(candidate => candidate.id === source) ? source : null;
      const holder = wanted ? handed.get(wanted) : undefined;
      if (holder && holder.guestId !== guestId) return this.current(guestId);
      const before = this.current(guestId);
      if (before === wanted) return wanted;
      if (before) handed.delete(before);
      if (wanted) handed.set(wanted, { source: wanted, guestId, guestName, leadMs: Math.min(MAX_INPUT_LEAD_MS, latencyMs + INPUT_LEAD_EXTRA_MS) });
      notify();
      return wanted;
    },
    current(guestId: string): string | null {
      for (const entry of handed.values()) if (entry.guestId === guestId) return entry.source;
      return null;
    },
    // Gives back whatever a guest has: it was removed, reloaded or stopped sending sound.
    release(guestId: string) {
      const source = this.current(guestId);
      if (!source) return;
      handed.delete(source);
      notify();
    },
    late(guestId: string, ms: unknown) {
      const source = this.current(guestId), entry = source ? handed.get(source) : undefined;
      if (!entry || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return;
      entry.leadMs = leadAfterLate(entry.leadMs, ms);
      notify();
    },
    // The guest's latency went up by `by`: the voice must be that much earlier as well.
    latencyRaised(guestId: string, by: number) {
      const source = this.current(guestId), entry = source ? handed.get(source) : undefined;
      if (!entry || !(by > 0)) return;
      entry.leadMs = Math.min(MAX_INPUT_LEAD_MS, entry.leadMs + by);
      notify();
    },
    get: (source: string): HandOver | undefined => handed.get(source),
    setTap(guestId: string, tap: unknown) {
      if (tap) taps.set(guestId, tap); else taps.delete(guestId);
      notify();
    },
    // Where a voice is to go: its guest's tap, once the guest has one; null for the mix.
    tapFor(source: string): unknown {
      const entry = handed.get(source);
      return entry ? taps.get(entry.guestId) ?? null : null;
    },
    // How early a voice is played, in seconds; 0 when it is in the mix.
    leadSeconds: (source: string) => (handed.get(source)?.leadMs ?? 0) / 1000,
    // How far ahead the scheduler must reach for the earliest voice.
    reachSeconds: () => Math.max(0, ...[...handed.values()].map(entry => entry.leadMs)) / 1000,
    all: () => [...handed.values()],
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export type GuestInputs = ReturnType<typeof createGuestInputs>;
// The app's one.
export const guestInputs = createGuestInputs();
