import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5});
import { readFileSync } from 'node:fs';
const a = JSON.parse(readFileSync('scripts/t33-top100-assignments.json','utf8'));
const CREDIT = {
  racing: "Race-day photograph (asbdavani.app blog) — representative of the horse's racing career, not a passport photo",
  sire: "Representative stallion portrait (web source) — not the horse's passport photo",
  sport: "Representative sport-horse portrait (web source) — not the horse's passport photo",
};
let n = 0;
for (const x of a) {
  const r = await sql`update horses set profile_image_url=${x.url}, profile_image_credit=${CREDIT[x.cat]} where id=${x.id} returning id`;
  if (!r.length) console.log('NO ROW', x.id, x.name);
  n += r.length;
}
console.log('reapplied:', n);
const v = await sql`select count(*)::int n from horses where profile_image_url like '/images/horses/sq-%' or profile_image_url like '/images/horses/sp2-%' or profile_image_url like '%horse-web-%'`;
console.log('new-style photos now:', v[0].n);
await sql.end();
