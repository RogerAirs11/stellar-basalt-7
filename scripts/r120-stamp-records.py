#!/usr/bin/env python3
"""R120 closeout: stamp TODO.md, CHANGELOG.md, PROJECT-MEMORY.md with the R120 round record."""
import re

# ---------------- TODO.md ----------------
todo = open('TODO.md').read()
r120_block = """# R120 — Master AI R119 audit + remediation integration round (2026-10-22)

**What arrived:** the Master AI R119 audit (54 findings, 65 implementation tasks — `Implementation-Plan.json` at the vault `master-ai/R120/`) plus Master AI's OWN first remediation pass (their commit c39e5551 on a pristine baseline identical to our R119 export 5b8837f): IMP-008 demo-payment fail-closed isolation, IMP-009 entitlement grant provenance (migration 0095), IMP-013 shared evidence-access policy, IMP-014 atomic password reset (0093), IMP-006 partial SQL portability (0094), IMP-017 strict UTC parsing, IMP-018 structured search parity, IMP-033/034/035 pedigree + genetics corrections, IMP-063 Retro mobile CSS scoping. Their sandbox could not run npm (DNS EAI_AGAIN), so the full-access follow-on sequence was ours to execute.

**Integration (commit 9712aa4):** the remediation patch applied cleanly onto 5b8837f and was byte-verified identical to their remediated source zip (42 files, +875/-156).

**Full-access gate round (the handoff's exact order):** npm ci; typechecks x4 (0 errors after re-pinning the advanced algorithm-version fixtures 1.0.0 -> 1.1.0 and the newline-formatted reset SQL matcher — Master AI could not run vitest in their sandbox); focused unit 100/100; focused integration 35/35; TZ-repeat 63/63 x UTC/Tehran/Sao_Paulo; r95 83/83, r108 129/129, r98 135/135 native; python 263/263; FULL vitest 1813/0 (+11 new tests vs R119); production build + dist asset validation green with ORIGINAL assets.

**Follow-on defects found and fixed by the gates (all with tests):**
1. Migration 0096 (rebuild pattern of 0089): 0084's CHECK on demo_payment_sessions.failure_reason never included 'invalid_expiry_timestamp' — the remediation's own new quarantine regression caught that the quarantine UPDATE itself failed before the honest 410.
2. Env-bound grant scope (IMP-009 follow-over): hard-coded grant_scope='production' in every gate made the ISOLATED DEMO's own paid journeys meaningless (demo grants could neither unlock the demo plan nor make an expired demo workspace read-only). New src/commerce/entitlementScope.ts: the isolated demo triple gates on its own demo-scope plan; every other environment stays production-only. Bidirectional regression: same DB + workspace + expired demo entitlement -> demo env 403 workspace_plan_expired, production env 201 (free-tier org, not plan-gated by a demo grant).
3. moderation caseDetail corrected to the role-based staff view: the IMP-013 evidence policy belongs on the marketplace EVIDENCE path (COM-02), not the moderation workflow surface (queue-before-assignment + resolved-case audit; decide-but-cannot-view was unworkable). Evidence path unchanged and still tested.
4. r108 seed fixtures modernized with explicit grant_scope='production' + provider_name='zarinpal' (what 0095's classifier derives from a real-provider attempt).

**IMP-012 (BE-13) — graph mutation serialization, fully executed with real two-connection PostgreSQL evidence:** graph-wide transaction advisory lock (namespace 710110, distinct from the AI admission lock) acquired in a SEPARATE statement before any guard read (the AI-reservation pattern); threaded through runGuardedHorseBatch(graphLock) with sliced result indexing (direct edit + change-request apply when parentageChanged) and prepended in merge/unmerge; bounded wait (SET LOCAL lock_timeout=5s) surfacing as recoverable 409 pedigree_edit_busy. Evidence scripts/r120-imp012-graph-barrier.mjs on embedded PostgreSQL 18.4, all 96 migrations through the production translator: R1 the unlocked opposite-edge race REPRODUCES (both commit, cycle survives), B1 barrier exactly-one-commit + no cycle + revision bumped once, B2 three-horse cycle, B3 reviewed-vs-direct + decision CAS never approves an unlanded update, B4 rollback releases, B5 bounded wait 1002ms -> 55P03 recognized — 22/22 PASS ALL GREEN (review-r120/evidence-local/imp012-graph-barrier.json).

**REAL production bug found by the barrier:** the parentage cycle guard's two-branch recursive CTE (father UNION mother) DOES NOT PARSE on PostgreSQL ("recursive reference ... must not appear within its non-recursive term") and passed through the translator unchanged — every live parentage edit on Supabase PG would have errored. Rewritten to the portable single-branch CASE form (valid on both engines, identical ancestor closure); python replay copy re-pinned; SQLite re-verified.

**IMP-014 acceptance — real-adapter failure injection (46/46 PASS, BOTH adapters):** poison statement substituted at each position (claim/rotate/revoke) inside the REAL adapter transaction (local SQLite with all migrations + the production PostgreSQL adapter): failure always surfaces, password/sessions/token-consumption always roll back, token remains reusable and the clean retry completes the reset (scripts/r120-imp014-reset-failure-injection.mjs).

**IMP-006 PostgreSQL parity (partial task -> both gates green):** db:pg-parity 96/96 migrations translated + applied on disposable PostgreSQL 18.4; db:pg-execution-parity PASS (SQLite-vs-PG transcript comparison). Actual deployed Supabase PG major-version qualification still listed under IMP-018's golden-corpus follow-up.

**Live read-only inspection (the handoff's steps 9-11, scripts/r120-live-inspection.mjs):**
- Demo containment: APP_ENV=production, ISOLATED_DEMO_MODE/REGISTRY_DATASET_KIND unset -> the fail-closed triple is INCOMPLETE in production (demo settlement unreachable even with the flag on). FOUND: the live worker still carried DEMO_PAYMENTS_ENABLED="1" from before the remediation -> FIXED to "0" via the CF settings echo-back PATCH (all other bindings preserved, live health 200; evidence review-r120/evidence-live/demo-flag-containment-fix.json).
- Entitlement provenance inventory (read-only, session forced read-only): live payment attempts are demo=1/real=0; the migration-0095 classification computed as a SELECT over the live schema: production=0, demo=1, legacy_unclassified=0 — no mixed histories; the single demo interval is listed for finance review. No ledger row mutated.
- Supabase direct Data API isolation (BE-12): Data API denies anonymous + invalid-key (401 x3); all 15 private application tables have RLS enabled; anon holds SELECT grants but ZERO policies exist -> RLS default-deny holds (proven, not assumed); the rls_auto_enable event trigger auto-enables RLS on every future public table; 1 SECURITY DEFINER function (the protective event trigger, not directly callable); 24 anon-executable functions recorded (internal __assign_* identity helpers — REVOKE-follow-up noted below); 6 default ACL entries recorded.

**IMP-063 Retro mobile — real-browser qualification with original assets (ALL GREEN):** isolated synthetic demo (28 horses — the audit's exact dataset), widths 320/390/720/721: .table-scroll display:block (the heritage rule no longer leaks), 8/8/22/22 VISIBLE records with real bounding boxes, records OPENABLE (click -> horse detail renders), 0 page errors; heritage's own mobile design intact at 390 (its scoped rule still applies to its own frontend, records surface through the designed layout). Evidence + screenshots: review-r120/evidence-local/retro-mobile/.

**NOT deployed:** live stays 0.68.0 / migrations through 0092 (live schema probe confirms 0093-0096 not yet applied). Deployment of this tree requires the standard live-migration round (backup -> rehearsal -> attested application -> probe -> deploy) once the owner approves the release; Actions remains billing-blocked.

**Remaining from the audit's P1 list (IMP-010/011/015/016/019/020/021/023/024/025/026/027/031/032/036/037 and the broader parity/localization work) — not started this round; the audit's Implementation-Plan.json is the standing task graph.** New follow-ups recorded: REVOKE anon EXECUTE on the 24 internal helper functions (live hardening, owner-gated like all live mutations beyond the containment flag); IMP-018's golden search corpus + EXPLAIN on the deployed PG major; owner finance review of the single demo entitlement interval (read-only inventory above).

---

"""
todo = r120_block + todo
open('TODO.md', 'w').write(todo)
print("TODO.md stamped")

