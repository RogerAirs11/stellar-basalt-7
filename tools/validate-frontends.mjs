import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const root = join(process.cwd(), "src", "web", "frontends");
const kitRoot = resolve(process.cwd(), "src", "frontend-kit");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const problems = [];
const warnings = [];
const frontendReports = [];
const ids = new Map();
const frontendContractSource = readFileSync(join(process.cwd(), "src", "contracts", "frontend.ts"), "utf8");
const hostDelegableBlock = frontendContractSource.match(/FRONTEND_HOST_DELEGABLE_FEATURES\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s+as const/)?.[1] ?? "";
const hostDelegableFeatures = new Set([...hostDelegableBlock.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1]));
const platformContractSource = readFileSync(join(process.cwd(), "src", "contracts", "platform.ts"), "utf8");
const platformFeatureSpecs = extractObjectAfter(platformContractSource, "PLATFORM_FEATURE_SPECS");
const platformFeatureKeys = platformFeatureSpecs
  ? [...platformFeatureSpecs.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1])
  : [];
const platformRoutesSource = readFileSync(join(process.cwd(), "src", "api", "routes.ts"), "utf8");
const platformCapabilitiesBlock = extractObjectAfter(platformRoutesSource, "PLATFORM_CAPABILITIES");
const livePlatformFeatures = new Set(platformCapabilitiesBlock
  ? [...platformCapabilitiesBlock.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:\s*true\s*,?/gm)].map((match) => match[1])
  : []);
if (!platformFeatureKeys.length) problems.push("platform: could not enumerate PLATFORM_FEATURE_SPECS for frontend coverage validation");
if (!platformCapabilitiesBlock) problems.push("platform: could not enumerate PLATFORM_CAPABILITIES for parity validation");
if (!hostDelegableFeatures.size) problems.push("platform: could not enumerate FRONTEND_HOST_DELEGABLE_FEATURES for host-delegation validation");

