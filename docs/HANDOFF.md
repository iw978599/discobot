# Handoff: where the work stopped

Written 2026-10-09 when the session was paused part-way through a batch of
requests, and brought up to date later that day when the work was picked up
again. Delete this file once everything below is finished and merged.

## Branches

- PRs #80, #81 and #82 were merged into `main` on 2026-10-09, and the site
  was published with them: items 1 to 6 below are live.
- `draft/handoff-effects-midi` (this branch) went on after that. It holds
  items 7 to 9 (PRs #83, #84 and #85, which were merged into this branch, not
  into `main`), the tidied roadmap and the quicker tests. None of that is on
  `main` until this branch is merged there.

## Finished on this branch

1. **Effects.** A stereo chorus (a fifth shared effect, with a send on every
   synth lane, the drum kit and each guest), reverb pre-delay and damping, a
   three-band master EQ, and a Vibrato LFO target.
2. **Scenes and guests.** Mutes and solos kept per scene for synth lanes and
   drums; guest effect sends; guests in Loop WAV and stems.
3. **MIDI.** The sequencer plays a chosen MIDI output (a channel per lane,
   drums on 10) and can send clock with start and stop. MIDI files of up to
   eight bars import at their full length.
4. **Song WAV and guests.** A song export used the open scene's mute and
   level for each guest through the whole song. It now uses each scene's own,
   bar by bar. Reproduced with a browser test that failed, then passed.
5. **Walkthrough for new users.** After a new account's recovery code, a tour
   lights nine parts of the rack in turn with a short explanation of each.
   Show the Walkthrough in the account dialog starts it again. It starts by
   itself once per browser.
6. **Import Kit.** Several sample files are put on the drum lanes at once,
   matched by their names and checked in a dialog before anything is stored.
   This is instead of bundled LinnDrum, DMX and TR-707 recordings: the owner
   decided none would be bundled, because none were found that the project is
   clearly allowed to redistribute. It came in as PR #82.
7. **The playhead out of React state** (PR #83). Playing no longer renders
   the whole rack on every step; the main thread does a little over half the
   work it did while playing.
8. **A phone layout, first part** (PR #84). At 720px wide and under the rack
   no longer scrolls sideways: units stack, steps are eight to a row, and
   controls are finger-sized.
9. **Kids mode, first version** (PR #85). A page of its own with nine big
   pads and one play button, reached from the Project menu or at `#kids`.

`AGENTS.md` and `docs/ROADMAP.md` describe all of these.

## Checked, and not checked

- `npm run typecheck`: clean at the last commit.
- `npm test`: 151 passing at the last commit.
- `npm run test:browser`: the playhead change, the phone layout and kids mode
  each passed the whole suite on GitHub apart. Together they have 138 tests.
  Three local runs of all three together each had one to three failures, in
  different tests each time, on a laptop that was on battery and in use; every
  one of those tests passed in another of the runs. The check on GitHub is the
  one to trust for this branch.
- The check on GitHub failed on every run of this branch until one guest test
  was changed: it compared two recordings of a guest in a window that ended
  where the next bell began. It passes there now.
- "A guest whose sound arrives late" failed once at phone width in an
  unusually slow local run and passed six times out of six straight after.
- Nothing has been listened to. The chorus, the damped reverb and the EQ were
  set by reasoning and measurement, not by ear.
- MIDI output was tested against a fake device, not real hardware.
- The walkthrough and Import Kit were looked at in screenshots at desktop and
  phone width in Chromium only. Neither has been tried in Firefox or Safari,
  on a real phone, or with a screen reader, and Import Kit has only met
  generated test tones, not a real sample pack.
- The phone layout and kids mode were looked at in Chromium's phone emulation
  only: not on a real phone or tablet, in Safari, in landscape, or as the
  installed app. Kids mode has not been tried with a child, and its four
  sounds were set by reasoning.
- The playhead change was measured in Chromium with a CPU throttle, not on a
  real phone.

## Still to do from the same request

1. **The LinnDrum, DMX and TR-707 kits in the kit menu** are synthesized and
   have not been tuned by ear against the machines they are named after.
2. **From the roadmap** (`docs/ROADMAP.md`): collaborative sessions
   (features item 7) is not started and lists questions to settle first. The
   phone layout (item 1) and kids mode (item 2) each have a first part here,
   and their entries say what is left. Two things in kids mode are the
   owner's to confirm: it is a separate page, and what a child makes cannot
   be opened in the full app.
3. **Follow-ups worth offering, not asked for:** following an external MIDI
   clock, sending hand-played notes to MIDI out, choosing output channels;
   running the browser tests as two halves side by side to save time
   (`PLAYWRIGHT_PORT` already gives each run its own app and API).

## Things the owner should know

- Two WAV exports of the same project can differ in one to three samples by
  the smallest step a 16-bit file has, when a kick goes through the reverb.
  This is on `main` too and comes from the browser's offline renderer. Tests
  that compare exports allow for it (`same` in `effects.spec.ts`).
- Still unanswered from earlier: whether the Firefox guest fixes (#76, #77)
  worked on a real desktop Firefox, and Tape Loop Deck's loops saving with a
  project (needs a protocol addition and a new prompt for its author).
