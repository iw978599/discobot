import test from 'node:test';
import assert from 'node:assert/strict';
import { CHORUS_PRESETS, DELAY_PRESETS, DRIVE_PRESETS, PHASER_PRESETS, REVERB_PRESETS } from '../src/services/effectPresets.ts';
import { CHORUS_DEFAULT, EFFECTS_DEFAULT } from '../src/services/effectSettings.ts';
import { sanitizeEffects } from '../src/services/projectSanitization.ts';
import { driveCurve, delayColorHz } from '../src/hooks/browserAudio.ts';

// What the store keeps of an effect, with what it keeps as nothing ('off', 'room', 'classic', none) put back.
const kept = (state: ReturnType<typeof sanitizeEffects>) => ({
  delay: { ...state.delay, sync: state.delay.sync ?? 'off', color: state.delay.color ?? 0, wow: state.delay.wow ?? 0 },
  reverb: { ...state.reverb, kind: state.reverb.kind ?? 'room', preDelay: state.reverb.preDelay ?? 0, damping: state.reverb.damping ?? 0 },
  chorus: { ...state.chorus!, sync: state.chorus?.sync ?? 'off' },
  phaser: { ...state.phaser, sync: state.phaser.sync ?? 'off' },
  drive: { ...state.drive, kind: state.drive.kind ?? 'classic' },
});

test('every effect preset is inside what the store keeps, so choosing one sets exactly that', () => {
  const groups = [
    ['delay', DELAY_PRESETS, EFFECTS_DEFAULT.delay],
    ['reverb', REVERB_PRESETS, EFFECTS_DEFAULT.reverb],
    ['chorus', CHORUS_PRESETS, CHORUS_DEFAULT],
    ['phaser', PHASER_PRESETS, EFFECTS_DEFAULT.phaser],
    ['drive', DRIVE_PRESETS, EFFECTS_DEFAULT.drive],
  ] as const;
  for (const [effect, presets, base] of groups) {
    for (const preset of presets) {
      const setting = { ...base, ...preset.settings, enabled: true };
      const state = sanitizeEffects({ ...EFFECTS_DEFAULT, [effect]: setting }, EFFECTS_DEFAULT);
      assert.deepEqual(kept(state)[effect], setting, preset.name);
    }
    // Each sets every setting of its effect, so nothing of the one before is left behind.
    const keys = Object.keys(presets[0].settings).sort();
    for (const preset of presets) assert.deepEqual(Object.keys(preset.settings).sort(), keys, preset.name);
  }
  const names = groups.flatMap(([, presets]) => presets.map(preset => preset.name));
  assert.equal(new Set(names).size, names.length);
});

test('the drive\'s kinds clip differently, and with no kind it is the curve it always was', () => {
  const at = (curve: Float32Array, x: number) => curve[Math.round((x + 1) / 2 * (curve.length - 1))];
  const classic = driveCurve(0.5);
  for (let i = 0; i < classic.length; i += 64) {
    const x = 2 * i / (classic.length - 1) - 1;
    assert.ok(Math.abs(classic[i] - Math.tanh(x * 9) / Math.tanh(9)) < 1e-6);
  }
  const quiet = 0.02;
  const gain = (kind?: 'overdrive' | 'distortion' | 'fuzz') => at(driveCurve(0.7, kind), quiet) / quiet;
  assert.ok(gain('distortion') > gain('overdrive') && gain('fuzz') > gain('distortion'), 'each kind clips harder than the one before');
  const lopsided = (kind: 'overdrive' | 'fuzz') => Math.abs(at(driveCurve(0.7, kind), 0.5) + at(driveCurve(0.7, kind), -0.5));
  assert.ok(lopsided('overdrive') > 0.01 && lopsided('fuzz') > 0.01, 'an overdrive and a fuzz lean to one side');
  for (const kind of [undefined, 'overdrive', 'distortion', 'fuzz'] as const) {
    assert.ok(driveCurve(1, kind).every(value => Math.abs(value) <= 1), `${kind ?? 'classic'} stays within full scale`);
  }
});

test('a delay\'s colour darkens its repeats from nothing to under 1.5 kHz, and stored settings are checked', () => {
  assert.equal(delayColorHz(0), 12000);
  assert.equal(delayColorHz(1), 1500);
  assert.ok(delayColorHz(0.5) < 12000 && delayColorHz(0.5) > 1500);
  const state = sanitizeEffects({ ...EFFECTS_DEFAULT, delay: { ...EFFECTS_DEFAULT.delay, color: 7, wow: -1 }, drive: { ...EFFECTS_DEFAULT.drive, kind: 'loud' } }, EFFECTS_DEFAULT);
  assert.equal(state.delay.color, 1);
  assert.equal('wow' in state.delay, false, 'a wow of nothing is stored as nothing');
  assert.equal('kind' in state.drive, false, 'a kind this version does not have is the classic drive');
  const plain = sanitizeEffects(EFFECTS_DEFAULT, EFFECTS_DEFAULT);
  assert.deepEqual([('color' in plain.delay), ('wow' in plain.delay), ('kind' in plain.drive)], [false, false, false], 'a project that never set them is unchanged');
});
