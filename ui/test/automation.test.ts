import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATABLE, SEND_PARAMS, stepSends, MAX_AUTOMATED, automatedKeys, automatedParams, automationAt, automationChange, canAutomate, copyAutomationBar, describeValue, fitAutomation,
  layAutomationAlong, resizeAutomationBars, resizeAutomationEachBar, sanitizeAutomation, sentAutomation, splitAutomated, stepVoiceParams, stepsThrough, toUnit,
  voiceKeysOf, withAutomationValues, withParamValues, withoutAutomation,
} from '../src/services/automation.ts';
import { LANE_PARAMS, fromUnit, lanePatch } from '../src/services/paramTargets.ts';
import { sceneAsBars } from '../src/services/patternLength.ts';
import { songBars } from '../src/services/songPlayback.ts';
import { sanitizePattern, sanitizeScenes } from '../src/services/projectSanitization.ts';
import { effectsTail, renderSynthBars, renderSynthLane, sendTimeline, type ExportArrangement } from '../src/services/wavExport.ts';
import { MAX_SHARE_LENGTH, decodeShare, encodeShare } from '../src/services/shareLink.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { SynthCore } from '../../engine/src/synth/SynthCore.ts';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import { defaults, ok, setup } from './helpers/store.ts';
import type { Automation, Pattern, Scene, SequencerStep, SynthParameters } from '../src/types.ts';

const SR = 44100;
const off = (): SequencerStep => ({ active: false, velocity: 0.7 });
const on = (note: string, extra: Partial<SequencerStep> = {}): SequencerStep => ({ active: true, note, velocity: 0.8, ...extra });
const steps = (count: number, notes: Record<number, SequencerStep> = {}) => Array.from({ length: count }, (_, index) => notes[index] ?? off());
const row = (count: number, values: Record<number, number> = {}): Array<number | null> => Array.from({ length: count }, (_, index) => values[index] ?? null);
const lane = (service: LocalProjectService, id = 1) => service.snapshot().synths.find((synth: any) => synth.synthId === id);
const openScene = (service: LocalProjectService) => { const project = service.snapshot(); return project.scenes.find((scene: Scene) => scene.id === project.currentSceneId) as Scene; };
const write = (service: LocalProjectService, patch: Partial<Pattern>, id = 1) => ok(service.writePattern(id, lane(service, id).pattern.id, patch));
const fresh = async () => { const service = setup(); await service.openLibrary(createMemoryLibrary()); return service; };
// A saw held through every step, so the filter is what is heard move.
const saw = (): SynthParameters => {
  const sound = createDefaultSynthParameters();
  sound.oscillator.type = 'sawtooth';
  sound.filter = { ...sound.filter, type: 'lowpass', frequency: 400, q: 0.7, envAmount: 0 };
  sound.envelope = { attack: 0.001, decay: 0.05, sustain: 1, release: 0.01 };
  sound.effects.reverb.wet = 0; sound.effects.delay.wet = 0;
  return sound;
};
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / samples.reduce((sum, value) => sum + value * value, 1e-30);

test('what can be automated is a lane\'s own numbers that the voice plays, each one of the voice\'s parameters', () => {
  assert.ok(AUTOMATABLE.includes('cutoff') && AUTOMATABLE.includes('level') && AUTOMATABLE.includes('pan') && AUTOMATABLE.includes('attack'));
  for (const key of ['macro1', 'macro2', 'macro3', 'macro4', 'duck']) assert.equal(AUTOMATABLE.includes(key), false, `${key} is not automated in this version`);
  // The sends are, on their own path: they are levels in the mixer, not the voice's.
  for (const key of ['reverbSend', 'delaySend', 'chorusSend', 'auxASend', 'auxBSend']) assert.ok(AUTOMATABLE.includes(key), key);
  for (const key of AUTOMATABLE) {
    assert.ok(LANE_PARAMS[key].path, `${key} is named in the one table of lane parameters`);
    if (SEND_PARAMS.includes(key)) { assert.deepEqual(voiceKeysOf(key), [], `${key} is nothing of the voice's`); continue; }
    assert.equal(voiceKeysOf(key).length, 1, `${key} is one parameter of the voice: ${voiceKeysOf(key)}`);
  }
  assert.deepEqual(voiceKeysOf('cutoff'), ['filterFreq']);
  assert.deepEqual(voiceKeysOf('level'), ['gain']);
  assert.equal(new Set(AUTOMATABLE.flatMap(voiceKeysOf)).size, AUTOMATABLE.length - SEND_PARAMS.length, 'no two share one');
});

