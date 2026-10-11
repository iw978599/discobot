import { expect, test, type Locator, type Page } from '@playwright/test';

const KIDS_KEY = 'discobot_kids_v1';
const PROJECT_KEY = 'discobot_browser_project_v1';
type Message = { node: string; type: string; instrument?: string; note?: string; time?: number };
const messages = (page: Page) => page.evaluate(() => (window as unknown as { kidsMessages: Message[] }).kidsMessages);
const kidsState = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KIDS_KEY);
const hits = async (page: Page, instrument: string) => (await messages(page)).filter(m => m.type === 'hit' && m.instrument === instrument);
const NOT_FOR_A_CHILD = 'input, select, textarea, a, [role="menu"], [role="dialog"], [role="slider"]';

// Everything that can be pressed is big enough for a finger and on the screen, with nothing to scroll.
async function expectAllInReach(page: Page, kids: Locator) {
  const view = page.viewportSize()!;
  for (const control of await kids.getByRole('button').all()) {
    const box = (await control.boundingBox())!, name = await control.getAttribute('aria-label') || '';
    expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height, name).toBeLessThanOrEqual(view.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

// Requests that leave this site, and errors thrown by the page.
function watch(page: Page, baseURL: unknown) {
  const origin = new URL(String(baseURL)).origin;
  const errors: string[] = [], elsewhere: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== origin && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) elsewhere.push(request.url()); });
  return { errors, elsewhere };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    // Everything sent to the synth and drum processors, so the test can tell what was played.
    const seen: Array<Record<string, unknown>> = [];
    (window as unknown as { kidsMessages: typeof seen }).kidsMessages = seen;
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: Record<string, unknown>) => { seen.push({ node: name, ...message }); post(message); };
      }
    };
  });
});

