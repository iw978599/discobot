import type { Automation } from '../types';
import { transposeNote } from '../utils/midiExport';
import type { Hits, Placed, SampleSong } from './sampleSong';

// The songs offered on an empty project, each in another style and each showing off other parts of
// the app: time signatures, the recorded instruments, strummed and inverted chords, swing, the
// arpeggiator, the lanes' own effects, the aux buses and automation. Every song plays all five lanes
// and lasts at least two minutes. Steps are sixteenths of the bar from 0; a bar of 3/4 or 6/8 has
// 12, 5/4 20, 7/8 14 and 12/8 24.

const up = (note: string, semitones: number) => transposeNote(note, semitones) ?? note;
const strum = (amount: number) => ({ strum: amount });
const late = (amount: number) => ({ offset: amount });
// A value for every step of a scene, from one level to another, or held.
const ramp = (steps: number, from: number, to: number): Array<number | null> => Array.from({ length: steps }, (_, index) => Number((from + (to - from) * index / Math.max(1, steps - 1)).toFixed(3)));
const held = (steps: number, value: number): Array<number | null> => Array(steps).fill(value);
// A slow vibrato on the second LFO, in semitones at its widest.
const vibrato = (depth: number, rate = 5.5) => ({ lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate, depth, sync: false, retrigger: true } });
const glide = (seconds: number) => ({ portamento: { enabled: true, glide: seconds, fingered: false, speed: false } });
// Four bars played twice, for an eight-bar scene.
const twice = <T>(bars: T[]): T[] => [...bars, ...bars];
// A bar of notes moved up or down, chords and all.
const moved = (bar: Placed[], semitones: number): Placed[] => bar.map(([step, notes, ...rest]): Placed => [step, Array.isArray(notes) ? notes.map(note => up(note, semitones)) : up(notes, semitones), ...rest]);
const chordBars = (chords: string[][], length: number, velocity: number): Placed[][] => chords.map((chord): Placed[] => [[0, chord, length, velocity]]);
const BARS_8 = 8 * 16;

// ---------------------------------------------------------------- Night Circuit (dark synthwave, 4/4)
// F minor at 104 BPM, after the darker side of synthwave: a Pro One bass pulsing in sixteenths and
// pushed down by every kick (its duck), a Juno running the chords through its arpeggiator, an OB pad,
// an MS-20 lead screaming through the overdrive, and OB brass stabbing the off-beats. The chords are
// F minor, D flat, B flat minor and C major, the harmonic minor's dominant; the bridge turns to G
// flat, a half step above home.

const CIRCUIT_ROOTS = ['F2', 'C#2', 'A#1', 'C2'];
const CIRCUIT_PADS = [['F3', 'G#3', 'C4'], ['F3', 'G#3', 'C#4'], ['F3', 'A#3', 'C#4'], ['E3', 'G3', 'C4']];
const CIRCUIT_ARPS = CIRCUIT_PADS.map(chord => chord.map(note => up(note, 12)));
const UNDERTOW_ROOTS = ['F#2', 'C#2', 'D#2', 'C2'];
const UNDERTOW_PADS = [['F#3', 'A#3', 'C#4'], ['F3', 'G#3', 'C#4'], ['D#3', 'F#3', 'A#3'], ['E3', 'G3', 'C4']];
const UNDERTOW_ARPS = UNDERTOW_PADS.map(chord => chord.map(note => up(note, 12)));
// Sixteen pulses a bar, the first of each beat the hardest, and the octave on the last but one.
const pulse = (root: string): Placed[] => Array.from({ length: 16 }, (_, step): Placed => [step, step === 14 ? up(root, 12) : root, 1, step % 4 === 0 ? 1 : 0.7]);
const stabs = (chords: string[][]) => chords.map((chord): Placed[] => [[6, chord.map(note => up(note, 12)), 2, 0.75], [14, chord.map(note => up(note, 12)), 2, 0.85]]);
const RUN_TUNE: Placed[][] = [
  [[0, 'C5', 2], [2, 'G#4', 2], [4, 'F4', 4], [8, 'G4', 2], [10, 'G#4', 2], [12, 'C5', 4]],
  [[0, 'C#5', 6], [6, 'C5', 2], [8, 'G#4', 6], [14, 'F4', 2]],
  [[0, 'F4', 2], [2, 'G#4', 2], [4, 'A#4', 4], [8, 'C#5', 4], [12, 'C5', 2], [14, 'A#4', 2]],
  [[0, 'C5', 8], [8, 'E4', 4], [12, 'G4', 4]],
];
// The same tune an octave's reach higher, for the climb.
const HIGH_TUNE: Placed[][] = [
  [[0, 'F5', 4], [4, 'D#5', 2], [6, 'C5', 2], [8, 'G#4', 4], [12, 'C5', 4]],
  [[0, 'C#5', 4], [4, 'F5', 4], [8, 'G#5', 6], [14, 'F5', 2]],
  [[0, 'F5', 2], [2, 'C#5', 2], [4, 'A#4', 4], [8, 'C#5', 2], [10, 'F5', 2], [12, 'A#5', 4]],
  [[0, 'G5', 8], [8, 'E5', 4], [12, 'C5', 4]],
];
const UNDERTOW_TUNE: Placed[][] = [[[0, 'C#5', 16, 0.7]], [[0, 'C#5', 8, 0.7], [8, 'F5', 8, 0.7]], [[0, 'F#5', 16, 0.75]], [[0, 'E5', 8, 0.75], [8, 'G5', 8, 0.8]]];
const HATS16: Array<[number, number]> = Array.from({ length: 16 }, (_, step): [number, number] => [step, step % 4 === 0 ? 0.5 : step % 2 === 0 ? 0.35 : 0.22]);
// The same hats with the quietest ones left to chance, so no two bars are quite alike.
const LOOSE_HATS16 = HATS16.map(([step, velocity]): [number, number, number, number] => [step, velocity, 1, step % 2 ? 0.7 : 1]);
const CIRCUIT_BEAT: Hits = { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: LOOSE_HATS16, openHH: [[14, 0.5]] };
const CIRCUIT_DRIVE: Hits = { ...CIRCUIT_BEAT, snare: [[4, 0.8], [12, 0.8]] };
const CIRCUIT_FILL: Hits = { ...CIRCUIT_DRIVE, snare2: [[12, 0.8], [13, 0.85]], ride: [[14, 0.9], [15, 0.95]], openHH: [] };
const CIRCUIT_SWEEP: Hits = { closedHH: HATS16, openHH: [[14, 0.5]], snare: [[12, 0.4], [13, 0.5], [14, 0.6], [15, 0.7]] };
const circuitBars = (beat: Hits, crashes: number[]): Hits[] => Array.from({ length: 8 }, (_, bar) => (bar === 7 ? CIRCUIT_FILL : crashes.includes(bar) ? { ...beat, crash: [0] } : beat));

const NIGHT_CIRCUIT: SampleSong = {
  id: 'night-circuit', name: 'Night Circuit', genre: 'Dark synthwave',
  hint: 'Dark synthwave in F minor at 104 BPM on five named lanes: a pulsing Pro One bass ducked by the kick, a Juno through its arpeggiator, an OB pad with a slow second layer, an MS-20 lead gliding through the overdrive with a vibrato, OB brass stabs, and hats left partly to chance',
  tempo: 104, kit: 'punchy-modern', drumVolume: 0.42, level: 0.59,
  lanes: [
    { preset: 'builtin-bass-pro', name: 'Pulse Bass', octaveShift: -1, sound: { duck: 0.5, fxSends: { reverb: 0 } } },
    // Played harder, brighter: the velocity opens the filter by a modulation route.
    { preset: 'builtin-keys-juno', name: 'Arp', sound: { arpeggiator: { enabled: true, mode: 'up', rate: '1/16', gate: 0.5, octaves: 2 }, modMatrix: [{ source: 'velocity', destination: 'filter', depth: 0.3 }], fxSends: { reverb: 0.2, auxA: 0.3 } } },
    { preset: 'builtin-pad-ob', name: 'Night Pad', sound: { duck: 0.35, layer: { enabled: true, mix: 0.35, detune: 12, brightness: -1, attack: 0.8, width: 0.8 }, inserts: { chorus: { mix: 0.35, depth: 0.55, rate: 0.83 } }, fxSends: { reverb: 0.4 } } },
    { preset: 'builtin-lead-ms', name: 'Screamer', octaveShift: 1, sound: { ...glide(0.06), ...vibrato(0.25), fxSends: { drive: 0.45, reverb: 0.25, auxA: 0.35 } } },
    { preset: 'builtin-keys-ob', name: 'Brass Stabs', sound: { fxSends: { reverb: 0.3 } } },
  ],
  effects: {
    drive: { enabled: true, amount: 0.5, tone: 0.55, kind: 'overdrive' },
    delay: { enabled: true, time: 0.43, feedback: 0.45, mix: 0.25, sync: '1/8d', color: 0.4, wow: 0.1 },
    reverb: { enabled: true, kind: 'hall', decay: 3.5, mix: 0.3, preDelay: 0.02, damping: 0.35 },
    aux: [{ kind: 'echo', level: 0.55, main: 0.43, shape: 0.45, sync: '1/8d' }, { kind: 'hall', level: 0.8, main: 4, shape: 0.35 }],
  },
  scenes: [
    // The arpeggio alone, its filter opening; the pad underneath, the hats coming in, the lead far off.
    { id: 'circuit-ignition', name: 'Ignition', color: 'blue', bars: 8,
      lanes: { 2: twice(chordBars(CIRCUIT_ARPS, 16, 0.8)), 3: twice(chordBars(CIRCUIT_PADS, 16, 0.55)), 4: [[], [], [], [], ...['C5', 'C#5', 'C#5', 'C5'].map((note): Placed[] => [[0, note, 16, 0.5]])] },
      drums: [{}, {}, {}, {}, { closedHH: HATS16 }, { closedHH: HATS16 }, { closedHH: HATS16 }, CIRCUIT_SWEEP],
      automation: { 2: { cutoff: ramp(BARS_8, 300, 5000) }, 4: { auxBSend: held(BARS_8, 0.7) } } },
    { id: 'circuit-pulse', name: 'Pulse', color: 'violet', bars: 8,
      lanes: { 1: twice(CIRCUIT_ROOTS.map(pulse)), 2: twice(chordBars(CIRCUIT_ARPS, 16, 0.8)), 3: twice(chordBars(CIRCUIT_PADS, 16, 0.6)), 5: [[], [], [], [], ...stabs(CIRCUIT_PADS)] },
      drums: circuitBars(CIRCUIT_BEAT, []) },
    { id: 'circuit-run', name: 'Run', color: 'red', bars: 8,
      lanes: { 1: twice(CIRCUIT_ROOTS.map(pulse)), 2: twice(chordBars(CIRCUIT_ARPS, 16, 0.8)), 3: twice(chordBars(CIRCUIT_PADS, 16, 0.6)), 4: twice(RUN_TUNE), 5: twice(stabs(CIRCUIT_PADS)) },
      drums: circuitBars(CIRCUIT_DRIVE, [0]) },
    // A half step up to G flat, down through E flat minor to C: the lead held, its echo growing, no kick.
    { id: 'circuit-undertow', name: 'Undertow', color: 'teal', bars: 8,
      lanes: { 1: twice(UNDERTOW_ROOTS.map((root): Placed[] => [[0, root, 16, 0.8]])), 2: twice(chordBars(UNDERTOW_ARPS, 16, 0.7)), 3: twice(chordBars(UNDERTOW_PADS, 16, 0.6)), 4: twice(UNDERTOW_TUNE), 5: [[], [], [], [], [], [], [], [[0, CIRCUIT_PADS[3].map(note => up(note, 12)), 16, 0.6]]] },
      drums: [...Array<Hits>(4).fill({ closedHH: HATS16.filter(([step]) => step % 2 === 0) }), { closedHH: HATS16 }, { closedHH: HATS16 }, { closedHH: HATS16 }, CIRCUIT_SWEEP],
      automation: { 4: { auxASend: ramp(BARS_8, 0.2, 0.75) }, 3: { cutoff: held(BARS_8, 1200) } } },
    // The lead an octave's reach higher, dirtier and brighter as the section goes on.
    { id: 'circuit-overdrive', name: 'Overdrive', color: 'pink', bars: 8,
      lanes: { 1: twice(CIRCUIT_ROOTS.map(pulse)), 2: twice(chordBars(CIRCUIT_ARPS, 16, 0.85)), 3: twice(chordBars(CIRCUIT_PADS, 16, 0.65)), 4: [...RUN_TUNE, ...HIGH_TUNE], 5: twice(stabs(CIRCUIT_PADS)) },
      drums: circuitBars(CIRCUIT_DRIVE, [0, 4]),
      automation: { 4: { drive: ramp(BARS_8, 0.1, 0.7), cutoff: ramp(BARS_8, 2500, 9000) } } },
    // The arpeggio closes again and fades; the pad is last.
    { id: 'circuit-shutdown', name: 'Shutdown', color: 'blue', bars: 8,
      lanes: { 1: [CIRCUIT_ROOTS.map(pulse)[0], [], [], [], [], [], [], []], 2: twice(chordBars(CIRCUIT_ARPS, 16, 0.7)), 3: twice(chordBars(CIRCUIT_PADS, 16, 0.5)), 4: [[[0, 'C5', 16, 0.6]], [], [], [], [], [], [], []] },
      drums: [{ kick: [[0, 0.8]], closedHH: HATS16 }, { kick: [[0, 0.6]], closedHH: HATS16 }, { kick: [[0, 0.4]] }, {}, {}, {}, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_8, 5000, 300) }, 3: { cutoff: ramp(BARS_8, 2500, 300) } } },
  ],
  // 72 bars at 104 BPM: two minutes and 46 seconds.
  order: [['circuit-ignition', 1], ['circuit-pulse', 1], ['circuit-run', 2], ['circuit-undertow', 1], ['circuit-overdrive', 2], ['circuit-run', 1], ['circuit-shutdown', 1]],
};

