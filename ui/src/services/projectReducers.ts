// What each operation does to the project. A reducer is the body of the route it replaces,
// moved as it was. It changes the state it is handed and says what to save and send; it never
// emits, saves or reads the clock itself, which is `apply`'s work in localService.ts.
import { MAX_SCENES, clone, merge, number, sanitizeDrums, sanitizeEffects, sanitizeModelParams, sanitizePattern, sanitizeScenes, sanitizeSends, sanitizeSong, sanitizeSynthParams } from './projectSanitization';
import { MAX_GUESTS, guestUrl, patchGuest, sanitizeGuests } from './guests';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { LANE_IDS, MAX_LANES, storedLaneName, storedPresetName } from './lanes';
import { BAR_CHOICES, TIME_SIGNATURES, barSteps, barTargets, clampLengths, copyBar, drumBars, laneBars, layAlong, resizeBars, resizeEachBar, stepsPerBar, storedSignature } from './patternLength';
import { emptySteps } from './songPlayback';
import { layAutomationAlong, resizeAutomationEachBar } from './automation';
import { nextSceneColor, sceneColor } from './sceneColors';
import { normalizeSynthModelId } from '../synthModels';
import type { DrumState, Pattern, Scene, TimeSignature } from '../types';
import type { ProjectDefaults, ProjectLane, ProjectState } from './localService';
import type { Operation, OpResult, OpType, Outcome, Rejected } from './projectOps';

// `origin` is this machine's own address, which a guest may not be loaded from.
export interface ReducerContext { state: ProjectState; defaults: ProjectDefaults; origin: string | undefined }
type Reducers = { [K in OpType]: (ctx: ReducerContext, op: Extract<Operation, { type: K }>) => Outcome<OpResult<K>> };

// Save, send the event, answer with the same data.
const update = <V>(type: string, data: V): Outcome<V> => ({ ok: true, value: data, save: true, event: { type, data } });
// What `respond({ error }, status)` was. A reducer refuses before it changes anything.
const refuse = (status: Rejected['status'], error: string): Rejected => ({ ok: false, status, error });
const BAD_DATA = 'Invalid local operation data';
const NO_SYNTH = 'Synth not found';
// The parts a patch carries only when it is a whole sound and not one knob's change.
export const WHOLE_SOUND = ['oscillator', 'filter', 'envelope', 'lfo1', 'lfo2', 'fxSends', 'gain'];
const BAD_ADDRESS = 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.';

