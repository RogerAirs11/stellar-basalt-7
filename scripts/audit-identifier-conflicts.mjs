#!/usr/bin/env node
/**
 * T08 (Master-Ai plan): identifier backfill + legacy collision audit.
 *
 *   node scripts/audit-identifier-conflicts.mjs --supabase "$SUPABASE_DATABASE_URL" --report
 *   node scripts/audit-identifier-conflicts.mjs --supabase "$SUPABASE_DATABASE_URL" --apply
 *   node scripts/audit-identifier-conflicts.mjs --sqlite data/generated/horse-registry.sqlite --report
 *
 * --report (default) is a DRY RUN: it lists every legacy collision and what
 * would be backfilled, touching nothing. --apply is idempotent:
 *   * every live horse keeps at most one row per identifier kind;
 *   * the lowest-id live horse in a collision group keeps status='live';
 *   * every other claimant gets status='conflict' plus an identifier_conflicts
 *     queue row for admin resolution — no horse is ever deleted or merged;
 *   * re-running skips horses and conflicts already recorded.
 *
 * Namespaces: legacy register numbers are issuer-unattributed by design —
 * 'registry:legacy:unattributed' (never guess the issuer). Microchips are
 * global ('microchip'), UEL numbers 'uel', life numbers 'life'. New editorial
 * writes claim 'registry:platform' — they cannot silently take over a legacy
 * number because the application-level duplicate guard still applies.
 */
import postgres from "postgres";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// Mirrors normalizeIdentifierValue in src/registry/identifiers.ts (kept in
// sync deliberately — the TS module pulls the whole API graph with it).
function normalizeIdentifierValue(value) {
  let out = String(value).normalize("NFKC").trim();
  out = out.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  out = out.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  out = out.replace(/\s+/g, " ");
  return out.trim();
}

const KINDS = [
  { field: "register_no", namespace: "registry:legacy:unattributed" },
  { field: "microchip_no", namespace: "microchip" },
  { field: "uel_no", namespace: "uel" },
  { field: "life_number", namespace: "life" },
];

function parseArgs(argv) {
  const args = { mode: "report", sqlite: null, supabase: null, limit: 50 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.mode = "apply";
    else if (arg === "--report") args.mode = "report";
    else if (arg === "--supabase") args.supabase = argv[++i];
    else if (arg === "--sqlite") args.sqlite = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!args.supabase && process.env.SUPABASE_DATABASE_URL) args.supabase = process.env.SUPABASE_DATABASE_URL;
  if (!args.supabase && !args.sqlite) {
    console.error("Need --supabase <url> (or SUPABASE_DATABASE_URL) or --sqlite <file>");
    process.exit(2);
  }
  return args;
}

