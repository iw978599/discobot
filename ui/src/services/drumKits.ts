import type { DrumInstrument, DrumKitDefinition, DrumKitId, DrumKitModelVariant } from '../types';

export const DRUM_INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];

const definitions: [DrumKitId, string, DrumKitModelVariant, number[][]][] = [
  ['clean-analog', 'Clean / Analog', 'analog', [[.62,.48,.52],[.68,.46,.68],[.45,.52,.48],[.48,.55,.58],[.43,.52,.48],[.44,.5,.45],[.52,.45,.5],[.5,.5,.5]]],
  ['punchy-modern', 'Punchy / Modern', 'modern', [[.7,.6,.68],[.74,.54,.82],[.48,.66,.56],[.54,.7,.72],[.48,.66,.58],[.5,.62,.62],[.6,.62,.62],[.56,.6,.66]]],
  ['lofi-dirty', 'Lo-Fi / Dirty', 'dirty', [[.58,.38,.46],[.66,.4,.78],[.42,.4,.66],[.44,.36,.48],[.4,.34,.5],[.42,.35,.7],[.5,.35,.6],[.48,.38,.58]]],
  ['tr-808', 'Roland TR-808', 'analog', [[.75,.25,.72],[.65,.55,.85],[.4,.7,.65],[.45,.75,.5],[.38,.6,.55],[.42,.55,.8],[.55,.5,.7],[.52,.48,.6]]],
  ['tr-909', 'Roland TR-909', 'modern', [[.72,.58,.65],[.7,.62,.78],[.46,.72,.52],[.52,.68,.62],[.44,.65,.48],[.48,.6,.65],[.58,.58,.68],[.54,.55,.62]]],
  ['linndrum', 'LinnDrum', 'modern', [[.68,.52,.6],[.72,.58,.82],[.44,.65,.55],[.5,.68,.58],[.42,.62,.52],[.46,.58,.68],[.6,.55,.72],[.52,.52,.65]]],
  ['oberheim-dmx', 'Oberheim DMX', 'analog', [[.7,.55,.58],[.68,.52,.75],[.43,.68,.48],[.48,.72,.55],[.4,.65,.45],[.44,.6,.62],[.55,.5,.65],[.5,.55,.58]]],
  ['tr-707', 'Roland TR-707', 'modern', [[.68,.5,.62],[.66,.55,.72],[.42,.62,.52],[.48,.65,.58],[.4,.58,.48],[.44,.55,.65],[.54,.52,.62],[.5,.52,.6]]],
];

export const DRUM_KITS: DrumKitDefinition[] = definitions.map(([id, name, modelVariant, values]) => ({
  id, name, modelVariant, description: `${name} synthesized drum kit`,
  instrumentDefaults: Object.fromEntries(DRUM_INSTRUMENTS.map((instrument, i) => [
    instrument, { volume: values[i][0], tone: values[i][1], extra: values[i][2], tune: 0, humanize: .35, pan: 0 },
  ])) as DrumKitDefinition['instrumentDefaults'],
}));
