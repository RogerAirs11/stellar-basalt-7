#!/usr/bin/env python3
"""Turn 26: mirror content_posts (141 quadlingual) + horses delta + generation
state to Cloudflare D1. D1 stays a revert copy; read models stay stale-documented.

Credentials come from the environment (turn-27 scrub — the exporter's credential
gate caught this file carrying live secrets committed by the turn-26 session):
  CF_ACCOUNT_ID, CF_TOKEN (Cloudflare API), D1_DATABASE_ID,
  SUPABASE_DATABASE_URL (postgres pooler URL).
"""
import json, os, time, urllib.request

CF_ACCT = os.environ["CF_ACCOUNT_ID"]
CF_TOKEN = os.environ["CF_TOKEN"]
D1_ID = os.environ["D1_DATABASE_ID"]

def d1(sql, params=None):
    body = {"sql": sql}
    if params: body["params"] = params
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCT}/d1/database/{D1_ID}/query",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"D1 {e.code}: {detail} | sql: {sql[:120]} | nparams: {len(params) if params else 0}")
    if not out.get("success"):
        raise RuntimeError(json.dumps(out.get("errors"))[:300])
    return out["result"][0]["results"] if out.get("result") else []

import psycopg2
c = psycopg2.connect(os.environ["SUPABASE_DATABASE_URL"], connect_timeout=30)
cur = c.cursor()

t0 = time.time()
# ---------- 1) content_posts mirror ----------
cur.execute("""SELECT id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
  summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
  tags_json, sources_json, author_label, ai_model, ai_grounding, ai_prompt, published_at, updated_at
  FROM content_posts WHERE status='published' ORDER BY id""")
posts = cur.fetchall()
print("posts:", len(posts), flush=True)
ok = 0
for chunk_start in range(0, len(posts), 20):
    chunk = posts[chunk_start:chunk_start+20]
    for p in chunk:
        d1("""INSERT INTO content_posts(id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
          summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
          tags_json, sources_json, author_label, ai_model, ai_grounding, ai_prompt, published_at, updated_at, created_at, row_version)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? , COALESCE((SELECT created_at FROM content_posts WHERE id=?), '2026-10-23T00:00:00Z'), 1)
          ON CONFLICT (slug) DO UPDATE SET kind=excluded.kind, status=excluded.status,
          title_en=excluded.title_en, title_fa=excluded.title_fa, title_ar=excluded.title_ar, title_zh=excluded.title_zh,
          summary_en=excluded.summary_en, summary_fa=excluded.summary_fa, summary_ar=excluded.summary_ar, summary_zh=excluded.summary_zh,
          body_en=excluded.body_en, body_fa=excluded.body_fa, body_ar=excluded.body_ar, body_zh=excluded.body_zh,
          tags_json=excluded.tags_json, sources_json=excluded.sources_json, author_label=excluded.author_label,
          ai_model=excluded.ai_model, ai_grounding=excluded.ai_grounding, ai_prompt=excluded.ai_prompt,
          published_at=excluded.published_at, updated_at=excluded.updated_at, row_version=excluded.row_version""",
          [str(x) if x is not None else None for x in p] + [p[0]])
        ok += 1
print(f"posts mirrored: {ok} in {time.time()-t0:.0f}s", flush=True)

# ---------- 2) horses delta (changed/new/deleted since 2026-10-22) ----------
cur.execute("""SELECT id, company_code, register_no, microchip_no, file_number, name_latin, name_native,
  father_id, mother_id, book_version, is_active, originality, birth_date, birth_year, birth_place_code,
  birth_place_desc, breed_type, breed_desc, sex_code, sex_desc, color_code, color_desc, main_strain_no,
  main_strain_desc, sub_strain_no, sub_strain_desc, uel_no, lab_no, dna_status, dna_desc, life_number,
  passport_no, passport_date, passport_deliver_date, is_stallion, is_sport, is_imported, imported_date,
  imported_from_code, imported_from_desc, import_register_no, horse_sr_no, is_dead, death_date,
  is_register_sport, has_sport_card, allow_stallion, description, source_created_at, raw_json,
  created_at, updated_at, deleted_at, row_version, last_mutation_id, birth_date_value,
  birth_date_precision, birth_date_calendar, data_origin
  FROM horses WHERE updated_at >= '2026-10-22' OR id >= 10112557""")
hs = cur.fetchall()
print("horses delta rows:", len(hs), flush=True)
# dependency levels: parents before children within the delta (D1 checks FKs immediately)
from concurrent.futures import ThreadPoolExecutor
delta_ids = {h[0] for h in hs}
children_of = {}
indeg = {h[0]: 0 for h in hs}
for h in hs:
    for par in (h[7], h[8]):
        if par in delta_ids:
            children_of.setdefault(par, []).append(h[0])
            indeg[h[0]] += 1
levels, cur_level = [], [i for i, d in indeg.items() if d == 0]
row_by_id = {h[0]: h for h in hs}
placed = set(cur_level)
while cur_level:
    levels.append(cur_level)
    nxt = []
    for nid in cur_level:
        for ch in children_of.get(nid, []):
            indeg[ch] -= 1
            if indeg[ch] == 0:
                placed.add(ch); nxt.append(ch)
    cur_level = nxt
