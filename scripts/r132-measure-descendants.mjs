import postgres from "postgres";
const url = process.env.SUPABASE_DATABASE_URL;
const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, fetch_types: false });

// Which sires have the most children (proxy for worst-case descendant trees)?
const top = await sql`
  SELECT father_id AS id, COUNT(*) AS kids
  FROM horses WHERE father_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY father_id ORDER BY kids DESC LIMIT 3`;
console.log("top sires by children:", top);

for (const sire of top) {
  const t0 = Date.now();
  const rows = await sql`
    WITH RECURSIVE walk(id, depth) AS (
      SELECT h.id, 0 FROM horses h WHERE h.id = ${sire.id} AND h.deleted_at IS NULL
      UNION
      SELECT child.id, a.depth + 1
      FROM walk a
      JOIN horses child ON child.deleted_at IS NULL
        AND (child.father_id = a.id OR child.mother_id = a.id)
      WHERE a.depth < 6
    )
    SELECT id, depth FROM walk`;
  const byDepth = {};
  for (const row of rows) byDepth[row.depth] = (byDepth[row.depth] ?? 0) + 1;
  console.log(`sire ${sire.id}: ${rows.length} pairs in ${Date.now() - t0}ms — by depth:`, byDepth);
}
await sql.end({ timeout: 3 });
