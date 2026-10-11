// The typed way into the project store: `apply(op)`, the typed helpers over it, the read methods
// and `subscribeOps`. While `request` still exists, each moved route is run both ways on two
// fresh stores, and the two must agree on everything: the answer, the events, whether a save
// was scheduled, and the project left behind. storeRoutes.test.ts pins what the routes do; this
// file pins that the typed way does the same. Each pull request of docs/TYPED_STORE_PLAN.md
// adds its group to `cases`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { OP_META, type Applied, type OpNotice, type Operation } from '../src/services/projectOps.ts';
import { reducers } from '../src/services/projectReducers.ts';
import { merge } from '../src/services/projectSanitization.ts';
import { MAX_GUESTS } from '../src/services/guests.ts';
import { DRUM_INSTRUMENTS, DRUM_KITS } from '../src/services/drumKits.ts';
import type { DrumInstrument, DrumState } from '../src/types.ts';
import { applied, call, comparable, defaults, setup, storage, type Message } from './helpers/store.ts';

const STORAGE_KEY = 'discobot_browser_project_v1';
// A value of the wrong type, as an untyped caller or a replayed operation could send.
const wrong = (value: unknown) => value as never;

// Either way of making an edit, run on a store of its own. An accepted case names what both
// answer and emit; a refused one names the status and the error, and both must then have
// emitted nothing, saved nothing and left the project as it was. Ids the stores make differ
// between the two, so an answer is written with each id as its place among them: 'id-1'.
interface Case {
  op: Operation['type'];
  title: string;
  // Whatever it returns is handed to `path` and `run`: usually an id it made.
  arrange?: (service: LocalProjectService) => any;
  method?: string;
  path: string | ((ctx: any) => string);
  body: unknown;
  run: (service: LocalProjectService, ctx: any) => Applied<unknown>;
  // Accepted: what both ways answer and emit, and the event's name.
  answer?: unknown;
  event?: string;
  // Refused: the status and the error both ways answer with.
  status?: 400 | 404 | 409;
  error?: string;
  check?: (project: any) => void;
}

const swing = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.swing', title, arrange, path: '/drum/swing', body: sent === undefined ? {} : { swing: sent }, run: service => service.setDrumSwing(wrong(sent)), answer: { swing: answer }, event: 'drumSwing', check: project => assert.equal(project.drumSwing, answer) },
];
const volume = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.masterVolume', title, arrange, path: '/drum/master-volume', body: sent === undefined ? {} : { volume: sent }, run: service => service.setDrumMasterVolume(wrong(sent)), answer: { volume: answer }, event: 'drumMasterVolume', check: project => assert.equal(project.drumMasterVolume, answer) },
];
const swingSet = (service: LocalProjectService) => { service.setDrumSwing(.4); };
const volumeSet = (service: LocalProjectService) => { service.setDrumMasterVolume(.6); };

const GUEST_URL = 'https://guest.example/synth';
const NO_GUEST = '00000000-0000-4000-8000-000000000000';
const BAD_ADDRESS = 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.';
const FULL = `A project can hold ${MAX_GUESTS} guest instruments.`;
// A guest as the store keeps a new one, with its id as its place among the ids.
const kept = (place: number, rest: object = {}) => ({ id: `id-${place}`, url: GUEST_URL, name: 'guest.example', volume: .8, muted: false, ...rest });
const addGuest = (service: LocalProjectService, url = GUEST_URL) => {
  const result = service.addGuest(url);
  assert.ok(result.ok);
  return result.value.guests.at(-1)!.id;
};
const fill = (service: LocalProjectService) => { for (let count = 0; count < MAX_GUESTS; count++) addGuest(service, `https://guest${count}.example/`); };
// A guest with everything set that a change can set.
const dressed = (service: LocalProjectService) => {
  const id = addGuest(service);
  assert.ok(service.changeGuest(id, { name: 'Choir', volume: .5, muted: true, sends: { reverb: .5, delay: 0, drive: 0, phaser: 0 }, state: { a: 1 } }).ok);
  return id;
};
const DRESSED = { name: 'Choir', volume: .5, muted: true, sends: { reverb: .5, delay: 0, drive: 0, phaser: 0, chorus: 0 }, state: { a: 1 } };
type Outcome = { answer: unknown } | { status: 400 | 404 | 409; error: string };
const outcome = (result: Outcome) => ('answer' in result ? { answer: result.answer, event: 'guestsChanged' } : result);
// In a route's body JSON has already left out what is undefined; `body` is what is sent to both.
const guestAdd = (title: string, body: { url?: unknown; name?: unknown }, result: Outcome, arrange?: Case['arrange']): Case => ({
  op: 'guest.add', title, arrange, path: '/guests', body, run: service => service.addGuest(wrong(body.url), wrong(body.name)), ...outcome(result),
});
const guestChange = (title: string, patch: unknown, result: Outcome, arrange: Case['arrange'] = dressed): Case => ({
  op: 'guest.patch', title, arrange, method: 'PUT', path: id => `/guests/${id}`, body: patch, run: (service, id) => service.changeGuest(id, wrong(patch)), ...outcome(result),
});
const guestRemove = (title: string, result: Outcome, arrange: Case['arrange'], check?: Case['check']): Case => ({
  op: 'guest.remove', title, arrange, method: 'DELETE', path: (ctx: any) => `/guests/${ctx.id ?? ctx}`, body: {}, run: (service, ctx) => service.removeGuest(ctx.id ?? ctx), ...outcome(result), check,
});

// An id a sample can have that `comparable` does not take for one of the store's own.
const SAMPLE = 'a'.repeat(36);
const NO_STEP = 'Invalid drum step', NO_LANE = 'Unknown local operation', NO_BARS = 'A drum pattern is 1, 2, 4 or 8 bars long';
const LANE_SETTINGS = { volume: .5, tone: .5, extra: .5, tune: 0, humanize: .35, pan: 0 };
type LaneChange = { on?: number[]; settings?: object; [key: string]: unknown };
// The drums as the store keeps them once they have been through its checks: every lane, with
// the steps in `on` switched on and whatever else is named laid over a lane nothing has touched.
const drums = (changes: Partial<Record<DrumInstrument, LaneChange>> = {}, length = 16) => ({
  drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => {
    const { on = [], settings = {}, ...rest } = changes[instrument] ?? {};
    return [instrument, { steps: Array.from({ length }, (_, step) => on.includes(step)), muted: false, solo: false, ...rest, settings: { ...LANE_SETTINGS, ...settings } }];
  })),
});
// A list beside the steps (velocity, chance, repeats): 1 everywhere but where it says.
const beside = (changes: Record<number, number> = {}, length = 16) => Array.from({ length }, (_, step) => changes[step] ?? 1);
const kickOn = (service: LocalProjectService) => { assert.ok(service.setDrumStep('kick', 3, true).ok); };
const kickSoft = (service: LocalProjectService) => { assert.ok(service.setDrumStepVelocity('kick', 3, .5).ok); };
const kickLoud = (service: LocalProjectService) => { assert.ok(service.setDrumSettings('kick', { volume: .9 }).ok); };
const snareMuted = (service: LocalProjectService) => { assert.ok(service.setDrumMix('snare', { muted: true }).ok); };
const clapSampled = (service: LocalProjectService) => { assert.ok(service.setDrumSample('clap', SAMPLE).ok); };
// A kick step with a velocity, a chance and repeats, a setting, a mute and a sample.
const dressedDrums = (service: LocalProjectService) => {
  kickOn(service); kickSoft(service); kickLoud(service); snareMuted(service); clapSampled(service);
  assert.ok(service.setDrumStepDetail('kick', 3, { probability: .25, ratchet: 3 }).ok);
};
const drumsDressed = (changes: Partial<Record<DrumInstrument, LaneChange>> = {}, length = 16, at = [3]) => drums({
  kick: {
    on: at, settings: { volume: .9 }, stepVelocities: beside(Object.fromEntries(at.map(step => [step, .5])), length),
    stepProbabilities: beside(Object.fromEntries(at.map(step => [step, .25])), length), stepRatchets: beside(Object.fromEntries(at.map(step => [step, 3])), length),
    ...changes.kick,
  },
  snare: { muted: true, ...changes.snare }, clap: { sampleId: SAMPLE },
}, length);
type DrumOutcome = { answer: unknown; event?: string } | { status: 400 | 404 | 409; error: string };
// `body` is sent to the route, where JSON leaves out what is undefined and turns a number that
// is not finite into null; the helper is handed the same values as they are.
const drumCase = (op: Case['op'], path: string, run: (service: LocalProjectService, body: any) => Applied<unknown>, method?: string) =>
  (title: string, body: Record<string, unknown>, result: DrumOutcome, arrange?: Case['arrange']): Case => ({
    op, title, arrange, method, path, body, run: service => run(service, body), ...('answer' in result ? { event: 'drumFullState', ...result } : result),
  });
