"""P05 (R88 agent plan, R91 enforcement layer): the D1 rate-limit counter
statement on a REAL in-memory SQLite with all migrations applied.

The Cloudflare rate-limiting binding was proven (live probe, 2026-10-03) to
admit every request on this account, so the fixed-window counter upsert is
the actual enforcement. These tests regex-extract the EXACT production
statement from src/security/rateLimit.ts and pin its semantics on a real
engine:

  * the first request in a window inserts count=1;
  * repeated requests in the SAME window increment atomically (each statement
    returns its own position, so no two concurrent callers can both see the
    same count);
  * a NEW window resets the counter to 1 (fixed one-minute windows);
  * the count CHECK constraint rejects corruption;
  * one row per key forever (counters are reused in place, not appended) —
    storage is bounded by key cardinality, not request volume.
"""
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

WINDOW_A = "2026-10-03T13:30:00.000Z"
WINDOW_B = "2026-10-03T13:31:00.000Z"


def extract_upsert() -> str:
    source = (ROOT / "src/security/rateLimit.ts").read_text()
    match = re.search(r'RATE_LIMIT_UPSERT_SQL = `([\s\S]*?)`;', source)
    assert match, "RATE_LIMIT_UPSERT_SQL not found in rateLimit.ts"
    return match.group(1)


class P05RateLimitCounters(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.upsert = extract_upsert()

    def tearDown(self):
        self.db.close()

    def count(self, key: str, window: str) -> int:
        row = self.db.execute(self.upsert, (key, window)).fetchone()
        return row[0]

    def test_first_request_inserts_one_and_same_window_increments(self):
        self.assertEqual(self.count("d1:auth:1.2.3.4", WINDOW_A), 1)
        self.assertEqual(self.count("d1:auth:1.2.3.4", WINDOW_A), 2)
        self.assertEqual(self.count("d1:auth:1.2.3.4", WINDOW_A), 3)

    def test_new_window_resets_to_one(self):
        for _ in range(10):
            self.count("d1:auth:1.2.3.4", WINDOW_A)
        self.assertEqual(self.count("d1:auth:1.2.3.4", WINDOW_B), 1)
        self.assertEqual(self.count("d1:auth:1.2.3.4", WINDOW_B), 2)

    def test_keys_are_isolated(self):
        self.count("d1:auth:1.2.3.4", WINDOW_A)
        self.count("d1:auth:1.2.3.4", WINDOW_A)
        # A different IP starts its own window at 1.
        self.assertEqual(self.count("d1:auth:5.6.7.8", WINDOW_A), 1)
        # The account-class key is a separate namespace from the IP key.
        self.assertEqual(self.count("d1:login-account:abc123", WINDOW_A), 1)

    def test_one_row_per_key_not_one_row_per_request(self):
        for _ in range(25):
            self.count("d1:write:1.2.3.4", WINDOW_A)
        rows = self.db.execute("SELECT COUNT(*) FROM rate_limit_counters WHERE key='d1:write:1.2.3.4'").fetchone()
        self.assertEqual(rows[0], 1)
        stored = self.db.execute("SELECT count FROM rate_limit_counters WHERE key='d1:write:1.2.3.4'").fetchone()
        self.assertEqual(stored[0], 25)

    def test_check_constraint_rejects_a_corrupted_counter(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO rate_limit_counters(key,window_start,count) VALUES('bad','w',-1)")
        self.db.rollback()

    def test_the_budgets_match_the_binding_configuration(self):
        # The D1 layer must mirror the binding limits it enforces on behalf of.
        source = (ROOT / 'src/security/rateLimit.ts').read_text()
        self.assertIn('auth: 10', source)
        self.assertIn('write: 30', source)
        self.assertIn('expensive: 12', source)
        self.assertIn('accountLogin: 5', source)
        wrangler = (ROOT / 'wrangler.jsonc').read_text()
        self.assertIn('"limit": 10', wrangler)
        self.assertIn('"limit": 30', wrangler)
        self.assertIn('"limit": 12', wrangler)
        self.assertIn('"limit": 5', wrangler)


if __name__ == "__main__":
    unittest.main()
