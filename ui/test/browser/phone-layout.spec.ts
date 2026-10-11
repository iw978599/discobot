import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    // Everything sent to the synth, so a test can tell which notes are sounding.
    const sent: Array<{ type: string; note?: string }> = [];
    (window as unknown as { audioMessages: typeof sent }).audioMessages = sent;
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: { type: string; note?: string }) => {
          sent.push(message);
          post(message);
        };
      }
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const box = async (locator: Locator) => (await locator.first().boundingBox())!;

// At phone width the specs start with the whole rack on one page (playwright.config.ts). This
// starts as a phone does that has never been here: one unit at a time.
const UNIT_KEY = 'discobot_rack_unit_v1';
const paged = async (page: Page) => {
  await page.evaluate(key => localStorage.removeItem(key), UNIT_KEY);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
};
const bar = (page: Page) => page.getByRole('navigation', { name: 'Rack units', exact: true });
const tab = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });
const ALL = 'Show all units on one page';

// The notes the synth has been told to start and not yet to stop.
const sounding = (page: Page) => page.evaluate(() => {
  const on = new Set<string>();
  for (const message of (window as unknown as { audioMessages: Array<{ type: string; note?: string }> }).audioMessages) {
    if (message.type === 'noteOn' && message.note) on.add(message.note);
    if (message.type === 'noteOff' && message.note) on.delete(message.note);
  }
  return [...on].sort();
});
const started = (page: Page, note: string) => page.evaluate(wanted => (window as unknown as { audioMessages: Array<{ type: string; note?: string }> }).audioMessages.some(message => message.type === 'noteOn' && message.note === wanted), note);

// Fingers on the screen. Each call says where every finger now is: one that is new has landed,
// one that is missing has lifted.
type Finger = { id: number; x: number; y: number };
const fingers = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  let down = false;
  return {
    async touch(...points: Finger[]) {
      if (points.length === 0) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await session.send('Input.dispatchTouchEvent', { type: down ? 'touchMove' : 'touchStart', touchPoints: points });
      down = points.length > 0;
    },
    // One finger moved in a line, a little at a time, as a finger moves.
    async slide(from: Finger, to: { x: number; y: number }, others: Finger[] = []) {
      for (let part = 1; part <= 8; part += 1) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...others, { id: from.id, x: from.x + (to.x - from.x) * part / 8, y: from.y + (to.y - from.y) * part / 8 }] });
      }
    },
  };
};
const at = async (locator: Locator, id = 0, across = 0.5, down = 0.5): Promise<Finger> => {
  const area = await box(locator);
  return { id, x: Math.round(area.x + area.width * across), y: Math.round(area.y + area.height * down) };
};
const centred = (locator: Locator) => locator.first().evaluate(element => element.scrollIntoView({ block: 'center' }));
// Whether one box is wholly inside another, sideways.
const within = (inner: { x: number; width: number }, outer: { x: number; width: number }, left = 0) => inner.x >= outer.x + left - 1 && inner.x + inner.width <= outer.x + outer.width + 1;

const addGuest = async (page: Page, baseURL: string) => {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(`http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest`);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  await expect(page.locator('[data-unit="guests"]')).toHaveAttribute('data-status', 'ready');
};

test('on a phone showing the whole rack it fits the screen, with steps eight to a row and controls a finger can hit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const scroller = page.locator('.rack-page');
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const step = (number: number) => box(lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) }));
  const drum = (number: number) => box(page.getByRole('button', { name: `Kick step ${number}`, exact: true }));

  // Nothing runs off the side, so the page only scrolls up and down.
  expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth), 'no sideways scrolling').toBeLessThanOrEqual(1);
  for (const unit of await page.locator('.rack-unit').all()) {
    const area = (await unit.boundingBox())!;
    expect(area.x, 'a unit starts on screen').toBeGreaterThanOrEqual(0);
    expect(area.x + area.width, 'and ends on it').toBeLessThanOrEqual(view.width + 1);
  }

  // A lane's sixteen steps are two rows of eight, each big enough to press.
  const [first, eighth, ninth, last] = [await step(1), await step(8), await step(9), await step(16)];
  expect(eighth.y).toBeCloseTo(first.y, 0);
  expect(ninth.y, 'step 9 starts the second row').toBeGreaterThan(first.y + first.height - 1);
  expect(ninth.x).toBeCloseTo(first.x, 0);
  expect(last.x).toBeCloseTo(eighth.x, 0);
  expect(first.width).toBeGreaterThanOrEqual(36);
  expect(first.height).toBeGreaterThanOrEqual(40);

  // The drum grid the same, and its mute buttons are not slivers.
  const [kick, kickEighth, kickNinth] = [await drum(1), await drum(8), await drum(9)];
  expect(kickEighth.y).toBeCloseTo(kick.y, 0);
  expect(kickNinth.y).toBeGreaterThan(kick.y + kick.height - 1);
  expect(kickNinth.x).toBeCloseTo(kick.x, 0);
  expect(kick.width).toBeGreaterThanOrEqual(24);
  expect(kick.height).toBeGreaterThanOrEqual(28);
  expect((await box(page.getByRole('button', { name: 'Mute Kick', exact: true }))).height).toBeGreaterThanOrEqual(28);

  // The keyboard shows one octave of its three, so a key is wide enough to play.
  expect(await page.locator('.keyboard').evaluate(element => element.scrollWidth > element.clientWidth * 2)).toBe(true);
  expect((await box(page.locator('.key.white'))).width).toBeGreaterThanOrEqual(44);

  // Play is on screen without scrolling sideways, and stays there when the rack is scrolled.
  const play = page.getByRole('button', { name: /Play All/ });
  for (const scrolled of [false, true]) {
    if (scrolled) await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight));
    const area = await box(play);
    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width).toBeLessThanOrEqual(view.width);
    expect(area.y).toBeGreaterThanOrEqual(0);
    expect(area.y + area.height).toBeLessThan(view.height / 2);
    // Scrolled, the bar is down to its last line: Play at the very top, the menus gone above it.
    if (scrolled) {
      expect(area.y, 'Play is the line that stays').toBeLessThan(30);
      expect((await box(page.getByRole('button', { name: 'Project ▾', exact: true }))).y, 'the menus have scrolled away').toBeLessThan(0);
    }
  }
  await scroller.evaluate(element => element.scrollTo(0, 0));

  // A menu comes up from the bottom, wholly on screen, with rows a finger can hit.
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  const list = await box(page.getByRole('menu', { name: 'Project', exact: true }));
  expect(list.x).toBeGreaterThanOrEqual(0);
  expect(list.x + list.width).toBeLessThanOrEqual(view.width);
  expect(list.y).toBeGreaterThanOrEqual(0);
  expect(list.y + list.height).toBeLessThanOrEqual(view.height);
  expect((await box(page.getByRole('menuitem', { name: 'New Project', exact: true }))).height).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Escape');

  // A dialog is the whole screen.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = await box(page.getByRole('dialog', { name: 'How to use Discobot', exact: true }));
  expect(help.x).toBe(0);
  expect(help.width).toBeCloseTo(view.width, 0);
  expect(help.height).toBeGreaterThanOrEqual(view.height - 1);
  await page.getByRole('button', { name: 'Close help', exact: true }).click();

  // And it still works: a drum hit and a note go on, on the second row.
  await page.getByRole('button', { name: 'Kick step 9', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lane.getByRole('button', { name: /^Select step 9( |$)/ }).click();
  await page.keyboard.press('a');
  await expect(lane.getByRole('button', { name: /^Select step 9 C/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a wide screen keeps the rack as one panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'this is the wide layout');
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const step = (number: number) => box(lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) }));
  expect((await step(16)).y, 'sixteen steps in one row').toBeCloseTo((await step(1)).y, 0);
  expect((await box(page.getByRole('button', { name: 'Kick step 16', exact: true }))).y).toBeCloseTo((await box(page.getByRole('button', { name: 'Kick step 1', exact: true }))).y, 0);
  expect(await page.locator('.rack').evaluate(element => getComputedStyle(element).minWidth)).toBe('1060px');
  await expect(page.getByRole('navigation', { name: 'Rack units', exact: true }), 'no bar of units').toHaveCount(0);
  await expect(page.locator('.rack > [data-unit]:visible'), 'every unit is on the page').toHaveCount(6);
  await page.getByRole('slider', { name: 'Synth 1 level', exact: true }).click();
  await expect(page.getByRole('dialog'), 'a mouse click on a knob opens nothing').toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  expect((await box(page.getByRole('dialog', { name: 'How to use Discobot', exact: true }))).width, 'a dialog is a panel, not the whole screen').toBeLessThanOrEqual(680);
});

