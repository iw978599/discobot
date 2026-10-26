import type { Automation } from '../types';
import { transposeNote } from '../utils/midiExport';
import type { Hits, Placed, SampleSong } from './sampleSong';

// The songs offered on an empty project, each in another style and each showing off other parts of
// the app: time signatures, the recorded instruments, strummed and inverted chords, swing, the
// arpeggiator, the lanes' own effects, the aux buses and automation. Steps are sixteenths of the
// bar from 0; a bar of 3/4 or 6/8 has 12, 5/4 20, 7/8 14 and 12/8 24.

const up = (note: string, semitones: number) => transposeNote(note, semitones) ?? note;
const strum = (amount: number) => ({ strum: amount });
const late = (amount: number) => ({ offset: amount });
// A value for every step of a scene, from one level to another, or held.
const ramp = (steps: number, from: number, to: number): Array<number | null> => Array.from({ length: steps }, (_, index) => Number((from + (to - from) * index / Math.max(1, steps - 1)).toFixed(3)));
const held = (steps: number, value: number): Array<number | null> => Array(steps).fill(value);
// A slow vibrato on the second LFO, in semitones at its widest.
const vibrato = (depth: number, rate = 5.5) => ({ lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate, depth, sync: false, retrigger: true } });
const glide = (seconds: number) => ({ portamento: { enabled: true, glide: seconds, fingered: false, speed: false } });

// ---------------------------------------------------------------- Night Circuit (dark synthwave, 4/4)
// F minor at 104 BPM, after the darker side of synthwave: a Pro One bass pulsing in sixteenths and
// pushed down by every kick (its duck), a Juno running the chords through its arpeggiator, an OB pad,
// an MS-20 lead screaming through the Tube Screamer-style drive, and OB brass stabbing the off-beats.
// The bridge turns to G flat, a half step above the home chord, and to C major, the darkest pair in
// the key. The arpeggio comes in from behind a closed filter and goes out the same way.

const CIRCUIT_ROOTS = ['F2', 'C#2', 'G#1', 'D#2'];
const CIRCUIT_PADS = [['F3', 'G#3', 'C4'], ['F3', 'G#3', 'C#4'], ['D#3', 'G#3', 'C4'], ['D#3', 'G3', 'A#3']];
const CIRCUIT_ARPS = [['F4', 'G#4', 'C5'], ['F4', 'G#4', 'C#5'], ['D#4', 'G#4', 'C5'], ['D#4', 'G4', 'A#4']];
const UNDERTOW_ROOTS = ['F2', 'F#2', 'C#2', 'C2'];
const UNDERTOW_PADS = [['F3', 'G#3', 'C4'], ['F#3', 'A#3', 'C#4'], ['F3', 'G#3', 'C#4'], ['E3', 'G3', 'C4']];
const UNDERTOW_ARPS = [['F4', 'G#4', 'C5'], ['F#4', 'A#4', 'C#5'], ['F4', 'G#4', 'C#5'], ['E4', 'G4', 'C5']];
// Sixteen pulses a bar, the first of each beat the hardest, and the octave on the last but one.
const pulse = (root: string): Placed[] => Array.from({ length: 16 }, (_, step): Placed => [step, step === 14 ? up(root, 12) : root, 1, step % 4 === 0 ? 1 : 0.7]);
const held4 = (chords: string[][], velocity: number): Placed[][] => chords.map((chord): Placed[] => [[0, chord, 16, velocity]]);
const stabs = CIRCUIT_PADS.map((chord): Placed[] => [[6, chord.map(note => up(note, 12)), 2, 0.75], [14, chord.map(note => up(note, 12)), 2, 0.85]]);
const RUN_TUNE: Placed[][] = [
  [[0, 'C5', 3], [3, 'G#4'], [4, 'C5', 2], [6, 'D#5', 2], [8, 'F5', 6], [14, 'D#5', 2]],
  [[0, 'C#5', 6], [6, 'C5', 2], [8, 'G#4', 4], [12, 'F4', 4]],
  [[0, 'G#4', 3], [3, 'A#4'], [4, 'C5', 4], [8, 'D#5', 4], [12, 'C5', 4]],
  [[0, 'A#4', 6], [6, 'G4', 2], [8, 'D#5', 8]],
];
const UNDERTOW_TUNE: Placed[][] = [[[0, 'C5', 16, 0.7]], [[0, 'C#5', 16, 0.75]], [[0, 'C#5', 8, 0.7], [8, 'A#4', 8, 0.65]], [[0, 'C5', 16, 0.8]]];
const HATS16: Array<[number, number]> = Array.from({ length: 16 }, (_, step): [number, number] => [step, step % 4 === 0 ? 0.5 : step % 2 === 0 ? 0.35 : 0.22]);
// The same hats with the quietest ones left to chance, so no two bars are quite alike.
const LOOSE_HATS16 = HATS16.map(([step, velocity]): [number, number, number, number] => [step, velocity, 1, step % 2 ? 0.7 : 1]);
const CIRCUIT_BEAT: Hits = { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: LOOSE_HATS16, openHH: [[14, 0.5]] };
const CIRCUIT_DRIVE: Hits = { ...CIRCUIT_BEAT, snare: [[4, 0.8], [12, 0.8]] };
const CIRCUIT_FILL: Hits = { ...CIRCUIT_DRIVE, snare2: [[12, 0.8], [13, 0.85]], ride: [[14, 0.9], [15, 0.95]], openHH: [] };
const BARS_4 = 4 * 16;