test('automation from a file is held to known parameters, their ranges, the pattern\'s length and eight parameters', () => {
  assert.equal(sanitizeAutomation(undefined, 16), undefined);
  assert.equal(sanitizeAutomation([], 16), undefined);
  assert.equal(sanitizeAutomation('cutoff', 16), undefined);
  assert.equal(sanitizeAutomation({}, 16), undefined, 'none is stored as nothing');
  assert.equal(sanitizeAutomation({ cutoff: row(16) }, 16), undefined, 'a parameter with no value is dropped');
  assert.equal(sanitizeAutomation({ cutoff: 'high', level: { 0: 1 } }, 16), undefined);
  const hostile = sanitizeAutomation({
    cutoff: [1e9, -5, 'x', Number.NaN, null, 800, Number.POSITIVE_INFINITY, { valueOf: () => 4 }, ...Array(100).fill(900)],
    detune: [12.6, 5000], macro1: [0.5], duck: [1], constructor: [1], __proto__: [1], tempo: [90],
  }, 8)!;
  assert.deepEqual(Object.keys(hostile), ['cutoff', 'detune']);
  assert.deepEqual(hostile.cutoff, [20000, 20, null, null, null, 800, null, null], 'clamped, and exactly as long as the pattern');
  assert.deepEqual(hostile.detune, [13, 100, null, null, null, null, null, null], 'a whole-number parameter is a whole number');
  const many = sanitizeAutomation(Object.fromEntries(AUTOMATABLE.map(key => [key, [LANE_PARAMS[key].min]])), 4)!;
  assert.equal(Object.keys(many).length, MAX_AUTOMATED);
  assert.deepEqual(Object.keys(many), AUTOMATABLE.slice(0, MAX_AUTOMATED), 'in the table\'s order, so the same automation is always stored the same way');

  assert.equal('automation' in sanitizePattern({ id: 'a', steps: steps(16) }, 120)!, false, 'a pattern with none has no such key');
  assert.equal('automation' in sanitizePattern({ id: 'a', steps: steps(16), automation: {} }, 120)!, false);
  assert.deepEqual(sanitizePattern({ id: 'a', steps: steps(16), automation: { cutoff: [500, 600] } }, 120)!.automation, { cutoff: row(16, { 0: 500, 1: 600 }) });
  assert.deepEqual(sanitizePattern({ id: 'a', steps: steps(32), bars: 2, automation: { cutoff: row(64, { 31: 500, 40: 600 }) } }, 120)!.automation, { cutoff: row(32, { 31: 500 }) }, 'cut to the steps there are');
});

test('every edit that moves a lane\'s steps has its match for the automation', () => {
  const automation: Automation = { cutoff: [100, 200, null, 400], level: [null, null, 1.5, null] };
  assert.deepEqual(resizeAutomationBars(automation, 4, 2), { cutoff: [100, 200, null, 400, 100, 200, null, 400], level: [null, null, 1.5, null, null, null, 1.5, null] }, 'growing repeats what is there');
  assert.deepEqual(resizeAutomationBars({ cutoff: [1000, null, null, null, null, null, 300, null] }, 4, 1), { cutoff: [1000, null, null, null] }, 'shrinking keeps the first bars');
  assert.equal(resizeAutomationBars({ cutoff: [null, null, null, null, null, null, 300, null] }, 4, 1), undefined, 'and a parameter left with nothing is gone');
  assert.deepEqual(resizeAutomationEachBar(automation, 4, 3), { cutoff: [100, 200, null], level: [null, null, 1.5] }, 'a shorter bar loses its end');
  assert.deepEqual(resizeAutomationEachBar({ cutoff: [100, 200, 300, 400] }, 2, 3), { cutoff: [100, 200, null, 300, 400, null] }, 'a longer bar gains empty steps at its end, in every bar');
  assert.deepEqual(copyAutomationBar({ cutoff: [100, null, 300, 400, null, 600] }, 2, 0, [2]), { cutoff: [100, null, 300, 400, 100, null] }, 'an empty step is copied as empty');
  assert.deepEqual(layAutomationAlong({ cutoff: [100, null, 300] }, 5), { cutoff: [100, null, 300, 100, null] });
  assert.deepEqual(layAutomationAlong({ cutoff: [null, null, 300] }, 2), undefined);
  assert.deepEqual(fitAutomation({ cutoff: [100, 200] }, 4), { cutoff: [100, 200, null, null] });
  for (const change of [resizeAutomationBars, resizeAutomationEachBar]) assert.equal(change(undefined, 16, 2), undefined, 'none stays none');
  assert.deepEqual(automation, { cutoff: [100, 200, null, 400], level: [null, null, 1.5, null] }, 'nothing handed in is changed');
  assert.deepEqual(sentAutomation(undefined), {}, 'none is sent as an empty list, because the store keeps what it has when nothing is sent');
});

