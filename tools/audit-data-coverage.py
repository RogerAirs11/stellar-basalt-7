#!/usr/bin/env python3
"""Aggregate-only coverage of an approved LOCAL SQLite snapshot; never exports records.

No URL/remote service support, no mutation, no inferred verification or clinical score.
Run on a restored snapshot, not a production database file being actively written.
"""
from __future__ import annotations
import argparse
import json
import math
import sqlite3
import time
from contextlib import closing
from pathlib import Path

TABLES = (
    'horses', 'people', 'horse_people', 'horse_aliases', 'genetic_tests',
    'breeding_records', 'competitions', 'competition_results', 'sales_listings',
    'directory_profiles', 'person_credentials', 'organization_credentials',
    'organization_profiles', 'horse_identifiers', 'horse_ownership_periods',
    'horse_claims', 'horse_access_grants', 'person_registry_stats',
    'horse_reference_intelligence', 'service_requests',
    'workspace_collections', 'workspace_collection_members', 'workspace_staff_assignments',
    'workspace_staff_invites', 'workspace_tasks', 'workspace_documents',
    'data_quality_issues', 'source_imports',
)
FIELDS = ('name_native', 'birth_year', 'sex_desc', 'breed_desc', 'color_desc',
          'main_strain_desc', 'sub_strain_desc', 'register_no', 'microchip_no',
          'father_id', 'mother_id', 'dna_status', 'dna_desc')

def identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'

def audit(path: Path, max_seconds: float = 30) -> dict:
    if not math.isfinite(max_seconds) or not 0 < max_seconds <= 300:
        raise ValueError('max_seconds must be finite, greater than zero and at most 300')
    if path.is_symlink() or not path.is_file():
        raise ValueError('An existing regular local snapshot is required; symlinks are refused')
    report: dict = {
        'schema_version': 1, 'mode': 'read-only aggregate snapshot',
        'classification': 'unclassified snapshot; not a production attestation',
        'complete': True, 'tables': {}, 'horse_fields': {}, 'pedigree': {}, 'genetics': {},
        'limitations': [
            'Counts describe stored rows, not real-world truth or current ownership/consent.',
            'DNA status text does not establish a verified assay, parentage or disease result.',
            'Coverage does not measure model accuracy, frontend parity or clinical suitability.',
            'No names, identifiers, contact values, genotype text or private payloads are emitted.',
            'No recursive pedigree traversal or record-level integrity certification is performed.',
        ],
    }
    deadline = time.monotonic() + max_seconds
    with closing(sqlite3.connect(path.absolute().as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        try:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            def columns(table: str) -> set[str]:
                return {row[1] for row in db.execute(f'PRAGMA table_info({identifier(table)})')}
            def count(sql: str) -> int:
                if time.monotonic() > deadline:
                    raise TimeoutError('Coverage query budget exhausted')
                return int(db.execute(sql).fetchone()[0])
            if 'local_demo_manifest' in tables:
                marker = db.execute('SELECT namespace FROM local_demo_manifest WHERE id=1').fetchone()
                if marker and isinstance(marker[0], str) and marker[0].startswith('synthetic:'):
                    report['classification'] = 'explicitly marked synthetic demonstration'
            for table in TABLES:
                report['tables'][table] = {'available': table in tables,
                    'rows': count(f'SELECT COUNT(*) FROM {identifier(table)}') if table in tables else None}
            if 'horses' in tables:
                cols = columns('horses')
                active = 'deleted_at IS NULL' if 'deleted_at' in cols else '1=1'
                report['active_horses'] = count(f'SELECT COUNT(*) FROM horses WHERE {active}')
                for field in FIELDS:
                    report['horse_fields'][field] = {'available': field in cols, 'recorded': count(
                        f'SELECT COUNT(*) FROM horses WHERE {active} AND {identifier(field)} IS NOT NULL AND LENGTH(TRIM(CAST({identifier(field)} AS TEXT)))>0'
                    ) if field in cols else None}
                if {'id', 'father_id', 'mother_id'}.issubset(cols):
                    report['pedigree']['both_parents_recorded'] = count(f'SELECT COUNT(*) FROM horses WHERE {active} AND father_id IS NOT NULL AND mother_id IS NOT NULL')
                    report['pedigree']['self_parent_rows'] = count(f'SELECT COUNT(*) FROM horses WHERE {active} AND (father_id=id OR mother_id=id)')
                    report['pedigree']['same_parent_both_roles'] = count(f'SELECT COUNT(*) FROM horses WHERE {active} AND father_id=mother_id')
                    for role, field in [('sire', 'father_id'), ('dam', 'mother_id')]:
                        where = 'h.deleted_at IS NULL' if 'deleted_at' in cols else '1=1'
                        report['pedigree'][f'dangling_{role}_references'] = count(f'SELECT COUNT(*) FROM horses h LEFT JOIN horses p ON p.id=h.{field} WHERE {where} AND h.{field} IS NOT NULL AND p.id IS NULL')
                else:
                    report['pedigree']['status'] = 'parent identifier columns unavailable'
            if 'genetic_tests' in tables:
                cols = columns('genetic_tests')
                report['genetics']['has_explicit_verification_field'] = 'verified' in cols
                report['genetics']['has_assay_type_field'] = 'test_type' in cols
                if 'verified' in cols:
                    report['genetics']['rows_marked_verified'] = count('SELECT COUNT(*) FROM genetic_tests WHERE verified=1')
                    report['genetics']['warning'] = 'Stored verification flag counted; certificates and provenance NOT independently verified.'
                if {'horse_id', 'test_type'}.issubset(cols):
                    report['genetics']['horse_assay_groups_with_multiple_records'] = count('SELECT COUNT(*) FROM (SELECT horse_id,test_type FROM genetic_tests GROUP BY horse_id,test_type HAVING COUNT(*)>1)')
            db.rollback()
        except (sqlite3.OperationalError, TimeoutError) as error:
            report['complete'] = False
            report['error_code'] = 'query_budget_exhausted' if time.monotonic() > deadline else 'snapshot_query_failed'
            # Never include a driver error string that might contain source values.
    return report

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--max-seconds', type=float, default=30)
    args = parser.parse_args()
    try:
        report = audit(args.snapshot, args.max_seconds)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(2, 'Coverage audit refused: use an existing, readable local SQLite snapshot and valid limits.\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report['complete'] else 2

if __name__ == '__main__':
    raise SystemExit(main())
