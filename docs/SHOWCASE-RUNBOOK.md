# R111 local rehearsal runbook

This rehearsal uses **fictional records in a separate local SQLite database**. The browser runs the application and its actual Worker handlers; normal sessions, permissions, command receipts, payment verification, media access and notification state transitions remain active. The offline research assistant uses bounded registry commands. Payment outcomes and notification delivery are simulated locally.

The supplied source package does not include an approved real or redacted registry snapshot, real provider credentials, or licensed production artwork. The source preview flag displays the explicit artwork placeholders implemented for this package. All example commands below run from the repository root.

## Start a fresh rehearsal

Use the project's locked dependencies and a Node version with built-in SQLite and TypeScript stripping. The recorded checks used Node 24.19.0 and Python 3. A first dependency installation needs network access; the subsequent rehearsal does not need external providers.

```sh
npm ci
python3 tools/reset-showcase.py reset --instance client-demo --as-of 2026-10-17
HORSE_REGISTRY_SOURCE_PREVIEW=1 npm run dev:demo -- data/demo/client-demo.sqlite
```

On Windows, use `python` if that is the installed Python command. In PowerShell, set `$env:HORSE_REGISTRY_SOURCE_PREVIEW="1"` before running `npm run dev:demo -- data/demo/client-demo.sqlite`.

Open **http://127.0.0.1:3000**. Keep the terminal open. The launcher binds only the loopback interface and uses a fixed port. The source preview switch belongs to the local review; use the normal asset restoration process before a production build.

The reset command builds a new baseline before switching a stopped instance. If the named instance already exists and has a recognized synthetic marker, reset first saves a backup. The underlying builder command refuses to overwrite even an empty file:

```sh
python3 tools/create-demo-database.py --output data/demo/separate-demo.sqlite --as-of 2026-10-17
python3 tools/create-demo-database.py --check --output data/demo/separate-demo.sqlite
```

The canonical baseline has 28 horses, 8 people, 10 UUID-addressed listings, 4 competitions, 16 competition results, 7 personas, 3 workspaces, 7 tasks, 4 claims, 9 genetic records and 3 byte-backed media items. `seed/showcase-scenarios.json` contains the full stable story map; `/api/demo/context` describes the running instance, its source date, baseline counts, available personas and reminder clock. These counts describe this fictional fixture, not national coverage.

## Sign in and follow the stories

Use the **Demo accounts** selector. It calls the server's fixed persona allowlist and creates a real session; it does not assign roles or user IDs in browser storage. Anonymous browsing remains anonymous. The server uses its existing session expiry policy and returns `sessionExpiresAt`; the reminder clock never extends authentication.

| Persona | Actual role | Useful local story | Expected denial |
| --- | --- | --- | --- |
| Owner A | `owner` | Workspace `970000001`, horse `900000017`, its own listings and media | Owner B workspace `970000002` |
| Owner B | `owner` | Workspace `970000002`, horse `900000018`, buyer inquiries | Owner A workspace `970000001` |
| Reviewer | `admin` | Claim review queue | Unassigned private Owner A workspace |
| Provider | `user` | Directory profile for person `990000003` | Owner A workspace |
| Organization manager | `owner` | Organization workspace `970000003` | Owner A private workspace |
| Staff | `user` | View and task management in workspace `970000001` | Workspace export and Owner B workspace |
| Administrator | `admin` | Demo notification inbox; explicitly assigned view/task/export access in workspace `970000001` | Unassigned Owner B workspace |

The reviewer uses the existing administrator capability model because claim review currently belongs to that role. It is a fictional local account, not a new narrowly scoped reviewer role. Administrator status alone does not bypass private workspace membership.

Switch Owner A → Owner B → Owner A and verify each person's workspace. The server revokes the presented old session on a persona switch. Use Logout to end the session. Existing client principal scopes and the canonical `auth.demoPersona` action invalidate private frontend authority; browser-specific results are recorded separately in the R111 UI evidence.

### Registry, breeding and media

- Horse `900000017` and horse `900000018` have explicitly fictional reviewed `CA / N/CA` examples: test IDs `980000008` and `980000009`. The raw result snapshot is mapped through `genetic_pairing_reviews`; no ordinary unverified result was promoted. This is a demonstration of a calculation, not a real laboratory report.
- The historical breeding record `980001001` covers on `2020-05-12`, in Solar Hijri season `1399`, and records a foaling day `2021-04-17`. Parents `900000009` and `900000012` match foal `900000017`. The planned record `980001002` uses the canonical season for its actual covering day. Birth years remain years, without invented birthdays.
- The manifest labels invalid season `2026` as **correction rehearsal input only**. It is not installed as an ordinary breeding record. Concurrency and correction behavior are tested in the separate genetics workstream.
- Horse `900000017` has a public abstract PNG, a private fictional PDF and a rejected private PNG. The public item is visibly synthetic and has actual 320 × 180 image bytes. Private media requires the normal authenticated access path; opening its raw public URL is expected to return 404.
- The three workspace document rows are date/status trackers. They are not claimed to be downloadable attachments. The separate horse PDF is the actual byte-backed document fixture.

### Demo payment

Create an order as Owner A or Owner B using the application's billing flow. The server's payment response supplies a `/demo-pay/` URL. The page offers three explicit simulated outcomes: success, cancellation and provider failure. After simulated success, choose **Verify simulated payment** while signed in as the order buyer. The application's normal server verification grants the demonstration entitlement once. A visible settlement alone does not grant it.

Reloading the payment page can resume verification. Repeating the same successful verification returns the recorded result. Cancellation, a simulated decline, an uncompleted session, a mismatched buyer and a response whose outcome is unknown must never be presented as success. The callback includes the actual demo authority and is restricted to `http://127.0.0.1:3000`; the exception is unavailable to live payment mode.

