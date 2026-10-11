import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
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

  // The keyboard is wider than the screen and slides, so a key is wide enough to play.
  expect(await page.locator('.keyboard-container').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect((await box(page.locator('.key.white'))).width).toBeGreaterThanOrEqual(24);

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
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(`http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest`);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();

  // The guest that was just added is the unit on show.
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(tab(page, 'Show Guests')).toHaveAttribute('aria-current', 'true');
  await expect(frame).toBeVisible();
  await frame.evaluate(element => { (element as HTMLIFrameElement & { kept?: boolean }).kept = true; });
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(blocks, { message: 'its sound arrives' }).toBeGreaterThan(10);

  // Another unit on screen: the guest is out of sight and its sound goes on arriving.
  await tab(page, 'Show Drums').click();
  await expect(unit).toBeHidden();
  const heard = await blocks();
  await expect.poll(blocks, { message: 'sound still arrives from the hidden guest' }).toBeGreaterThan(heard + 10);

  // Back again, it is the same frame, not a page loaded afresh.
  await tab(page, 'Show Guests').click();
  await expect(frame).toBeVisible();
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
  await expect(page.locator('.effects-unit'), 'the rack is left on the unit the tour ended at').toBeVisible();
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
  await expect.poll(percent, 'sixty pixels is two fifths of the range').toBeGreaterThan(50);
  await expect(sheet).toHaveCount(0);

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
