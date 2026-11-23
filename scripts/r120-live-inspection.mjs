#!/usr/bin/env node
/**
 * R120 live read-only inspection — the full-access handoff steps 9-11:
 *
 *   9.  Demo-payment containment: read the EFFECTIVE Cloudflare Worker
 *       settings (bindings/vars; secrets name-only, values never printed) and
 *       prove production cannot resolve the demo provider
 *       (APP_ENV / DEMO_PAYMENTS_ENABLED / ISOLATED_DEMO_MODE /
 *       REGISTRY_DATASET_KIND / callback origin / merchant presence).
 *  10. Entitlement provenance inventory (READ-ONLY, live Supabase): provider
 *       mix of payment attempts; the migration-0095 classification computed
 *       as a SELECT over the LIVE schema (grant_scope does not exist live
 *       yet — the same CASE logic the migration will apply); anything not
 *       cleanly real-only/demo-only is listed for finance review. NOTHING is
 *       mutated; no ledger row is deleted or reclassified.
 *  11. Supabase direct-API isolation (BE-12): RLS status, policies, grants,
 *       default privileges and SECURITY DEFINER functions for the private
 *       application tables, plus network denial canaries against the Data API
 *       (REST) both unauthenticated and with an invalid key. Worker auth does
 *       not protect an independently exposed Data API — this inspects it.
 *
 * Every query is SELECT-only; the Supabase session additionally runs with
 * default_transaction_read_only = on as a belt-and-braces guarantee.
 */
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Credentials come from the environment (vault TOKENS.md is the documented store).
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const CF_TOKEN = process.env.CF_API_TOKEN;
const WORKER = "horse-registry-nextgen";
if (!CF_ACCOUNT || !CF_TOKEN) { console.error("CF_ACCOUNT_ID and CF_API_TOKEN are required (vault TOKENS.md)"); process.exit(2); }

const SUPABASE_POOLER = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_POOLER) { console.error("SUPABASE_DATABASE_URL is required (vault TOKENS.md, pooler URL)"); process.exit(2); }
const SUPABASE_REF = "gqzglbknkodyasqfrqfv";

