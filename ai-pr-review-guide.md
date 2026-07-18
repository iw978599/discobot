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
### PR #55: Scrollable drum panel, compact MIDI bar, shorter keyboard/piano-roll

Source branch: `feat/ui-layout-refinements`
Last sync: 2026-07-18T16:42:19.654Z

#### Changed files
- `ui/src/App.css` — MODIFIED (+1/-0)
- `ui/src/components/Keyboard.css` — MODIFIED (+5/-5)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+1/-1)
- `ui/src/components/MidiPanel.css` — MODIFIED (+25/-38)
- `ui/src/components/MidiPanel.tsx` — MODIFIED (+35/-52)
- `ui/src/components/PianoRoll.css` — MODIFIED (+1/-1)
<!-- AUTO_PR_CHANGELOG_END -->
