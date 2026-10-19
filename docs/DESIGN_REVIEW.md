# Design review of the whole interface

Written 2026-10-11 for the owner (roadmap, improvements 9). Nothing here is
built. It is a list to choose from: say "do 3, 7 and 12" and each becomes a
small pull request; the redesigns and features are larger and are costed
separately.

It rests on 120 pictures of the real app taken by the browser tests on GitHub
(57 at desktop width, 63 at phone width) and on reading the stylesheets behind
them. The pictures are not in the repository; each finding names the picture
that shows it, as `desktop/<name>.png` or `phone/<name>.png`. Sizes: **small**
is an hour or two of an agent's work, **medium** is a day or so, **large** is
several days.

## 1. In short

The desktop rack is the strongest part of the app. It has a real idea behind
it (a rack of hardware, charcoal panels, one amber lamp colour, condensed
lettering, figures in a display face) and that idea is carried through the
transport, the lanes, the drums, the effects, the dialogs, the walkthrough and
the knob slider on a phone. It does not look like a template, and kids mode is
rightly a different world with its own look.

What lets it down is that the idea was applied in layers. The older controls
(the piano roll, the on-screen keyboard, the sound editor) still carry the
colours of the app before the rack, patched from outside. So the same note is
amber in the row of steps and blue in the piano roll. Amber now means eight
different things. Lettering comes in 33 sizes. And the phone layout, which
was built from the stylesheet without anybody seeing it, works but is
wasteful: the top bar takes nearly half the first screen and the sound
editor's header takes most of another.

The five things most worth doing, all small or medium:

1. **Fix kids mode on a phone held sideways** (finding 1). The twelve pads
   lie on top of each other. This is broken, not untidy.
2. **Fix the three places on a phone where words are cut off or squeezed**
   (finding 2): the Scene/Song switch, a project's name in the Projects
   list, and the recovery code.
3. **Make the piano roll, keyboard and sound editor use the rack's colours**
   (finding 4), so a note is the same colour everywhere.
4. **Raise the faint text and enlarge the smallest desktop targets**
   (findings 5 and 6): drum step numbers, the BPM label, disabled buttons,
   and the drum grid's 16-pixel cells.
5. **Give "focused", "selected" and "on" different looks** (finding 3), so a
   keyboard user can see where they are on an amber step.

The two bigger redesigns I would choose first:

- **The phone's top bar and bottom bar** (redesign A): one line of
  transport at the top, everything else behind a single menu. It gives back
  about a third of every phone screen.
- **A lane's editor as two levels** (redesign B): notes first, sound second,
  presets in the sound part. It fixes the phone's long scroll to the piano
  roll and makes the desktop lane easier to read.

## 2. Findings

Most important first. Each is marked **fault** (wrong or hard to use),
**inconsistency**, or **polish**.

### 1. Kids mode's pads overlap on a phone held sideways. Fault, small. **Done in #120.** Nothing is left of it; the beat grid on the shortest sideways phone (568 by 320) has holes 38px high, as before.

A child holding a phone sideways sees the three rows of pads piled on top of
each other: only the top sliver of the bear, dog, cat and rabbit shows, the
second row covers the first, and the row of progress dots is drawn across
the drum pads. Most of each pad cannot be touched.

- Where: kids mode, pads screen, 740 by 360. `phone/kids-pads-landscape.png`.
  The beat screen at the same size is fine (`phone/kids-beat-landscape.png`).
- Cause: `ui/src/kids/kids.css`. Each pad has `min-height: 64px`, and three
  rows of 64 plus the gaps, the two rows of buttons above and the play
  button below need more than 360 pixels. The grid's rows are allowed to
  shrink but the pads are not, so they spill over one another. On a narrow
  screen the six sound buttons also take a line of their own (`order: 1;
  flex: 1 0 100%`), which a sideways phone cannot spare.
- Fix: on a short screen, put the sounds on the same line as the two screen
  buttons, shrink the play button, and let pads go to six across in two
  rows. Add this size to the kids browser test, which today only checks an
  upright phone.
- The roadmap asks "whether twelve pads are cramped on a phone held
  sideways" (features 10). This answers it.

### 2. Words cut off or squeezed on a phone. Fault, small each. **Done in #120**, all five parts a to e. Not seen on a real phone.

a. **The Scene/Song switch reads "Scen" and "Song" with the letters
   clipped.** `phone/phone-unit-song.png`, `phone/focus-button.png`. In
   `rack.css` the phone block sets every mute/solo-style button to 36 pixels
   wide (`.rack-ms button { width: 36px }`), and that rule comes after, and
   so beats, the one that lets this switch be as wide as its word. Fix: give
   `.mode-toggle button` its own width in the phone block.

