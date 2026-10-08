export interface TransportTick {
  step: number;
  time: number;
  duration: number;
}

export class BrowserTransport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;

  constructor(
    private clock: () => number,
    private tempo: () => number,
    private schedule: (tick: TransportTick) => void,
  ) {}

  start() {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.clock() + .04;
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
  }

  // One tick is a 32nd note; 16-step lanes and the drum grid use every second tick.
  pump() {
    const now = this.clock();
    const duration = 60 / Math.max(20, Math.min(400, this.tempo())) / 8;
    // Skip missed beats after a suspended tab instead of playing a burst of stale notes.
    while (this.nextTime < now - duration) {
      this.step = (this.step + 1) % 32;
      this.nextTime += duration;
    }
    while (this.nextTime < now + .08) {
      this.schedule({ step: this.step, time: this.nextTime, duration });
      this.step = (this.step + 1) % 32;
      this.nextTime += duration;
    }
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.step = 0;
  }

  get running() { return this.timer !== null; }
}
