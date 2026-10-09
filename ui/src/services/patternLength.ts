import type { DrumInstrument, DrumLanePattern, Scene, SequencerStep } from '../types';

// A lane or the drum grid can be 1, 2, 4 or 8 bars long. A bar is 16 steps, or 32 on a synth
// lane set to finer steps. Lanes of different lengths loop against each other.
export const BAR_CHOICES = [1, 2, 4, 8] as const;
export const MAX_BARS = 8;
export const DRUM_STEPS_PER_BAR = 16;

// How many bars a lane's steps cover. `bars` is only believed if it fits the step count.
export function laneBars(stepCount: number, bars: unknown): number {
  const wanted = BAR_CHOICES.find(choice => choice === bars) ?? 1;
  const perBar = stepCount / wanted;
  return perBar === 16 || perBar === 32 ? wanted : 1;
}
export const stepsPerBar = (stepCount: number, bars: unknown) => stepCount / laneBars(stepCount, bars);

// The drum grid's length. Every drum lane is the same length; the kick is as good as any.
export function drumBars(drums: Partial<Record<DrumInstrument, { steps: unknown[] }>>): number {
  const bars = (drums.kick?.steps.length ?? DRUM_STEPS_PER_BAR) / DRUM_STEPS_PER_BAR;
  return BAR_CHOICES.find(choice => choice === bars) ?? 1;
}

// One bar out of a looping pattern: bar 5 of a two-bar lane is its second bar.
export function barOf<T>(items: T[], perBar: number, bar: number): T[] {
  const bars = Math.max(1, Math.floor(items.length / perBar));
  const start = (((bar % bars) + bars) % bars) * perBar;
  return items.slice(start, start + perBar);
}

// Changes how many bars a pattern has. Growing repeats what is there, so a one-bar loop
// becomes the same loop twice, ready to vary; shrinking keeps the first bars.
export function resizeBars<T>(items: T[], perBar: number, nextBars: number, blank: () => T): T[] {
  const bars = Math.max(1, Math.floor(items.length / perBar));
  return Array.from({ length: perBar * nextBars }, (_, index) => {
    const source = items[(Math.floor(index / perBar) % bars) * perBar + (index % perBar)];
    return source === undefined ? blank() : (typeof source === 'object' && source !== null ? { ...source } : source);
  });
}

// A long note must not ring past where the pattern now ends.
export function clampLengths(steps: SequencerStep[]): SequencerStep[] {
  return steps.map((step, index) => {
    if (!step.length || step.length <= steps.length - index) return step;
    const { length: _length, ...rest } = step;
    const room = steps.length - index;
    return room > 1 ? { ...rest, length: room } : rest;
  });
}

// How many bars a scene lasts: its longest lane or the drum grid, whichever is longer.
export function sceneBars(scene: Pick<Scene, 'lanes' | 'drums' | 'laneBars'>): number {
  let longest = drumBars(scene.drums ?? {});
  for (const [id, steps] of Object.entries(scene.lanes ?? {})) longest = Math.max(longest, laneBars(steps.length, scene.laneBars?.[Number(id)]));
  return longest;
}

const DRUM_ARRAYS = ['stepVelocities', 'stepProbabilities', 'stepRatchets'] as const;

// One bar of a drum lane, with the per-step details that travel with its steps.
export function drumLaneBar<T extends DrumLanePattern>(lane: T, bar: number): T {
  const sliced = { ...lane, steps: barOf(lane.steps, DRUM_STEPS_PER_BAR, bar) };
  for (const key of DRUM_ARRAYS) if (lane[key]) sliced[key] = barOf(lane[key]!, DRUM_STEPS_PER_BAR, bar);
  return sliced;
}

// A scene cut down to the one bar it plays `bar` bars into a pass, each lane looping at its
// own length. Everything that renders (WAV, MIDI, the shared-song page) works a bar at a time.
export function sceneBar(scene: Scene, bar: number): Scene {
  return {
    id: scene.id, name: scene.name,
    lanes: Object.fromEntries(Object.entries(scene.lanes ?? {}).map(([id, steps]) => [id, barOf(steps, stepsPerBar(steps.length, scene.laneBars?.[Number(id)]), bar)])),
    drums: Object.fromEntries((Object.keys(scene.drums ?? {}) as DrumInstrument[]).map(instrument => [instrument, drumLaneBar(scene.drums[instrument], bar)])) as Scene['drums'],
    ...(scene.mutes ? { mutes: scene.mutes } : {}),
    ...(scene.guestMix ? { guestMix: scene.guestMix } : {}),
  };
}

// A scene as the bars of one pass through it.
export const sceneAsBars = (scene: Scene): Scene[] => Array.from({ length: sceneBars(scene) }, (_, bar) => sceneBar(scene, bar));
