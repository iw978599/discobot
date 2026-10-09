# Handoff: where the work stopped

Written 2026-10-09 when the session was paused part-way through a batch of
requests. Delete this file once everything below is finished and merged.

## Branches

- `fix/review-and-websynth-studio` is PR #80. It removes the AI review
  workflow (GitHub Models, the service it called, was retired on 30 July 2026)
  and corrects the WebSynth Studio preset translator. Its `test` check passed
  before the two removal commits; it has not been merged.
- `draft/handoff-effects-midi` (this branch, a draft PR) is stacked on #80. It
  holds three finished commits of features, then this file and the skills in
  `.claude/skills/`. Merging it brings in #80 as well. Carry on from here.

## Finished on this branch

1. **Effects.** A stereo chorus (a fifth shared effect, with a send on every
   synth lane, the drum kit and each guest), reverb pre-delay and damping, a
   three-band master EQ, and a Vibrato LFO target.
2. **Scenes and guests.** Mutes and solos kept per scene for synth lanes and
   drums; guest effect sends; guests in Loop WAV and stems.
3. **MIDI.** The sequencer plays a chosen MIDI output (a channel per lane,
   drums on 10) and can send clock with start and stop. MIDI files of up to
   eight bars import at their full length.

`AGENTS.md` and `docs/ROADMAP.md` already describe all three.

## Checked, and not checked

- `npm run typecheck`: clean at the last commit.
- `npm test`: 144 passing at the last commit (run it again to confirm the
  count; the last full run before the MIDI tests showed 142).
- `npm run test:browser`: the full suite last passed (112 tests) after the
  effects commit only. After the later two commits only the affected specs
  were run and passed: `guests`, `scene-mutes`, `song-mode`, `quick-wins`,
  `midi-out`, `effects`. **Run the whole suite before marking the PR ready.**
- Nothing has been listened to. The chorus, the damped reverb and the EQ were
  set by reasoning and measurement, not by ear.
- MIDI output was tested against a fake device, not real hardware.

## Still to do from the same request

1. **Walkthrough for new users** (not started; only the account dialog was
   read). Asked for: a highlighted, step-by-step tour shown the first time
   someone signs up, and a button in the account dialog to see it again.
   Notes for building it:
   - `AccountDialog.tsx`: `SignedOut.submit` handles sign-up and passes the
     recovery code to `onRecoveryCode`. The tour should start after the
     recovery code's Done button, only when the code came from sign-up (not
     from Forgot Password or New Recovery Code).
   - Add a "Show the Walkthrough" button to `SignedIn`'s `account-actions`.
     It should close the dialog and start the tour.
   - Tour state is view state, so it belongs in `Rack.tsx`, not `useStudio`.
     "Has seen it" can be remembered per browser; components do not write
     `localStorage` directly, so put a tiny helper in `ui/src/services/`.
   - The transport bar is sticky and `.rack-page` is the scrolling area, so
     scroll a step's target into view inside `.rack-page` before measuring it.
   - Suggested stops: transport (play, tempo), a synth lane's steps, its
     sound editor, the drum grid, the song unit, effects, the Project and
     Export menus, and the account button.
   - No `window.confirm` or other browser dialogs; Escape and a Skip button
     must end it; it must be usable by keyboard and at phone width.
   - Add a browser test: sign up against the local API (see
     `accounts.spec.ts` for the pattern), finish the recovery-code step, walk
     the tour, reopen it from the account dialog.
2. **Sampled kits (LinnDrum, DMX, TR-707)** (not started). The engine can
   already play a sample on a drum lane (`DrumTrack.sampleId`,
   `DrumCore.setSample`). What is missing is the recordings. This needs a
   decision from the owner before any work: the app may not load anything
   from another site, so samples must be bundled, and they must be ones the
   project is allowed to redistribute. Do not bundle recordings whose licence
   has not been verified. Options to put to the owner: a verified
   public-domain or CC0 pack, recordings the owner makes or owns, or leaving
   it as "import your own samples".
3. **Added to the roadmap after the pause** (`docs/ROADMAP.md`): collaborative
   sessions (features item 13), kids mode (item 14) and a layout for phones
   and the installed app (item 15). The known bug noted with them (Song WAV
   ignoring a guest's mute and level per scene) is fixed.
4. **Follow-ups worth offering, not asked for:** following an external MIDI
   clock, sending hand-played notes to MIDI out, choosing output channels.

## Things the owner should know

- Two WAV exports of the same project can differ in one to three samples by
  the smallest step a 16-bit file has, when a kick goes through the reverb.
  This is on `main` too and comes from the browser's offline renderer. Tests
  that compare exports allow for it (`same` in `effects.spec.ts`).
- Still unanswered from earlier: whether the Firefox guest fixes (#76, #77)
  worked on a real desktop Firefox, and Tape Loop Deck's loops saving with a
  project (needs a protocol addition and a new prompt for its author).