const drumStep = drumCase('drum.step', '/drum/step', (service, body) => service.setDrumStep(body.instrument, body.step, body.active));
const drumVelocity = drumCase('drum.stepVelocity', '/drum/step-velocity', (service, body) => service.setDrumStepVelocity(body.instrument, body.step, body.velocity));
const drumDetail = drumCase('drum.stepDetail', '/drum/step-detail', (service, body) => service.setDrumStepDetail(body.instrument, body.step, { probability: body.probability, ratchet: body.ratchet }));
const drumSettings = drumCase('drum.settings', '/drum/settings', (service, body) => service.setDrumSettings(body.instrument, body.settings));
const drumSample = drumCase('drum.sample', '/drum/sample', (service, body) => service.setDrumSample(body.instrument, body.sampleId));
const drumMix = drumCase('drum.mix', '/drum/mix', (service, body) => service.setDrumMix(body.instrument, { muted: body.muted, solo: body.solo }));
const drumBars = drumCase('drum.bars', '/drum/bars', (service, body) => service.setDrumBars(body.bars));
const drumReset = drumCase('drum.reset', '/drum/reset', service => service.resetDrums());
const drumWhole = drumCase('drum.state', '/drum/state', (service, body) => service.setDrumState(body.state), 'PUT');
const drumKit = drumCase('drum.kit', '/drum/kit', (service, body) => service.setDrumKit(body.kitId, body.applyDefaults));
const KIT = DRUM_KITS.find(entry => entry.id === 'tr-808')!;
// Every lane with the kit's settings laid over it, which is all of a lane's settings.
const kitted = (changes: Partial<Record<DrumInstrument, LaneChange>> = {}) => ({
  selectedDrumKitId: KIT.id,
  drumState: drums(Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { ...changes[instrument], settings: KIT.instrumentDefaults[instrument] }]))).drumState,
});
const kickPanned = (service: LocalProjectService) => { kickOn(service); assert.ok(service.setDrumSettings('kick', { pan: -.5 }).ok); };
const twoBars = (service: LocalProjectService) => { assert.ok(service.setDrumBars(2).ok); };
const notNumbers: Array<[string, unknown]> = [['nothing', undefined], ['text', 'lots'], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['null', null]];
const notSteps: Array<[string, unknown]> = [['one past the end', 16], ['below zero', -1], ['a fraction', 1.5], ['text', '3'], ['missing', undefined], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY]];
const notLanes: Array<[string, unknown]> = [['that does not exist', 'cowbell'], ['that is missing', undefined], ['that is not a number at all', Number.NaN]];

