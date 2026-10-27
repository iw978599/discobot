import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SENT_BYTES, createSoundInbox, importMessage, kitChoice, listenToOpener, readSounds, senderOrigin, takeReceiveLink,
} from '../src/services/receiveSounds.ts';
import { MAX_KIT_FILES } from '../src/services/kitImport.ts';

const bytes = (size = 4) => new ArrayBuffer(size);
const sound = (name: unknown, lane: unknown = null, data: unknown = bytes()) => ({ name, mime: 'audio/wav', lane, data });
const message = (files: unknown[], extra: Record<string, unknown> = {}) => ({ discobotImport: 1, type: 'sounds', v: 1, from: 'Drum Foundry', files, ...extra });

test('only this handshake\'s envelope is read, apart from a guest\'s', () => {
  assert.ok(importMessage({ discobotImport: 1, type: 'sounds' }));
  assert.equal(importMessage({ discobotGuest: 1, type: 'sounds' }), null);
  assert.equal(importMessage({ discobotImport: 2, type: 'sounds' }), null);
  assert.equal(importMessage({ discobotImport: 1 }), null);
  assert.equal(importMessage('sounds'), null);
});

test('a sender must be https or this machine, and not Discobot itself', () => {
  const own = 'https://iw978599.github.io';
  assert.equal(senderOrigin('https://aaronvandorn.github.io', own), true);
  assert.equal(senderOrigin('http://localhost:5173', own), true);
  assert.equal(senderOrigin('http://127.0.0.1:8787', own), true);
  assert.equal(senderOrigin(own, own), false);
  assert.equal(senderOrigin('http://example.com', own), false);
  assert.equal(senderOrigin('null', own), false);
  assert.equal(senderOrigin('https://example.com/page', own), false);
});

test('every field of the sounds is checked, and a file that fails is left out', () => {
  const read = readSounds(message([
    sound('kick-long.wav', 'kick'),
    sound('../../etc/snare\u0007 1', 'bogus'),
    sound('hat.wav', 'closedHH', bytes(0)),
    sound('big.wav', null, bytes(MAX_SENT_BYTES + 1)),
    sound(42, 'kick'),
    sound('text.wav', 'snare', 'not bytes'),
    null,
  ], { from: '  Drum\u0000 Foundry with a name far too long to show in one line of the dialog  ' }));
  assert.ok(!('error' in read));
  assert.deepEqual(read.files.map(file => [file.name, file.lane]), [['kick-long.wav', 'kick'], ['snare 1.wav', null]]);
  assert.equal(read.offered, 7);
  assert.ok(read.from.startsWith('Drum Foundry with'));
  assert.ok(read.from.length <= 60);
  assert.equal((readSounds(message([sound('a.wav')], { from: 7 })) as { from: string }).from, 'another app');
});

test('sounds with nothing usable, or of another version, are an error', () => {
  assert.ok('error' in readSounds(message([])));
  assert.ok('error' in readSounds(message([sound('a.wav', null, 'x')])));
  assert.ok('error' in readSounds(message([sound('a.wav')], { v: 2 })));
  assert.ok('error' in readSounds(message('files' as unknown as unknown[])));
  assert.ok('error' in readSounds(null));
});

test('no more than an import lists are taken', () => {
  const read = readSounds(message(Array.from({ length: MAX_KIT_FILES + 5 }, (_, index) => sound(`perc-${index}.wav`))));
  assert.ok(!('error' in read));
  assert.equal(read.files.length, MAX_KIT_FILES);
  assert.equal(read.offered, MAX_KIT_FILES + 5);
});

test('a file starts on the lane it was sent for, the first of two keeps it, and the rest are guessed by name', () => {
  const choice = kitChoice([
    { name: 'thing.wav', lane: 'kick' },
    { name: 'other.wav', lane: 'kick' },
    { name: '02-snare-tight.wav', lane: null },
    { name: '03-kick-808.wav', lane: null },
    { name: 'fx-zap.wav', lane: null },
  ]);
  // The second kick is on no lane, and a name guessing a lane already taken does not take it.
  assert.deepEqual(choice, { kick: 0, snare: 2 });
});

