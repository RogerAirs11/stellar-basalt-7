"""P01 (R88 agent plan): execution-level adapter parity — SQLite reference side.

Runs the canonical parity sequence (see p01_parity_lib) on a real SQLite
database with ALL migrations applied and pins the per-step semantics:

  * a successful versioned write changes exactly one row and lands exactly one
    idempotency receipt in the same transaction;
  * a replayed idempotency key resolves to the stored receipt (query finds it);
  * the same key with a different payload digest is a unique violation — the
    receipt primary key, not application logic, enforces one-execution-per-key;
  * a stale expected_version changes nothing and the marker gate mints no
    receipt (the receipt trail is exactly as truthful as the state change);
  * renewal reactivates an expired listing; a sibling-active reactivation is
    rejected by the per-horse partial unique index;
  * an organization-mediated grant authorizes the create (in-write authority);
  * marker-conditioned P02 revocation lands exactly one audit event;
  * after revocation the same command is a zero-row no-op; the staff branch
    still passes (bounded, explicit);
  * a concurrent same-key receipt claim can only land once (the P01
    acceptance criterion "two concurrent clients cannot execute the same
    command twice").

The PG side of the comparison lives in scripts/pg-execution-parity.mjs, which
reads the SAME sequence.json and executes the production-translated statements
against a real PostgreSQL. This test additionally proves the SQLite transcript
is DETERMINISTIC (two runs byte-identical) so transcript comparison is sound.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from p01_parity_lib import build_sequence, run_sqlite  # noqa: E402


class P01ExecutionParitySqlite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sequence = build_sequence()
        cls.transcript = run_sqlite(cls.sequence)

    def step(self, step_id):
        for entry in self.transcript["steps"]:
            if entry["id"] == step_id:
                return entry
        raise KeyError(step_id)

    # ------------------------------------------------------------ step semantics

    def test_status_success_changes_one_row_and_lands_one_receipt(self):
        step = self.step("status-success")
        self.assertTrue(step["ok"])
        self.assertEqual(step["changes"], [1, 1])

    def test_replay_lookup_finds_the_stored_receipt(self):
        step = self.step("receipt-replay-lookup")
        self.assertEqual(step["rows"], [{"id": "key-p1", "command": "listing.status",
                                         "target_id": "listing-1", "status_code": 200,
                                         "request_digest": "digest-p1"}])

    def test_same_key_different_payload_is_a_unique_violation(self):
        step = self.step("receipt-conflict")
        self.assertEqual(step["error"], "unique_violation")

    def test_stale_version_changes_nothing_and_mints_no_receipt(self):
        step = self.step("status-stale-version")
        self.assertEqual(step["changes"], [0, 0])

    def test_renew_reactivates_and_sibling_reactivation_hits_the_unique_index(self):
        self.assertEqual(self.step("renew-reactivate")["changes"], [1])
        self.assertEqual(self.step("renew-sibling-unique-index")["error"], "unique_violation")

    def test_organization_grant_authorizes_create(self):
        self.assertEqual(self.step("create-via-org-grant")["changes"], [1])

    def test_inquiry_status_success(self):
        self.assertEqual(self.step("inquiry-status-success")["changes"], [1])

    def test_revocation_lands_marker_conditioned_audit(self):
        self.assertEqual(self.step("p02-revoke-grant")["changes"], [1, 1])

    def test_revoked_grant_is_a_no_op_and_staff_still_passes(self):
        self.assertEqual(self.step("status-after-revoke")["changes"], [0, 0])
        self.assertEqual(self.step("staff-branch")["changes"], [1])

    def test_concurrent_claim_lands_exactly_once(self):
        step = self.step("concurrent-receipt-claim")
        self.assertEqual(step["winners"], 1)
        self.assertEqual(step["errors"], ["unique_violation"])

    # ---------------------------------------- R95-N11 service-request scenarios

    def test_service_create_lands_everything_in_one_batch(self):
        step = self.step("service-create-success")
        self.assertTrue(step["ok"])
        self.assertEqual(step["changes"], [1, 1, 1, 1, 1, 1])

    def test_service_replay_is_a_full_no_op(self):
        self.assertEqual(self.step("service-create-replay")["changes"], [1, 0, 0, 0, 0, 0])

    def test_service_late_block_no_mandate_revoked_mandate_and_self_lead_all_refuse_in_transaction(self):
        for step_id in ("service-create-late-block", "service-create-no-horse-mandate",
                        "service-create-revoked-mandate", "service-create-self-lead"):
            step = self.step(step_id)
            self.assertTrue(step["ok"], step_id)
            self.assertEqual(step["changes"], [1, 0, 0, 0, 0, 0], step_id)

    # ------------------------------------------------- N12 lifecycle semantics

    def test_n12_duplicate_lead_refuses_in_transaction(self):
        # The same provider+category+note inside 24h as service-create-success.
        self.assertEqual(self.step("service-create-duplicate")["changes"], [1, 0, 0, 0, 0, 0])

    def test_n12_provider_block_and_standing_refuse_leads_in_transaction(self):
        self.assertEqual(self.step("service-create-provider-blocked")["changes"], [1, 1, 0, 0, 0, 0, 0])
        self.assertEqual(self.step("service-create-restricted-standing")["changes"], [1, 1, 0, 0, 0, 0, 0])

    def test_n12_consent_withdrawal_zeroes_consent_and_suppresses_pending_notices(self):
        # TWO optional notices were queued for request 1 (created + the v2
        # acknowledge notice; the CAS race step executes the UPDATE alone and
        # mints no notice) — both suppressed by the withdrawal.
        self.assertEqual(self.step("service-consent-withdrawal")["changes"], [1, 2, 1])

    def test_n12_withdrawn_lead_transition_suppresses_its_own_new_notice(self):
        # transition + audit + outbox(v4) + suppress(v4) — the v4 notice is
        # minted and immediately suppressed: after withdrawal the provider is
        # told nothing further about the dead lead.
        self.assertEqual(self.step("service-withdraw-transition-suppress")["changes"], [1, 1, 1, 1])

    def test_n12_provider_block_batch_audits_and_skips_suppression_of_sent_notices(self):
        # insert (1) + suppress (0: every matching notice is already
        # suppressed) + audit (1).
        self.assertEqual(self.step("service-provider-block")["changes"], [1, 0, 1])

    def test_n12_retention_sweep_minimizes_old_terminal_lead_only(self):
        self.assertEqual(self.step("service-retention-sweep")["changes"], [1, 1, 1, 1, 1])

    def test_service_transition_acknowledge_lands_and_wrong_party_and_stale_refuse(self):
        self.assertEqual(self.step("service-transition-acknowledge")["changes"], [1, 1, 1])
        self.assertEqual(self.step("service-transition-wrong-party")["changes"], [0, 0, 0])
        self.assertEqual(self.step("service-transition-stale")["changes"], [0, 0, 0])

    def test_concurrent_service_receipt_claim_lands_exactly_once(self):
        step = self.step("concurrent-service-receipt-claim")
        self.assertEqual(step["winners"], 1)
        self.assertEqual(step["errors"], [])

    def test_concurrent_service_cas_transition_lands_exactly_once(self):
        step = self.step("concurrent-service-transition-cas")
        self.assertEqual(step["winners"], 1)
        self.assertEqual(step["errors"], [])

    # ---------------------------------------------------------- final state pins

    def test_final_listing_state(self):
        rows = self.transcript["snapshot"]["SELECT id,status,row_version FROM sales_listings ORDER BY id"]
        as_dict = {row["id"]: (row["status"], row["row_version"]) for row in rows}
        self.assertEqual(as_dict["listing-1"], ("sold", 3))
        self.assertEqual(as_dict["listing-2"], ("active", 2))
        self.assertEqual(as_dict["listing-2b"], ("expired", 1))
        self.assertEqual(as_dict["listing-3"], ("draft", 1))
        self.assertEqual(as_dict["listing-org"], ("active", 1))

    def test_final_receipt_state_is_exactly_the_executed_commands(self):
        rows = self.transcript["snapshot"]["SELECT id,command,target_id,status_code,request_digest FROM command_receipts ORDER BY id"]
        self.assertEqual([row["id"] for row in rows], ["key-p1", "key-p12"])

    def test_final_grant_state_and_audit_count(self):
        grants = {row["id"]: row["revoked"] for row in
                  self.transcript["snapshot"]["SELECT id,revoked_at IS NOT NULL AS revoked FROM horse_access_grants ORDER BY id"]}
        self.assertEqual(grants["g-seller"], 1)
        self.assertEqual(grants["g-org-5"], 0)
        audit = self.transcript["snapshot"]["SELECT COUNT(*) AS n FROM audit_events WHERE action='grant.revoke'"]
        self.assertEqual(audit, [{"n": 1}])

    def test_final_service_request_state(self):
        rows = self.transcript["snapshot"]["SELECT id,requester_user_id,provider_person_id,category,horse_id,status,row_version FROM service_requests ORDER BY id"]
        self.assertEqual(rows, [
            {"id": 1, "requester_user_id": "svc-req", "provider_person_id": 41, "category": "farrier",
             "horse_id": 7, "status": "withdrawn", "row_version": 5},
            {"id": 50, "requester_user_id": "svc-req", "provider_person_id": 41, "category": "farrier",
             "horse_id": None, "status": "closed", "row_version": 3},
        ])
        receipts = self.transcript["snapshot"]["SELECT id,actor_user_id,request_id FROM service_request_receipts ORDER BY id"]
        self.assertEqual(receipts, [
            {"id": "svc-receipt-1", "actor_user_id": "svc-req", "request_id": 1},
            {"id": "svc-receipt-race", "actor_user_id": "svc-req", "request_id": None},
        ])
        outbox = self.transcript["snapshot"]["SELECT COUNT(*) AS n FROM notification_outbox WHERE purpose='service_request_notice'"]
        self.assertEqual(outbox, [{"n": 4}])
        service_audit = self.transcript["snapshot"]["SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('service_request.created','service_request.transitioned')"]
        self.assertEqual(service_audit, [{"n": 3}])

    def test_final_n12_lifecycle_state(self):
        consent = self.transcript["snapshot"]["SELECT id,share_contact,note_redacted_at IS NOT NULL AS redacted FROM service_requests ORDER BY id"]
        self.assertEqual(consent, [
            {"id": 1, "share_contact": 0, "redacted": 0},   # consent withdrawn
            {"id": 50, "share_contact": 0, "redacted": 1},   # retention-minimized
        ])
        outbox = self.transcript["snapshot"]["SELECT event_key,status,last_error FROM notification_outbox ORDER BY id"]
        self.assertEqual(outbox, [
            {"event_key": "service-request:1:created:svc-prov", "status": "suppressed", "last_error": "consent_withdrawn"},
            {"event_key": "service-request:1:v2:svc-req", "status": "suppressed", "last_error": "consent_withdrawn"},
            {"event_key": "service-request:1:v5:svc-prov", "status": "suppressed", "last_error": "lead_withdrawn"},
            {"event_key": "service-request:50:v5:svc-prov", "status": "suppressed", "last_error": "retention_sweep"},
        ])

    # -------------------------------------------------------------- determinism

    def test_sqlite_transcript_is_deterministic(self):
        second = run_sqlite(self.sequence)
        self.assertEqual(self.transcript, second)


if __name__ == "__main__":
    unittest.main()
