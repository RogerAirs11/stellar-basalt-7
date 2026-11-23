#!/usr/bin/env python3
"""Verify generated D1 SQL shards by replaying them into a fresh SQLite DB."""
from __future__ import annotations
import argparse, json, sqlite3, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"

p = argparse.ArgumentParser()
p.add_argument("--canonical", type=Path, required=True)
p.add_argument("--shards", type=Path, required=True)
a = p.parse_args()
manifest_payload = json.loads((a.shards / "manifest.json").read_text(encoding="utf-8"))
manifest = manifest_payload["files"]
entries = {entry["file"]: entry for entry in manifest_payload.get("entries", [])}
for name in manifest:
    path = a.shards / name
    entry = entries.get(name)
    if entry:
        import hashlib
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry.get("sha256") or path.stat().st_size != entry.get("bytes"):
            raise SystemExit(f"Shard manifest integrity mismatch: {name}")

with tempfile.TemporaryDirectory(prefix="horse-d1-verify-") as td:
    replay = Path(td) / "replay.sqlite"
    dst = sqlite3.connect(replay)
    dst.execute("PRAGMA foreign_keys=ON")
    for path in sorted(MIGRATIONS.glob("*.sql")):
        dst.executescript(path.read_text(encoding="utf-8"))
    for index, name in enumerate(manifest, 1):
        dst.executescript("BEGIN;\n" + (a.shards / name).read_text(encoding="utf-8") + "\nCOMMIT;\n")
        if index % 10 == 0 or index == len(manifest):
            print(f"replayed {index}/{len(manifest)} shards")
    dst.commit()

    src = sqlite3.connect(a.canonical)
    tables = ["source_imports","horses","people","horse_people","horse_aliases","data_quality_issues","horse_search_source","horse_search_fts","horse_search_trigram","horse_role_search_trigram"]
    for optional in ("analytics_snapshots", "horse_reference_intelligence", "person_registry_stats", "registry_runtime_counters", "horse_registry_people_summary", "registry_filter_counts", "registry_state"):
        if src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (optional,)).fetchone():
            tables.append(optional)
    mismatches = []
    for table in tables:
        expected = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        actual = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"{table}: {actual:,} (expected {expected:,})")
        if actual != expected:
            mismatches.append((table, expected, actual))

    fk = dst.execute("PRAGMA foreign_key_check").fetchall()
    integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
    missing_parent_links = dst.execute("""
      SELECT COUNT(*) FROM horses d
      JOIN main.horses s ON s.id=d.id
      WHERE 0
    """).fetchone()[0]  # keeps the verification query section explicit; parent comparison follows below.
    parent_diff = dst.execute("SELECT COUNT(*) FROM horses WHERE father_id=id OR mother_id=id").fetchone()[0]
    # Compare all parent IDs directly against canonical DB using an attached read-only-ish source.
    dst.execute("ATTACH DATABASE ? AS canonical", (str(a.canonical),))
    parent_mismatch = dst.execute("""
      SELECT COUNT(*) FROM horses d JOIN canonical.horses c ON c.id=d.id
      WHERE COALESCE(d.father_id,-1)<>COALESCE(c.father_id,-1)
         OR COALESCE(d.mother_id,-1)<>COALESCE(c.mother_id,-1)
    """).fetchone()[0]
    print(f"foreign_key_violations: {len(fk)}")
    print(f"integrity: {integrity}")
    print(f"parent_link_mismatches: {parent_mismatch}")
    src.close(); dst.close()
    if mismatches or fk or integrity != "ok" or parent_mismatch:
        raise SystemExit(1)
print("D1 shard replay verification: PASS")
