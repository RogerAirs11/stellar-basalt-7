#!/usr/bin/env python3
"""Build a lean, full-fidelity Cloudflare D1 serving SQLite image.

The canonical SQLite remains immutable. This tool copies it, removes only
serving-irrelevant duplication, sparsifies structurally empty derived rows,
prunes indexes not used by the deployed runtime, converts the two largest
search indexes to FTS5 external-content tables, and compacts the result.

No user-visible registry field or canonical relationship is removed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

REQUIRED_TABLES = {
    "horses", "people", "horse_people", "horse_search_source",
    "horse_search_fts", "horse_search_trigram", "horse_role_search_trigram",
    "horse_registry_people_summary", "horse_reference_intelligence",
    "person_registry_stats", "registry_state", "registry_filter_counts",
}
HRI_SERVING_UNUSED_INDEXES = ("idx_hri_cohort", "idx_hri_dpi", "idx_hri_kinship")
RUNTIME_UNUSED_SERVING_INDEXES = HRI_SERVING_UNUSED_INDEXES + ("idx_horses_microchip_no", "idx_people_name_latin")

EXTERNAL_FTS_SQL = """
CREATE VIRTUAL TABLE horse_search_fts USING fts5(
  name_latin,
  name_native,
  identifiers,
  owners,
  breeders,
  father_name,
  mother_name,
  places,
  breed,
  all_text,
  content='horse_search_source',
  content_rowid='horse_id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE horse_search_trigram USING fts5(
  all_text,
  content='horse_search_source',
  content_rowid='horse_id',
  tokenize='trigram'
);
"""

ROLE_FTS_SERVING_SQL = """
CREATE VIRTUAL TABLE horse_role_search_trigram USING fts5(
  owner,
  breeder,
  importer,
  passport_receiver,
  tokenize='trigram',
  columnsize=0
);
"""

SUMMARY_EMPTY_PREDICATE = """
coalesce(owner_name,'')='' AND coalesce(owner_name_native,'')=''
AND coalesce(breeder_name,'')='' AND coalesce(breeder_name_native,'')=''
AND coalesce(importer_name,'')='' AND coalesce(importer_name_native,'')=''
AND coalesce(passport_receiver_name,'')='' AND coalesce(passport_receiver_name_native,'')=''
"""
ROLE_EMPTY_PREDICATE = """
coalesce(owner,'')='' AND coalesce(breeder,'')=''
AND coalesce(importer,'')='' AND coalesce(passport_receiver,'')=''
"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def table_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])


def database_size_breakdown(conn: sqlite3.Connection) -> dict[str, int]:
    try:
        rows = conn.execute("SELECT name,SUM(pgsize) FROM dbstat GROUP BY name").fetchall()
    except sqlite3.OperationalError:
        return {}
    return {str(name): int(size or 0) for name, size in rows}


