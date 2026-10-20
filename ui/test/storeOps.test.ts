// The typed way into the project store: `apply(op)`, the typed helpers over it, the read methods
// and `subscribeOps`. Each operation's typed helper is run on a fresh store, and the answer,
// the events, whether a save was scheduled and the project left behind are held to what the case
// says. storeEdits.test.ts pins the same facts by applying each operation directly.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { OP_META, type Applied, type OpNotice, type Operation } from '../src/services/projectOps.ts';
import { reducers } from '../src/services/projectReducers.ts';
import { merge, sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { MAX_GUESTS } from '../src/services/guests.ts';
import { MAX_SCENES } from '../src/services/projectSanitization.ts';
import { DRUM_INSTRUMENTS, DRUM_KITS } from '../src/services/drumKits.ts';
import type { DrumInstrument, DrumState } from '../src/types.ts';
import { applied, comparable, defaults, setup, storage, type Message } from './helpers/store.ts';

const STORAGE_KEY = 'discobot_browser_project_v1';
// A value of the wrong type, as an untyped caller or a replayed operation could send.
const wrong = (value: unknown) => value as never;
const resolve = (value: unknown, ctx: any) => (typeof value === 'function' ? value(ctx) : value);

// One edit, run on a store of its own. An accepted case names what it answers and emits; a
// refused one names the status and the error, and must then have emitted nothing, saved
// nothing and left the project as it was. Ids the stores make differ
// between runs, so an answer is written with each id as its place among them: 'id-1'.
interface Case {
  op: Operation['type'];
  title: string;
  // Whatever it returns is handed to `path` and `run`: usually an id it made.
  arrange?: (service: LocalProjectService) => any;
  run: (service: LocalProjectService, ctx: any) => Applied<unknown>;
  // Accepted: what both ways answer and emit, and the event's name. `eventData` when the event
  // carries something other than the answer; `silent` when there is no event at all.
  answer?: unknown;
  // For an answer too large to write out: what the project holds afterwards. The answer and the
  // event must both be that, and the two ways must still agree.
  answerFrom?: (project: any) => unknown;
  event?: string;
  eventData?: unknown;
  silent?: boolean;
  // Refused: the status and the error both ways answer with.
  status?: 400 | 404 | 409;
  error?: string;
  check?: (project: any) => void;
}

const swing = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.swing', title, arrange, run: service => service.setDrumSwing(wrong(sent)), answer: { swing: answer }, event: 'drumSwing', check: project => assert.equal(project.drumSwing, answer) },
];
const volume = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.masterVolume', title, arrange, run: service => service.setDrumMasterVolume(wrong(sent)), answer: { volume: answer }, event: 'drumMasterVolume', check: project => assert.equal(project.drumMasterVolume, answer) },
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
const guestAdd = (title: string, body: { url?: unknown; name?: unknown }, result: Outcome, arrange?: Case['arrange']): Case => ({
  op: 'guest.add', title, arrange, run: service => service.addGuest(wrong(body.url), wrong(body.name)), ...outcome(result),
});
const guestChange = (title: string, patch: unknown, result: Outcome, arrange: Case['arrange'] = dressed): Case => ({
  op: 'guest.patch', title, arrange, run: (service, id) => service.changeGuest(id, wrong(patch)), ...outcome(result),
});
const guestRemove = (title: string, result: Outcome, arrange: Case['arrange'], check?: Case['check']): Case => ({
  op: 'guest.remove', title, arrange, run: (service, ctx) => service.removeGuest(ctx.id ?? ctx), ...outcome(result), check,
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
const drumCase = (op: Case['op'], run: (service: LocalProjectService, body: any) => Applied<unknown>) =>
  (title: string, body: Record<string, unknown>, result: DrumOutcome, arrange?: Case['arrange']): Case => ({
    op, title, arrange, run: service => run(service, body), ...('answer' in result ? { event: 'drumFullState', ...result } : result),
  });
const drumStep = drumCase('drum.step', (service, body) => service.setDrumStep(body.instrument, body.step, body.active));
const drumVelocity = drumCase('drum.stepVelocity', (service, body) => service.setDrumStepVelocity(body.instrument, body.step, body.velocity));
const drumDetail = drumCase('drum.stepDetail', (service, body) => service.setDrumStepDetail(body.instrument, body.step, { probability: body.probability, ratchet: body.ratchet }));
const drumSettings = drumCase('drum.settings', (service, body) => service.setDrumSettings(body.instrument, body.settings));
const drumSample = drumCase('drum.sample', (service, body) => service.setDrumSample(body.instrument, body.sampleId));
const drumMix = drumCase('drum.mix', (service, body) => service.setDrumMix(body.instrument, { muted: body.muted, solo: body.solo }));
const drumBars = drumCase('drum.bars', (service, body) => service.setDrumBars(body.bars));
const drumCopyBar = drumCase('drum.copyBar', (service, body) => service.copyDrumBar(body.from, body.to));
const drumReset = drumCase('drum.reset', service => service.resetDrums());
const drumWhole = drumCase('drum.state', (service, body) => service.setDrumState(body.state));
const drumKit = drumCase('drum.kit', (service, body) => service.setDrumKit(body.kitId, body.applyDefaults));
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
  drumSettings('a drum\'s own share of the delay and of the reverb is kept when it is less than all of it', { instrument: 'kick', settings: { delaySend: .25, reverbSend: 0 } },
    { answer: drums({ kick: { settings: { delaySend: .25, reverbSend: 0 } } }) }),
  drumSettings('a share put back to all of it is stored as nothing, and one out of range is held', { instrument: 'kick', settings: { delaySend: 1, reverbSend: -4 } },
    { answer: drums({ kick: { settings: { reverbSend: 0 } } }) }, service => { assert.ok(service.setDrumSettings('kick', { delaySend: .3 }).ok); }),
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
  {
    op: 'drum.state', title: 'the helper takes the drum state itself, a lane or two of it, and fills in the rest', arrange: dressedDrums,
    run: service => service.setDrumState(wrong({ snare: { steps: [false, true], muted: true } })),
    answer: drums({ snare: { on: [1], muted: true } }), event: 'drumFullState',
  },

  drumBars('a longer pattern repeats what was there: steps, velocity, chance and repeats together', { bars: 2 }, { answer: drumsDressed({}, 32, [3, 19]) }, dressedDrums),
  drumCopyBar('a bar laid over another takes its steps, velocity, chance and repeats with it', { from: 0, to: [1] }, { answer: drumsDressed({}, 32, [3, 19]) },
    service => { twoBars(service); dressedDrums(service); }),
  drumCopyBar('a bar the pattern does not have is refused', { from: 0, to: [2] }, { status: 400, error: 'There is no such bar to copy' }, twoBars),
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
const patchCase = (op: Case['op'], event: string, run: (service: LocalProjectService, patch: any) => Applied<unknown>) =>
  (title: string, patch: Record<string, unknown>, result: PatchOutcome, arrange?: Case['arrange']): Case => ({
    op, title, arrange, run: service => run(service, patch), ...('answer' in result ? { event, ...result } : result),
  });
const drumFx = patchCase('drum.fx', 'drumFxUpdate', (service, patch) => service.setDrumFx(patch));
const effectsSet = patchCase('effects.set', 'effectsLoopUpdate', (service, patch) => service.setEffectsLoop(patch));
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

// A lane's sound, model, mix and view, and the tempo. A new store has lane 1 and no other.
const NO_SYNTH = 'Synth not found';
// The sound once it has been through the checks with nothing changed, and what a case names laid over it.
const CHECKED_SOUND = sanitizeSynthParams(defaults().synthParams, defaults().synthParams);
const sound = (changes: object = {}) => merge(CHECKED_SOUND, changes);
const BRIGHT = { gain: 1.5, pan: -.5, spread: .4, filter: { frequency: 1234 }, lfo1: { sync: true, rate: 40 } };
const bright = (service: LocalProjectService) => { assert.ok(service.setSynthParams(1, BRIGHT).ok); };
const wasBright = (changes: object = {}) => merge(sound(BRIGHT), changes);
type LaneOutcome = { answer: unknown; eventData?: unknown; silent?: boolean } | { status: 400 | 404 | 409; error: string };
const laneCase = (op: Case['op'], event: string, run: (service: LocalProjectService, synthId: number, body: any) => Applied<unknown>) =>
  (title: string, body: Record<string, unknown>, result: LaneOutcome, arrange?: Case['arrange'], synthId = 1): Case => ({
    op, title, arrange, run: service => run(service, synthId, body), ...('answer' in result ? { event, ...result } : result),
  });
const params = laneCase('synth.params', 'synthUpdate', (service, synthId, body) => service.setSynthParams(synthId, body));
// The answer is the sound alone; the event names the lane.
const sounds = (answer: unknown) => ({ answer, eventData: { synthId: 1, parameters: answer } });
const model = laneCase('synth.model', 'synthModelUpdate', (service, synthId, body) => service.setSynthModel(synthId, { modelId: body.modelId, modelParams: body.modelParams }));
const MACROS = { macro1: .5, macro2: .5, macro3: .5, macro4: .5 };
const modelled = (modelId: string, macros: object = {}) => ({ answer: { synthId: 1, modelId, modelParams: { ...MACROS, ...macros } } });
const juno = (service: LocalProjectService) => { assert.ok(service.setSynthModel(1, { modelId: 'juno-106', modelParams: { macro1: .9 } }).ok); };
const mix = laneCase('synth.mix', 'synthMix', (service, synthId, body) => service.setSynthMix(synthId, { muted: body.muted, solo: body.solo }));
const mixed = (muted: boolean, solo: boolean) => ({ answer: { synthId: 1, muted, solo } });
const soloed = (service: LocalProjectService) => { assert.ok(service.setSynthMix(1, { solo: true }).ok); };
const named = laneCase('synth.name', 'synthName', (service, synthId, body) => service.setSynthName(synthId, body.name));
const swung = laneCase('synth.swing', 'synthSwing', (service, synthId, body) => service.setSynthSwing(synthId, body.swing));
const prefs = laneCase('synth.prefs', '', (service, synthId, body) => service.setSynthPrefs(synthId, { octaveShift: body.octaveShift, keyboardMode: body.keyboardMode }));
// A lane as the store answers it: the whole of it, with its pattern's id as its place among the ids.
const lane = (rest: object = {}) => {
  const pattern = { id: 'id-1', name: 'Synth 1', tempo: 120, steps: Array.from({ length: 16 }, () => ({ active: false, velocity: .7 })) };
  return { answer: { synthId: 1, pattern, patterns: [pattern], synthParams: defaults().synthParams, synthModelId: 'generic', synthModelParams: MACROS, muted: false, solo: false, isPlaying: false, ...rest }, silent: true };
};
const lowPiano = (service: LocalProjectService) => { assert.ok(service.setSynthPrefs(1, { octaveShift: -9, keyboardMode: 'piano-roll' }).ok); };
const tempoCase = (title: string, tempo: unknown, result: LaneOutcome, arrange?: Case['arrange']): Case => ({
  op: 'tempo.set', title, arrange, run: service => service.setTempo(wrong(tempo)), ...('answer' in result ? { event: 'tempoChange', ...result } : result),
  check: project => {
    const expected = 'answer' in result ? (result.answer as { tempo: number }).tempo : 120;
    assert.equal(project.tempo, expected);
    assert.equal(project.synths.length, 2);
    for (const entry of project.synths) assert.deepEqual([entry.pattern.tempo, ...entry.patterns.map((pattern: any) => pattern.tempo)], Array(entry.patterns.length + 1).fill(expected));
  },
});
// Two lanes, the first with a second pattern, so a tempo has more than one pattern to reach.
const twoLanes = (service: LocalProjectService) => {
  assert.ok(service.createLane(2).ok);
  assert.ok(service.writePattern(1, crypto.randomUUID(), { name: 'Second', steps: [{ active: true, note: 'C4', velocity: .8 }] }).ok);
};

const laneCases: Case[] = [
  params('a sound change is laid over what is there, then checked', { filter: { frequency: 1234, q: 999 }, gain: 5, oscillator: { type: 'noise' }, lfo1: { sync: true }, bogus: 1 },
    sounds(sound({ filter: { frequency: 1234, q: 30 }, gain: 2, lfo1: { sync: true } }))),
  params('a change of nothing leaves the sound as it was, and still emits and saves', {}, sounds(wasBright()), bright),
  params('one value inside a part changes only that', { filter: { q: 5 } }, sounds(wasBright({ filter: { q: 5 } })), bright),
  ...notNumbers.map(([what, gain]) => params(`a level that is ${what} leaves it as it was, or puts back what a new lane has`, { gain }, sounds(wasBright({ gain: gain === undefined ? 1.5 : 1 })), bright)),
  params('inside a part, what is undefined is not a change: JSON never sent it', { filter: { frequency: undefined, q: 5 }, pan: undefined }, sounds(wasBright({ filter: { q: 5 } })), bright),
  params('a spread that is undefined is kept; one that is null goes back to none', { spread: undefined }, sounds(wasBright()), bright),
  params('a spread that is not a number at all arrives as null, and goes back to none', { spread: Number.NaN }, sounds(wasBright({ spread: 0 })), bright),
  params('an LFO whose sync is undefined keeps it, and the faster rate sync allows', { lfo1: { sync: undefined, depth: .9 } }, sounds(wasBright({ lfo1: { depth: .9 } })), bright),
  params('an LFO whose sync is not true is not synced, and its rate is held to what that allows', { lfo1: { sync: Number.POSITIVE_INFINITY } }, sounds(wasBright({ lfo1: { sync: false, rate: 30 } })), bright),
  ...notObjects.map(([what, value]) => params(`a part that is ${what} goes back to what a new lane has`, { filter: value }, sounds(wasBright({ filter: CHECKED_SOUND.filter })), bright)),
  params('a part that is undefined is not a change', { filter: undefined, lfo1: undefined, gain: 1.2 }, sounds(wasBright({ gain: 1.2 })), bright),
  params('a sound for a lane that does not exist is refused', { gain: 1 }, { status: 404, error: NO_SYNTH }, bright, 3),

  model('a model change sets the model and lays its macros over the lane\'s, each held to 0 to 1', { modelId: 'tb-303', modelParams: { macro1: .9, macro2: 7, macro3: 'x', extra: 1 } }, modelled('tb-303', { macro1: .9, macro2: 1 })),
  model('macros alone keep the model', { modelParams: { macro4: .1 } }, modelled('juno-106', { macro1: .9, macro4: .1 }), juno),
  model('a model alone keeps the macros', { modelId: 'dx7' }, modelled('dx7', { macro1: .9 }), juno),
  model('a model that does not exist puts the lane back on the generic one, not the one it had', { modelId: 'nope' }, modelled('generic', { macro1: .9 }), juno),
  model('a change of nothing leaves the model as it was, and still emits and saves', {}, modelled('juno-106', { macro1: .9 }), juno),
  ...([['undefined', undefined], ['null', null], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['empty', ''], ['zero', 0]] as const).map(([what, modelId]) =>
    model(`a model that is ${what} keeps the one the lane has`, { modelId }, modelled('juno-106', { macro1: .9 }), juno)),
  model('a model that is a number puts the lane on the generic one', { modelId: 7 }, modelled('generic', { macro1: .9 }), juno),
  model('a macro that is undefined is not a change: JSON never sent it', { modelParams: { macro1: undefined, macro2: .2 } }, modelled('juno-106', { macro1: .9, macro2: .2 }), juno),
  model('a macro that is not a number goes back to the middle', { modelParams: { macro1: Number.NaN, macro2: null, macro3: 'x', macro4: Number.POSITIVE_INFINITY } }, modelled('juno-106'), service => { assert.ok(service.setSynthModel(1, { modelId: 'juno-106', modelParams: { macro1: .9, macro2: .9, macro3: .9, macro4: .9 } }).ok); }),
  ...[...notObjects, ['a list', [.1, .2]] as [string, unknown], ['undefined', undefined] as [string, unknown]].map(([what, modelParams]) =>
    model(`macros that are ${what} leave them as they were`, { modelParams }, modelled('juno-106', { macro1: .9 }), juno)),
  model('a model for a lane that does not exist is refused', { modelId: 'dx7' }, { status: 404, error: NO_SYNTH }, juno, 3),

  mix('mute and solo are set when they are true or false, and left otherwise', { muted: true, solo: 'yes' }, mixed(true, false)),
  mix('both can change together', { muted: true, solo: false }, mixed(true, false), soloed),
  mix('a change of nothing leaves the mix as it was, and still emits and saves', {}, mixed(false, true), soloed),
  mix('what is undefined is not a change', { muted: undefined, solo: undefined }, mixed(false, true), soloed),
  mix('what is not a number at all, infinity, null and a number are not a mute or a solo', { muted: Number.NaN, solo: Number.POSITIVE_INFINITY }, mixed(false, true), soloed),
  mix('null and a number are not either', { muted: 1, solo: null }, mixed(false, true), soloed),
  mix('a mix for a lane that does not exist is refused', { muted: true }, { status: 404, error: NO_SYNTH }, soloed, 3),
  named('a lane is named', { name: 'Pad' }, { answer: { synthId: 1, name: 'Pad' } }),
  named('and named no more', { name: '' }, { answer: { synthId: 1, name: '' } }, service => { assert.ok(service.setSynthName(1, 'Pad').ok); }),
  named('naming a lane that does not exist is refused', { name: 'Pad' }, { status: 404, error: NO_SYNTH }, undefined, 3),
  swung('a lane is swung', { swing: true }, { answer: { synthId: 1, swing: true } }),
  swung('and is swung no more', { swing: false }, { answer: { synthId: 1, swing: false } }, service => { assert.ok(service.setSynthSwing(1, true).ok); }),
  swung('swing for a lane that does not exist is refused', { swing: true }, { status: 404, error: NO_SYNTH }, undefined, 3),

  prefs('the octave and the keyboard are saved without an event; the answer is the whole lane', { octaveShift: 1.6, keyboardMode: 'piano-roll' }, lane({ octaveShift: 2, keyboardMode: 'piano-roll' })),
  prefs('the octave is held to two either way', { octaveShift: 9, keyboardMode: 'keyboard' }, lane({ octaveShift: 2, keyboardMode: 'keyboard' }), lowPiano),
  prefs('on a lane that has neither yet, a change of nothing sets the octave to 0 and no keyboard', {}, lane({ octaveShift: 0 })),
  ...notNumbers.map(([what, octaveShift]) => prefs(`an octave that is ${what} keeps what was there`, { octaveShift }, lane({ octaveShift: -2, keyboardMode: 'piano-roll' }), lowPiano)),
  ...([['undefined', undefined], ['one there is none of', 'harp'], ['null', null], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY]] as const).map(([what, keyboardMode]) =>
    prefs(`a keyboard that is ${what} keeps what was there`, { octaveShift: 1, keyboardMode }, lane({ octaveShift: 1, keyboardMode: 'piano-roll' }), lowPiano)),
  prefs('a view of a lane that does not exist is refused', { octaveShift: 1 }, { status: 404, error: NO_SYNTH }, lowPiano, 3),

  tempoCase('a tempo is kept as sent, fractions too, and set on every pattern of every lane', 137.5, { answer: { tempo: 137.5 } }, twoLanes),
  ...[20, 400].map(tempo => tempoCase(`a tempo of ${tempo} is allowed`, tempo, { answer: { tempo } }, twoLanes)),
  ...([['just under 20', 19.9], ['just over 400', 400.1], ['text', '120'], ['null', null], ['missing', undefined], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['less than nothing', Number.NEGATIVE_INFINITY]] as const).map(([what, tempo]) =>
    tempoCase(`a tempo that is ${what} is refused, and no pattern is touched`, tempo, { status: 400, error: 'Invalid tempo' }, twoLanes)),
];

// A pattern write. A new store has lane 1 with one pattern, named Synth 1 and open: id-1.
const BLANK = (count = 16) => Array.from({ length: count }, () => ({ active: false, velocity: .7 }));
const stepsWith = (changes: Record<number, object>, count = 16) => BLANK(count).map((step, index) => ({ ...step, ...changes[index] }));
const kept1 = (rest: object = {}) => ({ id: 'id-1', name: 'Synth 1', tempo: 120, steps: BLANK(), ...rest });
const SHELF = 'Invalid sequence pattern';
type Target = 'existing' | 'first' | 'new' | string;
const patternCase = (title: string, patch: unknown, result: LaneOutcome, target: Target = 'existing', arrange?: Case['arrange'], synthId = 1, extra: Partial<Case> = {}): Case => {
  const open = (service: LocalProjectService) => service.snapshot().synths[0];
  const id = (ctx: any) => (target === 'existing' ? ctx.id : target === 'first' ? ctx.first : target === 'new' ? '' : target);
  const answer = 'answer' in result ? JSON.parse(JSON.stringify(result.answer)) : undefined;
  return {
    op: 'pattern.write', title,
    arrange: async service => { await arrange?.(service); return { id: open(service).pattern.id, first: open(service).patterns[0].id }; },
    run: (service, ctx) => service.writePattern(synthId, id(ctx) || crypto.randomUUID(), wrong(patch)),
    ...('answer' in result
      ? { event: target === 'existing' || target === 'first' ? 'patternUpdated' : 'patternCreated', eventData: { synthId, pattern: answer }, ...result, answer }
      : result),
    ...extra,
  };
};
const noted = { active: true, note: 'C4', velocity: .8 };
const written1 = (step: object, changes: object = {}) => ({ answer: kept1({ ...changes, steps: stepsWith({ 0: step }) }) });
const longPattern = (service: LocalProjectService) => { assert.ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, wrong({ steps: BLANK(32), bars: 2 })).ok); };
const oneNote = (service: LocalProjectService) => { assert.ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, { steps: stepsWith({ 0: noted }) }).ok); };
const field = (title: string, change: object, expected: object) =>
  patternCase(title, { steps: [{ active: true, note: 'C4', velocity: .8, ...change }] }, written1({ ...noted, ...expected }));

