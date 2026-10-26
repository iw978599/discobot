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
import { songBars, songSeconds } from '../src/services/songPlayback.ts';
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
  // F harmonic minor, sharps for flats: everything but the bridge keeps to its seven notes.
  const F_MINOR = new Set(['F', 'G', 'G#', 'A#', 'C', 'C#', 'D#', 'E']);
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
      assert.equal(scene.tempo, spec.tempo, `${song.name}: ${spec.name} tempo`);
      const laneLength = (lane: number) => (spec.laneBars?.[lane] ?? spec.bars) * per;
      for (const lane of lanes) {
        assert.equal(scene.lanes[lane].length, laneLength(lane), `${song.name}: ${spec.name} lane ${lane}`);
        assert.ok(played(scene.lanes[lane]).every(note => noteNameToMidi(note) !== null));
        // A note never runs past the end of its lane.
        scene.lanes[lane].forEach((step, at) => assert.ok(!step.active || at + (step.length ?? 1) <= laneLength(lane), `${song.name}: ${spec.name} lane ${lane} step ${at}`));
        assert.equal(scene.mutes?.lanes?.[lane]?.muted, Boolean(spec.mutes?.lanes?.includes(lane)), `${song.name}: ${spec.name} lane ${lane} mute`);
      }
      for (const instrument of DRUM_INSTRUMENTS) {
        assert.equal(scene.drums[instrument].steps.length, length);
        assert.equal(scene.mutes?.drums?.[instrument]?.muted, Boolean(spec.mutes?.drums?.includes(instrument)), `${song.name}: ${spec.name} ${instrument} mute`);
      }
      for (const [lane, automation] of Object.entries(spec.automation ?? {})) {
        assert.deepEqual(Object.keys(scene.laneAutomation?.[Number(lane)] ?? {}).sort(), Object.keys(automation!).sort(), `${song.name}: ${spec.name} keeps its automation`);
        for (const values of Object.values(automation!)) assert.equal(values.length, laneLength(Number(lane)));
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

test('every sample song plays all five lanes and lasts at least two minutes', async () => {
  for (const song of SAMPLE_SONGS) {
    const made = await service();
    await made.importProject(build(made, song));
    const state = made.snapshot(), scenes = made.getScenes().scenes as Scene[];
    const byId = (id: string) => scenes.find(scene => scene.id === id)!;
    assert.equal(state.synths.length, 5, `${song.name} has five lanes`);
    const heard = song.order.map(([id]) => byId(id));
    for (const lane of [1, 2, 3, 4, 5]) assert.ok(heard.some(scene => played(scene.lanes[lane]).length > 0 && !scene.mutes?.lanes?.[lane]?.muted), `${song.name} plays lane ${lane}`);
    const seconds = songSeconds(state.song, id => sceneBars(byId(id)), song.tempo, id => byId(id).signature ?? '4/4', id => byId(id).tempo);
    assert.ok(seconds >= 120, `${song.name} lasts two minutes: ${Math.round(seconds)} seconds`);
  }
});

test('the jazz song after Mingus starts with the bass alone, shouts in 6/8, slows to a 4/4 dirge, and gets faster', async () => {
  const song = SAMPLE_SONGS.find(entry => entry.id === 'sixth-street-shout')!;
  const made = await service();
  await made.importProject(build(made, song));
  const state = made.snapshot(), scenes = made.getScenes().scenes as Scene[];
  const byId = (id: string) => scenes.find(scene => scene.id === id)!;
  assert.deepEqual(state.synths.map(lane => lane.name), ['Upright', 'Piano', 'Baritone', 'Tenor Sax', 'Trombone']);
  const intro = byId('shout-bass');
  assert.ok(played(intro.lanes[1]).length > 8 && [3, 4, 5].every(lane => played(intro.lanes[lane]).length === 0), 'the bass begins alone');
  assert.equal(byId('shout-riff').signature, '6/8');
  assert.equal(byId('shout-dirge').signature ?? '4/4', '4/4');
  assert.deepEqual(['shout-dirge', 'shout-riff', 'shout-faster', 'shout-collective'].map(id => byId(id).tempo ?? song.tempo), [66, 150, 168, 184], 'and it speeds up after the dirge');
  assert.ok(state.synths[4].synthParams.portamento?.enabled, 'the trombone slides between its notes');
});

test('the long build plays one figure that gains notes and opens its filter, section by section', async () => {
  const song = SAMPLE_SONGS.find(entry => entry.id === 'long-ascent')!;
  const made = await service();
  await made.importProject(build(made, song));
  const scenes = made.getScenes().scenes as Scene[];
  const byId = (id: string) => scenes.find(scene => scene.id === id)!;
  const notes = ['ascent-seed', 'ascent-sprout', 'ascent-pulse'].map(id => played(byId(id).lanes[2]).length);
  assert.deepEqual(notes, [32, 64, 128], 'four notes a bar, then eight, then sixteen');
  const cutoffs = ['ascent-seed', 'ascent-sprout', 'ascent-pulse', 'ascent-growth', 'ascent-canopy'].map(id => byId(id).laneAutomation![2].cutoff);
  cutoffs.forEach((cutoff, index) => assert.ok(cutoff.at(-1)! > cutoff[0]! && (index === 0 || cutoff[0]! >= cutoffs[index - 1].at(-1)!), 'each section opens the filter further'));
  assert.equal(byId('ascent-seed').drums.kick.steps.some(Boolean), false, 'it begins without the kick');
  assert.ok(played(byId('ascent-summit').lanes[4]).length > 0, 'and the supersaw takes the chords at the summit');
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

test('the space disco song is five minutes long, counting its slower countdown, and shows off scene tempos, mutes, chance and a shorter lane', async () => {
  const song = SAMPLE_SONGS.find(entry => entry.id === 'silver-satellite')!;
  const made = await service();
  const opened = await made.importProject(build(made, song));
  assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false]);
  const state = made.snapshot(), scenes = made.getScenes().scenes as Scene[];
  assert.deepEqual(state.synths.map(lane => lane.name), ['Octave Bass', 'Starship Arp', 'String Machine', 'Magic Lead', 'Clav']);
  const byId = (id: string) => scenes.find(scene => scene.id === id)!;
  const seconds = songSeconds(state.song, id => sceneBars(byId(id)), song.tempo, id => byId(id).signature ?? '4/4', id => byId(id).tempo);
  assert.equal(Math.round(seconds), 300, 'five minutes');
  assert.equal(scenes[0].tempo, 96, 'the countdown at its own tempo');
  const starfield = byId('satellite-starfield');
  assert.deepEqual([starfield.mutes?.lanes?.[1]?.muted, starfield.mutes?.lanes?.[2]?.muted, starfield.mutes?.drums?.kick?.muted], [true, true, true], 'the break is the groove with parts muted');
  assert.ok(played(starfield.lanes[1]).length > 0 && starfield.drums.kick.steps.some(Boolean), 'and their notes are still there');
  assert.equal(byId('satellite-orbit').mutes?.lanes?.[1]?.muted, false, 'and the next scene unmutes them');
  assert.equal(starfield.laneBars?.[4], 2, 'the lead goes round in two bars under eight');
  assert.ok(byId('satellite-orbit').drums.closedHH.stepProbabilities?.some(chance => chance < 1), 'hats left to chance');
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
