# Roadmap — Improvements and High-Value Features

First written 2026-10-08; tidied 2026-10-10 against the code as it stood then.
Each section lists what is still open, then what is done. Sizes are rough:
**S** is a day or less, **M** is a few days, **L** is a week or more.

## Design and implementation improvements

These do not add features. They remove the things most likely to cause bugs or
slow down every later change.

1. **Replace the REST-shaped store with a typed one, and split `useStudio.tsx`.** (L)
   `localRequest('/synth/1/parameters', { method: 'POST', body: JSON.stringify(...) })`
   (now deleted) was a leftover from the server version: every edit is serialized to a string,
   routed by regex, parsed, applied, then echoed back as an event that
   `useStudio.tsx` applies a second time on top of its own optimistic update.
   Replace it with a store exposing typed methods
   (`store.setSynthParams(id, patch)`) and a single subscription, and move
   state out of `useStudio.tsx` (about 2,400 lines) into hooks per concern:
   transport, history, MIDI, persistence. This removes a class of
   state-applied-twice bugs, and undo, automation and collaborative sessions
   all wait on it.

   The plan is `docs/TYPED_STORE_PLAN.md`: eight pull requests, each leaving
   the app working. Done: all eight. An edit is now a typed operation
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
   Lanes coming and going, play and stop go that way too, and so do the
   scenes and the song, which leaves `useStudio` with no route call at all.
   The last pull request deleted `request`; undo puts a snapshot back with one
   `applyAll`; and an instrument named after a built-in property is refused
   like any unknown one. Still open: splitting `useStudio.tsx` (2,190 lines),
   which the plan describes but does not schedule; saving when nothing changed,
   which is the owner's to decide; the whole drum state still sent for one step;
   and the list of things that look wrong at the end of the plan's account of
   pull request 8.

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
   arrow, Home and End keys, and gives focus back to its knob. A lane's row
   of steps, the drum grid and the piano roll are each one stop for the Tab
   key, with the arrow keys, Home and End moving inside; the on-screen
   keyboard's keys and the roll's squares have names and say whether they
   are pressed, and the buttons that move the roll and the keyboard along
   are named. Still open: the three octaves of the on-screen keyboard are
   still a tab stop for every key; the step numbers over the piano roll are
   not column headers to a screen reader; and nothing, the walkthrough
   included, has been tried with a screen reader.

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
   may change how something is laid out or reached, and, as the owner
   allowed on 2026-10-11, it may also propose new features and changes to
   what the app does.

   The review is written: `docs/DESIGN_REVIEW.md`, with numbered findings,
   five redesign suggestions and eleven suggested features. Still open:
   the owner choosing from it, and everything it lists as not looked at.

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

4. **A modulation matrix.** (M) First part done on 2026-10-12, not verified
   by ear: up to four routes a sound, on the LFO tab under Routing. Sources
   are the two LFOs, both envelopes, velocity, key and a stepped random;
   destinations are pitch, the second oscillator's pitch, the filter, the
   level, pulse width, pan and FM amount. Open: the mod wheel as a source
   (the app does not read a controller's wheel yet, which belongs with the
   MIDI work, features 6); more than four routes; and the LFO tab's own
   target menus are still there beside the routes, not replaced by them.

5. **A true ladder filter.** (M) Done on 2026-10-12, not verified by ear.
   The voice has a four-pole ladder beside the state-variable filter, as a
   third choice in the slope menu. Its resonance thins the bass a little and
   rings by itself at the top. The Minimoog and TB-303 models take it, with
   24 dB, when a lane is moved to them. The MS-20's filter followed the
   same day: a two-pole whose resonance distorts as it is pushed, and a
   high-pass before the filter that any sound can use. Open: the ladder
   gives back most of the level its resonance takes, because a lane's
   level stops at 200%.

6. **An algorithmic reverb, and insert effects per lane.** (M each)
   The reverb is a convolver with a shaped impulse. Insert effects are easier
   once the audio layer has a single owner (improvements item 4).

