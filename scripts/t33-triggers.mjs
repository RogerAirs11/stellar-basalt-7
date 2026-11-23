import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const t = await sql`select tgname, pg_get_triggerdef(oid) def from pg_trigger where tgrelid='horses'::regclass and not tgisinternal`;
console.log('triggers on horses:', t.length); for (const x of t) console.log(x.tgname, '::', x.def.slice(0, 200));
// check canonical_mutation_log recent
const l = await sql`select count(*)::int n from canonical_mutation_log where created_at > '2026-10-24'`;
console.log('mutations today:', l[0].n);
await sql.end();
