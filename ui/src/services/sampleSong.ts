import type { DrumInstrument, Scene, SequencerStep, Song, SynthParameters, SynthModelId, SynthModelParams } from '../types';
import { withStepNotes } from './noteScheduling';

// A whole song to open and take apart, offered beside the starting beats: five scenes of four
// bars each, three lanes with sounds of their own, and a song that plays the scenes in order.
// It is built as a project file from the project that is open, and opened the way any file is,
// as a new project, so nothing a person has is changed. Nobody can write a good song by
// reasoning alone: this was made, and is to be changed as the owner hears it.
export const SAMPLE_SONG_NAME = 'Sample Song';
export const SAMPLE_SONG_TEMPO = 118;
const BARS = 4, STEPS = BARS * 16;

// A minor: one chord a bar, four bars round.
const ROOTS = ['A2', 'F2', 'C3', 'G2'];
const CHORDS = [['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4']];
type Placed = [step: number, notes: string | string[], length?: number, velocity?: number];
const up = (note: string) => note.replace(/\d$/, digit => String(Number(digit) + 1));

const bassSteady = (root: string): Placed[] => [[0, root, 3], [6, root, 1, 0.75], [8, root, 3], [14, root, 1, 0.75]];
const bassBusy = (root: string): Placed[] => [[0, root, 2], [3, root, 1, 0.7], [6, root, 1, 0.8], [8, root, 2], [11, up(root), 1, 0.7], [14, root, 1, 0.8]];
const pad = (chord: string[]): Placed[] => [[0, chord, 16, 0.7]];
const MELODY: Placed[][] = [
  [[0, 'E5', 2], [3, 'D5'], [4, 'C5', 2], [7, 'A4'], [8, 'C5', 3], [12, 'E5', 2]],
  [[0, 'C5', 2], [3, 'A4'], [4, 'C5'], [6, 'D5', 2], [8, 'C5', 4], [14, 'A4']],
  [[0, 'E5', 2], [2, 'G5', 2], [4, 'E5'], [6, 'D5'], [8, 'C5', 3], [12, 'D5'], [14, 'E5']],
  [[0, 'D5', 3], [4, 'B4', 2], [6, 'G4', 2], [8, 'B4'], [10, 'D5', 2], [12, 'G5', 4]],
];
// The tune thinned to the note each half bar starts on.
const SPARSE = MELODY.map(bar => bar.filter(([step]) => step === 0 || step === 8).map(([step, notes]): Placed => [step, notes, 6, 0.7]));

type Hits = Partial<Record<DrumInstrument, Array<number | [step: number, velocity: number]>>>;
const SIXTEENTHS: Array<[number, number]> = Array.from({ length: 16 }, (_, step) => [step, step % 4 === 0 ? 0.6 : step % 2 === 0 ? 0.5 : 0.3]);
const EIGHTHS: Array<[number, number]> = [0, 2, 4, 6, 8, 10, 12, 14].map(step => [step, step % 4 === 0 ? 0.55 : 0.4]);
const GROOVE: Hits = { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: SIXTEENTHS.filter(([step]) => step % 4 !== 2), openHH: [[2, 0.6], [6, 0.6], [10, 0.6], [14, 0.7]] };
const FILL: Hits = { ...GROOVE, snare: [[10, 0.4], [12, 0.55], [13, 0.6], [14, 0.75], [15, 0.9]], clap: [4] };

interface Section {
  id: string; name: string; color: string;
  bass?: (root: string) => Placed[];
  pad: boolean;
  lead?: Placed[][];
  drums: Hits[];
}
const SECTIONS: Section[] = [
  { id: 'sample-intro', name: 'Intro', color: 'teal', pad: true,
    drums: [{ closedHH: EIGHTHS }, { closedHH: EIGHTHS }, { closedHH: EIGHTHS, kick: [0, 4, 8, 12] }, { closedHH: EIGHTHS, kick: [0, 4, 8, 12], openHH: [[14, 0.7]], snare: [[14, 0.5], [15, 0.7]] }] },
  { id: 'sample-verse', name: 'Verse', color: 'blue', pad: true, bass: bassSteady,
    drums: [GROOVE, GROOVE, GROOVE, FILL] },
  { id: 'sample-chorus', name: 'Chorus', color: 'red', pad: true, bass: bassBusy, lead: MELODY,
    drums: [{ ...GROOVE, crash: [0] }, GROOVE, GROOVE, FILL] },
  { id: 'sample-break', name: 'Break', color: 'violet', pad: true, lead: SPARSE,
    drums: [{ closedHH: EIGHTHS }, { closedHH: EIGHTHS }, { closedHH: EIGHTHS }, { closedHH: EIGHTHS, snare: [[12, 0.4], [13, 0.55], [14, 0.7], [15, 0.9]] }] },
  { id: 'sample-outro', name: 'Outro', color: 'green', pad: true, bass: bassSteady,
    drums: [{ kick: [0, 8], closedHH: EIGHTHS, crash: [0] }, { kick: [0, 8], closedHH: EIGHTHS }, { kick: [0, 8], closedHH: EIGHTHS }, { kick: [0] }] },
];

