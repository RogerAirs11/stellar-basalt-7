#!/usr/bin/env python3
"""R98-N03: rehearse migrations 0070-0072 on a restored legacy target.

Follows the R97-N03 rehearsal pattern: a SYNTHETIC R97-era legacy target
(migrations <= 0069) seeded with every R98 adjudication class from the
migration runbook, baseline evidence fingerprints, read-only preflight
blockers, evidence-based adjudication (never guessing), the additive upgrade,
and byte-preservation verification — twice, independently.

No live data, no production system, no private payloads in any log line.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIGRATIONS = REPO / "migrations"
SCHEME = "iso3166-2-ir:2020-11-24"
STEP: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)
    STEP.append(msg)


def statements(sql_text: str):
    buf: list[str] = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            continue
        buf.append(line)
        if stripped.endswith(";"):
            yield "\n".join(buf)
            buf = []
    if buf:
        yield "\n".join(buf)


def apply_upto(db_path: Path, last: str) -> int:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    names = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    applied = 0
    for name in names:
        if name > last:
            break
        for stmt in statements((MIGRATIONS / name).read_text()):
            conn.execute(stmt)
        applied += 1
    conn.commit()
    conn.close()
    return applied


def file_hash(db_path: Path) -> str:
    return hashlib.sha256(db_path.read_bytes()).hexdigest()


EVIDENCE_TABLES = [
    ("directory_profiles", "id"), ("person_credentials", "id"), ("attestations", "id"),
    ("issuer_memberships", "id"), ("attestation_events", "id"), ("service_requests", "id"),
    ("service_request_holds", "id"), ("audit_events", "id"),
]


def evidence_fingerprint(db_path: Path, columns: dict | None = None, blank: set[str] | None = None) -> dict:
    """Per-row evidence hashes over the BASELINE column list: a later ADDITIVE
    migration must never change the evidence bytes of existing columns.
    `blank` normalizes volatile auto-timestamp columns (used ONLY for the
    cross-restoration determinism comparison — same data, different wall clock)."""
    conn = sqlite3.connect(db_path)
    out = {}
    for table, order in EVIDENCE_TABLES:
        try:
            cols = columns[table] if columns and table in columns else [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
        except sqlite3.Error:
            out[table] = {"rows": 0, "sha256": "absent", "columns": 0}
            continue
        col_sql = ",".join(f'"{c}"' for c in cols)
        rows = conn.execute(f"SELECT {col_sql} FROM {table} ORDER BY {order}").fetchall()
        if blank:
            volatile = [i for i, c in enumerate(cols) if c in blank]
            if volatile:
                rows = [tuple("<ts>" if i in volatile else v for i, v in enumerate(row)) for row in rows]
        digest = hashlib.sha256(repr(rows).encode()).hexdigest()
        out[table] = {"rows": len(rows), "sha256": digest, "columns": len(cols)}
    conn.close()
    return out


def run_preflight(db_path: Path, strict: bool = False) -> dict:
    cmd = ["python3", str(REPO / "tools" / "r98-preflight.py"), "--db", str(db_path)]
    if strict:
        cmd.append("--strict")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    payload = json.loads(proc.stdout) if proc.stdout.strip().startswith("{") else {"ok": False, "raw": proc.stdout}
    log(f"preflight{' (strict)' if strict else ''} exit={proc.returncode} blockers={payload.get('blockers')} reviews={payload.get('reviews')}")
    return {"exit": proc.returncode, "payload": payload}


def seed_legacy(conn: sqlite3.Connection) -> None:
    """Every R98 adjudication class from the migration runbook."""
    conn.executescript(
        """
        INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
          ('admin','admin@example.test','Admin','x','admin',1),
          ('issuer-owner','issuer.owner@example.test','Issuer Owner','x','user',1),
          ('rep','rep@example.test','Representative','x','user',1),
          ('claimer','claimer@example.test','Claimer','x','user',1),
          ('requester','requester@example.test','Requester','x','user',1);
        INSERT INTO people(id,name_latin) VALUES (1,'Legacy Person'),(2,'Legacy Second Person'),(41,'Legacy Provider');
        INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES ('rep',1,'verified','2026-01-01 00:00:00');
        INSERT INTO organizations(id,slug,name_latin,status) VALUES (7,'legacy-stable','Legacy Stable','active');
        INSERT INTO horses(id,name_latin) VALUES (10,'Legacy Horse');

        -- [preservation control] settled directory profile (byte-preserved evidence)
        INSERT INTO directory_profiles(person_id,service_categories,province_code,city,contact_preference,contact_value,publication_consent,published_at,created_by_user_id)
          VALUES (1,'["farrier"]','IR-08','Arak','email','settled@example.test',1,'2026-06-01 10:00:00','rep');
        -- [adjudication: corrupt publication] the R97 binding bug stored a USER ID
        -- in published_at while created_by_user_id became NULL (11 placeholders / 10 binds)
        INSERT INTO directory_profiles(person_id,service_categories,province_code,city,contact_preference,contact_value,publication_consent,published_at,created_by_user_id)
          VALUES (2,'["trainer"]','IR-32','Tehran','platform_message',NULL,1,'rep','--corrupt--');
        UPDATE directory_profiles SET created_by_user_id=NULL WHERE person_id=2;
        -- [adjudication: legacy province] a third profile with a legacy code (stays unconfirmed)
        INSERT INTO directory_profiles(person_id,service_categories,province_code,city,contact_preference,contact_value,publication_consent,published_at,created_by_user_id)
          VALUES (41,'["veterinarian"]','IR-32','Karaj','email','provider@example.test',1,'2026-06-02 10:00:00','rep');
        INSERT INTO organization_profiles(organization_id,description,province_code,city,contact_preference,publication_consent,published_at,created_by_user_id)
          VALUES (7,'Legacy stable profile','08','Saveh','email',1,'2026-06-03 10:00:00','rep');

        -- [preservation control] settled credential + [adjudication: invalid dates /
        -- legacy issuer_attested authority]
        INSERT INTO person_credentials(person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state)
          VALUES (1,'farrier','Legacy Federation','F-100','2020-01-01','2025-01-01','platform_reviewed'),
                 (1,'judge','Legacy Federation','J-200','2026-02-30',NULL,'issuer_attested'),
                 (1,'trainer','Legacy Federation','T-300',NULL,NULL,'unverified');

        -- [adjudication: mixed-target claim] (person claim with an organization id)
        INSERT INTO directory_claims(id,user_id,claim_type,person_id,organization_id,evidence_note,status)
          VALUES (90,'claimer','person',1,7,'legacy mixed target claim','pending');

        INSERT INTO issuers(id,slug,name,kind,status,created_by_user_id) VALUES
          ('legacy-issuer-1','legacy-fed','Legacy Federation','federation','active','admin');
        -- [adjudication: DUPLICATE ACTIVE memberships] (the 0071 blocker)
        INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,valid_until,created_at) VALUES
          ('m-old','legacy-issuer-1','issuer-owner','owner','active','2026-01-01 00:00:00',NULL,'2026-01-01 00:00:00'),
          ('m-new','legacy-issuer-1','issuer-owner','owner','active','2026-03-01 00:00:00',NULL,'2026-03-01 00:00:00');
        -- [adjudication: invalid membership dates + inconsistent revocation]
        INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,valid_until,revoked_at,revoked_reason,created_at) VALUES
          ('m-bad-dates','legacy-issuer-1','claimer','attester','active','2026-02-30 00:00:00','2026-01-01 00:00:00',NULL,NULL,'2026-04-01 00:00:00'),
          ('m-inconsistent','legacy-issuer-1','rep','attester','active','2026-01-01 00:00:00',NULL,'2026-05-01 00:00:00','legacy partial revoke','2026-01-05 00:00:00');
        -- [preservation control] a properly revoked historical membership
        INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,valid_until,revoked_at,revoked_reason,created_at) VALUES
          ('m-revoked','legacy-issuer-1','claimer','attester','revoked','2026-01-01 00:00:00',NULL,'2026-02-01 00:00:00','clean historical revocation','2026-01-02 00:00:00');

        -- [preservation control] settled attestation + [adjudication: invalid
        -- issued_at / active without source_version]
        INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,statement,source_version,issued_at,status,attested_by_user_id) VALUES
          ('a-settled','legacy-issuer-1',10,'genetic_test','1','settled statement','legacy-v1','2026-05-01 10:00:00','active','issuer-owner'),
          ('a-bad-date','legacy-issuer-1',10,'genetic_test','2',NULL,NULL,'2026-02-30 10:00:00','active','issuer-owner'),
          ('a-unbound','legacy-issuer-1',10,'media','m-1',NULL,NULL,'2026-06-01 10:00:00','active','issuer-owner');
        INSERT INTO attestation_events(id,attestation_id,event,actor_user_id,reason) VALUES
          ('e-1','a-settled','issued','issuer-owner',NULL);

        -- [preservation control] a released historical hold (unknown release
        -- operation identity, retained by 0072)
        INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version,created_at,updated_at,closed_at)
          VALUES (201,'requester',41,'farrier','08','Saveh','Legacy private note text',1,'closed',1,'2025-11-01 00:00:00','2025-12-01 00:00:00','2025-12-01 00:00:00');
        INSERT INTO service_request_holds(service_request_id,hold_kind,reason,created_by_user_id,operation_id,created_at,released_at,released_by_user_id,release_reason)
          VALUES (201,'dispute','legacy dispute long since resolved','admin','legacy-op-hold-201','2025-12-05 00:00:00','2026-01-05 00:00:00','admin','legacy release without operation identity');

        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json) VALUES
          ('admin','legacy.event','legacy_entity','1','null','{}');
        """
    )
    conn.commit()


ADJUDICATIONS = [
    "duplicate-active-membership: keep m-old (first grant), explicitly revoke m-new with reason+actor (issuer decision recorded)",
    "invalid-membership-dates: revoke m-bad-dates — authority is never granted from malformed dates",
    "inconsistent-revocation: reconcile m-inconsistent to status='revoked' (evidence preserved)",
    "corrupt-publication: withdraw publication consent for person 2 (consent=0, published_at=NULL) — consent never inferred from a malformed field",
    "unknown-creator: person 2 creator stays explicitly NULL/unknown (documented disposition; no attribution without evidence)",
    "legacy-provinces: person 41 province reconfirmed by the subject with the explicit R98 scheme; person 1 + org 7 + request 201 stay legacy_r97_unconfirmed",
    "credential-invalid-dates: J-200 stays recorded with invalid dates (no valid badge; public projection pins invalid_dates)",
    "credential-legacy-authority: issuer_attested label stays recorded but projects unverified pending issuer-bound workflow",
    "mixed-target-claim: claim 90 stays pending — never approvable with two targets",
    "attestation-invalid-dates: a-bad-date revoked by the issuer (event appended; issuance history not edited)",
    "attestation-unbound: a-unbound stays active as historical metadata — restricted claim, no whole-record guarantee",
]


def adjudicate(conn: sqlite3.Connection) -> None:
    """Evidence-based dispositions ONLY. Every change preserves its original
    row and records actor + reason. Nothing is deleted; nothing is guessed."""
    conn.executescript(
        """
        -- Duplicate active memberships: the issuer owner decided the FIRST
        -- grant (m-old) is authoritative; m-new is explicitly revoked.
        UPDATE issuer_memberships SET status='revoked', revoked_at='2026-10-05 12:00:00',
          revoked_reason='duplicate active membership adjudicated pre-0071: first grant m-old is authoritative'
          WHERE id='m-new';
        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json) VALUES
          ('admin','issuer.membership.adjudicated','issuer_membership','m-new','{"status":"active"}','{"status":"revoked","reason":"duplicate active membership"}');

        -- Malformed interval: never a source of authority.
        UPDATE issuer_memberships SET status='revoked', revoked_at='2026-10-05 12:00:00',
          revoked_reason='invalid interval (valid_until precedes valid_from; malformed valid_from) — authority denied'
          WHERE id='m-bad-dates';
        -- Inconsistent revocation: status reconciled to the recorded evidence.
        UPDATE issuer_memberships SET status='revoked'
          WHERE id='m-inconsistent' AND revoked_at IS NOT NULL;

        -- Corrupt publication: consent withdrawn, publication date cleared.
        -- The malformed bytes are NOT reinterpreted as a timestamp.
        UPDATE directory_profiles SET publication_consent=0, published_at=NULL
          WHERE person_id=2 AND published_at='rep';

        -- Province reconfirmation by the subject (person 41): explicit scheme
        -- recorded via the audited operator edit BEFORE the migration backfill.
        UPDATE directory_profiles SET province_code='IR-30'
          WHERE person_id=41 AND province_code='IR-32';

        -- Invalid-dated attestation revoked by its issuer (event appended).
        UPDATE attestations SET status='revoked', revoked_at='2026-10-05 12:00:00',
          revoked_reason='impossible calendar date in issued_at — revoked by the issuer'
          WHERE id='a-bad-date';
        INSERT INTO attestation_events(id,attestation_id,event,actor_user_id,reason) VALUES
          ('e-2','a-bad-date','revoked','issuer-owner','impossible calendar date in issued_at');
        """
    )
    conn.commit()


def verify_upgrade(db_path: Path, baseline_columns: dict, baseline: dict) -> list[str]:
    problems: list[str] = []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    def columns(table: str) -> set:
        return {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}

    # New columns with defaults.
    for table, expected in [
        ("directory_profiles", ["row_version", "last_operation_id", "province_code_scheme"]),
        ("organization_profiles", ["province_code_scheme"]),
        ("directory_claims", ["row_version", "last_operation_id"]),
        ("person_credentials", ["row_version", "last_operation_id", "created_by_user_id", "revoked_at", "revoked_by_user_id", "revoke_reason"]),
        ("attestations", ["row_version", "last_operation_id"]),
        ("service_requests", ["province_code_scheme"]),
        ("service_request_holds", ["release_operation_id"]),
    ]:
        missing = [c for c in expected if c not in columns(table)]
        if missing:
            problems.append(f"{table}: missing columns {missing}")

    # Defaults applied to legacy rows.
    row = conn.execute("SELECT province_code_scheme FROM directory_profiles WHERE person_id=1").fetchone()
    if row[0] != "legacy_r97_unconfirmed":
        problems.append(f"legacy profile scheme = {row[0]!r}, expected legacy_r97_unconfirmed")
    row = conn.execute("SELECT row_version FROM directory_claims WHERE id=90").fetchone()
    if row[0] != 1:
        problems.append(f"legacy claim row_version = {row[0]!r}, expected 1")

    # Unique index present and enforced: a duplicate active membership is now impossible.
    indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    if "issuer_one_active_membership" not in indexes:
        problems.append("issuer_one_active_membership index missing")
    try:
        conn.execute("INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,created_at) VALUES ('m-dup','legacy-issuer-1','issuer-owner','owner','active','2026-10-01 00:00:00','2026-10-01 00:00:00')")
        conn.commit()
        problems.append("duplicate active membership INSERT was accepted (unique index not enforced)")
    except sqlite3.IntegrityError:
        conn.rollback()

    # Operation receipts table exists.
    if "issuer_management_operations" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        problems.append("issuer_management_operations table missing")

    # Hold-release operation identity is additive: historical NULL retained.
    row = conn.execute("SELECT release_operation_id FROM service_request_holds WHERE service_request_id=201").fetchone()
    if row[0] is not None:
        problems.append("historical release_operation_id was fabricated")

    # Integrity + foreign keys.
    if [r[0] for r in conn.execute("PRAGMA integrity_check")] != ["ok"]:
        problems.append("integrity_check failed")
    fk = [f"{r[0]}:{r[1]}" for r in conn.execute("PRAGMA foreign_key_check")]
    if fk:
        problems.append(f"foreign_key_check violations: {fk[:5]}")

    # Evidence byte-preservation over the baseline columns.
    after = evidence_fingerprint(db_path, baseline_columns)
    for table, before_value in baseline.items():
        if table not in after:
            problems.append(f"evidence table {table} vanished")
        elif after[table]["sha256"] != before_value["sha256"]:
            problems.append(f"evidence bytes CHANGED for {table} (baseline columns only)")
    conn.close()
    return problems


def one_rehearsal(label: str) -> dict:
    log(f"=== {label}: independent restoration ===")
    with tempfile.TemporaryDirectory(prefix="r98n03-") as tmp:
        # Phase 0 — the full chain (72 migrations) applies on the empty fixture.
        empty = Path(tmp) / "empty.sqlite"
        applied = apply_upto(empty, "9999")
        log(f"phase 0: empty fixture — {applied} migrations applied cleanly (0070-0072 included)")
        assert applied == 72, f"expected 72 migrations, applied {applied}"

        # Phase 1 — legacy R97 target (migrations <= 0069) + all adjudication classes.
        db_path = Path(tmp) / "restored-legacy.sqlite"
        applied = apply_upto(db_path, "0069_r97_directory_integrity.sql")
        log(f"phase 1: legacy R97 target built — {applied} migrations (no 0070-0072)")
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        seed_legacy(conn)
        conn.close()
        log("phase 1: legacy rows seeded — 11 adjudication classes + preservation controls")

        # Phase 2 — baseline (the 'approved backup' provenance).
        baseline_hash = file_hash(db_path)
        baseline_columns = {
            table: [r[1] for r in sqlite3.connect(db_path).execute(f'PRAGMA table_info("{table}")')]
            for table, _ in EVIDENCE_TABLES
        }
        baseline = evidence_fingerprint(db_path, baseline_columns)
        log("phase 2: baseline recorded (file sha256 " + baseline_hash[:16] + "..., "
            + ", ".join(f"{t}={v['rows']}" for t, v in baseline.items()) + ")")

        # Phase 3 — read-only preflight: the 0071 blocker MUST stop the show.
        pre1 = run_preflight(db_path)
        blocker_rules = [r for r in pre1["payload"].get("rules", []) if r["severity"] == "blocker" and r["count"]]
        review_rules = [r["id"] for r in pre1["payload"].get("rules", []) if r["severity"] == "review" and r["count"]]
        assert pre1["exit"] == 1 and blocker_rules, "preflight must report the duplicate-active-membership blocker"
        assert any(r["id"] == "issuer.duplicate_active" for r in blocker_rules), "expected issuer.duplicate_active blocker"
        expected_reviews = {
            "issuer.invalid_dates", "issuer.inconsistent_revocation", "directory.corrupt_publication",
            "directory.unknown_creator", "directory_profiles.location_unconfirmed",
            "organization_profiles.location_unconfirmed", "service_requests.location_unconfirmed",
            "credentials.invalid_dates", "credentials.unbound_authority", "claims.invalid_target",
            "attestations.invalid_dates", "attestations.no_source_version",
        }
        missing_reviews = expected_reviews - set(review_rules)
        assert not missing_reviews, f"preflight missed adjudication classes: {missing_reviews}"
        log(f"phase 3: preflight blockers present ({[r['id'] for r in blocker_rules]}) + {len(review_rules)} review classes")

        # 0071 MUST fail before adjudication (the designed stop condition).
        conn = sqlite3.connect(db_path)
        try:
            for stmt in statements((MIGRATIONS / "0071_r98_issuer_integrity.sql").read_text()):
                conn.execute(stmt)
            conn.commit()
            raise AssertionError("0071 applied WITHOUT adjudication — the unique index did not stop the duplicates")
        except sqlite3.IntegrityError:
            conn.rollback()
            log("phase 3: 0071 correctly REFUSED to apply before adjudication (unique index stop condition)")
        conn.close()

        # Phase 4 — evidence-based adjudication (documented dispositions).
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        adjudicate(conn)
        conn.close()
        for note in ADJUDICATIONS:
            log(f"phase 4: {note}")

        # Phase 4b — the UPGRADE baseline: byte-preservation is asserted across
        # the migration application only (the adjudication above is the set of
        # documented, evidence-based dispositions — those changes are the
        # reconciliation itself, not migration drift).
        upgrade_columns = {
            table: [r[1] for r in sqlite3.connect(db_path).execute(f'PRAGMA table_info("{table}")')]
            for table, _ in EVIDENCE_TABLES
        }
        upgrade_baseline = evidence_fingerprint(db_path, upgrade_columns)
        log("phase 4b: upgrade baseline recorded ("
            + ", ".join(f"{t}={v['rows']}" for t, v in upgrade_baseline.items()) + ")")

        # Phase 5 — preflight after adjudication: no blockers.
        pre2 = run_preflight(db_path)
        assert pre2["exit"] == 0, f"preflight must be blocker-free after adjudication (exit {pre2['exit']})"
        log("phase 5: preflight blocker-free (documented review dispositions remain visible)")

        # Phase 6 — apply 0070-0072 through the ledger, once, in order.
        # (Ledger semantics: each migration applies exactly once. The raw
        # ALTER TABLE statements are deliberately NOT replay-safe — the
        # runbook pins idempotency to the IF NOT EXISTS objects only, and the
        # supported local schema initializer below is the replay proof.)
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        for name in ["0070_r98_directory_integrity.sql", "0071_r98_issuer_integrity.sql", "0072_r98_retention_integrity.sql"]:
            for stmt in statements((MIGRATIONS / name).read_text()):
                conn.execute(stmt)
            conn.commit()
            log(f"phase 6: {name} applied (once, ledger-controlled)")
        # The raw ALTERs must refuse a second raw application (ledger is the
        # only supported path — this refusal is the designed behavior).
        try:
            for stmt in statements((MIGRATIONS / "0070_r98_directory_integrity.sql").read_text()):
                conn.execute(stmt)
            raise AssertionError("raw re-application of 0070 ALTERs was accepted (outside the ledger)")
        except sqlite3.OperationalError:
            conn.rollback()
            log("phase 6: raw re-application of 0070 correctly REFUSED (ledger-only, as documented)")
        conn.close()

        # Phase 6b — the supported local schema initializer runs twice cleanly.
        for attempt in (1, 2):
            fresh = Path(tmp) / f"initializer-{attempt}.sqlite"
            applied = apply_upto(fresh, "9999")
            assert applied == 72
        log("phase 6b: full local schema initializer ran twice (72 migrations, replay safe)")

        # Phase 7 — verification.
        problems = verify_upgrade(db_path, upgrade_columns, upgrade_baseline)
        if problems:
            for problem in problems:
                log(f"phase 7 FAIL: {problem}")
            raise AssertionError(f"{label}: {len(problems)} verification problems")
        log(f"phase 7: verification clean — columns/defaults, unique index enforced, receipts table, "
            f"additive hold identity, integrity+FK, evidence bytes preserved")
        # Determinism comparison: identical data modulo wall-clock defaults.
        determinism_fp = evidence_fingerprint(db_path, upgrade_columns, blank={"created_at", "updated_at"})
        return {"label": label, "baseline_sha256": baseline_hash, "fingerprint": upgrade_baseline,
                "determinism_fingerprint": determinism_fp,
                "preflight_before": {"exit": pre1["exit"], "blockers": pre1["payload"]["blockers"], "reviews": pre1["payload"]["reviews"]},
                "preflight_after": {"exit": pre2["exit"], "blockers": pre2["payload"]["blockers"], "reviews": pre2["payload"]["reviews"]}}


def main() -> int:
    started = time.monotonic()
    first = one_rehearsal("restoration-1")
    second = one_rehearsal("restoration-2")
    deterministic = first["determinism_fingerprint"] == second["determinism_fingerprint"]
    report = {
        "harness": "r98-n03-rehearse", "schema": "horse-registry-r98-n03/v1",
        "deterministic": deterministic,
        "restorations": [first, second],
        "adjudications": ADJUDICATIONS,
        "steps": STEP,
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "scope": "Synthetic legacy-target rehearsal only; no live data, no production system.",
    }
    out = REPO / "audit/r98/evidence-integration/n03-rehearsal.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    log(f"report written: {out}")
    log(f"deterministic across restorations: {deterministic}")
    ok = deterministic and first["preflight_after"]["exit"] == 0 and second["preflight_after"]["exit"] == 0
    print(f"\nr98-n03-rehearse: {'PASS' if ok else 'FAIL'} (elapsed {report['elapsed_seconds']}s)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
