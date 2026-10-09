# Control audit

## Scope and method

Every component in `ui/src/components` was inspected. The audit followed component
callbacks into `App.tsx`, browser-local project storage and the browser audio hooks.
Controls are not considered verified just because a knob or LED moves: browser
tests inspect persisted musical data, exercise playback, and reject page errors,
console errors, failed requests, WebSockets and requests outside `/discobot/`.

## Control inventory

| Component / controls | State and audio path | Corrections / coverage |
| --- | --- | --- |
| `Knob`, `DrumKnob`: rotary drag, typed values | Parent callback → parameter/settings update → local project → audio lane | Pointer capture supports mouse/touch/pen; cancellation, blur and unmount cleanup; keyboard arrows/Page/Home/End; accessible slider/value labels; clamped stepped values; Enter commits once and Escape cancels. |
| `SynthControls`: waveform, detune, filter type/cutoff/resonance | `onParameterChange` → synth parameters → AudioWorklet parameters | Unit-aware cutoff and gain entry; persisted-state checks and all enabled rotary controls exercised. |
| `SynthControls`: both LFO enables, waves, targets, depth/rate and tempo sync | Synth parameters → tempo-aware worklet parameter mapping | Native focusable toggle hit areas; synced `1/16` input parses denominator instead of `116`; browser coverage includes both LFOs. |
| `SynthControls`: ADSR and shape display | Envelope fields → synthesis envelope | Millisecond entry; shape sustain segment uses the same time scale as other segments; keyboard changes and durable state covered. |
| `SynthControls`: pan, spread, portamento/glide | Stereo and glide fields → audio hook/worklet | Center/left/right percentage pan parsing; glide milliseconds; disabled controls remain noninteractive. |
| `SynthControls`: hold, arpeggiator enable/mode/rate/gate | Keyboard latch / App arpeggiator scheduler → note events | Named accessible toggles/selects; keyboard sustain and audio note-on/note-off protocol checks; arpeggiator state persistence. |
| `SynthControls`: models, macros, sound presets | Model mapping / preset recall → parameters and audio | Twelve additional named Bass/Lead/Pad/Pluck sounds; all model macro groups selectable; blank preset save disabled; built-ins cannot be deleted; user save/load/delete/reload tested. |
| `SynthControls`: engine (Analog/FM), oscillator 2, sub, noise, pulse width, filter envelope/amount/key tracking/drive, voice mode, velocity and accent, LFO targets and phase mode, FM algorithm/ratio/amount/decay/feedback | Synth parameters → `toVoiceParams` → `SynthCore` (worklet live, offline for WAV) | Engine tests assert every parameter changes rendered audio; a browser test asserts the controls persist. Not verified by listening. |
| `Sequencer`: per-step Slide | Step `slide` flag → note held into the next step → mono legato glide | Unit tests cover the longer gate and the missing retrigger in exported audio; browser test covers persistence. |
| `SynthUnit`: mute, solo, remove | Per-synth mix and lane lifecycle | Toggle pressed state exposed; callbacks retained; removal is only offered for removable synths. |
| `Keyboard`: white/black keys | Note callbacks → live note audio; selected-step assignment | Fixed effects that immediately released every newly pressed note; touch/pointer and Space/Enter play/release; cancellation, visibility loss, octave change and unmount release held notes; all notes named. |
| `KeyboardPanel`: editor mode, octave limits | Selected synth keyboard mode/octave → keyboard or piano roll | Named pressed mode buttons; octave boundaries retained; held-note release tested. |
| `PianoRoll`: assign/erase/drag/clear | Shared step data → sequencer schedule | Pointer/touch paint, cancellation/blur cleanup and native keyboard activation; named pressed cells; minimum-width horizontal scrolling instead of crushed mobile cells. |
| `Sequencer`: pattern, length, step selection, velocity, saved patterns | Local project request adapter → pattern steps/history | Removed backend/auth request dependency; local save notifications refresh menus; errors visible; names/pressed step state; mobile horizontal scrolling; saved-pattern dialog Escape/focus trap/restore. |
| `DrumMachine`: kit/defaults, eight instrument selectors and volume/tone/tune/extra/humanize/pan | Drum state → local storage → synthesized drum previews/schedule | Distinct accessible instrument controls; pan parser corrected; preview velocity respected and disabling a hit no longer previews it; each instrument's common settings and mute/solo checked. |
| `DrumMachine`: steps, velocity, chance, repeats, fill/shift/reverse/duplicate | Boolean steps + per-step velocities, probabilities and repeat counts → `expandDrumStep` → drum schedule and exports | Explicit mobile-accessible velocity and chance sliders and a repeats select; shift/reverse/duplicate carry all three with hits; tests assert repeat timing, that a 0% step never plays, and persisted values. |
| Computer keyboard (A–L row, W E T Y U O P, Z/X) | `useComputerKeyboard` → the same note handlers as the on-screen keys | Ignored while typing in a field or with a dialog open; releases on blur, lane switch and stop; pressed keys light the on-screen keyboard. Browser test covers notes, octave, step entry and text fields. |
| Header: Loop WAV, Stems, Export Project, Import Project | `wavExport` loop/stem renders; `localService` project file | Loop length asserted to the sample; stems unzip to aligned non-silent WAVs; project file round-trip, cancel, and a non-project file are tested. |
| `DrumMachine`: master, swing, FX sends/returns, global mix/reset | Drum mix and shared effects → browser audio | Honest “Clear Solos” label replaces misleading “Solo All”; pressed mute state; removed obsolete Discord return description; musical save workflow includes swing, kit, sends and accents. |
| `EffectsPanel`: enable, drive, phaser, delay, reverb | Shared effects state → browser effects buses | Restored master bypass control and exposed phaser feedback; distinct enable labels; delay milliseconds; every effects rotary control and persisted returns tested. |
| `MixerPanel`: synth/drum gain, pan, FX returns, mute/solo | Same synth/drum/effects state as detailed controls → audio lanes | Named faders and pressed mix buttons; durable state and shared-control synchronization tested. |
| `MidiPanel`: device, channel, synth target, live/record/step | Web MIDI parsing → App routing → note/step/CC handlers | Unsupported, permission-denied and no-device states are visible rather than disappearing; device/channel/target labels and pressed modes; simulated channel filtering and step routing tested. |
| `SamplePanel`: import, play, delete | IndexedDB sample records → browser decode/playback | Accessible file/button controls; busy/error states; desktop/mobile import/play/delete/reload tests use generated WAV audio. |

