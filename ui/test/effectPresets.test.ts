import test from 'node:test';
import assert from 'node:assert/strict';
import { DELAY_PRESETS, REVERB_PRESETS } from '../src/services/effectPresets.ts';
import { EFFECTS_DEFAULT } from '../src/services/effectSettings.ts';
import { sanitizeEffects } from '../src/services/projectSanitization.ts';

// What the store keeps of an effect, with the sync and kind it drops for "off" and "room" put back.
const kept = (state: ReturnType<typeof sanitizeEffects>) => ({
  delay: { ...state.delay, sync: state.delay.sync ?? 'off' },
  reverb: { ...state.reverb, kind: state.reverb.kind ?? 'room' },
});

test('every effect preset is inside what the store keeps, so choosing one sets exactly that', () => {
  for (const preset of DELAY_PRESETS) {
    const delay = { ...EFFECTS_DEFAULT.delay, ...preset.settings, enabled: true };
    assert.deepEqual(kept(sanitizeEffects({ ...EFFECTS_DEFAULT, delay }, EFFECTS_DEFAULT)).delay, delay, preset.name);
  }
  for (const preset of REVERB_PRESETS) {
    const reverb = { ...EFFECTS_DEFAULT.reverb, ...preset.settings, enabled: true };
    assert.deepEqual(kept(sanitizeEffects({ ...EFFECTS_DEFAULT, reverb }, EFFECTS_DEFAULT)).reverb, reverb, preset.name);
  }
  // Each sets every setting of its effect, so nothing of the one before is left behind.
  for (const preset of DELAY_PRESETS) assert.deepEqual(Object.keys(preset.settings).sort(), ['feedback', 'mix', 'sync', 'time'], preset.name);
  for (const preset of REVERB_PRESETS) assert.deepEqual(Object.keys(preset.settings).sort(), ['damping', 'decay', 'kind', 'mix', 'preDelay'], preset.name);
  const names = [...DELAY_PRESETS, ...REVERB_PRESETS].map(preset => preset.name);
  assert.equal(new Set(names).size, names.length);
});
