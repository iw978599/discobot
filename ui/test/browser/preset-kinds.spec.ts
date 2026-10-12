import { expect, test, type Locator } from '@playwright/test';

const groups = (menu: Locator) => menu.evaluate(select => [...select.querySelectorAll('optgroup')].map(group => ({
  label: group.label,
  options: [...group.querySelectorAll('option')].map(option => option.textContent),
})));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
});

test('the presets menu is grouped by kind, and a person\'s own presets have a group of their own', async ({ page }) => {
  const lane = page.locator('.synth-module').first();
  const menu = lane.getByLabel('Synth preset', { exact: true });
  await expect.poll(() => groups(menu)).toEqual([
    { label: 'Bass', options: ['Sub Bass *', 'Round Bass *', 'Acid Bass *', 'Rubber Bass *', 'Reese Bass *', 'FM Bass *', 'Pluck Bass *', 'Wobble Bass *'] },
    { label: 'Lead', options: ['Saw Lead *', 'Square Lead *', 'PWM Lead *', 'Super Saw *', 'Soft Lead *', 'Squelch Lead *', 'Glass Lead *'] },
    { label: 'Pad', options: ['Warm Pad *', 'String Ensemble *', 'PWM Pad *', 'Glass Pad *', 'Sweep Pad *', 'Dark Pad *', 'Breath Pad *'] },
    { label: 'Keys', options: ['Electric Piano *', 'Digital Piano *', 'Organ *', 'Clav *', 'Juno Keys *', 'Poly Brass *'] },
    { label: 'Pluck', options: ['Saw Pluck *', 'Bell *', 'Marimba *', 'Kalimba *', 'Nylon Pluck *', 'Chord Stab *', 'Blip *'] },
    { label: 'Effects', options: ['Noise Riser *', 'Laser *', 'Wind *', 'Siren *', 'Alarm *', 'Helicopter *'] },
  ]);
  // Only the heading "Preset..." stands outside a group.
  await expect(menu.locator(':scope > option')).toHaveText(['Preset...']);

  await lane.getByLabel('Preset name', { exact: true }).fill('Night Bass');
  await lane.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await groups(menu)).at(-1)).toEqual({ label: 'My presets', options: ['Night Bass'] });
  expect((await groups(menu)).map(group => group.label), 'the person\'s own presets come after the built-in kinds').toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects', 'My presets']);
});

test('a preset chosen from its group still loads its sound', async ({ page }) => {
  const lane = page.locator('.synth-module').first();
  await lane.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'Electric Piano *' });
  await expect(page.getByLabel('Synth model', { exact: true }).first()).toHaveValue('dx7');
});
