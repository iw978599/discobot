import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';

async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

async function project(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && (url.origin !== 'http://127.0.0.1:4173' || !url.pathname.startsWith('/discobot/'))) requests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'SYNTHESIZER', exact: true })).toBeVisible();
  (page as Page & { auditErrors: string[]; auditRequests: string[] }).auditErrors = errors;
  (page as Page & { auditErrors: string[]; auditRequests: string[] }).auditRequests = requests;
});

test.afterEach(async ({ page }) => {
  const audited = page as Page & { auditErrors: string[]; auditRequests: string[] };
  expect(audited.auditErrors, 'No page errors, console errors, or failed asset requests').toEqual([]);
  expect(audited.auditRequests, 'Only static requests beneath the deployed /discobot/ base path').toEqual([]);
});

test('full musical arrangement survives save, editing, load and reload', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  await synth.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'Bass — Deep Sub *' });
  await edit(synth.getByLabel('Gain value', { exact: true }), '63%');
  await edit(synth.getByLabel('Pan value', { exact: true }), 'L25');
  await edit(synth.getByLabel('Cutoff value', { exact: true }), '1.2k');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'G3 step 5', exact: true }).click();
  await page.getByLabel('Step 5 velocity', { exact: true }).fill('0.55');
  await page.getByLabel('Drum kit', { exact: true }).selectOption('tr-808');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByLabel('Kick step 1 velocity', { exact: true }).fill('0.4');
  await edit(page.getByLabel('Kick pan value', { exact: true }), 'R20');
  await edit(page.getByLabel('Swing value', { exact: true }), '25%');
  await edit(page.getByLabel('Rev Send value', { exact: true }), '45%');
  const effects = page.locator('.effects-panel');
  await effects.getByLabel('Phaser enabled', { exact: true }).check();
  await edit(effects.locator('.effects-block').filter({ has: page.getByRole('heading', { name: 'Delay', exact: true }) }).getByLabel('Time value'), '320ms');
  await page.getByRole('button', { name: '+ Save', exact: true }).click();
  await page.locator('.save-name-input').fill('Browser groove');
  await page.locator('.save-name-input').press('Enter');
  await expect(page.getByText('Saved!', { exact: false })).toBeVisible();
  const before = await project(page);
  expect(before.savedPatterns).toHaveLength(1);
  const saved = before.savedPatterns[0];
  expect(saved.steps[0].note).toBe('C3');
  expect(saved.steps[4].note).toBe('G3');
  expect(saved.synths[0].synthParams.gain).toBeCloseTo(0.63);
  expect(saved.synths[0].synthParams.pan).toBeCloseTo(-0.25);
  expect(saved.synths[0].synthParams.filter.frequency).toBe(1200);
  expect(saved.drumState.kick.steps[0]).toBe(true);
  expect(saved.drumState.kick.stepVelocities[0]).toBeCloseTo(0.4);
  expect(saved.drumState.kick.settings.pan).toBeCloseTo(0.4);
  expect(saved.drumSwing).toBeCloseTo(0.25);
  expect(saved.effectsLoop.delay.time).toBeCloseTo(0.32);
  expect(saved.effectsLoop.phaser.enabled).toBe(true);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await edit(synth.getByLabel('Gain value', { exact: true }), '20%');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.locator('.load-select').selectOption(saved.id);
  await expect(page.getByRole('button', { name: 'C3 step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(synth.getByLabel('Gain value', { exact: true })).toHaveValue('63%');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.locator('.step-light.on').first()).toBeVisible();
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.step-light.on')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Gain value', { exact: true })).toHaveValue('63%');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await project(page)).savedPatterns[0]).toEqual(saved);
});

test('rotary keyboard bounds, typed units, cancellation and pointer cleanup', async ({ page, isMobile }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await gain.focus();
  await gain.press('Home');
  await expect(gain).toHaveAttribute('aria-valuenow', '0');
  await gain.press('ArrowUp');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.01');
  await gain.press('End');
  await expect(gain).toHaveAttribute('aria-valuenow', '2');
  await edit(synth.getByLabel('Gain value', { exact: true }), '50%');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await synth.getByLabel('Gain value', { exact: true }).fill('180%');
  await synth.getByLabel('Gain value', { exact: true }).press('Escape');
  await gain.focus();
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await edit(synth.getByLabel('Gain value', { exact: true }), 'not a number');
  await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  await synth.getByLabel('Portamento enabled', { exact: true }).check();
  await edit(synth.getByLabel('Glide value', { exact: true }), '120ms');
  await expect(synth.getByRole('slider', { name: 'Glide', exact: true })).toHaveAttribute('aria-valuenow', '0.12');
  await synth.getByLabel('LFO 1 enabled', { exact: true }).check();
  await synth.getByLabel('LFO 1 tempo sync', { exact: true }).check();
  await edit(synth.getByLabel('Rate value', { exact: true }).first(), '1/16');
  await expect(synth.getByRole('slider', { name: 'Rate', exact: true }).first()).toHaveAttribute('aria-valuenow', '16');
  if (!isMobile) {
    await gain.scrollIntoViewIfNeeded();
    const box = await gain.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 30);
    await page.mouse.up();
    const value = await gain.getAttribute('aria-valuenow');
    await page.mouse.move(box!.x, box!.y + 90);
    await expect(gain).toHaveAttribute('aria-valuenow', value!);
  } else {
    await gain.scrollIntoViewIfNeeded();
    const box = await gain.boundingBox();
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await gain.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientY: 20 });
    await session.detach();
    await expect(gain).toHaveAttribute('aria-valuenow', '0.5');
  }
});

test('keyboard sustain, hold, octave release and unsupported MIDI feedback', async ({ page }) => {
  const key = page.getByRole('button', { name: 'Play C3', exact: true });
  await key.focus();
  await page.keyboard.down('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Hold notes', { exact: true }).check();
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Oct +', exact: true }).click();
  await expect(page.locator('.key.active')).toHaveCount(0);
  await page.getByLabel('Hold notes', { exact: true }).uncheck();
  await expect(page.getByText('MIDI input is not supported in this browser.', { exact: false })).toBeVisible();
});

test('all named presets and model macros are selectable; user presets survive reload', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const preset = synth.getByLabel('Synth preset', { exact: true });
  const named = await preset.locator('option').allTextContents();
  for (const family of ['Bass —', 'Lead —', 'Pad —', 'Pluck —']) {
    expect(named.filter(name => name.startsWith(family))).toHaveLength(3);
  }
  for (const name of named.filter(name => name.includes('—'))) {
    await preset.selectOption({ label: name });
    await expect(synth.getByRole('slider', { name: 'Gain', exact: true })).toHaveAttribute('aria-valuenow', /0\.(45|55)/);
  }
  for (const model of ['minimoog-model-d', 'juno-106', 'dx7', 'tb-303', 'prophet-5']) {
    await synth.getByLabel('Synth model', { exact: true }).selectOption(model);
    await expect(synth.locator('.synth-model-macro-grid [role="slider"]')).toHaveCount(4);
    await synth.locator('.synth-model-macro-grid [role="slider"]').first().press('ArrowUp');
  }
  await synth.getByLabel('Preset name', { exact: true }).fill('My keys');
  await synth.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'My keys' });
  await expect(page.getByLabel('Synth model', { exact: true })).toHaveValue('prophet-5');
  await page.locator('.preset-controls').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByLabel('Synth preset', { exact: true }).locator('option').filter({ hasText: 'My keys' })).toHaveCount(0);
});
