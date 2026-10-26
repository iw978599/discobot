import { expect, test, type Locator, type Page } from '@playwright/test';

// The mixer shows levels the project already has. Every check here is that a control on it and
// the control it mirrors are one setting: the same figure, the same saved value, the same undo.

const PROJECT_KEY = 'discobot_browser_project_v1';
const UNIT_KEY = 'discobot_rack_unit_v1';
const DRUMS = ['Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Low Tom', 'High Tom', 'Cymbal'];

const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const lane = async (page: Page, id: number) => (await stored(page)).synths.find((entry: { synthId: number }) => entry.synthId === id);
const mixer = (page: Page) => page.getByRole('region', { name: 'Mixer module', exact: true });
const figure = (page: Page, name: string) => page.getByLabel(`${name} value`, { exact: true });
const fader = (page: Page, name: string) => mixer(page).getByRole('slider', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const set = async (page: Page, name: string, text: string) => {
  await figure(page, name).fill(text);
  await figure(page, name).press('Enter');
};
const box = async (locator: Locator) => (await locator.first().boundingBox())!;

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await button(page, 'More controls').click();
};

const ready = async (page: Page) => {
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await ready(page);
});

test('the mixer has a strip for every lane, every drum and every guest, and a removed lane loses its', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const strip = (name: string) => mixer(page).getByRole('group', { name: `Mixer ${name}`, exact: true });

  // It stands between the drums and the effects.
  expect(await page.locator('.rack [data-unit]').evaluateAll(units => units.map(unit => unit.getAttribute('data-unit')).slice(-3))).toEqual(['drums', 'mixer', 'effects']);

  for (const id of [1, 2, 3]) {
    await expect(strip(`Synth ${id}`)).toHaveCount(1);
    for (const part of ['level', 'pan']) await expect(fader(page, `Mixer Synth ${id} ${part}`)).toHaveCount(1);
    for (const part of ['mute', 'solo']) await expect(mixer(page).getByRole('button', { name: `Mixer Synth ${id} ${part}`, exact: true })).toHaveCount(1);
    // A lane's strip says its model, as the lane's own plate does.
    const model = (await page.locator(`[data-unit="synth-${id}"] .rack-plate span`).first().textContent())!;
    expect(model.length).toBeGreaterThan(0);
    await expect(strip(`Synth ${id}`)).toContainText(model);
  }
  for (const name of DRUMS) {
    await expect(strip(name)).toHaveCount(1);
    for (const part of ['volume', 'pan']) await expect(fader(page, `Mixer ${name} ${part}`)).toHaveCount(1);
    for (const part of ['mute', 'solo']) await expect(mixer(page).getByRole('button', { name: `Mixer ${name} ${part}`, exact: true })).toHaveCount(1);
  }
  // The drums are in the grid's order, each with its own colour, which no two share.
  const drums = mixer(page).locator('.mixer-strip[data-drum]');
  expect(await drums.evaluateAll(found => found.map(element => element.getAttribute('data-drum')))).toEqual(['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash']);
  expect(new Set(await drums.evaluateAll(found => found.map(element => getComputedStyle(element).borderTopColor))).size).toBe(8);
  for (const name of ['Mixer Drums master volume', 'Mixer Synth return', 'Mixer Drum return', 'Mixer Aux A return', 'Mixer Aux B return', 'Mixer main volume']) await expect(fader(page, name), name).toHaveCount(1);
  await expect(mixer(page).getByRole('group', { name: 'Mixer Guests', exact: true }), 'no guests, no strips for them').toHaveCount(0);

  // A lane that is removed has no strip.
  await button(page, 'Synth 3').click();
  await page.locator('[data-unit="synth-3"]').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(strip('Synth 3')).toHaveCount(0);
  await expect(strip('Synth 2')).toHaveCount(1);
  await expect(mixer(page).getByRole('group', { name: 'Mixer Synths', exact: true }).locator('.mixer-strip')).toHaveCount(2);

  // A guest gets one, with a level and a mute, and they are the guest unit's own.
  await more(page);
  await button(page, 'Project ▾').click();
  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(`http://127.0.0.1:${Number(new URL(String(testInfo.project.use.baseURL)).port) + 1000}/__guest`);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const guest = page.getByRole('region', { name: /^Guest instrument / });
  await expect(guest).toBeVisible();
  const guests = mixer(page).getByRole('group', { name: 'Mixer Guests', exact: true });
  await expect(guests.locator('.mixer-strip')).toHaveCount(1);
  await expect(guests, 'a guest\'s level is the scene\'s, and the mixer says so').toContainText('Kept with each scene');
  await expect(guests.getByRole('slider', { name: /^Mixer guest .+ pan$/ }), 'a guest has no pan').toHaveCount(0);
  await expect(guests.getByRole('button', { name: /^Mixer guest .+ solo$/ }), 'or solo').toHaveCount(0);
  const guestLevel = guests.getByLabel(/^Mixer guest .+ level value$/);
  await guestLevel.fill('40%');
  await guestLevel.press('Enter');
  await expect(guest.getByLabel(/^Guest .+ level value$/)).toHaveValue('40%');
  await expect.poll(async () => (await stored(page)).guests?.[0]?.volume).toBeCloseTo(0.4, 5);
  await guests.getByRole('button', { name: /^Mixer guest .+ mute$/ }).click();
  await expect(guest.getByRole('button', { name: /^Mute guest / })).toHaveAttribute('aria-pressed', 'true');
  await guest.getByRole('button', { name: /^Mute guest / }).click();
  await expect(guests.getByRole('button', { name: /^Mixer guest .+ mute$/ })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('a control on the mixer and the knob it mirrors show the same value, and changing either changes the other', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // A lane's level.
  await set(page, 'Mixer Synth 1 level', '35%');
  await expect(figure(page, 'Synth 1 level')).toHaveValue('35%');
  await expect.poll(async () => (await lane(page, 1)).synthParams.gain).toBeCloseTo(0.35, 5);
  await set(page, 'Synth 1 level', '120%');
  await expect(figure(page, 'Mixer Synth 1 level')).toHaveValue('120%');
  await expect(fader(page, 'Mixer Synth 1 level')).toHaveAttribute('aria-valuenow', '1.2');
  await expect(fader(page, 'Mixer Synth 1 level')).toHaveAttribute('aria-valuetext', '120%');
  await expect(figure(page, 'Mixer Synth 2 level'), 'another lane is left alone').not.toHaveValue('120%');

  // A drum's volume. The drum's own knob is in the strip under the grid, for the drum that is selected.
  await button(page, 'Select Kick').click();
  await set(page, 'Mixer Kick volume', '30%');
  await expect(figure(page, 'Kick volume')).toHaveValue('30%');
  await expect.poll(async () => (await stored(page)).drumState.kick.settings.volume).toBeCloseTo(0.3, 5);
  await set(page, 'Kick volume', '64%');
  await expect(figure(page, 'Mixer Kick volume')).toHaveValue('64%');

  // Mute and solo, which are saved as the lane's and the drum's own.
  await button(page, 'Mixer Kick mute').click();
  await expect(button(page, 'Mixer Kick mute')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Mute Kick')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stored(page)).drumState.kick.muted).toBe(true);
  await button(page, 'Mute Kick').click();
  await expect(button(page, 'Mixer Kick mute')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await stored(page)).drumState.kick.muted).toBe(false);
  await button(page, 'Mixer Snare solo').click();
  await expect(button(page, 'Solo Snare')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stored(page)).drumState.snare.solo).toBe(true);
  await button(page, 'Solo Snare').click();
  await expect(button(page, 'Mixer Snare solo')).toHaveAttribute('aria-pressed', 'false');
  await button(page, 'Mixer Synth 2 mute').click();
  await expect(button(page, 'Mute Synth 2')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await lane(page, 2)).muted).toBe(true);
  await button(page, 'Mute Synth 2').click();
  await expect(button(page, 'Mixer Synth 2 mute')).toHaveAttribute('aria-pressed', 'false');
  await button(page, 'Mixer Synth 3 solo').click();
  await expect(button(page, 'Solo Synth 3')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await lane(page, 3)).solo).toBe(true);
  await button(page, 'Solo Synth 3').click();
  await expect(button(page, 'Mixer Synth 3 solo')).toHaveAttribute('aria-pressed', 'false');

  // The drums as a whole.
  await set(page, 'Mixer Drums master volume', '55%');
  await expect(figure(page, 'Master')).toHaveValue('55%');
  await expect.poll(async () => (await stored(page)).drumMasterVolume).toBeCloseTo(0.55, 5);
  await set(page, 'Master', '90%');
  await expect(figure(page, 'Mixer Drums master volume')).toHaveValue('90%');

  // The two effect returns, each without disturbing the other.
  const drumReturn = (await stored(page)).effectsLoop.returns.drums;
  await set(page, 'Mixer Synth return', '40%');
  await expect(figure(page, 'Synth return')).toHaveValue('40%');
  await expect.poll(async () => (await stored(page)).effectsLoop.returns).toEqual({ synth: 0.4, drums: drumReturn });
  await set(page, 'Drum return', '20%');
  await expect(figure(page, 'Mixer Drum return')).toHaveValue('20%');
  await expect(figure(page, 'Mixer Synth return')).toHaveValue('40%');

  // The aux buses' returns are their Level knobs in the effects, each bus without disturbing the other.
  await set(page, 'Mixer Aux A return', '30%');
  await expect(figure(page, 'Aux A level')).toHaveValue('30%');
  await expect.poll(async () => (await stored(page)).effectsLoop.aux?.map((bus: { level: number }) => bus.level)).toEqual([0.3, 0.8]);
  await set(page, 'Aux B level', '55%');
  await expect(figure(page, 'Mixer Aux B return')).toHaveValue('55%');
  await expect(figure(page, 'Mixer Aux A return')).toHaveValue('30%');

  // Pan, read as each knob reads its own: a lane's to 100 either side, a drum's to 50.
  await set(page, 'Mixer Synth 1 pan', 'R40');
  await expect.poll(async () => (await lane(page, 1)).synthParams.pan).toBeCloseTo(0.4, 5);
  await expect(figure(page, 'Mixer Synth 1 pan')).toHaveValue('R40');
  await set(page, 'Mixer Kick pan', 'L25');
  await expect.poll(async () => (await stored(page)).drumState.kick.settings.pan).toBeCloseTo(-0.5, 5);
  await expect(figure(page, 'Mixer Kick pan')).toHaveValue('L25');

  // The main volume is the one on the top bar.
  await set(page, 'Mixer main volume', '50%');
  await more(page);
  await expect(figure(page, 'Volume')).toHaveValue('50%');
  expect(errors).toEqual([]);
});

