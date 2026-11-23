#!/usr/bin/env python3
"""Create a NEW, separately marked generated scale fixture; never read real data.

The fixed target is data/benchmarks/r111-scale-<rows>.sqlite. Existing files,
symlinks and arbitrary paths are refused. This is not a demo-login database.
"""
import argparse
import hashlib
import json
import math
import os
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 800_000_000
NAMESPACE = "synthetic:scale:r111"
WARNING = "GENERATED SYNTHETIC SCALE FIXTURE. No real horses, people, registry coverage, ownership or laboratory evidence."


def create(rows):
    if not 5_000 <= rows <= 80_000:
        raise ValueError("Choose 5,000–80,000 generated rows for this bounded harness")
    path = ROOT / "data/benchmarks" / f"r111-scale-{rows}.sqlite"
    if any(parent.is_symlink() for parent in [path, *path.parents]):
        raise ValueError("Symbolic-link target refused")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    inode = path.stat().st_ino
    started = time.perf_counter()
    db = None
    try:
        db = sqlite3.connect(path)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA temp_store=MEMORY")
        # The file is exclusively new, disposable and integrity-checked before
        # publication; no user commands need crash durability during generation.
        db.execute("PRAGMA journal_mode=MEMORY")
        migrations = sorted((ROOT / "migrations").glob("*.sql"))
        digest = hashlib.sha256()
        for migration in migrations:
            raw = migration.read_bytes()
            digest.update(migration.name.encode()+b"\0"+raw)
            db.executescript(raw.decode())
        names = ("AURORA", "DESERT", "EMBER", "LILAC", "NORTH", "SILVER", "VALE", "WIND")
        breeds = ("SYNTHETIC Arabian", "SYNTHETIC Warmblood", "SYNTHETIC Thoroughbred")
        now = "2026-10-17T12:00:00Z"

        def horses():
            for number in range(1, rows+1):
                father = mother = None
                if number <= 2_000:
                    # A deliberately prolific family exercises explicit
                    # descendant truncation beyond the requested 600-node cap.
                    if number > 2: father, mother = BASE+1, BASE+2
                    year = 1998+number if number <= 2 else 2005+number % 20
                    sex = "Stallion" if number == 1 or number > 2 and number % 2 == 0 else "Mare"
                else:
                    start = 2_001 + ((number-2_001)//4_095)*4_095
                    position = number-start+1
                    family_end = min(start+4_094, rows)
                    sire, dam = start+position*2-1, start+position*2
                    if sire <= family_end: father = BASE+sire
                    if dam <= family_end and position % 13 != 0: mother = BASE+dam
                    year = 2026-4*int(math.log2(position))
                    sex = "Stallion" if position % 2 == 0 else "Mare"
                yield (BASE+number,f"SCALE {names[number % len(names)]} {number:06}",f"اسب ساختگی {number:06}",
                       f"SYNTHETIC-SCALE-{number:06}",year,f"Synthetic region {number % 10}",breeds[number % len(breeds)],
                       sex,"Synthetic colour",father,mother,WARNING,now,now)
        db.executemany("""INSERT INTO horses(id,name_latin,name_native,register_no,birth_year,birth_place_desc,breed_desc,sex_desc,color_desc,
            father_id,mother_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", horses())
        db.executemany("INSERT INTO people(id,name_latin,name_native,created_at,updated_at) VALUES(?,?,?,?,?)",
                       ((890_000_000+i,f"Synthetic Scale Owner {i:04}",f"فرد ساختگی {i}",now,now) for i in range(1,513)))
        db.executemany("INSERT INTO horse_people(horse_id,person_id,role) VALUES(?,?,?)",
                       ((BASE+i,890_000_001+i%512,role) for i in range(1,rows+1) for role in ("owner","breeder")))
        db.commit()
        # Reuse the shipped source/FTS/trigram projection on this exclusively
        # new generated database. No existing search rows are deleted.
        source = (ROOT / "seed/demo.sql").read_text()
        index_sql = source[source.index("INSERT INTO horse_search_source"):]
        old_ids = "900000001,900000002,900000003,900000004,900000005,900000006,900000007,900000010,900000011"
        if index_sql.count(old_ids) != 3:
            raise ValueError("Canonical search seed changed; review this harness")
        db.executescript(index_sql.replace(old_ids,"SELECT id FROM horses"))
        db.execute("UPDATE registry_runtime_counters SET active_horse_count=? WHERE id=1",(rows,))
        exact_number = min(12_345,rows-3)
        manifest = {"namespace":NAMESPACE,"is_demo":True,"warning":WARNING,"rows":rows,"people":512,"horse_people":rows*2,
                    "migration_count":len(migrations),"schema_sha256":digest.hexdigest(),"generator_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "seed_projection_sha256":hashlib.sha256(source.encode()).hexdigest(),"as_of":"2026-10-17",
                    "shape":{"prolific_family_rows":2000,"binary_family_max_rows":4095,"missing_dam_rule":"Every thirteenth binary-tree position",
                             "max_tree_depth":11,"parent_year_gap":4,"breeds":list(breeds),"real_distribution_matched":False},
                    "cases":{"prolific_sire":BASE+1,"deep_profile":BASE+2001,"exact_name":f"SCALE {names[exact_number % len(names)]} {exact_number:06}",
                             "native_name":f"اسب ساختگی {exact_number:06}","exact_id":BASE+exact_number},
                    "excluded_payloads":["media blobs","private workspaces","marketplace and payments","genetics","analytics materializations"],
                    "derived_snapshots":"not built; canonical fallback reads are measured", "external_io":"none"}
        db.execute("CREATE TABLE synthetic_scale_manifest(id INTEGER PRIMARY KEY CHECK(id=1),namespace TEXT NOT NULL,manifest_json TEXT NOT NULL)")
        db.execute("INSERT INTO synthetic_scale_manifest VALUES(1,?,?)",(NAMESPACE,json.dumps(manifest)))
        db.commit()
        db.execute("ANALYZE")
        db.execute("VACUUM")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Generated scale fixture failed integrity checks")
        for table in ("horses","horse_search_source","horse_search_fts","horse_search_trigram"):
            if db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != rows:
                raise ValueError(f"Incomplete generated search table {table}")
        db.close()
        db = None
        return {**manifest,"path":str(path),"bytes":path.stat().st_size,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                "generation_seconds":round(time.perf_counter()-started,3),"integrity":"ok"}
    except BaseException:
        if db is not None: db.close()
        if path.exists() and path.stat().st_ino == inode:
            path.unlink()
            for suffix in ("-journal","-wal","-shm"):
                sidecar=Path(str(path)+suffix)
                if sidecar.exists() and not sidecar.is_symlink(): sidecar.unlink()
        raise


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows",type=int,default=78_000)
    try:
        print(json.dumps(create(parser.parse_args().rows),ensure_ascii=False,indent=2))
    except (ValueError,OSError,sqlite3.Error) as exc:
        raise SystemExit(f"Scale fixture creation refused: {exc}")
