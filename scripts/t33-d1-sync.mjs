// Turn 33: D1 failover sync — new posts, comments, top-100 horse images/descriptions, competitions
// 12-way parallel batch upserts.
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_ID = process.env.D1_DATABASE_ID;
const SUPA = `${process.env.SUPABASE_DATABASE_URL}`;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ID}/query`;

async function d1(sql, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error('D1: ' + JSON.stringify(json.errors).slice(0, 200));
  return json.result[0].results;
}
// D1 REST endpoint is single-statement; parallelism instead of batching
async function runParallel(stmts, width = 12) {
  const queue = [...stmts];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      await d1(s.sql, s.params);
      done++;
      if (done % 200 === 0) process.stdout.write(`\r  ${done}/${stmts.length}   `);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  process.stdout.write(`\r  ${done}/${stmts.length}\n`);
}

import postgres from "postgres";
const sql = postgres(SUPA, { max: 5, idle_timeout: 5 });

// 0. ensure columns
for (const c of ['profile_image_url', 'profile_image_credit', 'description', 'birth_city', 'birth_province']) {
  try { await d1(`ALTER TABLE horses ADD COLUMN ${c} TEXT`); console.log('col added:', c); } catch { /* exists */ }
}

// 1. top-100 horses + competitions
const horses = await sql`select id::text id, profile_image_url, profile_image_credit, description from horses where profile_image_url is not null`;
console.log('horses to sync:', horses.length);
{
  const stmts = horses.map(h => ({
    sql: `UPDATE horses SET profile_image_url=?, profile_image_credit=?, description=? WHERE id=?`,
    params: [h.profile_image_url, h.profile_image_credit, h.description, h.id],
  }));
  await runParallel(stmts);
  console.log('horses synced');
}
const comps = await sql`select id::text id, image_url, image_credit from competitions where image_url is not null`;
{
  const stmts = comps.map(c => ({
    sql: `UPDATE competitions SET image_url=?, image_credit=? WHERE id=?`,
    params: [c.image_url, c.image_credit, c.id],
  }));
  await runParallel(stmts);
  console.log('competitions synced:', comps.length);
}

// 2. posts (all published, upsert by slug)
const posts = await sql`
  SELECT id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
    summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
    tags_json, sources_json, author_label, ai_model, ai_grounding,
    cover_image_url, cover_image_alt_en, cover_image_alt_fa, cover_image_credit, cover_image_source_url,
    published_at, updated_at
  FROM content_posts WHERE status='published' ORDER BY id`;
console.log('posts to sync:', posts.length);
{
  const stmts = posts.map(p => ({
    sql: `INSERT INTO content_posts(id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
      summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
      tags_json, sources_json, author_label, ai_model, ai_grounding,
      cover_image_url, cover_image_alt_en, cover_image_alt_fa, cover_image_credit, cover_image_source_url,
      published_at, updated_at, created_at, row_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 1)
      ON CONFLICT (slug) DO UPDATE SET kind=excluded.kind, status=excluded.status,
      title_en=excluded.title_en, title_fa=excluded.title_fa, title_ar=excluded.title_ar, title_zh=excluded.title_zh,
      summary_en=excluded.summary_en, summary_fa=excluded.summary_fa, summary_ar=excluded.summary_ar, summary_zh=excluded.summary_zh,
      body_en=excluded.body_en, body_fa=excluded.body_fa, body_ar=excluded.body_ar, body_zh=excluded.body_zh,
      tags_json=excluded.tags_json, sources_json=excluded.sources_json, author_label=excluded.author_label,
      ai_model=excluded.ai_model, ai_grounding=excluded.ai_grounding,
      cover_image_url=excluded.cover_image_url, cover_image_alt_en=excluded.cover_image_alt_en,
      cover_image_alt_fa=excluded.cover_image_alt_fa, cover_image_credit=excluded.cover_image_credit,
      cover_image_source_url=excluded.cover_image_source_url,
      published_at=excluded.published_at, updated_at=excluded.updated_at, row_version=excluded.row_version`,
    params: [p.id, p.slug, p.kind, p.status, p.title_en, p.title_fa, p.title_ar, p.title_zh,
      p.summary_en, p.summary_fa, p.summary_ar, p.summary_zh, p.body_en, p.body_fa, p.body_ar, p.body_zh,
      p.tags_json, p.sources_json, p.author_label, p.ai_model, p.ai_grounding,
      p.cover_image_url, p.cover_image_alt_en, p.cover_image_alt_fa, p.cover_image_credit, p.cover_image_source_url,
      String(p.published_at), String(p.updated_at)],
  }));
  await runParallel(stmts);
}

// 3. comments (all, upsert by id)
const comments = await sql`SELECT id, post_id, author_name, body, locale, likes, status, created_at FROM content_comments`;
console.log('comments to sync:', comments.length);
{
  const stmts = comments.map(c => ({
    sql: `INSERT INTO content_comments(id, post_id, author_name, body, locale, likes, status, created_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET author_name=excluded.author_name, body=excluded.body, likes=excluded.likes, status=excluded.status`,
    params: [c.id, c.post_id, c.author_name, c.body, c.locale, c.likes || 0, c.status, String(c.created_at)],
  }));
  await runParallel(stmts);
}

// verify
const vp = await d1(`select count(*) n from content_posts where status='published'`);
const vc = await d1(`select count(*) n from content_comments`);
const vh = await d1(`select count(*) n from horses where profile_image_url is not null`);
console.log('D1 verify — posts:', vp[0].n, '| comments:', vc[0].n, '| horses w/ photo:', vh[0].n);
await sql.end();