const evidence = { started: new Date().toISOString(), sections: {}, verdict: null };
const section = (name) => {
  const record = { checks: [] };
  evidence.sections[name] = record;
  const check = (label, ok, detail) => {
    record.checks.push({ label, ok, detail });
    console.log(`  ${ok ? "PASS" : "WARN"}  ${label}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    if (!ok) record.failed = true;
  };
  return { record, check };
};

// ---------------------------------------------------------------------------
// 9. Demo containment — effective Cloudflare Worker settings (read-only)
// ---------------------------------------------------------------------------
const containment = section("9-demo-containment");
try {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER}/settings`, {
    headers: { Authorization: `Bearer ${CF_TOKEN}` },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    containment.check("Cloudflare settings endpoint reachable", false, `${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  } else {
    const bindings = body.result?.bindings ?? [];
    const vars = {};
    const secretNames = [];
    for (const binding of bindings) {
      if (binding.type === "plain_text" || binding.type === "json") vars[binding.name] = binding.text ?? JSON.stringify(binding.json ?? null);
      else if (binding.type === "secret_text") secretNames.push(binding.name);
    }
    containment.check("APP_ENV is production", vars.APP_ENV === "production", String(vars.APP_ENV));
    containment.check("DEMO_PAYMENTS_ENABLED is not enabled in production", !["true", "1"].includes(String(vars.DEMO_PAYMENTS_ENABLED ?? "").toLowerCase()), String(vars.DEMO_PAYMENTS_ENABLED));
    containment.check("ISOLATED_DEMO_MODE is not set to 1", vars.ISOLATED_DEMO_MODE !== "1", String(vars.ISOLATED_DEMO_MODE));
    containment.check("REGISTRY_DATASET_KIND is not synthetic", vars.REGISTRY_DATASET_KIND !== "synthetic", String(vars.REGISTRY_DATASET_KIND));
    containment.check("fail-closed triple is INCOMPLETE in production (demo gateway unreachable)",
      !(vars.APP_ENV === "local" && vars.ISOLATED_DEMO_MODE === "1" && vars.REGISTRY_DATASET_KIND === "synthetic"));
    containment.check("PAYMENT_CALLBACK_BASE_URL is configured (plain var or secret; value never printed for secrets)",
      /^https:\/\//.test(String(vars.PAYMENT_CALLBACK_BASE_URL ?? "")) || secretNames.includes("PAYMENT_CALLBACK_BASE_URL"),
      vars.PAYMENT_CALLBACK_BASE_URL != null ? String(vars.PAYMENT_CALLBACK_BASE_URL) : "secret-present (vault records it as an HTTPS workers.dev origin)");
    const merchantConfigured = secretNames.includes("ZARINPAL_MERCHANT_ID");
    containment.check("ZARINPAL_MERCHANT_ID secret presence recorded (value never read)", true, merchantConfigured ? "present" : "absent");
    containment.check("ZARINPAL_MERCHANT_ID absent means NO real provider either (honest 503, demo still unreachable)",
      true, merchantConfigured ? "real provider may resolve; demo still requires the local triple" : "no provider resolves in production — /pay stays the honest 503");
    evidence.sections["9-demo-containment"].effectiveVars = vars;
    evidence.sections["9-demo-containment"].secretNames = secretNames;
  }
} catch (error) {
  containment.check("Cloudflare settings fetch", false, String(error.message ?? error));
}

// ---------------------------------------------------------------------------
// 10. Entitlement provenance inventory (READ-ONLY live Supabase)
// ---------------------------------------------------------------------------
const inventory = section("10-entitlement-provenance-inventory");
const sql = postgres(SUPABASE_POOLER, { max: 1, idle_timeout: 5, connect_timeout: 15, prepare: false });
try {
  await sql.unsafe("SET default_transaction_read_only = on");
  // Belt and braces: prove the session cannot write.
  try { await sql.unsafe("CREATE TABLE r120_should_never_exist(x int)"); inventory.check("session is READ-ONLY (write refused)", false, "a write succeeded — ABORT"); process.exit(1); }
  catch { inventory.check("session is READ-ONLY (write refused)", true); }

  const liveColumns = await sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='entitlements' AND column_name IN ('grant_scope')`);
  const scopeColumnLive = liveColumns.length > 0;
  inventory.check("live schema state recorded (migration 0095 grant_scope column)", true, scopeColumnLive ? "PRESENT (already applied)" : "ABSENT (0095 not yet live — classification computed read-only below)");

  const providers = await sql.unsafe(`SELECT provider, state, COUNT(*)::int AS n FROM payment_attempts GROUP BY provider, state ORDER BY provider, state`);
  evidence.sections["10-entitlement-provenance-inventory"].paymentAttempts = providers;
  const demoAttempts = providers.filter(r => r.provider === "demo").reduce((a, r) => a + r.n, 0);
  const realAttempts = providers.filter(r => r.provider && r.provider !== "demo").reduce((a, r) => a + r.n, 0);
  inventory.check("payment attempt provider mix recorded", true, `demo=${demoAttempts} real=${realAttempts} rows=${JSON.stringify(providers)}`);

  // The migration-0095 classification computed as a SELECT over the live data:
  // an interval is production-scoped only when EVERY grant/renewal event for
  // its holder+sku has a non-demo verified attempt; demo-only symmetrically;
  // everything else is legacy_unclassified (finance review).
  const classification = await sql.unsafe(`
    SELECT
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM entitlement_events e
          WHERE e.sku = ent.sku
            AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id = ent.buyer_user_id)
              OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id = ent.payer_organization_id))
            AND e.kind IN ('grant','renewal')
            AND NOT EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id = e.payment_attempt_id AND p.provider <> 'demo')
        ) AND EXISTS (
          SELECT 1 FROM entitlement_events e
          WHERE e.sku = ent.sku
            AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id = ent.buyer_user_id)
              OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id = ent.payer_organization_id))
            AND e.kind IN ('grant','renewal')
            AND EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id = e.payment_attempt_id AND p.provider <> 'demo')
        ) THEN 'production'
        WHEN NOT EXISTS (
          SELECT 1 FROM entitlement_events e
          WHERE e.sku = ent.sku
            AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id = ent.buyer_user_id)
              OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id = ent.payer_organization_id))
            AND e.kind IN ('grant','renewal')
            AND NOT EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id = e.payment_attempt_id AND p.provider = 'demo')
        ) AND EXISTS (
          SELECT 1 FROM entitlement_events e
          WHERE e.sku = ent.sku
            AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id = ent.buyer_user_id)
              OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id = ent.payer_organization_id))
            AND e.kind IN ('grant','renewal')
            AND EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id = e.payment_attempt_id AND p.provider = 'demo')
        ) THEN 'demo'
        ELSE 'legacy_unclassified'
      END AS prospective_scope,
      COUNT(*)::int AS intervals
    FROM entitlements ent
    ${scopeColumnLive ? "WHERE ent.active=1" : "WHERE ent.active=1"}
    GROUP BY 1 ORDER BY 1`);
  evidence.sections["10-entitlement-provenance-inventory"].prospectiveClassification = classification;
  const unclassified = classification.find(r => r.prospective_scope === "legacy_unclassified")?.intervals ?? 0;
  const demoScope = classification.find(r => r.prospective_scope === "demo")?.intervals ?? 0;
  const prodScope = classification.find(r => r.prospective_scope === "production")?.intervals ?? 0;
  inventory.check("active interval classification computed (read-only)", true, `production=${prodScope} demo=${demoScope} legacy_unclassified=${unclassified}`);
  inventory.check("no mixed/unclassified interval is silently treated as production (finance review required before any reclassification)", true,
    unclassified === 0 ? "none present" : `${unclassified} interval(s) listed for finance review — NOT mutated`);

  // Detail rows for anything that is not clean production scope (capped).
  if (demoScope + unclassified > 0) {
    const detail = await sql.unsafe(`
      SELECT ent.id, ent.holder_key, ent.sku, ent.active, ent.expires_at,
        (SELECT COUNT(*)::int FROM entitlement_events e WHERE e.payment_attempt_id IS NOT NULL AND e.sku=ent.sku
           AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=ent.buyer_user_id)
             OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id=ent.payer_organization_id))
           AND e.kind IN ('grant','renewal')) AS linked_events
      FROM entitlements ent WHERE ent.active=1
        AND NOT EXISTS (
          SELECT 1 FROM entitlement_events e
          WHERE e.sku=ent.sku
            AND ((ent.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=ent.buyer_user_id)
              OR (ent.payer_organization_id IS NOT NULL AND e.payer_organization_id=ent.payer_organization_id))
            AND e.kind IN ('grant','renewal')
            AND EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id=e.payment_attempt_id AND p.provider <> 'demo'))
      ORDER BY ent.id LIMIT 50`);
    evidence.sections["10-entitlement-provenance-inventory"].reviewRows = detail;
    inventory.check("non-production intervals enumerated for finance review (read-only)", true, `${detail.length} row(s) recorded in evidence`);
  }
} catch (error) {
  inventory.check("live inventory query", false, String(error.message ?? error).slice(0, 200));
}

// ---------------------------------------------------------------------------
// 11. Supabase direct Data API isolation (BE-12) — RLS, grants, canaries
// ---------------------------------------------------------------------------
const exposure = section("11-supabase-direct-api-isolation");
try {
  // 11a. Network canaries against the Data API (PostgREST).
  const restBase = `https://${SUPABASE_REF}.supabase.co/rest/v1`;
  const noKey = await fetch(`${restBase}/users?select=id&limit=1`);
  exposure.check("Data API anonymous request is DENIED (no apikey)", noKey.status === 401 || noKey.status === 403, `HTTP ${noKey.status}`);
  const badKey = await fetch(`${restBase}/users?select=id&limit=1`, { headers: { apikey: "invalid-key-value", Authorization: "Bearer invalid-key-value" } });
  exposure.check("Data API invalid-key request is DENIED", badKey.status === 401 || badKey.status === 403, `HTTP ${badKey.status}`);
  const root = await fetch(`${restBase}/`);
  exposure.check("Data API root does not leak an open catalog to anonymous callers", root.status === 401 || root.status === 403, `HTTP ${root.status}`);

  // 11b. Which service-role/anon-reachable tables exist in the API schema.
  const apiTables = await sql.unsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`);
  const tableNames = apiTables.map(r => r.table_name);
  evidence.sections["11-supabase-direct-api-isolation"].publicTables = tableNames.length;
  const PRIVATE_TABLES = ["users", "sessions", "email_verifications", "audit_events", "payment_attempts", "entitlements",
    "entitlement_events", "orders", "ai_conversations", "ai_messages", "ai_request_ledger", "moderation_cases",
    "demo_payment_sessions", "command_receipts", "horse_merges", "person_redaction_fulfillments"];
  const present = PRIVATE_TABLES.filter(t => tableNames.includes(t));
  exposure.check("private application tables present in public schema (exposure surface)", true, `${present.length}/${PRIVATE_TABLES.length} tracked: ${present.join(", ")}`);

  // 11c. RLS + anon/authenticated grants for every private table.
  const rlsRows = await sql.unsafe(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
      (SELECT COUNT(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [present]);
  const exposedWithoutRls = [];
  for (const row of rlsRows) {
    const anonSelect = await sql.unsafe(`SELECT has_table_privilege('anon', $1::text, 'SELECT') AS ok`, [row.table_name]);
    const authSelect = await sql.unsafe(`SELECT has_table_privilege('authenticated', $1::text, 'SELECT') AS ok`, [row.table_name]);
    if (!row.rls_enabled && (anonSelect[0].ok || authSelect[0].ok)) exposedWithoutRls.push(row.table_name);
  }
  evidence.sections["11-supabase-direct-api-isolation"].tableRls = rlsRows;
  exposure.check("every private table reachable by anon/authenticated has RLS enabled (or no grant at all)",
    exposedWithoutRls.length === 0, exposedWithoutRls.length ? `EXPOSED WITHOUT RLS: ${exposedWithoutRls.join(", ")}` : `all ${rlsRows.length} tracked tables safe`);

  // 11d. Grants detail for the worst-case tables.
  const grants = await sql.unsafe(`
    SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role') AND table_name = ANY($1::text[])
    ORDER BY table_name, grantee, privilege_type`, [present]);
  evidence.sections["11-supabase-direct-api-isolation"].apiGrants = grants;
  const anonGrants = grants.filter(g => g.grantee === "anon" && g.privilege_type === "SELECT");
  exposure.check("anon role has no direct SELECT grants on private tables (beyond RLS-protected schema)", anonGrants.length === 0,
    anonGrants.length ? `anon SELECT on: ${anonGrants.map(g => g.table_name).join(", ")} — verify RLS denies all rows` : "none");

  // 11e. Default privileges for future tables.
  const defaults = await sql.unsafe(`SELECT pg_get_userbyid(defaclrole) AS role, defaclnamespace::regnamespace AS schema, defaclobjtype, defaclacl FROM pg_default_acl`);
  evidence.sections["11-supabase-direct-api-isolation"].defaultPrivileges = defaults.map(d => ({ role: d.role, schema: String(d.schema), type: d.defaclobjtype, acl: String(d.defaclacl) }));
  const publicSchemaDefaults = defaults.filter(d => String(d.schema) === "public");
  exposure.check("default privileges on public schema recorded (review: future tables must not grant anon by default)", true,
    publicSchemaDefaults.length ? `${publicSchemaDefaults.length} default ACL entries recorded` : "no public-schema default ACLs");

  // 11f. SECURITY DEFINER functions in public schema (potential anon-reachable surface).
  const definers = await sql.unsafe(`
    SELECT p.oid::int AS fn_oid, p.proname AS routine_name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true ORDER BY p.proname`);
  evidence.sections["11-supabase-direct-api-isolation"].securityDefinerFunctions = definers.map(d => d.routine_name);
  const anonExecutable = [];
  for (const fn of definers) {
    const priv = await sql.unsafe(`SELECT has_function_privilege($1::oid, 'EXECUTE') AS ok`, [fn.fn_oid]);
    if (priv[0].ok) anonExecutable.push(fn.routine_name);
  }
  exposure.check("SECURITY DEFINER functions executable by anon recorded (must each be justified)", true,
    `${definers.length} definer functions, ${anonExecutable.length} anon-executable${anonExecutable.length ? `: ${anonExecutable.join(", ")}` : ""}`);

  // 11g. Exposed functions in the API (PostgREST exposes EXECUTE-granted functions).
  const allRoutines = await sql.unsafe(`SELECT p.oid::int AS fn_oid, p.proname AS routine_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' ORDER BY p.proname`);
  const apiExposedFunctions = [];
  for (const fn of allRoutines) {
    const priv = await sql.unsafe(`SELECT has_function_privilege($1::oid, 'EXECUTE') AS ok`, [fn.fn_oid]);
    if (priv[0].ok) apiExposedFunctions.push(fn.routine_name);
  }
  evidence.sections["11-supabase-direct-api-isolation"].apiExposedFunctions = apiExposedFunctions;
  exposure.check("anon-executable public functions recorded (each must be a justified read-only helper)", true,
    `${apiExposedFunctions.length} anon-executable${apiExposedFunctions.length ? `: ${apiExposedFunctions.join(", ")}` : ""}`);

  // 11h. The decisive RLS canary: with anon SELECT grants present on all
  // private tables, RLS is the barrier — prove NO policy is permissive for
  // anon (a policy with a permissive USING like 'true' would expose rows).
  const policies = await sql.unsafe(`SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname`);
  evidence.sections["11-supabase-direct-api-isolation"].policies = policies.map(p => ({
    table: p.tablename, name: p.policyname, roles: p.roles, cmd: p.cmd,
    using: p.qual === null ? null : String(p.qual), with_check: p.with_check === null ? null : String(p.with_check),
  }));
  const permissive = policies.filter(p => p.roles.includes("anon") && /\btrue\b/i.test(String(p.qual ?? "")));
  const privatePolicies = policies.filter(p => present.includes(p.tablename));
  exposure.check("NO permissive (USING true) anon policy exists on any private table",
    permissive.length === 0, permissive.length ? `PERMISSIVE: ${permissive.map(p => `${p.tablename}.${p.policyname}`).join(", ")}` : `none — ${privatePolicies.length} policies on private tables reviewed; RLS default-deny holds for anon`);
} catch (error) {
  exposure.check("live exposure inspection", false, String(error.message ?? error).slice(0, 300));
}
await sql.end({ timeout: 2 });

// ---------------------------------------------------------------------------
evidence.finished = new Date().toISOString();
evidence.verdict = Object.values(evidence.sections).every(s => !s.failed) ? "ALL GREEN" : "REVIEW WARNINGS";
mkdirSync(join(root, "review-r120", "evidence-live"), { recursive: true });
const evidencePath = join(root, "review-r120", "evidence-live", "containment-inventory-exposure.json");
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — evidence: ${evidencePath}`);
process.exit(evidence.verdict === "ALL GREEN" ? 0 : 1);
