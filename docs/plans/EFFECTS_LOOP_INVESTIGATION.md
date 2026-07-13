# Effects Loop Investigation

## Summary

The effects loop is implemented and structurally correct, but has several issues that make it appear non-functional. The primary cause is that **the browser preview never applies the effects loop** — it only applies during server-side pattern rendering for Discord playback. Additionally, there is a bug where disabling the loop doesn't actually silence the wet returns.

## Root Causes

### 1. Browser preview ignores the effects loop (PRIMARY)

`ui/src/hooks/useSynthAudio.ts` only applies per-synth insert effects (delay/reverb from `SynthParameters.effects`). The shared `EffectsLoopState` is never read or applied in the browser audio chain.

When a user clicks keyboard keys or hears sequencer playback in the browser, they hear **dry synth + insert effects only**. The shared effects loop (drive, phaser, delay, reverb bus) is only applied during server-side `renderPatternAudio()` which produces audio for Discord voice.

**Impact**: Users testing via the web UI will never hear the effects loop unless they also play via Discord.

### 2. Disabling the effects loop doesn't silence wet returns (BUG)

In `web/src/index.ts`, `processEffectsLoopBus()` returns the raw input buffer when `loop.enabled === false`:

```typescript
function processEffectsLoopBus(input, sampleRate, loop) {
  if (!loop.enabled) return input;  // returns raw send signal!
  // ... apply effects ...
}
```

The returned signal is then mixed into the master:

```typescript
fullPCM[i] = dryPCM[i]
  + synthWetOut[i] * effectsLoop.returns.synth    // still nonzero!
  + drumWetOut[i] * effectsLoop.returns.drums * drumFx.returnLevel;
```

This means even with the loop "off", the summed send signals (reverb + delay + drive + phaser sends) bleed into the master mix at full return level. The loop's `enabled` toggle only bypasses the insert effect processing, not the signal routing.

### 3. Serial effects chain causes cumulative dry attenuation (MINOR)

Each effect in `processEffectsLoopBus` passes dry through its own wet/dry mix. Applied in series (drive → phaser → delay → reverb), the dry signal is attenuated by each stage:

- After delay (mix=0.3): dry at 0.7 amplitude
- After reverb (mix=0.38): dry at 0.7 × 0.62 = 0.434 amplitude

This is typical for serial effect chains but may cause unintended volume reduction.

### 4. Synth insert effects are bypassed during pattern rendering (BY DESIGN)

`renderNote()` is called with `{ applyInsertEffects: false }`. Per-synth delay/reverb settings in `SynthParameters.effects` have zero effect on rendered audio. Only the shared effects loop applies. This is intentional to avoid double-processing, but means synth-specific effect settings are ignored during playback.

### 5. Drum sends carry post-processed signal (MINOR)

Drum send buffers receive the signal after `processDrumBus()` (saturation, transient shaping, compression). The effects loop's drive/saturation stacks on top of the drum bus's own saturation, potentially causing double-saturation.

## Architecture Overview

```
Synth Note → renderNote(applyInsertEffects: false)
  ├── dryPCM ← sample
  ├── synthSendPCM.reverb ← sample * fxSends.reverb
  ├── synthSendPCM.delay  ← sample * fxSends.delay
  ├── synthSendPCM.drive  ← sample * fxSends.drive
  └── synthSendPCM.phaser ← sample * fxSends.phaser

Drum → DrumSynthesizer.renderPattern → processDrumBus
  ├── dryPCM ← sample
  ├── drumSendPCM.reverb ← sample * drumFx.sends.reverb
  ├── drumSendPCM.delay  ← sample * drumFx.sends.delay
  ├── drumSendPCM.drive  ← sample * drumFx.sends.drive
  └── drumSendPCM.phaser ← sample * drumFx.sends.phaser

Send Buffers → sum into wetIn per source
  ├── synthWetIn = synthSendPCM.reverb + .delay + .drive + .phaser
  └── drumWetIn  = drumSendPCM.reverb + .delay + .drive + .phaser

Wet In → processEffectsLoopBus(enabled check → drive → phaser → delay → reverb)
  ├── synthWetOut
  └── drumWetOut

Final Mix:
  fullPCM = dryPCM + synthWetOut * returns.synth + drumWetOut * returns.drums * drumFx.returnLevel
```

## Proposed Fixes

### Fix 1: Apply effects loop to browser preview (HIGH)

Add shared effects loop processing to `useSynthAudio.ts`. Options:

- **Web Audio API approach**: Create parallel wet chains (delay node, convolver for reverb, waveshaper for drive, allpass for phaser) connected to a shared bus, with send gains controlled by `fxSends` levels. Mix dry + wet at the output.
- **Simpler approach**: At minimum, apply the per-synth insert effects (delay/reverb from `SynthParameters.effects`) which are already partially wired but gated by `delayEnabled`/`reverbEnabled` checks. This would make the existing browser preview effects audible.

### Fix 2: Return zeros when effects loop is disabled (HIGH)

Change `processEffectsLoopBus` to return a zero-filled array when disabled:

```typescript
function processEffectsLoopBus(input, sampleRate, loop) {
  if (!loop.enabled) return new Float32Array(input.length);
  // ... existing code ...
}
```

### Fix 3: Parallel effects processing (MEDIUM)

Process each effect in parallel instead of in series to avoid cumulative dry attenuation. Sum the wet outputs from each effect independently, then mix with the dry bypass:

```typescript
function processEffectsLoopBus(input, sampleRate, loop) {
  if (!loop.enabled) return new Float32Array(input.length);
  const output = new Float32Array(input.length);
  // dry bypass
  for (let i = 0; i < input.length; i++) output[i] = input[i];
  // parallel wet processing
  if (loop.drive.enabled) output.addInPlace(applyDrive(input, ...));
  if (loop.phaser.enabled) output.addInPlace(applyPhaser(input, ...));
  if (loop.delay.enabled) output.addInPlace(applyDelay(input, ...));
  if (loop.reverb.enabled) output.addInPlace(applyReverb(input, ...));
  return output;
}
```

### Fix 4: Pre-effects loop dry bypass (LOW)

Add a dry bypass signal that goes through the effects loop untouched, ensuring the original signal level is preserved regardless of effect chain wet/dry settings.

## Testing Strategy

1. Enable effects loop, play a pattern via Discord — verify effects are audible
2. Disable effects loop, play a pattern via Discord — verify wet returns are silenced
3. Test each effect individually (enable only drive, only delay, etc.)
4. Test browser preview with effects loop enabled
5. Test with multiple synths and drums simultaneously
