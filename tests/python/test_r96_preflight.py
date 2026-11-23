"""Preflight tests use real migrations, no provider connections or customer data."""
import contextlib
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('r96_preflight',ROOT/'tools/r96-preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'restored.sqlite'
        with contextlib.closing(sqlite3.connect(self.path)) as db:
            for path in sorted((ROOT/'migrations').glob('[0-9]*.sql')):
                if int(path.name.split('_')[0])<=61:
                    db.executescript(path.read_text())
            db.commit()

    def execute(self, sql):
        with contextlib.closing(sqlite3.connect(self.path)) as db:
            db.executescript(sql)
            db.commit()

    def test_clean_schema_is_read_only(self):
        before=hashlib.sha256(self.path.read_bytes()).hexdigest()
        result=preflight.inspect(self.path)
        self.assertTrue(result['ok']);self.assertTrue(result['read_only'])
        self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_missing_file_is_not_created(self):
        p=self.path.parent/'missing.sqlite'
        with self.assertRaises(ValueError):preflight.inspect(p)
        self.assertFalse(p.exists())

    def test_bad_schema_fails_closed(self):
        self.execute('DROP TABLE refund_events; DROP TABLE refund_requests;')
        self.assertFalse(preflight.inspect(self.path)['ok'])

    def refund_fixture(self):
        self.execute("""INSERT INTO orders(id,order_key,buyer_user_id,total_minor,status,price_snapshot_json)
            VALUES(1,'synthetic-order','buyer',10000,'paid','[]');
            INSERT INTO payment_attempts(id,order_id,provider,amount_minor,currency,state)
            VALUES(1,1,'zarinpal',10000,'IRR','verified');
            INSERT INTO refund_requests(id,order_id,payment_attempt_id,request_key,kind,amount_minor,status,
              reason,requested_by_user_id,entitlement_policy_json)
            VALUES(1,1,1,'refund-one','full_unused',10000,'requested','Synthetic reason','buyer','{}');""")

    def test_duplicate_active_refunds_block_upgrade(self):
        self.refund_fixture()
        self.execute("INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,status,reason,requested_by_user_id,entitlement_policy_json) VALUES(1,1,'refund-two','full_unused',10000,'approved','Synthetic reason','buyer','{}')")
        result=preflight.inspect(self.path)
        self.assertFalse(result['ok']);self.assertEqual(result['blockers']['multiple_active_or_confirmed_refunds_for_one_attempt'],1)

    def test_terminal_failed_history_does_not_block_new_request(self):
        self.refund_fixture()
        self.execute("UPDATE refund_requests SET status='failed'; INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,status,reason,requested_by_user_id,entitlement_policy_json) VALUES(1,1,'refund-two','full_unused',10000,'requested','Synthetic reason','buyer','{}')")
        self.assertEqual(preflight.inspect(self.path)['blockers']['multiple_active_or_confirmed_refunds_for_one_attempt'],0)

    def test_invalid_refund_amount_is_not_silently_repaired(self):
        self.refund_fixture();self.execute('UPDATE refund_requests SET amount_minor=12000')
        result=preflight.inspect(self.path);self.assertFalse(result['ok'])
        self.assertEqual(result['blockers']['refund_amount_or_parent_mismatch'],1)

    def test_redacted_digest_warning_never_prints_private_note(self):
        secret='DO NOT PRINT THIS PRIVATE NOTE'
        self.execute(f"INSERT INTO people(id,name_latin) VALUES(1,'Synthetic person'); INSERT INTO service_requests(requester_user_id,provider_person_id,category,note,status,note_redacted_at,note_digest) VALUES('buyer',1,'trainer','{secret}','closed','2024-01-01','retention:preexisting')")
        result=preflight.inspect(self.path)
        self.assertEqual(result['warnings']['redacted_notes_without_valid_original_digest_shape'],1)
        self.assertNotIn(secret,json.dumps(result))

    def test_upgrade_preserves_rows_and_adds_required_columns(self):
        self.refund_fixture()
        with contextlib.closing(sqlite3.connect(self.path)) as db:
            before=list(db.execute('SELECT id,order_id,amount_minor,status FROM refund_requests'))
            for p in sorted((ROOT/'migrations').glob('[0-9]*.sql')):
                if int(p.name.split('_')[0])>61:db.executescript(p.read_text())
            self.assertEqual(before,list(db.execute('SELECT id,order_id,amount_minor,status FROM refund_requests')))
            self.assertIn('confirmation_source',{r[1] for r in db.execute('PRAGMA table_info(refund_requests)')})
            self.assertIn('creation_operation_id',{r[1] for r in db.execute('PRAGMA table_info(service_request_blocks)')})
            self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            db.commit()
        self.assertTrue(preflight.inspect(self.path)['ok'])

if __name__=='__main__':unittest.main()
