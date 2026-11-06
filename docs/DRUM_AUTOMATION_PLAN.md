# Drum automation

Asked for by the owner on 2026-11-05: automation for the drums, the sample songs rewritten to use
it, and the drum and bass song (Fracture Line) given Axis Stack on its Grit setting, playing
Discobot's drums.

## What it is

A synth lane's automation (`docs/agents/editing.md`) gives a lane's parameters a value for each
step. Drum automation does the same for each drum row: a value per step of the drum grid for a
drum's own settings. A drum hit already carries its drum's settings to the worklet
(`useDrumAudio`, `DrumHitMessage`), so a hit on an automated step plays with that step's value in
place of the drum's own setting. Values are held for the step, not ramped, as for lanes.

## Decisions (the coordinator's, the owner may change them)

- **What can be automated**, per drum: `volume`, `tone`, `extra`, `tune`, `pan`, `delaySend`,
  `reverbSend` (the `DrumSettings` numbers that ride on a hit). Not `humanize`, `percType` or
  `cymbalType`. Kit-wide levels (the drum master, the kit's sends) are not in this stage.
- **Where it is kept**: beside each drum row's steps, so it moves with the steps like
  `stepVelocities`, `stepProbabilities` and `stepRatchets` do. Absent means none and is never
  stored, so an older project is unchanged. Sanitized like a lane's (`sanitizeAutomation`'s rules:
  known keys only, clamped, as long as the steps).
- **Plays the same live and in export**: the value is applied where a hit's settings are built,
  in the one place both use (`expandDrumStep` or beside it), never in the worklet wrapper or only
  in `wavExport.ts`.
- **Editing**: an automation row under the drum grid for the selected drum, like the lanes'
  `AutomationRow`, with a choice of parameter. Auto records a drum's knob turned while the song
  plays, as it does a lane's.
- **Every edit that moves, copies, cuts or resizes drum steps** (Copy bar, Copy to, Shift,
  Reverse, Repeat Half, Spread, more or fewer bars, a new time signature, scene capture and apply,
  song export slicing) does the same to the drum automation.
- **Undo, saving, live sessions** come from the store as for every edit: drum automation is
  changed through a typed operation (or an existing drum operation carrying it).

## Stages

1. **Drum automation** in the store, playback, export, editing and Auto.
2. **The songs**: drum automation in every sample song (`SampleSong` gains it per scene); Fracture
   Line gets Axis Stack (a featured guest) whose settings select set 2, Grit, with Discobot's
   `drums` voice as its source (`source: { mode: 'discobot', id: 'drums' }`) and a gesture loop
   in beats per scene, written in Axis Stack's own state shape (its `captureState`/`applyState`
   in its page's source). Levels measured again (`scripts/measure-songs.mts`).

## How far it has got

Stage 1 is built (not verified by ear, and not run in a browser on this machine). Stored as
`stepAutomation` on a drum track and in each scene's `drums[row]` (an `Automation`: setting to a value
per step or null; `SCHEMA` 24). One operation, `drum.automation` (`instrument`, `key`, `steps`, `values`).
`hitSettings` in `services/drumAutomation.ts` is the one place a hit's settings are built, used live, in
WAV and stem export and (level only) in MIDI. The row under the drum grid is `DrumAutomationRow`, sharing
its editor with the lane's `AutomationRow`. Auto records a drum's knob. Left out: the desk overview shows
nothing of it, Fill and Spread leave it where it is, and kit-wide levels are not automatable. Stage 2 is
not started.
