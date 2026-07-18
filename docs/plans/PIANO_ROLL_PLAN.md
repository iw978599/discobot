# Planning: Keyboard / Piano Roll Toggle

## Status: ✅ IMPLEMENTED

Piano roll is implemented in `ui/src/components/PianoRoll.tsx` with 3-octave × step grid, click/drag note painting, and step headers. `KeyboardPanel.tsx` provides the mode toggle between keyboard and piano roll.

## Overview

Add a toggle to the keyboard panel that switches between the current on-screen keyboard and a piano roll editor. The piano roll provides a visual grid-based method for composing melodies, while the keyboard provides real-time note input.

## Current State

- `Keyboard.tsx`: 3-octave clickable keyboard with mouse hold/release, octave shift (-1 to +1)
- `Sequencer.tsx`: 16/32-step sequencer with per-step note assignment
- Keyboard is in `SynthUnit` grid column 2, below the sequencer
- Keyboard sends notes via `onNotePlay`/`onNoteRelease` callbacks

## Design

### Toggle Mechanism

- Small toggle button in the keyboard panel header (left side, before the title)
- Two modes: `keyboard` (default) and `piano-roll`
- Toggle state per synth (stored in `SynthState` in App.tsx)
- Icon-based: 🎹 for keyboard mode, 📊 for piano roll mode

### Piano Roll Layout

```
+----------------------------------------------------------+
| [🎹] Piano Roll    [Clear] [Quantize]                    |
+----------------------------------------------------------+
| C5 |         ■■■■                                        |
| B4 |     ■■■                                             |
| A#4|   ■                                                 |
| A4 |         ■■■■■■                                      |
| G#4| ■                                                   |
| G4 |             ■■                                      |
| F#4|                   ■■                                |
| F4 |                     ■■■                             |
| E4 |               ■■■                                  |
...
| C3 |                                                     |
+----------------------------------------------------------+
  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
```

- **Y-axis**: Piano keys (vertical), showing current octave range (3 octaves matching keyboard range)
- **X-axis**: Sequencer steps (16 or 32)
- **Cells**: Click to toggle note on/off at that pitch+step
- **Note color**: Matches step color scheme (amber when selected, blue when active)
- **Playback indicator**: Current step column highlighted during playback

### Interaction

- **Click cell**: Toggle note on/off
- **Drag across cells**: Paint notes (mousedown + drag)
- **Right-click cell**: Set velocity (popup or cycle through 3 levels: soft/medium/loud)
- **Scroll vertically**: Shift octave range
- **Clear button**: Remove all notes from current pattern
- **Quantize button**: Snap notes to nearest beat subdivision (optional, for future use)

### Data Model

Piano roll shares the same `Pattern.steps` data model as the sequencer. Each step has `{ active: boolean; note: string; velocity: number }`. The piano roll is an alternative view/edit mode for the same data — changes in one view reflect in the other.

### Component Structure

```
SynthUnit
├── SynthControls
├── Sequencer
└── KeyboardPanel (NEW - replaces Keyboard)
    ├── ModeToggle (keyboard ↔ piano roll)
    ├── Keyboard (existing, shown in keyboard mode)
    └── PianoRoll (new, shown in piano roll mode)
```

### Props

```typescript
interface PianoRollProps {
  pattern: Pattern | null;
  currentStep: number;
  isPlaying: boolean;
  selectedStep: number | null;
  octaveRange: [number, number]; // e.g. [3, 5]
  onNoteToggle: (stepIndex: number, note: string) => void;
  onStepSelect: (stepIndex: number) => void;
}
```

### Integration with Sequencer

- When a note is toggled in the piano roll, it updates `pattern.steps[stepIndex].note`
- When a note is changed in the sequencer step view (clicking a step, then choosing a key on the keyboard), it updates the same `pattern.steps[stepIndex].note`
- The sequencer's step grid remains visible above the piano roll for quick overview

## Implementation Steps

### Phase 1: Infrastructure
1. Add `keyboardMode: 'keyboard' | 'piano-roll'` to `SynthState` in App.tsx
2. Create `KeyboardPanel.tsx` wrapper component with mode toggle button
3. Create `PianoRoll.tsx` skeleton component

### Phase 2: Piano Roll Grid
4. Build the piano roll grid renderer (rows = notes, columns = steps)
5. Implement click-to-toggle note on/off
6. Implement drag-to-paint
7. Highlight current playback step
8. Highlight selected step
9. Sync with pattern data (read from and write to `pattern.steps`)

### Phase 3: Polish
10. Add octave range indicator and vertical scroll
11. Add Clear and Quantize buttons
12. Add velocity display (color intensity or small indicator)
13. Style to match existing dark theme
14. Responsive layout (single column on small screens)

## Styling Notes

- Background: `#0a0a0a` (matches keyboard container)
- Grid lines: `#222`
- Note cells (off): `#1a1a1a`
- Note cells (on): `#00d4ff` (synth accent color)
- Current step column: `rgba(255, 255, 255, 0.05)`
- Selected step: `#f59e0b` border (amber)
- Piano key labels on Y-axis: `#888`, white key rows slightly lighter

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
