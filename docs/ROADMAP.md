# Roadmap — Improvements and High-Value Features

First written 2026-10-08; tidied 2026-10-10 against the code as it stood then.
Each section lists what is still open, then what is done. Sizes are rough:
**S** is a day or less, **M** is a few days, **L** is a week or more.

## Design and implementation improvements

These do not add features. They remove the things most likely to cause bugs or
slow down every later change.

1. **Replace the REST-shaped store with a typed one, and split `useStudio.tsx`.** (L)
   `localRequest('/synth/1/parameters', { method: 'POST', body: JSON.stringify(...) })`
   is a leftover from the server version: every edit is serialized to a string,
   routed by regex, parsed, applied, then echoed back as an event that
   `useStudio.tsx` applies a second time on top of its own optimistic update.
   Replace it with a store exposing typed methods
   (`store.setSynthParams(id, patch)`) and a single subscription, and move
   state out of `useStudio.tsx` (about 2,400 lines) into hooks per concern:
   transport, history, MIDI, persistence. This removes a class of
   state-applied-twice bugs, and undo, automation and collaborative sessions
   all wait on it.

2. **Make undo a store feature.** (M, after 1)
   Undo snapshots are assembled by hand, and each handler must remember to
   push one. With a typed store, record every mutation as a patch
   automatically and group patches made during one drag. A whole-project undo
   entry also fixes the current limit that an entry restores only one synth
   lane.

3. **Stop re-rendering the whole app on every step.** (M)
   The playhead position lives in React state at the top of the tree, so all
   controls re-render 8 to 16 times a second during playback. Move the
   playhead to a ref or a small external store read only by the step lights.

4. **Give the audio layer a single owner.** (M)
   `browserAudio.ts` keeps the context, buses and effects in module-level
   variables, which makes it awkward to test and impossible to tear down
   cleanly. Wrap them in an `AudioEngine` class created once and passed to the
   hooks.

5. **Accessibility pass on custom controls.** (M)
   Steps are labelled and dialogs trap focus. Still open: the step grids are
   long runs of separate tab stops, so add a roving tab index; and nothing,
   the walkthrough included, has been tried with a screen reader.

6. **Type the worklet messages.** (S)
   Messages to the processors are untyped object literals on one side and
   `data.type === ...` checks on the other. Share a discriminated union from
   the engine so a renamed field is a compile error.

7. **CI housekeeping.** (S)
   `ci.yml` and `pages.yml` run the same checks on every push to `main`;
   have Pages depend on CI instead. Bump `configure-pages` and `deploy-pages`
   off Node 20. The browser tests take about nine minutes one at a time;
   `PLAYWRIGHT_PORT` already gives a run its own app and API, so the desktop
   and phone halves could run side by side.

8. **Move synth presets to IndexedDB.** (S)
   Presets are the one thing still written to `localStorage` from
   `useStudio.tsx`. Projects and their versions are already IndexedDB
   records.

Done: the rack rebuild that emptied `App.tsx`; the two-tab guard; debounced
saving; projects as IndexedDB records with version history; the Vibrato LFO
target; removal of the AI review workflow.

## Sound and synthesis

1. **Listen and tune.** (M)
   Nothing has been verified by ear. Levels, envelope ranges, kit characters,
   the model macros, the chorus, the shaped reverb and the EQ were set from
   measurements and reasoning. That includes the kits named after the
   LinnDrum, DMX and TR-707, which are synthesized. A listening session with
   adjustments is the highest-value sound work remaining, and only a person
   can do it.

2. **Samples that travel with a project.** (M for files, more for sync)
   Imported samples stay in the browser they were imported in. Putting them
   in project files is self-contained. Syncing them needs file storage on the
   server, which is waiting on a payment card for Cloudflare R2
   (`docs/STORAGE_AND_ACCOUNTS_PLAN.md`, stage 3 step 5).

3. **A sample oscillator in the synth.** (M)

4. **A modulation matrix.** (M)
   Sources (two LFOs, both envelopes, velocity, key, mod wheel) routed to any
   destination with a depth, replacing the fixed LFO target dropdowns.

5. **A true ladder filter.** (M)
   The 24 dB mode is two cascaded state-variable stages; a ladder with its
   characteristic resonance and bass loss is open, and the Minimoog and
   TB-303 models do not switch to 24 dB by themselves yet.

6. **An algorithmic reverb, and insert effects per lane.** (M each)
   The reverb is a convolver with a shaped impulse. Insert effects are easier
   once the audio layer has a single owner (improvements item 4).

