# Roadmap — Improvements and High-Value Features

Written 2026-10-08 against the `feat/synthesis-rewrite` branch. Items are
ordered by value for the effort within each section. Sizes are rough:
**S** is a day or less, **M** is a few days, **L** is a week or more.

## Design and implementation improvements

These do not add features. They remove the things most likely to cause bugs or
slow down every later change.

1. **Replace the REST-shaped store with a typed one, and split `App.tsx`.** (L)
   `localRequest('/synth/1/parameters', { method: 'POST', body: JSON.stringify(...) })`
   is a leftover from the server version: every edit is serialized to a string,
   routed by regex, parsed, applied, then echoed back as an event that
   `App.tsx` applies a second time on top of its own optimistic update. Replace
   it with a store exposing typed methods (`store.setSynthParams(id, patch)`)
   and a single subscription, and move state out of `App.tsx` (about 2,800
   lines) into hooks per concern: transport, history, MIDI, persistence. This
   is the prerequisite for song mode and removes a class of
   state-applied-twice bugs.

2. **Make undo a store feature.** (M, after 1)
   Undo snapshots are assembled by hand in `App.tsx`, and each handler must
   remember to push one; several did not until recently. With a typed store,
   record every mutation as a patch automatically and group patches made
   during one drag. A whole-project undo entry also fixes the current limit
   that an entry restores only one synth lane.

3. **Move saved arrangements and presets to IndexedDB.** (M)
   localStorage is synchronous, capped at roughly 5 MB, and rewritten in full
   on every edit, including every saved arrangement. Keep only the live
   project in localStorage (or move it too) and store arrangements as separate
   IndexedDB records. This also allows export and import of a single
   arrangement as a file.

4. **Guard against two tabs.** (S)
   Two tabs share one project key and silently overwrite each other. Use a
   `BroadcastChannel` or the Web Locks API to detect a second tab and either
   make it read-only or reload it when the other tab saves.

5. **Debounce persistence.** (S)
   Dragging a knob serializes and writes the entire project on every pointer
   move. Write on a trailing 250 ms timer and on `visibilitychange`/`pagehide`.

6. **Stop re-rendering the whole app on every step.** (M)
   The playhead position lives in React state at the top of the tree, so all
   controls re-render 8 to 16 times a second during playback. Move the
   playhead to a ref or a small external store read only by the step lights.

7. **Give the audio layer a single owner.** (M)
   `browserAudio.ts` keeps the context, buses and effects in module-level
   variables, which makes it awkward to test and impossible to tear down
   cleanly. Wrap them in an `AudioEngine` class created once and passed to the
   hooks.

8. **Type the worklet messages.** (S)
   Messages to the processors are untyped object literals on one side and
   `data.type === ...` checks on the other. Share a discriminated union from
   the engine so a renamed field is a compile error.

9. **Pitch LFO depth is too coarse.** (S)
   Depth 100% is ±1 octave, so a usable vibrato sits in the bottom 2% of the
   knob. Give the pitch target its own scale (for example ±1 semitone at 100%)
   and migrate stored values.

10. **CI housekeeping.** (S)
    `ci.yml` and `pages.yml` run the same checks on every push to `main`;
    have Pages depend on CI instead. Bump `configure-pages` and `deploy-pages`
    off Node 20. The `pr-review.yml` workflow cannot review anything larger
    than 100 KB and depends on a model endpoint; decide whether to keep it.

11. **Accessibility pass on custom controls.** (M)
    Knobs are keyboard-operable, but the step grids are long runs of unlabeled
    buttons for a screen reader, and modals other than the pattern manager do
    not trap focus. Add roving tab index to grids and a shared modal component.

## Sound and synthesis

The voice rewrite on this branch covers oscillators, filter, envelopes, FM,
mono/slide and the drum voices. What it leaves open:

1. **Listen and tune.** (M)
   Nothing on this branch has been verified by ear. Levels, envelope ranges,
   kit characters and the model macros were set from measurements and
   reasoning. A listening session with adjustments is the highest-value sound
   work remaining.

2. **Samples on the drum grid and as a synth source.** (M)
   The sampler stores files in IndexedDB but they can only be auditioned. Let
   each drum lane choose a stored sample instead of its synthesized voice
   (decoded once, posted to the drum worklet), which is also the honest way to
   do LinnDrum, DMX and TR-707 kits. A one-shot or looped sample oscillator in
   the synth is a natural follow-up.

3. **Unison and a 24 dB filter mode.** (S each)
   Unison (several detuned copies per note) is the missing piece for big
   leads and pads. A four-pole ladder mode alongside the current two-pole
   filter gives the steeper Moog and 303 character.

4. **A modulation matrix.** (M)
   Sources (two LFOs, both envelopes, velocity, key, mod wheel) routed to any
   destination with a depth, replacing the fixed LFO target dropdowns.

5. **Insert effects per lane and better shared effects.** (M)
   A chorus would do more for the Juno model than anything else. The reverb is
   decaying noise through a convolver; a small algorithmic reverb with
   pre-delay and damping would sound better and cost less. Tempo-synced delay
   times are an easy win.

6. **Sidechain ducking and a master EQ.** (S each)
   Kick-triggered ducking of a synth lane is central to the dance styles this
   tool suits, and is one gain envelope.

## Features

1. **Song mode.** (L) See `docs/SONG_MODE_PLAN.md`.

2. **Longer patterns and per-lane length.** (M)
   Patterns are one bar. Allowing 2, 4 or 8 bars, and lanes of different
   lengths running against each other, makes far more music possible than any
   single synthesis feature.

3. **Polyphonic steps and note length.** (M)
   A step holds one note with a fixed gate. Chords per step and a per-step
   length (so a note can last several steps) turn the piano roll into a real
   one. The engine is already eight-voice.

4. **Project files: export and import.** (S)
   Everything lives in one browser profile and is lost if site data is
   cleared. A "Download project" button writing JSON (and "Open project") is a
   backup, a way to move between devices, and a way to share.

5. **Record live playing against the clock.** (M)
   MIDI record mode writes to the step under the playhead. Add a metronome, a
   count-in and quantize strength so playing in a part is practical, from the
   on-screen keyboard as well as MIDI.

6. **Computer keyboard as a piano.** (S)
   Map the A–L row to notes with Z/X for octave. Most users have no MIDI
   controller, and clicking keys with a mouse is not playing.

7. **Parameter automation.** (L)
   Record knob movements per step or per bar and play them back. Filter sweeps
   over a section are a large part of electronic arrangement. Depends on the
   typed store.

8. **MIDI output and clock.** (M)
   Drive external hardware from the sequencer, and send or follow MIDI clock.
   Web MIDI is already in use for input.

9. **Per-step probability and ratchets on drums.** (S)
   A chance value and a repeat count per step give variation that the fixed
   16-step grid cannot, for very little code.

10. **Stem and loop export.** (S)
    Export each lane and the drums as separate WAV files, and offer a
    tail-wrapped loop export that repeats seamlessly. Both reuse the existing
    offline render.

11. **Installable, offline-capable app.** (S)
    A web manifest and a service worker make it installable and usable with no
    connection. The app already needs no network after load.

12. **Shareable links.** (M)
    Compress a project into the URL fragment so a pattern can be shared with a
    link and no backend. Limited to small projects by URL length.

## Suggested order

1. Listen and tune the new voices (sound item 1).
2. Project file export/import and the computer-keyboard piano: small, and they
   remove the two most common frustrations.
3. Typed store and `App.tsx` split, with debounced persistence and the
   two-tab guard folded in.
4. Song mode.
5. Samples on the drum grid.
6. Longer patterns, then polyphonic steps and note length.
