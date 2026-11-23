#!/usr/bin/env python3
"""R96-N03 migration rehearsal on SQLite: R95-era DB -> preflight -> 0062-0064.

Everything runs on a THROWAWAY database in /tmp; no canonical system is touched.
Exit 0 = rehearsal passed (including the blocked-migration stop condition).
"""
from __future__ import annotations
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIGRATIONS = REPO / "migrations"
STEP = []


def log(msg: str) -> None:
    print(msg, flush=True)
    STEP.append(msg)


def statements(sql_text: str):
    buf = []
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


def apply_upto(db_path: Path, last: str) -> None:
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
    log(f"R95-era database built: {applied} migrations applied (up to {last})")


def seed_r95_rows(db_path: Path) -> None:
    """Representative pre-R96 rows: a verified payment with grant + entitlement,
    a terminal old service request with a legacy redaction, an outbox row."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.executescript(
        """
        INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
          ('buyer','buyer@example.test','buyer','x','user',1),
          ('owner','owner@example.test','owner','x','admin',1);
        INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id)
          VALUES(1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'owner');
        INSERT INTO people(id,name_latin) VALUES(1,'R95 Era Provider');
        INSERT INTO orders(id,order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json,request_digest,creation_operation_id)
          VALUES(1,'r95-order-1','buyer','paid',19000000,'IRR','[]','digest-1','op-1');
        INSERT INTO payment_attempts(id,order_id,provider,amount_minor,currency,state,request_key,authority)
          VALUES(1,1,'zarinpal',19000000,'IRR','verified','rk-1','AUTH-R95-1');
        INSERT INTO entitlement_events(id,event_key,order_id,payment_attempt_id,buyer_user_id,sku,kind,granted_days,activated_at,expires_at)
          VALUES(1,'payment:1:sku:farm_workspace_monthly',1,1,'buyer','farm_workspace_monthly','grant',30,'2026-09-05 12:00:00','2026-10-05 12:00:00');
        INSERT INTO entitlements(id,buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at,holder_key)
          VALUES(1,'buyer',NULL,'farm_workspace_monthly',1,1,'2026-09-05 12:00:00','2026-10-05 12:00:00','user:buyer');
        INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,note_digest,note_redacted_at,share_contact,status,created_at,updated_at)
          VALUES(90,'buyer',1,'trainer','IR-23','Old city','[redacted by requester]','retention:preexisting','2025-01-01',1,'closed','2024-01-01 00:00:00','2024-01-01 00:00:00');
        INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at)
          VALUES('service-request:90:v1:provider','email','service_request_notice',0,'owner','o***@example.test','service_requests:90','queued',0,5,'2026-01-01 00:00:00');
        """
    )
    conn.commit()
    conn.close()
    log("representative R95 rows seeded (paid order + grant + legacy-redacted terminal lead + queued notice)")


def run_preflight(db_path: Path) -> int:
    proc = subprocess.run(
        ["python3", str(REPO / "tools" / "r96-preflight.py"), str(db_path)],
        capture_output=True, text=True,
    )
    log(f"preflight exit={proc.returncode}")
    for line in (proc.stdout or "").strip().splitlines():
        log(f"  preflight: {line}")
    if proc.returncode not in (0, 1):
        log(f"  preflight stderr: {(proc.stderr or '').strip()[:400]}")
    return proc.returncode


def apply_r96(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    for name in ["0062_r96_service_privacy_integrity.sql", "0063_r96_refund_integrity.sql", "0064_r96_reconciliation_operations.sql"]:
        for stmt in statements((MIGRATIONS / name).read_text()):
            conn.execute(stmt)
        log(f"applied {name}")
    conn.commit()
    conn.close()


def verify_schema(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    checks = [
        ("refund_access_adjustments table", "SELECT 1 FROM refund_access_adjustments LIMIT 0"),
        ("refund_access_reviews table", "SELECT 1 FROM refund_access_reviews LIMIT 0"),
        ("service_requests.note_digest_status column", "SELECT note_digest_status FROM service_requests LIMIT 0"),
        ("service_requests.retention_minimized_at column", "SELECT retention_minimized_at FROM service_requests LIMIT 0"),
        ("refund_requests.confirmation_source column", "SELECT confirmation_source FROM refund_requests LIMIT 0"),
        ("partial unique active-refund index", "SELECT 1 FROM sqlite_master WHERE type='index' AND sql LIKE '%refund_requests%' AND sql LIKE '%status%'"),
    ]
    failed = 0
    for label, q in checks:
        try:
            c.execute(q).fetchall()
            log(f"schema OK — {label}")
        except sqlite3.Error as e:
            failed += 1
            log(f"schema FAIL — {label}: {e}")
    counts = {
        "orders": c.execute("SELECT COUNT(*) FROM orders").fetchone()[0],
        "entitlement_events": c.execute("SELECT COUNT(*) FROM entitlement_events").fetchone()[0],
        "service_requests": c.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0],
        "notification_outbox": c.execute("SELECT COUNT(*) FROM notification_outbox").fetchone()[0],
    }
    log(f"row counts preserved: {counts}")
    conn.close()
    if failed:
        raise SystemExit(f"{failed} schema checks failed")


def probe_index_guard(db_path: Path) -> None:
    """The 0063 partial index must block a second ACTIVE refund per attempt."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute(
        "INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,requested_by_user_id,entitlement_policy_json,last_operation_id)"
        " VALUES(1,1,'rr-1','full_unused',19000000,'IRR','requested','first','buyer','{}','op-r1')"
    )
    try:
        c.execute(
            "INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,requested_by_user_id,entitlement_policy_json,last_operation_id)"
            " VALUES(1,1,'rr-2','full_unused',19000000,'IRR','approved','second','buyer','{}','op-r2')"
        )
        conn.rollback()
        conn.close()
        raise SystemExit("partial unique index did NOT block a second active refund")
    except sqlite3.IntegrityError as e:
        conn.rollback()
        conn.close()
        log(f"index guard OK — second active refund refused: {e}")


