const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/f527d88f-c274-4a11-8d17-37dc43ba9027/query`;
async function d1(sql, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 150));
  return json.result[0].results;
}
const r = await d1("select id, profile_image_url from horses where id in ('400921','6824','11579')");
console.log(r);
const n = await d1("select count(*) n from horses where profile_image_url like '/images/horses/sq-%'");
console.log('D1 sq- count:', n[0].n);