test('on a phone one unit is on screen at a time, and a bar along the bottom moves between them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const scroller = page.locator('.rack-page');
  const song = page.getByRole('region', { name: 'Song module', exact: true });
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });
  const effects = page.locator('.effects-unit');
  const onShow = page.locator('.rack > [data-unit]:visible');
  const play = page.getByRole('button', { name: /Play All/ });

  // It opens on the lane that is open for editing, with its editor, and nothing else.
  await expect(tab(page, 'Show Synth 1')).toHaveAttribute('aria-current', 'true');
  await expect(bar(page).locator('[aria-current]')).toHaveCount(1);
  await expect(lane).toBeVisible();
  await expect(lane.locator('.synth-controls-panel')).toBeVisible();
  await expect(onShow).toHaveCount(1);
  for (const hidden of ['song', 'synth-2', 'synth-3', 'drums', 'effects']) await expect(page.locator(`[data-unit="${hidden}"]`), hidden).toBeHidden();

  // The bar is the bottom edge of the screen, and each of its switches is big enough for a thumb.
  const strip = await box(bar(page));
  expect(strip.x).toBeCloseTo(0, 0);
  expect(strip.width).toBeCloseTo(view.width, 0);
  expect(strip.y + strip.height).toBeCloseTo(view.height, 0);
  await expect(bar(page).getByRole('button')).toHaveCount(7);
  for (const button of await bar(page).getByRole('button').all()) {
    const area = (await button.boundingBox())!;
    expect(area.width).toBeGreaterThanOrEqual(44);
    expect(area.height).toBeGreaterThanOrEqual(44);
    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width).toBeLessThanOrEqual(view.width + 1);
  }

  // A tap shows that unit instead, says so, and puts the keyboard inside it.
  await tab(page, 'Show Drums').click();
  await expect(drums).toBeVisible();
  await expect(lane).toBeHidden();
  await expect(tab(page, 'Show Drums')).toHaveAttribute('aria-current', 'true');
  await expect(bar(page).locator('[aria-current]')).toHaveCount(1);
  await expect(drums, 'focus goes to the unit that was asked for').toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[data-unit]')?.getAttribute('data-unit')), 'and the next Tab is inside it').toBe('drums');
  await page.getByRole('button', { name: 'Kick step 9', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 9', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // From the keyboard too. Whichever unit is on show, and however far the last one was scrolled,
  // it starts just under the transport, and Play is still there.
  for (const [name, part] of [['Show Song', song], ['Show Effects', effects], ['Show Synth 1', lane], ['Show Drums', drums]] as const) {
    await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await tab(page, name).focus();
    await page.keyboard.press('Enter');
    await expect(part, name).toBeVisible();
    await expect(part, name).toBeFocused();
    await expect(onShow, name).toHaveCount(1);
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'true');
    const [go, top] = [await box(play), await box(part)];
    expect(go.x, name).toBeGreaterThanOrEqual(0);
    expect(go.x + go.width, name).toBeLessThanOrEqual(view.width);
    expect(go.y, name).toBeGreaterThanOrEqual(0);
    expect(go.y + go.height, name).toBeLessThan(view.height / 2);
    expect(top.y, `${name}: the unit starts under the transport`).toBeGreaterThanOrEqual(go.y + go.height - 1);
    expect(top.y, name).toBeLessThan(view.height * 0.6);
    expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth), `${name}: no sideways scrolling`).toBeLessThanOrEqual(1);
  }

  // The whole rack is one of the choices, and the choice is remembered.
  await tab(page, ALL).click();
  await expect(tab(page, ALL)).toHaveAttribute('aria-current', 'true');
  for (const part of [song, lane, drums, effects]) await expect(part).toBeVisible();
  await page.reload();
  await expect(tab(page, ALL)).toHaveAttribute('aria-current', 'true');
  await expect(drums).toBeVisible();
  await tab(page, 'Show Effects').click();
  await page.reload();
  await expect(effects).toBeVisible();
  await expect(onShow).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a lane that is not on screen keeps playing, and its light is on the right step when it is shown again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const light = page.locator('[data-unit="synth-1"] .step-light.on');
  const drumLight = page.locator('.drum-step-indicator.active');
  const at = async (lit: Locator) => Number(await lit.getAttribute('data-step'));

  // As slow as it goes, so a step lasts three quarters of a second.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('20');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(light).toHaveCount(1);
  await expect(light).toBeVisible();

  // Off screen its playhead goes on, in step with the drums that are now on it.
  await tab(page, 'Show Drums').click();
  await expect(page.locator('[data-unit="synth-1"]')).toBeHidden();
  await expect(drumLight).toBeVisible();
  const first = await at(light);
  await expect.poll(() => at(light), 'the hidden lane moves on').not.toBe(first);
  await expect.poll(async () => await at(light) === await at(drumLight)).toBe(true);

  // Shown again, one step is lit and it is the one being played.
  await tab(page, 'Show Synth 1').click();
  await expect(light).toHaveCount(1);
  await expect(light).toBeVisible();
  await expect(drumLight, 'and now the drums are the hidden ones').toBeHidden();
  await expect.poll(async () => await at(light) === await at(drumLight), 'lit on the step being played').toBe(true);
  const second = await at(light);
  await expect.poll(() => at(light)).not.toBe(second);

  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.step-light.on, .drum-step-indicator.active, .drum-step-btn.current')).toHaveCount(0);
});

