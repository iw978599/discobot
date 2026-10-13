import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const offer = (page: Page) => page.getByRole('region', { name: 'Starting points', exact: true });
const tempo = (page: Page) => page.locator('.tempo-led-value');
const kick = (page: Page, step: number) => page.getByRole('button', { name: `Kick step ${step}`, exact: true });
const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });

test('an empty project offers beats to start from, and one press fills it in', async ({ page }) => {
  await expect(offer(page)).toBeVisible();
  await expect(tempo(page)).toHaveText('120');
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'false');

  await offer(page).getByRole('button', { name: 'House Beat', exact: true }).click();
  await expect(tempo(page)).toHaveText('124');
  for (const step of [1, 5, 9, 13]) await expect(kick(page, step)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(page, 2)).toHaveAttribute('aria-pressed', 'false');
  await expect(lane(page).getByRole('button', { name: 'Select step 3 C3', exact: true })).toBeVisible();
  await expect(lane(page).getByRole('button', { name: 'Select step 15 D#3', exact: true })).toBeVisible();
  await expect(offer(page), 'the offer stays, so another can be tried').toBeVisible();

  // Another replaces the first, and each is one edit: one undo brings the first back, a second empties the project.
  await offer(page).getByRole('button', { name: 'Slow Groove', exact: true }).click();
  await expect(tempo(page)).toHaveText('88');
  await expect(kick(page, 5)).toHaveAttribute('aria-pressed', 'false');
  await expect(lane(page).getByRole('button', { name: 'Select step 1 E3', exact: true })).toBeVisible();
  await expect(lane(page).getByRole('button', { name: /^Select step 3( |$)/ }), 'the first beat\u2019s bass note is gone').toHaveAccessibleName('Select step 3');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(tempo(page)).toHaveText('124');
  await expect(kick(page, 5)).toHaveAttribute('aria-pressed', 'true');
  await undo.click();
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'false');
  await expect(tempo(page)).toHaveText('120');
});

test('the offer leaves only when it is hidden, and is not made on a project that has something in it', async ({ page }) => {
  await offer(page).getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(kick(page, 1), 'nothing was put in').toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(offer(page), 'a project that is still empty offers again on the next visit').toBeVisible();

  // Putting something in does not take the offer away: the rack must not move under the pointer.
  await kick(page, 1).scrollIntoViewIfNeeded();
  const before = await kick(page, 1).boundingBox();
  await kick(page, 1).click();
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(offer(page)).toBeVisible();
  expect(await kick(page, 1).boundingBox(), 'the step is where it was pressed').toEqual(before);

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(offer(page), 'a project with a hit in it is not offered a beat').toHaveCount(0);
});

test('Sample Song opens a finished song as a new project, ready to play as a song', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const stored = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
  const first = (await stored()).projectId;
  await offer(page).getByRole('button', { name: 'Sample Song', exact: true }).click();

  await expect(tempo(page)).toHaveText('118');
  await expect.poll(async () => (await stored()).name).toBe('Sample Song');
  const project = await stored();
  expect(project.projectId, 'the empty project it was started from is left alone').not.toBe(first);
  expect(project.scenes.map((scene: { name: string }) => scene.name)).toEqual(['Intro', 'Verse', 'Chorus', 'Break', 'Outro']);
  expect(project.song.entries).toHaveLength(6);
  expect(project.synths).toHaveLength(3);
  await expect(offer(page), 'a project with a song in it is not offered a beat').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true }), 'the intro opens, and has no kick yet').toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});