const drumCases: Case[] = [
  drumStep('a step is switched on, and every lane is answered', { instrument: 'kick', step: 3, active: true }, { answer: drums({ kick: { on: [3] } }) }),
  drumStep('a step is switched off', { instrument: 'kick', step: 3, active: false }, { answer: drums() }, kickOn),
  drumStep('the last step can be set', { instrument: 'crash', step: 15, active: true }, { answer: drums({ crash: { on: [15] } }) }),
  drumStep('a longer pattern has more steps to set', { instrument: 'kick', step: 20, active: true }, { answer: drums({ kick: { on: [20] } }, 32) }, twoBars),
  drumStep('anything that counts as true switches a step on', { instrument: 'kick', step: 3, active: 'yes' }, { answer: drums({ kick: { on: [3] } }) }),
  drumStep('no word either way switches a step off', { instrument: 'kick', step: 3, active: undefined }, { answer: drums() }, kickOn),
  drumStep('what is not a number at all arrives as null, and switches a step off', { instrument: 'kick', step: 3, active: Number.NaN }, { answer: drums() }, kickOn),
  drumStep('infinity arrives as null too, and switches a step off', { instrument: 'kick', step: 3, active: Number.POSITIVE_INFINITY }, { answer: drums() }, kickOn),
  ...notSteps.map(([what, step]) => drumStep(`a step that is ${what} is refused`, { instrument: 'kick', step, active: true }, { status: 400, error: NO_STEP }, kickOn)),
  drumStep('step 16 of a one-bar pattern is refused though a longer one has it', { instrument: 'kick', step: 16, active: true }, { status: 400, error: NO_STEP }),
  ...notLanes.map(([what, instrument]) => drumStep(`an instrument ${what} is refused`, { instrument, step: 3, active: true }, { status: 404, error: NO_LANE })),
  drumStep('an instrument that does not exist is a 404 even when the step is bad too', { instrument: 'cowbell', step: 99, active: true }, { status: 404, error: NO_LANE }),

  drumVelocity('a velocity is kept beside the steps, whether or not the step is on', { instrument: 'kick', step: 3, velocity: .5 }, { answer: drums({ kick: { stepVelocities: beside({ 3: .5 }) } }) }),
  drumVelocity('a velocity past the top is held at 1', { instrument: 'kick', step: 3, velocity: 3 }, { answer: drums({ kick: { stepVelocities: beside() } }) }, kickSoft),
  drumVelocity('a velocity below zero is held at 0', { instrument: 'kick', step: 3, velocity: -1 }, { answer: drums({ kick: { stepVelocities: beside({ 3: 0 }) } }) }),
  ...notNumbers.map(([what, velocity]) => drumVelocity(`a velocity that is ${what} is full`, { instrument: 'kick', step: 3, velocity }, { answer: drums({ kick: { stepVelocities: beside() } }) }, kickSoft)),
  drumVelocity('a velocity for a step that is not there is refused', { instrument: 'kick', step: 16, velocity: .5 }, { status: 400, error: NO_STEP }),
  drumVelocity('a velocity for an instrument that does not exist is refused', { instrument: 'cowbell', step: 3, velocity: .5 }, { status: 404, error: NO_LANE }),

  drumDetail('a chance is kept beside the steps', { instrument: 'kick', step: 3, probability: .25 }, { answer: drums({ kick: { stepProbabilities: beside({ 3: .25 }) } }) }),
  drumDetail('repeats are kept beside the steps', { instrument: 'kick', step: 3, ratchet: 3 }, { answer: drums({ kick: { stepRatchets: beside({ 3: 3 }) } }) }),
  drumDetail('a chance and repeats can be set together, each held to its range', { instrument: 'kick', step: 3, probability: 2, ratchet: 9 },
    { answer: drums({ kick: { stepProbabilities: beside(), stepRatchets: beside({ 3: 4 }) } }) }),
  drumDetail('repeats are a whole number, and at least one', { instrument: 'kick', step: 3, probability: -1, ratchet: 2.4 }, { answer: drums({ kick: { stepProbabilities: beside({ 3: 0 }), stepRatchets: beside({ 3: 2 }) } }) }),
  drumDetail('no chance and no repeats changes nothing, and still emits and saves', { instrument: 'kick', step: 3 }, { answer: drums({ kick: { on: [3] } }) }, kickOn),
  drumDetail('what is undefined is not sent: the other is still set', { instrument: 'kick', step: 3, probability: undefined, ratchet: 2 }, { answer: drums({ kick: { stepRatchets: beside({ 3: 2 }) } }) }),
  drumDetail('what is not finite arrives as null, which is sent: each goes back to 1', { instrument: 'kick', step: 3, probability: Number.NaN, ratchet: Number.POSITIVE_INFINITY }, { answer: drumsDressed({ kick: { stepProbabilities: beside(), stepRatchets: beside() } }) }, dressedDrums),
  drumDetail('null and text are sent too', { instrument: 'kick', step: 3, probability: null, ratchet: 'twice' }, { answer: drums({ kick: { stepProbabilities: beside(), stepRatchets: beside() } }) }),
  drumDetail('a chance for a step that is not there is refused', { instrument: 'kick', step: -1, probability: .5 }, { status: 400, error: NO_STEP }),
  drumDetail('a chance for an instrument that does not exist is refused', { instrument: 'cowbell', step: 3, probability: .5 }, { status: 404, error: NO_LANE }),

  drumSettings('settings are laid over the lane\'s own', { instrument: 'kick', settings: { volume: .9, pan: -.5 } }, { answer: drums({ kick: { settings: { volume: .9, pan: -.5 } } }) }),
  drumSettings('each setting is held to its range, and one that is not a setting is dropped', { instrument: 'kick', settings: { volume: 7, tone: -1, tune: -3, bogus: 1 } },
    { answer: drums({ kick: { settings: { volume: 1, tone: 0, tune: -1 } } }) }),
  drumSettings('the cymbal can be made a ride', { instrument: 'crash', settings: { cymbalType: 'ride' } }, { answer: drums({ crash: { settings: { cymbalType: 'ride' } } }) }),
  drumSettings('a cymbal type that is not one takes the type off', { instrument: 'crash', settings: { cymbalType: 'gong' } }, { answer: drums() }, service => { assert.ok(service.setDrumSettings('crash', { cymbalType: 'ride' }).ok); }),
  drumSettings('a setting that is undefined is not a change: JSON never sent it', { instrument: 'kick', settings: { volume: undefined, tone: .2 } }, { answer: drums({ kick: { settings: { volume: .9, tone: .2 } } }) }, kickLoud),
  drumSettings('a setting that is not finite arrives as null, and goes back to where a new project has it', { instrument: 'kick', settings: { volume: Number.NaN, tone: Number.POSITIVE_INFINITY } }, { answer: drums() }, kickLoud),
  ...([['text', 'loud'], ['missing', undefined], ['null', null], ['a list', [{ volume: 1 }]], ['not a number at all', Number.NaN]] as const).map(([what, settings]) =>
    drumSettings(`settings that are ${what} change nothing, and still emit and save`, { instrument: 'kick', settings }, { answer: drums({ kick: { settings: { volume: .9 } } }) }, kickLoud)),
  drumSettings('settings for an instrument that does not exist are refused', { instrument: 'cowbell', settings: { volume: 1 } }, { status: 404, error: NO_LANE }),

  drumSample('a lane is given a sample', { instrument: 'clap', sampleId: SAMPLE }, { answer: drums({ clap: { sampleId: SAMPLE } }) }),
  drumSample('an id no sample can have is not kept', { instrument: 'clap', sampleId: 'clap.wav' }, { answer: drums() }, clapSampled),
  ...([['no id', undefined], ['null', null], ['a number', 7], ['not a number at all', Number.NaN]] as const).map(([what, sampleId]) =>
    drumSample(`${what} takes the sample off the lane`, { instrument: 'clap', sampleId }, { answer: drums() }, clapSampled)),
  drumSample('only the lane named loses its sample', { instrument: 'kick', sampleId: undefined }, { answer: drums({ clap: { sampleId: SAMPLE } }) }, clapSampled),
  drumSample('a sample for an instrument that does not exist is refused', { instrument: 'cowbell', sampleId: SAMPLE }, { status: 404, error: NO_LANE }),

  drumMix('a lane is muted', { instrument: 'snare', muted: true }, { answer: drums({ snare: { muted: true } }) }),
  drumMix('a lane is soloed', { instrument: 'snare', solo: true }, { answer: drums({ snare: { solo: true } }) }),
  drumMix('mute and solo can change together', { instrument: 'snare', muted: false, solo: true }, { answer: drums({ snare: { solo: true } }) }, snareMuted),
  drumMix('a mute that is not said leaves it as it was', { instrument: 'snare', muted: undefined, solo: undefined }, { answer: drums({ snare: { muted: true } }) }, snareMuted),
  drumMix('only true and false are a mute or a solo', { instrument: 'snare', muted: 0, solo: 'yes' }, { answer: drums({ snare: { muted: true } }) }, snareMuted),
  drumMix('what is not a number at all is neither', { instrument: 'snare', muted: Number.NaN, solo: Number.POSITIVE_INFINITY }, { answer: drums({ snare: { muted: true } }) }, snareMuted),
  drumMix('a mute for an instrument that does not exist is refused', { instrument: 'cowbell', muted: true }, { status: 404, error: NO_LANE }),

  drumReset('the drums go back to what a new project has: steps, settings, mutes, samples and length', {}, { answer: { drumState: defaults().drumState } }, service => { dressedDrums(service); twoBars(service); }),
  drumReset('drums that are already new are answered the same, and it still emits and saves', {}, { answer: { drumState: defaults().drumState } }),

  drumWhole('a whole drum state is checked: lengths from the kick, each value held to its range, unknown lanes dropped', {
    state: {
      kick: {
        steps: Array.from({ length: 32 }, (_, step) => step === 20), muted: true, solo: 'yes', sampleId: SAMPLE, settings: { volume: 4, pan: -.5, cymbalType: 'gong' },
        stepVelocities: [.5, 9], stepProbabilities: 'often', stepRatchets: [2.6, 0],
      },
      snare: { steps: [true] }, cowbell: { steps: [true] },
    },
  }, { answer: drums({
    kick: { on: [20], muted: true, sampleId: SAMPLE, settings: { volume: 1, pan: -.5 }, stepVelocities: beside({ 0: .5 }, 32), stepRatchets: beside({ 0: 3 }, 32) },
    snare: { on: [0] },
  }, 32) }, dressedDrums),
  ...([['missing', undefined], ['null', null], ['text', 'drums'], ['a list', [1]], ['empty', {}], ['not a number at all', Number.NaN]] as const).map(([what, state]) =>
    drumWhole(`a drum state that is ${what} leaves every lane as a new project has it`, { state }, { answer: drums() }, dressedDrums)),
  drumWhole('inside a drum state, what is undefined or not finite is read as JSON would have sent it', {
    state: { kick: {
      steps: [true, undefined, Number.NaN, true], muted: undefined, solo: Number.NaN, sampleId: undefined,
      settings: { volume: Number.NaN, tone: undefined, pan: Number.POSITIVE_INFINITY, tune: .5 }, stepVelocities: [Number.NaN, Number.POSITIVE_INFINITY, .5, undefined],
    } },
  }, { answer: drums({ kick: { on: [0, 3], settings: { tune: .5 }, stepVelocities: beside({ 2: .5 }) } }) }, dressedDrums),
  // The route also takes the drum state as the whole body, with no `state` around it.
  {
    op: 'drum.state', title: 'the route reads a body that is the drum state itself as the helper reads its argument', arrange: dressedDrums, method: 'PUT', path: '/drum/state',
    body: { snare: { steps: [false, true], muted: true } }, run: service => service.setDrumState(wrong({ snare: { steps: [false, true], muted: true } })),
    answer: drums({ snare: { on: [1], muted: true } }), event: 'drumFullState',
  },

  drumBars('a longer pattern repeats what was there: steps, velocity, chance and repeats together', { bars: 2 }, { answer: drumsDressed({}, 32, [3, 19]) }, dressedDrums),
  drumBars('a shorter pattern keeps the first bars and loses the rest', { bars: 1 }, { answer: drumsDressed({ snare: { stepVelocities: beside() } }) },
    service => { dressedDrums(service); twoBars(service); assert.ok(service.setDrumStep('snare', 20, true).ok); assert.ok(service.setDrumStepVelocity('snare', 20, .4).ok); }),
  drumBars('eight bars is the longest', { bars: 8 }, { answer: drums({ kick: { on: [3, 19, 35, 51, 67, 83, 99, 115] } }, 128) }, kickOn),
  drumBars('the length it already has changes nothing, and still emits and saves', { bars: 1 }, { answer: drums({ kick: { on: [3] } }) }, kickOn),
  ...([['three', 3], ['none', 0], ['text', '2'], ['missing', undefined], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['a fraction', 1.5]] as const).map(([what, bars]) =>
    drumBars(`a length of bars that is ${what} is refused`, { bars }, { status: 400, error: NO_BARS }, kickOn)),

  drumKit('a kit lays its settings over every lane and keeps the steps', { kitId: KIT.id }, { answer: kitted({ kick: { on: [3] } }), event: 'drumKitChanged' }, kickPanned),
  drumKit('a kit can be chosen without its settings', { kitId: KIT.id, applyDefaults: false }, { answer: { selectedDrumKitId: KIT.id, drumState: drums({ kick: { on: [3], settings: { pan: -.5 } } }).drumState }, event: 'drumKitChanged' }, kickPanned),
  drumKit('chosen without its settings in a new project, the drums are answered as they are kept', { kitId: KIT.id, applyDefaults: false }, { answer: { selectedDrumKitId: KIT.id, drumState: defaults().drumState }, event: 'drumKitChanged' }),
  ...([['undefined', undefined], ['null', null], ['zero', 0], ['text', 'false'], ['not a number at all', Number.NaN]] as const).map(([what, applyDefaults]) =>
    drumKit(`only false leaves the settings alone: ${what} lays them over`, { kitId: KIT.id, applyDefaults }, { answer: kitted({ kick: { on: [3] } }), event: 'drumKitChanged' }, kickPanned)),
  ...([['that does not exist', 'nope'], ['that is missing', undefined], ['that is a number', 7], ['that is not a number at all', Number.NaN]] as const).map(([what, kitId]) =>
    drumKit(`a kit ${what} is refused`, { kitId }, { status: 400, error: 'Unknown kit' }, kickPanned)),
];