test('a value is set on a step or taken off it, a parameter is cleared, and a lane holds eight at most', () => {
  let automation = withAutomationValues(undefined, 'cutoff', [2, 3], 5e6, 4);
  assert.deepEqual(automation, { cutoff: [null, null, 20000, 20000] }, 'held to the range');
  automation = withAutomationValues(automation, 'cutoff', [3, 9, -1, 1.5], null, 4);
  assert.deepEqual(automation, { cutoff: [null, null, 20000, null] }, 'steps that are not there are ignored');
  assert.equal(withAutomationValues(automation, 'cutoff', [2], null, 4), undefined, 'the last value gone, so is the parameter');
  assert.equal(withAutomationValues(automation, 'macro1', [0], 0.5, 4), automation, 'not a parameter that can be automated');
  assert.equal(withoutAutomation(automation, 'cutoff'), undefined);
  assert.deepEqual(withoutAutomation({ ...automation, level: [1, null, null, null] }, 'cutoff'), { level: [1, null, null, null] });
  const full = Object.fromEntries(AUTOMATABLE.slice(0, MAX_AUTOMATED).map(key => [key, [LANE_PARAMS[key].max]]));
  const ninth = AUTOMATABLE[MAX_AUTOMATED];
  assert.equal(canAutomate(full, ninth), false);
  assert.equal(canAutomate(full, AUTOMATABLE[0]), true, 'one that is automated already can still be drawn');
  assert.equal(withAutomationValues(full, ninth, [0], LANE_PARAMS[ninth].min, 1), full, 'a ninth is not started');
  assert.deepEqual(automatedKeys(full), AUTOMATABLE.slice(0, MAX_AUTOMATED));
});

test('a step plays its own values over the sound and the sound where it has none', () => {
  const sound = saw(), before = JSON.stringify(sound);
  const automation: Automation = { cutoff: [1000, null], resonance: [null, 5], pan: [-0.5, 0.25] };
  assert.deepEqual(automationAt(automation, 0), { cutoff: 1000, pan: -0.5 });
  assert.deepEqual(automationAt(automation, 7), {});
  const first = automatedParams(sound, automation, 0);
  assert.equal(first.filter.frequency, 1000);
  assert.equal(first.filter.q, sound.filter.q, 'no value on this step: the sound\'s own');
  assert.equal(first.pan, -0.5);
  assert.equal(first.filter.type, sound.filter.type, 'the rest of the sound is as it was');
  assert.equal(automatedParams(sound, undefined, 0), sound, 'no automation: the very same sound');
  assert.equal(JSON.stringify(sound), before, 'the lane\'s own sound is never changed');
  assert.equal(stepVoiceParams(sound, undefined, 0, 120), null, 'a lane without automation is sent nothing');
  assert.deepEqual(stepVoiceParams(sound, automation, 0, 120), { pan: -0.5, filterFreq: 1000, filterQ: sound.filter.q }, 'every automated parameter is sent each step, at the sound\'s own value where the step has none');
  assert.deepEqual(stepVoiceParams(sound, automation, 1, 120), { pan: 0.25, filterFreq: 400, filterQ: 5 });
  assert.deepEqual(stepVoiceParams(sound, automation, 1, 120, { cutoff: 9000 }), { pan: 0.25, filterFreq: 9000, filterQ: 5 }, 'a knob being recorded plays where it is');
  assert.deepEqual(stepVoiceParams(sound, undefined, 1, 120, { level: 0.25 }), { gain: 0.25 });
  // A parameter the step before set and this one does not goes back to the sound's own.
  const voice = toVoiceParams(sound, 120);
  assert.deepEqual(automationChange({ filterFreq: 900, gain: 2 }, { filterFreq: 300 }, voice), { gain: sound.gain, filterFreq: 300 });
  assert.deepEqual(automationChange({ filterFreq: 900 }, null, voice), { filterFreq: 400 });
  assert.equal(automationChange(null, null, voice), null);
  assert.equal(withParamValues(sound, { macro1: 1 }), sound);
});

