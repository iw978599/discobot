import { expect, test, type Locator, type Page } from '@playwright/test';

const DRUMS = ['Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Low Tom', 'High Tom', 'Cymbal'];
// The editor has two levels, Notes and Sound; the pages of the sound (Osc, Filter and the rest) are under Sound.
const tab = async (page: Page, name: string) => {
  if (name !== 'Notes' && name !== 'Sound') await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).click();
};

// Whether a piece of text is cut off or spills out of its box.
const clipped = (locator: Locator) => locator.evaluate(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a drum has one name: the same word on the grid, in its hint, to a screen reader and in the strip', async ({ page }) => {
  for (const name of DRUMS) {
    const button = page.getByRole('button', { name: `Select ${name}`, exact: true });
    await expect(button).toBeVisible();
    await expect(button, `${name}: the grid shows the whole word`).toHaveText(new RegExp(`^${name}$`, 'i'));
    await expect(button).toHaveAttribute('title', new RegExp(`^${name}:`));
    expect(await clipped(button), `${name}: the word fits its button`).toBe(false);
    await button.click();
    await expect(page.locator('.drum-strip-name b')).toHaveText(name);
  }
  for (const short of ['BD', 'SD', 'CP', 'CH', 'OH', 'LT', 'HT', 'CY']) {
    await expect(page.locator('.drum-name', { hasText: new RegExp(`^${short}$`) })).toHaveCount(0);
  }
});

test('every pattern button has a word, not only an arrow', async ({ page }) => {
  const tools = page.locator('.drum-machine .drum-tools').first();
  await expect(tools.getByRole('button')).toHaveText(['Fill', '→ Shift', '⇄ Reverse', '⇈ Repeat Half']);
  for (const [name, hint] of [['Shift right', 'Shift pattern right'], ['Reverse', 'Reverse pattern'], ['Repeat first half', 'Duplicate first 8 steps to last 8']]) {
    await expect(tools.getByRole('button', { name, exact: true })).toHaveAttribute('title', hint);
  }
});

test('a knob has one name wherever it appears', async ({ page }) => {
  // The lane's knob has no room for more than "Reso" and says the whole word as its hint.
  const resoKnob = page.getByRole('slider', { name: 'Synth 1 resonance', exact: true });
  await expect(resoKnob).toBeVisible();
  await expect(page.locator('.knob-label[title="Resonance"]').first()).toHaveText('Reso');

  // Where there is room it is spelled out, and fits.
  await tab(page, 'Filter');
  const panel = page.locator('.synth-controls-panel');
  for (const name of ['Resonance', 'Drive']) {
    const label = panel.locator('.knob-label:visible', { hasText: new RegExp(`^${name}$`, 'i') });
    await expect(label).toBeVisible();
    expect(await clipped(label), `${name} fits`).toBe(false);
  }
  await expect(panel.getByRole('slider', { name: 'Filter drive', exact: true })).toBeVisible();
  await tab(page, 'Osc');
  await expect(panel.getByRole('slider', { name: 'Unison detune', exact: true })).toBeVisible();
  await expect(panel.getByRole('slider', { name: 'Detune', exact: true })).toBeVisible();

  // The effects unit's returns are spelled out and not cut off.
  for (const name of ['Synth Return', 'Drum Return']) {
    const label = page.locator('.effects-returns .knob-label', { hasText: new RegExp(`^${name}$`, 'i') });
    await expect(label).toBeVisible();
    expect(await clipped(label), `${name} fits`).toBe(false);
  }
  await expect(page.getByRole('slider', { name: 'Synth return', exact: true })).toBeVisible();
});

test('a lane says the same model name under its name as in its Model menu', async ({ page }) => {
  const under = page.getByRole('button', { name: 'Synth 1', exact: true }).locator('span');
  await expect(under).toHaveText('Generic');
  await tab(page, 'Sound');
  await expect(page.getByLabel('Synth model', { exact: true }).first().locator('option:checked')).toHaveText('Generic');
});
