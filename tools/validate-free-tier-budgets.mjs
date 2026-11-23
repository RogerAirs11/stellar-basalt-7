#!/usr/bin/env node
/**
 * D03 — Free-tier budget drift validator.
 *
 * Fails if any launch envelope drifts upward without explicit review, or if any
 * route/client/meta constant contradicts the shared server constants. Wired into
 * `npm run check` so drift cannot reach a release silently.
 *
 * Launch envelopes under guard:
 *   synchronous registry export      500 rows
 *   change-request items              24
 *   live relationship graph          512 nodes per horse
 *   descendant analysis            1,000 nodes
 *   synchronous reindex processing    3 jobs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const contract = read("src/contracts/platform.ts");
const routes = read("src/api/routes.ts");
const client = read("src/frontend-kit/platformClient.ts");
const mock = read("src/frontend-kit/mockPlatformClient.ts");
const worker = read("src/worker.ts");
const classify = read("src/security/classify.ts");
const rateLimit = read("src/security/rateLimit.ts");
const wrangler = read("wrangler.jsonc");
const envTypes = read("src/types/cloudflare-env.d.ts");
const packageJson = JSON.parse(read("package.json"));

// --- Shared contract constants -------------------------------------------------
const exportMax = Number(contract.match(/REGISTRY_EXPORT_ROWS_MAX\s*=\s*(\d+)/)?.[1]);
const itemsMax = Number(contract.match(/CHANGE_REQUEST_ITEMS_MAX\s*=\s*(\d+)/)?.[1]);
check(exportMax === 500, `REGISTRY_EXPORT_ROWS_MAX drifted to ${exportMax} (launch envelope: 500)`);
check(itemsMax === 24, `CHANGE_REQUEST_ITEMS_MAX drifted to ${itemsMax} (launch envelope: 24)`);

// --- Server export route bound to the shared constant ---------------------------
check(/defaultLimit:\s*REGISTRY_EXPORT_ROWS_MAX,\s*maxLimit:\s*REGISTRY_EXPORT_ROWS_MAX/.test(routes),
  "server export route no longer uses defaultLimit/maxLimit = REGISTRY_EXPORT_ROWS_MAX");
// R117-20: the change-request Zod schemas moved to src/api/modules/changeRequests.ts.
check(/items:\s*z\.array\([\s\S]*?\)\.max\(CHANGE_REQUEST_ITEMS_MAX\)/.test(read("src/api/modules/changeRequests.ts")),
  "change-request items Zod schema no longer bounded by CHANGE_REQUEST_ITEMS_MAX");

// --- Platform meta advertises the ceilings --------------------------------------
check(/registryExportRowsMax:\s*REGISTRY_EXPORT_ROWS_MAX/.test(routes),
  "/api/platform/meta limits no longer advertise registryExportRowsMax");
check(/changeRequestItemsMax:\s*CHANGE_REQUEST_ITEMS_MAX/.test(routes),
  "/api/platform/meta limits no longer advertise changeRequestItemsMax");
check(/registryExportRowsMax:\s*number/.test(contract) && /changeRequestItemsMax:\s*number/.test(contract),
  "PlatformLimits contract lacks registryExportRowsMax/changeRequestItemsMax fields");
check(/registryExportRowsMax:\s*REGISTRY_EXPORT_ROWS_MAX/.test(mock) && /changeRequestItemsMax:\s*CHANGE_REQUEST_ITEMS_MAX/.test(mock),
  "mock client meta limits do not advertise the shared export/change-request ceilings");

// --- Client/mock constants must not contradict the server ------------------------
check(/limit:\s*REGISTRY_EXPORT_ROWS_MAX/.test(client) && /maxRows:\s*REGISTRY_EXPORT_ROWS_MAX/.test(client),
  "frontend-kit export client no longer uses REGISTRY_EXPORT_ROWS_MAX");
check(/limit",\s*String\(REGISTRY_EXPORT_ROWS_MAX\)/.test(mock) && /maxRows:\s*REGISTRY_EXPORT_ROWS_MAX/.test(mock),
  "mock export client no longer uses REGISTRY_EXPORT_ROWS_MAX");
for (const [name, source] of [["platformClient", client], ["mockPlatformClient", mock]]) {
  // Whitelist basis-point arithmetic (percent helpers legitimately multiply/divide by 10,000/100).
  const withoutBasisPoints = source.replace(/\*\s*10_?000\s*\)\s*\/\s*100/g, "PERCENT");
  check(!/10000|10_000/.test(withoutBasisPoints), `${name} still advertises a 10,000-row export/pedigree ceiling`);
}
check(/pedigreeDescendantMetricsNodesMax:\s*1000\b/.test(mock), "mock pedigreeDescendantMetricsNodesMax contradicts the shared 1,000-node server ceiling (P03 drift)");

// --- Relationship graph / descendant analysis / reindex envelopes ----------------
const relationshipNodes = Number(routes.match(/analyzeRelationship\(env\.DB,\s*from,\s*to,\s*depth,\s*(\d+)\)/)?.[1]);
check(relationshipNodes === 512, `live relationship graph budget drifted to ${relationshipNodes} nodes/horse (launch envelope: 512)`);
const descendantCaps = [...routes.matchAll(/parseBoundedIntegerParam\(url\.searchParams\.get\("max"\),\s*(\d+),\s*(\d+),\s*(\d+),\s*"max"\)/g)]
  .map((m) => ({ default: Number(m[1]), min: Number(m[2]), max: Number(m[3]) }));
check(descendantCaps.length >= 2, "descendant routes no longer bound maxNodes through parseBoundedIntegerParam");
for (const cap of descendantCaps) {
  check(cap.max <= 1000, `descendant analysis budget drifted to ${cap.max} nodes (launch envelope: 1,000)`);
}
const reindexJobs = Number(routes.match(/processSearchReindexQueue\(env\.DB,\s*(\d+)\)/)?.[1]);
check(reindexJobs === 3, `synchronous reindex processing drifted to ${reindexJobs} jobs (launch envelope: 3)`);

// --- Export stays privileged, never public ---------------------------------------
check(/requirePermission\(env\.DB,\s*request,\s*env\.SESSION_COOKIE_NAME,\s*"registry\.export"\)/.test(routes),
  "export route no longer authorizes through the semantic registry.export permission guard");
check(/exports:\s*\{\s*version:\s*"[\d.]+"\s*,\s*stability:\s*"stable"\s*,\s*access:\s*"privileged"/.test(contract),
  "feature catalog no longer classifies exports as privileged");

// --- Limiter wiring (D08 classification surface) -----------------------------------
check(/kind === "write" \? env\.WRITE_RATE_LIMITER/.test(rateLimit), "rate limiter no longer binds the dedicated WRITE_RATE_LIMITER");
check(/accountLimiterKey|enforceAccountLoginLimit/.test(rateLimit), "per-account login limiter missing from rateLimit module");
check(/classifyApiRateLimit/.test(worker), "worker no longer routes classification through the shared classifier");
check(/return "write"/.test(classify) && /return "auth"/.test(classify) && /return "expensive"/.test(classify) && /return "public"/.test(classify),
  "classifier no longer emits all four limiter classes (auth/expensive/write/public)");
check(/WRITE_RATE_LIMITER\?:/.test(envTypes) && /ACCOUNT_RATE_LIMITER\?:/.test(envTypes), "Cloudflare env typing lacks WRITE_RATE_LIMITER/ACCOUNT_RATE_LIMITER bindings");
check(wrangler.includes('"WRITE_RATE_LIMITER"') && wrangler.includes('"ACCOUNT_RATE_LIMITER"'), "wrangler.jsonc lacks write/account rate limiter bindings");
const writeBinding = wrangler.match(/"name":\s*"WRITE_RATE_LIMITER",\s*"namespace_id":\s*"(\d+)",\s*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)/);
check(writeBinding && Number(writeBinding[2]) === 30 && Number(writeBinding[3]) === 60, "WRITE_RATE_LIMITER must stay 30 requests/60s (D08 envelope)");
const accountBinding = wrangler.match(/"name":\s*"ACCOUNT_RATE_LIMITER",\s*"namespace_id":\s*"(\d+)",\s*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)/);
check(accountBinding && Number(accountBinding[2]) === 5 && Number(accountBinding[3]) === 60, "ACCOUNT_RATE_LIMITER must stay 5 attempts/60s (D10 envelope)");

// --- Validators wired into the aggregate gate ---------------------------------------
const checkScript = String(packageJson.scripts?.check ?? "");
check(checkScript.includes("validate:budgets"), "npm run check does not run the free-tier budget validator (validate:budgets)");
check(checkScript.includes("validate:inventories"), "npm run check does not run the operational inventory validator (validate:inventories)");
check(checkScript.includes("typecheck:backend-core"), "npm run check does not run the backend-core typecheck sub-gate");

if (problems.length > 0) {
  console.error("Free-tier budget audit FAILED:");
  for (const problem of problems) console.error(`  ERROR ${problem}`);
  process.exit(1);
}
console.log("Free-tier budget audit PASSED: export<=500 rows, change-requests<=24 items, relationship graph<=512 nodes, descendants<=1000 nodes, reindex<=3 jobs; export privileged; limiter bindings intact; client/mock/meta aligned with server constants.");