test('a guest keeps its page and its sound while another unit is on screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const baseURL = String(testInfo.project.use.baseURL);
  const unit = page.locator('[data-unit="guests"]');
  const frame = unit.locator('iframe');
  const blocks = async () => Number(await unit.getAttribute('data-audio-blocks'));

  await expect(tab(page, 'Show Guests'), 'no switch for guests until there is one').toHaveCount(0);
  await addGuest(page, baseURL);

  // The guest that was just added is the unit on show.
  await expect(tab(page, 'Show Guests')).toHaveAttribute('aria-current', 'true');
  await expect(frame).toBeVisible();
  await frame.evaluate(element => { (element as HTMLIFrameElement & { kept?: boolean }).kept = true; });
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(blocks, { message: 'its sound arrives' }).toBeGreaterThan(10);

  // Another unit on screen. The guest is still laid out at its full size, because a page that is
  // not rendered is not run in full, but nothing of it can be seen, touched, focused or read out.
  await tab(page, 'Show Drums').click();
  await expect(unit).toHaveAttribute('inert', '');
  await expect(unit).toHaveAttribute('aria-hidden', 'true');
  const size = await box(frame);
  expect(size.width, 'the frame keeps its width').toBeGreaterThan(200);
  expect(size.height, 'and its height').toBeGreaterThan(200);
  expect(await unit.evaluate(element => getComputedStyle(element).clipPath), 'clipped to nothing').toBe('inset(50%)');
  expect(await frame.evaluate((element) => { (element as HTMLElement).focus(); return document.activeElement === element; }), 'it cannot take focus').toBe(false);
  expect(await unit.evaluate((element) => {
    const area = element.getBoundingClientRect();
    const points = [[area.left + area.width / 2, area.top + 20], [area.left + area.width / 2, area.top + area.height / 2], [area.left + 20, area.bottom - 20]];
    return points.some(([x, y]) => element.contains(document.elementFromPoint(x, Math.min(window.innerHeight - 1, y))));
  }), 'nor a touch').toBe(false);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true }), 'and it is not in the way of the unit on show').toHaveAttribute('aria-pressed', 'true');
  const heard = await blocks();
  await expect.poll(blocks, { message: 'sound still arrives from the guest' }).toBeGreaterThan(heard + 10);

  // Back again, it is the same frame, not a page loaded afresh.
  await tab(page, 'Show Guests').click();
  await expect(frame).toBeVisible();
  await expect(unit).not.toHaveAttribute('inert', '');
  await expect(unit).not.toHaveAttribute('aria-hidden', 'true');
  expect(await unit.evaluate(element => getComputedStyle(element).clipPath)).toBe('none');
  expect(await frame.evaluate((element) => { (element as HTMLElement).focus(); return document.activeElement === element; }), 'on show, it can be reached again').toBe(true);
  expect(await frame.evaluate(element => (element as HTMLIFrameElement & { kept?: boolean }).kept), 'the frame was never taken out of the page').toBe(true);
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: /Stop All/ }).click();
});