test('a knob\'s change is split into what is recorded and what is still a change to the sound', () => {
  const sound = saw();
  const knob = splitAutomated({ filter: { ...sound.filter, frequency: 2000 } }, sound);
  assert.deepEqual(knob.moved, { cutoff: 2000 }, 'a knob sends the whole filter; only what differs from the sound has moved');
  assert.equal(knob.rest, null, 'and nothing is left to change in the sound');
  const tied = splitAutomated(lanePatch('level', 1.25), sound);
  assert.deepEqual([tied.moved, tied.rest], [{ level: 1.25 }, null], 'a controller\'s knob sends the one value');
  const mixed = splitAutomated({ filter: { ...sound.filter, frequency: 2000, type: 'highpass' } }, sound);
  assert.deepEqual(mixed.moved, { cutoff: 2000 });
  assert.deepEqual(mixed.rest, { filter: { ...sound.filter, type: 'highpass' } }, 'what cannot be automated is still made, with the recorded parameter put back');
  const other = splitAutomated({ duck: 0.9, voiceMode: 'mono' }, sound);
  assert.deepEqual(other.moved, {});
  assert.deepEqual(other.rest, { duck: 0.9, voiceMode: 'mono' }, 'the duck is not automated: the change is the sound\'s');
  const send = splitAutomated({ fxSends: { ...sound.fxSends, reverb: 0.9 } }, sound);
  assert.deepEqual([send.moved, send.rest], [{ reverbSend: 0.9 }, null], 'a send is recorded like any other knob');
  assert.deepEqual(splitAutomated({ filter: { ...sound.filter } }, sound), { moved: {}, rest: null }, 'a change that changes nothing');
  const refused = splitAutomated({ filter: { ...sound.filter, frequency: 2000 } }, sound, () => false);
  assert.deepEqual([refused.moved, refused.rest], [{}, { filter: { ...sound.filter, frequency: 2000 } }], 'a lane that can automate no more: the knob changes the sound as it always did');
});

test('the steps a held knob has passed, and a value as a share of its range', () => {
  assert.deepEqual(stepsThrough(2, 5, 16), [3, 4, 5]);
  assert.deepEqual(stepsThrough(14, 1, 16), [15, 0, 1], 'round the end of the pattern');
  assert.deepEqual(stepsThrough(4, 4, 16), []);
  assert.deepEqual(stepsThrough(4, 4, 4, true), [0, 1, 2, 3], 'the pattern has been right round since');
  assert.deepEqual(stepsThrough(0, 0, 0), []);
  for (const key of AUTOMATABLE) {
    const range = LANE_PARAMS[key];
    assert.ok(Math.abs(toUnit(range, range.min)) < 1e-9 && Math.abs(toUnit(range, range.max) - 1) < 1e-9, key);
    for (const unit of [0.1, 0.5, 0.9]) assert.ok(Math.abs(toUnit(range, fromUnit(range, unit)) - unit) < (range.whole ? 0.01 : 1e-4), `${key} at ${unit}`);
  }
  assert.equal(describeValue('cutoff', 1234), '1.2k');
  assert.equal(describeValue('level', 1.5), '150%');
  assert.equal(describeValue('detune', -12), '-12');
  assert.equal(describeValue('attack', 0.25), '0.25');
});

test('the store keeps automation with the pattern: written, kept by other writes, cleared only when told', () => {
  const service = setup();
  const events: any[] = [];
  service.subscribe(message => { if (message.type === 'patternUpdated') events.push(message.data.pattern); });
  const written = write(service, { automation: { cutoff: [300, 99999, null, 500], bogus: [1] } as Automation });
  assert.deepEqual(written.automation, { cutoff: row(16, { 0: 300, 1: 20000, 3: 500 }) });
  assert.deepEqual(events.at(-1).automation, written.automation, 'the event carries it as the store kept it');
  assert.deepEqual(write(service, { steps: steps(16, { 0: on('C3') }) }).automation, written.automation, 'a write of steps alone keeps it');
  assert.deepEqual(write(service, { name: 'Bass' }).automation, written.automation);
  assert.deepEqual(write(service, { steps: steps(32), bars: 2 }).automation, { cutoff: row(32, { 0: 300, 1: 20000, 3: 500 }) }, 'a write that changes the length and says nothing of it holds it to the new length');
  assert.equal('automation' in write(service, { automation: sentAutomation(undefined) }), false, 'an empty list takes it away');
  assert.equal('automation' in lane(service).pattern, false);
  assert.equal(JSON.stringify(service.exportProject()).includes('utomation'), false, 'and a project with none stores nothing new');
});

