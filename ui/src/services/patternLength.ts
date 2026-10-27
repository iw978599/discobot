import type { Automation, DrumInstrument, DrumLanePattern, Scene, SequencerStep, TimeSignature } from '../types';

// A lane or the drum grid can be 1, 2, 4 or 8 bars long. How long a bar is comes from the scene's
// time signature: 16 steps in 4/4, or twice that on a synth lane set to finer steps. Lanes of
// different lengths loop against each other.
export const BAR_CHOICES = [1, 2, 4, 8] as const;
export const MAX_BARS = 8;

// The time signatures a scene can have, and each one's beats as their lengths in sixteenth notes.
// This table is the one place that says how long a bar is and where its beats fall; everything
// else asks the functions below. 3/4 and 6/8 are as long as each other and differ in their beats.
// 7/8 is counted two, two, three. `across` is how many steps a narrow screen puts in a row, so
// that a row ends where a beat does.
const METRES: Record<TimeSignature, { beats: number[]; across: number }> = {
  '4/4': { beats: [4, 4, 4, 4], across: 8 },
  '3/4': { beats: [4, 4, 4], across: 8 },
  '6/8': { beats: [6, 6], across: 6 },
  '5/4': { beats: [4, 4, 4, 4, 4], across: 8 },
  '7/8': { beats: [4, 4, 6], across: 8 },
  '12/8': { beats: [6, 6, 6, 6], across: 6 },
};
export const TIME_SIGNATURES = Object.keys(METRES) as TimeSignature[];
export const DEFAULT_SIGNATURE: TimeSignature = '4/4';

// Anything that is not one of the six is 4/4, which is what every scene was before there was a choice.
export const timeSignature = (value: unknown): TimeSignature => TIME_SIGNATURES.find(signature => signature === value) ?? DEFAULT_SIGNATURE;
// What a scene stores: nothing for 4/4, so a scene in 4/4 is what it was before.
export const storedSignature = (value: unknown): TimeSignature | undefined => (timeSignature(value) === DEFAULT_SIGNATURE ? undefined : timeSignature(value));

// Sixteenth-note steps in a bar: the drum grid's, and a synth lane's unless it is set to finer steps.
export const barSteps = (signature?: unknown): number => METRES[timeSignature(signature)].beats.reduce((sum, beat) => sum + beat, 0);
// The transport's ticks in a bar. A tick is a 32nd note.
export const barTicks = (signature?: unknown): number => barSteps(signature) * 2;
// A bar's length in quarter notes, which is what a tempo counts.
export const barQuarters = (signature?: unknown): number => barSteps(signature) / 4;
export const barSeconds = (signature: unknown, tempo: number): number => barQuarters(signature) * 60 / tempo;
// How many steps the first beat of a bar lasts: four, or six in 6/8 and 12/8.
export const beatLength = (signature?: unknown): number => METRES[timeSignature(signature)].beats[0];
export const stepsAcross = (signature?: unknown): number => METRES[timeSignature(signature)].across;
// The two numbers of a signature, which is how a MIDI file carries it.
export const signatureFraction = (signature?: unknown): { numerator: number; denominator: number } => {
  const [numerator, denominator] = timeSignature(signature).split('/').map(Number);
  return { numerator, denominator };
};

// Where each beat of a bar starts, in sixteenth steps.
export function beatStarts(signature?: unknown): number[] {
  let at = 0;
  return METRES[timeSignature(signature)].beats.map(beat => { const start = at; at += beat; return start; });
}
// Whether a step of a bar starts a beat. `perBar` is how many steps the bar is drawn or played
// as: the bar's own count, or twice that for finer steps and for the transport's ticks.
export function onBeat(signature: unknown, stepInBar: number, perBar: number = barSteps(signature)): boolean {
  const scale = perBar / barSteps(signature);
  return Number.isInteger(stepInBar / scale) && beatStarts(signature).includes(stepInBar / scale);
}

