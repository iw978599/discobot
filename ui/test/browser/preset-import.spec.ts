import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
// The preset menu: a button, a list of groups, and a list of the chosen group's presets.
const presetButton = (scope: Page | Locator) => scope.getByRole('button', { name: /^Synth preset/ });
const presetRow = (scope: Page | Locator, group: string, name: string) => scope.getByRole('menu', { name: group, exact: true }).getByRole('menuitem', { name, exact: true });
async function openPresetGroup(scope: Page | Locator, group: string) {
  await presetButton(scope).click();
  await scope.locator(`[role="menuitem"][data-group="${group}"]`).click();
}
// Escape goes back from the group's list, then closes the menu.
async function closePresetMenu(page: Page, scope: Page | Locator = page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(presetButton(scope)).toHaveAttribute('aria-expanded', 'false');
}
const file = (name: string, contents: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof contents === 'string' ? contents : JSON.stringify(contents)) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a preset from another synth is imported with a report, and Discobot\'s own presets round-trip', async ({ page }, testInfo) => {
  const lane = page.locator('.synth-module').first();
  const input = lane.getByLabel('Import synth preset', { exact: true });
  const report = page.getByRole('dialog', { name: 'Preset imported', exact: true });

  // A VAST G1-J8 preset: wave 2 is a saw, cutoff 69 is the note A440, and its pan LFO has no equivalent.
  await input.setInputFiles(file('1985-1.preset.websynth.json', { format: 'websynth-preset', version: 1, name: '1985-1', params: {
    'voicing.mode': 0, 'osc1.wave': 2, 'osc1.octave': -1, 'osc2.wave': 3, 'osc2.level': 0.5, 'osc1.level': 1, 'sub.level': 0.6,
    'filter.cutoff': 69, 'filter.resonance': 1, 'filter.model': 0, 'filter.envAmount': 30, 'lfo.amount': 0.5, 'lfo.dest': 5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'seq.0.len': 16,
  } }));
  await expect(report).toContainText('1985-1 was imported from VAST G1-J8');
  await expect(report).toContainText('translated, not copied');
  await expect(report.getByRole('listitem').filter({ hasText: 'Oscillator 1 was -1 octave' })).toBeVisible();
  await expect(report.getByRole('listitem').filter({ hasText: 'LFO 1 moved the pan' })).toBeVisible();
  await page.keyboard.press('Escape');

  const sound = (await stored(page)).synths[0].synthParams;
  expect(sound.oscillator.type).toBe('sawtooth');
  expect(sound.oscillator2).toMatchObject({ enabled: true, type: 'square', semitones: 12, level: 0.5 });
  expect(sound.voiceMode).toBe('mono');
  expect(Math.round(sound.filter.frequency)).toBe(440);
  expect(sound.filter).toMatchObject({ type: 'lowpass', slope: 24, envAmount: 0.5 });
  expect(sound.mixer.sub).toBe(0.6);
  expect(sound.fxSends.reverb).toBe(0.4);
  expect(sound.lfo1.enabled).toBe(false);

  // It is kept with the presets, so it can be put on any lane later.
  await openPresetGroup(lane, 'My presets');
  await expect(presetRow(lane, 'My presets', '1985-1')).toBeVisible();
  await page.reload();
  await openPresetGroup(lane, 'My presets');
  await expect(presetRow(lane, 'My presets', '1985-1')).toBeVisible();
  await closePresetMenu(page, lane);

  // Importing the same file again does not overwrite the first.
  await input.setInputFiles(file('1985-1.preset.websynth.json', { format: 'websynth-preset', version: 1, name: '1985-1', params: {} }));
  await expect(report).toContainText('1985-1 2 was imported');
  await page.keyboard.press('Escape');

  // Export the lane's sound and bring it back in: an exact copy, with nothing to report.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await lane.getByLabel('Preset name', { exact: true }).fill('Night Bass');
  const download = page.waitForEvent('download');
  await lane.getByRole('button', { name: 'Export', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Night Bass.discobot-preset.json');
  const exported = JSON.parse((await readFile((await saved.path())!)).toString());
  expect(exported).toMatchObject({ format: 'discobot-preset', version: 1, name: 'Night Bass' });
  const before = (await stored(page)).synths[0].synthParams;

  await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
  const second = page.locator('.synth-module').nth(1);
  await second.getByLabel('Import synth preset', { exact: true }).setInputFiles(file('Night Bass.discobot-preset.json', exported));
  await expect(report).toContainText('Night Bass was imported from Discobot');
  await expect(report.getByRole('listitem')).toHaveCount(0);
  await expect(report).not.toContainText('translated');
  await page.keyboard.press('Escape');
  expect((await stored(page)).synths.find((synth: { synthId: number }) => synth.synthId === 2).synthParams).toEqual(before);

  // Files that are not presets are refused with a reason, and change nothing.
  for (const [contents, reason] of [[{ some: 'json' }, 'does not recognise this preset file'], ['not json at all', 'could not be read as a preset'], [{ format: 'discobot-project', formatVersion: 1, project: {} }, 'Import Project']] as const) {
    await second.getByLabel('Import synth preset', { exact: true }).setInputFiles(file('other.json', contents));
    await expect(page.locator('.app-alert').filter({ hasText: reason })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  }
  await expect(report).toHaveCount(0);
});

test('the top bar stays in reach when the page is scrolled', async ({ page }) => {
  const bar = page.locator('.rack-unit.transport');
  const play = page.getByRole('button', { name: /Play All/ });
  const top = (await bar.boundingBox())!.y;
  await page.getByRole('region', { name: 'Drums module', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('.effects-unit').scrollIntoViewIfNeeded();
  expect(await page.locator('.rack-page').evaluate(element => element.scrollTop), 'the page has scrolled').toBeGreaterThan(200);
  const box = (await bar.boundingBox())!;
  expect(box.y, 'the bar is at the top of the window').toBeLessThanOrEqual(Math.max(0, top));
  // The whole bar stays: on a narrow screen it is one line, and none of it scrolls away.
  expect(box.y).toBeGreaterThanOrEqual(-1);
  const stuck = (await play.boundingBox())!;
  expect(stuck.y, 'Play is still at the top of the window').toBeGreaterThanOrEqual(-1);
  expect(stuck.y).toBeLessThan(40);
  await play.click();
  await expect(page.getByRole('button', { name: /Stop All/ })).toBeVisible();
  await page.getByRole('button', { name: /Stop All/ }).click();
});

test('your own presets are kept in IndexedDB, and ones from before are moved there without being lost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const OLD_KEY = 'discobot_synth_presets_v1';
  const lane = page.locator('.synth-module').first();
  const inDatabase = () => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('discobot-presets');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction('presets').objectStore('presets').getAll();
      all.onsuccess = () => { resolve((all.result as Array<{ name: string; position: number }>).sort((a, b) => a.position - b.position).map(entry => entry.name)); request.result.close(); };
    };
  }));

  // A preset saved now goes to the database, and nothing is written to the old place.
  await lane.getByLabel('Preset name', { exact: true }).fill('Night Bass');
  await lane.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(inDatabase).toEqual(['Night Bass']);
  expect(await page.evaluate(key => localStorage.getItem(key), OLD_KEY)).toBeNull();

  // One left behind by the version before this is picked up on the next visit, after the one already kept.
  const old = await page.evaluate(() => new Promise<unknown>((resolve) => {
    const request = indexedDB.open('discobot-presets');
    request.onsuccess = () => {
      const all = request.result.transaction('presets').objectStore('presets').getAll();
      all.onsuccess = () => { const { position: _position, ...preset } = all.result[0]; request.result.close(); resolve({ ...preset, id: 'user-from-before', name: 'From Before' }); };
    };
  }));
  await page.evaluate(([key, preset]) => localStorage.setItem(key as string, JSON.stringify([preset])), [OLD_KEY, old] as const);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(inDatabase).toEqual(['Night Bass', 'From Before']);
  await openPresetGroup(lane, 'My presets');
  await expect(presetRow(lane, 'My presets', 'Night Bass')).toBeVisible();
  await expect(presetRow(lane, 'My presets', 'From Before')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), OLD_KEY), 'the old copy is removed once it has been moved').toBeNull();

  // Both are still there after another reload, and a deleted one stays deleted.
  await page.reload();
  await openPresetGroup(lane, 'My presets');
  await expect(presetRow(lane, 'My presets', 'Night Bass')).toBeVisible();
  await presetRow(lane, 'My presets', 'From Before').click();
  await expect(presetButton(lane)).toHaveAccessibleName('Synth preset: From Before');
  await lane.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(inDatabase).toEqual(['Night Bass']);
  await page.reload();
  await openPresetGroup(lane, 'My presets');
  await expect(presetRow(lane, 'My presets', 'Night Bass')).toBeVisible();
  await expect(presetRow(lane, 'My presets', 'From Before')).toHaveCount(0);
  expect(errors).toEqual([]);
});
