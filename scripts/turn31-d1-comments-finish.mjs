// turn 31 finisher: sync remaining comments to D1 in parallel batches.
// R131 SECURITY SCRUB (R129 precedent): this script shipped with the live
// Cloudflare API token and the Supabase pooler URL+password inline — the same
// leak class R129 scrubbed from sandbox/rebuild-sandbox.sh. All credentials
// now come from the environment (canonical store: vault TOKENS.md):
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID,
//   SUPABASE_DATABASE_URL
import postgres from "postgres";

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_ID = process.env.D1_DATABASE_ID;
if (!CF_ACCOUNT || !CF_TOKEN || !D1_ID) throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and D1_DATABASE_ID (vault TOKENS.md)");
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ID}/query`;

async function d1(sql, params = []) {
  for (let a = 1; a <= 3; a++) {
    const res = await fetch(DB, {
      method: "POST",
      headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const json = await res.json();
    if (json.success) return json.result[0].results;
    await new Promise(r => setTimeout(r, 800 * a));
  }
  throw new Error("D1 failed after retries");
}

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) throw new Error("Set SUPABASE_DATABASE_URL (vault TOKENS.md)");
const sql = postgres(SUPABASE_URL, { max: 1, connect_timeout: 20, prepare: false });

const comments = await sql`SELECT id, post_id, author_name, body, locale, likes, status, created_at FROM content_comments`;
console.log("comments in Supabase:", comments.length);

let done = 0, failed = 0, CONC = 12;
async function worker(queue) {
  while (queue.length) {
    const c = queue.pop();
    try {
      await d1(`INSERT INTO content_comments(id, post_id, author_name, body, locale, likes, status, created_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (id) DO UPDATE SET author_name=excluded.author_name, body=excluded.body,
          likes=excluded.likes, status=excluded.status`,
        [c.id, c.post_id, c.author_name, c.body, c.locale, c.likes, c.status, String(c.created_at)]);
      done++;
    } catch (e) { failed++; console.log("fail", c.id, String(e.message).slice(0, 80)); }
  }
}
const queue = [...comments];
await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
console.log(`synced this run: ${done}, failed: ${failed}`);

const check = await d1("SELECT (SELECT COUNT(*) FROM content_posts) p, (SELECT COUNT(*) FROM content_comments) c");
console.log("D1 now:", JSON.stringify(check));
await sql.end();