# ---------------- CHANGELOG.md ----------------
changelog = open('CHANGELOG.md').read()
entry = """# R120 — Master AI R119 remediation integrated + full-access qualification — 2026-10-22 (NOT deployed)

Master AI's R119 audit remediation pass (IMP-006/008/009/013/014/017/018/033/034/035/063) integrated byte-verified onto 5b8837f, plus the full-access follow-on execution their sandbox could not run.

- **Gates at this tree:** typechecks x4, full vitest 1813/0 (+11), python 263/263, r95 83/83, r108 129/129, r98 135/135, TZ x3, production build + dist with ORIGINAL assets, db:pg-parity 96/96, db:pg-execution-parity PASS.
- **New migrations 0093-0096** (0093 atomic reset claim + 0094 audit operation_id + 0095 grant provenance from the remediation; 0096 demo failure_reason CHECK widened by our gate round). Live NOT yet migrated (still 0092).
- **IMP-012 executed:** graph-wide advisory-lock serialization for pedigree mutations (direct edit, change-request apply, merge, unmerge) with real two-connection PostgreSQL 18.4 barrier evidence — the unlocked write-skew REPRODUCED, then blocked 22/22 (exactly-one-commit, no cycle, rollback release, bounded 5s wait -> 409 pedigree_edit_busy).
- **Real production bug fixed:** the parentage cycle guard's two-branch recursive CTE did not parse on PostgreSQL (latent on live since parentage edits existed — every live parentage edit would have errored); rewritten portable single-branch form, verified on both engines.
- **IMP-014 acceptance:** real-adapter failure injection 46/46 on local SQLite + the production PG adapter — any thrown statement inside the reset transaction rolls everything back; the token stays reusable.
- **Live containment (read-only + one flag):** production cannot resolve demo settlement (fail-closed triple incomplete — verified against effective Cloudflare settings); the stale live DEMO_PAYMENTS_ENABLED="1" aligned to the remediated "0"; entitlement inventory: demo=1 interval (finance review listed), no mixed histories; Supabase Data API: anonymous denied, all 15 private tables RLS default-deny (zero policies), protective rls_auto_enable event trigger confirmed.
- **IMP-063 qualified:** Retro mobile registry at 320/390/720/721 — visible + openable nonempty records with original assets (8 visible at mobile widths — the audit's exact 0->8 diagnostic), heritage's own scoped mobile design intact.

"""
changelog = entry + changelog
open('CHANGELOG.md', 'w').write(changelog)
print("CHANGELOG.md stamped")

