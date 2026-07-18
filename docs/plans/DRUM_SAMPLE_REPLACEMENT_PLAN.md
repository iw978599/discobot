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
### PR #53: Move sequencer+keyboard above synth control panels

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T13:43:27.722Z

#### Changed files
- `ui/src/App.tsx` — MODIFIED (+30/-30)
<!-- AUTO_PR_CHANGELOG_END -->
