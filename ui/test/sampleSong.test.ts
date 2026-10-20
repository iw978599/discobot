import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '@discobot/engine';
import { buildSampleSong, type SampleSong } from '../src/services/sampleSong.ts';
import { SAMPLE_SONGS } from '../src/services/sampleSongs.ts';
import { auxBuses } from '../src/services/auxSettings.ts';
import { STARTERS, starterDrums, starterPattern } from '../src/services/starters.ts';
import { createBuiltInPresets } from '../src/services/builtInPresets.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { stepNotes } from '../src/services/noteScheduling.ts';
import { noteNameToMidi } from '../src/utils/midiExport.ts';
import { barSteps, sceneBars } from '../src/services/patternLength.ts';
import { songBars } from '../src/services/songPlayback.ts';
import type { DrumState, EffectsLoopState, Scene, SequencerStep } from '../src/types.ts';

const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};
async function service() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const made = new LocalProjectService();
  made.initialize({
    synthParams: createDefaultSynthParameters(),
    drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
      steps: Array(16).fill(false), settings: { volume: .8, tone: .5, extra: .5, tune: 0, humanize: .35, pan: 0 }, muted: false, solo: false,
    }])) as DrumState,
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0, chorus: 0 }, returnLevel: .7 },
    effectsLoop,
  });
  await made.openLibrary(createMemoryLibrary());
  return made;
}
// A minor, with the one note of the G chord that is outside the five the tune uses.
const played = (steps: SequencerStep[]) => steps.flatMap(step => stepNotes(step));

const build = (made: LocalProjectService, song: SampleSong) => buildSampleSong(made.exportProject(), createBuiltInPresets(), song);

const NIGHT = SAMPLE_SONGS[0];

test('Night Circuit opens as a new project of its own: dark synthwave in F minor on five named lanes', async () => {
  const made = await service();
  const before = made.snapshot().projectId;
  const file = build(made, NIGHT);
  assert.ok(file);
  const opened = await made.importProject(file);
  assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false], 'it is a sound project: nothing in it had to be repaired');
  const state = made.snapshot();
  assert.notEqual(state.projectId, before, 'the project that was open is left as it was');
  assert.equal(state.name, 'Night Circuit');
  assert.equal(state.tempo, 104);
  assert.deepEqual(state.synths.map(lane => lane.name), ['Pulse Bass', 'Arp', 'Night Pad', 'Screamer', 'Brass Stabs']);

  const scenes = made.getScenes().scenes as Scene[];
  assert.deepEqual(scenes.map(scene => scene.name), ['Ignition', 'Pulse', 'Run', 'Undertow', 'Overdrive', 'Shutdown']);
  // F minor, sharps for flats: everything but the bridge keeps to its seven notes.
  const F_MINOR = new Set(['F', 'G', 'G#', 'A#', 'C', 'C#', 'D#']);
  for (const scene of scenes.filter(entry => entry.name !== 'Undertow')) {
    const notes = [1, 2, 3, 4, 5].flatMap(lane => played(scene.lanes[lane] ?? []));
    assert.ok(notes.length > 0 && notes.every(note => F_MINOR.has(note.replace(/\d+$/, ''))), `${scene.name} is in F minor`);
  }
  const bridge = [1, 2, 3, 4, 5].flatMap(lane => played(scenes.find(scene => scene.name === 'Undertow')!.lanes[lane] ?? []));
  assert.ok(bridge.some(note => note.startsWith('F#')) && bridge.some(note => note.startsWith('E')), 'the bridge turns to G flat and C major');

  const [bass, arp, , lead] = state.synths;
  assert.ok(bass.synthParams.duck! > 0, 'the bass is pushed down by every kick');
  assert.equal(arp.synthParams.arpeggiator.enabled, true, 'the chords run through the arpeggiator');
  assert.ok(lead.synthParams.fxSends.drive > 0 && state.effectsLoop.drive.kind === 'overdrive', 'the lead screams through the overdrive');
  assert.equal(scenes[0].drums.kick.steps.some(Boolean), false, 'it opens without a kick');
});

