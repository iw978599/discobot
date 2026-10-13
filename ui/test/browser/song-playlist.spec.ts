import { expect, test, type Page } from '@playwright/test';

// The song as a playlist: the same entries the blocks show, one row each, with lengths and times.
// The default tempo is 120, so a bar is two seconds.

type Saved = { scenes: Array<{ id: string; name: string }>; song: { entries: Array<{ sceneId: string; repeats: number }> } };
const stored = (page: Page): Promise<Saved> => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
// The stored song as scene names and repeats, in order.
const entries = async (page: Page) => {
  const saved = await stored(page);
  return (saved.song?.entries ?? []).map(entry => `${saved.scenes.find(scene => scene.id === entry.sceneId)?.name} x${entry.repeats}`);
};
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });
const layout = (page: Page, name: 'Blocks' | 'Playlist') => page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name, exact: true });
const row = (page: Page, place: number, name: string) => page.getByRole('group', { name: `Song row ${place}: ${name}`, exact: true });
const button = (page: Page, name: string) => page.locator('.song-playlist').getByRole('button', { name, exact: true });
const names = (page: Page) => page.locator('.song-list-row .song-list-scene');
const total = (page: Page) => page.locator('.song-list-total');
const plate = (page: Page) => page.locator('.song-row .rack-plate');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
});

