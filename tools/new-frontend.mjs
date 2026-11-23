import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [id, ...nameParts] = process.argv.slice(2);
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  console.error("Usage: npm run frontend:new -- <kebab-id> [Display Name]");
  process.exit(1);
}

const name = nameParts.join(" ").trim() || titleCase(id);
const projectRoot = process.cwd();
const platformSource = readFileSync(join(projectRoot, "src", "contracts", "platform.ts"), "utf8");
const routesSource = readFileSync(join(projectRoot, "src", "api", "routes.ts"), "utf8");
const platformFeatureKeys = objectKeys(platformSource, "PLATFORM_FEATURE_SPECS");
const currentCapabilities = booleanObject(routesSource, "PLATFORM_CAPABILITIES");
if (!platformFeatureKeys.length || platformFeatureKeys.some((feature) => !(feature in currentCapabilities))) {
  console.error("Could not derive the canonical platform feature catalog/capabilities. Refusing to create a stale frontend manifest.");
  process.exit(1);
}

const starterSurface = new Set(["search", "registry", "horse_profiles"]);
const starterHost = new Set(["authentication"]);
const platformFeatures = Object.fromEntries(platformFeatureKeys.map((feature) => [
  feature,
  starterSurface.has(feature) ? "surface" : starterHost.has(feature) ? "host" : "dormant",
]));
const currentLive = platformFeatureKeys.filter((feature) => currentCapabilities[feature]);
const starterParityDebt = currentLive.filter((feature) => platformFeatures[feature] === "dormant");
const optionalPlatform = currentLive.filter((feature) => !starterSurface.has(feature));

const root = join(projectRoot, "src", "web", "frontends", id);
if (existsSync(root)) {
  console.error(`Frontend '${id}' already exists at ${root}`);
  process.exit(1);
}
mkdirSync(root, { recursive: true });

const scope = `.${id}-ui`;
const coverageLiteral = `{\n${platformFeatureKeys.map((feature) => `    ${feature}: ${JSON.stringify(platformFeatures[feature])},`).join("\n")}\n  }`;
write("manifest.ts", `import { defineFrontendManifest } from "../../../frontend-kit";\n\nexport const manifest = defineFrontendManifest({\n  id: ${JSON.stringify(id)},\n  name: ${JSON.stringify(name)},\n  version: "0.1.0",\n  description: "Independent Horse DB frontend interpretation.",\n  contract: { minVersion: "2.1.0", maxMajor: 2 },\n  capabilities: ["home", "search", "registry", "horse"],\n  requiresPlatform: ["search", "registry", "horse_profiles"],\n  featureRequirements: [\n    { feature: "search", minVersion: "1.0.0", maxMajor: 1 },\n    { feature: "registry", minVersion: "1.0.0", maxMajor: 1 },\n    { feature: "horse_profiles", minVersion: "1.0.0", maxMajor: 1 },\n  ],\n  optionalPlatform: ${JSON.stringify(optionalPlatform)},\n  platformFeatures: ${coverageLiteral},\n  styleScope: ${JSON.stringify(scope)},\n  maturity: "experimental",\n});\n`);

write("adapter.ts", `import { defineFrontendAdapter, supportsPlatformFeature } from "../../../frontend-kit";\n\n/** Keep presentation-specific reshaping here; never copy backend/domain rules into the UI. */\nexport const adaptRuntime = defineFrontendAdapter((runtime) => ({\n  ...runtime,\n  canUsePedigree: supportsPlatformFeature(runtime.platformMeta, "pedigree_ancestors", { minVersion: "1.0.0", maxMajor: 1 }),\n}));\n`);

