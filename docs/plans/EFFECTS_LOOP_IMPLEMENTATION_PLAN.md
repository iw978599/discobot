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
### PR #55: Scrollable drum panel, compact MIDI bar, shorter keyboard/piano-roll

Source branch: `feat/ui-layout-refinements`
Last sync: 2026-07-18T16:42:19.654Z

#### Changed files
- `ui/src/App.css` — MODIFIED (+1/-0)
- `ui/src/components/Keyboard.css` — MODIFIED (+5/-5)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+1/-1)
- `ui/src/components/MidiPanel.css` — MODIFIED (+25/-38)
- `ui/src/components/MidiPanel.tsx` — MODIFIED (+35/-52)
- `ui/src/components/PianoRoll.css` — MODIFIED (+1/-1)
<!-- AUTO_PR_CHANGELOG_END -->
