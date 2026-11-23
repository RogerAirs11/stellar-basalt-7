# Local demo: load the real client registry

## Why the previous local run looked empty

`python tools/import_xlsx.py ...` creates a canonical SQLite file under `data/generated/`, but `npm run dev` does **not** query that file. The dev Worker queries Wrangler's own local D1 database. The previous setup seeded Wrangler D1 with only the tiny synthetic fixture, so real horse searches returned nothing even though the full XLSX import itself had succeeded.

The new bootstrap script fixes that gap by importing the workbook, generating safe D1 SQL shards, loading those shards into Wrangler local D1, and creating a local-only administrator.

## One-time local client bootstrap

From the project root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-client-local.ps1 -Workbook .\horse-allll.xlsx
```

The script will:

1. Import and validate the XLSX.
2. Generate D1 data shards.
3. Apply local migrations.
4. Replace the synthetic local D1 data with the client registry.
5. Prompt you to choose a local admin password.
6. Create local admin `admin@local.test`.
7. Print the final D1 counts.

Nothing in this command uploads data to Cloudflare.

Then run:

```powershell
npm run dev
```

Open `http://localhost:5173`.

Expected top-bar state: approximately **78,089 records** and a green registry-status dot.

## Admin login

- Email: `admin@local.test`
- Password: the password you chose during bootstrap

The local admin password is not committed to source and the temporary SQL containing its hash is deleted after insertion.

## UI paths

- `/` — unified fuzzy/mixed-field search
- `/browse` — paginated database table
- `/horse/<HorseNo>` — horse profile + pedigree
- `/admin` — administration console

## Safety note

The bootstrap script is intentionally **local-only**. Production Cloudflare setup must create a different production admin password and must not reuse local demo credentials.
