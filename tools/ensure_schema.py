from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"

# Historical migrations 0008 and 0012 add columns with plain SQLite
# ALTER TABLE ... ADD COLUMN. SQLite has no ADD COLUMN IF NOT EXISTS syntax, so
# blindly replaying the migration set makes schema preparation fail on an
# already-prepared database. Keep the migration files immutable and make this
# local schema helper safely replayable by skipping only ADD COLUMN statements
# whose target column is already present.
_ALTER_ADD_COLUMN = re.compile(
    r"^\s*ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\b",
    re.IGNORECASE | re.DOTALL,
)

# R125: D1's SQLite fork accepts PostgreSQL's `ADD COLUMN IF NOT EXISTS`
# (migration 0098 was applied to live D1 verbatim); stock python sqlite3
# rejects it at parse time. The idempotence check above already skips
# existing columns, so the guard can be stripped before execution.
_IF_NOT_EXISTS_ADD_COLUMN = re.compile(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+", re.IGNORECASE)


def _strip_leading_line_comments(sql: str) -> str:
    lines = sql.splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith("--")):
        lines.pop(0)
    return "\n".join(lines)


def _iter_statements(sql: str) -> Iterable[str]:
    """Yield complete SQLite statements while preserving multiline SQL/comments."""
    buffer: list[str] = []
    for line in sql.splitlines(keepends=True):
        buffer.append(line)
        candidate = "".join(buffer)
        if sqlite3.complete_statement(candidate):
            if _strip_leading_line_comments(candidate).strip():
                yield candidate.strip()
            buffer = []
    remainder = "".join(buffer)
    if _strip_leading_line_comments(remainder).strip():
        raise ValueError("Migration contains an incomplete trailing SQL statement")


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    quoted = table.replace('"', '""')
    return any(row[1] == column for row in conn.execute(f'PRAGMA table_info("{quoted}")'))


def _apply_migration_idempotently(conn: sqlite3.Connection, sql: str) -> None:
    for statement in _iter_statements(sql):
        match = _ALTER_ADD_COLUMN.match(_strip_leading_line_comments(statement))
        if match and _column_exists(conn, match.group(1), match.group(2)):
            continue
        # R125: D1's SQLite fork accepts PostgreSQL's ADD COLUMN IF NOT EXISTS
        # (migration 0098); stock python sqlite3 does not. The idempotence check
        # above already skipped existing columns, so the guard can be stripped.
        conn.execute(_IF_NOT_EXISTS_ADD_COLUMN.sub("ADD COLUMN ", statement))


def apply_migrations(path: Path) -> None:
    """Apply the migration set to *path*, closing the connection deterministically.

    The connection is closed on the success path and on every exception path.
    A close() failure must never mask the original migration error, so it is
    re-raised only when no other exception is already propagating (NEXT-15).
    """
    conn = sqlite3.connect(path)
    completed = False
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            _apply_migration_idempotently(conn, migration.read_text(encoding="utf-8"))
        conn.commit()
        problems = conn.execute("PRAGMA foreign_key_check").fetchall()
        if problems:
            raise RuntimeError(f"foreign_key_check returned {len(problems)} rows")
        completed = True
    finally:
        try:
            conn.close()
        except sqlite3.Error:
            # close() failed. Never mask an in-flight migration error: when the
            # body did not complete, the original exception keeps propagating.
            # On the completed path surface the close failure loudly instead of
            # silently losing the handle.
            if completed:
                raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Idempotently apply Horse DB SQLite schema migrations.")
    parser.add_argument("sqlite", type=Path)
    args = parser.parse_args()
    if not args.sqlite.exists():
        parser.error(f"SQLite database not found: {args.sqlite}")
    apply_migrations(args.sqlite)
    print(f"Schema migrations applied: {args.sqlite}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
