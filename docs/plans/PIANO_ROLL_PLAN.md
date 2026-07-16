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
