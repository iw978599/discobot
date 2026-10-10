import { createDefaultSynthParameters } from '@discobot/engine';
import type { DrumInstrument, DrumSettings, SynthParameters } from '../types';
import { DRUM_KITS } from './drumKits';

// Kids mode: a page of big pads for a small child. It is a page of its own (`#kids`) that never
// opens the projects, so nothing made there can change, delete or share one. What a child makes
// is kept in this browser under its own key and is not a project.

export const KIDS_HASH = '#kids';
export const isKidsLink = (hash: string) => hash === KIDS_HASH;

// Both go through a reload, so the page being left stops its sound and saves what it has.
export function enterKidsMode() {
  window.location.hash = KIDS_HASH;
  window.location.reload();
}
export function leaveKidsMode() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.location.reload();
}

// How long the way out has to be held. A small child presses things; they rarely hold them.
export const KIDS_LEAVE_HOLD_MS = 3000;
// The output level, out of 1. There is no volume control in kids mode.
export const KIDS_VOLUME = 0.5;
// The loop is two bars of eighth notes: slow enough that a tap lands where it was meant.
export const KIDS_STEPS = 16;
export const KIDS_TEMPOS = { slow: 80, fast: 110 } as const;
export type KidsTempo = keyof typeof KIDS_TEMPOS;

export type KidsPad = { label: string; picture: string; color: string } & ({ note: string } | { drum: DrumInstrument });

// Six notes of one five-note scale, low to high, so no two pads clash, then three drums.
export const KIDS_PADS: KidsPad[] = [
  { label: 'Bear', picture: '🐻', color: '#e5484d', note: 'C4' },
  { label: 'Dog', picture: '🐶', color: '#f76b15', note: 'D4' },
  { label: 'Cat', picture: '🐱', color: '#f5c518', note: 'E4' },
  { label: 'Rabbit', picture: '🐰', color: '#46a758', note: 'G4' },
  { label: 'Chick', picture: '🐥', color: '#3e9bf0', note: 'A4' },
  { label: 'Mouse', picture: '🐭', color: '#a66bff', note: 'C5' },
  { label: 'Drum', picture: '🥁', color: '#f2f2f2', drum: 'kick' },
  { label: 'Clap', picture: '👏', color: '#ffb3c7', drum: 'clap' },
  { label: 'Sparkle', picture: '✨', color: '#9be7e0', drum: 'closedHH' },
];

const sound = (changes: Partial<SynthParameters>): SynthParameters => ({
  ...createDefaultSynthParameters(), gain: 0.8, fxSends: { reverb: 0, delay: 0, drive: 0, phaser: 0, chorus: 0 }, ...changes,
});

// The sounds a child picks from, by picture. Set by reasoning, not by ear.
export const KIDS_SOUNDS: Array<{ label: string; picture: string; params: SynthParameters }> = [
  { label: 'Bell', picture: '🔔', params: sound({
    engine: 'fm', fm: { algorithm: 1, ratio: 3.5, index: 0.6, decay: 0.4, feedback: 0 },
    envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 },
  }) },
  { label: 'Piano', picture: '🎹', params: sound({
    oscillator: { type: 'triangle', detune: 0, pulseWidth: 0.5 },
    filter: { frequency: 4000, q: 1, type: 'lowpass', envAmount: 0, keyTracking: 0, drive: 0, slope: 12 },
    envelope: { attack: 0.005, decay: 0.35, sustain: 0.25, release: 0.25 },
  }) },
  { label: 'Horn', picture: '🎺', params: sound({
    oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    filter: { frequency: 1400, q: 1.2, type: 'lowpass', envAmount: 0.4, keyTracking: 0, drive: 0, slope: 12 },
    envelope: { attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.2 },
  }) },
  { label: 'Robot', picture: '🤖', params: sound({
    oscillator: { type: 'square', detune: 0, pulseWidth: 0.5 },
    filter: { frequency: 2500, q: 1, type: 'lowpass', envAmount: 0, keyTracking: 0, drive: 0, slope: 12 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3 },
  }) },
];

export const kidsDrumSettings = (drum: DrumInstrument): DrumSettings => DRUM_KITS[0].instrumentDefaults[drum];

export interface KidsState {
  // which of KIDS_SOUNDS the note pads play
  sound: number;
  tempo: KidsTempo;
  // notes[pad][step]: whether that pad plays on that step of the loop
  notes: boolean[][];
}

export const blankKids = (): KidsState => ({
  sound: 0, tempo: 'slow', notes: KIDS_PADS.map(() => Array<boolean>(KIDS_STEPS).fill(false)),
});

// What a first visit starts with: a drum and a clap to play along to, so Play does something at once.
export function starterKids(): KidsState {
  const state = blankKids();
  const pad = (drum: DrumInstrument) => KIDS_PADS.findIndex(entry => 'drum' in entry && entry.drum === drum);
  for (const step of [0, 4, 8, 12]) state.notes[pad('kick')][step] = true;
  for (const step of [2, 6, 10, 14]) state.notes[pad('clap')][step] = true;
  return state;
}

// Storage is not trusted: anything that is not the right shape becomes the blank value for its place.
export function sanitizeKids(input: unknown): KidsState {
  const blank = blankKids();
  if (!input || typeof input !== 'object') return blank;
  const { sound: chosen, tempo, notes } = input as Record<string, unknown>;
  return {
    sound: Number.isInteger(chosen) && (chosen as number) >= 0 && (chosen as number) < KIDS_SOUNDS.length ? chosen as number : 0,
    tempo: tempo === 'fast' ? 'fast' : 'slow',
    notes: blank.notes.map((row, pad) => {
      const stored = Array.isArray(notes) ? notes[pad] : null;
      return row.map((_, step) => Array.isArray(stored) && stored[step] === true);
    }),
  };
}

export const withNote = (state: KidsState, pad: number, step: number): KidsState => (
  state.notes[pad]?.[step] !== false ? state
    : { ...state, notes: state.notes.map((row, index) => (index === pad ? row.map((on, at) => on || at === step) : row)) }
);

// The last step the loop scheduled: how many steps in, when it sounds, and how long a step is.
export interface KidsStep { count: number; time: number; duration: number }

// Which step a tap at `now` belongs to: the nearest one, so a tap a little early or late still
// lands on the beat it was aimed at.
export const stepNearest = (last: KidsStep, now: number) => Math.max(0, last.count + Math.round((now - last.time) / last.duration));

const KIDS_KEY = 'discobot_kids_v1';

export function loadKids(): KidsState {
  try {
    const stored = localStorage.getItem(KIDS_KEY);
    return stored === null ? starterKids() : sanitizeKids(JSON.parse(stored));
  } catch { return starterKids(); }
}

export function saveKids(state: KidsState) {
  try { localStorage.setItem(KIDS_KEY, JSON.stringify(state)); } catch { /* kept for this visit only */ }
}
