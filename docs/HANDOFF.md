# Handoff: picking the work up on another machine

Written 2026-10-12 by the agent working with the owner, at the owner's request,
so that a new session on a different machine can carry on. It says what is
done, what is open, what comes next and in what order, what the owner has
decided, and how the owner wants the work run.

To use it, start a session in a clone of this repository and say:

> Read `docs/HANDOFF.md` and resume from it.

Everything here was true when it was written. The owner merges and changes
things without announcing it, so check each pull request's state on GitHub
before acting on what this says about it.

## 1. Setting up the machine

- **Tools:** git, Node 22 or later (the laptop had 24), npm, and the GitHub
  command line (`gh`), logged in as the repository's owner with
  `gh auth login`.
- **The repository:** `git clone https://github.com/iw978599/discobot`, then
  `npm ci` in it.
- **Git identity:** set `user.name` to `iw978599` for this repository and a
  GitHub no-reply address for `user.email`. Never put a real name or email
  address into a commit, code, docs or tests.
- **Worktrees:** the work was done in worktrees beside the main checkout, one
  for each builder, so two can work at once: `git worktree add
  ../discobot-chore`, `../discobot-phone`, `../discobot-store`. Each needs its
  own `npm ci`. Any names will do.
- **Deploying the accounts API** needs `npx wrangler@4 login` once. Only the
  owner's account can do it. Nothing in the queue below needs a deploy until
  something changes under `server/`.
- **Permission rules for the agent** (Claude Code): the session's own checks
  refuse `gh pr merge` unless the owner allows it. On the laptop the owner
  added two allow rules with `/permissions`: `Bash(gh pr merge:*)` and
  `Bash(gh pr ready:*)`. The agent cannot add these itself; the owner must.
  Run each as a plain command of its own (`gh pr ready N -R
  iw978599/discobot`, then `gh pr merge N -R iw978599/discobot --merge`), not
  wrapped in `timeout` or chained with `&&`, so the rules match.
- **Read first:** `AGENTS.md`, `docs/ROADMAP.md`, `docs/DESIGN_REVIEW.md`,
  `docs/SYNTH_MODELS_PLAN.md`, and the three skills in `.claude/skills/`
  (`ship-change`, `scripted-edits`, `add-project-field`).

## 2. How the owner wants the work run

These are the owner's own instructions, given over several sessions. A new
session should save them to its memory.

- **Say what you are doing as you do it.** A sentence or two before each
  stretch of tool calls. The owner asked for this after a long silent run.
- **Never run the Playwright browser tests on the owner's machine.** Push
  and let GitHub run them. Typecheck and the Node unit tests are fine
  locally. Tell every builder the same.
- **Check a pull request's state again before reporting it or choosing a
  base.** The owner merges on GitHub without saying so.
- **Builders.** One building subagent at a time is the rule, set after the
  owner hit the usage limit three times in a day. For the design-review
  queue the owner allowed "an extra subagent as needed", so two at once,
  kept out of each other's files. Sonnet for work that follows a pattern and
  has tests to catch it; Opus for design. Review each diff yourself; send a
  reviewer subagent only where nobody can see the result. Tell builders to
  be economical, and to commit, push and open a draft pull request early,
  because a cutoff by the usage limit otherwise loses the work.
- **Merging.** The owner's words on 2026-10-12: "you always have my
  permission to merge on this project". Merge when the checks are green and
  you have read the diff, then say what went in. Bring anything that changes
  behaviour beyond what was asked to the owner first. Merging to `main`
  publishes the site.
- **Do not spend runs proving a flaky test.** Find the cause, get one green
  run, and say what risk is left. The owner said so after a long loop of
  re-runs.
- **Keep the machine awake while agents work** if the owner asks (a small
  script that asks Windows not to sleep). Offer it at the start of a session
  and stop it when the work stops.
- **How to write to the owner.** They do not write the code. Say what a
  person using the app would see, what was verified and what was not, and
  what decision is theirs. Plain sentences.

## 3. Where things stand

### Finished and on `main` (2026-10-10 to 2026-10-12)