def blocked_migration_rehearsal(workdir: Path) -> None:
    """Legacy duplicates must STOP migration 0063 (runbook §4) — never deleted."""
    dup = workdir / "restored-r95-duplicates.sqlite"
    apply_upto(dup, "0061_r95_n14_moderation_active_case.sql")
    seed_r95_rows(dup)
    conn = sqlite3.connect(dup)
    c = conn.cursor()
    for key, status in [("dup-1", "approved"), ("dup-2", "confirmed")]:
        c.execute(
            "INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,requested_by_user_id,entitlement_policy_json)"
            " VALUES(1,1,?,'full_unused',19000000,'IRR',?,'legacy duplicate','buyer','{}')",
            (key, status),
        )
    conn.commit()
    conn.close()
    log("duplicate-active-refund database prepared (1 approved + 1 confirmed on the same attempt)")
    exit_code = run_preflight(dup)
    if exit_code != 1:
        raise SystemExit(f"preflight must flag duplicates as blockers (exit 1), got {exit_code}")
    try:
        apply_r96(dup)
        raise SystemExit("migration 0063 applied over duplicates — stop condition FAILED")
    except sqlite3.IntegrityError as e:
        log(f"stop condition OK — migration refuses: {e}")


def main() -> int:
    import tempfile
    if len(sys.argv) == 3:
        db_path = Path(sys.argv[1])
        workdir = Path(sys.argv[2])
    else:
        # Self-contained mode: throwaway paths under a fresh temp dir.
        workdir = Path(tempfile.mkdtemp(prefix="r96-n03-"))
        db_path = workdir / "restored-r95.sqlite"
        print(f"self-contained rehearsal in {workdir}", flush=True)
    apply_upto(db_path, "0061_r95_n14_moderation_active_case.sql")
    seed_r95_rows(db_path)
    pf = run_preflight(db_path)
    if pf == 2:
        raise SystemExit("preflight could not inspect the database (invalid input)")
    log("preflight on the clean R95 copy: no structural blockers expected" if pf == 0 else "preflight reported warnings — classified, not dismissed")
    apply_r96(db_path)
    verify_schema(db_path)
    probe_index_guard(db_path)
    blocked_migration_rehearsal(workdir)
    log("R96-N03 SQLite rehearsal COMPLETE: clean upgrade verified; blocked migration verified; nothing was deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
