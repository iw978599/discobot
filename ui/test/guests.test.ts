import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GUESTS, MAX_GUEST_STATE_CHARS, guestLink, guestUrl, patchGuest, placeBlock, resample, sanitizeGuests } from '../src/services/guests.ts';
import { BrowserTransport } from '../src/services/browserTransport.ts';

const OWN = 'https://iw978599.github.io';
const id = () => crypto.randomUUID();

test('a guest can only be loaded from another site, over https', () => {
  assert.equal(guestUrl('https://aaronvandorn.github.io/Choir/', OWN), 'https://aaronvandorn.github.io/Choir/');
  assert.equal(guestUrl('  https://example.com/synth?x=1#part  ', OWN), 'https://example.com/synth?x=1', 'the part after # is dropped');
  assert.equal(guestUrl('http://localhost:5173/', OWN), 'http://localhost:5173/', 'a creator can test from their own machine');
  for (const bad of [
    'http://example.com/', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///C:/x.html', 'blob:https://example.com/1',
    `${OWN}/discobot/`, 'https://user:pass@example.com/', 'not an address', '', `https://example.com/${'a'.repeat(400)}`, 7, null,
  ]) assert.equal(guestUrl(bad, OWN), null, String(bad));
  assert.equal(guestUrl(`${OWN}/other/`, 'https://elsewhere.example'), `${OWN}/other/`, 'only the page\'s own site is refused');
});

test('guests read from a project are checked like the rest of it', () => {
  const a = id(), b = id();
  const guests = sanitizeGuests([
    { id: a, url: 'https://example.com/a', name: '  Choir  ', volume: 3, muted: 'yes', state: { vowel: 'a' } },
    { id: a, url: 'https://example.com/duplicate-id' },
    { id: 'nope', url: 'https://example.com/bad-id' },
    { id: b, url: `${OWN}/discobot/` },
    { id: b, url: 'https://example.com/b', state: 'x'.repeat(MAX_GUEST_STATE_CHARS + 1) },
    ...Array.from({ length: MAX_GUESTS }, (_, index) => ({ id: id(), url: `https://example.com/extra-${index}` })),
    'junk', null,
  ], OWN);
  assert.equal(guests.length, MAX_GUESTS);
  assert.deepEqual(guests[0], { id: a, url: 'https://example.com/a', name: 'Choir', volume: 1, muted: false, state: { vowel: 'a' } });
  assert.deepEqual(guests[1], { id: b, url: 'https://example.com/b', name: 'example.com', volume: 0.8, muted: false }, 'an oversized state is dropped, not the guest');
  assert.deepEqual(sanitizeGuests('nope'), []);
  assert.deepEqual(sanitizeGuests(undefined), [], 'a project from before guests existed has none');

  const circular: Record<string, unknown> = {}; circular.self = circular;
  const patched = patchGuest(guests[0], { volume: -1, muted: true, name: '', state: circular, url: 'https://evil.example/', id: 'changed' });
  assert.deepEqual(patched, { id: a, url: 'https://example.com/a', name: 'Choir', volume: 0, muted: true }, 'the address and id cannot be patched, and a state that cannot be stored is dropped');
  assert.deepEqual(patchGuest(guests[0], { state: { vowel: 'o' } }).state, { vowel: 'o' });
});

test('guest audio is placed end to end, except across a real gap', () => {
  assert.equal(placeBlock(null, 48000.4, 48000), 48000, 'the first block goes where the clock says');
  assert.equal(placeBlock(49024, 49030, 48000), 49024, 'a few samples of clock jitter do not open a gap');
  assert.equal(placeBlock(49024, 49024 - 200, 48000), 49024);
  assert.equal(placeBlock(49024, 96000, 48000), 96000, 'a stall or restart is honoured');

  const ramp = Float32Array.from({ length: 441 }, (_, index) => index / 440);
  assert.equal(resample(ramp, 44100, 44100), ramp, 'the same rate is passed through untouched');
  const up = resample(ramp, 44100, 48000);
  assert.equal(up.length, 480);
  assert.ok(Math.abs(up[0]) < 1e-6 && Math.abs(up[479] - 1) < 1e-6 && Math.abs(up[240] - 240 / 479) < 0.002, 'a ramp stays a ramp');
});

test('the transport says when it starts and when a tempo change takes hold', () => {
  let now = 10, tempo = 120;
  const ticks: number[] = [], changes: Array<[number, number, number]> = [];
  const transport = new BrowserTransport(() => now, () => tempo, tick => ticks.push(tick.time));
  transport.onTempo = (bpm, time, beat) => changes.push([bpm, time, beat]);
  // A failed check must still stop the transport's timer, or the test run never ends.
  try {
  transport.start(0.35);
  assert.equal(transport.startTime, 10.35, 'guests get a longer lead than the built-in lanes');
  assert.equal(ticks.length, 0, 'nothing is due inside the look-ahead yet');
  now = 10.4; transport.pump();
  assert.equal(ticks[0], 10.35);
  // Two beats in (16 ticks of 62.5 ms), the tempo changes.
  now = 11.3; transport.pump();
  tempo = 90; now = 11.31; transport.pump();
  assert.equal(changes.length, 1);
  const [bpm, time, beat] = changes[0];
  assert.equal(bpm, 90);
  assert.ok(Math.abs(time - (10.35 + beat * 0.5)) < 1e-6, 'the change is reported at the beat it applies from');
  assert.ok(beat > 1.9 && beat < 2.2);
  transport.stop();
  transport.start();
  assert.ok(Math.abs(transport.startTime - 11.35) < 1e-9, 'the default lead is unchanged');
  } finally { transport.stop(); }

  const heard: unknown[] = [];
  const stop = guestLink.subscribe(state => heard.push(state));
  guestLink.announce({ playing: true, bpm: 120, anchorWall: 5, anchorBeat: 0 });
  guestLink.announce({ playing: false });
  stop();
  guestLink.announce({ playing: true, bpm: 99, anchorWall: 6, anchorBeat: 0 });
  assert.deepEqual(heard, [{ playing: true, bpm: 120, anchorWall: 5, anchorBeat: 0 }, { playing: false }]);
  assert.deepEqual(guestLink.transport(), { playing: true, bpm: 99, anchorWall: 6, anchorBeat: 0 }, 'a guest that connects later is told the current state');
  guestLink.announce({ playing: false });
});
