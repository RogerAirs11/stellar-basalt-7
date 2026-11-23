// turn-33: audit every DB image URL against the committed repo files.
// Any URL whose file does not exist under public/ renders as the SPA-fallback
// HTML (200 but undecodable -> an empty portrait), so this must stay at zero.
// Usage: node scripts/turn33-audit-image-urls.mjs   (read-only)
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 1, connect_timeout: 20, prepare: false });
const root = process.cwd();
const exists = (u) => u && fs.existsSync(path.join(root, "public", u));
const horses = await sql`SELECT profile_image_url u, COUNT(*)::int c FROM horses WHERE profile_image_url IS NOT NULL GROUP BY 1 ORDER BY 1`;
const comps = await sql`SELECT image_url u, COUNT(*)::int c FROM competitions WHERE image_url IS NOT NULL GROUP BY 1 ORDER BY 1`;
let bad = 0;
for (const r of [...horses, ...comps]) if (!exists(r.u)) { bad += r.c; console.log("ORPHAN:", r.u, "x" + r.c); }
console.log(`distinct horse urls: ${horses.length}, competition urls: ${comps.length}, orphan rows: ${bad}`);
await sql.end({ timeout: 5 });
process.exit(bad ? 1 : 0);