test('on a phone the walkthrough turns to the unit each stop is about', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const view = page.viewportSize()!;
  const tour = page.getByRole('dialog', { name: 'Walkthrough', exact: true });
  const spot = page.locator('.tour-spot');
  // Each stop's title, the first thing it lights up, and the switch that should be lit with it.
  const stops = [
    ['Play and tempo', '.tempo-display-group', 'Show Drums'],
    ['Scenes and song', '.song-module', 'Show Song'],
    ['A lane\'s steps', '.synth-module[aria-label="Synth 1 module"] .step-row', 'Show Synth 1'],
    ['The sound editor', '.synth-controls-panel', 'Show Synth 1'],
    ['The drum grid', '.drum-grid', 'Show Drums'],
    ['Effects', '.effects-unit', 'Show Effects'],
    ['Project and Export', '.transport .rack-menu', 'Show Effects'],
  ] as const;

  await tab(page, 'Show Drums').click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('dialog', { name: 'How to use Discobot', exact: true }).getByRole('button', { name: 'Show the Walkthrough', exact: true }).click();
  for (const [title, target, current] of stops) {
    await expect(tour.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(tab(page, current), title).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(target).first(), `${title}: its part is on the page`).toBeVisible();
    await expect(spot, title).toBeVisible();
    await expect(tour.getByRole('button', { name: 'Next', exact: true }), 'the way on has the keyboard').toBeFocused();
    await expect.poll(async () => Math.abs((await box(spot)).x - (await box(page.locator(target))).x), `${title}: the light is on its part`).toBeLessThan(8);
    const part = await box(page.locator(target));
    expect(part.y, title).toBeGreaterThanOrEqual(0);
    expect(part.y, title).toBeLessThan(view.height);
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(tab(page, 'Show Drums'), 'the unit the tour started from is put back').toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Drums module', exact: true })).toBeVisible();
  await expect(page.locator('.rack > [data-unit]:visible')).toHaveCount(1);
});

test('the lane on show is the lane that is open for editing, after a reload and when it is removed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const third = page.getByRole('region', { name: 'Synth 3 module', exact: true });
  const first = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const open = async (lane: Locator, id: number) => {
    await expect(lane.locator('.synth-controls-panel'), `Synth ${id} has its editor`).toBeVisible();
    await expect(lane.getByRole('button', { name: `Synth ${id}`, exact: true }), 'and its name plate says it is open').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.synth-controls-panel'), 'no other lane has one').toHaveCount(1);
  };

  await tab(page, 'Show Synth 3').click();
  await open(third, 3);

  // A new visit opens on the lane that was left, and that lane is open: the app itself always
  // starts with the first lane open.
  await page.reload();
  await expect(tab(page, 'Show Synth 3')).toHaveAttribute('aria-current', 'true');
  await open(third, 3);
  await third.getByRole('button', { name: /^Select step 1( |$)/ }).click();
  await page.keyboard.press('a');
  await expect(third.getByRole('button', { name: /^Select step 1 C/ }), 'the computer keyboard plays the lane on show').toBeVisible();

  // Removed, the lane that is opened in its place is the one shown, not the empty slot.
  await third.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(tab(page, 'Show Synth 1')).toHaveAttribute('aria-current', 'true');
  await open(first, 1);
  await expect(page.locator('.rack > [data-unit]:visible')).toHaveCount(1);
  await expect(tab(page, 'Show Synth 3, an empty slot')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a guest that arrives by itself does not pull the view to it, even after Add Guest was opened and closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  await addGuest(page, String(testInfo.project.use.baseURL));
  await expect(tab(page, 'Show Guests')).toHaveAttribute('aria-current', 'true');

  // A second project with no guest, where Add Guest is opened and closed again.
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Project: Untitled 2', exact: true })).toBeVisible();
  await expect(tab(page, 'Show Guests')).toHaveCount(0);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Close guest instrument', exact: true }).click();
  await tab(page, 'Show Drums').click();

  // Back in the first project its guest arrives with it. The drums stay on show.
  await page.getByRole('button', { name: /^Project: / }).click();
  await page.getByRole('dialog', { name: 'Projects', exact: true }).getByRole('group', { name: 'Project Untitled', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('[data-unit="guests"]')).toHaveCount(1);
  await expect(tab(page, 'Show Guests')).toBeVisible();
  await expect(tab(page, 'Show Drums')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Drums module', exact: true })).toBeVisible();
});

test('on the narrowest phones every switch of the bar fits, with three lanes and a guest', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await page.setViewportSize({ width: 360, height: 740 });
  await paged(page);
  await addGuest(page, String(testInfo.project.use.baseURL));
  const switches = bar(page).getByRole('button');
  await expect(switches).toHaveCount(8);
  expect(await bar(page).evaluate(element => element.scrollWidth - element.clientWidth), 'the bar does not have to be slid').toBeLessThanOrEqual(1);
  for (const button of await switches.all()) {
    const name = await button.getAttribute('aria-label');
    const area = (await button.boundingBox())!;
    expect(area.x, name!).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width, name!).toBeLessThanOrEqual(361);
    expect(area.width, name!).toBeGreaterThanOrEqual(44);
    expect(area.height, name!).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(element => element.querySelector('.unit-tab-name')!.getBoundingClientRect().width <= element.getBoundingClientRect().width), `${name}: its legend fits inside it`).toBe(true);
  }
  for (const name of ['Show Song', 'Show Synth 3', 'Show Guests', 'Show Drums', 'Show Effects', ALL]) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'true');
  }
});