write("entry.tsx", `import React, { useEffect, useState } from "react";\nimport { horseDbRoutes, type FrontendRuntimeProps, type HorseRecord } from "../../../frontend-kit";\nimport { adaptRuntime } from "./adapter";\nimport "./styles.css";\n\nexport default function ${componentName(id)}Frontend(runtime: FrontendRuntimeProps) {\n  const view = adaptRuntime(runtime);\n  const [horses, setHorses] = useState<HorseRecord[]>([]);\n  const [error, setError] = useState("");\n\n  useEffect(() => {\n    const controller = new AbortController();\n    view.platform.registry.browse({ limit: 12 }, { signal: controller.signal })\n      .then((result) => setHorses(result.rows))\n      .catch((reason: unknown) => {\n        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Registry request failed");\n      });\n    return () => controller.abort();\n  }, [view.platform]);\n\n  return <main className=${JSON.stringify(`${id}-ui`)}>\n    <h1>${escapeJsxText(name)}</h1>\n    {error && <p role="alert">{error}</p>}\n    {!error && horses.length === 0 && <p>Loading registry…</p>}\n    <div className="${id}-grid">\n      {horses.map((horse) => <button key={horse.id} onClick={() => view.navigate(horseDbRoutes.horse(horse.id))}>\n        <strong>{horse.name_latin || horse.name_native || ("#" + horse.id)}</strong>\n      </button>)}\n    </div>\n  </main>;\n}\n`);

write("styles.css", `${scope} {\n  min-height: 100vh;\n  padding: clamp(20px, 4vw, 56px);\n}\n\n${scope} .${id}-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));\n  gap: 12px;\n}\n`);

write("CAPABILITY_COVERAGE.md", `# Platform capability coverage\n\nGenerated from the canonical platform catalog at scaffold time. The manifest accounts for every semantic feature explicitly.\n\n- **surface** — reachable in this frontend.\n- **host** — intentionally delegated to the canonical host/auth/privileged shell.\n- **dormant** — preserved/incomplete; may be unavailable in the backend or still awaiting frontend integration.\n\nA live backend feature marked **dormant** is parity debt, not a hard compatibility failure: the frontend remains loadable while runtime coverage keeps the omission visible. Before release, every live capability should become **surface** or a truthful **host** handoff.\n\n## Scaffold-time parity debt\n\n${starterParityDebt.length ? starterParityDebt.map((feature) => `- \`${feature}\``).join("\n") : "None."}\n\nNever fabricate unsupported data, invent permissions, or delete preserved future-only capability code.\n`);

write("README.md", `# ${name}\n\nGenerated Horse DB external frontend shell.\n\n- Use only \`../../../frontend-kit\` for Horse DB platform imports.\n- Keep backend/domain rules out of this folder.\n- Keep CSS under \`${scope}\`.\n- The generated \`platformFeatures\` map is exhaustive and derived from the current canonical contract.\n- A live feature left \`dormant\` is explicit parity debt, not permission to fabricate it or remove its UI.\n- Promote reusable/sourceable donor features into the canonical backend/contract; otherwise capability-gate them.\n- Run \`npm run validate:frontends\` before integration.\n`);

console.log(`Created frontend '${id}' at src/web/frontends/${id}`);
if (starterParityDebt.length) console.log(`Starter parity debt (${starterParityDebt.length}): ${starterParityDebt.join(", ")}`);
console.log("Next: replace the shell UI, preserve the manifest/adapter boundary, surface live capabilities, then run npm run validate:frontends.");

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

function objectKeys(source, marker) {
  const body = extractObjectAfter(source, marker);
  return body ? [...body.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1]) : [];
}

function booleanObject(source, marker) {
  const body = extractObjectAfter(source, marker);
  if (!body) return {};
  return Object.fromEntries([...body.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:\s*(true|false)\s*,?/gm)].map((match) => [match[1], match[2] === "true"]));
}

function write(file, content) {
  writeFileSync(join(root, file), content, "utf8");
}

function titleCase(value) {
  return value.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function componentName(value) {
  return value.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1).replace(/[^A-Za-z0-9]/g, "") : "").join("").replace(/^[^A-Za-z_$]/, "Ui");
}

function escapeJsxText(value) {
  return value.replace(/[{}<>]/g, "");
}
