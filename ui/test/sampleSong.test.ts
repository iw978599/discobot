import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '@discobot/engine';
import { SAMPLE_SONG_NAME, SAMPLE_SONG_SOUNDS, SAMPLE_SONG_TEMPO, buildSampleSong } from '../src/services/sampleSong.ts';
import { STARTERS, starterDrums, starterPattern } from '../src/services/starters.ts';
import { createBuiltInPresets } from '../src/services/builtInPresets.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { stepNotes } from '../src/services/noteScheduling.ts';
import { noteNameToMidi } from '../src/utils/midiExport.ts';
import { sceneBars } from '../src/services/patternLength.ts';
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
const IN_KEY = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const played = (steps: SequencerStep[]) => steps.flatMap(step => stepNotes(step));

test('the sample song opens as a new project of its own: five scenes, three lanes with sounds, and a song in order', async () => {
  const made = await service();
  const before = made.snapshot().projectId;
  const file = buildSampleSong(made.exportProject(), createBuiltInPresets());
  assert.ok(file);
  const opened = await made.importProject(file);
  assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false], 'it is a sound project: nothing in it had to be repaired');
  const state = made.snapshot();
  assert.notEqual(state.projectId, before, 'the project that was open is left as it was');
  assert.equal(state.name, SAMPLE_SONG_NAME);
  assert.equal(state.tempo, SAMPLE_SONG_TEMPO);

  const scenes = made.getScenes().scenes as Scene[];
  assert.deepEqual(scenes.map(scene => scene.name), ['Intro', 'Verse', 'Chorus', 'Break', 'Outro']);
  assert.equal(new Set(scenes.map(scene => scene.color)).size, 5, 'each has a colour of its own');
  for (const scene of scenes) {
    assert.equal(sceneBars(scene), 4, scene.name);
    for (const lane of [1, 2, 3]) assert.equal(scene.lanes[lane].length, 64, `${scene.name} lane ${lane}`);
    for (const instrument of DRUM_INSTRUMENTS) {
      assert.equal(scene.drums[instrument].steps.length, 64);
      assert.ok(scene.drums[instrument].stepVelocities!.every(value => value > 0 && value <= 1));
    }
    const notes = [1, 2, 3].flatMap(lane => played(scene.lanes[lane]));
    assert.ok(notes.length > 0 && notes.every(note => IN_KEY.has(note[0]) && !note.includes('#') && noteNameToMidi(note) !== null), `${scene.name} is in key`);
    assert.ok(played(scene.lanes[2]).length === 12, `${scene.name} has its four chords`);
  }
  const chorus = scenes[2], verse = scenes[1], intro = scenes[0], breakdown = scenes[3];
  assert.ok(played(chorus.lanes[3]).length > 20 && played(verse.lanes[3]).length === 0, 'the tune comes in at the chorus');
  assert.ok(played(chorus.lanes[1]).length > played(verse.lanes[1]).length, 'and the bass gets busier');
  assert.ok(played(intro.lanes[1]).length === 0 && !breakdown.drums.kick.steps.some(Boolean), 'the intro has no bass and the break no kick');
  assert.ok(chorus.drums.crash.steps[0] && chorus.drums.crash.steps.filter(Boolean).length === 1);
  // A note never runs past the end of its scene.
  for (const scene of scenes) for (const lane of [1, 2, 3]) scene.lanes[lane].forEach((step, index) => assert.ok(index % 16 + (step.length ?? 1) <= 16 || !step.active));

  assert.deepEqual(state.song.entries.map(entry => entry.repeats), [1, 2, 2, 1, 2, 1]);
  assert.equal(songBars(state.song, scenes).length, 36, 'nine passes of four bars');
  // The lanes on the rack are the first scene, with the sounds chosen, and nothing is muted.
  const sounds = createBuiltInPresets();
  state.synths.forEach((lane, index) => {
    assert.deepEqual(lane.pattern.steps, scenes[0].lanes[lane.synthId]);
    const sound = sounds.find(entry => entry.id === SAMPLE_SONG_SOUNDS[index])!;
    assert.equal(lane.synthModelId, sound.modelId);
    assert.equal(lane.synthParams.gain, sound.params.gain);
    assert.equal(lane.muted || lane.solo, false);
  });
  assert.deepEqual(state.synths.map(lane => lane.synthId), [1, 2, 3]);
});

test('the sample song is made from whatever project is open, and from nothing if that is not a project', async () => {
  const made = await service();
  made.removeLane(3);
  made.removeLane(2);
  made.setDrumMix('kick', { muted: true });
  const file = buildSampleSong(made.exportProject(), createBuiltInPresets());
  const opened = await made.importProject(file);
  assert.equal(opened.ok, true);
  assert.equal(made.snapshot().synths.length, 3, 'a project with one lane still gives a song of three');
  assert.equal(made.snapshot().drumState.kick.muted, false);
  for (const nothing of [null, {}, { project: {} }, { project: { synths: [] } }]) assert.equal(buildSampleSong(nothing, createBuiltInPresets()), null);
  assert.equal(buildSampleSong(made.exportProject(), []), null, 'and from nothing if a sound it needs is missing');
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
