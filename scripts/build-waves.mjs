// Builds ui/public/waves.bin, the recordings and single-cycle waves the sample engine's built-in
// sounds play. It is run by hand when the set changes, never by a build or a check:
//
//   node scripts/build-waves.mjs <folder holding the source files> [the files to build, such as sounds/kit-swirly.bin]
//
// The source folder has `vsco/` and `akwf/`, each file fetched from the address beside it in
// SOURCES below and saved under the name given there (VCSL's go in `vcsl/`, Karoryfer's in
// `karoryfer/`). All four libraries are CC0 (docs/BUNDLED_AUDIO.md). With files named after the
// folder, only those are built, and only their sources are needed.
// Everything is cut short, mixed to one channel and stored as 16-bit, so the whole set stays small.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VSCO = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
const VCSL = 'https://raw.githubusercontent.com/sgossner/VCSL/master/';
const MEMBRANE = `${VCSL}Membranophones/Struck%20Membranophones/`;
const IDIOPHONE = `${VCSL}Idiophones/Struck%20Idiophones/`;
const AKWF ='https://raw.githubusercontent.com/KristofferKarlAxelEkstrand/AKWF-FREE/main/AKWF/';
const GOGODZE = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii/master/Samples/';
const SWIRLY = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.swirly-drums/main/Samples/';
const CAVEMAN = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.caveman-cosmonaut/master/Samples/';
const RATE = 22050;
const FRAME = 600;

const piano = (index, root, seconds) => ({ file: `vsco/piano_${index}.wav`, from: `${VSCO}Keys/Upright%20Piano/Player_dyn2_rr1_${index}.wav`, root, seconds });
const cycles = (folder, numbers) => numbers.map(number => {
  const name = `AKWF_${folder}_${String(number).padStart(4, '0')}.wav`;
  return { file: `akwf/${name}`, from: `${AKWF}AKWF_${folder}/${name}` };
});

