export interface TransportTick {
  step: number;
  time: number;
  duration: number;
}

export class BrowserTransport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private suspended = false;

  constructor(
    private clock: () => number,
    private tempo: () => number,
    private schedule: (tick: TransportTick) => void,
  ) {}

  private onVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.suspended = true;
    } else if (this.timer !== null) {
      this.suspended = false;
      this.pump();
    }
  };

  start() {
    if (this.timer !== null) return;
    this.step = 0;
    this.suspended = typeof document !== 'undefined' && document.hidden;
    this.nextTime = this.clock() + .04;
    this.timer = setInterval(() => this.pump(), 20);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.pump();
  }

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
    this.suspended = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  get running() { return this.timer !== null; }
  get isSuspended() { return this.suspended; }
}
