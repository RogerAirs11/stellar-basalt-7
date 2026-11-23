// turn-33 probe: did the turn-32 image wiring survive in the canonical DB?
import postgres from "postgres";
const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 1, idle_timeout: 5 },
);
try {
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='horses' AND column_name LIKE 'profile_image%'`;
  console.log("horse image columns:", cols.map(r => r.column_name).join(", ") || "NONE");
  const cols2 = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='competitions' AND column_name LIKE 'image%'`;
  console.log("competition image columns:", cols2.map(r => r.column_name).join(", ") || "NONE");
  if (cols.length) {
    const c1 = await sql`SELECT COUNT(*)::int c FROM horses WHERE profile_image_url IS NOT NULL`;
    console.log("horses with photo:", c1[0].c);
    const sample = await sql`SELECT id, name_latin, profile_image_url FROM horses WHERE profile_image_url IS NOT NULL LIMIT 3`;
    console.log(sample);
  }
  if (cols2.length) {
    const c2 = await sql`SELECT COUNT(*)::int c FROM competitions WHERE image_url IS NOT NULL`;
    console.log("competitions with image:", c2[0].c);
  }
} finally { await sql.end({ timeout: 5 }); }
