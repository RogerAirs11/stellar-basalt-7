#!/usr/bin/env python3
"""Compare two canonical horse-registry SQLite databases without mutating either.

Designed for future client workbook refreshes: import the new XLSX to a second
SQLite file, compare it with the currently approved canonical snapshot, inspect
the report, and only then decide how to apply changes.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

EXCLUDED = {"created_at", "updated_at", "deleted_at", "row_version", "raw_json"}


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def comparable_columns(conn: sqlite3.Connection) -> list[str]:
    return [r[1] for r in conn.execute("PRAGMA table_info(horses)") if r[1] not in EXCLUDED]


def horse_ids(conn: sqlite3.Connection) -> set[int]:
    return {int(r[0]) for r in conn.execute("SELECT id FROM horses")}


def compare(old_path: Path, new_path: Path, detail_limit: int = 50) -> dict[str, Any]:
    old = connect(old_path); new = connect(new_path)
    try:
        old_cols = comparable_columns(old); new_cols = comparable_columns(new)
        common_cols = [c for c in old_cols if c in set(new_cols)]
        schema = {
            "old_only_columns": sorted(set(old_cols) - set(new_cols)),
            "new_only_columns": sorted(set(new_cols) - set(old_cols)),
            "compared_columns": common_cols,
        }
        old_ids, new_ids = horse_ids(old), horse_ids(new)
        added = sorted(new_ids - old_ids); removed = sorted(old_ids - new_ids); shared = sorted(old_ids & new_ids)
        changed_ids: list[int] = []
        field_counts: Counter[str] = Counter()
        detail: list[dict[str, Any]] = []
        cols_sql = ",".join(common_cols)
        batch = 900
        for offset in range(0, len(shared), batch):
            ids = shared[offset:offset+batch]
            ph = ",".join("?" for _ in ids)
            old_rows = {int(r["id"]): r for r in old.execute(f"SELECT {cols_sql} FROM horses WHERE id IN ({ph})", ids)}
            new_rows = {int(r["id"]): r for r in new.execute(f"SELECT {cols_sql} FROM horses WHERE id IN ({ph})", ids)}
            for hid in ids:
                a, b = old_rows[hid], new_rows[hid]
                changed = [c for c in common_cols if a[c] != b[c]]
                if not changed: continue
                changed_ids.append(hid)
                field_counts.update(changed)
                if len(detail) < detail_limit:
                    detail.append({"horse_id": hid, "fields": changed})
        return {
            "old_database": old_path.name,
            "new_database": new_path.name,
            "counts": {
                "old_horses": len(old_ids), "new_horses": len(new_ids), "added": len(added),
                "removed": len(removed), "changed": len(changed_ids), "unchanged": len(shared)-len(changed_ids),
            },
            "schema": schema,
            "field_change_counts": dict(field_counts.most_common()),
            "sample_ids": {"added": added[:detail_limit], "removed": removed[:detail_limit], "changed": changed_ids[:detail_limit]},
            "sample_change_fields": detail,
            "note": "Values are intentionally omitted from the default report to reduce accidental disclosure. Inspect approved records separately when needed.",
        }
    finally:
        old.close(); new.close()


def main() -> int:
    p = argparse.ArgumentParser(description="Compare two canonical registry SQLite snapshots")
    p.add_argument("old", type=Path); p.add_argument("new", type=Path)
    p.add_argument("--output", type=Path, default=None)
    p.add_argument("--detail-limit", type=int, default=50)
    a = p.parse_args()
    for path in (a.old, a.new):
        if not path.exists(): p.error(f"Database not found: {path}")
    report = compare(a.old, a.new, max(0, min(a.detail_limit, 500)))
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if a.output:
        a.output.parent.mkdir(parents=True, exist_ok=True); a.output.write_text(text, encoding="utf-8")
    print(text)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