// An object in an operation, as a route's body used to arrive: after a trip through JSON, which
// leaves out what is undefined, turns NaN and infinity into null, and hands the reducer a copy
// that is nobody else's. Null for anything that is not an object, which is refused with
// "Invalid local operation data".
const sent = (value: unknown): Record<string, any> | null => {
  try {
    const parsed = JSON.parse(JSON.stringify(value) ?? 'null');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
};
// One value in an operation, after the same trip: a number that is not finite is null, and
// what JSON cannot carry is undefined.
const sentValue = (value: unknown): unknown => sent({ value })?.value;

// The open scene's time signature, which says how long a bar of the live lanes and drums is.
// It is the one thing about the open scene read from its slot in `scenes`: the lanes cannot say it.
export const openSignature = (state: ProjectState): TimeSignature | undefined => state.scenes.find(scene => scene.id === state.currentSceneId)?.signature;
const DRUM_DETAILS = [['stepVelocities', 1], ['stepProbabilities', 1], ['stepRatchets', 1]] as const;

// Only a lane's own number finds it; an operation can name anything.
const laneOf = (state: ProjectState, synthId: unknown) => state.synths.find(s => s.synthId === synthId);

type DrumLane = DrumState[keyof DrumState];
// The six edits to one drum lane: find the lane, change it, put the whole drum state through the
// checks, and send all of it. Only a lane the drum state has of its own is found: an instrument
// named after a property every object has (`constructor`, `toString`, `__proto__`) used to find
// that property, which a step edit then threw on and a mute or a sample was written onto.
const drumLaneEdit = ({ state, defaults }: ReducerContext, instrument: unknown, edit: (track: DrumLane) => Rejected | void): Outcome<{ drumState: DrumState }> => {
  const track = Object.prototype.hasOwnProperty.call(state.drumState, instrument as string) ? state.drumState[instrument as keyof DrumState] : undefined;
  if (!track) return refuse(404, 'Unknown local operation');
  const refused = edit(track);
  if (refused) return refused;
  state.drumState = sanitizeDrums(state.drumState, defaults.drumState, openSignature(state));
  return update('drumFullState', { drumState: state.drumState });
};
const badDrumStep = (track: DrumLane, step: number) =>
  (!Number.isInteger(step) || step < 0 || step >= track.steps.length ? refuse(400, 'Invalid drum step') : undefined);

// A lane as the store first makes it: one blank pattern of one bar (sixteen steps in 4/4), the
// default sound, and the project's tempo. The pattern's id is made here, not carried by the operation.
export const newLane = (synthId: number, tempo: number, defaults: ProjectDefaults, signature?: unknown): ProjectLane => {
  const pattern: Pattern = {
    id: crypto.randomUUID(), name: `Synth ${synthId}`, tempo,
    steps: emptySteps(barSteps(signature)),
  };
  return {
    synthId, pattern, patterns: [pattern], synthParams: clone(defaults.synthParams),
    synthModelId: 'generic', synthModelParams: { macro1: .5, macro2: .5, macro3: .5, macro4: .5 },
    muted: false, solo: false, isPlaying: false,
  };
};

// Play and stop are the same change with opposite flags: a pattern named that the lane has
// becomes the lane's pattern (for stop as well as play, as the route did), the lane is marked,
// the event goes out and nothing is saved. A lane that is not there is not an error: the answer
// says it failed, nothing is sent, and the status is still 200.
const transport = (playing: boolean) => ({ state }: ReducerContext, op: { synthId: number; patternId?: string }): Outcome<{ success: boolean }> => {
  const synth = laneOf(state, op.synthId);
  if (!synth) return { ok: true, value: { success: false }, save: false };
  if (op.patternId) {
    const pattern = synth.patterns.find(p => p.id === op.patternId);
    if (pattern) synth.pattern = pattern;
  }
  synth.isPlaying = playing;
  return { ok: true, value: { success: true }, save: false, event: { type: playing ? 'sequencerPlay' : 'sequencerStop', data: { synthId: synth.synthId } } };
};

// The scenes. The lanes' patterns and the drum grid are the scene being edited; its slot in
// `scenes` is only brought up to date by `commitScene`, which runs before anything reads
// `scenes`. These work on the state they are handed: the reducers below use them, and so does
// the service on its open project.

// The live lanes and drum grid as a scene.
export const captureScene = (state: ProjectState, id: string, name: string, color?: string, signature?: TimeSignature): Scene => ({
  id, name,
  ...(color ? { color } : {}),
  ...(storedSignature(signature) ? { signature: storedSignature(signature) } : {}),
  lanes: Object.fromEntries(state.synths.map(synth => [synth.synthId, clone(synth.pattern.steps)])),
  ...(state.synths.some(synth => (synth.pattern.bars ?? 1) > 1)
    ? { laneBars: Object.fromEntries(state.synths.filter(synth => (synth.pattern.bars ?? 1) > 1).map(synth => [synth.synthId, synth.pattern.bars!])) } : {}),
  // Automation is the pattern's, like its steps and its length, and goes into the scene with them.
  ...(state.synths.some(synth => synth.pattern.automation)
    ? { laneAutomation: Object.fromEntries(state.synths.filter(synth => synth.pattern.automation).map(synth => [synth.synthId, clone(synth.pattern.automation!)])) } : {}),
  ...(state.guests?.some(guest => guest.state !== undefined)
    ? { guests: Object.fromEntries(state.guests.filter(guest => guest.state !== undefined).map(guest => [guest.id, clone(guest.state)])) } : {}),
  ...(state.guests?.length ? { guestMix: Object.fromEntries(state.guests.map(guest => [guest.id, { volume: guest.volume, muted: guest.muted }])) } : {}),
  mutes: {
    lanes: Object.fromEntries(state.synths.map(synth => [synth.synthId, { muted: synth.muted, solo: synth.solo }])),
    drums: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { muted: state.drumState[instrument].muted, solo: state.drumState[instrument].solo }])),
  },
  drums: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => {
    const { steps, stepVelocities, stepProbabilities, stepRatchets } = state.drumState[instrument];
    return [instrument, clone({
      steps, ...(stepVelocities ? { stepVelocities } : {}), ...(stepProbabilities ? { stepProbabilities } : {}),
      ...(stepRatchets ? { stepRatchets } : {}),
    })];
  })) as Scene['drums'],
});

