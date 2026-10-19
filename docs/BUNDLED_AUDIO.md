# Audio that ships with the app

One file of audio is part of the app: `ui/public/waves.bin`, about 1.04 MB. It
holds the sounds the sample engine offers under "Built in", which the M1, D-50
and Wavestation models play, the drum machine's four cymbals and the Recorded drum kit. Nothing
else in the app is a recording.

The owner chose on 2026-10-12 to take these from two free libraries, after the
licences below were read at their sources. Both are CC0: their authors gave up
their rights, so the project may redistribute them, changed or not, with or
without credit. Credit is given here anyway.

## Where each sound is from

| Sound in the menu | From | Files |
|---|---|---|
| Piano | VSCO 2 Community Edition, Upright Piano | `Keys/Upright Piano/Player_dyn2_rr1_008`, `_014`, `_020`, `_026`, `_032` (five notes, an octave apart) |
| Marimba, Mallet attack | VSCO 2 Community Edition | `Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01` |
| Harp attack | VSCO 2 Community Edition | `Strings/Harp/KSHarp_C5_mf` |
| Bell attack | VSCO 2 Community Edition | `Percussion/Glock/glock_medium_C6` |
| Flute attack | VSCO 2 Community Edition | `Woodwinds/Flute/stac/LDFlute_stac_C5_v2_rr1` |
| Organ | Adventure Kid Waveforms | `AKWF_eorgan_0001` |
| Voice | Adventure Kid Waveforms | `AKWF_hvoice_0001` |
| Sequence: voices | Adventure Kid Waveforms | `AKWF_hvoice_` 0001, 0014, 0027, 0040, 0053, 0066, 0079, 0092 |
| Sequence: overtones | Adventure Kid Waveforms | `AKWF_overtone_` 0001, 0006, 0011, 0016, 0021, 0026, 0031, 0036 |
| Sequence: FM | Adventure Kid Waveforms | `AKWF_fmsynth_` 0001, 0016, 0031, 0046, 0061, 0076, 0091, 0106 |
| The drums' Crash | VSCO 2 Community Edition | `Percussion/cymbal-crash1_ff_rr1` |
| The drums' Ride | VSCO 2 Community Edition | `Percussion/susCymb1-hitstick_f_rr1` (a suspended cymbal struck with a stick) |
| The drums' Bell | VSCO 2 Community Edition | `Percussion/susCymb1-hit-bell_mf` |
| The drums' Splash | VSCO 2 Community Edition | `Percussion/cymbal-crashshort_v1` |
| Sequence: harmonics | Adventure Kid Waveforms | `AKWF_sinharm_` 0001, 0003, 0005, 0007, 0009, 0011, 0013, 0015 |

`scripts/build-waves.mjs` holds the full address of every file and is what
turns them into `waves.bin`.

### The Recorded drum kit (added 2026-10-19)

The owner asked on 2026-10-19 for more bundled open-source sounds, drums
especially. These seven are from the Versilian Community Sample Library
(VCSL), folders `Membranophones/Struck Membranophones/` (M) and
`Idiophones/Struck Idiophones/` (I). Each is one hit, from the `ui/public/waves.bin`
ids `kit-<drum>`, played by the Recorded kit. The Cymbal lane in that kit
plays the cymbal recordings above.

| Lane | VCSL file |
|---|---|
| Kick | M `Bass Drum 1/BDrumNew_hit_v5_rr1_Sum` |
| Snare | M `Snare Drum, Modern 1/Snare2_HitSN_v6_rr1_Mid` (snares on) |
| Clap | I `Claps/Clap_rr1` |
| Closed Hat | I `Hi-Hat Cymbal/HiHat_HitC_v3_rr1_Mid` |
| Open Hat | I `Hi-Hat Cymbal/HiHat_HitO_rr1_Mid` |
| Low Tom | M `Tom 2/Stick/TomL_HitS_v3_rr1_Mid` |
| High Tom | M `Tom 1/Stick/TomH_HitS_v3_rr1_Mid` |

They are kept at 22,050 Hz, except the two hats, which are at 32,000 Hz, and
cut to between a quarter of a second and a second. Together they added
212,892 bytes (about 208 KB) to `waves.bin`, which is now 1,091,846 bytes.

## The licences

**Versilian Community Sample Library (VCSL)**, Versilian Studios LLC.
<https://github.com/sgossner/VCSL>. Read on 2026-10-19: the repository's
`LICENSE` is CC0 1.0 Universal, and its README says "This collection is under
a Creative Commons 0 license. Essentially it's Public Domain- you can do
whatever you want with these sounds (even make commercial software), no
royalties, no credit, no special terms." The folders the drum recordings come
from hold only audio files; they have no notes of their own and no other terms.

**VSCO 2 Community Edition**, Versilian Studios LLC.
<https://github.com/sgossner/VSCO-2-CE>. The repository's licence is CC0 1.0
Universal. The upright piano's own note reads: "Upright Piano sampled by Simon
Dalzell of Ivy Audio, Winter 2015-16. Bearer is granted right to redistribute
this sample set by Versilian Studios LLC. Credit to both original author and
Versilian Studios is encouraged."

**Adventure Kid Waveforms (AKWF)**, Kristoffer Ekstrand.
<https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE> and
<https://www.adventurekid.se/akrt/waveforms/adventure-kid-waveforms/>. The
repository's licence is CC0 1.0 Universal, and the author's page reads: "To
the extent possible under law, Kristoffer Ekstrand has waived all copyright
and related or neighboring rights to AKWF Waveforms." Some other sites describe
the set as needing attribution; the author's own statement is the one relied
on.

Both were read on 2026-10-12.

## What was done to them

- Mixed to one channel, cut short (the piano's lowest note is two seconds, an
  attack a fifth of a second), faded out over the last fifth, brought to one
  level, resampled to 22,050 Hz and stored as 16-bit.
- The cymbals are kept at 32,000 Hz, because most of a cymbal lies above
  what the lower rate can hold, and are cut to between one and two and a
  half seconds. They are half the file.
- The single cycles are stored as they are, 600 samples each, with any
  constant offset taken out.
- Each recording's root note is where it was measured to sound, not what its
  file is called. The marimba, glockenspiel and flute files are each named an
  octave below where they sound.

## What was not used, and why

- Only waves from AKWF's folders of synthesized and instrument shapes. Its
  folders taken from particular machines (`c604`, `vgame`) were left alone.
- The University of Iowa's instrument samples say they may be used "without
  restrictions" but name no licence.
- The Salamander Grand Piano is CC BY, which would need a credit wherever the
  app is shipped.
- No recording from a Korg M1, a Roland D-50 or a Korg Wavestation. The three
  models are named for how those instruments worked, and play none of their
  sounds.

## Adding to it

A new sound needs a licence that clearly allows redistribution, read at its
source and recorded here, and the owner's say-so (`AGENTS.md`). Then add it to
`SOURCES` in the script and to `BUILT_IN_WAVES` in
`ui/src/services/builtInWaves.ts`, run the script, and check the pitch it
prints against the note expected. The file is downloaded by everyone on their
first visit, so keep it small.