const NIGHT_CIRCUIT: SampleSong = {
  id: 'night-circuit', name: 'Night Circuit', genre: 'Dark synthwave',
  hint: 'Dark synthwave in F minor at 104 BPM on five named lanes: a pulsing Pro One bass ducked by the kick, a Juno through its arpeggiator, an OB pad with a slow second layer, an MS-20 lead gliding through the Tube Screamer-style drive with a vibrato, OB brass stabs, and hats left partly to chance',
  tempo: 104, kit: 'punchy-modern', drumVolume: 0.42, level: 0.65,
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
    // The arpeggio alone, its filter opening; the pad underneath, and the hats coming in.
    { id: 'circuit-ignition', name: 'Ignition', color: 'blue', bars: 4, lanes: { 2: held4(CIRCUIT_ARPS, 0.8), 3: held4(CIRCUIT_PADS, 0.55) },
      drums: [{}, {}, { closedHH: HATS16 }, { closedHH: HATS16, openHH: [[14, 0.5]] }],
      automation: { 2: { cutoff: ramp(BARS_4, 300, 5000) } } },
    { id: 'circuit-pulse', name: 'Pulse', color: 'violet', bars: 4, lanes: { 1: CIRCUIT_ROOTS.map(pulse), 2: held4(CIRCUIT_ARPS, 0.8), 3: held4(CIRCUIT_PADS, 0.6) },
      drums: [CIRCUIT_BEAT, CIRCUIT_BEAT, CIRCUIT_BEAT, CIRCUIT_FILL] },
    { id: 'circuit-run', name: 'Run', color: 'red', bars: 4, lanes: { 1: CIRCUIT_ROOTS.map(pulse), 2: held4(CIRCUIT_ARPS, 0.8), 3: held4(CIRCUIT_PADS, 0.6), 4: RUN_TUNE, 5: stabs },
      drums: [{ ...CIRCUIT_DRIVE, crash: [0] }, CIRCUIT_DRIVE, CIRCUIT_DRIVE, CIRCUIT_FILL] },
    // A half step up to G flat and down to C major: the lead held, its echo growing, the kick gone.
    { id: 'circuit-undertow', name: 'Undertow', color: 'teal', bars: 4, lanes: { 1: UNDERTOW_ROOTS.map((root): Placed[] => [[0, root, 16, 0.8]]), 2: held4(UNDERTOW_ARPS, 0.7), 3: held4(UNDERTOW_PADS, 0.6), 4: UNDERTOW_TUNE },
      drums: [{ closedHH: HATS16.filter(([step]) => step % 2 === 0) }, { closedHH: HATS16.filter(([step]) => step % 2 === 0) }, { closedHH: HATS16 }, { closedHH: HATS16, snare: [[12, 0.5], [13, 0.6], [14, 0.7], [15, 0.85]] }],
      automation: { 4: { auxASend: ramp(BARS_4, 0.2, 0.75) }, 3: { cutoff: held(BARS_4, 1200) } } },
    // The lead dirtier and brighter as the section goes on.
    { id: 'circuit-overdrive', name: 'Overdrive', color: 'pink', bars: 4, lanes: { 1: CIRCUIT_ROOTS.map(pulse), 2: held4(CIRCUIT_ARPS, 0.85), 3: held4(CIRCUIT_PADS, 0.65), 4: RUN_TUNE, 5: stabs },
      drums: [{ ...CIRCUIT_DRIVE, crash: [0] }, CIRCUIT_DRIVE, { ...CIRCUIT_DRIVE, crash: [0] }, CIRCUIT_FILL],
      automation: { 4: { drive: ramp(BARS_4, 0.1, 0.7), cutoff: ramp(BARS_4, 2500, 9000) } } },
    // The arpeggio closes again and fades; the pad is last.
    { id: 'circuit-shutdown', name: 'Shutdown', color: 'blue', bars: 4, lanes: { 2: held4(CIRCUIT_ARPS, 0.7), 3: held4(CIRCUIT_PADS, 0.5) },
      drums: [{ kick: [[0, 0.8]], closedHH: HATS16 }, { kick: [[0, 0.6]] }, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_4, 5000, 300) }, 3: { cutoff: ramp(BARS_4, 2500, 300) } } },
  ],
  order: [['circuit-ignition', 1], ['circuit-pulse', 2], ['circuit-run', 2], ['circuit-undertow', 1], ['circuit-overdrive', 2], ['circuit-run', 1], ['circuit-shutdown', 1]],
};

// ---------------------------------------------------------------- Blue Waltz (jazz waltz, 3/4)
// F major, a bar of three beats (steps 0, 4 and 8). The piano comps on beats two and three with
// strummed chords; the sax plays the head, then a solo whose off-beat eighths are written late, a
// triplet's worth, which is how a swung eighth is put between steps.

const WALTZ_CHORDS = [['F3', 'A3', 'C4', 'E4'], ['F#3', 'A3', 'C4', 'D4'], ['F3', 'A#3', 'D4', 'G4'], ['E3', 'G3', 'A#3', 'C4'],
  ['G3', 'A3', 'C4', 'E4'], ['F#3', 'A3', 'C4', 'D4'], ['F3', 'A#3', 'D4', 'G4'], ['E3', 'G3', 'A#3', 'C4']];
