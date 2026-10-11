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

   The plan is `docs/TYPED_STORE_PLAN.md`: eight pull requests, each leaving
   the app working. Done: the first five. An edit is now a typed operation
   handed to one synchronous `apply`, with a reducer for each, and anything
   that wants to record edits can listen for them. Drum swing and drum master
   volume go that way, and `useStudio` applies each once, from the store's
   event; the kit list, the tempo and the scenes are read by typed methods.
   Adding, changing and removing a guest instrument go that way too, and with
   them an edit the store refuses (a bad address, a fifth guest) has its
   settled form. Every drum edit goes that way as well (steps, velocity,
   chance and repeats, a drum's settings, mute, solo and sample, the pattern's
   length, the kit, reset), and the drums on screen are set once, from the
   store's event. The drum sends and the shared effects go that way too, each
   as a change laid over what is there. So do a lane's sound, its synth model
   and macros, its mute and solo, its octave and keyboard, and the tempo,
   and so does every write to a lane's pattern (the piano roll, step controls,
   length, MIDI import and undo), applied once from the store's event.
   Still open: the other 10 operations (lanes coming and
   going, the transport, scenes and the song, in that order), then taking
   `request` away, and after that splitting `useStudio.tsx`, which the plan describes
   but does not schedule.

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
   Steps are labelled and dialogs trap focus. The phone's bar of units is a
   named navigation whose switches say which unit is on show, and choosing
   one moves keyboard focus into that unit. The large slider a touched knob
   opens is a native slider in a dialog: it has a name, a value in words,
   arrow, Home and End keys, and gives focus back to its knob. Still open: the step grids are
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

9. **A design review of the whole interface, with redesign suggestions.** (M) Asked for by the owner on
   2026-10-11, to be done with the frontend-design plugin. The interface has
   grown a piece at a time: the rack, the dialogs and menus, the phone
   layout, kids mode, and the pages a share link or a person's link opens.
   Nobody has looked across all of it at once. The review covers:
   - whether the pieces read as one thing: type sizes and weights, spacing,
     the colours and where each is used, corners, borders and shadows;
   - every state of every control: resting, hovered, pressed, focused, on,
     disabled, and the empty and error states of lists and pages;
   - what is hard to read or to hit: contrast, small text, small targets,
     and labels that are cut short;
   - the phone layout and kids mode as carefully as the desktop rack.
   It needs pictures of the real app at desktop and phone width, which the
   browser tests on GitHub can take. It ends in two things for the owner:
   - a written list of findings in order of how much each matters, which
     become small pull requests once agreed;
   - redesign suggestions, which the owner asked for: where a part of the
     interface would be better made differently and not merely tidied, a
     proposal for it with a picture or mock-up, what it would cost, and
     what it would change for someone using the app. These go further than
     fixes, up to a different look or arrangement for a whole part.
   Nothing suggested is built until the owner has chosen it. A suggestion
   may change how something is laid out or reached, but not what the app
   can do.

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

2. **Samples that travel with a project.** (files done; sync still open)
   A saved project file now carries the audio of the samples its drum lanes
   use, and opening it on another device puts them in that browser. Share
   links, published songs, sync and shared projects still carry no audio, so
   a lane's sample is missing there. Syncing samples needs file storage on
   the server, which is waiting on a payment card for Cloudflare R2
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
   and only the tempo and Play stay stuck to the top. Second part done: a
   narrow screen shows one unit at a time (the song, a lane, the guests, the
   drums or the effects), with a bar along the bottom to move between them
   and to go back to the whole rack on one page; the unit last on show is
   remembered in that browser, units out of sight keep playing, and the
   walkthrough turns to the unit each stop is about. Third part done: a knob
   tapped with a finger opens a large slider along the bottom of the screen,
   with its value in big figures, a step button either side and the hint a
   mouse would get by hovering; dragging a knob still turns it, and knobs on
   a narrow screen are as big as a fingertip. Still open from the list
   below: a piano roll and keyboard made for a thumb. Smaller things left:
   buttons whose only explanation is a hover hint, and the figure under a
   knob, which an iPhone may zoom the page to type in. None of it has been looked at in a browser by a person, tried on a
   real phone, or tried with a screen reader: it was built from the
   stylesheet and is held by browser tests that measure the page. The full
   list:
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

9. **A page listing a user's published songs.** Done, for each user's own
   songs only, as decided on 2026-10-10: no page that lists everyone's, no
   browsing, no search and no list of people.
   - Each person's page is at `#u=name` and lists the songs they have
     published, newest first, each leading to its own page. It needs no
     account to open.
   - The publisher's name on a song's page leads to it, and Share Link shows
     a signed-in user the link to their own.
   - The server gives out the username and each song's code, title and time,
     and nothing else. A name nobody has reads the same as a person with
     nothing published.
   - It needs the accounts API deployed (no database change). Until then the
     page says such pages are not available yet.
   Still open: a description or picture for a person or a song; choosing the
   order of the list or leaving a published song off it; playing a song from
   the list without opening its page.

10. **A fuller kids mode.** Done: twelve pads, more sounds to choose from,
    and a second screen where a beat is built on a grid of pictures. It is
    still a page of its own, as decided on 2026-10-10, and the rules of the
    first version still hold. Kids mode now lasts for the whole visit to a
    tab, so going back in the browser is not a way out. Still open: trying it
    with a child and on a real tablet, including that swipe back; choosing
    the sounds by ear; whether twelve pads are cramped on a phone held
    sideways.

11. **Time signatures.** (L) Asked for by the owner on 2026-10-11. Everything
    is in four-four today: a bar is sixteen steps (thirty-two on a lane set
    to finer steps), the drum grid is sixteen to a bar, and the transport,
    the song, the exports and the bar tabs all count in bars of that length.
    Being able to change it means, at least, three-four, six-eight, five-four
    and seven-eight:
    - a bar's length in steps comes from the time signature, for lanes and
      for the drum grid, with the grids drawn and grouped to match (beats of
      three in six-eight, say);
    - the transport, the playhead, the metronome when there is one, song
      mode's bar counting and the delay's tempo sync all follow it;
    - WAV, loop, stem and MIDI export, and MIDI import, carry it (a MIDI file
      has a place for a time signature);
    - older projects open as four-four, unchanged.
    It reaches into most of what counts steps (`patternLength.ts`,
    `browserTransport.ts`, `songPlayback.ts`, the exporters), so it should
    come after the typed store. It overlaps with pattern lengths that are not
    a whole number of bars (item 4) and the two should be designed together.
    To decide: one time signature for the project, or one for each scene so
    a song can change metre part-way; and which signatures to offer.

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
- **Time signatures.** One for the whole project, or one for each scene?
  And which ones should be on offer?

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
   made, and move **kids mode** (features 2) onto the same large controls.
   The fuller kids mode (features 10) is done. Then the **design review of
   the whole interface, with its redesign suggestions** (improvements 9), once the phone layout it has to
   look at is in place.
6. **Record live playing** and **more ways to edit patterns** (features 3
   and 4): the two that most change what making a song feels like. **Time
   signatures** (features 11) go with pattern editing, after the typed
   store.
7. Done: samples in project files (sound 2). Sync for them waits on storage.
8. **Parameter automation** (features 5).
9. **The audio layer's single owner** (improvements 4), then the sound work
   that builds on it: **insert effects, the reverb, the ladder filter, the
   modulation matrix and the sample oscillator** (sound 3 to 6).
10. **More MIDI** (features 6), when there is hardware to test with.
11. **Live collaborative sessions** (the rest of features 7), after the
    typed store. The published-songs page (features 9) is done.