export const ensureScenes = (state: ProjectState) => {
  if (state.scenes.length === 0) {
    const scene = captureScene(state, crypto.randomUUID(), 'Scene 1');
    state.scenes = [scene];
    state.currentSceneId = scene.id;
  }
  if (!state.scenes.some(scene => scene.id === state.currentSceneId)) state.currentSceneId = state.scenes[0].id;
  state.song = sanitizeSong(state.song, state.scenes);
};

// Copies the live pattern into the current scene's slot. Edits go to the live lanes and
// drums, so this runs before anything reads `scenes`: saving, switching, exporting.
export const commitScene = (state: ProjectState) => {
  const index = state.scenes.findIndex(scene => scene.id === state.currentSceneId);
  if (index >= 0) state.scenes[index] = captureScene(state, state.currentSceneId, state.scenes[index].name, state.scenes[index].color, state.scenes[index].signature);
};

// Makes a scene the live pattern.
const applyScene = (state: ProjectState, scene: Scene) => {
  state.currentSceneId = scene.id;
  for (const synth of state.synths) {
    synth.pattern.steps = clone(scene.lanes[synth.synthId] ?? emptySteps(barSteps(scene.signature)));
    const bars = laneBars(synth.pattern.steps.length, scene.laneBars?.[synth.synthId], scene.signature);
    if (bars > 1) synth.pattern.bars = bars; else delete synth.pattern.bars;
    const automation = scene.laneAutomation?.[synth.synthId];
    if (automation) synth.pattern.automation = clone(automation); else delete synth.pattern.automation;
    // Mutes and solos are the scene's. A scene from before they were kept holds none, and
    // the lanes carry on as they are.
    const flags = scene.mutes?.lanes?.[synth.synthId];
    if (flags) { synth.muted = flags.muted; synth.solo = flags.solo; }
  }
  // A guest takes the settings this scene holds for it. A scene from before the guest was added
  // holds none, and the guest carries on as it is.
  if (state.guests) {
    state.guests = state.guests.map(guest => ({
      ...guest,
      ...(scene.guests && guest.id in scene.guests ? { state: clone(scene.guests[guest.id]) } : {}),
      ...(scene.guestMix?.[guest.id] ?? {}),
    }));
  }
  for (const instrument of DRUM_INSTRUMENTS) {
    const track = state.drumState[instrument], pattern = scene.drums[instrument];
    const flags = scene.mutes?.drums?.[instrument];
    if (flags) { track.muted = flags.muted; track.solo = flags.solo; }
    track.steps = clone(pattern.steps);
    for (const key of ['stepVelocities', 'stepProbabilities', 'stepRatchets'] as const) {
      if (pattern[key]) track[key] = clone(pattern[key]);
      else delete track[key];
    }
  }
};

// What every scene change sends, and answers with: the scenes, the song, the open scene, and the
// lanes and drums as that scene left them, which is what the sceneChanged handler writes into
// the refs the scheduler reads.
export const sceneMessage = (state: ProjectState) => {
  commitScene(state);
  return {
    scenes: state.scenes, song: state.song, currentSceneId: state.currentSceneId,
    synths: state.synths.map(synth => ({ synthId: synth.synthId, pattern: synth.pattern, muted: synth.muted, solo: synth.solo })), drumState: state.drumState,
    guests: state.guests ?? [],
  };
};
const sceneChanged = (state: ProjectState) => update('sceneChanged', sceneMessage(state));