7. **More presets, grouped by kind, and more synth models.** (L in all)
   Asked for by the owner on 2026-10-11. The plan is
   `docs/SYNTH_MODELS_PLAN.md`.
   - More presets to start from, and the presets menu nested by what a
     sound is for: bass, lead, pad, keys, pluck, effects. The kinds are
     agreed. A person's own saved presets keep a group of their own, and an
     imported preset goes under a kind chosen at import, or "other".
   - Fourteen more synth models, which the owner chose to have all of. A
     model is this synth's own voice set up to behave like the instrument it
     is named for; it is not that instrument's circuit and does not use its
     samples. They fall in three groups by what they need:
     - with the voice as it is: SH-101, Pro-One, Jupiter-8, OB-Xa, Polysix,
       Mono/Poly, JP-8000;
     - after planned sound work: MS-20 (filter models, with the ladder
       filter, item 5), ARP Odyssey, CS-80 and Virus (the modulation matrix,
       item 4);
     - after the sample oscillator (item 3), and only with waveforms the
       project may redistribute: D-50, M1, Wavestation. Their makers'
       samples cannot be used, so these will be the furthest from their
       namesakes, and one may be left out if no usable waveforms are found.
   Asked for by the owner on 2026-10-12, as well as more presets: a review
   of every built-in preset's sound, redesigning the weak ones.
   Done on 2026-10-12: the MS-20, the first model that needed engine work,
   with three presets. Six models to go: three wait on the modulation
   matrix and three on the sample oscillator. Not verified by ear.
   Done on 2026-10-12: the seven models that needed nothing new from the
   voice, SH-101, Pro-One, Jupiter-8, OB-Xa, JP-8000, Mono/Poly and
   Polysix, with fifteen presets between them and the model menu grouped
   Mono, Poly and Digital. Unison goes to seven copies, with a level for
   the side copies. Seven models to go, each waiting on engine work.
   Not verified by ear: the owner listens to these seven next.
   Done on 2026-10-12: the seventeen old presets are replaced by forty, in
   all six kinds including Effects, each measured so that presets of a kind
   are about as loud as each other (the old ones differed by 18 dB). Not
   verified by ear. The first oscillator has a level, so a sound can be made
   of noise alone. Still to come with each new synth model: its own presets.
   Done (step 1 of the plan): every built-in preset has a kind and the presets
   menu is grouped by it, with a person's own presets in "My presets". Still
   open: the new presets themselves (no kind has an Effects preset yet, so
   that group does not show); choosing a kind when a preset is imported (an
   imported preset goes under "My presets" for now); the new models.
   Done as well: the presets menu is a nested menu in the rack's own style
   (the groups, then a group's presets beside them, or in their place on a
   phone), in place of the browser's own list.
   The model menu is grouped too, since it grows to nineteen. Presets and
   models are sound, and sound cannot be checked by a test: each needs the
   owner's ears before it is called done, with a listening session after the
   first group.

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
   a narrow screen are as big as a fingertip. Fourth part done: the
   on-screen keyboard shows one octave with keys a finger wide (two octaves
   on a phone on its side) and buttons to move to the others, follows each
   finger on its own, plays the keys a finger slides across, and lets
   everything go when a finger leaves the keys, the unit is switched away or
   the phone is turned. The piano roll has squares of 44px or more and shows
   as many steps of the bar as fit, with two buttons to move along it a beat
   at a time and the note names to slide it to higher notes; a tap adds or
   removes a note, a drag paints or rubs out, a finger held on a note keeps
   it and selects its step, and a note's end is a handle wide enough to
   drag. A phone on its side gets the phone arrangement with a lower bar of
   units. Everything in the list below is now built. Smaller things left:
   a note cannot be dragged longer than the steps on show (the Note length
   menu can), the piano roll does not turn to follow the playhead within a
   bar, the drum grid is still eight to a row on a phone on its side, the
   walkthrough places its card by width alone, two fingers on the piano
   roll at once get in each other's way (one lifting drops the other's tap,
   and either can move a length the other is dragging),
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
   over a section are a large part of electronic arrangement. The owner asked
   on 2026-10-12 whether a hardware knob could record it: yes, if the knob
   mapping in item 6 is built so that a mapped hardware knob changes a
   parameter by the same store operation the knob on screen sends. Recording
   is then the same for both. A hardware knob sends 128 positions, so a
   recorded sweep needs smoothing between them on playback.