test('on a phone a knob is set by touch: a tap opens a large slider, and a drag still turns it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const knob = page.locator('[data-unit="synth-1"]').getByRole('slider', { name: 'Synth 1 level', exact: true });
  const figure = page.getByLabel('Synth 1 level value', { exact: true });
  const percent = async () => Number.parseInt(await figure.inputValue(), 10);
  const sheet = page.getByRole('dialog', { name: 'Synth 1 level', exact: true });
  const slider = sheet.getByRole('slider', { name: 'Synth 1 level', exact: true });
  const button = (name: string) => sheet.getByRole('button', { name: `${name} Synth 1 level`, exact: true });

  // The knob itself is as big as a fingertip. A tap on it turns nothing and opens the sheet.
  const dial = await box(knob);
  expect(dial.width).toBeGreaterThanOrEqual(44);
  expect(dial.height).toBeGreaterThanOrEqual(44);
  const before = await percent();
  await knob.tap();
  await expect(sheet).toBeVisible();
  await expect(slider, 'the slider has the keyboard').toBeFocused();
  expect(await percent(), 'a tap turns nothing').toBe(before);
  await expect(sheet.locator('.knob-sheet-value')).toHaveText(`${before}%`);

  // The sheet is along the bottom, on screen, and everything in it is big enough to touch.
  const [panel, track] = [await box(sheet), await box(slider)];
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(view.width);
  expect(panel.y, 'in the lower half').toBeGreaterThan(view.height / 2);
  expect(panel.y + panel.height).toBeLessThanOrEqual(view.height);
  expect(track.width).toBeGreaterThanOrEqual(200);
  expect(track.height).toBeGreaterThanOrEqual(44);
  for (const name of ['Lower', 'Raise', 'Close']) {
    const area = await box(button(name));
    expect(area.width, name).toBeGreaterThanOrEqual(44);
    expect(area.height, name).toBeGreaterThanOrEqual(44);
  }

  // A touch along the slider sets the value, and the lane's own figure follows.
  await page.touchscreen.tap(track.x + track.width * 0.9, track.y + track.height / 2);
  await expect.poll(percent, 'near the top of its range').toBeGreaterThan(150);
  await page.touchscreen.tap(track.x + track.width * 0.1, track.y + track.height / 2);
  await expect.poll(percent, 'near the bottom').toBeLessThan(50);

  // It is a slider to the keyboard and to a screen reader: keys step it, and it says its value in words.
  await slider.press('Home');
  await expect.poll(percent).toBe(0);
  await slider.press('ArrowRight');
  await expect.poll(percent).toBe(1);
  await expect(slider).toHaveAttribute('aria-valuetext', '1%');
  await button('Raise').tap();
  await expect.poll(percent).toBe(2);
  await button('Lower').tap();
  await expect.poll(percent).toBe(1);
  await expect(sheet.locator('.knob-sheet-value')).toHaveText('1%');
  await expect.poll(() => page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    const project = JSON.parse(localStorage.getItem('discobot_browser_project_v1')!);
    return project.synths.find((lane: { synthId: number }) => lane.synthId === 1).synthParams.gain;
  }), 'and it is saved like any turn of the knob').toBeCloseTo(0.01, 5);

  // Closed, the knob has the keyboard again and shows what was set.
  await button('Close').tap();
  await expect(sheet).toHaveCount(0);
  await expect(knob).toBeFocused();
  await expect(knob).toHaveAttribute('aria-valuetext', '1%');

  // A finger dragged up the knob turns it as a mouse does, and opens nothing.
  const at = await box(knob), x = at.x + at.width / 2, y = at.y + at.height / 2;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const rise of [10, 30, 60]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - rise }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(percent, 'fifty pixels past the first few is a third of the range').toBeGreaterThan(50);
  await expect(sheet).toHaveCount(0);

  // A finger held still on the knob and then lifted is not a tap: it was stopping the page, or
  // pressing for a menu. It turns nothing and opens nothing.
  const held = await percent();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  await expect(sheet).toHaveCount(0);
  expect(await percent()).toBe(held);

  // A drum knob the same, with the hint a mouse would get by hovering. Escape closes it.
  await tab(page, 'Show Drums').click();
  const swing = page.locator('[data-unit="drums"]').getByRole('slider', { name: 'Swing', exact: true });
  const swingSheet = page.getByRole('dialog', { name: 'Swing', exact: true });
  await swing.tap();
  await expect(swingSheet).toContainText('delays off-beat steps');
  await swingSheet.getByRole('slider', { name: 'Swing', exact: true }).press('End');
  await expect(page.getByLabel('Swing value', { exact: true })).toHaveValue('75%');
  await page.keyboard.press('Escape');
  await expect(swingSheet).toHaveCount(0);
  await expect(swing).toBeFocused();
  expect(errors).toEqual([]);
});

