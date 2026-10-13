import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const hits = (steps: boolean[]) => steps.flatMap((on, step) => (on ? [step] : []));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a drum row and a lane\'s notes can each be copied into another scene, asking first when something is there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const drumCopy = page.locator('.drum-tools').first().getByRole('button', { name: /^Copy to/ });
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });

  // With one scene there is nowhere to copy to, and the menu says so.
  await drumCopy.click();
  await expect(page.getByRole('menuitem', { name: 'No other scene yet', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Scene 1 has a kick. Scene 2 is made empty and given a snare and a note.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await expect.poll(async () => (await stored(page)).scenes?.length).toBe(2);
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await lane.getByRole('button', { name: 'C3 step 3', exact: true }).click();

  // The snare row goes to Scene 1, which had none: no question, and its kick is left alone.
  await drumCopy.click();
  await page.getByRole('menuitem', { name: 'Scene 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => hits((await stored(page)).scenes[0].drums.snare.steps)).toEqual([4]);
  expect(hits((await stored(page)).scenes[0].drums.kick.steps)).toEqual([0]);

  // The kick row would replace Scene 1's kick, so it asks; Cancel leaves it, Replace does it.
  await page.getByRole('button', { name: 'Select Kick', exact: true }).click();
  await drumCopy.click();
  await page.getByRole('menuitem', { name: 'Scene 1', exact: true }).click();
  const question = page.getByRole('dialog', { name: 'Copy to Scene 1?', exact: true });
  await expect(question).toContainText('the Kick row');
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(hits((await stored(page)).scenes[0].drums.kick.steps)).toEqual([0]);
  await drumCopy.click();
  await page.getByRole('menuitem', { name: 'Scene 1', exact: true }).click();
  await question.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(async () => hits((await stored(page)).scenes[0].drums.kick.steps)).toEqual([]);

  // The lane's notes go the same way, and the scene on show does not change.
  await lane.getByRole('button', { name: /^Copy to/ }).click();
  await page.getByRole('menuitem', { name: 'Scene 1', exact: true }).click();
  await expect.poll(async () => (await stored(page)).scenes[0].lanes[1][2].note).toBe('C3');
  const project = await stored(page);
  expect(project.currentSceneId).toBe(project.scenes[1].id);
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
