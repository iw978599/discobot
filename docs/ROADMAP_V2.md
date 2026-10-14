# Roadmap v2

Ideas for after the current roadmap (`docs/ROADMAP.md`) is finished. The owner
asked for this on 2026-10-13: where building the current roadmap turns up a
new feature worth having or a part of the interface that could be better, it
is written here and not started. Nothing here is agreed, sized exactly, or in
any order that binds. Each entry says what it is, what it would change for
someone using the app, about how big it is (S, M or L), and what it leans on.

The same rules hold as for everything else: the project pays for nothing,
nothing is bundled without a licence read at its source, and sound cannot be
verified by a test.

## Sound

1. **Several recordings across the keyboard for an imported sample.** (M)
   The sample engine plays one imported recording at every pitch, which
   sounds wrong far from the note it was recorded at. The app's own piano
   already uses five recordings, each for its part of the keyboard. Let a
   person do the same: import several files, say which note each is, and
   the lane plays the nearest. Leans on the sample engine's zones, which
   exist.
2. **More sounds that come with the app.** (S each) The same two free
   libraries have strings, brass, woodwinds, a harp, timpani, a
   glockenspiel and thousands of single-cycle waves. Each addition is
   download size for everyone, so a few at a time, chosen by the owner's
   ear.
3. **Drum kits made of recordings.** (M) The cymbals are recordings now and
   the owner said the synthesized ones sounded nothing like cymbals. The
   same free library has a snare, bass drums, toms and hand percussion. A
   "Recorded" kit beside the synthesized ones would let the two be
   compared. Needs the owner's say-so for more bundled audio.
4. **A china, a sizzle and a second cymbal lane.** (S to M) Left over from
   the cymbal work: the free library has neither a china nor a sizzle, and
   one lane can only be one cymbal at a time.
5. **Effects presets.** (S) The effects unit has no presets. A handful
   (a small room, a long hall, a slapback, a tempo-synced dub delay) would
   be a quick way in, now that the delay, phaser and chorus can follow the
   tempo.
6. **A second sample song, and more starting beats.** (S each) One song in
   one style shows one side of the app. Each is made, heard by the owner,
   and changed.

## Playing and writing

7. **A scale lock.** (M) Choose a key and scale once; the keyboard and the
   piano roll mark or only offer the notes in it, the chord menu builds
   chords that fit it, and the randomizer (current roadmap) uses it.
8. **Inversions and a strum for chords.** (S) The chord menu puts a chord
   in root position with every note starting together. An inversion choice,
   and a strum that starts each note a little after the one below, would
   use the per-note timing the steps already have.
9. **A count-in of more than one bar, and a level for the click.** (S) The
   metronome's count-in is one bar and its level is fixed.
10. **A tempo for each scene.** (M) Tempo is project-wide. A song that
    slows for its break needs a tempo that a scene can set, carried through
    the transport, the exports and guest instruments.
11. **Swing for the synth lanes.** (S) The drums have swing; the lanes do
    not, so a swung beat has straight bass.

11a. **The arpeggiator held under a key.** (S) A key held on the keyboard is
    arpeggiated for one beat and stops, where a hardware arpeggiator runs for
    as long as the key is down, and latches with Hold.

11b. **More from portamento.** (S to M) Asked for by the owner on
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

## The interface

12. **A picture of the sound.** (M) A small oscilloscope or spectrum on a
    lane, and on the master, so a person can see what a knob does as well
    as hear it. It must be drawn outside React's rendering, as the playhead
    is.
13. **Search across presets.** (S) Eighty-six presets in six groups is
    past what a menu shows well. Typing a few letters to find one.
14. **Drag to reorder lanes and scenes.** (M) With a keyboard way to do the
    same, as the rest of the app has.
15. **A first-run choice.** (S) An empty project offers beats and a song in
    a strip. A new visitor might be better served by one plain question:
    start from a beat, open the sample song, or start empty.

## Sharing

16. **A listener's page that shows the song moving.** (M) The page a share
    link opens plays the song and offers a copy. Showing the scenes going
    by, in their colours, would make it more than a play button.

## Under the surface

17. **The audio engine handed to the hooks.** (M) The current roadmap gives
    the audio layer one owner. The step after is for the hooks and the
    studio to be given that owner instead of reaching for it, which is what
    makes the audio testable without a browser.
