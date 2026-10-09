import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
const project = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

type Captured = { type: string; note?: string; instrument?: string; time?: number };
async function menu(page: Page, name: 'Project' | 'Export', item: string) {
  await page.getByRole('button', { name: `${name} ▾`, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

const messages = (page: Page) => page.evaluate(() => (window as unknown as { audioMessages: Captured[] }).audioMessages);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    const captured: Array<{ type: string }> = [];
    (window as unknown as { audioMessages: typeof captured }).audioMessages = captured;
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: { type: string }) => {
          captured.push(message);
          post(message);
        };
      }
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the computer keyboard plays the selected synth, shifts octave and stays out of text fields', async ({ page }) => {
  await page.getByRole('heading', { name: 'Discobot', exact: true }).click();
  const c4 = page.getByRole('button', { name: 'Play C4', exact: true });
  await page.keyboard.down('a');
  await expect(c4).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await messages(page)).some(m => m.type === 'noteOn' && m.note === 'C4')).toBe(true);
  await page.keyboard.up('a');
  await expect(c4).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await messages(page)).some(m => m.type === 'noteOff' && m.note === 'C4')).toBe(true);

  await page.keyboard.down('w');
  await expect(page.getByRole('button', { name: 'Play C#4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('w');

  await page.keyboard.press('x');
  await expect(page.locator('.keyboard-panel-toggle .octave-shift-value')).toHaveText('+1');
  await page.keyboard.down('a');
  await expect(page.getByRole('button', { name: 'Play C5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  await page.keyboard.press('z');
  await expect(page.locator('.keyboard-panel-toggle .octave-shift-value')).toHaveText('0');

  // A selected step takes the note, the same as clicking the on-screen key.
  await page.locator('.synth-module').first().getByRole('button', { name: 'Select step 3', exact: true }).click();
  await page.keyboard.press('d');
  await expect.poll(async () => (await project(page)).synths[0].pattern.steps[2].note).toBe('E4');

  const before = (await messages(page)).filter(m => m.type === 'noteOn').length;
  await page.getByRole('button', { name: '+ Save', exact: true }).click();
  await page.locator('.save-name-input').pressSequentially('sad face');
  await expect(page.locator('.save-name-input')).toHaveValue('sad face');
  expect((await messages(page)).filter(m => m.type === 'noteOn').length, 'typing a name plays nothing').toBe(before);
  await page.locator('.save-name-input').press('Escape');

  // The second lane has its own octave and gets the notes once it is selected.
  await page.getByRole('button', { name: /^Synth 2/ }).click();
  await page.getByRole('heading', { name: 'Discobot', exact: true }).click();
  await page.keyboard.down('s');
  await expect(page.getByRole('button', { name: 'Play D4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('s');
  await expect(page.locator('.key.active')).toHaveCount(0);
});

test('drum steps repeat inside the step and can be given a chance of playing', async ({ page }) => {
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByLabel('Kick step 1 repeats', { exact: true }).selectOption('2');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toContainText('×2');
  await expect.poll(async () => (await project(page)).drumState.kick.stepRatchets?.[0]).toBe(2);
  await page.evaluate(() => { (window as unknown as { audioMessages: unknown[] }).audioMessages.length = 0; });

  await page.getByRole('button', { name: /Play All/ }).click();
  const kicks = async () => (await messages(page)).filter(m => m.type === 'hit' && m.instrument === 'kick' && typeof m.time === 'number');
  await expect.poll(async () => (await kicks()).length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const [first, second] = await kicks();
  expect(second.time! - first.time!, 'the repeat lands half a sixteenth later at 120 BPM').toBeCloseTo(0.0625, 3);

  await page.getByLabel('Kick step 1 chance', { exact: true }).fill('0');
  await expect.poll(async () => (await project(page)).drumState.kick.stepProbabilities?.[0]).toBe(0);
  // Hits already handed to the audio clock may still arrive; after that the step stays silent.
  await page.waitForTimeout(400);
  await page.evaluate(() => { (window as unknown as { audioMessages: unknown[] }).audioMessages.length = 0; });
  await page.waitForTimeout(4500);
  expect((await kicks()).length, 'a step with no chance never plays').toBe(0);
  await page.getByRole('button', { name: /Stop All/ }).click();

  await page.getByLabel('Kick step 1 chance', { exact: true }).fill('0.5');
  await page.getByTitle('Shift pattern right', { exact: true }).click();
  await expect.poll(async () => {
    const kick = (await project(page)).drumState.kick;
    return [kick.steps[1], kick.stepRatchets[1], kick.stepProbabilities[1], kick.stepRatchets[0], kick.stepProbabilities[0]];
  }, { message: 'chance and repeats move with their step' }).toEqual([true, 2, 0.5, 1, 1]);
});

test('loop export is exactly one bar and stems arrive as one zip of aligned WAV files', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  const loopDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Loop WAV');
  const loop = await loopDownload;
  expect(loop.suggestedFilename()).toMatch(/^discobot-loop-\d+\.wav$/);
  const loopPath = testInfo.outputPath('loop.wav');
  await loop.saveAs(loopPath);
  const loopBytes = await readFile(loopPath);
  expect(loopBytes.length, 'one bar at 120 BPM is two seconds of 16-bit stereo').toBe(44 + 2 * 44100 * 4);
  expect(loopBytes.subarray(44).some(byte => byte !== 0)).toBe(true);

  const stemsDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Stems');
  const stems = await stemsDownload;
  expect(stems.suggestedFilename()).toMatch(/^discobot-stems-\d+\.zip$/);
  const stemsPath = testInfo.outputPath('stems.zip');
  await stems.saveAs(stemsPath);
  const zip = await readFile(stemsPath);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  expect(zip.readUInt16LE(end + 10), 'one lane with notes plus the drums').toBe(2);
  let cursor = zip.readUInt32LE(end + 16);
  const entries: Array<{ name: string; size: number; offset: number }> = [];
  for (let i = 0; i < 2; i++) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    entries.push({ name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString(), size: zip.readUInt32LE(cursor + 24), offset: zip.readUInt32LE(cursor + 42) });
    cursor += 46 + nameLength;
  }
  expect(entries.map(entry => entry.name)).toEqual(['synth-1.wav', 'drums.wav']);
  expect(entries[0].size, 'stems are the same length so they line up').toBe(entries[1].size);
  for (const entry of entries) {
    const data = zip.subarray(entry.offset + 30 + entry.name.length, entry.offset + 30 + entry.name.length + entry.size);
    expect(data.subarray(0, 4).toString()).toBe('RIFF');
    expect(data.subarray(44).some(byte => byte !== 0), `${entry.name} has audio in it`).toBe(true);
  }
  await expect(page.locator('.app-alert')).toHaveCount(0);
});

test('a project file restores lanes, drums, saved arrangements and presets over a different project', async ({ page }, testInfo) => {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('96');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'G3 step 2', exact: true }).click();
  await page.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await page.getByLabel('Snare step 5 repeats', { exact: true }).selectOption('3');
  await page.getByLabel('Preset name', { exact: true }).fill('Travel keys');
  await page.locator('.preset-controls').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: '+ Save', exact: true }).click();
  await page.locator('.save-name-input').fill('Backed up');
  await page.locator('.save-name-input').press('Enter');
  await expect(page.getByText('Saved!', { exact: false })).toBeVisible();

  const download = page.waitForEvent('download');
  await menu(page, 'Project', 'Export Project');
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/^discobot-project-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath('project.json');
  await exported.saveAs(path);
  const file = JSON.parse(await readFile(path, 'utf8'));
  expect(file.format).toBe('discobot-project');
  expect(file.project.tempo).toBe(96);
  expect(file.synthPresets.map((preset: { name: string }) => preset.name)).toEqual(['Travel keys']);

  // A reload with an intact project must not warn that it was damaged.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(page.locator('.app-alert')).toHaveCount(0);

  // Wipe the browser, as if this were another device.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.tempo-led-value')).toHaveText('120');
  await expect(page.getByLabel('Synth preset', { exact: true }).locator('option').filter({ hasText: 'Travel keys' })).toHaveCount(0);

  const input = page.locator('input[aria-label="Import project file"]');
  const refused = page.waitForEvent('dialog');
  await input.setInputFiles(path);
  await (await refused).dismiss();
  await expect(page.locator('.tempo-led-value')).toHaveText('120');

  const confirmed = page.waitForEvent('dialog');
  await input.setInputFiles(path);
  await (await confirmed).accept();
  await expect(page.locator('.tempo-led-value')).toHaveText('96');
  await expect(page.getByRole('button', { name: 'G3 step 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toContainText('×3');
  await expect(page.locator('.load-select option').filter({ hasText: 'Backed up' })).toHaveCount(1);
  await expect(page.getByLabel('Synth preset', { exact: true }).locator('option').filter({ hasText: 'Travel keys' })).toHaveCount(1);
  await expect(page.locator('.app-alert')).toHaveCount(0);
  const stored = await project(page);
  expect(stored.tempo).toBe(96);
  expect(stored.savedPatterns).toHaveLength(1);

  await input.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.locator('.app-alert')).toContainText('not a Discobot project file');
  expect((await project(page)).tempo, 'a file that is not a project changes nothing').toBe(96);
});

test('the app installs a service worker and opens with no network', async ({ page, context }) => {
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    const response = await fetch(link.href);
    return { ok: response.ok, url: link.href, body: await response.json() };
  });
  expect(manifest.ok).toBe(true);
  expect(manifest.url).toContain('/discobot/manifest.webmanifest');
  expect(manifest.body.icons.length).toBeGreaterThan(0);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/discobot\/$/);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.locator('.drum-step-indicator.active').first()).toBeVisible();
  await expect.poll(async () => (await messages(page)).some(m => m.type === 'hit'), { message: 'the audio worklet loads from the cache' }).toBe(true);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await context.setOffline(false);
});