// The drum sends and the shared effects are each changed by a patch laid over what is there.
const FX = defaults().drumFx;
const sends = (changes: object = {}, returnLevel = FX.returnLevel) => ({ drumFx: { sends: { ...FX.sends, ...changes }, returnLevel } });
const fxSet = (service: LocalProjectService) => { assert.ok(service.setDrumFx({ sends: { reverb: .9, phaser: .4 }, returnLevel: .4 }).ok); };
const FX_SET = sends({ reverb: .9, phaser: .4 }, .4);
// A new project's effects: the defaults, with a shaped reverb.
const newEffects = () => { const effects: any = defaults().effectsLoop; Object.assign(effects.reverb, { preDelay: .02, damping: .35 }); return effects; };
const effects = (change: (effects: any) => void = () => {}, from: () => any = newEffects) => { const next = from(); change(next); return { effectsLoop: next }; };
const CHORUS = { enabled: true, rate: 2, depth: .3, mix: .4 }, EQ = { enabled: true, low: 3, mid: -2, high: 1 };
// Every part that a project saved before it existed does not have: a synced delay, a chorus, an EQ and a shaped reverb.
const shaped = (service: LocalProjectService) => { assert.ok(service.setEffectsLoop({ delay: { sync: '1/8' }, chorus: CHORUS, eq: EQ, reverb: { preDelay: .1, damping: .5 } }).ok); };
const shapedEffects = () => { const next = newEffects(); next.delay.sync = '1/8'; next.chorus = { ...CHORUS }; next.eq = { ...EQ }; Object.assign(next.reverb, { preDelay: .1, damping: .5 }); return next; };
const wasShaped = (change: (effects: any) => void = () => {}) => effects(change, shapedEffects);
type PatchOutcome = { answer: unknown } | { status: 400 | 404 | 409; error: string };
const patchCase = (op: Case['op'], path: string, event: string, run: (service: LocalProjectService, patch: any) => Applied<unknown>) =>
  (title: string, patch: Record<string, unknown>, result: PatchOutcome, arrange?: Case['arrange']): Case => ({
    op, title, arrange, path, body: patch, run: service => run(service, patch), ...('answer' in result ? { event, ...result } : result),
  });
const drumFx = patchCase('drum.fx', '/drum/fx', 'drumFxUpdate', (service, patch) => service.setDrumFx(patch));
const effectsSet = patchCase('effects.set', '/effects-loop', 'effectsLoopUpdate', (service, patch) => service.setEffectsLoop(patch));
const notObjects: Array<[string, unknown]> = [['text', 'lots'], ['null', null], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['a number', 7]];

const effectCases: Case[] = [
  drumFx('drum sends are laid over what is there and held to 0 to 1; what is not a send is dropped', { sends: { reverb: .9, delay: 7, chorus: .5 }, bogus: 1 }, { answer: sends({ reverb: .9, delay: 1 }) }),
  drumFx('the drum return level is held at 1 and keeps the sends', { returnLevel: 4 }, { answer: sends({ reverb: .9, phaser: .4 }, 1) }, fxSet),
  drumFx('a send and a return level below zero are held at 0', { sends: { drive: -1 }, returnLevel: -2 }, { answer: sends({ drive: 0 }, 0) }),
  drumFx('a change of nothing leaves the sends as they were, and still emits and saves', {}, { answer: FX_SET }, fxSet),
  ...notNumbers.map(([what, returnLevel]) => drumFx(`a return level that is ${what} leaves it as it was`, { returnLevel }, { answer: FX_SET }, fxSet)),
  drumFx('a send that is undefined is not a change: JSON never sent it', { sends: { reverb: undefined, delay: .5 } }, { answer: sends({ reverb: .9, phaser: .4, delay: .5 }, .4) }, fxSet),
  drumFx('sends that are undefined are not a change either', { sends: undefined, returnLevel: .5 }, { answer: sends({ reverb: .9, phaser: .4 }, .5) }, fxSet),
  drumFx('a send that is not a number goes back to where a new project has it', { sends: { reverb: Number.NaN, phaser: 'lots', drive: null, delay: Number.POSITIVE_INFINITY } }, { answer: sends({}, .4) },
    service => { assert.ok(service.setDrumFx({ sends: { reverb: .9, phaser: .4, drive: .8, delay: .6 }, returnLevel: .4 }).ok); }),
  ...[...notObjects, ['a list', [.5, .5]] as [string, unknown]].map(([what, value]) => drumFx(`sends that are ${what} all go back to where a new project has them`, { sends: value }, { answer: sends({}, .4) }, fxSet)),

  effectsSet('an effects change is laid over what is there, then checked', { delay: { feedback: 7, sync: '1/8' }, phaser: { enabled: true }, enabled: 'no', bogus: 1 },
    { answer: effects(next => { next.delay.feedback = .85; next.delay.sync = '1/8'; next.phaser.enabled = true; }) }),
  effectsSet('each value is held to its range', { returns: { synth: 4, drums: -1 }, drive: { amount: 9, tone: -1 }, phaser: { rate: 99, feedback: 1 }, delay: { time: 0, mix: 2 }, reverb: { decay: 99, mix: -1 } },
    { answer: effects(next => { next.returns = { synth: 1, drums: 0 }; Object.assign(next.drive, { amount: 1, tone: 0 }); Object.assign(next.phaser, { rate: 8, feedback: .75 }); Object.assign(next.delay, { time: .01, mix: 1 }); Object.assign(next.reverb, { decay: 8, mix: 0 }); }) }),
  effectsSet('a change of nothing leaves every effect as it was, the later ones too, and still emits and saves', {}, { answer: wasShaped() }, shaped),
  effectsSet('one value of an effect changes only that', { reverb: { mix: .1 } }, { answer: wasShaped(next => { next.reverb.mix = .1; }) }, shaped),
  ...notNumbers.map(([what, value]) => effectsSet(`a value that is ${what} leaves it as it was, or puts back what a new project has`, { drive: { amount: value } }, { answer: wasShaped(next => { next.drive.amount = value === undefined ? .9 : .2; }) },
    service => { shaped(service); assert.ok(service.setEffectsLoop({ drive: { amount: .9 } }).ok); })),
  ...notObjects.map(([what, value]) => effectsSet(`an effect that is ${what} goes back to what a new project has, without what came later`, { delay: value, reverb: value },
    { answer: wasShaped(next => { next.delay = defaults().effectsLoop.delay; next.reverb = defaults().effectsLoop.reverb; }) },
    service => { shaped(service); assert.ok(service.setEffectsLoop({ delay: { time: 1 }, reverb: { decay: 5 } }).ok); })),
  effectsSet('an effect that is undefined is not a change', { delay: undefined, reverb: undefined, chorus: undefined, eq: undefined }, { answer: wasShaped() }, shaped),

  effectsSet('the delay follows the tempo once it is told a note value', { delay: { sync: '1/8d' } }, { answer: effects(next => { next.delay.sync = '1/8d'; }) }),
  effectsSet('a delay told "off" has no sync at all, as in a project saved before there was one', { delay: { sync: 'off' } }, { answer: wasShaped(next => { delete next.delay.sync; }) }, shaped),
  ...([['a note value there is none of', '1/3'], ['null', null], ['not a number at all', Number.NaN], ['a number', 8]] as const).map(([what, sync]) =>
    effectsSet(`a sync that is ${what} takes the sync off`, { delay: { sync } }, { answer: wasShaped(next => { delete next.delay.sync; }) }, shaped)),
  effectsSet('a sync that is undefined is not a change: JSON never sent it', { delay: { sync: undefined, mix: .9 } }, { answer: wasShaped(next => { next.delay.mix = .9; }) }, shaped),
  effectsSet('a delay with no sync stays without one', { delay: { mix: .9 } }, { answer: effects(next => { next.delay.mix = .9; }) }),

  effectsSet('a chorus is added whole from one value, each held to its range', { chorus: { enabled: true, rate: 99 } }, { answer: effects(next => { next.chorus = { enabled: true, rate: 8, depth: .5, mix: .6 }; }) }),
  effectsSet('a chorus that is there keeps what the change does not name; only true switches it on', { chorus: { mix: 2, enabled: 'yes' } }, { answer: wasShaped(next => { next.chorus = { ...CHORUS, enabled: false, mix: 1 }; }) }, shaped),
  effectsSet('inside a chorus, what is undefined is not a change and what is not a number is put back', { chorus: { rate: undefined, depth: Number.NaN, mix: null } }, { answer: wasShaped(next => { next.chorus = { ...CHORUS, depth: .5, mix: .6 }; }) }, shaped),
  ...notObjects.map(([what, value]) => effectsSet(`a chorus and an EQ that are ${what} are taken away`, { chorus: value, eq: value }, { answer: wasShaped(next => { delete next.chorus; delete next.eq; }) }, shaped)),
  effectsSet('a chorus and an EQ that are lists are put back as new and switched off', { chorus: [1], eq: [1] }, { answer: wasShaped(next => { next.chorus = { enabled: false, rate: .6, depth: .5, mix: .6 }; next.eq = { enabled: false, low: 0, mid: 0, high: 0 }; }) }, shaped),
  effectsSet('a project with no chorus and no EQ stays without them', { phaser: { mix: .5 } }, { answer: effects(next => { next.phaser.mix = .5; }) }),

  effectsSet('an EQ is added whole from one band', { eq: { low: -3 } }, { answer: effects(next => { next.eq = { enabled: false, low: -3, mid: 0, high: 0 }; }) }),
  effectsSet('inside an EQ, a band is held to 12 either way, one not a number is flat and one undefined is kept', { eq: { low: 99, mid: Number.NaN, high: undefined } }, { answer: wasShaped(next => { next.eq = { ...EQ, low: 12, mid: 0 }; }) }, shaped),

  effectsSet('the reverb\'s pre-delay and damping are held to their ranges', { reverb: { preDelay: 9, damping: 7 } }, { answer: effects(next => { Object.assign(next.reverb, { preDelay: .25, damping: 1 }); }) }),
  effectsSet('a pre-delay of zero is taken away and the damping stays', { reverb: { preDelay: 0 } }, { answer: wasShaped(next => { delete next.reverb.preDelay; }) }, shaped),
  effectsSet('damping below zero is taken away and the pre-delay stays', { reverb: { damping: -1 } }, { answer: wasShaped(next => { delete next.reverb.damping; }) }, shaped),
  effectsSet('a pre-delay that is not a number is taken away; damping that is undefined is kept', { reverb: { preDelay: Number.NaN, damping: undefined } }, { answer: wasShaped(next => { delete next.reverb.preDelay; }) }, shaped),
  effectsSet('pre-delay and damping that are null or text are taken away', { reverb: { preDelay: null, damping: 'lots' } }, { answer: wasShaped(next => { delete next.reverb.preDelay; delete next.reverb.damping; }) }, shaped),
];