b. **In the Projects list, signed in, a project's name is squeezed into a
   column one word wide** ("Friday / Night / Open / now · / saves / as you
   …", with "browser" cut to "browse"), while four buttons sit beside it.
   `phone/dialog-projects-signed-in.png`. The row is allowed to wrap, but
   the name is also allowed to shrink to nothing, so the buttons win. Fix:
   on a phone give the name the whole first line and put the buttons under
   it.

c. **The recovery code breaks across two lines** in the middle
   ("…N6CEA-" then "9BJ9Q"). `phone/dialog-account-recovery-code.png`. This
   is the one piece of text a person must copy exactly. Fix: a slightly
   smaller size on a phone and no break inside the code (`.account-code`,
   20px with wide spacing).

d. **Knob figures lose their last letter**: "0.45H" for Hz, "0.60H", and
   "0.0 s" for semitones. `desktop/unit-effects.png`,
   `desktop/unit-drums.png`, `phone/phone-unit-effects.png`. The figure box
   is `6.5ch` wide (`.rack .knob-value-input`) and those values are longer.
   Fix: size the box to the longest value, or drop the space before the
   unit.

e. **The delay's two labels run together as "ONSYNC".**
   `desktop/unit-effects.png`. The "On" tick box and the "Sync" menu's label
   have no gap. Fix: a gap, or call the menu's label "Time".

### 3. Amber means too many things, so focus and selection are hard to tell apart. Fault, medium. Done in pull request #123.

What was built differs from the fix below in two places. A selected step is
not a thicker ring but a frame inside the step's own edge, so that it and the
focus ring, which stands outside, are different shapes and a step that is
both shows both. And the main button (Play, and a dialog's main button) is
no longer amber, since amber now means "on": it is the lightest button, and
Play turns amber while it plays.

Amber (`--amber`, `#ffb000`) is used for: a step that holds a note, the open
lane's border, the open scene, the main button, every figure and readout,
headings inside dialogs, the hover outline of every button, and the keyboard
focus ring. Two consequences a person meets:

- Tabbing onto a step that holds a note draws an amber ring on an amber
  square on a panel with an amber border. `desktop/focus-step.png`,
  `phone/focus-step.png`. It can be seen, just. A selected step, by
  contrast, gets a white ring, which is clearer than focus.
- A hovered button and a focused button look almost alike
  (`desktop/hover-button.png` against `desktop/focus-knob.png`), and a
  pressed-in toggle is grey-white (`.rack-btn.on`) while a pressed-in
  mute is amber (`.rack-ms button.on`) and the open scene is amber too.

Cause: `rack.css` has one accent and uses it for state, emphasis and focus
alike (`button:focus-visible { outline: 2px solid var(--amber) }`).

Fix: keep amber for "this is on or holds something" and for figures. Make
the focus ring white with a dark gap (it then shows on amber and on
charcoal). Make hover a lighter border, not amber. Use one look for every
"on" toggle. The steps' "selected" ring would then need to differ from
focus: a thicker white ring for selected, a double ring for focus.

### 4. The piano roll, the keyboard and parts of the sound editor are in an older colour scheme. Inconsistency, medium. **Done as redesign C part 2.** The switch reads "Keys" and "Roll". Seen only in the pictures the checks take, not on a real screen.

- Notes are amber in the row of steps and blue in the piano roll directly
  beneath it. `phone/phone-piano-roll.png`, `desktop/unit-synth-piano-roll.png`.
  A pressed key on the keyboard is blue as well.
- The piano roll and the keyboard sit in rounded, lighter grey boxes
  (8-pixel corners) inside a rack whose corners are 2 or 3 pixels.
  `desktop/unit-keyboard.png`.
- The piano roll's "Clear" button is in the computer's ordinary lettering
  and mixed case; every other button is condensed capitals.
  `desktop/unit-synth-piano-roll.png`, `phone/phone-piano-roll.png`.
- "Scene" and "Song" on the play-mode switch are in mixed case for the same
  reason. `desktop/unit-song.png`.
- The switch between keyboard and piano roll is two emoji (a piano and a bar
  chart). `desktop/unit-keyboard.png`. They are drawn in full colour by
  whatever device shows them, the bar chart is not a picture of a piano
  roll, and they are the only pictures used as buttons in the rack.

Cause: `ui/src/components/PianoRoll.css`, `Keyboard.css`, `KeyboardPanel.css`,
`SynthControls.css`, `EffectsPanel.css`, `MidiPanel.css` and `Knob.css` hold
the app's first look: blue `#3b82f6`, cyan `#00d4ff`, green `#10b981`, an
orange-amber `#f59e0b` that is not the rack's `#ffb000`, Courier New, and
corners of 4 to 10 pixels. None of them uses the rack's named colours (the
count of `var(--…)` in those files is zero; `rack.css` uses them 160 times).
`rack.css` then overrides them from outside with about 60 rules beginning
`.rack .…`. Whatever those rules did not reach still shows the old look. A
`<button>` also does not take the page's capitals unless told to, which is
what the "Clear", "Scene" and "Song" buttons show.

Fix: move each component's styles onto the rack's named colours and delete
the overrides. Notes amber in the piano roll (with the lighter amber for a
held note that the step row already uses), pressed keys amber, the boxes
square. Replace the two emoji with two small drawn icons or the words "Keys"
and "Roll". This is the single change that most makes the app read as one
thing.

### 5. Faint text. Fault, small. **Done in #121.** The faint edges are lighter but not to 3 to 1: an empty step is 2.4 to 1 and kids mode's holes 1.7 to 1 and 2.3 to 1.

Measured from the colour values, against the usual minimum of 4.5 to 1 for
small text (3 to 1 for large):

| What | Colours | Ratio |
|---|---|---|
| Step numbers over the drum grid | `#5d6164` on the panel | 2.1 |
| "BPM" beside the tempo | `#7a5a14` on `#0a0b0a` | 3.1 |
| A disabled button's word | 40% see-through | 3.1 |
| Disabled − + arrows on a song block | 30% see-through | 1.6 |
| An empty lane's name on the phone's bar | 60% see-through | 2.5 |
| Small grey captions on a panel (`--dim`) | `#8f9396` on the panel | 4.2 |

`desktop/unit-drums.png`, `desktop/unit-transport.png`,
`desktop/unit-song.png`, `phone/phone-unit-song.png`. The grey captions
(`--dim`) matter most because they carry real instructions: the hint under
the Notes tab and the note under a guest are 13-pixel condensed grey text.

Fix: lighten `--dim` to about `#a3a7aa` (5.3 to 1), set the step numbers and
"BPM" to `--dim`, and show disabled by a flatter look (no border light, grey
word at 4.5 to 1 with a "not allowed" pointer) instead of see-through.

Also faint, but not text: an empty step's edge against the panel is 1.4 to
1, and an empty square in kids mode's beat grid against the page is 1.2 to
1 (`phone/kids-beat.png`). Empty steps read as a dark band, not as sixteen
places to press. A slightly lighter edge would help; in kids mode the holes
could be a shade lighter.

### 6. Small things to hit on a desktop. Fault, small to medium. **Done in #121.** Drum rows are 24 pixels tall (not 22), the tick boxes 18 pixels.

The phone layout was given finger-sized controls; the desktop was left with
some very small ones, and plenty of laptops have touch screens.

| What | Size in pixels | Where set |
|---|---|---|
| A drum step | about 40 by 16 | `.drum-step-btn { height: 16px }` |
| Drum mute and solo | 18 by 16 | `.rack-ms.small button` |
| A drum's name button (BD, SD…) | 38 by 16 | `.drum-name` |
| Lane mute and solo | 22 by 22 | `.rack-ms button` |
| − + ◀ ▶ ✕ on a song block | 20 wide | `.song-block-tools button` |
| A tick box in the effects | about 13 square | `.effects-toggle input` |

`desktop/unit-drums.png`, `desktop/unit-song.png`, `desktop/unit-effects.png`.
The five song-block buttons are also 20 pixels apart with "remove" last in
the row, right beside "move later".

Fix: drum rows 22 pixels tall (eight rows add 48 pixels to the unit), mute
and solo 24 square everywhere, song-block buttons 26 wide with ✕ set apart.

### 7. Lettering comes in 33 sizes. Inconsistency, medium. **Done as redesign C part 3**: seven sizes (11, 13, 14, 16, 18, 26, 40), the desktop's base raised from 12 to 13, and the plain face for sentences. Letter-spacings and weights were not in the fix and are as they were.

Counted across the stylesheets: 33 different sizes (9, 10, 11, 12, 13, 14,
15, 16, 18, 20, 22, 26, 30, 34, 38, 40, 44 pixels, eleven more written in
another unit, and three that scale with the screen), five weights, 17
different corner roundings, 14 letter-spacings, about 30 different shadows,
and 93 distinct colours written out longhand plus 25 see-through ones, where
the rack names 12. Much of that is the older components (finding 4); the
rest is drift.

What a person notices: on a desktop most of the rack is set at 11 and 12
pixels in condensed capitals, which is small (`desktop/rack-full.png`);
there are three different ways of setting a sentence: condensed type on the
rack (`.rack-hint`), the computer's own type in dialogs
(`.rack-dialog-body`), and condensed type again on the share pages
(`desktop/page-share.png` against `desktop/dialog-help.png`).

Fix: one written scale of seven sizes (11, 12, 14, 16, 18, 26, 40), two
corner sizes (2 for a panel, 3 for a control), three shadows (control,
floating panel, lamp glow), named in `rack.css` beside the colours, and the
rules moved onto them. Raise the desktop's base size from 12 to 13. Decide
one face for sentences: I would use the dialog's plain face for anything
longer than a label, on the rack and the share pages too, because condensed
capitals are for labels and tire the eye in a paragraph.

### 8. The phone's top bar takes almost half the first screen. Fault, medium. **Done as redesign A.** Not seen on a real phone.

On a phone the bar wraps to three lines: name with Undo, Redo, Project and
Export; then Sign In, MIDI, ?, Mute and a volume knob standing taller than
the rest; then tempo and Play. That is 480 of 2,200 picture pixels before
the first unit, with gaps of empty panel between the lines.
`phone/phone-unit-song.png`, `phone/phone-unit-drums.png`. On a phone on its
side it is worse: the bar is 400 of the 945 pixels of height, and with the
bar of units at the bottom about a third of the screen is left for the
instrument. `phone/phone-landscape-synth.png`.

Cause: the same eleven controls as the desktop, wrapped
(`.rack-row { flex-wrap: wrap }` in the phone block). Only the last line
stays when scrolled, which is right; the trouble is the first screen.

Fix: see redesign A. As a small first step: put the volume knob inside the
Mute button's line at button height, and drop the gaps.

### 9. On a phone the way to a lane's notes is long. Fault, medium. **The first cause is done as redesign B**: the model and the preset tools are inside Sound, so Notes is the two levels, Length and Bars, and then the keyboard or piano roll. The second cause, the tall band the hint and the step controls share, is as it was.

Opening a lane on a phone shows: name, sixteen steps, five knobs, then a
block of Hold, Model, Preset, a name box, Save, Delete, Import and Export
that fills about a third of the screen, then seven tabs, then Length and
Bars, then an instruction with an empty band above and below it, then the
keyboard switch, and only then the piano roll, about one and a half screens
down. `phone/phone-keyboard.png`, `phone/phone-unit-synth-2.png`,
`phone/phone-unit-synth-3.png`.

Two causes. The preset tools sit above the tabs, so they are always there
(`SynthControls.tsx`). And the hint under the Notes tab shares its space
with the step controls and is sized for whichever is taller
(`.step-tools-swap`), which is a good rule on a desktop, where it stops the
piano roll jumping, but leaves a tall empty band on a phone where the step
controls wrap to four lines.

Fix: see redesign B. As a small first step: move presets into a tab of their
own, so the header is one line.

### 10. Things that are the browser's own, not the rack's. Inconsistency, small each. **Done, all but the sliders and tick boxes**, which the fix below did not ask for and are still the browser's.

- The share page's player is the browser's white pill once Listen is
  pressed. `desktop/page-share-playing.png`, `phone/page-share-playing.png`.
  It is the loudest thing on the page and belongs to another world.
- "Choose File / No file chosen" in MIDI and samples is the browser's white
  button. `desktop/dialog-midi-samples.png`. Elsewhere (Import preset,
  Import Kit) the app already hides it behind its own button.
- Deleting a scene, a project or a member asks with the browser's own
  pop-up (`window.confirm` in `SongModule.tsx`, `ProjectsDialog.tsx`,
  `AccountDialog.tsx`). `AGENTS.md` already says not to use it for guests,
  because a browser can be told to stop showing it and then answers "no"
  silently. The same holds here. Not photographed: a test cannot picture it.
- Sliders and tick boxes are the browser's, tinted amber. A disabled slider
  turns pale grey and looks brighter than a working one
  (`desktop/state-disabled-step-tools.png`, the Chance slider).
- Tapped buttons on a phone flash blue-green for a moment, the phone
  browser's own tap mark. `phone/phone-unit-song.png` (the Song switch),
  `phone/phone-keyboard.png` (the keyboard button),
  `phone/phone-unit-drums.png`. The keyboard and kids mode already turn it
  off; the rest of the rack does not (`-webkit-tap-highlight-color`). I am
  not certain how visible this is on a real phone; the pictures caught it
  mid-fade.

Fix: a small player of the rack's own (play, a bar, the time); the app's
button over the file chooser; the app's own dialog for the three
confirmations (which also lets Delete be styled as dangerous); turn the tap
mark off for the whole page.

### 11. The MIDI and samples dialog is the least finished screen. Polish, small. **Done with redesign C part 2.** The file chooser is still the browser's own; that is finding 10.

The sampler's box is indented and narrower than the box above it, the
"not supported" message sits in a small box of its own at a different width
and a smaller size, and "Stop Samples" is offered when there are no samples.
`desktop/dialog-midi-samples.png`, `phone/dialog-midi-samples.png`. Cause:
`MidiPanel.css` and `SamplePanel.css` are from before the rack and only
partly overridden. Fix with finding 4.

### 12. The account dialog's main button is Sign Out. Polish, small. **Done in #126.** Nothing is left of it.

Signed in, the one amber button is Sign Out, in a row of six where Delete
Account looks the same as Show the Walkthrough.
`desktop/dialog-account-signed-in.png`, `phone/dialog-account-signed-in.png`.
The thing most people open this for is to see that sync is working, which
is there and well done. Fix: no amber button here; Delete Account apart, at
the bottom, in the danger colour; the owner's invite codes and members
under a heading that says they are the owner's.

### 13. The Project menu is eleven things in one list. Polish, small. **Done in #126**, with the Export menu grouped the same way. The WAV names that feature 13 mentions were already Scene WAV and Song WAV. On a phone the sheet is taller than the screen's 70% and scrolls, so Kids Mode and Reset All are below the first screenful.

New Project, All Projects, Save a Copy, Version History, Share Link, Export
Project, Import Project, Add Guest Instrument, Import MIDI, Kids Mode, Reset
All: no grouping, no lines between, and Reset All (which clears everything)
is one row under Kids Mode with the same look. `desktop/menu-project.png`,
`phone/menu-project.png`. The explanations exist but only as hover hints,
which a phone does not have. Fix: three groups with a line between
(projects; in and out; extras), Reset All last, apart, in the danger colour;
on a phone show each row's explanation as a second, smaller line, since the
menu there is a full-width sheet with room for it. Overlaps features 13
(naming the WAV exports), which should be done in the same pass on the
Export menu (`desktop/menu-export.png`).

### 14. Names that do not match. Inconsistency, small. **Done in #127**, and with it feature 9 below. See the pull request for every name that changed.

- The drum grid says BD, SD, CP, CH, OH, LT, HT, CY; the strip beneath says
  Kick, Clap; Import Kit says Kick, Snare, Closed Hat, Low Tom.
  `desktop/unit-drums.png`, `desktop/dialog-kit-import.png`. BD and SD are
  drum-machine shorthand a newcomer will not know. On a phone the name
  buttons are tall enough for the whole word (`phone/phone-unit-drums.png`).
- Three pattern buttons are only arrows (→ ⇄ ⇈) beside one that is a word
  (Fill). `desktop/unit-drums.png`. Their meaning is in a hover hint.
- The lane's knob says "Reso" and the Filter tab's says "Resonance"; "Synth
  Rtn" and "Drum Rtn"; "Uni Det"; "Flt Drive". `desktop/synth-tab-filter.png`,
  `desktop/synth-tab-osc.png`. Some abbreviation is right for a panel; it
  should be the same one each time.
- A lane says "Analog" under its name while its Model menu says "Generic".
  `desktop/unit-synth-piano-roll.png`.

### 15. The open lane is not obviously openable, and the closed ones give no clue. Polish, small.

A lane is opened by clicking its name. Nothing about "SYNTH 2" looks like a
button until the pointer is on it (the name turns amber).
`desktop/rack-full.png`. Fix: a small ▸ / ▾ mark by the name, as a disclosure
has, and open a lane when one of its steps is clicked (it already selects
the lane; the picture `desktop/hover-step.png` shows a closed lane's step
inviting a click).

### 16. Smaller polish. Small each.

- The scenes' buttons (+ Copy, + Empty, Rename, Delete) are at the far right
  of the row, a screen's width from the scenes they act on.
  `desktop/unit-song.png`.
- The knob on the transport stands taller than its row, so the bar is as
  tall as the knob needs. `desktop/unit-transport.png`.
- In the walkthrough the dimming is good and the card is clear. On a phone
  the card covers the lower third and the part being shown can sit behind
  it for tall parts (`phone/walkthrough-step-4.png` shows the sound editor
  running under the card). The roadmap already notes it places its card by
  width alone.
- The share page and the songs page are a small card in the middle of an
  empty black screen. `desktop/page-share.png`, `desktop/page-user-songs.png`.
  See redesign D.
- On a person's songs page a song is a dark row with no arrow, no play mark
  and no underline; it does not say "press me". `desktop/page-user-songs.png`.
- The step controls say "100%" in a bolder, larger readout than the
  velocity's "89". `desktop/step-tools-selected.png`.
- Add Guest shows three instruments by one maker, all with the same small
  "Add" button, and the form for an address below with a second, bigger
  "Add Guest". `desktop/dialog-add-guest.png`. Fine; the error message is
  clear and says what to do (`desktop/dialog-add-guest-error.png`).

### What is good and should be kept

So that fixes do not sand it off: the tempo display; the step lights; the
knob slider sheet on a phone (`phone/phone-knob-sheet.png`), which is the
best-made thing on the phone; the phone's bar of units with its lamps; the
dialogs' plain, honest wording (the recovery code, sharing, guests, version
history all say exactly what happens and what is kept where); the
walkthrough's spotlight; kids mode upright and on a desktop
(`phone/kids-pads.png`, `desktop/kids-beat.png`), which is clear, bright
and has nothing to read.

