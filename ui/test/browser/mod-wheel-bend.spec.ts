import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const emit = (page: Page, data: number[]) => page.evaluate(bytes => (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi(bytes), data);
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const openMidi = async (page: Page) => {
  if (onPhone(page) && !await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'More controls', exact: true }).click();
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    const input = { id: 'test-controller', name: 'Test controller', state: 'connected', onmidimessage: null as null | ((event: { data: Uint8Array }) => void) };
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
    (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi = data => input.onmidimessage?.({ data: new Uint8Array(data) });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
});

test('the mod wheel is a route source, and bend and wheel messages are live only: nothing is saved', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('tab', { name: 'LFO', exact: true }).click();
  const source = page.locator('.synth-controls-panel').getByLabel('Route 1 source', { exact: true });
  await expect(source.locator('option', { hasText: 'Mod wheel' })).toHaveCount(1);
  await source.selectOption('modWheel');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.modMatrix?.[0]?.source).toBe('modWheel');

  await openMidi(page);
  await page.getByLabel('MIDI input device').selectOption('test-controller');
  await expect(page.locator('.midi-panel').first()).toBeVisible();
  const before = JSON.stringify(await stored(page));

  await emit(page, [0xe0, 0, 127]);
  await emit(page, [0xe0, 0, 0]);
  await emit(page, [0xe0, 0, 64]);
  await emit(page, [0xb0, 1, 127]);
  await emit(page, [0xb0, 1, 0]);
  await emit(page, [0xb1, 1, 90]);
  await emit(page, [0xe5, 3, 100]);
  await page.waitForTimeout(500);

  expect(JSON.stringify(await stored(page))).toBe(before);
  expect(errors).toEqual([]);
});