const cases: Case[] = [
  ...swing('a swing in range is kept as sent', .3, .3),
  ...swing('a swing past the top is held at .75', 5, .75),
  ...swing('a swing below zero is held at 0', -1, 0, swingSet),
  ...swing('no swing leaves it as it was, and still emits and saves', undefined, .4, swingSet),
  ...swing('a swing that is not a number leaves it as it was', 'lots', .4, swingSet),
  ...swing('a swing that is not finite leaves it as it was', Number.NaN, .4, swingSet),
  ...swing('null leaves the swing as it was', null, .4, swingSet),
  ...volume('a volume in range is kept as sent', .25, .25),
  ...volume('a volume past the top is held at 1', 3, 1, volumeSet),
  ...volume('a volume below zero is held at 0', -.5, 0),
  ...volume('no volume leaves it as it was, and still emits and saves', undefined, .6, volumeSet),
  ...volume('a volume that is not a number leaves it as it was', '11', .6, volumeSet),
  ...volume('a volume that is not finite leaves it as it was', Number.POSITIVE_INFINITY, .6, volumeSet),

  guestAdd('a guest is added with a new id, its address tidied and its site as its name', { url: `  ${GUEST_URL}?a=1#part  ` }, { answer: { guests: [kept(1, { url: `${GUEST_URL}?a=1` })] } }),
  guestAdd('a guest can be given a name, cut to 60 characters, and goes after the ones already there', { url: 'http://localhost:8787/__guest', name: `  ${'g'.repeat(70)}  ` },
    { answer: { guests: [kept(1), kept(2, { url: 'http://localhost:8787/__guest', name: 'g'.repeat(60) })] } }, addGuest),
  guestAdd('a name that is undefined gives the site as the name', { url: GUEST_URL, name: undefined }, { answer: { guests: [kept(1)] } }),
  guestAdd('a name that is not text gives the site as the name', { url: GUEST_URL, name: 7 }, { answer: { guests: [kept(1)] } }),
  guestAdd('a name that is not a number at all gives the site as the name', { url: GUEST_URL, name: Number.NaN }, { answer: { guests: [kept(1)] } }),
  guestAdd('an address that is not https is refused', { url: 'http://guest.example/' }, { status: 400, error: BAD_ADDRESS }),
  guestAdd('an address that is not text is refused', { url: 7 }, { status: 400, error: BAD_ADDRESS }),
  guestAdd('no address at all is refused', { url: undefined }, { status: 400, error: BAD_ADDRESS }, addGuest),
  guestAdd('an address that is not a number at all is refused', { url: Number.NaN }, { status: 400, error: BAD_ADDRESS }),
  guestAdd(`a project holds at most ${MAX_GUESTS} guests, and says so with a 409`, { url: GUEST_URL }, { status: 409, error: FULL }, fill),
  guestAdd('a bad address is a 400 even when the project is full', { url: 'nope' }, { status: 400, error: BAD_ADDRESS }, fill),

  guestChange('a guest\'s name, level, mute, sends and settings are each checked', { name: '  Bass  ', volume: 3, muted: false, sends: { reverb: .25, delay: 9, bogus: 1 }, state: { voices: [1, 2] }, url: 'https://evil.example/', id: 'x' },
    { answer: { guests: [kept(1, { name: 'Bass', volume: 1, muted: false, sends: { reverb: .25, delay: 1, drive: 0, phaser: 0, chorus: 0 }, state: { voices: [1, 2] } })] } }),
  guestChange('a change of nothing leaves the guest as it was, and still emits and saves', {}, { answer: { guests: [kept(1, DRESSED)] } }),
  guestChange('what is undefined is not a change: JSON never sent it', { name: undefined, volume: undefined, muted: undefined, sends: undefined, state: undefined }, { answer: { guests: [kept(1, DRESSED)] } }),
  guestChange('what is not a number at all arrives as null: the level stays, the mute goes off, the settings go', { volume: Number.NaN, muted: Number.NaN, state: Number.NaN, name: Number.NaN },
    { answer: { guests: [kept(1, { name: 'Choir', volume: .5, muted: false, sends: DRESSED.sends })] } }),
  guestChange('a level that is not finite leaves it as it was, and a send that is not finite likewise', { volume: Number.POSITIVE_INFINITY, sends: { reverb: Number.NEGATIVE_INFINITY, delay: .5 } },
    { answer: { guests: [kept(1, { ...DRESSED, sends: { ...DRESSED.sends, delay: .5 } })] } }),
  guestChange('inside a guest\'s settings, what is undefined is left out and what is not finite is null', { state: { a: undefined, b: Number.NaN, c: [undefined, Number.POSITIVE_INFINITY], d: 'kept' } },
    { answer: { guests: [kept(1, { ...DRESSED, state: { b: null, c: [null, null], d: 'kept' } })] } }),
  guestChange('sends of nothing and settings of null are taken off the guest; a blank name keeps the old one', { name: '  ', sends: { reverb: 0 }, state: null, muted: 'yes' },
    { answer: { guests: [kept(1, { name: 'Choir', volume: .5 })] } }),
  guestChange('only the guest named is changed', { muted: true }, { answer: { guests: [kept(1, { url: 'https://other.example/', name: 'other.example' }), kept(2, { muted: true })] } },
    service => { addGuest(service, 'https://other.example/'); return addGuest(service); }),
  guestChange('a guest that does not exist cannot be changed', { muted: true }, { status: 404, error: 'Guest not found' }, service => { addGuest(service); return NO_GUEST; }),

  guestRemove('removing a guest also takes its settings and level out of every scene', { answer: { guests: [kept(1, { url: 'https://other.example/', name: 'other.example', state: { b: 2 } })] } },
    async service => {
      const keep = addGuest(service, 'https://other.example/'), id = addGuest(service);
      service.changeGuest(id, { state: { a: 1 } });
      service.changeGuest(keep, { state: { b: 2 } });
      await service.request('/scenes/create', { method: 'POST', body: '{}' });
      assert.deepEqual(service.getScenes().scenes.map(scene => [Object.keys(scene.guests!).sort(), Object.keys(scene.guestMix!).sort()]), Array(2).fill([[id, keep].sort(), [id, keep].sort()]));
      return { id, keep };
    },
    project => {
      assert.equal(project.scenes.length, 2);
      for (const scene of project.scenes) {
        assert.deepEqual(Object.values(scene.guests), [{ b: 2 }]);
        assert.deepEqual(Object.values(scene.guestMix), [{ volume: .8, muted: false }]);
      }
    }),
  guestRemove('removing the only guest leaves the scenes with no guest settings at all', { answer: { guests: [] } },
    async service => { const id = dressed(service); await service.request('/scenes/create', { method: 'POST', body: '{}' }); return id; },
    project => { for (const scene of project.scenes) assert.deepEqual(Object.keys(scene).sort(), ['drums', 'id', 'lanes', 'mutes', 'name']); }),
  guestRemove('a guest that does not exist cannot be removed', { status: 404, error: 'Guest not found' }, service => { addGuest(service); return NO_GUEST; }),

  ...drumCases,
  ...effectCases,
];

