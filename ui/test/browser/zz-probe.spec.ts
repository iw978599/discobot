import { expect, test } from '@playwright/test';

// Temporary: how this browser renders loops of native nodes. Removed before the pull request is ready.
test('probe loops', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const rate = 44100, frames = 8000;
    const peaks = (data: Float32Array) => {
      const out: string[] = [];
      for (let i = 0; i < data.length && out.length < 6; i++) if (Math.abs(data[i]) > 1e-6) out.push(`${i}:${data[i].toFixed(4)}`);
      return out.join(' ');
    };
    const render = async (build: (ctx: OfflineAudioContext, input: AudioNode) => AudioNode) => {
      const ctx = new OfflineAudioContext(1, frames, rate);
      const buffer = ctx.createBuffer(1, 1, rate); buffer.getChannelData(0)[0] = 1;
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const input = ctx.createGain();
      source.connect(input);
      build(ctx, input).connect(ctx.destination);
      source.start(0);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const gain = (ctx: BaseAudioContext, value: number) => { const node = ctx.createGain(); node.gain.value = value; return node; };
    const delay = (ctx: BaseAudioContext, n: number) => { const node = ctx.createDelay(1); node.delayTime.value = n / rate; return node; };
    const cases: Record<string, (ctx: OfflineAudioContext, input: AudioNode) => AudioNode> = {
      comb: (ctx, input) => { const d = delay(ctx, 1000), g = gain(ctx, 0.5); input.connect(d).connect(g).connect(d); return d; },
      combFiltered: (ctx, input) => { const d = delay(ctx, 1000), f = ctx.createBiquadFilter(), g = gain(ctx, 0.5); f.type = 'highshelf'; f.gain.value = 0; input.connect(d).connect(f).connect(g).connect(d); return d; },
      combShort: (ctx, input) => { const d = delay(ctx, 200), g = gain(ctx, 0.5); input.connect(d).connect(g).connect(d); return d; },
      allpassTwoExits: (ctx, input) => {
        const sum = gain(ctx, 1), d = delay(ctx, 1000), back = gain(ctx, 0.5), fwd = gain(ctx, -0.5), out = gain(ctx, 1);
        input.connect(sum).connect(d).connect(back).connect(sum); sum.connect(fwd).connect(out); d.connect(out); return out;
      },
      allpassOneExit: (ctx, input) => {
        const sum = gain(ctx, 1), d = delay(ctx, 1000), back = gain(ctx, 0.5), neg = gain(ctx, -1), out = gain(ctx, 1);
        input.connect(sum).connect(d).connect(back).connect(sum); input.connect(neg).connect(out); d.connect(out); return out;
      },
      coupled: (ctx, input) => {
        const a = delay(ctx, 1000), b = delay(ctx, 1300), ga = gain(ctx, 0.5), gb = gain(ctx, 0.5), cross = gain(ctx, -0.3), out = gain(ctx, 1);
        input.connect(a); input.connect(b);
        a.connect(ga).connect(a); b.connect(gb).connect(b); ga.connect(cross); gb.connect(cross); cross.connect(a); cross.connect(b);
        a.connect(out); b.connect(out); return out;
      },
    };
    const report: Record<string, { peaks: string; repeat: boolean }> = {};
    for (const [name, build] of Object.entries(cases)) {
      const runs = [];
      for (let run = 0; run < 6; run++) runs.push(await render(build));
      report[name] = { peaks: peaks(runs[0]), repeat: runs.every(data => data.every((value, i) => value === runs[0][i])) };
    }
    return report;
  });
  console.log('probe loops', JSON.stringify(result, null, 1));
});
