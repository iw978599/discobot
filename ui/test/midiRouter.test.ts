import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IN_CHANNELS, asMidiInChannels, asMidiOutChannels, inChannelOf, partOfChannel, withInChannel } from '../src/services/midiChannels.ts';
import { asMidiOutputSettings, outputFlagsFor, withOutputFlags } from '../src/services/midiDevices.ts';
import { createMidiOut, type MidiOutFlags } from '../src/services/midiOutput.ts';

const flags = (on: Partial<MidiOutFlags>): MidiOutFlags => ({ notes: false, clock: false, played: false, thru: false, ...on });
const recorder = (id: string, name = id) => {
  const sent: number[][] = [];
  return { sent, port: { id, name, send: (data: number[]) => { sent.push([...data]); } } };
};

test('each channel plays one part: giving a part a channel takes it from the part that had it', () => {
  assert.deepEqual(DEFAULT_IN_CHANNELS, { 1: 1, drums: 10 }, 'Synth 1 on channel 1 and the drums on 10, as before');
  let map = withInChannel(DEFAULT_IN_CHANNELS, 2, 4);
  map = withInChannel(map, 3, 5);
  map = withInChannel(map, 'open', 6);
  assert.equal(partOfChannel(map, 1), 1);
  assert.equal(partOfChannel(map, 4), 2);
  assert.equal(partOfChannel(map, 6), 'open');
  assert.equal(partOfChannel(map, 10), 'drums');
  for (const free of [2, 3, 7, 16]) assert.equal(partOfChannel(map, free), null, `channel ${free} plays nothing here`);
  map = withInChannel(map, 3, 4);
  assert.equal(partOfChannel(map, 4), 3, 'channel 4 moved to Synth 3');
  assert.equal(inChannelOf(map, 2), 0, 'and Synth 2 is left with none');
  assert.equal(inChannelOf(withInChannel(map, 1, 0), 1), 0, 'Off');
});

test('stored channel maps are made safe', () => {
  assert.deepEqual(asMidiInChannels(null), DEFAULT_IN_CHANNELS);
  assert.deepEqual(asMidiInChannels({ 1: 3, 2: 3, 9: 4, drums: 17, open: 2.5, junk: 5 }), { 1: 3 }, 'one part a channel, known parts and real channels only');
  assert.deepEqual(asMidiOutChannels({ 1: 1, 2: 7, drums: 10, open: 3, 4: 0 }), { 2: 7 }, 'only a channel other than the usual one is kept');
});

test('output settings are kept by name, and an output not listed is sent nothing', () => {
  let settings = withOutputFlags({}, 'U6MIDI Pro Port 1', { clock: true });
  settings = withOutputFlags(settings, 'U6MIDI Pro Port 2', { thru: true });
  assert.deepEqual(outputFlagsFor(settings, 'U6MIDI Pro Port 1'), flags({ clock: true }));
  assert.deepEqual(outputFlagsFor(settings, 'Unknown'), flags({}));
  settings = withOutputFlags(settings, 'U6MIDI Pro Port 2', { thru: false });
  assert.equal('U6MIDI Pro Port 2' in settings, false, 'all off is forgotten');
  assert.deepEqual(asMidiOutputSettings({ a: { notes: 'yes', clock: true }, b: 3 }), { a: flags({ clock: true }) });
});

test('several outputs at once, each sent only what it is set to take', () => {
  const drums = recorder('dbi', 'DrumBrute Impact'), volcas = recorder('u6', 'U6MIDI Pro');
  const out = createMidiOut();
  out.setOutputs([{ port: drums.port, flags: flags({ clock: true }) }, { port: volcas.port, flags: flags({ notes: true, clock: true }) }]);
  out.tick(1000, 30, true);
  out.note(1, 60, 1, 1000, 1100);
  assert.deepEqual(drums.sent.map(data => data[0]), [0xfa, 0xf8, 0xf8, 0xf8], 'clock alone');
  assert.deepEqual(volcas.sent.map(data => data[0]), [0xfa, 0xf8, 0xf8, 0xf8, 0x90, 0x80], 'clock and notes');
  drums.sent.length = 0;
  out.setOutputs([{ port: volcas.port, flags: flags({ notes: true, clock: true }) }]);
  assert.deepEqual(drums.sent, [[0xfc]], 'an output that goes is stopped first');
});