// A root is the note a recording sounds at, measured, not the note in its file name: the marimba,
// the glockenspiel and the flute are each named an octave below where they sound.
// A recording has zones (one or more notes of the instrument); a table has frames (single cycles).
export const SOURCES = [
  { id: 'piano', zones: [piano('008', 37, 2), piano('014', 49, 1.8), piano('020', 61, 1.5), piano('026', 73, 1.2), piano('032', 85, 0.9)] },
  { id: 'mallet', zones: [{ file: 'vsco/marimba_C4.wav', from: `${VSCO}Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01.wav`, root: 72, seconds: 0.8 }] },
  { id: 'attack-pluck', zones: [{ file: 'vsco/harp_C5.wav', from: `${VSCO}Strings/Harp/KSHarp_C5_mf.wav`, root: 72, seconds: 0.25 }] },
  { id: 'attack-bell', zones: [{ file: 'vsco/glock_C6.wav', from: `${VSCO}Percussion/Glock/glock_medium_C6.wav`, root: 96, seconds: 0.3 }] },
  { id: 'attack-breath', zones: [{ file: 'vsco/flute_C5.wav', from: `${VSCO}Woodwinds/Flute/stac/LDFlute_stac_C5_v2_rr1.wav`, root: 84, seconds: 0.2 }] },
  { id: 'attack-mallet', zones: [{ file: 'vsco/marimba_C4.wav', from: `${VSCO}Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01.wav`, root: 72, seconds: 0.15 }] },
  // The drum machine's cymbals, one hit each. They are kept at a higher rate than the rest, because
  // most of a cymbal is above what 22,050 Hz can hold. A cymbal has no note; the root is not used.
  ...[['crash', 'cymbal-crash1_ff_rr1', 2.5], ['ride', 'susCymb1-hitstick_f_rr1', 1.8], ['bell', 'susCymb1-hit-bell_mf', 1.5], ['splash', 'cymbal-crashshort_v1', 1]]
    .map(([name, source, seconds]) => ({ id: `cymbal-${name}`, zones: [{ file: `vsco/cymbal_${name}.wav`, from: `${VSCO}Percussion/${source}.wav`, root: 60, seconds, rate: 32000, unpitched: true }] })),
  // The recorded drum kit, one hit per lane (VCSL). Like the cymbals they have no note. The hats are
  // kept at the higher rate for the same reason the cymbals are.
  ...[
    ['kick', `${MEMBRANE}Bass%20Drum%201/BDrumNew_hit_v5_rr1_Sum.wav`, 0.7],
    ['snare', `${MEMBRANE}Snare%20Drum,%20Modern%201/Snare2_HitSN_v6_rr1_Mid.wav`, 0.5],
    ['clap', `${IDIOPHONE}Claps/Clap_rr1.wav`, 0.5],
    ['closedHH', `${IDIOPHONE}Hi-Hat%20Cymbal/HiHat_HitC_v3_rr1_Mid.wav`, 0.25, 32000],
    ['openHH', `${IDIOPHONE}Hi-Hat%20Cymbal/HiHat_HitO_rr1_Mid.wav`, 1, 32000],
    ['snare2', `${MEMBRANE}Tom%202/Stick/TomL_HitS_v3_rr1_Mid.wav`, 0.7],
    ['ride', `${MEMBRANE}Tom%201/Stick/TomH_HitS_v3_rr1_Mid.wav`, 0.6],
  ].map(([name, from, seconds, rate]) => ({ id: `kit-${name}`, zones: [{ file: `vcsl/kit_${name}.wav`, from, root: 60, seconds, rate: rate ?? RATE, unpitched: true }] })),
  // Other percussion a drum lane can be instead of its own drum, in any kit (VCSL).
  ...[
    ['tambourine', `${IDIOPHONE}Tambourine%201/Tamb1_Hit_v2_rr1_Mid.wav`, 0.5],
    ['shaker', `${IDIOPHONE}Shaker,%20Small/Mid_ShakerDouble_Down_rr1.wav`, 0.35],
    ['cowbell', `${IDIOPHONE}Cowbells/Cowbell1_Normal_v3_rr1_Mid.wav`, 0.5],
    ['sidestick', `${MEMBRANE}Snare%20Drum,%20Modern%201/Snare2_stick_v1_rr1_Mid.wav`, 0.3],
    ['conga', `${MEMBRANE}Conga/Conga_HitN_v2_rr1_Sum.wav`, 0.6],
    ['bongo', `${MEMBRANE}Bongos/BongoH_Hit1_v2_rr1_Mid.wav`, 0.4],
  ].map(([name, from, seconds]) => ({ id: `perc-${name}`, zones: [{ file: `vcsl/perc_${name}.wav`, from, root: 60, seconds, rate: RATE, unpitched: true }] })),
  { id: 'organ', frames: cycles('eorgan', [1]) },
  { id: 'choir', frames: cycles('hvoice', [1]) },
  { id: 'seq-voices', frames: cycles('hvoice', [1, 14, 27, 40, 53, 66, 79, 92]) },
  { id: 'seq-overtones', frames: cycles('overtone', [1, 6, 11, 16, 21, 26, 31, 36]) },
  { id: 'seq-fm', frames: cycles('fmsynth', [1, 16, 31, 46, 61, 76, 91, 106]) },
  { id: 'seq-harmonics', frames: cycles('sinharm', [1, 3, 5, 7, 9, 11, 13, 15]) },
];