// What is in storage, or null when nothing has been written yet.
const written = () => { const text = storage.get(STORAGE_KEY); return text === undefined ? null : JSON.parse(text); };

for (const entry of cases) {
  test(`${entry.op} | ${entry.title}: the route and the typed helper do the same`, async () => {
    const one = setup();
    const routedCtx = await entry.arrange?.(one);
    one.flush();
    const routed = await call(one, entry.method ?? 'POST', typeof entry.path === 'string' ? entry.path : entry.path(routedCtx), entry.body);
    const routedProject = one.snapshot(), routedStored = written();

    const two = setup();
    const typedCtx = await entry.arrange?.(two);
    two.flush();
    const before = two.snapshot();
    const typed = applied(two, service => entry.run(service, typedCtx));
    const typedProject = two.snapshot(), typedStored = written();

    assert.notEqual(typed.data, undefined, 'an operation always answers with something');
    if (entry.error !== undefined) {
      assert.equal(typed.status, entry.status);
      assert.deepEqual(typed.data, { error: entry.error });
      assert.deepEqual(typed.events, [], 'a refused operation emits nothing');
      assert.equal(typed.saved, false, 'and saves nothing');
      assert.deepEqual(typedProject, before, 'and has changed nothing');
    } else {
      assert.equal(typed.status, 200);
      assert.deepEqual(comparable(typed.data), entry.answer);
      assert.deepEqual(comparable(typed.events), [{ type: entry.event, data: entry.answer }]);
      assert.equal(typed.saved, OP_META[entry.op].save, 'an accepted operation saves when OP_META says so');
    }
    entry.check?.(typedProject);

    assert.equal(typed.status, routed.status);
    assert.deepEqual(comparable(typed.data), comparable(routed.data));
    assert.deepEqual(comparable(typed.events), comparable(routed.events));
    assert.equal(typed.saved, routed.saved);
    assert.equal(typedProject.revision, routedProject.revision);
    assert.deepEqual(comparable(typedProject), comparable(routedProject));
    assert.deepEqual(comparable(typedStored), comparable(routedStored), 'and the same project was written');
  });
}

test('every case above is for an operation that has a reducer, and every reducer has a case', () => {
  assert.deepEqual([...new Set(cases.map(entry => entry.op))].sort(), Object.keys(reducers).sort());
  for (const type of Object.keys(reducers)) assert.ok(type in OP_META, type);
});

test('apply is synchronous: the event has arrived and the store has changed before it returns', () => {
  const service = setup();
  const seen: Message[] = [];
  service.subscribe(message => seen.push(message));
  seen.length = 0;
  const result = service.apply({ type: 'drum.swing', swing: .3 });
  assert.deepEqual(seen, [{ type: 'drumSwing', data: { swing: .3 } }]);
  assert.deepEqual(result, { ok: true, value: { swing: .3 } });
  assert.equal(service.snapshot().drumSwing, .3);
  for (const method of [
    'apply', 'applyAll', 'setDrumSwing', 'setDrumMasterVolume', 'setDrumKit', 'setDrumState', 'resetDrums', 'setDrumBars', 'setDrumStep', 'setDrumStepVelocity', 'setDrumStepDetail',
    'setDrumSettings', 'setDrumSample', 'setDrumMix', 'setDrumFx', 'setEffectsLoop', 'addGuest', 'changeGuest', 'removeGuest', 'getScenes', 'getTempo', 'getDrumKits',
  ] as const) {
    assert.equal(LocalProjectService.prototype[method].constructor.name, 'Function', `${method} is not async`);
  }
  service.flush();
});

test('an operation listener hears each accepted operation after its event, with where it came from and whether it saved', () => {
  const service = setup();
  const order: string[] = [], notices: OpNotice[] = [];
  service.subscribe(message => order.push(`event ${message.type}`));
  const stop = service.subscribeOps(notice => { order.push(`op ${notice.op.type}`); notices.push(notice); });
  order.length = 0;
  const first: Operation = { type: 'drum.swing', swing: 9 }, second: Operation = { type: 'drum.masterVolume', volume: .5 };
  service.apply(first);
  service.apply(second, 'history');
  assert.deepEqual(order, ['event drumSwing', 'op drum.swing', 'event drumMasterVolume', 'op drum.masterVolume']);
  assert.deepEqual(notices, [{ op: first, origin: 'local', saved: true }, { op: second, origin: 'history', saved: true }]);
  assert.equal(notices[0].op, first, 'the operation as it was sent, not as it was clamped');
  stop();
  service.setDrumSwing(.1);
  assert.equal(notices.length, 2, 'and nothing once it has stopped listening');
  service.flush();
});

// These stand a reducer in for one that has not moved yet, to try what no real reducer does:
// an outcome that is refused and yet names an event and a save, one that does not save, and one
// with no answer. They are about `apply`, not about the operation named.
function standIn<T>(type: 'tempo.set' | 'transport.play', reducer: (...args: any[]) => unknown, run: (service: LocalProjectService) => T): T {
  assert.equal(type in reducers, false, `${type} has a reducer of its own now: stand in for another`);
  (reducers as Record<string, unknown>)[type] = reducer;
  try { return run(setup()); } finally { delete (reducers as Record<string, unknown>)[type]; }
}

test('a refused operation is answered, not thrown: no event, no notice, no save', () => {
  standIn('tempo.set', () => ({ ok: false, status: 400, error: 'Invalid tempo', save: true, event: { type: 'tempoChange', data: {} } }), service => {
    const before = service.snapshot();
    let notices = 0;
    service.subscribeOps(() => { notices++; });
    const result = applied(service, target => target.apply({ type: 'tempo.set', tempo: 5 }));
    assert.deepEqual(result, { status: 400, data: { error: 'Invalid tempo' }, events: [], saved: false });
    assert.deepEqual(service.apply({ type: 'tempo.set', tempo: 5 }), { ok: false, status: 400, error: 'Invalid tempo' });
    assert.equal(notices, 0);
    assert.deepEqual(service.snapshot(), before);
  });
});

test('an operation that does not save is still announced, with saved false, and its answer is a copy', () => {
  standIn('transport.play', ({ state }: any) => ({ ok: true, value: state.song, event: { type: 'sequencerPlay', data: { synthId: 1 } } }), service => {
    const notices: OpNotice[] = [];
    service.subscribeOps(notice => notices.push(notice));
    let answer: any;
    const result = applied(service, target => (answer = target.apply({ type: 'transport.play', synthId: 1 })));
    assert.deepEqual(result.events, [{ type: 'sequencerPlay', data: { synthId: 1 } }]);
    assert.equal(result.saved, false);
    assert.deepEqual(notices.map(notice => notice.saved), [false]);
    answer.value.loop = true;
    assert.equal(service.getScenes().song.loop, false, 'changing the answer does not reach the store');
  });
});

test('a reducer that answers with nothing is a mistake apply reports, before anything is saved or sent', () => {
  standIn('transport.play', () => ({ ok: true, value: undefined, save: true, event: { type: 'sequencerPlay', data: { synthId: 1 } } }), service => {
    const seen: Message[] = [];
    let notices = 0;
    service.subscribe(message => seen.push(message));
    service.subscribeOps(() => { notices++; });
    seen.length = 0;
    assert.throws(() => service.apply({ type: 'transport.play', synthId: 1 }), /The reducer for transport\.play answered with nothing/);
    assert.deepEqual(seen, []);
    assert.equal(notices, 0);
    assert.equal(service.flush(), true);
    assert.equal(storage.has(STORAGE_KEY), false, 'nothing was scheduled');
  });
});

