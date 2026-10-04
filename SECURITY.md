# Security policy

Vitals is a hobby project kept by a small group of people. Please read this page with that in mind.

## Supported versions

Only the latest release gets security fixes. If you run an older version, update first and check
whether the problem is still there.

## How to report a problem

Please do not open a public issue for a security problem.

1. Open this repository on GitHub.
2. Go to the **Security** tab.
3. Choose **Report a vulnerability**. This opens a private advisory that only you and the maintainers can see.

Say what you found, which version or commit, and the steps to reproduce it. A short proof of
concept helps. If you are not sure whether something counts, report it anyway.

## What is in scope

- the web app (`src/`)
- the server and its pairing, sync relay, AI proxy and agent (MCP) endpoints (`packages/companion`, see
  [docs/SERVER.md](docs/SERVER.md))
- the desktop app and the Android app
- the ring drivers (`src/biometrics`), including how they talk over Bluetooth

Out of scope: problems in a third-party service you connect on your own (an AI provider, Tailscale,
GitHub), and problems that need someone to already have root on your server or your unlocked device.

## What to expect

We aim to acknowledge a report within a week. After that we work on a fix as time allows; this is a
best-effort promise, not a service level. We will tell you when a fix is released and, if you want,
credit you in the release notes.

## What Vitals does with your data

- **Local first.** Your data is kept on your own devices. There are no accounts and no analytics.
- **Sync.** Optional sync between your devices uses Evolu. Changes are end-to-end encrypted under keys
  derived from a 24-word phrase that only your devices hold, and the sync relay sees only encrypted data
  ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). Raw samples travel as encrypted blobs.
- **A server in the home role can read your data.** To work while your phone and browser are off, it keeps
  the sync key on its own disk. Anyone with root on that computer, or with a copy of its data folder or
  backups, can read your data. A server in the relay role cannot
  ([docs/SERVER.md](docs/SERVER.md), "What the server can read").
- **Devices pair with a short code.** The code lasts 10 minutes, works once, and locks after 5 wrong tries.
  A paired device keeps a token and the server keeps only its hash.
- **AI is optional.** If you turn it on, the text you send goes to the provider you chose, with your own key
  or sign-in. Agents get read, log or edit scopes and never destructive commands.
