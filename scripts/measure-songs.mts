// How loud each section of each sample song is: every lane (with its automation and any recorded
// instrument) and the drums (the recorded kit and percussion included), rendered dry by the exporter's
// own functions and summed. No effects and no master: a section's dry mix should peak near 0.5 so the
// effects have room (AGENTS.md, Sample songs). Run by hand:
//   node --import tsx scripts/measure-songs.mts            every song
//   node --import tsx scripts/measure-songs.mts lanterns   one song, by its id
import { readFileSync } from 'node:fs';
import { SAMPLE_SONGS } from '../ui/src/services/sampleSongs.ts';
import { buildSampleSong } from '../ui/src/services/sampleSong.ts';
import { createBuiltInPresets } from '../ui/src/services/builtInPresets.ts';
import { renderDrums, renderSynthBars } from '../ui/src/services/wavExport.ts';
import { BUILT_IN_WAVES, KIT_RECORDINGS, PERC_TYPES, parseWaveBundle } from '../ui/src/services/builtInWaves.ts';
import { barSteps, sceneAsBars } from '../ui/src/services/patternLength.ts';
import { createMemoryLibrary } from '../ui/src/services/projectLibrary.ts';
import { setup } from '../ui/test/helpers/store.ts';
import { CYMBAL_TYPES } from '../engine/src/index.ts';

const read = (path: string) => {
  const bytes = readFileSync(new URL(`../ui/public/${path}`, import.meta.url));
  return parseWaveBundle(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};
const waves = new Map([...read('waves.bin'), ...BUILT_IN_WAVES.flatMap(wave => (wave.file ? [...read(wave.file)] : []))]);
const recordings: Record<string, { data: Float32Array; rate: number }> = {};
const keep = (name: string, id: string) => { const sample = waves.get(id); if (sample) recordings[name] = { data: sample.data, rate: sample.rate }; };
for (const kind of CYMBAL_TYPES) keep(kind, `cymbal-${kind}`);
for (const drum of KIT_RECORDINGS) keep(`kit-${drum}`, `kit-${drum}`);
for (const kind of PERC_TYPES) keep(`perc-${kind}`, `perc-${kind}`);

const SR = 22050, only = process.argv[2];
const service = setup();
await service.openLibrary(createMemoryLibrary());
for (const song of SAMPLE_SONGS) {
  if (only && song.id !== only) continue;
  const project = (buildSampleSong(service.exportProject(), createBuiltInPresets(), song) as { project: any }).project;
  let loudest = 0;
  for (const scene of project.scenes) {
    const bars = sceneAsBars(scene);
    const tempo = scene.tempo ?? project.tempo;
    const barSeconds = (barSteps(scene.signature) / 16) * 240 / tempo;
    const frames = Math.round(SR * barSeconds * bars.length);
    const mix = [new Float32Array(frames), new Float32Array(frames)];
    const parts: string[] = [];
    const add = (out: Float32Array[]) => { let peak = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) { mix[c][i] += out[c][i]; peak = Math.max(peak, Math.abs(out[c][i])); } return peak; };
    for (const lane of project.synths) {
      const steps = bars.map(bar => bar.lanes[lane.synthId] ?? []);
      if (!steps.some(bar => bar.some(step => step.active))) continue;
      const params = lane.synthParams;
      const sample = params.engine === 'sample' && params.sample?.wave ? waves.get(params.sample.wave) ?? null : undefined;
      const peak = add(renderSynthBars(steps, params, tempo, frames, SR, barSeconds, sample, undefined, bars.map(bar => bar.laneAutomation?.[lane.synthId])));
      parts.push(`${lane.name ?? `Synth ${lane.synthId}`} ${peak.toFixed(2)}`);
    }
    const drums = add(renderDrums({ tempo, drumState: project.drumState, drumKitId: project.selectedDrumKitId, drumMasterVolume: project.drumMasterVolume, drumSwing: project.drumSwing, bars, signature: scene.signature, drumCymbals: recordings }, frames, SR, bars.length, 240 / tempo));
    let peak = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(mix[c][i]));
    loudest = Math.max(loudest, peak);
    console.log(`${song.name} / ${scene.name}: mix ${peak.toFixed(2)} | drums ${drums.toFixed(2)} | ${parts.join(' | ')}`);
  }
  console.log(`== ${song.name}: loudest section ${loudest.toFixed(2)}`);
}