## Automated checks

`npm run test:browser` uses Chromium desktop and emulated Pixel 7 touch viewports.
The server builds a production bundle, serves the actual `/discobot/` base path,
and uses per-port build directories so concurrent builds cannot delete assets
under active tests. Browser profiles and downloads use a project-local runtime
directory. Set `PLAYWRIGHT_PORT` when running alongside another preview server.

`ui/test/browser/controls.spec.ts` covers:

- A musical pattern with notes/velocities, synth sound, drum kit/accent/pan/swing,
  effect settings, save, destructive edits, load, playback/stop and reload.
- Rotary keyboard bounds, unit-aware typed values, cancellation and pointer cleanup.
- Keyboard sustain/hold/octave release and actual worklet note-event delivery.
- Named sound families, vintage-model macros and user preset persistence/deletion.
- Synth/effects/mixer state changes, all drum instrument control families and
  accent-preserving pattern tools.
- Saved-pattern menu refresh, deletion and modal focus trapping/restore.
- IndexedDB sample playback and persistence.
- Simulated MIDI channel/target routing, denied permissions, MIDI file round-trip,
  real MIDI header and non-silent WAV downloads.

### Verification status

The twenty main desktop/mobile scenarios and both saved-pattern manager scenarios
passed locally against the production bundle. Two additional first-note-loading
regression cases currently expose an audio-hook race: releasing a live key while
the worklet is loading can still enqueue its note afterward. Those cases remain
enabled, not skipped; the audio owner must fix the cancellation path before the
complete suite is green.

## Honest limitations

- Headless playback verifies successful audio initialization, worklet note events
  and non-silent exported PCM; it is not a listening test or a guarantee of
  perceptual sound quality on every device.
- MIDI input tests simulate hardware. Physical controllers, hot-plug behavior and
  browser/OS MIDI drivers still require manual checks.
- Mobile tests use Chromium touch emulation, not a physical phone. Firefox/Safari
  Web MIDI limitations are described in the UI, but those browsers are not run by
  this suite.
- Component-family coverage does not mean every possible parameter combination,
  timing race, repeated random fill result or browser storage-quota limit has been
  exhaustively tested.
- Saved projects and samples are device-local. Clearing site data removes them;
  there is no server account, Discord synchronization or cross-device recovery.
