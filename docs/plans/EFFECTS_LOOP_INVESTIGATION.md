# Effects Loop Investigation

## Summary

The effects loop is implemented and now mostly functional. The two critical issues (browser preview ignoring the loop, and disabling the loop not silencing wet returns) have been fixed. Remaining minor issues are documented below.

## Status

| Issue | Status |
|-------|--------|
| Browser preview ignores effects loop | **FIXED** — `useSynthAudio.ts` now has a shared effects bus with delay, reverb (ConvolverNode), drive (WaveShaperNode), and phaser |
| Disabling loop doesn't silence wet returns | **FIXED** — `processEffectsLoopBus` returns `new Float32Array(input.length)` when disabled |
| Serial effects chain dry attenuation | **OPEN** — Minor, cumulative dry reduction across series stages |
| Synth insert effects bypassed during render | **BY DESIGN** — Only shared FX loop applies during pattern rendering |
| Drum sends carry post-processed signal | **OPEN** — Minor, potential double-saturation with drum bus |

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

## Browser Preview Effects Bus

`useSynthAudio.ts` now implements a shared effects bus:

- **Delay**: `DelayNode` with feedback loop, time/feedback/mix from `effectsLoop.delay`
- **Reverb**: `ConvolverNode` with generated impulse response, decay/mix from `effectsLoop.reverb`
- **Drive**: `WaveShaperNode` with tanh waveshaper curve, amount/tone from `effectsLoop.drive`
- **Phaser**: Allpass filter chain with LFO-modulated frequencies, rate/depth/mix from `effectsLoop.phaser`

Per-synth send levels (`fxSends.reverb`, `fxSends.delay`, `fxSends.drive`, `fxSends.phaser`) control how much of each synth's signal enters the shared bus. The `effectsLoop` state is passed from App.tsx via `effectsLoopRef.current` in both the sequencer step handler and the keyboard click handler.

## Remaining Issues

### Serial effects chain dry attenuation (MINOR)

Each effect in `processEffectsLoopBus` passes dry through its own wet/dry mix. Applied in series (drive → phaser → delay → reverb), the dry signal is attenuated by each stage:

- After delay (mix=0.3): dry at 0.7 amplitude
- After reverb (mix=0.38): dry at 0.7 × 0.62 = 0.434 amplitude

**Proposed fix**: Process effects in parallel instead of series — sum wet outputs from each effect independently, then mix with a dry bypass signal.

### Drum sends carry post-processed signal (MINOR)

Drum send buffers receive the signal after `processDrumBus()` (saturation, transient shaping, compression). The effects loop's drive/saturation stacks on top of the drum bus's own saturation, potentially causing double-saturation.

## Testing Checklist

1. Enable effects loop, play a pattern via Discord — verify effects are audible
2. Disable effects loop, play a pattern via Discord — verify wet returns are silenced
3. Test each effect individually (enable only drive, only delay, etc.)
4. Test browser preview with effects loop enabled — verify delay, reverb, drive, phaser are audible
5. Test with multiple synths and drums simultaneously
6. Verify per-synth send levels control wet amount correctly

<!-- AUTO_PR_CHANGELOG_START -->
### PR #49: feat: real-time audio architecture, drum clones, streaming fixes

Source branch: `feat/realtime-audio-architecture`
Last sync: 2026-07-16T22:55:52.308Z

#### Changed files
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+89/-88)
- `AGENTS.md` — MODIFIED (+9/-3)
- `bot/src/index.ts` — MODIFIED (+57/-1)
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+124/-91)
- `engine/src/StreamingSynth.ts` — ADDED (+420/-0)
- `engine/src/Synthesizer.ts` — MODIFIED (+2/-0)
- `engine/src/index.ts` — MODIFIED (+1/-0)
- `engine/src/types.ts` — MODIFIED (+9/-1)
- `package-lock.json` — MODIFIED (+23/-0)
- `ui/package.json` — MODIFIED (+1/-0)
- `ui/public/synth-processor.js` — ADDED (+220/-0)
- `ui/src/App.tsx` — MODIFIED (+128/-3)
- `ui/src/authClient.ts` — MODIFIED (+9/-0)
- `ui/src/components/DrumKnob.tsx` — MODIFIED (+3/-1)
- `ui/src/components/DrumMachine.css` — MODIFIED (+21/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+46/-16)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+32/-0)
- `ui/src/components/KeyboardPanel.tsx` — MODIFIED (+19/-0)
- `ui/src/components/Knob.css` — MODIFIED (+0/-30)
- `ui/src/components/Knob.tsx` — MODIFIED (+2/-19)
- `ui/src/components/PianoRoll.tsx` — MODIFIED (+0/-1)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+53/-24)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+2/-3)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+124/-293)
- `ui/src/types.ts` — MODIFIED (+1/-0)
- `ui/src/utils/midiImport.ts` — ADDED (+89/-0)
- `web/src/index.ts` — MODIFIED (+469/-42)
<!-- AUTO_PR_CHANGELOG_END -->
