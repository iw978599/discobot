# Handoff: where the work stands

Written 2026-10-20 by the agent working with the owner, before the owner
cleared the session. To carry on, start a session in this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Check each pull request's state on GitHub before acting on what this says: the
owner merges and changes things without announcing it.

## 1. State

- Everything up to pull request 221 is merged and published: five lanes,
  preset search, held arpeggiator, inversions and strum, effect presets and
  clones (delay colour and wow, kinds of drive), aux buses on the mixer, send
  automation, the first-run choice with seven sample songs, recorded note
  length, SoundFont import, a plain-engine lane named by its preset.
- **Live sessions** (several people editing one shared project at once) are
  being built in stages; `docs/LIVE_SESSIONS_PLAN.md` holds the owner's
  decisions and the design. Stage 1, the relay (a Cloudflare Durable Object on
  the free plan), is pull request 222.
- **The owner's step:** once 222 is merged, deploy the accounts API:
  `npx wrangler@4 login` once, then `npm run deploy --workspace=server`. Until
  then the live route answers 503 and the app treats that as "not available".

## 2. Next, in order

1. **Live sessions, stage 2: edits.** `ui/src/services/liveSession.ts`, as
   designed in the plan (send shared operations, apply remote ones with the
   `remote` origin in their own scene, re-apply own pending edits whose keys
   overlap, batch a knob's drag, the host sends the whole project to a joiner,
   undo sends the whole project, only the host saves to the account). Read the
   `live-sessions` skill first.
2. **Stage 3: the transport** (play, stop, tempo; a start time on the shared
   wall clock, as guests have). **Stage 4: presence** (who is in, coloured
   marks).
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
