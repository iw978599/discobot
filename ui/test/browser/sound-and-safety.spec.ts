import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

// Export is a dialog: what (the scene or the song), as what, then Export. It is closed at once and
// the file goes on being made, so the caller waits for the download as it did with the menu.
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: item === 'Loop WAV' ? 'Seamless loop' : item === 'Stems' ? 'Stems' : item.endsWith('MIDI') ? 'MIDI' : 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

const PROJECT_KEY = 'discobot_browser_project_v1';
// What is in storage right now, without nudging the app to save first.
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
// The editor has two levels, Notes and Sound; the pages of the sound (Osc, Filter and the rest) are under Sound.
const tab = async (page: Page, name: string) => {
  if (name !== 'Notes' && name !== 'Sound') await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).click();
};

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
  await expect(synth.getByRole('slider', { name: 'Unison detune', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await voices.press('ArrowUp');
  await voices.press('ArrowUp');
  await expect(synth.getByLabel('Voices value', { exact: true })).toHaveValue('3');
  await synth.getByLabel('Unison detune value', { exact: true }).fill('20');
  await synth.getByLabel('Unison detune value', { exact: true }).press('Enter');
  await tab(page, 'Filter');
  // The ladder is a third choice beside the two slopes. It is a 24 dB filter, and choosing a
  // plain slope again goes back to the clean filter.
  await synth.getByLabel('Filter slope', { exact: true }).selectOption('ladder');
  await expect.poll(async () => {
    const { filter } = (await stored(page)).synths[0].synthParams;
    return [filter.slope, filter.model];
  }).toEqual([24, 'ladder']);
  await expect(synth.getByLabel('Filter slope', { exact: true })).toHaveValue('ladder');
  // The MS-20's filter is a fourth, at 12 dB, and the high-pass in front of the filter is a knob of its own.
  await synth.getByLabel('Filter slope', { exact: true }).selectOption('ms20');
  await expect(synth.getByLabel('High-pass cutoff value', { exact: true })).toHaveValue('Off');
  await synth.getByLabel('High-pass cutoff value', { exact: true }).fill('300');
  await synth.getByLabel('High-pass cutoff value', { exact: true }).press('Enter');
  await expect.poll(async () => {
    const { filter } = (await stored(page)).synths[0].synthParams;
    return [filter.slope, filter.model, filter.highpass];
  }).toEqual([12, 'ms20', 300]);
  await expect(synth.getByLabel('High-pass cutoff value', { exact: true })).toHaveValue('300Hz');
  await synth.getByLabel('High-pass cutoff value', { exact: true }).fill('0');
  await synth.getByLabel('High-pass cutoff value', { exact: true }).press('Enter');
  await expect(synth.getByLabel('High-pass cutoff value', { exact: true })).toHaveValue('Off');
  await synth.getByLabel('Filter slope', { exact: true }).selectOption('24');
  await expect.poll(async () => {
    const params = (await stored(page)).synths[0].synthParams;
    return [params.unison.voices, params.unison.detune, params.filter.slope, params.filter.model];
  }).toEqual([3, 0.4, 24, 'svf']);

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
    await exportAs(page, 'Stems');
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
