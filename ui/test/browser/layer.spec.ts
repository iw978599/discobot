import { expect, test, type Page, type Locator } from '@playwright/test';
import { SYNTH_MODELS } from '../../src/synthModels';

// The lane's Model menu, and a model chosen from it by id: from its group's list, or from the
// first list for one that is in no group.
const modelMenu = (scope: Page | Locator) => scope.getByRole('button', { name: /^Synth model: / });
async function chooseModel(scope: Page | Locator, id: string) {
  await modelMenu(scope).click();
  const group = SYNTH_MODELS.find(model => model.id === id)?.group;
  if (group) await scope.locator(`[role="menuitem"][data-group="${group}"]`).click();
  await scope.locator(`[role="menuitem"][data-item="${id}"]`).click();
}

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
const layer = async (page: Page) => (await stored(page)).synths[0].synthParams.layer;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a second layer is switched on and set on the Osc tab, is saved, and the CS-80 model sets it by itself', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  const enabled = synth.getByLabel('Second layer enabled', { exact: true });
  const detune = synth.getByLabel('Layer detune value', { exact: true });
  const mix = synth.getByLabel('Layer mix value', { exact: true });

  // One layer to begin with, and nothing to set until there are two.
  await expect(enabled).not.toBeChecked();
  await expect(synth.getByRole('slider', { name: 'Layer detune', exact: true })).toHaveAttribute('aria-disabled', 'true');
  expect((await layer(page)).enabled).toBe(false);

  await enabled.check({ force: true });
  await expect.poll(async () => (await layer(page)).enabled).toBe(true);
  await expect(synth.getByRole('slider', { name: 'Layer detune', exact: true })).toHaveAttribute('aria-disabled', 'false');
  await detune.fill('-12');
  await detune.press('Enter');
  await mix.fill('30');
  await mix.press('Enter');
  await expect.poll(async () => { const now = await layer(page); return [now.detune, now.mix]; }).toEqual([-12, 0.3]);
  await expect(detune).toHaveValue('-12c');

  // It is still there after a reload.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await expect(page.locator('.synth-controls-panel').first().getByLabel('Second layer enabled', { exact: true })).toBeChecked();

  // The CS-80 is two layers; any other model is one again.
  const panel = page.locator('.synth-controls-panel').first();
  await chooseModel(panel, 'juno-106');
  await expect.poll(async () => (await layer(page)).enabled).toBe(false);
  await chooseModel(panel, 'cs-80');
  await expect.poll(async () => (await layer(page)).enabled).toBe(true);
});