const WALTZ_WALK = [['F2', 'A2', 'C3'], ['D2', 'F#2', 'A2'], ['G2', 'A#2', 'D3'], ['C3', 'A#2', 'G2'], ['A2', 'C3', 'E3'], ['D3', 'C3', 'A2'], ['G2', 'A2', 'A#2'], ['C3', 'E2', 'G2']];
const walk = WALTZ_WALK.map((bar): Placed[] => bar.map((note, beat): Placed => [beat * 4, note, 3, beat === 0 ? 0.9 : 0.75]));
const comp = WALTZ_CHORDS.map((chord, bar): Placed[] => [[4, chord, 3, 0.55, strum(1 / 16)], [8, chord, bar % 2 ? 4 : 2, 0.5, strum(1 / 16)]]);
const compSparse = WALTZ_CHORDS.map((chord): Placed[] => [[4, chord, 6, 0.45, strum(1 / 8)]]);
const HEAD: Placed[][] = [
  [[0, 'C5', 4], [4, 'A4', 4], [8, 'F4', 4]],
  [[0, 'F#4', 6], [6, 'A4', 2], [8, 'C5', 4]],
  [[0, 'A#4', 8], [8, 'A4', 2], [10, 'G4', 2]],
  [[0, 'E4', 8], [8, 'G4', 4]],
  [[0, 'E5', 4], [4, 'C5', 4], [8, 'A4', 4]],
  [[0, 'D5', 6], [6, 'C5', 2], [8, 'A4', 4]],
  [[0, 'A#4', 4], [4, 'D5', 4], [8, 'C5', 4]],
  [[0, 'A#4', 6], [6, 'G4', 2], [8, 'E4', 4]],
];
// Eighths, each second one late: a swung line.
const swung = (notes: string[]): Placed[] => notes.map((note, index): Placed => [index * 2, note, index % 2 ? 1 : 2, index % 2 ? 0.7 : 0.85, index % 2 ? late(0.67) : {}]);
const SOLO: Placed[][] = [
  swung(['F4', 'A4', 'C5', 'E5', 'D5', 'C5']),
  swung(['A4', 'F#4', 'D4', 'F#4', 'C5', 'A4']),
  swung(['A#4', 'D5', 'C5', 'A#4', 'A4', 'G4']),
  swung(['G4', 'E4', 'C4', 'E4', 'G4', 'A#4']),
  swung(['A4', 'C5', 'E5', 'G5', 'E5', 'C5']),
  swung(['D5', 'C5', 'A4', 'F#4', 'A4', 'D5']),
  swung(['D5', 'C5', 'A#4', 'G4', 'A4', 'A#4']),
  [[0, 'C5', 6, 0.85], [8, 'E4', 2], [10, 'G4', 2, 0.7, late(0.67)]],
];
// The ride's skip beat (step 7) is left to chance, as a drummer would not play it every bar.
const RIDE: Hits = { crash: [[0, 0.7], [4, 0.6], [7, 0.4, 1, 0.65], [8, 0.6]], closedHH: [[4, 0.4], [8, 0.35]], kick: [[0, 0.35]] };
const RIDE_STICK: Hits = { ...RIDE, snare: [[8, 0.5]] };
const RIDE_FILL: Hits = { ...RIDE, snare: [[6, 0.4], [8, 0.55], [10, 0.6], [11, 0.75]], kick: [[0, 0.35], [11, 0.5]] };
const waltzDrums = (fill: boolean): Hits[] => [RIDE, RIDE_STICK, RIDE, RIDE_STICK, RIDE, RIDE_STICK, RIDE, fill ? RIDE_FILL : RIDE_STICK];

const BLUE_WALTZ: SampleSong = {
  id: 'blue-waltz', name: 'Blue Waltz', genre: 'Jazz waltz',
  hint: 'A jazz waltz in 3/4 at 152 BPM: a Steinway comping in strummed chords, a tenor sax head and a swung solo with a vibrato, a walking bass, and the recorded kit with a ride whose skip beat comes and goes and a cross-stick sent further into the room than the rest',
  tempo: 152, kit: 'recorded',
  lanes: [
    { preset: 'builtin-bass', name: 'Upright', octaveShift: -1, sound: { fxSends: { reverb: 0.15 } } },
    { preset: 'builtin-keys-steinway-grand', name: 'Piano', sound: { fxSends: { reverb: 0.3, auxB: 0.15, chorus: 0.2 } } },
    { preset: 'builtin-lead-tenor-sax', name: 'Tenor Sax', sound: { ...vibrato(0.2, 5), fxSends: { reverb: 0.25, auxB: 0.3 } } },
  ],
  // Each drum's own share of the kit's reverb: the cross-stick all of it, the ride and hats less, the kick none.
  drums: {
    crash: { cymbalType: 'ride', volume: 0.55, reverbSend: 0.6 }, snare: { percType: 'sidestick', volume: 0.6 },
    closedHH: { volume: 0.5, reverbSend: 0.6 }, kick: { volume: 0.6, reverbSend: 0 },
  },
  drumSends: { reverb: 0.35 },
  effects: {
    reverb: { enabled: true, kind: 'room', decay: 0.9, mix: 0.25, preDelay: 0.01, damping: 0.4 },
    chorus: { enabled: true, rate: 0.25, depth: 0.2, mix: 0.45 },
  },
  scenes: [
    { id: 'waltz-head', name: 'Head', color: 'blue', signature: '3/4', bars: 8, lanes: { 1: walk, 2: comp, 3: HEAD }, drums: waltzDrums(true) },
    { id: 'waltz-solo', name: 'Sax Solo', color: 'violet', signature: '3/4', bars: 8, lanes: { 1: walk, 2: compSparse, 3: SOLO }, drums: waltzDrums(true) },
    { id: 'waltz-out', name: 'Head Out', color: 'teal', signature: '3/4', bars: 8,
      lanes: { 1: walk, 2: comp, 3: [...HEAD.slice(0, 7), [[0, 'A4', 12, 0.8]]] }, drums: [...waltzDrums(false).slice(0, 7), { crash: [[0, 0.7]], kick: [[0, 0.5]] }] },
  ],
  order: [['waltz-head', 1], ['waltz-solo', 2], ['waltz-out', 1]],
};

// ---------------------------------------------------------------- Late Study (lo-fi hip hop, 4/4)
// D minor, swung: the drums by their Swing knob and the piano and bass by their lanes' Swing. A felt
// piano made dusty by its own drive, tone and chorus; an FM piano answering through a dub echo whose
// send comes up in the second half.

