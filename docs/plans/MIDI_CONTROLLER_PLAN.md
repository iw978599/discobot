# Planning: MIDI Controller Support

## Status: ✅ BASIC IMPLEMENTATION COMPLETE

MIDI input is implemented via `ui/src/hooks/useMidiInput.ts` and `ui/src/components/MidiPanel.tsx`. Supports device selection ("All devices" mode), channel filtering, noteOn/noteOff/CC parsing, and live/record/step modes. The advanced features (MIDI learn, CC mapping, pitch bend, sustain pedal) remain as future work.

## Overview

Add Web MIDI API support so users can connect a MIDI keyboard (or any MIDI controller) to play synths live, record patterns in real-time, and map MIDI CC to synth parameters.

## Current State

- No MIDI code exists in the codebase
- Browser-based app (React + Vite) — Web MIDI API is the only option
- Each synth has `onNotePlay(note)` / `onNoteRelease(note)` callbacks already
- Synth parameters are stored per-synth in `App.tsx` state
- Sequencer pattern model: `steps[i] = { active: boolean; note: string; velocity: number }`

## Web MIDI API

```typescript
// Request access
const access = await navigator.requestMIDIAccess({ sysex: false });

// List inputs
const inputs = Array.from(access.inputs.values());

// Listen for messages
input.onmidimessage = (event) => {
  const [status, note, velocity] = event.data;
  // status & 0xF0 = message type, status & 0x0F = channel
  // 0x90 = note on, 0x80 = note off, 0xB0 = control change
};
```

- Supported in Chrome, Edge, Opera (not Firefox without extension)
- No server-side component needed — MIDI is browser-local only
- No `BOT_SHARED_SECRET` or backend involvement required

---

## Architecture

### New Files

```
ui/src/
├── hooks/
│   └── useMidiInput.ts       # MIDI device management + message parsing
├── components/
│   └── MidiPanel.tsx          # Device selector, status, mode toggle, mapping display
├── components/
│   └── MidiPanel.css
```

### Modified Files

```
ui/src/App.tsx                # Add midiMode state, wire MIDI events to synth/drum
ui/src/components/SynthUnit.tsx # Pass MIDI mode props down
```

---

## MIDI Message Types

| Message | Status Byte | Notes |
|---------|------------|-------|
| Note On | `0x9x` | x = channel (0-15). Data: note (0-127), velocity (0-127) |
| Note Off | `0x8x` | x = channel. Data: note (0-127), velocity (0) |
| Control Change | `0xBx` | x = channel. Data: CC# (0-127), value (0-127) |
| Pitch Bend | `0xEx` | x = channel. Data: LSB (0-127), MSB (0-127) → 14-bit value |
| Program Change | `0xCx` | x = channel. Data: program# (0-127) |

---

## MIDI Modes

### 1. Live Play Mode (Default)

MIDI note on/off triggers synth audio in real-time (same as clicking keyboard keys).

- `noteOn(midiNote)` → convert to note name (e.g., `60` → `"C4"`) → call `synthAudio.playNote(noteName, params)`
- `noteOff(midiNote)` → call `synthAudio.releaseNote(noteName)`
- Velocity maps to gain (0-127 → 0.0-1.0)
- MIDI channel 1-4 maps to Synth 1-4 (configurable)

### 2. Record to Pattern Mode

MIDI notes write into the current pattern's steps.

- Transport must be playing (use existing `isPlaying` state)
- On `noteOn`: find current step based on playback position → write note into `pattern.steps[currentStep].note`
- Velocity stored in step data
- Quantize option: snap note to nearest step boundary (configurable grid resolution)
- Overdub: notes added without erasing existing notes
- Replace: new notes erase existing notes in the same step

### 3. Step Record Mode

Press a key to advance to the next step and place a note there.

- On each `noteOn`: write note to `pattern.steps[stepPointer]`, advance `stepPointer`
- Rest: press a dedicated button (or MIDI CC) to advance without placing a note
- Works without transport playing

---

## MIDI CC Mapping

### Default CC Assignments

| CC# | Parameter | Range |
|-----|-----------|-------|
| 1 | Filter Cutoff | 0-127 → 20-20000 Hz (exponential) |
| 7 | Master Gain | 0-127 → 0.0-2.0 |
| 11 | Filter Resonance | 0-127 → 0-30 |
| 71 | LFO Depth | 0-127 → 0-100% |
| 74 | LFO Rate | 0-127 → 0.1-20 Hz |
| 73 | Attack | 0-127 → 0-5s |
| 75 | Decay | 0-127 → 0-5s |
| 70 | Sustain | 0-127 → 0-100% |
| 72 | Release | 0-127 → 0-5s |
| 91 | Reverb Send | 0-127 → 0-1 |
| 94 | Delay Send | 0-127 → 0-1 |

