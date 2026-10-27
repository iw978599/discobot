import type { DrumInstrument, DrumKitDefinition, DrumKitId, DrumKitModelVariant, DrumRow, DrumSettings } from '../types';
import { EXTRA_DRUMS } from '@discobot/engine';

// An added row's settings before it is changed (docs/DRUM_ROWS_PLAN.md). It plays a recording, so
// Tone and Decay leave it as recorded (Decay at its top is no fade) and it is not humanized.
export const EXTRA_ROW_SETTINGS: DrumSettings = { volume: 0.8, tone: 0.5, extra: 1, tune: 0, humanize: 0, pan: 0 };

export const DRUM_INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
// The rows a drum state (or a scene's drums) has, in their order: the eight, then the added ones.
export const drumRowsOf = (drums: Partial<Record<DrumRow, unknown>>): DrumRow[] => [...DRUM_INSTRUMENTS, ...EXTRA_DRUMS.filter(row => drums[row] !== undefined)];

// The one name each drum has, wherever it is shown. Low Tom and High Tom are the snare2 and ride ids.
export const DRUM_NAMES: Record<DrumInstrument, string> = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', closedHH: 'Closed Hat', openHH: 'Open Hat', snare2: 'Low Tom', ride: 'High Tom', crash: 'Cymbal',
};
// The drums in the order the grid has them down the page, and the mixer across it.
export const DRUM_ROWS: DrumInstrument[] = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash'];
// Every row's name for its controls, wherever it is: a drum's own, and an added row its number on
// the grid, "Row 9" to "Row 16" (docs/DRUM_ROWS_PLAN.md).
export const DRUM_ROW_NAMES = { ...DRUM_NAMES, ...Object.fromEntries(EXTRA_DRUMS.map((row, index) => [row, `Row ${9 + index}`])) } as Record<DrumRow, string>;
// The rows a drum state has in the order the grid and the mixer show them: the eight, then the added ones.
export const shownDrumRows = (drums: Partial<Record<DrumRow, unknown>>): DrumRow[] => [...DRUM_ROWS, ...EXTRA_DRUMS.filter(row => drums[row] !== undefined)];

// A drum's knobs as a project starts with them.
const PLAIN_DRUM = { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 };
export const DRUM_SETTINGS_DEFAULT: Record<DrumInstrument, typeof PLAIN_DRUM> = {
  kick: PLAIN_DRUM, snare: { volume: 0.68, tone: 0.46, extra: 0.68, tune: 0, humanize: 0.35 }, openHH: PLAIN_DRUM, closedHH: PLAIN_DRUM,
  ride: PLAIN_DRUM, crash: PLAIN_DRUM, snare2: PLAIN_DRUM, clap: PLAIN_DRUM,
};

const definitions: [DrumKitId, string, DrumKitModelVariant, number[][]][] = [
  ['clean-analog', 'Clean / Analog', 'analog', [[.62,.48,.52],[.68,.46,.68],[.45,.52,.48],[.48,.55,.58],[.43,.52,.48],[.44,.5,.45],[.52,.45,.5],[.5,.5,.5]]],
  ['punchy-modern', 'Punchy / Modern', 'modern', [[.7,.6,.68],[.74,.54,.82],[.48,.66,.56],[.54,.7,.72],[.48,.66,.58],[.5,.62,.62],[.6,.62,.62],[.56,.6,.66]]],
  ['lofi-dirty', 'Lo-Fi / Dirty', 'dirty', [[.58,.38,.46],[.66,.4,.78],[.42,.4,.66],[.44,.36,.48],[.4,.34,.5],[.42,.35,.7],[.5,.35,.6],[.48,.38,.58]]],
  ['tr-808', 'Roland TR-808', 'analog', [[.75,.25,.72],[.65,.55,.85],[.4,.7,.65],[.45,.75,.5],[.38,.6,.55],[.42,.55,.8],[.55,.5,.7],[.52,.48,.6]]],
  ['tr-909', 'Roland TR-909', 'modern', [[.72,.58,.65],[.7,.62,.78],[.46,.72,.52],[.52,.68,.62],[.44,.65,.48],[.48,.6,.65],[.58,.58,.68],[.54,.55,.62]]],
  ['linndrum', 'LinnDrum', 'modern', [[.68,.52,.6],[.72,.58,.82],[.44,.65,.55],[.5,.68,.58],[.42,.62,.52],[.46,.58,.68],[.6,.55,.72],[.52,.52,.65]]],
  ['oberheim-dmx', 'Oberheim DMX', 'analog', [[.7,.55,.58],[.68,.52,.75],[.43,.68,.48],[.48,.72,.55],[.4,.65,.45],[.44,.6,.62],[.55,.5,.65],[.5,.55,.58]]],
  ['tr-707', 'Roland TR-707', 'modern', [[.68,.5,.62],[.66,.55,.72],[.42,.62,.52],[.48,.65,.58],[.4,.58,.48],[.44,.55,.65],[.54,.52,.62],[.5,.52,.6]]],
  ['recorded', 'Recorded', 'analog', [[.62,.5,1],[.55,.5,1],[.4,.5,1],[.4,.5,1],[.55,.5,1],[.5,.5,.7],[.55,.5,1],[.5,.5,1]]],
];

export const DRUM_KITS: DrumKitDefinition[] = definitions.map(([id, name, modelVariant, values]) => ({
  id, name, modelVariant, description: id === 'recorded' ? 'Recordings of real drums' : `${name} synthesized drum kit`,
  instrumentDefaults: Object.fromEntries(DRUM_INSTRUMENTS.map((instrument, i) => [
    instrument, { volume: values[i][0], tone: values[i][1], extra: values[i][2], tune: 0, humanize: .35, pan: 0 },
  ])) as DrumKitDefinition['instrumentDefaults'],
}));
