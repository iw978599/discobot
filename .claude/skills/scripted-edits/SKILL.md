---
name: scripted-edits
description: How to make multi-line or multi-file source edits in this repository on Windows without corrupting them. Use when an edit contains backslashes, backticks, quotes or template strings, or touches several files at once.
---

# Editing files here

The working tree has Windows line endings, and the shell is Git Bash. Two
things follow.

1. **Do not write source through a shell heredoc, `node -e '…'` or `sed` when
   the text has backslashes, backticks, `${...}`, apostrophes or mixed quotes.**
   The shell changes them on the way and the damage is easy to miss (a lost `\`
   in a regular expression, an apostrophe that ends a string early). This has
   happened many times; it is the commonest way an edit goes wrong here.
2. **A search string with `\n` in it will not match a file that has `\r\n`.**

## The pattern that works

Write a small Node script with the file-writing tool (not a heredoc) into the
session's scratchpad directory (not the repository), and run it from the
repository root with `node <scratchpad>/edit.js`:

```js
const fs = require('fs');
const edit = (path, pairs) => {
  let text = fs.readFileSync(path, 'utf8');
  const crlf = text.includes('\r\n');
  text = text.replace(/\r\n/g, '\n');
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${path}: not found: ${from.slice(0, 70)}`);
    text = text.split(from).join(to);
  }
  fs.writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
};
edit('ui/src/example.ts', [
  ['old text', 'new text'],
]);
```

- It throws when a search string is missing, so a half-applied edit is
  noticed. When it throws, nothing was written: check `git diff`, fix the
  string, run it again.
- `split().join()` replaces every occurrence. That is wanted for a repeated
  block, and a reason to make the search string longer when it is not.
- A search string must match the source exactly: an apostrophe the source
  writes escaped (`'the sound\'s'`) has to be escaped in the search string too.
- A long block of new text (a test, a song) goes in a scratch file of its own,
  written with the file-writing tool, and the script splices it in between two
  marker strings. Nothing in it then passes through the shell.
- Run `npm run typecheck` straight after. Parse a changed browser spec with
  `npx esbuild <spec> --log-level=error > /dev/null` (the typecheck does not
  cover the specs, and Playwright is not run on this machine).
- The edit tool handles CRLF files itself and is the safest choice for one or
  two replacements, especially of text with quotes or backslashes.
- Single-line, plain-text replacements are fine with `perl -pi -e`, which keeps
  the line endings.
- `sed -i` turns a CRLF file into LF. Use it only on a file that is LF already,
  or put the endings back afterwards with `perl -pi -e 's/(?<!\r)\n/\r\n/' <file>`.
- Never leave a script or a probe spec (`zz-*.spec.ts`) in the repository;
  check `git status` before committing, and stage files by name.

## Scratch scripts that run the app's code

To measure or check something by running the app's TypeScript (rendering a
song, listing presets): `node --import tsx <file>`. A script that uses
top-level `await` must be `.mts`. Imported by absolute path it needs a
`file:///` URL with spaces as `%20`; a script kept in the repository (like
`scripts/measure-songs.mts`) imports by relative path instead. A bare
`@discobot/engine` does not resolve from outside the repository: import
`engine/src/index.ts` by its path.

## Other machine quirks

- `gh` is on the path in Git Bash.
- Use PowerShell to find and stop stray `node` processes.
- New files are created with LF and Git warns about it; that is harmless.