const LOFI_CHORDS = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'E4'], ['E3', 'G3', 'B3', 'D4'], ['G3', 'C#4', 'F4']];
const LOFI_ROOTS = ['D2', 'G2', 'C2', 'A2'];
const lofiKeys = LOFI_CHORDS.map((chord): Placed[] => [[0, chord, 6, 0.6, strum(1 / 8)], [7, chord, 6, 0.45, strum(1 / 8)]]);
const lofiBass = LOFI_ROOTS.map((root): Placed[] => [[0, root, 5, 0.85], [7, root, 2, 0.6], [10, up(root, 7), 2, 0.6], [14, up(root, 12), 1, 0.5]]);
const LOFI_TUNE: Placed[][] = [
  [[2, 'A4', 2, 0.7], [4, 'C5', 4, 0.75], [10, 'D5', 2, 0.6], [12, 'C5', 4, 0.7]],
  [[0, 'B4', 6, 0.7], [8, 'G4', 2, 0.6], [11, 'A4', 4, 0.65]],
  [[2, 'G4', 2, 0.65], [4, 'B4', 4, 0.7], [10, 'C5', 2, 0.6], [12, 'D5', 4, 0.75]],
  [[0, 'E5', 6, 0.75], [8, 'C#5', 4, 0.6], [12, 'A4', 4, 0.6]],
];
// The quiet in-between hats play only half the time: a dusty, uneven sixteenth.
const lofiHats = (open: boolean): Array<number | [number, number, number, number]> => Array.from({ length: 16 }, (_, step): [number, number, number, number] => [step, step % 4 === 0 ? 0.5 : step % 2 === 0 ? 0.4 : 0.2, 1, step % 2 ? 0.5 : 1]).filter(([step]) => !open || step !== 14);
const LOFI_BEAT: Hits = { kick: [0, [7, 0.7], 10], snare: [4, 12], closedHH: lofiHats(false) };
const LOFI_TURN: Hits = { kick: [0, [7, 0.7], 10], snare: [4, 12, [15, 0.35]], closedHH: lofiHats(true), openHH: [[14, 0.55]] };
const lofiDrums = [LOFI_BEAT, LOFI_BEAT, LOFI_BEAT, LOFI_TURN];

const LATE_STUDY: SampleSong = {
  id: 'late-study', name: 'Late Study', genre: 'Lo-fi hip hop',
  hint: 'Lo-fi hip hop in D minor at 80 BPM, swung throughout: a felt piano made dusty by its own drive, tone and chorus and wavering on a detuned second layer, strummed jazz chords, an FM piano whose echo send rises by automation and whose notes land anywhere in the stereo, hats left to chance, and an outro that slows like a tape winding down',
  tempo: 80, drumSwing: 0.45, kit: 'lofi-dirty', drumVolume: 0.7, level: 0.85,
  lanes: [
    { preset: 'builtin-bass', name: 'Bass', octaveShift: -1, swing: true },
    { preset: 'builtin-grand-piano', name: 'Rhodes', swing: true, sound: {
      layer: { enabled: true, mix: 0.3, detune: 14, brightness: -0.5, attack: 0, width: 0.6 },
      inserts: { drive: 0.3, tone: -0.45, chorus: { mix: 0.35, depth: 0.5, rate: 0.4 } }, fxSends: { reverb: 0.3 } } },
    // A route from the random source to the pan puts each note somewhere else.
    { preset: 'builtin-keys-d50-bell', name: 'Bells', sound: { modMatrix: [{ source: 'random', destination: 'pan', depth: 0.5 }], fxSends: { reverb: 0.2, auxA: 0.2, delay: 0.25 } } },
  ],
  effects: {
    reverb: { enabled: true, kind: 'room', decay: 1.6, mix: 0.3, preDelay: 0.02, damping: 0.6 },
    // The bells' tape echo: darker each time round, and wavering.
    delay: { enabled: true, time: 0.38, feedback: 0.5, mix: 0.3, color: 0.55, wow: 0.45 },
    aux: [{ kind: 'echo', level: 0.65, main: 0.56, shape: 0.55 }, { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 }],
    eq: { enabled: true, low: 2, mid: 0, high: -4 },
  },
  scenes: [
    // The piano comes in from behind a closed filter.
    { id: 'lofi-intro', name: 'Intro', color: 'teal', bars: 4, lanes: { 2: lofiKeys }, drums: [{}, {}, { closedHH: lofiHats(false) }, LOFI_TURN],
      automation: { 2: { cutoff: ramp(64, 400, 4000) } } },
    { id: 'lofi-loop', name: 'Loop', color: 'blue', bars: 4, lanes: { 1: lofiBass, 2: lofiKeys }, drums: lofiDrums },
    { id: 'lofi-tune', name: 'Tune', color: 'pink', bars: 4, lanes: { 1: lofiBass, 2: lofiKeys, 3: LOFI_TUNE }, drums: lofiDrums,
      automation: { 3: { auxASend: [...held(32, 0.15), ...ramp(32, 0.15, 0.7)] } } },
    // A little slower than the rest, as if the tape were running down.
    { id: 'lofi-outro', name: 'Outro', color: 'green', bars: 4, tempo: 74, lanes: { 2: lofiKeys, 3: LOFI_TUNE.map(bar => bar.slice(0, 1)) }, drums: [LOFI_BEAT, { closedHH: lofiHats(false) }, {}, {}],
      automation: { 2: { cutoff: ramp(64, 4000, 500) } } },
  ],
  order: [['lofi-intro', 1], ['lofi-loop', 1], ['lofi-tune', 2], ['lofi-loop', 1], ['lofi-outro', 1]],
};

