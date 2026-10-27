# More rows in the drum machine

Asked for by the owner on 2026-10-26: "the ability to add more instrument rows to the drum machine
so other sounds can be loaded for kits". The owner decided the same day:

- **An added row plays a sample only**: one of the app's own recordings (the percussion and the
  cymbals), an imported sample, or a drum from Import Kit or SoundFont Kit. It has no synthesized
  voice and no tone knobs of its own.
- **Up to 16 rows**: the eight drums there are now, and up to eight more.

## The shape of it

The eight drums stay exactly what they are, under the same ids (`DrumInstrument`), so nothing
saved before changes. An added row is one more `DrumTrack` under an id of its own, `extra1` to
`extra8` (`ExtraDrum`), and a row of either kind is a `DrumRow`. Code that only ever means the
eight keeps `DrumInstrument`; code that must handle every row takes `DrumRow`.

- `drumState` holds an added row's key only once it has been added, so a project without any is
  as it was, and `matchesShape` still compares the eight alone. The rows are put back in
  `restore()` by hand, after the eight, as `effectsLoop`'s optional fields are.
- A scene's `drums` holds an added row's steps under the same key, absent in a scene saved before
  it was added (which plays it silent there, as a scene saved before a lane existed does).
  `mutes.drums` the same.
- The order on screen is the eight in `DRUM_ROWS` order, then the added rows by number.
- What an added row plays is `sampleId` (an imported sample, as any drum has) or, without one,
  `settings.percType` or `settings.cymbalType` naming one of the app's recordings. With neither it
  is silent. Its name is the sample's or recording's, as a drum playing a sample is shown now.
- The operations are `drum.addRow` (the id is in the operation, as live sessions need) and
  `drum.removeRow`, both undone and shared. Every other drum operation takes a `DrumRow`.

## Stages

1. **The row itself.** (Built in the pull request that added this plan.) Types, checks and restore, the two operations, the drum engine playing an
   added row's sample live and in every export, and the grid: "+ Row" under the eight, an added
   row's sound chosen from the recordings and imported samples, its volume, pan and tuning, and
   Remove. Copy bar, Fill, Shift and the step's chance and repeats work on it as on any row.
2. **Everywhere else a drum is.** (Built: the mixer, pads, MIDI files and output, MIDI Learn, live
   sessions' hits and guests' input. Stems and the share page needed nothing: the kit's stem and
   the page's render take every row.) The mixer's strips, MIDI pads (an added row has no note until it
   is given one by Learn), the drum sends, scene mutes and solo, stems, MIDI export (on its pad's
   note), the share page, live sessions and guests' input.
3. **Kits.** Import Kit and SoundFont Kit put the samples that match none of the eight on added
   rows instead of leaving them out.

Each stage is a pull request of its own, with its tests, and none changes how a project without
added rows sounds: a test holds an export of such a project to what `main` rendered.
