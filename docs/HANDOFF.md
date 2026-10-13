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

**The project pays for nothing.** The owner said so on 2026-10-12, in
capitals. Do not plan, propose or build on anything that costs money, asks
for a payment card, or bills by use, and do not describe work as waiting on
a payment. If something can only be done by paying, it is not planned; say
so and look for a way that is free.

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

Rewritten on 2026-10-12 at the owner's request, to hold every open item in
`docs/ROADMAP.md` and not only the current run of work. Tick things off
here as they merge. Steps 1 to 8 are in the order the owner gave, except step 3, which the
builder placed; from step 9 on the order is the builder's suggestion, and
the owner has not confirmed it. Live collaboration is last because the owner said so.

Finished since this file was first written, so no longer in the queue: all
of the design review's findings that were chosen (1 to 14); redesign C, all
three parts; design-review features 1, 6, 7, 9 and 10 (starting beats, the
save state, scene colours, full drum names, Space plays); the preset
sounds; and every synth model in `docs/SYNTH_MODELS_PLAN.md`, with the
voice work they needed (the ladder and MS-20 filters, a high-pass,
modulation routes, sync and ring, a second layer, the sample engine and the
app's own waves). The owner has heard little of the sound work: see section 5.

### Step 1. Tempo sync on everything that has a rate (roadmap features 18)

Asked for on 2026-10-12 and put first by the owner: "everything with a
rate knob should have a sync button that syncs to tempo ... bump it to the
top". Built for the phaser, the chorus and the speed of a sequence of
waves, and merged (#154).
The roadmap item says what is still open, and the owner has not said
whether that is enough.

### Step 2. The drum cymbals (roadmap sound 8)

Asked for on 2026-10-12: "the cymbal on the drum machine sounds bad. also
give more cymbal options on drums". Ask which cymbal, in which kit, and
what is wrong with it before changing anything; then a pass at the sound,
and more cymbals to choose from. The owner answered: both cymbals, every
kit, "sound nothing like cymbals", the hats are fine, and yes to
recordings. Built on `feat/design-review-cymbals` (check its pull
request's state): four recorded cymbals in place of the synthesized two.
The owner has not heard them.

### Step 3. A full song among the starting points (roadmap features 21)

Beside the three beats. A first version, with the three beats dressed up
and the arpeggiator's single-note change the owner asked for the same day,
is built on `feat/design-review-starters-and-arp` (check its pull
request's state). The owner has heard none of it: ask what to change.

### Step 4. The rest of the owner's picks from the design review

A branch with `design-review` in its name gets pictures of the app from
the checks; look at the pictures of what changed before calling it done.

Look:

1. **Redesign A, with finding 8 and features 3 and 4.** The phone's top
   bar as one line (tempo, Play, a "more" button) with everything else in a
   sheet; lamps on the bar of units that show activity and mute; a way to
   mute a unit from the bar. The walkthrough points at buttons that move
   into the sheet.
2. **Redesign B, with finding 9.** A lane's editor as two levels, Notes and
   Sound, with presets inside Sound and the preset's name on the lane's top
   line.

Behaviour:

3. **Feature 5:** copy a lane's pattern, or one drum row, to another scene.
   Built on `feat/design-review-copy-to-scene` (check its pull request's
   state).
4. **Feature 2:** export as a small dialog (what, as what, how long, and
   the progress in the same place). Built on
   `feat/design-review-export-dialog` (check its pull request's state).
5. **Feature 11:** Help with a list of headings and a search box. Merged
   (#153). "Help for this unit" on each unit's name plate, the other half
   of that feature in the review, is not built.
6. **Feature 8:** a metronome and a count-in, with the switches beside
   Tap. Built on `feat/design-review-metronome` (check its pull request's
   state). Not heard by the owner.
7. **Chord buttons in the piano roll** (roadmap features 15). The owner
   said on 2026-10-12 how it should work: choose a shape, then the root
   note; each note of a chord can then be deleted or lengthened by itself,
   perhaps with a toggle between one note and the whole step. The roadmap
   item has it in full, and says why it needs a length for each note.

### Step 5. MIDI work (roadmap features 6)

Pads to the drums; more than one place for incoming notes at once; knobs
tied to parameters by learning; and the older items (following an external
clock, sending notes played by hand, choosing the output channels). The mod
wheel as a source for the modulation routes belongs here too (roadmap sound
4). A mapped knob must change a parameter by the same store operation the
knob on screen sends. The owner's controller is a Novation Launchkey Mini
MK2 (25 keys, 16 pads, 8 knobs). Make it work as it comes, and get its real
note and controller numbers from the owner reading the MIDI panel's
last-message line, not from memory. Nobody has tested the app against real
MIDI hardware, so the owner tests each part.

### Step 6. Parameter automation (roadmap features 5)

Recordable from the screen and from a mapped hardware knob. A hardware knob
sends 128 positions, so playback needs smoothing.

### Step 7. Bar length and scenes as a playlist

Changing a bar's length, designed together with time signatures (roadmap
features 11: per scene; 4/4, 3/4, 6/8, 5/4, 7/8 and 12/8 are agreed;
whether a bar may have any custom number of steps is for the owner). Then
the playlist-style layout for scenes (roadmap features 14).

### Step 8. Firefox

"lets get feature complete in chrome then work back to firefox." When the
steps above are done, ask the owner what they see with guest instruments
in Firefox (section 5) and work from that.

### Step 9. The audio layer, and the sound work that waits on it

1. **Give the audio layer a single owner** (roadmap improvements 4).
2. **A master mixer** (features 22): every lane, the drums and the guests
   side by side with meters, and a strip for the whole mix. Ask the owner
   the roadmap item's questions before building. Placed here by the
   builder, because the meters and a level for the whole mix belong to the
   audio layer.
3. **Delay and reverb sends for each drum sound** (features 23), and
   **aux sends that can be routed to effects** (features 24). Both asked
   for on 2026-10-12, and placed here by the builder beside the mixer,
   which is where they would be shown. Each has questions for the owner in
   its roadmap item.
4. **Insert effects for each lane, and an algorithmic reverb** (sound 6).
5. What the sound work of 2026-10-12 left open, each small: loop points, a
   start offset and several recordings for an imported sample (sound 3);
   smoothing for a sample, a wave or a synced oscillator played high, which
   alias today; more than four modulation routes, and the LFO tab's own
   target menus beside them (sound 4); the ladder filter's level (sound 5).

### Step 10. Under the surface

1. **Undo as a store feature** (improvements 2): every edit recorded by
   the store, a drag as one entry, and an entry that restores the whole
   project and not one lane.
2. **Split `useStudio.tsx` into hooks per concern**, the rest of
   improvements 1. The typed store is done.
3. What the typed store left open (`AGENTS.md`, Known Issues).

### Step 11. Playing and editing

1. **Record live playing against the clock** (features 3): quantize
   strength, and recording from the on-screen keyboard. The metronome and
   count-in come with step 4.
2. **More ways to edit patterns** (features 4): lengths that are not a
   whole number of bars, copying one bar to another, copy and paste between
   scenes, and a part shared between scenes.
3. **Transpose** (features 19). Ask the owner what is moved and whether
   it rewrites the notes before building.
4. **A randomizer** (features 20). Ask the owner what it randomizes before
   building.

### Step 12. Finishing what is part done

1. **Accessibility** (improvements 5): the on-screen keyboard as one tab
   stop, the piano roll's step numbers as column headers, and a try with a
   real screen reader.
2. **The phone layout** (features 1) and **kids mode** (features 2):
   whatever those items still list as open, and trying both on real
   devices, a Kindle among them.
3. **The design review's leftovers**: what `docs/DESIGN_REVIEW.md` lists as
   not looked at.
4. **A true progress bar for exports** (features 13). The browser's
   offline renderer does not report how far it has got, so this needs the
   render done in pieces.

### Step 13. Live collaboration (the rest of roadmap features 7)

Last of all, by the owner's word. Live editing needs a connection held
open, which `AGENTS.md` rules out today, so that rule would have to be
changed on purpose. Also open there: seeing that the other person has the
project open, sharing by a code or a link, and passing a project to a new
owner.

### Waiting on something outside the work

- **Listen and tune** (sound 1). Only the owner can do it, at any time.
  Section 5 lists what has not been heard.
- **Samples that sync** (sound 2). Not planned as first designed: the file
  storage it was to use asks for a payment card, and the project pays for
  nothing (the owner, 2026-10-12). Open only if a way is found that costs
  nothing.

### Not chosen, so not in the queue

Design-review findings 15 and 16, redesigns D and E, and its feature 9
apart from the drum names. Tape Loop Deck stays off the guest list.

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
- **Listening.** The owner has heard the three starting beats, the seven
  models of group A and the presets (2026-10-12): "things generally sound
  good to me". Not heard: the ladder filter and the four presets on the
  Minimoog and TB-303 as they sound through it; the MS-20, its filter, its
  three presets and the high-pass.
- **The Launchkey's numbers**, when the MIDI work (step 5) is reached.
- **The cymbals** (step 2): whether the recorded Crash, Ride, Bell and
  Splash sound right, and whether the Ride (a suspended cymbal struck with
  a stick, the nearest the free library has) passes for one.
- **Transpose, the randomizer, the master mixer, the drums' own sends and
  routable aux sends** (steps 11 and 9): what each should do. The roadmap
  items (features 19, 20 and 22 to 24) list the questions.
- **Not heard, added on 2026-10-12:** modulation routes, the Odyssey with
  sync and ring, the Virus, the CS-80 and the second layer, the sample
  engine, and the M1, D-50 and Wavestation with the app's own waves. Which
  waves went into each Wavestation sequence was chosen without hearing them.

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