// ---------------------------------------------------------------- Seven Lights (electronic, 7/8)
// E minor, seven eighths to the bar counted two, two, three (beats on steps 0, 4 and 8 of 14). An
// acid bass whose filter is swept by automation, held chords run through the arpeggiator, a
// supersaw pad, and hats rolled with repeats.

const SEVEN_CHORDS = [['E4', 'G4', 'B4'], ['C4', 'E4', 'G4', 'B4'], ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4']];
const SEVEN_PAD = [['E3', 'B3', 'G4'], ['C3', 'G3', 'E4'], ['G3', 'D4', 'B4'], ['D3', 'A3', 'F#4']];
const SEVEN_ROOTS = ['E2', 'C2', 'G2', 'D2'];
const acid = (root: string): Placed[] => [
  [0, root, 1, 1], [2, root, 1, 0.6], [3, up(root, 12), 1, 0.9, { slide: true }], [4, root, 1, 0.6],
  [6, up(root, 7), 1, 1], [8, root, 1, 0.6], [10, up(root, 10), 1, 0.9, { slide: true }], [11, up(root, 12), 1, 0.7], [12, root, 1, 1],
];
const sevenBass = SEVEN_ROOTS.map(acid);
const arpChords = SEVEN_CHORDS.map((chord): Placed[] => [[0, chord, 14, 0.8]]);
const sevenPad = SEVEN_PAD.map((chord): Placed[] => [[0, chord, 14, 0.6]]);
// A ghost hat before the bar comes round, there about half the time.
const SEVEN_HATS: Array<number | [number, number, number?, number?]> = [...[0, 2, 4, 6, 8, 10, 12].map((step): [number, number] => [step, step === 0 || step === 4 || step === 8 ? 0.6 : 0.4]), [13, 0.25, 1, 0.5]];
const SEVEN_BEAT: Hits = { kick: [0, 8, [11, 0.6]], clap: [4, 12], closedHH: SEVEN_HATS, openHH: [[6, 0.5]] };
const SEVEN_ROLL: Hits = { ...SEVEN_BEAT, closedHH: [...SEVEN_HATS.filter(hit => (Array.isArray(hit) ? hit[0] : hit) < 10) as Array<[number, number]>, [10, 0.5, 3], [12, 0.6, 4]], snare: [[13, 0.7]] };
const sevenDrums = [SEVEN_BEAT, SEVEN_BEAT, SEVEN_BEAT, SEVEN_ROLL];
const STEPS_7 = 4 * 14;

const SEVEN_LIGHTS: SampleSong = {
  id: 'seven-lights', name: 'Seven Lights', genre: 'Electronic in 7/8',
  hint: 'Electronic music in 7/8 at 128 BPM: an acid bass with slides and accents whose filter is swept by automation, chords run through the arpeggiator, a supersaw pad and rolled hats on a TR-909, and a break made by muting the bass, the kick and the clap in its scene, their notes left in place',
  tempo: 128, kit: 'tr-909', drumVolume: 0.8, level: 0.85,
  lanes: [
    { preset: 'builtin-bass-acid', name: 'Acid', octaveShift: -1, sound: { fxSends: { delay: 0.15 } } },
    { preset: 'builtin-pad-jp', name: 'Supersaw Pad', sound: { fxSends: { reverb: 0.35 } } },
    { preset: 'builtin-pluck-bell', name: 'Arp Bells', octaveShift: 1,
      sound: { arpeggiator: { enabled: true, mode: 'updown', rate: '1/16', gate: 0.55, octaves: 2 }, fxSends: { delay: 0.25, auxA: 0.3 } } },
  ],
  effects: {
    delay: { enabled: true, time: 0.375, feedback: 0.45, mix: 0.25, sync: '1/8d' },
    reverb: { enabled: true, kind: 'hall', decay: 3, mix: 0.3, preDelay: 0.02, damping: 0.3 },
    aux: [{ kind: 'chorus', level: 0.7, main: 0.6, shape: 0.5 }, { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 }],
  },
  scenes: [
    { id: 'seven-rise', name: 'Rise', color: 'violet', signature: '7/8', bars: 4, lanes: { 1: sevenBass, 2: sevenPad },
      drums: [{ closedHH: SEVEN_HATS }, { closedHH: SEVEN_HATS }, { closedHH: SEVEN_HATS, kick: [0, 8] }, SEVEN_ROLL],
      automation: { 1: { cutoff: ramp(STEPS_7, 250, 1800) } } },
    { id: 'seven-drive', name: 'Drive', color: 'red', signature: '7/8', bars: 4, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords }, drums: sevenDrums,
      automation: { 1: { cutoff: ramp(STEPS_7, 900, 3500) } } },
    // The Drive with the bass, the kick and the clap muted in this scene: unmute them to hear it whole.
    { id: 'seven-break', name: 'Break', color: 'blue', signature: '7/8', bars: 4, lanes: { 1: sevenBass, 2: sevenPad, 3: arpChords },
      drums: [SEVEN_BEAT, SEVEN_BEAT, SEVEN_BEAT, { ...SEVEN_BEAT, snare: [[8, 0.4], [10, 0.5], [12, 0.6, 2], [13, 0.8, 2]] }],
      mutes: { lanes: [1], drums: ['kick', 'clap'] } },
  ],
  order: [['seven-rise', 1], ['seven-drive', 2], ['seven-break', 1], ['seven-drive', 2]],
};