test('Thru passes a channel\'s messages on at once, never real-time ones, never back to the controller, and only where the filter lets it', () => {
  const u6 = recorder('u6', 'U6MIDI Pro'), launchkey = recorder('lk-out', 'Launchkey Mini');
  const out = createMidiOut();
  out.setOutputs([{ port: u6.port, flags: flags({ thru: true }) }, { port: launchkey.port, flags: flags({ thru: true }) }]);
  const heard = withInChannel(DEFAULT_IN_CHANNELS, 2, 4);
  out.configure({ thruWhen: (_source, channel) => partOfChannel(heard, channel) === null });
  out.thru([0x91, 60, 100], 'Launchkey Mini');
  out.thru([0xb2, 74, 64], 'Launchkey Mini');
  out.thru([0xe1, 0, 64], 'Launchkey Mini');
  out.thru([0xc2, 5], 'Launchkey Mini');
  out.thru([0x90, 60, 100], 'Launchkey Mini');
  out.thru([0x93, 60, 100], 'Launchkey Mini');
  out.thru([0xf8], 'Launchkey Mini');
  out.thru([0xfa], 'Launchkey Mini');
  out.thru([0xf0, 1, 2, 0xf7], 'Launchkey Mini');
  out.thru([0x91, 61], 'Launchkey Mini');
  assert.deepEqual(u6.sent, [[0x91, 60, 100], [0xb2, 74, 64], [0xe1, 0, 64], [0xc2, 5]],
    'channels 2 and 3 go through; channels 1 and 4 are Discobot\'s; clock, start, sysex and a short message do not');
  assert.deepEqual(launchkey.sent, [], 'the controller is not sent its own notes back');

  u6.sent.length = 0;
  out.setOutputs([{ port: u6.port, flags: flags({}) }]);
  assert.deepEqual(u6.sent, [[0x81, 60, 0]], 'turning Thru off lets go of a note it passed on');
});

test('Panic sends every output all sound off, all notes off and every note off on all 16 channels', () => {
  const a = recorder('a'), b = recorder('b');
  const out = createMidiOut();
  out.setOutputs([{ port: a.port, flags: flags({ notes: true }) }, { port: b.port, flags: flags({}) }]);
  out.panic();
  for (const { sent } of [a, b]) {
    assert.equal(sent.length, 16 * (3 + 128));
    for (let channel = 0; channel < 16; channel++) {
      assert.ok(sent.some(data => data[0] === (0xb0 | channel) && data[1] === 123), `all notes off on ${channel + 1}`);
      assert.ok(sent.some(data => data[0] === (0xb0 | channel) && data[1] === 120), `all sound off on ${channel + 1}`);
      assert.equal(sent.filter(data => data[0] === (0x80 | channel)).length, 128);
    }
  }
});

test('the clock is 24 pulses a quarter note at any tempo, placed from each tick\'s own time', () => {
  const port = recorder('clock');
  const out = createMidiOut();
  const times: number[] = [];
  out.setOutputs([{ port: { id: 'clock', name: 'clock', send: (data: number[], at?: number) => { port.sent.push(data); if (data[0] === 0xf8) times.push(at!); } }, flags: flags({ clock: true }) }]);
  // A quarter note is eight ticks: 120 BPM for one beat, then 90 BPM for the next.
  let at = 0;
  for (let tick = 0; tick < 16; tick++) {
    const duration = (tick < 8 ? 500 : 60000 / 90) / 8;
    out.tick(at, duration, tick === 0);
    at += duration;
  }
  assert.equal(times.length, 48);
  assert.ok(Math.abs(times[24] - times[0] - 500) < 1e-9, 'one beat at 120');
  assert.ok(Math.abs(times[47] + (60000 / 90) / 24 - times[24] - 60000 / 90) < 1e-9, 'one beat at 90');
  assert.equal(port.sent.filter(data => data[0] === 0xfa).length, 1, 'one start');
});
