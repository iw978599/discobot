import { expect, test, type Locator, type Page } from '@playwright/test';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
};

// Four states each have a look of their own, and this holds them apart (design review, finding 3):
// keyboard focus is a white ring held off the control by a dark gap; a pointer over a control gives
// it a lighter edge; a selected step is framed inside its own edge; and anything that is on, or
// holds something, is amber. All of it is read from what the browser draws.

const FOCUS = 'rgb(255, 255, 255)';
const GAP = 'rgb(11, 12, 13)';
const SELECT = 'rgb(241, 241, 238)';
const ON = 'rgb(255, 176, 0)';
const HOVER = 'rgb(217, 219, 220)';
const CONTROL = 'rgb(26, 27, 28)';
const WELL = 'rgb(24, 25, 26)';
const PANEL = 'rgb(52, 55, 58)';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });
const step = (page: Page, number: number) => lane(page).getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) });
const css = (target: Locator, property: string) => target.first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

// The contrast ratio of two drawn colours.
const ratio = (first: string, second: string) => {
  const light = (text: string) => {
    const [r, g, b] = (text.match(/[\d.]+/g) || []).map(Number).map(value => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [light(first), light(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// The pointer rests where it last clicked, and a lit control is lighter under a pointer.
const pointerAway = (page: Page) => page.mouse.move(2, 2);
// The browser draws focus rings once a key has moved the focus, and goes on drawing them for focus moved after.
const byKeyboard = (page: Page) => page.keyboard.press('Tab');

const ring = async (target: Locator, what: string) => {
  await expect(target, `${what}: the ring is drawn`).toHaveCSS('outline-style', 'solid');
  await expect(target, `${what}: the ring is the focus colour`).toHaveCSS('outline-color', FOCUS);
  await expect(target, `${what}: the ring is two pixels`).toHaveCSS('outline-width', '2px');
};

test('on a step, focus is a ring outside it and selected is a frame inside it, and neither is the step\'s own colour', async ({ page }) => {
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await lane(page).getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await lane(page).getByRole('button', { name: 'G3 step 3', exact: true }).click();
  await expect(step(page, 3)).toHaveClass(/has-note/);

  // Selected with the pointer: framed inside, and no ring.
  await step(page, 1).click();
  await pointerAway(page);
  await expect(step(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 1)).toHaveCSS('background-color', ON);
  await expect(step(page, 1), 'a selected step has no ring').toHaveCSS('outline-style', 'none');
  await expect.poll(() => css(step(page, 1), 'box-shadow'), 'a selected step is framed inside its edge').toContain(`${SELECT} 0px 0px 0px 3px inset`);
  await expect.poll(() => css(step(page, 1), 'box-shadow'), 'a dark line keeps the frame off the amber').toContain(`${GAP} 0px 0px 0px 4px inset`);

  // Focused, holding a note, not selected: the ring, a dark gap, then the amber.
  await byKeyboard(page);
  await step(page, 3).focus();
  await ring(step(page, 3), 'a step that holds a note');
  await expect(step(page, 3)).toHaveCSS('outline-offset', '2px');
  await expect(step(page, 3)).toHaveCSS('background-color', ON);
  await expect.poll(() => css(step(page, 3), 'box-shadow'), 'the gap between the ring and the step').toContain(`${GAP} 0px 0px 0px 2px`);
  await expect.poll(() => css(step(page, 3), 'box-shadow'), 'a step that is only focused has no frame').not.toContain('inset');
  expect(FOCUS, 'the ring is not the step\'s colour').not.toBe(ON);
  expect(ratio(FOCUS, ON), 'white on amber alone would not show, which is why there is a gap').toBeLessThan(3);
  await expect.poll(async () => ratio(await css(step(page, 3), 'outline-color'), GAP), 'the ring against its gap').toBeGreaterThanOrEqual(3);
  await expect.poll(async () => ratio(await css(step(page, 3), 'background-color'), GAP), 'the gap against the step').toBeGreaterThanOrEqual(3);
  expect(ratio(FOCUS, PANEL), 'the ring against the panel round it').toBeGreaterThanOrEqual(3);

  // Focused and empty.
  await step(page, 2).focus();
  await ring(step(page, 2), 'an empty step');
  await expect(step(page, 2)).toHaveCSS('background-color', WELL);
  await expect.poll(() => css(step(page, 2), 'box-shadow'), 'an empty focused step has no frame').not.toContain('inset');

  // Selected and focused: both, the frame inside and the ring outside.
  await step(page, 1).focus();
  await ring(step(page, 1), 'the selected step');
  await expect.poll(() => css(step(page, 1), 'box-shadow'), 'still framed').toContain(`${SELECT} 0px 0px 0px 3px inset`);
  await expect.poll(() => css(step(page, 1), 'box-shadow'), 'and ringed with its gap').toContain(`${GAP} 0px 0px 0px 2px`);
  await expect(step(page, 3), 'the step left behind has lost its ring').toHaveCSS('outline-style', 'none');
});

test('a focused button has the focus ring, and a hovered one only a lighter edge', async ({ page }, testInfo) => {
  const button = page.getByRole('button', { name: 'Help', exact: true });
  await more(page);
  await expect(button).toHaveCSS('border-top-color', 'rgb(85, 88, 91)');

  if (testInfo.project.name === 'chromium') {
    await button.hover();
    await expect(button, 'a hovered button\'s edge').toHaveCSS('border-top-color', HOVER);
    await expect(button, 'a hovered button has no ring').toHaveCSS('outline-style', 'none');
    await expect(button, 'a hovered button is not lit').toHaveCSS('background-color', CONTROL);
    expect(HOVER, 'hover is not the focus colour').not.toBe(FOCUS);
    expect(HOVER, 'hover is not amber').not.toBe(ON);
    await pointerAway(page);
    await expect(button).toHaveCSS('border-top-color', 'rgb(85, 88, 91)');
  }

  await byKeyboard(page);
  await button.focus();
  await ring(button, 'a button');
  await expect(button).toHaveCSS('outline-offset', '2px');
  await expect(button, 'focus does not change the button\'s own edge').toHaveCSS('border-top-color', 'rgb(85, 88, 91)');
  await expect.poll(() => css(button, 'box-shadow')).toContain(`${GAP} 0px 0px 0px 2px`);
  await less(page);

  const knob = lane(page).getByRole('slider', { name: 'Synth 1 level', exact: true });
  await knob.focus();
  await ring(knob, 'a knob');
});

test('everything that is on is the same amber, and the main button is not', async ({ page }) => {
  const drums = page.locator('[data-unit="drums"]');
  await page.getByRole('button', { name: 'Mute Synth 1', exact: true }).click();
  await drums.getByRole('button', { name: 'More', exact: true }).click();
  await pointerAway(page);

  const lit: Array<[string, Locator]> = [
    ['a lane\'s mute', page.getByRole('button', { name: 'Mute Synth 1', exact: true })],
    ['a pressed-in button', drums.getByRole('button', { name: 'More', exact: true })],
    ['the open scene', page.getByRole('group', { name: 'Scenes', exact: true }).getByRole('button').first()],
    ['the open page of the sound editor', lane(page).getByRole('tab', { name: 'Notes', exact: true })],
    ['the keyboard and piano roll switch', lane(page).getByRole('button', { name: 'Keyboard', exact: true })],
  ];
  for (const [what, target] of lit) {
    await expect(target, `${what} is lit`).toHaveCSS('background-color', ON);
    await expect(target, `${what}: its edge`).toHaveCSS('border-top-color', ON);
    await expect(target, `${what}: its word`).toHaveCSS('color', 'rgb(17, 17, 17)');
  }

  const dark: Array<[string, Locator]> = [
    ['a lane\'s solo, which is off', page.getByRole('button', { name: 'Solo Synth 1', exact: true })],
    ['a button that is off', drums.getByRole('button', { name: 'Sends', exact: true })],
    ['the page of the sound editor that is not open', lane(page).getByRole('tab', { name: 'Osc', exact: true })],
  ];
  for (const [what, target] of dark) await expect(target, what).toHaveCSS('background-color', CONTROL);

  await expect(page.locator('.play-all-button'), 'Play, while nothing plays, is the main button and not a lit one').toHaveCSS('background-color', SELECT);
});

// Puts the focus on every control in a part of the page, one after another, and lists any whose ring is not the one ring.
const wrongRings = (scope: Locator) => scope.first().evaluate((root, [focus, gap]) => {
  const wrong: string[] = [];
  let seen = 0;
  for (const element of root.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href], [role="slider"]')) {
    if ((element as HTMLButtonElement).disabled || element.getClientRects().length === 0) continue;
    element.focus({ preventScroll: true });
    if (document.activeElement !== element) continue;
    seen += 1;
    // A switch in the sound editor is a hidden tick box, and its ring is drawn on the slider beside it.
    const drawn = element.matches('.synth-toggle input') && element.nextElementSibling ? element.nextElementSibling : element;
    const style = getComputedStyle(drawn);
    const right = style.outlineStyle === 'solid' && style.outlineColor === focus && parseFloat(style.outlineWidth) >= 2 && style.boxShadow.includes(gap);
    if (!right) wrong.push(`${element.tagName.toLowerCase()}.${element.className} "${element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 30) || ''}": ${style.outlineStyle} ${style.outlineColor} ${style.outlineWidth}, shadow ${style.boxShadow}`);
  }
  return { seen, wrong: wrong.slice(0, 12) };
}, [FOCUS, GAP] as const);

test('every control in the rack, a menu and a dialog shows the same focus ring', async ({ page }) => {
  test.setTimeout(90_000);
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await expect(lane(page).getByRole('button', { name: 'C3 step 1', exact: true })).toBeVisible();
  // Some older controls fade from one look to the next. This reads the look they come to rest in, so the fades are switched off.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await byKeyboard(page);
  const rack = await wrongRings(page.locator('.rack'));
  expect(rack.wrong, 'controls in the rack without the ring').toEqual([]);
  expect(rack.seen, 'the rack\'s controls were tried').toBeGreaterThan(100);

  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await byKeyboard(page);
  const list = await wrongRings(page.locator('.rack-menu-list'));
  expect(list.wrong, 'rows of the menu without the ring').toEqual([]);
  expect(list.seen).toBeGreaterThan(3);
  await expect(page.locator('.rack-menu-list button:focus'), 'a menu\'s ring is drawn inside the row, where it cannot be cut off').toHaveCSS('outline-offset', '-2px');

  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await expect(dialog).toBeVisible();
  const address = dialog.getByLabel('Address of the instrument\'s page', { exact: true });
  await address.focus();
  await ring(address, 'a field in a dialog');
  await expect(address).toHaveCSS('outline-offset', '2px');
  await byKeyboard(page);
  const inside = await wrongRings(dialog);
  expect(inside.wrong, 'controls in the dialog without the ring').toEqual([]);
  expect(inside.seen).toBeGreaterThan(1);
});

test('a lit button stays lit after the tap that lit it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'only a touch screen leaves a hover behind after a tap');
  const roll = lane(page).getByRole('button', { name: 'Piano Roll', exact: true });
  await roll.tap();
  await expect(roll).toHaveAttribute('aria-pressed', 'true');
  await expect(roll, 'the hover a tap leaves behind does not put the light out').toHaveCSS('background-color', ON);
  await expect(roll).toHaveCSS('color', 'rgb(17, 17, 17)');
});
