import { expect, test, type Page } from '@playwright/test';

// A voice of Discobot's handed to a guest (the optional "input" feature of the guest protocol). The
// example guest takes one when its address carries ?input=1, and plays it back unchanged, so a
// voice heard through it should be what the voice is in the mix: once, on the beat, as loud.

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}
async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const guestAddress = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest?input=1`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a drum handed to a guest leaves the mix, is marked, and comes back through the guest once and on the beat', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { readFile } = await import('node:fs/promises');
  const exportWav = async (name: string) => {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await exportAs(page, 'Scene WAV');
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
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(guestAddress(String(testInfo.project.use.baseURL)));
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  const guest = unit.frameLocator('iframe');

  // 240 BPM: a bar is a second, and the kick is on the second beat, a quarter of a second in.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('240');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Kick step 5', exact: true }).click();

  // The guest is told the voices there are, and asks for the kick.
  const voice = guest.getByLabel('Voice', { exact: true });
  await expect(voice.locator('option', { hasText: 'Synth 1 · ' })).toHaveCount(1);
  await expect(voice.locator('option', { hasText: 'Kick' })).toHaveCount(1);
  await voice.selectOption({ label: 'Kick' });
  const strip = page.locator('[aria-label="Mixer Kick"]');
  await expect(strip, 'the mixer says where the kick has gone').toHaveAttribute('data-handed', 'true');
  await expect(strip.locator('.mixer-name')).toContainText('→ Beat Bell');
  await expect(page.getByRole('button', { name: 'Select Kick', exact: true })).toHaveAttribute('data-handed', 'true');
  await expect(page.locator('[aria-label="Mixer Snare"]')).not.toHaveAttribute('data-handed', 'true');
  await expect(guest.getByRole('status')).toContainText('Voice: drum:kick');

  const handed = await exportWav('handed.wav');
  await expect(guest.getByRole('status')).not.toContainText('blocks received: 0');

  // Given back, the kick is in the mix again and nothing is marked.
  await voice.selectOption({ label: 'None' });
  await expect(strip).not.toHaveAttribute('data-handed', 'true');
  await expect(page.getByRole('button', { name: 'Select Kick', exact: true })).not.toHaveAttribute('data-handed', 'true');
  const dry = await exportWav('dry.wav');

  expect(dry(0.25, 0.3), 'the kick in the mix').toBeGreaterThan(0.02);
  expect(handed(0.25, 0.3), 'the kick through the guest').toBeGreaterThan(0.02);
  // Heard once: at the guest's level (0.8) and not twice as loud. Late or early, the window would hold less of it.
  const ratio = handed(0.25, 0.3) / dry(0.25, 0.3);
  expect(ratio, 'about as loud through the guest as in the mix').toBeGreaterThan(0.45);
  expect(ratio).toBeLessThan(1.4);
  expect(handed(0.2, 0.245), 'and not early').toBeLessThan(handed(0.25, 0.3) / 3);
  expect(errors).toEqual([]);
});