test('on a phone the keyboard is played with fingers: wide keys, several at once, a slide across them, and nothing left sounding', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const scroller = page.locator('.rack-page');
  const lane = page.locator('[data-unit="synth-1"]');
  const strip = lane.locator('.keyboard');
  const key = (note: string) => lane.getByRole('button', { name: `Play ${note}`, exact: true });
  const range = lane.locator('.keyboard-range');
  const pressed = () => lane.locator('.key[aria-pressed="true"]').evaluateAll(keys => keys.map(element => element.getAttribute('data-note')).sort());

  // One octave of the three is across the screen, the middle one, and every key of it is big
  // enough for a finger.
  await centred(strip);
  await expect(range).toHaveText('C4 - B4');
  const keys = await box(strip);
  for (const note of ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']) {
    const area = await box(key(note));
    expect(area.width, note).toBeGreaterThanOrEqual(44);
    expect(area.height, note).toBeGreaterThanOrEqual(100);
    expect(within(area, { x: 0, width: view.width }), `${note} is on screen`).toBe(true);
  }
  for (const note of ['C#4', 'D#4', 'F#4', 'G#4', 'A#4']) {
    const area = await box(key(note));
    expect(area.width, note).toBeGreaterThanOrEqual(30);
    expect(area.height, note).toBeGreaterThanOrEqual(60);
  }
  expect(keys.y, 'the keys are clear of the transport').toBeGreaterThan((await box(page.getByRole('button', { name: /Play All/ }))).y + 30);
  expect(keys.y + keys.height, 'and of the bar of units').toBeLessThanOrEqual((await box(bar(page))).y);

  // Hold and the octave buttons are in the same unit, and big enough to hit.
  await expect(lane.getByLabel('Hold notes', { exact: true })).toBeAttached();
  for (const name of ['Oct -', 'Oct +']) expect((await box(lane.getByRole('button', { name, exact: true }))).height, name).toBeGreaterThanOrEqual(32);

  // Two fingers hold two keys, and both sound. The page does not move under them.
  const still = await scroller.evaluate(element => element.scrollTop);
  const hand = await fingers(page);
  const [first, second] = [await at(key('C4'), 0, 0.5, 0.85), await at(key('E4'), 1, 0.5, 0.85)];
  await hand.touch(first);
  await expect(key('C4')).toHaveAttribute('aria-pressed', 'true');
  await hand.touch(first, second);
  await expect(key('E4')).toHaveAttribute('aria-pressed', 'true');
  await expect(key('C4'), 'the second finger does not let the first key go').toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sounding(page), 'both notes sound').toEqual(['C4', 'E4']);

  // Lifting one stops only that one.
  await hand.touch(second);
  await expect(key('C4')).toHaveAttribute('aria-pressed', 'false');
  await expect(key('E4')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sounding(page)).toEqual(['E4']);

  // The finger that is left slides along the keys and plays each one it comes to.
  const far = await at(key('G4'), 1, 0.5, 0.85);
  await hand.slide(second, far);
  await expect.poll(pressed).toEqual(['G4']);
  await expect.poll(() => sounding(page)).toEqual(['G4']);
  expect(await started(page, 'F4'), 'the key in between was played on the way').toBe(true);

  // Slid off the top of the keyboard, it is holding nothing.
  await hand.slide(far, { x: far.x, y: keys.y - 30 });
  await expect.poll(pressed).toEqual([]);
  await expect.poll(() => sounding(page)).toEqual([]);
  await hand.touch();
  expect(await scroller.evaluate(element => element.scrollTop), 'the page did not scroll under the fingers').toBe(still);

  // A key is held while another unit is brought on with the bar. The keys are hidden, not
  // taken away, and no finger lifts, but the note must stop.
  const stuck = await at(key('A4'), 0, 0.5, 0.85);
  await hand.touch(stuck);
  await expect.poll(() => sounding(page)).toEqual(['A4']);
  await tab(page, 'Show Drums').focus();
  await expect(key('A4'), 'the bar taking the keyboard focus lets nothing go').toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(lane).toBeHidden();
  await expect.poll(() => sounding(page), 'no note is left sounding behind the drums').toEqual([]);
  await hand.touch();
  await tab(page, 'Show Synth 1').click();
  await expect(lane.locator('.key.active')).toHaveCount(0);

  // The other octaves are a button away, and the keys come back where they were left.
  await expect(range).toHaveText('C4 - B4');
  await lane.getByRole('button', { name: 'Higher keys', exact: true }).tap();
  await expect(range).toHaveText('C5 - B5');
  await expect(lane.getByRole('button', { name: 'Higher keys', exact: true })).toBeDisabled();
  expect(within(await box(key('C5')), { x: 0, width: view.width })).toBe(true);
  await lane.getByRole('button', { name: 'Lower keys', exact: true }).tap();
  await lane.getByRole('button', { name: 'Lower keys', exact: true }).tap();
  await expect(range).toHaveText('C3 - B3');
  await expect(lane.getByRole('button', { name: 'Lower keys', exact: true })).toBeDisabled();
  expect(within(await box(key('C3')), { x: 0, width: view.width })).toBe(true);

  // A key is held as the phone is turned on its side. It is no longer under the finger.
  await centred(strip);
  await hand.touch(await at(key('D3'), 0, 0.5, 0.85));
  await expect.poll(() => sounding(page)).toEqual(['D3']);
  await page.setViewportSize({ width: 740, height: 360 });
  await expect.poll(() => sounding(page), 'turning the phone leaves nothing sounding').toEqual([]);
  await expect(lane.locator('.key.active')).toHaveCount(0);
  await hand.touch().catch(() => {});
  expect(errors).toEqual([]);
});

