#!/usr/bin/env python3
"""Read-only preflight for R98, run on a restored, quiescent SQLite copy.

Never repairs, remaps, redacts, or deletes records. Output contains counts and
bounded record IDs, never private notes, contact values, or laboratory results.
Exit: 0 no blockers, 1 blockers, 2 invocation/read failure, 3 --strict review.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
SCHEME = "iso3166-2-ir:2020-11-24"


def instant(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?", value):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.year < 1000:
            return None
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def day(value: object) -> dt.date | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def inspect(path: Path) -> dict:
    path = path.resolve(strict=True)
    if not path.is_file():
        raise ValueError("Expected a restored SQLite file")
    if Path(str(path) + "-wal").exists():
        raise ValueError("Use a quiescent restored copy with its WAL checkpointed; do not inspect a live database")
    before = digest(path)
    rules: list[dict] = []

    def record(key: str, level: str, identifiers: list[object], action: str) -> None:
        if identifiers:
            rules.append({"id": key, "severity": level, "count": len(identifiers), "sample_ids": identifiers[:20], "action": action})

    with closing(sqlite3.connect(f"file:{quote(str(path))}?mode=ro", uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"users", "people", "horses", "directory_profiles", "directory_claims", "person_credentials", "issuer_memberships", "issuers", "attestations"}
        missing = sorted(required - tables)
        record("schema.required_tables", "blocker", missing, "Restore the complete pre-R98 schema; do not guess missing migrations.")
        integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
        record("database.integrity", "blocker", ["integrity-check-failed"] if integrity != ["ok"] else [], "Quarantine the copy and restore a verified backup; inspect the private SQLite diagnostic separately.")
        fk = [f"{row[0]}:{row[1]}" for row in db.execute("PRAGMA foreign_key_check")]
        record("database.foreign_keys", "blocker", fk, "Resolve orphan relationships from authoritative evidence before release.")

        def has_column(table: str, name: str) -> bool:
            # Names are application constants, never user-supplied SQL.
            return name in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}

        if "issuer_memberships" in tables:
            duplicates = [f"{r[0]}:{r[1]}" for r in db.execute("SELECT issuer_id,user_id FROM issuer_memberships WHERE status='active' GROUP BY issuer_id,user_id HAVING COUNT(*)>1")]
            record("issuer.duplicate_active", "blocker", duplicates, "Migration 0071 creates a unique active-membership index. Adjudicate duplicates with issuer approval; preserve revocation history. Never delete arbitrarily.")
            invalid, inconsistent = [], []
            for row in db.execute("SELECT id,status,valid_from,valid_until,revoked_at FROM issuer_memberships"):
                start, end = instant(row["valid_from"]), instant(row["valid_until"])
                if start is None or (row["valid_until"] is not None and (end is None or end <= start)):
                    invalid.append(row["id"])
                if row["status"] == "active" and row["revoked_at"] is not None:
                    inconsistent.append(row["id"])
            record("issuer.invalid_dates", "review", invalid, "Do not grant authority from malformed dates. Reconfirm the original issuer interval and explicitly re-grant when justified.")
            record("issuer.inconsistent_revocation", "review", inconsistent, "Treat as revoked; reconcile status without erasing the original evidence.")

        if "directory_profiles" in tables:
            bad_publish, unknown_author = [], []
            for row in db.execute("SELECT d.id,d.publication_consent,d.published_at,d.created_by_user_id,u.id AS existing_author FROM directory_profiles d LEFT JOIN users u ON u.id=d.created_by_user_id"):
                if row["publication_consent"] and instant(row["published_at"]) is None:
                    bad_publish.append(row["id"])
                if row["existing_author"] is None:
                    unknown_author.append(row["id"])
            record("directory.corrupt_publication", "review", bad_publish, "R97 bind corruption may have stored a user ID as a timestamp. Obtain publication consent/evidence; do not fabricate a date from an unrelated field.")
            record("directory.unknown_creator", "review", unknown_author, "Attribute only from reliable audit evidence or leave explicitly unknown; do not guess the uploader.")

        province_codes = {item["code"] for item in json.loads((ROOT / "src/directory/catalog.json").read_text(encoding="utf8"))["provinces"]}
        for table in ("directory_profiles", "organization_profiles", "service_requests"):
            if table not in tables or not has_column(table, "province_code"):
                continue
            has_scheme = has_column(table, "province_code_scheme")
            scheme_expr = "province_code_scheme" if has_scheme else "'legacy_r97_unconfirmed'"
            uncertain, invalid = [], []
            for row in db.execute(f"SELECT id,province_code,{scheme_expr} AS scheme FROM {table} WHERE province_code IS NOT NULL AND province_code<>''"):
                if row["scheme"] != SCHEME:
                    uncertain.append(row["id"])
                elif row["province_code"] not in province_codes:
                    invalid.append(row["id"])
            record(f"{table}.location_unconfirmed", "review", uncertain, "Preserve the raw legacy code. Ask the subject/operator to confirm province identity and save the explicit R98 scheme; no blanket remap.")
            record(f"{table}.invalid_location", "review", invalid, "Correct the explicitly versioned code using the shared catalog and an audited authorized edit.")

        if "person_credentials" in tables:
            invalid_dates, legacy_authority = [], []
            for row in db.execute("SELECT id,issued_at,expires_at,verification_state FROM person_credentials"):
                start, end = day(row["issued_at"]), day(row["expires_at"])
                if (row["issued_at"] is not None and start is None) or (row["expires_at"] is not None and end is None) or (start and end and start > end):
                    invalid_dates.append(row["id"])
                if row["verification_state"] == "issuer_attested":
                    legacy_authority.append(row["id"])
            record("credentials.invalid_dates", "review", invalid_dates, "Do not render a valid credential badge. Reconcile date precision and source documentation.")
            record("credentials.unbound_authority", "review", legacy_authority, "Legacy label is not issuer evidence. Public projection is unverified pending a scoped, issuer-authorized credential workflow.")

        if "directory_claims" in tables:
            mixed = [r[0] for r in db.execute("SELECT id FROM directory_claims WHERE NOT ((claim_type='person' AND person_id IS NOT NULL AND organization_id IS NULL) OR (claim_type='organization' AND organization_id IS NOT NULL AND person_id IS NULL))")]
            record("claims.invalid_target", "review", mixed, "Require exactly one target; adjudicate old claims before approval. No new grant may follow an invalid target.")

        if "attestations" in tables:
            invalid, unbound = [], []
            for row in db.execute("SELECT id,issued_at,expires_at,source_version,status FROM attestations"):
                start, end = instant(row["issued_at"]), instant(row["expires_at"])
                if start is None or (row["expires_at"] is not None and (end is None or end <= start)):
                    invalid.append(row["id"])
                if row["status"] == "active" and not row["source_version"]:
                    unbound.append(row["id"])
            record("attestations.invalid_dates", "review", invalid, "Invalid evidence is not active. Have the issuer revoke/supersede it rather than editing issuance history.")
            record("attestations.no_source_version", "review", unbound, "Recorded attestation metadata is not an immutable snapshot of horse facts. Do not present it as a current whole-record guarantee.")

    after = digest(path)
    if after != before:
        raise RuntimeError("Input changed during inspection; discard this result and use an isolated restored copy")
    return {"schema": "horse-registry-r98-preflight/v1", "database_file": path.name,
            "sha256_before": before, "sha256_after": after, "read_only": True,
            "rules": rules, "blockers": sum(r["severity"] == "blocker" for r in rules),
            "reviews": sum(r["severity"] == "review" for r in rules),
            "scope": "SQLite restored-copy preflight only; not PostgreSQL, provider, production-load or legal certification."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--strict", action="store_true", help="Return 3 for unresolved review findings even without blockers")
    args = parser.parse_args()
    try:
        report = inspect(args.db)
    except (OSError, ValueError, sqlite3.Error, RuntimeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error), "read_only": True}), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 1 if report["blockers"] else 3 if args.strict and report["reviews"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
