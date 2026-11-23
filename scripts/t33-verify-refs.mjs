import postgres from "postgres";
import { existsSync, statSync } from "node:fs";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const posts = await sql`select slug, cover_image_url, body_en from content_posts where id like 'turn33-%'`;
let miss = 0, over = 0, refs = 0;
const check = (url) => {
  const f = 'public' + url;
  refs++;
  if (!existsSync(f)) { console.log('MISSING', url); miss++; }
  else if (statSync(f).size > 50 * 1024) { console.log('OVER', url, Math.round(statSync(f).size/1024), 'KB'); over++; }
};
for (const p of posts) {
  check(p.cover_image_url);
  const figs = [...p.body_en.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  const inline = figs.filter(u => u.startsWith('/images/'));
  console.log(p.slug.slice(0, 44), '| cover ok | inline figs:', inline.length);
  for (const u of inline) check(u);
}
console.log('refs checked:', refs, 'missing:', miss, 'over50kb:', over);
await sql.end();