test('a real refusal: nothing is emitted, saved or announced, and the answer says why', () => {
  const service = setup();
  const before = service.snapshot();
  let notices = 0;
  service.subscribeOps(() => { notices++; });
  const refused = applied(service, target => target.addGuest('http://guest.example/'));
  assert.deepEqual(refused, { status: 400, data: { error: BAD_ADDRESS }, events: [], saved: false });
  assert.deepEqual(service.removeGuest(NO_GUEST), { ok: false, status: 404, error: 'Guest not found' });
  assert.deepEqual(service.changeGuest(NO_GUEST, { muted: true }), { ok: false, status: 404, error: 'Guest not found' });
  assert.equal(notices, 0);
  assert.deepEqual(service.snapshot(), before);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('applyAll goes on past a refused operation', () => {
  const service = setup();
  const results = service.applyAll([
    { type: 'guest.remove', guestId: NO_GUEST }, { type: 'drum.swing', swing: .2 }, { type: 'guest.add', guestId: NO_GUEST, url: 'nope' }, { type: 'guest.add', guestId: NO_GUEST, url: GUEST_URL },
  ]);
  assert.deepEqual(results.map(result => (result.ok ? 200 : result.status)), [404, 200, 400, 200]);
  assert.equal(service.snapshot().drumSwing, .2);
  assert.deepEqual(service.snapshot().guests.map((guest: any) => guest.id), [NO_GUEST]);
  service.flush();
});

// A route made a new guest's id itself. An operation carries it, so it can be one no guest may
// have, or one already taken; both are refused, after the checks the route made.
test('guest.add refuses an id that is not one, and one that is taken', () => {
  const service = setup();
  const taken = addGuest(service);
  service.flush();
  const before = service.snapshot();
  for (const guestId of ['abc', '', undefined, 7, null, {}]) {
    assert.deepEqual(service.apply({ type: 'guest.add', guestId: wrong(guestId), url: GUEST_URL }), { ok: false, status: 400, error: 'That is not an id a guest instrument can have.' });
  }
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: taken, url: 'https://other.example/' }), { ok: false, status: 409, error: 'That guest instrument is already in the project.' });
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: taken, url: 'nope' }), { ok: false, status: 400, error: BAD_ADDRESS }, 'the address is checked first, as the route checked it');
  assert.deepEqual(service.snapshot(), before);
  while (service.snapshot().guests.length < MAX_GUESTS) addGuest(service, `https://guest${service.snapshot().guests.length}.example/`);
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: 'abc', url: GUEST_URL }), { ok: false, status: 409, error: FULL }, 'and then the room, as the route did');
  service.flush();
});

// A route's body was always an object: anything else was "Invalid local operation data" before
// the route was reached. The typed way answers the same for a change that is not an object.
test('a change to a guest that is not an object is refused as a route\'s body was', async () => {
  const service = setup();
  const id = dressed(service);
  service.flush();
  const before = service.snapshot();
  const loop: Record<string, unknown> = {};
  loop.loop = loop;
  for (const patch of [null, undefined, [], [{ muted: false }], 'muted', 7, Number.NaN, loop, () => ({ muted: false })]) {
    assert.deepEqual(applied(service, target => target.changeGuest(id, wrong(patch))), { status: 400, data: { error: 'Invalid local operation data' }, events: [], saved: false });
  }
  assert.deepEqual(service.changeGuest(NO_GUEST, wrong(null)), { ok: false, status: 400, error: 'Invalid local operation data' }, 'checked before the guest is looked for, as a body was');
  for (const raw of ['null', '[]', '7', '"muted"']) {
    const routed = await call(service, 'PUT', `/guests/${id}`, undefined, raw);
    assert.deepEqual([routed.status, routed.data, routed.events, routed.saved], [400, { error: 'Invalid local operation data' }, [], false]);
  }
  assert.deepEqual(service.snapshot(), before);
});

test('a change to the drum sends or the effects that is not an object is refused as a route\'s body was', async () => {
  const service = setup();
  fxSet(service);
  shaped(service);
  service.flush();
  const before = service.snapshot();
  const loop: Record<string, unknown> = {};
  loop.loop = loop;
  const refused = { status: 400, data: { error: 'Invalid local operation data' }, events: [], saved: false };
  for (const patch of [null, undefined, [], [{ returnLevel: 1 }], 'sends', 7, Number.NaN, loop, () => ({ returnLevel: 1 })]) {
    assert.deepEqual(applied(service, target => target.setDrumFx(wrong(patch))), refused);
    assert.deepEqual(applied(service, target => target.setEffectsLoop(wrong(patch))), refused);
  }
  for (const path of ['/drum/fx', '/effects-loop']) {
    for (const raw of ['null', '[]', '7', '"sends"']) {
      const routed = await call(service, 'POST', path, undefined, raw);
      assert.deepEqual([routed.status, routed.data, routed.events, routed.saved], [400, { error: 'Invalid local operation data' }, [], false]);
    }
  }
  assert.deepEqual(service.snapshot(), before);
});

test('the store keeps nothing of an effects operation\'s own objects', () => {
  const service = setup();
  const fx = { sends: { reverb: .9, delay: .1, drive: .1, phaser: 0 }, returnLevel: .5 };
  const fxResult = service.setDrumFx(fx);
  assert.ok(fxResult.ok);
  fx.sends.reverb = 0;
  fxResult.value.drumFx.sends.delay = 1;
  const patch = { chorus: { enabled: true, rate: 2, depth: .3, mix: .4 }, delay: { sync: '1/8' as const } };
  const result = service.setEffectsLoop(patch);
  assert.ok(result.ok);
  patch.chorus.rate = 7;
  result.value.effectsLoop.chorus!.mix = 0;
  result.value.effectsLoop.delay.time = 1;
  const kept = service.snapshot();
  assert.deepEqual([kept.drumFx.sends.reverb, kept.drumFx.sends.delay, kept.effectsLoop.chorus.rate, kept.effectsLoop.chorus.mix, kept.effectsLoop.delay.time], [.9, .1, 2, .4, .2]);
  service.flush();
});

test('the store keeps nothing of an operation\'s own objects', () => {
  const service = setup();
  const id = addGuest(service);
  const state = { voices: [1, 2], deep: { level: 1 } }, sends = { reverb: .5, delay: 0, drive: 0, phaser: 0 };
  const notices: OpNotice[] = [];
  service.subscribeOps(notice => notices.push(notice));
  const patch = { state, sends };
  const result = service.changeGuest(id, patch);
  assert.ok(result.ok);
  assert.equal((notices[0].op as { patch: unknown }).patch, patch, 'a listener is handed the operation as it was sent');
  state.voices.push(3);
  state.deep.level = 9;
  sends.reverb = 1;
  (result.value.guests[0].state as any).voices.length = 0;
  const guest = service.snapshot().guests[0];
  assert.deepEqual(guest.state, { voices: [1, 2], deep: { level: 1 } });
  assert.equal(guest.sends.reverb, .5);
  service.flush();
});

test('the store keeps nothing of a drum operation\'s own objects', () => {
  const service = setup();
  const state = { kick: { steps: Array(16).fill(true), settings: { volume: .9 }, stepVelocities: Array(16).fill(.5) } };
  const whole = service.setDrumState(wrong(state));
  assert.ok(whole.ok);
  state.kick.steps[0] = false;
  state.kick.settings.volume = .1;
  state.kick.stepVelocities[0] = 0;
  whole.value.drumState.kick.steps[1] = false;
  const settings = { volume: .7 };
  const changed = service.setDrumSettings('snare', settings);
  assert.ok(changed.ok);
  settings.volume = .2;
  changed.value.drumState.snare.settings.volume = 0;
  const kept = service.snapshot().drumState;
  assert.deepEqual([kept.kick.steps[0], kept.kick.steps[1], kept.kick.settings.volume, kept.kick.stepVelocities[0], kept.snare.settings.volume], [true, true, .9, .5, .7]);
  service.flush();
});

// useStudio applies a drum edit only when its event arrives, and some of its handlers make
// several edits in one go (a pattern tool, mute all then clear solos) or read the drums back
// between two. Each event must therefore be the whole of the drums with every earlier edit in it.
test('each drum edit is delivered whole before the next begins, with every earlier edit in it', () => {
  const service = setup();
  const heard: DrumState[] = [];
  service.subscribe(message => { if (message.type === 'drumFullState' || message.type === 'drumKitChanged') heard.push(message.data.drumState); });
  service.setDrumStep('kick', 0, true);
  assert.equal(heard.length, 1, 'delivered before the helper returned');
  service.setDrumState(Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { ...heard.at(-1)![instrument], muted: true }])) as DrumState);
  service.setDrumStep('kick', 1, true);
  service.setDrumStepVelocity('kick', 1, .5);
  service.setDrumStepDetail('kick', 1, { ratchet: 2 });
  service.setDrumKit(KIT.id, false);
  assert.equal(heard.length, 6);
  const last = heard.at(-1)!;
  assert.deepEqual([last.kick.steps[0], last.kick.steps[1], last.kick.muted, last.crash.muted, last.kick.stepVelocities![1], last.kick.stepRatchets![1]], [true, true, true, true, .5, 2]);
  assert.deepEqual(last, service.snapshot().drumState);
  assert.equal(new Set(heard).size, 6, 'each is a copy of its own');
  service.flush();
});

