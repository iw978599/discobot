import type { AuxBus, DrumInstrument, DrumState, EffectsLoopState, SynthModelId, SynthParameters } from '../types';
import { auxBuses } from './auxSettings';
import { getSynthModelDefinition } from '../synthModels';
import { DRUM_ROWS } from './drumKits';
import { laneName } from './lanes';
import { guestOrigin, type Guest } from './guests';

// What the mixer shows: every level the project already has, gathered into one plain list. It
// holds nothing of its own. Each number is read from where it is kept (a lane's sound, a drum's
// settings, a guest, the effects) and each is changed by the handler its own knob calls.

export interface MixerLane { id: number; name: string; model: string; level: number; pan: number; muted: boolean; solo: boolean }
export interface MixerDrum { id: DrumInstrument; volume: number; pan: number; muted: boolean; solo: boolean }
export interface MixerGuest { id: string; name: string; volume: number; muted: boolean }
export interface MixerChannels {
  lanes: MixerLane[];
  drums: MixerDrum[];
  drumMaster: number;
  guests: MixerGuest[];
  returns: { synth: number; drums: number };
  // The two aux buses as they are stored, A then B: the mixer shows their return levels and kinds.
  aux: AuxBus[];
  // This browser's output volume, which is not the project's.
  main: number;
}

export interface MixerSource {
  synths: Array<{ id: number; name?: string; synthModelId: SynthModelId; synthParams: Pick<SynthParameters, 'gain' | 'pan'> | null; muted?: boolean; solo?: boolean }>;
  drumState: DrumState;
  drumMasterVolume: number;
  guests: Array<Pick<Guest, 'id' | 'url' | 'name' | 'volume' | 'muted'>>;
  effectsLoop: Pick<EffectsLoopState, 'returns' | 'aux'>;
  browserVolume: number;
}

export function mixerChannels(source: MixerSource): MixerChannels {
  return {
    lanes: [...source.synths].sort((a, b) => a.id - b.id).map(synth => ({
      id: synth.id,
      name: laneName(synth.id, synth.name),
      model: getSynthModelDefinition(synth.synthModelId).name,
      level: synth.synthParams?.gain ?? 1,
      pan: synth.synthParams?.pan ?? 0,
      muted: Boolean(synth.muted),
      solo: Boolean(synth.solo),
    })),
    drums: DRUM_ROWS.filter(id => source.drumState[id]).map((id) => {
      const track = source.drumState[id];
      return { id, volume: track.settings.volume, pan: track.settings.pan ?? 0, muted: Boolean(track.muted), solo: Boolean(track.solo) };
    }),
    drumMaster: source.drumMasterVolume,
    guests: source.guests.map(guest => ({ id: guest.id, name: guest.name || guestOrigin(guest.url) || 'Guest', volume: guest.volume, muted: Boolean(guest.muted) })),
    returns: { synth: source.effectsLoop.returns.synth, drums: source.effectsLoop.returns.drums },
    aux: auxBuses(source.effectsLoop.aux),
    main: source.browserVolume,
  };
}

// Whether two lists would draw the same mixer. A note put in or a step switched on makes new
// lanes and new drums without changing anything here, and the mixer is not drawn again for it.
export function sameMixer(a: MixerChannels, b: MixerChannels): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// A pan as its own knob shows it. A lane's runs to 100 either side and a drum's to 50, as each
// does where it is set, so the mixer and the knob it mirrors read the same.
export function panText(pan: number, kind: 'lane' | 'drum'): string {
  if (kind === 'lane') return pan === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.abs(Math.round(pan * 100))}`;
  if (Math.abs(pan) < 0.05) return 'C';
  return pan < 0 ? `L${Math.round(Math.abs(pan) * 50)}` : `R${Math.round(pan * 50)}`;
}

export function parsePan(input: string, kind: 'lane' | 'drum'): number | null {
  const text = input.trim().toUpperCase();
  if (text === 'C') return 0;
  const n = Number.parseFloat(text.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? (text.startsWith('L') ? -Math.abs(n) : n) / (kind === 'lane' ? 100 : 50) : null;
}

export const percentText = (value: number) => `${Math.round(value * 100)}%`;
export function parsePercent(input: string): number | null {
  const n = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n / 100 : null;
}
