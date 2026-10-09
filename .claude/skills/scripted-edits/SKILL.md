---
name: scripted-edits
description: How to make multi-line or multi-file source edits in this repository on Windows without corrupting them. Use when an edit contains backslashes, backticks, quotes or template strings, or touches several files at once.
---

# Editing files here

The working tree has Windows line endings, and the shell is Git Bash. Two
things follow.

1. **Do not write source through a shell heredoc or `sed` when the text has
   backslashes, backticks, `${...}` or mixed quotes.** The shell changes them
   on the way and the damage is easy to miss (a lost `\` in a regular
   expression or a test title).
2. **A search string with `\n` in it will not match a file that has `\r\n`.**

## The pattern that works

Write a small Node script with the file-writing tool (not a heredoc), run it,
delete it:

```js
// _e.cjs, in the repository root; delete after running
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
  noticed.
- `split().join()` replaces every occurrence. That is wanted for a repeated
  block (the two LFO menus), and a reason to make the search string longer
  when it is not.
- Run `npm run typecheck` straight after.
- Single-line, plain-text replacements are fine with the edit tool or `sed`.
- Never leave `_e.cjs` or probe specs (`zz-*.spec.ts`) behind; check
  `git status` before committing.

## Other machine quirks

- `gh` is not on the path in Git Bash; call it by its full path under
  `%LOCALAPPDATA%\Programs\GitHub CLI\bin`.
- Use PowerShell to find and stop stray `node` processes.
- New files are created with LF and Git warns about it; that is harmless.
