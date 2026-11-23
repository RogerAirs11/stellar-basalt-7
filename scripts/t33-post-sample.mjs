import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const p = await sql`select id, slug, kind, title_en, title_fa, summary_en, author_label, cover_image_url, cover_image_credit, row_version,
  length(body_en) len_en, tags_json, published_at from content_posts where status='published' order by published_at desc limit 3`;
for (const x of p) {
  console.log('---', x.slug, x.kind, x.row_version, 'len', x.len_en, 'cover', x.cover_image_url);
  console.log('title:', x.title_en);
  console.log('summary:', x.summary_en?.slice(0, 120));
  console.log('author:', x.author_label, '| tags:', JSON.stringify(x.tags_json).slice(0, 100), '| pub:', x.published_at);
}
const b = await sql`select body_en from content_posts where slug=${p[0].slug}`;
console.log('\nBODY SAMPLE (first 900 chars):\n', b[0].body_en.slice(0, 900));
const ids = await sql`select max(id) mx, min(id) mn from content_posts`;
console.log('\npost id range:', ids[0]);
const cids = await sql`select max(id) mx from content_comments`;
console.log('comment id max:', cids[0]);
await sql.end();
