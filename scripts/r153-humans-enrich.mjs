// R153: enrich racing_humans on Supabase primary —
// (1) insert riders/coaches found in racing_results but missing from racing_humans
// (2) refresh starts/p1/p2/p3 standings derived from racing_results (GREATEST semantics: never decrease)
// Idempotent: re-run inserts nothing and updates nothing.
import postgres from "postgres";
import fs from "fs";

const sql = postgres(process.env.SUPA_URL, { max: 1, prepare: false });
await sql`set statement_timeout = 0`;
const SRC_TAG = "derive:racing_results/2026-10-29";

(async () => {
  // 1. derive per-person stats from results — single pass with window functions
  console.log("deriving rider+coach standings (single pass)...");
  const derived = await sql`
    with sides as (
      select rider_id as pid, rider_name as pname, rank, true as as_rider, false as as_coach
        from racing_results where rider_id is not null and rider_id <> ''
      union all
      select coach_id, coach_name, rank, false, true
        from racing_results where coach_id is not null and coach_id <> ''
    ),
    nm as (
      select pid, pname from (
        select pid, pname, row_number() over (
          partition by pid order by count(*) desc, length(pname) asc) rn
        from sides where pname is not null and trim(pname) <> ''
        group by pid, pname
      ) y where rn = 1
    ),
    st as (
      select pid, bool_or(as_rider) as_rider, bool_or(as_coach) as_coach,
             count(*) filter (where rank >= 1) as starts,
             count(*) filter (where rank = 1) as p1,
             count(*) filter (where rank = 2) as p2,
             count(*) filter (where rank = 3) as p3
      from sides group by pid
    )
    select st.pid, nm.pname, st.as_rider, st.as_coach,
           st.starts::int starts, st.p1::int p1, st.p2::int p2, st.p3::int p3
    from st left join nm on nm.pid = st.pid`;
  console.log(`distinct real humans in results: ${derived.length}`);
  const map = new Map();
  for (const d of derived) {
    map.set(d.pid, { name: d.pname, starts: Number(d.starts), p1: Number(d.p1), p2: Number(d.p2), p3: Number(d.p3), asRider: d.as_rider, asCoach: d.as_coach });
  }

  const existing = await sql`select human_id from racing_humans`;
  const existingSet = new Set(existing.map((e) => e.human_id));

  const ledger = { ts: new Date().toISOString(), tag: SRC_TAG, derived_humans: map.size, inserted: 0, updated: 0, unchanged: 0 };

  // 2. insert missing humans
  const toInsert = [...map.entries()].filter(([pid]) => !existingSet.has(pid));
  console.log(`missing from racing_humans: ${toInsert.length} — inserting...`);
  const now = new Date().toISOString();
  let ins = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const ids = [], names = [], roles = [], starts = [], p1s = [], p2s = [], p3s = [], srcs = [], nows = [];
    for (const [pid, d] of chunk) {
      const role = d.asRider && d.asCoach ? "COACH|RACE_RIDER" : d.asRider ? "RACE_RIDER" : "COACH";
      ids.push(pid); names.push(d.name); roles.push(role); starts.push(d.starts);
      p1s.push(d.p1); p2s.push(d.p2); p3s.push(d.p3); srcs.push(SRC_TAG); nows.push(now);
    }
    await sql`
      insert into racing_humans (human_id, name, role, starts, p1, p2, p3, source, created_at)
      select * from unnest(${ids}::text[], ${names}::text[], ${roles}::text[], ${starts}::int[], ${p1s}::int[], ${p2s}::int[], ${p3s}::int[], ${srcs}::text[], ${nows}::text[])
      on conflict (human_id) do nothing`;
    ins += chunk.length;
    if (ins % 2000 === 0) console.log(`  inserted ${ins}/${toInsert.length}`);
  }
  ledger.inserted = ins;
  console.log(`inserted: ${ins}`);

  // 3. refresh standings for existing humans (GREATEST — never decrease)
  console.log("refreshing standings for existing humans (GREATEST)...");
  const updates = [...map.entries()].filter(([pid]) => existingSet.has(pid));
  let upd = 0, unch = 0;
  for (let i = 0; i < updates.length; i += 300) {
    const chunk = updates.slice(i, i + 300);
    const ids = [], starts = [], p1s = [], p2s = [], p3s = [];
    for (const [pid, d] of chunk) { ids.push(pid); starts.push(d.starts); p1s.push(d.p1); p2s.push(d.p2); p3s.push(d.p3); }
    const r = await sql`
      update racing_humans h set
        starts = greatest(h.starts, v.starts), p1 = greatest(h.p1, v.p1),
        p2 = greatest(h.p2, v.p2), p3 = greatest(h.p3, v.p3)
      from unnest(${ids}::text[], ${starts}::int[], ${p1s}::int[], ${p2s}::int[], ${p3s}::int[])
        as v(pid, starts, p1, p2, p3)
      where h.human_id = v.pid
        and (v.starts > h.starts or v.p1 > h.p1 or v.p2 > h.p2 or v.p3 > h.p3)
      returning h.human_id`;
    upd += r.count;
    unch += chunk.length - r.count;
  }
  ledger.updated = upd; ledger.unchanged = unch;
  console.log(`standings updated: ${upd}, already current: ${unch}`);

  // 4. final state
  const final = await sql`select count(*)::int n, sum(starts)::bigint starts_sum from racing_humans`;
  ledger.final_rows = final[0].n; ledger.final_starts_sum = Number(final[0].starts_sum);
  console.log("racing_humans final:", JSON.stringify(final[0]));

  fs.writeFileSync("/home/z/my-project/horse-registry/scripts/r153-humans-ledger.json", JSON.stringify(ledger, null, 2));
  console.log("ledger written");
  await sql.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
