// Sending the sequencer to MIDI hardware: notes from the synth lanes and the drum grid, and
// MIDI clock with start and stop. Everything is sent with a time stamp a little ahead, the
// same way the audio is scheduled, so the hardware stays in step with what is heard.

export interface MidiOutPort {
  id: string;
  name?: string | null;
  send(data: number[], timestamp?: number): void;
  // Drops messages that have been queued but not sent yet. Not every browser has it.
  clear?: () => void;
}

// MIDI clock runs at 24 pulses to a quarter note, and one transport tick is a 32nd note.
export const CLOCKS_PER_TICK = 3;
export const MIDI_DRUM_CHANNEL = 10;

const NOTE_ON = 0x90, NOTE_OFF = 0x80, CONTROL = 0xb0, ALL_NOTES_OFF = 123;
const CLOCK = 0xf8, START = 0xfa, STOP = 0xfc;

export function createMidiOut() {
  let port: MidiOutPort | null = null;
  let notes = true, clock = false, running = false;
  const channels = new Set<number>();
  // A device unplugged mid-song must not stop playback.
  const send = (data: number[], at?: number) => { try { port?.send(data, at); } catch { /* the port has gone */ } };
  const silence = () => {
    try { port?.clear?.(); } catch { /* not supported */ }
    for (const channel of channels) send([CONTROL | (channel - 1), ALL_NOTES_OFF, 0]);
    channels.clear();
  };
  return {
    get active() { return port !== null; },
    get portId() { return port?.id ?? null; },
    setPort(next: MidiOutPort | null) {
      if (next?.id === port?.id) { port = next; return; }
      this.stop();
      port = next;
    },
    configure(settings: { notes?: boolean; clock?: boolean }) {
      if (settings.notes === false && notes) silence();
      if (settings.clock === false && clock && running) { send([STOP]); running = false; }
      if (settings.notes !== undefined) notes = settings.notes;
      if (settings.clock !== undefined) clock = settings.clock;
    },
    // `channel` counts from 1. `velocity` is 0 to 1. Times are on the `performance.now()` clock.
    note(channel: number, midi: number, velocity: number, onMs: number, offMs: number) {
      if (!port || !notes) return;
      if (!Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isInteger(channel) || channel < 1 || channel > 16) return;
      if (!Number.isFinite(onMs) || !Number.isFinite(offMs)) return;
      const level = Math.max(1, Math.min(127, Math.round((Number.isFinite(velocity) ? velocity : 0.8) * 127)));
      channels.add(channel);
      send([NOTE_ON | (channel - 1), midi, level], onMs);
      send([NOTE_OFF | (channel - 1), midi, 0], Math.max(onMs + 1, offMs));
    },
    // One transport tick. `first` is the tick playback starts on.
    tick(atMs: number, durationMs: number, first: boolean) {
      if (!port || !clock || !Number.isFinite(atMs) || !(durationMs > 0)) return;
      if (first || !running) send([START], atMs);
      running = true;
      for (let pulse = 0; pulse < CLOCKS_PER_TICK; pulse++) send([CLOCK], atMs + pulse * durationMs / CLOCKS_PER_TICK);
    },
    stop() {
      if (!port) return;
      silence();
      if (running) send([STOP]);
      running = false;
    },
  };
}

export const midiOut = createMidiOut();