# ---------------- PROJECT-MEMORY.md ----------------
memory = open('PROJECT-MEMORY.md').read()
stamp = """

## R120 — Master AI R119 remediation round (2026-10-22)

- Master AI delivered audit (54 findings / 65 tasks) + their own first remediation pass (10 IMP items); we integrated it byte-verified and ran the full-access sequence their sandbox (no npm DNS) could not.
- The evidence-first discipline paid for itself twice: the remediation's OWN new quarantine regression caught migration 0084's CHECK gap (fixed by 0096), and the IMP-012 barrier REPRODUCED the write-skew first — then found the parentage cycle guard NEVER PARSED on PostgreSQL (two-branch recursive CTE). Always reproduce, then barrier.
- Env-bound grant scope lesson (IMP-009 follow-over): production-only hard-coding is correct for production but breaks the isolated demo's honest paid-journey story; the accepted scope must follow the SAME strict environment triple as the demo gateway itself — default stays production (fail-closed).
- The moderation WORKFLOW surface (caseDetail) and private-conversation EVIDENCE (marketplace path) are different authorization domains; the evidence policy (assigned operator / super_admin / active case) belongs only on the latter.
- Live inspection patterns that worked: CF settings GET/PATCH echo-back (multipart "settings" part) for the one-flag containment fix; SET default_transaction_read_only for belt-and-braces read-only sessions; has_table_privilege/has_function_privilege with explicit ::text/::oid casts through the session pooler (the text form of has_function_privilege REQUIRES the argument list — use the OID form).
- Single-browser-context + viewport resize per width (the R117 nav-matrix pattern) is the reliable way to run the isolated demo multi-width checks — per-width contexts destabilized the single demo server.
- Embedded PostgreSQL 18.4 (staging/pgembedded) + esbuild transpile-only bundling (type-only imports erased) beats the ts-runtime loader for harnessing modules whose type graphs don't fit standalone tsc settings.
- Open follow-ups: the audit's remaining P1 graph (IMP-010/011/015/016/019/020/021/023-027/031/032/036/037), REVOKE anon EXECUTE on 24 internal helper functions (live, owner-gated), IMP-018 golden search corpus + EXPLAIN on the deployed PG major, finance review of the single demo entitlement interval, and the R120 release deployment (migrations 0093-0096 live round + manual wrangler; Actions still billing-blocked).
"""
memory = memory + stamp
open('PROJECT-MEMORY.md', 'w').write(memory)
print("PROJECT-MEMORY.md stamped")