test('on a phone the piano roll is edited with a finger: a tap, a drag, a held note and a note made longer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const scroller = page.locator('.rack-page');
  const lane = page.locator('[data-unit="synth-1"]');
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const grid = lane.locator('.piano-roll-grid');
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  const head = (step: number) => grid.locator(`.piano-roll-step-header[data-step="${step - 1}"]`);
  const on = (note: string, step: number, pressed: boolean) => expect(cell(note, step), `${note} step ${step}`).toHaveAttribute('aria-pressed', String(pressed));
  const steps = async () => (await lane.locator('.piano-roll-window').innerText()).split('–').map(Number);
  const places = () => Promise.all([scroller.evaluate(element => element.scrollTop), grid.evaluate(element => element.scrollTop), grid.evaluate(element => element.scrollLeft)]);
  const label = 46;

  // Part of the bar is across the screen, starting at its first step and its lowest notes, in
  // squares big enough for a finger. The grid is clear of the transport and the bar of units.
  await centred(grid);
  const frame = await box(grid);
  const [from, to] = await steps();
  expect(from).toBe(1);
  expect(to, 'at least a beat of steps').toBeGreaterThanOrEqual(4);
  expect(to, 'and not the whole bar squeezed in').toBeLessThan(16);
  for (const [note, step] of [['C3', 1], ['C3', to], ['G3', 2]] as const) {
    const area = await box(cell(note, step));
    expect(area.width, `${note} step ${step}`).toBeGreaterThanOrEqual(44);
    expect(area.height, `${note} step ${step}`).toBeGreaterThanOrEqual(44);
    expect(within(area, frame, label), `${note} step ${step} is on show`).toBe(true);
    expect(area.y + area.height, `${note} is on show`).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
  expect(within(await box(head(to + 1)), frame, label), 'the next step is off the edge').toBe(false);
  expect(frame.y).toBeGreaterThan((await box(page.getByRole('button', { name: /Play All/ }))).y + 30);
  expect(frame.y + frame.height).toBeLessThanOrEqual((await box(bar(page))).y);
  for (const name of ['Earlier steps', 'Later steps']) {
    const area = await box(lane.getByRole('button', { name, exact: true }));
    expect(area.width, name).toBeGreaterThanOrEqual(44);
    expect(area.height, name).toBeGreaterThanOrEqual(44);
  }
  const still = await places();
  const hand = await fingers(page);

  // A tap puts a note on, and the step row above shows it.
  await cell('C3', 1).tap();
  await on('C3', 1, true);
  await expect(lane.getByRole('button', { name: 'Select step 1 C3', exact: true })).toBeVisible();

  // Its end is a handle a finger can take. Dragged along, the note lasts longer and nothing
  // else is painted or rubbed out.
  const handle = cell('C3', 1).locator('.piano-roll-resize');
  const grip = await box(handle);
  expect(grip.width).toBeGreaterThanOrEqual(20);
  expect(grip.height).toBeGreaterThanOrEqual(44);
  const end = await at(handle);
  await hand.touch(end);
  await hand.slide(end, await at(cell('C3', 3)));
  await hand.touch();
  await expect(lane.getByLabel('Step 1 note length', { exact: true })).toHaveValue('3');
  await expect(cell('C3', 3)).toHaveClass(/held/);
  await expect(cell('C3', 3).locator('.piano-roll-resize'), 'the handle is at the new end').toBeVisible();
  await on('C3', 1, true);
  await on('C3', 2, false);

  // A finger dragged along a row paints a note on each step it crosses.
  const start = await at(cell('G3', 2));
  await hand.touch(start);
  await hand.slide(start, await at(cell('G3', 4)));
  await hand.touch();
  for (const step of [2, 3, 4]) await on('G3', step, true);

  // A finger held still on a note keeps it, and selects its step for the controls underneath.
  await hand.touch(await at(cell('G3', 2)));
  await page.waitForTimeout(800);
  await hand.touch();
  await page.waitForTimeout(300);
  await on('G3', 2, true);
  await expect(lane.getByRole('button', { name: 'Select step 2 G3', exact: true }), 'its step is selected').toHaveAttribute('aria-pressed', 'true');
  await expect(lane.getByLabel('Step 2 chance', { exact: true }), 'and the step controls are for it').toBeVisible();

  // A tap on a note takes it out. A drag that begins on a note rubs out along the row.
  await cell('G3', 2).tap();
  await on('G3', 2, false);
  const rub = await at(cell('G3', 3));
  await hand.touch(rub);
  await hand.slide(rub, await at(cell('G3', 4)));
  await hand.touch();
  for (const step of [3, 4]) await on('G3', step, false);
  await on('C3', 1, true);
  expect(await places(), 'neither the page nor the grid moved under the finger').toEqual(still);

  // The rest of the bar is reached with the two buttons, a beat at a time.
  await lane.getByRole('button', { name: 'Later steps', exact: true }).tap();
  expect(await steps()).toEqual([5, to + 4 > 16 ? 16 : to + 4]);
  expect(within(await box(head(5)), frame, label)).toBe(true);
  expect(within(await box(head(1)), frame, label), 'the first steps have gone off the edge').toBe(false);
  for (let press = 0; press < 4 && await lane.getByRole('button', { name: 'Later steps', exact: true }).isEnabled(); press += 1) await lane.getByRole('button', { name: 'Later steps', exact: true }).tap();
  await expect(lane.getByRole('button', { name: 'Later steps', exact: true })).toBeDisabled();
  expect((await steps())[1]).toBe(16);
  await cell('C3', 16).tap();
  await on('C3', 16, true);
  await lane.getByRole('button', { name: 'Earlier steps', exact: true }).tap();
  expect((await steps())[0] % 4, 'back on a beat').toBe(1);

  // A step picked in the row above is brought on show.
  await lane.getByRole('button', { name: /^Select step 2( |$)/ }).click();
  await expect.poll(async () => (await steps())[0]).toBe(1);
  await centred(grid);
  const moved = await box(grid);
  expect(within(await box(head(2)), moved, label)).toBe(true);

  // The higher notes are above, reached by sliding the note names; the squares never slide.
  const names = await box(grid.locator('.piano-roll-note-label').last());
  const low = await grid.evaluate(element => element.scrollTop);
  expect(low, 'there are notes above').toBeGreaterThan(100);
  const name: Finger = { id: 0, x: Math.round(names.x + names.width / 2), y: Math.round(moved.y + moved.height / 2) };
  await hand.touch(name);
  await hand.slide(name, { x: name.x, y: name.y + 150 });
  await hand.touch();
  await expect.poll(() => grid.evaluate(element => element.scrollTop), 'the grid went up to higher notes').toBeLessThan(low - 50);
  expect(await grid.evaluate(element => element.scrollLeft), 'and not sideways').toBe(still[2]);

  // While it plays, the light is on the playing step, on whichever part of the bar holds it.
  await page.locator('.rack-page').evaluate(element => element.scrollTo(0, 0));
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('20');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: /Play All/ }).click();
  const lit = grid.locator('.piano-roll-step-header.playing');
  await expect(lit).toHaveCount(1);
  await centred(grid);
  await expect.poll(async () => {
    const playing = Number(await lit.getAttribute('data-step')) + 1;
    const [low, high] = await steps();
    if (playing < low) await lane.getByRole('button', { name: 'Earlier steps', exact: true }).tap();
    else if (playing > high) await lane.getByRole('button', { name: 'Later steps', exact: true }).tap();
    else return within(await box(lit), await box(grid), label) && Number(await lit.getAttribute('data-step')) + 1 === playing;
    return false;
  }, { message: 'the lit step is on show once the grid is turned to it', timeout: 20_000 }).toBe(true);
  await expect(grid.locator('.piano-roll-cell.playing'), 'the whole column is lit').toHaveCount(36);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(grid.locator('.playing')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a phone on its side has the phone arrangement, with the width used and the height left for the instrument', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  await page.setViewportSize({ width: 740, height: 360 });
  await paged(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const scroller = page.locator('.rack-page');
  const lane = page.locator('[data-unit="synth-1"]');
  const play = page.getByRole('button', { name: /Play All/ });
  const step = (number: number) => box(lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) }));
  const key = (note: string) => lane.getByRole('button', { name: `Play ${note}`, exact: true });

  // One unit at a time, the bar along the bottom, nothing off the side.
  await expect(tab(page, 'Show Synth 1')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.rack > [data-unit]:visible')).toHaveCount(1);
  expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth), 'no sideways scrolling').toBeLessThanOrEqual(1);
  const strip = await box(bar(page));
  expect(strip.y + strip.height).toBeCloseTo(view.height, 0);
  expect(strip.height, 'the bar is lower than on an upright phone').toBeLessThanOrEqual(48);
  for (const button of await bar(page).getByRole('button').all()) {
    const area = (await button.boundingBox())!;
    expect(area.width).toBeGreaterThanOrEqual(44);
    expect(area.height).toBeGreaterThanOrEqual(44);
  }

  // A bar of steps is one row here, and each is still big enough to press.
  const [first, last] = [await step(1), await step(16)];
  expect(last.y, 'sixteen steps in one row').toBeCloseTo(first.y, 0);
  expect(first.width).toBeGreaterThanOrEqual(36);
  expect(first.height).toBeGreaterThanOrEqual(40);

  // Two octaves of keys across. With the keyboard brought up the screen, the line of the
  // transport that stays and the bar of units leave all of it on show.
  const keys = lane.locator('.keyboard');
  await centred(keys);
  await expect(lane.locator('.keyboard-range')).toHaveText('C4 - B5');
  const [top, bottom, board] = [await box(play), await box(bar(page)), await box(keys)];
  expect(top.y).toBeGreaterThanOrEqual(0);
  expect(bottom.y - (top.y + top.height), 'most of the height is left between them').toBeGreaterThanOrEqual(220);
  expect(board.y, 'the keys start under the transport').toBeGreaterThanOrEqual(top.y + top.height);
  expect(board.y + board.height, 'and end above the bar').toBeLessThanOrEqual(bottom.y);
  for (const note of ['C4', 'B4', 'C5', 'B5']) {
    const area = await box(key(note));
    expect(area.width, note).toBeGreaterThanOrEqual(44);
    expect(area.height, note).toBeGreaterThanOrEqual(100);
    expect(within(area, { x: 0, width: view.width }), `${note} is on screen`).toBe(true);
  }
  await key('C5').tap();
  await expect.poll(() => started(page, 'C5'), 'a tapped key plays').toBe(true);
  await expect(lane.locator('.key.active')).toHaveCount(0);

  // The piano roll shows more of the bar than it does upright, in squares as big, and fits
  // between the transport and the bar with several rows of notes on show.
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const grid = lane.locator('.piano-roll-grid');
  await centred(grid);
  const frame = await box(grid);
  const across = Number((await lane.locator('.piano-roll-window').innerText()).split('–')[1]);
  expect(across).toBeGreaterThanOrEqual(8);
  const square = await box(lane.getByRole('button', { name: `C3 step ${across}`, exact: true }));
  expect(square.width).toBeGreaterThanOrEqual(44);
  expect(square.height).toBeGreaterThanOrEqual(44);
  expect(within(square, frame, 46)).toBe(true);
  expect(frame.y).toBeGreaterThanOrEqual((await box(play)).y + (await box(play)).height);
  expect(frame.y + frame.height).toBeLessThanOrEqual((await box(bar(page))).y);
  expect(frame.height, 'three rows of notes or more under the step numbers').toBeGreaterThanOrEqual(28 + 3 * 45);
  await lane.getByRole('button', { name: 'C3 step 2', exact: true }).tap();
  await expect(lane.getByRole('button', { name: 'C3 step 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('each grid of steps is one stop for the Tab key, and the arrow keys move inside it', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile-chromium';
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const step = (number: number) => lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) });
  const drum = (name: string, number: number) => page.getByRole('button', { name: `${name} step ${number}`, exact: true });
  const stops = (selector: string) => page.locator(selector).evaluateAll(cells => cells.filter(cell => (cell as HTMLElement).tabIndex === 0).length);
  const row = '[data-unit="synth-1"] .step-cell', beat = '.drum-step-btn', roll = '.piano-roll-cell';

  // A lane's row of steps. With nothing selected the arrows move the keyboard along it, and the
  // one stop goes with it; Tab leaves the row in one press.
  expect(await stops(row)).toBe(1);
  await expect(step(1)).toHaveAttribute('tabindex', '0');
  await step(1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(step(2)).toBeFocused();
  await expect(step(2)).toHaveAttribute('tabindex', '0');
  await expect(lane.locator('.step-cell.selected'), 'moving the keyboard selects nothing').toHaveCount(0);
  await page.keyboard.press('End');
  await expect(step(16)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(step(1)).toBeFocused();
  expect(await stops(row)).toBe(1);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('step-cell')), 'Tab goes on past the row').toBe(false);

  // Enter selects the step, and from then on the arrows walk the selection, as they always have.
  await step(3).focus();
  await page.keyboard.press('Enter');
  await expect(step(3)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(step(4)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(4)).toBeFocused();
  await expect(step(4)).toHaveAttribute('tabindex', '0');
  expect(await stops(row)).toBe(1);

  // The drum grid is one stop for all its lanes. Down goes to the line below: the lane's
  // second line of eight on a phone, the next lane on a wide screen.
  expect(await stops(beat)).toBe(1);
  await expect(drum('Kick', 1)).toHaveAttribute('tabindex', '0');
  await drum('Kick', 1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(drum('Kick', 2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  if (phone) {
    await expect(drum('Kick', 10)).toBeFocused();
    await page.keyboard.press('ArrowDown');
  }
  await expect(drum('Snare', 2)).toBeFocused();
  await expect(drum('Snare', 2)).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowUp');
  await expect(drum('Kick', phone ? 10 : 2)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(drum('Kick', phone ? 10 : 2), 'and the step under the keyboard is switched as before').toHaveAttribute('aria-pressed', 'true');
  expect(await stops(beat)).toBe(1);

  // The piano roll the same: one stop, on the lowest note of the selected step until it is moved.
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, number: number) => lane.getByRole('button', { name: `${note} step ${number}`, exact: true });
  expect(await stops(roll)).toBe(1);
  await expect(cell('C3', 4)).toHaveAttribute('tabindex', '0');
  await cell('C3', 1).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expect(cell('C#3', 2)).toBeFocused();
  await expect(cell('C#3', 2)).toHaveAttribute('tabindex', '0');
  await expect(cell('C#3', 2)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(cell('C#3', 2)).toHaveAttribute('aria-pressed', 'true');
  expect(await stops(roll)).toBe(1);
});
