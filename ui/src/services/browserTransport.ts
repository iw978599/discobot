export interface TransportTick {
  // ticks since the transport started. It only counts: how long a bar is, and so which bar and
  // step a tick falls on, depends on the scene that is playing, which the scheduler knows.
  tick: number;
  time: number;
  duration: number;
}

export class BrowserTransport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private ticks = 0;
  private lastTempo = 0;
  private tickSeconds = 0;
  // When the first tick plays, on the audio clock.
  startTime = 0;
  // Called when a tempo change takes hold: the tempo, when, and how many beats in.
  onTempo: ((bpm: number, time: number, beat: number) => void) | null = null;

  constructor(
    private clock: () => number,
    private tempo: () => number,
    private schedule: (tick: TransportTick) => void,
    // How much further ahead than usual to schedule, in seconds: a voice handed to a guest is
    // played that much early (services/guestInput), so its ticks must be known that soon.
    private reach: () => number = () => 0,
  ) {}

  // `lead` is how far ahead the first tick is placed. Guests in a frame need longer than the
  // built-in lanes to hear about a start and line up with it.
  start(lead = .04) {
    if (this.timer !== null) return;
    this.ticks = 0;
    this.lastTempo = this.tempo();
    this.nextTime = this.startTime = this.clock() + lead;
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
  }

  // One tick is a 32nd note; the drum grid and a lane of sixteenth steps use every second tick.
  pump() {
    const now = this.clock();
    const tempo = Math.max(20, Math.min(400, this.tempo()));
    const duration = 60 / tempo / 8;
    this.tickSeconds = duration;
    // One tick is an eighth of a beat.
    if (tempo !== this.lastTempo) { this.lastTempo = tempo; this.onTempo?.(tempo, this.nextTime, this.ticks / 8); }
    // Skip missed beats after a suspended tab instead of playing a burst of stale notes.
    while (this.nextTime < now - duration) this.advance(duration);
    while (this.nextTime < now + .08 + this.reach()) {
      this.schedule({ tick: this.ticks, time: this.nextTime, duration });
      this.advance(duration);
    }
  }

  private advance(duration: number) {
    this.ticks++;
    this.nextTime += duration;
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get running() { return this.timer !== null; }

  // The tick the scheduler will play next, counted from the start.
  get scheduledTicks() { return this.ticks; }

  // Where a time on the audio clock falls, in ticks from the start and as a fraction. The
  // scheduler runs ahead of the clock, so this is behind `scheduledTicks`.
  ticksAt(time: number): number {
    return this.tickSeconds > 0 ? this.ticks - (this.nextTime - time) / this.tickSeconds : 0;
  }
}
