# Song Mode — Implementation Plan

Status: built on `feat/song-mode` (phases 1 to 4). Written 2026-10-08 against the `feat/synthesis-rewrite` branch.

## What was built, and where it differs from this plan

- **Scenes hold their own copy of the notes.** The plan below has scenes
  point at shared lane patterns by id. What shipped is simpler: a scene stores
  each lane's steps and the drum grid directly. Editing one scene never
  changes another, so the "shared patterns surprise users" risk does not
  arise; the cost is that there is no way to make two scenes share a part.
- **The lanes and drum grid are the open scene.** All existing editing, undo
  and saving code keeps working on the live pattern. The project store copies
  it into the scene's slot whenever scenes are read (`commitScene` in
  `localService.ts`) and copies a scene out when it is selected.
- **Follow is always on.** In song mode the editor opens whichever scene is
  playing. There is no toggle to edit one scene while another plays.
- **Undo** entries remember their scene; undoing an edit made elsewhere goes
  back to that scene first. Adding, deleting and renaming scenes, and editing
  the song order, are not on the undo stack.
- **Not built:** per-scene lane mutes, copy and paste between scenes, drag to
  reorder (blocks move with arrow buttons), stems of a whole song, and a
  progress display for long exports. Song audio export is capped at 8 minutes.

The rest of this document is the original plan, kept for its reasoning.

## Goal

Let a user arrange several one-bar patterns into a song: build sections (intro,
verse, chorus), chain them in order with repeat counts, play the chain from any
point, and export the whole song as MIDI or WAV.

## What exists today

- A project is one **scene**: up to three synth lanes (each with one active
  16- or 32-step pattern), one 16-step drum grid, tempo, swing, kit and effects.
- Each lane already stores a list of patterns (`LocalSynth.patterns`) with one
  marked current. The drum grid has no pattern list; there is exactly one.
- `BrowserTransport` counts 32nd-note ticks modulo 32, so playback is always a
  one-bar loop. `scheduleTickRef` in `App.tsx` reads the current patterns on
  every tick.
- "Saved arrangements" are full project snapshots in localStorage. They are the
  closest thing to sections today, but loading one replaces the whole project
  and is far too slow and heavy to do on a bar boundary.
- WAV export and MIDI export each render exactly one bar.

The main gaps are therefore: drums have no pattern identity, nothing groups
"lane patterns + drum pattern" into a unit, and the transport has no notion of
bars.

## Data model

Add two concepts. Both live in the project store next to `synths`.

```ts
// A section is one bar of everything: which pattern each lane plays, plus drums.
interface Scene {
  id: string;
  name: string;                         // "Verse", "Chorus A"
  lanePatterns: Record<number, string>; // synthId -> pattern id; missing = lane silent
  drums: DrumPattern;                   // steps + stepVelocities per instrument
  mutedLanes?: number[];                // per-scene mutes, so a breakdown can drop the bass
}

interface DrumPattern {
  steps: Record<DrumInstrument, boolean[]>;
  stepVelocities: Record<DrumInstrument, number[]>;
}

interface Song {
  entries: Array<{ sceneId: string; repeats: number }>; // repeats 1..64
  loop: boolean;                                        // loop the whole song at the end
}
```

Decisions baked into this shape:

- **Sound is global, notes are per scene.** Synth parameters, drum kit, drum
  knob settings, tempo, swing and effects stay project-wide. A scene only holds
  note data and mutes. This keeps a song sounding coherent, keeps scenes small,
  and avoids clicks from swapping synth parameters on a bar line. Per-scene
  tempo or sound changes are a later extension (see "Later").
- **Drum settings split from drum steps.** `DrumState` currently mixes the two
  per instrument. `steps` and `stepVelocities` move into `DrumPattern`;
  `settings`, `muted` and `solo` stay where they are.
- **Scenes reference lane patterns by id**, reusing the pattern list each lane
  already has. Editing a pattern used by two scenes changes both, which is the
  behaviour users of pattern-based sequencers expect. "Duplicate scene" must
  therefore copy the patterns it references and point the copy at the new ids.

### Migration

Bump `SCHEMA` in `localService.ts`. On load of an older project, create one
scene from the current state (each lane's current pattern, the current drum
steps) and a song containing that scene once. An upgraded project then plays
exactly as before. Saved arrangements get the same treatment in
`sanitizeSaved`.

## Transport

`BrowserTransport` gains a bar counter and reports it:

```ts
interface TransportTick { step: number; bar: number; time: number; duration: number }
```

`bar` increments when `step` wraps to 0. The transport stays ignorant of songs;
it only counts.

A small pure module, `ui/src/services/songPlayback.ts`, turns a bar number into
a scene:

```ts
// Flattens entries x repeats; returns null past the end of a non-looping song.
function sceneAtBar(song: Song, bar: number): { sceneId: string; entryIndex: number; repeat: number } | null
function songLengthBars(song: Song): number
```

`scheduleTickRef` then resolves the scene for `tick.bar` and reads that scene's
patterns instead of each lane's "current" pattern. Because ticks are scheduled
about 80 ms ahead, the lookup for the first tick of a new bar happens before the
bar line, so section changes are sample-accurate with no extra machinery.