test('kids mode is big pads and a play button, with nothing to read, type or open', async ({ page }, testInfo) => {
  const seen = watch(page, testInfo.project.use.baseURL);
  await page.goto('./#kids');
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids).toBeVisible();
  await expect(page.locator('.rack'), 'the workstation is not on the page at all').toHaveCount(0);
  await expect(kids.locator(NOT_FOR_A_CHILD)).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY), 'no project is opened or made').toBeNull();

  // Twelve pads, each big enough for a small finger, all on screen with nothing to scroll.
  const pads = kids.getByRole('group', { name: 'Pads', exact: true }).getByRole('button');
  await expect(pads).toHaveCount(12);
  const view = page.viewportSize()!;
  for (const box of await pads.evaluateAll(found => found.map(pad => pad.getBoundingClientRect().toJSON()))) {
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(72);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(view.width);
    expect(box.bottom).toBeLessThanOrEqual(view.height);
  }
  expect(await pads.evaluateAll(found => found.map(pad => pad.getAttribute('aria-label'))), 'the notes from low to high, then the drums')
    .toEqual(['Bear', 'Dog', 'Cat', 'Rabbit', 'Chick', 'Mouse', 'Frog', 'Bee', 'Drum', 'Bang', 'Sparkle', 'Clap']);
  await expectAllInReach(page, kids);

  // A pad sounds the moment it is pressed, before the finger lifts.
  await kids.getByRole('button', { name: 'Drum', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await hits(page, 'kick')).length).toBe(1);
  await kids.getByRole('button', { name: 'Cat', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4']);
  expect((await messages(page)).every(m => m.time === undefined), 'neither waited for a beat').toBe(true);
  // From the keyboard too, once for a held key.
  await kids.getByRole('button', { name: 'Mouse', exact: true }).focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4', 'C5']);
  // The newer pads carry the same scale higher, and add a drum.
  await kids.getByRole('button', { name: 'Frog', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4', 'C5', 'D5']);
  await kids.getByRole('button', { name: 'Bee', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4', 'C5', 'D5', 'E5']);
  await kids.getByRole('button', { name: 'Bang', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await hits(page, 'snare')).length).toBe(1);

  // A sound is chosen by its picture, and is heard as it is chosen. There are six.
  await expect(kids.getByRole('group', { name: 'Sound', exact: true }).getByRole('button')).toHaveCount(6);
  await kids.getByRole('button', { name: 'Ghost', exact: true }).click();
  await expect(kids.getByRole('button', { name: 'Ghost', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').length).toBe(5);
  await expect.poll(async () => (await kidsState(page)).sound).toBe(5);
  await kids.getByRole('button', { name: 'Horn', exact: true }).click();
  await expect(kids.getByRole('button', { name: 'Horn', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Ghost', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(kids.getByRole('button', { name: 'Bell', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').length).toBe(6);
  await expect.poll(async () => (await kidsState(page)).sound).toBe(2);

  // Start from nothing, at the faster of the two speeds.
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  expect((await kidsState(page)).notes.flat().some(Boolean)).toBe(false);
  await kids.getByRole('button', { name: 'Slow. Press to go faster', exact: true }).click();
  await expect(kids.getByRole('button', { name: 'Fast. Press to go slower', exact: true })).toBeVisible();

  // While it plays, a tap is kept and comes round again on its own.
  await kids.getByRole('button', { name: 'Play', exact: true }).click();
  const stop = kids.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.locator('.kids-dots .now')).toHaveCount(1);
  await page.waitForTimeout(400);
  const before = (await messages(page)).length;
  await kids.getByRole('button', { name: 'Bang', exact: true }).click();
  await expect.poll(async () => (await kidsState(page)).notes[11].filter(Boolean).length).toBe(1);
  expect((await messages(page)).slice(before).filter(m => m.instrument === 'snare' && m.time === undefined), 'the tap itself sounded once, at once').toHaveLength(1);
  // The loop is sixteen eighth notes: about four and a half seconds at this speed.
  await expect.poll(async () => (await messages(page)).slice(before).filter(m => m.instrument === 'snare' && typeof m.time === 'number').length, { timeout: 12_000, message: 'the loop plays the tap when it comes round' }).toBeGreaterThan(0);
  await expect(kids.locator('.kids-dots .on')).toHaveCount(1);
  await stop.click();
  await expect(kids.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(kids.locator('.kids-dots .now')).toHaveCount(0);

  // It is all still there after a reload.
  await page.reload();
  await expect(kids.getByRole('button', { name: 'Horn', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Fast. Press to go slower', exact: true })).toBeVisible();
  await expect(kids.locator('.kids-dots .on')).toHaveCount(1);

  expect(seen.elsewhere, 'kids mode asks nothing of the accounts API or any other site').toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('a second screen, reached by its picture, is a grid of pictures for building a beat', async ({ page }, testInfo) => {
  const seen = watch(page, testInfo.project.use.baseURL);
  await page.goto('./#kids');
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  const padsPicture = kids.getByRole('button', { name: 'Play the pads', exact: true }), beatPicture = kids.getByRole('button', { name: 'Build a beat', exact: true });
  const padGroup = kids.getByRole('group', { name: 'Pads', exact: true }), grid = kids.getByRole('group', { name: 'Beat', exact: true });
  await expect(padsPicture).toHaveAttribute('aria-pressed', 'true');
  await expect(beatPicture).toHaveAttribute('aria-pressed', 'false');
  await expect(padGroup).toBeVisible();
  await expect(grid).toHaveCount(0);
  // The way between the two is a drawing, not a word.
  for (const picture of [padsPicture, beatPicture]) {
    await expect(picture.locator('svg')).toBeVisible();
    expect((await picture.innerText()).trim()).toBe('');
  }

  await beatPicture.click();
  await expect(beatPicture).toHaveAttribute('aria-pressed', 'true');
  await expect(padsPicture).toHaveAttribute('aria-pressed', 'false');
  await expect(padGroup).toHaveCount(0);
  await expect(grid).toBeVisible();
  await expect(kids.locator(NOT_FOR_A_CHILD)).toHaveCount(0);

  // Four instruments, each a picture and eight holes, all within reach.
  await expect(grid.getByRole('button')).toHaveCount(36);
  for (const name of ['Drum', 'Bang', 'Sparkle', 'Clap']) {
    await expect(grid.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(grid.getByRole('button', { name: new RegExp(`^${name} [1-8]$`) })).toHaveCount(8);
  }
  await expectAllInReach(page, kids);
  // A first visit has a beat in it already, so Play does something at once.
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(4);
  for (const name of ['Drum 1', 'Drum 5', 'Clap 3', 'Clap 7']) await expect(grid.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');

  // An instrument's picture sounds it. A hole sounds as it is filled, and is quiet when emptied.
  await grid.getByRole('button', { name: 'Bang', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await hits(page, 'snare')).length).toBe(1);
  const hole = grid.getByRole('button', { name: 'Bang 4', exact: true });
  await hole.dispatchEvent('pointerdown', { button: 0 });
  await expect(hole).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await hits(page, 'snare')).length).toBe(2);
  await expect.poll(async () => (await kidsState(page)).beat[1]).toEqual([false, false, false, true, false, false, false, false]);
  await hole.click();
  await expect(hole).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await kidsState(page)).beat[1].some(Boolean)).toBe(false);
  await hole.click();
  await expect(hole).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await hits(page, 'snare')).length).toBe(3);
  expect((await messages(page)).every(m => m.time === undefined), 'none of it waited for a beat').toBe(true);

  // The sponge empties the grid.
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect.poll(async () => (await kidsState(page)).beat.flat().some(Boolean)).toBe(false);

  // A drum on the first step and a sparkle on the second, played at the faster speed.
  await grid.getByRole('button', { name: 'Drum 1', exact: true }).click();
  await grid.getByRole('button', { name: 'Sparkle 2', exact: true }).click();
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(2);
  await kids.getByRole('button', { name: 'Slow. Press to go faster', exact: true }).click();
  const filled = (await messages(page)).length;
  await kids.getByRole('button', { name: 'Play', exact: true }).click();
  const stop = kids.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  // The light is on one step at a time: one hole of each instrument.
  await expect(grid.locator('.now')).toHaveCount(4);
  const played = async (instrument: string) => (await messages(page)).slice(filled).filter(m => m.instrument === instrument && typeof m.time === 'number').map(m => m.time!);
  await expect.poll(async () => (await played('kick')).length, { timeout: 12_000, message: 'the beat comes round' }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await played('closedHH')).length, { timeout: 12_000 }).toBeGreaterThanOrEqual(1);
  const kicks = await played('kick'), sparkles = await played('closedHH');
  // A step is an eighth note and the beat is eight of them: at 110 a minute, 60 / 110 * 4 seconds.
  // A busy machine can miss a turn, so what is checked is that hits are whole turns apart.
  const step = 60 / 110 / 2, turns = (seconds: number) => seconds / (step * 8);
  const apart = turns(kicks[1] - kicks[0]), after = turns(sparkles[0] - kicks[0] - step);
  expect(Math.round(apart)).toBeGreaterThanOrEqual(1);
  expect(Math.abs(apart - Math.round(apart)), `drums ${kicks[1] - kicks[0]} seconds apart`).toBeLessThan(0.02);
  expect(Math.abs(after - Math.round(after)), `the sparkle ${sparkles[0] - kicks[0]} seconds after the drum`).toBeLessThan(0.02);
  expect(await played('snare'), 'what the sponge took away stays away').toEqual([]);

  // The beat keeps playing on the pad screen, where its drum's pad lights with it, and a tap there joins in.
  await padsPicture.click();
  await expect(padGroup).toBeVisible();
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.locator('.kids-dots .now')).toHaveCount(1);
  await page.waitForFunction(() => document.querySelector('.kids-pad[data-pad="6"]')?.classList.contains('lit') === true, null, { timeout: 12_000 });
  await kids.getByRole('button', { name: 'Cat', exact: true }).click();
  await expect.poll(async () => (await kidsState(page)).notes[2].filter(Boolean).length).toBe(1);
  const kicksSoFar = (await played('kick')).length;
  await expect.poll(async () => (await played('kick')).length, { timeout: 12_000, message: 'the beat plays on under the pads' }).toBeGreaterThan(kicksSoFar);
  await beatPicture.click();
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(2);
  await stop.click();
  await expect(kids.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(grid.locator('.now')).toHaveCount(0);

  // After a reload it opens where it was left, with the beat and the tune both kept.
  await page.reload();
  await expect(beatPicture).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(2);
  await expect(grid.getByRole('button', { name: 'Drum 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.getByRole('button', { name: 'Sparkle 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Fast. Press to go slower', exact: true })).toBeVisible();
  await padsPicture.click();
  await expect(kids.locator('.kids-dots .on')).toHaveCount(1);
  // On the pad screen the sponge takes the tune and leaves the beat.
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(kids.locator('.kids-dots .on')).toHaveCount(0);
  await expect.poll(async () => (await kidsState(page)).notes.flat().some(Boolean)).toBe(false);
  const kept = await kidsState(page);
  expect(kept.beat.flat().filter(Boolean)).toHaveLength(2);
  expect(kept.screen).toBe('pads');

  expect(await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY), 'no project is opened or made').toBeNull();
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(found => found.name).filter(name => name?.startsWith('discobot-'))), 'nor the project library, the samples or the presets').toEqual([]);
  expect(seen.elsewhere, 'kids mode asks nothing of the accounts API or any other site').toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('a tune kept by the first kids mode still opens, with the new places empty', async ({ page }) => {
  const row = (...steps: number[]) => Array.from({ length: 16 }, (_, step) => steps.includes(step));
  const old = { sound: 3, tempo: 'fast', notes: [row(1), row(), row(5), row(), row(), row(), row(0, 8), row(), row(3)] };
  await page.goto('./#kids');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KIDS_KEY, JSON.stringify(old)]);
  await page.reload();
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids.getByRole('button', { name: 'Robot', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Fast. Press to go slower', exact: true })).toBeVisible();
  await expect(kids.getByRole('group', { name: 'Pads', exact: true }).getByRole('button')).toHaveCount(12);
  await expect(kids.locator('.kids-dots .on')).toHaveCount(5);
  await kids.getByRole('button', { name: 'Build a beat', exact: true }).click();
  await expect(kids.getByRole('group', { name: 'Beat', exact: true }).getByRole('button')).toHaveCount(36);
  await expect(kids.getByRole('group', { name: 'Beat', exact: true }).locator('[aria-pressed="true"]'), 'nothing was added to it').toHaveCount(0);
  const now = await kidsState(page);
  expect(now.notes.slice(0, 9)).toEqual(old.notes);
  expect(now.notes).toHaveLength(12);
  expect(now.notes.slice(9).flat().some(Boolean)).toBe(false);
});

test('kids mode is reached from the Project menu, cannot touch the project, and is only left by holding', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 3', exact: true }).click();
  const project = () => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), localStorage.getItem(key)), PROJECT_KEY);
  const saved = JSON.parse((await project())!);
  expect(saved.drumState.kick.steps.slice(0, 4)).toEqual([false, false, true, false]);

  const entries = await page.evaluate(() => window.history.length);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kids Mode', exact: true }).click();
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids).toBeVisible();
  expect(page.url()).toMatch(/#kids$/);

  // Going back is not a way out: going in left nothing to go back to, and another address
  // in this tab is put back to kids mode.
  expect(await page.evaluate(() => window.history.length), 'going in adds no page to go back to').toBe(entries);
  await page.evaluate(() => { window.location.hash = ''; });
  await expect.poll(() => page.url()).toMatch(/#kids$/);
  await expect(kids).toBeVisible();
  await page.goto('./');
  await expect(kids).toBeVisible();
  await expect.poll(() => page.url()).toMatch(/#kids$/);
  await expect(kids.locator('.kids-dots .on'), 'a first visit has no tune yet').toHaveCount(0);

  // Everything a child can press, pressed: the pads and sounds, then every picture and hole of the beat.
  for (const name of ['Bear', 'Dog', 'Cat', 'Rabbit', 'Chick', 'Mouse', 'Frog', 'Bee', 'Drum', 'Bang', 'Clap', 'Sparkle', 'Bell', 'Piano', 'Horn', 'Robot', 'Guitar', 'Ghost']) await kids.getByRole('button', { name, exact: true }).click();
  await kids.getByRole('button', { name: 'Play', exact: true }).click();
  await kids.getByRole('button', { name: 'Sparkle', exact: true }).click();
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  await kids.getByRole('button', { name: /^Slow/ }).click();
  await kids.getByRole('button', { name: 'Build a beat', exact: true }).click();
  const grid = kids.getByRole('group', { name: 'Beat', exact: true });
  await expect(grid.locator('[aria-pressed="true"]'), 'a first visit starts with a beat').toHaveCount(4);
  for (const control of await grid.getByRole('button').all()) await control.click();
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(28);
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  await kids.getByRole('button', { name: 'Play the pads', exact: true }).click();
  await kids.getByRole('button', { name: 'Stop', exact: true }).click();

  // The way out does nothing when pressed, or held for a moment.
  const leave = kids.getByRole('button', { name: 'Leave kids mode: press and hold for three seconds', exact: true });
  await leave.click();
  await leave.hover();
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.waitForTimeout(2200);
  await expect(kids, 'a short hold, let go, does not add up').toBeVisible();
  expect(JSON.parse((await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY))!), 'the project is exactly as it was').toEqual(saved);

  // Held for three seconds, it goes back to the workstation, where nothing has changed.
  await leave.hover();
  await page.mouse.down();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible({ timeout: 8_000 });
  await page.mouse.up();
  expect(page.url()).not.toContain('#kids');
  await expect(page.getByRole('button', { name: 'Kick step 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const after = JSON.parse((await project())!);
  expect({ ...after, revision: 0, updatedAt: 0 }).toEqual({ ...saved, revision: 0, updatedAt: 0 });
  expect(await page.evaluate(key => localStorage.getItem(key), KIDS_KEY), 'the child\'s tune is kept apart from it').not.toBeNull();
});
