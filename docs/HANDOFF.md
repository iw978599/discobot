# Handoff: where the work stopped

Written 2026-10-09 when the session was paused part-way through a batch of
requests, and brought up to date later that day when the work was picked up
again. Delete this file once everything below is finished and merged.

## Branches

- `fix/review-and-websynth-studio` is PR #80. It removes the AI review
  workflow (GitHub Models, the service it called, was retired on 30 July 2026)
  and corrects the WebSynth Studio preset translator. Its `test` check passed
  before the two removal commits; it has not been merged.
- `draft/handoff-effects-midi` (this branch, PR #81) is stacked on #80.
  Merging it brings in #80 as well.

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

`AGENTS.md` and `docs/ROADMAP.md` describe all of these.

## Checked, and not checked

- `npm run typecheck`: clean at the last commit.
- `npm test`: 147 passing at the last commit.
- `npm run test:browser`: the whole suite passed (128 tests, desktop and
  phone width) with everything here in place.
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

## Still to do from the same request

1. **The LinnDrum, DMX and TR-707 kits in the kit menu** are synthesized and
   have not been tuned by ear against the machines they are named after.
2. **Added to the roadmap after the pause** (`docs/ROADMAP.md`): collaborative
   sessions (features item 7), kids mode (item 2) and a layout for phones
   and the installed app (item 1). None is started; each lists questions to
   settle first. The roadmap was tidied on 2026-10-10: open work first, a
   new suggested order, and items that were already done moved out.
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
