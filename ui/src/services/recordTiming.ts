// Where a note played while the transport runs is written: which step, and how late in it.
// The scheduler works a little ahead of what is heard, so the step it last played is not the step
// the player is hearing. This works back from the clock to the step being heard, then moves the
// note towards the nearest step by the quantize strength.

export const QUANTIZE_CHOICES = [1, 0.75, 0.5, 0] as const;
export const DEFAULT_QUANTIZE = 1;
// A note cannot start later in its step than this, as a step's offset cannot.
const MAX_OFFSET = 0.95;

export function asQuantize(value: unknown): number {
  return QUANTIZE_CHOICES.includes(value as typeof QUANTIZE_CHOICES[number]) ? value as number : DEFAULT_QUANTIZE;
}

export interface RecordMoment {
  // the transport's clock where the player is, in ticks (32 to a bar), as a fraction
  heardTicks: number;
  // the tick the scheduler will play next
  scheduledTicks: number;
  // the step the scheduler last played on this lane
  playheadStep: number;
  // ticks in one of this lane's steps: 2 for sixteen steps to the bar, 1 for thirty-two
  ticksPerStep: number;
  // steps in the lane's pattern
  steps: number;
  // 1 moves the note onto the nearest step; 0 leaves it where it was played
  strength: number;
}

export function recordPosition(moment: RecordMoment): { step: number; offset: number } {
  const { heardTicks, scheduledTicks, playheadStep, ticksPerStep, steps } = moment;
  const strength = Math.max(0, Math.min(1, moment.strength));
  // How many steps the scheduler is ahead of the player, and how far into its step the player is.
  const ahead = Math.floor((scheduledTicks - 1) / ticksPerStep) - Math.floor(heardTicks / ticksPerStep);
  const played = playheadStep - ahead + ((heardTicks / ticksPerStep) % 1 + 1) % 1;
  const nearest = Math.round(played);
  const kept = nearest + (played - nearest) * (1 - strength);
  let step = Math.floor(kept + 1e-9), offset = kept - step;
  // Close enough to a step is on it; too close to the next one is the next one.
  if (offset < 0.04) offset = 0;
  if (offset > MAX_OFFSET) { step += 1; offset = 0; }
  return { step: ((step % steps) + steps) % steps, offset: Math.round(offset * 100) / 100 };
}