// The song: the chorus comes round again after the break.
const ORDER: Array<[sceneId: string, repeats: number]> = [
  ['sample-intro', 1], ['sample-verse', 2], ['sample-chorus', 2], ['sample-break', 1], ['sample-chorus', 2], ['sample-outro', 1],
];

// Which sound each lane takes, by a built-in preset's id.
export const SAMPLE_SONG_SOUNDS = ['builtin-bass-rubber', 'builtin-pad-cs80', 'builtin-pluck-bell'];

const DRUMS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];

function lane(blank: SequencerStep, bars: Placed[][]): SequencerStep[] {
  const steps = Array.from({ length: STEPS }, () => ({ ...blank }));
  bars.forEach((bar, index) => {
    for (const [step, notes, length = 1, velocity = 0.9] of bar) {
      steps[index * 16 + step] = { ...withStepNotes(blank, Array.isArray(notes) ? notes : [notes]), velocity, ...(length > 1 ? { length } : {}) };
    }
  });
  return steps;
}

function grid(bars: Hits[]): Scene['drums'] {
  return Object.fromEntries(DRUMS.map((instrument) => {
    const steps = Array<boolean>(STEPS).fill(false), stepVelocities = Array<number>(STEPS).fill(1);
    bars.forEach((bar, index) => {
      for (const hit of bar[instrument] ?? []) {
        const [step, velocity] = Array.isArray(hit) ? hit : [hit, 1];
        steps[index * 16 + step] = true;
        stepVelocities[index * 16 + step] = velocity;
      }
    });
    return [instrument, { steps, stepVelocities }];
  })) as Scene['drums'];
}

type Sound = { id: string; params: SynthParameters; modelId: SynthModelId; modelParams: SynthModelParams };
type Json = Record<string, any>;

// The song as a project file, made from the file of the project that is open (for its shape, its
// drum kit and its effects) and the app's own sounds. Null if that file is not one, or a sound is missing.
export function buildSampleSong(file: unknown, sounds: Sound[]): unknown | null {
  const source = file as Json | null;
  const first = source?.project?.synths?.[0];
  const chosen = SAMPLE_SONG_SOUNDS.map(id => sounds.find(sound => sound.id === id));
  if (!first?.pattern?.steps?.length || !source?.project?.drumState || chosen.some(sound => !sound)) return null;
  const project: Json = structuredClone(source.project);
  const blank = withStepNotes(first.pattern.steps[0] as SequencerStep, []);

  const scenes: Scene[] = SECTIONS.map(section => ({
    id: section.id, name: section.name, color: section.color,
    lanes: {
      1: lane(blank, ROOTS.map(root => section.bass?.(root) ?? [])),
      2: lane(blank, CHORDS.map(chord => (section.pad ? pad(chord) : []))),
      3: lane(blank, section.lead ?? []),
    },
    laneBars: { 1: BARS, 2: BARS, 3: BARS },
    drums: grid(section.drums),
  }));
  const song: Song = { entries: ORDER.map(([sceneId, repeats]) => ({ sceneId, repeats })), loop: false };

  // The lanes and the drum grid in a project are always its open scene: the first.
  const open = scenes[0];
  project.synths = [1, 2, 3].map((synthId, index) => {
    const from: Json = structuredClone(project.synths.find((entry: Json) => entry.synthId === synthId) ?? first);
    const sound = chosen[index]!;
    const pattern = { ...from.pattern, id: `sample-lane-${synthId}`, steps: open.lanes[synthId], bars: BARS };
    return {
      ...from, synthId, pattern, patterns: [pattern], muted: false, solo: false, isPlaying: false,
      synthParams: structuredClone(sound.params), synthModelId: sound.modelId, synthModelParams: { ...sound.modelParams },
      // The bass is written an octave under where the piano roll opens.
      octaveShift: index === 0 ? -1 : index === 2 ? 1 : 0,
    };
  });
  for (const instrument of DRUMS) {
    project.drumState[instrument] = { ...project.drumState[instrument], ...open.drums[instrument], muted: false, solo: false };
    delete project.drumState[instrument].stepProbabilities;
    delete project.drumState[instrument].stepRatchets;
    delete project.drumState[instrument].sampleId;
  }
  Object.assign(project, { name: SAMPLE_SONG_NAME, tempo: SAMPLE_SONG_TEMPO, drumSwing: 0, scenes, currentSceneId: open.id, song, guests: [] });
  return { ...source, project };
}
