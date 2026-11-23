#!/usr/bin/env python3
"""Import the client's horse XLSX into the canonical SQLite schema.

Outputs a local SQLite database for validation/testing and optionally chunked SQL
files suitable for feeding to Wrangler/D1 after migrations are applied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import sys
import time as clock
from collections import defaultdict
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Iterable

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
SHARD_ROWS = 12_000
# D1 currently caps an individual SQL statement at 100 KB. Keep a safety margin
# and also bound shard files so uploads/checkpoints remain small and resumable.
D1_SAFE_SQL_STATEMENT_BYTES = 90_000
D1_SAFE_SHARD_FILE_BYTES = 2_000_000

CANONICAL_SOURCE_FIELDS = {
    "CompanyCode", "HorseNo", "RegisterNo", "MicroChipNo", "FileNumber", "HorseNameL", "HorseNameF",
    "FatherNo", "MotherNo", "BookVersion", "IsActive", "Originality", "BirthDate", "BirthYear", "BirthPlace",
    "BirthPlaceDesc", "BreedType", "BreedTypeDesc", "SexNo", "SexDesc", "ColorNo", "ColorDesc", "MainStrainNo",
    "MainStrainDesc", "SubStrainNo", "SubStrainDesc", "UELNo", "LabNo", "DNAStatus", "DNADesc", "LifeNumber",
    "PassportNo", "PassportDate", "PassportDeliverDate", "IsStallion", "IsSport", "IsImported", "ImportedDate",
    "ImportedFrom", "ImportedFromDesc", "ImportRegisterNo", "ExportCertificate", "HorseSRNo", "IsDie", "DeathDate",
    "IsRegisterSport", "IsHasSportCard", "IsAllowStallion", "Description", "CreateDateTime",
    "OwnerNo", "OwnerDesc", "OwnerDescLatin", "BreederNo", "BreeDerDesc", "BreeDerDescLatin", "ImporterNo",
    "PassportReceiverNo",
}

HORSE_COLUMNS = [
    "id", "company_code", "register_no", "microchip_no", "file_number", "name_latin", "name_native", "father_id",
    "mother_id", "book_version", "is_active", "originality", "birth_date", "birth_year", "birth_place_code",
    "birth_place_desc", "breed_type", "breed_desc", "sex_code", "sex_desc", "color_code", "color_desc",
    "main_strain_no", "main_strain_desc", "sub_strain_no", "sub_strain_desc", "uel_no", "lab_no", "dna_status",
    "dna_desc", "life_number", "passport_no", "passport_date", "passport_deliver_date", "is_stallion", "is_sport",
    "is_imported", "imported_date", "imported_from_code", "imported_from_desc", "import_register_no",
    "export_certificate", "horse_sr_no", "is_dead", "death_date", "is_register_sport", "has_sport_card",
    "allow_stallion", "description", "source_created_at", "raw_json",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def clean(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v):
            return None
        if v.is_integer():
            return int(v)
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, str):
        s = v.strip()
        return s or None
    return v


def as_text(v: Any) -> str | None:
    v = clean(v)
    if v is None:
        return None
    if isinstance(v, float):
        return format(v, ".15g")
    return str(v)


def as_int(v: Any) -> int | None:
    v = clean(v)
    if v is None:
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError, OverflowError):
        return None


def as_bool(v: Any, default: int = 0) -> int:
    if v is None:
        return default
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return 1 if v else 0
    return 1 if str(v).strip().lower() in {"1", "true", "yes", "y", "on"} else 0


def normalize_text(v: Any) -> str:
    import re
    import unicodedata
    if v is None:
        return ""
    s = unicodedata.normalize("NFKC", str(v)).strip().lower()
    table = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه"})
    s = s.translate(table)
    s = re.sub(r"[\u064B-\u065F\u0670\u06D6-\u06ED]", "", s)
    p = "۰۱۲۳۴۵۶۷۸۹"; a = "٠١٢٣٤٥٦٧٨٩"
    s = s.translate(str.maketrans({**{p[i]: str(i) for i in range(10)}, **{a[i]: str(i) for i in range(10)}}))
    s = re.sub(r"[\W_]+", " ", s, flags=re.UNICODE)
    return " ".join(s.split())


def row_to_horse(row: dict[str, Any]) -> tuple[Any, ...]:
    raw = {}
    for key, value in row.items():
        if key in CANONICAL_SOURCE_FIELDS or key.startswith("ShajF") or key.startswith("ShajNoF"):
            continue
        cv = clean(value)
        if cv is not None:
            raw[key] = cv
    return (
        as_int(row.get("HorseNo")), as_text(row.get("CompanyCode")), as_text(row.get("RegisterNo")),
        as_text(row.get("MicroChipNo")), as_text(row.get("FileNumber")), as_text(row.get("HorseNameL")) or "[unnamed]",
        as_text(row.get("HorseNameF")), as_int(row.get("FatherNo")) or None, as_int(row.get("MotherNo")) or None,
        as_text(row.get("BookVersion")), as_bool(row.get("IsActive"), 1), as_text(row.get("Originality")),
        as_text(row.get("BirthDate")), as_int(row.get("BirthYear")), as_text(row.get("BirthPlace")),
        as_text(row.get("BirthPlaceDesc")), as_text(row.get("BreedType")), as_text(row.get("BreedTypeDesc")),
        as_text(row.get("SexNo")), as_text(row.get("SexDesc")), as_text(row.get("ColorNo")), as_text(row.get("ColorDesc")),
        as_text(row.get("MainStrainNo")), as_text(row.get("MainStrainDesc")), as_text(row.get("SubStrainNo")),
        as_text(row.get("SubStrainDesc")), as_text(row.get("UELNo")), as_text(row.get("LabNo")), as_text(row.get("DNAStatus")),
        as_text(row.get("DNADesc")), as_text(row.get("LifeNumber")), as_text(row.get("PassportNo")),
        as_text(row.get("PassportDate")), as_text(row.get("PassportDeliverDate")), as_bool(row.get("IsStallion")),
        as_bool(row.get("IsSport")), as_bool(row.get("IsImported")), as_text(row.get("ImportedDate")),
        as_text(row.get("ImportedFrom")), as_text(row.get("ImportedFromDesc")), as_text(row.get("ImportRegisterNo")),
        as_text(row.get("ExportCertificate")), as_text(row.get("HorseSRNo")), as_bool(row.get("IsDie")),
        as_text(row.get("DeathDate")), as_bool(row.get("IsRegisterSport")), as_bool(row.get("IsHasSportCard")),
        as_bool(row.get("IsAllowStallion")), as_text(row.get("Description")), as_text(row.get("CreateDateTime")),
        json.dumps(raw, ensure_ascii=False, separators=(",", ":"), default=str) if raw else None,
    )


def apply_migrations(conn: sqlite3.Connection) -> None:
    for path in sorted(MIGRATIONS.glob("*.sql")):
        conn.executescript(path.read_text(encoding="utf-8"))


def detect_quality(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM data_quality_issues")
    rows = conn.execute("SELECT id,father_id,mother_id,birth_year FROM horses").fetchall()
    info = {int(r[0]): (r[1], r[2], r[3]) for r in rows}
    issues: list[tuple[int, str, str, str | None, str, str | None]] = []

    for horse_id, (father, mother, year) in info.items():
        if father == horse_id:
            issues.append((horse_id, "SELF_PARENT", "error", "father_id", "Horse is recorded as its own father", None))
        if mother == horse_id:
            issues.append((horse_id, "SELF_PARENT", "error", "mother_id", "Horse is recorded as its own mother", None))
        if year is not None and (year < 1700 or year > 2100):
            issues.append((horse_id, "BIRTH_YEAR_OUTLIER", "warning", "birth_year", f"Birth year {year} is outside expected registry range", None))
        for relation, parent_id in (("father_id", father), ("mother_id", mother)):
            if not parent_id or parent_id not in info or year is None:
                continue
            py = info[parent_id][2]
            if py is not None and py >= year:
                issues.append((horse_id, "PARENT_YEAR_CONFLICT", "warning", relation,
                               f"Parent {parent_id} has birth year {py}, not earlier than child year {year}",
                               json.dumps({"parent_id": parent_id, "parent_year": py, "child_year": year})))

    # Detect ancestry cycles with DFS; store one issue per horse participating in a discovered cycle.
    state: dict[int, int] = {}
    stack: list[int] = []
    stack_pos: dict[int, int] = {}
    cycle_nodes: set[int] = set()

    def visit(node: int) -> None:
        st = state.get(node, 0)
        if st == 2:
            return
        if st == 1:
            pos = stack_pos.get(node, 0)
            cycle_nodes.update(stack[pos:])
            return
        state[node] = 1; stack_pos[node] = len(stack); stack.append(node)
        f, m, _ = info[node]
        for parent in (f, m):
            if parent in info:
                visit(int(parent))
        stack.pop(); stack_pos.pop(node, None); state[node] = 2

    for node in info:
        if state.get(node, 0) == 0:
            visit(node)
    for horse_id in sorted(cycle_nodes):
        issues.append((horse_id, "PEDIGREE_CYCLE", "error", None, "Horse participates in a pedigree cycle", None))

    conn.executemany("""
      INSERT INTO data_quality_issues(horse_id,issue_code,severity,field_name,message,details_json)
      VALUES(?,?,?,?,?,?)
    """, issues)


def rebuild_search(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM horse_search_source")
    conn.execute("DELETE FROM horse_search_fts")
    conn.execute("DELETE FROM horse_search_trigram")
    rows = conn.execute("""
      SELECT h.id,h.name_latin,h.name_native,h.register_no,h.uel_no,h.life_number,
             h.birth_place_desc,h.imported_from_desc,h.birth_year,h.sex_desc,h.color_desc,h.breed_desc,h.main_strain_desc,h.sub_strain_desc,
             trim(COALESCE(f.name_latin,'') || ' ' || COALESCE(f.name_native,'')),
             trim(COALESCE(m.name_latin,'') || ' ' || COALESCE(m.name_native,'')),
             (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner'),
             (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder'),
             (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='importer'),
             (SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='passport_receiver'),
             (SELECT group_concat(a.alias,' ') FROM horse_aliases a WHERE a.horse_id=h.id)
      FROM horses h LEFT JOIN horses f ON f.id=h.father_id LEFT JOIN horses m ON m.id=h.mother_id
    """).fetchall()
    source_rows = []
    fts_rows = []
    tri_rows = []
    for r in rows:
        horse_id = r[0]
        name_latin = normalize_text(r[1]); name_native = normalize_text(r[2])
        identifiers = normalize_text(" ".join(str(x) for x in [r[3], r[4], r[5]] if x is not None))
        places = normalize_text(" ".join(str(x) for x in r[6:8] if x is not None))
        breed = normalize_text(" ".join(str(x) for x in [r[11], r[12], r[13]] if x is not None))
        father_name = normalize_text(r[14]); mother_name = normalize_text(r[15])
        owners = normalize_text(r[16]); breeders = normalize_text(r[17])
        importers = normalize_text(r[18]); passport_receivers = normalize_text(r[19]); aliases = normalize_text(r[20])
        all_text = normalize_text(" ".join(str(x) for x in [horse_id,name_latin,name_native,identifiers,owners,breeders,importers,passport_receivers,aliases,father_name,mother_name,places,breed,r[8],r[9],r[10]] if x is not None))
        values=(horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
        source_rows.append(values); fts_rows.append(values); tri_rows.append((horse_id,all_text))
    conn.executemany("INSERT INTO horse_search_source(horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)", source_rows)
    conn.executemany("INSERT INTO horse_search_fts(rowid,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)", fts_rows)
    conn.executemany("INSERT INTO horse_search_trigram(rowid,all_text) VALUES(?,?)", tri_rows)


def import_workbook(source: Path, db_path: Path, limit: int | None = None) -> dict[str, Any]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists(): db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    apply_migrations(conn)

    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    headers = [str(x) if x is not None else "" for x in next(rows_iter)]
    source_hash = sha256_file(source)
    started = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")
    cur = conn.execute("INSERT INTO source_imports(source_filename,source_sha256,source_sheet,source_rows,started_at,status) VALUES(?,?,?,?,?,'running')",
                       (source.name, source_hash, ws.title, max(0, ws.max_row-1), started))
    import_id = cur.lastrowid

    people: dict[int, tuple[str | None, str | None]] = {}
    roles: set[tuple[int,int,str]] = set()
    horse_rows: list[tuple[Any, ...]] = []
    inserted = 0
    parse_started = clock.perf_counter()

    for values in rows_iter:
        row = dict(zip(headers, values))
        hid = as_int(row.get("HorseNo"))
        if not hid:
            continue
        horse_rows.append(row_to_horse(row))
        for id_field, native_field, latin_field, role in (
            ("OwnerNo","OwnerDesc","OwnerDescLatin","owner"),
            ("BreederNo","BreeDerDesc","BreeDerDescLatin","breeder"),
        ):
            pid = as_int(row.get(id_field))
            if pid:
                native = as_text(row.get(native_field)); latin = as_text(row.get(latin_field))
                old = people.get(pid)
                if old:
                    people[pid] = (old[0] or native, old[1] or latin)
                else:
                    people[pid] = (native, latin)
                roles.add((hid, pid, role))
        for id_field, role in (("ImporterNo","importer"),("PassportReceiverNo","passport_receiver")):
            pid = as_int(row.get(id_field))
            if pid:
                people.setdefault(pid, (None, None)); roles.add((hid,pid,role))
        inserted += 1
        if inserted % 5000 == 0:
            elapsed = clock.perf_counter() - parse_started
            print(f"[import] parsed {inserted:,} horse rows in {elapsed:.1f}s", file=sys.stderr, flush=True)
        if limit and inserted >= limit:
            break

    included_ids = {int(r[0]) for r in horse_rows}
    if limit:
        # A quick fixture may not include referenced parents. Null only those external
        # references so the sample remains referentially valid. Full imports preserve all links.
        patched = []
        for item in horse_rows:
            values = list(item)
            if values[7] not in included_ids: values[7] = None
            if values[8] not in included_ids: values[8] = None
            patched.append(tuple(values))
        horse_rows = patched

    placeholders = ",".join("?" for _ in HORSE_COLUMNS)
    conn.execute("PRAGMA defer_foreign_keys=ON")
    conn.executemany(f"INSERT INTO horses({','.join(HORSE_COLUMNS)}) VALUES({placeholders})", horse_rows)
    conn.executemany("INSERT OR IGNORE INTO people(id,name_native,name_latin) VALUES(?,?,?)", [(pid,*names) for pid,names in people.items()])
    # For samples, only retain roles whose horse was included.
    conn.executemany("INSERT OR IGNORE INTO horse_people(horse_id,person_id,role) VALUES(?,?,?)", [r for r in roles if r[0] in included_ids])
    detect_quality(conn)
    rebuild_search(conn)
    completed = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")
    conn.execute("UPDATE source_imports SET status='complete',completed_at=?,source_rows=? WHERE id=?", (completed, inserted, import_id))
    conn.commit()

    counts = {
        "horses": conn.execute("SELECT COUNT(*) FROM horses").fetchone()[0],
        "people": conn.execute("SELECT COUNT(*) FROM people").fetchone()[0],
        "roles": conn.execute("SELECT COUNT(*) FROM horse_people").fetchone()[0],
        "quality_issues": conn.execute("SELECT COUNT(*) FROM data_quality_issues").fetchone()[0],
        "search_rows": conn.execute("SELECT COUNT(*) FROM horse_search_source").fetchone()[0],
    }
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.commit()
    size = db_path.stat().st_size
    conn.close(); wb.close()
    return {"source_sha256": source_hash, "sheet": ws.title, "counts": counts, "sqlite_bytes": size}


def sql_literal(value: Any) -> str:
    if value is None: return "NULL"
    if isinstance(value, (int, float)): return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def write_d1_shards(
    db_path: Path,
    out_dir: Path,
    *,
    include_raw_json: bool = False,
    external_search_fts: bool = False,
) -> None:
    """Emit deterministic, idempotent, byte-bounded data-only D1 SQL shards.

    Apply migrations separately before these files. ``raw_json`` remains excluded
    by default. Horse parent IDs are loaded in a second pass so cross-shard foreign
    keys are valid regardless of HorseNo ordering. Every emitted SQL statement is
    kept below the configured D1 safety threshold and every shard is hash-manifested
    so interrupted Free-tier uploads can resume safely.

    When ``external_search_fts`` is true, the manifest starts with a serving-schema
    prelude that recreates the two main search FTS tables as external-content indexes
    backed by ``horse_search_source`` and drops serving-unused indexes. Main FTS rows
    are populated explicitly in bounded multi-row batches instead of using one global
    FTS rebuild, so Free-tier imports can stop/resume between statements safely.

    Ordinary table inserts and horse parent-link updates are also emitted as bounded
    multi-row/batched statements. This reduces HTTP/API call count dramatically without
    changing D1 row-write accounting or data semantics.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.sql"):
        stale.unlink()
    conn = sqlite3.connect(db_path)
    tables = ["source_imports", "horses", "people", "horse_people", "horse_aliases", "data_quality_issues", "horse_search_source"]
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analytics_snapshots'").fetchone():
        tables.append("analytics_snapshots")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='horse_reference_intelligence'").fetchone():
        tables.append("horse_reference_intelligence")
    for optional in ("person_registry_stats", "registry_runtime_counters", "horse_registry_people_summary", "registry_filter_counts"):
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (optional,)).fetchone():
            tables.append(optional)
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_state'").fetchone():
        # Deliberately last: this records the final locally verified analytics state.
        tables.append("registry_state")
    manifest: list[str] = []
    manifest_entries: list[dict[str, Any]] = []
    seq = 1

    def emit_shard(filename: str, table: str, statements: list[str]) -> None:
        if not statements:
            return
        path = out_dir / filename
        content = "\n".join(statements) + "\n"
        encoded = content.encode("utf-8")
        if len(encoded) > D1_SAFE_SHARD_FILE_BYTES:
            raise ValueError(f"Generated shard {filename} exceeds safe file budget: {len(encoded)} bytes")
        path.write_bytes(encoded)
        manifest.append(path.name)
        manifest_entries.append({
            "file": path.name,
            "table": table,
            "statements": len(statements),
            "bytes": len(encoded),
            "sha256": sha256_file(path),
        })

    def flush_statement_shards(table: str, statements: Iterable[str]) -> None:
        nonlocal seq
        shard: list[str] = []
        shard_bytes = 0
        index = 0

        def flush() -> None:
            nonlocal seq, index, shard, shard_bytes
            if not shard:
                return
            emit_shard(f"{seq:03d}_{table}_{index:03d}.sql", table, shard)
            seq += 1
            index += 1
            shard = []
            shard_bytes = 0

        for statement in statements:
            statement_bytes = len((statement + "\n").encode("utf-8"))
            if statement_bytes > D1_SAFE_SQL_STATEMENT_BYTES:
                raise ValueError(
                    f"A single {table} SQL statement is {statement_bytes} bytes, above the safe D1 statement budget "
                    f"of {D1_SAFE_SQL_STATEMENT_BYTES}. Split/normalize the payload before cloud export."
                )
            if shard and (len(shard) >= SHARD_ROWS or shard_bytes + statement_bytes > D1_SAFE_SHARD_FILE_BYTES):
                flush()
            shard.append(statement)
            shard_bytes += statement_bytes
        flush()

    def flush_insert_shards(table: str, columns: list[str], rows: Iterable[tuple[Any, ...]], *, replace: bool = True) -> None:
        """Emit byte-bounded multi-row INSERT statements.

        Grouping rows into a single INSERT reduces remote API calls while preserving the
        exact same logical writes. Every statement stays below the conservative D1 SQL
        byte guard and remains retry-safe through INSERT OR REPLACE semantics.
        """
        verb = "INSERT OR REPLACE" if replace else "INSERT"
        head = f"{verb} INTO {table}({','.join(columns)}) VALUES"

        def statements() -> Iterable[str]:
            values: list[str] = []
            # Leave a little headroom under the hard safety guard for rendering/newlines.
            target = max(1, D1_SAFE_SQL_STATEMENT_BYTES - 512)
            head_bytes = len(head.encode("utf-8"))
            values_bytes = 0
            for row in rows:
                rendered = "(" + ",".join(sql_literal(v) for v in row) + ")"
                rendered_bytes = len(rendered.encode("utf-8"))
                single_bytes = head_bytes + rendered_bytes + 2  # semicolon + newline
                if single_bytes > D1_SAFE_SQL_STATEMENT_BYTES:
                    raise ValueError(
                        f"A single {table} row cannot fit inside the safe D1 statement budget"
                    )
                comma_bytes = 1 if values else 0
                candidate_bytes = head_bytes + values_bytes + comma_bytes + rendered_bytes + 2
                if values and candidate_bytes > target:
                    yield head + ",".join(values) + ";"
                    values = [rendered]
                    values_bytes = rendered_bytes
                else:
                    values.append(rendered)
                    values_bytes += comma_bytes + rendered_bytes
            if values:
                yield head + ",".join(values) + ";"

        flush_statement_shards(table, statements())

    def flush_parent_update_shards(rows: Iterable[tuple[Any, Any, Any]]) -> None:
        """Batch parent-link UPDATEs using CASE expressions, bounded by SQL bytes."""
        def render(batch: list[tuple[Any, Any, Any]]) -> str:
            father = " ".join(
                f"WHEN {sql_literal(hid)} THEN {sql_literal(fid)}" for hid, fid, _ in batch
            )
            mother = " ".join(
                f"WHEN {sql_literal(hid)} THEN {sql_literal(mid)}" for hid, _, mid in batch
            )
            ids = ",".join(sql_literal(hid) for hid, _, _ in batch)
            return (
                "UPDATE horses SET "
                f"father_id=CASE id {father} ELSE father_id END,"
                f"mother_id=CASE id {mother} ELSE mother_id END "
                f"WHERE id IN ({ids});"
            )

        def statements() -> Iterable[str]:
            # Numeric Horse IDs keep a 400-row CASE statement comfortably below the
            # 90 KB guard. Validate the rendered batch before emitting and split if an
            # unusual future identifier width ever pushes it over the limit.
            batch: list[tuple[Any, Any, Any]] = []

            def emit_safe(items: list[tuple[Any, Any, Any]]) -> Iterable[str]:
                statement = render(items)
                size = len((statement + "\n").encode("utf-8"))
                if size <= D1_SAFE_SQL_STATEMENT_BYTES:
                    yield statement
                    return
                if len(items) <= 1:
                    raise ValueError("A single horse parent update exceeds the safe D1 SQL statement budget")
                mid = len(items) // 2
                yield from emit_safe(items[:mid])
                yield from emit_safe(items[mid:])

            for row in rows:
                batch.append(row)
                if len(batch) >= 400:
                    yield from emit_safe(batch)
                    batch = []
            if batch:
                yield from emit_safe(batch)

        flush_statement_shards("horse_parent_links", statements())

    def _largest_safe_text_chunk(prefix: str, text: str, suffix: str) -> tuple[str, str]:
        """Split text so the rendered SQL statement stays inside the D1 safety budget."""
        low, high = 1, len(text)
        best = 0
        while low <= high:
            mid = (low + high) // 2
            statement = prefix + sql_literal(text[:mid]) + suffix
            if len((statement + "\n").encode("utf-8")) <= D1_SAFE_SQL_STATEMENT_BYTES:
                best = mid
                low = mid + 1
            else:
                high = mid - 1
        if best <= 0:
            raise ValueError("Could not fit even one payload character inside the D1 SQL statement budget")
        return text[:best], text[best:]

    def flush_analytics_snapshot_shards(columns: list[str], rows: Iterable[tuple[Any, ...]]) -> None:
        """Export oversized analytics JSON as retry-safe, byte-bounded SQL.

        Normal snapshot rows remain a single INSERT OR REPLACE. If payload_json
        would exceed the conservative 90 KB statement guard, emit a small UPSERT
        followed by guarded prefix-extension UPDATEs. Each UPDATE is idempotent:
        replaying an already-applied shard cannot append a chunk twice. The UPSERT
        also preserves a longer payload only when all snapshot identity fields match,
        so a genuinely new rebuild resets stale payload content safely.
        """
        payload_index = columns.index("payload_json")
        key_index = columns.index("key")
        identity_columns = [
            name for name in (
                "schema_version", "algorithm_version", "source_revision",
                "source_horse_count", "generated_at",
            ) if name in columns
        ]
        identity_indexes = [columns.index(name) for name in identity_columns]

        def statements() -> Iterable[str]:
            for row in rows:
                normal = f"INSERT OR REPLACE INTO analytics_snapshots({','.join(columns)}) VALUES({','.join(sql_literal(v) for v in row)});"
                if len((normal + "\n").encode("utf-8")) <= D1_SAFE_SQL_STATEMENT_BYTES:
                    yield normal
                    continue

                payload = row[payload_index]
                if not isinstance(payload, str):
                    raise ValueError("Oversized analytics payload_json must be text")
                key = row[key_index]

                # Find a first chunk that keeps the identity-aware UPSERT under budget.
                base_values = list(row)
                base_values[payload_index] = ""
                assignments = [f"{name}=excluded.{name}" for name in columns if name not in ("key", "payload_json")]
                same_identity = " AND ".join(
                    f"analytics_snapshots.{name}=excluded.{name}" for name in identity_columns
                ) or "1"
                upsert_prefix = (
                    f"INSERT INTO analytics_snapshots({','.join(columns)}) VALUES("
                    + ",".join(sql_literal(v) for v in base_values[:payload_index])
                    + ("," if payload_index else "")
                )
                upsert_suffix = (
                    ("," if payload_index < len(columns) - 1 else "")
                    + ",".join(sql_literal(v) for v in base_values[payload_index + 1:])
                    + ") ON CONFLICT(key) DO UPDATE SET "
                    + ",".join(assignments)
                    + ("," if assignments else "")
                    + "payload_json=CASE WHEN "
                    + same_identity
                    + " AND length(analytics_snapshots.payload_json)>=length(excluded.payload_json) "
                    + "THEN analytics_snapshots.payload_json ELSE excluded.payload_json END;"
                )
                first_chunk, remaining = _largest_safe_text_chunk(upsert_prefix, payload, upsert_suffix)
                yield upsert_prefix + sql_literal(first_chunk) + upsert_suffix

                prefix_len = len(first_chunk)
                while remaining:
                    # End length depends on chunk size. Binary-search using a renderer
                    # that includes the exact start/end character lengths.
                    low, high = 1, len(remaining)
                    best = 0
                    best_statement = ""
                    while low <= high:
                        mid = (low + high) // 2
                        chunk = remaining[:mid]
                        end_len = prefix_len + mid
                        statement = (
                            f"UPDATE analytics_snapshots SET payload_json=CASE WHEN length(payload_json)<{end_len} "
                            f"THEN substr(payload_json,1,{prefix_len})||{sql_literal(chunk)} ELSE payload_json END "
                            f"WHERE key={sql_literal(key)} AND "
                            + " AND ".join(
                                f"{name}={sql_literal(row[idx])}" for name, idx in zip(identity_columns, identity_indexes)
                            )
                            + ";"
                        )
                        if len((statement + "\n").encode("utf-8")) <= D1_SAFE_SQL_STATEMENT_BYTES:
                            best = mid
                            best_statement = statement
                            low = mid + 1
                        else:
                            high = mid - 1
                    if best <= 0:
                        raise ValueError("Could not fit analytics payload chunk inside D1 SQL statement budget")
                    yield best_statement
                    prefix_len += best
                    remaining = remaining[best:]

        flush_statement_shards("analytics_snapshots", statements())

    if external_search_fts:
        source_sql = dict(conn.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('horse_search_fts','horse_search_trigram')"
        ))
        if not all("content='horse_search_source'" in str(source_sql.get(name, "")) for name in ("horse_search_fts", "horse_search_trigram")):
            raise ValueError("external_search_fts requires a serving DB with external-content horse_search_fts and horse_search_trigram")
        flush_statement_shards("serving_schema", [
            "DROP INDEX IF EXISTS idx_hri_cohort;",
            "DROP INDEX IF EXISTS idx_hri_dpi;",
            "DROP INDEX IF EXISTS idx_hri_kinship;",
            "DROP INDEX IF EXISTS idx_horses_microchip_no;",
            "DROP INDEX IF EXISTS idx_people_name_latin;",
            "DROP TABLE IF EXISTS horse_search_fts;",
            "DROP TABLE IF EXISTS horse_search_trigram;",
            "CREATE VIRTUAL TABLE horse_search_fts USING fts5(name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text,content='horse_search_source',content_rowid='horse_id',tokenize='unicode61 remove_diacritics 2');",
            "CREATE VIRTUAL TABLE horse_search_trigram USING fts5(all_text,content='horse_search_source',content_rowid='horse_id',tokenize='trigram');",
            "DROP TABLE IF EXISTS horse_role_search_trigram;",
            "CREATE VIRTUAL TABLE horse_role_search_trigram USING fts5(owner,breeder,importer,passport_receiver,tokenize='trigram',columnsize=0);",
        ])

    for table in tables:
        columns = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
        if table == "horses" and not include_raw_json:
            columns = [c for c in columns if c != "raw_json"]

        if table == "horses":
            select_columns = columns
            father_index = select_columns.index("father_id")
            mother_index = select_columns.index("mother_id")

            def horse_rows_without_parents() -> Iterable[tuple[Any, ...]]:
                for row in conn.execute(f"SELECT {','.join(select_columns)} FROM horses ORDER BY id"):
                    values = list(row)
                    values[father_index] = None
                    values[mother_index] = None
                    yield tuple(values)

            flush_insert_shards(table, columns, horse_rows_without_parents())

            parent_rows = (
                (horse_id, father_id, mother_id)
                for horse_id, father_id, mother_id in conn.execute("SELECT id,father_id,mother_id FROM horses ORDER BY id")
                if father_id is not None or mother_id is not None
            )
            flush_parent_update_shards(parent_rows)
            continue

        rows = conn.execute(f"SELECT {','.join(columns)} FROM {table}")
        if table == "analytics_snapshots":
            flush_analytics_snapshot_shards(columns, rows)
        else:
            flush_insert_shards(table, columns, rows)

    # FTS data is derived and loaded last. For external-content search indexes, emit
    # explicit bounded rows rather than a monolithic rebuild. Replaying the same
    # immutable serving payload is idempotent with INSERT OR REPLACE and can resume
    # between statements when the Free write quota resets.
    if external_search_fts:
        external_fts_exports = [
            ("horse_search_fts", ["rowid","name_latin","name_native","identifiers","owners","breeders","father_name","mother_name","places","breed","all_text"],
             "SELECT horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text FROM horse_search_source ORDER BY horse_id"),
            ("horse_search_trigram", ["rowid","all_text"],
             "SELECT horse_id,all_text FROM horse_search_source ORDER BY horse_id"),
        ]
        for table, cols, sql in external_fts_exports:
            flush_insert_shards(table, cols, conn.execute(sql), replace=True)
    else:
        for table, cols in [
            ("horse_search_fts", ["rowid","name_latin","name_native","identifiers","owners","breeders","father_name","mother_name","places","breed","all_text"]),
            ("horse_search_trigram", ["rowid","all_text"]),
        ]:
            flush_insert_shards(table, cols, conn.execute(f"SELECT {','.join(cols)} FROM {table}"), replace=True)

    flush_insert_shards(
        "horse_role_search_trigram",
        ["rowid","owner","breeder","importer","passport_receiver"],
        conn.execute("SELECT rowid,owner,breeder,importer,passport_receiver FROM horse_role_search_trigram ORDER BY rowid"),
        replace=True,
    )

    manifest_payload = {
        "format_version": 4 if external_search_fts else 2,
        "files": manifest,
        "entries": manifest_entries,
        "safe_statement_bytes": D1_SAFE_SQL_STATEMENT_BYTES,
        "safe_shard_file_bytes": D1_SAFE_SHARD_FILE_BYTES,
        "source_sqlite_sha256": sha256_file(db_path),
        "external_search_fts": external_search_fts,
        "note": (
            "Apply in order after migrations. Horse rows load before parent-link updates. "
            + (
                "Serving-schema prelude recreates main FTS as external-content indexes; bounded explicit FTS batches populate them without a global rebuild. "
                if external_search_fts else
                "All data/FTS inserts are idempotent for safe retry. "
            )
            + "Free-tier writes may require spreading shards across quota reset windows and resuming from the upload ledger."
        ),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest_payload, indent=2), encoding="utf-8")
    conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Path to source .xlsx")
    parser.add_argument("--sqlite", type=Path, default=ROOT / "data/generated/horse-registry.sqlite")
    parser.add_argument("--limit", type=int, default=None, help="Import only first N horses for a quick fixture")
    parser.add_argument("--d1-shards", type=Path, default=None, help="Directory to emit chunked data-only SQL")
    parser.add_argument("--d1-include-raw-json", action="store_true", help="Include private raw source blobs in D1 shards (off by default)")
    args = parser.parse_args()
    if not args.source.exists():
        parser.error(f"Source not found: {args.source}")
    started = clock.perf_counter()
    result = import_workbook(args.source, args.sqlite, args.limit)
    if args.d1_shards:
        write_d1_shards(args.sqlite, args.d1_shards, include_raw_json=args.d1_include_raw_json)
    result["elapsed_seconds"] = round(clock.perf_counter() - started, 2)
    report_path = args.sqlite.parent / "import-report.json"
    report_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