test('every sample song opens sound and whole: its time signatures, sounds, swing, effects, percussion and automation all kept', async () => {
  const sounds = createBuiltInPresets();
  assert.ok(SAMPLE_SONGS.length >= 5 && new Set(SAMPLE_SONGS.map(song => song.id)).size === SAMPLE_SONGS.length);
  assert.ok(new Set(SAMPLE_SONGS.flatMap(song => song.scenes.map(scene => scene.signature ?? '4/4'))).size >= 5, 'they are in many time signatures');
  for (const song of SAMPLE_SONGS) {
    const made = await service();
    const opened = await made.importProject(build(made, song));
    assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false], `${song.name} opens with nothing repaired`);
    const state = made.snapshot(), scenes = made.getScenes().scenes as Scene[], lanes = song.lanes.map((_, index) => index + 1);
    assert.equal(state.name, song.name);
    assert.deepEqual(state.synths.map(lane => lane.synthId), lanes, `${song.name} has its lanes`);
    assert.equal(state.tempo, song.tempo);
    assert.equal(state.drumSwing, song.drumSwing ?? 0);
    assert.equal(state.selectedDrumKitId, song.kit);
    assert.deepEqual(scenes.map(scene => scene.id), song.scenes.map(scene => scene.id));
    for (const [index, spec] of song.scenes.entries()) {
      const scene = scenes[index], per = barSteps(spec.signature), length = spec.bars * per;
      assert.equal(scene.signature ?? '4/4', spec.signature ?? '4/4', `${song.name}: ${spec.name}`);
      assert.equal(sceneBars(scene), spec.bars, `${song.name}: ${spec.name} bars`);
      for (const lane of lanes) {
        assert.equal(scene.lanes[lane].length, length, `${song.name}: ${spec.name} lane ${lane}`);
        assert.ok(played(scene.lanes[lane]).every(note => noteNameToMidi(note) !== null));
        // A note never runs past the end of its scene.
        scene.lanes[lane].forEach((step, at) => assert.ok(!step.active || at + (step.length ?? 1) <= length, `${song.name}: ${spec.name} lane ${lane} step ${at}`));
      }
      for (const instrument of DRUM_INSTRUMENTS) assert.equal(scene.drums[instrument].steps.length, length);
      for (const [lane, automation] of Object.entries(spec.automation ?? {})) {
        assert.deepEqual(Object.keys(scene.laneAutomation?.[Number(lane)] ?? {}).sort(), Object.keys(automation!).sort(), `${song.name}: ${spec.name} keeps its automation`);
        for (const values of Object.values(automation!)) assert.equal(values.length, length);
      }
      const sounding = lanes.some(lane => played(scene.lanes[lane]).length > 0) || DRUM_INSTRUMENTS.some(instrument => scene.drums[instrument].steps.some(Boolean));
      assert.ok(sounding, `${song.name}: ${spec.name} plays something`);
    }
    assert.ok(song.order.every(([id]) => song.scenes.some(scene => scene.id === id)));
    state.synths.forEach((lane, index) => {
      const spec = song.lanes[index], sound = sounds.find(entry => entry.id === spec.preset)!;
      assert.ok(sound, `${song.name}: ${spec.preset}`);
      assert.equal(lane.synthModelId, sound.modelId);
      assert.equal(Boolean(lane.swing), Boolean(spec.swing));
      assert.equal(lane.name, spec.name, `${song.name}: lane ${index + 1} is called what the song calls it`);
      assert.ok(spec.name, `${song.name}: lane ${index + 1} has a name`);
      assert.ok(lane.synthModelId !== 'generic' || lane.preset, `${song.name}: lane ${index + 1} is a model or says its preset, never Generic`);
      const sends = (spec.sound?.fxSends ?? {}) as Record<string, number>;
      for (const [key, value] of Object.entries(sends)) assert.equal((lane.synthParams.fxSends as unknown as Record<string, number>)[key], value, `${song.name}: ${spec.preset} ${key}`);
    });
    for (const [instrument, settings] of Object.entries(song.drums ?? {})) {
      const kept = state.drumState[instrument as 'kick'].settings as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(settings!)) assert.equal(kept[key], value, `${song.name}: ${instrument} ${key}`);
    }
    const aux = (song.effects as { aux?: unknown[] } | undefined)?.aux;
    if (aux) assert.deepEqual(auxBuses(state.effectsLoop.aux), aux, `${song.name} keeps its aux buses`);
  }
});