const patternCases: Case[] = [
  patternCase('a new pattern is made from the steps sent, filled out to a bar', { name: 'Second', steps: [noted] }, { answer: kept1({ name: 'Second', steps: stepsWith({ 0: noted }) }) }, 'new'),
  patternCase('a new pattern with no steps takes the open one\'s, and a missing name is "Recovered pattern"', {}, { answer: kept1({ name: 'Recovered pattern', steps: stepsWith({ 0: noted }) }) }, 'new', oneNote),
  patternCase('a new pattern can be given its own id', { steps: [noted] }, { answer: kept1({ id: 'mine', name: 'Recovered pattern', steps: stepsWith({ 0: noted }) }) }, 'mine'),
  patternCase('an id inside the patch does not rename the pattern', { id: 'theirs', steps: [noted] }, { answer: kept1({ steps: stepsWith({ 0: noted }) }) }),
  patternCase('an id of 300 characters is cut to 200', { steps: [noted] }, { answer: kept1({ id: 'x'.repeat(200), name: 'Recovered pattern', steps: stepsWith({ 0: noted }) }) }, 'x'.repeat(300)),
  patternCase('an existing pattern is changed in place, keeping its name', { steps: [noted] }, written1(noted)),
  patternCase('a write of nothing keeps the pattern as it was, and still emits and saves', {}, { answer: kept1({ steps: stepsWith({ 0: noted }) }) }, 'existing', oneNote),
  patternCase('the written pattern goes last in the lane\'s list and becomes the open one', { name: 'First again' }, { answer: kept1({ name: 'First again' }) }, 'first',
    service => { assert.ok(service.writePattern(1, crypto.randomUUID(), { name: 'Second', steps: [noted] }).ok); }, 1,
    { check: project => { assert.deepEqual(project.synths[0].patterns.map((pattern: any) => pattern.name), ['Second', 'First again']); assert.equal(project.synths[0].pattern.name, 'First again'); } }),
  patternCase('a pattern of two bars keeps them when no bars are sent', { name: 'Again' }, { answer: kept1({ name: 'Again', steps: BLANK(32), bars: 2 }) }, 'existing', longPattern),
  patternCase('bars that are undefined are not sent: JSON dropped them, and the pattern\'s own stay', { name: 'Again', bars: undefined }, { answer: kept1({ name: 'Again', steps: BLANK(32), bars: 2 }) }, 'existing', longPattern),
  patternCase('steps sent with bars are that many bars long', { steps: BLANK(32), bars: 2 }, { answer: kept1({ steps: BLANK(32), bars: 2 }) }),
  patternCase('bars that are infinity are none', { steps: BLANK(32), bars: Number.POSITIVE_INFINITY }, { answer: kept1({ steps: BLANK(32) }) }),
  patternCase('bars that are text are none', { steps: BLANK(32), bars: '2' }, { answer: kept1({ steps: BLANK(32) }) }),
  patternCase('automation is kept as checked, each list as long as the steps', { automation: { cutoff: [250, -4], pan: [null, 9], tempo: [1] } }, { answer: kept1({ automation: { pan: [null, 1, ...Array(14).fill(null)], cutoff: [250, 20, ...Array(14).fill(null)] } }) }),
  patternCase('automation that is undefined is not sent, and the pattern\'s own stays', { name: 'Again', automation: undefined }, { answer: kept1({ name: 'Again', automation: { level: [1.5, ...Array(15).fill(null)] } }) }, 'existing',
    service => { assert.ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, { automation: { level: [1.5] } }).ok); }),
  patternCase('automation sent as none takes the pattern\'s away', { automation: {} }, { answer: kept1() }, 'existing',
    service => { assert.ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, { automation: { level: [1.5] } }).ok); }),
  patternCase('automation that is not a list of parameters is none', { automation: [[1, 2]] }, { answer: kept1() }),
  patternCase('a pattern\'s own tempo is not taken: the project\'s is written', { tempo: 200, steps: [noted] }, { answer: kept1({ tempo: 150, steps: stepsWith({ 0: noted }) }) }, 'existing',
    service => { assert.ok(service.setTempo(150).ok); }),

  ...([['longer than 200 characters', 'n'.repeat(250), 'n'.repeat(200)], ['that is a number', 7, 'Recovered pattern'], ['that is null', null, 'Recovered pattern'], ['that is not a number at all', Number.NaN, 'Recovered pattern'], ['that is infinity', Number.POSITIVE_INFINITY, 'Recovered pattern'], ['that is undefined, which JSON never sent: the old name stays', undefined, 'Synth 1']] as const).map(([what, name, expected]) =>
    patternCase(`a name ${what}`, { name }, { answer: kept1({ name: expected }) })),

  field('a velocity past the top is held at 1', { velocity: 3 }, { velocity: 1 }),
  field('a velocity below zero is held at 0', { velocity: -2 }, { velocity: 0 }),
  ...notNumbers.map(([what, velocity]) => field(`a velocity that is ${what} is .7`, { velocity }, { velocity: .7 })),
  field('a note that is not one is no note, and the step is off', { note: 'H9' }, { active: false, note: undefined }),
  field('a note that is not text is no note', { note: 60 }, { active: false, note: undefined }),
  field('a step that is on with no note is off', { note: undefined }, { active: false, note: undefined }),
  field('a step that is "on" but not true is off', { active: 'yes' }, { active: false }),
  field('a chord keeps its other notes once each, leaving out the lowest and what is no note', { notes: ['E4', 'G4', 'E4', 'C4', 'X', 7] }, { notes: ['E4', 'G4'] }),
  field('a chord holds six notes in all', { notes: ['D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'] }, { notes: ['D4', 'E4', 'F4', 'G4', 'A4'] }),
  field('notes that are not a list are none', { notes: 'E4' }, {}),
  field('a slide is kept when it is true', { slide: true }, { slide: true }),
  ...([['yes', 'yes'], ['undefined', undefined], ['null', null], ['1', 1]] as const).map(([what, slide]) => field(`a slide that is ${what} is none`, { slide }, {})),
  field('a length of four is kept', { length: 4 }, { length: 4 }),
  field('a length is held to what is left of the pattern', { length: 999 }, { length: 16 }),
  ...([['a fraction', 1.5], ['one', 1], ['infinity', Number.POSITIVE_INFINITY], ['not a number at all', Number.NaN], ['null', null], ['undefined', undefined], ['text', '4']] as const).map(([what, length]) => field(`a length that is ${what} is one step`, { length }, {})),
  field('a chance below one is kept', { probability: .5 }, { probability: .5 }),
  ...([['one', 1], ['more than one', 2], ['below zero', -.5], ['infinity', Number.POSITIVE_INFINITY], ['not a number at all', Number.NaN], ['null', null], ['undefined', undefined], ['text', '.5']] as const).map(([what, probability]) => field(`a chance that is ${what} is none`, { probability }, {})),
  field('a repeat count is kept', { ratchet: 3 }, { ratchet: 3 }),
  field('a repeat count is held to four', { ratchet: 9 }, { ratchet: 4 }),
  ...([['a fraction', 1.5], ['one', 1], ['infinity', Number.POSITIVE_INFINITY], ['not a number at all', Number.NaN], ['null', null], ['undefined', undefined]] as const).map(([what, ratchet]) => field(`a repeat count that is ${what} is none`, { ratchet }, {})),
  field('a late start is kept', { offset: .5 }, { offset: .5 }),
  field('a late start is held below one step', { offset: 4 }, { offset: .95 }),
  ...([['infinity: JSON made it null, so it is none', Number.POSITIVE_INFINITY], ['zero', 0], ['below zero', -.5], ['not a number at all', Number.NaN], ['null', null], ['undefined', undefined], ['text', '.5']] as const).map(([what, offset]) => field(`a late start that is ${what} is none`, { offset }, {})),
  patternCase('a step that is not an object is a blank one, and steps past a bar are cut', { steps: [null, 'x', 7, undefined, noted, ...BLANK(30)] }, { answer: kept1({ steps: stepsWith({ 4: noted }, 32) }) }),
  patternCase('a step whose fields are all undefined is a blank one', { steps: [{ active: undefined, note: undefined, velocity: undefined, notes: undefined, length: undefined }] }, { answer: kept1() }),

  ...([['text', 'abc'], ['an object', {}], ['a number', 7]] as const).map(([what, steps]) =>
    patternCase(`steps that are ${what} are refused`, { steps }, { status: 400, error: SHELF })),
  ...([['null', null], ['undefined', undefined], ['not a number at all', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['zero', 0], ['empty text', ''], ['false', false]] as const).map(([what, steps]) =>
    patternCase(`steps that are ${what} are the ones the pattern had`, { steps, name: 'Kept' }, { answer: kept1({ name: 'Kept', steps: stepsWith({ 0: noted }) }) }, 'existing', oneNote)),
  patternCase('a pattern id that is a number is no id: refused', { steps: [noted] }, { status: 400, error: SHELF }, 'new', undefined, 1, { run: service => service.writePattern(1, wrong(5), { steps: [noted] }) }),
  patternCase('a pattern for a lane that does not exist is refused', { steps: [noted] }, { status: 404, error: NO_SYNTH }, 'existing', undefined, 3),
  ...notObjects.map(([what, patch]) => patternCase(`a pattern that is ${what} is refused`, patch, { status: 400, error: 'Invalid local operation data' })),
  patternCase('a pattern that is a list is refused', [noted], { status: 400, error: 'Invalid local operation data' }),
  patternCase('a pattern that is not an object is refused before a lane is looked for', 'lots', { status: 400, error: 'Invalid local operation data' }, 'existing', undefined, 3),
];

