import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5});
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/f527d88f-c274-4a11-8d17-37dc43ba9027/query`;
async function d1(q, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 150));
  return json.result[0].results;
}
const horses = await sql`select id::text id, profile_image_url, profile_image_credit, description from horses where profile_image_url is not null`;
console.log('horses:', horses.length);
const queue = [...horses];
const worker = async () => {
  while (queue.length) {
    const h = queue.shift();
    await d1(`UPDATE horses SET profile_image_url=?, profile_image_credit=?, description=? WHERE id=?`, [h.profile_image_url, h.profile_image_credit, h.description, h.id]);
  }
};
await Promise.all(Array.from({ length: 10 }, worker));
const v = await d1("select count(*) n from horses where profile_image_url like '/images/horses/sq-%'");
console.log('D1 sq- photos now:', v[0].n);
await sql.end();
