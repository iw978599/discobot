export interface TransportTick {
  step: number;
  // bars since the transport started; it only counts, and knows nothing about songs
  bar: number;
  time: number;
  duration: number;
}

export class BrowserTransport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private ticks = 0;
  private lastTempo = 0;
  // When the first tick plays, on the audio clock.
  startTime = 0;
  // Called when a tempo change takes hold: the tempo, when, and how many beats in.
  onTempo: ((bpm: number, time: number, beat: number) => void) | null = null;

  constructor(
    private clock: () => number,
    private tempo: () => number,
    private schedule: (tick: TransportTick) => void,
  ) {}

  // `lead` is how far ahead the first tick is placed. Guests in a frame need longer than the
  // built-in lanes to hear about a start and line up with it.
  start(lead = .04) {
    if (this.timer !== null) return;
    this.step = 0;
    this.bar = 0;
    this.ticks = 0;
    this.lastTempo = this.tempo();
    this.nextTime = this.startTime = this.clock() + lead;
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
  }

  // One tick is a 32nd note; 16-step lanes and the drum grid use every second tick.
  pump() {
    const now = this.clock();
    const tempo = Math.max(20, Math.min(400, this.tempo()));
    const duration = 60 / tempo / 8;
    // One tick is an eighth of a beat.
    if (tempo !== this.lastTempo) { this.lastTempo = tempo; this.onTempo?.(tempo, this.nextTime, this.ticks / 8); }
    // Skip missed beats after a suspended tab instead of playing a burst of stale notes.
    while (this.nextTime < now - duration) this.advance(duration);
    while (this.nextTime < now + .08) {
      this.schedule({ step: this.step, bar: this.bar, time: this.nextTime, duration });
      this.advance(duration);
    }
  }

  private advance(duration: number) {
    this.step = (this.step + 1) % 32;
    if (this.step === 0) this.bar++;
    this.ticks++;
    this.nextTime += duration;
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.step = 0;
  }

  get running() { return this.timer !== null; }
}