// A lane as the store makes it, with its pattern's id as its place among the ids.
const madeLane = (synthId: number, rest: object = {}) => {
  const pattern = { id: 'id-1', name: `Synth ${synthId}`, tempo: 120, steps: BLANK() };
  return { answer: { synthId, pattern, patterns: [pattern], synthParams: defaults().synthParams, synthModelId: 'generic', synthModelParams: MACROS, muted: false, solo: false, isPlaying: false, ...rest } };
};
const laneIds = (...expected: number[]) => (project: any) => assert.deepEqual(project.synths.map((entry: any) => entry.synthId), expected);
const makeLane = (title: string, sent: unknown, result: ReturnType<typeof madeLane> | { status: 400 | 404 | 409; error: string }, arrange?: Case['arrange'], check?: Case['check']): Case => ({
  op: 'synth.create', title, arrange, run: service => service.createLane(wrong(sent)),
  ...('answer' in result ? { event: 'synthCreated', ...result } : result), check,
});
const withLanes = async (service: LocalProjectService) => { assert.ok(service.createLane(2).ok); assert.ok(service.createLane(3).ok); };
const withAllLanes = async (service: LocalProjectService) => { for (const id of [2, 3, 4, 5]) assert.ok(service.createLane(id).ok); };
const removeCase = (title: string, synthId: number, result: { answer: unknown } | { status: 400 | 404 | 409; error: string }, arrange?: Case['arrange'], check?: Case['check']): Case => ({
  op: 'synth.remove', title, arrange, run: service => service.removeLane(synthId),
  ...('answer' in result ? { event: 'synthRemoved', ...result } : result), check,
});
const twoPatterns = (service: LocalProjectService) => {
  assert.ok(service.writePattern(1, 'one', { steps: [noted] }).ok);
  assert.ok(service.writePattern(1, 'two', { steps: [noted] }).ok);
};
const openPattern = (id: string) => (project: any) => assert.equal(project.synths[0].pattern.id, id);
// Play and stop do not save and send the lane's number. `patternId` is read by both.
const transportCase = (verb: 'play' | 'stop', title: string, body: { synthId: number; patternId?: string }, result: { answer: unknown; eventData?: unknown; silent?: boolean }, arrange?: Case['arrange'], check?: Case['check']): Case => ({
  op: verb === 'play' ? 'transport.play' : 'transport.stop', title, arrange,
  run: service => service.apply(verb === 'play' ? { type: 'transport.play', synthId: body.synthId, patternId: body.patternId } : { type: 'transport.stop', synthId: body.synthId, patternId: body.patternId }),
  event: verb === 'play' ? 'sequencerPlay' : 'sequencerStop', eventData: { synthId: body.synthId }, ...result, check,
});
const laneStarted = (synthId: number) => async (service: LocalProjectService) => { assert.ok(service.createLane(2).ok); assert.ok(service.playLane(synthId).ok); };
const playing = (...expected: boolean[]) => (project: any) => assert.deepEqual(project.synths.map((entry: any) => entry.isPlaying), expected);
const SUCCESS = { answer: { success: true } }, FAILURE = { answer: { success: false }, silent: true };

