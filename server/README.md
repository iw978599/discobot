# Discobot accounts API

A Cloudflare Worker with a D1 database. It holds accounts and a copy of each
synced project. Public song pages come later
(see `docs/STORAGE_AND_ACCOUNTS_PLAN.md`).

## What it stores

- **Accounts:** username, password hash, recovery-code hash, join date, the
  invite code used, and whether the account is the owner.
- **Sessions:** a hash of a random token per signed-in browser, with an expiry
  90 days out.
- **Invite codes:** the code, who made it, and who used it.
- **Projects:** id, owner, name, revision number, last-changed time, and the
  project itself in the project-file format. Up to 100 per account, 400 KB
  each. A deleted project leaves a marker with no contents, so other browsers
  learn it was deleted. Deleting the account deletes all of them.
- **Published songs:** a short code, the publisher, the project it came from,
  a title and the song. Anyone with the code can read the title, the
  publisher's username and the song. Up to 50 per account.
- **Failed sign-ins:** a username and a time, deleted after fifteen minutes.

No email addresses, names or IP addresses. Passwords, session tokens and
recovery codes are never stored or logged in readable form.

## Running it

```bash
npm run dev:api                       # local, in memory, http://127.0.0.1:8787
npm test                              # includes server/test
npm run deploy --workspace=server     # publish (after `npx wrangler login`)
npm run migrate --workspace=server    # apply new migrations to the live database
```

To use the local API from the dev UI, start the UI with
`VITE_API_URL=http://127.0.0.1:8787 npm run dev`. The local owner invite is
`local-owner-invite`.

## The owner

The Worker has a secret, `OWNER_INVITE`. The first account created with it as
the invite code becomes the owner; after that the secret does nothing. The
owner creates invite codes and can remove accounts, both from the Account
dialog in the app. To set a new secret:
`npx wrangler secret put OWNER_INVITE` (run inside `server/`).

## Limits to know

- Eight wrong passwords or recovery codes for one username lock that username
  for fifteen minutes. Someone who knows a username can therefore lock its
  owner out for a while by guessing on purpose.
- Losing both the password and the recovery code loses the account. There is
  no other way in, by design.
- Cloudflare caps password hashing (PBKDF2-SHA256) at 100,000 iterations.
