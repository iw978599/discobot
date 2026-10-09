import type { DrumInstrument } from '../types';

// Reads the names of sample files to decide which drum lane each belongs on, so the sounds of
// a drum machine can be put on the kit in one go. Only names are read, never the audio, so a
// guess can be wrong: the import dialog shows every guess and lets it be changed.

// The most files one import lists.
export const MAX_KIT_FILES = 64;

// "LinnKick01.wav" becomes linn, kick, 01; "HHOpen" becomes hh, open.
const words = (name: string) => name
  .replace(/\.[^.]+$/, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Short codes must be the whole word ("ch", "bd"); longer names may be the start of one ("snares").
const has = (tokens: string[], codes: string[], stems: string[] = []) =>
  tokens.some(token => codes.includes(token) || stems.some(stem => token.startsWith(stem)));

interface Guess { lane: DrumInstrument; anyTom?: boolean }

function guess(name: string): Guess | null {
  const tokens = words(name), joined = tokens.join('');
  const hat = tokens.some(token => /^(hh|hat|hihat|highhat)|(hat|hats|hh)$/.test(token));
  if (has(tokens, ['oh', 'ohh', 'hho']) || (hat && (joined.includes('open') || has(tokens, ['o', 'op'])))) return { lane: 'openHH' };
  if (hat || has(tokens, ['ch', 'chh', 'hhc'])) return { lane: 'closedHH' };
  if (has(tokens, ['cp'], ['clap', 'handclap'])) return { lane: 'clap' };
  if (has(tokens, ['lt', 'mt', 'ht', 'ft'], ['tom']) || tokens.some(token => token.endsWith('tom'))) {
    // The Low Tom and High Tom lanes are the snare2 and ride instruments.
    if (has(tokens, ['lt', 'ft', 'lo', 'low', 'l', 'floor', 'flr']) || /tom(lo|fl)|(lo|low|floor)tom/.test(joined)) return { lane: 'snare2' };
    if (has(tokens, ['ht', 'hi', 'high', 'h']) || /tomhi|(hi|high)tom/.test(joined)) return { lane: 'ride' };
    return { lane: 'ride', anyTom: true };
  }
  if (has(tokens, ['cy', 'cym', 'rd', 'rc', 'cc'], ['crash', 'cymbal', 'ride'])) return { lane: 'crash' };
  if (has(tokens, ['sd', 'sn', 'snr'], ['snare', 'rim'])) return { lane: 'snare' };
  if (has(tokens, ['bd', 'kk', 'kik'], ['kick', 'bassdrum']) || (tokens.includes('bass') && has(tokens, [], ['drum']))) return { lane: 'kick' };
  return null;
}

// The lane a file's name suggests, or null when the name says nothing a lane could play.
export const laneForFile = (name: string): DrumInstrument | null => guess(name)?.lane ?? null;

// One file for each lane the names cover, as an index into `names`. Where several files suit a
// lane the first by name is taken ("Kick 1" before "Kick 2"). A tom that does not say whether it
// is high or low takes whichever tom lane is still free.
export function matchKit(names: string[]): Partial<Record<DrumInstrument, number>> {
  const lanes: Partial<Record<DrumInstrument, number>> = {};
  const inOrder = names.map((name, index) => ({ name, index })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (const { name, index } of inOrder) {
    const found = guess(name);
    if (!found) continue;
    const lane = found.anyTom && lanes.ride !== undefined ? 'snare2' : found.lane;
    if (lanes[lane] === undefined) lanes[lane] = index;
  }
  return lanes;
}
