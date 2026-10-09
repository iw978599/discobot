import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';

async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
async function menu(page: Page, name: 'Project' | 'Export', item: string) {
  await page.getByRole('button', { name: `${name} ▾`, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function openProject(page: Page, name: string) {
  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('group', { name: `Project ${name}`, exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Project: ${name}`, exact: true })).toBeVisible();
}
const openMidi = (page: Page) => page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();

async function project(page: Page) {
  return page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
}

test.beforeEach(async ({ page }, testInfo) => {
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  const errors: string[] = [];
  const requests: string[] = [];
  (page as Page & { auditErrors: string[]; auditRequests: string[] }).auditErrors = errors;
  (page as Page & { auditErrors: string[]; auditRequests: string[] }).auditRequests = requests;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && (url.origin !== origin || !url.pathname.startsWith('/discobot/'))) requests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
  page.on('websocket', socket => requests.push(`Unexpected WebSocket: ${socket.url()}`));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    const messages: Array<{ type: string; note?: string }> = [];
    (window as unknown as { audioMessages: typeof messages }).audioMessages = messages;
    const urls: string[] = [];
    (window as unknown as { workletUrls: string[] }).workletUrls = urls;
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
        this.audioWorklet.addModule = (url: string, options?: WorkletOptions) => {
          urls.push(new URL(url, document.baseURI).href);
          return addModule(url, options);
        };
      }
    };
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: { type: string; note?: string }) => {
          messages.push(message);
          post(message);
        };
      }
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test.afterEach(async ({ page }, testInfo) => {
  const audited = page as Page & { auditErrors: string[]; auditRequests: string[] };
  const base = String(testInfo.project.use.baseURL);
  const workletUrls = await page.evaluate(() => (window as unknown as { workletUrls?: string[] }).workletUrls || []);
  expect(workletUrls.filter(url => !url.startsWith(base)), 'AudioWorklet modules respect the deployment base path').toEqual([]);
  expect(audited.auditErrors, 'No page errors, console errors, or failed asset requests').toEqual([]);
  expect(audited.auditRequests, 'Only static requests beneath the deployed /discobot/ base path').toEqual([]);
});

test('full musical arrangement survives a kept copy, editing, reopening and reload', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  await page.locator('.tempo-led').click();
  await edit(page.locator('.tempo-led-input'), '96');
  await synth.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'Bass — Deep Sub *' });
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '63%');
  await edit(synth.getByLabel('Pan value', { exact: true }), 'L25');
  await tab(page, 'Filter');
  await edit(synth.getByLabel('Cutoff value', { exact: true }), '1.2k');
  await tab(page, 'Notes');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'G3 step 5', exact: true }).click();
  await page.getByLabel('Step 5 velocity', { exact: true }).fill('0.55');
  await page.getByLabel('Drum kit', { exact: true }).selectOption('tr-808');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByLabel('Kick step 1 velocity', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await edit(page.getByLabel('Kick pan value', { exact: true }), 'R20');
  await edit(page.getByLabel('Swing value', { exact: true }), '25%');
  await edit(page.getByLabel('Master value', { exact: true }), '76%');
  await page.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(page.getByLabel('Rev Send value', { exact: true }), '45%');
  await edit(page.locator('.drum-machine').getByLabel('FX Return value', { exact: true }), '55%');
  await edit(page.getByLabel('Drum return value', { exact: true }), '53%');
  const effects = page.locator('.effects-panel');
  await effects.getByLabel('Phaser enabled', { exact: true }).check();
  await edit(effects.locator('.effects-block').filter({ has: page.getByRole('heading', { name: 'Delay', exact: true }) }).getByLabel('Time value'), '320ms');
  const saved = await project(page);
  expect(saved.tempo).toBe(96);
  expect(saved.synths[0].pattern.steps[0].note).toBe('C3');
  expect(saved.synths[0].pattern.steps[4].note).toBe('G3');
  expect(saved.synths[0].pattern.steps[4].velocity).toBeCloseTo(0.55);
  expect(saved.synths[0].synthParams.gain).toBeCloseTo(0.63);
  expect(saved.synths[0].synthParams.pan).toBeCloseTo(-0.25);
  expect(saved.synths[0].synthParams.filter.frequency).toBe(1200);
  expect(saved.drumState.kick.steps[0]).toBe(true);
  expect(saved.drumState.kick.stepVelocities[0]).toBeCloseTo(0.4);
  expect(saved.drumState.kick.settings.pan).toBeCloseTo(0.4);
  expect(saved.drumSwing).toBeCloseTo(0.25);
  expect(saved.selectedDrumKitId).toBe('tr-808');
  expect(saved.drumFx.sends.reverb).toBeCloseTo(0.45);
  expect(saved.drumMasterVolume).toBeCloseTo(0.76);
  expect(saved.drumFx.returnLevel).toBeCloseTo(0.55);
  expect(saved.effectsLoop.returns.drums).toBeCloseTo(0.53);
  expect(saved.effectsLoop.delay.time).toBeCloseTo(0.32);
  expect(saved.effectsLoop.phaser.enabled).toBe(true);
  // Keep a copy, wreck the open project, then go back to the copy.
  await menu(page, 'Project', 'Save a Copy');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Gain value', { exact: true }), '20%');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await openProject(page, 'Untitled copy');
  await tab(page, 'Amp');
  await expect(synth.getByLabel('Gain value', { exact: true })).toHaveValue('63%');
  await expect(page.getByLabel('Synth 1 level value', { exact: true })).toHaveValue('63%');
  await tab(page, 'Notes');
  await expect(page.getByRole('button', { name: 'C3 step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.locator('.step-light.on').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { workletUrls: string[] }).workletUrls.some(url => url.endsWith('/discobot/audio-worklet.js')))).toBe(true);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.step-light.on')).toHaveCount(0);
  await page.reload();
  await tab(page, 'Amp');
  await expect(page.getByLabel('Gain value', { exact: true })).toHaveValue('63%');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Project: Untitled copy', exact: true }), 'the project that was open is still open after a reload').toBeVisible();
  await openProject(page, 'Untitled');
  await tab(page, 'Amp');
  await expect(page.getByLabel('Gain value', { exact: true }), 'the original still has the edit made after the copy').toHaveValue('20%');
});

test('rotary keyboard bounds, typed units, cancellation and pointer cleanup', async ({ page, isMobile }) => {
  const synth = page.locator('.synth-controls-panel');
  const gain = synth.getByRole('slider', { name: 'Gain', exact: true });
  await tab(page, 'Amp');
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
  await tab(page, 'LFO');
  await synth.getByLabel('LFO 1 enabled', { exact: true }).check();
  await synth.getByLabel('LFO 1 tempo sync', { exact: true }).check();
  await edit(synth.getByLabel('Rate value', { exact: true }).first(), '1/16');
  await expect(synth.getByRole('slider', { name: 'Rate', exact: true }).first()).toHaveAttribute('aria-valuenow', '16');
  await tab(page, 'Amp');
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
  await page.getByRole('heading', { name: 'Discobot', exact: true }).click();
  const key = page.getByRole('button', { name: 'Play C3', exact: true });
  await key.focus();
  await page.keyboard.down('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioMessages: Array<{ type: string; note?: string }> }).audioMessages.some(message => message.type === 'noteOn' && message.note === 'C3'))).toBe(true);
  await page.keyboard.up('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioMessages: Array<{ type: string; note?: string }> }).audioMessages.some(message => message.type === 'noteOff' && message.note === 'C3'))).toBe(true);
  await page.getByLabel('Hold notes', { exact: true }).check();
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Oct +', exact: true }).click();
  await expect(page.locator('.key.active')).toHaveCount(0);
  await page.getByLabel('Hold notes', { exact: true }).uncheck();
  await openMidi(page);
  await expect(page.getByText('MIDI input is not supported in this browser.', { exact: false })).toBeVisible();
});

test('releasing the first key during worklet loading cannot start a stuck note', async ({ page }) => {
  await page.addInitScript(() => {
    const gate = { requested: false, finished: false, release: null as null | (() => void) };
    (window as unknown as { workletGate: typeof gate }).workletGate = gate;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
        this.audioWorklet.addModule = async (...args: Parameters<Worklet['addModule']>) => {
          gate.requested = true;
          await new Promise<void>(resolve => { gate.release = resolve; });
          await addModule(...args);
          gate.finished = true;
        };
      }
    };
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Discobot', exact: true }).click();
  const key = page.getByRole('button', { name: 'Play C3', exact: true });
  await key.focus();
  await page.keyboard.down('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as { workletGate: { requested: boolean } }).workletGate.requested), { message: 'Keyboard note starts actual worklet loading' }).toBe(true);
  await page.keyboard.up('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => (window as unknown as { workletGate: { release: () => void } }).workletGate.release());
  await expect.poll(() => page.evaluate(() => (window as unknown as { workletGate: { finished: boolean } }).workletGate.finished)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { audioMessages: Array<{ type: string; note?: string }> }).audioMessages.filter(message => message.type === 'noteOn' && message.note === 'C3'))).toEqual([]);
});

test('all named presets and model macros are selectable; user presets survive reload', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  const preset = synth.getByLabel('Synth preset', { exact: true });
  const named = await preset.locator('option').allTextContents();
  for (const family of ['Bass —', 'Lead —', 'Pad —', 'Pluck —']) {
    expect(named.filter(name => name.startsWith(family))).toHaveLength(3);
  }
  await tab(page, 'Amp');
  for (const name of named.filter(name => name.includes('—'))) {
    await preset.selectOption({ label: name });
    await expect(synth.getByRole('slider', { name: 'Gain', exact: true })).toHaveAttribute('aria-valuenow', /0\.(45|55)/);
  }
  const macros = page.locator('.synth-module.selected .synth-model-macro-grid [role="slider"]');
  for (const model of ['minimoog-model-d', 'juno-106', 'dx7', 'tb-303', 'prophet-5']) {
    await synth.getByLabel('Synth model', { exact: true }).selectOption(model);
    await expect(macros).toHaveCount(4);
    await macros.first().press('ArrowUp');
  }
  await synth.getByLabel('Preset name', { exact: true }).fill('My keys');
  await synth.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.getByLabel('Synth preset', { exact: true }).selectOption({ label: 'My keys' });
  await expect(page.getByLabel('Synth model', { exact: true })).toHaveValue('prophet-5');
  await page.locator('.preset-controls').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByLabel('Synth preset', { exact: true }).locator('option').filter({ hasText: 'My keys' })).toHaveCount(0);
});

test('piano-roll keyboard navigation, 32-step editing and cancelled painting preserve notes', async ({ page }) => {
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const first = page.getByRole('button', { name: 'C3 step 1', exact: true });
  await first.focus();
  await first.press('Space');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await first.press('ArrowRight');
  const second = page.getByRole('button', { name: 'C3 step 2', exact: true });
  await expect(second).toBeFocused();
  await second.press('ArrowUp');
  const sharp = page.getByRole('button', { name: 'C#3 step 2', exact: true });
  await expect(sharp).toBeFocused();
  await sharp.press('Space');
  await expect(sharp).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Sequence length').selectOption('32');
  await sharp.focus();
  await sharp.press('End');
  const last = page.getByRole('button', { name: 'C#3 step 32', exact: true });
  await expect(last).toBeFocused();
  await last.press('Enter');
  expect((await project(page)).synths[0].pattern.steps[31].note).toBe('C#3');
  const paint = page.getByRole('button', { name: 'D3 step 3', exact: true });
  await paint.dispatchEvent('pointerdown', { pointerId: 2, button: 0, pointerType: 'touch' });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2 })));
  await page.getByRole('button', { name: 'E3 step 4', exact: true }).dispatchEvent('pointerenter', { pointerId: 2, pointerType: 'touch' });
  expect((await project(page)).synths[0].pattern.steps[2].note).toBe('D3');
  expect((await project(page)).synths[0].pattern.steps[3].note).toBeUndefined();
  await page.getByLabel('Sequence length').selectOption('16');
  expect((await project(page)).synths[0].pattern.steps).toHaveLength(16);
});

test('projects dialog traps focus, closes with Escape, and renames, copies and deletes projects', async ({ page }) => {
  const opener = page.getByRole('button', { name: /^Project: / });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await expect(dialog.getByRole('button', { name: 'Close projects', exact: true })).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Project Untitled', exact: true })).toContainText('Open now');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true }).last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await dialog.getByLabel('Project name', { exact: true }).fill('Friday jam');
  await dialog.getByLabel('Project name', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Project: Friday jam', exact: true })).toBeVisible();
  expect((await project(page)).name).toBe('Friday jam');

  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  const copy = dialog.getByRole('group', { name: 'Project Friday jam copy', exact: true });
  await expect(copy).toBeVisible();
  page.once('dialog', confirm => { void confirm.accept(); });
  await copy.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(copy).toHaveCount(0);

  // Deleting the only project leaves a fresh one, never nothing.
  const first = (await project(page)).projectId;
  page.once('dialog', confirm => { void confirm.accept(); });
  await dialog.getByRole('group', { name: 'Project Friday jam', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Project Untitled', exact: true })).toBeVisible();
  await expect(dialog.getByRole('group')).toHaveCount(1);
  expect((await project(page)).projectId).not.toBe(first);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Project: Untitled', exact: true })).toBeVisible();
});

test('all synth, effects and mixer control families update durable project state', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel');
  await tab(page, 'Osc');
  await synth.getByLabel('Oscillator waveform').selectOption('sawtooth');
  await tab(page, 'Filter');
  await synth.getByLabel('Filter type').selectOption('highpass');
  await tab(page, 'LFO');
  await synth.getByLabel('LFO 1 enabled').check();
  await synth.getByLabel('LFO 2 enabled').check();
  await synth.getByLabel('LFO 1 waveform').selectOption('triangle');
  await synth.getByLabel('LFO 2 target').selectOption('pitch');
  await tab(page, 'Arp');
  await synth.getByLabel('Arpeggiator enabled').check();
  await synth.getByLabel('Arpeggiator mode').selectOption('converge');
  await synth.getByLabel('Arpeggiator rate').selectOption('1/8');
  await tab(page, 'Amp');
  await synth.getByLabel('Portamento enabled').check();
  let turned = 0;
  for (const name of ['Osc', 'Filter', 'Amp', 'LFO', 'Sends']) {
    await tab(page, name);
    for (const control of await synth.locator('[role="slider"]:not([aria-disabled="true"]):visible').all()) {
      await control.focus();
      const before = Number(await control.getAttribute('aria-valuenow'));
      await control.press(before === Number(await control.getAttribute('aria-valuemax')) ? 'ArrowDown' : 'ArrowUp');
      expect(Number(await control.getAttribute('aria-valuenow'))).not.toBe(before);
      turned++;
    }
  }
  expect(turned, 'every tab of the editor has working knobs').toBeGreaterThan(30);
  for (const control of await page.locator('.synth-module.selected .rack-knobs [role="slider"]').all()) {
    const before = Number(await control.getAttribute('aria-valuenow'));
    await control.press(before === Number(await control.getAttribute('aria-valuemax')) ? 'ArrowDown' : 'ArrowUp');
    expect(Number(await control.getAttribute('aria-valuenow'))).not.toBe(before);
  }
  for (const enabled of ['Drive enabled', 'Phaser enabled', 'Delay enabled', 'Reverb enabled']) {
    await page.locator('.effects-panel').getByLabel(enabled, { exact: true }).check();
  }
  for (const control of await page.locator('.effects-panel [role="slider"]').all()) {
    const before = Number(await control.getAttribute('aria-valuenow'));
    await control.press('ArrowUp');
    expect(Number(await control.getAttribute('aria-valuenow'))).not.toBe(before);
  }
  await page.getByLabel('Effects loop enabled', { exact: true }).uncheck();
  await expect(page.getByLabel('Effects loop enabled', { exact: true })).not.toBeChecked();
  await page.getByLabel('Effects loop enabled', { exact: true }).check();
  await edit(page.getByLabel('Synth 1 level value', { exact: true }), '72%');
  await tab(page, 'Amp');
  await edit(synth.getByLabel('Pan value', { exact: true }), 'R35');
  await edit(synth.getByLabel('FX Return value', { exact: true }), '44%');
  await edit(page.getByLabel('Synth return value', { exact: true }), '66%');
  await edit(page.getByLabel('Drum return value', { exact: true }), '53%');
  await page.getByRole('button', { name: 'Mute Synth 1', exact: true }).click();
  await page.getByRole('button', { name: 'Solo Synth 1', exact: true }).click();
  const state = await project(page);
  expect(state.synths[0].synthParams.oscillator.type).toBe('sawtooth');
  expect(state.synths[0].synthParams.filter.type).toBe('highpass');
  expect(state.synths[0].synthParams.arpeggiator).toMatchObject({ enabled: true, mode: 'converge', rate: '1/8' });
  expect(state.synths[0].synthParams.gain).toBeCloseTo(0.72);
  expect(state.synths[0].synthParams.pan).toBeCloseTo(0.35);
  expect(state.synths[0].synthParams.fxReturn).toBeCloseTo(0.44);
  expect(state.synths[0]).toMatchObject({ muted: true, solo: true });
  expect(state.effectsLoop.returns).toEqual({ synth: 0.66, drums: 0.53 });
});

test('drum instrument settings, mute/solo and pattern tools retain velocity accents', async ({ page }) => {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  for (const label of ['Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Low Tom', 'High Tom', 'Cymbal']) {
    await page.getByRole('button', { name: `Select ${label}`, exact: true }).click();
    for (const suffix of ['volume', 'tone', 'tune', 'humanize', 'pan']) {
      const control = page.getByRole('slider', { name: `${label} ${suffix}`, exact: true });
      const before = Number(await control.getAttribute('aria-valuenow'));
      await control.press('ArrowDown');
      expect(Number(await control.getAttribute('aria-valuenow'))).not.toBe(before);
    }
    await page.getByRole('button', { name: `Mute ${label}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Mute ${label}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: `Solo ${label}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Solo ${label}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Select Kick', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByLabel('Kick step 1 velocity', { exact: true }).fill('0.35');
  await page.getByTitle('Shift pattern right', { exact: true }).click();
  let state = await project(page);
  expect(state.drumState.kick.steps[1]).toBe(true);
  expect(state.drumState.kick.stepVelocities[1]).toBeCloseTo(0.35);
  await page.getByTitle('Reverse pattern', { exact: true }).click();
  state = await project(page);
  expect(state.drumState.kick.steps[14]).toBe(true);
  expect(state.drumState.kick.stepVelocities[14]).toBeCloseTo(0.35);
  await page.getByRole('button', { name: 'Select Cymbal', exact: true }).click();
  await page.getByRole('button', { name: 'Switch cymbal type', exact: true }).click();
  expect((await project(page)).drumState.crash.settings.cymbalType).toBe('ride');
});

test('sample import, playback, persistence and deletion use device-local storage', async ({ page }) => {
  const buffer = Buffer.alloc(44 + 1600);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(1600, 40);
  for (let i = 0; i < 800; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 8000 * 440 * Math.PI * 2) * 8000), 44 + i * 2);
  await openMidi(page);
  await page.getByLabel('Import audio sample', { exact: true }).setInputFiles({ name: 'browser-tone.wav', mimeType: 'audio/wav', buffer });
  await expect(page.getByRole('button', { name: 'Play sample browser-tone.wav', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play sample browser-tone.wav', exact: true }).click();
  await page.reload();
  await openMidi(page);
  await expect(page.getByRole('button', { name: 'Play sample browser-tone.wav', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete sample browser-tone.wav', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play sample browser-tone.wav', exact: true })).toHaveCount(0);
  await page.reload();
  await openMidi(page);
  await expect(page.getByText('No samples yet.', { exact: false })).toBeVisible();
});

test('simulated MIDI device routes step notes by channel and target; permission denial stays visible', async ({ page }) => {
  await page.addInitScript(() => {
    const input = { id: 'test-controller', name: 'Test controller', state: 'connected', onmidimessage: null as null | ((event: { data: Uint8Array }) => void) };
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
    (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi = data => input.onmidimessage?.({ data: new Uint8Array(data) });
  });
  await page.reload();
  await openMidi(page);
  await page.getByLabel('MIDI input device').selectOption('test-controller');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await page.getByLabel('MIDI channel').selectOption('2');
  await page.getByLabel('MIDI target synth').selectOption('1');
  await page.evaluate(() => (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi([0x90, 60, 100]));
  expect((await project(page)).synths[0].pattern.steps[0].note).toBeUndefined();
  await page.evaluate(() => (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi([0x91, 60, 100]));
  await expect.poll(async () => (await project(page)).synths[0].pattern.steps[0].note).toBe('C4');
  await page.evaluate(() => (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi([0x81, 60, 0]));
  await expect(page.getByText('Ch 2 Note Off 60', { exact: true })).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { throw new Error('Denied'); } });
  });
  await page.reload();
  await openMidi(page);
  await expect(page.getByText('MIDI permission denied', { exact: true })).toBeVisible();
});

test('MIDI export/import and WAV download produce real local files', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click();
  const midiDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Export MIDI');
  const midi = await midiDownload;
  const midiPath = testInfo.outputPath('arrangement.mid');
  await midi.saveAs(midiPath);
  const midiBytes = await readFile(midiPath);
  expect(midiBytes.subarray(0, 4).toString()).toBe('MThd');
  expect(midiBytes.length).toBeGreaterThan(30);
  const wavDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Download WAV');
  const wav = await wavDownload;
  const wavPath = testInfo.outputPath('arrangement.wav');
  await wav.saveAs(wavPath);
  const wavBytes = await readFile(wavPath);
  expect(wavBytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(wavBytes.subarray(8, 12).toString()).toBe('WAVE');
  expect(wavBytes.length).toBeGreaterThan(44);
  expect(wavBytes.subarray(44).some(byte => byte !== 0)).toBe(true);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.locator('input[type="file"][accept=".mid,.midi"]').setInputFiles({ name: 'arrangement.mid', mimeType: 'audio/midi', buffer: midiBytes });
  const dialog = page.getByRole('dialog', { name: 'Import MIDI', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('select').first().selectOption('1');
  await dialog.getByRole('button', { name: 'Apply All', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await project(page)).synths[0].pattern.steps.some((step: { note?: string }) => step.note === 'C4')).toBe(true);
});