for (const dirent of readdirSync(root, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const folder = dirent.name;
  const folderPath = join(root, folder);
  const resolvedFolderPath = resolve(folderPath);
  const manifestPath = join(folderPath, "manifest.ts");
  const entryPath = join(folderPath, "entry.tsx");
  const localProblems = [];
  const localWarnings = [];

  if (!existsSync(manifestPath)) localProblems.push("missing manifest.ts");
  if (!existsSync(entryPath)) localProblems.push("missing entry.tsx");

  let id = null;
  let styleScope = null;
  if (existsSync(manifestPath)) {
    const manifest = readFileSync(manifestPath, "utf8");
    id = manifest.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null;
    styleScope = manifest.match(/\bstyleScope\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null;
    if (!id) localProblems.push("manifest id could not be determined");
    else {
      if (id !== folder) localProblems.push(`manifest id '${id}' must match folder name`);
      if (ids.has(id)) localProblems.push(`duplicate manifest id '${id}' also used by ${ids.get(id)}`);
      ids.set(id, folder);
    }
    if (!/defineFrontendManifest\s*\(/.test(manifest)) {
      localWarnings.push("manifest should use defineFrontendManifest() for stronger agent/type guidance");
    }
    validatePlatformFeatureCoverage(manifest, `${folder}/manifest.ts`, localProblems);
    validateManifestRequirementParity(manifest, `${folder}/manifest.ts`, localProblems);
  }

  const cssFiles = [];
  for (const path of walk(folderPath)) {
    const localPath = relative(folderPath, path);
    if (localPath.split(sep).includes("original")) continue; // preserved non-production source/archive
    const ext = extname(path);
    const source = readFileSync(path, "utf8");
    const label = relative(process.cwd(), path).replaceAll("\\", "/");

    if (sourceExtensions.has(ext)) {
      if (/\/api\//.test(source)) localProblems.push(`${label}: direct /api/ route usage is forbidden; use runtime.platform / Frontend Integration Kit`);
      if (/\b(?:D1Database|env\.DB|wrangler|\.wrangler|horse-registry\.sqlite)\b/.test(source)) {
        localProblems.push(`${label}: backend/database runtime coupling is forbidden`);
      }
      if (/\buser\?*\.role\b/.test(source)) {
        localProblems.push(`${label}: auth role checks are forbidden in external frontends; consume runtime.permissions instead`);
      }
      if (/\bfetch\s*\(/.test(source)) {
        localWarnings.push(`${label}: direct fetch() detected; Horse DB data/actions must use runtime.platform and external network use requires review`);
      }
      if (/(?:from\s+|import\s*\()\s*["'][^"']*(?:^|\/)original(?:\/|["'])/.test(source) || /["']\.\/?original(?:\/|["'])/.test(source)) {
        localProblems.push(`${label}: production frontend code must not import preserved original/mock source`);
      }
      if (/from\s+["'][^"']*(?:\/api\/|\/db\/|\/auth\/|\/worker(?:["'/]))/.test(source)) {
        localProblems.push(`${label}: imports backend internals; use frontend contracts/kit/shared presentation helpers`);
      }
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(path), specifier);
          const insideFrontend = target === resolvedFolderPath || target.startsWith(`${resolvedFolderPath}${sep}`);
          const publicKitRoot = target === kitRoot;
          if (!insideFrontend && !publicKitRoot) {
            localProblems.push(`${label}: cross-module import '${specifier}' is forbidden; external frontends may import only their own files or the public frontend-kit root`);
          }
        } else if (specifier.startsWith("/") || specifier.startsWith("src/")) {
          localProblems.push(`${label}: project-absolute import '${specifier}' is forbidden in external frontends`);
        }
      }
    }

    if (ext === ".css") {
      cssFiles.push(path);
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(?:^|})\s*(?:html|body|:root)(?=\s|\{|[,.#:\[])/m.test(stripped)) {
        localProblems.push(`${label}: global html/body/:root styling is forbidden in plugin CSS; scope styles to the frontend root`);
      }
      if (/(?:^|})\s*\*\s*\{/m.test(stripped)) {
        localProblems.push(`${label}: bare global * selector is forbidden in plugin CSS`);
      }
    }
  }

  if (cssFiles.length && !styleScope) localProblems.push("CSS exists but manifest has no styleScope declaration");
  if (cssFiles.length && styleScope) {
    const cssHasScope = cssFiles.some((path) => readFileSync(path, "utf8").includes(styleScope));
    if (!cssHasScope) localProblems.push(`styleScope '${styleScope}' is not present in plugin CSS`);
  }

  for (const problem of localProblems) problems.push(`${folder}: ${problem}`);
  for (const warning of localWarnings) warnings.push(`${folder}: ${warning}`);
  frontendReports.push({ id: id ?? folder, folder, styleScope, errors: [...new Set(localProblems)], warnings: [...new Set(localWarnings)] });
}

const builtinRegistrySource = readFileSync(join(process.cwd(), "src", "web", "frontendRegistry.ts"), "utf8");
const builtinProblems = [];
validatePlatformFeatureCoverage(builtinRegistrySource, "heritage built-in manifest", builtinProblems);
for (const problem of builtinProblems) problems.push(`heritage: ${problem}`);

const report = {
  ok: problems.length === 0,
  frontendCount: frontendReports.length,
  frontends: frontendReports,
  errors: [...new Set(problems)],
  warnings: [...new Set(warnings)],
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (report.warnings.length) {
  console.log("Frontend integration warnings:");
  for (const warning of report.warnings) console.log(`  WARN ${warning}`);
}

if (!report.ok) {
  console.error("Frontend integration validation FAILED:");
  for (const problem of report.errors) console.error(`  ERROR ${problem}`);
  process.exit(1);
}

console.log(`Frontend integration validation passed (${report.frontendCount} external frontend${report.frontendCount === 1 ? "" : "s"}).`);

function extractObjectAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex);
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
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}


function validateManifestRequirementParity(source, label, localProblems) {
  const requiredBlock = source.match(/\brequiresPlatform\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const optionalBlock = source.match(/\boptionalPlatform\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const featureBlock = source.match(/\bfeatureRequirements\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const required = new Set([...requiredBlock.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1]));
  const optional = new Set([...optionalBlock.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1]));
  for (const feature of optional) {
    if (required.has(feature)) localProblems.push(`${label}: '${feature}' cannot be both required and optional`);
  }
  for (const match of featureBlock.matchAll(/\bfeature\s*:\s*["']([a-z][a-z0-9_]*)["']/g)) {
    const feature = match[1];
    if (!required.has(feature)) localProblems.push(`${label}: featureRequirements.${feature} must also appear in requiresPlatform`);
  }
}

function validatePlatformFeatureCoverage(source, label, localProblems) {
  const block = extractObjectAfter(source, "platformFeatures");
  if (!block) {
    localProblems.push(`${label}: missing exhaustive platformFeatures coverage map`);
    return;
  }
  const keys = [...block.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1]);
  const unique = new Set(keys);
  const missing = platformFeatureKeys.filter((key) => !unique.has(key));
  const unknown = [...unique].filter((key) => !platformFeatureKeys.includes(key));
  if (missing.length) localProblems.push(`${label}: platformFeatures missing ${missing.join(", ")}`);
  if (unknown.length) localProblems.push(`${label}: platformFeatures contains unknown ${unknown.join(", ")}`);
  if (unique.size !== keys.length) localProblems.push(`${label}: platformFeatures contains duplicate keys`);
  for (const key of platformFeatureKeys) {
    const value = block.match(new RegExp(`^\\s*${key}\\s*:\\s*["'](surface|host|dormant)["']`, "m"));
    if (!value && unique.has(key)) {
      localProblems.push(`${label}: platformFeatures.${key} must be surface, host, or dormant`);
      continue;
    }
    if (value?.[1] === "host" && !hostDelegableFeatures.has(key)) {
      localProblems.push(`${label}: platform feature '${key}' cannot be delegated to the host; it must be surfaced or dormant`);
    }
    if (value?.[1] === "dormant" && livePlatformFeatures.has(key)) {
      localProblems.push(`${label}: live platform feature '${key}' is still dormant; surface it or explicitly delegate it to the host`);
    }
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function importSpecifiers(source) {
  const values = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  return [...new Set(values)];
}

