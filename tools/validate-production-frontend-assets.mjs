import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const mode = process.argv.includes("--dist") ? "dist" : "source";
const policyPath = join(root, "src", "web", "frontendReleasePolicy.json");
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const problems = [];
const active = new Set(policy.activeFrontends ?? []);
const external = new Set(policy.activeExternalFrontends ?? []);
const retiredRoots = policy.retiredPublicAssetRoots ?? [];
const required = policy.requiredProductionAssets ?? {};
const rasterExtensions = new Set([".avif", ".webp", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff"]);
const allowedActiveRasterExtensions = new Set([".avif", ".webp"]);
const maxRasterBytes = 250 * 1024;
// R53: the retired mandatory-Q8 regression list was removed. frontendReleasePolicy.json
// is now the single source of truth for which frontends exist and which assets they
// require — no per-frontend hardcoding here, so catalogue changes (like the R53
// retirement of q8mx-ch-wd and prism-ultra) need no validator edits.

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalizeAsset(value) {
  return value.replace(/^\/+/, "").split(/[?#]/, 1)[0];
}

function assetRefsForFrontend(id) {
  const dir = join(root, "src", "web", "frontends", id);
  const refs = new Set();
  const matcher = /(?:["'(`]|url\(\s*["']?)(\/[A-Za-z0-9_./-]+\.(?:avif|webp|png|jpe?g|gif|bmp|tiff?))(?:[?#][^"')`\s]*)?/gi;
  for (const file of walk(dir)) {
    const rel = relative(dir, file).replaceAll("\\", "/");
    if (rel.startsWith("original/") || rel.startsWith("archive/")) continue;
    if (![".ts", ".tsx", ".css", ".js", ".jsx"].includes(extname(file).toLowerCase())) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(matcher)) refs.add(normalizeAsset(match[1]));
  }
  return refs;
}

function checkActiveAsset(asset, owner, baseDir) {
  const ext = extname(asset).toLowerCase();
  if (rasterExtensions.has(ext) && !allowedActiveRasterExtensions.has(ext)) {
    problems.push(`${owner}: active raster '${asset}' must be AVIF/WebP`);
  }
  for (const retiredRoot of retiredRoots) {
    if (asset === retiredRoot || asset.startsWith(`${retiredRoot}/`)) {
      problems.push(`${owner}: active asset '${asset}' falls under retired root '${retiredRoot}'`);
    }
  }
  const full = join(baseDir, asset);
  if (!existsSync(full) || !statSync(full).isFile()) {
    problems.push(`${owner}: missing ${mode} asset '${asset}'`);
    return;
  }
  const size = statSync(full).size;
  if (rasterExtensions.has(ext) && size > maxRasterBytes) {
    problems.push(`${owner}: active raster '${asset}' is ${size} bytes (> ${maxRasterBytes})`);
  }
}

if (!active.has("heritage")) problems.push("release policy must keep Heritage/Core active");
for (const id of external) {
  if (!active.has(id)) problems.push(`${id}: external-active frontend missing from activeFrontends`);
  for (const file of ["manifest.ts", "entry.tsx"]) {
    if (!existsSync(join(root, "src", "web", "frontends", id, file))) problems.push(`${id}: missing ${file}`);
  }
}
for (const id of Object.keys(required)) if (!active.has(id)) problems.push(`${id}: owns required production assets but is not active`);

const baseDir = mode === "dist" ? join(root, "dist", "client") : join(root, "public");
if (mode === "dist" && !existsSync(baseDir)) problems.push("dist/client is missing; run the production build before --dist validation");

for (const id of active) {
  const assets = new Set([...(required[id] ?? []), ...assetRefsForFrontend(id)]);
  for (const asset of [...assets].sort()) checkActiveAsset(asset, id, baseDir);
}

if (problems.length) {
  console.error(`Production frontend asset validation FAILED (${mode}):`);
  for (const problem of problems) console.error(`  ERROR ${problem}`);
  process.exit(1);
}

const counts = {};
for (const id of active) counts[id] = new Set([...(required[id] ?? []), ...assetRefsForFrontend(id)]).size;
console.log(`Production frontend asset validation passed (${mode}): ${[...active].map((id) => `${id}=${counts[id]}`).join(", ")}.`);