// ---------------------------------------------------------------- Market Day (Afrobeat, 12/8)
// D dorian in 12/8: four dotted-quarter beats to the bar (steps 0, 6, 12 and 18 of 24). The
// cymbal lane is a bell playing the standard twelve-eight pattern; congas, bongos and a shaker take
// the places of the toms and the clap. A marimba ostinato, an FM bass and a kalimba through an echo.

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
const DM_RUN = ['D4', 'A4', 'F4', 'A4', 'C5', 'A4', 'D4', 'A4', 'F4', 'A4', 'E4', 'F4'];
const G_RUN = ['B3', 'G4', 'D4', 'G4', 'B4', 'G4', 'B3', 'G4', 'D4', 'G4', 'F4', 'D4'];
const ostinato = (run: string[]): Placed[] => run.map((note, eighth): Placed => [eighth * 2, note, 2, eighth % 3 === 0 ? 0.85 : 0.6]);
// Two bars, looping under four-bar scenes: the lane is shorter than the scene.
const marimba = [ostinato(DM_RUN), ostinato(G_RUN)];
const marketBass = ['D2', 'G2', 'D2', 'G2'].map((root): Placed[] => [[0, root, 5, 0.9], [8, up(root, 7), 2, 0.7], [12, root, 4, 0.85], [20, up(root, 10), 2, 0.7], [22, up(root, 12), 2, 0.6]]);
const KALIMBA: Placed[][] = [
  [[0, 'A5', 4], [6, 'F5', 2], [8, 'E5', 2], [12, 'D5', 6]],
  [[0, 'D5', 4], [6, 'B4', 2], [8, 'D5', 2], [12, 'G5', 6]],
  [[0, 'A5', 4], [6, 'C6', 2], [8, 'A5', 2], [12, 'F5', 4], [18, 'E5', 4]],
  [[0, 'D5', 6], [12, 'B4', 2], [14, 'D5', 2], [18, 'G4', 6]],
];
const STEPS_12 = 4 * 24;

const MARKET_DAY: SampleSong = {
  id: 'market-day', name: 'Market Day', genre: 'Afrobeat in 12/8',
  hint: 'An Afrobeat groove in 12/8 at 96 BPM on the recorded kit: a bell pattern, congas, bongos and a shaker that breathes by chance, a two-bar marimba ostinato looping under four-bar scenes, an SH-101 bass, and a kalimba answering through an echo',
  tempo: 96, kit: 'recorded', drumVolume: 0.85,
  lanes: [
    { preset: 'builtin-bass-101', name: 'Bass', octaveShift: -1 },
    { preset: 'builtin-pluck-m1-marimba', name: 'Marimba', sound: { fxSends: { reverb: 0.2 } } },
    { preset: 'builtin-pluck-kalimba', name: 'Kalimba', sound: { fxSends: { reverb: 0.25, auxA: 0.4 }, pan: 0.3 } },
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
    { id: 'market-groove', name: 'Groove', color: 'green', signature: '12/8', bars: 4, lanes: { 1: marketBass, 2: marimba }, laneBars: { 2: 2 },
      drums: [MARKET_GROOVE, MARKET_GROOVE, MARKET_GROOVE, MARKET_FILL] },
    { id: 'market-call', name: 'Call', color: 'pink', signature: '12/8', bars: 4, lanes: { 1: marketBass, 2: marimba, 3: KALIMBA }, laneBars: { 2: 2 },
      drums: [MARKET_GROOVE, MARKET_GROOVE, MARKET_GROOVE, MARKET_FILL],
      automation: { 3: { pan: [...held(STEPS_12 / 2, 0.4), ...held(STEPS_12 / 2, -0.4)] } } },
  ],
  order: [['market-start', 1], ['market-groove', 2], ['market-call', 2], ['market-groove', 1]],
};

// ---------------------------------------------------------------- Cathedral (ambient, 5/4)
// A minor in five: a pipe organ, a CS-80 that swells under it, a lead sent ever further into the
// long Hall by automation, and a kick like a slow heart.

const ORGAN_CHORDS = [['A3', 'B3', 'C4', 'E4'], ['F3', 'A3', 'B3', 'E4'], ['C4', 'E4', 'G4'], ['B3', 'D4', 'G4']];
const organ = ORGAN_CHORDS.map((chord): Placed[] => [[0, chord, 20, 0.6]]);
const swell = ['A2', 'F2', 'C3', 'G2'].map((root): Placed[] => [[0, [root, up(root, 7), up(root, 12)], 20, 0.5]]);
const CHANT: Placed[][] = [
  [[0, 'E5', 8], [8, 'D5', 4], [12, 'C5', 8]],
  [[0, 'B4', 12], [12, 'C5', 4], [16, 'A4', 4]],
  [[0, 'G4', 8], [8, 'C5', 8], [16, 'E5', 4]],
  [[0, 'D5', 16], [16, 'B4', 4]],
];
const HEART: Hits = { kick: [[0, 0.7], [3, 0.4]] };
const STEPS_5 = 4 * 20;
const auxSwell: Automation = { auxBSend: ramp(STEPS_5, 0.1, 0.9) };

const CATHEDRAL: SampleSong = {
  id: 'cathedral', name: 'Cathedral', genre: 'Ambient in 5/4',
  hint: 'Ambient music in 5/4 at 72 BPM, slowing to 60 for its last scene: a pipe organ, a CS-80 swell with a second layer an octave up fading in under it, a lead that glides and wavers and is sent ever deeper into the long Hall by automation, and a heartbeat kick',
  tempo: 72, kit: 'clean-analog', level: 0.54,
  lanes: [
    { preset: 'builtin-pad-cs80-swell', name: 'Swell', octaveShift: -1, sound: { gain: 0.8, layer: { enabled: true, mix: 0.3, detune: 1200, brightness: -0.5, attack: 1.5, width: 1 }, fxSends: { reverb: 0.5, phaser: 0.4 } } },
    { preset: 'builtin-keys-pipe-organ', name: 'Organ', sound: { fxSends: { reverb: 0.45 } } },
    { preset: 'builtin-lead-ms-hollow', name: 'Choir Lead', octaveShift: 1, sound: { ...glide(0.12), ...vibrato(0.3, 4.5), fxSends: { reverb: 0.3, auxA: 0.25, auxB: 0.1 } } },
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
    { id: 'cathedral-choir', name: 'Choir', color: 'violet', signature: '5/4', bars: 4, lanes: { 1: swell, 2: organ, 3: CHANT }, drums: [HEART, HEART, HEART, HEART],
      automation: { 3: auxSwell } },
    // Without the heartbeat, slower.
    { id: 'cathedral-light', name: 'Light', color: 'teal', signature: '5/4', bars: 4, tempo: 60, lanes: { 1: swell, 3: CHANT.map(bar => bar.slice(0, 1)) }, drums: [{}, {}, {}, {}],
      automation: { 3: { auxBSend: held(STEPS_5, 0.9) } } },
  ],
  order: [['cathedral-nave', 1], ['cathedral-choir', 2], ['cathedral-light', 1]],
};

