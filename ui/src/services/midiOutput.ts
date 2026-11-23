// Sending to MIDI hardware: notes from the synth lanes and the drum grid, MIDI clock with start
// and stop, notes played by hand, and a controller's own messages passed straight on (Thru). Any
// number of outputs at once, each with its own switches for those four. Everything the sequencer
// sends has a time stamp a little ahead, the same way the audio is scheduled, so the hardware stays
// in step with what is heard. Which channel each lane and the drums go out on is chosen
// (`channels`); by default lane N is channel N and the drums channel 10.
import type { DrumRow, DrumSettings } from '../types';
import { drumRowNote, noteNameToMidi } from '../utils/midiExport';

export interface MidiOutPort {
  id: string;
  name?: string | null;
  send(data: number[], timestamp?: number): void;
  // Drops messages that have been queued but not sent yet. Not every browser has it.
  clear?: () => void;
}

// What one output is sent. All off is an output not used.
export interface MidiOutFlags {
  notes: boolean;
  clock: boolean;
  played: boolean;
  thru: boolean;
}
export const NO_OUTPUT_FLAGS: MidiOutFlags = { notes: false, clock: false, played: false, thru: false };

// MIDI clock runs at 24 pulses to a quarter note, and one transport tick is a 32nd note.
export const CLOCKS_PER_TICK = 3;
export const MIDI_DRUM_CHANNEL = 10;

// The channel each part goes out on, where it is not its usual one: a lane's number, or 'drums'.
export type MidiOutChannels = Partial<Record<string, number>>;
export const outChannel = (channels: MidiOutChannels, part: number | 'drums') => {
  const chosen = channels[String(part)];
  return Number.isInteger(chosen) && chosen! >= 1 && chosen! <= 16 ? chosen! : part === 'drums' ? MIDI_DRUM_CHANNEL : part;
};
// A note or a pad played by hand, as a live session hands it on.
export type PlayedNote = { kind: 'note'; lane: number; note: string; velocity: number; on: boolean } | { kind: 'hit'; drum: DrumRow; velocity: number };

const NOTE_ON = 0x90, NOTE_OFF = 0x80, CONTROL = 0xb0, ALL_SOUND_OFF = 120, ALL_NOTES_OFF = 123, SUSTAIN = 64;
const CLOCK = 0xf8, START = 0xfa, STOP = 0xfc;

interface Output {
  port: MidiOutPort;
  flags: MidiOutFlags;
  // Channels the sequencer has sent notes on, so stopping can silence them.
  channels: Set<number>;
  running: boolean;
  // Notes played by hand, and notes passed through, that are down now on this output.
  down: Map<string, [number, number]>;
  thruDown: Map<string, [number, number]>;
}

// Whether a controller's message is passed on: `source` is the input's name, `channel` counts from 1.
export type ThruFilter = (source: string, channel: number, data: ArrayLike<number>) => boolean;