test('a scene holds each lane\'s automation, and the live pattern is the truth for the open scene', () => {
  const service = setup();
  ok(service.createLane(2));
  const first = service.snapshot().currentSceneId;
  write(service, { steps: steps(16, { 0: on('C3') }), automation: { cutoff: row(16, { 0: 300, 8: 3000 }) } });
  assert.deepEqual(openScene(service).laneAutomation, { 1: { cutoff: row(16, { 0: 300, 8: 3000 }) } }, 'committed with the steps; a lane with none is not listed');
  // An edit to something else, then a look at the scene: the first edit must not lose it.
  ok(service.setSceneColor(first, 'red'));
  ok(service.setDrumStep('kick', 0, true));
  assert.deepEqual(openScene(service).laneAutomation?.[1].cutoff[8], 3000);

  const copy = ok(service.createScene()).currentSceneId as string;
  assert.deepEqual(lane(service).pattern.automation, { cutoff: row(16, { 0: 300, 8: 3000 }) }, 'a copied scene brings it');
  write(service, { automation: { cutoff: row(16, { 4: 1000 }), level: row(16, { 4: 0.5 }) } });
  ok(service.selectScene(first));
  assert.deepEqual(lane(service).pattern.automation, { cutoff: row(16, { 0: 300, 8: 3000 }) }, 'each scene has its own');
  ok(service.selectScene(copy));
  assert.deepEqual(lane(service).pattern.automation, { level: row(16, { 4: 0.5 }), cutoff: row(16, { 4: 1000 }) });

  const empty = ok(service.createScene({ empty: true })).currentSceneId as string;
  assert.equal('automation' in lane(service).pattern, false, 'an empty scene starts with none');
  assert.equal('laneAutomation' in openScene(service), false);
  ok(service.selectScene(copy));
  assert.equal(lane(service).pattern.automation?.cutoff[4], 1000, 'and going there did not take it from the scene that was left');

  // Copy to: the lane's automation goes with its notes, in place of what the other scene had.
  ok(service.copyPartToScene(first, { synthId: 1 }));
  ok(service.copyPartToScene(empty, { synthId: 1 }));
  const scenes = service.snapshot().scenes as Scene[];
  assert.deepEqual(scenes.find(scene => scene.id === first)!.laneAutomation, { 1: { level: row(16, { 4: 0.5 }), cutoff: row(16, { 4: 1000 }) } });
  assert.deepEqual(scenes.find(scene => scene.id === empty)!.laneAutomation?.[1].level[4], 0.5);
  ok(service.selectScene(empty));
  write(service, { automation: sentAutomation(undefined) });
  ok(service.copyPartToScene(first, { synthId: 1 }));
  assert.equal('laneAutomation' in (service.snapshot().scenes as Scene[]).find(scene => scene.id === first)!, false, 'a lane with none copied over one with some leaves none');
});

test('a new time signature, and Copy to a scene in another, resize the automation as they do the steps', () => {
  const service = setup();
  const first = service.snapshot().currentSceneId;
  write(service, { steps: steps(32, { 16: on('C3') }), bars: 2, automation: { cutoff: row(32, { 0: 100, 11: 200, 12: 300, 15: 400, 16: 500, 31: 600 }) } });
  const second = ok(service.createScene()).currentSceneId as string;
  ok(service.setSceneSignature('3/4'));
  assert.equal(lane(service).pattern.steps.length, 24);
  assert.deepEqual(lane(service).pattern.automation, { cutoff: row(24, { 0: 100, 11: 200, 12: 500 }) }, 'each bar keeps its values from its start and loses those past its new end');
  ok(service.setSceneSignature('5/4'));
  assert.deepEqual(lane(service).pattern.automation, { cutoff: row(40, { 0: 100, 11: 200, 20: 500 }) }, 'a longer bar gains empty steps at its end');
  ok(service.selectScene(first));
  ok(service.copyPartToScene(second, { synthId: 1 }));
  const target = (service.snapshot().scenes as Scene[]).find(scene => scene.id === second)!;
  assert.equal(target.lanes[1].length, 40);
  assert.deepEqual(target.laneAutomation?.[1].cutoff, row(40, { 0: 100, 11: 200, 12: 300, 15: 400, 16: 500, 31: 600, 32: 100 }), 'laid along the other scene\'s bars as the notes are, going round again');
});