// ---------------------------------------------------------------- Sixth Street Shout (jazz, after Mingus)
// After Charles Mingus's gospel-blues records: the bass begins alone, slowly, with a blues line; then
// a fast 6/8 church shout over F7, B flat 7, D7, G7 and C7, the horns coming in one at a time with
// riffs that lock together (a baritone growling under the bass, a trombone smearing between notes
// on its glide, a tenor answering), hand claps on the backbeat, the drums comping by chance. In the
// middle the band drops to a 4/4 dirge in F minor for the trombone, then the shout comes back
// faster and faster (each scene its own tempo) until every horn plays at once, and an amen.

const SHOUT_PROG = ['F7', 'F7', 'Bb7', 'Bb7', 'F7', 'D7', 'G7', 'C7'];
// How far each chord's riff is moved from F's.
const SHOUT_SHIFT: Record<string, number> = { F7: 0, Bb7: 5, D7: -3, G7: 2, C7: -5, Fm7: 0, Bbm7: 5, Db7: -4 };
const SHOUT_VOICINGS: Record<string, string[]> = {
  F7: ['A3', 'D#4', 'G4'], Bb7: ['G#3', 'D4', 'G4'], D7: ['F#3', 'C4', 'E4'], G7: ['F3', 'B3', 'E4'], C7: ['E3', 'A#3', 'D4'],
  Fm7: ['G#3', 'C4', 'D#4'], Bbm7: ['G#3', 'C#4', 'F4'], Db7: ['F3', 'B3', 'D#4'],
};
// The blues line under the shout: the root, the minor third, the fourth, the sharp fourth, the fifth, the seventh.
const BLUES_LINE = [0, 3, 5, 6, 7, 10];
const BLUES_ACCENTS = [1, 0.7, 0.8, 0.75, 0.9, 0.7];
const shoutBass = SHOUT_PROG.map((name): Placed[] => BLUES_LINE.map((semitones, eighth): Placed => [eighth * 2, up('F2', semitones + SHOUT_SHIFT[name]), 2, BLUES_ACCENTS[eighth]]));
const riff = (a: Placed[], b: Placed[]) => SHOUT_PROG.map((name, bar) => moved(bar % 2 ? b : a, SHOUT_SHIFT[name]));
const bari = riff([[0, 'F2', 3, 0.95], [4, 'G#2', 2, 0.8], [6, 'A2', 2, 0.85], [8, 'C3', 4, 0.9]], [[0, 'D#3', 2, 0.85], [2, 'C3', 2, 0.75], [4, 'A2', 2, 0.8], [6, 'F2', 6, 0.9]]);
const tenorRiff = riff([[6, 'C5', 2, 0.85], [8, 'A4', 2, 0.75], [10, 'C5', 2, 0.85]], [[0, 'D#5', 4, 0.9], [4, 'D5', 2, 0.75], [6, 'C5', 6, 0.85]]);
const boneRiff = riff([[0, 'A3', 6, 0.8], [6, 'C4', 6, 0.8]], [[0, 'D#4', 12, 0.85]]);
// Gospel piano: the chord on the off-beats either side of the backbeat, rolled.
const shoutPiano = SHOUT_PROG.map((name): Placed[] => {
  const chord = SHOUT_VOICINGS[name];
  return [[2, chord, 2, 0.5, strum(1 / 32)], [6, chord, 4, 0.7, strum(1 / 16)], [10, chord, 2, 0.5]];
});
const TENOR_SOLO: Placed[][] = [
  [[0, 'C5', 2], [2, 'D#5', 2], [4, 'F5', 4], [8, 'D#5', 2], [10, 'C5', 2]],
  [[0, 'A4', 2], [2, 'C5', 2], [4, 'D#5', 2], [6, 'D5', 2], [8, 'C5', 4]],
  [[0, 'F5', 6, 0.95], [6, 'G#5', 2], [8, 'F5', 2], [10, 'D5', 2]],
  [[0, 'D#5', 2], [2, 'D5', 2], [4, 'C5', 2], [6, 'A#4', 6]],
  [[0, 'F5', 2], [2, 'F5', 2], [4, 'G#5', 2], [6, 'A5', 6, 1]],
  [[0, 'F#5', 4], [4, 'D5', 2], [6, 'C5', 2], [8, 'A4', 4]],
  [[0, 'B4', 2], [2, 'D5', 2], [4, 'F5', 2], [6, 'E5', 2], [8, 'D5', 2], [10, 'A#4', 2]],
  [[0, 'A4', 2], [2, 'G4', 2], [4, 'E4', 2], [6, 'F4', 6]],
];
// The trombone's own line when everyone plays at once: long notes it glides between.
const BONE_LINE: Placed[][] = [
  [[0, 'F3', 4], [4, 'A3', 4], [8, 'C4', 4]], [[0, 'D#4', 6], [6, 'D4', 6]], [[0, 'D4', 4], [4, 'F4', 8]], [[0, 'G#4', 6], [6, 'F4', 6]],
  [[0, 'A3', 2], [2, 'C4', 2], [4, 'D#4', 8]], [[0, 'F#4', 6], [6, 'D4', 6]], [[0, 'F4', 6], [6, 'B3', 6]], [[0, 'A#3', 6], [6, 'A3', 6]],
];
// The bass alone, slowly: the blues line climbing, then falling back.
const BASS_INTRO: Placed[][] = [
  ...Array.from({ length: 3 }, (): Placed[][] => [
    [[0, 'F2', 4, 1], [4, 'G#2', 2, 0.8], [6, 'A#2', 2, 0.8], [8, 'B2', 2, 0.85], [10, 'C3', 4, 0.9], [14, 'D#2', 2, 0.7]],
    [[0, 'F2', 6, 0.95], [6, 'C2', 2, 0.75], [8, 'D#2', 2, 0.8], [10, 'E2', 2, 0.85], [12, 'F2', 4, 0.9]],
  ]).flat(),
  [[0, 'F2', 4, 1], [4, 'G#2', 2, 0.8], [6, 'A#2', 2, 0.8], [8, 'B2', 2, 0.85], [10, 'C3', 4, 0.9], [14, 'D#2', 2, 0.7]],
  [[0, 'F2', 8, 0.9], [10, 'C3', 2, 0.7], [12, 'B2', 2, 0.75], [14, 'C3', 2, 0.8]],
];
// The dirge, half as fast in 4/4 and in F minor: a walking bass, the baritone holding the roots.
const DIRGE_PROG = ['Fm7', 'Fm7', 'Bbm7', 'Bbm7', 'Fm7', 'Db7', 'C7', 'C7'];
const DIRGE_WALK = [['F2', 'G#2', 'A#2', 'B2'], ['C3', 'A#2', 'G#2', 'G2'], ['A#1', 'C#2', 'F2', 'G#2'], ['A2', 'A#2', 'G#2', 'F2'],
  ['F2', 'C2', 'D#2', 'E2'], ['C#2', 'F2', 'G#2', 'B2'], ['C2', 'E2', 'G2', 'A#2'], ['C3', 'A#2', 'G2', 'E2']];
const dirgeBass = DIRGE_WALK.map((bar): Placed[] => bar.map((note, beat): Placed => [beat * 4, note, 4, beat === 0 ? 0.95 : 0.8]));
const dirgeBari = DIRGE_PROG.map((name): Placed[] => moved([[0, 'F2', 8, 0.7], [8, 'C3', 8, 0.6]], SHOUT_SHIFT[name]));
// The piano on the beat, and a gospel tremolo (a chord struck four times in a step) on the fourth.
const dirgePiano = DIRGE_PROG.map((name): Placed[] => [[0, SHOUT_VOICINGS[name], 8, 0.55, strum(1 / 16)], [12, SHOUT_VOICINGS[name].map(note => up(note, 12)), 4, 0.4, { ratchet: 4 }]]);
const dirgeTenor = ['G#4', 'G4', 'G#4', 'G#4', 'G#4', 'B4', 'A#4', 'G4'].map((note): Placed[] => [[0, note, 16, 0.45]]);
const DIRGE_BONE: Placed[][] = [
  [[0, 'C4', 6, 0.85], [6, 'D#4', 2, 0.75, late(0.5)], [8, 'F4', 8, 0.9]],
  [[0, 'G#4', 4, 0.85], [4, 'G4', 2, 0.7, late(0.67)], [6, 'F4', 2, 0.75], [8, 'D#4', 4, 0.8], [12, 'C4', 4, 0.75]],
  [[0, 'C#4', 8, 0.85], [8, 'F4', 4, 0.8], [12, 'G#4', 4, 0.85]],
  [[0, 'A#4', 12, 0.95], [12, 'G#4', 4, 0.75]],
  [[0, 'C5', 4, 1], [4, 'B4', 2, 0.8, late(0.67)], [6, 'A#4', 2, 0.8], [8, 'G#4', 4, 0.85], [12, 'F4', 4, 0.8]],
  [[0, 'F4', 8, 0.85], [8, 'G#4', 4, 0.8], [12, 'B4', 4, 0.85]],
  [[0, 'A#4', 6, 0.9], [6, 'G4', 2, 0.75, late(0.5)], [8, 'E4', 8, 0.85]],
  [[0, 'G4', 4, 0.8], [4, 'E4', 4, 0.75], [8, 'C4', 8, 0.8]],
];

// 6/8: the ride on the two dotted beats and the eighths between, the hats' foot on the backbeat; the
// kick, the snare's comping and the second clap are left to chance, as a drummer feels them.
const SIX_RIDE: Hits = { crash: [[0, 0.75], [4, 0.5], [6, 0.7], [8, 0.35, 1, 0.5], [10, 0.5]], closedHH: [[6, 0.45]], kick: [[0, 0.5], [9, 0.3, 1, 0.4]] };
const SIX_CLAPS: Hits = { ...SIX_RIDE, clap: [[6, 0.9], [10, 0.45, 1, 0.4]] };
const SIX_SHOUT: Hits = { ...SIX_CLAPS, snare: [[4, 0.35, 1, 0.5], [6, 0.75], [11, 0.4, 1, 0.5]] };
const SIX_FILL: Hits = { ...SIX_RIDE, snare: [[0, 0.5], [2, 0.6], [4, 0.7], [6, 0.8], [8, 0.9], [10, 1, 2]], snare2: [[9, 0.8], [11, 0.85]] };
const phrase = (beat: Hits, last: Hits = SIX_FILL): Hits[] => [...Array<Hits>(7).fill(beat), last];
const SLOW_RIDE: Hits = { crash: [[0, 0.55], [4, 0.5], [7, 0.3, 1, 0.6], [8, 0.5], [12, 0.5], [15, 0.3, 1, 0.6]], closedHH: [[4, 0.4], [12, 0.4]], kick: [[0, 0.3]], snare: [[12, 0.35, 1, 0.5]] };
const SLOW_FILL: Hits = { ...SLOW_RIDE, snare: [[8, 0.4], [10, 0.5], [12, 0.6, 2], [14, 0.75, 3]], snare2: [[13, 0.7]], ride: [[11, 0.6]] };

