#!/usr/bin/env bash
# LEAN core-code export of horse-registry for external AI re-review (R78, per owner:
# "only what actually matters regarding the actual real code that exposes our core
# features and capabilities — exclude as much as you can").
#
# INCLUDED (the app itself):
#   src/            — worker, API routes, auth, AI stack, pedigree engine, registry,
#                     search, security, db layer, contracts, frontend-kit, the five
#                     React frontends, web entry (ts/tsx/js/json/html only)
#   migrations/     — the canonical database schema (the data model = core features)
#   standalone-frontends/classic-v1.4/public/ui/ — the Classic donor app (vanilla JS,
#                     real feature surface: market, records, admin, i18n)
#   package.json, tsconfig*.json, .env.example — dependency/module/config surface
#   IMPLEMENTATION-STATUS-R76.md — ticket-by-ticket response to both AI packages
#
# EXCLUDED (available in the full repo on request): tests, scripts, tools, supabase,
#   .github CI, ALL CSS (decoration), web/assets (images/fonts), public/ + dist/
#   (build outputs), docs, audit packages, seed data, lockfile, launchers.
set -euo pipefail

REPO=/home/z/my-project/repos/horse-registry
STAGE_ROOT=/home/z/my-project/staging
STAGE="$STAGE_ROOT/horse-registry"
COMMIT=$(cd "$REPO" && git rev-parse --short HEAD)
OUT=/home/z/my-project/download/horse-registry-core-code_R78_${COMMIT}.zip

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE" /home/z/my-project/download

# --- THE APP: src, code files only (no assets, no styles, no docs) ---
rsync -a \
  --exclude='/web/assets/' \
  --exclude='/web/styles/' \
  --exclude='*.md' \
  --exclude='*.txt' \
  --exclude='*.svg' \
  --exclude='*.webp' \
  --exclude='*.avif' \
  --exclude='*.woff2' \
  --exclude='*.css' \
  "$REPO/src/" "$STAGE/src/"

# --- THE DATA MODEL: canonical migration chain ---
rsync -a "$REPO/migrations/" "$STAGE/migrations/"

# --- Classic donor app: ui source only ---
mkdir -p "$STAGE/standalone-frontends/classic-v1.4/public"
rsync -a --exclude='*.md' --exclude='*.txt' --exclude='*.wav' --exclude='*.WAV' \
  "$REPO/standalone-frontends/classic-v1.4/public/ui/" \
  "$STAGE/standalone-frontends/classic-v1.4/public/ui/"

# --- config surface (what the code needs / declares) ---
(cd "$REPO" && cp --parents package.json tsconfig.json tsconfig.backend-core.json \
  tsconfig.frontend-kit.json tsconfig.pedigree.json .env.example "$STAGE/")

# --- the response document + provenance ---
cp "$REPO/audit/2026-10-02/IMPLEMENTATION-STATUS-R76.md" "$STAGE/IMPLEMENTATION-STATUS-R76.md"
cat > "$STAGE/PACKAGE-INFO.txt" <<EOF
Horse Registry — LEAN core-code export @ $COMMIT (R78, 2026-10-03)
Read IMPLEMENTATION-STATUS-R76.md first (ticket-by-ticket response to both AI packages).

THE APP
- src/worker.ts        Cloudflare Worker entry (routing, security headers)
- src/api/routes.ts    every REST endpoint (~50 routes)
- src/api/             auth, claims/change-requests (conditioned atomic review
                       batches), competitions, marketplace, media, admin
- src/ai/              Gemini/DeepSeek/offline providers, relay, model catalog,
                       conversation store, AES-256-GCM key envelopes, tools
- src/pedigree/        pedigree/relationship/inbreeding engine, breeding analysis
- src/db/              Supabase-PG (Hyperdrive) + D1 + Turso layers, SQL translator
- src/contracts/ + src/frontend-kit/  typed contracts + shared record-module loaders
- src/web/             the five React frontends (Heritage/Core, EquiData, Retro
                       Astra, FEI, Classic embedded) + i18n + platform client
- standalone-frontends/classic-v1.4/public/ui/  Classic donor app (vanilla JS)
- migrations/          canonical schema (30 SQL files, both providers)
Stack: Cloudflare Worker + Vite + React + TypeScript; bilingual EN/FA.

DELIBERATELY EXCLUDED (in the full repo): tests/ (182 vitest + 48 python),
scripts/ + tools/ (validators, parity gate, seed, build tooling), .github/ CI,
ALL CSS (presentation only), web/assets (images/fonts), public/ + dist/ (built
outputs), docs/, audit/ bundles, seed data, lockfile.
This is a READING package — do not expect npm run build to pass without styles.

Verify against the live app: https://horse-registry-nextgen.rogerfires10.workers.dev
EOF

# --- FINAL PURGE GATE: no binaries, no css, no md (except status doc), no empty dirs ---
find "$STAGE" -type f \( -name '*.webp' -o -name '*.avif' -o -name '*.woff2' -o -name '*.woff' \
  -o -name '*.ttf' -o -name '*.otf' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \
  -o -name '*.gif' -o -name '*.wav' -o -name '*.WAV' -o -name '*.mp3' -o -name '*.glb' \
  -o -name '*.xlsx' -o -name '*.sqlite' -o -name '*.svg' -o -name '*.css' \) -delete
find "$STAGE" -type f -name '*.md' ! -name 'IMPLEMENTATION-STATUS-R76.md' -delete
find "$STAGE" -depth -type d -empty -delete
mkdir -p "$STAGE"

# --- VERIFICATION GATES ---
echo "=== 1. File type audit (code/text only) ==="
find "$STAGE" -type f | sed "s/.*\.//" | sort | uniq -c | sort -rn

echo ""
echo "=== 2. Binary / oversized check ==="
find "$STAGE" -type f -size +300k -exec ls -lh {} \; || true
echo "(none above = clean)"

echo ""
echo "=== 3. Secret scan (must be CLEAN) ==="
grep -rEl "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|cfat_[A-Za-z0-9]{20,}|sbp_v0_[A-Za-z0-9]{20,}|eyJhbGciOiJFZERTQS|AIzaSy[A-Za-z0-9_-]{30,}" "$STAGE" 2>/dev/null || echo "CLEAN — no secrets"

echo ""
echo "=== 4. Counts ==="
echo "files: $(find "$STAGE" -type f | wc -l)"
du -sh "$STAGE"

# --- BUILD ZIP ---
(cd "$STAGE_ROOT" && zip -r -q -9 "$OUT" horse-registry)
echo ""
echo "=== ZIP BUILT ==="
ls -lh "$OUT"
unzip -l "$OUT" | tail -2
