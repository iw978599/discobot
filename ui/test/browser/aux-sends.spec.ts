import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Two aux buses, each pointed at an echo, the Hall or a chorus (in the effects unit), and a send to
// each from every lane, the drums and every guest. Nothing is stored for a bus or a send that is
// as it starts.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}
async function exportWav(page: Page, path: string) {
  await page.waitForTimeout(250);
  const download = page.waitForEvent('download');
  await exportAs(page, 'Scene WAV');
  await (await download).saveAs(path);
  return readFile(path);
}
function same(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 44; i + 1 < a.length; i += 2) {
    const gap = Math.abs(a.readInt16LE(i) - b.readInt16LE(i));
    if (gap > 2 || (gap > 0 && ++differing > 40)) return false;
  }
  return true;
}

const effects = (page: Page) => page.locator('.effects-unit');
const bus = (page: Page, name: 'A' | 'B') => effects(page).locator(`[data-aux="${name}"]`);
const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the two buses start as an echo and a Hall, and what is changed is stored and kept across a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByLabel('Aux A effect', { exact: true })).toHaveValue('echo');
  await expect(page.getByLabel('Aux B effect', { exact: true })).toHaveValue('hall');
  expect((await stored(page)).effectsLoop.aux, 'a project that never touched them stores none').toBeUndefined();

  await page.getByLabel('Aux A effect', { exact: true }).selectOption('chorus');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.[0]?.kind).toBe('chorus');
  await expect(page.getByLabel('Aux A rate value', { exact: true })).toBeVisible();
  await edit(bus(page, 'B').getByLabel('Aux B decay value', { exact: true }), '4');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.[1]?.main).toBeCloseTo(4, 1);

  await page.reload();
  await expect(page.getByLabel('Aux A effect', { exact: true })).toHaveValue('chorus');
  await expect(bus(page, 'B').getByLabel('Aux B decay value', { exact: true })).toHaveValue(/4/);

  await page.getByLabel('Aux A effect', { exact: true }).selectOption('echo');
  await edit(bus(page, 'B').getByLabel('Aux B decay value', { exact: true }), '2.5');
  await expect.poll(async () => 'aux' in (await stored(page)).effectsLoop, 'back as they start, nothing is stored').toBe(false);
  expect(errors).toEqual([]);
});

test('the echo and the chorus can follow the tempo, and turning the knob sets a free value again', async ({ page }) => {
  const a = bus(page, 'A');
  await a.getByLabel('Aux A sync', { exact: true }).selectOption('1/4');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.[0]?.sync).toBe('1/4');
  await edit(a.getByLabel('Aux A time value', { exact: true }), '300');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.[0]?.sync).toBeUndefined();
  await expect(a.getByLabel('Aux A sync', { exact: true })).toHaveValue('off');
  await expect(bus(page, 'B').getByLabel('Aux B sync', { exact: true }), 'the Hall has no sync').toHaveCount(0);
});

test('a lane, the kit and a guest each send to the buses, and a send brought back to nothing is not stored', async ({ page }) => {
  const first = lane(page);
  await first.getByRole('tab', { name: 'Sound', exact: true }).click();
  await first.getByRole('tab', { name: 'Sends', exact: true }).click();
  expect((await stored(page)).synths[0].synthParams.fxSends.auxA, 'a new lane stores no send').toBeUndefined();
  await edit(first.getByLabel('Aux A send value', { exact: true }), '40%');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.fxSends.auxA).toBeCloseTo(0.4, 2);
  await edit(first.getByLabel('Aux A send value', { exact: true }), '0%');
  await expect.poll(async () => 'auxA' in (await stored(page)).synths[0].synthParams.fxSends).toBe(false);

  const drums = page.locator('[data-unit="drums"]');
  await drums.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(drums.getByLabel('Aux B value', { exact: true }), '50%');
  await expect.poll(async () => (await stored(page)).drumFx.sends.auxB).toBeCloseTo(0.5, 2);
  await edit(drums.getByLabel('Aux B value', { exact: true }), '0%');
  await expect.poll(async () => 'auxB' in (await stored(page)).drumFx.sends).toBe(false);
});

test('an export has what is sent to a bus in it, the same every time, and none of it when nothing is sent', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const take = (name: string) => exportWav(page, testInfo.outputPath(`${name}.wav`));
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await effects(page).getByLabel('Delay enabled', { exact: true }).uncheck();
  await effects(page).getByLabel('Drive enabled', { exact: true }).uncheck();
  await effects(page).getByLabel('Reverb enabled', { exact: true }).uncheck();
  const drums = page.locator('[data-unit="drums"]');
  await drums.getByRole('button', { name: 'Sends', exact: true }).click();
  for (const name of ['Rev Send', 'Dly Send', 'Drv Send', 'Phs Send']) await edit(drums.getByLabel(`${name} value`, { exact: true }), '0%');
  await edit(drums.getByLabel('FX Return value', { exact: true }), '100%');

  const dry = await take('dry');
  await edit(bus(page, 'A').getByLabel('Aux A level value', { exact: true }), '100%');
  expect(same(await take('level-up'), dry), 'a bus nothing is sent to changes nothing').toBe(true);

  await edit(drums.getByLabel('Aux A value', { exact: true }), '100%');
  await expect.poll(async () => (await stored(page)).drumFx.sends.auxA).toBe(1);
  const echoed = await take('echoed');
  expect(same(echoed, dry), 'the echo is heard').toBe(false);
  expect(same(await take('echoed-again'), echoed), 'and is the same every time').toBe(true);

  await bus(page, 'A').getByLabel('Aux A effect', { exact: true }).selectOption('hall');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.[0]?.kind).toBe('hall');
  const hall = await take('hall');
  expect(same(hall, echoed), 'another effect on the bus sounds different').toBe(false);
  expect(errors).toEqual([]);
});
