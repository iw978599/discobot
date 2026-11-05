import { expect, test, type Page } from '@playwright/test';

// The desk's frame (docs/DESK_LAYOUT_PLAN.md, stage 2): one screen, the track list, the dock with its
// tabs and its handle, and the top bar in three groups. Wide screens only; stage 5 does the phone.

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desk frame is the wide arrangement; stage 5 covers phones');
});

async function open(page: Page, layout: 'desk' | 'rack') {
  await page.addInitScript((choice) => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    localStorage.setItem('discobot_layout_v1', choice);
  }, layout);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
}

const tracks = (page: Page) => page.getByRole('navigation', { name: 'Tracks', exact: true });
const unit = (page: Page, name: string) => page.locator(`[data-unit="${name}"]`);

test('the desk is one screen: the page does not scroll', async ({ page }) => {
  await open(page, 'desk');
  await expect(tracks(page)).toBeVisible();
  const sizes = await page.evaluate(() => {
    const scroller = document.scrollingElement!;
    const rack = document.querySelector('.rack-page')!;
    return { page: [scroller.scrollHeight, scroller.clientHeight], rack: [rack.scrollHeight, rack.clientHeight] };
  });
  expect(sizes.page[0]).toBeLessThanOrEqual(sizes.page[1] + 1);
  expect(sizes.rack[0]).toBeLessThanOrEqual(sizes.rack[1] + 1);
});

test('the track list names the lanes and the drums, and picking one shows its unit in the dock', async ({ page }) => {
  await open(page, 'desk');
  const list = tracks(page);
  for (const name of ['Synth 1', 'Synth 2', 'Synth 3']) await expect(list.getByRole('button', { name: `Show ${name} in the dock`, exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Show Drums in the dock', exact: true })).toBeVisible();

  await expect(list.getByRole('button', { name: 'Show Synth 1 in the dock', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(unit(page, 'synth-1')).toBeVisible();
  await expect(unit(page, 'synth-2')).toBeHidden();

  await list.getByRole('button', { name: 'Show Synth 2 in the dock', exact: true }).click();
  await expect(unit(page, 'synth-2')).toBeVisible();
  await expect(unit(page, 'synth-1')).toBeHidden();
  await expect(unit(page, 'synth-1'), 'hidden, not taken away').toHaveCount(1);
  await expect(unit(page, 'drums')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Synth 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Synth 2', exact: true }), 'the lane is the open one').toHaveAttribute('aria-pressed', 'true');

  await list.getByRole('button', { name: 'Show Drums in the dock', exact: true }).click();
  await expect(unit(page, 'drums')).toBeVisible();
  await expect(unit(page, 'synth-2')).toBeHidden();
});

test('the dock has tabs for the mixer and the effects, and the choice is kept', async ({ page }) => {
  await open(page, 'desk');
  await expect(page.getByRole('tablist', { name: 'Dock', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Mixer', exact: true }).click();
  await expect(unit(page, 'mixer')).toBeVisible();
  await expect(unit(page, 'synth-1')).toBeHidden();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  await expect(unit(page, 'effects')).toBeVisible();
  await expect(unit(page, 'mixer')).toBeHidden();
  await page.getByRole('tab', { name: 'Synth 1', exact: true }).click();
  await expect(unit(page, 'synth-1')).toBeVisible();

  await page.getByRole('tab', { name: 'Mixer', exact: true }).click();
  await page.reload();
  await expect(unit(page, 'mixer')).toBeVisible();
});

test('the handle sets the dock height from the keyboard and it survives a reload', async ({ page }) => {
  await open(page, 'desk');
  const handle = page.getByRole('separator', { name: 'Dock height', exact: true });
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  const height = async () => Number(await handle.getAttribute('aria-valuenow'));
  const box = async () => (await unit(page, 'synth-1').boundingBox())!.height;
  const before = await height();
  const boxBefore = await box();
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await height()).toBe(before + 48);
  await expect.poll(box).toBeGreaterThan(boxBefore);

  await page.keyboard.press('Home');
  expect(await height()).toBe(Number(await handle.getAttribute('aria-valuemin')));
  await page.keyboard.press('End');
  expect(await height()).toBe(Number(await handle.getAttribute('aria-valuemax')));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  const chosen = await height();

  await page.reload();
  await expect(page.getByRole('separator', { name: 'Dock height', exact: true })).toHaveAttribute('aria-valuenow', String(chosen));
});

test('muting from the track list mutes the lane', async ({ page }) => {
  await open(page, 'desk');
  const plate = page.getByRole('button', { name: 'Mute Synth 1', exact: true });
  await expect(plate).toHaveAttribute('aria-pressed', 'false');
  const mute = tracks(page).getByRole('button', { name: 'Track list mute Synth 1', exact: true });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(plate).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await expect(plate).toHaveAttribute('aria-pressed', 'false');

  const solo = tracks(page).getByRole('button', { name: 'Track list solo Synth 1', exact: true });
  await solo.click();
  await expect(page.getByRole('button', { name: 'Solo Synth 1', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const drumsMute = tracks(page).getByRole('button', { name: 'Track list mute Drums', exact: true });
  await drumsMute.click();
  await expect(drumsMute).toHaveAttribute('aria-pressed', 'true');
  await tracks(page).getByRole('button', { name: 'Show Drums in the dock', exact: true }).click();
  // Every drum's own mute on the grid is pressed (the drums' Mute All shows only with Sends open).
  await expect(page.getByRole('button', { name: 'Mute Kick', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Add Lane in the track list adds the next lane and shows it', async ({ page }) => {
  await open(page, 'desk');
  await tracks(page).getByRole('button', { name: 'Add Synth 4 from the track list', exact: true }).click();
  await expect(tracks(page).getByRole('button', { name: 'Show Synth 4 in the dock', exact: true })).toBeVisible();
  await expect(unit(page, 'synth-4')).toBeVisible();
});

test('every control of the top bar is still there, in three groups', async ({ page }) => {
  await open(page, 'desk');
  const bar = page.locator('header.transport');
  await expect(bar.locator('.desk-bar-group')).toHaveCount(3);
  await expect(bar.getByRole('button', { name: /^Project: / })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Project ▾', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: /Play All|Stop All/ })).toBeVisible();
  await expect(bar.locator('.tempo-led-label')).toHaveText('BPM');
  await expect(bar.getByRole('button', { name: 'TAP', exact: true })).toBeVisible();
  await expect(bar.getByRole('group', { name: 'Metronome', exact: true })).toBeVisible();
  for (const name of ['Undo', 'Redo', 'Export', 'MIDI and samples', 'Help', 'Mute']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(bar.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible();
  await expect(bar.getByRole('slider', { name: 'Click level', exact: true })).toBeVisible();
});

test('with the desk off none of the frame exists', async ({ page }) => {
  await open(page, 'rack');
  await expect(page.locator('.desk-tracks, .desk-dock-bar, .desk-bar, .desk-frame, [data-dock]')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Dock height', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Dock', exact: true })).toHaveCount(0);
  for (const name of ['synth-1', 'synth-2', 'synth-3', 'drums', 'mixer', 'effects']) await expect(unit(page, name)).toBeVisible();
});
