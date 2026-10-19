// Keys held under a lane's arpeggiator. It runs for as long as any key is down, through the
// notes held as one chord, a beat at a time, as a hardware arpeggiator does; with Hold on the keys
// latch, so it runs until Hold is let go. Each pulse is handed on only `AHEAD` seconds before it
// sounds, so letting the last key go stops it at once. A key pressed or let go starts the pattern
// again from the top with the notes now held, except that a key pressed with another, a moment
// after it, joins the chord without the first note sounding twice.

export interface ArpPulse { note: string; offset: number; duration: number }

// Read for each beat, so a change to the sound or the tempo is heard from the next one.
export interface LiveArpLane {
  pulses: (notes: string[], beat: number) => ArpPulse[];
  beat: () => number;
  play: (note: string, time: number, duration: number, velocity: number) => void;
}

const AHEAD = 0.1;
const EVERY_MS = 25;
// Keys pressed this close together are one chord.
const TOGETHER = 0.05;

interface Held {
  notes: string[];
  velocity: number;
  lane: LiveArpLane;
  // When the beat being played began, and the pulses of it not yet handed on.
  start: number;
  queue: Array<{ note: string; time: number; duration: number }>;
  played: number;
}

export class LiveArp {
  private held = new Map<number, Held>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private now: () => number, private every = EVERY_MS) {}

  press(id: number, note: string, velocity: number, lane: LiveArpLane) {
    const held = this.held.get(id);
    if (held?.notes.includes(note)) return;
    const notes = [...(held?.notes ?? []), note];
    this.held.set(id, { notes, velocity, lane, start: 0, queue: [], played: held?.played ?? -Infinity });
    this.restart(id, held);
  }

  release(id: number, note: string) {
    const held = this.held.get(id);
    if (!held?.notes.includes(note)) return;
    const notes = held.notes.filter(entry => entry !== note);
    if (notes.length === 0) { this.stop(id); return; }
    this.held.set(id, { ...held, notes });
    this.restart(id, held);
  }

  stop(id?: number) {
    if (id === undefined) this.held.clear();
    else this.held.delete(id);
    if (this.held.size === 0 && this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  holds(id: number) { return this.held.has(id); }

  private restart(id: number, before: Held | undefined) {
    const held = this.held.get(id)!, now = this.now();
    // A key that joins another pressed a moment ago goes on in the same beat, after what has sounded.
    const together = before !== undefined && now - before.start < TOGETHER;
    held.start = together ? before.start : now;
    held.queue = this.beatOf(held, held.start).filter(pulse => !together || pulse.time > held.played);
    this.tick();
    if (this.timer === null) this.timer = setInterval(() => this.tick(), this.every);
  }

  private beatOf(held: Held, start: number) {
    return held.lane.pulses(held.notes, held.lane.beat()).map(pulse => ({ note: pulse.note, time: start + pulse.offset, duration: pulse.duration }));
  }

  tick() {
    const until = this.now() + AHEAD;
    for (const held of this.held.values()) {
      for (;;) {
        while (held.queue.length > 0 && held.queue[0].time <= until) {
          const pulse = held.queue.shift()!;
          held.played = pulse.time;
          held.lane.play(pulse.note, pulse.time, pulse.duration, held.velocity);
        }
        if (held.queue.length > 0) break;
        const next = held.start + held.lane.beat();
        if (next > until) break;
        held.start = next;
        held.queue = this.beatOf(held, next);
        if (held.queue.length === 0) break;
      }
    }
  }
}
