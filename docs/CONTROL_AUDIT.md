# Control audit

## Scope and method

Every component in `ui/src/components` was inspected. The audit followed component
callbacks into `App.tsx`, browser-local project storage and the browser audio hooks.
Controls are not considered verified just because a knob or LED moves: browser
tests inspect persisted musical data, exercise playback, and reject page errors,
console errors, failed requests, WebSockets and requests outside `/discobot/`.

## Control inventory

| Component / controls | State and audio path | Corrections / coverage |
| --- | --- | --- |
| `Knob`, `DrumKnob`: rotary drag, typed values | Parent callback → parameter/settings update → local project → audio lane | Pointer capture supports mouse/touch/pen; cancellation, blur and unmount cleanup; keyboard arrows/Page/Home/End; accessible slider/value labels; clamped stepped values; Enter commits once and Escape cancels. |
| `SynthControls`: waveform, detune, filter type/cutoff/resonance | `onParameterChange` → synth parameters → AudioWorklet parameters | Unit-aware cutoff and gain entry; persisted-state checks and all enabled rotary controls exercised. |
| `SynthControls`: both LFO enables, waves, targets, depth/rate and tempo sync | Synth parameters → tempo-aware worklet parameter mapping | Native focusable toggle hit areas; synced `1/16` input parses denominator instead of `116`; browser coverage includes both LFOs. |
| `SynthControls`: ADSR and shape display | Envelope fields → synthesis envelope | Millisecond entry; shape sustain segment uses the same time scale as other segments; keyboard changes and durable state covered. |
| `SynthControls`: pan, spread, portamento/glide | Stereo and glide fields → audio hook/worklet | Center/left/right percentage pan parsing; glide milliseconds; disabled controls remain noninteractive. |
| `SynthControls`: hold, arpeggiator enable/mode/rate/gate | Keyboard latch / App arpeggiator scheduler → note events | Named accessible toggles/selects; keyboard sustain and audio note-on/note-off protocol checks; arpeggiator state persistence. |
| `SynthControls`: models, macros, sound presets | Model mapping / preset recall → parameters and audio | Twelve additional named Bass/Lead/Pad/Pluck sounds; all model macro groups selectable; blank preset save disabled; built-ins cannot be deleted; user save/load/delete/reload tested. |
| `SynthUnit`: mute, solo, remove | Per-synth mix and lane lifecycle | Toggle pressed state exposed; callbacks retained; removal is only offered for removable synths. |
| `Keyboard`: white/black keys | Note callbacks → live note audio; selected-step assignment | Fixed effects that immediately released every newly pressed note; touch/pointer and Space/Enter play/release; cancellation, visibility loss, octave change and unmount release held notes; all notes named. |
| `KeyboardPanel`: editor mode, octave limits | Selected synth keyboard mode/octave → keyboard or piano roll | Named pressed mode buttons; octave boundaries retained; held-note release tested. |
| `PianoRoll`: assign/erase/drag/clear | Shared step data → sequencer schedule | Pointer/touch paint, cancellation/blur cleanup and native keyboard activation; named pressed cells; minimum-width horizontal scrolling instead of crushed mobile cells. |
| `Sequencer`: pattern, length, step selection, velocity, saved patterns | Local project request adapter → pattern steps/history | Removed backend/auth request dependency; local save notifications refresh menus; errors visible; names/pressed step state; mobile horizontal scrolling; saved-pattern dialog Escape/focus trap/restore. |
| `DrumMachine`: kit/defaults, eight instrument selectors and volume/tone/tune/extra/humanize/pan | Drum state → local storage → synthesized drum previews/schedule | Distinct accessible instrument controls; pan parser corrected; preview velocity respected and disabling a hit no longer previews it; each instrument's common settings and mute/solo checked. |
| `DrumMachine`: steps, velocity, fill/shift/reverse/duplicate | Boolean steps + per-step velocities → drum schedule | Explicit mobile-accessible velocity slider; shift/reverse/duplicate carry accents with hits; transformation assertions inspect persisted steps/velocities. |
| `DrumMachine`: master, swing, FX sends/returns, global mix/reset | Drum mix and shared effects → browser audio | Honest “Clear Solos” label replaces misleading “Solo All”; pressed mute state; removed obsolete Discord return description; musical save workflow includes swing, kit, sends and accents. |
| `EffectsPanel`: enable, drive, phaser, delay, reverb | Shared effects state → browser effects buses | Restored master bypass control and exposed phaser feedback; distinct enable labels; delay milliseconds; every effects rotary control and persisted returns tested. |
| `MixerPanel`: synth/drum gain, pan, FX returns, mute/solo | Same synth/drum/effects state as detailed controls → audio lanes | Named faders and pressed mix buttons; durable state and shared-control synchronization tested. |
| `MidiPanel`: device, channel, synth target, live/record/step | Web MIDI parsing → App routing → note/step/CC handlers | Unsupported, permission-denied and no-device states are visible rather than disappearing; device/channel/target labels and pressed modes; simulated channel filtering and step routing tested. |
| `SamplePanel`: import, play, delete | IndexedDB sample records → browser decode/playback | Accessible file/button controls; busy/error states; desktop/mobile import/play/delete/reload tests use generated WAV audio. |

