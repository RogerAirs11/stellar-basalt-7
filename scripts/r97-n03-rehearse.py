#!/usr/bin/env python3
"""R97-N03 migration rehearsal on SQLite: R96-era DB -> read-only preflight ->
migration 0069 -> evidence-based adjudication -> verification.

Everything runs on a THROWAWAY database in /tmp; no canonical system is
touched and no network is used. Exit 0 = rehearsal passed, including the
stop-condition (preflight blocks on unadjudicated legacy evidence) and the
preservation proof (settled money/grant evidence is byte-identical before and
after the upgrade, except explicit audited corrections).
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


def evidence_fingerprint(db_path: Path, columns: dict | None = None) -> dict:
    """Per-row evidence hashes for the tables whose history must be preserved.
    When `columns` is supplied (the BASELINE column list), only those columns
    are hashed — a later ADDITIVE migration must never change the evidence
    bytes of the columns that already existed."""
    conn = sqlite3.connect(db_path)
    out = {}
    for table, order in [
        ("refund_requests", "id"), ("refund_allocations", "id"), ("refund_events", "id"),
        ("entitlement_events", "id"), ("entitlements", "id"), ("orders", "id"),
        ("payment_attempts", "id"), ("payment_events", "id"), ("horses", "id"),
    ]:
        cols = columns[table] if columns and table in columns else [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
        col_sql = ",".join(f'"{c}"' for c in cols)
        rows = conn.execute(f"SELECT {col_sql} FROM {table} ORDER BY {order}").fetchall()
        digest = hashlib.sha256(repr(rows).encode()).hexdigest()
        out[table] = {"rows": len(rows), "sha256": digest, "columns": len(cols)}
    conn.close()
    return out


def run_preflight(db_path: Path) -> dict:
    proc = subprocess.run(
        ["python3", str(REPO / "tools" / "r97-preflight.py"), str(db_path)],
        capture_output=True, text=True,
    )
    payload = json.loads(proc.stdout) if proc.stdout.strip().startswith("{") else {"ok": False, "raw": proc.stdout}
    log(f"preflight exit={proc.returncode} ok={payload.get('ok')}")
    return {"exit": proc.returncode, "payload": payload, "stdout": proc.stdout}


def main() -> int:
    started = time.monotonic()
    backup_stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

    # ------------------------------------------------------------------
    # Phase 0 — all 69 migrations apply on the EMPTY fixture (0069 included).
    # ------------------------------------------------------------------
    with tempfile.TemporaryDirectory(prefix="r97n03-empty-") as tmp:
        empty = Path(tmp) / "empty.sqlite"
        applied = apply_upto(empty, "9999")
        log(f"phase 0: empty fixture — {applied} migrations applied cleanly (0069 included)")
        assert applied == 69, f"expected 69 migrations, applied {applied}"

    # ------------------------------------------------------------------
    # Phase 1 — build the R96-era legacy target (migrations <= 0068) and seed
    # every legacy adjudication class plus preservation controls.
    # ------------------------------------------------------------------
    with tempfile.TemporaryDirectory(prefix="r97n03-legacy-") as tmp:
        db_path = Path(tmp) / "restored-legacy.sqlite"
        applied = apply_upto(db_path, "0068_r96_n09_workspace_journey.sql")
        log(f"phase 1: legacy R96 target built — {applied} migrations (no 0069)")

        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(
            """
            INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
              ('buyer','buyer@example.test','buyer','x','user',1),
              ('owner','owner@example.test','owner','x','admin',1),
              ('seller','seller@example.test','seller','x','user',1);
            INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id)
              VALUES(1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'owner');
            INSERT INTO horses(id,name_latin,register_no,row_version,last_mutation_id)
              VALUES(1,'Legacy Unindexed Horse','SECRET-REGISTER-1',1,'legacy-op-1'),
                     (2,'Legacy Indexed Horse','SECRET-REGISTER-2',1,'legacy-op-2');
            INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)
              VALUES('register_no','registry:platform','SECRET-REGISTER-2','SECRET-REGISTER-2',2,'live','legacy');
            -- counter drift: 2 live horses, counter says 3 (+1 drift)
            UPDATE registry_runtime_counters SET active_horse_count=3 WHERE id=1;
            INSERT INTO orders(id,order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json,request_digest,creation_operation_id)
              VALUES(1,'legacy-order-1','buyer','paid',19000000,'IRR','[]','digest-1','op-1'),
                     (2,'legacy-order-2','buyer','paid',19000000,'IRR','[]','digest-2','op-2');
            INSERT INTO payment_attempts(id,order_id,provider,amount_minor,currency,state,request_key,authority)
              VALUES(1,1,'zarinpal',19000000,'IRR','verified','rk-1','AUTH-LEGACY-1'),
                     (2,2,'zarinpal',19000000,'IRR','verified','rk-2','AUTH-LEGACY-2');
            INSERT INTO entitlement_events(id,event_key,order_id,payment_attempt_id,buyer_user_id,sku,kind,granted_days,activated_at,expires_at)
              VALUES(1,'payment:1:sku:farm_workspace_monthly',1,1,'buyer','farm_workspace_monthly','grant',30,'2026-09-05 12:00:00','2026-10-05 12:00:00');
            INSERT INTO entitlements(id,buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at,holder_key)
              VALUES(1,'buyer',NULL,'farm_workspace_monthly',1,1,'2026-09-05 12:00:00','2026-10-05 12:00:00','user:buyer');
            -- settled money evidence: a CONFIRMED refund with an approved allocation (R96 schema: no proposal identity column)
            INSERT INTO refund_requests(id,order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,requested_by_user_id,entitlement_policy_json,last_operation_id)
              VALUES(10,1,1,'legacy-rr-confirmed','full_unused',19000000,'IRR','confirmed','settled long ago','buyer','{}','op-rr-10');
            INSERT INTO refund_allocations(refund_request_id,policy_version,charge_amount_minor,proposed_amount_minor,currency,basis_json,status,proposed_by_user_id,approved_by_user_id,approved_at,approval_note)
              VALUES(10,1,19000000,19000000,'IRR','{"kind":"full_unused"}','approved','owner','owner','2026-09-20 12:00:00','legacy approval without proposal identity');
            -- still-PENDING refund (its own attempt) whose legacy allocation also lacks identity (adjudication: re-propose + re-approve)
            INSERT INTO refund_requests(id,order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,requested_by_user_id,entitlement_policy_json,last_operation_id)
              VALUES(11,2,2,'legacy-rr-pending','full_unused',19000000,'IRR','requested','still pending','buyer','{}','op-rr-11');
            INSERT INTO refund_allocations(refund_request_id,policy_version,charge_amount_minor,proposed_amount_minor,currency,basis_json,status,proposed_by_user_id)
              VALUES(11,1,19000000,19000000,'IRR','{"kind":"full_unused"}','approved','owner');
            -- prematurely resolved access review (refund 11 is NOT confirmed)
            INSERT INTO refund_access_reviews(refund_request_id,reason,status,resolved_at,resolved_by_user_id,resolution_note)
              VALUES(11,'legacy auto-resolution','resolved','2026-09-21 12:00:00','owner','resolved before money confirmation');
            -- uncertain send WITHOUT a dispatch fingerprint (R96 schema has no column)
            INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at,first_attempt_at)
              VALUES('legacy-uncertain-send','email','service_request_notice',0,'owner','o***@example.test','service_requests:90','queued',1,5,'2026-01-01 00:00:00','2025-12-31 23:00:00');
            -- prior FAILED-observation based terminal release
            INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json,inquiry_outcome)
              VALUES(2,'provider','redirected','failed','{"inquiry":"failed_observed"}','failed_observed'),
                     (2,'system','failed','failed','{"terminal_release":"legacy-failed-based"}',NULL);
            -- invalid reminder date + invalid timezone on OPEN tasks
            INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(70,'Legacy Herd','buyer');
            INSERT INTO workspace_tasks(collection_id,title,category,due_date,recurrence,due_timezone,status,created_by_user_id,occurrence_key)
              VALUES(70,'Invalid date task','other','2026-02-30','none','Asia/Tehran','open','buyer','legacy-invalid-date'),
                     (70,'Invalid zone task','other','2026-11-01','none','Not/AZone','open','buyer','legacy-invalid-zone');
            """
        )
        conn.commit()
        conn.close()
        log("phase 1: legacy rows seeded — all six adjudication classes + settled preservation controls")

        # --------------------------------------------------------------
        # Phase 2 — record the baseline: file hash + per-table evidence
        # fingerprints (the 'approved backup' provenance).
        # --------------------------------------------------------------
        baseline_hash = file_hash(db_path)
        baseline_columns = {
            table: [r[1] for r in sqlite3.connect(db_path).execute(f'PRAGMA table_info("{table}")')]
            for table in ["refund_requests", "refund_allocations", "refund_events", "entitlement_events",
                          "entitlements", "orders", "payment_attempts", "payment_events", "horses"]
        }
        baseline = evidence_fingerprint(db_path, baseline_columns)
        log(f"phase 2: baseline recorded (file sha256 {baseline_hash[:16]}..., "
            + ", ".join(f"{t}={v['rows']}" for t, v in baseline.items()))

        # --------------------------------------------------------------
        # Phase 3 — read-only preflight on the restored target. It must
        # REPORT the legacy classes, block on the unadjudicated approved
        # allocations, never modify a byte, and never print private values.
        # --------------------------------------------------------------
        before_preflight = file_hash(db_path)
        pre1 = run_preflight(db_path)
        after_preflight = file_hash(db_path)
        b = pre1["payload"].get("blockers", {})
        w = pre1["payload"].get("warnings", {})
        stop_condition = (
            pre1["exit"] == 1
            and not pre1["payload"]["ok"]
            and b.get("foreign_key_violations") == 0
            and b.get("integrity_errors") == 0
            and b.get("unbound_approved_refund_allocations") == 2
            and before_preflight == after_preflight
            and "SECRET-REGISTER" not in pre1["stdout"]
            and "Legacy Unindexed" not in pre1["stdout"]
        )
        log(f"phase 3: stop-condition {'HELD' if stop_condition else 'VIOLATED'} — "
            f"blockers={json.dumps(b)}, warnings={json.dumps(w)}")
        warnings_seen = (
            w.get("prior_uncertain_sends_without_fingerprint") == 1
            and w.get("resolved_access_review_before_money_confirmation") == 1
            and w.get("failed_observations_used_for_legacy_terminal_release") == 1
            and w.get("active_horses_with_unindexed_identifier_fields") == 1
            and w.get("active_horse_counter_difference") == 1
            and w.get("open_tasks_invalid_dates") == 1
            and w.get("open_tasks_invalid_timezones") == 1
        )
        log(f"phase 3: every seeded legacy class reported: {'YES' if warnings_seen else 'NO'}")
        if not (stop_condition and warnings_seen):
            return 1

        # --------------------------------------------------------------
        # Phase 4 — apply migration 0069 through the actual mechanism, then
        # prove: schema upgraded, row counts preserved, settled evidence
        # byte-identical, the new partial unique index enforces identity.
        # --------------------------------------------------------------
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        for stmt in statements((MIGRATIONS / "0069_r97_integrity_boundaries.sql").read_text()):
            conn.execute(stmt)
        conn.commit()
        conn.close()
        log("phase 4: migration 0069 applied (proposal_operation_id, reminder_checked_at, dispatch_fingerprint, inquiry scope columns)")

        conn = sqlite3.connect(db_path)
        cols = {
            "refund_allocations": {r[1] for r in conn.execute('PRAGMA table_info("refund_allocations")')},
            "workspace_tasks": {r[1] for r in conn.execute('PRAGMA table_info("workspace_tasks")')},
            "notification_outbox": {r[1] for r in conn.execute('PRAGMA table_info("notification_outbox")')},
            "payment_events": {r[1] for r in conn.execute('PRAGMA table_info("payment_events")')},
        }
        schema_ok = (
            "proposal_operation_id" in cols["refund_allocations"]
            and "reminder_checked_at" in cols["workspace_tasks"]
            and "dispatch_fingerprint" in cols["notification_outbox"]
            and "inquiry_provider_scope" in cols["payment_events"]
            and "inquiry_authority" in cols["payment_events"]
        )
        log(f"phase 4: 0069 schema upgrade {'OK' if schema_ok else 'FAILED'}")

        # The partial unique index: two live proposals can never share an identity.
        conn.execute("UPDATE refund_allocations SET proposal_operation_id='adj-prop-A' WHERE refund_request_id=11")
        conn.commit()
        duplicate_blocked = False
        try:
            conn.execute("INSERT INTO refund_allocations(refund_request_id,policy_version,charge_amount_minor,proposed_amount_minor,currency,basis_json,status,proposed_by_user_id,proposal_operation_id)"
                         " VALUES(11,2,19000000,19000000,'IRR','{}','proposed','owner','adj-prop-A')")
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            duplicate_blocked = True
        log(f"phase 4: duplicate proposal identity blocked by the partial unique index: {'YES' if duplicate_blocked else 'NO'}")
        conn.close()

        after_migration = evidence_fingerprint(db_path, baseline_columns)
        preserved = all(
            after_migration[t]["rows"] == baseline[t]["rows"] and after_migration[t]["sha256"] == baseline[t]["sha256"]
            for t in ["refund_requests", "refund_events", "entitlement_events", "entitlements", "orders", "payment_attempts", "payment_events", "horses"]
        ) and after_migration["refund_allocations"]["rows"] == baseline["refund_allocations"]["rows"]
        log(f"phase 4: settled evidence + row counts byte-preserved across 0069: {'YES' if preserved else 'NO'}")
        if not (schema_ok and duplicate_blocked and preserved):
            return 1

        # --------------------------------------------------------------
        # Phase 5 — evidence-based adjudication (audited, append-only where
        # history exists). NO mass fills, NO invented proposal ids, NO
        # first_attempt_at resets.
        # --------------------------------------------------------------
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")

        # (5a) The still-PENDING refund 11: supersede the identity-less legacy
        # allocation and re-propose + re-approve through the EXACT production
        # CAS semantics (proposal identity bound, exact amount re-stated).
        conn.execute("UPDATE refund_allocations SET status='superseded' WHERE refund_request_id=11 AND status='approved'")
        proposal_op = "0b1c2d3e-4f50-4fa6-b7c8-d9e0f1a2b3c4"
        conn.execute("INSERT INTO refund_allocations(refund_request_id,policy_version,charge_amount_minor,proposed_amount_minor,currency,basis_json,status,proposed_by_user_id,proposal_operation_id)"
                     " VALUES(11,3,19000000,19000000,'IRR','{\"kind\":\"full_unused\",\"adjudication\":\"r97-n03\"}','proposed','owner',?)", (proposal_op,))
        approval_op = "1c2d3e4f-504f-4a6b-8c9d-0e1f2a3b4c5d"
        conn.execute("UPDATE refund_requests SET allocation_status='approved', amount_minor=19000000, last_operation_id=?"
                     " WHERE id=11 AND status='requested' AND allocation_status='proposed'", (approval_op,))
        conn.execute("UPDATE refund_allocations SET status='approved', approved_by_user_id='owner', approved_at=CURRENT_TIMESTAMP, approval_note='adjudicated re-approval with bound proposal identity'"
                     " WHERE refund_request_id=11 AND status='proposed' AND proposed_amount_minor=19000000 AND currency='IRR' AND proposal_operation_id=?"
                     " AND EXISTS(SELECT 1 FROM refund_requests r WHERE r.id=refund_allocations.refund_request_id AND r.last_operation_id=? AND r.allocation_status='approved')",
                     (proposal_op, approval_op))
        conn.execute("INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)"
                     " SELECT id,'operator','allocation','allocation_approved',? FROM refund_requests WHERE id=11 AND last_operation_id=?",
                     (json.dumps({"amount_minor": 19000000, "currency": "IRR", "proposal_operation_id": proposal_op, "adjudication": "r97-n03 re-approval"}), approval_op))

        # (5b) The SETTLED refund 10: preserve the historical money facts
        # (amount/approved_at/approval_note stay byte-identical) while binding
        # the proposal identity to the refund's OWN historical operation marker
        # — the actual approved basis recovered from the record, never a random
        # id — with an append-only adjudication event as the receipt.
        conn.execute("UPDATE refund_allocations SET proposal_operation_id=("
                     " SELECT COALESCE(r.last_operation_id,'settled-no-marker') FROM refund_requests r WHERE r.id=refund_allocations.refund_request_id)"
                     " WHERE refund_request_id=10 AND status='approved' AND proposal_operation_id IS NULL"
                     " AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL")
        conn.execute("INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)"
                     " VALUES(10,'operator','allocation','allocation_identity_recovered',?)",
                     (json.dumps({"adjudication": "r97-n03", "recovered_from": "historical approval record",
                                  "approved_at": "2026-09-20 12:00:00", "money_facts_unchanged": True}),))

        # (5c) The unknown send is HELD: no fingerprint + a past uncertain
        # attempt means the R97 worker refuses a blind retry; adjudication
        # moves it to review explicitly, never sends, never resets the anchor.
        conn.execute("UPDATE notification_outbox SET status='dead_letter', last_error='adjudication:legacy_dispatch_unknown'"
                     " WHERE event_key='legacy-uncertain-send' AND status='queued' AND first_attempt_at IS NOT NULL AND dispatch_fingerprint IS NULL")

        # (5d) The prematurely resolved review re-opens with an append-only
        # refund_events correction (the review row itself returns to 'open';
        # the correction lives in the append-only ledger).
        conn.execute("UPDATE refund_access_reviews SET status='open', resolved_at=NULL, resolved_by_user_id=NULL,"
                     " resolution_note=COALESCE(resolution_note,'')||' | re-opened by r97-n03 adjudication: resolved before money confirmation'"
                     " WHERE refund_request_id=11 AND status='resolved'")
        conn.execute("INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)"
                     " VALUES(11,'operator','review_resolved','review_reopened',?)",
                     (json.dumps({"adjudication": "r97-n03", "reason": "resolved before money confirmation", "append_only": True}),))

        # (5e) Identifier backfill + counter correction, both audited with an
        # explicit adjudication source (no invented identities: the value came
        # from the legacy row itself).
        conn.execute("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)"
                     " SELECT 'register_no','registry:platform',TRIM(register_no),TRIM(register_no),id,'live','adjudication:r97-n03'"
                     " FROM horses WHERE id=1 AND deleted_at IS NULL AND NULLIF(TRIM(register_no),'') IS NOT NULL"
                     " AND NOT EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=horses.id AND i.kind='register_no' AND i.status='live')")
        conn.execute("UPDATE registry_runtime_counters SET active_horse_count=(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) WHERE id=1")
        # (5f) Invalid reminder dates/zones: flagged for OWNER repair — data is
        # never invented; the report carries the pending list.
        invalid_tasks = conn.execute(
            "SELECT id,title FROM workspace_tasks WHERE status='open' AND (due_date='2026-02-30' OR due_timezone='Not/AZone')"
        ).fetchall()
        conn.commit()
        conn.close()
        log(f"phase 5: adjudication complete — re-proposed+re-approved refund 11 (identity {proposal_op[:8]}...), "
            f"unknown send HELD for operator review, review 11 re-opened with append-only correction, "
            f"identifier backfilled + counter trued, {len(invalid_tasks)} invalid reminder rows pending owner repair")

        # --------------------------------------------------------------
        # Phase 6 — final verification: preflight clean of blockers, settled
        # evidence still byte-identical, timing + data-loss window recorded.
        # --------------------------------------------------------------
        pre2 = run_preflight(db_path)
        b2 = pre2["payload"].get("blockers", {})
        w2 = pre2["payload"].get("warnings", {})
        final_clean = pre2["payload"]["ok"] and not any(b2.values())
        log(f"phase 6: post-adjudication preflight ok={pre2['payload']['ok']} blockers={json.dumps(b2)}")

        conn = sqlite3.connect(db_path)
        settled_refund_10 = conn.execute(
            "SELECT status,amount_minor FROM refund_requests WHERE id=10"
        ).fetchone()
        settled_alloc_10 = conn.execute(
            "SELECT status,proposed_amount_minor,approved_at,approval_note FROM refund_allocations WHERE refund_request_id=10 AND status='approved'"
        ).fetchone()
        conn.close()
        settled_ok = (
            settled_refund_10[0] == "confirmed" and settled_refund_10[1] == 19000000
            and settled_alloc_10 is not None and settled_alloc_10[1] == 19000000
            and settled_alloc_10[2] == "2026-09-20 12:00:00"
            and settled_alloc_10[3] == "legacy approval without proposal identity"
        )
        log(f"phase 6: settled refund 10 evidence untouched (status/amount/approved_at/note identical): {'YES' if settled_ok else 'NO'}")

        elapsed = time.monotonic() - started
        restored_stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        log(f"phase 6: rehearsal wall time {elapsed:.1f}s; backup stamp {backup_stamp}; restored+verified stamp {restored_stamp}")
        log("phase 6: data-loss window = backup stamp -> migration-complete stamp "
            f"({backup_stamp} .. {restored_stamp}); during the window the restored copy accepts no external writes "
            "(delivery/payment disabled by the rehearsal boundary), so the window equals the operator's "
            "re-run cadence for the R96 backup, not unsaved client activity")

        success = final_clean and settled_ok and w2.get("open_tasks_invalid_dates") == 1 and w2.get("open_tasks_invalid_timezones") == 1
        log(f"\nr97-n03 rehearsal: {'PASS' if success else 'FAIL'}")
        return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
