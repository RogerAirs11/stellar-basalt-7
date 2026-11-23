"""Run production TypeScript commands against real SQLite once per Python run.
These assertions overlap the native suite; do NOT add their counts as independent
coverage. This replaces brittle copied/source-string SQL, not application code.
"""
from functools import lru_cache
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]

@lru_cache(maxsize=2)
def _native_run(suite):
    run = subprocess.run(['node', '--test', '--test-reporter=tap', suite],
                         cwd=ROOT, text=True, capture_output=True, timeout=90, check=False)
    return run

def native_passed_tests(suite="tools/test-r95-runtime.cjs"):
    if suite not in {"tools/test-r95-runtime.cjs","tools/test-r97-runtime.cjs"}:
        raise ValueError("Unknown native suite")
    run = _native_run(suite)
    if run.returncode:
        raise AssertionError('Production-command integration tests failed:\n' + run.stdout + '\n' + run.stderr)
    names = set(re.findall(r'^ok \d+ - (.+)$', run.stdout, re.MULTILINE))
    if not names:
        raise AssertionError('Native runner returned no TAP passes; refusing a vacuous pass')
    return names

def assert_native(test_case, *names):
    passed = native_passed_tests()
    for name in names:
        test_case.assertIn(name, passed, 'The corresponding production-command test must execute successfully')


def assert_r97(test_case, *names):
    passed = native_passed_tests("tools/test-r97-runtime.cjs")
    for name in names:
        test_case.assertIn(name, passed)
