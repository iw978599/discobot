import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_LATENCY_MS, MAX_GUESTS, MAX_GUEST_LATENCY_MS, MAX_GUEST_STATE_CHARS, guestLink, guestUrl, latencyAfterLateBlocks, patchGuest, placeBlock, resample, sanitizeGuests } from '../src/services/guests.ts';
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

test('late audio raises the latency by what was missing, and the transport waits long enough for every guest', () => {
  assert.equal(latencyAfterLateBlocks(120, 0.03), 180, 'thirty milliseconds late needs one more step');
  assert.equal(latencyAfterLateBlocks(120, 0.25), 420, 'a quarter of a second late is covered in one go');
  assert.equal(latencyAfterLateBlocks(120, 5), MAX_GUEST_LATENCY_MS, 'but never past the limit');
  assert.equal(latencyAfterLateBlocks(MAX_GUEST_LATENCY_MS, 0.2), MAX_GUEST_LATENCY_MS);

  assert.equal(guestLink.startLead(), 0, 'with no guests connected the transport starts as it always has');
  guestLink.connect('a', GUEST_LATENCY_MS);
  assert.ok(guestLink.startLead() >= 0.8, 'a guest that has never been started gets a long first lead');
  guestLink.announce({ playing: true, bpm: 120, anchorWall: 1, anchorBeat: 0 });
  guestLink.announce({ playing: false });
  assert.ok(Math.abs(guestLink.startLead() - 0.35) < 1e-9, 'once it has been started, the usual short one');
  guestLink.connect('a', 420);
  assert.ok(Math.abs(guestLink.startLead() - 0.65) < 1e-9, 'a guest that plays further ahead needs a longer lead, and stays warm');
  guestLink.connect('b', GUEST_LATENCY_MS);
  assert.ok(guestLink.startLead() >= 0.8, 'a newly loaded guest makes the next start a long one again');
  guestLink.disconnect('a');
  guestLink.disconnect('b');
  assert.equal(guestLink.startLead(), 0);
});

test('each scene keeps its own settings for a guest', async () => {
  const { LocalProjectService } = await import('../src/services/localService.ts');
  const { createMemoryLibrary } = await import('../src/services/projectLibrary.ts');
  const { createDefaultSynthParameters } = await import('../../engine/src/synth/voiceParams.ts');
  const { DRUM_INSTRUMENTS } = await import('../src/services/drumKits.ts');
  const { sanitizeSceneGuests } = await import('../src/services/guests.ts');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5 } }]));
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(), drumState: drums as never, drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 },
    effectsLoop: { enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 }, phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 }, delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 } },
  });
  await service.openLibrary(createMemoryLibrary());
  const post = (path: string, body: unknown, method = 'POST') => service.request(path, { method, body: JSON.stringify(body) });
  const guests = () => service.snapshot().guests as Array<{ id: string; state?: unknown }>;

  await post('/guests', { url: 'https://example.com/choir' });
  await post('/guests', { url: 'https://example.com/drums' });
  const [choir, kit] = guests().map(guest => guest.id);
  const verse = service.snapshot().currentSceneId;
  await post(`/guests/${choir}`, { state: { vowel: 'a' } }, 'PUT');

  // A second scene starts as a copy, then gets settings of its own.
  await post('/scenes/create', {});
  const chorus = service.snapshot().currentSceneId;
  assert.deepEqual(guests()[0].state, { vowel: 'a' });
  await post(`/guests/${choir}`, { state: { vowel: 'o' } }, 'PUT');
  await post(`/guests/${kit}`, { state: { swing: 0.3 } }, 'PUT');

  const selected = await (await post('/scenes/select', { sceneId: verse })).json();
  assert.deepEqual(selected.guests.map((guest: { state?: unknown }) => guest.state), [{ vowel: 'a' }, { swing: 0.3 }], 'the choir goes back to the verse; the kit, which the verse knows nothing of, stays as it is');
  await post('/scenes/select', { sceneId: chorus });
  assert.deepEqual(guests().map(guest => guest.state), [{ vowel: 'o' }, { swing: 0.3 }]);

  const stored = (await (await service.request('/scenes')).json()).scenes as Array<{ id: string; guests?: Record<string, unknown> }>;
  assert.deepEqual(stored.find(scene => scene.id === verse)!.guests, { [choir]: { vowel: 'a' }, [kit]: { swing: 0.3 } }, 'leaving the verse recorded what both guests were set to there');
  assert.deepEqual(stored.find(scene => scene.id === chorus)!.guests, { [choir]: { vowel: 'o' }, [kit]: { swing: 0.3 } });

  // It travels in a project file, checked on the way back in.
  const read = service.readProjectFile(JSON.parse(JSON.stringify(service.exportProject())));
  assert.ok(read.ok);
  if (read.ok) assert.deepEqual(read.project.scenes.find(scene => scene.id === verse)!.guests?.[choir], { vowel: 'a' });
  assert.deepEqual(sanitizeSceneGuests({ [choir]: { a: 1 }, 'not-an-id': { b: 2 }, [kit]: 'x'.repeat(MAX_GUEST_STATE_CHARS + 1) }), { [choir]: { a: 1 } });
  assert.equal(sanitizeSceneGuests('nope'), undefined);
  assert.equal(sanitizeSceneGuests({}), undefined);

  // Removing a guest removes its settings from every scene.
  await post(`/guests/${choir}`, {}, 'DELETE');
  const after = (await (await service.request('/scenes')).json()).scenes as Array<{ guests?: Record<string, unknown> }>;
  assert.ok(after.every(scene => !scene.guests || !(choir in scene.guests)));
  assert.ok(after.every(scene => scene.guests && kit in scene.guests));
});