Done: the voice rewrite (oscillators, filter, envelopes, FM, mono and slide,
drum voices); unison and the 24 dB filter slope; a sample on any drum lane,
live and in export; Import Kit, which puts several sample files on the lanes
at once by their names; the stereo chorus; reverb pre-delay and damping;
tempo-synced delay; kick ducking; the three-band master EQ. Recordings of the
LinnDrum, DMX and TR-707 will not be bundled: none were found that the project
may redistribute.

## Features

1. **A layout for phones and the installed app.** (L)
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
   Kids mode (item 2) is touch-first too and can share its large controls.
   Decided: "apps" means the installable web app that exists today.
   Packaged apps in the phone stores are not planned for now; they would be
   a separate piece of work (a wrapper, store accounts and review).

2. **Kids mode.** Done as a first version: a page of its own (Project menu,
   or `#kids`) with nine big pads, six notes of one scale and three drums,
   that sound as they are touched; four sounds chosen by picture; one play
   button that loops what is tapped, at a slow or a fast speed; a fixed,
   capped level; and a way out that only works held for three seconds. It
   keeps its own tune, never opens the projects, and asks nothing of the
   account or any other site. Decided in building it: it is a separate page,
   not a switch in the transport bar. Still open: whether what a child makes
   can be opened in the full app; trying it with a child and on a real
   tablet; choosing the sounds by ear; keeping the screen awake.

3. **Record live playing against the clock.** (M)
   MIDI record mode writes to the step under the playhead. Add a metronome, a
   count-in and quantize strength so playing in a part is practical, from the
   on-screen keyboard as well as MIDI.

4. **More ways to edit patterns.** (M)
   Lengths that are not a whole number of bars (a 12-step lane against 16);
   copying one bar to another; copy and paste between scenes, and sharing a
   part between scenes (`docs/SONG_MODE_PLAN.md`). A step holds one start
   time, so an on-the-step note and a late one cannot share a step; a 32-step
   lane is the way to get both.

5. **Parameter automation.** (L, after the typed store)
   Record knob movements per step or per bar and play them back. Filter sweeps
   over a section are a large part of electronic arrangement.

6. **More MIDI.** (M)
   Following an external clock, sending notes played by hand, and choosing
   the output channels. MIDI output has only been tested against a fake
   device, so real hardware is needed to finish any of it.

7. **Collaborative sessions.** (L)
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

8. **The walkthrough for someone with no account.** (S)
   It is shown after a new account's recovery code and from the account
   dialog. Offer it from the Help button too.

9. **A page listing a user's published songs.** (M)
   Publishing gives each song a short link, and there is no profile page or
   browsable list (`docs/STORAGE_AND_ACCOUNTS_PLAN.md`, stage 3 step 4).

Done: song mode, with mutes and solos kept per scene; patterns of 1, 2, 4 or
8 bars per lane, and MIDI files of up to eight bars imported at full length;
chords, note length and late starts; project files; the computer keyboard as a
piano; MIDI output and clock; chance and repeats on drums and synth steps;
stem and loop export; the installable, offline-capable app; share links, both
the long kind that carries the song and short links to a published one;
accounts, project sync and version history; guest instruments; the walkthrough
for new accounts.

## Suggested order

1. **Listen and tune** (sound 1). It needs the owner's ears, not an agent, so
   it can go on alongside everything else.
2. **The four small ones:** CI housekeeping, typed worklet messages, synth
   presets to IndexedDB, and the walkthrough from Help. A day each, no
   decisions needed, and the first makes every later change quicker to check.
3. **The typed store** (improvements 1), then **undo in the store**
   (improvements 2). Large and with nothing to show for it, but automation,
   collaborative sessions and most new features get cheaper and safer after.
4. **The playhead out of React state** (improvements 3). It matters most on
   phones, so it comes before the phone layout.
5. **The phone layout** (features 1), with the **accessibility pass**
   (improvements 5) done on the new controls as they are made, and
   moving **kids mode** (features 2) onto the same large controls.
6. **Record live playing** and **more ways to edit patterns** (features 3
   and 4): the two that most change what making a song feels like.
7. **Samples in project files** (sound 2). Sync for them waits on storage.
8. **Parameter automation** (features 5).
9. **The audio layer's single owner** (improvements 4), then the sound work
   that builds on it: **insert effects, the reverb, the ladder filter, the
   modulation matrix and the sample oscillator** (sound 3 to 6).
10. **More MIDI** (features 6), when there is hardware to test with.
11. **Collaborative sessions** (features 7) and the **published-songs page**
    (features 9), once the open questions above are settled.
