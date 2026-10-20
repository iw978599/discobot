import { expect, test, type Locator, type Page } from '@playwright/test';

// Putting scenes, the song's blocks and the playlist's rows in another order by dragging, and the
// scenes with Alt and an arrow key (roadmap 20).

type Saved = { scenes: Array<{ id: string; name: string }>; song: { entries: Array<{ sceneId: string }> } };
const stored = (page: Page): Promise<Saved> => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const sceneNames = async (page: Page) => (await stored(page)).scenes.map(scene => scene.name);
const songNames = async (page: Page) => {
  const saved = await stored(page);
  return saved.song.entries.map(entry => saved.scenes.find(scene => scene.id === entry.sceneId)?.name);
};
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });
const chips = (page: Page) => page.locator('.scene-chip');
const block = (page: Page, place: number, name: string) => page.getByRole('group', { name: `Song block ${place}: ${name}`, exact: true });
const row = (page: Page, place: number, name: string) => page.getByRole('group', { name: `Song row ${place}: ${name}`, exact: true });

// A mouse pressed on one thing, moved a little to pick it up, then over the other and let go.
async function drag(page: Page, from: Locator, to: Locator) {
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
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
});

test('a scene is dragged to another place, or moved with Alt and an arrow, and a plain click still opens it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await expect(scene(page, 'Scene 3')).toHaveAttribute('aria-pressed', 'true');

  await drag(page, scene(page, 'Scene 3'), scene(page, 'Scene 1'));
  await expect(chips(page)).toHaveText(['Scene 3', 'Scene 1', 'Scene 2']);
  await expect(scene(page, 'Scene 3'), 'the open scene is still open').toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sceneNames(page)).toEqual(['Scene 3', 'Scene 1', 'Scene 2']);

  // A drag let go where it started changes nothing and opens nothing.
  await drag(page, scene(page, 'Scene 2'), scene(page, 'Scene 2'));
  await expect(chips(page)).toHaveText(['Scene 3', 'Scene 1', 'Scene 2']);
  await expect(scene(page, 'Scene 3')).toHaveAttribute('aria-pressed', 'true');

  await scene(page, 'Scene 2').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(chips(page)).toHaveText(['Scene 3', 'Scene 2', 'Scene 1']);
  await expect(scene(page, 'Scene 2'), 'the keyboard stays on the scene it moved').toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(chips(page)).toHaveText(['Scene 3', 'Scene 1', 'Scene 2']);
  await expect.poll(() => sceneNames(page)).toEqual(['Scene 3', 'Scene 1', 'Scene 2']);

  await scene(page, 'Scene 1').click();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('the song\'s blocks and the playlist\'s rows are dragged to another place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Scene 2', exact: true }).click();
  await expect(block(page, 2, 'Scene 2')).toBeVisible();

  await drag(page, block(page, 2, 'Scene 2'), block(page, 1, 'Scene 1'));
  await expect(block(page, 1, 'Scene 2')).toBeVisible();
  await expect(block(page, 2, 'Scene 1')).toBeVisible();
  await expect.poll(() => songNames(page)).toEqual(['Scene 2', 'Scene 1']);

  await page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Playlist', exact: true }).click();
  await drag(page, row(page, 2, 'Scene 1'), row(page, 1, 'Scene 2'));
  await expect(row(page, 1, 'Scene 1')).toBeVisible();
  await expect.poll(() => songNames(page)).toEqual(['Scene 1', 'Scene 2']);
  expect(errors).toEqual([]);
});
