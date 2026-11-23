"""Verify the complete R148 source inventory and its code fingerprint.

Run after extracting the source package, before installing dependencies or
integrating the patch. This verifies bytes and provenance metadata; it does
not grant deployment approval or prove product correctness.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "EXPORT_MANIFEST.json").read_text(encoding="utf-8"))
    if manifest.get("round") != "R148" or manifest.get("schema_version") != 2:
        raise SystemExit("Expected the R148 source inventory")
    files = manifest.get("files", [])
    if len(files) != manifest.get("file_count"):
        raise SystemExit("Inventory file count is inconsistent")
    seen: set[str] = set()
    actual: dict[str, dict[str, object]] = {}
    failures: list[str] = []
    for item in files:
        name = item["path"]
        relative = PurePosixPath(name)
        if (relative.is_absolute() or ".." in relative.parts or "\\" in name
                or relative.as_posix() != name or name in seen
                or name == "EXPORT_MANIFEST.json"):
            raise SystemExit("Unsafe, duplicate or self-referential inventory path")
        seen.add(name)
        path = root.joinpath(*relative.parts)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            failures.append(f"missing/nonregular: {name}")
            continue
        content = path.read_bytes()
        row = {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        actual[name] = row
        if row != item:
            failures.append(f"changed: {name}")
    code_paths = manifest.get("code_fingerprint_paths", [])
    if not code_paths or code_paths != sorted(set(code_paths)) or not set(code_paths).issubset(seen):
        raise SystemExit("Code fingerprint path set is invalid")
    if not failures:
        canonical = json.dumps([actual[name] for name in code_paths], ensure_ascii=False,
                               sort_keys=True, separators=(",", ":")).encode("utf-8")
        if hashlib.sha256(canonical).hexdigest() != manifest.get("frozen_code_sha256"):
            failures.append("code fingerprint mismatch")
    if failures:
        print("Source inventory mismatch:\n" + "\n".join(failures))
        return 1
    print(f"R148 verified: {len(seen)} inventoried files; {len(code_paths)} code/configuration/test files.")
    print("No production deployment, data completeness or release approval is implied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