const SIXTH_STREET: SampleSong = {
  id: 'sixth-street-shout', name: 'Sixth Street Shout', genre: 'Jazz, after Mingus',
  hint: 'Gospel-blues jazz after Charles Mingus: the upright bass alone at 76 BPM, then a 6/8 church shout at 150 with hand claps, the horns coming in one riff at a time (a baritone, a gliding trombone, a tenor sax), a Steinway rolling gospel chords, a 4/4 dirge in F minor at 66 for the trombone, and the shout again ever faster, at 168 and 184, until the horns all play at once',
  tempo: 150, kit: 'recorded', drumVolume: 0.7, level: 0.66,
  lanes: [
    { preset: 'builtin-bass', name: 'Upright', octaveShift: -1, sound: { fxSends: { reverb: 0.15 } } },
    { preset: 'builtin-keys-steinway-grand', name: 'Piano', sound: { fxSends: { reverb: 0.3, auxB: 0.15 } } },
    // The tenor's recording played an octave and more lower, darker: a baritone.
    { preset: 'builtin-lead-tenor-sax', name: 'Baritone', octaveShift: -1, sound: { gain: 1.0, pan: -0.3, inserts: { tone: -0.35, drive: 0.15 }, fxSends: { reverb: 0.2 } } },
    { preset: 'builtin-lead-tenor-sax', name: 'Tenor Sax', sound: { gain: 2.2, ...vibrato(0.2, 5), pan: 0.25, fxSends: { reverb: 0.25, auxB: 0.3 } } },
    // Brass that slides between its notes: a trombone.
    { preset: 'builtin-lead-cs80', name: 'Trombone', octaveShift: -1, sound: { ...glide(0.09), ...vibrato(0.15, 4.5), pan: -0.1, inserts: { tone: -0.3 }, fxSends: { reverb: 0.3, auxB: 0.2 } } },
  ],
  // The ride is the cymbal lane; the hand claps ring out into the room, the kick not at all.
  drums: {
    crash: { cymbalType: 'ride', volume: 0.55, reverbSend: 0.6 }, snare: { volume: 0.55 }, clap: { volume: 0.7 },
    closedHH: { volume: 0.5, reverbSend: 0.6 }, kick: { volume: 0.6, reverbSend: 0 },
  },
  drumSends: { reverb: 0.35 },
  effects: {
    reverb: { enabled: true, kind: 'room', decay: 1.1, mix: 0.28, preDelay: 0.01, damping: 0.4 },
    aux: [{ kind: 'echo', level: 0.5, main: 0.4, shape: 0.5, sync: '1/8' }, { kind: 'hall', level: 0.75, main: 2.2, shape: 0.4 }],
  },
  scenes: [
    // The bass alone; the piano's low clusters and the ride come in at the end.
    { id: 'shout-bass', name: 'Bass Alone', color: 'blue', bars: 8, tempo: 76,
      lanes: { 1: BASS_INTRO, 2: [[], [], [], [], [], [], [[0, ['F2', 'C3', 'D#3', 'G#3'], 16, 0.45]], [[0, ['F2', 'B2', 'D#3', 'A3'], 8, 0.4]]] },
      drums: [{}, {}, {}, {}, {}, {}, { crash: [[0, 0.4], [4, 0.4], [8, 0.45], [12, 0.5]] }, { crash: [[0, 0.5], [4, 0.5]], snare: [[8, 0.4], [10, 0.5], [12, 0.6, 2], [14, 0.75, 3]] }] },
    // The shout begins: the blues line, the baritone under it, and the hand claps.
    { id: 'shout-riff', name: 'Riff', color: 'violet', signature: '6/8', bars: 8, lanes: { 1: shoutBass, 3: bari }, drums: phrase(SIX_CLAPS) },
    // The trombone and the tenor come in, each with its own riff, and the piano.
    { id: 'shout-horns', name: 'Horns', color: 'red', signature: '6/8', bars: 8, lanes: { 1: shoutBass, 2: shoutPiano, 3: bari, 4: tenorRiff, 5: boneRiff }, drums: phrase(SIX_SHOUT) },
    { id: 'shout-tenor', name: 'Tenor Shout', color: 'pink', signature: '6/8', bars: 8, lanes: { 1: shoutBass, 2: shoutPiano, 3: bari, 4: TENOR_SOLO, 5: boneRiff }, drums: phrase(SIX_SHOUT),
      automation: { 4: { auxBSend: ramp(8 * 12, 0.2, 0.5) } } },
    // Half as fast and in the minor: the trombone's turn.
    { id: 'shout-dirge', name: 'Dirge', color: 'teal', bars: 8, tempo: 66, lanes: { 1: dirgeBass, 2: dirgePiano, 3: dirgeBari, 4: dirgeTenor, 5: DIRGE_BONE }, drums: [...Array<Hits>(7).fill(SLOW_RIDE), SLOW_FILL] },
    { id: 'shout-faster', name: 'Faster', color: 'red', signature: '6/8', bars: 8, tempo: 168, lanes: { 1: shoutBass, 2: shoutPiano, 3: bari, 4: tenorRiff, 5: boneRiff }, drums: phrase(SIX_SHOUT) },
    // Every horn at once, each with a line of its own.
    { id: 'shout-collective', name: 'Everybody', color: 'pink', signature: '6/8', bars: 8, tempo: 184, lanes: { 1: shoutBass, 2: shoutPiano, 3: bari, 4: TENOR_SOLO, 5: BONE_LINE },
      drums: phrase({ ...SIX_SHOUT, clap: [[6, 0.9], [10, 0.6]] }) },
    // A last chord with the blue note in it, a roll on the ride, and its resolution.
    { id: 'shout-amen', name: 'Amen', color: 'blue', bars: 4, tempo: 56,
      lanes: {
        1: [[[0, 'F2', 32, 0.9]], [], [[0, 'F1', 32, 0.85]], []],
        2: [[[0, ['F3', 'A3', 'D#4', 'G#4'], 32, 0.65, strum(1 / 8)]], [], [[0, ['F3', 'A3', 'C4', 'D4'], 32, 0.6, strum(1 / 8)]], []],
        3: [[[0, 'F2', 32, 0.8]], [], [[0, 'F2', 32, 0.7]], []],
        4: [[[0, 'G#4', 32, 0.85]], [], [[0, 'A4', 32, 0.8]], []],
        5: [[[0, 'D#4', 32, 0.8]], [], [[0, 'C4', 32, 0.75]], []],
      },
      drums: [
        { crash: [[0, 0.3, 4], [4, 0.4, 4], [8, 0.5, 4], [12, 0.6, 4]] },
        { crash: [[0, 0.7, 4], [4, 0.8, 4], [8, 0.9, 4], [12, 1, 4]], snare: [[8, 0.5, 4], [12, 0.7, 4]] },
        { kick: [[0, 1]], snare: [[0, 0.9]], crash: [[0, 1]] }, {},
      ] },
  ],
  // About two minutes and 50 seconds, counting each scene at its own tempo.
  order: [['shout-bass', 1], ['shout-riff', 2], ['shout-horns', 2], ['shout-tenor', 2], ['shout-dirge', 1], ['shout-riff', 1], ['shout-faster', 2], ['shout-collective', 2], ['shout-amen', 1]],
};

// ---------------------------------------------------------------- Late Study (lo-fi hip hop, 4/4)
// D minor, swung: the drums by their Swing knob and the keys and bass by their lanes' Swing. A
// two-five-one into the four (E half-diminished, A7 flat nine, D minor nine, G minor nine) on an FM
// electric piano made dusty by its own drive, tone and chorus; a felt piano with the tune; bells
// answering through a tape echo; a breathy pad; and a bridge to B flat.

const LOFI_CHORDS = [['E3', 'G3', 'A#3', 'D4'], ['G3', 'A#3', 'C#4', 'E4'], ['F3', 'A3', 'C4', 'E4'], ['F3', 'A#3', 'D4', 'A4']];
const LOFI_ROOTS = ['E2', 'A1', 'D2', 'G2'];
const LOFI_BRIDGE = [['A3', 'D4', 'F4'], ['G3', 'C4', 'E4'], ['F3', 'A#3', 'D4', 'A4'], ['G3', 'A#3', 'C#4', 'E4']];
const LOFI_BRIDGE_ROOTS = ['A#1', 'A1', 'G1', 'A1'];
const lofiKeys = (chords: string[][]) => twice(chords.map((chord): Placed[] => [[0, chord, 6, 0.6, strum(1 / 8)], [7, chord, 6, 0.45, strum(1 / 8)]]));
const lofiBass = (roots: string[]) => twice(roots.map((root): Placed[] => [[0, root, 5, 0.85], [7, root, 2, 0.6], [10, up(root, 7), 2, 0.6], [14, up(root, 12), 1, 0.5]]));
const lofiPad = (chords: string[][]) => twice(chordBars(chords.map(chord => chord.map(note => up(note, 12))), 16, 0.35));
const LOFI_TUNE: Placed[][] = [
  [[2, 'D5', 2, 0.7], [4, 'A#4', 4, 0.65], [10, 'G4', 2, 0.6], [12, 'A4', 4, 0.65]],
  [[0, 'C#5', 6, 0.7], [8, 'A#4', 2, 0.6], [10, 'G4', 2, 0.55], [12, 'E4', 4, 0.6]],
  [[0, 'F4', 2, 0.6], [2, 'A4', 2, 0.65], [4, 'E5', 6, 0.75], [12, 'D5', 4, 0.65]],
  [[0, 'A#4', 6, 0.7], [8, 'A4', 4, 0.6], [12, 'F4', 4, 0.55]],
  [[0, 'G4', 2, 0.6], [2, 'A#4', 2, 0.65], [4, 'D5', 4, 0.7], [10, 'E5', 2, 0.6], [12, 'D5', 4, 0.65]],
  [[0, 'C#5', 4, 0.7], [4, 'E5', 4, 0.65], [8, 'G5', 6, 0.7]],
  [[0, 'F5', 6, 0.75], [8, 'E5', 2, 0.6], [10, 'D5', 2, 0.6], [12, 'A4', 4, 0.6]],
  [[0, 'D5', 8, 0.65], [8, 'A#4', 4, 0.55], [12, 'A4', 4, 0.55]],
];
const LOFI_BRIDGE_TUNE: Placed[][] = twice([
  [[0, 'F5', 8, 0.65], [8, 'D5', 8, 0.6]], [[0, 'E5', 16, 0.6]],
  [[0, 'D5', 6, 0.6], [8, 'F5', 4, 0.6], [12, 'A5', 4, 0.65]], [[0, 'G5', 8, 0.65], [8, 'E5', 8, 0.6]],
]);
const LOFI_BELLS: Placed[][] = twice([
  [[8, 'A5', 2, 0.5], [10, 'G5', 2, 0.45]], [[12, 'E5', 4, 0.5]],
  [[8, 'A5', 2, 0.5], [10, 'C6', 2, 0.5], [12, 'E6', 4, 0.55]], [[4, 'D6', 4, 0.45], [12, 'A5', 4, 0.4]],
]);
// The quiet in-between hats play only half the time: a dusty, uneven sixteenth.
const lofiHats = (open: boolean): Array<number | [number, number, number, number]> => Array.from({ length: 16 }, (_, step): [number, number, number, number] => [step, step % 4 === 0 ? 0.5 : step % 2 === 0 ? 0.4 : 0.2, 1, step % 2 ? 0.5 : 1]).filter(([step]) => !open || step !== 14);
const LOFI_BEAT: Hits = { kick: [0, [7, 0.7], 10], snare: [4, 12], closedHH: lofiHats(false) };
const LOFI_TURN: Hits = { kick: [0, [7, 0.7], 10], snare: [4, 12, [15, 0.35]], closedHH: lofiHats(true), openHH: [[14, 0.55]] };
const lofiDrums = twice([LOFI_BEAT, LOFI_BEAT, LOFI_BEAT, LOFI_TURN]);

const LATE_STUDY: SampleSong = {
  id: 'late-study', name: 'Late Study', genre: 'Lo-fi hip hop',
  hint: 'Lo-fi hip hop in D minor at 80 BPM, swung throughout, on five lanes: an FM electric piano made dusty by its own drive, tone and chorus and wavering on a detuned second layer, strummed jazz chords, a felt piano with the tune, bells whose echo send rises by automation and whose notes land anywhere in the stereo, a breathy pad, hats left to chance, and an outro that slows like a tape winding down',
  tempo: 80, drumSwing: 0.45, kit: 'lofi-dirty', drumVolume: 0.7, level: 0.7,
  lanes: [
    { preset: 'builtin-bass', name: 'Bass', octaveShift: -1, swing: true },
    { preset: 'builtin-grand-piano', name: 'Rhodes', swing: true, sound: {
      layer: { enabled: true, mix: 0.3, detune: 14, brightness: -0.5, attack: 0, width: 0.6 },
      inserts: { drive: 0.3, tone: -0.45, chorus: { mix: 0.35, depth: 0.5, rate: 0.4 } }, fxSends: { reverb: 0.3 } } },
    // A route from the random source to the pan puts each note somewhere else.
    { preset: 'builtin-keys-d50-bell', name: 'Bells', sound: { modMatrix: [{ source: 'random', destination: 'pan', depth: 0.5 }], fxSends: { reverb: 0.2, auxA: 0.2, delay: 0.25 } } },
    { preset: 'builtin-keys-felt', name: 'Felt Piano', swing: true, sound: { inserts: { tone: -0.25 }, fxSends: { reverb: 0.35, auxB: 0.2 } } },
    { preset: 'builtin-pad-d50-breath', name: 'Breath', sound: { gain: 0.6, fxSends: { reverb: 0.4 } } },
  ],
  effects: {
    reverb: { enabled: true, kind: 'room', decay: 1.6, mix: 0.3, preDelay: 0.02, damping: 0.6 },
    // The bells' tape echo: darker each time round, and wavering.
    delay: { enabled: true, time: 0.38, feedback: 0.5, mix: 0.3, color: 0.55, wow: 0.45 },
    aux: [{ kind: 'echo', level: 0.65, main: 0.56, shape: 0.55 }, { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 }],
    eq: { enabled: true, low: 2, mid: 0, high: -4 },
  },
  scenes: [
    // The electric piano comes in from behind a closed filter, over the pad.
    { id: 'lofi-intro', name: 'Intro', color: 'teal', bars: 8, lanes: { 2: lofiKeys(LOFI_CHORDS), 5: lofiPad(LOFI_CHORDS) },
      drums: [{}, {}, {}, {}, { closedHH: lofiHats(false) }, { closedHH: lofiHats(false) }, { closedHH: lofiHats(false) }, LOFI_TURN],
      automation: { 2: { cutoff: ramp(BARS_8, 400, 4000) } } },
    { id: 'lofi-loop', name: 'Loop', color: 'blue', bars: 8, lanes: { 1: lofiBass(LOFI_ROOTS), 2: lofiKeys(LOFI_CHORDS), 5: lofiPad(LOFI_CHORDS) }, drums: lofiDrums },
    { id: 'lofi-tune', name: 'Tune', color: 'pink', bars: 8, lanes: { 1: lofiBass(LOFI_ROOTS), 2: lofiKeys(LOFI_CHORDS), 4: LOFI_TUNE, 5: lofiPad(LOFI_CHORDS) }, drums: lofiDrums },
    // The bells answer, their echo coming up.
    { id: 'lofi-bells', name: 'Bells', color: 'violet', bars: 8, lanes: { 1: lofiBass(LOFI_ROOTS), 2: lofiKeys(LOFI_CHORDS), 3: LOFI_BELLS, 4: LOFI_TUNE.map(bar => bar.slice(0, 2)), 5: lofiPad(LOFI_CHORDS) }, drums: lofiDrums,
      automation: { 3: { auxASend: [...held(64, 0.15), ...ramp(64, 0.15, 0.7)] } } },
    { id: 'lofi-bridge', name: 'Bridge', color: 'green', bars: 8, lanes: { 1: lofiBass(LOFI_BRIDGE_ROOTS), 2: lofiKeys(LOFI_BRIDGE), 3: LOFI_BELLS.map((bar, index) => (index % 2 ? bar : [])), 4: LOFI_BRIDGE_TUNE, 5: lofiPad(LOFI_BRIDGE) }, drums: lofiDrums },
    // A little slower than the rest, as if the tape were running down.
    { id: 'lofi-outro', name: 'Outro', color: 'teal', bars: 8, tempo: 74, lanes: { 2: lofiKeys(LOFI_CHORDS), 3: LOFI_BELLS, 4: LOFI_TUNE.map(bar => bar.slice(0, 1)), 5: lofiPad(LOFI_CHORDS) },
      drums: [LOFI_BEAT, LOFI_BEAT, { closedHH: lofiHats(false) }, { closedHH: lofiHats(false) }, {}, {}, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_8, 4000, 500) }, 5: { level: ramp(BARS_8, 0.6, 0.1) } } },
  ],
  // 48 bars at 80 and 8 at 74: two minutes and 50 seconds.
  order: [['lofi-intro', 1], ['lofi-loop', 1], ['lofi-tune', 1], ['lofi-bells', 1], ['lofi-bridge', 1], ['lofi-tune', 1], ['lofi-outro', 1]],
};

