from __future__ import annotations
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


snapshot = load_module("analytics_snapshot_test_module", ROOT / "tools" / "build_analytics_snapshot.py")
schema = load_module("analytics_schema_test_module", ROOT / "tools" / "ensure_schema.py")


class AnalyticsSnapshotTests(unittest.TestCase):
    def test_snapshot_is_reproducible_cycle_aware_and_stale_safe(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "fixture.sqlite"
            sqlite3.connect(db).close()
            schema.apply_migrations(db)
            conn = sqlite3.connect(db)
            conn.executemany(
                "INSERT INTO horses(id,name_latin,father_id,mother_id,birth_year,sex_desc,breed_desc) VALUES(?,?,?,?,?,?,?)",
                [
                    (1, "SIRE", None, None, 1980, "Colt", "Arabian"),
                    (2, "DAM", None, None, 1982, "Filly", "Arabian"),
                    (3, "CHILD", 1, 2, 2000, "Filly", "Arabian"),
                    (4, "GRANDCHILD", 3, 2, 2018, "Colt", "Arabian"),
                    # Explicit corrupt cycle plus one downstream contaminated horse.
                    (10, "CYCLE A", 11, None, 1990, "Colt", "Arabian"),
                    (11, "CYCLE B", 10, None, 1991, "Colt", "Arabian"),
                    (12, "CYCLE CHILD", 10, None, 2010, "Filly", "Arabian"),
                ],
            )
            conn.commit(); conn.close()

            first = snapshot.ensure_snapshot(db, if_stale=True)
            self.assertEqual(first["action"], "rebuilt")
            conn = sqlite3.connect(db)
            payload = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.SNAPSHOT_KEY,)).fetchone()[0])
            self.assertEqual(payload["horseCount"], 7)
            self.assertEqual(payload["pedigree"]["cycleNodeCount"], 2)
            self.assertEqual(payload["pedigree"]["cycleContaminatedHorseCount"], 3)
            self.assertEqual(payload["pedigree"]["analyticsEligibleHorseCount"], 4)
            self.assertTrue(all(row["eligibleHorseCount"] == 4 for row in payload["pedigree"]["completeness"]))
            self.assertEqual(payload["schemaVersion"], snapshot.SCHEMA_VERSION)
            self.assertEqual(payload["algorithmVersion"], snapshot.ALGORITHM_VERSION)
            self.assertIn("runtimeSummary", payload)
            self.assertEqual(payload["runtimeSummary"]["stats"]["horses"], 7)
            self.assertEqual(payload["runtimeSummary"]["stats"]["searchRows"], 0)
            self.assertTrue(any(row["value"] == "Arabian" for row in payload["runtimeSummary"]["facets"]["breeds"]))
            runtime_payload = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.RUNTIME_SNAPSHOT_KEY,)).fetchone()[0])
            self.assertEqual(runtime_payload["sourceRevision"], first["sourceRevision"])
            self.assertEqual(runtime_payload["runtimeSummary"]["stats"]["horses"], 7)
            self.assertNotIn("premium", runtime_payload)
            self.assertIn("premium", payload)
            runtime_counter = conn.execute("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").fetchone()[0]
            self.assertEqual(runtime_counter, 7)
            person_stats_count = conn.execute("SELECT COUNT(*) FROM person_registry_stats").fetchone()[0]
            self.assertEqual(person_stats_count, 0)
            browse_people_count = conn.execute("SELECT COUNT(*) FROM horse_registry_people_summary").fetchone()[0]
            self.assertEqual(browse_people_count, 7)
            role_index_count = conn.execute("SELECT COUNT(*) FROM horse_role_search_trigram").fetchone()[0]
            self.assertEqual(role_index_count, 7)
            filter_counts = {(row[0], row[1]): row[2] for row in conn.execute(
                "SELECT filter_key,filter_value,count_value FROM registry_filter_counts"
            )}
            self.assertEqual(filter_counts[("breed", "Arabian")], 7)
            self.assertEqual(filter_counts[("sex", "Filly")], 3)
            self.assertEqual(filter_counts[("hasSire", "1")], 5)
            self.assertEqual(filter_counts[("hasDam", "1")], 2)
            self.assertEqual(payload["premium"]["analyticalValidity"]["pedigree"]["eligibleRecords"], 4)
            self.assertGreater(payload["premium"]["parentConcentration"]["sires"]["assignments"], 0)
            self.assertIn("peopleConcentration", payload["premium"])
            self.assertEqual(payload["premium"]["peopleConcentration"]["owners"]["assignments"], 0)
            self.assertEqual(payload["premium"]["generationIntervals"]["plausibleAgeRangeYears"], [2, 35])
            self.assertGreaterEqual(payload["premium"]["pedigreeDiversity"]["medianEquivalentCompleteGenerations"], 0)
            conn.close()

            reused = snapshot.ensure_snapshot(db, if_stale=True)
            self.assertEqual(reused["action"], "reuse")
            self.assertEqual(reused["sourceRevision"], first["sourceRevision"])

            conn = sqlite3.connect(db)
            conn.execute("UPDATE horses SET name_latin='SIRE RENAMED', row_version=row_version+1 WHERE id=1")
            conn.commit(); conn.close()
            rebuilt = snapshot.ensure_snapshot(db, if_stale=True)
            self.assertEqual(rebuilt["action"], "rebuilt")
            self.assertNotEqual(rebuilt["sourceRevision"], first["sourceRevision"])

    def test_r117_21_completeness_measures_are_separate_reproducible_and_honest(self):
        """R117-21: five separate coverage measures, each with the same explicit
        denominator, its own missing/unknown definition, snapshot time and
        permission scope; reproducible for the same fixture; an empty database
        is labelled with zero denominators rather than invented numbers; and no
        synthetic score claims verification or registry completeness."""
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "completeness.sqlite"
            sqlite3.connect(db).close()
            schema.apply_migrations(db)
            conn = sqlite3.connect(db)
            conn.executemany(
                "INSERT INTO horses(id,name_latin,name_native,father_id,mother_id,birth_year,sex_desc,breed_desc,is_active,is_dead,is_imported,is_sport) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    (1, "FULL RECORD", "کامل", 2, 3, 2000, "Stallion", "Arabian", 1, 0, 1, 0),
                    (2, "SIRE", None, None, None, 1980, "Stallion", "Arabian", 1, 0, 0, 0),
                    (3, "DAM", None, None, None, 1982, "Mare", "Arabian", 1, 0, 0, 0),
                    (4, "PARTIAL", None, 1, None, 2005, "Colt", None, 0, 0, 0, 0),
                    (5, "MINIMAL", None, None, None, None, None, None, 0, 1, 0, 0),
                ],
            )
            conn.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('u1','u1@example.test','U1','x','user')")
            conn.execute("INSERT INTO competitions(id,name_native,discipline,event_date,venue,season) VALUES(10,'Cup','endurance','2020-01-01','Tehran',2020)")
            conn.execute("INSERT INTO competition_results(competition_id,horse_id,placement) VALUES(10,1,1)")
            conn.execute("INSERT INTO genetic_tests(horse_id,test_type,result) VALUES(2,'CA','N/N')")
            conn.execute("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status) VALUES('microchip','fic','abc123','abc123',3,'live')")
            conn.execute("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status) VALUES('microchip','fic','dead9','dead9',4,'superseded')")
            conn.execute("INSERT INTO issuers(id,slug,name) VALUES('iss1','iss1','Issuer One')")
            conn.execute("INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,attested_by_user_id) VALUES('at1','iss1',5,'horse_identity','5','u1')")
            conn.execute("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes) VALUES('m1',1,'photo','a.jpg','image/jpeg',10)")
            conn.execute("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes) VALUES('m2',4,'photo','b.jpg','image/jpeg',10)")
            conn.execute("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes) VALUES('m3',4,'document','c.pdf','application/pdf',10)")
            conn.commit(); conn.close()

            built = snapshot.ensure_snapshot(db, if_stale=False)
            self.assertEqual(built["action"], "rebuilt")
            conn = sqlite3.connect(db)
            payload = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.SNAPSHOT_KEY,)).fetchone()[0])
            conn.close()
            section = payload["completeness"]
            self.assertEqual(section["snapshotTime"], payload["generatedAt"])
            self.assertIn("denominator", section["denominatorDefinition"].lower())
            self.assertIn("public registry surface", section["permissionScope"].lower())
            self.assertIn("never assert verification", section["interpretation"])

            measures = {measure["key"]: measure for measure in section["measures"]}
            self.assertEqual(set(measures), {"identity", "ancestry", "evidence", "media", "activity"})
            for key, measure in measures.items():
                self.assertEqual(measure["totalRecords"], 5, f"{key} shares the same explicit denominator")
                self.assertTrue(measure["missingDefinition"], f"{key} defines missing/unknown")
                self.assertTrue(measure["coveragePercent"] == round(measure["coveredRecords"] / 5 * 100, 2))

            # identity: every horse has a Latin name; only horse 1 has a native name.
            self.assertEqual(measures["identity"]["coveredRecords"], 5)
            identity_components = {component["key"]: component for component in measures["identity"]["components"]}
            self.assertEqual(identity_components["nativeName"]["coveredRecords"], 1)
            self.assertEqual(identity_components["breed"]["coveredRecords"], 3)
            self.assertEqual(identity_components["birthYear"]["coveredRecords"], 4)
            # ancestry: horses 1 and 4 have at least one parent; only horse 1 has both.
            self.assertEqual(measures["ancestry"]["coveredRecords"], 2)
            ancestry_components = {component["key"]: component for component in measures["ancestry"]["components"]}
            self.assertEqual(ancestry_components["anyParent"]["coveredRecords"], 2)
            self.assertEqual(ancestry_components["bothParents"]["coveredRecords"], 1)
            # evidence: horses 1 (competition), 2 (genetic test), 3 (live identifier) and 5 (active attestation).
            self.assertEqual(measures["evidence"]["coveredRecords"], 4)
            evidence_components = {component["key"]: component for component in measures["evidence"]["components"]}
            self.assertEqual(evidence_components["competitionResults"]["coveredRecords"], 1)
            self.assertEqual(evidence_components["geneticTests"]["coveredRecords"], 1)
            self.assertEqual(evidence_components["liveIdentifiers"]["coveredRecords"], 1)  # superseded row does not count
            self.assertEqual(evidence_components["activeAttestations"]["coveredRecords"], 1)
            # media: horses 1 and 4; horse 4 has both a photo and a document.
            self.assertEqual(measures["media"]["coveredRecords"], 2)
            media_components = {component["key"]: component for component in measures["media"]["components"]}
            self.assertEqual(media_components["photo"]["coveredRecords"], 2)
            self.assertEqual(media_components["document"]["coveredRecords"], 1)
            # activity: horses 1, 2, 3 (active) and 5 (deceased); horse 4 carries no flag.
            self.assertEqual(measures["activity"]["coveredRecords"], 4)
            activity_components = {component["key"]: component for component in measures["activity"]["components"]}
            self.assertEqual(activity_components["active"]["coveredRecords"], 3)
            self.assertEqual(activity_components["deceased"]["coveredRecords"], 1)
            self.assertEqual(activity_components["imported"]["coveredRecords"], 1)

            # Reproducible: the same fixture rebuilt with the same timestamp yields identical numbers.
            conn = sqlite3.connect(db)
            original_generated = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.SNAPSHOT_KEY,)).fetchone()[0])["generatedAt"]
            conn.close()
            snapshot.ensure_snapshot(db, if_stale=False, generated_at_override=original_generated)
            conn = sqlite3.connect(db)
            rebuilt_payload = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.SNAPSHOT_KEY,)).fetchone()[0])
            conn.close()
            self.assertEqual(rebuilt_payload["completeness"], section)

    def test_r117_21_empty_database_completeness_is_labelled_zero_not_invented(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "empty.sqlite"
            sqlite3.connect(db).close()
            schema.apply_migrations(db)
            built = snapshot.ensure_snapshot(db, if_stale=False)
            self.assertEqual(built["action"], "rebuilt")
            conn = sqlite3.connect(db)
            payload = json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (snapshot.SNAPSHOT_KEY,)).fetchone()[0])
            conn.close()
            section = payload["completeness"]
            self.assertEqual(payload["horseCount"], 0)
            for measure in section["measures"]:
                self.assertEqual(measure["totalRecords"], 0)
                self.assertEqual(measure["coveredRecords"], 0)
                self.assertEqual(measure["coveragePercent"], 0)
                self.assertTrue(measure["missingDefinition"])

    def test_reference_population_mean_kinship_fixture_is_deterministic_and_pedigree_only(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "reference.sqlite"
            sqlite3.connect(db).close()
            schema.apply_migrations(db)
            conn = sqlite3.connect(db)
            rows=[
                (1,"FOUNDER SIRE",None,None,1990,"Stallion","Arabian"),
                (2,"FOUNDER DAM",None,None,1991,"Mare","Arabian"),
            ]
            for i in range(40):
                rows.append((100+i,f"FULL SIB {i+1}",1,2,2012+(i%13),"Mare" if i%2 else "Stallion","Arabian"))
            conn.executemany("INSERT INTO horses(id,name_latin,father_id,mother_id,birth_year,sex_desc,breed_desc) VALUES(?,?,?,?,?,?,?)",rows)
            conn.commit(); conn.close()

            built=snapshot.ensure_snapshot(db,if_stale=False)
            self.assertEqual(built["action"],"rebuilt")
            conn=sqlite3.connect(db)
            payload=json.loads(conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?",(snapshot.SNAPSHOT_KEY,)).fetchone()[0])
            refs=payload["premium"]["referencePopulations"]
            self.assertEqual(len(refs),1)
            ref=refs[0]
            self.assertEqual(ref["label"],"Arabian")
            self.assertEqual(ref["populationSize"],40)
            self.assertEqual(ref["sampleSize"],32)
            # Full siblings from unrelated, non-inbred founders have pedigree kinship 0.25.
            self.assertAlmostEqual(ref["meanKinshipPercent"]["median"],25.0,places=4)
            self.assertIn("not genomic",ref["interpretation"])
            horse=conn.execute("SELECT mean_kinship_percent,diversity_preservation_index,confidence_grade FROM horse_reference_intelligence WHERE horse_id=100").fetchone()
            self.assertIsNotNone(horse)
            self.assertAlmostEqual(horse[0],25.0,places=4)
            self.assertGreaterEqual(horse[1],0)
            self.assertIn(horse[2],("high","medium","low"))
            conn.close()

            reused=snapshot.ensure_snapshot(db,if_stale=True)
            self.assertEqual(reused["action"],"reuse")


if __name__ == "__main__":
    unittest.main()
