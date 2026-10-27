import { expect, test, type Page } from '@playwright/test';

// A lane's instrument chosen per scene (docs/SCENE_SOUNDS_PLAN.md): the switch on the lane's editor,
// the mark on its name plate, and the other scenes keeping the lane's sound.

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desktop rack, with the song unit and the lane on one page');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a scene given a sound of its own for a lane plays another instrument there, and the other scenes keep the lane\'s', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const plate = page.getByRole('button', { name: 'Synth 1', exact: true }).locator('span');
  const own = lane.getByRole('switch', { name: 'Synth 1 sound in this scene only', exact: true });
  await page.getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(own).toHaveAttribute('aria-checked', 'false');
  await expect(plate).not.toHaveAttribute('data-scene-sound', 'true');

  await own.click();
  await expect(own).toHaveAttribute('aria-checked', 'true');
  await expect(plate, 'the plate is marked').toHaveAttribute('data-scene-sound', 'true');
  await lane.getByRole('tab', { name: 'Sound', exact: true }).click();
  await lane.getByRole('button', { name: /^Synth model: / }).click();
  await lane.locator('[role="menuitem"][data-group="Poly"]').click();
  await lane.getByRole('menuitem', { name: 'Juno-106', exact: true }).click();
  await expect(plate).toHaveText('Juno-106');
  await expect.poll(async () => {
    const project = await stored(page);
    return [project.synths[0].synthModelId, project.synths[0].shared?.synthModelId];
  }).toEqual(['juno-106', 'generic']);

  await scene(page, 'Scene 1').click();
  await expect(plate, 'the first scene plays the lane\'s own sound').toHaveText('Generic');
  await expect(own).toHaveAttribute('aria-checked', 'false');
  await expect(plate).not.toHaveAttribute('data-scene-sound', 'true');
  await scene(page, 'Scene 2').click();
  await expect(plate).toHaveText('Juno-106');

  // A reload keeps it; turning it off gives the scene the lane's sound back, and undo puts it back.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Synth 1', exact: true }).locator('span')).toHaveText('Juno-106');
  await lane.getByRole('switch', { name: 'Synth 1 sound in this scene only', exact: true }).click();
  await expect(plate).toHaveText('Generic');
  await expect.poll(async () => (await stored(page)).scenes.some((entry: { sounds?: unknown }) => entry.sounds)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(plate).toHaveText('Juno-106');

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});
