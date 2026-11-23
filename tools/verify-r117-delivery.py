#!/usr/bin/env python3
"""Verify the R117 delivery manifest without modifying the source tree."""
import hashlib,json,sys
from pathlib import Path,PurePosixPath
root=Path(__file__).resolve().parents[1];path=root/'DELIVERY_MANIFEST.json'
if not path.is_file():raise SystemExit('DELIVERY_MANIFEST.json is created when the source export is packaged.')
manifest=json.loads(path.read_text());fail=[]
for row in manifest['files']:
 p=PurePosixPath(row['path'])
 if p.is_absolute() or '..' in p.parts:fail.append({'path':str(p),'reason':'unsafe path'});continue
 target=root.joinpath(*p.parts)
 if target.is_symlink() or not target.is_file():fail.append({'path':str(p),'reason':'missing/non-regular'});continue
 actual=hashlib.sha256(target.read_bytes()).hexdigest()
 if actual!=row['sha256']:fail.append({'path':str(p),'reason':'sha256 mismatch'})
print(json.dumps({'checked':len(manifest['files']),'failures':fail},indent=2))
sys.exit(1 if fail else 0)
