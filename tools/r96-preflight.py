#!/usr/bin/env python3
"""Read-only R95 -> R96 checks against a consistent restored SQLite copy.
Exit 0: no detected blockers (NOT release approval); 1: blockers; 2: invalid input.
Does not repair data, create a database, print customer content, or contact a provider.
PostgreSQL upgrade, locking, and settlement must be verified separately.
"""
from __future__ import annotations
import argparse
import contextlib
import json
import re
import sqlite3
import sys
from pathlib import Path

REQUIRED = {
    'refund_requests': {'id', 'payment_attempt_id', 'order_id', 'amount_minor', 'currency', 'status'},
    'payment_attempts': {'id', 'order_id', 'amount_minor', 'currency'},
    'orders': {'id', 'total_minor', 'currency'},
    'entitlements': {'id', 'active'},
    'entitlement_events': {'id', 'kind', 'activated_at', 'expires_at'},
    'service_requests': {'id', 'note', 'note_digest', 'note_redacted_at', 'status'},
    'service_request_blocks': {'id', 'blocker_user_id', 'blocked_person_id'},
    'service_provider_blocks': {'id', 'provider_person_id', 'blocked_requester_user_id'},
    'billing_review_cases': {'id', 'status'},
}

def inspect(path: Path) -> dict:
    if not path.is_file():
        raise ValueError('Database file does not exist; no file was created')
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        # One coherent read snapshot; a restored copy is still strongly preferred.
        db.execute('BEGIN')
        available = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = {}
        for table, columns in REQUIRED.items():
            if table not in available:
                missing[table] = 'table missing'
            else:
                actual = {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
                if columns - actual:
                    missing[table] = sorted(columns - actual)
        if missing:
            return {'ok': False, 'read_only': True, 'blockers': {'incompatible_schema': missing}, 'warnings': {}}
        scalar = lambda sql: db.execute(sql).fetchone()[0]
        blockers = {
            'multiple_active_or_confirmed_refunds_for_one_attempt': scalar("""SELECT COUNT(*) FROM (
                SELECT payment_attempt_id FROM refund_requests
                WHERE status IN ('requested','approved','provider_pending','confirmed')
                GROUP BY payment_attempt_id HAVING COUNT(*)>1)"""),
            'refund_amount_or_parent_mismatch': scalar("""SELECT COUNT(*) FROM refund_requests r
                JOIN payment_attempts p ON p.id=r.payment_attempt_id JOIN orders o ON o.id=r.order_id
                WHERE p.order_id<>r.order_id OR r.amount_minor>p.amount_minor OR r.currency<>p.currency
                    OR p.amount_minor<>o.total_minor OR p.currency<>o.currency"""),
            'foreign_key_violations': sum(1 for _ in db.execute('PRAGMA foreign_key_check')),
            'integrity_errors': sum(row[0] != 'ok' for row in db.execute('PRAGMA integrity_check')),
        }
        malformed_digest = 0
        unverifiable_old_digest = 0
        for digest, redacted in db.execute('SELECT note_digest,note_redacted_at FROM service_requests WHERE note_redacted_at IS NOT NULL'):
            if not isinstance(digest,str) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
                malformed_digest += 1
            else:
                unverifiable_old_digest += 1
        warnings = {
            'redacted_notes_without_valid_original_digest_shape': malformed_digest,
            'historical_digest_shape_valid_but_original_bytes_not_verified': unverifiable_old_digest,
            'grants_missing_frozen_intervals': scalar("SELECT COUNT(*) FROM entitlement_events WHERE kind='grant' AND (activated_at IS NULL OR expires_at IS NULL)"),
            'previously_confirmed_refunds_require_external_settlement_review': scalar("SELECT COUNT(*) FROM refund_requests WHERE status='confirmed'"),
            'unresolved_payment_review_cases': scalar("SELECT COUNT(*) FROM billing_review_cases WHERE status='open'"),
        }
        if 'refund_access_reviews' in available:
            warnings['open_refund_access_reviews'] = scalar("SELECT COUNT(*) FROM refund_access_reviews WHERE status='open'")
        result = {'ok': not any(blockers.values()), 'read_only': True, 'blockers': blockers, 'warnings': warnings,
            'scope': 'Consistent local SQLite read only; not provider settlement, PostgreSQL validation, data repair, retention approval or release approval'}
        db.rollback()
        return result

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path, help='Restored SQLite copy with migrations through at least 0061')
    args = parser.parse_args()
    try:
        result = inspect(args.database)
    except (ValueError, sqlite3.Error, OSError) as exc:
        print(json.dumps({'ok':False,'read_only':True,'error':str(exc)}),file=sys.stderr)
        return 2
    print(json.dumps(result,indent=2))
    return 0 if result['ok'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
