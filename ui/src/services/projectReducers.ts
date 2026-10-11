// What each operation does to the project. A reducer is the body of the route it replaces,
// moved as it was. It changes the state it is handed and says what to save and send; it never
// emits, saves or reads the clock itself, which is `apply`'s work in localService.ts.
import { clone, merge, number, sanitizeDrums, sanitizeEffects, sanitizeModelParams, sanitizePattern, sanitizeSends, sanitizeSynthParams } from './projectSanitization';
import { MAX_GUESTS, guestUrl, patchGuest, sanitizeGuests } from './guests';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { BAR_CHOICES, DRUM_STEPS_PER_BAR, resizeBars } from './patternLength';
import { normalizeSynthModelId } from '../synthModels';
import type { DrumState, Pattern } from '../types';
import type { ProjectDefaults, ProjectLane, ProjectState } from './localService';
import type { Operation, OpResult, OpType, Outcome, Rejected } from './projectOps';

// `origin` is this machine's own address, which a guest may not be loaded from.
export interface ReducerContext { state: ProjectState; defaults: ProjectDefaults; origin: string | undefined }
type Reducers = { [K in OpType]: (ctx: ReducerContext, op: Extract<Operation, { type: K }>) => Outcome<OpResult<K>> };

// What `update(type, data)` was in the router: save, send the event, answer with the same data.
const update = <V>(type: string, data: V): Outcome<V> => ({ ok: true, value: data, save: true, event: { type, data } });
// What `respond({ error }, status)` was. A reducer refuses before it changes anything.
const refuse = (status: Rejected['status'], error: string): Rejected => ({ ok: false, status, error });
const BAD_DATA = 'Invalid local operation data';
const NO_SYNTH = 'Synth not found';
const BAD_ADDRESS = 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.';

// An object in an operation, as a route's body used to arrive: after a trip through JSON, which
// leaves out what is undefined, turns NaN and infinity into null, and hands the reducer a copy
// that is nobody else's. Null for anything that is not an object, which `request` answers with
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

// The router found the lane from a number in the path; an operation can name anything.
const laneOf = (state: ProjectState, synthId: unknown) => state.synths.find(s => s.synthId === synthId);

type DrumLane = DrumState[keyof DrumState];
// The six edits to one drum lane, as the router made them: find the lane, change it, put the
// whole drum state through the checks, and send all of it.
// An instrument named after a property every object has (`constructor`, `toString`,
// `__proto__`) finds that property instead of a lane, as it did in the router: a step edit or a
// change of settings then throws, and a sample or a mute is written onto the property itself.
// storeRoutes.test.ts pins the throw; the last pull request of the plan is where it is put right.
const drumLaneEdit = ({ state, defaults }: ReducerContext, instrument: unknown, edit: (track: DrumLane) => Rejected | void): Outcome<{ drumState: DrumState }> => {
  const track = state.drumState[instrument as keyof DrumState];
  if (!track) return refuse(404, 'Unknown local operation');
  const refused = edit(track);
  if (refused) return refused;
  state.drumState = sanitizeDrums(state.drumState, defaults.drumState);
  return update('drumFullState', { drumState: state.drumState });
};
const badDrumStep = (track: DrumLane, step: number) =>
  (!Number.isInteger(step) || step < 0 || step >= track.steps.length ? refuse(400, 'Invalid drum step') : undefined);

// A lane as the store first makes it: one blank pattern of sixteen steps, the default sound, and
// the project's tempo. The pattern's id is made here, not carried by the operation.
export const newLane = (synthId: number, tempo: number, defaults: ProjectDefaults): ProjectLane => {
  const pattern: Pattern = {
    id: crypto.randomUUID(), name: `Synth ${synthId}`, tempo,
    steps: Array.from({ length: 16 }, () => ({ active: false, velocity: .7 })),
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

// Partial until every route has moved; `apply` refuses an operation that has no reducer yet.
export const reducers: Partial<Reducers> = {
  'drum.bars': ({ state, defaults }, op) => {
    const bars = BAR_CHOICES.find(choice => choice === op.bars);
    if (!bars) return refuse(400, 'A drum pattern is 1, 2, 4 or 8 bars long');
    for (const instrument of DRUM_INSTRUMENTS) {
      const lane = state.drumState[instrument];
      lane.steps = resizeBars(lane.steps, DRUM_STEPS_PER_BAR, bars, () => false);
      if (lane.stepVelocities) lane.stepVelocities = resizeBars(lane.stepVelocities, DRUM_STEPS_PER_BAR, bars, () => 1);
      if (lane.stepProbabilities) lane.stepProbabilities = resizeBars(lane.stepProbabilities, DRUM_STEPS_PER_BAR, bars, () => 1);
      if (lane.stepRatchets) lane.stepRatchets = resizeBars(lane.stepRatchets, DRUM_STEPS_PER_BAR, bars, () => 1);
    }
    state.drumState = sanitizeDrums(state.drumState, defaults.drumState);
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
  'drum.reset': ({ state, defaults }) => {
    state.drumState = clone(defaults.drumState);
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
    state.drumState = sanitizeDrums(op.state, defaults.drumState);
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
    const pattern = sanitizePattern({ ...previous, ...patch, id, steps: patch.steps || previous?.steps || synth.pattern.steps }, state.tempo);
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
  // The model's name is taken when it counts as true, and infinity does where the null JSON made
  // of it does not; `merge` takes a macro that is undefined as a value to set.
  'synth.model': ({ state }, op) => {
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    synth.synthModelId = normalizeSynthModelId(sentValue(op.modelId) || synth.synthModelId);
    synth.synthModelParams = sanitizeModelParams(merge(synth.synthModelParams, sent(op.modelParams) ?? {}));
    return update('synthModelUpdate', { synthId: synth.synthId, modelId: synth.synthModelId, modelParams: synth.synthModelParams });
  },
  // The event names the lane; the answer is the sound alone.
  'synth.params': ({ state, defaults }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const synth = laneOf(state, op.synthId);
    if (!synth) return refuse(404, NO_SYNTH);
    synth.synthParams = sanitizeSynthParams(merge(synth.synthParams, patch), defaults.synthParams);
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
    const id = sentValue(op.synthId) || [1, 2, 3].find(id => !state.synths.some(s => s.synthId === id));
    if (!Number.isInteger(id) || (id as number) < 1 || (id as number) > 3) return refuse(400, 'Three synths maximum');
    let synth = state.synths.find(s => s.synthId === id);
    if (!synth) { synth = newLane(id as number, state.tempo, defaults); state.synths.push(synth); }
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
  'tempo.set': ({ state }, op) => {
    const { tempo } = op;
    if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400) return refuse(400, 'Invalid tempo');
    state.tempo = tempo;
    state.synths.forEach(s => { s.pattern.tempo = tempo; s.patterns.forEach(p => { p.tempo = tempo; }); });
    return update('tempoChange', { tempo: state.tempo });
  },
};
