import test from 'node:test';
import assert from 'node:assert/strict';
import { laneForFile, matchKit } from '../src/services/kitImport.ts';

test('a sample file\'s name says which drum lane it belongs on', () => {
  const expected: Record<string, string | null> = {
    'BD.wav': 'kick', 'Linn Kick 1.wav': 'kick', 'LinnKick01.WAV': 'kick', 'kick_hard.flac': 'kick', 'Bass Drum.wav': 'kick', '707-BassDrum2.wav': 'kick',
    'SD.wav': 'snare', 'DMX_Snare.wav': 'snare', 'snares-03.mp3': 'snare', 'Rimshot.wav': 'snare',
    'CP.wav': 'clap', 'Handclap.wav': 'clap', 'dmx claps.wav': 'clap',
    'CH.wav': 'closedHH', '707 HH Closed.wav': 'closedHH', 'hihat_closed.wav': 'closedHH', 'HiHat.wav': 'closedHH', 'ClosedHat.wav': 'closedHH', 'HHC.wav': 'closedHH', 'hat 2.ogg': 'closedHH',
    'OH.wav': 'openHH', 'HHOpen.wav': 'openHH', 'Open Hi-Hat.wav': 'openHH', 'openhat.wav': 'openHH', 'HH O.wav': 'openHH', 'hihat-open-long.wav': 'openHH',
    'LT.wav': 'snare2', 'Tom Lo.wav': 'snare2', 'LowTom.wav': 'snare2', 'floor tom.wav': 'snare2', 'TomLow1.wav': 'snare2',
    'HT.wav': 'ride', 'Tom Hi.wav': 'ride', 'HighTom.wav': 'ride', 'Tom 1.wav': 'ride', 'MT.wav': 'ride',
    'Crash.wav': 'crash', 'CY.wav': 'crash', 'Ride Cymbal.wav': 'crash', 'cymbal-01.wav': 'crash',
    'Cowbell.wav': null, 'Tambourine.wav': null, 'Conga Hi.wav': null, 'Clave.wav': null, 'Cabasa.wav': null, 'Shaker.wav': null, 'untitled.wav': null, '.wav': null,
  };
  for (const [name, lane] of Object.entries(expected)) assert.equal(laneForFile(name), lane, name);
});

test('a set of files is given to the lanes one each', () => {
  const names = ['Tom Mid.wav', 'Kick 2.wav', 'Cowbell.wav', 'Kick 10.wav', 'Kick 1.wav', 'Snare.wav', 'Tom Hi.wav', 'Tom Lo.wav', 'HH Open.wav', 'HH Closed.wav'];
  assert.deepEqual(matchKit(names), { kick: 4, snare: 5, ride: 6, snare2: 7, openHH: 8, closedHH: 9 },
    'the first kick by name wins, and the lanes nothing suits are left out');
  assert.deepEqual(matchKit(['Tom 3.wav', 'Tom 1.wav', 'Tom 2.wav']), { ride: 1, snare2: 2 }, 'toms that do not say which they are fill the high tom, then the low');
  assert.deepEqual(matchKit(['Tom.wav', 'Tom Hi.wav']), { ride: 1, snare2: 0 }, 'a tom that says it is high keeps the high lane');
  assert.deepEqual(matchKit(['notes.txt', 'Cowbell.wav']), {});
  assert.deepEqual(matchKit([]), {});
});
