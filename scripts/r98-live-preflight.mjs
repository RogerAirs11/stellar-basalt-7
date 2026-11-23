#!/usr/bin/env node
/* R98 live preflight (read-only, PostgreSQL equivalent of tools/r98-preflight.py):
 * checks the CANONICAL Supabase database for the 0071 blocker (duplicate active
 * issuer memberships) and the R98 review classes before any migration is applied.
 * Read-only: a single read-only transaction; nothing is written. */
import postgres from "postgres";
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("SUPABASE_DATABASE_URL required"); process.exit(2); }
const sql = postgres(url, { max: 1, connect_timeout: 15, idle_timeout: 5 });
try {
  const report = await sql.begin("read only", async (tx) => {
    const version = (await tx`SELECT current_setting('server_version') AS v`)[0].v;
    const migrations = await tx`SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT substring(tablename FROM 1 FOR 4) AS m FROM pg_tables WHERE schemaname='public' AND tablename ~ '^[0-9]{4}_') t`.catch(() => [{ n: -1 }]);
    // The migration ledger table (if the deploy uses one) or infer from schema markers.
    const ledger = await tx`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='d1_migrations'`.catch(() => [{ n: 0 }]);
    const dupActive = await tx`SELECT issuer_id, user_id, COUNT(*)::int AS n FROM issuer_memberships WHERE status='active' GROUP BY issuer_id, user_id HAVING COUNT(*) > 1`;
    const invalidDates = await tx`SELECT id FROM issuer_memberships WHERE valid_from IS NULL OR (valid_until IS NOT NULL AND valid_until <= valid_from)`;
    const inconsistent = await tx`SELECT id FROM issuer_memberships WHERE status='active' AND revoked_at IS NOT NULL`;
    const badPublish = await tx`SELECT d.id FROM directory_profiles d WHERE d.publication_consent = 1 AND (d.published_at IS NULL OR d.published_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}:[0-9]{2})?')`;
    const legacyAuthority = await tx`SELECT COUNT(*)::int AS n FROM person_credentials WHERE verification_state='issuer_attested'`;
    const profiles = await tx`SELECT COUNT(*)::int AS n FROM directory_profiles`;
    const horses = await tx`SELECT COUNT(*)::int AS n FROM horses WHERE deleted_at IS NULL`;
    const attestations = await tx`SELECT COUNT(*)::int AS n FROM attestations`;
    const memberships = await tx`SELECT COUNT(*)::int AS n FROM issuer_memberships`;
    const r98Columns = await tx`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('province_code_scheme','release_operation_id') AND table_name IN ('directory_profiles','service_requests','service_request_holds')`;
    return {
      server: version, ledgerTable: ledger[0].n,
      duplicate_active_memberships: dupActive.length,
      duplicate_detail: dupActive.slice(0, 10),
      invalid_membership_dates: invalidDates.length,
      inconsistent_revocations: inconsistent.length,
      corrupt_publication_dates: badPublish.length,
      legacy_issuer_attested_credentials: legacyAuthority[0].n,
      counts: { profiles: profiles[0].n, horses: horses[0].n, attestations: attestations[0].n, issuer_memberships: memberships[0].n },
      r98_columns_present: r98Columns[0].n,
      blocker: dupActive.length > 0,
    };
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.blocker ? 1 : 0;
} finally { await sql.end({ timeout: 5 }); }
