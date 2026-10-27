# A lane's instrument chosen per scene

Asked for by the owner on 2026-10-27: "lets make lane instruments changeable per scene", so that
the sample songs can change instruments from scene to scene where it makes sense.

Until now a lane's sound has been the project's: every scene played it with the same instrument.

## What a scene may change

A scene may give a lane a sound of its own. It is opt-in, lane by lane: a scene that does not have
one plays the lane's shared sound, as every scene did before. A project without any is what it was.

- **The instrument** is the scene's: the model and its macros, the preset's name, and everything in
  the lane's `SynthParameters` that makes the voice (oscillators, filter, envelopes, LFOs, routes,
  layer, unison, the sample engine and its recording, the arpeggiator, glide, and the lane's own
  inserts, which run inside the voice engine).
- **The channel** stays the lane's in every scene, because the mixer shows it: the level (`gain`),
  `pan`, the effect sends (`fxSends`, `fxReturn`) and `duck`. So do the lane's name, number, octave,
  keyboard and swing. `CHANNEL_KEYS` in `services/sceneSounds.ts` is that list.

## The shape of it

The lanes in the store are the open scene, as their steps are: `synthParams`, `synthModelId`,
`synthModelParams` and `preset` on a lane are always the sound heard in the open scene, so every
knob, preset, Randomize, MIDI Learn, undo and live edit works on it without knowing about scenes,
and a lane's sound still reaches the audio through the store's events.

- `scene.sounds` (`Record<laneId, LaneSound>`) holds a scene's own sound for each lane that has
  one. Absent means none, and is never stored empty. Like the steps, the open scene's entry is only
  brought up to date by `commitScene`: never read it for the open scene, use the lane.
- `lane.shared` (a `LaneSound`) is the lane's shared sound, kept aside while the open scene has a
  sound of its own for it, and present only then. `sharedSound(lane)` is `shared` or the lane's own.
- Opening a scene (`applyScene`) swaps: the lane's sound goes back to `scene.sounds` of the scene
  being left (by `commitScene`) or to `shared`, and the scene being opened gives its own, if any.
  The channel keys are carried across from the lane as it is, never from the copy.
- `restore()` holds the two together: `shared` without an own sound in the open scene is put back
  as the lane's sound; an own sound in the open scene without `shared` is taken, and the lane's
  sound kept aside as the shared one, which is how a song written by hand can open on one.
  Replacing the scenes (Reset All, a saved arrangement) keeps the lanes as they sound and drops
  `shared`.
- The operation is `scene.sound` (`{ synthId, own }`), on the open scene, undone and shared.
  Turning it on keeps the lane as it sounds now (the shared sound is copied aside); turning it off
  puts the shared sound back. A new scene copies the open one's own sounds, as it copies its steps.
- Playing: in song mode the scheduler opens each scene on its first tick, ahead of when the tick is
  heard, so a changed sound is sent for that tick's time (`params` and `sample` messages with a
  `time`), not at once. A lane playing a recording has every recording its scenes use loaded.
- Exporting: each bar of a song carries its scene's sounds (`sceneBar`), and a lane's render
  changes its voice at the first bar of a scene with another sound. A MIDI file is unchanged: it
  never held a lane's sound.

## Stages

1. **The store, playing and exports.** (Built in the pull request that added this plan.) Types,
   checks and restore, the swap, `scene.sound`, timed changes live, recordings per scene, WAV by
   bar, the share page, project files' samples and live sessions. Unit tests.
2. **The editor.** A "This scene only" switch on the lane's editor, a mark on the lane's name plate
   when the open scene has its own sound, and a browser test.
3. **The songs.** The sample songs rewritten to change instruments between scenes where it suits
   them, and two of them given a guest instrument whose settings change from scene to scene.

Each stage is a pull request of its own, and none changes how a project without scene sounds
sounds: a test holds a song export of such a project to what `main` rendered.
