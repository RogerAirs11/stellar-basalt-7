#!/usr/bin/env python3
"""Create a NEW, explicitly synthetic local registry; never seed a remote/live DB.

Usage: python tools/create-demo-database.py [--output data/demo/client-demo.sqlite]
Existing paths are refused (including symlinks). No reset/overwrite flag exists.
Use --check to inspect the safety marker and integrity without changing the file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import uuid
from collections import defaultdict
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMESPACE = "synthetic:r111"
ADMIN = "demo-admin-local"
WARNING = "SYNTHETIC DEMONSTRATION ONLY. No real identity, ownership, consent, credential, payment, or delivery."


def schema_hash() -> str:
    digest = hashlib.sha256()
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        digest.update(migration.name.encode())
        digest.update(b"\0")
        digest.update(migration.read_bytes())
    return digest.hexdigest()


def target_path(value: str) -> Path:
    if "://" in value or value.startswith("file:") or value == ":memory:":
        raise ValueError("Only a local .sqlite path is allowed; remote/file URIs are refused")
    path = Path(value).expanduser().absolute()
    if path.suffix != ".sqlite":
        raise ValueError("The local demo filename must end in .sqlite")
    if any(parent.is_symlink() for parent in [path, *path.parents]):
        raise ValueError("Refusing a symbolic-link database path")
    return path


def inspect(path: Path) -> dict:
    path = target_path(str(path))
    # mode=ro prevents accidental creation or modification during verification.
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        row = db.execute("SELECT namespace, schema_sha256, as_of, manifest_json FROM local_demo_manifest WHERE id=1").fetchone()
        if not row or row[0] != NAMESPACE or row[1] != schema_hash():
            raise ValueError("Not an R111 synthetic demo, or migrations changed; create a fresh file")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Demo database integrity check failed")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Demo database has invalid foreign keys")
        manifest = json.loads(row[3])
        if manifest.get("builder_sha256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
            raise ValueError("Demo builder changed; create a fresh isolated file instead of silently reusing old fixtures")
        if manifest.get("source_sha256") != hashlib.sha256((ROOT / "public/demo-workbench/data.json").read_bytes()).hexdigest():
            raise ValueError("Bundled demo data changed; create a fresh isolated file")
        if manifest.get("fixture_helpers_sha256") != fixture_helpers_hash():
            raise ValueError("Demo scenario, media or canonical date helper changed; create a fresh isolated file")
        manifest["path"] = str(path)
        manifest["integrity"] = "ok"
        return manifest


def insert(db: sqlite3.Connection, table: str, values: dict) -> None:
    # All identifiers below are implementation constants, never user supplied.
    db.execute(f"INSERT INTO {table} ({','.join(values)}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))


def fixture_helpers_hash() -> str:
    digest = hashlib.sha256()
    for relative in ("tools/demo_scenarios.py", "tools/demo_media_fixtures.py", "tools/demo-season-values.mjs", "src/registry/dates.ts", "tools/build_analytics_snapshot.py"):
        digest.update(relative.encode())
        digest.update((ROOT / relative).read_bytes())
    return digest.hexdigest()


def canonical_seasons(days: list[date]) -> list[int]:
    """Call the application's actual conversion, without a second calendar implementation."""
    result = subprocess.run([os.environ.get("NODE", "node"), str(ROOT / "tools/demo-season-values.mjs"), json.dumps([day.isoformat() for day in days])],
                            check=True, text=True, capture_output=True, cwd=ROOT)
    seasons = json.loads(result.stdout)
    if any(not isinstance(season, int) or not 1380 <= season <= 1500 for season in seasons):
        raise ValueError("Demo date falls outside the supported canonical Solar Hijri seasons")
    return seasons