// ---------------------------------------------------------------- Seven Lights (electronic, 7/8)
// E minor, seven eighths to the bar counted two, two, three (beats on steps 0, 4 and 8 of 14). An
// acid bass whose filter is swept by automation, held chords run through the arpeggiator, a
// supersaw pad, a Virus lead that glides, chord stabs on the off-beats, and hats rolled with repeats.

const SEVEN_CHORDS = [['E4', 'G4', 'B4'], ['C4', 'E4', 'G4', 'B4'], ['C4', 'E4', 'G4', 'A4'], ['D4', 'F#4', 'A4', 'B4']];
const SEVEN_PAD = [['E3', 'B3', 'G4'], ['C3', 'G3', 'E4'], ['A2', 'E3', 'C4'], ['B2', 'F#3', 'D4']];
const SEVEN_ROOTS = ['E2', 'C2', 'A1', 'B1'];
const acid = (root: string): Placed[] => [
  [0, root, 1, 1], [2, root, 1, 0.6], [3, up(root, 12), 1, 0.9, { slide: true }], [4, root, 1, 0.6],
  [6, up(root, 7), 1, 1], [8, root, 1, 0.6], [10, up(root, 10), 1, 0.9, { slide: true }], [11, up(root, 12), 1, 0.7], [12, root, 1, 1],
];
const sevenBass = twice(SEVEN_ROOTS.map(acid));
const arpChords = twice(chordBars(SEVEN_CHORDS, 14, 0.8));
const sevenPad = twice(chordBars(SEVEN_PAD, 14, 0.6));
const SEVEN_TUNE: Placed[][] = [
  [[0, 'B4', 4], [4, 'E5', 4], [8, 'D5', 2], [10, 'B4', 4]],
  [[0, 'G5', 4], [4, 'E5', 4], [8, 'B4', 6]],
  [[0, 'A4', 4], [4, 'C5', 4], [8, 'E5', 2], [10, 'G5', 4]],
  [[0, 'F#5', 8], [8, 'D5', 2], [10, 'B4', 4]],
];
const SEVEN_TUNE_HIGH: Placed[][] = [
  [[0, 'E5', 4], [4, 'G5', 4], [8, 'B5', 2], [10, 'A5', 4]],
  [[0, 'G5', 4], [4, 'E5', 4], [8, 'C6', 6]],
  [[0, 'A5', 4], [4, 'G5', 4], [8, 'E5', 2], [10, 'C5', 4]],
  [[0, 'D5', 4], [4, 'F#5', 4], [8, 'B5', 6]],
];
const sevenStabs = twice(SEVEN_CHORDS.map((chord): Placed[] => [[2, chord, 1, 0.65], [6, chord, 1, 0.7], [10, chord, 2, 0.8]]));
// A ghost hat before the bar comes round, there about half the time.
const SEVEN_HATS: Array<number | [number, number, number?, number?]> = [...[0, 2, 4, 6, 8, 10, 12].map((step): [number, number] => [step, step === 0 || step === 4 || step === 8 ? 0.6 : 0.4]), [13, 0.25, 1, 0.5]];
const SEVEN_BEAT: Hits = { kick: [0, 8, [11, 0.6]], clap: [4, 12], closedHH: SEVEN_HATS, openHH: [[6, 0.5]] };
const SEVEN_ROLL: Hits = { ...SEVEN_BEAT, closedHH: [...SEVEN_HATS.filter(hit => (Array.isArray(hit) ? hit[0] : hit) < 10) as Array<[number, number]>, [10, 0.5, 3], [12, 0.6, 4]], snare: [[13, 0.7]] };
const sevenDrums = (crashes: number[]): Hits[] => Array.from({ length: 8 }, (_, bar) => (bar % 4 === 3 ? SEVEN_ROLL : crashes.includes(bar) ? { ...SEVEN_BEAT, crash: [0] } : SEVEN_BEAT));
const STEPS_7 = 8 * 14;

const SEVEN_LIGHTS: SampleSong = {
  id: 'seven-lights', name: 'Seven Lights', genre: 'Electronic in 7/8',
  hint: 'Electronic music in 7/8 at 128 BPM: an acid bass with slides and accents whose filter is swept by automation, chords run through the arpeggiator, a supersaw pad, a Virus lead that glides, chord stabs and rolled hats on a TR-909, and a break made by muting the bass, the kick and the clap in its scene, their notes left in place',
  tempo: 128, kit: 'tr-909', drumVolume: 0.8, level: 0.52,
  lanes: [
    { preset: 'builtin-bass-acid', name: 'Acid', octaveShift: -1, sound: { fxSends: { delay: 0.15 } } },
    { preset: 'builtin-pad-jp', name: 'Supersaw Pad', sound: { duck: 0.3, fxSends: { reverb: 0.35 } } },
    { preset: 'builtin-pluck-bell', name: 'Arp Bells', octaveShift: 1,
      sound: { arpeggiator: { enabled: true, mode: 'updown', rate: '1/16', gate: 0.55, octaves: 2 }, fxSends: { delay: 0.25, auxA: 0.3 } } },
    { preset: 'builtin-lead-virus', name: 'Lead', sound: { ...glide(0.05), ...vibrato(0.15, 6), fxSends: { reverb: 0.25, delay: 0.2 } } },
    { preset: 'builtin-pluck-stab', name: 'Stabs', sound: { pan: 0.2, fxSends: { reverb: 0.2, auxA: 0.2 } } },
  ],
  effects: {
    delay: { enabled: true, time: 0.375, feedback: 0.45, mix: 0.25, sync: '1/8d' },
    reverb: { enabled: true, kind: 'hall', decay: 3, mix: 0.3, preDelay: 0.02, damping: 0.3 },
    aux: [{ kind: 'chorus', level: 0.7, main: 0.6, shape: 0.5 }, { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 }],
  },
  scenes: [
    { id: 'seven-rise', name: 'Rise', color: 'violet', signature: '7/8', bars: 8, lanes: { 1: sevenBass, 2: sevenPad },
      drums: [...Array<Hits>(4).fill({ closedHH: SEVEN_HATS }), ...Array<Hits>(3).fill({ closedHH: SEVEN_HATS, kick: [0, 8] }), SEVEN_ROLL],
      automation: { 1: { cutoff: ramp(STEPS_7, 250, 1800) } } },
    { id: 'seven-drive', name: 'Drive', color: 'red', signature: '7/8', bars: 8, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords, 5: [[], [], [], [], ...sevenStabs.slice(4)] }, drums: sevenDrums([0]),
      automation: { 1: { cutoff: ramp(STEPS_7, 900, 3500) } } },
    { id: 'seven-tune', name: 'Tune', color: 'pink', signature: '7/8', bars: 8, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords, 4: twice(SEVEN_TUNE), 5: sevenStabs }, drums: sevenDrums([0, 4]) },
    // The Tune with the bass, the kick and the clap muted in this scene: unmute them to hear it whole.
    { id: 'seven-break', name: 'Break', color: 'blue', signature: '7/8', bars: 8, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords, 4: [...SEVEN_TUNE.map(bar => bar.slice(0, 1)), ...SEVEN_TUNE] },
      drums: [...sevenDrums([]).slice(0, 7), { ...SEVEN_BEAT, snare: [[8, 0.4], [10, 0.5], [12, 0.6, 2], [13, 0.8, 2]] }],
      mutes: { lanes: [1], drums: ['kick', 'clap'] }, automation: { 4: { auxBSend: held(STEPS_7, 0.6) } } },
    // Everything, the lead higher and the bass's filter wide open.
    { id: 'seven-peak', name: 'Peak', color: 'red', signature: '7/8', bars: 8, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords, 4: [...SEVEN_TUNE, ...SEVEN_TUNE_HIGH], 5: sevenStabs }, drums: sevenDrums([0, 4]),
      automation: { 1: { cutoff: held(STEPS_7, 4000) } } },
    // The arpeggio's filter closes; the pad and the stabs fade.
    { id: 'seven-outro', name: 'Outro', color: 'violet', signature: '7/8', bars: 8, lanes: { 2: sevenPad, 3: arpChords, 5: sevenStabs.slice(0, 4).concat([[], [], [], []]) },
      drums: [{ closedHH: SEVEN_HATS, kick: [0, 8] }, { closedHH: SEVEN_HATS, kick: [0, 8] }, { closedHH: SEVEN_HATS }, { closedHH: SEVEN_HATS }, { closedHH: SEVEN_HATS.slice(0, 3) }, {}, {}, {}],
      automation: { 3: { cutoff: ramp(STEPS_7, 6000, 300) }, 2: { level: ramp(STEPS_7, 0.8, 0.1) } } },
  ],
  // 80 bars of seven eighths at 128 BPM: two minutes and eleven seconds.
  order: [['seven-rise', 1], ['seven-drive', 1], ['seven-tune', 2], ['seven-break', 1], ['seven-drive', 1], ['seven-peak', 3], ['seven-outro', 1]],
};

// ---------------------------------------------------------------- Market Day (Afrobeat, 12/8)
// D dorian in 12/8: four dotted-quarter beats to the bar (steps 0, 6, 12 and 18 of 24). The
// cymbal lane is a bell playing the standard twelve-eight pattern; congas, bongos and a shaker take
// the places of the toms and the clap. A highlife guitar chopping the off-beats, a marimba ostinato,
// a bass, a horn section riffing in octaves and an organ holding the chords.

const BELL = [0, 4, 8, 10, 14, 18, 22];
const MARKET_GROOVE: Hits = {
  crash: BELL.map((step): [number, number] => [step, step === 0 ? 0.8 : 0.6]),
  // The shaker's weak strokes are each left to chance, so it breathes.
  clap: Array.from({ length: 12 }, (_, eighth): [number, number, number, number] => [eighth * 2, eighth % 3 === 0 ? 0.45 : 0.25, 1, eighth % 3 === 0 ? 1 : 0.8]),
  snare2: [[4, 0.6], [10, 0.9], [16, 0.6], [22, 0.9]],
  ride: [[2, 0.5], [8, 0.6], [14, 0.5], [20, 0.6]],
  kick: [0, [12, 0.8], [18, 0.5]],
};
const MARKET_BREAK: Hits = { crash: MARKET_GROOVE.crash, clap: MARKET_GROOVE.clap };
const MARKET_FILL: Hits = { ...MARKET_GROOVE, snare2: [[4, 0.6], [10, 0.9], [14, 0.6], [16, 0.7], [18, 0.8], [20, 0.9], [22, 1]] };
const marketBars: Hits[] = [MARKET_GROOVE, MARKET_GROOVE, MARKET_GROOVE, MARKET_FILL];
const DM_RUN = ['D4', 'F4', 'A4', 'C5', 'A4', 'F4', 'D4', 'E4', 'F4', 'A4', 'G4', 'E4'];
const G_RUN = ['B3', 'D4', 'G4', 'B4', 'G4', 'D4', 'B3', 'C4', 'D4', 'G4', 'F4', 'D4'];
const ostinato = (run: string[]): Placed[] => run.map((note, eighth): Placed => [eighth * 2, note, 2, eighth % 3 === 0 ? 0.85 : 0.6]);
// Two bars, looping under four-bar scenes: the lane is shorter than the scene.
const marimba = [ostinato(DM_RUN), ostinato(G_RUN)];
const MARKET_ROOTS = ['D2', 'G2', 'D2', 'G2'];
const marketBass = MARKET_ROOTS.map((root): Placed[] => [[0, root, 4, 0.9], [6, up(root, 7), 2, 0.7], [10, up(root, 12), 2, 0.65], [12, root, 4, 0.85], [18, up(root, 10), 2, 0.7], [22, up(root, 7), 2, 0.6]]);
const MARKET_CHOP = [['D4', 'F4', 'A4'], ['D4', 'G4', 'B4'], ['D4', 'F4', 'A4'], ['D4', 'G4', 'B4']];
const guitar = MARKET_CHOP.map((chord): Placed[] => [2, 8, 10, 14, 20, 22].map((step): Placed => [step, chord, 1, step % 6 === 2 ? 0.7 : 0.55]));
const marketOrgan = chordBars([['C4', 'F4', 'A4'], ['B3', 'D4', 'F4', 'G4'], ['C4', 'F4', 'A4'], ['B3', 'D4', 'F4', 'G4']], 24, 0.45);
// The horns in octaves.
const octaves = (bars: Placed[][]) => bars.map(bar => bar.map(([step, note, ...rest]): Placed => [step, [note as string, up(note as string, -12)], ...rest]));
const HORNS = octaves(twice([
  [[0, 'A4', 2, 0.9], [4, 'C5', 2, 0.85], [6, 'D5', 4, 0.95], [12, 'F5', 2, 0.85], [14, 'E5', 2, 0.8], [16, 'D5', 2, 0.85], [18, 'C5', 4, 0.9]],
  [[0, 'B4', 4, 0.9], [6, 'D5', 2, 0.8], [8, 'B4', 2, 0.75], [12, 'G4', 6, 0.9], [20, 'A4', 2, 0.7], [22, 'B4', 2, 0.75]],
]));
const HORN_SHOUT = octaves(twice([
  [[0, 'D5', 2, 0.9], [2, 'F5', 2, 0.85], [4, 'A5', 4, 1], [12, 'G5', 2, 0.85], [14, 'F5', 2, 0.8], [16, 'D5', 6, 0.9]],
  [[0, 'B4', 2, 0.9], [2, 'D5', 2, 0.85], [4, 'G5', 4, 1], [12, 'F5', 2, 0.85], [14, 'D5', 2, 0.8], [16, 'B4', 6, 0.9]],
]));
const STEPS_12 = 4 * 24;

