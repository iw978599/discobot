# The desk layout

Asked for by the owner on 2026-11-05, after three redesign directions were drawn as mock-ups. The
owner chose direction A, the studio desk, and iterated on it once. The mock-ups are
claude.ai artifacts the owner has: "Discobot Redesign Directions" (all three) and "Discobot Studio
Desk" (the second draft of A, which this plan follows).

## What it is

One screen with no page scroll. Tracks down the left, the scenes and the song order across the
top, every track's pattern in the middle lined up under a bar ruler, and one editor docked at the
bottom with tabs: Notes, Sound, Automation, Mixer, Effects. The dock can be dragged taller or
shorter. On a phone the same parts stack and the dock is a sheet pulled up from the bottom.

## Decided by the owner on 2026-11-05

- **The rack stays the default.** The desk is an option to try, switched on from the Project menu
  and off again. It is this browser's choice, never the project's, like the colour scheme.
  Nothing about the rack changes for someone who has not switched the desk on: every rule for the
  desk is scoped to it.
- **The rows above the dock are editable.** A click adds or removes a step on any track without
  opening it, and Shift+click selects a step without changing it, as on the drum grid.
- **Track colours are automatic**: one per lane number, the drums' own colours for drum rows, one
  for guests and one for audio tracks. Nothing new is stored in a project.
- **Amber stays** as the "on" colour (`--on`), and the colour schemes keep working in the desk.

## Rules every stage keeps

- Nothing is lost. Every control the rack has is reachable in the desk.
- The units are the same components. The desk arranges and hides them with CSS (as the phone layout
  already does with `data-shown`); it never unmounts a unit, so guests keep playing, MIDI and the
  step lights go on, and no unit renders for a switch.
- New controls call the studio's existing handlers, so undo, saving and live sessions are unchanged.
  No new project state.
- The playhead and tracked-render rules in `AGENTS.md` apply to anything new that shows steps.
- Colours, sizes and corners come from the names in `rack.css`; a new name needs a value in every
  colour scheme block.

## Stages, one pull request each

1. **The switch and the look.** `services/layoutChoice.ts` (`'rack' | 'desk'`, stored under
   `discobot_layout_v1`, set as `data-layout="desk"` on the root element before the first render,
   from `main.tsx` beside `startColourScheme`). A Project menu item, "Try the Desk Layout", which
   reads "Back to the Rack" while the desk is on. The desk's look, under `[data-layout="desk"]`
   only: IBM Plex Sans for words, IBM Plex Sans Condensed for track names, IBM Plex Mono for figures
   (bundled from `@fontsource`, licence checked), no capitals or wide letter spacing, fewer frames.
   The track colour names `--track-1` to `--track-5`, `--track-guest` and `--track-audio` in every
   scheme.
2. **The frame.** The top bar in three groups (project; transport; history, sharing, account,
   help), with Click, count-in and MIDI in the Project menu. The track list on the left (colour,
   name, sound, mute, solo, select; the drums fold open into their rows). The dock with its tabs,
   showing the selected track's unit, the mixer or the effects, and a handle to resize it. The song
   unit above.
3. **The overview grid.** Every track's pattern for the open scene in rows beside the track list,
   under a bar ruler, editable: click adds or removes, Shift+click selects. A lane shorter than
   the scene shows its repeats faded. The playing step is lit through `usePlayheadMark`.
4. **The Song view and presence.** A Patterns/Song switch: Song lays every scene end to end with
   the audio tracks' clips under them. In a live session, people's initials in the top bar and a dot
   on the track each is at.
5. **The phone.** While the desk is on, a narrow screen shows the song, the tracks as a list and
   the dock as a sheet, in place of the bar of units.

## How far it has got

Stage 1 is built: the switch (`layoutChoice.ts`, the Project menu item), the desk's faces and no-capitals look under `[data-layout="desk"]`, the bundled IBM Plex fonts (OFL-1.1 checked) and the track colour names in every scheme. Fewer frames is left for later stages. Stage 2 is built (the frame, `services/deskFrame.ts`, `DeskTrackList`, `DeskDockBar`, the third arrangement of `TransportUnit`; see `docs/agents/interface.md`), as follows: the desk-frame grid, the track list with mute, solo and Add Lane, the dock with its tabs and resizable handle, and the top bar in three groups. Left for later: the drums folding open into their rows, fewer frames, Click, count-in and MIDI moving into the Project menu, and the Scene/Song mode switch staying in the song unit rather than the bar. Stage 3 is built (the overview grid: the song area across the top and, below it, one scrolling tracks region whose rows are each track's header and its cells under a bar ruler; editable cells; the drums folding open into their rows; the shared drum selection `services/drumSelection.ts`; see `docs/agents/interface.md`). The track list is no longer a column of its own: its rows are the overview's row headers. Left for later: painting by dragging, Shift-range selecting, and the guests and audio tracks having cells (stage 4). Stage 4 is built (the Patterns / Song switch for the tracks region, `services/deskSong.ts`, `DeskSong.tsx`; the song laid end to end with a block where each track plays, the audio tracks' clips, the playing bar; people's initials in the top bar and a dot on each person's track header, `DeskPeople.tsx`; see `docs/agents/interface.md`). Left for later: dragging, trimming and fading a clip in the desk (the song unit's Timeline keeps them), the guests' own cells, and a block for each repeat. Stage 5 is not started.
