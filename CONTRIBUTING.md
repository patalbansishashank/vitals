# Contributing to Vitals

Thank you for looking. Small fixes, bug reports and evidence-based model changes are all welcome.

## A note on how changes land

The maintainers work in a private history. This public repository receives snapshot commits from it.
Pull requests are welcome, but they will not be merged here directly: a maintainer applies the change to the
private history, and it appears in the next snapshot. Your pull request will be closed with a note when that
happens. Credit goes in the release notes.

## Setup

You need the Node version in [`.nvmrc`](.nvmrc) (22 or newer) and [pnpm](https://pnpm.io) 9 or newer.

```sh
pnpm install
pnpm dev        # http://localhost:5173
```

## Checks a change must pass

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Before a release the maintainers also run `pnpm test:release`, which splits the heavy tests into a second pass.
Run it if your change touches the engine, the planner or the evidence pages.

## Style

- UI text and docs are plain, short English. Use a plain word where one exists. No marketing words.
- Do not add real host names, IP addresses, e-mail addresses or personal health data to tracked files. Use
  placeholders such as `https://vitals.example.ts.net:8443`.
- Keep tests next to the code, in `__tests__` folders.

## Where the specs live

- [docs/SUITE_SPEC.md](docs/SUITE_SPEC.md) is the code contract for the whole app: data, commands, sync, the apps.
- [docs/MODEL_SPEC.md](docs/MODEL_SPEC.md) is the model: every equation and parameter in `src/engine`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map of folders and layers.
- [docs/SERVER.md](docs/SERVER.md) covers the server; [docs/RELEASING.md](docs/RELEASING.md) covers releases.

## Devices and rings

Vitals is manual-only from 0.6.0: everything it knows is what the person enters. It has no Bluetooth, ring drivers or
health-file importers, and changes that add them are out of scope. Ring support lives in the separate Android app
[Gauge](https://github.com/patalbansishashank/Gauge).

## Changing the model

The bar is evidence, not opinion. A change to an equation or a parameter must:

- cite published human evidence (a study, a review) with a link or reference;
- give an evidence grade, A to D, as `docs/MODEL_SPEC.md` does for every parameter, and a plausible range;
- keep the validation suite honest: do not loosen a must-pass check to make it pass; record a miss openly with
  its cause (see [docs/VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md));
- keep the safety limits in place.

Vitals is not a medical device, and nothing in a change should read as medical advice.