test('the post-rock song is seven minutes long on all five lanes, and builds by its automation', async () => {
  const song = SAMPLE_SONGS.find(entry => entry.id === 'lanterns')!;
  const made = await service();
  await made.importProject(build(made, song));
  const state = made.snapshot(), scenes = made.getScenes().scenes as Scene[];
  assert.equal(state.synths.length, 5);
  const seconds = songBars(state.song, scenes).length * 4 * 60 / song.tempo;
  assert.ok(seconds >= 6.5 * 60 && seconds <= 7.5 * 60, `about seven minutes: ${seconds} seconds`);
  const rise = scenes.find(scene => scene.id === 'lanterns-rise')!.laneAutomation![4];
  assert.ok(rise.level[0]! < 0.05 && rise.level.at(-1)! > rise.level[0]! * 10, 'the wall climbs out of nothing');
  assert.ok(rise.cutoff.at(-1)! > rise.cutoff[0]! * 5 && rise.drive.at(-1)! > rise.drive[0]!, 'and brightens and dirties as it does');
  const fall = scenes.find(scene => scene.id === 'lanterns-fall')!.laneAutomation![4];
  assert.equal(fall.level.at(-1), 0, 'and dies away again in the Fall');
});

test('a sample song is made from whatever project is open, and from nothing if that is not a project', async () => {
  const made = await service();
  made.removeLane(3);
  made.removeLane(2);
  made.setDrumMix('kick', { muted: true });
  const opened = await made.importProject(build(made, NIGHT));
  assert.equal(opened.ok, true);
  assert.equal(made.snapshot().synths.length, 5, 'a project with one lane still gives a song of all its lanes');
  assert.equal(made.snapshot().drumState.kick.muted, false);
  for (const nothing of [null, {}, { project: {} }, { project: { synths: [] } }]) assert.equal(buildSampleSong(nothing, createBuiltInPresets(), NIGHT), null);
  assert.equal(buildSampleSong(made.exportProject(), [], NIGHT), null, 'and from nothing if a sound it needs is missing');
});

test('a starting beat has hits of different strengths, and the bass its own', () => {
  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { steps: Array(32).fill(false), settings: { volume: 0.8 } }])) as unknown as DrumState;
  for (const starter of STARTERS) {
    const beat = starterDrums(starter, drums);
    const strengths = new Set(DRUM_INSTRUMENTS.flatMap(instrument => beat[instrument].steps.flatMap((on, step) => (on ? [beat[instrument].stepVelocities![step]] : []))));
    assert.ok(strengths.size >= 3, `${starter.name} has loud, middling and quiet hits`);
    for (const instrument of DRUM_INSTRUMENTS) {
      const track = beat[instrument];
      assert.equal(track.stepVelocities!.length, 32);
      // Both bars are alike, a step with no hit is at full strength for when one is put there, and every strength is for a hit there is.
      track.steps.forEach((on, step) => {
        assert.equal(track.stepVelocities![step], track.stepVelocities![step % 16]);
        if (!on) assert.equal(track.stepVelocities![step], 1);
      });
      for (const step of Object.keys(starter.velocities?.[instrument] ?? {})) assert.ok(starter.drums[instrument]?.includes(Number(step)), `${starter.name}: ${instrument} step ${step} is a hit`);
    }
    const pattern = starterPattern(starter, { id: 'p', name: 'p', tempo: 120, steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 1 })) });
    for (const entry of starter.bass) {
      assert.equal(pattern.steps[entry.step].velocity, entry.velocity ?? 1);
      assert.equal(Boolean(pattern.steps[entry.step].slide), Boolean(entry.slide));
    }
    assert.equal(new Set(starter.bass.map(entry => entry.step)).size, starter.bass.length, `${starter.name}: one bass note to a step`);
  }
});