def normalize_baseline_timestamps(db: sqlite3.Connection, now: str) -> None:
    """Only called on the exclusively created synthetic baseline, before publication."""
    baseline_columns = {"created_at","updated_at","added_at","indexed_at","computed_at","generated_at","built_at"}
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for table in tables:
        for column in db.execute(f'PRAGMA table_info("{table}")').fetchall():
            if column[1] in baseline_columns:
                db.execute(f'UPDATE "{table}" SET "{column[1]}"=? WHERE "{column[1]}" IS NOT NULL', (now,))


def create(path: Path, as_of: date) -> dict:
    path = target_path(str(path))
    if as_of < date(2025, 1, 1):
        raise ValueError("Demo rehearsal date must be 2025-01-01 or later to keep fictional parent ages coherent")
    fixture_path = ROOT / "public/demo-workbench/data.json"
    raw = fixture_path.read_bytes()
    fixture = json.loads(raw)
    if fixture.get("is_demo") is not True or fixture.get("namespace") != "synthetic:r88":
        raise ValueError("Only the bundled, explicitly synthetic fixture is accepted")
    for key in ("horses", "people", "providers", "competitions", "results", "listings"):
        if not fixture.get(key) or any(row.get("is_demo") is not True or row.get("authority") != "none" for row in fixture[key]):
            raise ValueError(f"Unmarked or empty synthetic fixture collection: {key}")
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation: an existing file (even an empty or unrelated DB) is NEVER opened for writes.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    created_inode = path.stat().st_ino
    db = None
    try:
        db = sqlite3.connect(path)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted((ROOT / "migrations").glob("*.sql"))
        for migration in migrations:
            db.executescript(migration.read_text(encoding="utf-8"))
        now = as_of.isoformat() + "T12:00:00Z"
        people = {row["id"]: 990000000 + index for index, row in enumerate(fixture["people"], 1)}
        horses = {row["id"]: 900000000 + row["id"] for row in fixture["horses"]}
        events = {row["id"]: 960000000 + index for index, row in enumerate(fixture["competitions"], 1)}
        insert(db, "users", dict(id=ADMIN, email="demo-admin@local.invalid", display_name="DEMO Local Administrator", password_hash="demo-route-only", role="admin"))
        from demo_scenarios import seed_users, seed_scenarios, stable_id
        seed_users(db, now, ADMIN)
        for person in fixture["people"]:
            insert(db, "people", dict(id=people[person["id"]], name_latin=person["name"]["en"], name_native=person["name"]["fa"]))
        # Parent rows can appear later; the existing schema declares deferred lineage foreign keys.
        for horse in fixture["horses"]:
            insert(db, "horses", dict(id=horses[horse["id"]], name_latin=horse["name_latin"], name_native=horse["name_native"],
                birth_year=horse["birth_year"], birth_place_desc=horse["province"], breed_desc=horse["breed_desc"],
                sex_desc="Stallion" if horse["sex_desc"] == "male" else "Mare", color_desc=horse["color_desc"],
                father_id=horses.get(horse["father_id"]), mother_id=horses.get(horse["mother_id"]),
                description=WARNING, register_no=horse["public_id"]))
            for role in ("owner", "breeder"):
                insert(db, "horse_people", dict(horse_id=horses[horse["id"]], person_id=people[horse[f"{role}_id"]], role=role))
        catalog = json.loads((ROOT / "src/directory/catalog.json").read_text(encoding="utf-8"))
        provinces = {row["en"]:row["code"] for row in catalog["provinces"]}
        allowed_categories = {row["id"] for row in catalog["service_categories"]}
        categories = defaultdict(set)
        for provider in fixture["providers"]:
            if provider["category"] not in allowed_categories:
                raise ValueError("Demo provider category is not in the canonical vocabulary")
            categories[provider["person_id"]].add(provider["category"])
        for index, person in enumerate(fixture["people"], 1):
            published = index != len(fixture["people"])
            insert(db, "directory_profiles", dict(id=950000000+index, person_id=people[person["id"]],
                service_categories=json.dumps(sorted(categories[person["id"]])), province_code=provinces[person["province"]], province_code_scheme=catalog["province_code_scheme"],
                city=person["province"], contact_preference="platform_message", contact_value=None,
                languages='["en","fa"]', availability_text=WARNING, publication_consent=int(published),
                published_at=now if published else None, created_by_user_id=ADMIN))
        for event in fixture["competitions"]:
            insert(db, "competitions", dict(id=events[event["id"]], name_native=event["name"]["fa"], name_latin=event["name"]["en"],
                discipline={"jumping":"show_jumping","show":"halter"}.get(event["discipline"],event["discipline"]), event_date=event["date"], venue="DEMO fictional venue", city=event["province"],
                season=int(event["date"][:4]), provenance="demo", notes=WARNING))
        person_names = {person["id"]: person["name"]["en"] for person in fixture["people"]}
        for index, result in enumerate(fixture["results"], 1):
            insert(db, "competition_results", dict(id=960001000+index, competition_id=events[result["competition_id"]],
                horse_id=horses[result["horse_id"]], rider_name=person_names[result["rider_id"]], placement=result["placement"],
                provenance="demo", notes=WARNING))
        listing_stories = []
        for listing in fixture["listings"]:
            listing_id = stable_id("listing/" + listing["id"])
            # UUID grammar stays identical to production detail/status/inquiry routes.
            uuid.UUID(listing_id)
            listing_stories.append(dict(id=listing_id, fixture_key=listing["id"], horse_id=horses[listing["horse_id"]], detail_path=f"/api/market/listings/{listing_id}"))
            insert(db, "sales_listings", dict(id=listing_id, horse_id=horses[listing["horse_id"]],
                seller_user_id=ADMIN, seller_contact_name=person_names[listing["seller_id"]], seller_city=listing["province"],
                asking_price_toman=None, status=listing["status"], title="DEMO horse listing - not for sale", description=WARNING,
                provenance="demo", listed_at=now, updated_at=now, availability_confirmed_at=now,
                expires_at=(as_of+timedelta(days=30)).isoformat()+"T12:00:00Z"))
        # Explicitly unverified, synthetic laboratory placeholders. These are
        # presentation fixtures, never claims of real testing or medical status.
        assay_rows = [(17,"CA","N/CA"),(18,"CA","N/N"),(17,"SCID","N/N"),
                      (18,"SCID","N/SCID"),(19,"LFS","not tested"),
                      (20,"OAAM1","N/OAAM"),(17,"CA","inconclusive")]
        for index, (horse, assay, result) in enumerate(assay_rows, 1):
            insert(db, "genetic_tests", dict(id=980000000+index, horse_id=900000000+horse,
                test_type=assay, test_category="disease", result=result, verified=0,
                lab_name="DEMO - NOT A LABORATORY", lab_accession=f"SYNTHETIC-{index}",
                tested_at=as_of.isoformat(), notes=WARNING, provenance="demo"))
        # These two explicitly fictional examples exercise the reviewed assay
        # mapping flow. The seven ordinary placeholders above remain unverified.
        for test_id, horse_id in [(980000008,900000017),(980000009,900000018)]:
            insert(db, "genetic_tests", dict(id=test_id, horse_id=horse_id, test_type="CA", test_category="disease", result="N/CA", verified=1,
                lab_name="DEMO FICTIONAL LAB - NO ACTUAL TEST", lab_accession=f"SYNTHETIC-REVIEWED-{test_id}", tested_at=as_of.isoformat(),
                notes=WARNING + " Fictional reviewed genotype example; no actual laboratory test.", provenance="demo"))
            db.execute("""INSERT INTO genetic_pairing_reviews(test_id,assay_key,result_snapshot,test_type_snapshot,review_state,reviewed_by_user_id,reviewed_at,expires_at,row_version,last_operation_id,review_note)
                          VALUES(?,'CA','N/CA','CA','accepted','demo-reviewer',?,NULL,1,?,?)""",
                       (test_id, now, stable_id(f"genetic-review/{test_id}"), "Fictional reviewed genotype example; no actual laboratory test."))
        # Explicit invented dates ONLY for these fictional stories. Horse birth
        # years stay year-precision; covering dates are never padded from them.
        covering_days = [date(2020, 5, 12), as_of + timedelta(days=14)]
        seasons = canonical_seasons(covering_days)
        for index, (sire, dam, foal, outcome, covering, season) in enumerate([
            (9,12,17,"foaled",covering_days[0],seasons[0]),
            (17,20,None,"planned",covering_days[1],seasons[1])], 1):
            insert(db, "breeding_records", dict(id=980001000+index, sire_id=900000000+sire,
                dam_id=900000000+dam, foal_id=900000000+foal if foal else None,
                covering_date=covering.isoformat(), season=season, outcome=outcome,
                notes=WARNING + (" Fictional foaling: 2021-04-17 (340 days after covering); foal registry birth remains year-only." if foal else " Planned covering only; not a pregnancy."), provenance="demo"))
        collection = 970000001
        insert(db, "workspace_collections", dict(id=collection, name="DEMO Client Rehearsal", description=WARNING, owner_user_id=ADMIN))
        for index, horse in enumerate(fixture["horses"][16:22], 1):
            insert(db, "workspace_collection_members", dict(id=970001000+index, collection_id=collection, horse_id=horses[horse["id"]], added_by_user_id=ADMIN, note=WARNING))
        tasks = [(-2,"DEMO overdue paperwork","document_renewal","open"), (0,"DEMO today's planning","other","open"),
                 (3,"DEMO future appointment","veterinary_appointment","open"), (7,"DEMO farrier reminder","farrier","open"),
                 (-1,"DEMO completed checklist","other","done")]
        for index, (offset,title,category,status) in enumerate(tasks,1):
            insert(db, "workspace_tasks", dict(id=970002000+index, collection_id=collection, horse_id=900000017,
                title=title, category=category, due_date=(as_of+timedelta(days=offset)).isoformat(), status=status,
                created_by_user_id=ADMIN, assigned_to_user_id=ADMIN, occurrence_key=f"{NAMESPACE}:task:{index}",
                completed_at=now if status=="done" else None, completed_by_user_id=ADMIN if status=="done" else None))
        for index, (category,offset) in enumerate([("identification",30),("registration",7),("other",-3)],1):
            insert(db, "workspace_documents", dict(id=970003000+index, collection_id=collection, horse_id=900000017,
                title=f"DEMO unverified {category} placeholder", category=category, note=WARNING,
                expires_at=(as_of+timedelta(days=offset)).isoformat(), created_by_user_id=ADMIN))
        stories = seed_scenarios(db, now=now, as_of=as_of, warning=WARNING, admin_id=ADMIN, people=people, listings=listing_stories, workspace_id=collection)
        from demo_media_fixtures import seed_demo_media
        stories["media"] = seed_demo_media(db, now=now, warning=WARNING, admin_id=ADMIN, workspace_id=collection, horse_id=900000017, owner_id="demo-owner-a")
        stories["breeding"] = {"normal_record_ids":[980001001,980001002], "historical_foaling_day":"2021-04-17", "canonical_covering_seasons":seasons,
                              "invalid_legacy_fixture":{"included_in_database":False,"label":"Correction rehearsal input only, not a normal fixture", "record_id":980001002,"invalid_season":2026}}
        stories["pairing_evidence"] = {"test_ids":[980000008,980000009],"horse_ids":[900000017,900000018],"assay_key":"CA","genotypes":["N/CA","N/CA"],
            "label":"Fictional reviewed genotype examples; no actual laboratory tests. Ordinary placeholders remain unverified."}
        # R117-16: explicitly fictional issuers with NARROW approved scopes and
        # recorded registration evidence (no real federation/ownership/laboratory).
        from demo_scenarios import seed_fictional_issuers
        stories["credential_stories"] = seed_fictional_issuers(db, now=now, warning=WARNING, admin_id=ADMIN)
        db.execute("CREATE TABLE local_demo_clock(id INTEGER PRIMARY KEY CHECK(id=1), now_iso TEXT NOT NULL)")
        db.execute("INSERT INTO local_demo_clock VALUES(1,?)", (now,))
        insert(db, "source_imports", dict(source_filename="SYNTHETIC-R111-FIXTURE.json",source_sha256=hashlib.sha256(raw).hexdigest(),
            source_sheet=NAMESPACE,source_rows=len(horses),started_at=now,completed_at=now,status="complete",notes=WARNING))
        # This database is exclusively new and synthetic; index every seeded row.
        template = (ROOT / "seed/demo.sql").read_text(encoding="utf-8")
        index_sql = template[template.index("INSERT INTO horse_search_source"):]
        old_ids = "900000001,900000002,900000003,900000004,900000005,900000006,900000007,900000010,900000011"
        if index_sql.count(old_ids) != 3:
            raise ValueError("Search seed template changed; review builder before use")
        db.commit()
        db.executescript(index_sql.replace(old_ids, ",".join(str(value) for value in horses.values())))
        # Source hashes include updated_at, so normalize BEFORE building them.
        normalize_baseline_timestamps(db, now)
        db.commit()
        db.close()
        db = None
        from build_analytics_snapshot import ensure_snapshot
        ensure_snapshot(path, generated_at_override=now)
        db = sqlite3.connect(path)
        # Baseline timestamps are deterministic at a fixed --as-of date. This
        # touches only this exclusively created synthetic database. Temporal
        # story fields (covering, due, expiry, validity) retain their own values.
        normalize_baseline_timestamps(db, now)
        tables = ["horses","people","directory_profiles","competitions","competition_results","sales_listings",
                  "workspace_collections","workspace_collection_members","workspace_tasks","workspace_documents","horse_search_source","analytics_snapshots","genetic_tests","breeding_records","users","horse_claims","horse_access_grants","horse_media","billing_prices","service_requests","service_request_receipts"]
        manifest = dict(namespace=NAMESPACE, builder_revision="r113", is_demo=True, warning=WARNING, as_of=as_of.isoformat(),
            migration_count=len(migrations), schema_sha256=schema_hash(), builder_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), source_sha256=hashlib.sha256(raw).hexdigest(),
            fixture_helpers_sha256=fixture_helpers_hash(), dataset_kind="synthetic", write_policy="isolated_local_only", stories=stories,
            counts={table:db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables},
            user_id=ADMIN, workspace_id=collection, horse_ids=sorted(horses.values()),
            external_effects="disabled by tools/dev-demo.mjs + local SQLite adapter; no credentials loaded")
        db.execute("CREATE TABLE local_demo_manifest (id INTEGER PRIMARY KEY CHECK(id=1), namespace TEXT NOT NULL, schema_sha256 TEXT NOT NULL, as_of TEXT NOT NULL, manifest_json TEXT NOT NULL)")
        db.execute("INSERT INTO local_demo_manifest VALUES (1,?,?,?,?)",(NAMESPACE,schema_hash(),as_of.isoformat(),json.dumps(manifest)))
        db.commit()
        # Repack the new file so overwritten wall-clock defaults do not linger
        # in free page space; fixed-as-of rebuilds have identical bytes too.
        db.execute("VACUUM")
        db.close()
        db = None
        return inspect(path)
    except BaseException:
        if db is not None:
            db.close()
        # Never delete a file replaced by another process after our exclusive creation.
        if path.exists() and path.stat().st_ino == created_inode:
            path.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "data/demo/client-demo.sqlite"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(), help="ISO date for relative task/document dates")
    parser.add_argument("--check", action="store_true", help="Read-only marker/schema/integrity validation; never seeds")
    args = parser.parse_args()
    try:
        path = target_path(args.output)
        result = inspect(path) if args.check else create(path, args.as_of)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as exc:
        print(f"Demo database refused: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
