# Roadmap — Improvements and High-Value Features

Written 2026-10-08 against the `feat/synthesis-rewrite` branch. Items are
ordered by value for the effort within each section. Sizes are rough:
**S** is a day or less, **M** is a few days, **L** is a week or more.

## Design and implementation improvements

The UI was rebuilt as a single rack (transport, three synth lanes, drum grid,
effects) on the `feat/rack-ui` branch. That moved all behaviour out of
`App.tsx` into `ui/src/studio/useStudio.tsx`, which is the first half of item 1
below; the typed store is still to do.

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

4. **Guard against two tabs.** Done: a tab stops saving when another tab
   writes the project, and asks which version to keep.

5. **Debounce persistence.** Done.

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

9. **Pitch LFO depth is too coarse.** Done: a Vibrato LFO target is the
   pitch target scaled to one semitone at full depth. Pitch is unchanged, so
   nothing stored had to be migrated.

10. **CI housekeeping.** (S)
    `ci.yml` and `pages.yml` run the same checks on every push to `main`;
    have Pages depend on CI instead. Bump `configure-pages` and `deploy-pages`
    off Node 20. The AI review workflow was removed: the model service it
    called was retired.

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

2. **Samples on the drum grid and as a synth source.** Drum lanes are done:
   each lane can play an imported sample, live and in export. Still open:
   samples do not travel with a project (file, link or sync), ready-made
   sampled kits for the LinnDrum, DMX and TR-707, and a sample oscillator in
   the synth.

3. **Unison and a 24 dB filter mode.** Done. The 24 dB mode is two cascaded
   state-variable stages, not a ladder model; a true ladder with its
   characteristic resonance and bass loss is still open. The Minimoog and
   TB-303 models do not switch to 24 dB by themselves yet.

4. **A modulation matrix.** (M)
   Sources (two LFOs, both envelopes, velocity, key, mod wheel) routed to any
   destination with a depth, replacing the fixed LFO target dropdowns.

5. **Insert effects per lane and better shared effects.** Partly done: a
   stereo chorus is a fifth shared effect with its own send, and the reverb
   has pre-delay and damping. It is still a convolver, with a shaped impulse;
   an algorithmic reverb and per-lane insert effects are open. Tempo-synced
   delay time is done (Sync on the shared delay).

6. **Sidechain ducking and a master EQ.** Ducking is done (per-lane Duck
   amount, kick only, fixed recovery time). Master EQ is done: three bands
   on the whole mix, live and in export.

## Features

1. **Song mode.** Done; `docs/SONG_MODE_PLAN.md` lists what was left out
   (copy and paste between scenes, sharing a part between scenes). Mutes and
   solos are now kept per scene.

2. **Longer patterns and per-lane length.** Done: each synth lane and the
   drum grid can be 1, 2, 4 or 8 bars, and lanes of different lengths loop
   against each other. MIDI files of up to eight bars import at their
   full length. Still open: lengths that are not a whole number of bars (a
   12-step lane against 16) and copying one bar to another.

3. **Polyphonic steps and note length.** Done: up to six notes per step and
   a per-step length, in the piano roll, live playback, WAV and MIDI export
   and MIDI import. A note's length can be dragged by its end in the piano roll,
   and a step can start late (Timing, or Alt+click) so a note sits between
   steps. Still open: a step holds one start time, so an on-the-step note and
   a late one cannot share a step; a 32-step lane is the way to get both.

4. **Project files: export and import.** Done. Samples are not yet included
   in the file.

5. **Record live playing against the clock.** (M)
   MIDI record mode writes to the step under the playhead. Add a metronome, a
   count-in and quantize strength so playing in a part is practical, from the
   on-screen keyboard as well as MIDI.

6. **Computer keyboard as a piano.** Done.

7. **Parameter automation.** (L)
   Record knob movements per step or per bar and play them back. Filter sweeps
   over a section are a large part of electronic arrangement. Depends on the
   typed store.

8. **MIDI output and clock.** Done for sending: the sequencer plays a chosen
   MIDI output (a channel per lane, drums on 10) and sends clock with start
   and stop. Still open: following an external clock, sending notes played
   by hand, and choosing the channels.

9. **Per-step probability and ratchets.** Done, on drums and on synth steps.

