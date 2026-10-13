# More synth models: the plan

Written 2026-10-11. The owner asked for more synth models "in the manner of"
well-known instruments, was given fourteen candidates, and asked for a plan to
add all of them. This is roadmap sound item 7. Nothing here is built yet.

## What a model is

A model is this synth's own voice, set up and limited to behave like the
instrument it is named for. It is not that instrument's circuit, and it does not
use that instrument's samples. Five exist: Minimoog Model D, Juno-106, DX7,
TB-303 and Prophet-5.

In the code a model is four things (`ui/src/synthModels.ts`):

- an id, added to `SynthModelId` in `engine/src/types.ts`;
- a name and a one-line subtitle;
- four macros, which are the four knobs a lane shows for that model;
- a voicing: how the four macros become engine parameters
  (`mapSynthModelToEngineParams`, through `mapModel` or, for FM, `mapFmModel`).

A project stores the model's id and its four macro values. An id this version
does not know is read as the generic model (`normalizeSynthModelId`), which is
what an older copy of the app will do with a project that uses a new model:
the lane opens and plays with the generic controls. Check that this is still
true before the first new model ships, and say so in the pull request.

## Progress

- 2026-10-12: **SH-101 and Pro-One are built**, with the model menu grouped
  Mono, Poly and Digital. Not verified by ear. What was found on the way:
  - The voice has pulse width and an LFO can move it, so the SH-101's pulse
    is as planned. Its pulse is the voice's first oscillator (the only one
    with a width) and its saw the second, at the same pitch, balanced by the
    first oscillator's new level.
  - One envelope for filter and level is done by giving both the same
    values; the envelope's own times are fixed and not on a macro.
  - The sub is one octave down only. The real one can also sit two down.
  - Unison stops at five copies. The JP-8000 wants seven: raise the limit
    with that model.
  - A model's filter slope: these two set 24 dB. The five older models
    still leave the slope alone, as the roadmap notes for the Minimoog and
    TB-303.
  - A project using one of these opens with the plain engine in a copy of
    the app that does not know it; a test checks the rule.

- 2026-10-12: **Jupiter-8 and OB-Xa are built.** Not verified by ear.
  - The Jupiter-8's separate high-pass filter is left out: the voice has
    one filter. Its low-pass is set to 24 dB.
  - The OB-Xa is set to its 12 dB filter. Its first macro spreads the two
    saws apart; it does not use unison, which the sources read for this
    did not confirm for the instrument, and it does not touch the lane's
    stereo spread, which belongs to the lane and not to a model. Its fourth
    macro is the attack alone, as planned, not the contour the older
    models share.
  - The Jupiter-8 shares the older models' contour macro, where a longer
    release comes with a faster attack. If that reads wrong by ear, it is
    the thing to change for all of them at once.

- 2026-10-12: **JP-8000 and Mono/Poly are built.** Not verified by ear.
  - The owner said to raise the unison limit, so it is seven copies now.
  - The supersaw's Mix needed something the voice did not have: a level
    for the copies either side of the middle one (`unison.mix`). It is in
    the sound editor's unison box as Mix.
  - Detune on the JP-8000 is not even along the knob: small amounts for
    most of its travel, then it opens out, as descriptions of the
    instrument say. The exact curve was not found; this one is a square.
  - The Mono/Poly is its unison mode only: four copies on one note. Its
    four-note mode, one oscillator a note, is not modelled.
  - A lane that moves to another model now has unison and filter slope put
    back (`enterSynthModel`), which the slope note above asked for.

- 2026-10-12: **Polysix is built, which finishes group A.** Not verified
  by ear. Its Ensemble macro is the lane's chorus send, as the owner agreed
  for this model; the send goes back to zero when the lane leaves the
  Polysix. The real instrument's ensemble, chorus and phase are three
  settings of one effect; here there is the one shared chorus. Its sub is
  one octave down only.
