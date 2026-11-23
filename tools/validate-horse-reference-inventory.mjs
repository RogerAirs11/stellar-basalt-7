#!/usr/bin/env node
/**
 * R117-19 (Master AI R117 handoff D31) — horse-reference inventory drift gate.
 *
 * "Stop a real reversal if the reference inventory is incomplete" — this
 * validator makes the inventory TESTABLY complete. It fails when:
 *   - a horse-referencing column exists in migrations/*.sql (FK REFERENCES
 *     horses, or a logical horse-reference column name) but is NOT classified
 *     in src/registry/horseReferenceInventory.ts;
 *   - a classified non-virtual column no longer exists in the schema;
 *   - a moves/archives entry's table lacks its declared row key (an `id`
 *     column, or horse_people's composite person_id+role PK);
 *   - src/api/modules/imports.ts re-declares its own move list instead of
 *     deriving it from the inventory.
 *
 * A future migration that adds a horse reference without a disposition breaks
 * this gate — merges and unmerges stop until the policy is extended.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMigrationSchema } from "./lib/migration-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// ---------- derive every horse-referencing column from the migration chain ----------
const migrationText = readdirSync(join(root, "migrations")).filter(f => /^\d+.*\.sql$/.test(f)).sort()
  .map(f => readFileSync(join(root, "migrations", f), "utf8")).join("\n");

/** Final persistent ordinary tables after ordered rebuilds and ALTERs. */
const schema = new Map([...deriveMigrationSchema(migrationText)]
  .filter(([, table]) => !table.virtual && !table.temporary)
  .map(([name, table]) => [name, table.columns]));

const LOGICAL_REFERENCE_COLUMNS = /^(horse_id|sire_id|dam_id|foal_id|father_id|mother_id|alias_horse_id|kept_horse_id|merged_horse_id|subject_horse_id|related_horse_id|[a-z_]+_horse_id)$/;

const derived = new Set();
for (const [table, columns] of schema) {
  for (const [column, line] of columns) {
    const fk = /REFERENCES\s+horses\s*\(/i.test(line);
    const logical = table !== "horses" && LOGICAL_REFERENCE_COLUMNS.test(column) && !/user|person|people/.test(column);
    if (fk || logical) derived.add(`${table}.${column}`);
  }
}

// ---------- the classified inventory (parsed from the TypeScript source) ----------
const inventorySource = readFileSync(join(root, "src/registry/horseReferenceInventory.ts"), "utf8");
const classified = new Set();
for (const m of inventorySource.matchAll(/\{\s*table:\s*"(\w+)",\s*column:\s*"(\w+)"/g)) classified.add(`${m[1]}.${m[2]}`);
const inventoryVersion = (inventorySource.match(/HORSE_REFERENCE_INVENTORY_VERSION = "([^"]+)"/) || [])[1];

if (!inventoryVersion) problems.push("HORSE_REFERENCE_INVENTORY_VERSION is missing from the inventory source");

// Virtual references are classified but not derivable from a column declaration.
const virtualEntries = new Set();
for (const m of inventorySource.matchAll(/\{\s*table:\s*"(\w+)",\s*column:\s*"(\w+)"[^}]*virtual:\s*true[^}]*\}/g)) virtualEntries.add(`${m[1]}.${m[2]}`);

for (const reference of derived) {
  if (!classified.has(reference)) {
    problems.push(`Horse reference present in migrations but NOT classified in horseReferenceInventory.ts: ${reference} (merge/unmerge must stop until the policy is extended)`);
  }
}
for (const entry of classified) {
  if (derived.has(entry)) continue;
  if (virtualEntries.has(entry)) continue;
  problems.push(`Classified inventory entry no longer exists in the migration schema: ${entry}`);
}

// ---------- row-key declarations for moves/archives entries ----------
const moveTables = new Map();
for (const m of inventorySource.matchAll(/\{\s*table:\s*"(\w+)",\s*column:\s*"(\w+)",\s*kind:\s*"(\w+)"(,\s*primaryKey:\s*"([^"]+)")?[^}]*disposition:\s*"(moves|archives)"/g)) {
  moveTables.set(`${m[1]}.${m[2]}`, { table: m[1], key: m[5] ?? "id" });
}
if (moveTables.size === 0) problems.push("No moves/archives entries parsed from horseReferenceInventory.ts — check the source format");
for (const [entry, info] of moveTables) {
  const columns = schema.get(info.table);
  if (!columns) { problems.push(`moves/archives entry ${entry} references an unknown table`); continue; }
  if (info.key === "id" && !columns.has("id")) {
    problems.push(`moves/archives entry ${entry} assumes an id column but ${info.table} has none — declare primaryKey (e.g. horse_people's person_id+role)`);
  }
  if (info.key === "person_id+role" && !(columns.has("person_id") && columns.has("role"))) {
    problems.push(`moves/archives entry ${entry} declares person_id+role but ${info.table} lacks those columns`);
  }
}

// ---------- the merge command must derive its move set from the inventory ----------
const importsSource = readFileSync(join(root, "src/api/modules/imports.ts"), "utf8");
if (!/from "\.\.\/\.\.\/registry\/horseReferenceInventory"/.test(importsSource)) {
  problems.push("src/api/modules/imports.ts no longer imports the horse-reference inventory");
}
if (/const MERGE_FK_MOVES\s*[:=]/.test(importsSource)) {
  problems.push("src/api/modules/imports.ts re-declares a MERGE_FK_MOVES hand list — the move set must be derived from horseReferenceInventory.ts");
}
if (!/HORSE_REFERENCE_INVENTORY_VERSION/.test(importsSource)) {
  problems.push("src/api/modules/imports.ts does not stamp merges with the inventory policy version");
}

// ---------- report ----------
if (problems.length > 0) {
  console.error(`validate-horse-reference-inventory: FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`validate-horse-reference-inventory: OK — ${classified.size} classified references (${virtualEntries.size} virtual), ${derived.size} derived from migrations, ${moveTables.size} moves/archives pairs with declared row keys, version ${inventoryVersion}`);