10. **Stem and loop export.** Done.

11. **Installable, offline-capable app.** Done.

12. **Shareable links.** (M)
    Compress a project into the URL fragment so a pattern can be shared with a
    link and no backend. Limited to small projects by URL length.

13. **Collaborative sessions.** (L)
    A signed-in user starts a session on a project and shares it with another
    signed-in user, and the two work on the song together. Open questions to
    settle before building:
    - Live or turn-based. Live means both see each other's edits as they
      happen, which needs a connection held open between them (a Cloudflare
      Durable Object with WebSockets is the natural fit for the current
      server; note `AGENTS.md` rules out reintroducing a WebSocket transport,
      so that rule would have to be revisited on purpose). Turn-based means a
      shared project both can save to, using the revision check sync already
      has, with no new kind of connection.
    - What is shared: edits only, or playback position and who is editing
      what as well. Each person hears their own browser's audio either way.
    - How two edits to the same thing are settled. Today's sync never merges;
      it keeps both copies. A session needs a real rule (last edit per step
      or per control wins is the simplest that feels right).
    - Who may join: by username, by a session code, or both; how the owner of
      the project ends a session or removes someone.
    - Guest instruments and imported samples are per browser today, so a
      collaborator may not have them.
    - The typed store (improvements item 1) should come first: edits need to
      be small, named operations to send to another person.

14. **Kids mode.** (M)
    A mode a four-year-old can use without reading. A starting point:
    - A few very large, colourful pads and a big play button; no menus, small
      knobs, text fields or dialogs.
    - Everything always sounds good: notes held to one scale, a fixed tempo
      range, sounds chosen from a handful of pictures.
    - Tapping makes sound at once (touch first, phone and tablet sized).
    - Nothing can be lost or broken: it works on its own scratch project, and
      cannot delete, overwrite, share, publish or reach account settings.
    - A capped volume.
    - A way out that a small child will not trigger by accident (press and
      hold, or a simple sum for the adult).
    - No account needed and no requests to anywhere, like the rest of the app.
    To decide: whether what a child makes can be opened later in the full
    app, and whether it is a separate page or a switch in the transport bar.

15. **A layout for phones and the installed app.** (L)
    The rack is one wide panel. On a phone it keeps its desktop width and is
    scrolled sideways, which works but is not comfortable: the step grids and
    the knobs are small, and the transport bar is wider than the screen. A
    layout made for a narrow screen:
    - One unit on screen at a time (a lane, the drums, the song, effects),
      with a bar along the bottom to move between them and the transport
      always in reach.
    - Step grids that fit the width: eight steps to a row, or one bar paged
      a half at a time.
    - Touch-sized controls. Knobs become sliders or open a large dial when
      touched; nothing depends on hover or a right click.
    - The piano roll and the on-screen keyboard usable with a thumb, in
      portrait and landscape.
    - Respect the phone's safe areas (notch, home bar) when installed, and
      keep the screen awake while playing.
    - Dialogs as full-screen sheets.
    The same components and the same `Studio` object should drive both
    layouts: this is a second arrangement of the rack, not a second app.
    Kids mode (item 14) is touch-first too and can share its large controls.
    To decide: whether "apps" means the installable web app that exists
    today, or packaged apps in the phone stores as well, which is a separate
    piece of work (a wrapper, store accounts and review).

## Known bugs

- **Song WAV ignores a guest's mute and level per scene.** The export decides
  which guests to record, and at what level, from the scene that is open when
  Export is pressed (`handleExportWav` reads `guestsRef` once and gives each
  recording a single gain). A guest muted in the open scene is left out of the
  whole song, and one muted only in another scene plays through it. The fix:
  record every guest that is audible in any scene of the song, and apply each
  scene's `guestMix` to the recording bar by bar, the way `applySceneMutes`
  does for the synth lanes. Loop WAV, Download WAV and stems export one scene
  and are not affected.

## Suggested order

1. Listen and tune the new voices (sound item 1).
2. Samples on the drum grid.
3. Dependable local storage: `docs/STORAGE_AND_ACCOUNTS_PLAN.md`, stage 1.
4. Typed store, splitting `useStudio.tsx` by concern.
5. Longer patterns, then polyphonic steps and note length.