const comingAndGoingCases: Case[] = [
  makeLane('a new lane is a blank pattern of sixteen steps, the default sound and the generic model', 3, madeLane(3), undefined, laneIds(1, 3)),
  makeLane('with no lane named, the lowest free one', undefined, madeLane(2), undefined, laneIds(1, 2)),
  makeLane('lane 0 counts as no lane named (looks wrong)', 0, madeLane(2)),
  makeLane('lane null counts as none', null, madeLane(2)),
  makeLane('lane infinity counts as none: JSON made it null', Number.POSITIVE_INFINITY, madeLane(2)),
  makeLane('lane "not a number at all" counts as none', Number.NaN, madeLane(2)),
  makeLane('lanes are kept in the order they were made, not by number', 2, madeLane(2), service => { assert.ok(service.createLane(3).ok); }, laneIds(1, 3, 2)),
  makeLane('a new lane takes the project\'s tempo', 2, madeLane(2, { pattern: { id: 'id-1', name: 'Synth 2', tempo: 150, steps: BLANK() }, patterns: [{ id: 'id-1', name: 'Synth 2', tempo: 150, steps: BLANK() }] }), service => { assert.ok(service.setTempo(150).ok); }),
  makeLane('creating a lane that exists answers with it as it is, and still emits and saves', 1,
    madeLane(1, { muted: true, solo: true }), service => { assert.ok(service.setSynthMix(1, { muted: true, solo: true }).ok); }, laneIds(1)),
  ...([6, -1, 1.5, '2'] as const).map(synthId => makeLane(`lane ${JSON.stringify(synthId)} is refused`, synthId, { status: 400, error: '5 synths maximum' })),
  makeLane('with all five lanes there, no lane named is refused', undefined, { status: 400, error: '5 synths maximum' }, withAllLanes),

  removeCase('lane 1 cannot be removed', 1, { status: 400, error: 'Synth 1 cannot be removed' }),
  removeCase('a lane is removed and the others stay in their order', 2, { answer: { synthId: 2 } }, withLanes, laneIds(1, 3)),
  removeCase('a lane that is playing is removed all the same', 2, { answer: { synthId: 2 } }, laneStarted(2), laneIds(1)),
  removeCase('a lane that is not there is a 404', 3, { status: 404, error: NO_SYNTH }),
  removeCase('lane 0 is not there either', 0, { status: 404, error: NO_SYNTH }),

  ...(['play', 'stop'] as const).flatMap((verb): Case[] => {
    const on = verb === 'play';
    return [
      transportCase(verb, 'marks the lane and sends its number, and does not save', { synthId: 2 }, SUCCESS, on ? laneStarted(1) : laneStarted(2), playing(on, on)),
      transportCase(verb, 'lane 1 is the first lane', { synthId: 1 }, SUCCESS, on ? undefined : async service => { assert.ok(service.playLane(1).ok); }, playing(on)),
      transportCase(verb, 'a pattern named becomes the lane\'s open pattern', { synthId: 1, patternId: 'one' }, SUCCESS, service => { twoPatterns(service); }, openPattern('one')),
      transportCase(verb, 'a pattern the lane does not have is ignored', { synthId: 1, patternId: 'nope' }, SUCCESS, service => { twoPatterns(service); }, openPattern('two')),
      transportCase(verb, 'a lane that is not there is a success that says it failed: nothing is sent or changed', { synthId: 2 }, FAILURE, undefined, playing(false)),
      transportCase(verb, 'a lane already in that state is marked again and the event goes out again', { synthId: 2 }, SUCCESS, on ? laneStarted(2) : service => { assert.ok(service.createLane(2).ok); }, playing(false, on)),
    ];
  }),
];

// A second scene, empty and open; the first holds a kick on step 3.
const twoScenes = (service: LocalProjectService) => {
  assert.ok(service.setDrumStep('kick', 3, true).ok);
  const first = service.getScenes().currentSceneId;
  const made = service.createScene({ empty: true });
  assert.ok(made.ok);
  return { first, second: made.value.currentSceneId };
};
type Ids = { first: string; second: string };
const openScene = (service: LocalProjectService) => service.getScenes().currentSceneId;
// What a scene change answers and sends: the scenes, the song, the open scene, and the lanes and
// drums as that scene left them.
const sceneAnswer = (project: any) => ({
  scenes: project.scenes, song: project.song, currentSceneId: project.currentSceneId,
  synths: project.synths.map((lane: any) => ({ synthId: lane.synthId, pattern: lane.pattern, muted: lane.muted, solo: lane.solo })),
  drumState: project.drumState, guests: project.guests ?? [],
});
const sceneChange = (op: Case['op'], run: (service: LocalProjectService, body: any) => Applied<unknown>) =>
  (title: string, body: unknown, arrange?: Case['arrange'], check?: Case['check']): Case =>
    ({ op, title, arrange, run: (service, ctx) => run(service, resolve(body, ctx)), event: 'sceneChanged', answerFrom: sceneAnswer, check });
const sceneRefused = (op: Case['op'], run: (service: LocalProjectService, body: any) => Applied<unknown>) =>
  (title: string, body: unknown, status: 400 | 404 | 409, error: string, arrange?: Case['arrange']): Case =>
    ({ op, title, arrange, run: (service, ctx) => run(service, resolve(body, ctx)), status, error });