for h in hs:
    if h[0] not in placed:
        levels.append([h[0]])
HORSE_SQL = """INSERT INTO horses(id, company_code, register_no, microchip_no, file_number, name_latin, name_native,
          father_id, mother_id, book_version, is_active, originality, birth_date, birth_year, birth_place_code,
          birth_place_desc, breed_type, breed_desc, sex_code, sex_desc, color_code, color_desc, main_strain_no,
          main_strain_desc, sub_strain_no, sub_strain_desc, uel_no, lab_no, dna_status, dna_desc, life_number,
          passport_no, passport_date, passport_deliver_date, is_stallion, is_sport, is_imported, imported_date,
          imported_from_code, imported_from_desc, import_register_no, horse_sr_no, is_dead, death_date,
          is_register_sport, has_sport_card, allow_stallion, description, source_created_at, raw_json,
          created_at, updated_at, deleted_at, row_version, last_mutation_id, birth_date_value,
          birth_date_precision, birth_date_calendar, data_origin)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT (id) DO UPDATE SET
            register_no=excluded.register_no, microchip_no=excluded.microchip_no, name_latin=excluded.name_latin,
            name_native=excluded.name_native, father_id=excluded.father_id, mother_id=excluded.mother_id,
            birth_year=excluded.birth_year, birth_place_desc=excluded.birth_place_desc, breed_desc=excluded.breed_desc,
            sex_desc=excluded.sex_desc, color_desc=excluded.color_desc, main_strain_desc=excluded.main_strain_desc,
            sub_strain_desc=excluded.sub_strain_desc, dna_status=excluded.dna_status, dna_desc=excluded.dna_desc,
            passport_no=excluded.passport_no, is_stallion=excluded.is_stallion, is_sport=excluded.is_sport,
            is_imported=excluded.is_imported, is_dead=excluded.is_dead, description=excluded.description,
            raw_json=excluded.raw_json, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
            row_version=excluded.row_version, birth_date_value=excluded.birth_date_value,
            birth_date_precision=excluded.birth_date_precision, birth_date_calendar=excluded.birth_date_calendar,
            data_origin=excluded.data_origin"""
def push_horse(h):
    d1(HORSE_SQL, [str(x) if x is not None else None for x in h])
n = 0
with ThreadPoolExecutor(max_workers=10) as pool:
    for lv, level in enumerate(levels):
        list(pool.map(push_horse, [row_by_id[i] for i in level]))
        n += len(level)
        print(f"  level {lv}: {len(level)} (total {n})", flush=True)
print(f"horses delta mirrored: {n} in {time.time()-t0:.0f}s", flush=True)

# ---------- 3) generation state ----------
REV = "sha256:c6fea7b1bf29fb256e4605210c402927b994adea30b4740fdf275f40d89b135f"
d1("UPDATE registry_runtime_counters SET active_horse_count=93892, updated_at='2026-10-23T00:00:00Z' WHERE id=1")
d1("UPDATE registry_state SET analytics_stale=0, analytics_source_revision=?, updated_at='2026-10-23T00:00:00Z' WHERE id=1", [REV])
d1("INSERT INTO source_imports(source_filename, source_sha256, source_sheet, source_rows, started_at, completed_at, status, notes) VALUES ('turn28-quality-pass-2', ?, 'horses', 93892, '2026-10-23T00:00:00Z', '2026-10-23T00:00:00Z', 'complete', 'turn28 quality pass 2 mirror: horses delta (turn26+28 changes incl. 1097 merges + 1568 stubs) + counter/state/ledger + filter counts; snapshot payloads remain from previous generation (documented fail-closed lag)')", [REV])
d1("DELETE FROM registry_filter_counts")
import psycopg2.extras
cur.execute("SELECT filter_key, filter_value, count_value, source_revision, generated_at FROM registry_filter_counts")
fc = cur.fetchall()
for row in fc:
    d1("INSERT INTO registry_filter_counts(filter_key, filter_value, count_value, source_revision, generated_at) VALUES (?,?,?,?,?)",
       [str(x) if x is not None else None for x in row])
print("filter counts mirrored:", len(fc), flush=True)

# verify
print("D1 horses:", d1("SELECT COUNT(*) AS n FROM horses"))
print("D1 horses active:", d1("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL"))
print("D1 posts:", d1("SELECT COUNT(*) AS n FROM content_posts WHERE status='published'"))
print("D1 quadlingual:", d1("SELECT COUNT(*) AS n FROM content_posts WHERE title_ar IS NOT NULL AND body_ar IS NOT NULL AND title_zh IS NOT NULL AND body_zh IS NOT NULL AND status='published'"))
print("D1 state:", d1("SELECT analytics_source_revision, analytics_stale FROM registry_state WHERE id=1"))
print("D1 counter:", d1("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1"))
print(f"TOTAL {time.time()-t0:.0f}s")
c.close()