test('one undo takes back a change made on the mixer', async ({ page }) => {
  const undo = button(page, 'Undo');
  const original = await figure(page, 'Mixer Kick volume').inputValue();
  expect(original).not.toBe('30%');
  await set(page, 'Mixer Kick volume', '30%');
  await expect(figure(page, 'Mixer Kick volume')).toHaveValue('30%');
  await page.waitForTimeout(400);
  await undo.click();
  await expect(figure(page, 'Mixer Kick volume')).toHaveValue(original);
  await expect.poll(async () => Math.round((await stored(page)).drumState.kick.settings.volume * 100)).toBe(Number.parseInt(original, 10));
});

test('a drag moves a fader\'s cap as far as the pointer goes, and the whole drag is one undo', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the drag is a mouse\'s; a finger\'s tap is in the phone check');
  const undo = button(page, 'Undo');
  const slot = fader(page, 'Mixer Snare volume');
  await slot.scrollIntoViewIfNeeded();
  const cap = slot.locator('.fader-cap');
  const before = Number.parseInt(await figure(page, 'Mixer Snare volume').inputValue(), 10);
  const [area, capBefore] = [await box(slot), await box(cap)];
  await page.mouse.move(area.x + area.width / 2, capBefore.y + capBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2, capBefore.y + capBefore.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  await expect(figure(page, 'Mixer Snare volume')).toHaveValue(`${before + 20}%`);
  expect((await box(cap)).y, 'the cap went up with the pointer').toBeCloseTo(capBefore.y - 20, 0);
  await expect.poll(async () => Math.round((await stored(page)).drumState.snare.settings.volume * 100)).toBe(before + 20);
  await page.waitForTimeout(400);
  await undo.click();
  await expect(figure(page, 'Mixer Snare volume')).toHaveValue(`${before}%`);
});

