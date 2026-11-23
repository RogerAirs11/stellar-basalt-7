#!/usr/bin/env python3
"""Read-only R97 upgrade assessment for a consistent, restored SQLite copy.
No network, repairs, contact details, raw notes, identifiers, or credentials.
Exit 0 means no detected data blockers, NOT approval to deploy or take payments.
PostgreSQL concurrency and backup restoration require independent execution.
"""
from __future__ import annotations
import argparse
import contextlib
import datetime as dt
import json
from pathlib import Path
import sqlite3
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

REQUIRED = {'horses', 'horse_identifiers', 'refund_allocations', 'refund_requests',
            'refund_access_reviews', 'workspace_tasks', 'notification_outbox',
            'payment_events', 'registry_runtime_counters'}

def inspect(path: Path) -> dict:
    if not path.is_file():
        raise ValueError('Supply an existing restored SQLite file; no file was created')
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = sorted(REQUIRED - tables)
        if missing:
            return {'ok': False, 'read_only': True, 'blockers': {'missing_tables': missing}, 'warnings': {}}
        columns = {t: {r[1] for r in db.execute(f'PRAGMA table_info("{t}")')} for t in REQUIRED}
        scalar = lambda sql: db.execute(sql).fetchone()[0]
        invalid_dates = invalid_zones = 0
        for day, zone in db.execute("SELECT due_date,due_timezone FROM workspace_tasks WHERE status='open'"):
            try:
                if not isinstance(day, str) or len(day) != 10 or dt.date.fromisoformat(day).isoformat() != day:
                    invalid_dates += 1
            except (ValueError, TypeError):
                invalid_dates += 1
            try:
                ZoneInfo(zone)
            except (ZoneInfoNotFoundError, ValueError, TypeError):
                invalid_zones += 1
        unbound = "proposal_operation_id IS NULL" if 'proposal_operation_id' in columns['refund_allocations'] else '1=1'
        blockers = {
            'foreign_key_violations': sum(1 for _ in db.execute('PRAGMA foreign_key_check')),
            'integrity_errors': sum(r[0] != 'ok' for r in db.execute('PRAGMA integrity_check')),
            'unbound_approved_refund_allocations': scalar(f"SELECT COUNT(*) FROM refund_allocations WHERE status='approved' AND ({unbound})"),
        }
        fp_unknown = "dispatch_fingerprint IS NULL" if 'dispatch_fingerprint' in columns['notification_outbox'] else '1=1'
        warnings = {
            'open_tasks_invalid_dates': invalid_dates,
            'open_tasks_invalid_timezones': invalid_zones,
            'prior_uncertain_sends_without_fingerprint': scalar(f"SELECT COUNT(*) FROM notification_outbox WHERE status='queued' AND first_attempt_at IS NOT NULL AND ({fp_unknown})"),
            'resolved_access_review_before_money_confirmation': scalar("SELECT COUNT(*) FROM refund_access_reviews a JOIN refund_requests r ON r.id=a.refund_request_id WHERE a.status='resolved' AND r.status<>'confirmed'"),
            'active_horses_with_unindexed_identifier_fields': scalar("""SELECT COUNT(*) FROM horses h WHERE h.deleted_at IS NULL AND (
                (NULLIF(TRIM(h.register_no),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.kind='register_no' AND i.status='live')) OR
                (NULLIF(TRIM(h.microchip_no),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.kind='microchip_no' AND i.status='live')))"""),
            'active_horse_counter_difference': scalar("SELECT COALESCE((SELECT active_horse_count FROM registry_runtime_counters WHERE id=1),0)-(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL)"),
            'failed_observations_used_for_legacy_terminal_release': scalar("SELECT COUNT(*) FROM payment_events WHERE payload_json LIKE '%terminal_release%' AND payment_attempt_id IN (SELECT payment_attempt_id FROM payment_events WHERE inquiry_outcome='failed_observed')"),
        }
        return {'ok': not any(blockers.values()), 'read_only': True, 'blockers': blockers, 'warnings': warnings,
                'scope': 'A consistent restored SQLite snapshot; warnings require adjudication, never blind repair.',
                'release_approval': False}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.database)
    except (ValueError, sqlite3.Error, OSError) as exc:
        print(json.dumps({'ok':False, 'read_only':True, 'error':str(exc)}))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())
