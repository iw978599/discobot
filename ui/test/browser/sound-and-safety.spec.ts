import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
// What is in storage right now, without nudging the app to save first.
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

async function setTempo(page: Page, bpm: number) {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(String(bpm));
  await page.locator('.tempo-led-input').press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    const counter = { writes: 0 };
    (window as unknown as { projectWrites: typeof counter }).projectWrites = counter;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'discobot_browser_project_v1') counter.writes++;
      return setItem.call(this, key, value);
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  // Lanes 2 and 3 are created on first load; let that settle so it does not count as an edit.
  await expect(page.getByRole('button', { name: 'Synth 3', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('unison, the 24 dB filter and kick ducking are saved, and ducking is audible in an exported stem', async ({ page }, testInfo) => {
  const synth = page.locator('.synth-controls-panel');
  await tab(page, 'Osc');
  const voices = synth.getByRole('slider', { name: 'Voices', exact: true });
  await expect(synth.getByRole('slider', { name: 'Uni Det', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await voices.press('ArrowUp');
  await voices.press('ArrowUp');
  await expect(synth.getByLabel('Voices value', { exact: true })).toHaveValue('3');
  await synth.getByLabel('Uni Det value', { exact: true }).fill('20');
  await synth.getByLabel('Uni Det value', { exact: true }).press('Enter');
  await tab(page, 'Filter');
  await synth.getByLabel('Filter slope', { exact: true }).selectOption('24');
  await expect.poll(async () => {
    const params = (await stored(page)).synths[0].synthParams;
    return [params.unison.voices, params.unison.detune, params.filter.slope];
  }).toEqual([3, 0.4, 24]);

  // A long note under a kick on the first step: the stem's opening should be quieter with ducking on.
  await tab(page, 'Amp');
  await synth.getByLabel('Sustain value', { exact: true }).fill('100');
  await synth.getByLabel('Sustain value', { exact: true }).press('Enter');
  await tab(page, 'Notes');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByLabel('Step 1 slide', { exact: true }).check();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  const stemOpening = async (name: string) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Stems', exact: true }).click();
    const path = testInfo.outputPath(name);
    await (await download).saveAs(path);
    const zip = await readFile(path);
    expect(zip.subarray(30, 41).toString(), 'the synth lane is the first file in the zip').toBe('synth-1.wav');
    const audio = zip.subarray(30 + 11 + 44);
    let sum = 0;
    // 20 to 60 ms in, left channel: after the attack, while the duck is at its deepest.
    for (let frame = 882; frame < 2646; frame++) sum += (audio.readInt16LE(frame * 4) / 32768) ** 2;
    return Math.sqrt(sum / 1764);
  };
  const open = await stemOpening('plain.zip');
  await tab(page, 'Sends');
  await synth.getByLabel('Duck value', { exact: true }).fill('100%');
  await synth.getByLabel('Duck value', { exact: true }).press('Enter');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.duck).toBe(1);
  const ducked = await stemOpening('ducked.zip');
  expect(open).toBeGreaterThan(0.01);
  expect(ducked, 'the lane drops well below its normal level right after the kick').toBeLessThan(open * 0.4);

  await page.reload();
  await tab(page, 'Sends');
  await expect(page.getByLabel('Duck value', { exact: true })).toHaveValue('100%');
  await tab(page, 'Filter');
  await expect(page.getByLabel('Filter slope', { exact: true })).toHaveValue('24');
});

test('turning a knob many times is saved once, and nothing is lost on reload', async ({ page }) => {
  await tab(page, 'Amp');
  const gain = page.locator('.synth-controls-panel').getByRole('slider', { name: 'Gain', exact: true });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (window as unknown as { projectWrites: { writes: number } }).projectWrites.writes);
  await gain.focus();
  for (let i = 0; i < 25; i++) await gain.press('ArrowDown');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.75');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.gain).toBe(0.75);
  const writes = await page.evaluate(() => (window as unknown as { projectWrites: { writes: number } }).projectWrites.writes) - before;
  expect(writes, '25 changes should not be 25 full-project writes').toBeLessThanOrEqual(5);

  // An edit made a moment before leaving the page is still saved.
  await gain.press('ArrowDown');
  await page.reload();
  await tab(page, 'Amp');
  await expect(page.locator('.synth-controls-panel').getByRole('slider', { name: 'Gain', exact: true })).toHaveAttribute('aria-valuenow', '0.74');
});

test('a second tab cannot silently overwrite the project', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await setTempo(other, 150);
  await expect.poll(async () => (await stored(other)).tempo).toBe(150);

  const warning = page.getByRole('alert').filter({ hasText: 'changed in another tab' });
  await expect(warning).toBeVisible();
  await setTempo(page, 99);
  await page.waitForTimeout(600);
  expect((await stored(page)).tempo, 'the first tab does not write over the second').toBe(150);

  await warning.getByRole('button', { name: "Load the other tab's version", exact: true }).click();
  await expect(page.locator('.tempo-led-value')).toHaveText('150');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The other way round: this tab's edits win when asked to.
  await setTempo(other, 151);
  await expect(warning).toBeVisible();
  await setTempo(page, 88);
  await warning.getByRole('button', { name: "Keep this tab's version", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).tempo).toBe(88);
  await setTempo(page, 87);
  await expect.poll(async () => (await stored(page)).tempo, { message: 'saving has resumed' }).toBe(87);
  await other.close();
});
