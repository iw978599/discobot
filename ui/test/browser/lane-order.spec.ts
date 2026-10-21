import { expect, test, type Locator, type Page } from '@playwright/test';

// Moving lanes (roadmap 20): only where they are shown changes (the owner, 2026-10-20). Alt and an
// arrow on a lane's name plate move it up or down the rack, and a strip dragged in the mixer by its
// name takes another lane's place; the rack and the mixer show the one order.

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const rackOrder = (page: Page) => page.locator('section.synth-module').evaluateAll(units => units.map(unit => unit.getAttribute('data-unit')));
const mixerOrder = (page: Page) => page.locator('.mixer-desk [aria-label="Mixer Synths"] .mixer-strip').evaluateAll(strips => strips.map(strip => strip.getAttribute('aria-label')));
const plate = (page: Page, id: number) => page.locator(`[data-unit="synth-${id}"] .rack-plate`);

async function drag(page: Page, from: Locator, to: Locator) {
  await to.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a lane moves up the rack with Alt and an arrow, and in the mixer by dragging, keeping its number', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect.poll(() => rackOrder(page)).toEqual(['synth-1', 'synth-2', 'synth-3']);

  await plate(page, 3).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => rackOrder(page)).toEqual(['synth-3', 'synth-1', 'synth-2']);
  await expect(plate(page, 3), 'the keyboard stays on the lane it moved').toBeFocused();
  await expect.poll(() => mixerOrder(page)).toEqual(['Mixer Synth 3', 'Mixer Synth 1', 'Mixer Synth 2']);
  await expect.poll(async () => (await stored(page)).laneOrder).toEqual([3, 1, 2, 4, 5]);
  expect((await stored(page)).synths.map((lane: { synthId: number }) => lane.synthId), 'each lane keeps its number').toEqual([1, 2, 3]);

  // Dragged by its name in the mixer: Synth 2 to where Synth 3 is.
  const name = (id: number) => page.locator(`.mixer-desk [aria-label="Mixer Synth ${id}"] .mixer-name`);
  await drag(page, name(2), name(3));
  await expect.poll(() => mixerOrder(page)).toEqual(['Mixer Synth 2', 'Mixer Synth 3', 'Mixer Synth 1']);
  await expect.poll(() => rackOrder(page)).toEqual(['synth-2', 'synth-3', 'synth-1']);

  await page.reload();
  await expect.poll(() => rackOrder(page)).toEqual(['synth-2', 'synth-3', 'synth-1']);
  expect(errors).toEqual([]);
});