// Instruments too big for waves.bin, each a file of its own that the app fetches the first time a
// sound needs it (`sounds/<id>.bin`, the same format). One recording a C or so across the range, at a
// middle velocity, cut shorter the higher it is. A name is the MIDI note it was measured to sound at
// (C4 is 60); the pitch printed for each is the check.
const octaves = (folder, name, url, seconds, firstOctave, ...extra) => seconds.map((length, index) => {
  const octave = firstOctave + index;
  return { file: `vcsl/${name}_C${octave}.wav`, from: url(octave), root: 12 * (octave + 1), seconds: length, ...Object.assign({}, ...extra) };
});
const GRAND = `${VCSL}Chordophones/Zithers/`;
const TX = `${VCSL}Electrophones/TX81Z/`;
export const INSTRUMENTS = [
  { id: 'kawai-piano', file: 'sounds/kawai-piano.bin', zones: octaves(null, 'kawai', n => `${GRAND}Grand%20Piano,%20Kawai/Sustains/GPiano_sus_C${n}_v3_rr1_Player.wav`, [2.4, 2.2, 2, 1.7, 1.4, 1, 0.7], 1) },
  { id: 'steinway-piano', file: 'sounds/steinway-piano.bin', zones: octaves(null, 'steinway', n => `${GRAND}Grand%20Piano,%20Steinway%20B/Sus/JHPiano_Sus_Close_C${n}_vl3_rr1.wav`, [2.4, 2.2, 2, 1.7, 1.4, 1, 0.7], 1) },
  { id: 'pipe-organ', file: 'sounds/pipe-organ.bin', zones: octaves(null, 'organ', n => `${VCSL}Aerophones/Edge-blown%20Aerophones/Pipe%20Organ/Loud/Rode_Man3Open_C${n}.wav`, [2, 2, 2, 1.6, 1.6, 1.2], 1) },
  { id: 'tenor-sax', file: 'sounds/tenor-sax.bin', zones: octaves(null, 'sax', n => `${VCSL}Aerophones/Reed%20Aerophones/Tenor%20Saxophone/Non-Vibrato/BrettTenor_NV_Main_C${n}_vl3_rr1.wav`, [1.8, 1.8, 1.6, 1.2], 2) },
  { id: 'fm-piano', file: 'sounds/fm-piano.bin', zones: octaves(null, 'fmpiano', n => `${TX}FM%20Piano/FMPiano_C${n}_vl2.wav`, [2, 1.8, 1.5, 1.2, 1, 0.8, 0.6], 1) },
  { id: 'fm-piano-1', file: 'sounds/fm-piano-1.bin', zones: octaves(null, 'tx1', n => `${TX}Piano%201/Piano%201_C${n}_vl2.wav`, [2, 1.8, 1.5, 1.2, 1, 0.8, 0.6], 1) },
  { id: 'fm-clavisynth', file: 'sounds/fm-clavisynth.bin', zones: octaves(null, 'clavi', n => `${TX}Clavisynth/Clavisynth_C${n}_vl2.wav`, [1.5, 1.4, 1.2, 1, 0.8, 0.6], 1) },
  // Caveman Cosmonaut (Karoryfer): a 1983 Unitra B-11 transistor organ with every register drawn
  // (`all_all_all`). Its files are named an octave below where they sound: c4 is MIDI 48, as the
  // library's own mapping has it.
  { id: 'caveman-organ', file: 'sounds/caveman-organ.bin', zones: [[4, 2], [5, 2], [6, 1.6], [7, 1.4]].map(([octave, seconds]) => (
    { file: `karoryfer/caveman_c${octave}.wav`, from: `${CAVEMAN}all_all_all_c${octave}.wav`, root: 12 * octave, seconds }
  )) },
];

// Recorded drum kits other than the first, each a file of its own fetched once the kit is chosen
// (`sounds/kit-<kit>.bin`), holding `<kit>-<drum>` for the lanes it has; a lane it lacks plays the
// first recorded kit's. One hit each, from a velocity layer near the top, like the Recorded kit's.
// A hit recorded by two microphones at once (`mix`) is the two summed at the levels the library's
// own kit starts with.
const drum = (kit, name, from, seconds, rate = RATE, mix) => ({
  id: `${kit}-${name}`,
  zones: [{ ...(mix ? { mix: mix.map(([part, url, gain]) => ({ file: `karoryfer/${kit}_${name}_${part}.wav`, from: url, gain })) } : { file: `karoryfer/${kit}_${name}.wav`, from }), root: 60, seconds, rate, unpitched: true }],
});
export const KITS = [
  // Gogodze Phu Vol II: recorded with seven microphones, mixed by its player with curves that are
  // not in its files, so each drum is the one microphone nearest it: the kick's and the snare's own,
  // and the overheads for the hats and toms.
  { id: 'gogodze', file: 'sounds/kit-gogodze.bin', sources: [
    drum('gogodze', 'kick', `${GOGODZE}kick_mic/ks_vl5_rr1.wav`, 0.7),
    drum('gogodze', 'snare', `${GOGODZE}snare_mic/sc_vl5_rr1.wav`, 0.6),
    drum('gogodze', 'closedHH', `${GOGODZE}oh_mic/hc_vl3_rr1.wav`, 0.3, 32000),
    drum('gogodze', 'openHH', `${GOGODZE}oh_mic/ho_vl4_rr1.wav`, 1.2, 32000),
    drum('gogodze', 'snare2', `${GOGODZE}oh_mic/tl_vl4_rr1.wav`, 0.9),
    drum('gogodze', 'ride', `${GOGODZE}oh_mic/th_vl4_rr1.wav`, 0.8),
  ] },
  // Swirly Drums, dry: the kick is its resonant head and its beater at 100 and 70, the snare its
  // top and bottom at 80 and 100, the levels `Programs/Basic_kit.sfz` sets; the floor tom and the
  // mid-high tom, the two toms of that kit after the floor.
  { id: 'swirly', file: 'sounds/kit-swirly.bin', sources: [
    drum('swirly', 'kick', null, 0.7, RATE, [['reso', `${SWIRLY}marching_kick/marching_kick_vl18_rr1_reso.wav`, 1], ['beater', `${SWIRLY}marching_kick/marching_kick_vl18_rr1_beater.wav`, 0.7]]),
    drum('swirly', 'snare', null, 0.6, RATE, [['top', `${SWIRLY}snare_main/snare_hit_vl10_rr1_top.wav`, 0.8], ['btm', `${SWIRLY}snare_main/snare_hit_vl10_rr1_btm.wav`, 1]]),
    drum('swirly', 'closedHH', `${SWIRLY}hat_closed/hh_closed_vl10_rr1.wav`, 0.3, 32000),
    drum('swirly', 'openHH', `${SWIRLY}hat_open/hh_open_vl11_rr1.wav`, 1.2, 32000),
    drum('swirly', 'snare2', `${SWIRLY}tom_floor/tom_floor_vl10_rr1.wav`, 0.9),
    drum('swirly', 'ride', `${SWIRLY}tom_mhi/tom_mhi_vl8_rr1.wav`, 0.8),
  ] },
];

