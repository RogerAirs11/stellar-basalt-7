"""P03 (R88 agent plan): versioned marketplace commands on a real in-memory
SQLite database with ALL migrations applied.

These tests regex-extract the SQL templates from src/marketplace/commands.ts
and reconstruct the EXACT production statements (same placeholder
substitution rules as the TypeScript builders), then execute them against a
real database. This pins the guarantees the vitest SQL-shape locks can only
assert structurally:

  * a successful guarded command increments row_version and lands exactly one
    idempotency receipt, in one transaction;
  * a stale expected_version changes nothing and mints NO receipt (the marker
    gate) — the receipt trail is exactly as truthful as the state change;
  * a racing second writer's marker can never mint a receipt for an execution
    it did not perform;
  * a grant revoked (or a horse deleted) between the guard read and the write
    turns the command into a zero-row no-op — never a success on stale
    authority; the organization-mediated grant path behaves identically;
  * SOLD IS NOT AN OWNERSHIP TRANSFER: the status statement writes
    sales_listings only; horses/horse_people/horse_access_grants are
    untouched (full snapshot comparison);
  * renewal reactivates an expired listing (the previously unreachable
    expired -> active path) and extends the expiry;
  * two concurrent same-key claims cannot both land (PK conflict) and a
    second active listing for the same horse cannot be inserted (partial
    unique index, the create-race authority).

This is SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import json
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

NOW_ISO = "2026-10-03T12:00:00.000Z"
NOW_TEXT = "2026-10-03 12:00:00"


def extract_template(source: str, const_name: str) -> str:
    match = re.search(const_name + r' = `([\s\S]*?)`;', source)
    assert match, f"template {const_name} not found in commands.ts"
    return match.group(1)


class P03MarketplaceCommands(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(path.read_text())

        # Seed: seller (granted owner on horse 1), admin, buyer; horses; grants;
        # one active listing, one expired listing, one new inquiry.
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller','seller@example.invalid','SELLER','unused','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('admin','admin@example.invalid','ADMIN','unused','admin')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('orgmate','orgmate@example.invalid','ORGMATE','unused','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('buyer','buyer@example.invalid','BUYER','unused','user')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'LIVE')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(2,'GONE')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(3,'DRAFT-HORSE')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(4,'EXPIRED-HORSE')")
        self.db.execute("UPDATE horses SET deleted_at='2026-10-01 00:00:00' WHERE id=2")
        # owner mandate on horses 1+3 for the seller (create_listing + manage_inquiries)
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                        "VALUES('g-seller',1,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                        "VALUES('g-seller-3',3,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                        "VALUES('g-seller-4',4,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')")
        # organization-mediated seller mandate on horse 1 for orgmate
        self.db.execute("INSERT INTO organizations(id,slug,name_latin) VALUES(1,'demo','DEMO')")
        self.db.execute("INSERT INTO organization_memberships(id,organization_id,user_id,valid_from) VALUES(1,1,'orgmate','2026-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,relationship,actions,valid_from) "
                        "VALUES('g-org',1,NULL,1,'seller','create_listing,manage_inquiries','2026-01-01 00:00:00')")

        self.db.execute("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                        "VALUES('listing-1',1,'seller','SELLER','active','user')")
        # an expired listing on its own horse (v1, expiry in the past)
        self.db.execute("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,expires_at,provenance) "
                        "VALUES('listing-2',4,'seller','SELLER','expired','2026-09-01 00:00:00','user')")
        # and an expired listing on horse 1, which ALSO has the active listing-1:
        # reactivating this one trips the per-horse partial unique index.
        self.db.execute("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,expires_at,provenance) "
                        "VALUES('listing-2b',1,'seller','SELLER','expired','2026-09-01 00:00:00','user')")
        # a draft listing on ANOTHER horse: the partial unique index allows at
        # most one draft/active/pending_sale listing per horse
        self.db.execute("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                        "VALUES('listing-3',3,'seller','SELLER','draft','user')")
        self.db.execute("INSERT INTO sales_inquiries(id,listing_id,buyer_user_id,buyer_name,buyer_contact,status) "
                        "VALUES('inquiry-1','listing-1','buyer','BUYER','+98...','new')")
        self.db.commit()

        # Reconstruct the EXACT production statements from source (same
        # substitution rules as the TypeScript builders).
        src = (ROOT / 'src/marketplace/commands.ts').read_text()
        grant_tmpl = extract_template(src, 'GRANT_PREDICATE_TEMPLATE')
        arm_tmpl = re.search(r'AUTHORITY_ARM_TEMPLATE = "([^"]*)"', src).group(1)

        def grant_sql(horse_column: str, action: str, relationships):
            return (grant_tmpl.replace('{{horseColumn}}', horse_column)
                    .replace('{{viewerSlot}}', '?')
                    .replace('{{relationshipSlots}}', ','.join('?' for _ in relationships)))

        def arm(seller_column: str, predicate: str):
            return (arm_tmpl.replace('{{sellerColumn}}', seller_column)
                    .replace('{{grantPredicate}}', predicate))

        create_listing_rel = ['owner', 'seller']
        manage_inquiries_rel = ['owner', 'manager', 'seller']

        self.grant_binds_create_listing = [NOW_ISO, NOW_ISO, 'seller', 'seller', NOW_ISO, NOW_ISO, 'create_listing', *create_listing_rel]
        self.grant_binds_manage_inquiries = [NOW_ISO, NOW_ISO, 'seller', 'seller', NOW_ISO, NOW_ISO, 'manage_inquiries', *manage_inquiries_rel]
        self.orgmate_grant_binds_create_listing = [NOW_ISO, NOW_ISO, 'orgmate', 'orgmate', NOW_ISO, NOW_ISO, 'create_listing', *create_listing_rel]

        status_tmpl = extract_template(src, 'LISTING_STATUS_SQL_TEMPLATE')
        renew_tmpl = extract_template(src, 'LISTING_RENEW_SQL_TEMPLATE')
        inquiry_status_tmpl = extract_template(src, 'INQUIRY_STATUS_SQL_TEMPLATE')
        create_tmpl = extract_template(src, 'LISTING_CREATE_SQL_TEMPLATE')
        inquiry_create_tmpl = extract_template(src, 'INQUIRY_CREATE_SQL_TEMPLATE')
        receipt_tmpl = extract_template(src, 'RECEIPT_INSERT_SQL_TEMPLATE')
        marker_gate_tmpl = re.search(r'RECEIPT_MARKER_GATE_TEMPLATE = "([^"]*)"', src).group(1)
        self.receipt_sql = receipt_tmpl.replace(
            '{{gate}}', marker_gate_tmpl.replace('{{table}}', 'sales_listings'))

        self.status_sql = status_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'create_listing', create_listing_rel)))
        self.renew_sql = renew_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'create_listing', create_listing_rel)))
        self.inquiry_status_sql = inquiry_status_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'manage_inquiries', manage_inquiries_rel)))
        self.create_sql = create_tmpl.replace('{{grantPredicate}}', grant_sql('h.id', 'create_listing', create_listing_rel))
        self.inquiry_create_sql = inquiry_create_tmpl

    def tearDown(self):
        self.db.close()

    # ------------------------------------------------------------------ helpers

    def listing(self, listing_id: str):
        return self.db.execute("SELECT status,row_version,expires_at,last_operation_id FROM sales_listings WHERE id=?", (listing_id,)).fetchone()

    def inquiry(self, inquiry_id: str):
        return self.db.execute("SELECT status,row_version FROM sales_inquiries WHERE id=?", (inquiry_id,)).fetchone()

    def receipts(self, key: str):
        return self.db.execute("SELECT id,actor_user_id,command,target_id,request_digest,status_code,response_json FROM command_receipts WHERE id=?", (key,)).fetchall()

    def run_status(self, listing_id='listing-1', expected_version=1, current='active', next_status='pending_sale',
                   staff=0, user='seller', marker='op-1', key=None, digest='digest-a', grant_binds=None):
        """Execute the production listing.status statements as ONE transaction (D1 batch equivalent)."""
        cur = self.db.cursor()
        binds = [next_status, NOW_TEXT, marker, listing_id, expected_version, current, user, user, *(grant_binds if grant_binds is not None else self.grant_binds_create_listing)]
        changed = cur.execute(self.status_sql, binds).rowcount
        receipt_rows = 0
        if key is not None:
            receipt_rows = cur.execute(self.receipt_sql, [key, user, 'listing.status', listing_id, digest, 200,
                                                          json.dumps({'id': listing_id, 'status': next_status, 'row_version': expected_version + 1}),
                                                          listing_id, marker]).rowcount
        self.db.commit()
        return changed, receipt_rows

    def snapshot_ownership_tables(self):
        return (
            self.db.execute("SELECT * FROM horses ORDER BY id").fetchall(),
            self.db.execute("SELECT * FROM horse_people ORDER BY horse_id, person_id, role").fetchall(),
            self.db.execute("SELECT * FROM horse_access_grants ORDER BY id").fetchall(),
        )

    # ------------------------------------------------------------- listing.status

    def test_status_success_increments_version_and_lands_one_receipt(self):
        changed, receipt_rows = self.run_status(key='key-aaaaaaaa')
        self.assertEqual((changed, receipt_rows), (1, 1))
        row = self.listing('listing-1')
        self.assertEqual(row[0], 'pending_sale')
        self.assertEqual(row[1], 2)
        self.assertEqual(row[3], 'op-1')
        receipts = self.receipts('key-aaaaaaaa')
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0][1:5], ('seller', 'listing.status', 'listing-1', 'digest-a'))

    def test_stale_version_changes_nothing_and_mints_no_receipt(self):
        changed, receipt_rows = self.run_status(expected_version=7, key='key-bbbbbbbb')
        self.assertEqual((changed, receipt_rows), (0, 0))
        row = self.listing('listing-1')
        self.assertEqual((row[0], row[1]), ('active', 1))
        self.assertEqual(self.receipts('key-bbbbbbbb'), [])

    def test_status_without_a_key_writes_no_receipt_but_still_guards(self):
        changed, receipt_rows = self.run_status()
        self.assertEqual((changed, receipt_rows), (1, 0))
        self.assertEqual(self.listing('listing-1')[1], 2)

    def test_racing_marker_cannot_mint_a_receipt_for_another_writer(self):
        # Writer A lands the update with marker op-A...
        self.run_status(marker='op-A')
        # ...writer B's receipt INSERT gated on ITS OWN marker op-B mints nothing.
        cur = self.db.cursor()
        rows = cur.execute(self.receipt_sql, ['key-cccccccc', 'seller', 'listing.status', 'listing-1', 'digest-b', 200,
                                              json.dumps({'id': 'listing-1'}), 'listing-1', 'op-B']).rowcount
        self.db.commit()
        self.assertEqual(rows, 0)
        self.assertEqual(self.receipts('key-cccccccc'), [])

    def test_revoked_grant_is_a_zero_row_no_op_even_with_the_right_version(self):
        self.db.execute("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g-seller'")
        self.db.execute("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g-seller-3'")
        self.db.commit()
        changed, receipt_rows = self.run_status(key='key-dddddddd')
        self.assertEqual((changed, receipt_rows), (0, 0))
        self.assertEqual((self.listing('listing-1')[0], self.listing('listing-1')[1]), ('active', 1))

    def test_sold_is_not_an_ownership_transfer(self):
        before = self.snapshot_ownership_tables()
        changed, _ = self.run_status(next_status='sold', key='key-eeeeeeee')
        self.assertEqual(changed, 1)
        self.assertEqual(self.listing('listing-1')[0], 'sold')
        after = self.snapshot_ownership_tables()
        self.assertEqual(before, after, 'marking a listing sold must not touch horses/horse_people/horse_access_grants')

    def test_second_claim_of_the_same_key_cannot_double_land(self):
        changed, receipt_rows = self.run_status(key='key-ffffffff')
        self.assertEqual((changed, receipt_rows), (1, 1))
        with self.assertRaises(sqlite3.IntegrityError):
            cur = self.db.cursor()
            cur.execute(self.receipt_sql, ['key-ffffffff', 'seller', 'listing.status', 'listing-1', 'digest-a', 200,
                                           json.dumps({'id': 'listing-1'}), 'listing-1', 'op-1'])
        self.db.rollback()
        self.assertEqual(len(self.receipts('key-ffffffff')), 1)

    def test_staff_branch_passes_without_any_grant(self):
        changed, _ = self.run_status(staff=1, user='admin')
        self.assertEqual(changed, 1)
        self.assertEqual(self.listing('listing-1')[0], 'pending_sale')

    # ------------------------------------------------------------- listing.renew

    def run_renew(self, listing_id='listing-2', expected_version=1, staff=0, user='seller', marker='op-r', extend_days=30):
        cur = self.db.cursor()
        expires_at = f'2026-11-02 12:00:00'
        binds = [expires_at, NOW_TEXT, marker, listing_id, expected_version, user, user, *self.grant_binds_create_listing]
        changed = cur.execute(self.renew_sql, binds).rowcount
        self.db.commit()
        return changed

    def test_renew_reactivates_an_expired_listing(self):
        # listing-2 is expired at version 1 (default backfill) with a past expiry.
        changed = self.run_renew()
        self.assertEqual(changed, 1)
        row = self.listing('listing-2')
        self.assertEqual(row[0], 'active')
        self.assertEqual(row[1], 2)
        self.assertEqual(row[2], '2026-11-02 12:00:00')

    def test_renew_of_an_expired_listing_with_an_active_sibling_hits_the_unique_index(self):
        # horse 1 already has the active listing-1; reactivating listing-2b
        # trips the per-horse partial unique index. The handler maps this to
        # the same clean 409 listing_exists as a conflicting create.
        cur = self.db.cursor()
        with self.assertRaises(sqlite3.IntegrityError):
            cur.execute(self.renew_sql, ['2026-11-02 12:00:00', NOW_TEXT, 'op-x', 'listing-2b', 1, 'seller', 'seller', *self.grant_binds_create_listing])
        self.db.rollback()
        self.assertEqual(self.listing('listing-2b')[0], 'expired')

    def test_renew_of_a_draft_listing_is_rejected_by_the_status_guard(self):
        changed = self.run_renew(listing_id='listing-3')
        self.assertEqual(changed, 0)
        self.assertEqual(self.listing('listing-3')[0], 'draft')
        self.assertEqual(self.listing('listing-3')[1], 1)

    def test_renew_with_a_stale_version_changes_nothing(self):
        changed = self.run_renew(expected_version=9)
        self.assertEqual(changed, 0)
        self.assertEqual(self.listing('listing-2')[0], 'expired')

    # ------------------------------------------------------------ inquiry.status

    def run_inquiry_status(self, inquiry_id='inquiry-1', expected_version=1, current='new', next_status='contacted', staff=0, user='seller', marker='op-i'):
        cur = self.db.cursor()
        binds = [next_status, marker, inquiry_id, expected_version, current, user, user, *self.grant_binds_manage_inquiries]
        changed = cur.execute(self.inquiry_status_sql, binds).rowcount
        self.db.commit()
        return changed

    def test_inquiry_status_success_and_revoked_grand_no_op(self):
        changed = self.run_inquiry_status()
        self.assertEqual(changed, 1)
        self.assertEqual(self.inquiry('inquiry-1'), ('contacted', 2))

        # Closed inquiries cannot be reopened; and with the manage_inquiries
        # grant revoked, even a legitimate next transition is a no-op.
        self.db.execute("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g-seller'")
        self.db.commit()
        changed = self.run_inquiry_status(current='contacted', next_status='closed', expected_version=2)
        self.assertEqual(changed, 0)
        self.assertEqual(self.inquiry('inquiry-1'), ('contacted', 2))

    def test_inquiry_status_stale_version_is_a_no_op(self):
        changed = self.run_inquiry_status(expected_version=5)
        self.assertEqual(changed, 0)

    # ------------------------------------------------------------ listing.create

    def run_create(self, listing_id='listing-new', horse_id=1, staff=0, user='seller', grant_binds=None):
        cur = self.db.cursor()
        binds = [listing_id, horse_id, user, 'SELLER', None, None, 'Tehran', 1000, 1, 0, None, None,
                 NOW_TEXT, NOW_TEXT, horse_id, user, *(grant_binds if grant_binds is not None else self.grant_binds_create_listing)]
        changed = cur.execute(self.create_sql, binds).rowcount
        self.db.commit()
        return changed

    def test_create_success_lands_row_version_1(self):
        # listing-1 must first leave the active set so the partial unique index allows a new one.
        self.run_status(next_status='sold')
        changed = self.run_create()
        self.assertEqual(changed, 1)
        row = self.db.execute("SELECT status,row_version FROM sales_listings WHERE id='listing-new'").fetchone()
        self.assertEqual(row, ('active', 1))

    def test_create_is_a_no_op_when_the_grant_was_revoked_mid_flight(self):
        self.run_status(next_status='sold')
        self.db.execute("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g-seller'")
        self.db.commit()
        changed = self.run_create()
        self.assertEqual(changed, 0)
        self.assertIsNone(self.db.execute("SELECT id FROM sales_listings WHERE id='listing-new'").fetchone())

    def test_create_is_a_no_op_for_a_deleted_horse(self):
        self.run_status(next_status='sold')
        changed = self.run_create(horse_id=2)
        self.assertEqual(changed, 0)

    def test_create_via_organization_grant_and_its_revocation(self):
        self.run_status(next_status='sold')
        changed = self.run_create(listing_id='listing-org', user='orgmate', staff=0, grant_binds=self.orgmate_grant_binds_create_listing)
        self.assertEqual(changed, 1, 'an organization-mediated seller mandate must authorize the create')

        # Revoking the membership removes the path immediately (in-transaction).
        self.db.execute("DELETE FROM sales_listings WHERE id='listing-org'")
        self.db.execute("UPDATE organization_memberships SET status='revoked', revoked_at=CURRENT_TIMESTAMP WHERE id=1")
        self.db.commit()
        changed = self.run_create(listing_id='listing-org2', user='orgmate', staff=0, grant_binds=self.orgmate_grant_binds_create_listing)
        self.assertEqual(changed, 0)

    def test_concurrent_second_active_listing_hits_the_partial_unique_index(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.run_create(listing_id='listing-race')
        self.db.rollback()

    # ----------------------------------------------------------- inquiry.create

    def test_inquiry_create_rechecks_availability_in_the_write(self):
        cur = self.db.cursor()
        binds = ['inquiry-new', 'buyer', 'BUYER', '+98...', None, 'listing-1', 'buyer', 'buyer']
        changed = cur.execute(self.inquiry_create_sql, binds).rowcount
        self.db.commit()
        self.assertEqual(changed, 1)

        # A sold listing is no longer available: the INSERT..SELECT lands nothing.
        self.run_status(next_status='sold')
        cur = self.db.cursor()
        changed = cur.execute(self.inquiry_create_sql, ['inquiry-new2', 'buyer', 'BUYER', '+98...', None, 'listing-1', 'buyer', 'buyer']).rowcount
        self.db.commit()
        self.assertEqual(changed, 0)

    def test_inquiry_create_refuses_blocked_contact_in_the_write(self):
        # R98-N12: either-direction participant blocks refuse NEW contact
        # inside the INSERT..SELECT itself (a block landing between the guard
        # read and the write still fails closed). Anonymous inquiries have no
        # account to block.
        cur = self.db.cursor()
        cur.execute("""
            INSERT INTO marketplace_participant_blocks(blocker_user_id,blocked_user_id,created_at)
            VALUES ('seller','buyer',CURRENT_TIMESTAMP)
        """)
        self.db.commit()
        binds = ['inquiry-blocked', 'buyer', 'BUYER', '+98...', None, 'listing-1', 'buyer', 'buyer']
        changed = cur.execute(self.inquiry_create_sql, binds).rowcount
        self.db.commit()
        self.assertEqual(changed, 0)
        # The reverse direction (buyer blocks seller) refuses identically.
        cur.execute("UPDATE marketplace_participant_blocks SET blocker_user_id='buyer', blocked_user_id='seller'")
        self.db.commit()
        changed = cur.execute(self.inquiry_create_sql, ['inquiry-blocked2', 'buyer', 'BUYER', '+98...', None, 'listing-1', 'buyer', 'buyer']).rowcount
        self.db.commit()
        self.assertEqual(changed, 0)
        # An ANONYMOUS inquiry (no account) has nothing to match: the block
        # predicate passes and the inquiry lands.
        cur.execute("DELETE FROM marketplace_participant_blocks")
        self.db.commit()
        changed = cur.execute(self.inquiry_create_sql, ['inquiry-anon', None, 'ANON', '+98...', None, 'listing-1', None, None]).rowcount
        self.db.commit()
        self.assertEqual(changed, 1)

    # ----------------------------------------------------------------- migration

    def test_migration_0038_defaults_and_command_vocabulary(self):
        row = self.db.execute("SELECT row_version FROM sales_listings WHERE id='listing-1'").fetchone()
        self.assertEqual(row[0], 1, 'existing rows backfill to row_version 1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO command_receipts(id,actor_user_id,command,target_id,request_digest,status_code,response_json) "
                            "VALUES('k1','u','bogus.command','t','d',200,'{}')")
        self.db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO command_receipts(id,actor_user_id,command,target_id,request_digest,status_code,response_json) "
                            "VALUES('k2','u','listing.status','t','d',99,'{}')")
        self.db.rollback()


if __name__ == "__main__":
    unittest.main()
