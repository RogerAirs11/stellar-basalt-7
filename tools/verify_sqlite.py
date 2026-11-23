#!/usr/bin/env python3
"""Fast integrity and feature checks for a generated canonical SQLite database."""
from __future__ import annotations
import argparse, json, sqlite3
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("database", type=Path)
    a = p.parse_args()
    if not a.database.exists():
        p.error(f"Database not found: {a.database}")
    conn = sqlite3.connect(a.database)
    conn.row_factory = sqlite3.Row
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    tables = [
        "horses", "people", "horse_people", "data_quality_issues",
        "horse_search_source", "horse_search_fts", "horse_search_trigram", "horse_role_search_trigram",
    ]
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_filter_counts'").fetchone():
        counts["registry_filter_counts"] = conn.execute("SELECT COUNT(*) FROM registry_filter_counts").fetchone()[0]
    analytics_table = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analytics_snapshots'").fetchone() is not None
    counts["analytics_snapshots"] = conn.execute("SELECT COUNT(*) FROM analytics_snapshots").fetchone()[0] if analytics_table else 0
    runtime_summary_ready = bool(analytics_table and conn.execute("SELECT 1 FROM analytics_snapshots WHERE key='registry-runtime' LIMIT 1").fetchone())
    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    latest_source = conn.execute(
        "SELECT source_filename,source_sha256,source_rows,completed_at,status FROM source_imports ORDER BY id DESC LIMIT 1"
    ).fetchone()
    fts = conn.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'name_latin:aur*' LIMIT 1").fetchone() if counts["horse_search_source"] else None
    trigram_ok = True
    role_trigram_ok = True
    if counts["horse_search_source"]:
        try:
            conn.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'auro' LIMIT 1").fetchone()
        except sqlite3.OperationalError:
            trigram_ok = False
        try:
            conn.execute('SELECT rowid FROM horse_role_search_trigram WHERE owner MATCH \'"ali"\' LIMIT 1').fetchone()
        except sqlite3.OperationalError:
            role_trigram_ok = False
    result = {
        "integrity": integrity,
        "foreign_key_violations": len(fk),
        "counts": counts,
        "latest_source": dict(latest_source) if latest_source else None,
        "fts_query_executed": fts is not None or counts["horse_search_source"] == 0,
        "trigram_query_supported": trigram_ok,
        "role_trigram_query_supported": role_trigram_ok,
        "analytics_ready": counts["analytics_snapshots"] > 0,
        "runtime_summary_ready": runtime_summary_ready,
    }
    print(json.dumps(result, indent=2))
    conn.close()
    return 0 if integrity == "ok" and not fk and trigram_ok and role_trigram_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
