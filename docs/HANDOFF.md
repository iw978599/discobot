# Handoff: where the work stands

Written 2026-10-21 by the agent working with the owner. To carry on, start a
session in this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Check each pull request's state on GitHub before acting on what this says: the
owner merges and changes things without announcing it (pull request 247, the
Start Live Session setup, was the owner's own).

## 1. State

- Everything up to pull request 250 is merged and published. Nothing is
  open. The rules for each area of the app are in `docs/agents/`; read the
  file for the area you change.
- Done from "The plan from here" in `docs/ROADMAP.md`: items 11 to 22, and
  22a. Since the last handoff (2026-10-20, up to 244):
  - 246: twelve more scales and fourteen more chord shapes (the Chord menu in
    groups), a ninth in the key. The owner confirmed the scale lock as built.
  - 248: lanes can be shown in another order (Alt and an arrow on a lane's
    name, or dragging a mixer strip by its name). The owner decided a lane
    moves only where it is shown: its number and MIDI channel stay.
  - 249: a long reverb holds its level past 2.1 s, and a long Room darkens as
    it goes. The owner heard a Room at a long Decay as static.
  - 250: a SoundFont drum kit on the drum lanes (SoundFont Kit, beside Import
    Kit), each lane offered its General MIDI drum.
- Live sessions are built and wait to be tried by two people on the site
  (`docs/LIVE_SESSIONS_PLAN.md`). The accounts API with the relay was
  deployed on 2026-10-20 (version `2fa154e0`).

## 2. Next, in order

1. **What the owner hears and tries comes first.** None of this has been
   heard or tried by a person: whether 249 cured the static of a long Room
   reverb; a SoundFont drum kit and a SoundFont instrument with real files
   (FreePats' Upright Piano KW is CC0); an instrument made of several
   recordings; the spring reverb; portamento; dragging and the hold on a real
   phone; a live session with someone.
2. Then `docs/ROADMAP.md`, "The plan from here", from item 24 (more MIDI),
   in its order. Item 23, the share page's song strip, is done.
3. Questions still waiting on the owner are at the end of `docs/ROADMAP.md`
   ("Questions waiting on the owner"). Waiting on the owner and not to be
   started: listening, MIDI hardware, a screen reader trial, licences for new
   bundled audio, the ladder filter's level.

## 3. How the owner wants the work run

`CLAUDE.md` lists the rules. In short: narrate; never run Playwright on this
machine (push and let GitHub run it; a failed run's screenshots come down
with `gh run download <run> -D <dir>`); merge pull requests once every check
is green; stage files by name; no real names or emails anywhere; the project
pays for nothing; at most one builder, on Sonnet, for contained items; say
"not verified by ear" for sound; write to the owner in plain sentences.

Things that cost time in the last two sessions:
- Pull requests that each add a line to the same part of `docs/ROADMAP.md`
  conflict: merge `main` into the next one after each merge.
- Help's words are searched by `help-search.spec.ts` (kick, unison, import):
  new Help text avoids them unless it should be found.
- Browser tests at phone width: the bar of units covers the bottom of the
  screen, and `page.mouse` does not scroll, so a drag scrolls its target to
  the middle first. A key held on the on-screen keyboard is let go when the
  Notes level is left.
- A locator by an `aria-label` prefix catches more than meant ("Mixer Synth "
  also matches "Mixer Synth return"): scope it to its group.
- Undo copies an earlier project over the current one with `Object.assign`,
  so a new optional top-level field must be taken away in `restoreContent`
  when the earlier copy has none (as `laneOrder` is).

Delete this file when the work it describes is merged and a newer handoff is
not needed.
