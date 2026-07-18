# Improvement Ideas — Discobot

## Implemented (July 2026)

### Undo/Redo (per-pattern)
- Undo/redo stack now tracks pattern edits including:
  - note add/remove/toggle
  - per-step velocity edits
  - synth parameter edits
  - drum pattern/parameter edits
- Keyboard shortcuts:
  - Undo: `Ctrl/Cmd + Z`
  - Redo: `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`

### MIDI Export (.mid)
- Header includes **Export MIDI** for current state.
- MIDI export writes a Standard MIDI File (Type 1) with:
  - tempo meta event from project BPM
  - one synth track per active synth lane
  - drum track on channel 10
- Drum note mapping (GM-style):
  - kick: 36
  - snare: 38
  - snare2: 40
  - clap: 39
  - closedHH: 42
  - openHH: 46
  - crash: 49
  - ride: 51
- Limitation: audio-domain synth FX are not embedded in MIDI.

### Arpeggiator MVP
- Per-synth arpeggiator controls added:
  - toggle
  - mode: `up`, `down`, `random`
  - rate: `1/8`, `1/16` (BPM-synced)
  - gate control (0.1–1.0)
- Arpeggiator settings persist with synth parameters (and therefore pattern saves).

### Synth Presets (independent from pattern)
- Presets can be saved/loaded/deleted independently from pattern save data.
- Built-in starter presets included: **Pad, Bass, Lead, Pluck**.
- User presets persist in browser local storage.

## Synth Features

### Missing Common Functionality
- **Arpeggiator**: Per-synth arp with up/down/updown/random patterns, rate synced to BPM, gate length control
- **Preset system**: Save/load synth parameter presets (separate from pattern save) — common starting points like "Pad", "Bass", "Lead", "Pluck"
- **Stereo spread / unison**: Duplicate oscillator with detune + pan for thicker sound
- **Pulse width modulation (PWM)**: For square wave — modulate duty cycle via LFO or envelope
- **Ring modulation**: Cross-modulate two oscillators for metallic/dissonant textures
- **Frequency modulation (FM)**: Operator-style FM synthesis between oscillators
- **Sub oscillator**: Second oscillator one octave below, sine or triangle, for weight
- **Voice polyphony**: Currently monophonic — add configurable voice count (2-8) with voice stealing
- **Portamento / glide**: Pitch slide between consecutive notes, configurable time
- **Velocity sensitivity**: Map note velocity to filter cutoff, amp, or other parameters
- **Aftertouch**: Map pressure to filter cutoff or vibrato
- **Sync / Retrigger**: Oscillator hard sync, envelope retrigger modes
- **Second filter type**: Add highpass, bandpass, notch options alongside the existing lowpass
- **Parallel filter routing**: Split signal through two filters simultaneously

### UI/UX for Synths
- **Visual waveform display**: Show the oscillator waveform shape in the synth panel
- **Filter frequency response graph**: Real-time visualization of the filter curve
- **Envelope visualizer**: Show ADSR shape with draggable points
- **LFO rate sync to BPM**: Display rate as note values (1/4, 1/8, 1/16, etc.) instead of raw Hz

---

## Drum Machine Features

### Missing Common Functionality
- **Multiple kits**: Already has 3 kits — expand to user-definable kits or more built-in options
- **Per-step pitch/tuning**: Tune individual hits on the grid (e.g., pitched kick pattern)
- **Flam / drag**: Per-step flam timing for more human feel
- **Swing / groove**: Global swing parameter (50-75%), or per-instrument shuffle
- **Humanize**: Randomize timing slightly per step for organic feel
- **Velocity per step**: Currently master velocity per instrument — add per-step velocity in the grid
- **Fill patterns**: Quick one-button fill generation (e.g., "add hi-hats on every 8th note")
- **Reverse playback**: Per-instrument reverse for cymbal swells, snare rolls
- **Layering**: Layer two instruments on the same step (e.g., kick + sub)
- **Drum roll / ratchet**: Repeat a step rapidly (1/32, 1/64) with decay
- **Sidechain / ducking**: Route kick to duck other instruments for pumping effect
- **Pattern chains**: String multiple drum patterns together for longer arrangements
- **MIDI output**: Send drum MIDI to external hardware or other DAWs