// One reducer for every operation: the compiler fails if one is missing.
export const reducers: Reducers = {
  'drum.bars': ({ state, defaults }, op) => {
    const bars = BAR_CHOICES.find(choice => choice === op.bars);
    if (!bars) return refuse(400, 'A drum pattern is 1, 2, 4 or 8 bars long');
    const signature = openSignature(state), perBar = barSteps(signature);
    for (const instrument of DRUM_INSTRUMENTS) {
      const lane = state.drumState[instrument];
      lane.steps = resizeBars(lane.steps, perBar, bars, () => false);
      for (const [key, blank] of DRUM_DETAILS) if (lane[key]) lane[key] = resizeBars(lane[key]!, perBar, bars, () => blank);
    }
    state.drumState = sanitizeDrums(state.drumState, defaults.drumState, signature);
    return update('drumFullState', { drumState: state.drumState });
  },
  // One bar of the whole grid laid over others: every drum's steps, with each step's details.
  'drum.copyBar': ({ state, defaults }, op) => {
    const signature = openSignature(state), perBar = barSteps(signature);
    const to = barTargets(drumBars(state.drumState, signature), op.from, op.to);
    if (!to) return refuse(400, 'There is no such bar to copy');
    for (const instrument of DRUM_INSTRUMENTS) {
      const lane = state.drumState[instrument];
      lane.steps = copyBar(lane.steps, perBar, op.from, to);
      for (const [key] of DRUM_DETAILS) if (lane[key]) lane[key] = copyBar(lane[key]!, perBar, op.from, to);
    }
    state.drumState = sanitizeDrums(state.drumState, defaults.drumState, signature);
    return update('drumFullState', { drumState: state.drumState });
  },
  // `merge` takes a key that is undefined as a value to set, so the patch is read as sent.
  'drum.fx': ({ state, defaults }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const fx = merge(state.drumFx, patch);
    state.drumFx = { sends: sanitizeSends(fx.sends, defaults.drumFx.sends), returnLevel: number(fx.returnLevel, state.drumFx.returnLevel, 0, 1) };
    return update('drumFxUpdate', { drumFx: state.drumFx });
  },
  'drum.kit': ({ state }, op) => {
    const kit = DRUM_KITS.find(k => k.id === op.kitId);
    if (!kit) return refuse(400, 'Unknown kit');
    state.selectedDrumKitId = kit.id;
    if (op.applyDefaults !== false) {
      DRUM_INSTRUMENTS.forEach(instrument => { state.drumState[instrument].settings = { ...state.drumState[instrument].settings, ...kit.instrumentDefaults[instrument] }; });
    }
    return update('drumKitChanged', { selectedDrumKitId: kit.id, drumState: state.drumState });
  },
  'drum.masterVolume': ({ state }, op) => {
    state.drumMasterVolume = number(op.volume, state.drumMasterVolume, 0, 1);
    return update('drumMasterVolume', { volume: state.drumMasterVolume });
  },
  'drum.mix': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    if (typeof op.muted === 'boolean') track.muted = op.muted;
    if (typeof op.solo === 'boolean') track.solo = op.solo;
  }),
  // The grid goes back to one empty bar, of the open scene's length.
  'drum.reset': ({ state, defaults }) => {
    state.drumState = clone(defaults.drumState);
    for (const instrument of DRUM_INSTRUMENTS) state.drumState[instrument].steps = resizeEachBar(state.drumState[instrument].steps, barSteps(), barSteps(openSignature(state)), () => false);
    return update('drumFullState', { drumState: state.drumState });
  },
  'drum.sample': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    if (typeof op.sampleId === 'string') track.sampleId = op.sampleId; else delete track.sampleId;
  }),
  // `merge` takes a key that is undefined as a value to set, so the settings are read as sent.
  'drum.settings': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    track.settings = merge(track.settings, sent(op.settings) ?? {});
  }),
  // The checks build every lane anew from what they are handed, so nothing of the caller's is kept.
  'drum.state': ({ state, defaults }, op) => {
    state.drumState = sanitizeDrums(op.state, defaults.drumState, openSignature(state));
    return update('drumFullState', { drumState: state.drumState });
  },
  'drum.step': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    const refused = badDrumStep(track, op.step);
    if (refused) return refused;
    track.steps[op.step] = Boolean(sentValue(op.active));
  }),
  'drum.stepDetail': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    const refused = badDrumStep(track, op.step);
    if (refused) return refused;
    if (op.probability !== undefined) {
      track.stepProbabilities ||= Array(track.steps.length).fill(1);
      track.stepProbabilities![op.step] = number(op.probability, 1, 0, 1);
    }
    if (op.ratchet !== undefined) {
      track.stepRatchets ||= Array(track.steps.length).fill(1);
      track.stepRatchets![op.step] = number(op.ratchet, 1, 1, 4);
    }
  }),
  'drum.stepVelocity': (ctx, op) => drumLaneEdit(ctx, op.instrument, track => {
    const refused = badDrumStep(track, op.step);
    if (refused) return refused;
    track.stepVelocities ||= Array(track.steps.length).fill(1);
    track.stepVelocities![op.step] = number(op.velocity, 1, 0, 1);
  }),
  'drum.swing': ({ state }, op) => {
    state.drumSwing = number(op.swing, state.drumSwing, 0, .75);
    return update('drumSwing', { swing: state.drumSwing });
  },
  'effects.set': ({ state, defaults }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    state.effectsLoop = sanitizeEffects(merge(state.effectsLoop, patch), defaults.effectsLoop);
    return update('effectsLoopUpdate', { effectsLoop: state.effectsLoop });
  },
  'guest.add': ({ state, origin }, op) => {
    const guests = state.guests ?? [];
    const url = guestUrl(op.url, origin);
    if (!url) return refuse(400, BAD_ADDRESS);
    if (guests.length >= MAX_GUESTS) return refuse(409, `A project can hold ${MAX_GUESTS} guest instruments.`);
    // The route made the id itself, so these two could not happen there.
    const [guest] = sanitizeGuests([{ id: op.guestId, url, name: op.name }], origin);
    if (!guest) return refuse(400, 'That is not an id a guest instrument can have.');
    if (guests.some(entry => entry.id === guest.id)) return refuse(409, 'That guest instrument is already in the project.');
    state.guests = [...guests, guest];
    return update('guestsChanged', { guests: state.guests });
  },
  'guest.patch': ({ state }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const guests = state.guests ?? [];
    if (!guests.some(guest => guest.id === op.guestId)) return refuse(404, 'Guest not found');
    state.guests = guests.map(guest => (guest.id === op.guestId ? patchGuest(guest, patch) : guest));
    return update('guestsChanged', { guests: state.guests });
  },
  'guest.remove': ({ state }, op) => {
    const guests = state.guests ?? [];
    if (!guests.some(guest => guest.id === op.guestId)) return refuse(404, 'Guest not found');
    state.guests = guests.filter(guest => guest.id !== op.guestId);
    // Its settings go from every scene too.
    for (const scene of state.scenes) {
      if (!scene.guests) continue;
      delete scene.guests[op.guestId];
      if (Object.keys(scene.guests).length === 0) delete scene.guests;
    }
    for (const scene of state.scenes) {
      if (!scene.guestMix) continue;
      delete scene.guestMix[op.guestId];
      if (Object.keys(scene.guestMix).length === 0) delete scene.guestMix;
    }
    return update('guestsChanged', { guests: state.guests });
  },
  // The pattern written becomes the lane's open one. The id is the operation's own: the route
  // took it from the path, then from the body, then made one. An id that is not text, or is
  // empty, is no pattern's, and is refused by the same check that refuses steps that are no list.
  'pattern.write': ({ state }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    const id = op.patternId;
    const previous = synth.patterns.find(p => p.id === id);
    const pattern = sanitizePattern({ ...previous, ...patch, id, steps: patch.steps || previous?.steps || synth.pattern.steps }, state.tempo, openSignature(state));
    if (!pattern) return refuse(400, 'Invalid sequence pattern');
    synth.patterns = [...synth.patterns.filter(p => p.id !== id), pattern];
    synth.pattern = pattern;
    return { ok: true, value: pattern, save: true, event: { type: previous ? 'patternUpdated' : 'patternCreated', data: { synthId: synth.synthId, pattern } } };
  },
  // Checked with `typeof`, which takes what JSON would have dropped or nulled as it takes nothing.
  'synth.mix': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    if (typeof op.muted === 'boolean') synth.muted = op.muted;
    if (typeof op.solo === 'boolean') synth.solo = op.solo;
    return update('synthMix', { synthId: synth.synthId, muted: synth.muted, solo: synth.solo });
  },
  // The preset last loaded on the lane, kept only while there is one. Empty takes it away.
  'synth.preset': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    const preset = storedPresetName(op.preset);
    if (preset) synth.preset = preset;
    else delete synth.preset;
    return update('synthPreset', { synthId: synth.synthId, preset: synth.preset ?? '' });
  },
  // Kept only while it has one, so a lane never named is stored as it was. Empty takes the name away.
  'synth.name': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    const name = storedLaneName(op.name);
    if (name) synth.name = name;
    else delete synth.name;
    return update('synthName', { synthId: synth.synthId, name: synth.name ?? '' });
  },
  // Kept only while on, so a lane that never swung is stored as it was.
  'synth.swing': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    if (op.swing === true) synth.swing = true;
    else delete synth.swing;
    return update('synthSwing', { synthId: synth.synthId, swing: synth.swing === true });
  },
  // The model's name is taken when it counts as true, and infinity does where the null JSON made
  // of it does not; `merge` takes a macro that is undefined as a value to set.
  'synth.model': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    const modelId = normalizeSynthModelId(sentValue(op.modelId) || synth.synthModelId);
    // Another model is another sound: the preset that was loaded no longer names it. A preset being
    // loaded sets its model first and its name after, so its name is kept.
    if (modelId !== synth.synthModelId) delete synth.preset;
    synth.synthModelId = modelId;
    synth.synthModelParams = sanitizeModelParams(merge(synth.synthModelParams, sent(op.modelParams) ?? {}));
    return update('synthModelUpdate', { synthId: synth.synthId, modelId: synth.synthModelId, modelParams: synth.synthModelParams });
  },
  // The event names the lane; the answer is the sound alone.
  'synth.params': ({ state, defaults }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    // A whole sound (a preset, Reset, undo) with no inserts means none: they are absent from the
    // defaults, so the merge alone would keep the lane's old ones.
    const whole = WHOLE_SOUND.every(key => key in patch) && !('inserts' in patch);
    synth.synthParams = sanitizeSynthParams(merge(whole ? { ...synth.synthParams, inserts: undefined } : synth.synthParams, patch), defaults.synthParams);
    return { ok: true, value: synth.synthParams, save: true, event: { type: 'synthUpdate', data: { synthId: synth.synthId, parameters: synth.synthParams } } };
  },
  // Saved, and sent to nobody: the octave and the keyboard are this person's view of the lane.
  'synth.prefs': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    synth.octaveShift = Math.round(number(op.octaveShift, synth.octaveShift ?? 0, -2, 2));
    synth.keyboardMode = op.keyboardMode === 'piano-roll' ? 'piano-roll' : op.keyboardMode === 'keyboard' ? 'keyboard' : synth.keyboardMode;
    return { ok: true, value: synth, save: true };
  },
  // No lane named, or one that counts as none (0, and infinity, which JSON made null), is the
  // lowest free number. A lane that is there is answered as it is, and still saved and sent.
  'synth.create': ({ state, defaults }, op) => {
    const id = sentValue(op.synthId) || LANE_IDS.find(id => !state.synths.some(s => s.synthId === id));
    if (!Number.isInteger(id) || (id as number) < 1 || (id as number) > MAX_LANES) return refuse(400, `${MAX_LANES} synths maximum`);
    let synth = state.synths.find(s => s.synthId === id);
    if (!synth) { synth = newLane(id as number, state.tempo, defaults, openSignature(state)); state.synths.push(synth); }
    return update('synthCreated', synth);
  },
  // The lane is looked for first, so a lane that is not there is a 404 even for lane 1.
  'synth.remove': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    if (synth.synthId === 1) return refuse(400, 'Synth 1 cannot be removed');
    state.synths = state.synths.filter(s => s !== synth);
    return update('synthRemoved', { synthId: synth.synthId });
  },
  // A pattern id is compared with the lane's own ids and is truthy or not: nothing to guard.
  'transport.play': transport(true),
  'transport.stop': transport(false),
  // The scene operations. Each saves and sends the whole scene message, as its route did.
  'scene.select': ({ state }, op) => {
    const target = state.scenes.find(scene => scene.id === op.sceneId);
    if (!target) return refuse(404, 'Scene not found');
    if (target.id !== state.currentSceneId) {
      commitScene(state);
      applyScene(state, target);
    }
    return sceneChanged(state);
  },
  // The route made the new scene's id itself, so a missing, empty or taken one could not happen
  // there. They are refused after the check on how many scenes there are, which came first.
  'scene.create': ({ state }, op) => {
    if (state.scenes.length >= MAX_SCENES) return refuse(400, `A project can hold ${MAX_SCENES} scenes`);
    if (typeof op.sceneId !== 'string' || !op.sceneId || op.sceneId.length > 200) return refuse(400, 'That is not an id a scene can have.');
    if (state.scenes.some(scene => scene.id === op.sceneId)) return refuse(409, 'That scene is already in the project.');
    commitScene(state);
    const name = (typeof op.name === 'string' && op.name.trim() ? op.name.trim() : `Scene ${state.scenes.length + 1}`).slice(0, 40);
    // A new scene is in the time signature of the one it was made from.
    const scene = captureScene(state, op.sceneId, name, nextSceneColor(state.scenes), openSignature(state));
    if (op.empty === true) {
      for (const id of Object.keys(scene.lanes)) scene.lanes[Number(id)] = emptySteps(scene.lanes[Number(id)].length);
      delete scene.laneAutomation;
      // An empty scene keeps the lengths of the one it was made from.
      for (const instrument of DRUM_INSTRUMENTS) scene.drums[instrument] = { steps: Array(scene.drums[instrument].steps.length).fill(false) };
    }
    const index = state.scenes.findIndex(entry => entry.id === state.currentSceneId);
    state.scenes.splice(index + 1, 0, scene);
    applyScene(state, scene);
    return sceneChanged(state);
  },
  // A scene that is not there is a 400 about the name, as the route answered.
  'scene.rename': ({ state }, op) => {
    const target = state.scenes.find(scene => scene.id === op.sceneId);
    const name = typeof op.name === 'string' ? op.name.trim().slice(0, 40) : '';
    if (!target || !name) return refuse(400, 'A scene needs a name');
    target.name = name;
    return sceneChanged(state);
  },
  // No colour, or one that is not in the list, takes the scene's colour away.
  'scene.color': ({ state }, op) => {
    const target = state.scenes.find(scene => scene.id === op.sceneId);
    if (!target) return refuse(400, 'That scene is not in the project.');
    const color = sceneColor(op.color);
    if (color) target.color = color; else delete target.color;
    return sceneChanged(state);
  },
  // The open scene's part goes into the other scene, in place of what that scene had for it. A
  // lane brings its own length. A drum row is laid along the other scene's grid, which may be
  // longer or shorter, going round again or stopping short. Where the two scenes' bars are of
  // different lengths a lane keeps how many bars it has and is laid along them the same way.
  'scene.copyPart': ({ state }, op) => {
    commitScene(state);
    const from = state.scenes.find(scene => scene.id === state.currentSceneId);
    const to = state.scenes.find(scene => scene.id === op.toSceneId);
    if (!from || !to || from === to) return refuse(400, 'Choose another scene to copy to.');
    if (typeof op.synthId === 'number') {
      const steps = from.lanes[op.synthId];
      if (!steps) return refuse(404, NO_SYNTH);
      const fromBar = barSteps(from.signature), toBar = barSteps(to.signature);
      const laneLength = laneBars(steps.length, from.laneBars?.[op.synthId], from.signature);
      const fine = steps.length / laneLength === fromBar * 2 ? 2 : 1;
      to.lanes[op.synthId] = fromBar === toBar ? structuredClone(steps) : clampLengths(layAlong(structuredClone(steps), laneLength * toBar * fine));
      const bars = from.laneBars?.[op.synthId];
      if (bars && bars > 1) to.laneBars = { ...to.laneBars, [op.synthId]: bars };
      else if (to.laneBars) delete to.laneBars[op.synthId];
      // The lane's automation goes with its notes, laid along the same length, in place of what was there.
      const automation = layAutomationAlong(from.laneAutomation?.[op.synthId], to.lanes[op.synthId].length);
      if (automation) to.laneAutomation = { ...to.laneAutomation, [op.synthId]: structuredClone(automation) };
      else if (to.laneAutomation) { delete to.laneAutomation[op.synthId]; if (Object.keys(to.laneAutomation).length === 0) delete to.laneAutomation; }
    } else if (typeof op.drum === 'string' && from.drums[op.drum] && to.drums[op.drum]) {
      const row = from.drums[op.drum], length = to.drums[op.drum].steps.length;
      const along = <T,>(values: T[] | undefined) => (values?.length ? Array.from({ length }, (_, step) => values[step % values.length]) : undefined);
      const velocities = along(row.stepVelocities), probabilities = along(row.stepProbabilities), ratchets = along(row.stepRatchets);
      to.drums[op.drum] = {
        steps: along(row.steps) ?? Array(length).fill(false),
        ...(velocities ? { stepVelocities: velocities } : {}), ...(probabilities ? { stepProbabilities: probabilities } : {}), ...(ratchets ? { stepRatchets: ratchets } : {}),
      };
    } else return refuse(400, 'Choose a lane or a drum to copy.');
    return sceneChanged(state);
  },
  'scene.delete': ({ state }, op) => {
    const index = state.scenes.findIndex(scene => scene.id === op.sceneId);
    if (index < 0) return refuse(404, 'Scene not found');
    if (state.scenes.length === 1) return refuse(400, 'A project needs at least one scene');
    commitScene(state);
    state.scenes.splice(index, 1);
    if (op.sceneId === state.currentSceneId) applyScene(state, state.scenes[Math.max(0, index - 1)]);
    state.song = sanitizeSong({ ...state.song, entries: state.song.entries.filter(entry => entry.sceneId !== op.sceneId) }, state.scenes);
    return sceneChanged(state);
  },
  // Used when a saved arrangement is loaded: the lanes and drums have already been set to its
  // current scene, so that scene is taken from the live pattern. The scenes and the song are read
  // through `sent`, as the body was. With none usable, a new scene gets an id made here, so this
  // operation is not repeatable (as synth.create is not).
  'scene.replace': ({ state, defaults }, op) => {
    const body = sent({ scenes: op.scenes, currentSceneId: op.currentSceneId, song: op.song });
    if (!body) return refuse(400, BAD_DATA);
    const scenes = sanitizeScenes(body.scenes, defaults.drumState);
    state.scenes = scenes ?? [];
    state.currentSceneId = scenes?.some(scene => scene.id === body.currentSceneId) ? body.currentSceneId : scenes?.[0].id ?? '';
    state.song = scenes ? sanitizeSong(body.song, scenes) : { entries: [], loop: false };
    ensureScenes(state);
    // The live lanes and drums are held to the bar length of the scene they now are.
    const signature = openSignature(state);
    if (signature) {
      for (const synth of state.synths) synth.pattern = sanitizePattern(synth.pattern, state.tempo, signature) ?? synth.pattern;
      state.drumState = sanitizeDrums(state.drumState, defaults.drumState, signature);
    }
    return sceneChanged(state);
  },
  // The open scene's time signature. Every lane and the drum grid keep how many bars they have
  // and each bar becomes the new length: a shorter bar loses the steps at its end, a longer one
  // gains empty steps there. Nothing is repeated.
  'scene.signature': ({ state, defaults }, op) => {
    const scene = state.scenes.find(entry => entry.id === state.currentSceneId);
    if (!scene) return refuse(404, 'Scene not found');
    const signature = TIME_SIGNATURES.find(choice => choice === op.signature);
    if (!signature) return refuse(400, `A scene is in ${TIME_SIGNATURES.join(', ')}`);
    const from = barSteps(scene.signature), to = barSteps(signature);
    for (const synth of state.synths) {
      const perBar = stepsPerBar(synth.pattern.steps.length, synth.pattern.bars, scene.signature);
      synth.pattern.steps = clampLengths(resizeEachBar(synth.pattern.steps, perBar, perBar > from ? to * 2 : to, () => ({ active: false, velocity: .7 })));
      const automation = resizeAutomationEachBar(synth.pattern.automation, perBar, perBar > from ? to * 2 : to);
      if (automation) synth.pattern.automation = automation; else delete synth.pattern.automation;
    }
    for (const instrument of DRUM_INSTRUMENTS) {
      const lane = state.drumState[instrument];
      lane.steps = resizeEachBar(lane.steps, from, to, () => false);
      for (const [key, blank] of DRUM_DETAILS) if (lane[key]) lane[key] = resizeEachBar(lane[key]!, from, to, () => blank);
    }
    if (storedSignature(signature)) scene.signature = signature; else delete scene.signature;
    state.drumState = sanitizeDrums(state.drumState, defaults.drumState, signature);
    return sceneChanged(state);
  },
  // Each of entries and loop is kept when it is not sent (undefined and null alike).
  'song.set': ({ state }, op) => {
    const body = sent({ entries: op.entries, loop: op.loop });
    if (!body) return refuse(400, BAD_DATA);
    state.song = sanitizeSong({ entries: body.entries ?? state.song.entries, loop: body.loop ?? state.song.loop }, state.scenes);
    return sceneChanged(state);
  },
  'tempo.set': ({ state }, op) => {
    const { tempo } = op;
    if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400) return refuse(400, 'Invalid tempo');
    state.tempo = tempo;
    state.synths.forEach(s => { s.pattern.tempo = tempo; s.patterns.forEach(p => { p.tempo = tempo; }); });
    return update('tempoChange', { tempo: state.tempo });
  },
};
