import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPEATS, MAX_SONG_ENTRIES, insertSongEntry, moveSongEntry, removeSongEntry, repeatSongEntry, songClock, rowAtSeconds, songLengthBars, songRows } from '../src/services/songPlayback.ts';
import { SONG_VIEWS, asSongView, storedSongView } from '../src/services/songView.ts';
import type { Song } from '../src/types.ts';

const entry = (sceneId: string, repeats = 1) => ({ sceneId, repeats });
const song = (...entries: Song['entries']): Song => ({ entries, loop: false });
const ids = (entries: Song['entries']) => entries.map(item => item.sceneId).join('');
const lengths: Record<string, number> = { a: 1, b: 2, c: 4 };
const lengthOf = (sceneId: string) => lengths[sceneId] ?? 1;

test('a time is minutes and seconds to the nearest second, and never shows sixty seconds', () => {
  assert.deepEqual([0, 4, 59.4, 59.6, 60, 125, 600].map(songClock), ['0:00', '0:04', '0:59', '1:00', '1:00', '2:05', '10:00']);
  assert.deepEqual([-3, NaN].map(songClock), ['0:00', '0:00']);
});

test('each row of a song says where it starts and how long it lasts, for scenes of different lengths', () => {
  const whole = song(entry('a', 2), entry('b', 3), entry('c'), entry('a'));
  const rows = songRows(whole, lengthOf, 120);
  assert.deepEqual(rows.map(row => [row.sceneId, row.repeats, row.passBars, row.bars, row.startBar, row.startSeconds, row.seconds]), [
    ['a', 2, 1, 2, 0, 0, 4],
    ['b', 3, 2, 6, 2, 4, 12],
    ['c', 1, 4, 4, 8, 16, 8],
    ['a', 1, 1, 1, 12, 24, 2],
  ]);
  const last = rows[rows.length - 1];
  assert.equal(last.startBar + last.bars, songLengthBars(whole, lengthOf), 'the rows add up to the whole song');
});

test('the times of a row follow the tempo, and a length that makes no sense counts as one bar', () => {
  assert.deepEqual(songRows(song(entry('b', 2), entry('a')), lengthOf, 60).map(row => [row.startSeconds, row.seconds]), [[0, 16], [16, 4]]);
  assert.deepEqual(songRows(song(entry('a'), entry('a')), () => NaN, 0).map(row => [row.passBars, row.startSeconds, row.seconds]), [[1, 0, 2], [1, 2, 2]]);
  assert.deepEqual(songRows(song(entry('x', 3))).map(row => [row.bars, row.seconds]), [[3, 6]], 'with nothing said a scene is one bar at 120');
  assert.deepEqual(songRows(song()), []);
});

test('moving a row keeps the starting mark on the row it was on', () => {
  const entries = [entry('a'), entry('b'), entry('c'), entry('d')];
  assert.equal(ids(moveSongEntry(entries, 0, 2, 1).entries), 'acbd');
  assert.equal(ids(moveSongEntry(entries, 0, 0, 3).entries), 'bcda');
  assert.equal(moveSongEntry(entries, 2, 2, 1).start, 1, 'the marked row moved, and the mark with it');
  assert.equal(moveSongEntry(entries, 1, 2, 1).start, 2, 'a row moved above the marked one pushes it down');
  assert.equal(moveSongEntry(entries, 2, 1, 2).start, 1, 'a row moved below the marked one lets it up');
  assert.equal(moveSongEntry(entries, 3, 0, 1).start, 3, 'a move that does not cross the mark leaves it');
  assert.equal(moveSongEntry(entries, 2, 0, 3).start, 1);
  for (const [from, to] of [[1, 1], [-1, 0], [0, 4], [4, 0]]) assert.equal(moveSongEntry(entries, 1, from, to).entries, entries, 'a move that cannot be made changes nothing');
  assert.equal(ids(entries), 'abcd', 'the list handed in is not changed');
});

test('removing a row keeps the mark on its row, and the last row cannot be removed', () => {
  const entries = [entry('a'), entry('b'), entry('c')];
  assert.deepEqual([ids(removeSongEntry(entries, 2, 0).entries), removeSongEntry(entries, 2, 0).start], ['bc', 1]);
  assert.equal(removeSongEntry(entries, 0, 2).start, 0);
  assert.equal(removeSongEntry(entries, 2, 2).start, 1, 'the marked row was the last: the mark goes to the new last');
  assert.equal(removeSongEntry(entries, 1, 1).start, 1, 'the marked row was taken out: the mark is on the one that took its place');
  assert.equal(removeSongEntry([entry('a')], 0, 0).entries.length, 1);
  assert.equal(removeSongEntry(entries, 0, 5).entries, entries);
});

test('a scene is added once, at a place, and the mark stays on its row', () => {
  const entries = [entry('a', 3), entry('b')];
  assert.deepEqual(insertSongEntry(entries, 1, 1, 'c'), { entries: [entry('a', 3), entry('c', 1), entry('b')], start: 2 });
  assert.deepEqual([ids(insertSongEntry(entries, 0, 2, 'c').entries), insertSongEntry(entries, 0, 2, 'c').start], ['abc', 0]);
  assert.equal(ids(insertSongEntry(entries, 0, 99, 'c').entries), 'abc', 'a place past the end is the end');
  const full = Array.from({ length: MAX_SONG_ENTRIES }, () => entry('a'));
  assert.equal(insertSongEntry(full, 0, 1, 'b').entries, full, 'a full song takes no more');
});

test('repeats are held between one and the most a row may have', () => {
  const entries = [entry('a'), entry('b', 4)];
  assert.deepEqual(repeatSongEntry(entries, 1, 5), [entry('a'), entry('b', 5)]);
  assert.deepEqual([0, -2, NaN, 2.6, MAX_REPEATS + 9].map(value => repeatSongEntry(entries, 0, value)[0].repeats), [1, 1, 1, 3, MAX_REPEATS]);
  assert.deepEqual(repeatSongEntry(entries, 7, 3), entries);
});

test('only the blocks or the playlist is a way of showing the song, and the blocks come first', () => {
  for (const view of SONG_VIEWS) assert.equal(asSongView(view), view);
  for (const bad of ['', 'list', 'Playlist', null, undefined, 1, {}]) assert.equal(asSongView(bad), null);
  assert.equal(storedSongView(), 'blocks', 'with no storage to read');
});

test('the row playing at a time is the last to have started, and none outside the song', () => {
  const rows = songRows(song(entry('a', 2), entry('b'), entry('c')), id => (id === 'c' ? 2 : 1), 120);
  assert.deepEqual([0, 3.99, 4, 5.5, 6, 9.99].map(time => rowAtSeconds(rows, time)), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual([-1, 10, 12, NaN].map(time => rowAtSeconds(rows, time)), [-1, -1, -1, -1], 'the tail after the last bar belongs to no row');
  assert.equal(rowAtSeconds([], 0), -1);
});
