import { expect, test, type Page } from '@playwright/test';

const KIDS_KEY = 'discobot_kids_v1';
const PROJECT_KEY = 'discobot_browser_project_v1';
type Message = { node: string; type: string; instrument?: string; note?: string; time?: number };
const messages = (page: Page) => page.evaluate(() => (window as unknown as { kidsMessages: Message[] }).kidsMessages);
const kidsState = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KIDS_KEY);

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
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  const errors: string[] = [], elsewhere: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== origin && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) elsewhere.push(request.url()); });
  await page.goto('./#kids');
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids).toBeVisible();
  await expect(page.locator('.rack'), 'the workstation is not on the page at all').toHaveCount(0);
  await expect(kids.locator('input, select, textarea, a, [role="menu"], [role="dialog"], [role="slider"]')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY), 'no project is opened or made').toBeNull();

  // Nine pads, each big enough for a small finger, all on screen with nothing to scroll.
  const pads = kids.getByRole('group', { name: 'Pads', exact: true }).getByRole('button');
  await expect(pads).toHaveCount(9);
  const view = page.viewportSize()!;
  for (const box of await pads.evaluateAll(found => found.map(pad => pad.getBoundingClientRect().toJSON()))) {
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(72);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(view.width);
    expect(box.bottom).toBeLessThanOrEqual(view.height);
  }
  for (const control of await kids.getByRole('button').all()) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height), await control.getAttribute('aria-label') || '').toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A pad sounds the moment it is pressed, before the finger lifts.
  await kids.getByRole('button', { name: 'Drum', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'hit' && m.instrument === 'kick').length).toBe(1);
  await kids.getByRole('button', { name: 'Cat', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4']);
  expect((await messages(page)).every(m => m.time === undefined), 'neither waited for a beat').toBe(true);
  // From the keyboard too, once for a held key.
  await kids.getByRole('button', { name: 'Mouse', exact: true }).focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').map(m => m.note)).toEqual(['E4', 'C5']);

  // A sound is chosen by its picture, and is heard as it is chosen.
  await kids.getByRole('button', { name: 'Horn', exact: true }).click();
  await expect(kids.getByRole('button', { name: 'Horn', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Bell', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await messages(page)).filter(m => m.type === 'noteOn').length).toBe(3);
  expect((await kidsState(page)).sound).toBe(2);

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
  await kids.getByRole('button', { name: 'Clap', exact: true }).click();
  await expect.poll(async () => (await kidsState(page)).notes[7].filter(Boolean).length).toBe(1);
  expect((await messages(page)).slice(before).filter(m => m.instrument === 'clap' && m.time === undefined), 'the tap itself sounded once, at once').toHaveLength(1);
  // The loop is sixteen eighth notes: about four and a half seconds at this speed.
  await expect.poll(async () => (await messages(page)).slice(before).filter(m => m.instrument === 'clap' && typeof m.time === 'number').length, { timeout: 12_000, message: 'the loop plays the clap when it comes round' }).toBeGreaterThan(0);
  await expect(kids.locator('.kids-dots .on')).toHaveCount(1);
  await stop.click();
  await expect(kids.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(kids.locator('.kids-dots .now')).toHaveCount(0);

  // It is all still there after a reload.
  await page.reload();
  await expect(kids.getByRole('button', { name: 'Horn', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(kids.getByRole('button', { name: 'Fast. Press to go slower', exact: true })).toBeVisible();
  await expect(kids.locator('.kids-dots .on')).toHaveCount(1);

  expect(elsewhere, 'kids mode asks nothing of the accounts API or any other site').toEqual([]);
  expect(errors).toEqual([]);
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

  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kids Mode', exact: true }).click();
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids).toBeVisible();
  expect(page.url()).toMatch(/#kids$/);
  await expect(kids.locator('.kids-dots .on'), 'a first visit starts with a beat').toHaveCount(8);

  // Everything a child can press, pressed.
  for (const name of ['Bear', 'Dog', 'Cat', 'Rabbit', 'Chick', 'Mouse', 'Drum', 'Clap', 'Sparkle', 'Bell', 'Piano', 'Horn', 'Robot']) await kids.getByRole('button', { name, exact: true }).click();
  await kids.getByRole('button', { name: 'Play', exact: true }).click();
  await kids.getByRole('button', { name: 'Sparkle', exact: true }).click();
  await kids.getByRole('button', { name: 'Start again', exact: true }).click();
  await kids.getByRole('button', { name: /^Slow/ }).click();
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