const MARKET_DAY: SampleSong = {
  id: 'market-day', name: 'Market Day', genre: 'Afrobeat in 12/8',
  hint: 'An Afrobeat groove in 12/8 at 96 BPM on the recorded kit and five lanes: a bell pattern, congas, bongos and a shaker that breathes by chance, a highlife guitar chopping the off-beats, a two-bar marimba ostinato looping under four-bar scenes, an SH-101 bass, a horn section in octaves and an organ',
  tempo: 96, kit: 'recorded', drumVolume: 0.85, level: 0.8,
  lanes: [
    { preset: 'builtin-bass-101', name: 'Bass', octaveShift: -1 },
    { preset: 'builtin-pluck-nylon', name: 'Highlife Guitar', sound: { pan: -0.3, inserts: { tone: 0.2 }, fxSends: { reverb: 0.15, auxA: 0.2 } } },
    { preset: 'builtin-pluck-m1-marimba', name: 'Marimba', sound: { pan: 0.2, fxSends: { reverb: 0.2 } } },
    { preset: 'builtin-keys-brass', name: 'Horns', sound: { fxSends: { reverb: 0.3 } } },
    { preset: 'builtin-keys-m1-organ', name: 'Organ', sound: { gain: 0.6, fxSends: { reverb: 0.3 } } },
  ],
  drums: {
    crash: { cymbalType: 'bell', volume: 0.5 }, clap: { percType: 'shaker', volume: 0.55, pan: -0.4 },
    snare2: { percType: 'conga', volume: 0.75, pan: 0.25 }, ride: { percType: 'bongo', volume: 0.6, pan: -0.25 },
  },
  drumSends: { reverb: 0.2 },
  effects: {
    reverb: { enabled: true, kind: 'room', decay: 1.2, mix: 0.25, preDelay: 0.01, damping: 0.3 },
    aux: [{ kind: 'echo', level: 0.6, main: 0.469, shape: 0.4, sync: '1/8' }, { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 }],
  },
  scenes: [
    { id: 'market-start', name: 'Percussion', color: 'teal', signature: '12/8', bars: 4, lanes: {},
      drums: [MARKET_BREAK, { ...MARKET_BREAK, snare2: MARKET_GROOVE.snare2 }, { ...MARKET_GROOVE, kick: [] }, MARKET_FILL] },
    { id: 'market-groove', name: 'Groove', color: 'green', signature: '12/8', bars: 4, lanes: { 1: marketBass, 2: guitar, 3: marimba }, laneBars: { 3: 2 }, drums: marketBars },
    { id: 'market-horns', name: 'Horns', color: 'pink', signature: '12/8', bars: 4, lanes: { 1: marketBass, 2: guitar, 3: marimba, 4: HORNS, 5: marketOrgan }, laneBars: { 3: 2 }, drums: marketBars },
    // The drums and the bass drop out; the organ, the guitar and the bell are left, and the horns call.
    { id: 'market-break', name: 'Break', color: 'blue', signature: '12/8', bars: 4, lanes: { 2: guitar, 4: [[], [], [], HORNS[1]], 5: marketOrgan },
      drums: [MARKET_BREAK, MARKET_BREAK, MARKET_BREAK, { ...MARKET_BREAK, snare2: MARKET_FILL.snare2 }],
      automation: { 2: { cutoff: ramp(STEPS_12, 800, 5000) } } },
    { id: 'market-shout', name: 'Shout', color: 'red', signature: '12/8', bars: 4, lanes: { 1: marketBass, 2: guitar, 3: marimba, 4: HORN_SHOUT, 5: marketOrgan }, laneBars: { 3: 2 },
      drums: [{ ...MARKET_GROOVE, kick: [0, [6, 0.6], [12, 0.8], [18, 0.6]] }, MARKET_GROOVE, MARKET_GROOVE, MARKET_FILL] },
  ],
  // 40 bars of twelve eighths at 96 BPM: two and a half minutes.
  order: [['market-start', 1], ['market-groove', 2], ['market-horns', 2], ['market-break', 1], ['market-horns', 1], ['market-shout', 2], ['market-groove', 1]],
};

// ---------------------------------------------------------------- Cathedral (ambient, 5/4)
// A minor in five: a pipe organ, a CS-80 that swells under it, a harp running up and down the chord in
// eighths, a choir of voices, a lead sent ever further into the long Hall by automation, and a kick
// like a slow heart. It slows twice, each time by the scene's own tempo.

const ORGAN_CHORDS = [['A3', 'B3', 'C4', 'E4'], ['F3', 'A3', 'C4', 'E4'], ['D3', 'F3', 'A3', 'E4'], ['E3', 'A3', 'B3']];
const organ = chordBars(ORGAN_CHORDS, 20, 0.6);
const swell = ['A2', 'F2', 'D2', 'E2'].map((root): Placed[] => [[0, [root, up(root, 7), up(root, 12)], 20, 0.5]]);
// Ten eighths up the chord over two octaves and back.
const HARP_RUN = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];
const harp = (chords: string[][], velocity: number) => chords.map((chord): Placed[] => {
  const tones = [...chord.slice(0, 3), ...chord.slice(0, 3).map(note => up(note, 12))].map(note => up(note, 12));
  return HARP_RUN.map((index, eighth): Placed => [eighth * 2, tones[index], 2, eighth % 5 === 0 ? velocity : velocity * 0.8]);
});
const choir = chordBars(ORGAN_CHORDS.map(chord => chord.map(note => up(note, 12))), 20, 0.45);
const CHANT: Placed[][] = [
  [[0, 'E5', 8], [8, 'C5', 4], [12, 'B4', 8]],
  [[0, 'A4', 12], [12, 'C5', 4], [16, 'E5', 4]],
  [[0, 'F5', 8], [8, 'E5', 4], [12, 'D5', 8]],
  [[0, 'B4', 16], [16, 'E5', 4]],
];
const HEART: Hits = { kick: [[0, 0.7], [3, 0.4]] };
const STEPS_5 = 4 * 20;
const auxSwell: Automation = { auxBSend: ramp(STEPS_5, 0.1, 0.9) };

const CATHEDRAL: SampleSong = {
  id: 'cathedral', name: 'Cathedral', genre: 'Ambient in 5/4',
  hint: 'Ambient music in 5/4 at 72 BPM, slowing to 60 and then 56 by its scenes\' own tempos: a pipe organ, a CS-80 swell with a second layer an octave up fading in under it, a harp running up and down the chords, a choir of recorded voices, a lead that glides and wavers and is sent ever deeper into the long Hall by automation, and a heartbeat kick',
  tempo: 72, kit: 'clean-analog', level: 0.5,
  lanes: [
    { preset: 'builtin-pad-cs80-swell', name: 'Swell', octaveShift: -1, sound: { gain: 0.8, layer: { enabled: true, mix: 0.3, detune: 1200, brightness: -0.5, attack: 1.5, width: 1 }, fxSends: { reverb: 0.5, phaser: 0.4 } } },
    { preset: 'builtin-keys-pipe-organ', name: 'Organ', sound: { fxSends: { reverb: 0.45 } } },
    { preset: 'builtin-lead-ms-hollow', name: 'Chant Lead', octaveShift: 1, sound: { ...glide(0.12), ...vibrato(0.3, 4.5), fxSends: { reverb: 0.3, auxA: 0.25, auxB: 0.1 } } },
    { preset: 'builtin-pluck-harp', name: 'Harp', sound: { pan: 0.3, fxSends: { reverb: 0.4, auxB: 0.3 } } },
    { preset: 'builtin-pad-m1-voices', name: 'Choir', sound: { gain: 0.7, pan: -0.2, fxSends: { reverb: 0.5 } } },
  ],
  drums: { kick: { volume: 0.7, tone: 0.3 } },
  effects: {
    reverb: { enabled: true, kind: 'hall', decay: 4, mix: 0.35, preDelay: 0.03, damping: 0.3 },
    // A deep, slow phaser on the swell.
    phaser: { enabled: true, rate: 0.15, depth: 0.85, feedback: 0.6, mix: 0.6 },
    aux: [{ kind: 'echo', level: 0.55, main: 0.833, shape: 0.5, sync: '1/4' }, { kind: 'hall', level: 0.85, main: 5, shape: 0.25 }],
  },
  scenes: [
    { id: 'cathedral-nave', name: 'Nave', color: 'blue', signature: '5/4', bars: 4, lanes: { 2: organ }, drums: [{}, {}, HEART, HEART] },
    { id: 'cathedral-harp', name: 'Harp', color: 'green', signature: '5/4', bars: 4, lanes: { 2: organ, 4: harp(ORGAN_CHORDS, 0.6) }, drums: [HEART, HEART, HEART, HEART] },
    { id: 'cathedral-choir', name: 'Choir', color: 'violet', signature: '5/4', bars: 4, lanes: { 1: swell, 2: organ, 3: CHANT, 4: harp(ORGAN_CHORDS, 0.45), 5: choir }, drums: [HEART, HEART, HEART, HEART],
      automation: { 3: auxSwell } },
    // Without the heartbeat, slower, the last chord turned to E major.
    { id: 'cathedral-light', name: 'Light', color: 'teal', signature: '5/4', bars: 4, tempo: 60,
      lanes: { 1: swell, 3: CHANT.map(bar => bar.slice(0, 1)), 4: harp([...ORGAN_CHORDS.slice(0, 3), ['E3', 'G#3', 'B3']], 0.5), 5: chordBars([...ORGAN_CHORDS.slice(0, 3), ['E3', 'G#3', 'B3']].map(chord => chord.map(note => up(note, 12))), 20, 0.45) },
      drums: [{}, {}, {}, {}], automation: { 3: { auxBSend: held(STEPS_5, 0.9) } } },
    // Slower again: the organ and the choir on A minor, the harp thinning out.
    { id: 'cathedral-coda', name: 'Coda', color: 'blue', signature: '5/4', bars: 4, tempo: 56,
      lanes: { 2: [...organ.slice(0, 3), [[0, ['A3', 'C4', 'E4'], 20, 0.55]]], 4: harp(ORGAN_CHORDS, 0.4).map((bar, index) => bar.filter((_, eighth) => eighth % (index + 1) === 0)), 5: [...choir.slice(0, 3), [[0, ['A4', 'C5', 'E5'], 20, 0.4]]] },
      drums: [{}, {}, {}, {}], automation: { 5: { level: ramp(STEPS_5, 0.7, 0.05) } } },
  ],
  // 20 bars at 72, 4 at 60 and 4 at 56: two minutes and twenty seconds.
  order: [['cathedral-nave', 1], ['cathedral-harp', 1], ['cathedral-choir', 2], ['cathedral-light', 1], ['cathedral-harp', 1], ['cathedral-choir', 1], ['cathedral-coda', 1]],
};

// ---------------------------------------------------------------- Lanterns Over Dark Water (post-rock, 4/4)
// Seven minutes in B minor at 100 BPM, after the manner of Mogwai: the same four chords (B minor,
// G major seven, E minor, F sharp, two bars each) all the way through, and everything else about it
// moving. A clean guitar picks an arpeggio into a dotted-eighth echo; a glockenspiel rings into a
// long hall; strings swell; and a wall of distorted, tremolo-picked guitar (a step repeated four
// times, a sixteenth each) climbs out of nothing. The dynamics are made with the effects as much as
// the notes: the guitar's filter opens through the first section and closes in the last, the wall's
// level, brightness and drive are swept up through each Rise and down through the Fall, and the
// reverb and the hall take more of each lane the quieter the music gets.

