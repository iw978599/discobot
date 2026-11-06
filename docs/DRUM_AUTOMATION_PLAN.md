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
its editor with the lane's `AutomationRow`. Auto records a drum's knob. Since asked for on 2026-11-05, the desk overview shows it (`DeskAutomationStrips`: a mark on the folded drums line, a strip a setting under an open drum). Left out: Fill and Spread leave it where it is, and kit-wide levels are not automatable.

Stage 2 is built (not verified by ear, not run in a browser on this machine). A sample song's scene gives
`drumAutomation` (by drum, then setting: a value or null for every step of the scene's drum grid, written
with `ramp`, `segment`, `perStep` and `tail` in `sampleSongs.ts`), which `buildSampleSong` carries into the
scene's `drums[row].stepAutomation` and the open scene's `drumState`. `sampleSong.test.ts` fails if a
length, a range or a key would have been repaired by the store. Every song moves at least one drum: hats'
tone or a decay opening with the build, a snare's tune climbing into a drop, reverb on the last snare of a
phrase, a percussion row panning, a kick sagging as the tape slows. Levels were measured again; every
song's loudest section is still 0.51 to 0.54. Where a kit plays recordings (Recorded), the songs
automate only volume, pan and the sends, since it is not known that a recording answers tone or the second knob.

Fracture Line plays Axis Stack (`AXIS_GUEST`, id `c0000000-0000-4000-8000-000000000003`, a send of 0.2 to
the reverb to stand in for the drums' own) on its Grit set (`cur: 1`), source `{ mode: 'discobot', id:
'drums' }`, written in Axis Stack's own state shape with its four default sets, and a gesture loop in
beats on Grit (`axisGrit`): a faint swell in the Intro, two-bar risers in the Build, a crunch on each
snare in the Drop (heavier in the Lead), a half-beat flutter in the Meltdown and a resting hint in the
Outro. The Breakdown has no drums and does not name the guest, so it is muted. The loops are one or
two bars long, or one beat in the Meltdown, because the host's beat count runs on through every scene
and the Meltdown's bars are three and a half beats, so a longer loop would not land on the bar in a
scene played after one. Two things are uncertain: a guest holding the drums takes them out of
Discobot's mix, so the scenes' `volume` of 1 is set by reasoning (Axis Stack's own output is 0.85), and
the measuring script does not measure guests.