test('one bar at a time: a scene cut into bars cuts each lane\'s automation where it cuts its steps', () => {
  const scene: Scene = {
    id: 'a', name: 'A', drums: Object.fromEntries(['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'].map(name => [name, { steps: Array(16).fill(false) }])) as Scene['drums'],
    lanes: { 1: steps(32, { 0: on('C3'), 16: on('D3') }), 2: steps(16, { 0: on('E3') }) }, laneBars: { 1: 2 },
    laneAutomation: { 1: { cutoff: row(32, { 0: 100, 15: 200, 16: 300 }) }, 2: { level: row(16, { 3: 0.5 }) } },
  };
  const bars = sceneAsBars(scene);
  assert.deepEqual(bars.map(bar => bar.laneAutomation?.[1].cutoff), [row(16, { 0: 100, 15: 200 }), row(16, { 0: 300 })]);
  assert.deepEqual(bars.map(bar => bar.laneAutomation?.[2].level), [row(16, { 3: 0.5 }), row(16, { 3: 0.5 })], 'a shorter lane goes round, automation and all');
  const song = songBars({ entries: [{ sceneId: 'a', repeats: 2 }], loop: false }, [scene]);
  assert.deepEqual(song.map(bar => bar.laneAutomation?.[1].cutoff[0]), [100, 300, 100, 300]);
  const plain = sceneAsBars({ ...scene, laneAutomation: undefined });
  assert.equal(plain.some(bar => 'laneAutomation' in bar), false);
  assert.deepEqual(sanitizeScenes([{ ...scene, laneAutomation: { 1: { cutoff: [1e9] }, 3: { cutoff: [500] }, 9: { cutoff: [500] } } }], defaults().drumState)![0].laneAutomation, { 1: { cutoff: row(32, { 0: 20000 }) } }, 'a scene from a file: only lanes it has, held to their lengths');
});

test('a project file carries automation, a hostile one is bounded, and one from before it opens exactly as it was', async () => {
  const service = await fresh();
  ok(service.createLane(2));
  write(service, { steps: steps(32, { 3: on('C3'), 20: on('D3', { length: 5 }) }), bars: 2 });
  write(service, { steps: steps(16, { 7: on('E3') }) }, 2);
  ok(service.setDrumStep('kick', 4, true));
  ok(service.createScene());
  const old = JSON.parse(JSON.stringify(service.exportProject()));
  assert.equal(JSON.stringify(old).includes('utomation'), false, 'a project without automation stores nothing new');
  assert.equal(JSON.stringify(service.normalized(old.project)), JSON.stringify(service.normalized(JSON.parse(JSON.stringify(old.project)))));
  const target = await fresh();
  assert.deepEqual(await target.importProject(JSON.parse(JSON.stringify(old))), { ok: true, repaired: false }, 'not reported as damaged');
  const plain = (project: any) => JSON.parse(JSON.stringify({ scenes: project.scenes, song: project.song, synths: project.synths.map((synth: any) => synth.pattern), drumState: project.drumState }));
  assert.deepEqual(plain(target.snapshot()), plain(old.project));

  write(service, { automation: { cutoff: row(32, { 0: 250, 31: 4000 }), pan: row(32, { 5: -1 }) } });
  ok(service.selectScene(service.snapshot().scenes[0].id));
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const other = await fresh();
  assert.deepEqual(await other.importProject(JSON.parse(JSON.stringify(file))), { ok: true, repaired: false });
  assert.deepEqual((other.snapshot().scenes as Scene[])[1].laneAutomation, { 1: { pan: row(32, { 5: -1 }), cutoff: row(32, { 0: 250, 31: 4000 }) } });
  ok(other.selectScene(other.snapshot().scenes[1].id));
  assert.deepEqual(lane(other).pattern.automation, { pan: row(32, { 5: -1 }), cutoff: row(32, { 0: 250, 31: 4000 }) });
  // Reloading the browser's own copy keeps the open scene's.
  other.flush();
  const reloaded = new LocalProjectService();
  reloaded.initialize(defaults());
  assert.deepEqual(lane(reloaded).pattern.automation, lane(other).pattern.automation);

  const hostile = JSON.parse(JSON.stringify(file));
  hostile.project.scenes[1].laneAutomation = { 1: { cutoff: Array(5000).fill(1e12), constructor: [1], macro1: [1] }, 2: 'x', 7: { cutoff: [1] } };
  hostile.project.synths[0].pattern.automation = { level: [Number.MAX_VALUE, -3, 'loud'], __proto__: { polluted: true } };
  const bounded = (await fresh()).readProjectFile(hostile);
  assert.ok(bounded.ok);
  assert.deepEqual(bounded.project.scenes[1].laneAutomation, { 1: { cutoff: Array(32).fill(20000) } });
  assert.deepEqual(bounded.project.synths[0].pattern.automation, { level: [2, 0, ...Array(bounded.project.synths[0].pattern.steps.length - 2).fill(null)] });
  assert.equal(({} as any).polluted, undefined);
});