6. **More MIDI.** (L in all)
   Following an external clock, sending notes played by hand, and choosing
   the output channels. MIDI output has only been tested against a fake
   device, so real hardware is needed to finish any of it.

   Asked for by the owner on 2026-10-12: map a controller's knobs and pads to
   the synths and the drums. Today a MIDI keyboard plays one lane, chosen in
   the MIDI panel with one channel; a controller's knob messages arrive, are
   shown in the panel, and are then dropped (`handleMidiMessage` returns on
   `controlChange`), and incoming notes cannot go to the drums. In three
   parts:
   - **Pads to the drums.** (S) "Drums" as somewhere incoming notes can go,
     with each note mapped to a drum lane. The note numbers MIDI export
     already uses for the eight lanes are the starting map, so most pad
     controllers work as they come; each pad can be given another lane.
   - **More than one place at once.** (S) A keyboard on a lane and pads on
     the drums together: a place for each channel, or for each device,
     where today there is one channel and one lane.
   - **Knobs to parameters, by learning.** (M) Choose Learn on any knob on
     screen, turn a knob on the controller, and the two are tied. To settle
     in building it: where the ties are kept (with the device in this
     browser, so a controller works the same in every project, or with the
     project); what happens when the controller's knob and the knob on
     screen are in different places (jump, or wait until the hardware knob
     passes the value); a knob that follows the open lane against one tied
     to a single lane; and a list of the ties with a way to remove each.
     It needs one way of naming any parameter (this lane's cutoff, the drum
     bus's drive), which the modulation matrix (sound 4) and parameter
     automation (item 5) need as well: build it once. A mapped knob must
     change the parameter by the same store operation the knob on screen
     sends, so undo, saving, and later automation treat the two alike.
   Web MIDI is in Chrome and Edge on a computer and on Android, and in
   Firefox with its own permission; not on an iPhone or iPad. None of this
   has been tried with real hardware.

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
    On 2026-10-12, the owner also asked for a way to change a bar's length:
    choose the number of beats or steps in the bar. This is different from
    changing how many bars a pattern contains (item 4) or using finer step
    resolution on a synth lane. Whether arbitrary custom step counts should
    work with the agreed per-scene time signatures is still a design question.
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
    Decided by the owner on 2026-10-11: each scene has its own time
    signature, so a song can change metre from one section to the next, and
    the ones on offer are four-four, three-four and six-eight, with
    five-four, seven-eight and twelve-eight added as worth having
    (five-four and seven-eight are the odd metres people most reach for;
    twelve-eight is the slow shuffle, and costs little once six-eight is
    there). Because it is per scene, a scene's length in a song, the bar
    counting in song mode and every export have to take each scene's own bar
    length, where today one length serves the whole song. Keep these agreed
    metre options and the backward-compatible four-four default.

12. **Turn a knob with the scroll wheel.** (S) Asked for by the owner on
    2026-10-11: with the pointer over a knob, the wheel turns it, with no
    click or drag. Knobs have no wheel behaviour today. To settle in
    building it: the page itself scrolls with the wheel, so a knob that
    happens to be under the pointer must not swallow a scroll that was meant
    for the page (turn only after the pointer has rested on the knob, or
    only when the knob has been clicked or focused, or with a key held); how
    far one notch turns, and a finer turn with Shift as the arrow keys have;
    one undo entry for a run of notches, as a drag makes; and the same for
    the drum knobs and the sliders in the effects panel. A trackpad's
    two-finger scroll arrives as wheel events too and must not send values
    flying.
    Built, as a draft: the wheel turns a knob once the pointer has rested on
    it for a third of a second and the page was not just being scrolled (the
    first of the options above; the owner has not confirmed it), a notch is a
    fiftieth of the range, Shift is one step, a trackpad's small events add up
    and no event is more than a notch, a quick run is one undo entry, and it
    works on the synth, drum and effects knobs. Still open: the owner's say on
    the resting rule, a visible cue that a knob is ready (only the cursor
    changes), and a notch size per knob where 2% is wrong.

13. **Show that an export is still being made, and name the WAV exports
    plainly.** (S) From the owner trying Song WAV in the installed app on a
    Pixel 9 on 2026-10-11. A long song takes a while to render and the app
    gives no sign of it, so the owner opened the file early and took it for
    cut short; waited for, the whole song arrived with its download notice.
    So: show progress while an export is being made, say when it is done,
    and stop a second export being started on top of the first. The owner
    also once got only the scene from what was meant to be a song download,
    and puts it down to pressing the wrong thing: the Export menu has both
    Download WAV, which is the open scene, and Song WAV. Call the first
    Scene WAV, and its MIDI neighbour Scene MIDI, so the two kinds read as
    a pair.
    Done: "Download WAV" is now Scene WAV and "Export MIDI" Scene MIDI. While a WAV
    export is made a message at the top says so, the other WAV exports are
    greyed out, and the message says when the file has downloaded (Stems say
    which file of how many). Still open: a true progress bar or percentage,
    since the browser's offline renderer does not report how far it has got.

14. **A playlist-style layout for scenes.** (M) Asked for by the owner on
    2026-10-12. Show each scene occurrence in song playback order so the
    arrangement is easy to read and edit. Proposed scope: reorder occurrences,
    repeat scenes and show each occurrence's duration, using the existing
    scenes and song data, including scenes with different bar lengths. Provide
    keyboard and touch access; do not make dragging the only way to edit it.
    The exact visual layout, and whether an occurrence's duration is in bars
    or repeats, are still design choices. This is the project's song
    arrangement, not a playlist of published songs, a discovery page or a new
    cloud service.

15. **Chord buttons in the piano roll.** (S) Asked for by the owner on
    2026-10-12. Offer buttons to insert editable chord notes at the selected
    step, with a chosen root and chord type. These are note-entry shortcuts,
    using the existing note length, velocity and undo behavior, not a new
    synthesis feature; chords already play. Basic major and minor chords are a
    reasonable starting point. The final chord set, inversions and whether
    insertion adds to or replaces notes are still design choices.

16. **One row for a project and its copies.** Done: asked for by the owner on
    2026-10-12 and built. In Projects, a project and the ones the app named
    after it ("copy", "earlier version", "this browser's version", and the
    2, 3… added to a name already in use) share one row under the main name,
    with a list on the row to choose which of them Open, Rename, Copy, Delete
    and the rest act on. Nothing is renamed, merged or stored; it is only how
    the list is shown. Still open: two new projects left as "Untitled" and
    "Untitled 2" share a row as well, since the number is all the app has to
    go on, and a copy of a project with a very long name is not matched to
    it, because the app shortens the name to fit the ending on.

Done: song mode, with mutes and solos kept per scene; patterns of 1, 2, 4 or
8 bars per lane, and MIDI files of up to eight bars imported at full length;
chords, note length and late starts; project files; the computer keyboard as a
piano; MIDI output and clock; chance and repeats on drums and synth steps;
stem and loop export; the installable, offline-capable app; share links, both
the long kind that carries the song and short links to a published one;
accounts, project sync and version history; guest instruments; the walkthrough
for new accounts.

17. **Kindle and Fire tablets get the phone layout.** (S) Asked for by the owner on 2026-10-12. Built: a Silk, Kindle or Fire model user agent makes the page report a 640px layout width, which the existing phone rules treat as a phone upright or on its side. Not verified on a real Kindle.

## Questions waiting on the owner

- **Did the Firefox guest fixes work?** PRs #76 and #77 changed how a guest
  instrument's audio is timed for Firefox. Nobody has said whether a guest
  now plays in time on a real desktop Firefox.
- **Tape Loop Deck.** On hold: the owner took it off the Add Guest list on
  2026-10-10. Its loops are not saved with a project either, which needs an
  addition to the guest protocol and a new prompt for its author.
- **Kids mode.** Staying a separate page is now decided. Still to answer:
  whether what a child makes can be opened in the full app.
- **The Polysix model and the chorus.** The chorus is one shared effect
  with a send for each lane. May a model turn up its lane's send, or should
  that model wait until a lane can have effects of its own?

## Suggested order

1. **Listen and tune** (sound 1). It needs the owner's ears, not an agent, so
   it can go on alongside everything else.
2. Done: the four small ones (CI housekeeping, typed worklet messages, synth
   presets to IndexedDB, and the walkthrough from Help).
3. Done: **the typed store** (improvements 1). Next, **undo in the store**
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
   signatures and changing bar length** (feature 11) go with pattern editing,
   after the typed store; **piano-roll chord buttons** (feature 15) fit with
   note entry. A **playlist-style scene layout** (feature 14) belongs with
   song arrangement and should account for scenes of different lengths.
   **The scroll wheel on knobs** (features 12) and **showing that an export
   is being made** (features 13) are small and can go in at any time.
7. Done: samples in project files (sound 2). Sync for them waits on storage.
8. **Parameter automation** (features 5).
9. **The audio layer's single owner** (improvements 4), then the sound work
   that builds on it: **insert effects, the reverb, the ladder filter, the
   modulation matrix and the sample oscillator** (sound 3 to 6). **More
   presets and synth models** (sound 7) follow `docs/SYNTH_MODELS_PLAN.md`:
   the grouped presets menu and the seven models that need nothing new can
   be done at any time; the other seven come after the sound work each
   leans on.
10. **More MIDI** (features 6), when there is hardware to test with.
11. **Live collaborative sessions** (the rest of features 7), after the
    typed store. The published-songs page (features 9) is done.