## 3. Redesign suggestions

### A. The phone's top and bottom bars

**Done.** The top bar is one line (tempo, Play, Undo and Redo as arrows from 375px wide, and a
button for the rest), and the rest is a sheet from the bottom edge. What was built differently
from the proposal below: Tap, Click and Count are in that sheet, not in a tempo sheet of their
own, and tapping the tempo still opens the plain text field; "All" is still on the bottom bar;
the sheet's rows have their explanation beside the button, not under it; the walkthrough
points at the button for the three stops that are now under it and does not open the sheet.
Not seen on a real phone.

**Now.** Eleven controls wrap over three lines at the top (finding 8); seven
or eight units share a bar at the bottom in 11-pixel letters.

**Proposal.** One line at the top that never wraps and never scrolls away:
tempo, Play, and a "more" button. Everything else (project name, Undo, Redo,
Project, Export, account, MIDI, Help, Mute, volume) lives in the sheet that
"more" raises from the bottom, grouped, with each row's explanation as a
second line. Undo and Redo get a place on the top line when there is room.

```
 now (first screen of a phone)          proposed
┌───────────────────────────────┐      ┌───────────────────────────────┐
│ DISCOBOT  UNDO REDO PROJ▾ EXP▾│      │ 120  ▶ PLAY ALL     ↶  ↷   ≡  │
│ Untitled                      │      ├───────────────────────────────┤
│ SIGN IN  MIDI  ?  MUTE  (vol) │      │ SYNTH 1  Analog          M  S │
│                               │      │ ■ □ ■ □ ■ □ ■ □               │
│ 120  TAP  ▶ PLAY ALL          │      │ ■ □ ■ □ ■ □ ■ □               │
├───────────────────────────────┤      │ (o) (o) (o) (o) (o)           │
│ SYNTH 1  Analog          M  S │      │  NOTES   SOUND                │
│ ■ □ ■ □ ■ □ ■ □               │      │ ┌ piano roll ───────────────┐ │
│ ■ □ ■ □ ■ □ ■ □               │      │ │                           │ │
│ (o) (o) (o) (o) (o)           │      │ │                           │ │
│ …                             │      │ └───────────────────────────┘ │
├───────────────────────────────┤      ├───────────────────────────────┤
│Song│Syn1│Syn2│Syn3│Drum│FX│All│      │ Song │ 1 │ 2 │ 3 │ Drums │ FX │
└───────────────────────────────┘      └───────────────────────────────┘
```

