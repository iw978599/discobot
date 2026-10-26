---
name: sample-songs
description: How to write, change and mix Discobot's sample songs (the songs offered on an empty project) - the data they are written as, the owner's rules for them, and how to measure their levels so they do not clip. Use when adding a sample song, changing one, or when the owner reports one sounds wrong.
---

# The sample songs

The songs are data: `SAMPLE_SONGS` in `ui/src/services/sampleSongs.ts`, each a
`SampleSong` (types in `ui/src/services/sampleSong.ts`). `buildSampleSong` turns
one into a project file from the open project's file, and the app opens it as a
new project. The strip on an empty project lists them all (`StarterUnit.tsx`).

## Writing one

- **Lanes** (up to five): a built-in preset's id, a `name` (every lane has one),
  and an optional `sound` laid over the preset (inserts, sends, arpeggiator,
  duck, `glide` and `vibrato` from the helpers, a `layer`, `unison`, `modMatrix`). `octaveShift` and `swing` as wanted.
- **Scenes**: `signature` (absent is 4/4), `bars` (1, 2, 4 or 8), `tempo` (the scene's
  own; absent is the song's), `laneBars` (a lane shorter than the scene, which loops; its
  notes and automation are that long), `mutes` (`{ lanes, drums }` muted in the scene with
  their notes kept; every scene stores its mutes, all off unless listed), notes per lane
  as a list of bars of `Placed` (`[step, notes, length, velocity, extra]`, steps
  counted in sixteenths within the bar: 16 in 4/4, 12 in 3/4 and 6/8, 20 in 5/4,
  14 in 7/8, 24 in 12/8), `drums` as a list of bars of `Hits`, and `automation`
  per lane (a value or null for every step of the lane: use `ramp` and `held`). A hit in
  `Hits` may be `[step, velocity, repeats, chance]`.
- **Song**: `order`, scenes with repeats; `kit`, `drums` (per-drum settings such
  as `percType`, `cymbalType` or a drum's own `reverbSend`/`delaySend`, where 1 is the
  default and is not stored), `drumSends`, `effects` laid over the defaults.
- Notes are sharps (`'C#4'`, never `'Db4'`). An aux bus's `sync` takes only
  `RATE_SYNCS`; the shared delay's takes `DELAY_SYNCS`.

## The owner's rules

- **No lane says "Generic"** (2026-10-20): every lane is a synth model's preset,
  or a preset on the plain engine (a recorded instrument), which a lane calls by
  the preset's name.
- **Every lane is named.**
- **Show the app off**: the songs should use the newer features (time
  signatures, strum, swing, the arpeggiator, inserts, aux buses, automation,
  effect clones, percussion, recorded instruments, five lanes).
- They are written by reasoning and have not been heard: say "not verified by
  ear", and change them when the owner says how they sound.

## Mixing: do not skip this

The owner heard clipping in a song whose loudest section summed to full scale
before any effect. Every part was fine alone; together they were not.

1. Run `node --import tsx scripts/measure-songs.mts` (or with a song's id). It
   renders each section's dry mix (lanes and drums, by the exporter's own
   functions, at the scene's own tempo) and prints its peak, and each part's.
   It plays lanes muted in a scene as well, so a break measures louder than it is.
2. Each song's **loudest section should peak near 0.5**, which leaves room for
   the reverb, echoes and drive on top. Set the song's `level` (scales every
   lane's level and every automated level, so swells keep their shape) and
   `drumVolume`; change single lanes' `gain` only to balance parts.
3. Measure again after any change to a song's notes, sounds or levels.

## Tests

`ui/test/sampleSong.test.ts` opens every song through the store and fails if
anything had to be repaired, if a lane has no name or would say Generic, or if
a scene's length, notes or automation are wrong. The first song is tested in
detail. `ui/test/browser/starting-points.spec.ts` lists the songs by name in
order: change it with the list.