const select = sceneChange('scene.select', (service, body) => service.selectScene(body.sceneId));
const selectRefused = sceneRefused('scene.select', (service, body) => service.selectScene(body.sceneId));
const create = sceneChange('scene.create', (service, body) => service.createScene(body));
const createRefused = sceneRefused('scene.create', (service, body) => service.createScene(body));
const rename = sceneChange('scene.rename', (service, body) => service.renameScene(body.sceneId, body.name));
const renameRefused = sceneRefused('scene.rename', (service, body) => service.renameScene(body.sceneId, body.name));
const colour = sceneChange('scene.color', (service, body) => service.setSceneColor(body.sceneId, body.color));
const colourRefused = sceneRefused('scene.color', (service, body) => service.setSceneColor(body.sceneId, body.color));
const signature = sceneChange('scene.signature', (service, body) => service.setSceneSignature(body.signature));
const signatureRefused = sceneRefused('scene.signature', (service, body) => service.setSceneSignature(body.signature));
const copyPart = sceneChange('scene.copyPart', (service, body) => service.copyPartToScene(body.toSceneId, body.part));
const copyPartRefused = sceneRefused('scene.copyPart', (service, body) => service.copyPartToScene(body.toSceneId, body.part));
const remove = sceneChange('scene.delete', (service, body) => service.deleteScene(body.sceneId));
const removeRefused = sceneRefused('scene.delete', (service, body) => service.deleteScene(body.sceneId));
const replace = sceneChange('scene.replace', (service, body) => service.replaceScenes(body));
const song = sceneChange('song.set', (service, body) => service.setSong(body));
const unchangedScenes = (project: any) => { assert.equal(project.scenes.length, 1); assert.equal(project.drumState.kick.steps[3], true); };
const names = (project: any) => project.scenes.map((scene: any) => scene.name);

const sceneCases: Case[] = [
  selectRefused('a scene that does not exist', { sceneId: 'nope' }, 404, 'Scene not found'),
  selectRefused('no scene named', {}, 404, 'Scene not found'),
  select('selecting the open scene changes nothing but still emits and saves', (id: string) => ({ sceneId: id }), service => { kickOn(service); return openScene(service); }, unchangedScenes),
  select('selecting another scene keeps the edits to the one left and opens the other, with its mutes', (ids: Ids) => ({ sceneId: ids.first }), service => {
    const ids = twoScenes(service);
    assert.ok(service.setDrumStep('snare', 5, true).ok);
    assert.ok(service.setSynthMix(1, { muted: true }).ok);
    assert.ok(service.setDrumMix('clap', { solo: true }).ok);
    return ids;
  }, project => {
    assert.equal(project.drumState.kick.steps[3], true);
    assert.equal(project.drumState.snare.steps[5], false);
    assert.equal(project.drumState.clap.solo, false);
    assert.equal(project.synths[0].muted, false);
    assert.deepEqual(project.scenes[1].mutes.lanes[1], { muted: true, solo: false });
    assert.equal(project.scenes[1].drums.snare.steps[5], true);
  }),
  select('a guest takes the settings the scene holds for it', (ids: Ids) => ({ sceneId: ids.first }), service => {
    const guest = addGuest(service);
    assert.ok(service.changeGuest(guest, { state: { first: true }, volume: .3 }).ok);
    const ids = twoScenes(service);
    assert.ok(service.changeGuest(guest, { state: { second: true }, muted: true }).ok);
    return ids;
  }, project => assert.deepEqual([project.guests[0].state, project.guests[0].volume, project.guests[0].muted], [{ first: true }, .3, false])),

  create('a new scene is a copy of the open one, placed after it and opened', {}, service => { kickOn(service); kickSoft(service); oneNote(service); }, project => {
    assert.deepEqual(names(project), ['Scene 1', 'Scene 2']);
    assert.equal(project.currentSceneId, project.scenes[1].id);
    assert.deepEqual({ ...project.scenes[1], id: 0, name: 0, color: 0 }, { ...project.scenes[0], id: 0, name: 0, color: 0 });
    assert.equal(project.scenes[0].color, undefined, 'the scene it was copied from is not given a colour');
    assert.equal(project.scenes[1].color, 'red', 'a new scene takes the first colour no scene has');
    assert.equal(project.scenes[1].drums.kick.stepVelocities[3], .5);
  }),
  create('an empty new scene has no notes or hits, keeps the lengths, and takes its name trimmed', { empty: true, name: '  Break  ' }, service => {
    assert.ok(service.setDrumBars(2).ok);
    assert.ok(service.setDrumStep('kick', 20, true).ok);
    assert.ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, { steps: [...BLANK(31), noted] }).ok);
  }, project => {
    assert.equal(project.scenes[1].name, 'Break');
    assert.deepEqual(project.scenes[1].lanes[1], BLANK(32));
    assert.deepEqual(project.scenes[1].drums.kick, { steps: Array(32).fill(false) });
    assert.equal(project.scenes[0].drums.kick.steps[20], true);
    assert.equal(project.scenes[0].lanes[1][31].note, 'C4');
    assert.deepEqual(project.synths[0].pattern.steps, BLANK(32));
  }),
  create('a scene name is cut to 40 characters', { name: 'n'.repeat(50) }, undefined, project => assert.equal(project.scenes[1].name, 'n'.repeat(40))),
  create('a blank or missing name is numbered from how many scenes there are', { name: '   ' }, twoScenes, project => assert.deepEqual(names(project), ['Scene 1', 'Scene 2', 'Scene 3'])),
  create('a name that is not text is numbered too', { name: 7 }, undefined, project => assert.deepEqual(names(project), ['Scene 1', 'Scene 2'])),
  create('a new scene goes straight after the open one, not at the end', { name: 'Middle' }, service => {
    const ids = twoScenes(service);
    assert.ok(service.selectScene(ids.first).ok);
    return ids;
  }, project => assert.deepEqual(names(project), ['Scene 1', 'Middle', 'Scene 2'])),
  create('a flag that is not exactly true makes a copy', { empty: 1 }, kickOn, project => assert.equal(project.drumState.kick.steps[3], true)),
  createRefused(`a project holds at most ${MAX_SCENES} scenes`, {}, 400, `A project can hold ${MAX_SCENES} scenes`, service => { for (let count = 1; count < MAX_SCENES; count++) assert.ok(service.createScene().ok); }),

  rename('renaming trims the name and cuts it to 40 characters', (ids: Ids) => ({ sceneId: ids.first, name: `  ${'v'.repeat(50)}  ` }), twoScenes, project => {
    assert.deepEqual(names(project), ['v'.repeat(40), 'Scene 2']);
    assert.equal(project.currentSceneId, project.scenes[1].id, 'renaming does not open the scene');
  }),
  renameRefused('a scene that does not exist is a 400 about the name, not a 404 (looks wrong)', { sceneId: 'nope', name: 'Verse' }, 400, 'A scene needs a name'),
  renameRefused('a blank name', (id: string) => ({ sceneId: id, name: '   ' }), 400, 'A scene needs a name', openScene),
  renameRefused('a name that is not text', (id: string) => ({ sceneId: id, name: 7 }), 400, 'A scene needs a name', openScene),
  renameRefused('no name at all', (id: string) => ({ sceneId: id }), 400, 'A scene needs a name', openScene),

  colour('a scene is given a colour, and the open scene keeps the one it had', (ids: Ids) => ({ sceneId: ids.first, color: 'blue' }), twoScenes, project => {
    assert.deepEqual(project.scenes.map((scene: any) => scene.color), ['blue', 'red']);
    assert.equal(project.currentSceneId, project.scenes[1].id, 'colouring does not open the scene');
  }),
  colour('a colour that is not in the list takes the colour away', (ids: Ids) => ({ sceneId: ids.second, color: '#ff0000' }), twoScenes, project => {
    assert.equal('color' in project.scenes[1], false);
  }),
  colour('no colour takes the colour away', (ids: Ids) => ({ sceneId: ids.second }), twoScenes, project => {
    assert.equal('color' in project.scenes[1], false);
  }),
  colourRefused('a scene that does not exist cannot be coloured', { sceneId: 'nope', color: 'blue' }, 400, 'That scene is not in the project.'),

  signature('the open scene takes a time signature and its lanes and drums become bars of it', { signature: '6/8' }, twoScenes, project => {
    assert.deepEqual(project.scenes.map((scene: any) => scene.signature), [undefined, '6/8']);
    assert.deepEqual(project.scenes.map((scene: any) => scene.drums.kick.steps.length), [16, 12]);
    assert.equal(project.drumState.kick.steps.length, 12);
    assert.equal(project.synths[0].pattern.steps.length, 12);
    assert.equal(project.scenes[0].drums.kick.steps[3], true, 'the other scene keeps what it had');
  }),
  signature('the same signature again changes nothing but is still answered', { signature: '4/4' }, twoScenes, project => {
    assert.equal('signature' in project.scenes[1], false);
    assert.equal(project.drumState.kick.steps.length, 16);
  }),
  signatureRefused('a signature that is not one of the six', { signature: '2/2' }, 400, 'A scene is in 4/4, 3/4, 6/8, 5/4, 7/8, 12/8'),
  signatureRefused('no signature at all', {}, 400, 'A scene is in 4/4, 3/4, 6/8, 5/4, 7/8, 12/8'),

  // The open scene is the second, which is empty: copying its kick row empties the first scene's.
  copyPart('one drum row of the open scene goes into another scene', (ids: Ids) => ({ toSceneId: ids.first, part: { drum: 'kick' } }), twoScenes, project => {
    assert.equal(project.scenes[0].drums.kick.steps.some(Boolean), false);
    assert.equal(project.scenes[0].drums.kick.steps.length, 16);
  }),
  copyPart('a lane of the open scene goes into another scene', (ids: Ids) => ({ toSceneId: ids.first, part: { synthId: 1 } }), twoScenes, project => {
    assert.deepEqual(project.scenes[0].lanes[1], project.scenes[1].lanes[1]);
  }),
  copyPartRefused('a part is not copied into the scene it is in', (ids: Ids) => ({ toSceneId: ids.second, part: { synthId: 1 } }), 400, 'Choose another scene to copy to.', twoScenes),
  copyPartRefused('nor without saying which part', (ids: Ids) => ({ toSceneId: ids.first, part: {} }), 400, 'Choose a lane or a drum to copy.', twoScenes),

  removeRefused('a scene that does not exist, even when only one is left', { sceneId: 'nope' }, 404, 'Scene not found'),
  removeRefused('the last scene cannot be deleted', (id: string) => ({ sceneId: id }), 400, 'A project needs at least one scene', openScene),
  remove('deleting the open scene opens the one before it and takes it out of the song', (ids: Ids) => ({ sceneId: ids.second }), service => {
    const ids = twoScenes(service);
    assert.ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 2 }, { sceneId: ids.second, repeats: 3 }], loop: true }).ok);
    return ids;
  }, project => {
    assert.equal(project.scenes.length, 1);
    assert.equal(project.currentSceneId, project.scenes[0].id);
    assert.equal(project.drumState.kick.steps[3], true);
    assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 2 }], loop: true });
  }),
  remove('deleting the open first scene opens the one that takes its place', (ids: Ids) => ({ sceneId: ids.first }), service => {
    const ids = twoScenes(service);
    assert.ok(service.selectScene(ids.first).ok);
    return ids;
  }, project => {
    assert.equal(project.currentSceneId, project.scenes[0].id);
    assert.equal(project.drumState.kick.steps[3], false);
  }),
  remove('deleting another scene leaves the open one open; a song left empty plays the first scene once', (ids: Ids) => ({ sceneId: ids.first }), service => {
    const ids = twoScenes(service);
    assert.ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 4 }] }).ok);
    assert.ok(service.setDrumStep('snare', 5, true).ok);
    return ids;
  }, project => {
    assert.equal(project.drumState.snare.steps[5], true);
    assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 1 }], loop: false });
  }),

  replace('replacing with nothing leaves one new scene made from the live pattern', {}, service => {
    twoScenes(service);
    assert.ok(service.setDrumStep('snare', 5, true).ok);
  }, project => {
    assert.deepEqual(names(project), ['Scene 1']);
    assert.equal(project.drumState.snare.steps[5], true);
    assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 1 }], loop: false });
  }),
  replace('replacing takes the scenes and song given, except the open scene, which stays the live pattern', (body: any) => body, service => {
    twoScenes(service);
    const [a, b] = service.getScenes().scenes;
    a.drums.kick.steps[7] = true;
    b.drums.kick.steps[9] = true;
    return {
      scenes: [{ ...a, id: 'a', name: 'A' }, { ...b, id: 'b', name: 'B' }, { ...b, id: 'a', name: 'Twice' }, { name: 'No id' }],
      currentSceneId: 'b', song: { entries: [{ sceneId: 'b', repeats: 3 }, { sceneId: 'gone', repeats: 1 }], loop: true },
    };
  }, project => {
    assert.deepEqual(project.scenes.map((scene: any) => [scene.id, scene.name]), [['a', 'A'], ['b', 'B']]);
    assert.equal(project.currentSceneId, 'b');
    assert.deepEqual(project.song, { entries: [{ sceneId: 'b', repeats: 3 }], loop: true });
    assert.equal(project.scenes[0].drums.kick.steps[7], true);
    assert.equal(project.scenes[1].drums.kick.steps[9], false, 'the open scene is not read from the body');
  }),
  replace('replacing with an open scene that is not among them opens the first', (body: any) => body, service => {
    const [scene] = service.getScenes().scenes;
    return { scenes: [{ ...scene, id: 'a' }, { ...scene, id: 'b' }], currentSceneId: 'zzz' };
  }, project => {
    assert.equal(project.currentSceneId, 'a');
    assert.deepEqual(project.song, { entries: [{ sceneId: 'a', repeats: 1 }], loop: false });
  }),
  replace('what JSON would have dropped or changed is dropped or changed: an undefined name, a repeat of infinity', (body: any) => body, service => {
    const [scene] = service.getScenes().scenes;
    return {
      scenes: [{ ...scene, id: 'a', name: undefined }, { ...scene, id: 'b', name: 'B' }], currentSceneId: undefined,
      song: { entries: [{ sceneId: 'b', repeats: Number.POSITIVE_INFINITY }, { sceneId: 'a', repeats: Number.NaN }], loop: undefined },
    };
  }, project => {
    assert.deepEqual(project.scenes.map((scene: any) => [scene.id, scene.name]), [['a', 'Scene'], ['b', 'B']]);
    assert.equal(project.currentSceneId, 'a');
    assert.deepEqual(project.song, { entries: [{ sceneId: 'b', repeats: 1 }, { sceneId: 'a', repeats: 1 }], loop: false });
  }),
  replace('scenes that are not a list leave one new scene, like none', { scenes: 'many' }, undefined, project => assert.deepEqual(names(project), ['Scene 1'])),

  song('the song takes entries for scenes that exist, with whole repeats from 1 to 64', (ids: Ids) => ({
    entries: [{ sceneId: ids.second, repeats: 2.6 }, { sceneId: 'gone', repeats: 2 }, { sceneId: ids.first, repeats: 999 }, { sceneId: ids.first }], loop: true,
  }), twoScenes, project => {
    const [first, second] = project.scenes.map((scene: any) => scene.id);
    assert.deepEqual(project.song, { entries: [{ sceneId: second, repeats: 3 }, { sceneId: first, repeats: 64 }, { sceneId: first, repeats: 1 }], loop: true });
  }),
  song('the song keeps whichever of entries and loop is not sent', { loop: false }, service => {
    const ids = twoScenes(service);
    assert.ok(service.setSong({ entries: [{ sceneId: ids.second, repeats: 2 }], loop: true }).ok);
    assert.ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 5 }] }).ok);
  }, project => assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 5 }], loop: false })),
  song('an empty song is the first scene once; a loop that is not exactly true is off', { entries: [], loop: 'yes' }, twoScenes,
    project => assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 1 }], loop: false })),
  song('entries that are not a list are an empty song', { entries: 'all of them', loop: true }, undefined,
    project => assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[0].id, repeats: 1 }], loop: true })),
  song('a song request with nothing in it changes nothing but still emits and saves', {}, kickOn, unchangedScenes),
  song('a key that is undefined is not sent: it keeps what the song has', { entries: undefined, loop: undefined }, service => {
    const ids = twoScenes(service);
    assert.ok(service.setSong({ entries: [{ sceneId: ids.second, repeats: 2 }], loop: true }).ok);
  }, project => assert.deepEqual(project.song, { entries: [{ sceneId: project.scenes[1].id, repeats: 2 }], loop: true })),
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
    service => {
      const keep = addGuest(service, 'https://other.example/'), id = addGuest(service);
      service.changeGuest(id, { state: { a: 1 } });
      service.changeGuest(keep, { state: { b: 2 } });
      service.createScene();
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
    service => { const id = dressed(service); service.createScene(); return id; },
    project => { for (const scene of project.scenes) assert.deepEqual(Object.keys(scene).filter(key => key !== 'color').sort(), ['drums', 'id', 'lanes', 'mutes', 'name']); }),
  guestRemove('a guest that does not exist cannot be removed', { status: 404, error: 'Guest not found' }, service => { addGuest(service); return NO_GUEST; }),

  ...drumCases,
  ...effectCases,
  ...laneCases,
  ...patternCases,
  ...comingAndGoingCases,
  ...sceneCases,
];