test('the playlist shows the song a row at a time with its bars and times, and edits the same song as the blocks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });

  // Three scenes: Scene 1 is two bars long, the Break and Scene 3 one bar each.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await drums.getByLabel('Drum bars', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Scene name', { exact: true }).fill('Break');
  await page.getByLabel('Scene name', { exact: true }).press('Enter');
  await expect(scene(page, 'Break')).toHaveAttribute('aria-pressed', 'true');
  await drums.getByLabel('Drum bars', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await expect(scene(page, 'Scene 3')).toHaveAttribute('aria-pressed', 'true');
  await drums.getByLabel('Drum bars', { exact: true }).selectOption('1');
  await scene(page, 'Scene 1').click();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');

  // The blocks are what a browser starts with; the playlist is asked for.
  await expect(layout(page, 'Blocks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Song order', exact: true })).toBeVisible();
  await expect(page.locator('.song-playlist')).toHaveCount(0);
  await layout(page, 'Playlist').click();
  await expect(layout(page, 'Playlist')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Song order', exact: true })).toHaveCount(0);
  await expect(names(page)).toHaveText(['Scene 1']);
  await expect(row(page, 1, 'Scene 1').locator('.song-list-bars')).toHaveText('2 bars');
  await expect(row(page, 1, 'Scene 1').locator('.song-list-time')).toHaveText('at 0:00 for 0:04');
  await expect(row(page, 1, 'Scene 1').locator('.song-list-count')).toHaveText('×1');
  await expect(button(page, 'Remove row 1 from the song'), 'a song keeps at least one row').toBeDisabled();
  await expect(total(page)).toHaveText('Whole song 2 bars lasting 0:04');

  // A scene is added at the end: the open scene unless another is chosen.
  await expect(page.getByLabel('Scene to add to the song', { exact: true })).toHaveValue(/.+/);
  await page.getByLabel('Scene to add to the song', { exact: true }).selectOption({ label: 'Break' });
  await button(page, 'Add Break at the end of the song').click();
  await expect(names(page)).toHaveText(['Scene 1', 'Break']);
  await expect.poll(() => entries(page)).toEqual(['Scene 1 x1', 'Break x1']);
  await expect(row(page, 2, 'Break').locator('.song-list-bars')).toHaveText('1 bar');
  await expect(row(page, 2, 'Break').locator('.song-list-time')).toHaveText('at 0:04 for 0:02');

  // Repeats: the row says one pass, how many, and what that comes to.
  await button(page, 'More repeats for row 2').click();
  await expect(row(page, 2, 'Break').locator('.song-list-count')).toHaveText('×2');
  await button(page, 'More repeats for row 2').click();
  await expect(row(page, 2, 'Break').locator('.song-list-count')).toHaveText('×3');
  await expect(row(page, 2, 'Break').locator('.song-list-bars')).toHaveText('1 bar × 3 = 3 bars');
  await expect(row(page, 2, 'Break').locator('.song-list-time')).toHaveText('at 0:04 for 0:06');
  await expect.poll(() => entries(page)).toEqual(['Scene 1 x1', 'Break x3']);

  // A scene is added after a chosen row, and every row below starts later.
  await page.getByLabel('Scene to add to the song', { exact: true }).selectOption({ label: 'Scene 3' });
  await button(page, 'Add Scene 3 after row 1').click();
  await expect(names(page)).toHaveText(['Scene 1', 'Scene 3', 'Break']);
  await expect.poll(() => entries(page)).toEqual(['Scene 1 x1', 'Scene 3 x1', 'Break x3']);
  await expect(row(page, 2, 'Scene 3').locator('.song-list-time')).toHaveText('at 0:04 for 0:02');
  await expect(row(page, 3, 'Break').locator('.song-list-time')).toHaveText('at 0:06 for 0:06');
  await expect(total(page)).toHaveText('Whole song 6 bars lasting 0:12');
  await expect(plate(page), 'the unit says the same total').toContainText('6 bars · 0:12');

  // A row is moved with its button, and the keyboard stays on the row that moved.
  await expect(button(page, 'Move row 1 earlier')).toBeDisabled();
  await expect(button(page, 'Move row 3 later')).toBeDisabled();
  await button(page, 'Move row 3 earlier').click();
  await expect(names(page)).toHaveText(['Scene 1', 'Break', 'Scene 3']);
  await expect.poll(() => entries(page)).toEqual(['Scene 1 x1', 'Break x3', 'Scene 3 x1']);
  await expect(button(page, 'Move row 2 earlier')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(names(page)).toHaveText(['Break', 'Scene 1', 'Scene 3']);
  await expect.poll(() => entries(page)).toEqual(['Break x3', 'Scene 1 x1', 'Scene 3 x1']);
  await expect(button(page, 'Move row 1 later'), 'the first row cannot go earlier, so the keyboard is on its other move button').toBeFocused();
  await expect(row(page, 1, 'Break').locator('.song-list-time')).toHaveText('at 0:00 for 0:06');
  await expect(row(page, 2, 'Scene 1').locator('.song-list-time')).toHaveText('at 0:06 for 0:04');
  await expect(row(page, 3, 'Scene 3').locator('.song-list-time')).toHaveText('at 0:10 for 0:02');

  await button(page, 'Fewer repeats for row 1').click();
  await expect(row(page, 1, 'Break').locator('.song-list-bars')).toHaveText('1 bar × 2 = 2 bars');
  await expect.poll(() => entries(page)).toEqual(['Break x2', 'Scene 1 x1', 'Scene 3 x1']);

  // A row is removed.
  await button(page, 'Remove row 2 from the song').click();
  await expect(names(page)).toHaveText(['Break', 'Scene 3']);
  await expect.poll(() => entries(page)).toEqual(['Break x2', 'Scene 3 x1']);
  await expect(total(page)).toHaveText('Whole song 3 bars lasting 0:06');

  // A row opens its scene and marks where the song starts.
  await button(page, 'Open Scene 3 from row 2 and start the song here').click();
  await expect(scene(page, 'Scene 3')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Open Scene 3 from row 2 and start the song here')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Open Break from row 1 and start the song here')).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, 2, 'Scene 3').locator('.song-list-start')).toHaveText('Start');

  // The open scene's length is read as it stands: made two bars, its row and the total follow at once.
  await drums.getByLabel('Drum bars', { exact: true }).selectOption('2');
  await expect(row(page, 2, 'Scene 3').locator('.song-list-bars')).toHaveText('2 bars');
  await expect(row(page, 2, 'Scene 3').locator('.song-list-time')).toHaveText('at 0:04 for 0:04');
  await expect(total(page)).toHaveText('Whole song 4 bars lasting 0:08');

  // In song mode the row that is playing is marked, and no row is once it stops.
  await page.getByRole('group', { name: 'Play mode', exact: true }).getByRole('button', { name: 'Song', exact: true }).click();
  await button(page, 'Open Break from row 1 and start the song here').click();
  await expect(scene(page, 'Break')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.song-list-row[aria-current="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.locator('.song-list-row[aria-current="true"] .song-list-scene')).toHaveText('Break', { timeout: 10_000 });
  await expect(page.locator('.song-list-row[aria-current="true"] .rack-led.on')).toHaveCount(1);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.song-list-row[aria-current="true"]')).toHaveCount(0);
  await page.getByRole('group', { name: 'Play mode', exact: true }).getByRole('button', { name: 'Scene', exact: true }).click();

  // The choice of layout is this browser's, and is there after a reload; so is the song.
  await expect.poll(() => entries(page)).toEqual(['Break x2', 'Scene 3 x1']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(layout(page, 'Playlist')).toHaveAttribute('aria-pressed', 'true');
  await expect(names(page)).toHaveText(['Break', 'Scene 3']);
  await expect(total(page)).toHaveText('Whole song 4 bars lasting 0:08');

  // Back to the blocks: the same song, and that choice is kept too.
  await layout(page, 'Blocks').click();
  await expect(page.locator('.song-playlist')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Song block 1: Break', exact: true })).toContainText('×2');
  await expect(page.getByRole('group', { name: 'Song block 2: Scene 3', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(layout(page, 'Blocks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Song order', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
