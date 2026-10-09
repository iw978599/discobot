import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const guestAddress = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest`;

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a guest instrument is hosted, follows the transport, sends its sound to the mixer and keeps its settings', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL), address = guestAddress(baseURL);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Addresses that must be refused: not https, and Discobot's own site.
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await expect(dialog).toContainText('cannot read your projects or your account');
  for (const bad of ['http://example.com/synth', `${baseURL}index.html`, 'javascript:alert(1)']) {
    await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(bad);
    await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).press('Enter');
    await expect(dialog.getByRole('alert'), bad).toContainText('not an address a guest instrument can be loaded from');
  }
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();

  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(unit.getByRole('status')).toContainText('Connected');
  const guest = unit.frameLocator('iframe');
  await expect(guest.getByRole('status')).toContainText(`Hosted by ${new URL(baseURL).origin}`);
  await expect(guest.getByRole('status')).toContainText('Stopped');
  await expect(guest.getByRole('button', { name: 'Start', exact: true }), 'the host drives the transport').toBeHidden();

  // The frame is kept apart from Discobot: it is another site's page.
  const frame = unit.locator('iframe');
  expect(await frame.getAttribute('sandbox')).toContain('allow-scripts');
  expect(new URL((await frame.getAttribute('src'))!).origin).not.toBe(new URL(baseURL).origin);

  // Its settings are saved in the project.
  await guest.getByLabel('Note', { exact: true }).selectOption('G4');
  await expect.poll(async () => (await stored(page)).guests?.[0]?.state).toEqual({ note: 'G4', wave: 'triangle' });

  // Play: the guest starts with the transport at Discobot's tempo, and its sound arrives.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('150');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(guest.getByRole('status')).toContainText('Playing at 150 BPM');
  await expect.poll(async () => Number(/Beats played: (\d+)/.exec(await guest.getByRole('status').innerText())?.[1])).toBeGreaterThan(2);
  await expect.poll(async () => Number(await unit.getAttribute('data-audio-blocks')), { message: 'audio crosses from the frame into the mixer' }).toBeGreaterThan(10);

  // A tempo change reaches it while playing.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('100');
  await page.locator('.tempo-led-input').press('Enter');
  await expect(guest.getByRole('status')).toContainText('Playing at 100 BPM');
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(guest.getByRole('status')).toContainText('Stopped');

  // Level and mute are the project's, like any lane.
  await unit.getByRole('button', { name: /^Mute guest / }).click();
  expect((await stored(page)).guests[0]).toMatchObject({ url: address, muted: true });

  // After a reload the guest comes back with its settings, without being asked about again.
  await page.reload();
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(guest.getByLabel('Note', { exact: true })).toHaveValue('G4');
  await expect(unit.getByRole('button', { name: /^Mute guest / })).toHaveAttribute('aria-pressed', 'true');

  // Removing is confirmed in the page, not in a browser dialog, which a browser can be told to stop showing.
  let dialogs = 0;
  page.on('dialog', dialog => { dialogs += 1; void dialog.dismiss(); });
  await unit.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(unit, 'the first press only asks').toHaveCount(1);
  await unit.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(unit.getByRole('button', { name: 'Remove It', exact: true })).toHaveCount(0);
  await unit.getByRole('button', { name: 'Remove', exact: true }).click();
  await unit.getByRole('button', { name: 'Remove It', exact: true }).click();
  expect(dialogs).toBe(0);
  await expect(unit).toHaveCount(0);
  expect((await stored(page)).guests).toEqual([]);
  expect(errors).toEqual([]);
});

test('a guest that arrives with someone else\'s song is not loaded until the visitor agrees', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL), address = guestAddress(baseURL);
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  await expect(page.getByRole('region', { name: /^Guest instrument / })).toHaveAttribute('data-status', 'ready');
  await menu(page, 'Share Link');
  const link = await page.getByRole('dialog', { name: 'Share this song', exact: true }).getByLabel('Share link', { exact: true }).inputValue();

  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  const requests: string[] = [];
  visitor.on('request', request => { if (request.url().startsWith(new URL(address).origin)) requests.push(request.url()); });
  await visitor.goto(link);
  await visitor.getByRole('button', { name: 'Open a Copy to Edit', exact: true }).click();
  const unit = visitor.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'asking');
  await expect(unit).toContainText(`uses a guest instrument from ${new URL(address).origin}`);
  await expect(unit.locator('iframe')).toHaveCount(0);
  expect(requests, 'nothing is fetched from the guest\'s site before the visitor agrees').toEqual([]);

  await unit.getByRole('button', { name: 'Load It', exact: true }).click();
  await expect(unit).toHaveAttribute('data-status', 'ready');
  expect(requests.length).toBeGreaterThan(0);
  await visitorContext.close();
});

test('a WAV export records the guest by playing through once, and the named instruments are on offer', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL), address = guestAddress(baseURL);
  const { readFile } = await import('node:fs/promises');
  const exportWav = async (name: string) => {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Download WAV', exact: true }).click();
    const path = testInfo.outputPath(name);
    await (await download).saveAs(path);
    const bytes = await readFile(path);
    // 16-bit stereo at 44.1 kHz: the level of the left channel between two times, in seconds.
    return (from: number, to: number) => {
      let sum = 0, count = 0;
      for (let frame = Math.round(from * 44100); frame < Math.round(to * 44100); frame++) { const value = bytes.readInt16LE(44 + frame * 4) / 32768; sum += value * value; count++; }
      return Math.sqrt(sum / count);
    };
  };

  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  for (const name of ['Choir', 'Logic Rhythm', 'Boolean Melody Machine', 'Tape Loop Deck']) {
    await expect(dialog.getByRole('group', { name: `${name} by Aaron Van Dorn`, exact: true }).getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  }
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');

  // 240 BPM: a bar is one second and the guest rings on every quarter of it. A kick on beat one only.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('240');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  // Muted, the guest is left out and nothing has to be played.
  await unit.getByRole('button', { name: /^Mute guest / }).click();
  const without = await exportWav('without-guest.wav');
  await expect(page.getByText('Recording the guest instruments')).toHaveCount(0);

  await unit.getByRole('button', { name: /^Mute guest / }).click();
  const pending = exportWav('with-guest.wav');
  await expect(page.getByText('Recording the guest instruments')).toBeVisible();
  const withGuest = await pending;
  await expect(page.getByText('Recording the guest instruments')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Play All/ }), 'playback stops when the recording is done').toBeVisible();

  // The fourth beat is three quarters of a second in. Only the guest plays there; the kick is a fading tail by then.
  expect(withGuest(0.75, 0.81), 'the bell is in the file').toBeGreaterThan(without(0.75, 0.81) * 2 + 0.02);
  expect(withGuest(0.752, 0.772), 'and it starts on the beat, not before it').toBeGreaterThan(withGuest(0.72, 0.745) * 1.5);
  expect(withGuest(0, 0.05), 'the kick is still there').toBeGreaterThan(0.02);
});

test('a guest whose sound arrives late is still heard, and is then asked to play earlier', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  // The example guest holds every block of audio back by a quarter of a second, as a slow browser might.
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(`${guestAddress(baseURL)}?delay=250`);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(unit).toHaveAttribute('data-latency', '120');

  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(async () => Number(await unit.getAttribute('data-late-blocks')), { message: 'the late audio is noticed' }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await unit.getAttribute('data-latency')), { message: 'and the guest is asked to play earlier by enough to cover it' }).toBeGreaterThanOrEqual(240);
  await expect(unit.getByRole('alert')).toContainText('takes longer than usual to arrive');
  await expect(unit.frameLocator('iframe').getByRole('status')).toContainText('Playing');

  // Once it has adjusted, blocks stop arriving late.
  await page.waitForTimeout(1200);
  const settled = Number(await unit.getAttribute('data-late-blocks'));
  await page.waitForTimeout(1500);
  expect(Number(await unit.getAttribute('data-late-blocks')), 'no more late blocks after adjusting').toBe(settled);
  expect(Number(await unit.getAttribute('data-audio-blocks'))).toBeGreaterThan(50);
  await page.getByRole('button', { name: /Stop All/ }).click();
});

test('a guest\'s settings belong to the scene, and change with it when a song moves on', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(guestAddress(baseURL));
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  const note = unit.frameLocator('iframe').getByLabel('Note', { exact: true });
  const sceneGuests = async () => (await stored(page)).scenes.map((scene: { name: string; guests?: Record<string, { note: string }> }) => [scene.name, Object.values(scene.guests ?? {})[0]?.note]);

  // Scene 1 has the guest on G4.
  await note.selectOption('G4');
  await expect.poll(async () => (await stored(page)).guests[0].state?.note).toBe('G4');

  // A copy of the scene starts the same, and is then given A4.
  await page.getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scene: Scene 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveValue('G4');
  await note.selectOption('A4');
  await expect.poll(async () => (await stored(page)).guests[0].state?.note).toBe('A4');

  // Opening a scene puts the guest back to how that scene left it.
  await page.getByRole('button', { name: 'Scene: Scene 1', exact: true }).click();
  await expect(note).toHaveValue('G4');
  await page.getByRole('button', { name: 'Scene: Scene 2', exact: true }).click();
  await expect(note).toHaveValue('A4');
  expect(await sceneGuests()).toEqual([['Scene 1', 'G4'], ['Scene 2', 'A4']]);

  // It survives a reload, for both scenes.
  await page.reload();
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(note).toHaveValue('A4');
  await page.getByRole('button', { name: 'Scene: Scene 1', exact: true }).click();
  await expect(note).toHaveValue('G4');

  // In song mode the guest changes with the scenes as they play.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('240');
  await page.locator('.tempo-led-input').press('Enter');
  // The song starts as Scene 1; the open scene is what the Add button adds.
  await page.getByRole('button', { name: 'Scene: Scene 2', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Scene 2', exact: true }).click();
  await page.getByRole('button', { name: 'More repeats for block 1', exact: true }).click();
  await page.getByRole('button', { name: 'More repeats for block 2', exact: true }).click();
  await page.getByRole('group', { name: 'Play mode' }).getByRole('button', { name: 'Song', exact: true }).click();
  await page.getByRole('group', { name: 'Song block 1: Scene 1', exact: true }).getByRole('button', { name: /Scene 1/ }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(note, 'the first scene plays with its own setting').toHaveValue('G4');
  await expect(page.getByRole('button', { name: 'Scene: Scene 2', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  await expect(note, 'and the guest follows the song into the second').toHaveValue('A4');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible({ timeout: 10_000 });
  expect(await sceneGuests(), 'playing through did not mix the two up').toEqual([['Scene 1', 'G4'], ['Scene 2', 'A4']]);
});
