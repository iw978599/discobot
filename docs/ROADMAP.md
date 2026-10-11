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

3. **Stop re-rendering the whole app on every step.** Done: the playhead is
   a small store outside React and the step lights follow it without a
   render. Playing a three-lane project with drums, the main thread was busy
   a little over half as long as before, and script time fell to between a
   fifth and an eighth. Also done: a synth lane, the drums and a guest each
   render only when something they read has changed, so an edit to one lane
   no longer draws the others. Turning a knob took about a third less script
   time, and a drum step about half. The effects panel sits out edits that are
   not to the effects. Still open: the transport bar and the song strip
   still render on every edit.

4. **Give the audio layer a single owner.** (M)
   `browserAudio.ts` keeps the context, buses and effects in module-level
   variables, which makes it awkward to test and impossible to tear down
   cleanly. Wrap them in an `AudioEngine` class created once and passed to the
   hooks.

5. **Accessibility pass on custom controls.** (M)
   Steps are labelled and dialogs trap focus. Still open: the step grids are
   long runs of separate tab stops, so add a roving tab index; and nothing,
   the walkthrough included, has been tried with a screen reader.

6. **Type the worklet messages.** Done: the hooks that send and the worklet
   that receives share one set of message types from the engine, so a renamed
   field or a misspelt message does not compile.

7. **CI housekeeping.** Done: the check on GitHub runs the browser tests for
   desktop and phone width on two machines at once, and
   `npm run test:browser:fast` runs them side by side locally. Publishing no
   longer repeats the checks: it starts when they pass on `main` and builds
   the commit they passed on. The Pages actions are on Node 24.

8. **Move synth presets to IndexedDB.** Done: presets have a store of their
   own, and any saved before are moved there on the next visit.

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

1. **A layout for phones and the installed app.** (L) First part done: at
   720px wide and under the rack no longer scrolls sideways. Units stack
   their parts, step grids are eight to a row, buttons are finger-sized, the
   keyboard slides sideways, menus rise from the bottom, dialogs fill the
   screen, safe areas are respected, the screen stays awake while playing,
   and only the tempo and Play stay stuck to the top. It is still every unit
   on one long page. Still open from the list below: one unit on screen at a
   time with a bar to move between them, knobs as sliders or a large dial,
   and a piano roll made for a thumb. None of it has been tried on a real
   phone. The full list:
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
   tablet; choosing the sounds by ear; keeping the screen awake. More to do
   in it is item 10.

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

7. **Collaborative sessions.** (L) First version done, in turns: the owner
   of a synced project shares it by username, the other person opens it from
   "Shared with you", and each one's saves reach the other. It needs the
   accounts API deployed with migration `0004_shares.sql` before it works on
   the live site. How the open questions were answered:
   - Live or turn-based: turn-based, on the revision check sync already has,
     with no new kind of connection. Live editing would need a connection
     held open (`AGENTS.md` rules out a WebSocket transport, so that rule
     would have to be revisited on purpose) and the typed store first.
   - What is shared: edits only. Each person hears their own browser. Each
     sees who saved last, and is told when the other's save arrives.
   - Two edits to the same thing: nothing is merged. Whoever syncs second
     keeps their edits as a project of their own and gets the other's version.
   - Who may join: by username, chosen by the owner, up to eight people. The
     owner removes someone; a member leaves. Either way the member keeps a
     copy that is theirs alone.
   - Guest instruments and imported samples are still per browser, so a
     collaborator may not have them. The dialog says so.
   Still open: live editing; seeing that the other person has the project
   open or is part-way through a turn; sharing by a code or a link instead
   of a username; passing a project to a new owner.

8. **The walkthrough for someone with no account.** Done: Help has a Show
   the Walkthrough button, and the stop about accounts says they are optional
   to someone who is not signed in.

9. **A page listing a user's published songs.** (M)
   Publishing gives each song a short link, and there is no profile page or
   browsable list (`docs/STORAGE_AND_ACCOUNTS_PLAN.md`, stage 3 step 4).
   Decided 2026-10-10: a page for each user's own songs only. No page that
   lists everyone's.

10. **A fuller kids mode.** (M)
    The first version is too simple to hold a child's interest for long.
    Decided 2026-10-10: it stays a page of its own, and gets
    - more to play: more pads and more sounds to choose from;
    - a second activity on another screen, such as a grid of pictures for
      building a beat.
    The rules of the first version still hold: no reading needed, nothing
    can be lost or broken, a capped level, no account and no requests to
    anywhere.

Done: song mode, with mutes and solos kept per scene; patterns of 1, 2, 4 or
8 bars per lane, and MIDI files of up to eight bars imported at full length;
chords, note length and late starts; project files; the computer keyboard as a
piano; MIDI output and clock; chance and repeats on drums and synth steps;
stem and loop export; the installable, offline-capable app; share links, both
the long kind that carries the song and short links to a published one;
accounts, project sync and version history; guest instruments; the walkthrough
for new accounts.

## Questions waiting on the owner

- **Did the Firefox guest fixes work?** PRs #76 and #77 changed how a guest
  instrument's audio is timed for Firefox. Nobody has said whether a guest
  now plays in time on a real desktop Firefox.
- **Tape Loop Deck.** On hold: the owner took it off the Add Guest list on
  2026-10-10. Its loops are not saved with a project either, which needs an
  addition to the guest protocol and a new prompt for its author.
- **Kids mode.** Staying a separate page is now decided. Still to answer:
  whether what a child makes can be opened in the full app.

## Suggested order

1. **Listen and tune** (sound 1). It needs the owner's ears, not an agent, so
   it can go on alongside everything else.
2. Done: the four small ones (CI housekeeping, typed worklet messages, synth
   presets to IndexedDB, and the walkthrough from Help).
3. **The typed store** (improvements 1), then **undo in the store**
   (improvements 2). Large and with nothing to show for it, but automation,
   collaborative sessions and most new features get cheaper and safer after.
4. Done: the playhead out of React state (improvements 3).
5. **The rest of the phone layout** (features 1): one unit on screen at a
   time, knobs as sliders and a piano roll made for a thumb. Do the
   **accessibility pass** (improvements 5) on the new controls as they are
   made, move **kids mode** (features 2) onto the same large controls, and
   build the **fuller kids mode** (features 10).
6. **Record live playing** and **more ways to edit patterns** (features 3
   and 4): the two that most change what making a song feels like.
7. **Samples in project files** (sound 2). Sync for them waits on storage.
8. **Parameter automation** (features 5).
9. **The audio layer's single owner** (improvements 4), then the sound work
   that builds on it: **insert effects, the reverb, the ladder filter, the
   modulation matrix and the sample oscillator** (sound 3 to 6).
10. **More MIDI** (features 6), when there is hardware to test with.
11. **Live collaborative sessions** (the rest of features 7), after the
    typed store, and the **published-songs page** (features 9).