const LANTERN_CHORDS = [
  ['B3', 'F#4', 'B4', 'D5'], ['B3', 'F#4', 'B4', 'D5'], ['G3', 'D4', 'F#4', 'B4'], ['G3', 'D4', 'F#4', 'B4'],
  ['E3', 'B3', 'E4', 'G4'], ['E3', 'B3', 'E4', 'G4'], ['F#3', 'C#4', 'F#4', 'B4'], ['F#3', 'C#4', 'F#4', 'A#4'],
];
const LANTERN_ROOTS = ['B1', 'B1', 'G1', 'G1', 'E2', 'E2', 'F#1', 'F#1'];
// The guitar's figure: eight eighths through the chord, the first of each beat a little harder.
const PICK = [0, 1, 3, 2, 1, 2, 3, 1];
const picking = (gentle: number) => LANTERN_CHORDS.map((chord): Placed[] => PICK.map((note, eighth): Placed => [eighth * 2, chord[note], 2, (eighth % 2 ? 0.55 : 0.75) * gentle]));
const bassHeld = LANTERN_ROOTS.map((root, bar): Placed[] => (bar % 2 ? [] : [[0, root, 32, 0.8]]));
const bassDriving = LANTERN_ROOTS.map((root): Placed[] => Array.from({ length: 8 }, (_, eighth): Placed => [eighth * 2, root, 2, eighth % 4 === 0 ? 1 : 0.85]));
const GLOCK: Placed[][] = [
  [[0, 'D6', 4, 0.7], [4, 'C#6', 4, 0.6], [8, 'B5', 8, 0.75]],
  [[0, 'F#5', 8, 0.6], [8, 'A5', 8, 0.65]],
  [[0, 'B5', 4, 0.7], [4, 'A5', 4, 0.6], [8, 'F#5', 8, 0.7]],
  [[0, 'D6', 8, 0.65], [8, 'B5', 8, 0.6]],
  [[0, 'G5', 4, 0.7], [4, 'B5', 4, 0.6], [8, 'E6', 8, 0.75]],
  [[0, 'D6', 8, 0.65], [8, 'B5', 8, 0.6]],
  [[0, 'C#6', 4, 0.7], [4, 'B5', 4, 0.6], [8, 'F#5', 8, 0.7]],
  [[0, 'A#5', 8, 0.65], [8, 'C#6', 8, 0.6]],
];
const GLOCK_SPARSE = GLOCK.map((bar, index): Placed[] => (index % 2 ? [] : bar.slice(-1)));
const STRING_CHORDS = [['B3', 'D4', 'F#4'], ['B3', 'D4', 'G4'], ['B3', 'E4', 'G4'], ['A#3', 'C#4', 'F#4']];
const strings = STRING_CHORDS.flatMap((chord): Placed[][] => [[[0, chord, 32, 0.7]], []]);
// The wall: a power chord on every beat, each beat picked four times.
const POWER = [['B2', 'F#3', 'B3'], ['G2', 'D3', 'G3'], ['E2', 'B2', 'E3'], ['F#2', 'C#3', 'F#3']];
const tremolo = POWER.flatMap((chord): Placed[][] => {
  const bar: Placed[] = [0, 4, 8, 12].map((step): Placed => [step, chord, 4, step === 0 ? 1 : 0.85, { ratchet: 4 }]);
  return [bar, bar];
});

const SOFT_HATS: Hits = { closedHH: [0, 2, 4, 6, 8, 10, 12, 14].map((step): [number, number] => [step, step % 4 === 0 ? 0.25 : 0.15]) };
const GLOW_BEAT: Hits = { ...SOFT_HATS, kick: [[0, 0.4]] };
const GATHER_BEAT: Hits = {
  closedHH: [0, 2, 4, 6, 8, 10, 12, 14].map((step): [number, number] => [step, step % 4 === 0 ? 0.35 : 0.22]),
  kick: [[0, 0.65], [8, 0.5]], snare2: [[6, 0.4], [14, 0.45]], ride: [[10, 0.35], [11, 0.3, 1, 0.6]],
};
// The Rise: the snare comes in and gets harder, then rolls in eighths and sixteenths into the Storm.
const RISE_BEATS: Hits[] = [
  ...[0.45, 0.5, 0.55, 0.6, 0.68, 0.75].map((level): Hits => ({ ...GATHER_BEAT, snare: [[4, level], [12, level]], kick: [[0, 0.8], [8, 0.7]] })),
  { kick: [[0, 0.85], [8, 0.8]], snare: [0, 2, 4, 6, 8, 10, 12, 14].map((step): [number, number] => [step, 0.55 + step * 0.02]), closedHH: GATHER_BEAT.closedHH },
  { kick: [[0, 0.9], [8, 0.9]], snare: Array.from({ length: 16 }, (_, step): [number, number] => [step, 0.6 + step * 0.025]), crash: [[15, 0.6]] },
];
const STORM_BEAT: Hits = {
  kick: [[0, 1], [3, 0.8], [8, 1], [10, 0.85]], snare: [[4, 1], [12, 1]],
  crash: [[0, 0.9], [8, 0.6]], openHH: [2, 6, 10, 14].map((step): [number, number] => [step, 0.55]),
};
const STORM_FILL: Hits = { ...STORM_BEAT, snare: [[4, 1], [12, 1]], snare2: [[13, 0.9], [14, 0.9]], ride: [[11, 0.85], [12, 0.85]], crash: [[0, 0.9]] };
const stormBeats: Hits[] = [STORM_BEAT, STORM_BEAT, STORM_BEAT, STORM_BEAT, STORM_BEAT, STORM_BEAT, STORM_BEAT, STORM_FILL];
// The Fall: the same beat, quieter each bar, and fewer hits.
const FALL_BEATS: Hits[] = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3].map((level, bar): Hits => ({
  kick: [[0, level], ...(bar < 4 ? [[8, level * 0.9] as [number, number]] : [])], snare: bar < 6 ? [[12, level]] : [], ...(bar === 0 ? { crash: [[0, 0.9]] as Array<[number, number]> } : {}),
}));
const EMBER_BEATS: Hits[] = Array.from({ length: 8 }, (_, bar): Hits => (bar % 2 ? {} : { kick: [[0, 0.35]] }));
const nothing: Hits[] = Array.from({ length: 8 }, () => ({}));

const LANTERNS: SampleSong = {
  id: 'lanterns', name: 'Lanterns Over Dark Water', genre: 'Post-rock, 7 minutes',
  hint: 'Seven minutes of post-rock in B minor at 100 BPM, on all five lanes: a clean guitar into a dotted-eighth echo, a glockenspiel into a long hall, strings, and a wall of tremolo-picked guitar, built quiet to loud and back by automation of the filters, levels, drive and reverb sends',
  tempo: 100, kit: 'recorded', drumVolume: 0.5, level: 0.47,
  lanes: [
    { preset: 'builtin-bass-pro', name: 'Bass', octaveShift: -1, sound: { gain: 1.35, inserts: { drive: 0.15 }, fxSends: { reverb: 0.1 } } },
    { preset: 'builtin-keys-juno', name: 'Clean Guitar',
      sound: { gain: 2, inserts: { chorus: { mix: 0.3, depth: 0.4, rate: 0.5 } }, fxSends: { reverb: 0.3, auxA: 0.45, auxB: 0.15 } } },
    { preset: 'builtin-pluck-bell', name: 'Glockenspiel', octaveShift: 1, sound: { gain: 1.4, fxSends: { reverb: 0.25, auxA: 0.2, auxB: 0.5 } } },
    { preset: 'builtin-lead-jp', name: 'Tremolo Wall',
      sound: { gain: 0.7, inserts: { drive: 0.65, tone: -0.15 }, fxSends: { reverb: 0.35, auxB: 0.3 } } },
    { preset: 'builtin-pad-cs80', name: 'Strings', sound: { gain: 0.65, fxSends: { reverb: 0.4, auxB: 0.3 } } },
  ],
  drums: { kick: { volume: 0.9 }, crash: { volume: 0.6 } },
  drumSends: { reverb: 0.25 },
  effects: {
    reverb: { enabled: true, kind: 'hall', decay: 4, mix: 0.35, preDelay: 0.03, damping: 0.3 },
    aux: [{ kind: 'echo', level: 0.6, main: 0.45, shape: 0.45, sync: '1/8d' }, { kind: 'hall', level: 0.85, main: 6, shape: 0.3 }],
    eq: { enabled: true, low: 1, mid: 0, high: 0 },
  },
  scenes: [
    // The guitar alone, its filter opening across the eight bars and its echo deepening.
    { id: 'lanterns-drift', name: 'Drift', color: 'blue', bars: 8, lanes: { 2: picking(0.8) }, drums: nothing,
      automation: { 2: { cutoff: ramp(BARS_8, 500, 5000), auxBSend: ramp(BARS_8, 0.1, 0.4) } } },
    { id: 'lanterns-glow', name: 'Glow', color: 'teal', bars: 8, lanes: { 1: bassHeld, 2: picking(0.85), 3: GLOCK }, drums: Array(8).fill(GLOW_BEAT) },
    { id: 'lanterns-gather', name: 'Gather', color: 'green', bars: 8, lanes: { 1: bassHeld, 2: picking(0.9), 3: GLOCK, 5: strings }, drums: Array(8).fill(GATHER_BEAT),
      automation: { 5: { level: ramp(BARS_8, 0.2, 0.65) } } },
    // Everything drops away but the guitar and the glockenspiel, deep in the hall.
    { id: 'lanterns-hush', name: 'Hush', color: 'violet', bars: 8, lanes: { 2: picking(0.6), 3: GLOCK_SPARSE }, drums: nothing,
      automation: { 2: { reverbSend: held(BARS_8, 0.7), auxBSend: held(BARS_8, 0.6) }, 3: { auxBSend: held(BARS_8, 0.85) } } },
    // The wall climbs out of nothing: louder, brighter and dirtier with every step.
    { id: 'lanterns-rise', name: 'Rise', color: 'pink', bars: 8, lanes: { 1: bassHeld, 2: picking(0.9), 4: tremolo, 5: strings }, drums: RISE_BEATS,
      automation: { 4: { level: ramp(BARS_8, 0.03, 0.7), cutoff: ramp(BARS_8, 700, 9000), drive: ramp(BARS_8, 0, 0.6) }, 5: { level: ramp(BARS_8, 0.5, 0.85) } } },
    { id: 'lanterns-storm', name: 'Storm', color: 'red', bars: 8, lanes: { 1: bassDriving, 2: picking(1), 3: GLOCK, 4: tremolo, 5: strings }, drums: stormBeats,
      automation: { 1: { drive: held(BARS_8, 0.5) } } },
    { id: 'lanterns-break', name: 'Break', color: 'violet', bars: 8, lanes: { 3: GLOCK, 5: strings }, drums: nothing,
      automation: { 3: { auxBSend: held(BARS_8, 0.9) }, 5: { reverbSend: held(BARS_8, 0.8), level: ramp(BARS_8, 0.65, 0.4) } } },
    // The wall dies away, and the guitar's echo takes over.
    { id: 'lanterns-fall', name: 'Fall', color: 'pink', bars: 8, lanes: { 1: bassHeld, 2: picking(0.9), 3: GLOCK, 4: tremolo, 5: strings }, drums: FALL_BEATS,
      automation: { 4: { level: ramp(BARS_8, 0.7, 0), cutoff: ramp(BARS_8, 9000, 500) }, 2: { auxASend: ramp(BARS_8, 0.45, 0.8) } } },
    // The guitar's filter closes and the room fills with its reverb.
    { id: 'lanterns-ember', name: 'Ember', color: 'teal', bars: 8, lanes: { 2: picking(0.7), 3: GLOCK_SPARSE }, drums: EMBER_BEATS,
      automation: { 2: { cutoff: ramp(BARS_8, 5000, 600), reverbSend: ramp(BARS_8, 0.3, 0.9) }, 3: { level: ramp(BARS_8, 1.4, 0.5) } } },
    { id: 'lanterns-last', name: 'Last Light', color: 'blue', bars: 8, lanes: { 2: picking(0.55), 3: GLOCK_SPARSE }, drums: nothing,
      automation: { 2: { cutoff: held(BARS_8, 600), reverbSend: held(BARS_8, 0.9) }, 3: { level: held(BARS_8, 0.5), auxBSend: held(BARS_8, 0.9) } } },
  ],
  // 176 bars at 2.4 seconds a bar: seven minutes and two seconds.
  order: [
    ['lanterns-drift', 1], ['lanterns-glow', 3], ['lanterns-gather', 2], ['lanterns-hush', 1], ['lanterns-rise', 1], ['lanterns-storm', 4],
    ['lanterns-break', 1], ['lanterns-rise', 1], ['lanterns-storm', 4], ['lanterns-fall', 1], ['lanterns-ember', 1], ['lanterns-last', 2],
  ],
};

// ---------------------------------------------------------------- Silver Satellite (space disco, 4/4)
// Five minutes in A minor, after the space disco of the late seventies and its revival: an octave
// bass bouncing between a note and the one above, four on the floor with open hats on the off-beats
// and syndrum-style tom fills, a string machine through a slow phaser, a sequencer arpeggio into a
// dotted-eighth echo, a clavinet chopping the off-beats, and a lead that glides between its notes
// with a vibrato. It begins with a beatless countdown at 96 BPM (the scene's own tempo) and lifts off
// at 120. The breaks are made by muting parts in their scenes, their notes left in place: the
// Starfield is the groove without its bass, arpeggio, kick and clap.

