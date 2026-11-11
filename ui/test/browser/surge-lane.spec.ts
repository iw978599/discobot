import { expect, test, type Page } from '@playwright/test';

// A synth lane on Surge XT's engine (docs/SURGE_XT_PLAN.md, stage 2): its glue loaded into the
// audio worklet, its module compiled by the page, a patch of Discobot's own, all from this site.
const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const sound = async (page: Page, index = 0) => (await stored(page)).synths[index].synthParams;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    // What the lanes processor puts out for Synth 1, to be listened to.
    const win = window as any;
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== 'lanes-processor') return;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        this.connect(analyser, 0);
        win.surgeProbe = analyser;
        // What passes between the page and the processor, said if Surge is not heard.
        win.surgeLog = [];
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: any) => {
          const m = message?.message ?? message;
          win.surgeLog.push(`to ${message?.lane ?? '-'}: ${m?.type}${m?.note ? ' ' + m.note : ''}${m?.params?.engine ? ' ' + m.params.engine : ''}`);
          post(message);
        };
        this.port.addEventListener('message', (event: MessageEvent) => win.surgeLog.push(`from: ${JSON.stringify(event.data)}`));
      }
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a lane on Surge XT loads Surge from this site and plays its patch, and its macros are knobs', async ({ page }) => {
  const errors: string[] = [], elsewhere: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(page.url()).origin) elsewhere.push(request.url()); });

  await page.getByRole('button', { name: 'Synth 1', exact: true }).click();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();

  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('surge');
  await expect.poll(async () => { const now = await sound(page); return [now.engine, now.surge.patch]; }).toEqual(['surge', 'punk-bass']);
  await expect(synth.getByLabel('Surge patch', { exact: true })).toHaveValue('punk-bass');
  await expect(synth.getByRole('slider', { name: 'Surge Cutoff', exact: true })).toBeVisible();
  await expect(synth.getByRole('slider', { name: 'Surge Drive', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(synth.getByText('Loading Surge XT…')).toHaveCount(0, { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => {
    const analyser = (window as any).surgeProbe as AnalyserNode | undefined;
    if (!analyser) return 0;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
  }), { timeout: 15000, message: 'Surge is heard' }).toBeGreaterThan(0.001).catch(async (error) => {
    const log: string[] = await page.evaluate(() => (window as any).surgeLog);
    throw new Error([error.message, ...new Set(log), ...errors].slice(0, 80).join('\n'));
  });
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Another patch, with its own macros, each a knob the lane keeps.
  await synth.getByLabel('Surge patch', { exact: true }).selectOption('clipped-stab');
  await expect.poll(async () => (await sound(page)).surge.patch).toBe('clipped-stab');
  const bright = synth.getByLabel('Surge Bright value', { exact: true });
  await bright.fill('60%');
  await bright.press('Enter');
  await expect.poll(async () => (await sound(page)).surge.macros[0]).toBeCloseTo(0.6, 2);

  // The engine and the patches are this site's own files.
  const files = await page.evaluate(async () => Promise.all(['surge/surge-engine.wasm', 'surge/surge-worklet.js', 'surge/patches/punk-bass.fxp'].map(async file => {
    const response = await fetch(file);
    return { file, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  })));
  for (const file of files) { expect(file.status, file.file).toBe(200); expect(file.bytes, file.file).toBeGreaterThan(1000); }
  expect(errors).toEqual([]);
  expect(elsewhere).toEqual([]);
});

test('a third lane cannot be put on Surge XT', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'the three lanes side by side are the wide layout');
  for (const id of [1, 2, 3]) {
    await page.getByRole('button', { name: `Synth ${id}`, exact: true }).click();
    await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
    await page.locator('.synth-controls-panel').first().getByLabel('Synth engine', { exact: true }).selectOption('surge');
  }
  await expect(page.getByText('Only 2 lanes can play Surge XT at once.', { exact: false })).toBeVisible();
  await expect.poll(async () => [(await sound(page, 0)).engine, (await sound(page, 1)).engine, (await sound(page, 2)).engine]).toEqual(['surge', 'surge', 'subtractive']);
});
