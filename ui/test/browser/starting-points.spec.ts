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
// The songs and the beats are each a menu on the offer: open it, and choose one.
const menu = (page: Page, name: string) => page.getByRole('menu', { name, exact: true });
const pick = async (page: Page, name: string, item: string) => {
  await offer(page).getByRole('button', { name, exact: true }).click();
  await menu(page, name).getByRole('menuitem', { name: item, exact: true }).click();
};

test('an empty project offers beats to start from, and one press fills it in', async ({ page }) => {
  await expect(offer(page)).toBeVisible();
  await expect(tempo(page)).toHaveText('120');
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'false');

  await pick(page, 'A beat to start from', 'House Beat');
  await expect(tempo(page)).toHaveText('124');
  for (const step of [1, 5, 9, 13]) await expect(kick(page, step)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(page, 2)).toHaveAttribute('aria-pressed', 'false');
  await expect(lane(page).getByRole('button', { name: 'Select step 3 C3', exact: true })).toBeVisible();
  await expect(lane(page).getByRole('button', { name: 'Select step 15 D#3', exact: true })).toBeVisible();
  await expect(offer(page), 'the offer stays, so another can be tried').toBeVisible();

  // Another replaces the first, and each is one edit: one undo brings the first back, a second empties the project.
  await pick(page, 'A beat to start from', 'Slow Groove');
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

test('the offer leaves only when Start empty is pressed, and is not made on a project that has something in it', async ({ page }) => {
  await offer(page).getByRole('button', { name: 'Start empty', exact: true }).click();
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

test('a sample song opens as a new project, ready to play as a song', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const stored = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
  const first = (await stored()).projectId;
  await pick(page, 'A song to hear', 'Night Circuit');

  await expect(tempo(page)).toHaveText('104');
  await expect.poll(async () => (await stored()).name).toBe('Night Circuit');
  const project = await stored();
  expect(project.projectId, 'the empty project it was started from is left alone').not.toBe(first);
  expect(project.scenes.map((scene: { name: string }) => scene.name)).toEqual(['Ignition', 'Pulse', 'Run', 'Undertow', 'Overdrive', 'Shutdown']);
  expect(project.song.entries).toHaveLength(7);
  expect(project.synths).toHaveLength(5);
  await expect(offer(page), 'a project with a song in it is not offered a beat').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true }), 'the intro opens, and has no kick yet').toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});

test('the songs on offer are in many styles, and one in another time signature opens in it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await offer(page).getByRole('button', { name: 'A beat to start from', exact: true }).click();
  await expect(menu(page, 'A beat to start from').getByRole('menuitem')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await offer(page).getByRole('button', { name: 'A song to hear', exact: true }).click();
  const songs = menu(page, 'A song to hear').getByRole('menuitem');
  await expect(songs).toHaveText([/Night Circuit/, /Downtown Wah/, /Late Study/, /Fracture Line/, /Market Day/, /Cathedral/, /Lanterns Over Dark Water/, /Silver Satellite/, /Long Ascent/]);

  const stored = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
  await songs.filter({ hasText: 'Fracture Line' }).click();
  await expect.poll(async () => (await stored()).name).toBe('Fracture Line');
  const project = await stored();
  expect(project.scenes.map((scene: { signature?: string }) => scene.signature)).toEqual([undefined, undefined, undefined, undefined, '7/8', undefined, undefined]);
  expect(project.synths[1].pattern.steps.length, 'it opens on eight bars of 4/4').toBe(128);
  expect(project.scenes[4].lanes['1'].length, 'and its Meltdown is eight bars of fourteen').toBe(112);
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});
