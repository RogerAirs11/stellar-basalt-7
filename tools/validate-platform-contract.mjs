import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const problems = [];
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const contract = readFileSync(join(root, "src/contracts/platform.ts"), "utf8");
const routes = readFileSync(join(root, "src/api/routes.ts"), "utf8");
const client = readFileSync(join(root, "src/frontend-kit/platformClient.ts"), "utf8");
const mockClient = readFileSync(join(root, "src/frontend-kit/mockPlatformClient.ts"), "utf8");
const fields = readFileSync(join(root, "src/db/types.ts"), "utf8");
const presentation = readFileSync(join(root, "src/frontend-kit/horseFields.ts"), "utf8");
const projection = readFileSync(join(root, "src/db/publicProjection.ts"), "utf8");
const searchQuery = readFileSync(join(root, "src/search/query.ts"), "utf8");
const searchRefresh = readFileSync(join(root, "src/search/refresh.ts"), "utf8");
const frontendRegistry = readFileSync(join(root, "src/web/frontendRegistry.ts"), "utf8");

const appVersion = contract.match(/PLATFORM_APPLICATION_VERSION\s*=\s*["']([^"']+)/)?.[1];
const contractVersion = contract.match(/PLATFORM_CONTRACT_VERSION\s*=\s*["']([^"']+)/)?.[1];
if (!appVersion) problems.push("cannot determine PLATFORM_APPLICATION_VERSION");
if (!contractVersion) problems.push("cannot determine PLATFORM_CONTRACT_VERSION");
if (appVersion && pkg.version !== appVersion) problems.push(`package version ${pkg.version} != platform application version ${appVersion}`);
if (appVersion && packageLock.version !== appVersion) problems.push(`package-lock root version ${packageLock.version} != platform application version ${appVersion}`);
if (appVersion && packageLock.packages?.[""]?.version !== appVersion) problems.push(`package-lock workspace version ${packageLock.packages?.[""]?.version} != platform application version ${appVersion}`);
if (appVersion && !(mockClient.includes(`applicationVersion: "${appVersion}"`)
  || (/applicationVersion:\s*PLATFORM_APPLICATION_VERSION\b/.test(mockClient) && mockClient.includes("PLATFORM_APPLICATION_VERSION,")))) problems.push(`mock PlatformClient applicationVersion is not aligned to ${appVersion}`);

for (const feature of ["change_requests", "audit", "admin", "curation", "exports"]) {
  if (!new RegExp(`\\b${feature}\\s*:\\s*true`).test(routes)) problems.push(`live server capability '${feature}' is not advertised true`);
  if (!new RegExp(`\\b${feature}\\s*:\\s*\\{[\\s\\S]*?version:\\s*["']1\\.0\\.0["'][\\s\\S]*?stability:\\s*["']stable["']`).test(contract)) {
    problems.push(`contract feature '${feature}' is not a stable 1.0.0 capability`);
  }
}

for (const namespace of ["changes:", "admin:"]) if (!client.includes(namespace)) problems.push(`PlatformClient implementation missing ${namespace.replace(":", "")} namespace`);
for (const route of ["/api/change-requests", "/api/admin/change-requests", "/api/admin/audit", "/api/admin/horses/"]) if (!client.includes(route)) problems.push(`PlatformClient does not cover ${route}`);
if (!contract.includes("source: PlatformSourceProvenance | null")) problems.push("platform metadata lacks typed canonical-source provenance");
if (!routes.includes("FROM source_imports ORDER BY id DESC LIMIT 1")) problems.push("platform metadata does not read canonical source_imports provenance");

const publicBase = extractArray(fields, "PUBLIC_HORSE_FIELDS");
const publicProfile = extractArray(fields, "PUBLIC_HORSE_PROFILE_FIELDS");
const publicHorseAllowlist = `${publicBase ?? ""} ${publicProfile ?? ""}`;
const publicSpecs = extractArray(presentation, "PUBLIC_HORSE_DETAIL_FIELD_SPECS");
for (const sensitive of ["microchip_no", "file_number", "lab_no", "passport_no", "description", "raw_json", "row_version", "deleted_at"]) {
  if (publicHorseAllowlist.includes(`"${sensitive}"`)) problems.push(`sensitive field '${sensitive}' leaked into public horse profile allowlist`);
  if (publicSpecs?.includes(`"${sensitive}"`)) problems.push(`sensitive field '${sensitive}' leaked into public presentation descriptors`);
}
for (const required of ["color_desc", "main_strain_desc", "sub_strain_desc", "dna_status", "imported_from_desc", "export_certificate", "has_sport_card"]) {
  if (!publicHorseAllowlist.includes(`"${required}"`)) problems.push(`rich public profile lost canonical safe field '${required}'`);
}
if (!projection.includes("normalizePublicHorseRecord") || !projection.includes("/^-+$/")) problems.push("public DTO source-sentinel normalization is missing");
if (!routes.includes("normalizePublicHorseRecord") || !routes.includes("meaningfulSourceTextSql")) problems.push("API presentation/facet boundary is not using centralized source cleanup");


// The SDK is the integration boundary, so every live route family must be
// represented there. Dynamic IDs/query strings are checked by stable path
// fragments rather than by exact literal extraction.
for (const route of [
  "/api/auth/me", "/api/auth/login", "/api/auth/logout", "/api/platform/meta", "/api/health",
  "/api/search?", "/api/search/meta", "/api/horses?", "/api/registry/facets", "/api/registry/export", "/api/horses/${positiveId(id)}",
  "/api/people?", "/api/people/${positiveId(id)}", "/pedigree?", "/descendants?", "/pedigree/metrics?",
  "/pedigree/descendant-metrics?", "/pedigree/coefficients?", "/pedigree/paths?", "/api/relationship?",
  "/api/relationship/coefficients?", "/api/breeding/pairing-analysis?", "/insights?", "/api/analytics/registry",
  "/api/quality/summary", "/api/claims/mine", "/api/claims", "/api/change-requests/mine", "/api/change-requests",
  "/api/admin/dashboard", "/api/admin/audit", "/api/admin/quality?", "/api/admin/claims", "/review",
  "/api/admin/change-requests", "/api/admin/horses/${positiveId(id)}", "/api/admin/maintenance/reindex", "/api/admin/maintenance/reconcile-mutations",
]) {
  if (!client.includes(route)) problems.push(`PlatformClient route coverage missing fragment ${route}`);
}
if (!routes.includes("compileRegistryQuery") || !routes.includes("exportRegistry")) problems.push("registry browse/export does not share the canonical query compiler");
if (!client.includes("exports:") || !client.includes("/api/registry/export")) problems.push("PlatformClient export capability is missing");
if (!routes.includes('horseMatch && (method === "PUT" || method === "PATCH")')) problems.push("server horse-update route must accept canonical PUT plus legacy PATCH");
if (!client.includes('"PUT", { expected_row_version: expectedRowVersion, changes }')) problems.push("PlatformClient horse update is not using canonical PUT");

// Search metadata, parser aliases and actual scoring must evolve together.
for (const field of ["name", "id", "owner", "breeder", "importer", "passportReceiver", "father", "mother", "year", "breed", "place", "color", "strain", "imported"]) {
  if (!routes.includes(`{ key: "${field}"`)) problems.push(`search metadata missing field '${field}'`);
  if (!searchQuery.includes(`${field}: "${field}"`) && !searchQuery.includes(`| "${field}"`)) problems.push(`search parser missing field '${field}'`);
}
for (const alias of ["colour", "bloodline", "origin", "sire", "dam", "born", "passport", "passportreceiver", "passport_receiver"]) if (!searchQuery.includes(`${alias}:`)) problems.push(`search parser missing alias '${alias}'`);
for (const scoring of ["parsed.fields.color", "parsed.fields.strain", "parsed.fields.imported", "parsed.fields.importer", "parsed.fields.passportReceiver"]) {
  const service = readFileSync(join(root, "src/search/service.ts"), "utf8");
  if (!service.includes(scoring)) problems.push(`search scoring missing ${scoring}`);
}

// Registry-field metadata must correspond to both typed SDK params and server
// query parsing. This prevents a facet/filter appearing in one frontend while
// being silently ignored by the backend.
const registryQuery = readFileSync(join(root, "src/registry/query.ts"), "utf8");
for (const field of ["breed", "sex", "lifecycle", "place", "color", "mainStrain", "importedFrom", "yearFrom", "yearTo", "name", "id", "register", "owner", "breeder", "importer", "passportReceiver", "sire", "dam", "hasSire", "hasDam", "isImported", "isSport", "isStallion", "hasSportCard"]) {
  if (!contract.includes(`${field}?:`)) problems.push(`RegistryBrowseParams missing '${field}'`);
  const directRead = registryQuery.includes(`url.searchParams.get("${field}")`);
  const booleanTableRead = registryQuery.includes(`["${field}",`) && registryQuery.includes("applyBooleanFilter(url.searchParams.get(param)");
  if (!directRead && !booleanTableRead) problems.push(`canonical registry query compiler does not parse '${field}'`);
}

for (const role of ["importer", "passport_receiver"]) {
  if (!searchRefresh.includes(`hp.role='${role}'`)) problems.push(`general search reindex omits canonical people role '${role}'`);
}
for (const [field, role] of [["importer_name", "importer"], ["passport_receiver_name", "passport_receiver"]]) {
  const directProjection = routes.includes(`AS ${field}`);
  const helperProjection = routes.includes(`person("${role}","name_latin","${field}")`)
    && routes.includes("AS ${materializedColumn}");
  if (!directProjection && !helperProjection) problems.push(`registry browse projection omits '${field}'`);
  if (!routes.includes(`"${field}"`)) problems.push(`registry CSV export omits '${field}'`);
  if (!contract.includes(`${field}?: string | null`)) problems.push(`HorseRecord contract omits '${field}'`);
}

// R96 centralizes version markers on the platform constant (single source of
// truth — cannot drift from the contract). Accept either the literal form or
// the imported-constant form; both prove alignment to the release.
if (!(frontendRegistry.includes(`version: "${pkg.version}"`)
  || (/version:\s*PLATFORM_APPLICATION_VERSION\b/.test(frontendRegistry) && frontendRegistry.includes("import { PLATFORM_APPLICATION_VERSION")))) problems.push(`Heritage built-in frontend version is not aligned to application release ${pkg.version}`);

const hostUiFiles = [join(root, "src/web/main.tsx"), ...walk(join(root, "src/web/heritage"))].filter((path) => [".ts", ".tsx"].includes(extname(path)));
for (const file of hostUiFiles) {
  const source = readFileSync(file, "utf8");
  if (/\/api\//.test(source)) problems.push(`${file.replace(root + "/", "")}: raw /api/ usage bypasses PlatformClient`);
}

const frontendSources = [
  readFileSync(join(root, "src/web/heritage/RegistryDeskPage.tsx"), "utf8"),
  readFileSync(join(root, "src/web/frontends/equidata-elite/pages.tsx"), "utf8"),
];
for (const [index, source] of frontendSources.entries()) {
  if (!source.includes("source.sha256")) problems.push(["Heritage", "EquiData"][index] + " does not surface canonical source provenance");
}

if (problems.length) {
  console.error("Platform contract audit FAILED:");
  for (const problem of problems) console.error(`  ERROR ${problem}`);
  process.exit(1);
}
console.log(`Platform contract audit passed: app ${appVersion}, contract ${contractVersion}; SDK boundary, capability truthfulness, data visibility, provenance and public DTO hygiene are enforced.`);

function extractArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("[", markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}