// ---------------------------------------------------------------- Lanterns Over Dark Water (post-rock, 4/4)
// Seven minutes in B minor at 100 BPM, after the manner of Mogwai: the same four chords (Bm, G, D, A,
// two bars each) all the way through, and everything else about it moving. A clean guitar picks an
// arpeggio into a dotted-eighth echo; a glockenspiel rings into a long hall; strings swell; and a
// wall of distorted, tremolo-picked guitar (a step repeated four times, a sixteenth each) climbs out
// of nothing. The dynamics are made with the effects as much as the notes: the guitar's filter opens
// through the first section and closes in the last, the wall's level, brightness and drive are swept
// up through each Rise and down through the Fall, and the reverb and the hall take more of each lane
// the quieter the music gets.

const BARS_8 = 8 * 16;
const LANTERN_CHORDS = [
  ['B3', 'F#4', 'B4', 'D5'], ['B3', 'F#4', 'B4', 'D5'], ['G3', 'D4', 'G4', 'B4'], ['G3', 'D4', 'G4', 'B4'],
  ['D4', 'A4', 'D5', 'F#5'], ['D4', 'A4', 'D5', 'F#5'], ['A3', 'E4', 'A4', 'C#5'], ['A3', 'E4', 'A4', 'C#5'],
];
const LANTERN_ROOTS = ['B1', 'B1', 'G1', 'G1', 'D2', 'D2', 'A1', 'A1'];
// The guitar's figure: eight eighths through the chord, the first of each beat a little harder.
const PICK = [0, 1, 2, 3, 1, 2, 3, 2];
const picking = (gentle: number) => LANTERN_CHORDS.map((chord): Placed[] => PICK.map((note, eighth): Placed => [eighth * 2, chord[note], 2, (eighth % 2 ? 0.55 : 0.75) * gentle]));
const bassHeld = LANTERN_ROOTS.map((root, bar): Placed[] => (bar % 2 ? [] : [[0, root, 32, 0.8]]));
const bassDriving = LANTERN_ROOTS.map((root): Placed[] => Array.from({ length: 8 }, (_, eighth): Placed => [eighth * 2, root, 2, eighth % 4 === 0 ? 1 : 0.85]));
const GLOCK: Placed[][] = [
  [[0, 'F#5', 4, 0.7], [4, 'D5', 4, 0.6], [8, 'B5', 8, 0.75]],
  [[0, 'A5', 4, 0.6], [4, 'F#5', 12, 0.65]],
  [[0, 'G5', 4, 0.7], [4, 'B5', 4, 0.6], [8, 'D6', 8, 0.75]],
  [[0, 'B5', 8, 0.65], [8, 'A5', 8, 0.6]],
  [[0, 'F#5', 4, 0.7], [4, 'A5', 4, 0.6], [8, 'D6', 8, 0.75]],
  [[0, 'A5', 8, 0.65], [8, 'F#5', 8, 0.6]],
  [[0, 'E5', 4, 0.7], [4, 'A5', 4, 0.6], [8, 'C#6', 8, 0.75]],
  [[0, 'B5', 8, 0.65], [8, 'A5', 8, 0.6]],
];
const GLOCK_SPARSE = GLOCK.map((bar, index): Placed[] => (index % 2 ? [] : bar.slice(-1)));
const STRING_CHORDS = [['B3', 'D4', 'F#4'], ['G3', 'B3', 'D4'], ['F#3', 'A3', 'D4'], ['E3', 'A3', 'C#4']];
const strings = STRING_CHORDS.flatMap((chord): Placed[][] => [[[0, chord, 32, 0.7]], []]);
// The wall: a power chord on every beat, each beat picked four times.
const POWER = [['B2', 'F#3', 'B3'], ['G2', 'D3', 'G3'], ['D3', 'A3', 'D4'], ['A2', 'E3', 'A3']];
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

