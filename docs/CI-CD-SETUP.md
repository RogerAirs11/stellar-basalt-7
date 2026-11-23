# CI/CD — GitHub → Cloudflare Automatic Deployment

**Since R48 (2026-09-23):** pushing to `main` on GitHub deploys to production automatically.
No more manual `npm run build` + `wrangler deploy` uploads. GitHub's servers do the build,
the tests, and the deploy — the sandbox (or any laptop) is only for *editing* code.

## How it works

```
push to superz/* (any working branch)   →  CI: typecheck + tests + build (~3 min, no deploy)
push to main  (or PR merge)             →  full checks + D1 migrations + live deploy (~4 min)
Actions tab → "Deploy Production" → Run workflow  →  deploy ANY branch manually, on demand
```

- **Safety:** if typecheck, tests, or the build fail, the run stops and production stays on
  the last good version. A broken push can never take the live site down mid-pipeline.
- **Ordering:** production deploys queue (`concurrency: production-deploy`, never cancelled),
  so rapid pushes to main land in order.
- **Migrations:** `wrangler d1 migrations apply horse-registry --remote` runs before every
  deploy. It is idempotent — applied migrations are tracked inside D1 itself, so it is a
  no-op unless a new migration file was added.
- **Secrets on the worker** (`GEMINI_API_KEY`, `GEMINI_API_KEYS`, …) live in Cloudflare and
  are untouched by CI deploys. They persist across every deploy.
- **The deployed bundle is the same anti-theft build** as before: vite `--mode cloudflare`
  with terser (top-level mangling, 2 passes, console dropped, comments stripped, no
  sourcemaps) + minified HTML — exactly what `npm run build` has always produced.

## One-time setup (~5 minutes, GitHub web UI only)

### 1. Create the Cloudflare API token

1. Go to https://dash.cloudflare.com/profile/api-tokens → **Create Token**.
2. Use **Create Custom Token** with these permissions:

   | Scope | Permission |
   |---|---|
   | Account → Workers Scripts | Edit |
   | Account → D1 | Edit |
   | Account → Account Settings | Read |

   (Alternatively the **"Edit Cloudflare Workers"** template also covers D1.)
3. Account Resources: include the account that owns `horse-registry-nextgen`.
4. Create → copy the token value (shown once).

### 2. Add the GitHub repository secrets

On https://github.com/RogerAirs11/horse-registry → **Settings → Secrets and variables →
Actions → New repository secret**, add BOTH:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID (same one already noted in `.env.secrets`) |

> Note: the account ID is not secret (it is embedded in the committed AI-gateway URL in
> `wrangler.jsonc`), but keeping it as a secret matches the existing `.env.secrets` naming
> and keeps everything in one place.

### 3. Push and watch

Push anything to `main` (or merge a PR). Then check the **Actions** tab — you should see
`Deploy Production` run green in ~4 minutes and
https://horse-registry-nextgen.rogerfires10.workers.dev will be updated.

## Everyday workflows

| You want to… | Do this |
|---|---|
| Ship a change | Push/merge to `main`. That's it. |
| Try something risky | Work on a non-main branch — CI checks it, nothing deploys. |
| Deploy the working branch without merging | Actions → *Deploy Production* → *Run workflow* → pick the branch. |
| Roll back code | `git revert <sha>` on `main` + push — auto-deploys the previous state. |
| Roll back fast (no code change) | Cloudflare dashboard → Workers & Pages → `horse-registry-nextgen` → Deployments → previous version → **Rollback**. Or locally: `npx wrangler rollback` (needs `.env.secrets`). |
| Add an approval gate before go-live | Settings → Environments → `production` → add required reviewers. Then each push to main waits for a click. |

## What CI deliberately does NOT do

- **No SQLite import / registry data uploads.** Bulk data work (78k horses, demo seeding)
  stays a runbook operation — see `RECOVERY_RUNBOOK.md`, `scripts/d1-upload-resume.mjs` and
  the 100k/day D1 write-cap notes in PROJECT_CONTINUITY. Deploys ship *code + schema only*.
- **No Turso/Supabase replica sync.** `npm run db:sync` remains manual (R46 runbook).
- **No worker secret changes.** Set once via dashboard or `wrangler secret put`; they persist.

## Sandbox / local development role

The sandbox is now a **disposable editing environment** — nothing production-critical lives
only here:

- Every commit lives on GitHub; any fresh `git clone` + `npm install` + `.env`/`.env.secrets`
  restores a full dev environment.
- To let an agent session push to GitHub directly (instead of you pushing from your machine),
  put `GH_TOKEN=<token with repo contents read/write>` in `.env.secrets` and share that file
  with the session. Optional — CI/CD itself never needs it.
- To deploy manually from the sandbox/laptop (fallback path, rare): `.env.secrets` with
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, then `npm run build && npx wrangler deploy`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Action fails at "Apply D1 migrations" | Token lacks D1:Edit, or the `migrations/` dir is missing on that branch. |
| Action fails at deploy with auth error | `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets missing or expired. |
| Site unchanged after green run | Browser cache / worker version lag — verify the version on the dashboard Deployments page. |
| "Assert production configuration" failed | `wrangler.jsonc` on that branch has `APP_ENV: development` or a placeholder D1 id — fix the config, push again. |