Two playback modes, chosen by a toggle next to Play:

- **Pattern mode** (today's behaviour): loop the scene being edited.
- **Song mode**: follow the chain from the selected entry. At the end, stop or
  wrap depending on `song.loop`.

Details that need care:

- **Notes across a scene change.** A slide step on the last step of a bar holds
  into the next bar; that already works because the gate is a duration. An
  arpeggio scheduled late in a bar can spill a few pulses past the bar line,
  which is musically fine. Nothing needs cancelling on a scene change.
- **Lane silent in the next scene.** Scheduled notes simply stop being issued;
  the release tail rings out naturally. Do not call `stopSynth` on a scene
  change or tails will be cut.
- **Editing while playing in song mode.** The editor follows playback
  ("follow" toggle, on by default) so the visible grid is the audible one.
  With follow off, the user edits one scene while the song keeps moving.
- **Record and step MIDI modes** write into the scene being edited, not the one
  being played, when follow is off.

## UI

1. **Scene strip** above the sequencer: one chip per scene with its name, a
   `+` to add (duplicates the current scene), rename on double-click, delete,
   and drag to reorder. Clicking a chip selects that scene for editing. This is
   the only new always-visible element.
2. **Song lane** below the strip, collapsed by default: the chain as a row of
   blocks (`Intro x2 | Verse x4 | Chorus x4`). Each block has a repeat stepper
   and a remove button; dragging a scene chip onto the lane appends it. A
   playhead moves across the lane during song playback, and clicking a block
   starts playback from it.
3. **Mode toggle** (`Pattern | Song`) beside Play All, plus a `Loop` checkbox
   and a read-out of song length in bars and minutes:seconds.
4. The existing per-lane pattern dropdown stays, now meaning "which pattern
   this lane plays in the selected scene".

Mobile: the strip and lane scroll horizontally; repeat steppers must be at
least 44 px touch targets.

## Export

- **WAV:** `renderArrangementWav` takes the flattened bar list. For each lane,
  create one `SynthCore`, schedule every bar's notes at `bar * barDuration`,
  and render the full length in one pass so tails and delay lines carry across
  bar lines. Same for `DrumCore`. Length is `songLengthBars * barDuration +
  tail`. Guard memory: at 44.1 kHz stereo float, a 5-minute song is about
  100 MB of intermediate buffers per lane; cap export at around 10 minutes and
  render lanes one at a time, releasing each buffer after it is handed to the
  offline context. Show progress, since a long song takes seconds to render.
- **MIDI:** `createMidiFile` emits each bar's events offset by
  `bar * PPQ * 4` ticks. Add marker meta events (`0xFF 0x06`) with scene names
  at each section start so a DAW shows the structure.
- "Export current scene" remains available for both formats.

## Undo

Scene and song edits go on the existing project-wide undo stack. The snapshot
type gains `scenes` and `song`. Structural operations (add, delete, reorder,
change repeats) each push one entry. Because a snapshot currently carries one
lane plus global state, add a second entry kind for structure-only changes
rather than widening every snapshot.

## Phases

Each phase leaves the app shippable.

1. **Model and migration.** `Scene`, `Song`, `DrumPattern` types; schema bump;
   split drum steps from drum settings; migrate projects and saved
   arrangements; sanitizers; unit tests for migration and for hostile data.
   No visible change.
2. **Scenes.** Scene strip with add/duplicate/rename/delete/select. Playback
   still loops the selected scene. Undo for scene operations. Browser tests.
3. **Song playback.** Bar counter in the transport, `songPlayback.ts`, song
   lane UI, mode toggle, follow, playhead. Unit tests for `sceneAtBar`; a
   browser test that a two-scene song plays scene B's notes in bar 2.
4. **Export.** Multi-bar WAV and MIDI with markers, progress and the length
   cap. Tests comparing a two-bar export against two one-bar renders.
5. **Polish.** Per-scene lane mutes, copy/paste of a scene's drums or a lane's
   pattern between scenes, keyboard shortcuts for next/previous scene.

Phases 1 and 2 are roughly equal in size; phase 3 is the largest; phase 4 is
small because both cores already schedule by absolute time.

## Risks

- **`App.tsx` size.** It already owns most state at about 2,800 lines. Song
  mode should not go in there. Do the store refactor in `docs/ROADMAP.md`
  (item 1) first, or at minimum put scene and song state behind their own hook.
- **localStorage quota.** Scenes multiply pattern data. A 16-step pattern is
  under 1 KB, so 50 scenes with three lanes is well under 200 KB, but saved
  arrangements each embed a full copy. Moving saved arrangements to IndexedDB
  (roadmap item 3) removes the concern.
- **Shared patterns surprise users.** Editing a pattern used by several scenes
  changes all of them. Mitigate with a small "used in 3 scenes" badge and a
  "make unique" action.

## Later

- Per-scene tempo and time signature, with the transport reading tempo per bar.
- Per-scene sound snapshots (program changes), crossfaded over a few
  milliseconds to avoid clicks.
- Scenes longer than one bar (2, 4, 8 bars), which needs pattern lengths beyond
  32 steps.
- Automation lanes recorded against song position.
