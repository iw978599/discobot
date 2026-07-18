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
### PR #54: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T15:06:55.296Z

#### Changed files
- `.opencode/agent/discobot-developer.md` — MODIFIED (+3/-12)
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+3/-12)
- `AGENTS.md` — MODIFIED (+3/-12)
- `README.md` — MODIFIED (+3/-12)
- `docs/guides/DEPLOYMENT.md` — MODIFIED (+3/-12)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — MODIFIED (+3/-12)
- `docs/guides/HOSTING_QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/RAILWAY_DEPLOY.md` — MODIFIED (+3/-12)
- `docs/guides/README_STREAMING.md` — MODIFIED (+3/-12)
- `docs/guides/SETUP.md` — MODIFIED (+3/-12)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — MODIFIED (+3/-12)
- `docs/plans/IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/IMPROVEMENT_IDEAS.md` — MODIFIED (+3/-12)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/PIANO_ROLL_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — MODIFIED (+3/-12)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — MODIFIED (+3/-12)
- `docs/reference/AUDIO_STREAMING_CODE.md` — MODIFIED (+3/-12)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/FINAL_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — MODIFIED (+3/-12)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/PROJECT_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/REFACTORING_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reviews/CODE_REVIEW.md` — MODIFIED (+3/-12)
- `engine/src/types.ts` — MODIFIED (+1/-0)
- `start-ui.bat` — ADDED (+4/-0)
- `start-web.bat` — ADDED (+5/-0)
- `ui/src/App.css` — MODIFIED (+5/-6)
- `ui/src/App.tsx` — MODIFIED (+22/-21)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+19/-1)
- `ui/src/components/Keyboard.css` — MODIFIED (+2/-0)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+2/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+6/-1)
- `web/src/index.ts` — MODIFIED (+3/-0)
<!-- AUTO_PR_CHANGELOG_END -->
