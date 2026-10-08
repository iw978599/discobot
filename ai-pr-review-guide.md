# AI PR Review Guide

Expert-level code review framework for the Discord Synth Bot project.

## Review Principles

1. **Correctness first** — Does it work? Does it break anything?
2. **Performance matters** — Audio code cannot tolerate GC pauses or jank
3. **Security always** — Auth, input validation, secret handling
4. **Architecture fit** — Does it follow the established data flow?
5. **Readability** — Will the next developer understand this in 6 months?

## Project Architecture

```
discobot/
├── bot/       Discord bot (discord.js v14, @discordjs/voice)
├── engine/    Custom math synthesis, types, streaming renderer
├── web/       Express API (3001) + WebSocket (3001/ws)
└── ui/        React + Vite (3000)
```

**Data flow**: Engine types → Web server (state + REST) → WebSocket → UI + Bot

## Review Checklist

### 1. Correctness

- [ ] Code does what the PR description claims
- [ ] Edge cases handled (empty arrays, null, concurrent access)
- [ ] Type changes propagate through engine → web → ui
- [ ] WebSocket message shapes match between sender and receiver
- [ ] Audio output is valid (no NaN, no unclipped overs)
- [ ] State mutations are not bypassing React state updates
- [ ] Async operations have proper error handling

### 2. Performance

- [ ] No allocations in audio render loops
- [ ] React components memoized where needed (useCallback, useMemo)
- [ ] No unstable object/function references causing re-renders
- [ ] WebSocket messages throttled for high-frequency updates
- [ ] No memory leaks (event listeners, intervals, node refs)
- [ ] JSON file writes (saved-patterns.json) not blocking request handlers
- [ ] Large arrays not copied when mutation suffices

### 3. Security

- [ ] No secrets, tokens, or keys in committed code
- [ ] Auth tokens validated before use (session TTL, CSRF check)
- [ ] HMAC signature verification not bypassed for bot requests
- [ ] WebSocket origin validation enforced (isAllowedUpgradeOrigin)
- [ ] User input sanitized before storage or rendering
- [ ] No SQL/NoSQL injection vectors (if applicable)
- [ ] Rate limiting present on sensitive endpoints

### 4. Architecture

- [ ] Changes respect engine → web → ui data flow
- [ ] New types defined in `engine/src/types.ts` (single source of truth)
- [ ] REST for data operations, WebSocket for real-time sync only
- [ ] No circular dependencies introduced
- [ ] Component responsibilities are clear (not mixing concerns)
- [ ] Server state in global variables, client state in React hooks

### 5. Code Quality

- [ ] No new comments (unless explaining non-obvious math or audio logic)
- [ ] Error handling present (no silent failures or empty catch blocks)
- [ ] Function and variable names are descriptive
- [ ] No dead code or commented-out blocks
- [ ] CSS does not use `!important`
- [ ] No inline styles where CSS classes would work
- [ ] Import order is consistent (external → internal → relative)

### 6. Audio-Specific Checks

- [ ] `DrumState` initialized with `createDefaultDrumState()` (never null)
- [ ] Synth parameters clamped to valid ranges
- [ ] StreamingSynth chunks: 20ms at 48kHz (960 samples)
- [ ] Pattern audio: stereo Int16 PCM at 48kHz, base64 encoded
- [ ] Browser AudioWorklet messages match engine expectations
- [ ] Drum kit changes apply defaults without losing user tweaks
- [ ] New audio paths include `tryResume()` or `ensureAudioReady()`
- [ ] Master gain nodes used for volume control (not direct destination)
- [ ] Soft-clipper used on master mix (not hard clipping)

### 7. State Management

- [ ] `normalizeDrumState` called when loading drum state from storage
- [ ] `normalizeSynthModelId` and `normalizeSynthModelParams` used for synth models
- [ ] React state updates use functional form when depending on previous state
- [ ] Refs used for values accessed inside callbacks or effects
- [ ] Cleanup functions returned from useEffect hooks
- [ ] WebSocket handlers check `session.guildId` before broadcasting

### 8. Testing Considerations

- [ ] Can this be tested manually via the UI?
- [ ] Does `npm run build` pass without errors?
- [ ] Does `tsc --noEmit` pass for all workspaces?
- [ ] Are there obvious scenarios that would break the change?
- [ ] Does the change affect Discord bot playback behavior?

## Known Issues to Watch For

These are recurring problems in this codebase:

1. **Stale closures** — React callbacks capturing stale state. Use refs for values that change.
2. **WebSocket type drift** — Server and client message types must stay in sync.
3. **AudioContext suspension** — Chrome requires resume() in user gesture. Use tryResume().
4. **Double saturation** — Drum FX sends carry post-processed signal through shared FX loop.
5. **Synth insert bypass** — Browser insert effects are bypassed during pattern rendering by design.
6. **Firefox/Safari** — No Web MIDI API. Graceful degradation required.
7. **CORS for audio** — AudioWorklet module must be served from same origin.
8. **Pattern step sync** — 32-step patterns must stay synchronized across WebSocket broadcasts.

## Output Format

Structure your review as:

```
## PR Review: [Title]

**Summary**: [One paragraph assessment]

### Critical Issues
[Must-fix before merge]

### Suggestions
[Recommended improvements]

### Nitpicks
[Style/clarity nits]

### Verdict
- Approve
- Request Changes
- Comment
```

## How to Use This Guide

### Via GitHub Actions (automatic)
The `.github/workflows/pr-review.yml` workflow reads this file and sends it along with the PR diff to an AI model for review. The review is posted as a PR comment.

### Manual review
When reviewing a PR, read this guide first, then examine:
1. The PR diff (`gh pr diff <number>`)
2. Changed files in full context
3. Related unchanged files that might be affected

Post your review as a PR comment using:
```bash
gh pr comment <number> --body-file review.md
```

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