// When each bar of a run of bars starts and how long it lasts, in seconds. `whole` is how long a
// whole note lasts, which is a bar of 4/4: a run of 4/4 bars is that length over and over, as it
// was before a bar could be any other length.
export interface BarTime { start: number; duration: number }
// `scales` stretches a bar played at another tempo than the project's (a scene's own, roadmap 17):
// the project's tempo over the bar's. Bars at the project's tempo come out exactly as they did.
export function barTimes(signatures: unknown[], whole: number, scales: number[] = []): BarTime[] {
  let sixteenths = 0;
  return signatures.map((signature, bar) => {
    const steps = barSteps(signature) * (scales[bar] ?? 1), time = { start: sixteenths / 16 * whole, duration: steps / 16 * whole };
    sixteenths += steps;
    return time;
  });
}
// How long a run of bars is, counted in whole notes: its length in bars when they are all 4/4.
export const wholeNotes = (signatures: unknown[]): number => signatures.reduce<number>((sum, signature) => sum + barSteps(signature), 0) / 16;

// How many sixteenth steps into its beat a step of a bar is: 0 on the beat.
export function beatPosition(signature: unknown, stepInBar: number): number {
  const starts = beatStarts(signature);
  return stepInBar - (starts.filter(start => start <= stepInBar).pop() ?? 0);
}

// How many bars a lane's steps cover. `bars` is only believed if it fits the step count.
export function laneBars(stepCount: number, bars: unknown, signature?: unknown): number {
  const wanted = BAR_CHOICES.find(choice => choice === bars) ?? 1;
  const perBar = stepCount / wanted, bar = barSteps(signature);
  return perBar === bar || perBar === bar * 2 ? wanted : 1;
}
export const stepsPerBar = (stepCount: number, bars: unknown, signature?: unknown) => stepCount / laneBars(stepCount, bars, signature);

// The drum grid's length. Every drum lane is the same length; the kick is as good as any.
export function drumBars(drums: Partial<Record<DrumInstrument, { steps: unknown[] }>>, signature?: unknown): number {
  const perBar = barSteps(signature);
  const bars = (drums.kick?.steps.length ?? perBar) / perBar;
  return BAR_CHOICES.find(choice => choice === bars) ?? 1;
}

// One bar out of a looping pattern: bar 5 of a two-bar lane is its second bar.
export function barOf<T>(items: T[], perBar: number, bar: number): T[] {
  const bars = Math.max(1, Math.floor(items.length / perBar));
  const start = (((bar % bars) + bars) % bars) * perBar;
  return items.slice(start, start + perBar);
}

const copyOf = <T>(item: T): T => (typeof item === 'object' && item !== null ? { ...item } : item);

// Changes how many bars a pattern has. Growing repeats what is there, so a one-bar loop
// becomes the same loop twice, ready to vary; shrinking keeps the first bars.
export function resizeBars<T>(items: T[], perBar: number, nextBars: number, blank: () => T): T[] {
  const bars = Math.max(1, Math.floor(items.length / perBar));
  return Array.from({ length: perBar * nextBars }, (_, index) => {
    const source = items[(Math.floor(index / perBar) % bars) * perBar + (index % perBar)];
    return source === undefined ? blank() : copyOf(source);
  });
}

// Changes how long each bar of a pattern is and keeps how many bars it has, which is what a new
// time signature does. A shorter bar loses the steps at its end; a longer one gains empty steps
// there. Nothing is repeated and nothing moves to another bar.
export function resizeEachBar<T>(items: T[], perBar: number, nextPerBar: number, blank: () => T): T[] {
  const bars = Math.max(1, Math.floor(items.length / perBar));
  return Array.from({ length: bars * nextPerBar }, (_, index) => {
    const inBar = index % nextPerBar, source = inBar < perBar ? items[Math.floor(index / nextPerBar) * perBar + inBar] : undefined;
    return source === undefined ? blank() : copyOf(source);
  });
}

// A pattern laid along another length: it goes round again when it is the shorter and stops
// short when it is the longer.
export const layAlong = <T>(items: T[], length: number): T[] => (items.length ? Array.from({ length }, (_, index) => copyOf(items[index % items.length])) : []);

// Steps counted from the start of a file laid along bars of `perBar` steps: as many bars as hold
// them, up to eight, with what is past the eighth left out and the rest of the last bar empty.
export function relayBars<T>(items: T[], perBar: number, blank: () => T): { items: T[]; bars: number } {
  const bars = BAR_CHOICES.find(choice => choice * perBar >= items.length) ?? MAX_BARS;
  return { bars, items: Array.from({ length: bars * perBar }, (_, index) => (items[index] === undefined ? blank() : copyOf(items[index]))) };
}

