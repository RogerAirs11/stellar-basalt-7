const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_ID = process.env.D1_DATABASE_ID;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ID}/query`;
async function d1(sql, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 200));
  return json.result[0].results;
}
const p = await d1("select count(*) n from content_posts where status='published'");
const c = await d1("select count(*) n from content_comments");
const h = await d1("select count(*) n from horses where profile_image_url is not null");
const ci = await d1("select count(*) n from competitions where image_url is not null");
const hp = await d1("select name from pragma_table_info('horses') where name in ('profile_image_url','birth_city','description')");
console.log('D1 posts:', p[0].n, '| comments:', c[0].n, '| horses w/ photo:', h[0].n, '| comps w/ img:', ci[0].n, '| horse cols:', hp.map(x=>x.column_name).join(','));