test('a link to a song with one parameter automated over eight bars is still an ordinary link', async () => {
  const service = setup();
  write(service, { steps: steps(128, Object.fromEntries(Array.from({ length: 32 }, (_, index) => [index * 4, on('C3')]))), bars: 8 });
  const without = await encodeShare(service.exportProject());
  // A slow sweep up and down, a different value on every step, as a recorded pass leaves.
  write(service, { automation: { cutoff: Array.from({ length: 128 }, (_, step) => fromUnit(LANE_PARAMS.cutoff, 0.5 + 0.45 * Math.sin(step / 9))) } });
  const withSweep = await encodeShare(service.exportProject());
  const decoded = await decodeShare(withSweep) as any;
  assert.equal(decoded.project.synths[0].pattern.automation.cutoff.length, 128);
  assert.ok(withSweep.length - without.length < 1500, `the sweep adds ${withSweep.length - without.length} characters to a link of ${without.length}`);
  assert.ok(withSweep.length < MAX_SHARE_LENGTH / 10, `${withSweep.length}`);
});

test('the voice makes a timed change on its sample, and one that changes nothing leaves the sound bit for bit', () => {
  const sound = saw();
  const play = (schedule: (core: SynthCore) => void) => {
    const core = new SynthCore(SR);
    core.setParams(toVoiceParams(sound, 120));
    core.noteOn({ note: 'C3', duration: 1, time: 0 });
    schedule(core);
    const left = new Float32Array(SR / 2), right = new Float32Array(SR / 2);
    for (let offset = 0; offset < left.length; offset += 128) core.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128));
    return left;
  };
  const plain = play(() => {});
  const same = play(core => { for (let step = 1; step < 8; step++) core.setParams({ filterFreq: 400 }, step * 0.0531); });
  assert.deepEqual(same, plain, 'cutting a block at a change that changes nothing is not heard');
  const opened = play(core => core.setParams({ filterFreq: 8000 }, 0.25));
  const cut = Math.round(0.25 * SR);
  assert.deepEqual(opened.subarray(0, cut), plain.subarray(0, cut), 'nothing moves before its time');
  assert.notDeepEqual(opened.subarray(cut, cut + 2000), plain.subarray(cut, cut + 2000));
  assert.ok(brightness(opened.subarray(cut + 2000)) > brightness(plain.subarray(cut + 2000)) * 4, 'and the filter is open after it');
  const dropped = play(core => { core.setParams({ filterFreq: 8000 }, 0.25); core.clearScheduledParams(); });
  assert.deepEqual(dropped, plain, 'a change still waiting is forgotten when the transport stops');
  const late = play(core => { core.setParams({ filterFreq: 8000 }, 0.3); core.setParams({ filterFreq: 400 }, 0.2); core.setParams({ filterFreq: 8000 }, -1); core.setParams({ filterFreq: 400 }); });
  assert.deepEqual(late.subarray(0, Math.round(0.3 * SR)), plain.subarray(0, Math.round(0.3 * SR)), 'changes are made in the order of their times, and one with no time or a past one is made now');
});

