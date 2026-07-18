# Planning: Replace Synthesized Drums with Audio Samples

## Goal

Transition drum generation from pure synthesis to sample-based playback while preserving:
- current 8-lane drum workflow,
- real-time browser preview,
- Discord render pipeline quality,
- low-latency sequencing behavior.

## Current State (Baseline)

- Drum audio is generated algorithmically in `engine/src/DrumSynthesizer.ts`.
- Browser preview in UI uses generated drum functions.
- Server renders full drum pattern PCM and routes through effects loop.
- Drum kits currently define parameter defaults, not sample assets.

## Target State

- Each drum lane can play one or more curated PCM samples.
- Existing lane controls (volume/tone/extra) remain meaningful by remapping:
  - `volume` → gain/velocity scaling
  - `tone` → filter/brightness shaping
  - `extra` → lane-specific macro (e.g., decay, transient, layer blend)
- Optional hybrid mode combines sample base layer + light synthetic enhancement.

## Architecture Proposal

1. **Sample Asset Layer**
   - Add per-kit/per-instrument sample manifest (file path, root gain, trim points, optional variants).
2. **Sample Decode + Cache**
   - Decode at startup (server) and lazily/cache for browser preview.
   - Keep memory-safe caching with predictable eviction policy for future expansion.
3. **Pattern Renderer Update**
   - Replace `renderHit` calls with sample trigger/mix per step.
   - Preserve per-step humanization via slight gain/timing/pitch variance.
4. **Control Mapping**
   - Map current knobs into sample processing so UI muscle memory remains.
5. **Effects Compatibility**
   - Keep existing send and return routing unchanged after dry sample mix stage.

## Data Model Additions

- Extend drum kit metadata with:
  - sample pack id/version
  - per-instrument sample refs
  - optional round-robin/velocity-layer metadata.
- Keep backward-compatible defaults for old saved patterns.

## Migration Strategy

1. Introduce a feature flag (`drumRenderMode: synth | sample | hybrid`).
2. Ship sample mode for one kit first (e.g., punchy-modern) for validation.
3. Add remaining kits after loudness normalization and tuning pass.
4. Keep synth mode as fallback until sample parity is verified.

## Risks

- Bundle size/runtime memory growth from sample assets.
- Startup/first-hit latency due to decoding.
- Loudness mismatch across kits/instruments.
- Potential drift between browser preview and server render if different decode paths are used.

## Mitigations

- Pre-normalize and trim assets offline.
- Use shared decode pipeline semantics where possible.
- Add quick RMS/peak validation checks per sample pack.
- Keep fallback synth mode during rollout.

## Phased Plan

1. **Foundation**
   - Manifest format + sample loader + cache
2. **Engine Integration**
   - Sample trigger renderer for server pattern rendering
3. **UI Preview Integration**
   - Sample playback in `useDrumAudio`
4. **Control Remap + Tuning**
   - Preserve existing knob behavior expectations
5. **Rollout**
   - Hybrid fallback, regression checks, docs update

## Acceptance Criteria

- Drum lanes play samples end-to-end in browser and Discord.
- Existing drum sequencing UX remains unchanged.
- Existing saved patterns load and play without migration failures.
- Loudness and transient response are consistent across kits.
- Effects loop and drum send/return behavior remains functional.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #56: Add LFO tempo sync, stereo spread, drum velocity per step, envelope v…

Source branch: `feat/effects-mixer-improvements`
Last sync: 2026-07-18T19:08:07.568Z

#### Changed files
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+9/-2)
- `engine/src/StreamingSynth.ts` — MODIFIED (+47/-11)
- `engine/src/Synthesizer.ts` — MODIFIED (+52/-4)
- `engine/src/types.ts` — MODIFIED (+5/-0)
- `ui/public/synth-processor.js` — MODIFIED (+17/-7)
- `ui/src/App.css` — MODIFIED (+40/-0)
- `ui/src/App.tsx` — MODIFIED (+146/-6)
- `ui/src/components/DrumMachine.css` — MODIFIED (+41/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+91/-8)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+0/-8)
- `ui/src/components/MixerPanel.css` — ADDED (+248/-0)
- `ui/src/components/MixerPanel.tsx` — ADDED (+196/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+12/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+6/-0)
- `ui/src/components/SynthControls.css` — MODIFIED (+48/-0)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+92/-24)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+4/-2)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+16/-6)
- `web/src/index.ts` — MODIFIED (+174/-11)
<!-- AUTO_PR_CHANGELOG_END -->
