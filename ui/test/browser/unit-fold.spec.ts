import { expect, test, type Page } from '@playwright/test';

// Every unit but a guest has Hide in the corner of its name plate: it puts the unit away down to
// its name, the browser remembers it, and Show brings it back (design review 27).

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const ready = async (page: Page) => {
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
};
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desktop rack, where every unit is on the page at once');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await ready(page);
});

test('a unit is hidden down to its name and shown again, and the browser remembers which', async ({ page }) => {
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });
  await expect(lane.getByRole('button', { name: /^Select step 1( |$)/ })).toBeVisible();

  await button(page, 'Hide Synth 1').click();
  await expect(button(page, 'Show Synth 1')).toHaveAttribute('aria-expanded', 'false');
  await expect(lane.getByRole('button', { name: /^Select step 1( |$)/ }), 'its steps are put away').toHaveCount(0);
  await expect(lane.getByRole('slider'), 'and its knobs').toHaveCount(0);
  await expect(lane.getByRole('button', { name: 'Synth 1', exact: true }), 'its name stays').toBeVisible();
  await expect(lane.getByRole('button', { name: 'Mute Synth 1', exact: true }), 'and so do mute and solo').toBeVisible();

  await button(page, 'Hide the drums').click();
  await expect(drums.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveCount(0);
  await button(page, 'Hide the song').click();
  await expect(page.getByRole('button', { name: 'Scene: Scene 1', exact: true })).toHaveCount(0);
  await button(page, 'Hide the effects').click();
  await expect(page.getByRole('switch', { name: 'Delay enabled', exact: true })).toHaveCount(0);

  await page.reload();
  await ready(page);
  for (const name of ['Show Synth 1', 'Show the drums', 'Show the song', 'Show the effects']) await expect(button(page, name), name).toBeVisible();
  await expect(button(page, 'Hide Synth 2'), 'what was not hidden is not').toBeVisible();

  await button(page, 'Show Synth 1').click();
  await button(page, 'Show the drums').click();
  await expect(lane.getByRole('button', { name: /^Select step 1( |$)/ })).toBeVisible();
  await expect(drums.getByRole('button', { name: 'Kick step 1', exact: true })).toBeVisible();
  // A hidden lane keeps its notes: what was there before is there after.
  await drums.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await button(page, 'Hide the drums').click();
  await button(page, 'Show the drums').click();
  await expect(drums.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
