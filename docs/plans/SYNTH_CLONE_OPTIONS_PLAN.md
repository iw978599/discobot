# Planning: Vintage/Modern Synth Clone Options

## Status: ✅ IMPLEMENTED

6 synth models are now available in the UI via `ui/src/synthModels.ts`: generic, minimoog-model-d, juno-106, dx7, tb-303, prophet-5. Each provides 4 macro parameters mapped to engine synth parameters via `mapSynthModelToEngineParams`. Model selection and macro values persist with pattern saves.

## Goal

Add five selectable synth models to the synth panel that emulate both:
- the characteristic sound profile of popular hardware synths, and
- their control surfaces/workflows (not just hidden preset curves).

## Candidate Clone Set (5)

1. **Minimoog Model D (mono subtractive lead/bass)**
2. **Roland Juno-106 (poly analog polysynth)**
3. **Yamaha DX7 (FM electric keys/plucks/bells)**
4. **Roland TB-303 (acid bassline mono synth)**
5. **Sequential Prophet-5 (classic poly analog brass/pads)**

## Why These 5

- Broad coverage of major synthesis families in one UI:
  - subtractive mono (Minimoog, TB-303)
  - subtractive poly (Juno-106, Prophet-5)
  - FM digital (DX7)
- Strong name recognition and distinct sonic identities.
- Controls can map into current Discobot engine with incremental extensions.

## Product Shape

- Add a **Synth Model selector** at synth-lane level.
- Each model provides:
  - a model-specific control layout
  - model-specific parameter ranges/scaling
  - model-aware default patch
  - compatibility mapping into engine params.
- Preserve existing “generic” synth mode as a fallback.

## Control Surface Expectations By Model

### 1) Minimoog
- Oscillator section emphasis (3 osc behavior abstraction)
- Ladder-style lowpass character controls
- Envelope contour with punchy mono behavior
- Glide/legato oriented performance options

### 2) Juno-106
- DCO/sub/noise style source mix abstraction
- Single-LFO workflow with classic rate/depth feel
- Chorus-style character switch abstraction
- Straightforward ADSR/filter panel

### 3) DX7
- Operator algorithm + ratio/fine tuning abstractions
- FM index/envelope shape controls
- Bright digital timbre panel
- Macro-based control set (to avoid unusable operator-level complexity in v1)

### 4) TB-303
- Saw/square source mode
- Accent/slide behavior controls
- Resonant lowpass with acid range scaling
- Decay and envelope modulation emphasis

### 5) Prophet-5
- Dual-osc subtractive layout
- Poly mode and spread/stack macros
- Resonant filter + ADSR architecture
- Vintage drift/slop macro

## Technical Approach

1. Introduce a model descriptor layer (metadata + control schema + param mapper).
2. Separate UI controls from engine-neutral synth state.
3. Build model-specific “to engine params” translators.
4. Add optional engine extensions where mapping is impossible today.
5. Persist model choice and model params with patterns/presets.

## Data Model Changes

- Extend synth state/persistence with:
  - `modelId`
  - `modelParams` (typed per model)
  - versioned migration strategy for old saves.

## Implementation Phases

1. **Foundation**
   - Model registry
   - Generic schema-driven control rendering
   - Persistence updates
2. **First Two Models**
   - Minimoog + Juno-106
   - Range tuning + presets
3. **FM Model**
   - DX7 macro layer
   - Additional modulation support if needed
4. **Bassline + Poly Classic**
   - TB-303 + Prophet-5
   - Performance behavior refinements
5. **Polish**
   - A/B listening pass
   - MIDI mapping updates
   - UX simplification and docs

## Risks

- Exact clone expectations vs. current lightweight engine scope.
- FM depth can overwhelm current UI unless macro-constrained.
- Backward compatibility for existing patterns/presets.
- CPU cost if per-model processing grows too complex.

## Acceptance Criteria

- User can switch among 5 models per synth lane.
- Each model exposes a distinct control panel shape.
- Model controls audibly affect sound in expected directions.
- Saved patterns/presets reload with correct model + control state.
- Existing non-model patterns remain loadable.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #50: Rework drum engine with per-instrument tune/humanize controls and relocate FX panel below drums

Source branch: `copilot/rework-drum-sounds`
Last sync: 2026-07-16T23:07:58.545Z

#### Changed files
- Unable to fetch changed files from API (transient error).
<!-- AUTO_PR_CHANGELOG_END -->
