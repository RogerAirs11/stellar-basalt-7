"""P15 (R88 agent plan): shareable sale dossiers on a REAL in-memory SQLite
database with ALL migrations applied.

Pins the acceptance criteria with real SQL:

  * the snapshot is FROZEN — a canonical record change after creation never
    rewrites snapshot_json; staleness is detected live at view time by
    comparing horse.updated_at with the snapshot's created_at;
  * the share token hash is the ONLY stored form: the UNIQUE(token_hash)
    lookup is the public view's only entry point, and a revoked/expired link
    matches the guard clauses and reveals nothing;
  * revoking the dossier kills every link in one statement;
  * sections_meta_json records source + review state per section, and the
    CHECK constraint refuses statuses outside active/revoked.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import json
import sqlite3
from r95_native_bridge import assert_native
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SOURCE = (ROOT / 'src' / 'api' / 'modules' / 'dossiers.ts').read_text()
# R95-N13: the mint SQL moved into the command module (mandate-conditioned
# INSERT..SELECT); the view lookup stays in the route. Scan BOTH so the
# extraction always targets the file that actually owns the statement.
SOURCES = [SOURCE, (ROOT / 'src' / 'dossiers' / 'commands.ts').read_text()]


def extract_backtick_block(marker: str) -> str:
    for source in SOURCES:
        if marker in source:
            idx = source.index(marker)
            start = source.rindex('`', 0, idx)
            end = source.index('`', start + 1)
            return source[start + 1:end]
    raise ValueError(f'substring not found: {marker}')


class P15Dossiers(unittest.TestCase):
    def _close_db(self):
        # R109-31: deterministic close — never leave the connection to GC
        # (ResourceWarning source in GC-sensitive environments).
        try:
            self.db.close()
        except Exception:
            pass

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self._close_db)
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller','s@example.invalid','S','x','user')")
        self.db.execute("INSERT INTO horses(id,name_latin,updated_at) VALUES(9,'STAR','2026-10-01 00:00:00')")

    # --------------------------------------------------- the frozen snapshot

    def test_snapshot_never_rewrites_when_canonical_record_changes(self):
        self.db.execute(
            "INSERT INTO dossier_snapshots(horse_id,created_by_user_id,snapshot_json,sections_meta_json,created_at) "
            "VALUES(9,'seller','{\"identity\":{\"name_latin\":\"STAR\"}}','{}','2026-10-01 00:00:00')")
        before = self.db.execute("SELECT snapshot_json FROM dossier_snapshots WHERE id=1").fetchone()[0]
        # A canonical correction lands AFTER the snapshot.
        self.db.execute("UPDATE horses SET name_latin='STAR-II', updated_at='2026-10-02 00:00:00' WHERE id=9")
        after = self.db.execute("SELECT snapshot_json FROM dossier_snapshots WHERE id=1").fetchone()[0]
        self.assertEqual(before, after, 'the frozen bytes must never change')
        # Live staleness detection (the view route's exact comparison):
        horse_updated = self.db.execute("SELECT updated_at FROM horses WHERE id=9").fetchone()[0]
        created = self.db.execute("SELECT created_at FROM dossier_snapshots WHERE id=1").fetchone()[0]
        self.assertGreater(horse_updated, created, 'the view must report stale')

    def test_status_check_constraint_refuses_unknown_states(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO dossier_snapshots(horse_id,created_by_user_id,snapshot_json,sections_meta_json,status) "
                "VALUES(9,'seller','{}','{}','verified_badge')")  # no badge state exists, ever

    # -------------------------------------------------------- share links

    def test_token_hash_is_the_only_stored_form(self):
        insert = extract_backtick_block('INSERT INTO dossier_share_links(dossier_id,token_hash,expires_at,recipient_user_id,created_by_user_id')
        # Substitute the mandate predicate exactly like the production
        # command does (buildActiveGrantPredicate for create_listing).
        marketplace = (ROOT / 'src' / 'marketplace' / 'commands.ts').read_text()
        grant_tmpl = re.search(r'GRANT_PREDICATE_TEMPLATE = `([\s\S]*?)`;', marketplace).group(1)
        insert = insert.replace('{{grantPredicate}}', grant_tmpl
                                .replace('{{horseColumn}}', 'ds.horse_id')
                                .replace('{{viewerSlot}}', '?')
                                .replace('{{relationshipSlots}}', '?,?')).replace('{{editorialSlots}}','?,?,?')
        self.db.execute(
            "INSERT INTO dossier_snapshots(horse_id,created_by_user_id,snapshot_json,sections_meta_json) "
            "VALUES(9,'seller','{}','{}')")
        # R95-N13: the mint is a mandate-conditioned INSERT..SELECT. Bind the
        # full statement (current editorial account short-circuits the grant arm) and
        # execute the ACTUAL production SQL.
        now = '2026-10-01T00:00:00.000Z'
        self.db.execute("UPDATE users SET role='admin' WHERE id='seller'")
        binds = (1, 'a' * 64, '2026-11-01T00:00:00Z', None, 'seller', 'op-token-1',
                 1, 'seller', 'seller', 'editor', 'admin', 'super_admin',
                 now, now, 'seller', 'seller', now, now, 'create_listing', 'owner', 'seller')
        self.db.execute(insert, binds)
        stored = self.db.execute("SELECT token_hash FROM dossier_share_links WHERE dossier_id=1").fetchone()[0]
        self.assertRegex(stored, '^[0-9a-f]{64}$')
        # The mandate arm exists in the SAME statement: with the current non-editorial role
        # and no grant, the identical mint inserts nothing.
        self.db.execute("UPDATE users SET role='user' WHERE id='seller'")
        no_grant_binds = (1, 'b' * 64, '2026-11-01T00:00:00Z', None, 'seller', 'op-token-2',
                          1, 'seller', 'seller', 'editor', 'admin', 'super_admin',
                          now, now, 'seller', 'seller', now, now, 'create_listing', 'owner', 'seller')
        self.db.execute(insert, no_grant_binds)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dossier_share_links").fetchone()[0], 1)

    def test_revoked_and_expired_links_match_the_view_guards(self):
        lookup = extract_backtick_block('FROM dossier_share_links l WHERE l.token_hash=?')
        self.db.execute(
            "INSERT INTO dossier_snapshots(horse_id,created_by_user_id,snapshot_json,sections_meta_json) "
            "VALUES(9,'seller','{}','{}')")
        # One revoked, one expired, one live link.
        self.db.execute("INSERT INTO dossier_share_links(dossier_id,token_hash,expires_at,revoked_at,created_by_user_id) "
                        "VALUES(1,?,'2027-01-01T00:00:00Z','2026-10-02T00:00:00Z','seller')", ('b' * 64,))
        self.db.execute("INSERT INTO dossier_share_links(dossier_id,token_hash,expires_at,created_by_user_id) "
                        "VALUES(1,?,'2026-01-01T00:00:00Z','seller')", ('c' * 64,))
        self.db.execute("INSERT INTO dossier_share_links(dossier_id,token_hash,expires_at,created_by_user_id) "
                        "VALUES(1,?,'2027-01-01T00:00:00Z','seller')", ('d' * 64,))
        revoked = self.db.execute(lookup, ('b' * 64,)).fetchone()
        expired = self.db.execute(lookup, ('c' * 64,)).fetchone()
        live = self.db.execute(lookup, ('d' * 64,)).fetchone()
        self.assertIsNotNone(revoked)
        self.assertIsNotNone(revoked[3], 'revoked_at must be set for the 410 branch')
        self.assertLess(expired[2], '2026-10-03T00:00:00Z', 'expires_at in the past selects the 410 branch')
        self.assertIsNone(live[3])
        self.assertGreater(live[2], '2026-10-03T00:00:00Z')

    def test_revoking_the_dossier_kills_every_link_in_one_atomic_batch(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'dossier revocation is creator-scoped and only the winner audits and revokes links')

    def test_sections_meta_records_source_and_review_state(self):
        meta = {"genetics": {"source": "seller:redacted", "review_state": "not_shared", "generated_at": "2026-10-01T00:00:00Z"}}
        self.db.execute(
            "INSERT INTO dossier_snapshots(horse_id,created_by_user_id,snapshot_json,sections_meta_json) "
            "VALUES(9,'seller','{\"genetics\":{\"not_shared\":true}}',?)", (json.dumps(meta),))
        stored = json.loads(self.db.execute("SELECT sections_meta_json FROM dossier_snapshots WHERE id=1").fetchone()[0])
        self.assertEqual(stored["genetics"]["review_state"], "not_shared")
        snapshot = json.loads(self.db.execute("SELECT snapshot_json FROM dossier_snapshots WHERE id=1").fetchone()[0])
        self.assertTrue(snapshot["genetics"]["not_shared"], 'redaction is visible, never clean')


if __name__ == '__main__':
    unittest.main()
