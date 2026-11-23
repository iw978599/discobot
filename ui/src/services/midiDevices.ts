import { NO_OUTPUT_FLAGS, type MidiOutFlags } from './midiOutput';

// Where each MIDI input's notes go. 'default' plays each channel's part, as the channel table in
// the panel says (`midiChannels.ts`). The others take every note from the device, whatever its channel:
// 'open' is whichever lane is open, 'synth:2' is that lane, 'drums' makes every note a pad, and
// 'off' has the device ignored, knobs and all.
export type MidiDestination = 'default' | 'open' | 'synth:1' | 'synth:2' | 'synth:3' | 'synth:4' | 'synth:5' | 'drums' | 'off';

export const MIDI_DESTINATIONS: Array<{ id: MidiDestination; label: string }> = [
  { id: 'default', label: 'By channel' },
  { id: 'open', label: 'The open lane' },
  { id: 'synth:1', label: 'Synth 1' },
  { id: 'synth:2', label: 'Synth 2' },
  { id: 'synth:3', label: 'Synth 3' },
  { id: 'synth:4', label: 'Synth 4' },
  { id: 'synth:5', label: 'Synth 5' },
  { id: 'drums', label: 'Drums' },
  { id: 'off', label: 'Off' },
];

// Kept by the device's name. A browser makes up a device's id, and the same controller has a
// different one in another browser and can be given a new one when site data is cleared; its name
// is what the controller itself says. Two devices with one name share a place.
export type MidiDestinations = Record<string, MidiDestination>;

const KEY = 'discobot_midi_devices_v1';
export const MAX_MIDI_DEVICES = 32;
const MAX_NAME = 120;

const isDestination = (value: unknown): value is MidiDestination => MIDI_DESTINATIONS.some(entry => entry.id === value);

// A stored list made safe. 'default' is never kept: a device that is not in the list has it.
export function asMidiDestinations(value: unknown): MidiDestinations {
  const places: MidiDestinations = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return places;
  let kept = 0;
  for (const [name, place] of Object.entries(value as Record<string, unknown>)) {
    if (!name || name.length > MAX_NAME || !isDestination(place) || place === 'default') continue;
    places[name] = place;
    if ((kept += 1) >= MAX_MIDI_DEVICES) break;
  }
  return places;
}

export function storedMidiDestinations(): MidiDestinations {
  try { return asMidiDestinations(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return asMidiDestinations(null); }
}

export function storeMidiDestinations(places: MidiDestinations) {
  try { localStorage.setItem(KEY, JSON.stringify(asMidiDestinations(places))); } catch { /* the places last for this visit */ }
}

export const destinationFor = (places: MidiDestinations, name: string): MidiDestination => Object.prototype.hasOwnProperty.call(places, name) ? places[name] : 'default';

export function withDestination(places: MidiDestinations, name: string, place: MidiDestination): MidiDestinations {
  const { [name]: _, ...rest } = places;
  return asMidiDestinations(place === 'default' ? rest : { [name]: place, ...rest });
}

// The lane a place names, or null for a place that is not one lane.
export function destinationLane(place: MidiDestination): number | null {
  return place.startsWith('synth:') ? Number(place.slice(6)) : null;
}

// What each MIDI output is sent, kept in this browser by the output's name as an input's place is.
// An output not listed is sent nothing.
export type MidiOutputSettings = Record<string, MidiOutFlags>;
const OUT_KEY = 'discobot_midi_outputs_v1';

export function asMidiOutputSettings(value: unknown): MidiOutputSettings {
  const kept: MidiOutputSettings = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return kept;
  let count = 0;
  for (const [name, flags] of Object.entries(value as Record<string, unknown>)) {
    if (!name || name.length > MAX_NAME || flags === null || typeof flags !== 'object') continue;
    const source = flags as Record<string, unknown>;
    const clean: MidiOutFlags = { notes: source.notes === true, clock: source.clock === true, played: source.played === true, thru: source.thru === true };
    if (!Object.values(clean).some(Boolean)) continue;
    kept[name] = clean;
    if ((count += 1) >= MAX_MIDI_DEVICES) break;
  }
  return kept;
}

export function storedMidiOutputSettings(): MidiOutputSettings {
  try { return asMidiOutputSettings(JSON.parse(localStorage.getItem(OUT_KEY) || '{}')); } catch { return {}; }
}

export function storeMidiOutputSettings(settings: MidiOutputSettings) {
  try { localStorage.setItem(OUT_KEY, JSON.stringify(asMidiOutputSettings(settings))); } catch { /* kept for this visit */ }
}

export const outputFlagsFor = (settings: MidiOutputSettings, name: string): MidiOutFlags => Object.prototype.hasOwnProperty.call(settings, name) ? settings[name] : NO_OUTPUT_FLAGS;

export function withOutputFlags(settings: MidiOutputSettings, name: string, patch: Partial<MidiOutFlags>): MidiOutputSettings {
  return asMidiOutputSettings({ ...settings, [name]: { ...outputFlagsFor(settings, name), ...patch } });
}