- **The typed project store**, all eight steps (#99 to #114). The old
  request layer is gone. `docs/TYPED_STORE_PLAN.md` has what each step found.
- **The phone layout**, including the piano roll and keyboard for a thumb
  (#106).
- **Three small items:** a message while a WAV export is made, with the
  names Scene WAV and Scene MIDI (#115); the scroll wheel on knobs, which
  turns a knob after the pointer has rested on it, confirmed by the owner
  (#116); the presets menu grouped by kind (#117).
- **The design review** (#118): `docs/DESIGN_REVIEW.md`, and a spec that
  photographs the app on GitHub for any branch whose name contains
  `design-review`.
- **From the review, findings 1, 2, 5 and 6** (#120, #121): kids mode on a
  phone held sideways, five places where words were cut off, faint text,
  and small desktop targets.
- **Redesign C part 1, which is also finding 3** (#123): colours named by
  the job they do, and different looks for focus, hover, selected and on.
  Play is a light button when stopped and amber while playing. The owner has
  been told and has not yet said whether they like it; it is one rule to
  put back.
- **Faster checks** (#122): each width's browser tests run on four machines
  with the browser cached, about three minutes. The checks are
  `browser (chromium, 1)` to `(4)`, the same for `mobile-chromium`, two
  `results` jobs and `test`. The artifacts `test-results-chromium` and
  `test-results-mobile-chromium` are complete only when `results` has run.
- **Roadmap text:** the owner's requests for changing a bar's length, a
  playlist-style layout for scenes and chord buttons (#119), and for mapping
  a MIDI controller's knobs and pads (#124).

### Open when this was written

Nothing. Every pull request from this stretch is merged.

The first batch of the behaviour track is in: Space plays and stops, and a
word beside the project's name says where the work is (#125); the account
dialog and the Project and Export menus in groups (#126); and one set of
names for the drums and the knobs (#127). #127 gives the drums their full
names everywhere, which widened the column beside every step grid from 86
to 120 pixels, so the steps are 34 pixels narrower in all. That widening is
what the review's feature 9 proposed, which the owner had left out; the
agent held the pull request and the owner then said to merge it.

### A test to watch: found and fixed

The cause was in the app, not the test: the first change to a knob within a
quarter of a second of the page loading got no undo step, because "no
change before this one" was read as "a change at time zero". The test typed
a level about 240 ms in. `ui/src/studio/undoSteps.ts` holds the rule now,
with a unit test. What follows is what was known before.

`rack-renders.spec.ts`, "undo reaches units that did not render for each
other's edit", passed only on a retry twice on 2026-10-12, on two different
pull requests that did not touch undo (desktop, the fourth machine both
times). An undo did not take within seven seconds. It is older than those
pull requests. Step 8 of the typed store changed how undo restores a
snapshot, so start there. It has not been looked into.

### Nothing is running

No builder is at work. The worktrees on the laptop are clean and everything
is pushed.

## 4. The queue, in the owner's order

Tick things off here as they merge.

### Step 1. Design-review findings 1 to 6

Findings 1, 2, 3, 5 and 6 are merged. **Finding 4** (the piano roll,
keyboard and sound editor still in an older colour scheme) is built as
redesign C part 2, on the branch `feat/design-review-older-components`.
It is merged (#129).

### Step 2. The rest of the owner's picks from the design review

The owner chose: findings 7 to 14; redesigns A, B and C; features 1 to 8,
10 and 11; and chord buttons in the piano roll (roadmap features 15). Not
chosen: findings 15 and 16, redesigns D and E, feature 9.

Two tracks, so that two builders keep out of each other's files. A branch
with `design-review` in its name gets pictures of the app from the checks,
and a builder should look at the pictures of what it changed before calling
it done.

**Look track (Opus, with the frontend-design skill), in order:**

1. **Redesign C part 2, with findings 4 and 11.** Built on
   `feat/design-review-older-components` on 2026-10-12 by the session that
   picked this file up, and merged (#129). What it was: move `PianoRoll.css`,
   `Keyboard.css`, `KeyboardPanel.css`, `SynthControls.css`,
   `EffectsPanel.css`, `MidiPanel.css`, `Knob.css` and `DrumKnob.css` onto
   the named colours and delete the `.rack .…` overrides in `rack.css`.
   Notes and pressed keys become `--on`. Replace the two emoji on the
   keyboard and piano-roll switch. The MIDI and samples dialog is tidied in
   the same pass. `docs/DESIGN_REVIEW.md`, under redesign C, says what part
   1 left for it.
2. **Redesign C part 3, with finding 7.** Built on
   `feat/design-review-type-and-corners` (the owner said yes to both the
   larger base size and the plain face for sentences); check its pull
   request's state. What it was: one scale of type sizes, two
   corners, three shadows, named beside the colours. Browser tests measure
   sizes on a phone, so some of their numbers will move.
3. **Redesign A, with finding 8 and features 3 and 4.** The phone's top
   bar as one line (tempo, Play, a "more" button) with everything else in a
   sheet; lamps on the bar of units that show activity and mute; a way to
   mute a unit from the bar. The walkthrough points at buttons that move
   into the sheet.
4. **Redesign B, with finding 9.** A lane's editor as two levels, Notes and
   Sound, with presets inside Sound and the preset's name on the lane's top
   line. Build the review's small first step (presets into a tab) on the
   way if that helps.

**Behaviour track (Sonnet), in order:**

1. Batch 1, done and merged: Space plays, and a save state beside the
   project's name (features 10 and 6, #125); the account dialog and the
   Project menu in groups (findings 12 and 13, #126); one set of names for
   the drums and the knobs (finding 14, and with it the full drum names of
   feature 9, #127).
2. **Finding 10** is merged (#130), with a fix for lit buttons going dark
   after a tap on a phone, which #129 had brought in. What it was: the app's own dialog in place of the browser's "are you
   sure" for deleting a scene, a project or a member; its own button over
   the file chooser in MIDI and samples; its own small player on the share
   page; the phone browser's tap mark turned off for the whole page.
3. **Feature 1** is merged (#131): three beats in a strip on a project
   opened empty, which stays until Hide is pressed. Nobody has heard the
   beats; they are data in `ui/src/services/starters.ts`.
4. **Feature 7:** a colour for each scene. Built on
   `feat/design-review-scene-colours`; check its pull request's state.
5. **Feature 5:** copy a lane's pattern, or one drum row, to another scene.
6. **Feature 2:** export as a small dialog (what, as what, how long, and
   the progress in the same place). The message and the names are already
   built (#115).
7. **Feature 11:** Help with a list of headings and a search box.
8. **Feature 8:** a metronome and a count-in, with the switch beside Tap.
   The review only placed the switch; the metronome does not exist yet. The
   owner was told this would be read as "build it" and did not object.
9. **Chord buttons in the piano roll** (roadmap features 15).

### Step 2b. The preset sounds (asked for by the owner on 2026-10-12)

First part built on `feat/preset-sounds`: forty presets in place of
seventeen, level-matched by measurement, and a level for the first
oscillator. Check its pull request's state. The owner has not heard them.

The owner: "would also like to add reviewing/redesigning the synth preset
sounds as well as adding more presets". Go through every built-in preset,
redesign the ones that are weak, and add more (roadmap sound 7 lists the
kinds, and no kind has an Effects preset yet). Where it sits in the order
was not said; it is placed here, before the new models, because the new
models' presets build on the same work. Ask the owner if that matters.
Sound cannot be checked by a test: bring the owner a list of what changed
to listen to. The starting beats (`starters.ts`) may also be dressed up
later; the owner has heard them and said they "sound good".

### Step 3. Every synth model in `docs/SYNTH_MODELS_PLAN.md`

The owner: "tackle everything to add all synths from the roadmap". All
fourteen, with the engine work each needs.

1. Group A, which needs nothing new, is all built. SH-101 and Pro-One
   (#139) and Jupiter-8 and OB-Xa (#140) are merged. JP-8000 and Mono/Poly
   (#141, with the unison limit raised to seven as the owner said) and
   Polysix (`feat/synth-models-polysix`) were open when this was written:
   check their state. Then the owner listens (item 2). The list was;
   `docs/SYNTH_MODELS_PLAN.md` has what was found. The full list: SH-101; Pro-One; Jupiter-8 with
   OB-Xa; JP-8000 with Mono/Poly; Polysix last. The Polysix may turn up its
   lane's chorus send (the owner answered for the Polysix only; ask again
   before another model does it). Sonnet.
2. **Stop for the owner to listen.** No sound in the app, old or new, has
   been checked by ear.
3. The audio engine's single owner (roadmap improvements 4).
4. The ladder filter and filter models, then the MS-20.
5. The modulation matrix, then the Odyssey, the Virus and the CS-80. Build
   here the one way of naming any parameter that step 4 needs too.
6. The sample oscillator, then the M1, the D-50 and the Wavestation. These
   may only ship waveforms the project is allowed to redistribute; bring the
   owner the choices before building them.

### Step 4. MIDI work (roadmap features 6)

Pads to the drums; more than one place for incoming notes at once; knobs
tied to parameters by learning; and the older items (following an external
clock, sending notes played by hand, choosing the output channels). A mapped
knob must change a parameter by the same store operation the knob on screen
sends. The owner's controller is a Novation Launchkey Mini MK2 (25 keys, 16
pads, 8 knobs). Make it work as it comes, and get its real note and
controller numbers from the owner reading the MIDI panel's last-message
line, not from memory. Nobody has tested the app against real MIDI hardware,
so the owner tests each part.

### Step 5. Parameter automation (roadmap features 5)

Recordable from the screen and from a mapped hardware knob. A hardware knob
sends 128 positions, so playback needs smoothing.

### Step 6. Bar length and scenes as a playlist

Changing a bar's length, designed together with time signatures (roadmap
features 11: per scene; 4/4, 3/4, 6/8, 5/4, 7/8 and 12/8 are agreed;
whether a bar may have any custom number of steps is for the owner). Then
the playlist-style layout for scenes (roadmap features 14).

### Not in the queue

Undo as a store feature, recording live playing, more ways to edit
patterns, and live collaboration, which the owner wants built last of all.

## 5. Waiting on the owner

Said by the owner on 2026-10-12, so no longer waiting:

- **Firefox waits.** "lets get feature complete in chrome then work back to
  firefox."
- **Play stays as it is.** "play/stop state should be easy to tell from the
  button, so do what you must": it is a light button reading Play All when
  stopped and a lit amber one reading Stop All while playing, which was
  judged clear enough. Change it only if the owner says it is not.
- **The new lettering looks good.**
- **The GitHub Support report was sent.**
- **Sound work comes next**, ahead of the rest of the design-review queue:
  "we've done a lot of non sound work. lets do some sounds work, prests and
  synths".
- Also asked for that day, each given to a builder: the preset selector as
  a nested menu; in Projects, one row for a project and its copies, with a
  way to choose among them; Kindle devices given the phone layout. Check
  the open pull requests for each.

Still waiting:

- **Firefox, later.** The owner said "firefox still has trouble" with guest
  instruments, after two fixes (#76, #77). When Chrome is feature complete,
  ask what they see (which guest; does it fail to load, make no sound, or
  drift out of time; any message in the console).
- **Listening.** The owner has heard the three starting beats and said they
  sound good (2026-10-12). Nothing else is verified by ear, the forty new
  presets least of all.
- **The Launchkey's numbers**, when step 4 is reached.

Decided, so do not ask again: kids mode stays a separate page, and a kids
tune not opening in the full app is fine; published songs have a page for
each person only; the design review may suggest features as well as
redesign; the knob wheel's behaviour is fine as built; the phone layout and
kids mode look good on the owner's phone.

## 6. Things learned the hard way

- **A touch is steered to the nearest thing that answers a click.** A small
  thing laid over a control must not have an `onClick`, or a finger on the
  control is handed to it. This cost three rounds on the phone piano roll.
- **Browser tests: never check and then act, never read once after an
  action.** `isEnabled()` then `tap()` hung for the whole of a test's time
  four times in ten; a value read straight after a tap was sometimes the old
  one. Use `expect` with its waiting, or `expect.poll`. A test that passes
  only on a retry (the log says "flaky") is a failure.
- **A hung test leaves a trace.** Download the run's artifact, unzip
  `trace.zip`, and in `1-trace.trace` (one JSON object a line) a `before`
  with no matching `after` is the action that never finished.
- **Fetching the browser on GitHub can stall** for minutes and then arrive
  all at once. It is cached now and retried. Installing the browser's
  system libraries with apt also hung, twice, restarting services; the
  checks no longer run apt, because GitHub's machines have the libraries. A
  job that fails before any test ran can simply be run again
  (`gh run rerun <run> --failed`).
- **Stage files by name.** `git add -A` once swept a local cache file into
  a commit.
- **The working tree has Windows line endings on Windows.** Multi-line
  edits go through a small Node script (the `scripted-edits` skill).
- **Builders have been cut off by the usage limit five times.** Nothing was
  lost when they had pushed early. A cut-off builder can be resumed with a
  message and keeps what it knew.
- **The agent cannot change its own permission settings**, even when the
  owner says to. The owner adds rules with `/permissions`.