### UI/UX for Drums
- **Waveform preview per instrument**: Show what each drum hit sounds like
- **Mixer view**: Horizontal faders for all 8 instruments at once (like a hardware mixer)
- **Solo/mute group buttons**: Group multiple instruments (e.g., mute all cymbals)
- **Velocity bars in grid**: Show velocity as vertical bar height inside each cell

---

## Global / System Features

### Transport & Arrangement
- **Song mode**: Chain multiple patterns into a linear arrangement (intro → verse → chorus → etc.)
- **Pattern groups / banks**: Organize patterns into sets (e.g., "Verse patterns", "Chorus patterns")
- **Loop points**: Set start/end loop within a pattern
- **Time signatures**: Support 3/4, 6/8, 5/4, 7/8 beyond the current 4/4
- **Tap tempo**: Click a button in time to set BPM
- **Tempo automation**: Gradual tempo changes over time (accelerando/ritardando)

### Recording & Export
- **Real-time recording**: Record from keyboard/MIDI input directly into pattern
- **Undo/redo**: Per-pattern undo stack for edits
- **WAV export**: Download rendered pattern as WAV file
- **Multi-track export**: Export each synth/drum as separate stems
- **Session recording**: Record entire session (multiple patterns, transitions) as single audio file

### Collaboration & Multiplayer
- **Multiple users editing**: Multiple people controlling different synths simultaneously
- **Chat / messaging**: In-app text chat for collaborators
- **User roles**: Owner, editor, viewer permissions
- **Jam mode**: Everyone's inputs mixed in real-time with voting on tempo/key

### Modern / Trending Features
- **AI-assisted composition**: Suggest patterns, melodies, or chord progressions based on current state
- **Spectral / granular synthesis**: Experimental sound design modes
- **Modular routing**: Drag-and-drop signal flow editor (connect any output to any input)
- **Visual audio feedback**: Real-time spectrum analyzer, oscilloscope, spectrogram
- **Responsive mobile UI**: Touch-optimized layout for phone/tablet use
- **PWA support**: Install as app, offline mode with cached assets
- **WebSocket reconnection**: Graceful reconnect with state recovery on connection drop
- **Cloud sync**: Save/load patterns to cloud account (Google Drive, Dropbox)
- **Social sharing**: Share patterns as links with playback in browser
- **Sound packs / marketplace**: Community-contributed presets, kits, patterns

### Developer / Power User
- **Scripting / automation API**: JavaScript expressions for parameter modulation over time
- **OSC protocol support**: Open Sound Control for inter-app communication
- **LVST / VST plugin mode**: Host Discobot as a plugin inside a DAW
- **MIDI learn**: Click any knob, move a MIDI controller to bind it
- **Macro controls**: Map multiple parameters to a single macro knob
- **Snapshot / morphing**: Save parameter snapshots and morph between them

<!-- AUTO_PR_CHANGELOG_START -->
### PR #52: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T12:38:44.155Z

#### Changed files
- `engine/src/types.ts` — MODIFIED (+9/-0)
- `ui/src/App.css` — MODIFIED (+42/-16)
- `ui/src/App.tsx` — MODIFIED (+294/-127)
- `ui/src/components/SynthUnit.css` — MODIFIED (+10/-45)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+23/-99)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+27/-13)
- `ui/src/hooks/usePatternAudio.ts` — MODIFIED (+29/-6)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+28/-1)
- `ui/src/types.ts` — MODIFIED (+1/-0)
- `web/src/index.ts` — MODIFIED (+44/-26)
<!-- AUTO_PR_CHANGELOG_END -->
