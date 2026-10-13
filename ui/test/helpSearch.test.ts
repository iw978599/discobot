import test from 'node:test';
import assert from 'node:assert/strict';
import { helpCount, helpWords, matchHelp } from '../src/services/helpSearch.ts';

const sections = [
  { id: 'start', title: 'Quick start', text: 'Press Play All to start. The Space bar does the same.' },
  { id: 'drums', title: 'Drums', text: 'Each hit has a velocity. “Kick” or “HH Open”; the kit’s effect sends.' },
  { id: 'keys', title: 'Keys', text: 'Tap tempo:   Shift + T\nUndo: Ctrl/Cmd + Z' },
];

test('nothing typed leaves every section, in order', () => {
  assert.deepEqual(matchHelp(sections, ''), ['start', 'drums', 'keys']);
  assert.deepEqual(matchHelp(sections, '   '), ['start', 'drums', 'keys']);
});

test('a word is found in the text or the heading, whatever its capitals', () => {
  assert.deepEqual(matchHelp(sections, 'VELOCITY'), ['drums']);
  assert.deepEqual(matchHelp(sections, 'quick'), ['start']);
  assert.deepEqual(matchHelp(sections, 'undo'), ['keys']);
});

test('every word typed must be in the section, in any order', () => {
  assert.deepEqual(matchHelp(sections, 'bar space'), ['start']);
  assert.deepEqual(matchHelp(sections, 'space velocity'), []);
  assert.deepEqual(matchHelp(sections, '  tap   tempo '), ['keys']);
});

test('part of a word matches, and a word in more than one section shows them all', () => {
  assert.deepEqual(matchHelp(sections, 'temp'), ['keys']);
  assert.deepEqual(matchHelp(sections, 's'), ['start', 'drums', 'keys']);
});

test('a plain apostrophe or quote finds a curly one, and line breaks in the text do not matter', () => {
  assert.deepEqual(matchHelp(sections, "kit's"), ['drums']);
  assert.deepEqual(matchHelp(sections, '"kick"'), ['drums']);
  assert.deepEqual(matchHelp(sections, 'T Undo'), ['keys']);
});

test('nothing matches a word that is nowhere', () => {
  assert.deepEqual(matchHelp(sections, 'zebra'), []);
  assert.deepEqual(matchHelp([], 'kick'), []);
});

test('the words of a search are lower case with the spaces gone', () => {
  assert.deepEqual(helpWords('  Tap\tTEMPO '), ['tap', 'tempo']);
  assert.deepEqual(helpWords(''), []);
});

test('the count says how many are left, or that nothing is, and is empty with nothing typed', () => {
  assert.equal(helpCount(6, 6, ''), '');
  assert.equal(helpCount(6, 6, '  '), '');
  assert.equal(helpCount(2, 6, 'kick'), '2 of 6 sections match.');
  assert.equal(helpCount(1, 6, 'kick'), '1 of 6 sections matches.');
  assert.equal(helpCount(0, 6, ' zebra '), 'Nothing in Help matches “zebra”.');
});
