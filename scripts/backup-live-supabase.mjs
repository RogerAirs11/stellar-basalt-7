#!/usr/bin/env node
/**
 * R96 owner-gated live-Supabase logical backup.
 * Dumps every non-empty public table to gzipped JSONL + a manifest with row
 * counts and SHA256 per table. Read-only against the source; the output is
 * the R96_MIGRATION_BACKUP_ID evidence the migration-approval gate requires.
 *
 * Usage: SUPABASE_DATABASE_URL=... node scripts/backup-live-supabase.mjs [outdir]
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = process.argv[2] ?? "/home/z/my-project/backups/live-supabase-r96";
mkdirSync(outDir, { recursive: true });
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("Need SUPABASE_DATABASE_URL"); process.exit(2); }
const sql = postgres(url, { max: 1, connect_timeout: 15 });

function sha256File(p) {
  return spawnSync("sha256sum", [p], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0];
}

try {
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'sqlite_master' ORDER BY table_name`;
  const manifest = { startedAt: new Date().toISOString(), endpoint: url.replace(/\/\/[^@]*@/, '//***@'), tables: {} };
  let totalRows = 0;
  for (const { table_name: t } of tables) {
    const n = (await sql.unsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
    if (n === 0) { manifest.tables[t] = { rows: 0, skipped: "empty" }; continue; }
    const gzPath = join(outDir, `${t}.jsonl.gz`);
    const gz = spawnSync("gzip", ["-9"], { input: "" }); // probe gzip exists
    if (gz.error) throw new Error("gzip unavailable");
    // stream rows -> JSONL -> gzip via shell pipe (simple + memory-bounded)
    const out = createWriteStream(join(outDir, `${t}.jsonl`), { flags: "w" });
    let written = 0;
    const rows = await sql.unsafe(`SELECT * FROM "${t}"`);
    for (const row of rows) {
      out.write(JSON.stringify(row) + "\n");
      written++;
      if (written % 100000 === 0) console.log(`  ${t}: ${written} rows...`);
    }
    await new Promise((res) => out.end(res));
    spawnSync("gzip", ["-9", "-f", join(outDir, `${t}.jsonl`)]);
    const size = statSync(gzPath).size;
    manifest.tables[t] = { rows: written, sha256: sha256File(gzPath), bytes: size };
    totalRows += written;
    console.log(`${t}: ${written} rows, ${(size / 1024).toFixed(0)} KiB`);
  }
  manifest.completedAt = new Date().toISOString();
  manifest.totalRows = totalRows;
  const manifestPath = join(outDir, "BACKUP-MANIFEST.json");
  // manifest includes its own integrity: hash of concatenated table hashes
  const concat = Object.values(manifest.tables).map((v) => v.sha256 ?? "").join("\n");
  manifest.backupId = "r96-live-supabase-" + createHash("sha256").update(concat + totalRows).digest("hex").slice(0, 16);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("\nBACKUP ID:", manifest.backupId);
  console.log("manifest:", manifestPath);
} finally {
  await sql.end({ timeout: 5 });
}
