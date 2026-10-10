import { expect, test, type Page } from '@playwright/test';

// The step lights are switched on outside React, so these check what React would otherwise
// guarantee: one step lit in each grid, moving, and still lit after the grid renders again.

const count = (page: Page, selector: string) => page.evaluate(found => document.querySelectorAll(found).length, selector);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the step being played is lit in every grid, moves on, and stays lit through edits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const drumStep = async () => Number(await page.locator('.drum-step-indicator.active').getAttribute('data-step'));

  // As slow as it goes, so a step lasts three quarters of a second and can be caught in the act.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('20');
  await page.locator('.tempo-led-input').press('Enter');
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const rows = await lane.locator('.piano-roll-note-label').count();
  expect(rows).toBeGreaterThan(11);
  await expect(page.locator('.step-light.on, .drum-step-indicator.active, .drum-step-btn.current, .piano-roll-cell.playing'), 'nothing is lit before playing').toHaveCount(0);

  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(lane.locator('.step-light.on')).toHaveCount(1);
  await expect(page.locator('.drum-step-indicator.active')).toHaveCount(1);
  await expect(page.locator('.drum-step-btn.current'), 'the whole drum column').toHaveCount(8);
  await expect(lane.locator('.piano-roll-step-header.playing')).toHaveCount(1);
  await expect(lane.locator('.piano-roll-cell.playing'), 'the whole piano roll column').toHaveCount(rows);

  // The three grids of one lane agree, and the light moves on.
  await expect.poll(async () => await lane.locator('.step-light.on').getAttribute('data-step') === await lane.locator('.piano-roll-step-header.playing').getAttribute('data-step')).toBe(true);
  const first = await drumStep();
  await expect.poll(drumStep).not.toBe(first);

  // An edit in the lit column renders that grid again. The light must not be lost with it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const step = await drumStep();
    await page.getByRole('button', { name: `Kick step ${step + 1}`, exact: true }).click();
    await page.waitForTimeout(120);
    expect(await count(page, '.drum-step-btn.current'), 'after a drum edit').toBe(8);
    expect(await count(page, '.drum-step-indicator.active')).toBe(1);

    const column = Number(await lane.locator('.piano-roll-step-header.playing').getAttribute('data-step'));
    await lane.getByRole('button', { name: `C4 step ${column + 1}`, exact: true }).click();
    await page.waitForTimeout(120);
    expect(await count(page, '.piano-roll-cell.playing'), 'after a piano roll edit').toBe(rows);
    expect(await count(page, '[aria-label="Synth 1 module"] .step-light.on'), 'and the step row above it').toBe(1);
  }

  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.step-light.on, .drum-step-indicator.active, .drum-step-btn.current, .piano-roll-cell.playing, .piano-roll-step-header.playing'), 'nothing is lit once it stops').toHaveCount(0);
  expect(errors).toEqual([]);
});
