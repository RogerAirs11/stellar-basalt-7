import postgres from "postgres";
import { existsSync, statSync } from "node:fs";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
// every /images/ reference across posts (bodies+covers) and horses/competitions must resolve
const posts = await sql`select slug, cover_image_url, body_en, body_fa, body_ar, body_zh from content_posts where status='published'`;
const refs = new Set();
const add = (s) => { if (!s) return; for (const m of s.matchAll(/\/images\/[\w./-]+\.webp/g)) refs.add(m[0]); };
for (const p of posts) { add(p.cover_image_url); add(p.body_en); add(p.body_fa); add(p.body_ar); add(p.body_zh); }
const hp = await sql`select profile_image_url u from horses where profile_image_url is not null`;
for (const h of hp) add(h.u);
const cp = await sql`select image_url u from competitions where image_url is not null`;
for (const c of cp) add(c.u);
let miss = 0, over = 0;
for (const r of refs) {
  const f = 'public' + r;
  if (!existsSync(f)) { console.log('MISSING', r); miss++; }
  else if (statSync(f).size > 50 * 1024) { console.log('OVER', r, Math.round(statSync(f).size / 1024), 'KB'); over++; }
}
console.log('total refs:', refs.size, '| missing:', miss, '| over50KB:', over);
await sql.end();