export function createMidiOut(onSent?: (portId: string) => void) {
  const outputs = new Map<string, Output>();
  let routes: MidiOutChannels = {};
  let thruWhen: ThruFilter = () => true;
  // A device unplugged mid-song must not stop playback.
  const send = (out: Output, data: number[], at?: number) => {
    try { out.port.send(data, at); onSent?.(out.port.id); } catch { /* the port has gone */ }
  };
  const releaseAll = (out: Output, held: Map<string, [number, number]>) => {
    held.forEach(([channel, midi]) => send(out, [NOTE_OFF | (channel - 1), midi, 0]));
    held.clear();
  };
  const silence = (out: Output) => {
    try { out.port.clear?.(); } catch { /* not supported */ }
    for (const channel of out.channels) send(out, [CONTROL | (channel - 1), ALL_NOTES_OFF, 0]);
    out.channels.clear();
  };
  const stopOne = (out: Output) => {
    silence(out);
    if (out.running) send(out, [STOP]);
    out.running = false;
  };
  // What one output stops being sent: whatever it was holding of that is let go.
  const change = (out: Output, flags: MidiOutFlags) => {
    if (!flags.notes && out.flags.notes) silence(out);
    if (!flags.played && out.flags.played) releaseAll(out, out.down);
    if (!flags.thru && out.flags.thru) releaseAll(out, out.thruDown);
    if (!flags.clock && out.flags.clock && out.running) { send(out, [STOP]); out.running = false; }
    out.flags = flags;
  };
  const each = (flag: keyof MidiOutFlags, act: (out: Output) => void) => outputs.forEach(out => { if (out.flags[flag]) act(out); });
  return {
    // True when any output is sent anything.
    get active() { for (const out of outputs.values()) if (Object.values(out.flags).some(Boolean)) return true; return false; },
    get portIds() { return [...outputs.keys()]; },
    // Every output there is to send to now, with what each is sent. One that has gone is let go of first.
    setOutputs(next: Array<{ port: MidiOutPort; flags: MidiOutFlags }>) {
      const ids = new Set(next.map(entry => entry.port.id));
      outputs.forEach((out, id) => {
        if (ids.has(id)) return;
        stopOne(out);
        releaseAll(out, out.down);
        releaseAll(out, out.thruDown);
        outputs.delete(id);
      });
      for (const { port, flags } of next) {
        const out = outputs.get(port.id);
        if (out) { out.port = port; change(out, { ...flags }); continue; }
        outputs.set(port.id, { port, flags: { ...flags }, channels: new Set(), running: false, down: new Map(), thruDown: new Map() });
      }
    },
    configure(settings: { channels?: MidiOutChannels; thruWhen?: ThruFilter }) {
      if (settings.channels !== undefined) routes = settings.channels;
      if (settings.thruWhen !== undefined) thruWhen = settings.thruWhen;
    },
    // `channel` counts from 1. `velocity` is 0 to 1. Times are on the `performance.now()` clock.
    note(channel: number, midi: number, velocity: number, onMs: number, offMs: number) {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isInteger(channel) || channel < 1 || channel > 16) return;
      if (!Number.isFinite(onMs) || !Number.isFinite(offMs)) return;
      const level = Math.max(1, Math.min(127, Math.round((Number.isFinite(velocity) ? velocity : 0.8) * 127)));
      each('notes', out => {
        out.channels.add(channel);
        send(out, [NOTE_ON | (channel - 1), midi, level], onMs);
        send(out, [NOTE_OFF | (channel - 1), midi, 0], Math.max(onMs + 1, offMs));
      });
    },
    // The channel a lane, or the drums, goes out on.
    channelOf: (part: number | 'drums') => outChannel(routes, part),
    // A note or a pad played by hand, sent at once to every output that takes them. A pad is a
    // short hit. `settings` is a pad's row's, which says the note an added row is sent on.
    played(event: PlayedNote, settings?: Pick<DrumSettings, 'percType' | 'cymbalType'>) {
      if (event.kind === 'hit') {
        const channel = outChannel(routes, 'drums'), midi = drumRowNote(event.drum, settings), now = performance.now();
        if (midi === undefined) return;
        const level = Math.max(1, Math.min(127, Math.round(event.velocity * 127)));
        each('played', out => {
          send(out, [NOTE_ON | (channel - 1), midi, level], now);
          send(out, [NOTE_OFF | (channel - 1), midi, 0], now + 60);
        });
        return;
      }
      const channel = outChannel(routes, event.lane), midi = noteNameToMidi(event.note), key = `${event.lane}:${event.note}`;
      if (midi === null) return;
      if (event.on) {
        const level = Math.max(1, Math.min(127, Math.round(event.velocity * 127)));
        each('played', out => {
          out.down.set(key, [channel, midi]);
          send(out, [NOTE_ON | (channel - 1), midi, level]);
        });
        return;
      }
      // Let go on the channel it was sent on, whatever has changed since, and only where it was sent.
      outputs.forEach(out => {
        const sent = out.down.get(key);
        if (!sent) return;
        out.down.delete(key);
        send(out, [NOTE_OFF | (sent[0] - 1), sent[1], 0]);
      });
    },
    // A controller's message, passed on unchanged and at once. Only a channel's messages (notes,
    // knobs, bend, pressure, programs) go through: never clock, start or stop, which only the
    // sequencer sends, so no output is ever given them twice. An output with the same name as the
    // input is the controller itself, and is skipped so its message cannot come back round.
    thru(data: ArrayLike<number>, source: string) {
      if (!data || data.length < 1) return;
      const status = data[0];
      if (status < 0x80 || status >= 0xf0) return;
      const channel = (status & 0x0f) + 1, type = status & 0xf0;
      const length = type === 0xc0 || type === 0xd0 ? 2 : 3;
      if (data.length < length) return;
      let filtered: boolean | null = null;
      const bytes = Array.from({ length }, (_, i) => data[i] & (i === 0 ? 0xff : 0x7f));
      outputs.forEach(out => {
        if (!out.flags.thru || (out.port.name ?? '') === source) return;
        filtered ??= thruWhen(source, channel, data);
        if (!filtered) return;
        const key = `${source}\n${channel}:${bytes[1]}`;
        if (type === NOTE_ON && bytes[2] > 0) out.thruDown.set(key, [channel, bytes[1]]);
        else if (type === NOTE_OFF || type === NOTE_ON) out.thruDown.delete(key);
        send(out, bytes);
      });
    },
    // One transport tick. `first` is the tick playback starts on.
    tick(atMs: number, durationMs: number, first: boolean) {
      if (!Number.isFinite(atMs) || !(durationMs > 0)) return;
      each('clock', out => {
        if (first || !out.running) send(out, [START], atMs);
        out.running = true;
        for (let pulse = 0; pulse < CLOCKS_PER_TICK; pulse++) send(out, [CLOCK], atMs + pulse * durationMs / CLOCKS_PER_TICK);
      });
    },
    stop() { outputs.forEach(stopOne); },
    // Everything off, on every output and every channel: the sound, the notes, the pedal, and
    // each note one by one for a device that ignores the first two.
    panic() {
      outputs.forEach(out => {
        try { out.port.clear?.(); } catch { /* not supported */ }
        for (let channel = 0; channel < 16; channel++) {
          send(out, [CONTROL | channel, SUSTAIN, 0]);
          send(out, [CONTROL | channel, ALL_SOUND_OFF, 0]);
          send(out, [CONTROL | channel, ALL_NOTES_OFF, 0]);
          for (let midi = 0; midi < 128; midi++) send(out, [NOTE_OFF | channel, midi, 0]);
        }
        out.channels.clear();
        out.down.clear();
        out.thruDown.clear();
      });
    },
  };
}

// When something was last sent to each output, for its lamp. Read outside React.
export const midiSentAt = new Map<string, number>();
export const midiOut = createMidiOut(id => { midiSentAt.set(id, performance.now()); });
