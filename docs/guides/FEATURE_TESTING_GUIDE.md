# Feature Testing Guide (Undo/Redo, MIDI Export, Arpeggiator, Presets, Drum FX Routing)

## Prerequisites
1. Start app: `npm run dev`
2. Open UI and complete Discord `/login` flow.
3. Ensure at least one synth lane is visible.

## 1) Undo/Redo
1. Select a step in a synth sequencer and assign a note from keyboard.
2. Press `Ctrl/Cmd + Z`.
   - Expected: note is removed.
3. Press `Ctrl/Cmd + Shift + Z` (or `Ctrl/Cmd + Y`).
   - Expected: note returns.
4. Select the same step and move velocity slider in sequencer footer.
5. Undo and redo again.
   - Expected: velocity value reverts/restores.
6. Change a synth knob (e.g., cutoff), then undo/redo.
   - Expected: knob value reverts/restores.
7. Toggle a drum step and change drum knob value, then undo/redo.
   - Expected: drum edits revert/restore.
8. Switch to another pattern and perform edits.
   - Expected: undo/redo affects current pattern history without corrupting other pattern state.

## 2) MIDI Export (.mid)
1. Program notes on at least one synth lane.
2. Program a few drum hits (kick/snare/hats).
3. Set BPM to a non-default value (e.g., 132).
4. Click **Export MIDI** in header.
   - Expected: `.mid` file downloads.
5. Import file into a DAW (Ableton/FL/Logic/Reaper or any MIDI inspector).
   - Expected:
     - tempo matches selected BPM
     - synth notes appear on separate synth tracks
     - drums are on MIDI channel 10
     - no stuck notes (all notes have note-off)

## 3) Arpeggiator MVP
1. In synth controls, enable **ARP**.
2. Set mode to `up`, rate to `1/16`, gate around `0.5`.
3. Trigger notes from keyboard or start sequencer playback.
   - Expected: audible repeated/arpeggiated motion.
4. Change mode to `down`, then `random`.
   - Expected: playback order changes accordingly.
5. Change rate from `1/16` to `1/8`.
   - Expected: arp speed follows BPM-synced division.
6. Adjust gate from short to long.
   - Expected: note length per arp pulse changes.

## 4) Synth Presets
1. Dial in a custom synth sound.
2. Enter preset name and click **Save** in preset controls.
   - Expected: preset appears in preset list.
3. Change synth settings heavily.
4. Load the saved preset.
   - Expected: saved settings restore.
5. Delete selected user preset.
   - Expected: it is removed from list.
6. Refresh browser.
   - Expected: user presets persist (local storage), built-in presets remain available.
7. Save/load patterns and verify presets are independent.
   - Expected: pattern operations do not overwrite preset library.

## 5) Help UI + Docs
1. Click **Help**.
   - Expected: expanded help content includes quick start, header controls, shortcuts, synth/drum workflow, and FX return notes.
2. Verify docs updates:
   - `README.md`
   - `docs/guides/QUICK_START.md`
   - `docs/guides/FEATURE_TESTING_GUIDE.md`

## 6) Drum FX Return Placement
1. Open **Effects Loop** panel.
   - Expected: no standalone drum return knob in this panel.
2. Open **Rhythm Composer**.
   - Expected: controls include `FX Return` and `Loop Return` in drum controls.
3. Adjust `Loop Return`.
   - Expected: wet drum amount from global loop changes while synth wet return remains unchanged.

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
