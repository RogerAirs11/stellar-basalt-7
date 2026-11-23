from __future__ import annotations

import argparse
from pathlib import Path

from import_xlsx import write_d1_shards


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate D1-compatible SQL shards from the canonical local SQLite database.")
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/generated/remote-d1-shards"))
    parser.add_argument("--include-raw-json", action="store_true")
    parser.add_argument("--serving-layout", action="store_true", help="Emit external-content FTS serving-schema prelude/rebuild shards")
    args = parser.parse_args()
    if not args.sqlite.exists():
        parser.error(f"SQLite database not found: {args.sqlite}")
    write_d1_shards(args.sqlite, args.out, include_raw_json=args.include_raw_json, external_search_fts=args.serving_layout)
    print(f"D1 shards written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
