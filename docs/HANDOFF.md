# Handoff: where the work stands

Written 2026-10-20 by the agent working with the owner. To carry on, start a
session in this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Check each pull request's state on GitHub before acting on what this says: the
owner merges and changes things without announcing it.

## 1. State

- Everything up to pull request 225 is merged and published. 224 moved the
  rules for each area of the app out of `AGENTS.md` into `docs/agents/`; read
  the file for the area you change.
- **Live sessions** (several people editing one shared project at once) are
  built in stages; `docs/LIVE_SESSIONS_PLAN.md` holds the owner's decisions,
  the design and the known limits. Stage 1, the relay, is merged (222).
  Stage 2, edits, joining, undo and saving (`ui/src/services/liveSession.ts`),
  is merged (225). Stage 3, the transport, is the pull request from branch
  `feat/live-transport`.
- The accounts API with the relay was deployed on 2026-10-20 (version
  `2fa154e0`); its live route answers. Stages 2 and 3 need no server change.

## 2. Next, in order

1. **Live sessions, stage 4: presence** (who is in, coloured marks on the
   rack). Nothing on screen says a session is on until this is done, apart
   from the line saying who is playing. Read the `live-sessions` skill first.
2. Afterwards, if the owner hears beats slip on a long play: pull the audio
   clocks back together (the plan's known limits for stage 3).
3. Then `docs/ROADMAP.md`, "The plan from here", in its order: item 11's
   remainder (the transport bar and song strip render on every edit), 12 and
   13 (split `useStudio.tsx`, hand the audio engine to the hooks), 14 (the
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