test('sent sounds are shown once they decode, and answered when the dialog closes', async () => {
  const inbox = createSoundInbox(async data => data.byteLength !== 3);
  const answers: unknown[] = [];
  await inbox.take(message([sound('kick.wav', 'kick'), sound('bad.wav', 'snare', bytes(3)), sound('zap.wav')]), 'https://aaronvandorn.github.io', answer => answers.push(answer));
  const offer = inbox.current();
  assert.ok(offer);
  assert.deepEqual(offer.files.map(file => file.name), ['kick.wav', 'zap.wav']);
  assert.equal(offer.files[0].type, 'audio/wav');
  assert.deepEqual(offer.initial, { kick: 0 });
  assert.equal(offer.site, 'aaronvandorn.github.io');
  assert.equal(offer.from, 'Drum Foundry');
  // A second sender while these are shown is told so.
  const second: unknown[] = [];
  await inbox.take(message([sound('kick.wav')]), 'https://example.com', answer => second.push(answer));
  assert.equal((second[0] as { type: string }).type, 'error');
  assert.deepEqual(answers, []);
  inbox.finish(2);
  assert.equal(inbox.current(), null);
  assert.deepEqual(answers, [{ type: 'done', imported: 2 }]);
});

test('sounds none of which decode show nothing and are answered with an error', async () => {
  const inbox = createSoundInbox(async () => false);
  const answers: Array<{ type: string }> = [];
  await inbox.take(message([sound('kick.wav')]), 'https://aaronvandorn.github.io', answer => answers.push(answer));
  assert.equal(inbox.current(), null);
  assert.equal(answers[0].type, 'error');
});

test('#receive comes off the address, and counts only with a page that opened this one', () => {
  const page = (hash: string, opener: unknown) => {
    const calls: string[] = [];
    return {
      calls,
      win: {
        location: { hash, pathname: '/discobot/', search: '' },
        history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { calls.push(url); } },
        opener,
      } as unknown as Window,
    };
  };
  const opened = page('#receive', {});
  assert.equal(takeReceiveLink(opened.win), true);
  assert.deepEqual(opened.calls, ['/discobot/']);
  const alone = page('#receive', null);
  assert.equal(takeReceiveLink(alone.win), false);
  assert.deepEqual(alone.calls, ['/discobot/']);
  const plain = page('#song=abc', {});
  assert.equal(takeReceiveLink(plain.win), false);
  assert.deepEqual(plain.calls, []);
});

test('the opener is told ready, and only its first sounds are taken', async () => {
  const posted: Array<[unknown, string]> = [];
  const opener = { postMessage: (data: unknown, origin: string) => posted.push([data, origin]) };
  let listener: ((event: MessageEvent) => void) | null = null;
  const win = {
    opener, location: { origin: 'https://iw978599.github.io' },
    addEventListener: (_type: string, handler: (event: MessageEvent) => void) => { listener = handler; },
    removeEventListener: () => { listener = null; },
  } as unknown as Parameters<typeof listenToOpener>[0];
  const inbox = createSoundInbox(async () => true);
  listenToOpener(win, inbox);
  assert.deepEqual(posted, [[{ discobotImport: 1, type: 'ready' }, '*']]);
  const send = (source: unknown, origin: string, from: string) => listener!({ source, origin, data: message([sound('kick.wav', 'kick')], { from }) } as MessageEvent);
  send({}, 'https://aaronvandorn.github.io', 'Another window');
  send(opener, 'http://example.com', 'Not https');
  send(opener, 'https://iw978599.github.io', 'Discobot itself');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(inbox.current(), null);
  send(opener, 'https://aaronvandorn.github.io', 'Drum Foundry');
  send(opener, 'https://aaronvandorn.github.io', 'Again');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(inbox.current()?.from, 'Drum Foundry');
  inbox.finish(0);
  assert.deepEqual(posted.slice(1), [[{ discobotImport: 1, type: 'done', imported: 0 }, 'https://aaronvandorn.github.io']]);
});
