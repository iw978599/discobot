// Following another device's MIDI clock (roadmap item 24): its 24 pulses to a quarter note give a
// tempo, read across the last beat's worth of pulses so one late pulse moves it little. The tempo
// is to a tenth, held to the app's 20 to 400. Start and stop are the studio's to act on.

export const PULSES_PER_BEAT = 24;

export function createClockFollower(window = PULSES_PER_BEAT) {
  const times: number[] = [];
  return {
    // A pulse that arrived at `at` milliseconds; answers the tempo once a beat has been heard.
    pulse(at: number): number | null {
      if (!Number.isFinite(at)) return null;
      // A clock that stopped and started again begins a new count.
      if (times.length && (at <= times[times.length - 1] || at - times[times.length - 1] > 1000)) times.length = 0;
      times.push(at);
      if (times.length > window + 1) times.shift();
      if (times.length < window + 1) return null;
      const perPulse = (times[times.length - 1] - times[0]) / window;
      if (!(perPulse > 0)) return null;
      const bpm = 60000 / (perPulse * PULSES_PER_BEAT);
      return Math.round(Math.min(400, Math.max(20, bpm)) * 10) / 10;
    },
    reset() { times.length = 0; },
  };
}