function readWav(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV file`);
  let format = null, data = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      let code = bytes.readUInt16LE(at + 8);
      if (code === 0xfffe) code = bytes.readUInt16LE(at + 32);
      format = { code, channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    } else if (id === 'data') data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error(`${path}: no audio in it`);
  const width = format.bits / 8, frames = Math.floor(data.length / (width * format.channels));
  const mono = new Float64Array(frames);
  const read = (offset) => {
    if (format.code === 3) return width === 4 ? data.readFloatLE(offset) : data.readDoubleLE(offset);
    if (width === 2) return data.readInt16LE(offset) / 32768;
    if (width === 3) return data.readIntLE(offset, 3) / 8388608;
    if (width === 4) return data.readInt32LE(offset) / 2147483648;
    throw new Error(`${path}: ${format.bits}-bit audio is not read`);
  };
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) sum += read((frame * format.channels + channel) * width);
    mono[frame] = sum / format.channels;
  }
  return { mono, rate: format.rate };
}

const peakOf = (samples) => samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);

// A windowed-sinc resampler: everything above half the new rate is taken out before it can fold back.
function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = from / to, cutoff = Math.min(1, to / from) * 0.94, reach = 24;
  const out = new Float64Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < out.length; index++) {
    const centre = index * ratio, first = Math.ceil(centre - reach / cutoff), last = Math.floor(centre + reach / cutoff);
    let sum = 0;
    for (let n = Math.max(0, first); n <= Math.min(samples.length - 1, last); n++) {
      const x = (n - centre) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      sum += samples[n] * sinc * (0.5 + 0.5 * Math.cos(Math.PI * x / reach)) * cutoff;
    }
    out[index] = sum;
  }
  return out;
}

// The pitch of a recording, from how far it has to be slid along itself to line up again.
function pitchOf(samples, rate, expected) {
  const start = Math.floor(rate * 0.05), length = Math.min(samples.length - start, Math.floor(rate * 0.3));
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / (expected * 1.3)); lag <= Math.ceil(rate / (expected * 0.77)); lag++) {
    let sum = 0;
    for (let n = start; n < start + length - lag; n++) sum += samples[n] * samples[n + lag];
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return bestLag ? rate / bestLag : 0;
}

// One file, or several recorded at once summed at their gains.
function readZone(folder, file, mix) {
  if (!mix) return readWav(join(folder, file));
  const parts = mix.map(part => ({ ...readWav(join(folder, part.file)), gain: part.gain }));
  if (parts.some(part => part.rate !== parts[0].rate)) throw new Error(`${mix[0].file}: the parts are at different rates`);
  const mono = new Float64Array(Math.max(...parts.map(part => part.mono.length)));
  for (const part of parts) part.mono.forEach((value, index) => { mono[index] += value * part.gain; });
  return { mono, rate: parts[0].rate };
}

function zone(folder, { file, mix, root, seconds, rate: wanted = RATE, unpitched = false }) {
  file ??= mix[0].file;
  const { mono, rate } = readZone(folder, file, mix);
  // Start a moment before the sound does.
  const loud = peakOf(mono), begin = Math.max(0, mono.findIndex(value => Math.abs(value) > loud * 0.02) - Math.floor(rate * 0.002));
  const cut = resample(mono.subarray(begin, begin + Math.ceil(rate * (seconds + 0.05))), rate, wanted).subarray(0, Math.floor(wanted * seconds));
  // The last fifth fades away, so a recording cut short does not stop with a click.
  const fade = Math.floor(cut.length * 0.2), scale = 0.9 / peakOf(cut);
  const out = Float64Array.from(cut, (value, index) => value * scale * Math.min(1, (cut.length - 1 - index) / fade));
  if (unpitched) {
    console.log(`  ${file.padEnd(24)} ${(out.length / wanted).toFixed(2)}s kept of ${((mono.length - begin) / rate).toFixed(2)}s, at ${wanted} Hz`);
    return { root, rate: wanted, samples: out };
  }
  const expected = 440 * 2 ** ((root - 69) / 12), heard = pitchOf(out, RATE, expected);
  const cents = heard ? 1200 * Math.log2(heard / expected) : NaN;
  console.log(`  ${file.padEnd(24)} root ${root}  ${seconds}s  pitch ${heard.toFixed(1)} Hz against ${expected.toFixed(1)} (${cents.toFixed(0)} cents)`);
  return { root, rate: RATE, samples: out };
}

function frame(folder, { file }) {
  const { mono } = readWav(join(folder, file));
  if (mono.length !== FRAME) throw new Error(`${file}: ${mono.length} samples, not one cycle of ${FRAME}`);
  const mean = mono.reduce((sum, value) => sum + value, 0) / FRAME;
  const level = mono.map(value => value - mean), scale = 0.9 / (peakOf(level) || 1);
  return level.map(value => value * scale);
}

function bundle(folder, sources, path) {
  const waves = [], audio = [];
  let offset = 0;
  const keep = (samples) => { audio.push(samples); offset += samples.length; return { offset: offset - samples.length, length: samples.length }; };
  for (const source of sources) {
    console.log(source.id);
    if (source.frames) {
      const joined = new Float64Array(FRAME * source.frames.length);
      source.frames.forEach((entry, index) => joined.set(frame(folder, entry), index * FRAME));
      waves.push({ id: source.id, frame: FRAME, zones: [{ root: 0, rate: 0, ...keep(joined) }] });
      console.log(`  ${source.frames.length} cycle${source.frames.length === 1 ? '' : 's'}`);
    } else {
      waves.push({ id: source.id, zones: source.zones.map(entry => { const made = zone(folder, entry); return { root: made.root, rate: made.rate, ...keep(made.samples) }; }) });
    }
  }
  let json = JSON.stringify({ waves });
  if (json.length % 2) json += ' ';
  const header = Buffer.alloc(12);
  header.write('DBWV', 0, 'latin1'); header.writeUInt32LE(1, 4); header.writeUInt32LE(json.length, 8);
  const pcm = Buffer.alloc(offset * 2);
  let at = 0;
  for (const samples of audio) for (const value of samples) { pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), at); at += 2; }
  const file = Buffer.concat([header, Buffer.from(json, 'latin1'), pcm]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file);
  console.log(`${path}: ${file.length} bytes (${(file.length / 1024).toFixed(0)} KB)`);
}

function build(folder, only) {
  const wanted = (file) => only.length === 0 || only.includes(file);
  if (wanted('waves.bin')) bundle(folder, SOURCES, 'ui/public/waves.bin');
  for (const instrument of INSTRUMENTS) if (wanted(instrument.file)) bundle(folder, [{ id: instrument.id, zones: instrument.zones }], `ui/public/${instrument.file}`);
  for (const kit of KITS) if (wanted(kit.file)) bundle(folder, kit.sources, `ui/public/${kit.file}`);
}

if (process.argv[2]) build(process.argv[2], process.argv.slice(3));
else console.log('Usage: node scripts/build-waves.mjs <folder holding vsco/, vcsl/, akwf/ and karoryfer/> [files to build]');

