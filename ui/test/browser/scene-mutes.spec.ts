import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('mutes and solos are kept per scene, and a song plays each scene with its own', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const pressed = (name: string) => page.getByRole('button', { name, exact: true });
  await pressed('Mute Synth 1').click();
  await pressed('Mute Kick').click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'true');

  // A new scene starts as a copy; changing it does not touch the first.
  await page.getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'true');
  await pressed('Mute Synth 1').click();
  await pressed('Mute Kick').click();
  await pressed('Solo Snare').click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'false');

  await scene(page, 'Scene 1').click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('Mute Kick')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('Solo Snare')).toHaveAttribute('aria-pressed', 'false');
  await scene(page, 'Scene 2').click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'false');
  await expect(pressed('Mute Kick')).toHaveAttribute('aria-pressed', 'false');
  await expect(pressed('Solo Snare')).toHaveAttribute('aria-pressed', 'true');

  const scenes = (await stored(page)).scenes;
  expect(scenes[0].mutes.lanes['1']).toEqual({ muted: true, solo: false });
  expect(scenes[1].mutes.lanes['1']).toEqual({ muted: false, solo: false });
  expect(scenes[0].mutes.drums.kick.muted).toBe(true);
  expect(scenes[1].mutes.drums.snare.solo).toBe(true);

  await page.reload();
  await expect(pressed('Solo Snare')).toHaveAttribute('aria-pressed', 'true');
  await scene(page, 'Scene 1').click();
  await expect(pressed('Mute Synth 1')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