async function makeBackend(args) {
  if (args.supabase) {
    const sql = postgres(args.supabase, { max: 1, idle_timeout: 5, connect_timeout: 15 });
    return {
      kind: "postgres",
      async select(query, params) {
        return await sql.unsafe(query, params);
      },
      // Multi-row INSERT chunks: 240k single-row statements over the pooler is
      // far too slow; ~500-row batches keep the whole backfill under a minute.
      async insertRows(table, columns, rows) {
        if (!rows.length) return 0;
        const CHUNK = 500;
        let applied = 0;
        for (let start = 0; start < rows.length; start += CHUNK) {
          const chunk = rows.slice(start, start + CHUNK);
          const tuples = chunk.map((row) => `(${row.map((value) => typeof value === "number" ? value : `'${String(value).replaceAll("'", "''")}'`).join(",")})`).join(",");
          await sql.unsafe(`INSERT INTO ${table}(${columns.join(",")}) VALUES ${tuples}`);
          applied += chunk.length;
          if (rows.length > CHUNK) console.log(`  ${table}: ${applied}/${rows.length}`);
        }
        return applied;
      },
      async close() {
        await sql.end({ timeout: 5 });
      },
    };
  }
  const client = createClient({ url: `file:${args.sqlite}` });
  return {
    kind: "sqlite",
    async select(query, params) {
      const result = await client.execute({ sql: query, args: params });
      return result.rows;
    },
    async insertRows(table, columns, rows) {
      if (!rows.length) return 0;
      const CHUNK = 500;
      let applied = 0;
      for (let start = 0; start < rows.length; start += CHUNK) {
        const chunk = rows.slice(start, start + CHUNK);
        const placeholdersSql = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
        await client.execute({
          sql: `INSERT INTO ${table}(${columns.join(",")}) VALUES ${placeholdersSql}`,
          args: chunk.flat(),
        });
        applied += chunk.length;
      }
      return applied;
    },
    async close() {
      client.close();
    },
  };
}

function placeholders(backend, count) {
  if (backend.kind === "postgres") return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(",");
  return Array.from({ length: count }, () => "?").join(",");
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backend = await makeBackend(args);

  const horses = await backend.select(
    `SELECT id,register_no,microchip_no,uel_no,life_number FROM horses
     WHERE deleted_at IS NULL
       AND ((register_no IS NOT NULL AND TRIM(register_no)!='')
         OR (microchip_no IS NOT NULL AND TRIM(microchip_no)!='')
         OR (uel_no IS NOT NULL AND TRIM(uel_no)!='')
         OR (life_number IS NOT NULL AND TRIM(life_number)!=''))
     ORDER BY id`,
    [],
  );

  const groups = new Map(); // kind|namespace|normalized -> [{id, raw}]
  for (const horse of horses) {
    for (const kind of KINDS) {
      const raw = String(horse[kind.field] ?? "").trim();
      if (!raw) continue;
      const normalized = normalizeIdentifierValue(raw);
      if (!normalized) continue;
      const key = `${kind.field}|${kind.namespace}|${normalized}`;
      if (!groups.has(key)) groups.set(key, { kind: kind.field, namespace: kind.namespace, normalized, claimants: [] });
      groups.get(key).claimants.push({ id: Number(horse.id), raw });
    }
  }

  const collisions = [...groups.values()].filter((group) => group.claimants.length > 1);
  const totalRows = [...groups.values()].reduce((sum, group) => sum + group.claimants.length, 0);

  console.log(`Live horses with identifiers: ${horses.length}`);
  console.log(`Distinct (kind,namespace,value) groups: ${groups.size} covering ${totalRows} identifier claims`);
  console.log(`Legacy collision groups: ${collisions.length} (${collisions.reduce((s, g) => s + g.claimants.length - 1, 0)} extra claimants)`);

  if (collisions.length) {
    console.log("\nTop collisions (kept = lowest live horse id):");
    for (const group of collisions.slice(0, args.limit)) {
      const kept = group.claimants[0];
      const others = group.claimants.slice(1);
      console.log(
        `  [${group.kind}] "${group.normalized}" kept horse #${kept.id}` +
          ` <- conflicts ${others.map((claimant) => `#${claimant.id}`).join(", ")}`,
      );
    }
    if (collisions.length > args.limit) console.log(`  ... and ${collisions.length - args.limit} more groups`);
  }

  if (args.mode === "report") {
    console.log("\n(dry run — pass --apply to backfill horse_identifiers and queue conflicts)");
    await backend.close();
    return;
  }

  // Idempotency: skip (horse, kind) pairs already recorded, in ANY status.
  const existing = await backend.select(`SELECT horse_id,kind FROM horse_identifiers`, []);
  const existingPairs = new Set(existing.map((row) => `${Number(row.horse_id)}|${row.kind}`));
  const existingConflicts = await backend.select(
    `SELECT kind,kept_horse_id,conflicting_horse_id FROM identifier_conflicts`,
    [],
  );
  const existingConflictKeys = new Set(
    existingConflicts.map((row) => `${row.kind}|${Number(row.kept_horse_id)}|${Number(row.conflicting_horse_id)}`),
  );

  const identifierRows = [];
  const conflictRows = [];
  const now = new Date();
  const nowText = now.toISOString().slice(0, 19).replace("T", " "); // SQLite/Postgres shared UTC text form
  let liveInserted = 0;
  let conflictInserted = 0;
  let queueInserted = 0;
  for (const group of groups.values()) {
    const claimants = [...group.claimants].sort((a, b) => a.id - b.id);
    const kept = claimants[0];
    for (let index = 0; index < claimants.length; index += 1) {
      const claimant = claimants[index];
      if (existingPairs.has(`${claimant.id}|${group.kind}`)) continue;
      const status = group.claimants.length === 1 || index === 0 ? "live" : "conflict";
      identifierRows.push([group.kind, group.namespace, group.normalized, claimant.raw, claimant.id, status, "legacy_import", nowText, nowText]);
      if (status === "live") liveInserted += 1;
      else {
        conflictInserted += 1;
        if (!existingConflictKeys.has(`${group.kind}|${kept.id}|${claimant.id}`)) {
          conflictRows.push([group.kind, group.namespace, group.normalized, claimant.raw, kept.id, claimant.id, nowText]);
          queueInserted += 1;
        }
      }
    }
  }

  console.log(`\nPlanned inserts: ${liveInserted} live rows, ${conflictInserted} conflict rows, ${queueInserted} conflict-queue rows`);
  if (!identifierRows.length && !conflictRows.length) {
    console.log("Nothing to do — horse_identifiers is already up to date.");
    await backend.close();
    return;
  }
  const appliedRows = await backend.insertRows("horse_identifiers", ["kind", "issuer_namespace", "normalized_value", "raw_value", "horse_id", "status", "source_id", "created_at", "updated_at"], identifierRows);
  const appliedConflicts = await backend.insertRows("identifier_conflicts", ["kind", "issuer_namespace", "normalized_value", "raw_value", "kept_horse_id", "conflicting_horse_id", "detected_at"], conflictRows);
  console.log(`Applied ${appliedRows} identifier rows + ${appliedConflicts} conflict-queue rows to ${backend.kind}.`);
  await backend.close();
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.stack : cause);
  process.exit(1);
});
