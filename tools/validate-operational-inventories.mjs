#!/usr/bin/env node
/**
 * D06 — Operational inventory drift validator.
 *
 * Compares the current source/migrations against the two inventory documents and fails if:
 *   - a current API route family/pattern (method + path token from src/api/routes.ts)
 *     is absent from docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md;
 *   - a migrated ordinary/virtual table (CREATE [VIRTUAL] TABLE in migrations/*.sql)
 *     is absent from docs/CANONICAL_DERIVED_DATA_INVENTORY.md;
 *   - a documented route/structure row no longer exists in source (stale inventory).
 *
 * Counts are derived from current source on every run — never hardcoded as eternal truth.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMigrationSchema } from "./lib/migration-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// ---------- Route inventory ----------
const routesSource = [
  readFileSync(join(root, "src/api/routes.ts"), "utf8"),
  readFileSync(join(root, "src/ai/application/api.ts"), "utf8"),
].join("\n");
const routeInventory = readFileSync(join(root, "docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md"), "utf8");

/** Derive (method, pathToken) pairs exactly as dispatched in routes.ts. */
function deriveRoutes(source) {
  const entries = new Set();
  for (const m of source.matchAll(/path\s*===\s*"([^"]+)"\s*&&\s*method\s*===\s*"(\w+)"/g)) entries.add(`${m[2]} ${m[1]}`);
  for (const m of source.matchAll(/path\s*===\s*"([^"]+)"\s*&&\s*\(method\s*===\s*"PUT"\s*\|\|\s*method\s*===\s*"PATCH"\)/g)) entries.add(`PUT/PATCH ${m[1]}`);
  const declared = [...source.matchAll(/const\s+(\w+)\s*=\s*path\.match\((\/.*\/)\);/g)];
  for (const m of declared) {
    const name = m[1];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const iff of source.matchAll(new RegExp(`if\\s*\\(\\s*${escaped}\\s*&&\\s*method\\s*===\\s*"(\\w+)"\\s*\\)`, "g"))) {
      entries.add(`${iff[1]} ${m[2]}`);
    }
    if (new RegExp(`if\\s*\\(\\s*${escaped}\\s*&&\\s*\\(method\\s*===\\s*"PUT"\\s*\\|\\|\\s*method\\s*===\\s*"PATCH"\\)\\s*\\)`).test(source)) {
      entries.add(`PUT/PATCH ${m[2]}`);
    }
  }
  return entries;
}

function parseRouteInventoryRows(markdown) {
  const rows = new Set();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    // Regex alternations inside a markdown table cell are escaped as "\|"; restore
    // them to real pipes BEFORE splitting so the path token matches the source
    // regex literal exactly (e.g. /(competitions|media|genetics|...)/ routes).
    const shielded = line.replace(/\\\|/g, "\u0000");
    const cells = shielded.split("|").map((cell) => cell.trim().replace(/\u0000/g, "|"));
    if (cells.length < 3) continue;
    if (!/^(GET|POST|PUT|PATCH|DELETE|PUT\/PATCH)$/.test(cells[1])) continue;
    rows.add(`${cells[1]} ${cells[2]}`);
  }
  return rows;
}

const derivedRoutes = deriveRoutes(routesSource);
// Cohesive delegated handlers use a separate, reviewed endpoint contract.
// Their real HTTP integration tests exercise dispatch and permissions; keep
// the wiring and documentation checked even though legacy regex extraction
// cannot infer paths assembled by those handlers.
const extendedSurfaces=JSON.parse(readFileSync(join(root,"src/api/extended-route-surface.json"),"utf8"));
for (const surface of extendedSurfaces) {
  const source=readFileSync(join(root,surface.module),"utf8");
  if (!new RegExp(`await\\s+${surface.dispatcher}\\s*\\(`).test(routesSource)) problems.push(`Extended dispatcher is not wired: ${surface.dispatcher}`);
  if (!source.includes(`export async function ${surface.dispatcher}(`)) problems.push(`Extended dispatcher is not exported: ${surface.dispatcher}`);
  for (const route of surface.routes) {
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(route.method)||!route.path.startsWith("/api/")) throw new Error("Invalid extended route contract");
    const key=`${route.method} ${route.path}`;
    if (derivedRoutes.has(key)) problems.push(`Duplicate extended route contract: ${key}`);
    derivedRoutes.add(key);
  }
}
const documentedRoutes = parseRouteInventoryRows(routeInventory);

for (const route of derivedRoutes) {
  if (!documentedRoutes.has(route)) problems.push(`API route present in source but missing from RUNTIME_ROUTE_BUDGET_INVENTORY.md: ${route}`);
}
for (const route of documentedRoutes) {
  if (!derivedRoutes.has(route)) problems.push(`Route documented in RUNTIME_ROUTE_BUDGET_INVENTORY.md no longer exists in source: ${route}`);
}
if (derivedRoutes.size !== documentedRoutes.size) {
  problems.push(`Route inventory count drift: source derives ${derivedRoutes.size} entries, inventory documents ${documentedRoutes.size}`);
}

// ---------- Data inventory ----------
const migrationDir = join(root, "migrations");
const migrationFiles = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
const derivedTables = new Map([...deriveMigrationSchema(migrationFiles.map(file => readFileSync(join(migrationDir, file), "utf8")))]
  .filter(([, table]) => !table.temporary));

const dataInventory = readFileSync(join(root, "docs/CANONICAL_DERIVED_DATA_INVENTORY.md"), "utf8");
const documentedTables = new Set();
for (const line of dataInventory.split("\n")) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length < 3) continue;
  if (!/^\d{4}\b/.test(cells[2] ?? "")) continue; // structure rows carry a four-digit migration column
  // Strip human annotations like "(virtual, fts5 unicode61)" from the structure name cell.
  documentedTables.add(cells[1].replace(/\s*\([^)]*\)\s*$/, ""));
}

for (const [table, meta] of derivedTables) {
  if (!documentedTables.has(table)) {
    problems.push(`Migrated ${meta.virtual ? "virtual " : ""}table present in migrations but missing from CANONICAL_DERIVED_DATA_INVENTORY.md: ${table}`);
  }
}
for (const table of documentedTables) {
  if (!derivedTables.has(table)) problems.push(`Structure documented in CANONICAL_DERIVED_DATA_INVENTORY.md not found in migrations: ${table}`);
}
if (derivedTables.size !== documentedTables.size) {
  problems.push(`Data inventory count drift: migrations define ${derivedTables.size} structures, inventory documents ${documentedTables.size}`);
}

if (problems.length > 0) {
  console.error("Operational inventory audit FAILED:");
  for (const problem of problems) console.error(`  ERROR ${problem}`);
  console.error(`(derived: ${derivedRoutes.size} API route entries, ${derivedTables.size} migrated structures)`);
  process.exit(1);
}
console.log(`Operational inventory audit PASSED: ${derivedRoutes.size} API route entries and ${derivedTables.size} migrated structures (${migrationFiles.length} migrations) are fully documented and drift-free.`);
