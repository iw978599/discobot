# Audio tracks on a timeline (roadmap V23)

Asked for by the owner on 2026-10-22: recordings and loops placed on tracks along the song,
trimmed, moved and faded, as other web music apps have. This is the plan and how far it has got.

## What it is

- A **timeline** unit shows the song laid out in bars, its blocks along the top in their scenes'
  colours, and under it any number of **audio tracks** (up to 8).
- A track holds **clips**. A clip is a stretch of one recording: an imported audio file, kept in
  this browser like a drum lane's sample (`sampleStore`), never in the project.
- A clip starts at a place in the song, counted in the transport's ticks (32nd notes) from the
  song's first beat, so it stays on its beat when the tempo changes. Its audio is not stretched:
  it lasts as long as it lasts, in seconds.
- A clip can be moved (snapped to a beat, or a step with Alt), trimmed at either end, given a
  level and faded in and out. A track has a level, a pan, mute and solo, and sends, on the mixer
  like any other channel.
- Clips play in **Song** mode and in a Song WAV. In **Scene** mode they are silent: a scene is a
  loop of steps and has no place in the song. Stems and a loop are made of one scene, so they
  leave clips out too; so do MIDI files, and the share page, whose link carries no recordings.

## Choices made without the owner (say if any is wrong)

1. A clip is placed against the song's time, not inside a scene. Moving a song block does not
   move the clips; the timeline is one line, as in other apps.
2. Silent in Scene mode (above).
3. A clip's position is in ticks; its length, trim and fades are in seconds of its recording.
4. The recordings travel only in project files, as samples do. A share link, a published song,
   sync and a live session carry the clips without their audio; the share page then plays the
   song without them and says so. Syncing audio would need paid storage.
5. A project file holds about 12 MB of audio in all. A longer recording is left out of the file,
   and the user is told, as for samples today.

## Stages, each a pull request

1. **The data and the store.** `audioTracks` on the project (absent: none, so every project is
   unchanged), operations for tracks and clips with their reducers, checks in
   `projectSanitization.ts`, undo, what live sessions share, and the project file carrying the
   recordings. Unit tests only. No sound and no screen yet.
2. **Sound.** Each track an audio channel (`createLane`), on the mixer; the scheduler starts each
   clip on its tick in Song mode, and one already under way when Play starts part way through;
   Stop stops them; a Song WAV renders them (`wavExport.ts`), decoded once.
3. **The timeline unit.** The bars, the song's blocks, the tracks and their clips; adding a
   track, adding a clip from a file at the playhead or the start, moving and trimming with the
   pointer, a finger and the keyboard, deleting; the playhead.
4. **Fades and finishing.** Fade handles, a clip's level, zoom, the share page, the phone layout,
   Help and the walkthrough.

## Progress

- 2026-10-22: planned, and stage 1 built: the data, its checks, the six operations with undo and live-session keys, and the project file carrying clip recordings.
- 2026-10-22: stage 2 built: each track a channel of the engine's with a pan, on the mixer
  (level, pan, mute, solo); recordings decoded once (`clipRecordings.ts`); the scheduler plays the
  clips in Song mode (`playClips` in `useStudioTransport`), Stop stops them; a Song WAV lays each
  track out as a take (`trackRender.ts`) mixed as a guest's is. Not verified by ear.
- 2026-10-22: stage 3 built, as the song unit's third view rather than a unit of its own (the
  phone's bar of units has no room for another switch, and the timeline is a way of showing the
  song): the song's blocks along the top with the playing bar lit and a mark where new
  recordings go; tracks with name, mute, solo and remove (asking when it holds clips); Add
  Recording; clips moved and trimmed by pointer, finger and keyboard; a chosen clip's track,
  trim, length, level and fades as figures.
- 2026-10-22: stage 4 built: three zooms (a 4/4 bar 32, 64 or 128 pixels), fades drawn on each clip
  as slopes with a handle at each on the chosen clip, and a line on the share page when a song's
  tracks cannot be heard there. Left for what the owner finds in use: the walkthrough has no stop
  for the timeline, and nothing has been tried on a real phone or heard.
- 2026-10-22: Record Session (roadmap V24) puts what this browser hears onto a new track.
