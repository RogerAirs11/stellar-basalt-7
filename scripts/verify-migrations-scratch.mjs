#!/usr/bin/env node
/**
 * R82 local check: apply every migration in order to a scratch SQLite db and
 * confirm 0033 creates its tables + indexes cleanly after 0001-0032.
 */
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const scratch = "/home/z/my-project/scratch-migrations.db";
try { rmSync(scratch); } catch {}
const client = createClient({ url: `file:${scratch}` });

const dir = "migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const sql = readFileSync(join(dir, file), "utf8");
  try {
    await client.executeMultiple(sql);
    console.log(`OK  ${file}`);
  } catch (cause) {
    console.error(`FAIL ${file}: ${cause instanceof Error ? cause.message : cause}`);
    process.exit(1);
  }
}

const check = await client.execute(
  "SELECT name FROM sqlite_master WHERE name IN ('horse_identifiers','identifier_conflicts','uq_horse_identifiers_live') ORDER BY name",
);
console.log("created objects:", check.rows.map((row) => row.name).join(", "));

// duplicate-live-identifier behavior
await client.executeMultiple(`
  INSERT INTO users(id,email,password_hash,display_name,role) VALUES('u1','a@b.c','x','A','admin');
`);
await client.executeMultiple(`INSERT INTO horses(id,name_latin,last_mutation_id) VALUES(1,'One','m1'),(2,'Two','m2');`);
await client.executeMultiple(`INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('register_no','registry:platform','100','100',1,'live','t');`);
try {
  await client.executeMultiple(`INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('register_no','registry:platform','100','100',2,'live','t');`);
  console.error("FAIL: duplicate live identifier was accepted");
  process.exit(1);
} catch {
  console.log("OK  duplicate live identifier rejected by unique partial index");
}
await client.executeMultiple(`INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('register_no','registry:platform','100','100',2,'superseded','t');`);
console.log("OK  non-live duplicate row allowed (history preserved)");

// horses table gained strain columns already? (0001 has them)
const cols = await client.execute("PRAGMA table_info(horses)");
const names = cols.rows.map((row) => row.name);
console.log("strains present in horses:", names.includes("main_strain_desc") && names.includes("sub_strain_desc"));
rmSync(scratch);
console.log("ALL MIGRATIONS APPLY CLEANLY");
