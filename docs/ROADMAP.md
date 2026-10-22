# Roadmap — Improvements and High-Value Features

First written 2026-10-08; tidied 2026-10-10 against the code as it stood then.
Each section lists what is still open, then what is done. Sizes are rough:
**S** is a day or less, **M** is a few days, **L** is a week or more.

## The plan from here

Written 2026-10-19 at the owner's request: what was left of this roadmap and
everything in roadmap v2, in one list, put in order by time and cost. Roadmap
v2's entries are now at the end of this file (**V1** to **V17**, under
"Ideas folded in from roadmap v2"), with their detail as it was.

**Time** is the size used everywhere here: **S** a day or less, **M** a few
days, **L** a week or more. **Cost** is how much of the owner's usage limit
the work takes, which is the only cost there is (the project pays for
nothing). Roughly: an **S** done directly is a small share of a day's limit;
an **M** is about one builder's run, which has been 250,000 to 475,000 tokens;
an **L** is several of those. Within each group the order is by what a person
using the app gains for the cost, highest first. Nothing below needs paying
for.

### 0. Finishing what is built

Done 2026-10-21: **Project → Start Live Session** sets up the current project
with sign-in, an explicit account upload when needed, the existing username
sharing controls and joining instructions. The rack and setup show connecting,
waiting alone, participants and connection failures; retry uses the existing
automatic session. Share Link remains a listening/copy flow. Browser coverage
is added for setup, invitation errors and success, retry and reopening.
Live sound is still not verified by ear or on two real computers.