The live HTTP rehearsal script creates real fictional orders and checks all four outcomes, callback authority, buyer-only verification data, replay and entitlement behavior:

```sh
python3 tools/test-r111-demo-http.py
```

This script changes only the running marked local rehearsal. Start from a fresh/reset fixture when repeating a complete presentation: it deliberately creates inquiry, order, payment and notification records.

### Notification and reminder rehearsal

The adapter exposes `POST /api/demo/run-pending-jobs` only to an authenticated local administrator with a valid CSRF token. A single invocation runs the actual retention sweep, reminder enqueue and notification drain, with a bounded send limit of 10. The demo provider records acceptance locally. Use the existing administrator demo inbox callback action to mark delivery or non-delivery through the actual signed callback path.

Acceptance and delivery are different states. Repeating a settled callback does not duplicate delivery. All seeded recipients use `@local.invalid`; the demo inbox does not capture authentication OTPs. Its signing secret exists only in server memory and changes on restart.

`POST /api/demo/clock` accepts `{ "advance_days": 1 }` through the same administrator/CSRF guards. The explicit clock affects **the local reminder/retention scheduler only**. It does not alter the operating system time, session expiry, payment session expiry or ordinary entitlement evaluation. `/api/demo/context.clock` always names this scope. Use the HTTP test script for a complete ready-made outbox rehearsal without entering SQL or secrets.

### Offline research

Open the Assistant and try:

```text
Find DEMO
Horse 900000017
Count horses
List horses
```

Persian examples include `جست‌وجو DEMO`, `اسب ۹۰۰۰۰۰۰۱۷` and `تعداد اسب‌ها`. These commands invoke the same validated public read-only registry tools as the provider-backed assistant. Answers identify the fictional dataset and return actual evidence IDs and record links. Search shows at most eight records and states when the slice is bounded. Unknown profiles and empty searches stay empty.

This mode does not run an LLM, search the web, inspect images, generate free-form analysis or provide breeding/medical advice. Unsupported prompts show the available commands. The normal public model descriptor reports external models and vision unavailable. To disable even this local research mode, set `HORSE_REGISTRY_DEMO_RESEARCH=0` when starting the demo. The live provider gates and credentials remain separate.

```sh
python3 tools/test-r111-research-http.py
```

This second script verifies actual SSE replies, returned horse IDs, citations, persisted conversation evidence, missing/empty cases, same-message replay and separation between anonymous and signed-in conversations.

## Stop, back up, reset and restore

Press **Ctrl+C in the launch terminal** and wait for it to exit. The launcher and reset tool share an exclusive instance lock; do not delete a lock while the server is running.

```sh
python3 tools/reset-showcase.py backup --instance client-demo
python3 tools/reset-showcase.py reset --instance client-demo --as-of 2026-10-17
```

Backup prints a filename under `data/demo/backups`. To restore that exact backup to the same named instance:

```sh
python3 tools/reset-showcase.py restore --instance client-demo --backup-name COPY-THE-EXACT-PRINTED-FILENAME.sqlite
```

The placeholder above must be replaced with the filename printed by your backup. Restore checks that the file belongs to this instance, preserves the current instance in a separate backup, checks schema and fixture compatibility, then switches the stopped instance. It retains completed commands and embedded document/photo bytes. An old backup from a different code/fixture revision is preserved but refused for automatic launch; it is not silently migrated.

If the terminal or computer died and the tool reports a stale lock:

```sh
python3 tools/reset-showcase.py reset --instance client-demo --as-of 2026-10-17 --recover-stale-lock
```

This removes the lock only after validating its instance path and proving its recorded process no longer exists. A live or unrecognized lock is refused. An arbitrary path, a non-synthetic database, a symlink, a foreign instance backup or active SQLite sidecars will not be overwritten.

## Read-only browsing

Create a separate synthetic copy, stop the editable server, then launch that separate file read-only:

```sh
python3 tools/create-demo-database.py --output data/demo/reference-view.sqlite --as-of 2026-10-17
HORSE_REGISTRY_SOURCE_PREVIEW=1 npm run dev:demo -- --read-only data/demo/reference-view.sqlite
```

The server denies mutating requests, the database itself is opened read-only, the persona picker is disabled and the write policy says `read_only`. AI conversations are disabled in this mode because they persist messages. This is a supported read-only **synthetic** reference copy; an approved real/redacted snapshot and its redaction review remain an external handoff item.

## Common recovery cases

| Symptom | Action |
| --- | --- |
| “Demo builder/migrations changed” | Stop the server and reset a named synthetic instance. The prior file is backed up. |
| Port 3000 already in use | Stop the existing local launch terminal. Do not run two rehearsals against the same named file. |
| “Instance locked” | Stop the matching launcher; use proven-dead stale lock recovery only if it crashed. |
| Missing licensed artwork | Use the explicit source preview flag for code review, or restore the authorized assets before the normal build. |
| Payment says unknown or verification failed | Keep the same order/attempt and inspect/retry its verification. Do not claim success or create a replacement paid result. |
| Reminder did not deliver | Acceptance is only a recorded provider acknowledgement. Inspect the demo inbox and its callback state. |
| Assistant says unsupported | Use one of the four displayed commands. External providers are deliberately unavailable in the local rehearsal. |
| Source data looks stale | Check the fixture `as_of`, the reminder clock scope and analytics freshness separately. Resetting changes only the named synthetic instance. |

No part of this runbook deploys a site, sends real notifications, contacts a payment merchant or signs in to an external service. Hosted multi-visitor isolation, real provider checks, reference redaction, licensed artwork restoration and cross-device production sign-in remain separate execution work.
