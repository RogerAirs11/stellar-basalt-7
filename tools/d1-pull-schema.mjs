// tools/d1-pull-schema.mjs — dump live D1 schema (sqlite_master) to a JSON file.
// Usage: node tools/d1-pull-schema.mjs [output.json]
import { writeFileSync } from "node:fs";

const CF_ACC = process.env.CLOUDFLARE_ACCOUNT_ID ?? "d75bc9215eaa1c0fc53b7f716195fdfc";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DB = "f527d88f-c274-4a11-8d17-37dc43ba9027";
if (!CF_TOKEN) {
  console.error("Set CLOUDFLARE_API_TOKEN");
  process.exit(1);
}

async function d1Query(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACC}/d1/database/${D1_DB}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error("D1 error: " + JSON.stringify(data.errors));
  return data.result?.[0]?.results ?? [];
}

const rows = await d1Query(
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' AND name != 'd1_migrations' ORDER BY type DESC, name",
);

const out = process.argv[2] ?? new URL("../sandbox/d1-live-schema.json", import.meta.url).pathname;
writeFileSync(out, JSON.stringify(rows, null, 2));
const tables = rows.filter((r) => r.type === "table");
const indexes = rows.filter((r) => r.type === "index");
const others = rows.filter((r) => r.type !== "table" && r.type !== "index");
console.log(`tables: ${tables.length} (virtual: ${tables.filter((t) => /VIRTUAL/i.test(t.sql ?? "")).length}), indexes: ${indexes.length}, other: ${others.length}`);
console.log("written:", out);