def assert_required_schema(conn: sqlite3.Connection) -> None:
    tables = {str(r[0]) for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = sorted(REQUIRED_TABLES - tables)
    if missing:
        raise RuntimeError(f"Input database missing required tables: {missing}")


def external_search_layout(conn: sqlite3.Connection) -> bool:
    rows = dict(conn.execute(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('horse_search_fts','horse_search_trigram')"
    ))
    return all("content='horse_search_source'" in str(rows.get(name, "")) for name in ("horse_search_fts", "horse_search_trigram"))


def optimize_working_copy(conn: sqlite3.Connection) -> dict[str, Any]:
    assert_required_schema(conn)
    before = {
        "horses": table_count(conn, "horses"),
        "people": table_count(conn, "people"),
        "horse_people": table_count(conn, "horse_people"),
        "horse_search_source": table_count(conn, "horse_search_source"),
        "horse_search_fts": table_count(conn, "horse_search_fts"),
        "horse_search_trigram": table_count(conn, "horse_search_trigram"),
        "horse_role_search_trigram": table_count(conn, "horse_role_search_trigram"),
        "horse_registry_people_summary": table_count(conn, "horse_registry_people_summary"),
        "horse_reference_intelligence": table_count(conn, "horse_reference_intelligence"),
        "registry_filter_counts": table_count(conn, "registry_filter_counts"),
        "raw_json_nonnull": int(conn.execute("SELECT COUNT(*) FROM horses WHERE raw_json IS NOT NULL").fetchone()[0]),
        "raw_json_text_bytes": int(conn.execute("SELECT COALESCE(SUM(length(raw_json)),0) FROM horses").fetchone()[0]),
    }

    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("BEGIN IMMEDIATE")
    try:
        # The canonical DB retains raw_json. The public/admin DTOs intentionally
        # never serve it, and the existing D1 exporter already excludes it.
        conn.execute("UPDATE horses SET raw_json=NULL WHERE raw_json IS NOT NULL")

        # Materialized people display rows are optional accelerators. A missing
        # row already falls back to exact horse_people/people queries in routes.ts.
        conn.execute(f"DELETE FROM horse_registry_people_summary WHERE {SUMMARY_EMPTY_PREDICATE}")

        # Role trigram is only a fresh-analytics membership prefilter. Empty FTS
        # documents cannot match any role query, so removing them is exact. The
        # deployed runtime never ranks this table, so columnsize=0 safely removes
        # one docsize row/write per retained horse without changing MATCH membership.
        conn.execute(f"DELETE FROM horse_role_search_trigram WHERE {ROLE_EMPTY_PREDICATE}")
        conn.execute("CREATE TEMP TABLE _serving_role_search AS SELECT rowid,owner,breeder,importer,passport_receiver FROM horse_role_search_trigram")
        conn.execute("DROP TABLE horse_role_search_trigram")
        conn.executescript(ROLE_FTS_SERVING_SQL)
        conn.execute("INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver) SELECT rowid,owner,breeder,importer,passport_receiver FROM _serving_role_search ORDER BY rowid")
        conn.execute("DROP TABLE _serving_role_search")

        # Runtime reference-intelligence access is by horse_id PK only. These
        # cohort/ranking indexes are build-time/research conveniences and are
        # expensive to import into a read-optimized D1 serving image.
        for index in RUNTIME_UNUSED_SERVING_INDEXES:
            conn.execute(f'DROP INDEX IF EXISTS "{index}"')

        # Search source already stores the exact normalized indexed content.
        # External-content FTS removes duplicate shadow content tables while
        # preserving identical MATCH behavior and rowids.
        conn.execute("DROP TABLE horse_search_fts")
        conn.execute("DROP TABLE horse_search_trigram")
        conn.executescript(EXTERNAL_FTS_SQL)
        conn.execute("INSERT INTO horse_search_fts(horse_search_fts) VALUES('rebuild')")
        conn.execute("INSERT INTO horse_search_trigram(horse_search_trigram) VALUES('rebuild')")
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # Planner statistics are serving-image state, not canonical data.
    conn.execute("ANALYZE")
    try:
        conn.execute("PRAGMA optimize")
    except sqlite3.DatabaseError:
        pass
    conn.commit()

    after = {
        "horses": table_count(conn, "horses"),
        "people": table_count(conn, "people"),
        "horse_people": table_count(conn, "horse_people"),
        "horse_search_source": table_count(conn, "horse_search_source"),
        "horse_search_fts": table_count(conn, "horse_search_fts"),
        "horse_search_trigram": table_count(conn, "horse_search_trigram"),
        "horse_role_search_trigram": table_count(conn, "horse_role_search_trigram"),
        "horse_registry_people_summary": table_count(conn, "horse_registry_people_summary"),
        "horse_reference_intelligence": table_count(conn, "horse_reference_intelligence"),
        "registry_filter_counts": table_count(conn, "registry_filter_counts"),
        "raw_json_nonnull": int(conn.execute("SELECT COUNT(*) FROM horses WHERE raw_json IS NOT NULL").fetchone()[0]),
    }

    if before["horses"] != after["horses"] or before["people"] != after["people"] or before["horse_people"] != after["horse_people"]:
        raise RuntimeError("Serving optimization changed canonical entity/relationship counts")
    if before["horse_search_source"] != after["horse_search_source"]:
        raise RuntimeError("Serving optimization changed canonical search-source row count")
    if after["horse_search_fts"] != before["horse_search_source"] or after["horse_search_trigram"] != before["horse_search_source"]:
        raise RuntimeError("External FTS row count does not match search source")
    if after["raw_json_nonnull"] != 0:
        raise RuntimeError("raw_json was not fully removed from serving rows")
    if not external_search_layout(conn):
        raise RuntimeError("External-content FTS layout was not created")
    role_sql = str(conn.execute("SELECT sql FROM sqlite_master WHERE name='horse_role_search_trigram'").fetchone()[0])
    if "columnsize=0" not in role_sql.replace(" ", ""):
        raise RuntimeError("Role trigram serving layout did not disable docsize storage")

    integrity = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    fk = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    if integrity != "ok" or fk != 0:
        raise RuntimeError(f"Serving DB integrity failed: integrity={integrity}, fk_violations={fk}")

    return {"before": before, "after": after, "integrity": integrity, "foreign_key_violations": fk}


def write_markdown_report(path: Path, report: dict[str, Any]) -> None:
    before_size = int(report["input"]["size_bytes"])
    after_size = int(report["output"]["size_bytes"])
    saved = before_size - after_size
    pct = (saved / before_size * 100.0) if before_size else 0.0
    b = report["transform"]["before"]
    a = report["transform"]["after"]
    path.write_text(
        "# D1 Serving DB Optimization Report\n\n"
        f"- Input: `{report['input']['file']}`\n"
        f"- Input SHA-256: `{report['input']['sha256']}`\n"
        f"- Input size: **{before_size:,} bytes**\n"
        f"- Output: `{report['output']['file']}`\n"
        f"- Output SHA-256: `{report['output']['sha256']}`\n"
        f"- Output size: **{after_size:,} bytes**\n"
        f"- Saved: **{saved:,} bytes ({pct:.2f}%)**\n\n"
        "## Exact retained canonical counts\n\n"
        f"- Horses: {a['horses']:,}\n"
        f"- People: {a['people']:,}\n"
        f"- Horse-person relationships: {a['horse_people']:,}\n"
        f"- Search source: {a['horse_search_source']:,}\n"
        f"- Main FTS: {a['horse_search_fts']:,}\n"
        f"- Trigram FTS: {a['horse_search_trigram']:,}\n"
        f"- Reference intelligence: {a['horse_reference_intelligence']:,}\n"
        f"- Filter counts: {a['registry_filter_counts']:,}\n\n"
        "## Serving-only reductions\n\n"
        f"- `raw_json` non-null rows: {b['raw_json_nonnull']:,} → {a['raw_json_nonnull']:,}\n"
        f"- Empty people-summary rows removed: {b['horse_registry_people_summary'] - a['horse_registry_people_summary']:,}\n"
        f"- Empty role-trigram documents removed: {b['horse_role_search_trigram'] - a['horse_role_search_trigram']:,}\n"
        "- Dropped unused serving indexes: `idx_hri_cohort`, `idx_hri_dpi`, `idx_hri_kinship`, `idx_horses_microchip_no`, `idx_people_name_latin`\n"
        "- `horse_search_fts` and `horse_search_trigram` use `horse_search_source` as external content.\n"
        "- `horse_role_search_trigram` uses `columnsize=0` because it is membership-only and never ranked.\n\n"
        "## Safety\n\n"
        f"- Integrity: `{report['transform']['integrity']}`\n"
        f"- Foreign-key violations: {report['transform']['foreign_key_violations']}\n"
        "- Canonical input was not modified.\n"
        "- No user-visible field, canonical entity, relationship, search-source row, or intelligence row was removed.\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--report-json", type=Path)
    ap.add_argument("--report-md", type=Path)
    ap.add_argument("--expect-sha256", default=None)
    args = ap.parse_args()

    src = args.input.resolve()
    dst = args.output.resolve()
    if not src.exists():
        ap.error(f"Input not found: {src}")
    if src == dst:
        ap.error("Input and output must differ; canonical input is immutable")

    input_sha = sha256_file(src)
    if args.expect_sha256 and input_sha.lower() != args.expect_sha256.lower():
        raise SystemExit(f"Input SHA-256 mismatch: {input_sha}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="horse-d1-serving-", dir=str(dst.parent)) as td:
        work = Path(td) / "working.sqlite"
        shutil.copy2(src, work)
        conn = sqlite3.connect(work)
        try:
            transform = optimize_working_copy(conn)
            sizes = database_size_breakdown(conn)
            compact = Path(td) / "compact.sqlite"
            escaped = str(compact).replace("'", "''")
            conn.execute(f"VACUUM INTO '{escaped}'")
        finally:
            conn.close()
        if dst.exists():
            dst.unlink()
        shutil.move(str(compact), dst)

    # Reopen compact artifact and verify final integrity/counts after VACUUM.
    final = sqlite3.connect(dst)
    try:
        final_integrity = str(final.execute("PRAGMA integrity_check").fetchone()[0])
        final_fk = len(final.execute("PRAGMA foreign_key_check").fetchall())
        final_counts = {t: table_count(final, t) for t in ("horses", "people", "horse_people", "horse_search_source", "horse_search_fts", "horse_search_trigram")}
    finally:
        final.close()
    if final_integrity != "ok" or final_fk:
        raise SystemExit(f"Final compact database failed integrity: {final_integrity}, fk={final_fk}")

    report = {
        "format_version": 1,
        "input": {"file": src.name, "path": str(src), "size_bytes": src.stat().st_size, "sha256": input_sha},
        "output": {"file": dst.name, "path": str(dst), "size_bytes": dst.stat().st_size, "sha256": sha256_file(dst)},
        "transform": transform,
        "pre_vacuum_dbstat_bytes": sizes,
        "final_integrity": final_integrity,
        "final_foreign_key_violations": final_fk,
        "final_counts": final_counts,
    }
    if args.report_json:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.report_md:
        args.report_md.parent.mkdir(parents=True, exist_ok=True)
        write_markdown_report(args.report_md, report)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