const BARS_8_4 = 8 * 16;
const DISCO_CHORDS: Record<string, { root: string; arp: string[]; strings: string[] }> = {
  Am: { root: 'A2', arp: ['A3', 'C4', 'E4'], strings: ['A3', 'C4', 'E4'] },
  F: { root: 'F2', arp: ['F3', 'A3', 'C4'], strings: ['A3', 'C4', 'F4'] },
  G: { root: 'G2', arp: ['G3', 'B3', 'D4'], strings: ['B3', 'D4', 'G4'] },
  Em: { root: 'E2', arp: ['E3', 'G3', 'B3'], strings: ['B3', 'E4', 'G4'] },
  E: { root: 'E2', arp: ['E3', 'G#3', 'B3'], strings: ['B3', 'E4', 'G#4'] },
  Dm: { root: 'D2', arp: ['D3', 'F3', 'A3'], strings: ['A3', 'D4', 'F4'] },
};
const ORBIT = ['Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E'];
const NEBULA = ['Dm', 'Dm', 'Am', 'Am', 'Dm', 'Dm', 'E', 'E'];
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
  [[0, 'A4', 2], [2, 'C5', 2], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 2], [12, 'E5', 4]],
  [[0, 'F5', 6], [6, 'E5', 2], [8, 'C5', 8]],
  [[0, 'D5', 2], [2, 'B4', 2], [4, 'G4', 4], [8, 'B4', 2], [10, 'D5', 2], [12, 'G5', 4]],
  [[0, 'E5', 12], [12, 'D5', 2], [14, 'B4', 2]],
  [[0, 'A4', 2], [2, 'C5', 2], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 2], [12, 'A5', 4]],
  [[0, 'A5', 4], [4, 'G5', 2], [6, 'F5', 2], [8, 'E5', 4], [12, 'C5', 4]],
  [[0, 'D5', 4], [4, 'G5', 4], [8, 'D5', 2], [10, 'B4', 2], [12, 'D5', 4]],
  [[0, 'E5', 16]],
];
// Long notes the lead glides between.
const NEBULA_LINE: Placed[][] = [
  [[0, 'F5', 8], [8, 'A5', 8]], [[0, 'E5', 16]], [[0, 'E5', 8], [8, 'C5', 8]], [[0, 'A4', 16]],
  [[0, 'D5', 8], [8, 'F5', 8]], [[0, 'A5', 16]], [[0, 'G#5', 8], [8, 'B5', 8]], [[0, 'E5', 16]],
];
// Two bars that go round under the Starfield's eight, deep in the hall.
const STARFIELD_CALL: Placed[][] = [[[0, 'A5', 4, 0.7], [4, 'G5', 4, 0.65], [8, 'E5', 8, 0.7]], [[0, 'C5', 8, 0.65], [8, 'D5', 8, 0.6]]];
const COUNTDOWN_LINE: Placed[][] = [[], [], [], [], [[0, 'E5', 16, 0.6]], [[0, 'C5', 8, 0.6], [8, 'D5', 8, 0.6]], [[0, 'B4', 16, 0.65]], [[0, 'G#4', 16, 0.7]]];

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
      automation: { 2: { cutoff: ramp(BARS_8_4, 300, 4000) }, 3: { level: ramp(BARS_8_4, 0.2, 0.75) }, 4: { auxBSend: held(BARS_8_4, 0.6) } } },
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
    // The bridge: to D minor and the E major that leads home, the lead gliding over long notes.
    { id: 'satellite-nebula', name: 'Nebula', color: 'pink', bars: 8,
      lanes: { 1: octaveBass(NEBULA), 2: discoArp(NEBULA), 3: discoStrings(NEBULA), 4: NEBULA_LINE, 5: clav(NEBULA) },
      drums: discoBars({ ...DISCO_BEAT, openHH: [] }, true),
      automation: { 2: { cutoff: ramp(BARS_8_4, 1500, 6000) } } },
    // Four bars of drums and the bass, the arpeggio opening like a rising signal, and a snare roll.
    { id: 'satellite-transmission', name: 'Transmission', color: 'green', bars: 4,
      lanes: { 1: octaveBass(['Am', 'Am', 'Am', 'Am']), 2: discoArp(['Am', 'Am', 'Am', 'Am']) },
      drums: [TRANSMIT, TRANSMIT, TRANSMIT, TRANSMIT_ROLL],
      automation: { 2: { cutoff: ramp(64, 400, 8000) } } },
    // Everything at once, brighter and dirtier.
    { id: 'satellite-hyperdrive', name: 'Hyperdrive', color: 'red', bars: 8,
      lanes: { 1: octaveBass(ORBIT), 2: discoArp(ORBIT), 3: discoStrings(ORBIT), 4: THEME, 5: clav(ORBIT) },
      drums: discoBars({ ...DISCO_BEAT, openHH: OFFBEATS.map(([step]): [number, number] => [step, 0.65]) }, true).map((bar, index) => (index === 4 ? { ...bar, crash: [0] } : bar)),
      automation: { 1: { drive: held(BARS_8_4, 0.3) }, 2: { cutoff: held(BARS_8_4, 7000) }, 4: { auxASend: held(BARS_8_4, 0.4) } } },
    // The arpeggio closing, the kick fading out, the lead's last note held.
    { id: 'satellite-reentry', name: 'Re-entry', color: 'blue', bars: 8,
      lanes: { 2: discoArp(ORBIT), 3: discoStrings([...ORBIT.slice(0, 7), 'Am']), 4: [[], [], [], [], [], [], [[0, 'E5', 16, 0.6]], [[0, 'A4', 16, 0.55]]] },
      drums: [...REENTRY_BEATS, {}, {}, {}, {}],
      automation: { 2: { cutoff: ramp(BARS_8_4, 5000, 300) }, 3: { level: ramp(BARS_8_4, 0.75, 0.2) } } },
  ],
  // The countdown's 8 bars at 96 BPM are 20 seconds; the other 140 bars at 120 are 280: five minutes.
  order: [
    ['satellite-countdown', 1], ['satellite-liftoff', 2], ['satellite-orbit', 2], ['satellite-starfield', 1], ['satellite-liftoff', 1],
    ['satellite-orbit', 2], ['satellite-nebula', 2], ['satellite-starfield', 1], ['satellite-transmission', 1], ['satellite-hyperdrive', 3],
    ['satellite-orbit', 2], ['satellite-reentry', 1],
  ],
};

export const SAMPLE_SONGS: SampleSong[] = [NIGHT_CIRCUIT, BLUE_WALTZ, LATE_STUDY, SEVEN_LIGHTS, MARKET_DAY, CATHEDRAL, LANTERNS, SILVER_SATELLITE];