test('a fader is the slider a knob is: the arrow keys, the wheel and a middle click', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a wheel and a middle button are a mouse\'s');
  const slot = fader(page, 'Mixer Synth 2 level');
  await set(page, 'Mixer Synth 2 level', '50%');
  await slot.focus();
  await page.keyboard.press('ArrowUp');
  await expect(figure(page, 'Synth 2 level')).toHaveValue('51%');
  await page.keyboard.press('ArrowDown');
  await expect(figure(page, 'Synth 2 level')).toHaveValue('50%');
  await page.keyboard.press('End');
  await expect(figure(page, 'Synth 2 level'), 'a lane\'s level goes to 200%').toHaveValue('200%');
  await page.keyboard.press('Home');
  await expect(figure(page, 'Synth 2 level')).toHaveValue('0%');

  // The wheel turns it once the pointer has rested on it, by a fiftieth of its range.
  await set(page, 'Mixer Synth 2 level', '50%');
  await slot.scrollIntoViewIfNeeded();
  const area = await box(slot);
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await expect(slot).toHaveAttribute('data-wheel', 'ready');
  await page.mouse.wheel(0, -100);
  await expect(figure(page, 'Synth 2 level')).toHaveValue('54%');

  // A middle click puts it where a middle click on the lane's own knob puts that.
  await slot.click({ button: 'middle' });
  const home = await figure(page, 'Mixer Synth 2 level').inputValue();
  expect(home).not.toBe('54%');
  await set(page, 'Synth 2 level', '35%');
  await page.locator('[data-unit="synth-2"]').getByRole('slider', { name: 'Synth 2 level', exact: true }).click({ button: 'middle' });
  await expect(figure(page, 'Synth 2 level')).toHaveValue(home);
  await expect(figure(page, 'Mixer Synth 2 level')).toHaveValue(home);
});

