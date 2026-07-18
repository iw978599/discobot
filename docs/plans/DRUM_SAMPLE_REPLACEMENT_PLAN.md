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
