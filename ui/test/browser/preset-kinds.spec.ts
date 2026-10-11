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
    { label: 'Bass', options: ['Bass *', 'Bass — Deep Sub *', 'Bass — Acid Pulse *', 'Bass — Rubber Square *'] },
    { label: 'Lead', options: ['Lead *', 'Lead — Bright Saw *', 'Lead — Soft Triangle *', 'Lead — Singing Pulse *'] },
    { label: 'Pad', options: ['Pad *', 'Pad — Warm Cloud *', 'Pad — Glass Air *', 'Pad — Analog Strings *'] },
    { label: 'Keys', options: ['Electric Piano *'] },
    { label: 'Pluck', options: ['Pluck *', 'Pluck — Bell *', 'Pluck — Wooden *', 'Pluck — Short Wire *'] },
  ]);
  // Only the heading "Preset..." stands outside a group.
  await expect(menu.locator(':scope > option')).toHaveText(['Preset...']);

  await lane.getByLabel('Preset name', { exact: true }).fill('Night Bass');
  await lane.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await groups(menu)).at(-1)).toEqual({ label: 'My presets', options: ['Night Bass'] });
  expect((await groups(menu)).map(group => group.label), 'the person\'s own presets come after the built-in kinds').toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'My presets']);
});

test('a preset chosen from its group still loads its sound', async ({ page }) => {
  const lane = page.locator('.synth-module').first();
  await lane.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'Electric Piano *' });
  await expect(page.getByLabel('Synth model', { exact: true }).first()).toHaveValue('dx7');
});
