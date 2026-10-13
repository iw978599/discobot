import { expect, test, type Locator, type Page } from '@playwright/test';

async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

// The editor has two levels, Notes and Sound; the pages of the sound (Osc, Filter and the rest) are under Sound.
const tab = async (page: Page, name: string) => {
  if (name !== 'Notes' && name !== 'Sound') await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).click();
};
const scrolled = (page: Page) => page.locator('.rack-page').evaluate(element => element.scrollTop);

// Puts the pointer on the knob and waits until the app says the wheel will turn it.
async function rest(page: Page, knob: Locator) {
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(knob).toHaveAttribute('data-wheel', 'ready');
}

// Wheel events sent from inside the page, all in one task, as a scroll wheel turned quickly or a
// trackpad would: the second argument is how many and the third whether Shift is held.
const spin = (knob: Locator, deltaY: number, count = 1, shiftKey = false) => knob.evaluate((element, [dy, n, shift]) => {
  const prevented: boolean[] = [];
  for (let i = 0; i < (n as number); i++) {
    const event = new WheelEvent('wheel', { deltaY: dy as number, shiftKey: shift as boolean, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    prevented.push(event.defaultPrevented);
  }
  return prevented;
}, [deltaY, count, shiftKey]);

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'A wheel is a mouse; a phone has none');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
});

test('the wheel turns a knob the pointer has rested on, and the page stays where it is', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await rest(page, gain);
  const before = await scrolled(page);
  await page.mouse.wheel(0, -100);
  await expect(gain, 'one notch up is a fiftieth of the range').toHaveAttribute('aria-valuenow', '0.54');
  await page.mouse.wheel(0, 100);
  await expect(gain, 'and one notch down puts it back').toHaveAttribute('aria-valuenow', '0.5');
  expect(await scrolled(page), 'the page did not scroll').toBe(before);
});

test('Shift gives a finer turn, as the arrow keys give a step', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await rest(page, gain);
  expect(await spin(gain, -100, 1, true)).toEqual([true]);
  await expect(gain).toHaveAttribute('aria-valuenow', '0.51');
});

test('a run of notches is one undo step', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await rest(page, gain);
  expect(await spin(gain, -100, 5)).toEqual([true, true, true, true, true]);
  await expect(gain).toHaveAttribute('aria-valuenow', '0.7');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(gain, 'one undo takes back all five notches').toHaveAttribute('aria-valuenow', '0.5');
});

test('a knob stops at its top end', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '195%');
  await expect(gain).toHaveAttribute('aria-valuenow', '1.95');
  await rest(page, gain);
  await spin(gain, -100, 3);
  await expect(gain, 'three notches up from 1.95 stop at the top').toHaveAttribute('aria-valuenow', '2');
});

test('a small trackpad scroll adds up before it moves a step', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await rest(page, gain);
  // Ten small events of a tenth of a notch make one notch: 0.04.
  await spin(gain, -10, 10);
  await expect(gain).toHaveAttribute('aria-valuenow', '0.54');
});

test('a wheel that is the page scrolling, or comes before the pointer has rested, is left to the page', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  expect(await spin(gain, -100), 'no pointer has rested on the knob').toEqual([false]);

  await rest(page, gain);
  const passedOn = await gain.evaluate(element => {
    // The page was being scrolled a moment ago, from elsewhere, and the knob came under the pointer.
    document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(passedOn, 'the scroll that was under way carries on').toBe(false);
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
});

test('the middle button puts a knob back at its default, as one undo step', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
  await expect(gain, 'a new lane starts at its default').toHaveAttribute('aria-valuenow', '1');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  // Resting on the knob first puts the typed value and the press far enough apart to be two undo steps.
  await rest(page, gain);
  const before = await scrolled(page);
  await gain.click({ button: 'middle' });
  await expect(gain, 'back at the default, not at zero').toHaveAttribute('aria-valuenow', '1');
  await expect(gain, 'the knob has the keyboard').toBeFocused();
  expect(await scrolled(page), 'the page did not scroll').toBe(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  // The left button still only takes hold of the knob, and the right does nothing.
  await gain.click();
  await gain.click({ button: 'right' });
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');

  // An effects knob: the EQ's default is flat.
  const eqEffects = page.locator('.effects-unit');
  await eqEffects.getByLabel('Master EQ enabled', { exact: true }).check();
  const eqLow = eqEffects.getByRole('slider', { name: 'EQ low', exact: true });
  await rest(page, eqLow);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await eqLow.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await eqLow.click({ button: 'middle' });
  await expect(eqLow).toHaveAttribute('aria-valuenow', '0');

  // A drum knob: there is no swing to begin with.
  const swing = page.getByRole('slider', { name: 'Swing', exact: true });
  await edit(page.getByLabel('Swing value', { exact: true }), '30%');
  await expect(swing).toHaveAttribute('aria-valuenow', '0.3');
  await swing.click({ button: 'middle' });
  await expect(swing).toHaveAttribute('aria-valuenow', '0');
});

test('the drum knobs and the effects knobs turn with the wheel too', async ({ page }) => {
  const swing = page.getByRole('slider', { name: 'Swing', exact: true });
  await rest(page, swing);
  const swingBefore = Number(await swing.getAttribute('aria-valuenow'));
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await swing.getAttribute('aria-valuenow'))).toBeGreaterThan(swingBefore);

  const effects = page.locator('.effects-unit');
  await effects.getByLabel('Master EQ enabled', { exact: true }).check();
  const eqLow = effects.getByRole('slider', { name: 'EQ low', exact: true });
  await rest(page, eqLow);
  const eqBefore = Number(await eqLow.getAttribute('aria-valuenow'));
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await eqLow.getAttribute('aria-valuenow'))).toBeGreaterThan(eqBefore);
});
