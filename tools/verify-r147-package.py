"""Verify the immutable source-file inventory in an extracted R147 package.

This checks bytes, not product correctness or deployment approval. Generated
files and dependencies added after extraction are outside the source inventory.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "EXPORT_MANIFEST.json").read_text(encoding="utf-8"))
    if manifest.get("round") != "R147" or manifest.get("schema_version") != 2:
        raise SystemExit("Expected the R147 source inventory")
    seen: set[str] = set()
    failures: list[str] = []
    for item in manifest["files"]:
        name = item["path"]
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or name in seen:
            raise SystemExit("Unsafe or duplicate inventory path")
        seen.add(name)
        path = root.joinpath(*relative.parts)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            failures.append(f"missing/nonregular: {name}")
            continue
        content = path.read_bytes()
        if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
            failures.append(f"changed: {name}")
    if failures:
        print("Source inventory mismatch:\n" + "\n".join(failures))
        return 1
    print(f"R147 source inventory verified: {len(seen)} files; no deployment or correctness claim.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
