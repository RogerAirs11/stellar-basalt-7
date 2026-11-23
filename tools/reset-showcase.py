#!/usr/bin/env python3
"""Reset/backup/restore a stopped, named synthetic instance under data/demo.

Arbitrary database paths and symlinked paths are refused. Reset first builds a
fresh marked database, preserves an existing instance in backups, then swaps
the stopped instance atomically. No production adapter is imported or opened.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import sys
import uuid
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
spec = importlib.util.spec_from_file_location("showcase_builder", ROOT / "tools/create-demo-database.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def instance_path(name):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", name):
        raise ValueError("Instance must be a simple lower-case name, not a path")
    return builder.target_path(str(ROOT / "data/demo" / (name + ".sqlite")))


def validate_marked(path):
    path = builder.target_path(str(path))
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        row = db.execute("SELECT namespace FROM local_demo_manifest WHERE id=1").fetchone()
        if not row or row[0] not in ("synthetic:r106", "synthetic:r111"):
            raise ValueError("Refusing a database without the recognized synthetic marker")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Synthetic database integrity check failed; preserve it for manual recovery")
    return path


@contextmanager
def instance_lock(path, recover_stale=False):
    lock = Path(str(path) + ".lock")
    if lock.is_symlink(): raise ValueError("Refusing a symlinked lock")
    if lock.exists() and recover_stale:
        before = lock.stat().st_ino
        metadata = json.loads(lock.read_text())
        pid = metadata.get("pid")
        if metadata.get("database") != str(path) or not isinstance(pid, int) or pid <= 0:
            raise ValueError("Unrecognized instance lock; no file changed")
        try: os.kill(pid, 0)
        except ProcessLookupError:
            if lock.stat().st_ino != before: raise ValueError("Instance lock changed; retry after checking the server")
            lock.unlink()
        else: raise ValueError("Demo server is still running; stop it before reset/backup/restore")
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    inode = os.fstat(fd).st_ino
    with os.fdopen(fd, "w") as handle:
        json.dump({"pid":os.getpid(),"database":str(path)},handle)
    try: yield
    finally:
        if lock.exists() and not lock.is_symlink() and lock.stat().st_ino == inode: lock.unlink()


def snapshot(source, target):
    validate_marked(source)
    target = builder.target_path(str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with closing(sqlite3.connect(source.as_uri()+"?mode=ro",uri=True)) as src, closing(sqlite3.connect(target)) as dest:
        src.backup(dest)
    validate_marked(target)
    return {"name":target.name,"sha256":hashlib.sha256(target.read_bytes()).hexdigest()}


def preserve_current(path):
    name = path.stem + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8] + ".sqlite"
    return snapshot(path, path.parent / "backups" / name)


def install_candidate(path, candidate):
    # Re-check the exact stopped target and switch it to DELETE journaling so
    # an old WAL can never be replayed onto the replacement database.
    if path.exists():
        validate_marked(path)
        with closing(sqlite3.connect(path, timeout=0)) as db:
            mode = db.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
            if mode != "delete": raise ValueError("Database is still in use; replacement refused")
        if Path(str(path)+"-wal").exists() or Path(str(path)+"-shm").exists():
            raise ValueError("Database sidecars remain; replacement refused")
    os.replace(candidate, path)
    return builder.inspect(path)


def perform(action, instance, as_of, restore_name=None, recover_stale=False):
    path = instance_path(instance)
    path.parent.mkdir(parents=True, exist_ok=True)
    with instance_lock(path,recover_stale):
        if action == "backup":
            return {"action":"backup","instance":instance,"backup":preserve_current(path)}
        candidate = path.parent / (instance + "-new-" + uuid.uuid4().hex + ".sqlite")
        try:
            if action == "restore":
                if not restore_name or not re.fullmatch(r"[a-z0-9][a-zA-Z0-9_-]*\.sqlite", restore_name):
                    raise ValueError("Restore requires the simple backup filename printed by a prior backup/reset")
                source = builder.target_path(str(path.parent/"backups"/restore_name))
                if not source.name.startswith(instance + "-"): raise ValueError("Backup belongs to another named instance")
                snapshot(source,candidate)
                builder.inspect(candidate)  # Only compatible schema/fixture revisions can be launched.
            else:
                builder.create(candidate,as_of)
            backup = preserve_current(path) if path.exists() else None
            manifest = install_candidate(path,candidate)
            return {"action":action,"instance":instance,"backup":backup,"manifest":manifest}
        finally:
            if candidate.exists() and not candidate.is_symlink(): candidate.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["reset","backup","restore"])
    parser.add_argument("--instance",default="client-demo")
    parser.add_argument("--as-of",type=date.fromisoformat,default=date.today())
    parser.add_argument("--backup-name")
    parser.add_argument("--recover-stale-lock",action="store_true")
    args=parser.parse_args()
    try:
        result=perform(args.action,args.instance,args.as_of,args.backup_name,args.recover_stale_lock)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except (ValueError,OSError,sqlite3.Error) as exc:
        print(f"Showcase operation refused: {exc}",file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__": raise SystemExit(main())
