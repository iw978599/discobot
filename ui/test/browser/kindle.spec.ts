import { expect, test } from '@playwright/test';

const SILK = 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.144 Safari/537.36';
const SILK_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.144 Safari/537.36';
const CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// isMobile makes Chromium honour the viewport tag as a phone or tablet does; without it the tag
// is ignored and nothing here would be tested. 800 wide is a Fire HD 10 held upright.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'sets its own device');
});

test.describe('Silk on a Fire HD 10, upright', () => {
  test.use({ userAgent: SILK, viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true });

  test('gets the phone layout', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.unit-bar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);
    await expect.poll(() => page.evaluate(() => document.querySelector('.rack')!.scrollWidth <= document.querySelector('.rack')!.clientWidth)).toBe(true);
  });
});

test.describe('Silk in desktop view, on its side', () => {
  test.use({ userAgent: SILK_DESKTOP, viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true });

  test('still gets the phone layout', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.unit-bar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);
  });
});

test.describe('another tablet of the same size', () => {
  test.use({ userAgent: CHROME, viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true });

  // Narrower than the desktop rack, so it has the phone arrangement too (design review 27), but at
  // its own width: only a Kindle is made to report a narrower one.
  test('has the phone arrangement at its own width', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
    await expect(page.locator('.unit-bar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(720);
  });
});
