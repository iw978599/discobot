import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const project = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await ready(page);
});

test('a share link opens a page that plays the song, and a visitor can keep a copy', async ({ page, browser }, testInfo) => {
  await page.getByRole('button', { name: /^Project: / }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await projects.getByRole('button', { name: 'Rename', exact: true }).click();
  await projects.getByLabel('Project name', { exact: true }).fill('Friday Night');
  await projects.getByLabel('Project name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('140');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: '+ Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Scene 2', exact: true }).click();

  await menu(page, 'Share Link');
  const dialog = page.getByRole('dialog', { name: 'Share this song', exact: true });
  const link = await dialog.getByLabel('Share link', { exact: true }).inputValue();
  expect(link).toContain('/discobot/#song=');
  expect(link.length, 'a short song makes a link that fits in a message').toBeLessThan(8000);
  await expect(dialog).toContainText('nothing is uploaded');

  // Someone else, in a browser that has never seen this site.
  const visitorContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
  const visitor = await visitorContext.newPage();
  const requests: string[] = [];
  visitor.on('request', request => { if (!request.url().startsWith(String(testInfo.project.use.baseURL)) && request.url().startsWith('http')) requests.push(request.url()); });
  await visitor.goto(link);
  const shared = visitor.getByRole('main', { name: 'Shared song', exact: true });
  await expect(shared.getByRole('heading', { name: 'Friday Night', exact: true })).toBeVisible();
  await expect(shared).toContainText('140 BPM');
  await expect(shared).toContainText('2 bars');
  await expect(shared).toContainText('2 scenes');
  await expect(shared.getByLabel('Song order')).toContainText('Scene 2 ×1');
  await expect(visitor.locator('.rack')).toHaveCount(0);

  await shared.getByRole('button', { name: /Listen/ }).click();
  const audio = shared.locator('audio');
  await expect(audio).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration), { message: 'two bars at 140 BPM plus a tail' }).toBeGreaterThan(3.4);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), { message: 'it is actually playing' }).toBeGreaterThan(0);
  expect((await project(visitor)).name, 'listening does not save anything into the visitor\'s projects').toBe('Untitled');

  await shared.getByRole('button', { name: 'Open a Copy to Edit', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Project: Friday Night', exact: true })).toBeVisible();
  await expect(visitor.locator('.tempo-led-value')).toHaveText('140');
  await expect(visitor.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(visitor.locator('.scene-chip')).toHaveCount(2);
  expect(new URL(visitor.url()).hash, 'the link is cleared so a reload does not show the shared page again').toBe('');
  await visitor.reload();
  await expect(visitor.getByRole('button', { name: 'Project: Friday Night', exact: true })).toBeVisible();
  await visitor.getByRole('button', { name: /^Project: / }).click();
  await expect(visitor.getByRole('dialog', { name: 'Projects', exact: true }).getByRole('group'), 'their own project is still there').toHaveCount(2);
  expect(requests, 'opening a shared song contacts nobody').toEqual([]);

  // A link that was cut short explains itself and offers a way out.
  await visitor.goto(`${link.slice(0, link.length - 40)}`);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'This link could not be opened', exact: true })).toBeVisible();
  await visitor.getByRole('button', { name: 'Go to Discobot', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Project: Friday Night', exact: true })).toBeVisible();
  await visitorContext.close();
});

test('arrangements saved by an earlier version turn into projects', async ({ page }) => {
  await page.getByRole('button', { name: 'Kick step 3', exact: true }).click();
  const current = await project(page);
  await page.evaluate(({ key, state }) => {
    const lane = state.synths[0];
    const kit = JSON.parse(JSON.stringify(state.drumState));
    kit.kick.steps = kit.kick.steps.map(() => false);
    kit.snare.steps[4] = true;
    const steps = lane.pattern.steps.map((step: object, index: number) => (index === 0 ? { active: true, note: 'D3', velocity: 0.8 } : step));
    state.savedPatterns = [{
      id: 'legacy-1', name: 'Old groove', createdAt: 1, updatedAt: 2, tempo: 101, steps, synthParams: lane.synthParams,
      drumState: kit, drumKitId: 'tr-909', synths: [{ id: 1, steps, synthParams: lane.synthParams }],
    }];
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: PROJECT_KEY, state: current });
  await page.reload();
  await ready(page);
  await expect(page.locator('.app-alert'), 'upgrading is not reported as a problem').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kick step 3', exact: true }), 'the open project is untouched').toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('group', { name: 'Project Old groove', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.tempo-led-value')).toHaveText('101');
  await expect(page.getByLabel('Drum kit', { exact: true })).toHaveValue('tr-909');
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.synth-module').first().getByRole('button', { name: 'Select step 1 D3', exact: true })).toBeVisible();
  expect((await project(page)).savedPatterns, 'they are moved, not copied').toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: /^Project: / }).click();
  await expect(dialog.getByRole('group'), 'a second load does not migrate them again').toHaveCount(2);
});

test('new projects start empty and each project remembers its own work across reloads', async ({ page }) => {
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await menu(page, 'New Project');
  await expect(page.getByRole('button', { name: 'Project: Untitled 2', exact: true })).toBeVisible();
  await expect(page.locator('.drum-step-btn.active')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synth 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Snare step 9', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Snare step 9', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Snare step 9', exact: true }).click();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Project: Untitled 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('group', { name: 'Project Untitled', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Snare step 9', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true }), 'undo does not reach back into another project').toHaveAttribute('aria-pressed', 'true');
});