## Automated checks

`npm run test:browser` uses Chromium desktop and emulated Pixel 7 touch viewports.
The server builds a production bundle, serves the actual `/discobot/` base path,
and uses per-port build directories so concurrent builds cannot delete assets
under active tests. Browser profiles and downloads use a project-local runtime
directory. Set `PLAYWRIGHT_PORT` when running alongside another preview server.

`ui/test/browser/controls.spec.ts` covers:

- A musical pattern with notes/velocities, synth sound, drum kit/accent/pan/swing,
  effect settings, save, destructive edits, load, playback/stop and reload.
- Rotary keyboard bounds, unit-aware typed values, cancellation and pointer cleanup.
- Keyboard sustain/hold/octave release and actual worklet note-event delivery.
- Named sound families, vintage-model macros and user preset persistence/deletion.
- Synth/effects/mixer state changes, all drum instrument control families and
  accent-preserving pattern tools.
- Saved-pattern menu refresh, deletion and modal focus trapping/restore.
- IndexedDB sample playback and persistence.
- Simulated MIDI channel/target routing, denied permissions, MIDI file round-trip,
  real MIDI header and non-silent WAV downloads.

### Verification status

The twenty main desktop/mobile scenarios and both saved-pattern manager scenarios
passed locally against the production bundle. Two additional first-note-loading
regression cases currently expose an audio-hook race: releasing a live key while
the worklet is loading can still enqueue its note afterward. Those cases remain
enabled, not skipped; the audio owner must fix the cancellation path before the
complete suite is green.

## Honest limitations

- Headless playback verifies successful audio initialization, worklet note events
  and non-silent exported PCM; it is not a listening test or a guarantee of
  perceptual sound quality on every device.
- MIDI input tests simulate hardware. Physical controllers, hot-plug behavior and
  browser/OS MIDI drivers still require manual checks.
- Mobile tests use Chromium touch emulation, not a physical phone. Firefox/Safari
  Web MIDI limitations are described in the UI, but those browsers are not run by
  this suite.
- Component-family coverage does not mean every possible parameter combination,
  timing race, repeated random fill result or browser storage-quota limit has been
  exhaustively tested.
- Saved projects and samples are device-local. Clearing site data removes them;
  there is no server account, Discord synchronization or cross-device recovery.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #58: [WIP] Strip all Discord functionality and configure site for GitHub Pages

Source branch: `copilot/strip-discord-functionality`
Last sync: 2026-10-08T19:06:37.537Z