### MIDI Learn Mode

1. User clicks "Learn" button on any knob/slider in SynthControls
2. Panel enters MIDI learn mode (visual indicator: knob pulses)
3. User moves a MIDI CC
4. That CC is permanently bound to that parameter
5. Bindings stored in localStorage, per synth

---

## MIDI Device Selection

- Dropdown lists available MIDI input devices (from `MIDIAccess.inputs`)
- Default: first available device
- Multiple devices supported (additive — all active inputs listened to)
- Device status indicator: green dot = connected, red = disconnected
- Auto-reconnect on device hot-plug (listen to `onstatechange`)

---

## UI: MidiPanel Component

Located below the keyboard in each synth unit, or as a global panel in the header.

```
┌──────────────────────────────────────────────┐
│ MIDI: [dropdown: Select Device ▼] ● Connected │
│ Mode: [Live] [Record] [Step]    [Learn] [⚙]  │
│ Channel: 1 → Synth 1   CC Bindings: 8 active │
└──────────────────────────────────────────────┘
```

- **Device dropdown**: Select MIDI input
- **Mode toggle**: Three buttons (Live / Record / Step)
- **Channel mapping**: Which MIDI channel maps to which synth
- **Learn button**: Enter/exit MIDI learn mode
- **Settings gear**: Open CC mapping panel
- **Status dot**: Connection state

---

## Implementation Plan

### Phase 1: Core MIDI Input
1. Create `useMidiInput.ts` hook
   - Request `MIDIAccess`, enumerate inputs
   - Parse MIDI messages (note on/off, CC, pitch bend)
   - Expose `midiState: { connected, devices, lastMessage }`
   - Expose `setDevice(deviceId)` and `setChannel(channel)`
2. Wire note on/off to `synthAudio.playNote` / `synthAudio.releaseNote` in App.tsx
   - Convert MIDI note number to note name: `midiNoteToName(60)` → `"C4"`
   - Apply velocity to gain
3. Test with virtual MIDI port

### Phase 2: MIDI Panel UI
4. Create `MidiPanel.tsx` — device selector, mode toggle, status display
5. Add to `SynthUnit` (below keyboard) or as a global header element
6. Style to match dark theme

### Phase 3: Record Mode
7. Implement record-to-pattern: map current playback step to note insertion
8. Implement quantize option (snap to step boundaries)
9. Implement step-record mode (advance pointer per note)
10. Wire pattern updates to server via existing WebSocket

### Phase 4: CC Mapping
11. Build CC parser that maps incoming CC values to synth parameters
12. Implement default CC mapping table
13. Add MIDI learn mode (click knob → receive CC → bind)
14. Persist bindings in localStorage
15. Add CC mapping display in settings panel

### Phase 5: Polish
16. Handle MIDI device hot-plug (auto-reconnect)
17. Add pitch bend support (pitch bend → detune parameter)
18. Add sustain pedal (CC 64) → hold mode toggle
19. Add panic button (all notes off: send MIDI `0xBx 123 0`)
20. Handle browser permission denied gracefully

---

## Note Number Conversion

```typescript
function midiNoteToName(midi: number): { note: string; octave: number } {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1; // MIDI 60 = C4
  return { note: notes[noteIndex], octave };
}

function nameToMidi(note: string, octave: number): number {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteIndex = notes.indexOf(note.replace(/\d/g, ''));
  return (octave + 1) * 12 + noteIndex;
}
```

## CC Value Conversion

```typescript
function ccToRange(value: number, min: number, max: number, curve: 'linear' | 'exp' = 'linear'): number {
  const normalized = value / 127;
  if (curve === 'exp') {
    return min * Math.pow(max / min, normalized);
  }
  return min + normalized * (max - min);
}
```

---

## Browser Compatibility

| Browser | Web MIDI | Notes |
|---------|----------|-------|
| Chrome 43+ | Yes | Full support |
| Edge 79+ | Yes | Full support |
| Opera 29+ | Yes | Full support |
| Firefox | No | Behind flag `dom.webmidi.enabled`, not default |
| Safari | No | No support as of 2026 |

Graceful fallback: If `navigator.requestMIDIAccess` is undefined, hide MIDI panel and show "MIDI not supported in this browser" message.

---

## Testing

1. Use a physical MIDI keyboard connected via USB
2. Use a virtual MIDI port (loopMIDI on Windows, IAC Driver on Mac) with a MIDI keyboard app (e.g., VMPK)
3. Test all three modes: Live, Record, Step
4. Test CC mapping with knobs/sliders
5. Test device hot-plug (unplug/replug USB)
6. Test graceful fallback in Firefox

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