Tap tempo moves into the tempo's own editing sheet (tap the display: type,
tap, or nudge), which also fixes the tempo box being a bare text field on a
phone (`phone/state-tempo-edit.png`).

**For the person using it.** About 300 more picture pixels of instrument on
every screen, and one obvious place for everything that is not playing.
The cost is one more tap to reach Undo on the narrowest phones, and two to
reach Export.

**Alternatives.** (1) Keep the three lines but let all of them scroll away
except tempo and Play: this is today, and the first screen is the problem.
(2) Put the "more" button on the bottom bar in place of "All": saves the
top line a button, but then the bar of units mixes places with a menu. I
would pick the top-line version, and drop "All" from the bottom bar into the
"more" sheet as "Show the whole rack", since a phone user rarely wants it.

**Cost.** Medium. `TransportUnit.tsx` gains a narrow arrangement; `Menu.tsx`
gains groups and second lines. `phone-layout.spec.ts`, the walkthrough's
stops "Project and Export", "Your account" and "Help", and the
`--transport-tuck` measuring all change or go.

**Risk.** The walkthrough points at buttons that would now be inside a
sheet; it would have to open the sheet for those stops. Undo is used often
and must not end up two taps away.

### B. A lane's editor in two levels

**Done.** The open lane's editor has two tabs, Notes and Sound. Notes holds the step controls
and the keyboard or piano roll and nothing else. Sound holds the model, the presets with their
tools, and under them the six pages as a row of tabs of their own; it opens again on the page it
was left on. Both rows work with the arrow keys. What was built differently from the proposal
below: Hold and Remove are on the line of the two levels and show on both, since Hold is about
playing and Remove about the lane; Save, Delete, Import and Export are still four buttons, not a
"more" menu; a lane opens on Notes every visit, and which level is open is not remembered between
visits. Two parts of the proposal are not built: the pages side by side on a wide screen (every
browser test of the sound finds its controls a page at a time), and the preset's name on the
lane's top line (which preset a lane was last given is not stored, so there is nothing to show
after a reload). Seen only in the pictures the checks take, not on a real screen.

