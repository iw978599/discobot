---
name: ship-change
description: The checks and steps for finishing a change in Discobot and opening a pull request - what to run, what to update, how to commit and how to describe it. Use before committing, pushing or opening a PR in this repository.
---

# Shipping a change

## Before committing

1. `npm run typecheck`
2. `npm test -- --test-timeout 120000` (a test that leaves a timer running
   would otherwise hang the run)
3. Browser tests. **The owner's rule: do not run Playwright on this machine.**
   Push and let the check on GitHub run them (it deals each width's specs out
   to four machines). Before pushing, parse every changed spec with
   `npx esbuild <spec> --log-level=error > /dev/null`, since the typecheck does
   not cover the specs. A test that fails on GitHub and times real audio or
   makes many exports may only have been starved: re-run the failed jobs
   (`gh run rerun <id> --failed`) before believing it.
4. Update `AGENTS.md` or the area's file under `docs/agents/` (behaviour a
   later change must know; keep `AGENTS.md` under 100,000 characters) and
   `docs/ROADMAP.md` (what is now done, what is still open). Keep
   `docs/GUEST_PROTOCOL.md`, `docs/guest-example.html` and the guest tests in
   step with each other.

## Browser test notes

- Playwright builds the app itself. A preview server left running on port
  4173 makes it reuse a stale build: stop stray `node` processes first.
- Edits reach the arrangement a moment after a control changes. Wait before
  exporting, or poll stored state.
- Read saved state with the `stored(page)` helper (it dispatches `pagehide`
  so the debounced write happens).
- Knob values are typed into the input labelled `"<knob label> value"`,
  followed by Enter.
- Two exports can differ by a few samples at the smallest step. Compare with
  the `same` helper in `effects.spec.ts`, not byte equality, when a kick and
  the reverb are involved.
- Guest tests run against `docs/guest-example.html`, served by the local API
  at `/__guest`.
- The app must make no request to another site; a test fails on any.

## Commits and pull requests

- Never commit on `main`. Branch first.
- Before the first push of a session, check `git remote get-url origin` is
  the project's own repository.
- Commit with the identity already configured for this repository. Do not put
  anyone's real name or email address into commits, code, docs or tests.
- `.opencode/`, build output and `test-results/` stay untracked.
- A pull request that builds on another unmerged one says so in its first
  line, and says that merging it brings in both.
- The description states what was run and its result, and plainly lists what
  was not verified. Sound that has not been listened to is "not verified by
  ear".
- Wait for the checks with one background command, not by polling by hand:
  `sleep 120; for i in $(seq 1 80); do p=$(gh pr checks <n> 2>&1 | grep -c -E "pending|queued|in_progress|no checks"); [ "$p" = 0 ] && break; sleep 30; done; gh pr checks <n>`
  run in the background; you are told when it ends.
- The owner allows merging a pull request once every check is green
  (`gh pr merge <n> --merge --delete-branch`). Merge them in order when one
  builds on another.
  Before merging one that another is stacked on, point the upper one at
  `main` (`gh pr edit <n> --base main`): deleting the lower one's branch
  closes the upper pull request, and a closed one cannot be pointed anywhere.
- `docs/ROADMAP.md`, `AGENTS.md` and `docs/agents/` conflict often, because pull requests add
  lines next to each other. Merge `main` into the branch and keep both sides'
  lines; never drop the other pull request's.
- Merging to `main` publishes the site, once the checks on that merge have
  passed (about six minutes). If a check fails, nothing is published. The accounts API is deployed
  separately and by hand (`npm run deploy --workspace=server`, then
  `npm run migrate --workspace=server` if there is a new migration).

## Writing for the owner

Plain sentences, no jargon, the result first. Say what changed for someone
using the app, then what is still open. Do not describe a fix as working
unless it was reproduced and then seen fixed.
