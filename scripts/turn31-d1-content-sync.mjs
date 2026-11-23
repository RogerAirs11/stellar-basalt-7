// turn 31: sync content_posts (+covers, inline figures) and content_comments
// from Supabase (canonical) to the D1 failover replica. Idempotent upserts.
import postgres from "postgres";

// R131 SECURITY SCRUB (R129 precedent): credentials moved to the environment
// (canonical store: vault TOKENS.md) — CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
// D1_DATABASE_ID, SUPABASE_DATABASE_URL.
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_ID = process.env.D1_DATABASE_ID;
if (!CF_ACCOUNT || !CF_TOKEN || !D1_ID) throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and D1_DATABASE_ID (vault TOKENS.md)");
const DB = "https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/d1/database/" + D1_ID + "/query";

async function d1(sql, params = []) {
  const res = await fetch(DB, {
    method: "POST",
    headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) throw new Error("D1: " + JSON.stringify(json.errors).slice(0, 200));
  return json.result[0].results;
}

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) throw new Error("Set SUPABASE_DATABASE_URL (vault TOKENS.md)");
const sql = postgres(SUPABASE_URL, { max: 1, connect_timeout: 20, prepare: false });

// ---- posts ----
const posts = await sql`
  SELECT id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
    summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
    tags_json, sources_json, author_label, ai_model, ai_grounding, ai_prompt,
    cover_image_url, cover_image_alt_en, cover_image_alt_fa, cover_image_credit, cover_image_source_url,
    published_at, updated_at
  FROM content_posts WHERE status='published' ORDER BY id`;
console.log("published posts:", posts.length);

let pi = 0;
for (const p of posts) {
  const v = [...posts[pi] ? [
    p.id, p.slug, p.kind, p.status, p.title_en, p.title_fa, p.title_ar, p.title_zh,
    p.summary_en, p.summary_fa, p.summary_ar, p.summary_zh, p.body_en, p.body_fa, p.body_ar, p.body_zh,
    p.tags_json, p.sources_json, p.author_label, p.ai_model, p.ai_grounding, p.ai_prompt,
    p.cover_image_url, p.cover_image_alt_en, p.cover_image_alt_fa, p.cover_image_credit, p.cover_image_source_url,
    p.published_at, p.updated_at,
  ] : []].map(x => (x === null || x === undefined) ? null : String(x));
  pi++;
  await d1(`INSERT INTO content_posts(id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
    summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
    tags_json, sources_json, author_label, ai_model, ai_grounding, ai_prompt,
    cover_image_url, cover_image_alt_en, cover_image_alt_fa, cover_image_credit, cover_image_source_url,
    published_at, updated_at, created_at, row_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
      COALESCE((SELECT created_at FROM content_posts WHERE id=?), '2026-10-23T00:00:00Z'), 1)
    ON CONFLICT (slug) DO UPDATE SET kind=excluded.kind, status=excluded.status,
    title_en=excluded.title_en, title_fa=excluded.title_fa, title_ar=excluded.title_ar, title_zh=excluded.title_zh,
    summary_en=excluded.summary_en, summary_fa=excluded.summary_fa, summary_ar=excluded.summary_ar, summary_zh=excluded.summary_zh,
    body_en=excluded.body_en, body_fa=excluded.body_fa, body_ar=excluded.body_ar, body_zh=excluded.body_zh,
    tags_json=excluded.tags_json, sources_json=excluded.sources_json, author_label=excluded.author_label,
    ai_model=excluded.ai_model, ai_grounding=excluded.ai_grounding, ai_prompt=excluded.ai_prompt,
    cover_image_url=excluded.cover_image_url, cover_image_alt_en=excluded.cover_image_alt_en,
    cover_image_alt_fa=excluded.cover_image_alt_fa, cover_image_credit=excluded.cover_image_credit,
    cover_image_source_url=excluded.cover_image_source_url,
    published_at=excluded.published_at, updated_at=excluded.updated_at, row_version=excluded.row_version`,
    [...v, p.id]);
  pi - 1;
}
console.log("posts synced:", posts.length);

// ---- comments ----
const comments = await sql`SELECT id, post_id, author_name, body, locale, likes, status, created_at FROM content_comments`;
console.log("comments:", comments.length);
let ci = 0;
for (const c of comments) {
  await d1(`INSERT INTO content_comments(id, post_id, author_name, body, locale, likes, status, created_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (id) DO UPDATE SET author_name=excluded.author_name, body=excluded.body,
      likes=excluded.likes, status=excluded.status`,
    [c.id, c.post_id, c.author_name, c.body, c.locale, c.likes, c.status, String(c.created_at)]);
  ci++;
}
console.log("comments synced:", ci);

const check = await d1("SELECT (SELECT COUNT(*) FROM content_posts) p, (SELECT COUNT(*) FROM content_comments) c");
console.log("D1 now:", JSON.stringify(check));
await sql.end();