- **Next is the listening session with the owner on all seven**, before
  any of group B. Things to listen for are noted in each entry above and
  in the pull requests (#139, #140, #141 and the Polysix's).

- 2026-10-12: **The owner listened** to the seven models of group A and the
  presets: "things generally sound good to me". Nothing was asked to be
  changed.
- 2026-10-12: **The ladder filter is built** (roadmap sound 5), the first
  of the engine work group B waits on. The Minimoog and TB-303 take it. The
  MS-20 still needs its own filter: a high-pass and a low-pass in a row
  with a resonance that distorts, and a second cutoff for the voice.

- 2026-10-12: **The MS-20 is built**, with the two things it needed from
  the voice: a high-pass before the filter, and a two-pole filter whose
  resonance distorts as it is pushed. Not verified by ear.
  - Sources disagree on whether the instrument's high-pass is 6 or 12 dB an
    octave. This one is 12.
  - Its second oscillator's ring modulation is not modelled, and nor is
    the patch panel. One envelope opens the low-pass; the high-pass does
    not move with it.
  - The distortion is in the filter's resonance only. Pushed hard with a
    plain sine it measures about 36 dB under the note, so it is a growl
    more than a scream; `MS20_HOLD` is the one number to raise if the
    owner wants more.

- 2026-10-12: **The modulation matrix is built** (roadmap sound 4), the
  engine work the Odyssey, Virus and CS-80 wait on. Four routes a sound.
  The Odyssey still needs oscillator sync and ring modulation in the
  voice; the CS-80 needs two layers a note; the Virus a waveshaper or a
  second filter for its harder sounds.

- 2026-10-12: **The Odyssey is built**, with oscillator sync and ring
  modulation added to the voice for it. Not verified by ear.
  - The instrument's ring modulator is an exclusive-or of the two
    oscillators' pulse waves. This one multiplies the two oscillators,
    which is the same thing for pulses and gentler for other waves.
  - It is mono. The instrument's two-note mode, one oscillator a note, is
    not modelled, nor its static high-pass (the voice has one now; the
    model does not set it).
  - S&H is the random source to the filter, stepped six times a second by
    the first LFO, which the model keeps for that and sends nowhere.
  - A synced oscillator tuned very high aliases: the restart is not
    band-limited.

- 2026-10-12: **The M1, the D-50 and the Wavestation are built**, which is
  all of group C and the end of this plan. Not verified by ear.
  - Their sounds are from VSCO 2 Community Edition and Adventure Kid
    Waveforms, both CC0, chosen by the owner (`docs/BUNDLED_AUDIO.md`). None
    is a recording of the instrument the model is named for.
  - M1: four sounds on the first knob (piano, marimba, organ, voice), then
    brightness, attack and release. The piano is five recorded notes, each
    two seconds or less with no loop, so a held piano note dies away sooner
    than a real one.
  - D-50: a recorded attack (flute, harp, mallet or bell) over a saw. Its
    chorus is a second layer, tuned and placed apart, not an effect, because
    only the Polysix was agreed to set an effect send.
  - Wavestation: four sequences of eight single cycles, with speed and
    crossfade. The instrument's sequences had a length and a level for
    every step and followed the tempo; these go round at one speed.
  - Which waves went into each sequence was chosen by their folder and
    number, without hearing them.
  - A single cycle played high aliases, as a recording does.

- 2026-10-12: **The sample oscillator is built**, as a third engine. It
  plays what a person imports. Group C still waits, on waveforms the
  project may ship and the owner's choice of where they come from.

- 2026-10-12: **The CS-80 is built**, and with it a second layer for the
  voice. Not verified by ear.
  - A layered sound plays every note on two voices. The second is the
    first again with five differences: its share of the level, its tuning,
    its filter (in octaves against the first's), a slower attack, and its
    place from side to side. It is a stored field (`layer`) that any sound
    can use, on the Osc tab.
  - The instrument's two layers were two whole synths, each with its own
    waves, filters and envelopes. Here the layers share all of those.
  - Each layer is a saw alone. The instrument could add a pulse to it; this
    voice's pulse and saw at one pitch cancel each other (the two together
    measured 5 to 9 dB under either alone), so the pulse is left out.
  - A layered lane plays four notes at once, not eight. The instrument had
    eight. Raising the voice count is a cost in processing and was not done.
  - Its ribbon, its poly aftertouch and its ring modulator are not modelled.

- 2026-10-12: **The Virus is built.** It needed nothing more from the
  voice: the routes carry its movement and the filter's drive is its
  saturation. Not verified by ear.
  - The instrument has three oscillators, two filters with a saturation
    stage between them and three LFOs. This has two oscillators and a sub,
    one driven filter and two LFOs.
  - The plan's first macro is Morph. The sources read for this did not
    confirm a wave-morph control on the instrument's ordinary oscillators;
    it is built as a saw turning into a pulse.
  - Mod Depth scales four routes at once and uses all four of a sound's
    places, so a Virus lane has none left for routes of the person's own.

## The fourteen, in three groups

The grouping is by what each needs from the voice, because that decides when
it can be built.

### Group A: the voice as it is

No engine work. Each is a definition, a voicing and presets.

| Model | What it is | Voicing | Macros |
|---|---|---|---|
| Roland SH-101 | Mono bass and lead | One oscillator, saw and pulse mixed, sub an octave or two down, noise, 24 dB filter, one envelope shared by filter and level | Wave mix, Sub, Cutoff, Env |
| Sequential Pro-One | Aggressive mono | Two oscillators, saw and pulse, a little detune, 24 dB filter with a fast envelope, mono with glide | Detune, Reso, Cutoff, Env |
| Roland Jupiter-8 | Big, clean poly | Two oscillators, saw with pulse, slight detune, 12 or 24 dB filter, separate envelopes, eight voices | Detune, Reso, Brightness, Contour |
| Oberheim OB-Xa | Wide, brassy poly | Two saws detuned further apart, 12 dB filter left fairly open, slow-ish attack, unison of two spread wide | Spread, Reso, Brightness, Attack |
| Korg Polysix | Warm poly with ensemble | One oscillator with pulse width movement and a sub, 24 dB filter, chorus send turned up | PWM, Reso, Brightness, Ensemble |
| Korg Mono/Poly | Stacked lead | Four copies in unison, detuned, mono, 24 dB filter | Detune, Reso, Cutoff, Env |
| Roland JP-8000 | Supersaw | Saw with seven copies in unison, detune and mix as the two main controls, 12 dB filter | Detune, Mix, Cutoff, Release |

Things to check in the code before building, each of which may move a model to
group B:

- How many unison copies the core allows. JP-8000 wants seven and Mono/Poly
  four.
- Whether the voice has pulse width and can move it with an LFO (Polysix,
  SH-101).
- The chorus is one shared effect with a send per lane, not something a model
  owns. A Polysix model that turns up the lane's chorus send changes a mix
  setting from a sound setting; decide whether that is acceptable or whether
  Polysix waits for insert effects (sound 6).
- Whether one envelope can drive both filter and level (SH-101), or whether
  two set alike are near enough.

### Group B: needs planned sound work first

| Model | What it is | Waits for | Macros |
|---|---|---|---|
| Korg MS-20 | Screaming mono | A filter of its own character: a high-pass and a low-pass in series whose resonance distorts. This goes with the ladder filter (sound 5), which is where the voice gains a choice of filter models | HP Cutoff, LP Cutoff, Peak, Env |
| ARP Odyssey | Duophonic lead | Oscillator sync and ring modulation in the voice, and the modulation matrix (sound 4) to route sample-and-hold and the second envelope | Sync, Ring, Cutoff, S&H |
| Yamaha CS-80 | Expressive pads | Two complete layers per note, each with its own filter and envelopes, and the modulation matrix for the slow movement it is known for | Layer mix, Detune, Brightness, Swell |
| Access Virus | Modern, heavily modulated | The modulation matrix, and for its harder sounds a waveshaper or a second filter | Morph, Reso, Cutoff, Mod depth |

If the voice turns out to have sync or ring modulation already, the Odyssey can
come earlier in a plainer form.

### Group C: needs the sample oscillator, and samples the project may use

| Model | What it is | Waits for | Macros |
|---|---|---|---|
| Roland D-50 | A sampled attack on a synth sustain | The sample oscillator (sound 3) | Attack level, Tone, Brightness, Chorus |
| Korg M1 | Sampled piano, organ and others through a filter | The sample oscillator | Sound, Brightness, Attack, Release |
| Korg Wavestation | A sequence of waves, crossfading | The sample oscillator, and a small wave sequencer on top of it | Sequence, Speed, Crossfade, Brightness |

**These three cannot use the instruments' own samples.** Those are their
makers' recordings and the project may not redistribute them. `AGENTS.md`
already holds this line for drum machines: nothing is bundled without the
owner's say-so and a checked licence. So each needs waveforms that are either
made for the project (recorded or synthesized by it) or clearly licensed for
redistribution, with the licence recorded beside them. That work, not the
code, is most of the cost of group C, and the result will be "a sound of that
kind", further from its namesake than groups A and B. If no usable waveforms
are found for one of them, it is left out and the roadmap says why.

## How each model is added

The same for every model, one pull request per model or per two or three
closely related ones:

1. Read up on the instrument's real architecture and ranges from its manual or
   service notes before choosing numbers (the rule in `AGENTS.md`: find the
   real definitions; do not guess from names).
2. Add the id, the definition and the voicing. A new engine parameter, if one
   is needed, follows the `add-project-field` skill: optional in the type,
   present in the defaults with a neutral value, clamped in the sanitizer,
   `SCHEMA` bumped.
3. Add three to five presets for it, each with its kind (bass, lead, pad,
   keys, pluck, effects), so they land in the grouped presets menu.
4. Tests: every macro at its ends and middle gives parameters inside the
   sanitizer's limits; each macro moves what its label says; the generic model
   and one unison voice at 12 dB are still bit-identical to before (the
   existing test); a project using the new model opens in a copy of the app
   that does not know it. Extend the browser test that selects every model and
   macro.
5. Say "not verified by ear" in the pull request. A model is not done until
   the owner has listened to it.

With nineteen models the model menu needs grouping as the presets menu does:
mono, poly, digital. Do that with the first group.

## Order

1. **The presets menu grouped by kind, and a kind on every preset.** Needs
   nothing else, and every later step adds presets into it.
2. **Group A**, in this order, simplest first: SH-101; Pro-One; Jupiter-8 and
   OB-Xa together; JP-8000 and Mono/Poly together (both are unison); Polysix
   last, once the chorus question is settled. The model menu is grouped in the
   first of these.
3. **A listening session with the owner** on group A before going further:
   what is learned about ranges and macro choices applies to the rest.
4. **The engine work the roadmap already plans**, which is not part of this
   plan: the audio layer's single owner, the ladder filter and filter models,
   the modulation matrix, the sample oscillator.
5. **Group B** as each thing it waits for lands: MS-20 with the filter models;
   Odyssey, Virus and CS-80 after the modulation matrix, CS-80 last because
   two layers per note is the largest change to the voice.
6. **Group C** after the sample oscillator, and only for the models whose
   waveforms have been found and their licences checked: M1, then D-50, then
   Wavestation, which also needs its wave sequencer.

Group A is about a day a model. Group B is a few days each on top of the
engine work. Group C depends on the waveforms.