test('Hide puts the strips away, and the browser remembers it', async ({ page }) => {
  const strips = mixer(page).locator('.mixer-strip');
  await expect(strips.first()).toBeVisible();
  const hide = mixer(page).getByRole('button', { name: 'Hide the mixer', exact: true });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  const show = mixer(page).getByRole('button', { name: 'Show the mixer', exact: true });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(strips).toHaveCount(0);
  await expect(mixer(page), 'the unit itself stays').toBeVisible();

  await page.reload();
  await ready(page);
  await expect(show).toBeVisible();
  await expect(strips).toHaveCount(0);
  // The levels are where they always were.
  await set(page, 'Synth 1 level', '45%');
  await show.click();
  await expect(figure(page, 'Mixer Synth 1 level')).toHaveValue('45%');

  await page.reload();
  await ready(page);
  await expect(hide).toBeVisible();
  await expect(strips.first()).toBeVisible();
});

test('on a phone the mixer is a unit of its own on the bar, slid sideways, with a fader a finger can use', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // One unit at a time, as on a phone that has never been here.
  await page.evaluate(key => localStorage.removeItem(key), UNIT_KEY);
  await page.reload();
  await ready(page);
  const view = page.viewportSize()!;
  const bar = page.getByRole('navigation', { name: 'Rack units', exact: true });
  const tab = bar.getByRole('button', { name: 'Show Mixer', exact: true });
  const desk = mixer(page).locator('.mixer-desk');

  await expect(mixer(page)).toBeHidden();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'true');
  await expect(mixer(page)).toBeVisible();
  await expect(mixer(page), 'focus goes into the unit').toBeFocused();
  await expect(page.locator('.rack [data-unit]:visible'), 'and it is the only unit on show').toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Synth 1 module', exact: true })).toBeHidden();

  // The page does not slide sideways; the desk does, inside the unit.
  expect(await page.locator('.rack-page').evaluate(element => element.scrollWidth - element.clientWidth), 'no sideways scrolling of the page').toBeLessThanOrEqual(1);
  const unit = await box(mixer(page));
  expect(unit.x).toBeGreaterThanOrEqual(0);
  expect(unit.x + unit.width).toBeLessThanOrEqual(view.width + 1);
  expect(await desk.evaluate(element => element.scrollWidth > element.clientWidth), 'the strips are wider than the screen').toBe(true);
  await expect(fader(page, 'Mixer main volume'), 'the last strip starts off the screen').not.toBeInViewport();
  await desk.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(fader(page, 'Mixer main volume')).toBeInViewport();
  await desk.evaluate((element) => { element.scrollLeft = 0; });

  // What a finger touches is a finger wide.
  for (const name of ['Mixer Synth 1 mute', 'Mixer Synth 1 solo']) {
    const area = await box(mixer(page).getByRole('button', { name, exact: true }));
    expect(area.width, name).toBeGreaterThanOrEqual(44);
    expect(area.height, name).toBeGreaterThanOrEqual(44);
  }
  const slot = fader(page, 'Mixer Synth 1 level');
  expect((await box(slot)).width).toBeGreaterThanOrEqual(44);
  expect((await box(fader(page, 'Mixer Synth 1 pan'))).width).toBeGreaterThanOrEqual(44);

  // A tap on a fader moves nothing and opens the large slider, which sets the lane's own level.
  const before = await figure(page, 'Mixer Synth 1 level').inputValue();
  await slot.tap();
  const sheet = page.getByRole('dialog', { name: 'Mixer Synth 1 level', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.knob-sheet-value')).toHaveText(before);
  await expect(sheet, 'its hint is in the sheet, since a phone has no hover').toContainText('The same as its Level knob');
  await sheet.getByRole('slider', { name: 'Mixer Synth 1 level', exact: true }).press('End');
  await expect(sheet.locator('.knob-sheet-value')).toHaveText('200%');
  await expect.poll(async () => (await lane(page, 1)).synthParams.gain).toBeCloseTo(2, 5);
  await sheet.getByRole('button', { name: 'Close Mixer Synth 1 level', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(figure(page, 'Mixer Synth 1 level')).toHaveValue('200%');

  // A mute from here reaches the lane, which is not on the screen.
  await mixer(page).getByRole('button', { name: 'Mixer Synth 1 mute', exact: true }).tap();
  await expect.poll(async () => (await lane(page, 1)).muted).toBe(true);
  await expect(bar.getByRole('button', { name: 'Show Synth 1', exact: true })).toHaveAttribute('data-muted', 'true');

  // The mixer is remembered as the unit on show.
  await page.reload();
  await ready(page);
  await expect(tab).toHaveAttribute('aria-current', 'true');
  await expect(mixer(page)).toBeVisible();
  expect(errors).toEqual([]);
});
