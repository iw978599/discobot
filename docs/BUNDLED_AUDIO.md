# Audio that ships with the app

One file of audio is part of the app: `ui/public/waves.bin`, about 1.18 MB. It
holds the sounds the sample engine offers under "Built in", which the M1, D-50
and Wavestation models play, the drum machine's four cymbals, the Recorded drum kit and the extra percussion. Nothing
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

### Other percussion on a drum lane (added 2026-10-19)

Six more VCSL hits (same folders and licence as the kit), ids `perc-<name>` in
`waves.bin`, chosen from the Voice menu of the lane that has them, in any kit.
Kept at 22,050 Hz and cut to between a quarter and half a second. Together they
added 113,652 bytes (about 111 KB): `waves.bin` is now 1,205,498 bytes.

| Choice (lane) | VCSL file |
|---|---|
| Tambourine (Clap) | I `Tambourine 1/Tamb1_Hit_v2_rr1_Mid` |
| Shaker (Clap) | I `Shaker, Small/Mid_ShakerDouble_Down_rr1` |
| Cowbell (Clap) | I `Cowbells/Cowbell1_Normal_v3_rr1_Mid` |
| Cross-stick (Snare) | M `Snare Drum, Modern 1/Snare2_stick_v1_rr1_Mid` |
| Conga (Low Tom) | M `Conga/Conga_HitN_v2_rr1_Sum` |
| Bongo (High Tom) | M `Bongos/BongoH_Hit1_v2_rr1_Mid` |

### Instruments fetched on demand (added 2026-10-19)