// storeRoutes.test.ts pins that a step sent to an instrument named after a property every object
// has is not refused but throws. The typed way is left doing the same, for all six edits to one
// lane, until the last pull request of the plan puts it right.
test('an instrument named after a built-in property does through the helpers what it does through the routes (looks wrong)', async () => {
  const service = setup();
  const before = service.snapshot();
  for (const name of ['constructor', 'toString', '__proto__']) {
    const post = (path: string, rest: object) => service.request(path, { method: 'POST', body: JSON.stringify({ instrument: name, ...rest }) });
    assert.throws(() => service.setDrumStep(wrong(name), 0, true), TypeError);
    assert.throws(() => service.setDrumStepVelocity(wrong(name), 0, .5), TypeError);
    assert.throws(() => service.setDrumStepDetail(wrong(name), 0, { ratchet: 2 }), TypeError);
    assert.throws(() => service.setDrumSettings(wrong(name), { volume: 1 }), SyntaxError);
    await assert.rejects(post('/drum/step', { step: 0, active: true }), TypeError);
    await assert.rejects(post('/drum/step-velocity', { step: 0, velocity: .5 }), TypeError);
    await assert.rejects(post('/drum/step-detail', { step: 0, ratchet: 2 }), TypeError);
    await assert.rejects(post('/drum/settings', { settings: { volume: 1 } }), SyntaxError);
  }
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  assert.equal(storage.has(STORAGE_KEY), false, 'nothing was scheduled');

  // A mute or a sample does not throw: it is written onto the built-in property itself and
  // answered as a change that changed no lane. `__proto__` is left out here only because the
  // property it finds is the one every object in the test run shares.
  for (const name of ['constructor', 'toString']) {
    const builtIn = ({} as Record<string, any>)[name];
    try {
      const typedMix = applied(setup(), target => target.setDrumMix(wrong(name), { muted: true }));
      assert.equal(builtIn.muted, true);
      delete builtIn.muted;
      const routedMix = await call(setup(), 'POST', '/drum/mix', { instrument: name, muted: true });
      assert.equal(builtIn.muted, true);
      delete builtIn.muted;
      const typedSample = applied(setup(), target => target.setDrumSample(wrong(name), SAMPLE));
      assert.equal(builtIn.sampleId, SAMPLE);
      delete builtIn.sampleId;
      const routedSample = await call(setup(), 'POST', '/drum/sample', { instrument: name, sampleId: SAMPLE });
      assert.equal(builtIn.sampleId, SAMPLE);
      const unchanged = { status: 200, data: drums(), events: [{ type: 'drumFullState', data: drums() }], saved: true };
      for (const result of [typedMix, routedMix, typedSample, routedSample]) assert.deepEqual(result, unchanged);
    } finally {
      delete builtIn.muted;
      delete builtIn.sampleId;
    }
  }
});

test('before the service is initialized the typed way throws, with the message request() rejects with', () => {
  const message = /Local project has not been initialized/;
  assert.throws(() => new LocalProjectService().apply({ type: 'drum.swing', swing: .1 }), message);
  assert.throws(() => new LocalProjectService().applyAll([{ type: 'drum.swing', swing: .1 }]), message);
  assert.throws(() => new LocalProjectService().setDrumSwing(.1), message);
  assert.throws(() => new LocalProjectService().setDrumMasterVolume(.1), message);
  assert.throws(() => new LocalProjectService().addGuest(GUEST_URL), message);
  assert.throws(() => new LocalProjectService().changeGuest(NO_GUEST, {}), message);
  assert.throws(() => new LocalProjectService().removeGuest(NO_GUEST), message);
  assert.throws(() => new LocalProjectService().setDrumStep('kick', 0, true), message);
  assert.throws(() => new LocalProjectService().setDrumStepVelocity('kick', 0, 1), message);
  assert.throws(() => new LocalProjectService().setDrumStepDetail('kick', 0, {}), message);
  assert.throws(() => new LocalProjectService().setDrumSettings('kick', {}), message);
  assert.throws(() => new LocalProjectService().setDrumSample('kick'), message);
  assert.throws(() => new LocalProjectService().setDrumMix('kick', {}), message);
  assert.throws(() => new LocalProjectService().setDrumBars(1), message);
  assert.throws(() => new LocalProjectService().setDrumKit(KIT.id), message);
  assert.throws(() => new LocalProjectService().setDrumState(defaults().drumState), message);
  assert.throws(() => new LocalProjectService().resetDrums(), message);
  assert.throws(() => new LocalProjectService().setDrumFx({}), message);
  assert.throws(() => new LocalProjectService().setEffectsLoop({}), message);
  assert.throws(() => new LocalProjectService().getTempo(), message);
  assert.throws(() => new LocalProjectService().getScenes(), message);
});

// Until the last pull request of the plan every operation is in the type but only some have a
// reducer. When scene.rename gains one, name another here; when all have one, delete this.
test('an operation whose route has not moved yet throws, and changes nothing', () => {
  const service = setup();
  const before = service.snapshot();
  assert.throws(() => service.apply({ type: 'scene.rename', sceneId: service.getScenes().currentSceneId, name: 'Verse' }), /No reducer for scene\.rename yet/);
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('applyAll applies in order, each delivered before the next, and saves once', () => {
  const service = setup();
  const order: string[] = [];
  service.subscribe(message => order.push(`event ${message.type} ${JSON.stringify(message.data)}`));
  service.subscribeOps(notice => order.push(`op ${notice.op.type} ${notice.origin}`));
  order.length = 0;
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  const results = service.applyAll([{ type: 'drum.swing', swing: .2 }, { type: 'drum.masterVolume', volume: 2 }, { type: 'drum.swing', swing: .5 }], 'history');
  assert.deepEqual(results, [{ ok: true, value: { swing: .2 } }, { ok: true, value: { volume: 1 } }, { ok: true, value: { swing: .5 } }]);
  assert.deepEqual(order, [
    'event drumSwing {"swing":0.2}', 'op drum.swing history',
    'event drumMasterVolume {"volume":1}', 'op drum.masterVolume history',
    'event drumSwing {"swing":0.5}', 'op drum.swing history',
  ]);
  assert.equal(writes, 0);
  service.flush();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)!).drumSwing, .5);
  assert.deepEqual(service.applyAll([]), []);
});

test('the read methods answer what their routes answer, as copies, without saving', async () => {
  const service = setup();
  await service.request('/drum/step', { method: 'POST', body: JSON.stringify({ instrument: 'kick', step: 3, active: true }) });
  service.flush();
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  const route = async (path: string) => (await service.request(path)).json();

  assert.deepEqual(service.getTempo(), await route('/tempo'));
  assert.deepEqual(service.getTempo(), { tempo: 120 });
  assert.deepEqual(service.getDrumKits(), await route('/drum/kits'));
  assert.equal(service.getDrumKits().defaultKitId, 'clean-analog');
  const scenes = service.getScenes();
  assert.deepEqual(scenes, await route('/scenes'));
  assert.deepEqual(Object.keys(scenes).sort(), ['currentSceneId', 'scenes', 'song']);
  assert.equal(scenes.scenes[0].drums.kick.steps[3], true, 'the open scene is read from the live pattern');

  scenes.scenes[0].name = 'changed';
  scenes.song.loop = true;
  service.getDrumKits().kits[0].name = 'changed';
  assert.equal(service.getScenes().scenes[0].name, 'Scene 1');
  assert.equal(service.getScenes().song.loop, false);
  assert.notEqual(service.getDrumKits().kits[0].name, 'changed');
  service.flush();
  assert.equal(writes, 0);
});

test('merge copies its base, goes into objects, replaces lists and skips the keys that reach a prototype', () => {
  const base = { a: { b: 1, c: [1, 2] }, d: 'kept' };
  const merged = merge(base, JSON.parse('{"a":{"c":[3],"e":2},"__proto__":{"x":1},"constructor":{"x":1},"prototype":{"x":1}}'));
  assert.deepEqual(merged, { a: { b: 1, c: [3], e: 2 }, d: 'kept' });
  assert.deepEqual(base, { a: { b: 1, c: [1, 2] }, d: 'kept' });
  assert.equal((merged as any).x, undefined);
  assert.equal(Object.keys(merged).includes('constructor'), false);
});