const DISCO_CHORDS: Record<string, { root: string; arp: string[]; strings: string[] }> = {
  Am: { root: 'A2', arp: ['A3', 'C4', 'E4'], strings: ['A3', 'C4', 'E4'] },
  C: { root: 'C3', arp: ['C4', 'E4', 'G4'], strings: ['G3', 'C4', 'E4'] },
  F: { root: 'F2', arp: ['F3', 'A3', 'C4'], strings: ['A3', 'C4', 'F4'] },
  G: { root: 'G2', arp: ['G3', 'B3', 'D4'], strings: ['B3', 'D4', 'G4'] },
  Em: { root: 'E2', arp: ['E3', 'G3', 'B3'], strings: ['B3', 'E4', 'G4'] },
  E: { root: 'E2', arp: ['E3', 'G#3', 'B3'], strings: ['B3', 'E4', 'G#4'] },
  Dm: { root: 'D2', arp: ['D3', 'F3', 'A3'], strings: ['A3', 'D4', 'F4'] },
};
const ORBIT = ['Am', 'C', 'F', 'G', 'Am', 'C', 'Dm', 'E'];
const NEBULA = ['F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'E'];
// The octave bass: eighths, the low note on the beat and the one above on the off-beat.
const octaveBass = (chords: string[]) => chords.map((name): Placed[] => Array.from({ length: 8 }, (_, eighth): Placed => {
  const root = DISCO_CHORDS[name].root;
  return [eighth * 2, eighth % 2 ? up(root, 12) : root, 1, eighth % 2 ? 0.75 : 0.95];
}));
const discoArp = (chords: string[]) => chords.map((name): Placed[] => [[0, DISCO_CHORDS[name].arp, 16, 0.8]]);
const discoStrings = (chords: string[]) => chords.map((name): Placed[] => [[0, DISCO_CHORDS[name].strings, 16, 0.7]]);
// The clavinet's chop: an octave above the strings, on the sixteenths either side of the beats.
const clav = (chords: string[]) => chords.map((name): Placed[] => {
  const chord = DISCO_CHORDS[name].strings.map(note => up(note, 12));
  return [[3, chord, 1, 0.6], [6, chord, 1, 0.75], [11, chord, 1, 0.6], [14, chord, 1, 0.75]];
});
const THEME: Placed[][] = [
  [[0, 'E5', 2], [2, 'A5', 2], [4, 'G5', 2], [6, 'E5', 2], [8, 'C5', 4], [12, 'D5', 4]],
  [[0, 'E5', 6], [6, 'G5', 2], [8, 'E5', 8]],
  [[0, 'F5', 2], [2, 'A5', 2], [4, 'C6', 4], [8, 'A5', 2], [10, 'G5', 2], [12, 'F5', 4]],
  [[0, 'D5', 12], [12, 'B4', 2], [14, 'D5', 2]],
  [[0, 'E5', 2], [2, 'A5', 2], [4, 'G5', 2], [6, 'E5', 2], [8, 'C5', 4], [12, 'E5', 4]],
  [[0, 'G5', 4], [4, 'E5', 2], [6, 'G5', 2], [8, 'C6', 8]],
  [[0, 'A5', 4], [4, 'F5', 4], [8, 'D5', 2], [10, 'E5', 2], [12, 'F5', 4]],
  [[0, 'G#5', 8], [8, 'B5', 4], [12, 'E5', 4]],
];
// Long notes the lead glides between.
const NEBULA_LINE: Placed[][] = [
  [[0, 'A5', 8], [8, 'C6', 8]], [[0, 'B5', 16]], [[0, 'G5', 8], [8, 'B5', 8]], [[0, 'C6', 8], [8, 'A5', 8]],
  [[0, 'A5', 16]], [[0, 'D6', 8], [8, 'B5', 8]], [[0, 'G#5', 16]], [[0, 'B5', 8], [8, 'E5', 8]],
];
// Two bars that go round under the Starfield's eight, deep in the hall.
const STARFIELD_CALL: Placed[][] = [[[0, 'C6', 4, 0.7], [4, 'B5', 4, 0.65], [8, 'G5', 8, 0.7]], [[0, 'E5', 8, 0.65], [8, 'A5', 8, 0.6]]];
const COUNTDOWN_LINE: Placed[][] = [[], [], [], [], [[0, 'E5', 16, 0.6]], [[0, 'G5', 8, 0.6], [8, 'E5', 8, 0.6]], [[0, 'D5', 16, 0.65]], [[0, 'G#4', 16, 0.7]]];

// Closed hats on the sixteenths between, the quiet ones left to chance; open hats on the off-beats.
const DISCO_HATS: Array<[number, number, number?, number?]> = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15].map((step): [number, number, number, number] => [step, step % 4 === 0 ? 0.35 : 0.2, 1, step % 4 === 0 ? 1 : 0.6]);
const OFFBEATS: Array<[number, number]> = [2, 6, 10, 14].map((step): [number, number] => [step, 0.5]);
const DISCO_BEAT: Hits = { kick: [0, 4, 8, 12], clap: [4, 12], openHH: OFFBEATS, closedHH: DISCO_HATS };
// The syndrum-style fill: the high tom, then the low tom running down into the next bar.
const DISCO_FILL: Hits = { ...DISCO_BEAT, clap: [4], openHH: OFFBEATS.slice(0, 2), ride: [[8, 0.8], [10, 0.8]], snare2: [[12, 0.85], [13, 0.85], [14, 0.9], [15, 0.95]] };
const discoBars = (beat: Hits, crash: boolean): Hits[] => [crash ? { ...beat, crash: [0] } : beat, beat, beat, beat, beat, beat, beat, DISCO_FILL];
// The countdown's last bar: a snare roll that gets harder and faster into the lift-off.
const LAUNCH_ROLL: Hits = { snare: [[0, 0.3], [4, 0.4], [8, 0.5], [10, 0.55], [12, 0.65, 2], [13, 0.75, 2], [14, 0.85, 3], [15, 1, 3]] };
const STAR_HATS: Hits = { ...DISCO_BEAT, openHH: OFFBEATS.map(([step]): [number, number] => [step, 0.3]) };
const TRANSMIT: Hits = { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: DISCO_HATS, ride: [[3, 0.6], [7, 0.6]], snare2: [[11, 0.7], [15, 0.7]] };
const TRANSMIT_ROLL: Hits = { kick: [0, 4, 8, 12], snare: Array.from({ length: 16 }, (_, step): [number, number, number] => [step, 0.5 + step * 0.03, step >= 12 ? 2 : 1]) };
const REENTRY_BEATS: Hits[] = [1, 0.8, 0.6, 0.4].map((level): Hits => ({ kick: [[0, level], [4, level], [8, level], [12, level]], openHH: OFFBEATS.map(([step]): [number, number] => [step, level * 0.4]) }));

const SILVER_SATELLITE: SampleSong = {
  id: 'silver-satellite', name: 'Silver Satellite', genre: 'Space disco, 5 minutes',
  hint: 'Five minutes of space disco in A minor: a beatless countdown at its own 96 BPM, then 120 with an octave bass, four on the floor, a string machine through a phaser, a sequencer arpeggio, a clavinet, a gliding lead with a vibrato and tom fills, and breaks made by muting parts in their scenes',
  tempo: 120, kit: 'linndrum', drumVolume: 0.56, level: 0.53,
  lanes: [
    { preset: 'builtin-bass-101', name: 'Octave Bass', octaveShift: -1, sound: { duck: 0.3, fxSends: { reverb: 0 } } },
    { preset: 'builtin-keys-polysix', name: 'Starship Arp', sound: { gain: 1.4, arpeggiator: { enabled: true, mode: 'up', rate: '1/16', gate: 0.45, octaves: 2 }, duck: 0.2, fxSends: { reverb: 0.15, auxA: 0.35 } } },
    // A string machine: the ensemble thickened by a third copy and swept by the shared phaser.
    { preset: 'builtin-pad-strings', name: 'String Machine', sound: { unison: { voices: 3, detune: 0.25, mix: 0.8 }, duck: 0.25, fxSends: { reverb: 0.35, phaser: 0.6 } } },
    { preset: 'builtin-lead-odyssey', name: 'Magic Lead', sound: { gain: 2.1, ...glide(0.08), ...vibrato(0.2, 6), fxSends: { reverb: 0.2, auxA: 0.25, auxB: 0.2 } } },
    // Harder is brighter: the velocity opens the filter.
    { preset: 'builtin-keys-fm-clavisynth', name: 'Clav', sound: { gain: 1.2, pan: -0.25, modMatrix: [{ source: 'velocity', destination: 'filter', depth: 0.25 }], inserts: { tone: 0.25 }, fxSends: { reverb: 0.1, delay: 0.1 } } },
  ],
  // The clap rings out into the hall, the hats a little, the kick not at all; the toms either side.
  drums: { kick: { reverbSend: 0 }, closedHH: { reverbSend: 0.3 }, openHH: { reverbSend: 0.5 }, snare2: { pan: -0.3 }, ride: { pan: 0.3 } },
  drumSends: { reverb: 0.25 },
  effects: {
    phaser: { enabled: true, rate: 0.2, depth: 0.7, feedback: 0.5, mix: 0.5 },
    delay: { enabled: true, time: 0.375, feedback: 0.4, mix: 0.25, sync: '1/8d', color: 0.3, wow: 0.15 },
    reverb: { enabled: true, kind: 'hall', decay: 3, mix: 0.3, preDelay: 0.02, damping: 0.35 },
    aux: [{ kind: 'echo', level: 0.55, main: 0.375, shape: 0.45, sync: '1/8d' }, { kind: 'hall', level: 0.8, main: 4, shape: 0.3 }],
  },
  scenes: [
    // No drums until the last bar: the arpeggio's filter opens, the strings swell, the lead glides in.
    { id: 'satellite-countdown', name: 'Countdown', color: 'blue', bars: 8, tempo: 96,
      lanes: { 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 4: COUNTDOWN_LINE },
      drums: [{}, {}, {}, {}, {}, {}, {}, LAUNCH_ROLL],
      automation: { 2: { cutoff: ramp(BARS_8, 300, 4000) }, 3: { level: ramp(BARS_8, 0.2, 0.75) }, 4: { auxBSend: held(BARS_8, 0.6) } } },
    { id: 'satellite-liftoff', name: 'Lift-off', color: 'teal', bars: 8,
      lanes: { 1: octaveBass(ORBIT), 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 5: [[], [], [], [], ...clav(ORBIT).slice(4)] },
      drums: discoBars(DISCO_BEAT, true) },
    { id: 'satellite-orbit', name: 'Orbit', color: 'violet', bars: 8,
      lanes: { 1: octaveBass(ORBIT), 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 4: THEME, 5: clav(ORBIT) },
      drums: discoBars(DISCO_BEAT, true) },
    // The groove with its bass, arpeggio, kick and clap muted here, and the lead's two bars echoing.
    { id: 'satellite-starfield', name: 'Starfield', color: 'blue', bars: 8, laneBars: { 4: 2 },
      lanes: { 1: octaveBass(ORBIT), 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 4: STARFIELD_CALL },
      drums: [...Array<Hits>(7).fill(STAR_HATS), { ...STAR_HATS, ...DISCO_FILL, kick: DISCO_BEAT.kick }],
      mutes: { lanes: [1, 2], drums: ['kick', 'clap'] },
      automation: { 4: { auxBSend: held(32, 0.7), auxASend: held(32, 0.5) } } },
    // The bridge: through F, G and E minor to the E major that leads home, the lead gliding over long notes.
    { id: 'satellite-nebula', name: 'Nebula', color: 'pink', bars: 8,
      lanes: { 1: octaveBass(NEBULA), 2: discoArp(NEBULA), 3: discoStrings(NEBULA), 4: NEBULA_LINE, 5: clav(NEBULA) },
      drums: discoBars({ ...DISCO_BEAT, openHH: [] }, true),
      automation: { 2: { cutoff: ramp(BARS_8, 1500, 6000) } } },
    // Four bars of drums and the bass, the arpeggio opening like a rising signal, and a snare roll.
    { id: 'satellite-transmission', name: 'Transmission', color: 'green', bars: 4,
      lanes: { 1: octaveBass(['Am', 'Am', 'Am', 'Am']), 2: discoArp(['Am', 'Am', 'Am', 'Am']) },
      drums: [TRANSMIT, TRANSMIT, TRANSMIT, TRANSMIT_ROLL],
      automation: { 2: { cutoff: ramp(64, 400, 8000) } } },
    // Everything at once, brighter and dirtier.
    { id: 'satellite-hyperdrive', name: 'Hyperdrive', color: 'red', bars: 8,
      lanes: { 1: octaveBass(ORBIT), 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 4: THEME, 5: clav(ORBIT) },
      drums: discoBars({ ...DISCO_BEAT, openHH: OFFBEATS.map(([step]): [number, number] => [step, 0.65]) }, true).map((bar, index) => (index === 4 ? { ...bar, crash: [0] } : bar)),
      automation: { 1: { drive: held(BARS_8, 0.3) }, 2: { cutoff: held(BARS_8, 7000) }, 4: { auxASend: held(BARS_8, 0.4) } } },
    // The arpeggio closing, the kick fading out, the lead's last note held.
    { id: 'satellite-reentry', name: 'Re-entry', color: 'blue', bars: 8,
      lanes: { 2: discoArp(ORBIT), 3: discoStrings([...ORBIT.slice(0, 7), 'Am']), 4: [[], [], [], [], [], [], [[0, 'E5', 16, 0.6]], [[0, 'A4', 16, 0.55]]] },
      drums: [...REENTRY_BEATS, {}, {}, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_8, 5000, 300) }, 3: { level: ramp(BARS_8, 0.75, 0.2) } } },
  ],
  // The countdown's 8 bars at 96 BPM are 20 seconds; the other 140 bars at 120 are 280: five minutes.
  order: [
    ['satellite-countdown', 1], ['satellite-liftoff', 2], ['satellite-orbit', 2], ['satellite-starfield', 1], ['satellite-liftoff', 1],
    ['satellite-orbit', 2], ['satellite-nebula', 2], ['satellite-starfield', 1], ['satellite-transmission', 1], ['satellite-hyperdrive', 3],
    ['satellite-orbit', 2], ['satellite-reentry', 1],
  ],
};

