# Handoff: where the work stands

Written 2026-10-20 by the agent working with the owner. To carry on, start a
session in this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Check each pull request's state on GitHub before acting on what this says: the
owner merges and changes things without announcing it.

## 1. State

- Everything up to pull request 229 is merged and published. 224 moved the
  rules for each area of the app out of `AGENTS.md` into `docs/agents/`; read
  the file for the area you change.
- **Live sessions** (several people editing one shared project at once) are
  built: the relay (222), edits, joining, undo and saving (225), the
  transport (226) and presence (227), and playing together with a snap to
  the beat (229). `docs/LIVE_SESSIONS_PLAN.md` holds the
  owner's decisions, the design and the known limits of each stage.
- `useStudio.tsx` is split into hooks per concern (roadmap 12, 228): the state is made in `useStudioCore`, and each
  concern is a hook in `ui/src/studio/`. Change the hook for the concern.
- The accounts API with the relay was deployed on 2026-10-20 (version
  `2fa154e0`); its live route answers. Stages 2 to 4 need no server change.

## 2. Next, in order

1. **The owner tries a live session** with someone on the site: edits, Play
   and Stop together, playing together with and without Snap, the names and
   marks. Nothing of it has been heard or
   seen by a person yet. What they report comes first.
2. If beats slip on a long play: pull the audio clocks back together (the
   plan's known limits for stage 3).
3. Then `docs/ROADMAP.md`, "The plan from here", in its order (11 and 12 are
   done): 13 (hand the audio engine to the hooks), 14 (the
   Hall's Decay in Chrome; the spring reverb clone waits on it), 16 onwards.
   Item 9 (a kind chosen on preset import) was tabled by the owner.
4. Waiting on the owner and not to be started: listening, MIDI hardware, a
   screen reader trial, licences for new bundled audio, the ladder filter's
   level.

## 3. How the owner wants the work run

`CLAUDE.md` lists the rules. In short: narrate; never run Playwright on this
machine (push and let GitHub run it); merge pull requests once every check is
green; stage files by name; no real names or emails anywhere; the project pays
for nothing; at most one builder, on Sonnet, for contained items; say "not
verified by ear" for sound; write to the owner in plain sentences.

Delete this file when the work it describes is merged and a newer handoff is
not needed.