test('an exported sweep is heard, step by step, and is exactly what the live scheduler sends', () => {
  const sound = saw(), tempo = 120, barFrames = SR * 2, stepFrames = barFrames / 16;
  const held = steps(16, { 0: on('C2', { length: 16 }) });
  const sweep: Automation = { cutoff: Array.from({ length: 16 }, (_, step) => (step < 12 ? fromUnit(LANE_PARAMS.cutoff, 0.3 + step * 0.05) : null)) };
  const plain = renderSynthLane({ id: 'p', name: 'p', tempo, steps: held }, sound, tempo, barFrames, SR)[0];
  assert.deepEqual(renderSynthLane({ id: 'p', name: 'p', tempo, steps: held, automation: undefined }, sound, tempo, barFrames, SR)[0], plain);
  assert.deepEqual(renderSynthBars([held], sound, tempo, barFrames, SR, 2, null, undefined, [{ cutoff: row(16) }])[0], plain, 'automation with no values renders as none');
  const own: Automation = { cutoff: Array(16).fill(sound.filter.frequency), level: Array(16).fill(sound.gain) };
  assert.deepEqual(renderSynthBars([held], sound, tempo, barFrames, SR, 2, null, undefined, [own])[0], plain, 'and values that are the sound\'s own are the sound, bit for bit');

  const swept = renderSynthLane({ id: 'p', name: 'p', tempo, steps: held, automation: sweep }, sound, tempo, barFrames, SR)[0];
  const bright = (samples: Float32Array, step: number) => brightness(samples.subarray(step * stepFrames + 1500, (step + 1) * stepFrames));
  const heard = Array.from({ length: 16 }, (_, step) => bright(swept, step)), flat = Array.from({ length: 16 }, (_, step) => bright(plain, step));
  for (let step = 1; step < 12; step++) assert.ok(heard[step] > heard[step - 1] * 1.05, `step ${step + 1} is brighter than the one before: ${heard.map(value => value.toFixed(5))}`);
  assert.ok(heard[11] > flat[11] * 10, 'the top of the sweep is far brighter than the same step without it');
  for (let step = 13; step < 16; step++) assert.ok(Math.abs(heard[step] / flat[step] - 1) < 0.05, `step ${step + 1} has no value and is back at the sound's own cutoff`);
  assert.ok(Math.abs(heard[0] / flat[0] - 1) > 0.05, 'the first step is already the automation\'s');

  // What export hands the voice, against what the scheduler hands it: both ask stepVoiceParams
  // for the step and automationChange for what to send, at the step's own time.
  const sent: Array<[unknown, number | undefined]> = [];
  const setParams = SynthCore.prototype.setParams;
  SynthCore.prototype.setParams = function (update, time) { if (time !== undefined) sent.push([update, time]); return setParams.call(this, update, time); };
  try { renderSynthBars([held, held], sound, tempo, barFrames * 2, SR, 2, null, undefined, [sweep, undefined]); } finally { SynthCore.prototype.setParams = setParams; }
  const live: Array<[unknown, number]> = [];
  let before: ReturnType<typeof stepVoiceParams> = null;
  for (let step = 0; step < 32; step++) {
    const now = stepVoiceParams(sound, step < 16 ? sweep : undefined, step % 16, tempo), change = automationChange(before, now, toVoiceParams(sound, tempo));
    if (change) live.push([change, step * 0.125]);
    before = now;
  }
  assert.deepEqual(sent, live);
  assert.equal(sent.length, 17, 'sixteen steps of the automated bar, and one that puts the cutoff back for the bar without');
  assert.deepEqual(sent[16], [{ filterFreq: sound.filter.frequency }, 2]);
  assert.deepEqual(sent[3], [{ filterFreq: sweep.cutoff[3] }, 0.375]);
  assert.deepEqual(sent[12], [{ filterFreq: sound.filter.frequency }, 1.5], 'a step with no value is sent the sound\'s own');
});

test('a lane\'s sends are automated on a path of their own, and an export moves them where the scheduler does', () => {
  const sound = createDefaultSynthParameters();
  assert.equal(stepSends(sound, undefined, 0), null, 'no automation: the sound\'s sends stand');
  assert.equal(stepSends(sound, { cutoff: [500, null] }, 0), null, 'automation of the voice alone leaves the sends to the sound');
  const automation: Automation = { auxASend: [0.8, null, 0, null] };
  assert.deepEqual(stepSends(sound, automation, 0), { ...sound.fxSends, auxA: 0.8 });
  assert.deepEqual(stepSends(sound, automation, 1), sound.fxSends, 'a step with no value plays the sound\'s own');
  assert.equal(stepSends(sound, automation, 2)!.auxA, 0);
  assert.deepEqual(stepSends(sound, undefined, 0, { reverbSend: 0.5 }), { ...sound.fxSends, reverb: 0.5 }, 'a knob being recorded plays where it is');

  // The export's timeline is the scheduler's sends at each step's start.
  const steps: SequencerStep[] = Array.from({ length: 4 }, off);
  const timeline = sendTimeline([steps, steps], sound, [automation, undefined], [{ start: 0, duration: 2 }, { start: 2, duration: 2 }]);
  assert.deepEqual(timeline.map(entry => entry.time), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(timeline.map(entry => entry.sends.auxA ?? 0), [0.8, sound.fxSends.auxA ?? 0, 0, sound.fxSends.auxA ?? 0, ...Array(4).fill(sound.fxSends.auxA ?? 0)]);
  assert.deepEqual(sendTimeline([steps], sound, [{ cutoff: [500] }], [{ start: 0, duration: 2 }]), [], 'nothing sent where no send is automated');

  // An aux bus that only automation sends to still rings on after the last note.
  const loop = { enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: false, amount: 0, tone: .5 }, phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 }, delay: { enabled: false, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: false, decay: 2, mix: .3 } };
  const arrangement = (automated?: Automation): ExportArrangement => ({
    tempo: 120, drumState: {} as ExportArrangement['drumState'], drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0,
    drumFx: { sends: { reverb: 0, delay: 0, drive: 0, phaser: 0 }, returnLevel: 1 }, effectsLoop: loop,
    synths: [{ id: 1, pattern: { id: 'p', name: 'p', tempo: 120, steps, ...(automated ? { automation: automated } : {}) }, synthParams: sound, muted: false, solo: false }],
  });
  assert.ok(effectsTail(arrangement(automation)) > effectsTail(arrangement()));
});