**Now.** One open lane shows: steps and five knobs; then Hold, Model and
six preset controls; then seven tabs of equal weight (Notes, Osc, Filter,
Amp, LFO, Arp, Sends), of which the first is about what is played and the
other six about the sound. `desktop/unit-synth-piano-roll.png`,
`desktop/synth-tab-osc.png`.

**Proposal.** Two tabs, Notes and Sound. Notes holds the step controls and
the keyboard or piano roll, and nothing else. Sound holds the model, the
presets and the six sound pages. On a desktop, where there is width, the
Sound tab shows the pages as a row of panels side by side, as hardware
does, and no further tabs are needed at 1280 pixels and up for Osc, Filter
and Amp together.

```
┌ SYNTH 1 ▾  Analog   M S   ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □   (o)(o)(o)(o)(o) ┐
│  [ NOTES ]  [ SOUND ]                              Preset: Night Bass ▾  ⋯   │
│                                                                              │
│  Step 3   Velocity ───●──  89   Slide □   Chance ─────●  100%   Length 1 ▾   │
│  ┌ piano roll ─────────────────────────────────────────────────────────────┐ │
│  │ C4 │   │   │   │   │                                                    │ │
│  │ G3 │   │ ▆ │   │   │      notes in amber, as in the row of steps        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

   SOUND:   Model ▾   Preset ▾  Save  ⋯ (import, export, delete)
            [ Osc ] [ Filter ] [ Amp ] [ LFO ] [ Arp ] [ Sends ]
```

The preset's name shows on the lane's top line at all times, where today
the lane says only "Analog": the name of the sound is the most useful label
a lane can have.

**For the person using it.** On a phone the piano roll is on the first
screen of a lane (finding 9). On a desktop the lane reads as "what it plays"
and "what it sounds like", which is how people think about a part.

**Alternatives.** (1) Only move presets into a tab (the small first step in
finding 9): cheaper, fixes most of the phone problem, leaves seven equal
tabs. (2) Keep Sound always open beside Notes on a wide desktop: best for a
big screen, but the rack gets very tall. I would pick the two-level version
and build alternative 1 first as a step toward it.

**Cost.** Medium to large. `SynthControls.tsx` is 1,356 lines and owns the
tabs; `SynthModule.tsx` passes the notes in. Many browser tests click a tab
by name.

**Risk.** A second level of tabs is one more tap for someone who lives in
the Filter page. The roadmap's grouped presets menu (sound 7) and modulation
matrix (sound 4) both add to the Sound side, so this is better done before
them than after.

### C. One set of named values for the whole look

**Now.** See findings 3, 4 and 7. The look is held in one large stylesheet
that overrides seven older ones.

