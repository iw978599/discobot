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

// Each synth lane has effects of its own on the Inserts page of Sound: drive and tone, a chorus
// and a delay. A lane that never used them stores nothing for them, and the Polysix's Ensemble
// is the mix of its chorus.
const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const params = async (page: Page, index = 0) => (await stored(page)).synths?.[index]?.synthParams;

const lane = (page: Page, id = 1) => page.getByRole('region', { name: `Synth ${id} module`, exact: true });
const openInserts = async (page: Page) => {
  const first = lane(page);
  await first.getByRole('tab', { name: 'Sound', exact: true }).click();
  await first.getByRole('tab', { name: 'Inserts', exact: true }).click();
  return first;
};
const setKnob = async (scope: ReturnType<typeof lane>, name: string, text: string) => {
  const field = scope.getByLabel(`${name} value`, { exact: true });
  await field.fill(text);
  await field.press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a lane has no insert effects until one is set, and setting one back to nothing stores nothing', async ({ page }) => {
  expect((await params(page)).inserts, 'a new lane stores none').toBeUndefined();
  const first = await openInserts(page);
  for (const name of ['Insert drive', 'Insert tone', 'Insert chorus mix', 'Insert chorus depth', 'Insert chorus rate', 'Insert delay mix', 'Insert delay time', 'Insert delay feedback']) {
    await expect(first.getByLabel(`${name} value`, { exact: true }), name).toBeVisible();
  }

  await setKnob(first, 'Insert drive', '40%');
  await expect.poll(async () => (await params(page)).inserts?.drive).toBeCloseTo(0.4, 2);
  await setKnob(first, 'Insert delay mix', '30%');
  await expect.poll(async () => (await params(page)).inserts?.delay?.mix).toBeCloseTo(0.3, 2);

  await setKnob(first, 'Insert drive', '0%');
  await setKnob(first, 'Insert delay mix', '0%');
  await expect.poll(async () => (await params(page)).inserts, 'with every effect back at its start nothing is stored').toBeUndefined();
});

test('the chorus and the delay can follow the tempo, and a free rate or time turns that off', async ({ page }) => {
  const first = await openInserts(page);
  await setKnob(first, 'Insert chorus mix', '50%');
  await first.getByLabel('Insert chorus sync', { exact: true }).selectOption('1/4');
  await first.getByLabel('Insert delay sync', { exact: true }).selectOption('1/8');
  await expect.poll(async () => (await params(page)).inserts?.chorus?.sync).toBe('1/4');
  await expect.poll(async () => (await params(page)).inserts?.delay?.sync).toBe('1/8');

  await setKnob(first, 'Insert chorus rate', '2');
  await expect.poll(async () => (await params(page)).inserts?.chorus?.sync, 'a free rate is not synced').toBeUndefined();
  await expect(first.getByLabel('Insert chorus sync', { exact: true })).toHaveValue('off');
  await expect.poll(async () => (await params(page)).inserts?.chorus?.rate).toBeCloseTo(2, 1);
});

test('the Polysix Ensemble is the mix of the lane chorus, and leaving the Polysix takes it away', async ({ page }) => {
  const first = lane(page);
  await first.getByRole('tab', { name: 'Sound', exact: true }).click();
  await chooseModel(first, 'polysix');
  const macros = page.locator('.synth-module.selected .synth-model-macro-grid [role="slider"]');
  await expect(macros).toHaveCount(4);
  await macros.nth(3).focus();
  for (let n = 0; n < 5; n++) await macros.nth(3).press('ArrowUp');
  await expect.poll(async () => (await params(page)).inserts?.chorus?.mix, 'Ensemble sets the chorus insert').toBeGreaterThan(0);
  expect((await params(page)).fxSends.chorus, 'and not the shared chorus send').toBe(0);

  await setKnob(await openInserts(page), 'Insert drive', '25%');
  await chooseModel(first, 'minimoog-model-d');
  await expect.poll(async () => (await params(page)).inserts?.chorus?.mix ?? 0, 'the chorus goes with the Polysix').toBe(0);
  expect((await params(page)).inserts?.drive, 'the lane\'s other inserts stay').toBeCloseTo(0.25, 2);
});

test('loading a preset puts back the sound it was saved with, inserts included', async ({ page }) => {
  const first = await openInserts(page);
  await setKnob(first, 'Insert drive', '60%');
  await expect.poll(async () => (await params(page)).inserts?.drive).toBeCloseTo(0.6, 2);
  await first.getByLabel('Preset name', { exact: true }).fill('Grit');
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await setKnob(first, 'Insert drive', '0%');
  await expect.poll(async () => (await params(page)).inserts).toBeUndefined();
  await page.reload();
  const again = lane(page);
  await again.getByRole('tab', { name: 'Sound', exact: true }).click();
  await again.getByRole('button', { name: /^Synth preset/ }).click();
  await again.locator('[role="menuitem"][data-group="My presets"]').click();
  await again.getByRole('menu', { name: 'My presets', exact: true }).getByRole('menuitem', { name: 'Grit', exact: true }).click();
  await expect.poll(async () => (await params(page)).inserts?.drive).toBeCloseTo(0.6, 2);
});