// ---------------------------------------------------------------- Long Ascent (progressive house, 4/4)
// Built the way Eric Prydz's Opus is built, on a sequence of its own: one figure through D minor,
// B flat, F and C, two bars a chord, that begins as four notes a bar behind a closed filter and over
// five minutes gains notes (eighths, then sixteenths, then leaping an octave on every other one)
// while the filter opens, the kick, an off-beat bass, a counter-figure and strings come in, until a
// long breakdown, a snare roll, and the summit, where a supersaw takes the chords. Then it closes
// down the way it opened. The tune is not Opus's: only the way of building it is borrowed.

const ASCENT_CHORDS: Record<string, string[]> = {
  Dm: ['D4', 'F4', 'A4', 'D5'], Bb: ['D4', 'F4', 'A#4', 'D5'], F: ['C4', 'F4', 'A4', 'C5'], C: ['C4', 'E4', 'G4', 'C5'], A: ['C#4', 'E4', 'A4', 'C#5'],
};
const ASCENT_ROOTS: Record<string, string> = { Dm: 'D2', Bb: 'A#1', F: 'F2', C: 'C2', A: 'A1' };
const ASCENT = ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'];
const ASCENT_BREAK = ['Bb', 'Bb', 'C', 'C', 'Dm', 'Dm', 'A', 'A'];
// Which of the chord's four notes each sixteenth plays.
const FIGURE = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
// The figure at one note in `every` sixteenths, each held as long as the gap; `wide` puts every other note up an octave.
const figure = (chords: string[], every: 1 | 2 | 4, wide = false) => chords.map((name): Placed[] => FIGURE.flatMap((index, step): Placed[] => {
  if (step % every) return [];
  const note = ASCENT_CHORDS[name][index];
  return [[step, wide && step % 2 ? up(note, 12) : note, every === 4 ? 3 : every, step % 4 === 0 ? 0.9 : 0.7]];
}));
const offBass = (chords: string[]) => chords.map((name): Placed[] => [2, 6, 10, 14].map((step): Placed => [step, ASCENT_ROOTS[name], 2, 0.9]));
// The counter-figure: every third sixteenth, an octave up, so it turns against the bar.
const counter = (chords: string[]) => chords.map((name): Placed[] => [0, 3, 6, 9, 12].map((step, index): Placed => [step, up(ASCENT_CHORDS[name][index % 4], 12), 1, index === 0 ? 0.7 : 0.55]));
const ascentStrings = (chords: string[]) => chords.map((name): Placed[] => [[0, ASCENT_CHORDS[name].slice(0, 3).map(note => up(note, -12)).concat(ASCENT_CHORDS[name][3]), 16, 0.6]]);
// The summit's chords on the supersaw, pushed against the beat.
const summitChords = ASCENT.map((name): Placed[] => {
  const chord = ASCENT_CHORDS[name].slice(1).map(note => up(note, 12));
  return [[0, chord, 3, 0.95], [3, chord, 3, 0.8], [6, chord, 4, 0.9], [10, chord, 2, 0.75], [12, chord, 4, 0.85]];
});
const BREAK_LINE: Placed[][] = [
  [[0, 'F5', 8, 0.7], [8, 'D5', 8, 0.65]], [[0, 'A#5', 16, 0.7]], [[0, 'G5', 8, 0.7], [8, 'E5', 8, 0.65]], [[0, 'C6', 16, 0.75]],
  [[0, 'A5', 8, 0.7], [8, 'F5', 8, 0.7]], [[0, 'D6', 16, 0.8]], [[0, 'C#6', 8, 0.8], [8, 'E6', 8, 0.85]], [[0, 'A5', 16, 0.8]],
];
const ASCENT_HATS: Array<[number, number, number?, number?]> = Array.from({ length: 16 }, (_, step): [number, number, number, number] => [step, step % 4 === 2 ? 0.3 : 0.18, 1, step % 2 ? 0.6 : 1]);
const ASCENT_KICK: Hits = { kick: [0, 4, 8, 12] };
const ASCENT_GROOVE: Hits = { ...ASCENT_KICK, clap: [4, 12], closedHH: ASCENT_HATS, openHH: [2, 6, 10, 14].map((step): [number, number] => [step, 0.45]) };
const ASCENT_FILL: Hits = { ...ASCENT_GROOVE, snare: [[12, 0.6], [13, 0.7], [14, 0.8, 2], [15, 0.9, 2]] };
const ascentBars = (beat: Hits, crash = true): Hits[] => [crash ? { ...beat, crash: [0] } : beat, ...Array<Hits>(6).fill(beat), { ...beat, ...ASCENT_FILL, kick: beat.kick ?? [] }];
// The lift: the snare in quarters, eighths, sixteenths and then rolled, harder all the way.
const LIFT_ROLL: Hits[] = Array.from({ length: 8 }, (_, bar): Hits => {
  const every = bar < 2 ? 4 : bar < 4 ? 2 : 1;
  return { snare: Array.from({ length: 16 / every }, (_, index): [number, number, number] => [index * every, Number((0.35 + bar * 0.08 + index * 0.003).toFixed(3)), bar === 7 ? 2 : 1]) };
});

const LONG_ASCENT: SampleSong = {
  id: 'long-ascent', name: 'Long Ascent', genre: 'Progressive house, after Opus',
  hint: 'Five minutes of progressive house at 126 BPM, built the way Eric Prydz\'s Opus is built but on a tune of its own: one sequence that gains notes and opens its filter by automation, section by section, while the kick, an off-beat bass, a counter-figure turning against the bar and strings come in, a long breakdown with a snare roll, and a summit where a supersaw takes the chords',
  tempo: 126, kit: 'punchy-modern', drumVolume: 0.5, level: 0.5,
  lanes: [
    { preset: 'builtin-bass-sub', name: 'Off-beat Bass', sound: { duck: 0.4, fxSends: { reverb: 0 } } },
    { preset: 'builtin-pluck', name: 'Sequence', sound: { duck: 0.2, fxSends: { reverb: 0.25, auxA: 0.35 } } },
    { preset: 'builtin-pad-cs80', name: 'Strings', sound: { duck: 0.3, fxSends: { reverb: 0.5, auxB: 0.3 } } },
    { preset: 'builtin-lead-supersaw', name: 'Summit Saw', sound: { duck: 0.3, gain: 0.8, fxSends: { reverb: 0.35, delay: 0.15 } } },
    { preset: 'builtin-pluck-blip', name: 'Counter', sound: { pan: 0.3, fxSends: { delay: 0.35, reverb: 0.2 } } },
  ],
  drums: { kick: { reverbSend: 0 }, openHH: { reverbSend: 0.4 } },
  drumSends: { reverb: 0.2 },
  effects: {
    delay: { enabled: true, time: 0.357, feedback: 0.45, mix: 0.25, sync: '1/8d', color: 0.35 },
    reverb: { enabled: true, kind: 'hall', decay: 4, mix: 0.3, preDelay: 0.03, damping: 0.3 },
    aux: [{ kind: 'echo', level: 0.55, main: 0.357, shape: 0.45, sync: '1/8d' }, { kind: 'hall', level: 0.85, main: 5, shape: 0.3 }],
  },
  scenes: [
    // Four notes a bar behind a closed filter, and nothing else.
    { id: 'ascent-seed', name: 'Seed', color: 'blue', bars: 8, lanes: { 2: figure(ASCENT, 4) }, drums: Array(8).fill({}),
      automation: { 2: { cutoff: ramp(BARS_8, 350, 900) } } },
    // Eighths, and the hats.
    { id: 'ascent-sprout', name: 'Sprout', color: 'teal', bars: 8, lanes: { 2: figure(ASCENT, 2) },
      drums: [{}, {}, {}, {}, ...Array<Hits>(3).fill({ closedHH: ASCENT_HATS }), { closedHH: ASCENT_HATS, snare: [[12, 0.4], [14, 0.5]] }],
      automation: { 2: { cutoff: ramp(BARS_8, 900, 1600) } } },
    // Sixteenths, the kick and the off-beat bass.
    { id: 'ascent-pulse', name: 'Pulse', color: 'green', bars: 8, lanes: { 1: offBass(ASCENT), 2: figure(ASCENT, 1) },
      drums: ascentBars({ ...ASCENT_KICK, closedHH: ASCENT_HATS }),
      automation: { 2: { cutoff: ramp(BARS_8, 1600, 2500) } } },
    { id: 'ascent-growth', name: 'Growth', color: 'violet', bars: 8, lanes: { 1: offBass(ASCENT), 2: figure(ASCENT, 1), 5: counter(ASCENT) },
      drums: ascentBars(ASCENT_GROOVE),
      automation: { 2: { cutoff: ramp(BARS_8, 2500, 4000) } } },
    // The figure leaps an octave on every other note; the strings come in.
    { id: 'ascent-canopy', name: 'Canopy', color: 'pink', bars: 8, lanes: { 1: offBass(ASCENT), 2: figure(ASCENT, 1, true), 3: ascentStrings(ASCENT), 5: counter(ASCENT) },
      drums: ascentBars(ASCENT_GROOVE),
      automation: { 2: { cutoff: ramp(BARS_8, 4000, 6000) } } },
    // The drums go; the strings and a slow line on the saw over the figure in eighths, the filter half closed.
    { id: 'ascent-breakdown', name: 'Breakdown', color: 'blue', bars: 8, lanes: { 2: figure(ASCENT_BREAK, 2), 3: ascentStrings(ASCENT_BREAK), 4: BREAK_LINE },
      drums: Array(8).fill({}),
      automation: { 2: { cutoff: held(BARS_8, 1400) }, 4: { level: held(BARS_8, 0.5), auxBSend: held(BARS_8, 0.6) } } },
    // The snare rolls in, the figure back in sixteenths, its filter opening all the way.
    { id: 'ascent-lift', name: 'Lift', color: 'teal', bars: 8, lanes: { 2: figure(ASCENT_BREAK, 1), 3: ascentStrings(ASCENT_BREAK), 5: counter(ASCENT_BREAK) },
      drums: LIFT_ROLL,
      automation: { 2: { cutoff: ramp(BARS_8, 1400, 9000) }, 3: { level: ramp(BARS_8, 0.4, 0.9) } } },
    { id: 'ascent-summit', name: 'Summit', color: 'red', bars: 8, lanes: { 1: offBass(ASCENT), 2: figure(ASCENT, 1, true), 3: ascentStrings(ASCENT), 4: summitChords, 5: counter(ASCENT) },
      drums: ascentBars({ ...ASCENT_GROOVE, ride: [[2, 0.4], [6, 0.4], [10, 0.4], [14, 0.4]] }).map((bar, index) => (index === 4 ? { ...bar, crash: [0] } : bar)),
      automation: { 2: { cutoff: held(BARS_8, 9000) } } },
    // Down the way it came: the bass and the counter-figure go, the filter closes.
    { id: 'ascent-afterglow', name: 'Afterglow', color: 'violet', bars: 8, lanes: { 2: figure(ASCENT, 2), 3: ascentStrings(ASCENT) },
      drums: [ASCENT_GROOVE, ASCENT_GROOVE, ASCENT_KICK, ASCENT_KICK, { closedHH: ASCENT_HATS }, { closedHH: ASCENT_HATS }, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_8, 5000, 1200) }, 3: { level: ramp(BARS_8, 0.8, 0.4) } } },
    { id: 'ascent-last', name: 'Last Note', color: 'blue', bars: 8, lanes: { 2: [...figure(ASCENT, 4).slice(0, 7), [[0, 'D4', 16, 0.7]]], 3: [...ascentStrings(ASCENT).slice(0, 7), [[0, ['D3', 'F3', 'A3', 'D4'], 16, 0.55]]] },
      drums: Array(8).fill({}),
      automation: { 2: { cutoff: ramp(BARS_8, 1200, 350) }, 3: { level: ramp(BARS_8, 0.4, 0.05) } } },
  ],
  // 160 bars at 126 BPM: five minutes and five seconds.
  order: [
    ['ascent-seed', 2], ['ascent-sprout', 2], ['ascent-pulse', 2], ['ascent-growth', 2], ['ascent-canopy', 2], ['ascent-breakdown', 2],
    ['ascent-lift', 1], ['ascent-summit', 4], ['ascent-canopy', 1], ['ascent-afterglow', 1], ['ascent-last', 1],
  ],
};

export const SAMPLE_SONGS: SampleSong[] = [NIGHT_CIRCUIT, SIXTH_STREET, LATE_STUDY, SEVEN_LIGHTS, MARKET_DAY, CATHEDRAL, LANTERNS, SILVER_SATELLITE, LONG_ASCENT];