// Which of the bars asked for a bar can be copied over: whole numbers, inside the pattern, not the
// bar itself, each once. Null when the bar to copy is not one, or nothing is left to copy it to.
export function barTargets(bars: number, from: unknown, to: unknown): number[] | null {
  const inside = (bar: unknown): bar is number => typeof bar === 'number' && Number.isInteger(bar) && bar >= 0 && bar < bars;
  if (!inside(from) || !Array.isArray(to) || !to.every(inside)) return null;
  const targets = [...new Set(to)].filter(bar => bar !== from);
  return targets.length > 0 ? targets : null;
}

// One bar laid over others of the same pattern. The rest is left as it is.
export function copyBar<T>(items: T[], perBar: number, from: number, to: number[]): T[] {
  return items.map((item, index) => {
    if (!to.includes(Math.floor(index / perBar))) return item;
    return copyOf(items[from * perBar + (index % perBar)]);
  });
}

// A long note must not ring past where the pattern now ends.
export function clampLengths(steps: SequencerStep[]): SequencerStep[] {
  return steps.map((step, index) => {
    if (!step.length || step.length <= steps.length - index) return step;
    const { length: _length, lengths, ...rest } = step;
    const room = steps.length - index;
    // Each note's own length is held to the same room; notes that then last alike need none of their own.
    const own = lengths?.map(length => Math.min(length, room));
    return { ...rest, ...(room > 1 ? { length: room } : {}), ...(own?.some(length => length !== room) ? { lengths: own } : {}) };
  });
}

// How many bars a scene lasts: its longest lane or the drum grid, whichever is longer.
export function sceneBars(scene: Pick<Scene, 'lanes' | 'drums' | 'laneBars' | 'signature'>): number {
  let longest = drumBars(scene.drums ?? {}, scene.signature);
  for (const [id, steps] of Object.entries(scene.lanes ?? {})) longest = Math.max(longest, laneBars(steps.length, scene.laneBars?.[Number(id)], scene.signature));
  return longest;
}

const DRUM_ARRAYS = ['stepVelocities', 'stepProbabilities', 'stepRatchets'] as const;

// One bar of a drum lane, with the per-step details that travel with its steps.
export function drumLaneBar<T extends DrumLanePattern>(lane: T, bar: number, signature?: unknown): T {
  const perBar = barSteps(signature);
  const sliced = { ...lane, steps: barOf(lane.steps, perBar, bar) };
  for (const key of DRUM_ARRAYS) if (lane[key]) sliced[key] = barOf(lane[key]!, perBar, bar);
  return sliced;
}

// A scene cut down to the one bar it plays `bar` bars into a pass, each lane looping at its
// own length. Everything that renders (WAV, MIDI, the shared-song page) works a bar at a time.
export function sceneBar(scene: Scene, bar: number): Scene {
  return {
    id: scene.id, name: scene.name,
    lanes: Object.fromEntries(Object.entries(scene.lanes ?? {}).map(([id, steps]) => [id, barOf(steps, stepsPerBar(steps.length, scene.laneBars?.[Number(id)], scene.signature), bar)])),
    drums: Object.fromEntries((Object.keys(scene.drums ?? {}) as DrumInstrument[]).map(instrument => [instrument, drumLaneBar(scene.drums[instrument], bar, scene.signature)])) as Scene['drums'],
    // A lane's automation is cut at the same place as its steps.
    ...(scene.laneAutomation ? {
      laneAutomation: Object.fromEntries(Object.entries(scene.laneAutomation).map(([id, automation]): [string, Automation] => {
        const steps = scene.lanes?.[Number(id)] ?? [], perBar = stepsPerBar(steps.length, scene.laneBars?.[Number(id)], scene.signature);
        return [id, Object.fromEntries(Object.entries(automation).map(([key, values]) => [key, barOf(values, perBar, bar)]))];
      })),
    } : {}),
    ...(scene.mutes ? { mutes: scene.mutes } : {}),
    ...(scene.color ? { color: scene.color } : {}),
    ...(scene.signature ? { signature: scene.signature } : {}),
    ...(scene.tempo !== undefined ? { tempo: scene.tempo } : {}),
    ...(scene.guestMix ? { guestMix: scene.guestMix } : {}),
    // A lane's own sound in the scene is the scene's, in every bar of it.
    ...(scene.sounds ? { sounds: scene.sounds } : {}),
  };
}

// A scene as the bars of one pass through it.
export const sceneAsBars = (scene: Scene): Scene[] => Array.from({ length: sceneBars(scene) }, (_, bar) => sceneBar(scene, bar));
