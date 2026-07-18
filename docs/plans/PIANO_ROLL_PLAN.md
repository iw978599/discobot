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
