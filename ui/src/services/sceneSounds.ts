import type { LaneSound, Scene, SynthModelId, SynthModelParams, SynthParameters } from '../types';

// A lane's instrument chosen per scene (docs/SCENE_SOUNDS_PLAN.md). The lanes in the store are the
// open scene's sound, as their steps are the open scene's steps. A scene with a sound of its own for
// a lane keeps it in `scene.sounds`, and while that scene is open the lane keeps its shared sound
// aside in `shared`.

// What stays the lane's in every scene, because the mixer shows it: its level, pan, sends and duck.
export const CHANNEL_KEYS = ['gain', 'pan', 'fxSends', 'fxReturn', 'duck'] as const;

export interface SoundedLane {
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  preset?: string;
  shared?: LaneSound;
}

const copy = <T>(value: T): T => structuredClone(value);

// `params` with `channel`'s level, pan, sends and duck in place of its own.
export function withChannel(params: SynthParameters, channel: SynthParameters): SynthParameters {
  const out: Record<string, unknown> = { ...params };
  for (const key of CHANNEL_KEYS) {
    if (channel[key] === undefined) delete out[key];
    else out[key] = copy(channel[key]);
  }
  return out as unknown as SynthParameters;
}

// The sound a lane has now, as a scene would keep it.
export const soundOf = (lane: SoundedLane & { synthParams: SynthParameters }): LaneSound => ({
  synthParams: copy(lane.synthParams), synthModelId: lane.synthModelId, synthModelParams: { ...lane.synthModelParams },
  ...(lane.preset ? { preset: lane.preset } : {}),
});

// The lane's shared sound: what a scene without one of its own plays.
export const sharedSound = (lane: SoundedLane & { synthParams: SynthParameters }): LaneSound => lane.shared ?? soundOf(lane);

// What a lane plays in a scene that is not open: the scene's own sound, with the lane's channel,
// or the lane's shared sound. For the open scene the lane itself is the answer.
export function soundIn(scene: Pick<Scene, 'sounds'> | null | undefined, laneId: number, lane: SoundedLane & { synthParams: SynthParameters }): SynthParameters {
  const own = scene?.sounds?.[laneId];
  if (own) return withChannel(own.synthParams, lane.synthParams);
  return lane.shared ? withChannel(lane.shared.synthParams, lane.synthParams) : lane.synthParams;
}

// Which recording a sound's sample engine plays, as a key: the same for the same recording, and
// empty for none. The recordings a song's scenes use are loaded once each, under it.
export const sampleKey = (params: SynthParameters | null | undefined): string =>
  (params?.sample?.wave ? `wave:${params.sample.wave}` : params?.sample?.id ? `id:${params.sample.id}` : '');

// Every sound a lane has in a project: its own, its shared one, and each scene's for it.
export const lanesSounds = (lane: SoundedLane & { id: number }, scenes: Array<Pick<Scene, 'sounds'>>): SynthParameters[] =>
  [lane.synthParams, lane.shared?.synthParams, ...scenes.map(scene => scene.sounds?.[lane.id]?.synthParams)].filter((params): params is SynthParameters => Boolean(params));

// Whether two sounds are the same for the voice, so a change need not be sent.
export const sameSound = (a: SynthParameters | null | undefined, b: SynthParameters | null | undefined): boolean =>
  a === b || (Boolean(a) && Boolean(b) && JSON.stringify(a) === JSON.stringify(b));