**Part 1 of three is done (pull request #123): the names for colours, and
the four states of finding 3.** `rack.css` names its colours by job and its
own rules use the names; `AGENTS.md` ("Colours and States") has the table.
The names differ a little from the sketch below: there is no "raised"
surface but `--surface-control`, `--surface-inset`, `--surface-field` and
`--surface-display`; text is `--text`, `--text-plain`, `--text-label`,
`--text-faint` and `--text-on`; and `--action`, `--select` and `--gap`
were added. What parts 2 and 3 build on:

- **Part 2 is done.** Each component's stylesheet holds its own look on the
  names, the `.rack .…` overrides and the old names are deleted, and the
  buttons that had a style of their own are `.rack-btn`. Left written out:
  the piano's white and black keys, and the knob's body in `Knob.tsx` and
  `DrumKnob.tsx`. The knobs are still passed a `color` each that nothing
  shows; it can be removed. What it was asked to do: move `PianoRoll.css`, `Keyboard.css`,
  `KeyboardPanel.css`, `SynthControls.css`, `EffectsPanel.css`,
  `MidiPanel.css`, `Knob.css` and `DrumKnob.css` onto the names and delete
  the `.rack .…` overrides. A note in the piano roll and a pressed key
  become `--on`. Those files still set orange focus outlines of their own;
  the rack's one focus rule already overrides them, so they can simply be
  deleted. The roll's cells and the piano keys are in the list of things
  whose ring is drawn inside the edge; once a note there is amber, check the
  picture of a focused note. The old names (`--amber`, `--ink`,
  `--legend`, `--dim`, `--well`, `--rail`, `--unit-top`,
  `--unit-bottom`) are no longer used by `rack.css` itself and can be
  deleted once nothing else uses them.
- Still written out in `rack.css`, for part 2 or 3 to name or drop: black
  (`#000`) round the displays, white for the step light, the two paler
  ambers of a slide and a held note (`#ffe09a`, `#8a6a1f`), the reds of
  the message bar and of an error (`#2a1a12`, `#ffd9cc`, `#ffb4a6`,
  `#ff8f80`), the rack's screws, and the knob sheet's thumb.
- **Part 3 is done.** `AGENTS.md` ("Sizes, Corners, Shadows and Faces") has
  the table. The scale is 11, 13, 14, 16, 18, 26 and 40 (13 where the
  sketch had 12, since the base was raised). Four shadows are named, not
  three: a lit step's glow is fainter than a lamp's. The bar of units'
  upward shadow is the one shadow still written out. What it was told:
  it has nothing from part 1 to undo: no type
  size, corner, spacing or shadow was changed, and the names for those are
  still to be chosen.
- The snare lane's colour (`--drum-snare`, `#f59e0b`) is close to the
  amber of "on". It was left as it was; whoever revisits the drum colours
  may want to move it.

**Proposal.** A short list of names in `rack.css` for everything: seven
type sizes, two corners, three shadows, and colours named by job rather
than by shade:

```
--surface-page  --surface-panel  --surface-well  --surface-raised
--text  --text-label  --text-faint
--on  (amber: holds something, is switched on)     --value (figures)
--focus (white ring)   --hover (lighter edge)   --danger
--drum-kick … --drum-cymbal   (the eight drum colours, today written in
                               DrumModule.tsx)
```

Then each component's stylesheet is rewritten onto those names and the
`.rack .…` overrides are deleted. No screen is rearranged.

**For the person using it.** Notes one colour everywhere, one look for
"on", a focus ring that shows, larger and more even lettering. For whoever
builds next: a new control is styled by picking names, not by copying a
neighbour, which is how the 33 sizes came about.

**Alternatives.** Do only findings 3, 4 and 5 as spot fixes. Cheaper now,
and the drift returns. I would do this, in three pull requests: names and
colours; the older components; sizes and corners.

**Cost.** Medium. About 1,900 lines of stylesheet are touched but few are
hard. **Risk.** The browser tests measure sizes on a phone; a change of
base size will move some of their numbers. Every screen needs a fresh set
of these pictures to compare, which is now one push away.

### D. The pages a link opens

**Now.** A shared song is a small card in a black screen: a title, a line
of facts, the song order, a Listen button, two buttons of equal weight.
`desktop/page-share.png`. A person's page is a name and a list of dark
rows. `desktop/page-user-songs.png`. These are the first thing a stranger
ever sees of Discobot, and they show nothing of it.

**Proposal.** Make the page a small, read-only piece of the rack: the song
drawn as its scenes in order, each a strip showing its drum hits and notes
as lit steps, with a light that moves through them as it plays.

```
┌──────────────────────────────────────────────────────────────┐
│  FRIDAY NIGHT                              a song by Ian     │
│  120 BPM   3 bars   0:06                                     │
│                                                              │
│  ( ▶ )  ━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━  0:02 / 0:06       │
│                                                              │
│  SCENE 1 ×2                    SCENE 2 ×1                    │
│  ■ · ■ · ■ · ■ · ■ · ■ · ■ ·   ■ · · · ■ · · · ■ · · · ■ ·   │ synth 1
│  ■ · · · · · · · ■ · · · · ·   · · · · · · · · · · · · · ·   │ synth 2
│  ● · · · ● · · · ● · · · ● ·   ● · · · ● · · · ● · · · ● ·   │ drums
│                                                              │
│  [ Open a copy to edit ]        Go to my projects            │
└──────────────────────────────────────────────────────────────┘
```

One main action (Open a copy to edit) and one quiet link. The player is
the rack's own (finding 10). On a person's page each song gets a play
button in its row and the same small strip as a picture of it.

**For the person using it.** A stranger sees what the thing is and that
they can change it. A publisher has something worth sending.

**Alternatives.** (1) Only restyle: own player, one main button, bigger
card. Small, and worth doing regardless. (2) The strip without the moving
light: cheaper, most of the effect. I would do alternative 1 now and the
strip next.

**Cost.** Small for the restyle; medium for the strip (the page already
has the project in hand and already cuts it into bars to play it). Overlaps
features 9's open items ("a picture for a person or a song", "playing a
song from the list without opening its page").

**Risk.** Drawing untrusted projects: it must go through the same checks
the page already uses, and a very long song needs the strip to scroll.

### E. Kids mode: small changes only

Kids mode is the most coherent screen in the app and should not be
redesigned. Besides finding 1:

- The six sound buttons and the two screen buttons are told apart only by
  round against square. Putting the screen buttons at one end and the
  sounds in a group of their own with a faint shared background would make
  "where am I" and "what does it sound like" two clear things.
  `desktop/kids-pads.png`.
- In the beat grid an empty hole is nearly the page's colour (finding 5).
- The dots that show the loop are 10 pixels and dark blue on dark blue
  until one lights. Bigger and lighter would let a child see the loop come
  round. `phone/kids-pads.png`.
- "Hold to leave" filling as it is held works well
  (`desktop/kids-leave-holding.png`).

Cost: small. Risk: the kids browser test pins sizes and positions.

## 4. Features and changes

The owner said on 2026-10-11 that the review may suggest features and
changes to what the app does. These come from looking at the screens and
asking what a person would reach for and not find.

1. **Done.** Three beats ("House Beat", "Slow Groove", "Electro") in a strip
   above the song unit, which stays until Hide is pressed so that each can
   be tried; not checked by ear.
   **A way to start that is not an empty rack.** A new project is 48 dark
   squares and eight empty drum rows (`desktop/rack-empty.png`), and the
   only instruction is one grey line inside the open lane. Offer, on an
   empty project, three or four starting points ("House beat", "Slow
   groove", "Empty") that fill in drums and a bass line to change. For a
   newcomer. Small to medium. Kids mode already does this (`starterKids`).
   Not on the roadmap.

2. **Show that an export is running, and name the exports plainly.**
   Already roadmap features 13; the pictures agree (`desktop/menu-export.png`:
   "Download WAV" beside "Song WAV" does not say which is the scene). I
   would go one further: make Export a small dialog instead of a menu, with
   two choices (what: this scene or the whole song; as: audio, loop, stems,
   MIDI), a line saying how long the file will be, and the progress shown in
   the same place. Small to medium.

3. **Done**, for the synth lanes and the drums; the other units have no lamp. A lamp is lit for
   the length of each step its unit sounds, so a run of notes is a steady light. A guest's
   sound cannot be seen from outside its page, so guests have none.
   **Lamps on the phone's bar that mean something.** Each unit's lamp is
   lit only for the unit on show (`phone/phone-unit-drums.png`). Let a lamp
   flash on that unit's notes while playing, and show a muted unit dimmed
   with a line through its name. A phone user then sees the whole song's
   activity without leaving the unit they are on. Small. Not on the
   roadmap. The step lights' rule in `AGENTS.md` (no rendering per step)
   applies.

4. **Done for mute**, by holding a lane's switch or the drums' for half a second (Shift+M on a
   keyboard); the hint is in the top bar's sheet and in Help. Solo is not on the bar.
   **Mute and solo for every lane in one place on a phone.** Related: on a
   phone, muting the drums while editing a lane means two taps away and two
   back. A long press on a unit's switch on the bar could mute it. For a
   phone user arranging. Small. Needs a hint, since a long press cannot be
   discovered.

5. **Copy a lane's pattern, or one drum row, to another scene.** The song
   area makes scenes easy to add (`desktop/unit-song.png`), but a scene can
   only be copied whole. Overlaps roadmap features 4 ("copy and paste
   between scenes"); from the design side I would put it as a "Copy to…"
   item on each lane, listing the scenes.

6. **A visible save state.** **Done in #125.** On a phone the word is in the Projects dialog, not on the bar. It also says "Not saved" when the browser refuses a write. The Projects list says "saves as you work"
   (`desktop/dialog-projects-one.png`), but the rack itself never says
   anything was saved, and a signed-in person cannot see from the rack
   whether the project is in their account or only in this browser. A
   small word beside the project's name ("Saved", "Saved · in your
   account", "This browser only", and "Not saving" when another tab has
   it) would answer the question people have before closing a tab. Small.
   Not on the roadmap.

7. **Done.** Six colours and none, chosen beside Rename; a new scene takes
   the first colour not in use. **Scene colours.** Scenes are told apart only by name. A colour for each
   scene, shown on its chip, on its blocks in the song, and on the share
   page's strips (redesign D), makes a song's shape readable at a glance:
   A A B A. For anyone using song mode. Small to medium; it is a stored
   value, so it follows the `add-project-field` skill. Not on the roadmap.

8. **A metronome and a count-in.** Already roadmap features 3. From the
   interface side: its switch belongs beside Tap on the transport, and on a
   phone inside the tempo sheet proposed in redesign A.

9. **Full names for the drums, and a picture for each pattern tool.** A
   change to what is shown, not to what is done (finding 14), but worth
   listing here because it changes the drum unit's width: a 64-pixel name
   column with "Kick", "Snare", "Clap", "Cl Hat", "Op Hat", "Lo Tom",
   "Hi Tom", "Cymbal". Small.

10. **Keyboard shortcuts shown where they are used.** **Done in #125.** Space had no shortcut; it now plays and stops, and the Play All hint and Help say so. Space for Play is not
    offered (letters play notes, so shortcuts need a modifier or a
    non-letter key; `AGENTS.md` says so). Space is not a letter. If Play is
    not already on Space, it should be, and the Play button's hint should
    say so. A search of `useStudio.tsx` and `useComputerKeyboard.ts` found
    no Space shortcut and the Help text (`desktop/dialog-help.png`) lists
    none, but I did not search every file, so treat "there is none" as
    likely, not certain. Small.

11. **Help as a page with a list of parts, not one long scroll.** **Built: the list of headings, the search box, and a "?" on each unit's name plate that opens Help at that unit's section. Not yet seen on a screen.** The Help
    dialog is about seven screens of solid text on a phone
    (`desktop/dialog-help.png`). Give it a list of headings at the top (or
    at the side on a desktop) and a search box, and make each rack unit's
    name plate offer "Help for this unit" so help opens at the right place.
    Small to medium.

## 5. What was not looked at or could not be judged

- **Sound, feel and motion.** These are still pictures. Nothing was heard.
  No control was dragged, so how a knob, the piano roll or the keyboard
  feels under a hand, how fast things answer, and every animation and
  transition are unjudged. The step lights were seen lit in one frame only.
- **A real phone or tablet.** The phone pictures are from a desktop browser
  pretending to be a Pixel 7. Safe areas, the on-screen keyboard covering a
  field, an iPhone zooming into a small text box, and real finger accuracy
  were not seen.
- **A screen reader.** Not tried. Labels were read in the code and look
  careful, but that is not the same thing.
- **Other browsers.** Chromium only. Firefox and Safari draw sliders, tick
  boxes, menus and the audio player differently.
- **Lettering as the owner sees it.** The dialogs use the computer's own
  typeface; the test machine has Arial-like type, so the dialogs will look
  different on a Mac, a Windows machine and a phone.
- **Screens not captured:** the browser's own menus (every drop-down list
  opened, such as Model, Preset, Kit, Bars); the browser's own "are you
  sure" pop-ups; MIDI import's dialog; Version History with several
  versions; the Projects list with "Shared with you" and a shared project's
  sharing panel; the banners for "changed in another tab", sync keeping two
  versions, and a guest recording during export; a guest that asks
  permission or fails to load; a lane with a synth model's own knobs;
  a pattern of several bars with its bar buttons and Follow; a 32-step
  lane; a drum lane with an imported sample; the Amp and Arp tabs; song
  mode while playing; MIDI with a controller connected; the account's
  Forgot Password and Change Password forms; a tablet width between the
  phone and the desktop (721 to 1059 pixels wide, where the rack has a
  fixed minimum width of 1,060 and scrolls sideways: worth a look of its
  own); a desktop wider than 1,400.
- **Pictures taken but not examined.** All 57 desktop pictures were looked
  at except three: `rack-empty`, `banner-message`, `transport-signed-in`
  (the phone versions of the last two were). Of the 63 phone pictures, 40
  were looked at; the 23 not examined are the phone versions of screens
  examined at desktop width or in a neighbouring phone picture:
  `rack-empty`, `rack-full`, `rack-playing`, `phone-unit-synth`,
  `phone-synth-tab-sends`, `phone-unit-effects-2`, `phone-unit-all`,
  `menu-export`, `dialog-help`, `dialog-projects`, `dialog-projects-one`,
  `dialog-versions`, `dialog-share-signed-out`, `dialog-add-guest`,
  `dialog-add-guest-error`, `dialog-preset-import`,
  `dialog-account-signed-out`, `dialog-account-create-error`, `page-share`,
  `page-share-long-link`, `page-share-error`, `page-user-songs-empty`,
  `kids-pads-playing`, `kids-leave-holding`. Phone-only faults in those
  screens could have been missed.
- **Contrast** was worked out from the colour values in the stylesheets,
  not measured on a screen; values over a gradient or see-through are
  approximate.

## 6. The screenshots

**How to take them again.** Push a branch whose name contains
`design-review` and open a pull request. The check on GitHub ("Static app
CI") then also runs `ui/test/browser/design-shots.spec.ts`, which is
skipped on every other branch. When the check finishes, the pictures are in
its two artifacts, kept for a week: `test-results-chromium` (desktop,
1280 by 720) and `test-results-mobile-chromium` (phone, a Pixel 7, 412 by
839, at 2.6 times detail). Download with
`gh run download <run> -n test-results-chromium -D <folder>`. Each test's
folder also holds `skipped.txt`, which lists any screen that could not be
reached; this time nothing was skipped. The browser tests must not be run
on the owner's laptop.

**Both widths** (in `desktop/` and in `phone/`):

| Name | What it shows |
|---|---|
| `rack-empty` | A new project, nothing in it |
| `rack-full` | The whole rack top to bottom, with music in it |
| `rack-playing` | The top of the rack while playing, a step light lit |
| `automation-empty` | The open lane's Automation row before a parameter is chosen |
| `automation-sweep` | The lane's steps with a cutoff sweep drawn under them, step 6 focused, and the Cutoff knob's mark (the whole lane is `automation-lane`, desktop only) |
| `automation-auto-on` | The Automation row with Auto on and the Erase button focused |
| `focus-button`, `focus-step`, `focus-knob` | The keyboard focus ring on a button or field, a step and a knob |
| `states-step-row`, `states-step-row-2` | One row of steps with the states beside each other: a mute that is on, a step selected, a step focused and (desktop) a step under the pointer; in `-2` the selected step is the focused one |
| `focus-step-empty`, `states-drum-grid` | The focus ring on an empty step two along from an empty selected one, and on a drum step beside a picked one |
| `focus-unit-help` | A lane's name plate with the keyboard focus on its "?", the button that opens Help at that unit's section |
| `states-song` | The song unit with the open scene lit and focus on the other scene |
| `unit-song-playlist` | The song unit with the song shown as a playlist: a row for each entry, focus on a move button |
| `focus-menu-row`, `focus-dialog-field` | The focus ring on a row of the Project menu and on a field in a dialog |
| `state-disabled-step-tools` | The step controls with an empty step selected: three of them disabled |
| `state-tempo-edit` | The tempo being typed |
| `banner-message` | The message bar, after a file that is not audio was given to Import Kit |
| `menu-project`, `menu-export` | The two menus open |
| `dialog-help` | Help |
| `dialog-help-search`, `dialog-help-search-nothing` | Help with a search that leaves two sections, and one that matches nothing |
| `walkthrough-step-1`, `-4`, `-9` | The walkthrough at its first, fourth and last stop |
| `dialog-midi-samples` | MIDI and samples, with no MIDI available |
| `dialog-midi-devices`, `dialog-midi-pads` | MIDI and samples with two controllers connected: each device sent somewhere of its own, and the pads' notes with one drum waiting for a pad |
| `dialog-projects-one` | Projects, with one project |
| `dialog-projects-family` | Projects, with two that share a name in one row |
| `dialog-projects` | Projects, with that row being renamed |
| `dialog-versions` | Version history, one version |
| `dialog-share-signed-out` | Share, signed out |
| `dialog-preset-import` | The report after importing another synth's preset |
| `dialog-kit-import` | Import Kit, three files matched to lanes |
| `dialog-add-guest`, `dialog-add-guest-error` | Add a guest instrument, empty and with a refused address |
| `unit-guest` | A guest instrument in the rack |
| `dialog-account-signed-out` | Sign in |
| `dialog-account-create-error` | Create Account with a refused password |
| `dialog-account-recovery-code` | The recovery code |
| `dialog-account-signed-in` | The account, signed in as the owner, with an invite code |
| `transport-signed-in` | The top of the rack, signed in; on a phone, the top bar's sheet, signed in |
| `phone-more-sheet`, `phone-more-sheet-menu` | Phone only: the sheet the top bar's last button raises, and the Project menu opened from it |
| `phone-unit-bar-muted`, `phone-unit-bar-playing` | Phone only: the bar of units with Synth 2 muted from it, still and while playing with lamps lit |
| `phone-landscape-more-sheet` | Phone only: that sheet on a phone on its side |
| `dialog-projects-signed-in` | Projects, signed in |
| `dialog-share-signed-in`, `dialog-share-published` | Share before and after publishing |
| `page-share`, `page-share-playing` | A published song's page, before and after Listen |
| `page-share-long-link` | The page for a link that carries the song |
| `page-share-error` | A short link that leads nowhere |
| `page-user-songs`, `page-user-songs-empty` | A person's songs, and a name with none |
| `kids-pads`, `kids-pads-playing`, `kids-beat` | Kids mode: pads, pads while playing, the beat grid |
| `kids-leave-holding` | "Hold to leave" part-way through the hold |

**Desktop only:**

| Name | What it shows |
|---|---|
| `unit-transport`, `unit-song`, `unit-drums`, `unit-mixer`, `unit-effects` | Each unit close up |
| `unit-synth-piano-roll` | An open lane with the piano roll |
| `unit-keyboard` | The on-screen keyboard |
| `step-tools-selected` | The step controls with a step that holds a note |
| `lane-editor-notes`, `lane-editor-sound` | The open lane's editor on each of its two levels: Notes with the keyboard, and Sound with the model, the presets and the first page |
| `synth-tab-osc`, `-filter`, `-lfo`, `-sends` | Four pages of the sound editor, under Sound |
| `synth-engine-sample` | The Osc page with the sample engine playing the built-in piano, Loop on |
| `unit-drums-more-sends` | The drums with More and Sends open |
| `unit-drums-own-sends` | The Sends row close up: the selected drum's own Delay and Reverb, its share of the reverb at nothing, then the kit's sends |
| `unit-effects-hall` | The effects' boxes close up with the reverb's Kind menu set to Hall |
| `hover-button`, `hover-step` | A button and a step under the pointer |
| `time-6-8`, `time-7-8` | The whole rack with the open scene in 6/8 (twelve steps, beats of six) and in 7/8 (fourteen, counted two, two, three); at phone width the rows break where a beat ends |

**Phone only:**

| Name | What it shows |
|---|---|
| `phone-unit-song`, `phone-unit-drums`, `phone-unit-drums-2`, `phone-unit-effects`, `phone-unit-effects-2` | One unit at a time; `-2` is the same unit scrolled down |
| `phone-unit-drums-sends` | The drums' Sends row: the selected drum's own Delay and Reverb above the kit's sends |
| `phone-unit-effects-hall` | The reverb's box at the top of the effects, its Kind menu set to Hall |
| `phone-unit-mixer`, `phone-unit-mixer-2` | The mixer by itself, from its first strip and slid to its last |
| `phone-unit-synth`, `phone-unit-synth-2`, `phone-unit-synth-3` | Lane 1 at the top and scrolled; lane 3, empty |
| `phone-piano-roll`, `phone-keyboard` | The piano roll and the keyboard |
| `phone-lane-editor-notes`, `phone-lane-editor-sound` | The open lane's editor on each of its two levels, from its top |
| `phone-synth-tab-osc`, `-filter`, `-sends` | Three pages of the sound editor, under Sound |
| `phone-synth-engine-sample` | The sample engine's box on the Osc page, Loop on |
| `phone-knob-sheet` | The large slider a tapped knob opens |
| `phone-unit-all` | "All": the whole rack on one page |
| `phone-landscape-synth`, `phone-landscape-keyboard`, `phone-landscape-drums` | A phone on its side, 740 by 360 |
| `kids-pads-landscape`, `kids-beat-landscape` | Kids mode on a phone on its side |
