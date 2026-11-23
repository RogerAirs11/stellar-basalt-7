import postgres from "postgres";

const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 10, idle_timeout: 5, connect_timeout: 15 }
);

// 1. Column fill-rate audit for horses
const cols = await sql`
  select column_name, data_type from information_schema.columns
  where table_name='horses' order by ordinal_position`;
const colNames = cols.map(c => c.column_name);

const gaps = {};
for (const c of colNames) {
  if (['id','created_at','updated_at','raw_json'].includes(c)) continue;
  const r = await sql.unsafe(`select count(*)::int n, count(${c})::int filled from horses`);
  const pct = Math.round((r[0].filled / r[0].n) * 100);
  if (pct < 90) gaps[c] = `${r[0].filled}/${r[0].n} (${pct}%)`;
}
console.log('=== HORSES: columns <90% filled ===');
for (const [k, v] of Object.entries(gaps)) console.log(' ', k, v);

// 2. Top horses by importance (racing wins)
const topRacing = await sql`
  select h.id, h.name, h.breed, h.sex, h.yob, coalesce(rs.wins,0) wins, coalesce(rs.starts,0) starts, h.profile_image_url
  from horses h join horse_racing_stats rs on rs.horse_id = h.id
  order by rs.wins desc, rs.starts desc nulls last limit 60`;
console.log('\n=== TOP 60 racing (by wins) ===');
for (const h of topRacing) console.log(` ${h.id} ${h.name} ${h.breed||''} w=${h.wins} s=${h.starts} photo=${!!h.profile_image_url}`);

// 3. Sport champions (wins field on horses?)
const hasWins = await sql`select column_name from information_schema.columns where table_name='horses' and column_name like '%win%'`;
console.log('\nhorses win-ish columns:', hasWins.map(r=>r.column_name));

// 4. competitions table state
const comp = await sql`select count(*)::int n, count(image_url)::int with_img from competitions`;
console.log('\ncompetitions:', comp[0]);

// 5. races/results coverage
const races = await sql`select count(*)::int n from racing_races`;
const results = await sql`select count(*)::int n from racing_results`;
const rs2 = await sql`select count(*)::int n from horse_racing_stats`;
console.log('racing_races:', races[0].n, 'racing_results:', results[0].n, 'horse_racing_stats:', rs2[0].n);

// 6. posts with figure counts
const figs = await sql`
  select
    count(*) filter (where body_en !~ '!\[')::int as none,
    count(*) filter (where (length(body_en) - length(replace(body_en,'![',''))) / 2 >= 1)::int as f1,
    count(*) filter (where (length(body_en) - length(replace(body_en,'![',''))) / 2 >= 2)::int as f2,
    count(*) filter (where (length(body_en) - length(replace(body_en,'![',''))) / 2 >= 3)::int as f3,
    count(*)::int total
  from content_posts where status='published'`;
console.log('post figures:', figs[0]);

await sql.end();