for (const entry of cases) {
  test(`${entry.op} | ${entry.title}`, async () => {
    const service = setup();
    const ctx = await entry.arrange?.(service);
    service.flush();
    const before = service.snapshot();
    const result = applied(service, store => entry.run(store, ctx));
    const project = service.snapshot();

    assert.notEqual(result.data, undefined, 'an operation always answers with something');
    if (entry.error !== undefined) {
      assert.equal(result.status, entry.status);
      assert.deepEqual(result.data, { error: entry.error });
      assert.deepEqual(result.events, [], 'a refused operation emits nothing');
      assert.equal(result.saved, false, 'and saves nothing');
      assert.deepEqual(project, before, 'and has changed nothing');
    } else {
      assert.equal(result.status, 200);
      const answer = entry.answerFrom ? comparable(entry.answerFrom(project)) : entry.answer;
      assert.deepEqual(comparable(result.data), answer);
      assert.deepEqual(comparable(result.events), entry.silent ? [] : [{ type: entry.event, data: 'eventData' in entry ? entry.eventData : answer }]);
      assert.equal(result.saved, OP_META[entry.op].save, 'an accepted operation saves when OP_META says so');
    }
    entry.check?.(project);
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
    'setDrumSettings', 'setDrumSample', 'setDrumMix', 'setDrumFx', 'setEffectsLoop', 'setTempo', 'setSynthParams', 'setSynthModel', 'setSynthMix', 'setSynthPrefs', 'writePattern', 'createLane', 'removeLane', 'playLane', 'stopLane', 'addGuest', 'changeGuest', 'removeGuest', 'selectScene', 'createScene', 'renameScene', 'deleteScene', 'replaceScenes', 'setSong', 'getScenes', 'getTempo', 'getDrumKits',
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

// These put a reducer in the place of a real one for a moment, to try what no real reducer does:
// an outcome that is refused and yet names an event and a save, one that does not save, and one
// with no answer. They are about `apply`, not about the operation named. Every operation has a
// reducer now, so the real one is put back afterwards.
function standIn<T>(type: 'scene.select' | 'scene.delete', reducer: (...args: any[]) => unknown, run: (service: LocalProjectService) => T): T {
  const held = (reducers as Record<string, unknown>)[type];
  assert.equal(typeof held, 'function', `${type} has no reducer to stand in for`);
  (reducers as Record<string, unknown>)[type] = reducer;
  try { return run(setup()); } finally { (reducers as Record<string, unknown>)[type] = held; }
}

test('a refused operation is answered, not thrown: no event, no notice, no save', () => {
  standIn('scene.delete', () => ({ ok: false, status: 400, error: 'Not now', save: true, event: { type: 'sceneChanged', data: {} } }), service => {
    const before = service.snapshot();
    let notices = 0;
    service.subscribeOps(() => { notices++; });
    const result = applied(service, target => target.apply({ type: 'scene.delete', sceneId: 'a' }));
    assert.deepEqual(result, { status: 400, data: { error: 'Not now' }, events: [], saved: false });
    assert.deepEqual(service.apply({ type: 'scene.delete', sceneId: 'a' }), { ok: false, status: 400, error: 'Not now' });
    assert.equal(notices, 0);
    assert.deepEqual(service.snapshot(), before);
  });
});

test('an operation that does not save is still announced, with saved false, and its answer is a copy', () => {
  standIn('scene.select', ({ state }: any) => ({ ok: true, value: state.song, event: { type: 'sceneChanged', data: { synthId: 1 } } }), service => {
    const notices: OpNotice[] = [];
    service.subscribeOps(notice => notices.push(notice));
    let answer: any;
    const result = applied(service, target => (answer = target.apply({ type: 'scene.select', sceneId: 'a' })));
    assert.deepEqual(result.events, [{ type: 'sceneChanged', data: { synthId: 1 } }]);
    assert.equal(result.saved, false);
    assert.deepEqual(notices.map(notice => notice.saved), [false]);
    answer.value.loop = true;
    assert.equal(service.getScenes().song.loop, false, 'changing the answer does not reach the store');
  });
});

test('a reducer that answers with nothing is a mistake apply reports, before anything is saved or sent', () => {
  standIn('scene.select', () => ({ ok: true, value: undefined, save: true, event: { type: 'sceneChanged', data: { synthId: 1 } } }), service => {
    const seen: Message[] = [];
    let notices = 0;
    service.subscribe(message => seen.push(message));
    service.subscribeOps(() => { notices++; });
    seen.length = 0;
    assert.throws(() => service.apply({ type: 'scene.select', sceneId: 'a' }), /The reducer for scene\.select answered with nothing/);
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

// A change must be an object: anything else is "Invalid local operation data", before the guest is looked for.
test('a change to a guest that is not an object is refused', () => {
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
  assert.deepEqual(service.snapshot(), before);
});

test('a change to the drum sends or the effects that is not an object is refused', () => {
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
  assert.deepEqual(service.snapshot(), before);
});

// An operation can name a lane with anything, and only the lane's own number finds it.
test('a lane named by anything but its number is not found, and a sound that is not an object is refused first', () => {
  const service = setup();
  bright(service);
  service.flush();
  const before = service.snapshot();
  const missing = { status: 404, data: { error: 'Synth not found' }, events: [], saved: false };
  for (const synthId of ['1', 1.5, 0, -1, 9, Number.NaN, undefined, null, [1], true]) {
    assert.deepEqual(applied(service, target => target.setSynthParams(wrong(synthId), { gain: 1 })), missing);
    assert.deepEqual(applied(service, target => target.setSynthModel(wrong(synthId), { modelId: 'dx7' })), missing);
    assert.deepEqual(applied(service, target => target.setSynthMix(wrong(synthId), { muted: true })), missing);
    assert.deepEqual(applied(service, target => target.setSynthPrefs(wrong(synthId), { octaveShift: 1 })), missing);
  }
  const loop: Record<string, unknown> = {};
  loop.loop = loop;
  const refused = { status: 400, data: { error: 'Invalid local operation data' }, events: [], saved: false };
  for (const patch of [null, undefined, [], [{ gain: 1 }], 'gain', 7, Number.NaN, loop, () => ({ gain: 1 })]) {
    assert.deepEqual(applied(service, target => target.setSynthParams(1, wrong(patch))), refused);
    assert.deepEqual(applied(service, target => target.setSynthParams(3, wrong(patch))), refused, 'checked before the lane is looked for, as a body was');
  }
  assert.deepEqual(service.snapshot(), before);
});

test('the store keeps nothing of a lane operation\'s own objects', () => {
  const service = setup();
  const patch = { filter: { frequency: 1234 }, fxSends: { reverb: .5, delay: 0, drive: 0, phaser: 0, chorus: 0 } };
  const result = service.setSynthParams(1, patch);
  assert.ok(result.ok);
  patch.filter.frequency = 99;
  patch.fxSends.reverb = 0;
  result.value.filter.frequency = 50;
  const macros = { macro1: .9 };
  const modelResult = service.setSynthModel(1, { modelId: 'juno-106', modelParams: macros });
  assert.ok(modelResult.ok);
  macros.macro1 = 0;
  modelResult.value.modelParams.macro2 = 0;
  const viewed = service.setSynthPrefs(1, { octaveShift: 1 });
  assert.ok(viewed.ok);
  viewed.value.pattern.steps[0].active = true;
  viewed.value.synthParams.gain = 0;
  const kept = service.snapshot().synths[0];
  assert.deepEqual([kept.synthParams.filter.frequency, kept.synthParams.fxSends.reverb, kept.synthModelParams.macro1, kept.synthModelParams.macro2, kept.pattern.steps[0].active, kept.synthParams.gain], [1234, .5, .9, .5, false, 1]);
  service.flush();
});

// useStudio hears a sound only through the synthUpdate event, which is also the one thing that
// hands the sound to the audio. A model change is followed by its macros' sound, and undo sends
// the sound, the model, the tempo and the mix one after another: each must have arrived whole,
// with the lane's number, before the next begins, and the view must send nothing.
test('each lane edit is delivered before the next begins, and a view change sends nothing', () => {
  const service = setup();
  const heard: Message[] = [];
  service.subscribe(message => heard.push(message));
  heard.length = 0;
  service.setSynthModel(1, { modelId: 'juno-106' });
  assert.deepEqual(heard.map(message => message.type), ['synthModelUpdate']);
  service.setSynthParams(1, { filter: { frequency: 900 } });
  assert.deepEqual(heard.map(message => message.type), ['synthModelUpdate', 'synthUpdate']);
  assert.deepEqual([heard[1].data.synthId, heard[1].data.parameters.filter.frequency], [1, 900]);
  assert.deepEqual(heard[1].data.parameters, service.snapshot().synths[0].synthParams);
  service.setTempo(90);
  service.setSynthMix(1, { muted: true });
  service.setSynthPrefs(1, { octaveShift: 2, keyboardMode: 'piano-roll' });
  assert.deepEqual(heard.map(message => message.type), ['synthModelUpdate', 'synthUpdate', 'tempoChange', 'synthMix']);
  assert.deepEqual(heard[3].data, { synthId: 1, muted: true, solo: false });
  assert.equal(service.snapshot().synths[0].octaveShift, 2);
  service.flush();
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

// An instrument named after a property every object has used to find that property: the four
// edits that read the lane threw (a TypeError, and a SyntaxError for the settings), and the mute
// and the sample were written onto the property itself, `__proto__` being the object every other
// object inherits from, and answered as a change that changed no lane. Now each is an unknown
// instrument, refused like any other, and nothing is touched.
test('an instrument named after a built-in property is an unknown instrument, and nothing is written onto the property', () => {
  const builtIns = ['constructor', 'toString', '__proto__'];
  for (const name of builtIns) assert.ok(({} as Record<string, unknown>)[name], `the old lookup found ${name} on a plain object`);
  const refused = { status: 404, data: { error: NO_LANE }, events: [], saved: false };
  const edits: Array<[string, (service: LocalProjectService, name: string) => Applied<unknown>]> = [
    ['drum.step', (service, name) => service.setDrumStep(wrong(name), 0, true)],
    ['drum.stepVelocity', (service, name) => service.setDrumStepVelocity(wrong(name), 0, .5)],
    ['drum.stepDetail', (service, name) => service.setDrumStepDetail(wrong(name), 0, { ratchet: 2 })],
    ['drum.settings', (service, name) => service.setDrumSettings(wrong(name), { volume: 1 })],
    ['drum.sample', (service, name) => service.setDrumSample(wrong(name), SAMPLE)],
    ['drum.mix', (service, name) => service.setDrumMix(wrong(name), { muted: true })],
  ];
  const service = setup();
  const before = service.snapshot();
  for (const name of builtIns) {
    for (const [op, edit] of edits) assert.deepEqual(applied(service, target => edit(target, name)), refused, `${op} ${name}`);
  }
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  assert.equal(storage.has(STORAGE_KEY), false, 'nothing was scheduled');
  const everyObject = Object.prototype as Record<string, any>;
  for (const holder of [everyObject, ({} as Record<string, any>).constructor, ({} as Record<string, any>).toString]) {
    assert.equal(holder.muted, undefined, 'no mute was written onto a built-in property');
    assert.equal(holder.sampleId, undefined, 'and no sample');
  }
  assert.equal(({} as Record<string, any>).muted, undefined, 'and every object is as it was');
});

test('before the service is initialized the typed way throws', () => {
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
  assert.throws(() => new LocalProjectService().setTempo(120), message);
  assert.throws(() => new LocalProjectService().setSynthParams(1, {}), message);
  assert.throws(() => new LocalProjectService().setSynthModel(1, {}), message);
  assert.throws(() => new LocalProjectService().setSynthMix(1, {}), message);
  assert.throws(() => new LocalProjectService().setSynthPrefs(1, {}), message);
  assert.throws(() => new LocalProjectService().getTempo(), message);
  assert.throws(() => new LocalProjectService().getScenes(), message);
});

test('the store keeps nothing of a pattern operation\'s own objects', () => {
  const service = setup();
  const id = service.snapshot().synths[0].pattern.id;
  const patch = { name: 'Mine', steps: stepsWith({ 0: { active: true, note: 'C4', velocity: .8, notes: ['E4'] } }) };
  const result = service.writePattern(1, id, patch);
  assert.ok(result.ok);
  patch.steps[0].notes![0] = 'G4';
  patch.steps[0].active = false;
  patch.steps.pop();
  patch.name = 'Changed';
  result.value.steps[0].velocity = 0;
  result.value.steps[1].active = true;
  const kept = service.snapshot().synths[0];
  assert.deepEqual([kept.pattern.name, kept.pattern.steps.length, kept.pattern.steps[0], kept.pattern.steps[1].active], ['Mine', 16, { active: true, note: 'C4', velocity: .8, notes: ['E4'] }, false]);
  assert.deepEqual(kept.patterns, [kept.pattern]);
  service.flush();
});

// Two cells painted in one frame: the second is built from the pattern the first left, which
// the first's event has already put in front of the listener, with nothing else changed.
test('each pattern write is delivered whole before the next begins, and a second write builds on the first', () => {
  const service = setup();
  const id = service.snapshot().synths[0].pattern.id;
  let open = service.snapshot().synths[0].pattern;
  const seen: Message[] = [];
  service.subscribe(message => { seen.push(message); if (message.type === 'patternUpdated') open = message.data.pattern; });
  for (const index of [0, 5, 9]) {
    const next = { ...open, steps: open.steps.map((step, at) => (at === index ? { ...step, active: true, note: 'C4' } : step)) };
    assert.ok(service.writePattern(1, id, next).ok);
    assert.deepEqual(open.steps.flatMap((step, at) => (step.active ? [at] : [])), [0, 5, 9].filter(at => at <= index));
  }
  assert.deepEqual(seen.slice(1).map(message => message.type), Array(3).fill('patternUpdated'));
  assert.equal(service.snapshot().synths[0].patterns.length, 1);
  service.flush();
});

test('pattern.write is saved, undoable and shared', () => {
  assert.deepEqual(OP_META['pattern.write'], { save: true, undoable: true, share: true });
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

test('the read methods answer as copies, without saving', () => {
  const service = setup();
  assert.ok(service.setDrumStep('kick', 3, true).ok);
  service.flush();
  let writes = 0;
  service.subscribeWrites(() => { writes++; });

  assert.deepEqual(service.getTempo(), { tempo: 120 });
  assert.equal(service.getDrumKits().defaultKitId, 'clean-analog');
  assert.equal(service.getDrumKits().kits.length, DRUM_KITS.length);
  const scenes = service.getScenes();
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

// Song playback changes scene from inside the scheduler's timing loop and reads the lanes and
// drums on the next line. That works only because the store has delivered sceneChanged, and the
// handler has written the refs, before the call returns. This stands a listener in for the
// handler and reads what it wrote with no turn of the event loop in between.
test('opening a scene is finished when selectScene returns: what the listener keeps holds it on the next line', () => {
  const service = setup();
  const ids = twoScenes(service);
  assert.ok(service.setDrumStep('snare', 5, true).ok);
  const refs = { scene: '', kick: [] as boolean[], snare: [] as boolean[], scenes: 0, lane: [] as unknown[] };
  service.subscribe(message => {
    if (message.type !== 'sceneChanged') return;
    refs.scene = message.data.currentSceneId;
    refs.kick = message.data.drumState.kick.steps;
    refs.snare = message.data.drumState.snare.steps;
    refs.lane = message.data.synths[0].pattern.steps;
    refs.scenes = message.data.scenes.length;
  });
  const result = service.selectScene(ids.first);
  assert.ok(!(result instanceof Promise), 'the answer is not a promise');
  assert.equal(refs.scene, ids.first);
  assert.deepEqual([refs.kick[3], refs.snare[5], refs.scenes], [true, false, 2]);
  assert.equal(refs.lane.length, 16);
  assert.equal(service.snapshot().currentSceneId, ids.first, 'and the store itself has moved on');

  assert.ok(service.selectScene(ids.second).ok);
  assert.equal(refs.scene, ids.second);
  assert.deepEqual([refs.kick[3], refs.snare[5]], [false, true]);
  service.flush();
});

test('every scene operation is delivered before it returns, and none answers with a promise', () => {
  const service = setup();
  const seen: string[] = [];
  service.subscribe(message => seen.push(message.type));
  seen.length = 0;
  const first = service.getScenes().currentSceneId;
  for (const change of [
    () => service.createScene(), () => service.renameScene(first, 'Verse'), () => service.setSong({ loop: true }),
    () => service.selectScene(first), () => service.deleteScene(first), () => service.replaceScenes(),
  ]) {
    const result = change();
    assert.ok(!(result instanceof Promise));
    assert.ok(result.ok);
    assert.deepEqual(seen, ['sceneChanged']);
    seen.length = 0;
  }
  service.flush();
});

test('a new scene\'s id is refused when it is empty, too long, not text or already in the project', () => {
  const service = setup();
  const first = service.getScenes().currentSceneId;
  service.flush();
  const before = service.snapshot();
  const seen: Message[] = [];
  service.subscribe(message => seen.push(message));
  seen.length = 0;
  for (const sceneId of ['', 'x'.repeat(201), 7, null, undefined]) {
    assert.deepEqual(service.apply({ type: 'scene.create', sceneId: wrong(sceneId) }), { ok: false, status: 400, error: 'That is not an id a scene can have.' });
  }
  assert.deepEqual(service.apply({ type: 'scene.create', sceneId: first }), { ok: false, status: 409, error: 'That scene is already in the project.' });
  assert.deepEqual(seen, []);
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  const kept = service.apply({ type: 'scene.create', sceneId: 'x'.repeat(200) });
  assert.ok(kept.ok && kept.value.currentSceneId === 'x'.repeat(200));
  assert.equal(service.apply({ type: 'scene.create', sceneId: 'y' }).ok, true);
  service.flush();
});

test('the id a scene is given is the one it has, so the same operation makes the same scene', () => {
  const one = setup(), two = setup();
  for (const service of [one, two]) {
    assert.ok(service.setDrumStep('kick', 3, true).ok);
    assert.ok(service.apply({ type: 'scene.create', sceneId: 'mine', name: 'Same', empty: true }).ok);
  }
  assert.equal(one.snapshot().scenes[1].id, 'mine');
  assert.deepEqual(one.snapshot().scenes[1], two.snapshot().scenes[1]);
  one.flush(); two.flush();
});

test('the store keeps nothing of a scene or song operation\'s own objects', () => {
  const service = setup();
  const [scene] = service.getScenes().scenes;
  const scenes = [{ ...scene, id: 'a', name: 'A' }, { ...scene, id: 'b', name: 'B' }];
  const entries = [{ sceneId: 'a', repeats: 2 }];
  const replacement = { scenes, currentSceneId: 'a', song: { entries, loop: true } };
  const result = service.replaceScenes(replacement);
  assert.ok(result.ok);
  scenes[1].name = 'changed';
  scenes[1].drums.kick.steps[0] = true;
  entries[0].repeats = 9;
  replacement.song.loop = false;
  result.value.scenes[1].name = 'also changed';
  assert.deepEqual(service.getScenes().scenes.map(entry => entry.name), ['A', 'B']);
  assert.equal(service.snapshot().scenes[1].drums.kick.steps[0], false);
  assert.deepEqual(service.getScenes().song, { entries: [{ sceneId: 'a', repeats: 2 }], loop: true });

  const next = { entries: [{ sceneId: 'b', repeats: 3 }], loop: false };
  assert.ok(service.setSong(next).ok);
  next.entries[0].repeats = 1;
  next.entries.push({ sceneId: 'a', repeats: 1 });
  assert.deepEqual(service.getScenes().song, { entries: [{ sceneId: 'b', repeats: 3 }], loop: false });
  service.flush();
});

// Undo puts back the whole project, so every edit to the scenes and the song is undone. Opening a
// scene is moving about in the project, not an edit.
test('scene operations are saved, undone and shared, and opening a scene is not undone', () => {
  for (const type of ['scene.signature', 'scene.create', 'scene.rename', 'scene.color', 'scene.copyPart', 'scene.delete', 'scene.replace', 'song.set'] as const) {
    assert.deepEqual(OP_META[type], { save: true, undoable: true, share: true }, type);
  }
  assert.deepEqual(OP_META['scene.select'], { save: true, undoable: false, share: true });
});

// The studio is not run by these tests, so the two things the plan asks of it are read from its
// source: the scheduler's scene change is a plain call with nothing awaited, and a scene handler
// that leaves the open scene collects the guests' settings before the change.
test('the scheduler opens a scene with a plain call, and a scene change waits for the guests first', () => {
  const source = readFileSync(new URL('../src/studio/useStudio.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(source.includes('localRequest'), false, 'useStudio makes no route call at all');
  const from = source.indexOf('scheduleTickRef.current = ');
  const tick = source.slice(from, source.indexOf('const lanes = synthsRef.current;', from));
  const calls = (tick.match(/^.*selectScene.*$/gm) ?? []).filter(line => !line.trim().startsWith('//'));
  assert.deepEqual(calls.map(line => line.trim()), ['localService.selectScene(position.sceneId);']);
  assert.match(source, /if \(leavesScene\) await guestLink\.captureAll\(\);\n\s+const result = change\(\);/);
  for (const handler of ['handleSceneSelect', 'handleSceneAdd', 'handleSceneDelete']) {
    assert.match(source, new RegExp(`const ${handler} = useCallback\\(.*sceneChange\\(\\(\\) => localService\\.\\w+\\([^)]*\\)\\), \\[sceneChange\\]\\)`), handler);
  }
  for (const handler of ['handleSceneRename', 'handleSongChange']) assert.match(source, new RegExp(`${handler}[\\s\\S]*?, false\\)`), handler);
});

// Undo is the store's: the studio records nothing by hand and only asks for a step.
test('the studio leaves undo to the store', () => {
  const source = readFileSync(new URL('../src/studio/useStudio.tsx', import.meta.url), 'utf8');
  for (const gone of ['pushHistorySnapshot', 'historyRef', 'applySnapshot', 'getSnapshot']) assert.equal(source.includes(gone), false, gone);
  assert.ok(source.includes('const handleUndo = useCallback(() => { localService.undo(); }, []);'));
  assert.ok(source.includes('const handleRedo = useCallback(() => { localService.redo(); }, []);'));
});
