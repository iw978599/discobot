import { expect, test, type Locator, type Page } from '@playwright/test';

// Small text must reach 4.5 to 1 against what it lies on, and the things a pointer hits on a desktop
// must be big enough to hit. Both are measured from what the browser draws.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const PANEL = '#34373a';
const BUTTON = '#1a1b1c';
const DISPLAY = '#0a0b0a';

// The contrast ratio of an element's drawn text colour (after its opacity) against a backdrop, and its opacity.
const ink = (target: Locator, backdrop: string, markEmpty = false) => target.first().evaluate((element, [back, mark]) => {
  if (mark) element.closest('.unit-tab')?.classList.add('empty');
  const channels = (text: string) => (text.match(/[\d.]+/g) || []).map(Number);
  const light = ([r, g, b]: number[]) => {
    const [x, y, z] = [r, g, b].map(value => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  const [r, g, b, a = 1] = channels(getComputedStyle(element).color);
  const under = [1, 3, 5].map(index => parseInt(back.slice(index, index + 2), 16));
  const mix = [r, g, b].map((value, index) => value * a * opacity + under[index] * (1 - a * opacity));
  const [top, bottom] = [light(mix), light(under)];
  return { ratio: (Math.max(top, bottom) + 0.05) / (Math.min(top, bottom) + 0.05), opacity };
}, [backdrop, markEmpty] as const);

const expectLegible = async (target: Locator, backdrop: string, what: string, markEmpty = false) => {
  const found = await ink(target, backdrop, markEmpty);
  expect(found.ratio, `${what}: contrast against ${backdrop}`).toBeGreaterThanOrEqual(4.5);
  expect(found.opacity, `${what} is shown by its colour, not by being see-through`).toBe(1);
};

test('faint text is legible: captions, drum step numbers, BPM and the empty lane on the phone\'s bar', async ({ page }, testInfo) => {
  await expectLegible(page.locator('.effects-unit .effects-block h4'), PANEL, 'a grey caption');
  await expectLegible(page.locator('.drum-step-indicator').first(), PANEL, 'a drum step number');
  await expectLegible(page.locator('.tempo-led-label'), DISPLAY, 'BPM');
  if (testInfo.project.name === 'mobile-chromium') {
    // No tab of a new project's bar is empty, so one is given the empty look in the same step as it is measured.
    const empty = page.locator('.unit-tab:not([aria-current]) .unit-tab-name');
    await expect(empty.first()).toBeVisible();
    await expectLegible(empty, PANEL, 'an empty lane\'s name on the bar', true);
  }
});

test('a disabled control is flat and grey, not see-through, and its word is still legible', async ({ page }) => {
  await page.getByRole('button', { name: /^\+ Add /, exact: false }).click();
  await expectLegible(page.getByRole('button', { name: 'Move block 1 earlier', exact: true }), BUTTON, 'a disabled song arrow');
  await expectLegible(page.getByRole('button', { name: 'Fewer repeats for block 1', exact: true }), BUTTON, 'a disabled song minus');
  const unit = page.locator('[data-unit="drums"]');
  await unit.getByRole('button', { name: 'More', exact: true }).click();
  await unit.getByRole('button', { name: 'Sends', exact: true }).click();
  const clear = unit.getByRole('button', { name: 'Clear Solos', exact: true });
  await expect(clear).toBeDisabled();
  await expectLegible(clear, BUTTON, 'a disabled button');
  await expect(clear).toHaveCSS('cursor', 'not-allowed');
});

test('on a desktop the things a pointer hits are big enough to hit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desktop sizes; the phone has its own');
  const size = async (target: Locator) => (await target.first().boundingBox())!;
  const atLeast = async (target: Locator, width: number, height: number, what: string) => {
    const box = await size(target);
    expect(box.width, `${what}: width`).toBeGreaterThanOrEqual(width);
    expect(box.height, `${what}: height`).toBeGreaterThanOrEqual(height);
  };
  await atLeast(page.getByRole('button', { name: 'Kick step 1', exact: true }), 22, 22, 'a drum step');
  await atLeast(page.getByRole('button', { name: 'Mute Kick', exact: true }), 24, 24, 'drum mute');
  await atLeast(page.getByRole('button', { name: 'Solo Kick', exact: true }), 24, 24, 'drum solo');
  await atLeast(page.getByRole('button', { name: 'Select Kick', exact: true }), 28, 22, 'a drum name');
  await atLeast(page.getByRole('button', { name: 'Mute Synth 1', exact: true }), 24, 24, 'lane mute');
  await atLeast(page.getByRole('button', { name: 'Solo Synth 1', exact: true }), 24, 24, 'lane solo');

  // The two mute and solo buttons of a drum row do not run into each other or into the steps.
  const [mute, solo, step] = [await size(page.getByRole('button', { name: 'Mute Kick', exact: true })), await size(page.getByRole('button', { name: 'Solo Kick', exact: true })), await size(page.getByRole('button', { name: 'Kick step 1', exact: true }))];
  expect(solo.x, 'solo is clear of mute').toBeGreaterThanOrEqual(mute.x + mute.width);
  expect(step.x, 'steps start clear of solo').toBeGreaterThanOrEqual(solo.x + solo.width);

  // Two blocks in the song, so that every button of the first can be pressed.
  await page.getByRole('button', { name: /^\+ Add /, exact: false }).click();
  const tools = ['Fewer repeats for block 1', 'More repeats for block 1', 'Move block 1 earlier', 'Move block 1 later', 'Remove block 1 from the song'];
  for (const name of tools) await atLeast(page.getByRole('button', { name, exact: true }), 26, 24, name);
  const later = await size(page.getByRole('button', { name: 'Move block 1 later', exact: true }));
  const remove = await size(page.getByRole('button', { name: 'Remove block 1 from the song', exact: true }));
  expect(remove.x - (later.x + later.width), 'remove is set apart from move later').toBeGreaterThanOrEqual(8);

  await atLeast(page.getByRole('switch', { name: 'Delay enabled', exact: true }), 30, 24, 'the delay\'s On button');
});

const edge = (page: Page, selector: string) => page.locator(selector).first().evaluate(element => getComputedStyle(element).borderTopColor);

test('an empty step has an edge that can be seen against the panel', async ({ page }) => {
  const light = (text: string) => {
    const [r, g, b] = (text.match(/[\d.]+/g) || []).map(Number).map(value => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (text: string) => { const a = light(text), b = light('rgb(52, 55, 58)'); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const plain = await edge(page, '.drum-step-btn:not(.beat):not(.active)');
  const beat = await edge(page, '.drum-step-btn.beat:not(.active)');
  expect(ratio(plain), 'an empty drum step\'s edge against the panel (was 1.3)').toBeGreaterThanOrEqual(2.3);
  expect(ratio(beat), 'an empty drum step on a beat').toBeGreaterThan(ratio(plain));
  expect(ratio(await edge(page, '.step-cell:not(.beat):not(.has-note)')), 'an empty lane step\'s edge').toBeGreaterThanOrEqual(2.3);
});
