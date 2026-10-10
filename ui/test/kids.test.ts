import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KIDS_BEAT_ROWS, KIDS_BEAT_STEPS, KIDS_PADS, KIDS_PAD_ORDER, KIDS_SOUNDS, KIDS_STEPS, KIDS_TEMPOS, KIDS_VOLUME,
  blankKids, isKidsLink, padSounds, sanitizeKids, starterKids, stepNearest, withBeatToggled, withNote,
} from '../src/services/kids.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';

test('kids mode has pads that cannot clash, sounds the app would accept, and a capped level', () => {
  assert.equal(KIDS_PADS.length, 12);
  const notes = KIDS_PADS.flatMap(pad => ('note' in pad ? [pad.note] : []));
  assert.equal(notes.length, 8);
  assert.equal(new Set(notes).size, 8, 'no two pads are the same note');
  assert.ok(notes.every(note => ['C', 'D', 'E', 'G', 'A'].includes(note.replace(/\d/, ''))), 'every note is in one five-note scale');
  const drums = KIDS_PADS.flatMap(pad => ('drum' in pad ? [pad.drum] : []));
  assert.equal(new Set(drums).size, 4, 'each drum pad is a drum of its own');
  assert.equal(new Set(KIDS_PADS.map(pad => pad.label)).size, 12, 'each pad has its own name');
  assert.equal(new Set(KIDS_PADS.map(pad => pad.picture)).size, 12, 'and its own picture');
  assert.deepEqual(
    KIDS_PADS.slice(0, 9).map(pad => ('note' in pad ? pad.note : pad.drum)),
    ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'kick', 'clap', 'closedHH'],
    'the first nine are where a tune saved before the others were added expects them',
  );
  assert.deepEqual([...KIDS_PAD_ORDER].sort((a, b) => a - b), KIDS_PADS.map((_, index) => index), 'every pad is on the screen once');

  assert.equal(KIDS_BEAT_ROWS.length, 4);
  assert.equal(new Set(KIDS_BEAT_ROWS).size, 4);
  assert.ok(KIDS_BEAT_ROWS.every(pad => 'drum' in KIDS_PADS[pad]), 'each row of the beat grid is a drum pad');
  assert.equal(KIDS_STEPS % KIDS_BEAT_STEPS, 0, 'the beat goes round a whole number of times in the loop');

  assert.ok(KIDS_VOLUME > 0 && KIDS_VOLUME <= 0.6);
  assert.ok(Object.values(KIDS_TEMPOS).every(tempo => tempo >= 70 && tempo <= 120), 'the tempo stays in a gentle range');
  assert.equal(KIDS_SOUNDS.length, 6);
  assert.deepEqual(KIDS_SOUNDS.slice(0, 4).map(sound => sound.label), ['Bell', 'Piano', 'Horn', 'Robot'], 'a saved choice of sound still means the same sound');
  assert.equal(new Set(KIDS_SOUNDS.map(sound => sound.label)).size, 6);
  for (const sound of KIDS_SOUNDS) {
    assert.deepEqual(sanitizeSynthParams(sound.params, createDefaultSynthParameters()), sound.params, `${sound.label} is a sound the app would accept`);
    assert.ok(sound.params.gain <= 0.8 && Object.values(sound.params.fxSends).every(send => send === 0), `${sound.label} is no louder than the others`);
  }
  assert.equal(isKidsLink('#kids'), true);
  for (const other of ['', '#', '#kids2', '#song=abc', '#s=abcdefghij']) assert.equal(isKidsLink(other), false, other);
});

test('what kids mode reads from storage is made safe', () => {
  const blank = blankKids();
  assert.equal(blank.notes.length, 12);
  assert.ok(blank.notes.every(row => row.length === KIDS_STEPS && row.every(on => on === false)));
  assert.equal(blank.beat.length, 4);
  assert.ok(blank.beat.every(row => row.length === KIDS_BEAT_STEPS && row.every(on => on === false)));
  assert.equal(blank.screen, 'pads');
  for (const junk of [
    null, 7, 'tune', [], { sound: 99, tempo: 'warp', notes: 'all of them' }, { notes: [[1, 'yes', {}]] },
    { beat: 'boom', screen: 'settings' }, { beat: [[1, 'yes', null], 7], screen: 4 }, { sound: 2.5, beat: { 0: [true] } },
  ]) assert.deepEqual(sanitizeKids(junk), blank, JSON.stringify(junk));

  const kept = sanitizeKids({
    sound: 5, tempo: 'fast', screen: 'beat', extra: 'ignored',
    notes: [[true, false, true], 'junk', Array(400).fill(true), ...Array(20).fill([true])],
    beat: [[false, true], 'junk', Array(400).fill(true), [true], [true], [true]],
  });
  assert.equal(kept.sound, 5);
  assert.equal(kept.tempo, 'fast');
  assert.equal(kept.screen, 'beat');
  assert.deepEqual(kept.notes[0].slice(0, 4), [true, false, true, false]);
  assert.ok(kept.notes[1].every(on => !on));
  assert.equal(kept.notes[2].length, KIDS_STEPS, 'a row is never longer than the loop');
  assert.equal(kept.notes.length, 12, 'and there is never a row without a pad');
  assert.deepEqual(kept.beat[0], [false, true, false, false, false, false, false, false]);
  assert.ok(kept.beat[1].every(on => !on));
  assert.deepEqual(kept.beat[2], Array(KIDS_BEAT_STEPS).fill(true), 'a row of the beat is never longer than its bar');
  assert.equal(kept.beat.length, 4);
  assert.equal(sanitizeKids({ sound: 6 }).sound, 0, 'a sound that is not there becomes the first');

  const starter = starterKids();
  assert.ok(starter.beat.some(row => row.some(Boolean)), 'a first visit has a beat to play along to');
  assert.ok(starter.notes.every(row => !row.some(Boolean)), 'and no tune yet');
  assert.deepEqual(sanitizeKids(JSON.parse(JSON.stringify(starter))), starter);
});

