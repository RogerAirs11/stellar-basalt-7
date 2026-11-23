import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const p = await sql`select distinct ai_model, author_label, kind, row_version from content_posts where status='published' limit 8`;
console.log(p.map(r => `${r.kind} | v${r.row_version} | ${r.author_label} | ${r.ai_model}`).join('\n'));
const g = await sql`select ai_grounding, sources_json from content_posts where status='published' and ai_grounding is not null limit 1`;
console.log('\ngrounding:', JSON.stringify(g[0])?.slice(0, 400));
await sql.end();