#### Changed files
- `.dockerignore` — REMOVED (+0/-41)
- `.env.example` — REMOVED (+0/-25)
- `.github/workflows/ci.yml` — ADDED (+25/-0)
- `.github/workflows/docker-image.yml` — REMOVED (+0/-18)
- `.github/workflows/pages.yml` — ADDED (+45/-0)
- `.gitignore` — MODIFIED (+6/-0)
- `.opencode/agent/discobot-developer.md` — REMOVED (+0/-97)
- `.opencode/skills/discobot-dev/SKILL.md` — REMOVED (+0/-145)
- `AGENTS.md` — MODIFIED (+172/-35)
- `Dockerfile` — REMOVED (+0/-60)
- `Dockerfile.railway` — REMOVED (+0/-64)
- `README.md` — MODIFIED (+204/-308)
- `ai-pr-review-guide.md` — MODIFIED (+136/-22)
- `bot/package.json` — REMOVED (+0/-28)
- `bot/src/index.ts` — REMOVED (+0/-585)
- `bot/tsconfig.json` — REMOVED (+0/-9)
- `deploy.sh` — REMOVED (+0/-52)
- `docker-compose.yml` — REMOVED (+0/-59)
- `docs/CONTROL_AUDIT.md` — ADDED (+222/-0)
- `docs/REFACTOR_HANDOFF.txt` — ADDED (+192/-0)
- `docs/guides/DEPLOYMENT.md` — REMOVED (+0/-562)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — REMOVED (+0/-105)
- `docs/guides/HOSTING_QUICK_START.md` — REMOVED (+0/-201)
- `docs/guides/QUICK_START.md` — REMOVED (+0/-104)
- `docs/guides/RAILWAY_DEPLOY.md` — REMOVED (+0/-262)
- `docs/guides/README_STREAMING.md` — REMOVED (+0/-63)
- `docs/guides/SETUP.md` — REMOVED (+0/-167)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — REMOVED (+0/-70)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — REMOVED (+0/-118)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — REMOVED (+0/-95)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — REMOVED (+0/-107)
- `docs/plans/IMPLEMENTATION_PLAN.md` — REMOVED (+0/-87)
- `docs/plans/IMPROVEMENT_IDEAS.md` — REMOVED (+0/-165)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — REMOVED (+0/-288)
- `docs/plans/PIANO_ROLL_PLAN.md` — REMOVED (+0/-157)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — REMOVED (+0/-148)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — REMOVED (+0/-368)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — REMOVED (+0/-493)
- `docs/reference/AUDIO_STREAMING_CODE.md` — REMOVED (+0/-267)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — REMOVED (+0/-432)
- `docs/reports/FINAL_SUMMARY.md` — REMOVED (+0/-401)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — REMOVED (+0/-344)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — REMOVED (+0/-308)
- `docs/reports/PROJECT_SUMMARY.md` — REMOVED (+0/-188)
- `docs/reports/REFACTORING_SUMMARY.md` — REMOVED (+0/-373)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — REMOVED (+0/-255)
- `docs/reviews/CODE_REVIEW.md` — REMOVED (+0/-582)
- `ecosystem.config.js` — REMOVED (+0/-37)
- `engine/package.json` — MODIFIED (+2/-5)
- `engine/src/AudioContextManager.ts` — MODIFIED (+1/-1)
- `engine/src/AudioContextPolyfill.ts` — REMOVED (+0/-17)
- `engine/src/AudioExporter.ts` — MODIFIED (+19/-16)
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+24/-19)
- `engine/src/Streaming.ts` — REMOVED (+0/-89)
- `engine/src/StreamingSynth.ts` — MODIFIED (+53/-82)
- `engine/src/Synthesizer.ts` — MODIFIED (+30/-78)
- `engine/src/constants.ts` — MODIFIED (+0/-8)
- `engine/src/dsp.ts` — ADDED (+44/-0)
- `engine/src/index.ts` — MODIFIED (+1/-9)
- `engine/src/types.ts` — MODIFIED (+4/-0)
- `engine/test/audio.test.ts` — ADDED (+139/-0)
- `nginx-docker.conf` — REMOVED (+0/-32)
- `nginx.conf` — REMOVED (+0/-104)
- `opencode.json` — REMOVED (+0/-34)
- `package-lock.json` — MODIFIED (+848/-2787)
- `package.json` — MODIFIED (+10/-14)
- `playwright.config.ts` — ADDED (+33/-0)
- `railway.json` — REMOVED (+0/-7)
- `setup-discord-dependencies.ps1` — REMOVED (+0/-48)
- `setup-final.ps1` — REMOVED (+0/-77)
- `start-ui.bat` — REMOVED (+0/-4)
- `start-web.bat` — REMOVED (+0/-5)
- `supervisord.conf` — REMOVED (+0/-23)
- `ui/index.html` — MODIFIED (+2/-2)
- `ui/package.json` — MODIFIED (+2/-2)
- `ui/public/synth-processor.js` — MODIFIED (+159/-196)
- `ui/src/App.css` — MODIFIED (+0/-24)
- `ui/src/App.tsx` — MODIFIED (+411/-377)
- `ui/src/authClient.ts` — REMOVED (+0/-68)
- `ui/src/components/DrumKnob.css` — MODIFIED (+4/-0)
- `ui/src/components/DrumKnob.tsx` — MODIFIED (+23/-35)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+52/-9)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+18/-0)
- `ui/src/components/Keyboard.tsx` — MODIFIED (+84/-30)
- `ui/src/components/KeyboardPanel.tsx` — MODIFIED (+4/-0)
- `ui/src/components/Knob.css` — MODIFIED (+5/-0)
- `ui/src/components/Knob.tsx` — MODIFIED (+22/-36)
- `ui/src/components/MidiPanel.css` — MODIFIED (+5/-0)
- `ui/src/components/MidiPanel.tsx` — MODIFIED (+15/-4)
- `ui/src/components/MixerPanel.css` — MODIFIED (+0/-2)
- `ui/src/components/MixerPanel.tsx` — MODIFIED (+18/-0)
- `ui/src/components/PianoRoll.css` — MODIFIED (+5/-0)
- `ui/src/components/PianoRoll.tsx` — MODIFIED (+54/-6)
- `ui/src/components/SamplePanel.css` — ADDED (+49/-0)
- `ui/src/components/SamplePanel.tsx` — ADDED (+59/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+3/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+57/-19)
- `ui/src/components/SynthControls.css` — MODIFIED (+16/-2)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+90/-6)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+2/-2)
- `ui/src/components/useKnobInteraction.ts` — ADDED (+52/-0)
- `ui/src/config.ts` — REMOVED (+0/-51)
- `ui/src/hooks/browserAudio.ts` — ADDED (+241/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+66/-125)
- `ui/src/hooks/useMidiInput.ts` — MODIFIED (+24/-1)
- `ui/src/hooks/usePatternAudio.ts` — REMOVED (+0/-170)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+101/-328)
- `ui/src/hooks/useWebSocket.ts` — REMOVED (+0/-63)
- `ui/src/services/browserTransport.ts` — ADDED (+68/-0)
- `ui/src/services/drumKits.ts` — ADDED (+21/-0)
- `ui/src/services/localService.ts` — ADDED (+330/-0)
- `ui/src/services/projectSanitization.ts` — ADDED (+169/-0)
- `ui/src/services/sampleStore.ts` — ADDED (+96/-0)
- `ui/src/services/wavExport.ts` — ADDED (+167/-0)
- `ui/src/synthModels.ts` — MODIFIED (+20/-19)
- `ui/src/types.ts` — MODIFIED (+3/-3)
- `ui/src/utils/midiExport.ts` — MODIFIED (+19/-10)
- `ui/src/utils/midiImport.ts` — MODIFIED (+56/-11)
- `ui/test/audio-routing.test.ts` — ADDED (+101/-0)
- `ui/test/audio-worklet.test.ts` — ADDED (+148/-0)
- `ui/test/browser/controls.spec.ts` — ADDED (+469/-0)
- `ui/test/browser/local-app.spec.ts` — ADDED (+127/-0)
- `ui/test/localService.test.ts` — ADDED (+171/-0)
- `ui/test/static.test.ts` — ADDED (+30/-0)
- `ui/vite.config.ts` — MODIFIED (+2/-1)
- `web/package.json` — REMOVED (+0/-27)
- `web/src/authFallback.ts` — REMOVED (+0/-8)
- `web/src/index.ts` — REMOVED (+0/-2675)
- `web/src/sessionAuth.ts` — REMOVED (+0/-14)
- `web/src/tests/authFallback.test.ts` — REMOVED (+0/-18)
- `web/src/tests/sessionAuth.test.ts` — REMOVED (+0/-27)
- `web/src/tests/wsHelpers.test.ts` — REMOVED (+0/-31)
- `web/src/wsHelpers.ts` — REMOVED (+0/-45)
- `web/tsconfig.json` — REMOVED (+0/-9)
<!-- AUTO_PR_CHANGELOG_END -->
