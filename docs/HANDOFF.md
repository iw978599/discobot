# Handoff: where the work stands

Written 2026-10-20 by the agent working with the owner. To carry on, start a
session in this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Check each pull request's state on GitHub before acting on what this says: the
owner merges and changes things without announcing it.

## 1. State

- Everything up to pull request 244 is merged or about to be (check 244). The
  rules for each area of the app are in `docs/agents/`; read the file for the
  area you change.
- **Live sessions** are built (222, 225 to 227, 229) and wait to be tried by
  two people on the site. `docs/LIVE_SESSIONS_PLAN.md` holds the design and
  the known limits. The accounts API with the relay was deployed on
  2026-10-20 (version `2fa154e0`).
- Done from "The plan from here" in `docs/ROADMAP.md` this session: 11 to 22,
  except item 20's lanes. In short: `useStudio` split into hooks (228), the
  audio engine handed to the hooks (231), scale lock (233), the Hall's decay
  was a measuring mistake (234), Auto records macros (236), SoundFont import
  (237), a spring reverb (238), a tempo for each scene (239), more from
  portamento (240), a real export progress bar (241), dragging scenes, song
  blocks and playlist rows (242), a picture of the sound on the lane and the
  mixer (243), and several recordings made into one instrument (244).

## 2. Next, in order

1. **The owner tries things only a person can**: a live session with
   someone; listening to the spring reverb, portamento, a SoundFont (FreePats'
   Upright Piano KW is CC0) and an instrument made of several recordings;
   dragging on a real phone. What they report comes first.
2. **Questions for the owner** at the end of `docs/ROADMAP.md`, newest first:
   whether moving a lane renumbers it (its MIDI channel), and the scale lock's
   details (the builder's choices).
3. Then `docs/ROADMAP.md`, "The plan from here", from item 23 (a listener's
   page that shows the song moving) in its order.
4. Waiting on the owner and not to be started: listening, MIDI hardware, a
   screen reader trial, licences for new bundled audio, the ladder filter's
   level.

## 3. How the owner wants the work run

`CLAUDE.md` lists the rules. In short: narrate; never run Playwright on this
machine (push and let GitHub run it; a failed run's screenshots come down
with `gh run download`); merge pull requests once every check is green; stage
files by name; no real names or emails anywhere; the project pays for
nothing; at most one builder, on Sonnet, for contained items; say "not
verified by ear" for sound; write to the owner in plain sentences.

Two things that cost time this session: open pull requests that each add a
line to the same part of `docs/ROADMAP.md` conflict, so merge `main` into the
next one after each merge; and Help's words are searched by
`help-search.spec.ts` (kick, unison, import), so new Help text must avoid
them unless it should be found.

Delete this file when the work it describes is merged and a newer handoff is
not needed.
