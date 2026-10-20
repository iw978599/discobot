@AGENTS.md

# Working with the owner

`AGENTS.md` (above) is the project's own account of itself and its rules. These
are how the owner wants a session run.

- **Start:** if `docs/HANDOFF.md` exists, read it first; it says where work
  stopped. Read the skill in `.claude/skills/` that fits the task
  (`ship-change`, `scripted-edits`, `add-project-field`, `sample-songs`,
  `live-sessions`).
- **Narrate** what you are doing as you go, in plain sentences, result first.
- **Never run Playwright on this machine.** Run `npm run typecheck` and
  `npm test` locally, parse changed specs with `npx esbuild`, push, and let the
  checks on GitHub run the browser tests.
- **Merge** a pull request yourself once every check is green.
- **Git:** branch off `main`, stage files by name (never `git add -A`), and
  never put a real name or email in a commit, code, docs or tests.
- **Costs:** the project pays for nothing. Never plan or build on a paid or
  card-requiring service. Changing which outside service gets data, or adding
  a secret, is the owner's decision.
- **Usage limits** run out fast: work directly, and use at most one builder
  (a subagent on Sonnet) for a contained item.
- **Sound** cannot be verified by tests: say "not verified by ear".
- **Docs:** keep `AGENTS.md` and `docs/ROADMAP.md` up to date with every change.
- Never work under the `everhealth` GitHub organisation from this machine.