The owner asked on 2026-10-19 for these seven VCSL instruments as built-in
sounds for the sample engine. Together they are too big for `waves.bin`, so
each is a file of its own, `ui/public/sounds/<id>.bin`, in the same format,
fetched the first time a lane, an export or the share page needs it and kept in
memory (`loadBuiltInWave`). They are left out of the service worker's list of
files cached at install; once fetched, the worker keeps them for offline use.
Each is mono, 22,050 Hz, 16-bit, a recording every octave (C), cut shorter the
higher it is and faded at the end. Each recording's pitch was checked by the
build script against its note (all within 10 cents except the top C of three,
where the script's check is too coarse to tell).

| Menu name | File | Size | From VCSL (folder / file) | Recordings |
|---|---|---|---|---|
| Grand Piano (Kawai) | `sounds/kawai-piano.bin` | 503,176 bytes | `Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C<1..7>_v3_rr1_Player` | C1 to C7 |
| Grand Piano (Steinway B) | `sounds/steinway-piano.bin` | 503,180 bytes | `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_C<1..7>_vl3_rr1` | C1 to C7 |
| Pipe Organ | `sounds/pipe-organ.bin` | 459,022 bytes | `Aerophones/Edge-blown Aerophones/Pipe Organ/Loud/Rode_Man3Open_C<1..6>` | C1 to C6 |
| Tenor Sax | `sounds/tenor-sax.bin` | 282,510 bytes | `Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/BrettTenor_NV_Main_C<2..5>_vl3_rr1` | C2 to C5 |
| FM Piano | `sounds/fm-piano.bin` | 392,926 bytes | `Electrophones/TX81Z/FM Piano/FMPiano_C<1..7>_vl2` | C1 to C7 |
| FM Piano 1 | `sounds/fm-piano-1.bin` | 392,928 bytes | `Electrophones/TX81Z/Piano 1/Piano 1_C<1..7>_vl2` | C1 to C7 |
| FM Clavisynth | `sounds/fm-clavisynth.bin` | 277,288 bytes | `Electrophones/TX81Z/Clavisynth/Clavisynth_C<1..6>_vl2` | C1 to C6 |

In all, 2,811,030 bytes (about 2.7 MB), none of it downloaded until used.
`waves.bin` is unchanged.

Notes read in the folders on 2026-10-19:

- Pipe Organ, `Info.txt`: "Organ sampled by Simon Dalzell of Ivy Audio,
  Winter 2015-16. Bearer is granted right to redistribute this sample set by
  Versilian Studios LLC. Credit to both original author and Versilian Studios
  is encouraged." This is the same note the upright piano already carries
  (above). Credit: Simon Dalzell of Ivy Audio, and Versilian Studios.
- Grand Piano, Kawai: `Legacy.txt` reads "LEGACY!" (the folder has been
  superseded in the library; the files are still in it and under the same
  licence). Grand Piano, Steinway B: `NORMALIZED.txt` says the layers are
  normalized, so a velocity curve is needed to get the dynamics back. Neither
  note changes the licence. Here one velocity layer is used, and the sample
  engine's own level and velocity handling apply.
- TX81Z, `Origin.txt`: "These patches are user-created using the TX81Z
  Programmer application and sampled from the original FM hardware using
  Samplit." The patches are the library authors' own, not Yamaha's factory
  voices; the repository licence (CC0) covers the recordings. Clavisynth's
  `A Note.txt` says the instrument is at "8va normal pitch standard", and its
  pitch was measured to be at the note its file name says. The three names in
  the menu do not use any maker's name.
- Tenor Saxophone has no notes file.

Nothing in these folders carried terms other than CC0 and the above note, so
nothing was left out.

### Two more recorded kits and an organ, from Karoryfer (added 2026-10-27)

The owner asked on 2026-10-27 for more open-source drum and synth sounds, and
chose these from a search of what is clearly allowed: Gogodze Phu Vol II,
Swirly Drums and Caveman Cosmonaut, all by Karoryfer Samples and CC0 (below).
Each is a file of its own under `ui/public/sounds/`, in `waves.bin`'s format,
fetched only when it is used: a kit once a project has it chosen
(`KIT_FILES`, `loadCymbals(kitId)`), the organ as the other instruments are.
`waves.bin` is unchanged. Each drum is one hit from a velocity layer near the
top, round robin 1, at 22,050 Hz (the hats at 32,000 Hz), cut to between 0.3
and 1.2 seconds; the clap and the cymbal lanes have no recording in either
kit and play the Recorded kit's clap and the cymbal recordings.

**Recorded: Gogodze** (`sounds/kit-gogodze.bin`, 228,848 bytes), from
<https://github.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii>, folder
`Samples/`. The kit was recorded with seven microphones, and its own player
mixes them with curves that are not in its files, so each drum is the one
microphone nearest it rather than a guess at that mix.

| Lane | File |
|---|---|
| Kick | `kick_mic/ks_vl5_rr1` |
| Snare | `snare_mic/sc_vl5_rr1` |
| Closed Hat | `oh_mic/hc_vl3_rr1` |
| Open Hat | `oh_mic/ho_vl4_rr1` |
| Low Tom | `oh_mic/tl_vl4_rr1` |
| High Tom | `oh_mic/th_vl4_rr1` |

**Recorded: Swirly** (`sounds/kit-swirly.bin`, 228,842 bytes), from
<https://github.com/sfzinstruments/karoryfer.swirly-drums>, folder `Samples/`,
the dry recordings (not `wet/` or `wetter/`). The kick and the snare were each
recorded by two microphones at once, and are the two summed at the levels the
library's `Programs/Basic_kit.sfz` starts with.

| Lane | File |
|---|---|
| Kick | `marching_kick/marching_kick_vl18_rr1_reso` at 1 and `_beater` at 0.7 |
| Snare | `snare_main/snare_hit_vl10_rr1_top` at 0.8 and `_btm` at 1 |
| Closed Hat | `hat_closed/hh_closed_vl10_rr1` |
| Open Hat | `hat_open/hh_open_vl11_rr1` |
| Low Tom | `tom_floor/tom_floor_vl10_rr1` |
| High Tom | `tom_mhi/tom_mhi_vl8_rr1` |

**Caveman Organ** (`sounds/caveman-organ.bin`, 308,972 bytes), from
<https://github.com/sfzinstruments/karoryfer.caveman-cosmonaut>: a 1983 Unitra
B-11 transistor organ with every register drawn, `Samples/all_all_all_c4` to
`_c7`, four recordings an octave apart, 2 to 1.4 seconds each. The files are
named an octave below where they sound, as the library's own mapping says
(c4 is MIDI 48); the build script measured each within 6 cents of its note.
It has a preset, Caveman Organ, among the keys.

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

**Karoryfer Samples** (D. Smolken): Gogodze Phu Vol II, Swirly Drums and
Caveman Cosmonaut, in the `sfzinstruments` organisation on GitHub (links
above). Read on 2026-10-27: each repository's licence file is CC0 1.0
Universal, added by D. Smolken, who runs Karoryfer. The readmes of Gogodze
and Caveman Cosmonaut, written earlier, say "Royalty-free for all commercial
and non-commercial use. Copyright 2018 Karoryfer Lecolds" (and Gogodze's,
"you can do whatever you want with it"); the CC0 file their author added
afterwards is the statement relied on. Swirly Drums' file is named `license`.
Credit: Karoryfer Samples.

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
- Michael Fischer's TR-808 set (1994), which the TidalCycles project carries
  under CC0 (`tidalcycles/sounds-tr808-fischer`), and the kits made from it
  (`Boochi44/free-drum-samples`): Fischer's own readme says only that the
  samples are "ABSOLUTELY FREE" and names no licence, and the CC0 file was
  added by TidalCycles in 2021, not by him. Looked at on 2026-10-27.
- The CR-78, TR-505, LinnDrum and TR-909 sets in `oramics/sampled`: the CR-78
  is labelled public domain, but the page it came from (boxedear.com) states
  no licence, and the others name no source for theirs. SM Drums is listed as
  public domain in the `sfzinstruments` catalogue but its repository has no
  licence file; Retro Drums and Moog Drums there say "free use" or nothing.
  Naked Drums, the DrumGizmo kits and the Salamander kit and piano need a
  credit (CC BY or CC BY-SA). Looked at on 2026-10-27.
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
