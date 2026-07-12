# Effects Loop Migration Implementation Plan

## Goal
Move reverb and delay from per-synth embedded effects to a shared effects loop (send/return bus) while keeping each synth’s core voice controls and both LFOs intact.

## Current-State Summary
- Per-synth effects are part of `SynthParameters.effects` and rendered inside `engine/src/Synthesizer.ts`.
- Pattern render/mix is centralized in `web/src/index.ts` (`renderPatternAudio`) and currently sums each synth note render output directly.
- UI exposes reverb/delay inside each synth panel (`ui/src/components/SynthControls.tsx`).

## Target Architecture
- **Dry synth voices**: each synth renders dry output only.
- **Shared FX bus**: one global delay + reverb chain processes summed sends from all active synths.
- **Per-synth sends**: each synth has `delaySend` and `reverbSend` (or a unified FX send matrix).
- **Global returns**: one set of delay/reverb parameters controls the loop for the entire mix.
- **Order**: dry mix + (delay/reverb returns), with selectable FX order (default: delay -> reverb) and soft clipper at the end.

## Data Model Changes
1. Remove/retire `SynthParameters.effects` usage for sequence rendering.
2. Add per-synth send controls in synth params (e.g. `fxSends.delay`, `fxSends.reverb`, 0..1).
3. Add global `EffectsLoopState` in server runtime state for shared delay/reverb settings and bypass flags.
4. Extend persistence schema (`saved-patterns.json`) to store:
   - per-synth send levels
   - global effects loop settings
5. Add migration logic so old saved patterns with per-synth effects still load safely.

## Engine and Audio Pipeline Plan
1. Extract delay/reverb processors from `Synthesizer` into reusable processing utilities (shared module).
2. Keep `Synthesizer.renderNote()` focused on oscillator/LFO/filter/envelope/gain (dry output).
3. In server mix stage (`renderPatternAudio`):
   - build dry master mix
   - build FX send buffers by accumulating synth sends
   - process shared delay/reverb returns
   - blend dry + wet returns with controlled headroom
4. Preserve existing drum behavior and final soft clipping.

## API / WebSocket Plan
1. Add API surface for global FX loop state (`GET/POST /effects-loop`).
2. Include global FX loop state in initial payload and broadcast updates via WebSocket (new message type).
3. Continue using existing synth parameter endpoint for per-synth send levels.
4. Validate and clamp all new params server-side.

## UI / Layout Plan
1. Remove dedicated per-synth reverb/delay parameter blocks.
2. Keep per-synth compact **FX Send** section (Delay Send, Reverb Send).
3. Add a global **Effects Loop** panel near global transport/tempo controls.
4. Preserve both LFO sections as first-class controls in synth UI.
5. Keep responsive behavior by using grouped sections (Voice, Modulation, Envelope, Sends, Global FX).

## Best-Practice UX Direction
- Use clear dry/wet mental model: **Send amount per synth, effect character globally**.
- Keep high-frequency controls close together (filter + envelope; LFOs grouped).
- Reduce duplicated knobs across synth units by centralizing shared effects.
- Prefer immediate feedback controls with guarded ranges and clear units.

## Rollout Phases
1. **Phase 1: Data + compatibility**
   - Add new state/types and backward-compatible loaders.
2. **Phase 2: Engine pipeline refactor**
   - Dry synth rendering + shared FX processing path.
3. **Phase 3: API + socket updates**
   - Global FX endpoints and sync messages.
4. **Phase 4: UI migration**
   - Replace per-synth effect blocks with send controls and global FX panel.
5. **Phase 5: Save/load + regression checks**
   - Validate old/new pattern persistence and playback parity.

## Validation Checklist
- 16-step and multi-synth playback stays sample-aligned.
- Solo/mute logic still applies before send routing.
- Global tempo changes preserve FX timing behavior.
- Saved patterns created before migration load without crashes.
- Browser preview and Discord render paths produce consistent wet/dry behavior.

## Follow-Up Items (Related to Requested Features)
- Step length toggle (16/32) should be introduced as pattern metadata and reflected across sequencer UI/server render loop.
- Editable knob value fields should be implemented in shared knob components so Enter/blur commits immediately.
- Hold mode should be added as synth voice behavior/state and reflected in keyboard + sequencer interaction rules.
