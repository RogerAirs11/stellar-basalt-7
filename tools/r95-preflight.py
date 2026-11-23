#!/usr/bin/env python3
"""Read-only R94 -> R95 financial migration preflight on a restored SQLite copy.
Exit 0: no detected blockers (NOT a release approval); 1: blockers; 2: bad input.
No customer contacts, document content, secrets, or financial repair are emitted.
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

CHECKS = {
    'duplicate_open_payment_attempts': "SELECT order_id,COUNT(*) AS n FROM payment_attempts WHERE state IN ('created','redirected') GROUP BY order_id HAVING COUNT(*)>1",
    'duplicate_live_price_versions': "SELECT sku,COUNT(*) AS n FROM billing_prices WHERE active=1 AND superseded_at IS NULL GROUP BY sku HAVING COUNT(*)>1",
    'duplicate_active_entitlements': "SELECT CASE WHEN payer_organization_id IS NOT NULL THEN 'org:' || payer_organization_id ELSE 'user:' || buyer_user_id END AS holder_key,sku,COUNT(*) AS n FROM entitlements WHERE active=1 GROUP BY 1,2 HAVING COUNT(*)>1",
}

def inspect(path: Path):
    if not path.is_file():
        raise ValueError('Database file does not exist; preflight never creates a database')
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        available = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {'orders', 'payment_attempts', 'payment_events', 'billing_prices', 'entitlements'}
        missing = sorted(required - available)
        if missing:
            return {'ok': False, 'blockers': {'missing_tables': missing}, 'warnings': {}, 'read_only': True}
        blockers = {name: len(db.execute(sql).fetchall()) for name, sql in CHECKS.items()}
        blockers['foreign_key_violations'] = len(db.execute('PRAGMA foreign_key_check').fetchall())
        blockers['integrity_errors'] = sum(r[0] != 'ok' for r in db.execute('PRAGMA integrity_check'))
        receipt_filter = " AND NOT EXISTS(SELECT 1 FROM billing_command_receipts r WHERE r.payment_attempt_id=p.id AND r.kind='verify')" if "billing_command_receipts" in available else ""
        warnings = {'legacy_paid_attempts_require_receipt_reconciliation': db.execute("SELECT COUNT(*) FROM payment_attempts p WHERE p.state='verified'" + receipt_filter).fetchone()[0]}
        malformed = 0
        missing_periods = 0
        for (raw,) in db.execute("SELECT price_snapshot_json FROM orders WHERE status IN ('pending','awaiting_payment')"):
            try:
                lines = json.loads(raw)
                if not isinstance(lines, list) or not lines or any(not isinstance(line, dict) for line in lines):
                    malformed += 1
                elif any('period_days' not in line for line in lines):
                    missing_periods += 1
            except (TypeError, ValueError):
                malformed += 1
        warnings['pending_orders_without_frozen_periods'] = missing_periods
        warnings['malformed_pending_order_snapshots'] = malformed
        return {'ok': not any(blockers.values()), 'blockers': blockers, 'warnings': warnings, 'read_only': True,
                'scope': 'SQLite restored-copy preflight only; no PostgreSQL, money movement, migration approval or repair'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path, help='Restored R94 SQLite database copy; never the only production backup')
    args = parser.parse_args()
    try:
        report = inspect(args.database)
    except (ValueError, sqlite3.Error) as error:
        print(json.dumps({'ok': False, 'error': str(error), 'read_only': True}), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
