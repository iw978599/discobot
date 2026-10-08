# Discobot

A browser-only music workstation: up to three synths, 16/32-step sequencing,
piano-roll editing, an eight-instrument drum machine, MIDI and shared effects.
No Discord account, backend, API keys or login is required.

## Architecture

```
discobot/
├── engine/    # Browser-compatible TypeScript DSP and shared types
└── ui/        # React + Vite, Web Audio, local project/sample services
```

Two npm workspaces build to a static site in `ui/dist/`. Project operations and
events run in-process; there is no REST server or WebSocket connection. Sound is
generated locally and played through the browser's Web Audio API.

## Run locally

Use **Node.js 22+** and npm from the repository root:
```bash
npm ci
npm run dev
```

Open **http://localhost:3000/discobot/**. To preview the production build:

```bash
npm run build
npm start
```

Open **http://localhost:4173/discobot/**. `npm start` is Vite's static preview,
not an application backend. The build's asset base is `/discobot/`.

## Make music

1. Click a keyboard key or Play to unlock browser audio; start with low output volume.
2. Select a synth step and assign a note, or paint notes in the piano roll.
   Adjust velocity, oscillator, filter, ADSR, LFOs and arpeggiator controls.
3. Add drum steps, select a kit, and adjust track settings, swing, mute/solo and mix.
4. Use Play All / Stop All, shared tempo and the mixer. Effects sends feed
   drive, phaser, delay and reverb; a send and its return must be audible.
5. Save a named pattern; load or delete it through the pattern manager.

### Local data

Project state and named patterns are stored in **localStorage**. Imported sample
bytes and metadata are stored in **IndexedDB**, then decoded locally for playback.
Nothing is uploaded. Storage is specific to the browser profile and origin:
localhost ports and the deployed site do not share projects. Clearing site data,
private browsing or storage quotas can remove/prevent persistence. Storage errors
are reported in the UI; local storage is not a backup.

### MIDI and audio files

- **MIDI input:** select a device, channel, target synth and live/record/step mode.
  Hardware input requires Web MIDI support, a secure context (HTTPS or localhost)
  and permission. Unsupported browsers show an explanation instead of unusable
  device controls; use the on-screen keyboard or import a file instead.
- **Import MIDI:** choose a `.mid` file and a track; imported notes and detected
  tempo are mapped to the sequencer. MIDI file import/export does not require
  Web MIDI or a connected controller.
- **Export MIDI:** download a Standard MIDI File containing synth lanes, tempo
  and drums on channel 10. MIDI stores note events, not synthesized audio.
- **Export WAV:** render the current arrangement locally to a stereo audio file.
  Offline rendering is a separate DSP path, not a recording of the live output.

### Audio implementation

- Eight-voice AudioWorklet synthesis with PolyBLEP correction for saw/square
  oscillators, smoothed parameters and short voice-stealing/transition ramps.
- Audio-clock look-ahead sequencing rather than network-delivered audio.
- Parallel effects sends preserve the dry signal when effects are bypassed;
  the phaser mixes a dry tap with its all-pass stages.
- Shared output headroom, compression and soft saturation protect the live mix;
  sample previews use the same output with short boundary fades.

These are implemented DSP safeguards, not a claim of listening-verified quality
or exact emulation of vintage hardware.

## Validation

Existing checks: `npm run typecheck`, `npm test`, and `npm run test:browser`.
See [the control audit](docs/CONTROL_AUDIT.md) for coverage and remaining limits.
Automated browser/DSP checks do not verify subjective sound quality, real MIDI
hardware or every browser/device; those require listening and hands-on testing.

## GitHub Pages publication

**Publication is not confirmed.** Repository metadata reported `has_pages: false`,
the expected site's DNS lookup failed, and browser-only PR #58 was still unmerged
when checked. No Pages-settings write API is available in this task.

Remaining maintainer steps:
1. Merge the approved browser-only PR into `main`.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run **Publish GitHub Pages** on `main` and confirm its deployment succeeds.

Expected URL: **https://iw978599.github.io/discobot/** — this is not a claim that
the site is already published.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #58: [WIP] Strip all Discord functionality and configure site for GitHub Pages

Source branch: `copilot/strip-discord-functionality`
Last sync: 2026-10-08T18:30:00.532Z

#### Changed files
- `.dockerignore` — REMOVED (+0/-41)
- `.env.example` — REMOVED (+0/-25)
- `.github/workflows/ci.yml` — ADDED (+25/-0)
- `.github/workflows/docker-image.yml` — REMOVED (+0/-18)
- `.github/workflows/pages.yml` — ADDED (+45/-0)
- `.gitignore` — MODIFIED (+6/-0)
- `.opencode/agent/discobot-developer.md` — REMOVED (+0/-97)
- `.opencode/skills/discobot-dev/SKILL.md` — REMOVED (+0/-145)
- `AGENTS.md` — MODIFIED (+36/-13)
- `Dockerfile` — REMOVED (+0/-60)
- `Dockerfile.railway` — REMOVED (+0/-64)
- `README.md` — MODIFIED (+83/-329)
- `bot/package.json` — REMOVED (+0/-28)
- `bot/src/index.ts` — REMOVED (+0/-585)
- `bot/tsconfig.json` — REMOVED (+0/-9)
- `deploy.sh` — REMOVED (+0/-52)
- `docker-compose.yml` — REMOVED (+0/-59)
- `docs/CONTROL_AUDIT.md` — ADDED (+80/-0)
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
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+103/-328)
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