test('a tune kept before the beat grid and the newer pads still loads as it was', () => {
  const row = (...steps: number[]) => Array.from({ length: 16 }, (_, step) => steps.includes(step));
  const old = { sound: 3, tempo: 'fast', notes: [row(1), row(), row(5, 9), row(), row(), row(15), row(0, 4, 8, 12), row(2, 6, 10, 14), row(3)] };
  const loaded = sanitizeKids(JSON.parse(JSON.stringify(old)));
  assert.equal(loaded.sound, 3);
  assert.equal(KIDS_SOUNDS[loaded.sound].label, 'Robot');
  assert.equal(loaded.tempo, 'fast');
  assert.deepEqual(loaded.notes.slice(0, 9), old.notes, 'every tap is on the pad and the step it was');
  assert.ok(loaded.notes.slice(9).every(steps => steps.length === KIDS_STEPS && !steps.some(Boolean)), 'the new pads start empty');
  assert.deepEqual(loaded.beat, blankKids().beat, 'the beat grid starts empty, so the tune sounds as it did');
  assert.equal(loaded.screen, 'pads');
  for (let count = 0; count < 32; count++) {
    for (let pad = 0; pad < KIDS_PADS.length; pad++) assert.equal(padSounds(loaded, pad, count), old.notes[pad]?.[count % 16] ?? false, `pad ${pad} at ${count}`);
  }
});

test('a tap is kept on the step it was nearest to', () => {
  const last = { count: 10, time: 5, duration: 0.375 };
  assert.equal(stepNearest(last, 5), 10);
  assert.equal(stepNearest(last, 5.15), 10, 'a little late is still this step');
  assert.equal(stepNearest(last, 5.2), 11, 'past halfway belongs to the next');
  assert.equal(stepNearest(last, 4.7), 9, 'a step that is scheduled but not yet heard');
  assert.equal(stepNearest({ count: 0, time: 5, duration: 0.375 }, 1), 0, 'never before the start');

  const blank = blankKids(), once = withNote(blank, 3, 5);
  assert.equal(once.notes[3][5], true);
  assert.equal(blank.notes[3][5], false, 'the old state is left alone');
  assert.equal(withNote(once, 3, 5), once, 'tapping a step that is already on changes nothing');
  assert.equal(withNote(once, 99, 5), once);
  assert.equal(withNote(once, 3, 99), once);
});

test('the beat grid turns a hit on and off, and plays with the pads without doubling a drum', () => {
  const blank = blankKids(), on = withBeatToggled(blank, 1, 3);
  assert.equal(on.beat[1][3], true);
  assert.equal(blank.beat[1][3], false, 'the old state is left alone');
  assert.equal(on.beat.flat().filter(Boolean).length, 1);
  assert.deepEqual(withBeatToggled(on, 1, 3), blank, 'a second touch empties it again');
  assert.equal(withBeatToggled(on, 9, 3), on);
  assert.equal(withBeatToggled(on, 1, 8), on);
  assert.equal(withBeatToggled(on, -1, 0), on);

  const row = 1, pad = KIDS_BEAT_ROWS[row];
  assert.equal(padSounds(on, pad, 3), true);
  assert.equal(padSounds(on, pad, 11), true, 'the beat comes round twice in the loop');
  assert.equal(padSounds(on, pad, 19), true, 'and carries on after it');
  assert.equal(padSounds(on, pad, 4), false);
  assert.ok(KIDS_PADS.every((_, other) => other === pad || !padSounds(on, other, 3)), 'no other pad plays for it');

  const both = withNote(on, pad, 3);
  assert.equal(padSounds(both, pad, 3), true, 'a drum tapped where the beat already has it is one hit, not two');
  const tune = withNote(blank, 0, 12);
  assert.equal(padSounds(tune, 0, 12), true);
  assert.equal(padSounds(tune, 0, 28), true);
  assert.equal(padSounds(tune, 0, 4), false, 'a tapped note plays once in the loop, not once a bar');
  assert.equal(padSounds(tune, 99, 0), false);
});
