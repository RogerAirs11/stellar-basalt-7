#!/usr/bin/env python3
"""Comprehensive pure-source export for master-AI observation and testing.

Enumerates TRACKED files only (git ls-files) so untracked sandbox junk can
never leak into a package. Includes every code, schema, seed, config and
documentation file needed to observe and test the platform: application
source with all five frontend kits, public frontends (classic-registry UI,
business-model, demo-pay), standalone frontends, database migrations plus
full sandbox schemas and demo seed data, tests, tools, scripts, the sandbox
dev kit, CI workflows, the dependency lockfile, REVIEW_HANDOFF.json and the
main documentation set (README, SETUP, TODO, CHANGELOG, PROJECT-MEMORY,
PROJECT_CONTINUITY, docs/, audit/ observation history and the current
current review round workspaces).

Intentionally excluded: binary assets (images/fonts/audio/3D), the live
database and any dumps, secrets, build outputs, derived round-to-round
.patch diffs, *.bak residues, and superseded round workspaces/documents
(review-r96, review-r97 and the R88/R95/R96/R97-era root residue docs).

No builds, installs, DB access or network calls. Never deletes a staging
tree. The credential-pattern check is a safeguard, not proof that code has
no secrets.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
import os

SOURCE_DIRS = ('src', 'tests', 'tools', 'scripts', 'migrations', 'supabase', '.github',
               'standalone-frontends', 'public', 'docs', 'audit', 'sandbox', 'seed')
# Round workspaces ship automatically: every tracked top-level review-r<number>/ dir
# is included (review-r98, review-r102, ...) EXCEPT the retired-residue rounds
# review-r96/review-r97 pinned in EXCLUDED_PARTS. New rounds can never be
# forgotten again (R103 export initially missed review-r102 this way).
ROUND_DIR_RE = re.compile(r'review-r\d+$')
ROOT_TSCONFIG_RE = re.compile(r'tsconfig(?:\.[A-Za-z0-9_-]+)*\.json$')
ROUND_START_RE = re.compile(r'R[1-9][0-9]*_START_HERE\.md$')
ROOT_FILES = ('package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
              'requirements.txt', 'index.html', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json',
              'tsconfig.backend-core.json', 'tsconfig.frontend-kit.json', 'tsconfig.pedigree.json',
              'wrangler.jsonc', 'wrangler.staging.jsonc', '.env.example', '.gitignore',
              'tools-turso-sync.mjs', 'REVIEW_HANDOFF.json', 'REVIEW_CURRENT.json',
              # main documentation and standing workspace state
              'README.md', 'SETUP.md', 'TODO.md', 'CHANGELOG.md', 'PROJECT-MEMORY.md',
              'PROJECT_CONTINUITY.md', 'R98_START_HERE.md', 'PRIVATE_PROJECT.md',
              'RELEASE-MANIFEST.json', 'SHA256SUMS.txt', '.workspace-version',
              '.nvmrc', '.node-version',
              # local launcher / operator tooling (code)
              'Deploy Horse Registry to Cloudflare.bat', 'Launch Horse Registry.bat',
              'HorseRegistryLauncher.ps1', 'Refresh Local SQLite from XLSX.bat')
EXCLUDED_PARTS = {'.git', 'node_modules', '__pycache__', '.pytest_cache', 'dist', 'coverage',
                  '.venv', 'venv', 'review-r96', 'review-r97'}
EXCLUDED_ROOT_DIRS = {'data'}
EXCLUDED_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
                     '.woff', '.woff2', '.ttf', '.otf', '.wav', '.mp3', '.mp4', '.glb', '.pdf',
                     '.xlsx', '.xls', '.sqlite', '.sqlite3', '.db', '.pyc', '.zip', '.gz', '.br',
                     '.wasm', '.bin', '.dat', '.bmp', '.tiff', '.mov', '.flac', '.riv',
                     '.patch', '.bak', '.r83bak'}
# Superseded round-residue documents at repo root. Their round history stays
# observable inside audit/<round>/; these root copies only point at retired
# rounds (R88/R95/R96/R97) and would mislead a fresh reviewer.
EXCLUDED_ROOT_DOCS = {'AGENT-START-HERE.md', 'AGENT_START_HERE.md', 'CHANGELOG-R88.md',
                      'R95_AGENT_PLAN.md', 'R95_AGENT_TASKS.json', 'R95_CHANGE_MANIFEST.json',
                      'R95_CODE_REVIEW.md', 'R95_MIGRATION_RUNBOOK.md', 'R95_README.md',
                      'R95_TEST_REPORT.md', 'R96-START-HERE.md', 'R97-START-HERE.md',
                      'R97_CHANGELOG.md', 'README-R88.md', 'README-R96.md'}
TOKEN_PATTERNS = [re.compile(p) for p in (
    r'ghp_[A-Za-z0-9]{20,}', r'github_pat_[A-Za-z0-9_]{20,}', r'cfat_[A-Za-z0-9]{20,}',
    r'sbp_v0_[A-Za-z0-9]{20,}', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
)]

def included(rel: str) -> bool:
    parts = rel.split('/')
    # The top-level data tree contains database exports and must stay private.
    # Nested source directories such as Retro's data/ contain required TypeScript;
    # excluding every directory named data silently broke the supplied archive.
    if len(parts) > 1 and parts[0] in EXCLUDED_ROOT_DIRS:
        return False
    # EXCLUDED_PARTS names DIRECTORIES (e.g. data/, review-r96/); testing only
    # the parent components keeps legitimately-named files (src/data) shippable.
    if any(part in EXCLUDED_PARTS for part in parts[:-1]):
        return False
    if rel in EXCLUDED_ROOT_DOCS:
        return False
    if Path(rel).suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    name = parts[-1]
    if name.startswith('.env') and rel != '.env.example':
        return False
    top = parts[0]
    if top in SOURCE_DIRS or ROUND_DIR_RE.fullmatch(top):
        return True
    return rel in ROOT_FILES or (len(parts) == 1 and bool(ROOT_TSCONFIG_RE.fullmatch(rel) or ROUND_START_RE.fullmatch(rel)))

def assert_referenced_configs_present(payload: dict[str, bytes]) -> None:
    """An export must not discard the configs that its own npm gates execute."""
    package = json.loads(payload.get('package.json', b'{}'))
    scripts = package.get('scripts', {})
    if not isinstance(scripts, dict):
        raise ValueError('package.json scripts must be an object')
    # Recognize the explicit tsc project forms used by this repository, including
    # quoted paths; do not execute shell snippets or expand environment values.
    pattern = re.compile(r"(?:^|[;&|]\s*)?(?:npx\s+)?(?:tsc|vue-tsc)\s+(?:-[^\s;&|]+\s+)*?(?:-p|--project)(?:=|\s+)[\"']?([A-Za-z0-9_./-]+\.json)")
    for name, command in scripts.items():
        if not isinstance(command, str):
            continue
        for match in pattern.finditer(command):
            path = match.group(1).removeprefix('./')
            if '..' in Path(path).parts or path.startswith('/') or path not in payload:
                raise ValueError(f'Npm script {name} references a missing or unexported TypeScript config: {path}')


def tracked_files(repo: Path) -> tuple[list[str], str]:
    """Return (paths, enumeration_mode). Prefers the git-tracked listing,
    which is what protects real exports from untracked sandbox junk (an
    untracked stray file leaked into the R101 archive this way). Trees
    without a git repository (e.g. synthetic test fixtures) fall back to a
    filesystem walk under the same exclusion rules."""
    try:
        out = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z'],
                                      stderr=subprocess.DEVNULL, timeout=30)
        return [p.decode('utf-8') for p in out.split(b'\x00') if p], 'git ls-files (tracked files only)'
    except (OSError, subprocess.SubprocessError):
        pass
    found: list[str] = []
    for path in repo.rglob('*'):
        rel = path.relative_to(repo).as_posix()
        if rel.split('/')[0] in EXCLUDED_ROOT_DIRS:
            continue
        if any(part in EXCLUDED_PARTS for part in rel.split('/')[:-1]):
            continue
        if path.is_file():
            found.append(rel)
    return sorted(found), 'filesystem walk (no git repository present)'

def source_files(repo: Path) -> tuple[list[Path], str]:
    names, mode = tracked_files(repo)
    found: list[Path] = []
    for rel in names:
        if not included(rel):
            continue
        path = repo / rel
        if path.is_symlink():
            raise ValueError(f'Symlink is not exportable: {rel}')
        if path.is_file():
            found.append(path)
    return sorted(found, key=lambda p: p.relative_to(repo).as_posix()), mode

def provenance(repo: Path) -> dict[str, object]:
    def git(*args: str) -> str | None:
        try:
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL,
                                           text=True, timeout=5).strip() or None
        except (OSError, subprocess.SubprocessError):
            return None
    commit = git('rev-parse', 'HEAD')
    return {'commit': commit, 'dirty': bool(git('status', '--porcelain')) if commit else None}

def export(repo: Path, output: Path, round_name: str, overwrite: bool = False) -> dict[str, object]:
    repo = repo.resolve()
    if not repo.is_dir() or not (repo / 'package.json').is_file():
        raise ValueError('The source repository must contain package.json')
    if not re.fullmatch(r'R[1-9][0-9]{0,5}', round_name):
        raise ValueError('Round must have the form R102')
    if output.is_symlink():
        raise ValueError('Output must not be a symlink')
    output = output.absolute()
    if output.suffix.lower() != '.zip':
        raise ValueError('Output must end in .zip')
    if output.exists() and not overwrite:
        raise FileExistsError('Output exists; use --overwrite explicitly')
    files, enumeration_mode = source_files(repo)
    payload: dict[str, bytes] = {}
    for path in files:
        rel = path.relative_to(repo).as_posix()
        if path.resolve() == output.resolve():
            raise ValueError('Output overlaps a selected input')
        raw = path.read_bytes()
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError as exc:
            raise ValueError(f'Non-text file in pure-source selection: {rel}') from exc
        if '\x00' in text:
            raise ValueError(f'NUL bytes in pure-source selection: {rel}')
        # R143: REDACT instead of fail — the repo's PROJECT-MEMORY credential
        # recovery block (owner directive: keys always recoverable from the
        # repo) must never ship in a Master-AI zip, but a redacted copy keeps
        # the documentation context intact. The guard still refuses files
        # whose ONLY content value would be the secret itself is not
        # detectable here; redaction covers the documented token formats.
        redacted = text
        for pattern in TOKEN_PATTERNS:
            redacted = pattern.sub(lambda m: m.group(0)[:6] + '...REDACTED', redacted)
        if redacted != text:
            raw = redacted.encode('utf-8')
        payload[rel] = raw
    assert_referenced_configs_present(payload)
    meta = provenance(repo)
    info = (
        f'Horse Registry - comprehensive pure-source export, {round_name}\n'
        f'Commit: {meta["commit"] or "unavailable"}; working tree dirty: {meta["dirty"]}\n'
        'This export makes NO claim that builds, tests, production, or paid workflows are complete.\n'
        'Included: ALL tracked code and documentation - application source with the five frontend\n'
        'kits, public frontends (classic-registry UI, business-model, demo-pay), standalone\n'
        'frontends, database migrations plus full sandbox schema SQL/JSON and seed/demo.sql,\n'
        'tests, tools, scripts, the sandbox dev kit, CI workflows, the dependency lockfile,\n'
        'REVIEW_HANDOFF.json, REVIEW_CURRENT.json, and the main documentation set (README, SETUP, TODO, CHANGELOG,\n'
        'PROJECT-MEMORY, PROJECT_CONTINUITY, docs/, audit/ observation history, all maintained\n'
        'review-round workspaces, current START_HERE documents, launcher scripts).\n'
        'Excluded by design: binary assets (images, fonts, audio, 3D models), the live database\n'
        'and any data dumps, secrets, build outputs, derived round-to-round .patch diffs, *.bak\n'
        'residues, superseded round workspaces (review-r96, review-r97) and their root-level\n'
        'residue documents from retired rounds (R88/R95/R96/R97 era).\n'
        'Binary assets are referenced by path only; fetch them from the upstream repository when\n'
        'a visual build is required. Dependency installation and asset-dependent gates still\n'
        'require the matching external packages and authorized source asset bundle.\n'
        + ('See REVIEW_HANDOFF.json for carried review state and its evidence limitations.\n' if 'REVIEW_HANDOFF.json' in payload else 'WARNING: no REVIEW_HANDOFF.json was supplied; prior review context is not included.\n')
        + 'Verify included paths against EXPORT_MANIFEST.json. It does not attest omitted upstream files.\n'
        'Install the exact lockfile for typecheck and tests. The normal production build requires original assets.\n'
        'Use the current round START_HERE guide for any explicitly isolated source-preview mode.\n'
    ).encode()
    payload['PACKAGE-INFO.txt'] = info
    manifest = {'schema_version': 1, 'round': round_name, 'source': meta,
                'enumeration': enumeration_mode,
                'scope': 'comprehensive: all tracked code, schema, seed, config and documentation; '
                         'binary assets, database dumps, secrets, build outputs and superseded '
                         'round residue excluded',
                'has_dependency_lockfile': any(p in payload for p in ('package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock')),
                'has_handoff': 'REVIEW_HANDOFF.json' in payload,
                'files': [{'path': p, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                          for p, raw in sorted(payload.items())],
                'manifest_self_excluded': True}
    payload['EXPORT_MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix='.source-export-', suffix='.zip', dir=output.parent, delete=False) as handle:
        temp = Path(handle.name)
    try:
        with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path, raw in sorted(payload.items()):
                entry = zipfile.ZipInfo('horse-registry-src/' + path, (1980,1,1,0,0,0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = (0o100644 << 16)
                archive.writestr(entry, raw)
        if overwrite:
            os.replace(temp, output)
        else:
            # Atomic no-clobber publication; an output appearing during export
            # must not be silently overwritten.
            os.link(temp, output)
            temp.unlink()
    finally:
        temp.unlink(missing_ok=True)
    return {'output': str(output), 'files': len(payload), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'has_dependency_lockfile': manifest['has_dependency_lockfile'], 'has_handoff': manifest['has_handoff']}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--round', default='R102')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(export(args.repo,args.output,args.round,args.overwrite),indent=2))
        return 0
    except (OSError, ValueError) as exc:
        parser.exit(2, str(exc)+'\n')

if __name__ == '__main__':
    raise SystemExit(main())
