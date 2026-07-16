# Effects Loop Migration Implementation Plan

## Status: ✅ IMPLEMENTED

The shared effects loop has been fully implemented across all layers (engine, web server, UI, browser preview). See `EFFECTS_LOOP_INVESTIGATION.md` for known issues.

## What Was Implemented

### Data Model
- `EffectsLoopState` type with drive, phaser, delay, reverb sub-objects and per-effect `enabled` toggles
- `FxSendLevels` per synth and per drum: `reverb`, `delay`, `drive`, `phaser` (0-1)
- Global `effectsLoop` state in server runtime, persisted in `saved-patterns.json`
- `DrumKitId` (`clean-analog`, `punchy-modern`, `lofi-dirty`) persisted per pattern

### Engine Pipeline
- `Synthesizer.renderNote()` renders dry output (oscillator, filter, ADSR, dual LFOs)
- `renderPatternAudio()` builds dry master mix + FX send buffers, processes shared FX loop, blends dry + wet returns with soft clipping
- `processEffectsLoopBus()` applies drive → phaser → delay → reverb in series, returns zeros when disabled

### API / WebSocket
- `GET/POST /effects-loop` — read/update global effects loop state
- `effectsLoopUpdate` WebSocket message broadcasts changes to all clients
- Per-synth send levels via existing `POST /synth/:id/parameters` endpoint
- Drum FX sends via `POST /drum/fx` endpoint

### UI
- `EffectsPanel.tsx` — global effects loop panel with drive, phaser, delay, reverb controls and per-effect on/off toggles
- Per-synth FX send knobs in `SynthControls.tsx` (reverb send, delay send, drive send, phaser send)
- Drum FX sends in `DrumMachine.tsx` (reverb, delay, drive, phaser + loop return)
- Default `EffectsLoopState.enabled` set to `true`

### Browser Preview
- `useSynthAudio.ts` implements shared effects bus:
  - Delay: `DelayNode` with feedback loop
  - Reverb: `ConvolverNode` with generated impulse response
  - Drive: `WaveShaperNode` with tanh waveshaper curve
  - Phaser: Allpass filter chain with LFO modulation
- `effectsLoop` state passed from App.tsx via `effectsLoopRef.current`

## Original Goal

Move reverb and delay from per-synth embedded effects to a shared effects loop (send/return bus) while keeping each synth's core voice controls and both LFOs intact.

## Architecture

```
Synth Note → renderNote(applyInsertEffects: false)
  ├── dryPCM
  └── synthSendPCM.{reverb, delay, drive, phaser}

Drum → DrumSynthesizer → processDrumBus
  ├── dryPCM
  └── drumSendPCM.{reverb, delay, drive, phaser}

Send Buffers → processEffectsLoopBus (drive → phaser → delay → reverb)
  ├── synthWetOut
  └── drumWetOut

Final Mix:
  fullPCM = dryPCM + synthWetOut * returns.synth + drumWetOut * returns.drums
```

## Remaining Known Issues

- Serial effects chain causes cumulative dry attenuation (minor)
- Drum sends carry post-processed signal (potential double-saturation)
- Synth insert effects bypassed during pattern rendering (by design)

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