Undo in the store (#192), insert effects for each lane (#191) and two aux
sends (#194): built, waiting on their checks, merged as each is green.

Done 2026-10-21: **Tape Loop Deck is back on the Add Guest list**, and a guest
can keep files with a project (the protocol's optional `files`), so its tapes
can come back with the project. They stay in this browser and travel in
project files, as samples do. The deck's side is its creator's, from
`docs/GUEST_PROMPT_FOR_TAPE_LOOP_DECK.md`; until then it keeps its settings
but not its tapes.

Also asked for on 2026-10-19 and in progress: handing a voice of Discobot's to a guest
instrument (the protocol's optional `input`), for Axis Stack; and recorded drums and seven
more instruments from the VCSL library (a builder).

### 1. Quick and cheap (S each)

The most for the least. Each is one short piece of work, mostly by the agent
directly, with no builder.

1. **Swing for the synth lanes** (V11). Done: a Swing switch on each lane follows the drums' Swing. Whether a lane should have an amount of its own is the owner's to say.
2. **A longer count-in and a level for the click** (V9). Done: 1, 2 or 4 bars, and a Click level knob.
3. **Search across presets** (V13). Done: a search field at the top of the preset menu.
4. **The arpeggiator held under a key** (V11a). Done: it runs while the key is down,
   as hardware does.
5. **Inversions and a strum for chords** (V8). Done: an Inversion menu beside Chord, and Strum in the step controls.
6. **Effects presets, the plain ones** (the first half of V5). Done: Presets menus on the delay and the reverb. Was: a small room,
   a long hall, a slapback, a dub delay, in a menu on each effect.
7. **The aux buses on the mixer, by MIDI Learn and in automation**. Done: return strips on the mixer, aux sends and levels by MIDI Learn, and every send of a lane automatable. Was: the parts
   the aux sends were built without.
8. **A first-run choice** (V15). Done: the strip on an empty project asks it, with six sample songs in different styles. Was: start from a beat, the sample song, or
   empty.
9. **A kind chosen when a preset is imported** (sound 7), so it does not
   always land in "My presets".
10. **How long a recorded note is held** (features 3). Done: a recorded note lasts as long as its key was held. Was: every recorded note is
    one step long today.
11. **Small tidying, low gain:** done: every Sync menu now has dotted and triplet values, new projects named Untitled each have a row of their own, and the transport bar and song unit are `tracked`, so a lane's edit no longer draws them (the song unit reads scene lengths as values, `studio.sceneInfo`). Was: the delay's Sync menu has dotted and
    triplet values and the others do not (features 18); the transport bar
    and song strip still render on every edit (improvements 3); two
    "Untitled" projects share a row in Projects (features 16).

### 2. The architecture work the owner asked for (M to L, the agent)

12. **Split `useStudio.tsx` into hooks per concern** (improvements 1). Done:
    from 2,738 lines to 963, with eight hooks beside it in `ui/src/studio/`
    and the state made in one place (`useStudioCore`). Nothing changes for a
    person using the app.
13. **The audio engine handed to the hooks** (V17, improvements 4). Done:
    the audio hooks, the guest audio and the studio are given the engine (the
    app's by default), and a unit test tries the guest player on an engine of
    its own.

### 3. Medium (M each, about one builder's run)

14. **The Hall's Decay in Chrome**. Done: the Hall was right; the browser
    test measured its tail on top of the kick's own three-second tail. The
    spec now subtracts a dry take and holds the knob both ways. The spring
    reverb clone (15) no longer waits on it.
14a. **Importing SoundFonts** (V18). Done: "Import a SoundFont…" on a lane's
    Osc page reads a `.sf2`, asks which instrument, and keeps it as a sample of
    its own kind with each recording's keys and loop. Not tried with a real
    font yet: FreePats' Upright Piano KW (CC0) is the first to try.
15. **Clones of well-known effects** (the second half of V5). Done, the spring reverb last (a Spring kind of reverb and a "Spring style" preset, not verified by ear): presets named "… style" on each effect, with a colour and a wow on the delay and kinds of drive. Was: the list the
    owner agreed on 2026-10-19, with knobs added to an effect where a clone
    needs them.
16. **A scale lock** (V7). Done: Randomize's key and scale are the studio's
    one, with a Lock switch; locked, keys played land in the scale, the
    keyboard and roll mark the notes outside it and the roll takes none there,
    and the chord menu has chords in the key. The owner confirmed the details
    on 2026-10-20 and asked for more scales and chords, which were added.
17. **A tempo for each scene** (V10). Done: a Tempo field beside the scene's
    time signature; the transport, the song's length, WAV and MIDI export
    follow it. Synced effects, swing and the arpeggiator still follow the
    project's tempo.
18. **More from portamento** (V11b). Done: on the Amp page, a Sync menu for
    the glide time, Held keys only (fingered glide on a poly lane) and Same
    speed (an octave in the knob's time). Not done: each voice of a chord
    gliding from its own last note, and Glide on a lane's face.
19. **A true progress bar for exports** (features 13). Done: a bar in the
    Export dialog and on the rack's message. The lanes and the drums are the
    first half, one share each, with a pause after each so the page can draw;
    the browser's own render is the second half, which stops at ten points
    to say so (`suspend`). Stems count across the whole zip.
20. **Drag to reorder lanes, scenes and the playlist's rows** (V14,
    features 14), with a keyboard way as well. Done for the scenes (drag, or
    Alt and an arrow, a `scene.move` edit), the song's blocks and the
    playlist's rows (drag; their arrow buttons were already the keyboard way).
    A finger holds before it drags. Lanes too, as the owner decided on
    2026-10-20: moving one changes only where it is shown (Alt and an arrow
    on its name plate, or dragging its strip in the mixer).
21. **A picture of the sound** (V12): a small scope or spectrum on a lane
    and on the master. Done: a Wave or Spectrum picture at the top of the open
    lane's Sound level and beside the main volume on the mixer, drawn outside
    React from an analyser made only when a picture asks.
22a. **A SoundFont drum kit on the drum lanes.** Asked for by the owner on
    2026-10-20. Done: SoundFont Kit in the drum strip offers each lane the drum
    General MIDI has for it, through Import Kit's dialog.
22. **Several recordings across the keyboard for an imported sample** (V1).
    Done: Import several recordings… on the Osc page, each file's note read
    from its name and shown to be changed, kept as one instrument.
23. **A listener's page that shows the song moving** (V16). Done: the song
    order on a share page is a strip of its scenes in their colours, each as
    wide as it lasts; while the song plays the playing scene is lit and a line
    moves through it, and pressing a scene plays from there.
24. **More MIDI** (features 6): following an external clock, sending notes
    played by hand, choosing the output channels, aftertouch. Each part is
    tested by the owner on their controller.
25. **More than four modulation routes**, with the LFO tab's own menus
    folded into them (sound 4).
26. **The design review's screens not looked at** (improvements 9).
27. **Published songs** (features 9): a description or picture, the list's
    order, playing from the list.

### 4. Large (L, several runs)

28. **Automation for the rest of the project** (features 5): the drums, the
    effects, the tempo, macro knobs, ramps between steps, and automation
    against the song.
29. **Pattern lengths that are not whole bars, and a part shared between
    scenes** (features 4).

### 5. Waiting on the owner

Cheap for the agent but blocked until the owner does or says something.

- **Listening** (sound 1): a long Room reverb, which the owner heard as static on 2026-10-20 and which now holds its level and darkens past 2.1 s; the Hall, the inserts and aux buses, the
  randomizer, the sample engine and the newer models are not heard yet.
- **More sounds, a recorded drum kit, a china and a sizzle** (V2, V3, V4):
  each needs the owner's say-so and a licence read at its source.
- **A second sample song and more starting beats** (V6): made, then heard.
- **The ladder filter's level** (sound 5): an ear decision.
- **MIDI hardware**: nothing MIDI has been tried with a real controller.
- **A screen reader trial** (improvements 5).
- **Firefox and guest instruments**: what the owner sees there.
- **Live collaboration** (features 7): the owner lifted the rule on 2026-10-20 and it is being built in stages (`docs/LIVE_SESSIONS_PLAN.md`): all four stages are built (the relay, edits, the transport, presence), and playing together with a snap to the beat, and wait to be tried by two people on the site. Was: needs the rule against a held-open
  connection changed on purpose. L.
- **Samples that sync** (sound 2): not planned; the storage asks for a card.

New ideas go under "Ideas folded in from roadmap v2" at the end of this file,
and are placed in this plan when the owner agrees to them.

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
   Done (2026-10-19): the store records every undoable operation as it is
   applied and a step puts back the whole project (`undoHistory.ts`). A step
   is one turn's edits, a run of changes to one control, or a group held
   open; it is kept as the whole project, not as patches, which was simpler
   and is small enough. Scene, song, kit and mute edits are now undone too.

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

4. **Give the audio layer a single owner.** First part done on 2026-10-13,
   with no change to any sound intended; not verified by ear. The context,
   the master chain, the effect buses and what is sounding belong to one
   `AudioEngine` in `browserAudio.ts`, which can be disposed of and made
   again, and tests make their own. Still open: every caller still goes
   through the module's functions, which call the app's one engine. Passing
   the engine to the hooks explicitly was done on 2026-10-20 (pull request
   231, plan item 13).

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
   are named. The on-screen keyboard is now one stop too, its keys reached
   with the arrow keys, Home and End, and the piano roll is a grid whose
   step numbers and note names are the headings of its columns and rows.
   Still open: nothing, the walkthrough included, has been tried with a
   screen reader; and whether left and right on the on-screen keys should
   go on walking the selected step, as they do now, is the owner's to say.

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

   Redesign B (a lane's editor in two levels, Notes and Sound) is built,
   with the presets and their tools inside Sound. Not built from its
   proposal: the pages of the sound side by side on a wide screen, the
   preset's name on the lane's top line, and the preset tools folded into
   a "more" menu. The review says what was left and why.

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
   To listen to, from the pass over the built-in sounds and beats on
   2026-10-13. None of it is verified by ear: each change was chosen from
   what the sound's name promises and from measurements (level, how far the
   level moves while a chord is held for eight seconds, and how much of the
   sound differs between the two sides). No preset's name or id changed, and
   a project already saved keeps the sound it has: a preset is only applied
   when it is loaded.
   Presets changed, in the order of the menu:
   - Bass, FM Bass: a harder note is brighter (velocity to the FM amount);
     at a middling strength it is what it was.
   - Lead, Mono/Poly Lead and Odyssey Sync: vibrato, which the other leads
     had and these two did not.
   - Lead, Soft Lead: a second layer, slightly out of tune, a little
     brighter and placed apart. It measured the same on both sides and now
     measures 0.42 wide. It plays four notes at once, not eight.
   - Lead, Glass Lead: a harder note is glassier (velocity to the FM amount).
   - Pad, M1 Voices: a slow vibrato, and notes spread across the two sides
     by pitch (it measured the same on both sides; now 0.23).
   - Pad, Glass Pad: the FM amount drifts slowly and the sound sways from
     side to side. Its level moved 0.8 dB while held and its brightness
     hardly at all; now 1.7 dB and about a third of an octave.
   - Pad, Breath Pad: it swells and falls slowly, as breathing does, and
     drifts a little from side to side (0.9 dB of movement before, 5.8 now).
   - Keys, M1 Organ: a gentle tremolo at six a second, as a rotary speaker
     gives; it was a still sound.
   - Keys, Digital Piano: a harder note is brighter (velocity to the FM
     amount), on top of the filter that already followed it.
   - Pluck, Chord Stab and Blip: a harder note is brighter (velocity to the
     filter), as the other plucks already were. Blip is a little louder: it
     was the quietest pluck.
   - Effects, Wind: the gusts cross from side to side as they brighten.
   - Effects, Helicopter: it circles slowly from one side to the other.
   Presets added:
   - Bass, Sync Bass: oscillator sync swept by the filter's envelope,
     through the ladder filter.
   - Lead, Stereo Lead: a saw and a pulse through the ladder filter, in two
     layers placed far apart (0.76 wide, the widest lead).
   - Pad, Voices in Time: the sequence of voice waves stepped through in
     time with the tempo, a wave each half note, in two layers.
   - Pad, Gate Pad: a chord cut into eighth notes in time with the tempo,
     with the filter opening and closing once a bar.
   - Keys, Felt Piano: the recorded piano, darker and softer, in two layers
     a little apart.
   - Keys, Suitcase Keys: an FM electric piano that moves from side to side
     in time with the tempo, brighter for a harder note.
   - Pluck, Harp: the recorded harp attack over a soft triangle that carries
     the note, low notes to the left and high to the right.
   - Pluck, Octave Arp: a pluck through the ladder filter that comes with
     the arpeggiator on, up and down through two octaves.
   - Effects, Computer: a square wave stepping to a random pitch and place
     every sixteenth note, in time with the tempo.
   - Effects, Dive: a note that starts an octave up and falls.
   Looked at and left alone: Pluck Bass was tried on the ladder filter and
   lost 1.7 dB with its level already at the most a lane allows, so it is as
   it was. Super Saw measures narrow (0.06) but two layers of five copies is
   a lot of work for a phone. A model's preset can only be given what its
   macros leave alone, so M1 Voices could not have a second layer.
   The three starting beats, each with one or two hits that are not played
   every time and one that repeats within its step:
   - House Beat: the ghost snare before the bar comes round plays half the
     time, and the last closed hat is played twice.
   - Slow Groove: the ghost snare in the middle plays seven times in ten,
     the open hat three in four, and the last ghost snare is a drag (two
     quick hits) into the next bar.
   - Electro: a quiet ghost snare after the third kick, six times in ten;
     the high tom of the fill is a roll of two; the open hat at the end
     plays seven times in ten.

2. **Samples that travel with a project.** (files done; sync still open)
   A saved project file now carries the audio of the samples its drum lanes
   use, and opening it on another device puts them in that browser. Share
   links, published songs, sync and shared projects still carry no audio, so
   a lane's sample is missing there. Syncing samples needs file storage on
   the server. The storage first planned, Cloudflare R2, asks for a payment
   card, and the owner said on 2026-10-12 that the project pays for
   nothing. So this is not planned on R2. It stays open only if a way is
   found that costs nothing and asks for no card; until then samples
   travel in project files, which is free and works today.

3. **A sample oscillator in the synth.** (M) Done on 2026-10-12, not verified
   by ear. A synth lane's engine can be Sample: it plays an imported sample
   up and down the keyboard, through the lane's filter, envelopes, routes
   and second layer. A root note says which key gives the recorded pitch,
   and Loop sends it round while a key is held. Project files carry the
   sample; links, published songs and sync do not, and there the lane plays
   its oscillator. On 2026-10-13, not verified by ear: Start says where
   in the recording a note begins, and Loop From and Loop To say which
   part goes round, with the end of a chosen loop faded into what comes
   before its start so the join does not click; and a recording played
   two or more times faster than it was made no longer folds its top back
   as false tones (measured: from 27 dB under the note to inaudible).
   Open: several recordings across the keyboard for an imported sample;
   the last octave of folding, for a recording played between one and two
   times its speed, which is read as it is.

4. **A modulation matrix.** (M) First part done on 2026-10-12, not verified
   by ear: up to four routes a sound, on the LFO tab under Routing. Sources
   are the two LFOs, both envelopes, velocity, key and a stepped random;
   destinations are pitch, the second oscillator's pitch, the filter, the
   level, pulse width, pan and FM amount. The mod wheel is now a source (features 6); open: more than four routes; and the LFO tab's own
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
   The reverb half is done (2026-10-13): the reverb's Kind menu chooses Room,
   the convolver with a shaped impulse it always was, or Hall, damped
   feedback combs into all-passes (Freeverb's shape), built from native
   nodes by one function for live playback
   and export, whose decay and damping change without rebuilding anything.
   The names Room and Hall are the builder's and the owner may change them.
   Insert effects per lane are done (2026-10-19): drive, tone, a chorus and a delay on a
   lane's own Inserts page, run inside the synth core so live and export match; the Polysix's
   Ensemble is the mix of its chorus. The set of four is the builder's choice. Not verified by ear.

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
   Done on 2026-10-12: the CS-80, with a second layer for the voice (any
   sound can have one) and three presets. Not verified by ear.
   Done on 2026-10-12: the M1, the D-50 and the Wavestation, the last
   three, with eight presets. They play recordings and single-cycle waves
   from two CC0 libraries the owner chose (`docs/BUNDLED_AUDIO.md`), 430 KB
   in all. Every model in the plan is now built. Not verified by ear, and
   which waves went into each sequence was chosen without hearing them.
   Done on 2026-10-12: the Virus, with three presets. Not verified by ear.
   Done on 2026-10-12: the Odyssey, with oscillator sync and ring
   modulation for the voice and three presets. Not verified by ear.
   Done on 2026-10-12: the MS-20, the first model that needed engine work,
   with three presets. Not verified by ear.
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

8. **The drum machine's cymbal, and more cymbals to choose from.** (M) Asked
   for by the owner on 2026-10-12: "the cymbal on the drum machine sounds
   bad. also give more cymbal options on drums". The Cymbal lane has two
   sounds, Ride and Crash, both synthesized. Two parts:
   - A pass at how the cymbal sounds. Ask the owner first which is bad
     (the ride, the crash, or both), in which kit, and in what way (harsh,
     thin, too short, like noise), then change `renderRide` and
     `renderCrash` in `DrumCore` to answer it. A sound that was changed
     must be listed for the owner to hear; a test cannot say it is better.
   - More cymbals on that lane: for example a splash, a china, a ride bell
     and a sizzle beside Ride and Crash. To settle in building it: whether
     they are further choices on the one Cymbal lane, as Ride and Crash are
     today, or a second cymbal lane; and whether any should be a recording
     from a library the project may ship (`docs/BUNDLED_AUDIO.md`), which
     needs the owner's say-so, or all synthesized.
   A saved project must go on playing the cymbal it chose.
   Done on 2026-10-12, not verified by ear. The owner said it was both
   cymbals in every kit ("sound nothing like cymbals really", "the hats are
   fine") and agreed to recordings. The Cymbal lane now plays a recording
   of a real cymbal, the same in every kit, and offers four: Crash, Ride,
   Bell and Splash, chosen from a menu in the drum strip. They are from
   the free library the piano came from (`docs/BUNDLED_AUDIO.md`) and add
   about 430 KB to the first visit. A project that chose Crash or Ride
   keeps that choice and now hears the recording. Open: a china and a
   sizzle, which the library does not have; a second cymbal lane; kids
   mode, which still plays the synthesized cymbal.

9. **More bundled open-source sounds, drums especially.** (M) Asked for by
   the owner on 2026-10-19, to be done first, from the Versilian Community
   Sample Library (CC0). Part 1, done on 2026-10-19, not verified by ear:
   a **Recorded** kit in the kit menu in which every drum lane plays a
   recording (one hit each), about 208 KB added to `waves.bin`. Tune,
   Decay and Tone act on a recording as they do on the cymbal. Open: a
   second, harder hit for velocity; the name "Recorded", which the owner
   may change; the kit's default levels, set by reasoning. Part 2, done on
   2026-10-19, not verified by ear: a Voice menu on four lanes, in any kit:
   Clap is a tambourine, shaker or cowbell, Snare a cross-stick, Low Tom a
   conga and High Tom a bongo (about 111 KB more). Open: more choices, a
   second hit each. Part 3, done on 2026-10-19, not verified by ear: seven
   VCSL instruments as built-in sounds for the sample engine (two grand
   pianos, a pipe organ, a tenor sax, three FM keyboards), about 2.7 MB in
   all, each its own file fetched the first time it is used. Open: a
   preset or two made from them; more notes or a second velocity layer;
   a way to fetch them ahead of time for use offline.

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
   Done on 2026-10-13, not verified by ear: the metronome (Click) and a
   one-bar count-in (Count), beside Tap, kept per browser and in no export.
   Still open: quantize strength, recording from the on-screen keyboard,
   a level for the click, and a count-in of more than one bar.
   Done on 2026-10-13, not tried by a person playing: Rec in a lane's
   keyboard panel records the on-screen and computer keyboards while the
   song runs; a Quantize menu (100, 75, 50, 0%) says how firmly a played
   note is moved onto the nearest step, for those and for MIDI's record
   mode. A recorded note now lands on the step the player hears; it used
   to land on the step the scheduler had reached, up to a step early.
   Still open: how long a recorded note is held (every one is a step
   long); the click's level and a longer count-in are in
   the ideas at the end of this file.

4. **More ways to edit patterns.** (M)
   Lengths that are not a whole number of bars (a 12-step lane against 16);
   copying one bar to another; copy and paste between scenes, and sharing a
   part between scenes (`docs/SONG_MODE_PLAN.md`). A step holds one start
   time, so an on-the-step note and a late one cannot share a step; a 32-step
   lane is the way to get both.
   Done on 2026-10-13: a Copy to menu on each lane and on the drum strip
   puts that lane's notes, or the selected drum's row, into another scene.
   It asks first when the other scene has something there, because it is
   not in the undo history. Also done that day: a Copy bar menu beside the
   bar buttons of a lane or the drum grid lays the bar on show over
   another bar, or over every other, as one undo step. Still open: lengths
   that are not a whole number of bars, and sharing a part between scenes.

5. **Parameter automation.** (L, after the typed store)
   Built on 2026-10-14 and merged as built at the owner's word: every choice
   listed on its pull request (#187) is accepted.
   Record knob movements per step or per bar and play them back. Filter sweeps
   over a section are a large part of electronic arrangement. The owner asked
   on 2026-10-12 whether a hardware knob could record it: yes, if the knob
   mapping in item 6 is built so that a mapped hardware knob changes a
   parameter by the same store operation the knob on screen sends. Recording
   is then the same for both. A hardware knob sends 128 positions, so a
   recorded sweep needs smoothing between them on playback.
   First version built on 2026-10-13 and waiting as a draft for the owner:
   a synth lane's own numbers (cutoff, resonance, level, pan, the envelope,
   the LFOs' rates and depths, detune, pulse width, sub, noise, glide, the
   filter's envelope amount and drive; up to eight per lane) get a value per
   step, kept with the pattern and so with the scene. Drawn in a row under
   the open lane's steps, or recorded with Auto from a knob on screen or a
   tied controller knob while the song plays. Played live at each step's own
   time and in audio exports, stems, loops and shared songs. Each value is
   held for its step (the voice's own hundredth of a second of smoothing is
   all there is between steps); a step with none plays the knob's setting.
   Still open: the drums, the effects, the tempo, a model's macro knobs and
   the lane's sends and duck (all outside the synth voice); ramps between
   steps, which a recorded hardware sweep wants; automation recorded against
   the song rather than a scene's pattern; automation in MIDI files; and the
   knob on screen turning with the automation while the song plays.

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
   First two parts built on 2026-10-13 and waiting as a draft for the
   owner to try with their controller: pads on channel 10 (or another
   chosen in the MIDI panel) play the drums and, in record mode, are
   written on the step being played; the keyboard on its own channel plays
   its lane at the same time. Knobs by learning are merged.

   The rest of what the owner asked for was built on 2026-10-13, not tried
   with real hardware: each drum's pad can be changed (Learn beside the drum
   in the MIDI panel, then hit the pad; a note has one drum and a drum one
   note; Reset pads puts the General MIDI notes back), and with more than
   one controller connected each has a place of its own (as before, the
   open lane, Synth 1 to 3, the drums, or off). Both are kept in the
   browser, not the project. Pitch bend (two semitones) and the mod wheel (CC 1, a route source) are done, as live gestures that are not saved or exported, not verified by ear or on hardware. Still open from this item: aftertouch, following an external clock, sending notes
   played by hand, and choosing the output channels. Choices made in
   building it that the owner has not confirmed: a device's place is kept
   by its name; a device sent to a lane plays it on every channel; Off
   stops a device's knobs as well as its notes; and a drum still on its
   usual note goes on answering to the General MIDI notes near it.

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
    **Built on 2026-10-13, not verified by ear and not tried by a person:** a
    Time menu in the song unit sets the open scene's signature, one of the
    six, and no custom number of steps. Every lane and the drum grid of
    that scene become bars of it (16, 12, 12, 20, 14 or 24 sixteenth steps;
    twice that on a lane of finer steps), keeping how many bars they have:
    a shorter bar loses the steps at its end and one Undo brings them back,
    a longer one gains empty steps. The beat marks, the metronome and the
    count-in, the phone's rows, the playhead, song mode, the playlist's
    times, and WAV, loop, stem and MIDI export all take each scene's own
    bar length; a MIDI file carries the signature and each change of it.
    A project in 4/4 stores nothing new and renders as it did. Still open:
    7/8 is counted two, two, three and nothing else; the delay's tempo sync
    is in note values and so was left alone; MIDI import still reads a file
    as 4/4 and lays it along the scene's bars; a guest is told beats, never
    the signature; a browser still running the version before this reads a
    bar of fewer than sixteen steps as damage and pads it.

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
    which file of how many). A true progress bar followed (plan item 19).
    Done on 2026-10-13: Export is one dialog in place of the menu, with what
    to export, as what, how long the file will be, and the message about
    its making in the same place.

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
    **Done on 2026-10-13**, as a second way of showing the song beside the
    blocks: a Blocks/Playlist switch in the song unit, remembered per browser,
    with the blocks still the default. The playlist is a row for each entry in
    playing order with its place, the scene's colour and name, its repeats, the
    bars of one pass and of the whole row, when it starts and how long it lasts
    at the project's tempo, a lamp on the row that is playing, and a total at
    the foot. Each row has buttons to move it earlier or later, change its
    repeats, remove it, add a chosen scene after it and open its scene; a
    scene can also be added at the end. A row's duration is shown both ways,
    in bars and in repeats. Still open: dragging a row to reorder it was not
    built; times assume four beats to a bar, as the rest of the app does; the
    playlist has not been seen on a real screen or tried with a screen reader.

15. **Chord buttons in the piano roll.** (S) Asked for by the owner on
    2026-10-12. Offer buttons to insert editable chord notes at the selected
    step, with a chosen root and chord type. These are note-entry shortcuts,
    using the existing note length, velocity and undo behavior, not a new
    synthesis feature; chords already play. Basic major and minor chords are a
    reasonable starting point. The final chord set, inversions and whether
    insertion adds to or replaces notes are still design choices.
    How the owner wants it to work, said on 2026-10-12:
    - Choose a shape first (major, minor and so on), then the root note:
      with a shape chosen, pressing a note in the roll puts the whole chord
      there, built on that note.
    - Once a chord is in the roll, each of its notes can be deleted or made
      longer by itself.
    - "Perhaps a toggle" between changing one note and changing the whole
      chord, meaning every note in the step. The owner was unsure of the
      toggle; show them a way of doing it before settling.
    What this needs that the app does not have: a step holds one length for
    all its notes (`step.length`), so a note of a chord cannot yet be longer
    than its neighbours. Each note needs a length of its own, stored so that
    older projects play as they did, and carried through playback, the
    arpeggiator, WAV and MIDI export and MIDI import (`expandStepNotes`).
    That makes this larger than the (S) above: (M).
    First part done on 2026-10-13: the piano roll has a Chord menu (major,
    minor, seventh, major and minor 7th, sus 2, sus 4, diminished, fifth).
    With a shape chosen, a note put in is the root and the rest of the
    chord comes with it, as one edit. Each note can be taken out by
    itself. Still open: a length for each note, so one note of a chord can
    be made longer than the others, and the toggle between one note and
    the whole step; inversions.
    Second part done on 2026-10-13: each note of a chord has a length of
    its own. Dragging a note's end in the piano roll changes that note
    alone; a Whole step switch beside the Chord menu makes every note of
    the step go together, as before. Playback, WAV and MIDI export and MIDI
    import all carry it. The switch is the "perhaps a toggle" the owner
    spoke of, and is theirs to keep or drop. Inversions are in
    the ideas at the end of this file.

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

18. **Tempo sync on everything that has a rate.** (M) Asked for by the owner
    on 2026-10-12, and put at the front of the queue: "everything with a
    rate knob should have a sync button that syncs to tempo". Today the two
    LFOs of a lane have a Sync box and the delay has a Sync menu. These
    have a rate and no sync:
    - the phaser's Rate and the chorus's Rate, in the effects unit;
    - the Speed of a sequence of waves in the sample engine, and with it
      the Wavestation model's Speed knob;
    - rates a model sets and does not show, such as the Odyssey's
      sample-and-hold and the Polysix's pulse movement, which could follow
      the tempo when the model is chosen.
    Synced, a rate is a note value (one cycle or one step a bar, a half, a
    quarter and so on) and follows the tempo as it changes, live and in
    every export, as the LFOs and the delay do. Each new sync is a stored
    setting: absent means off, so an older project plays as it did. To
    settle in building it: one look for all of them (the LFOs use a tick
    box and the delay a menu), and whether dotted and triplet values are
    offered. A control added later that has a rate should come with its
    sync.
    Built on 2026-10-12, not verified by ear: the phaser, the chorus and
    the speed of a sequence of waves each have a Sync menu, from once every
    eight bars to once a sixteenth. The knob shows the note value while
    synced, and turning it sets a free rate again. On 2026-10-13 the
    LFOs' tick box became a Sync menu like the effects' (Free, then a bar
    down to 1/32; an LFO cannot go slower than a bar), with the knob still
    stepping through note values while synced. Still open: the delay's
    own menu has dotted and triplet values and the others do not; an
    LFO's knob steps note values where an effect's goes back to free; the
    Wavestation model's Speed knob does nothing while its sequence is
    synced; and the rates a model sets without showing them are LFOs, which
    can be synced on the LFO tab but are not when the model is chosen.

19. **Transpose.** (S to M) Asked for by the owner on 2026-10-12. Nothing
    moves notes up or down today except a lane's octave setting, which
    changes what the keyboard and the piano roll show, not the notes
    stored. To ask the owner before building: what is moved (one lane's
    pattern, every lane in a scene, or the whole song); by how much
    (semitones, octaves); and whether it rewrites the notes or is a setting
    that shifts them as they play, which could differ from scene to scene
    and be automated later. Drums are not transposed.
    Done on 2026-10-13: four buttons in a lane's Notes tab (−12, −1, +1,
    +12) rewrite the notes of that lane's pattern in the open scene,
    chords together, as one undo step. A move that would take any note
    below C0 or above B8 is not offered. The owner answered the questions
    the same day, each as built: one lane in the open scene, those four
    buttons, the notes rewritten, and a button disabled at the edge.

20. **A randomizer.** (M) Asked for by the owner on 2026-10-12. To ask the
    owner before building, because it could mean several things: random
    notes in a lane's pattern (held to a scale, so they sound like music);
    a random drum pattern; a random sound for a lane (every knob, or only
    some, or a gentle nudge of the sound that is there); or all of these
    on one button. Whatever it is, one press is one undo step, and it never
    touches what it was not pointed at.
    Done on 2026-10-13, not verified by ear: a key, a scale (major,
    minor and the two pentatonics) and a Randomize button in a lane's
    Notes tab, which replace that lane's notes in the open scene with a
    new line in the scale, as one undo step. The owner answered the same
    day, all as built: random notes for synth lanes only is what was
    meant (not a drum pattern, not a random sound); the kind of line it
    makes is what they wanted, though nobody has yet heard one; the
    browser remembering the last key and scale, not the project, is
    fine; and it does not ask before replacing a lane's notes.

21. **A full song among the starting points.** (S to M) Asked for by the
    owner on 2026-10-12: "add a full song example along with the beat
    examples". The strip on an empty project offers three beats, each a
    tempo, a drum grid and one lane's pattern in a single scene
    (`ui/src/services/starters.ts`). A song is several scenes in order,
    with all three lanes, their sounds, and the song's arrangement, so a
    starter must be able to carry scenes, a song and sounds, which a beat
    does not. It is also a good place to show what the app can do: the new
    models, a scene's colour, mutes that differ from scene to scene.
    Nobody can write a good song by reasoning alone: it is made, then the
    owner listens, and it is changed until they like it.
    First version built on 2026-10-13, not verified by ear: a Sample Song
    button on the strip opens a finished song as a new project. It is in A
    minor at 118, five sections of four bars (intro, verse, chorus, break,
    outro, the chorus returning after the break), about seventy seconds,
    with a bass, a pad and a bell lead on three built-in sounds and the
    recorded crash. The three beats were dressed up the same day: quiet
    and loud hats, ghost notes, a fill, and bass notes of different
    strengths. On 2026-10-13 they were also given hits left to chance and
    repeats (listed under sound 1). Open: the owner hearing all of it and
    saying what to change; more than one song.

22. **A master mixer.** (M) Asked for by the owner on 2026-10-12. Levels are
    spread about today: each synth lane has a Level knob on its face and
    its pan and sends in its editor, the drums have a master volume and a
    volume for each drum, a guest has a level in its own unit, and the
    master EQ is in the effects unit. There is no one place that shows
    everything side by side, no meters, and no level for the whole mix.
    A mixer would be one unit with a strip for each synth lane, the drums
    and each guest (level, pan, mute, solo, the effect sends), a strip for
    the whole mix, and meters that show what is sounding. To ask the owner
    before building: whether it replaces the knobs where they are now or
    sits beside them, showing the same values; whether each drum has a
    strip or the drums are one; and whether the whole mix gets its own
    level, since the output is only limited near full scale today. The
    meters must not set React state many times a second (the playhead rule
    in `AGENTS.md`). Levels are per scene for guests and project-wide for
    lanes, and a mixer has to show that honestly.
    First version built on 2026-10-13, to the owner's answer ("a new unit,
    same levels. Each instrument should have a channel"): a Mixer unit
    between the drums and the effects, with a strip for each synth lane,
    each guest, each of the eight drums and the kit as a whole, the two
    effect returns and the main volume. Each strip is a fader, with a pan
    knob, mute and solo where the channel has them. Nothing new is stored:
    a fader and the knob it mirrors are one setting. Still open, and each
    needs the owner's word or work in the audio layer first: meters; the
    effect sends on each strip; a level for the whole mix that is saved
    with the project (the main volume shown is this browser's); solo for a
    guest.

23. **Delay and reverb sends for each drum sound.** (M) Asked for by the
    owner on 2026-10-12. The drums have one set of sends for the whole kit
    today (`drumFx`), so reverb on the snare is reverb on the kick as well.
    Each of the eight drums should have its own send to the delay and to
    the reverb. All eight are mixed to one stereo signal inside `DrumCore`
    before anything outside can reach them, so the core has to hand each
    drum out separately, or hand out a second mix for each send, in live
    playback and in export alike. Stored per drum, absent meaning what the
    kit's sends give today, so an older project sounds as it did. To ask
    the owner: whether the kit's own sends stay as a master over the
    eight, and whether drive, phaser and chorus get a send for each drum
    too or only the two asked for.
    **Built on 2026-10-13 to the owner's answer** (delay and reverb only,
    the kit's sends a master over them), not verified by ear. Under Sends in
    the drum strip the selected drum has two knobs, Delay and Reverb, before
    the kit's. Each is a share from 0 to 100% of what the kit sends to that
    effect: what reaches the delay from a drum is the drum, times its
    share, times the kit's Dly Send. Every drum starts at 100%, which is
    what it sent before, and a share of 100% is stored as nothing, so a
    project that never turns one is the project it was and exports the
    same file. A drum is turned down to keep it out; it cannot be sent
    more than the kit is. `DrumCore` makes a second and a third mix of
    its voices beside the kit; live they are the drum processor's second
    and third outputs, and an export makes them only when a drum that
    plays is held back. Choosing a kit or pressing Apply Kit leaves the
    shares alone, as it leaves the cymbal type and an imported sample;
    Reset drums puts them back to 100%. A stem of the drums has its
    effects, as it had. A controller's knob can be tied to either. The
    Mixer shows levels and pans only and has no knob for these.

24. **Aux sends that can be routed to effects.** (L) Done (2026-10-19) as the owner
    decided: two buses, each an echo, the Hall or a chorus, with a send to each from every
    lane, the drums and each guest, added to the five fixed sends. Still open: a chain of effects
    on a bus, one bus feeding another, and the mixer unit showing the sends. The original
    request follows. Asked for by the owner
    on 2026-10-12. Today the sends are fixed: every lane has one send to
    each of the five shared effects (drive, phaser, delay, reverb, chorus),
    and each effect is always there. Routable aux sends would mean a small
    number of aux buses, each with a chain of effects the person chooses
    and orders, and a send to each bus from every lane, the drums (or each
    drum, item 23) and each guest. To ask the owner before building: how
    many buses; whether an effect can be used on more than one bus; whether
    one bus can feed another (a delay into the reverb); and whether this
    replaces the five fixed sends or is added to them. Projects saved with
    the fixed sends must open sounding the same. It belongs with the master
    mixer (item 22), which is where the sends and the buses would be
    shown, and needs the audio layer's single owner (improvements 4) first.

## Questions waiting on the owner

- **Firefox guests.** The owner said on 2026-10-13 that the timing "still
  seems off" on Firefox after PRs #76 and #77. Still to ask: what is
  heard (a guest early, late, drifting further out as it plays, or
  stuttering), and with which guest.
- **Controller knobs and MIDI pads.** Both are built as the owner asked,
  with pads that can be changed and a place for each device; none of it
  has been tried with the Launchkey.
- **A drum's own delay and reverb sends** (features 23). Built so that a
  drum's knob is a share of the kit's send and starts at 100%, which is
  the only way an older project sounds the same. So a drum can be taken
  out of an effect but not sent more than the rest of the kit; to have
  reverb on the snare alone, the kit's Rev Send goes up and the other
  drums' Reverb knobs go down. Is that the right way round? And: should
  Apply Kit put the shares back to 100% (it leaves them), and should the
  two knobs be with a drum's other knobs rather than under Sends?

## Decided by the owner on 2026-10-20

- **The scale lock**: the builder's choices stand (the key and scale are
  this browser's; a key outside the scale sounds as the nearest note in it;
  the roll takes no note outside it; the chord menu has the key's chords).
  More scales and chords were asked for, and added: twelve more scales
  (the modes, harmonic and melodic minor, Phrygian dominant, Hungarian
  minor, Blues, Whole tone, Hirajoshi), fourteen more chord shapes in three
  groups, and a ninth in the key.
- **Moving lanes**: only where they are shown. A lane keeps its number, its
  MIDI channel and its name; moving it changes its place on the rack, the
  bar of units and the mixer.

## Decided by the owner on 2026-10-13

Answers given in one sitting. Each is settled; build to it without asking
again.

- **Transpose.** As built and merged: one lane in the open scene, four
  buttons, the notes rewritten, a button disabled at the edge of the range.
- **Controller knobs.** As built and merged: ties kept with the browser
  for now, the value jumps to the controller's knob, the parameter chosen
  from a menu.
- **Randomizer.** As built: random notes for synth lanes only, the kind of
  line it makes, the browser remembering the last key and scale, and no
  question before it replaces a lane's notes.
- **A knob's reset.** A middle click puts a knob back at its default, not
  at zero.
- **The scroll wheel on knobs.** The rule that the pointer must rest on a
  knob before the wheel turns it is good.
- **The piano keys' arrows.** Left and right standing aside while a step
  is selected is fine.
- **Time signatures.** The six agreed ones only. No custom number of
  steps in a bar.
- **Master mixer.** A new unit showing the same levels as the knobs that
  exist, which stay. Each instrument has a channel.
- **A delay and reverb send for each drum.** Yes: delay and reverb only,
  with the kit's own sends as a master over them.
- **Aux sends.** Two for now. Which effects they can be pointed at is the
  builder's choice.
- **MIDI.** Each pad can be given to any drum. When more than one device
  is connected, each can have a destination of its own.
- **Kids mode.** What a child makes cannot be opened in the full app.
- **The Polysix model and the chorus.** When a lane can have effects of
  its own, the Polysix's Ensemble moves from the lane's send on the shared
  chorus to an effect of its own.
- **Tape Loop Deck.** Was: stays off the Add Guest list. Changed on 2026-10-21:
  the owner put it back, since what held it was its tapes not being kept, and
  guests can now keep files with a project.

## Suggested order

Replaced on 2026-10-19 by "The plan from here" at the top of this file.

## Ideas folded in from roadmap v2

These were the ideas at the end of this file until 2026-10-19, when the owner asked for the two
roadmaps to be one. Each is placed in "The plan from here" by its number (V1 to
V17). The same rules hold: the project pays for nothing, nothing is bundled
without a licence read at its source, and sound cannot be verified by a test.
A new idea is added here and placed in the plan when the owner agrees to it.

### Sound

V1. **Several recordings across the keyboard for an imported sample.** (M)
   The sample engine plays one imported recording at every pitch, which
   sounds wrong far from the note it was recorded at. The app's own piano
   already uses five recordings, each for its part of the keyboard. Let a
   person do the same: import several files, say which note each is, and
   the lane plays the nearest. Leans on the sample engine's zones, which
   exist.
V2. **More sounds that come with the app.** (S each) The same two free
   libraries have strings, brass, woodwinds, a harp, timpani, a
   glockenspiel and thousands of single-cycle waves. Each addition is
   download size for everyone, so a few at a time, chosen by the owner's
   ear.
V3. **Drum kits made of recordings.** (M) The cymbals are recordings now and
   the owner said the synthesized ones sounded nothing like cymbals. The
   same free library has a snare, bass drums, toms and hand percussion. A
   "Recorded" kit beside the synthesized ones would let the two be
   compared. Needs the owner's say-so for more bundled audio.
V4. **A china, a sizzle and a second cymbal lane.** (S to M) Left over from
   the cymbal work: the free library has neither a china nor a sizzle, and
   one lane can only be one cymbal at a time.
V5. **Effects presets, among them clones of well-known units.** (M) The
   effects have no presets. A preset menu on each effect's box (and on a
   lane's own insert effects, once they exist) would hold plain starting
   points (a small room, a long hall, a slapback, a tempo-synced dub delay)
   and, asked for by the owner on 2026-10-19, presets set up to sound like
   popular effects: a tape echo in the manner of the Space Echo, an
   analogue delay like the Memory Man, a plate and a spring reverb, the
   Juno's two chorus modes and a Dimension-style chorus, the Small Stone
   and Phase 90 phasers, and an overdrive, a distortion and a fuzz after
   the Tube Screamer, the RAT and the Big Muff. A clone is the app's own
   effect set to behave like the unit it is named for, as a synth model
   is; it is not that unit's circuit. The owner agreed this list as a start
   (2026-10-19), and said an effect may gain knobs of its own where a clone
   needs them (wow and flutter on the delay, a spring's drip, a drive's tone
   stack); they belong in the shared builders so live and export agree, and
   are optional settings like any other. What each preset is called is
   still for the owner. Leans on the insert effects and the Hall reverb, whose Decay in
   Chrome is a known issue to settle first.
V6. **A second sample song, and more starting beats.** (S each) One song in
   one style shows one side of the app. Each is made, heard by the owner,
   and changed.

### Playing and writing

V7. **A scale lock.** (M) Choose a key and scale once; the keyboard and the
   piano roll mark or only offer the notes in it, the chord menu builds
   chords that fit it, and the randomizer (current roadmap) uses it.
V8. **Inversions and a strum for chords.** (S) The chord menu puts a chord
   in root position with every note starting together. An inversion choice,
   and a strum that starts each note a little after the one below, would
   use the per-note timing the steps already have.
V9. **A count-in of more than one bar, and a level for the click.** (S) The
   metronome's count-in is one bar and its level is fixed.
V10. **A tempo for each scene.** (M) Tempo is project-wide. A song that
    slows for its break needs a tempo that a scene can set, carried through
    the transport, the exports and guest instruments.
V11. **Swing for the synth lanes.** (S) The drums have swing; the lanes do
    not, so a swung beat has straight bass.

V11a. **The arpeggiator held under a key.** (S) A key held on the keyboard is
    arpeggiated for one beat and stops, where a hardware arpeggiator runs for
    as long as the key is down, and latches with Hold.

V11b. **More from portamento.** (S to M) Asked for by the owner on
    2026-10-13. What exists: a switch and a Glide time on a lane's Amp
    page, which glides every note from the last note played, taking the
    same time whatever the distance, and a Slide on a step that holds a
    note into the next. What it could gain: a legato mode that glides only
    when a key is still held as the next is pressed, as most monophonic
    synths do (fingered portamento); a choice between the same time for
    any distance and the same speed, so a wide leap takes longer; a glide
    time that follows the tempo (a 1/16 or 1/8 glide); in a lane playing
    chords, each voice gliding from the note it last played rather than
    all from one; and Glide on the lane's face as one of its knobs where a
    model has none. Each is a choice on the sound, absent meaning what
    happens now, so stored sounds are unchanged.

### The interface

V12. **A picture of the sound.** (M) A small oscilloscope or spectrum on a
    lane, and on the master, so a person can see what a knob does as well
    as hear it. It must be drawn outside React's rendering, as the playhead
    is.
V13. **Search across presets.** (S) Eighty-six presets in six groups is
    past what a menu shows well. Typing a few letters to find one.
V14. **Drag to reorder lanes and scenes.** (M) With a keyboard way to do the
    same, as the rest of the app has.
V15. **A first-run choice.** (S) An empty project offers beats and a song in
    a strip. A new visitor might be better served by one plain question:
    start from a beat, open the sample song, or start empty.

### Sharing

V16. **A listener's page that shows the song moving.** (M) The page a share
    link opens plays the song and offers a copy. Showing the scenes going
    by, in their colours, would make it more than a play button.

### Under the surface

V17. **The audio engine handed to the hooks.** (M) The current roadmap gives
    the audio layer one owner. The step after is for the hooks and the
    studio to be given that owner instead of reaching for it, which is what
    makes the audio testable without a browser.

### Sound, added later

V18. **Importing SoundFonts.** (M) Asked for by the owner on 2026-10-19. A
    SoundFont (`.sf2`) is recordings tied to key ranges, with loop points and a
    root note, which is what the sample engine already plays for the bundled
    pianos. What is new: a reader for the file's instruments and their zones, a
    choice of which instrument to take, and keeping the result in this browser
    like an imported sample (not synced, as samples are not). A SoundFont's own
    envelopes and filter carry over only in part: the lane's sound stands in for
    them. Importing a person's own file avoids bundling: free fonts are 30 to
    300 MB and each needs its licence read. Test files with clear licences:
    FreePats' Upright Piano KW (small, SF2, 5.8 MB) and Spanish Classical Guitar
    (SF2, 9.5 MB), both CC0 (freepats.zenvoid.org); its MuldjordKit drum kit (SF2,
    53 MB, CC BY 4.0); and MuseScore's MS_General, a General MIDI set under MIT, for
    a file of many instruments.

### From comparing other web music apps (2026-10-21)

The owner asked what similar apps have that Discobot lacks. On 2026-10-22 they asked for
V19 to V22 in one pull request, and then V23.

V19. **Colour schemes, a light one among them.** Done: Studio (as before, the
    default), Daylight, High Contrast and Midnight, and Match This Device, in the
    Project menu's Colour Scheme, kept in this browser.
V20. **A searchable list of keyboard shortcuts.** Done: Shift + ? or Help's
    Keyboard Shortcuts button.
V21. **Pattern generation.** Done for the drums: Spread puts so many hits along a
    drum's bar as evenly as it allows (Euclidean rhythms). Not built: the same
    for a synth lane, which would need a note for each hit.
V22. **Swing templates.** Done: the menu beside the drums' Swing knob, swing
    counted as drum machines count it (54% to 75%, and a triplet), on sixteenths
    or, new, on eighths. Not built: templates that also set each step's strength
    (a groove's accents).
V23. **Audio tracks on a timeline.** (L) Recordings and loops placed on tracks along
    the song, trimmed, moved and faded: next, after V19 to V22.
- Not asked for yet: recording from a microphone, cutting a sample into slices,
  changing a recording's speed or pitch on its own, MP3 export, one-button
  mastering, a compressor per lane, comments or "remix this" on published songs,
  a vocoder, granular sound and pitch correction. Ableton Link cannot be done
  from a web page; turning a recording into notes well needs a paid server.
