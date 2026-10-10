import test from 'node:test';
import assert from 'node:assert/strict';
import { KIDS_PADS, KIDS_SOUNDS, KIDS_STEPS, KIDS_TEMPOS, KIDS_VOLUME, blankKids, isKidsLink, sanitizeKids, starterKids, stepNearest, withNote } from '../src/services/kids.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';

test('kids mode has a few pads that cannot clash, and a capped level', () => {
  assert.equal(KIDS_PADS.length, 9);
  const notes = KIDS_PADS.flatMap(pad => ('note' in pad ? [pad.note.replace(/\d/, '')] : []));
  assert.equal(notes.length, 6);
  assert.ok(notes.every(note => ['C', 'D', 'E', 'G', 'A'].includes(note)), 'every note is in one five-note scale');
  assert.equal(new Set(KIDS_PADS.map(pad => pad.label)).size, 9, 'each pad has its own name');
  assert.ok(KIDS_VOLUME > 0 && KIDS_VOLUME <= 0.6);
  assert.ok(Object.values(KIDS_TEMPOS).every(tempo => tempo >= 70 && tempo <= 120), 'the tempo stays in a gentle range');
  for (const sound of KIDS_SOUNDS) assert.deepEqual(sanitizeSynthParams(sound.params, createDefaultSynthParameters()), sound.params, `${sound.label} is a sound the app would accept`);
  assert.equal(isKidsLink('#kids'), true);
  for (const other of ['', '#', '#kids2', '#song=abc', '#s=abcdefghij']) assert.equal(isKidsLink(other), false, other);
});

test('what kids mode reads from storage is made safe', () => {
  const blank = blankKids();
  assert.equal(blank.notes.length, 9);
  assert.ok(blank.notes.every(row => row.length === KIDS_STEPS && row.every(on => on === false)));
  for (const junk of [null, 7, 'tune', [], { sound: 99, tempo: 'warp', notes: 'all of them' }, { notes: [[1, 'yes', {}]] }]) assert.deepEqual(sanitizeKids(junk), blank, JSON.stringify(junk));

  const kept = sanitizeKids({ sound: 2, tempo: 'fast', notes: [[true, false, true], 'junk', Array(400).fill(true)], extra: 'ignored' });
  assert.equal(kept.sound, 2);
  assert.equal(kept.tempo, 'fast');
  assert.deepEqual(kept.notes[0].slice(0, 4), [true, false, true, false]);
  assert.ok(kept.notes[1].every(on => !on));
  assert.equal(kept.notes[2].length, KIDS_STEPS, 'a row is never longer than the loop');
  assert.equal(kept.notes.length, 9);

  const starter = starterKids();
  assert.ok(starter.notes.some(row => row.some(Boolean)), 'a first visit has a beat to play along to');
  assert.deepEqual(sanitizeKids(JSON.parse(JSON.stringify(starter))), starter);
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
