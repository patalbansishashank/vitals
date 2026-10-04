# QA configuration

The QA scripts under `qa/` need a few facts about your own machines (the server, your PC, the public site). They are not
stored in the repository. Copy the example and fill in your values:

```sh
cp qa/local.config.example.json qa/local.config.json    # qa/local.config.json is git-ignored
```

| Key | Environment override | Meaning |
|---|---|---|
| `serverUrl` | `VITALS_QA_SERVER_URL` | server address, e.g. `https://vitals.example.ts.net:8443` |
| `serverHost` | `VITALS_QA_SERVER_HOST` | the server's tailnet name |
| `serverSsh` | `VITALS_QA_SERVER_SSH` | your ssh alias for the server |
| `serverIp4` / `serverIp6` | `VITALS_QA_SERVER_IP4` / `VITALS_QA_SERVER_IP6` | the server's tailnet addresses |
| `pcHost` / `pcIp4` | `VITALS_QA_PC_HOST` / `VITALS_QA_PC_IP4` | the PC that runs the QA scripts |
| `siteUrl` | `VITALS_QA_SITE_URL` | the public website |
| `ownerPersonId` | `VITALS_QA_OWNER_PERSON_ID` | person id used by the server journeys |
| `neverPublic` | (none) | words that must never reach the public repository: your names, your tailnet name |

An environment variable wins over the file. Node scripts read the values through `qa/scripts/lib/localConfig.mjs`.
The shipped example holds placeholders only; never commit real values.

The public-hygiene guard (`tests/publicHygiene/privateNames.test.ts`) also reads this file: it fails when a public file
holds a `neverPublic` word (whole word, any case) or the `ownerPersonId`. Without the file only the general checks run
(tailnet names and addresses, e-mail addresses); `scripts/publish/publish-public.sh` refuses to publish without it.
