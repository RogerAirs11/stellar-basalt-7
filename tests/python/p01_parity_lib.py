"""P01 (R88 agent plan): EXECUTION-LEVEL database adapter parity — sequence
builder + SQLite reference runner.

The same seed and command sequence must produce equivalent rows and errors on
every supported provider (the P01 acceptance criterion). This module:

  1. builds ONE canonical command sequence from the production SQL templates
     (regex-extracted from TypeScript — the same substitution rules the P03
     suite pins), covering versioned writes, idempotency receipts, marker
     gates, in-write authority (direct grant, organization grant, staff
     branch), the partial-unique-index create race, marker-conditioned P02
     revocation audit, and a concurrent same-key receipt claim;
  2. executes it on a real SQLite database with ALL migrations applied and
     records a normalized transcript;
  3. emits the expanded sequence as JSON so scripts/pg-execution-parity.mjs
     can translate the SAME statements with the PRODUCTION runtime translator
     (src/db/sqliteSqlToPostgres.ts) and execute them against a real
     PostgreSQL, then compare the transcripts.

Everything is deterministic: fixed NOW literals, fixed digests, fixed keys.
The transcript contains only normalized outcomes (changes counts, selected
rows, error CLASSES) — never engine-specific error text.
"""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NOW_ISO = "2026-10-03T12:00:00.000Z"
NOW_TEXT = "2026-10-03 12:00:00"

ERROR_CLASSES = (
    ("UNIQUE constraint", "unique_violation"),
    ("CHECK constraint", "check_violation"),
    ("FOREIGN KEY constraint", "foreign_key_violation"),
)


def classify_sqlite_error(error: Exception) -> str:
    message = str(error)
    for needle, name in ERROR_CLASSES:
        if needle in message:
            return name
    return f"sqlite_error:{type(error).__name__}"


def extract_template(source: str, const_name: str) -> str:
    match = re.search(const_name + r' = `([\s\S]*?)`;', source)
    assert match, f"template {const_name} not found"
    return match.group(1)


def build_sequence():
    """Return the engine-agnostic expanded sequence (SQLite dialect SQL)."""
    commands_src = (ROOT / 'src/marketplace/commands.ts').read_text()
    access_src = (ROOT / 'src/access/horseAccess.ts').read_text()
    services_src = (ROOT / 'src/services/commands.ts').read_text()
    services_policy_src = (ROOT / 'src/services/policy.ts').read_text()
    services_privacy_src = (ROOT / 'src/services/privacy.ts').read_text()

    # R95-N12: the receipt template interpolates the anti-abuse constants via
    # TS template literals — resolve them from the ONE source of truth.
    max_daily = re.search(r'export const MAX_NEW_REQUESTS_PER_DAY = (\d+);', services_privacy_src).group(1)
    max_category = re.search(r'export const MAX_NEW_PER_CATEGORY_PER_DAY = (\d+);', services_privacy_src).group(1)

    grant_tmpl = extract_template(commands_src, 'GRANT_PREDICATE_TEMPLATE')
    arm_tmpl = re.search(r'AUTHORITY_ARM_TEMPLATE = "([^"]*)"', commands_src).group(1)
    status_tmpl = extract_template(commands_src, 'LISTING_STATUS_SQL_TEMPLATE')
    renew_tmpl = extract_template(commands_src, 'LISTING_RENEW_SQL_TEMPLATE')
    inquiry_status_tmpl = extract_template(commands_src, 'INQUIRY_STATUS_SQL_TEMPLATE')
    create_tmpl = extract_template(commands_src, 'LISTING_CREATE_SQL_TEMPLATE')
    receipt_tmpl = extract_template(commands_src, 'RECEIPT_INSERT_SQL_TEMPLATE')
    marker_gate_tmpl = re.search(r'RECEIPT_MARKER_GATE_TEMPLATE = "([^"]*)"', commands_src).group(1)
    revoke_grant_sql = re.search(r'REVOKE_GRANT_SQL = `([\s\S]*?)`', access_src).group(1)
    grant_audit_sql = re.search(r'GRANT_REVOKE_AUDIT_SQL = `([\s\S]*?)`', access_src).group(1)

    def grant_sql(horse_column, action, relationships):
        return (grant_tmpl.replace('{{horseColumn}}', horse_column)
                .replace('{{viewerSlot}}', '?')
                .replace('{{relationshipSlots}}', ','.join('?' for _ in relationships)))

    def arm(seller_column, predicate):
        return (arm_tmpl.replace('{{sellerColumn}}', seller_column)
                .replace('{{grantPredicate}}', predicate))

    def receipt_sql(table='sales_listings'):
        return receipt_tmpl.replace('{{gate}}', marker_gate_tmpl.replace('{{table}}', table))

    rel_create = ['owner', 'seller']
    rel_manage = ['owner', 'manager', 'seller']
    seller_grants = [NOW_ISO, NOW_ISO, 'seller', 'seller', NOW_ISO, NOW_ISO, 'create_listing', *rel_create]
    orgmate_grants = [NOW_ISO, NOW_ISO, 'orgmate', 'orgmate', NOW_ISO, NOW_ISO, 'create_listing', *rel_create]
    seller_manage = [NOW_ISO, NOW_ISO, 'seller', 'seller', NOW_ISO, NOW_ISO, 'manage_inquiries', *rel_manage]

    status_sql = status_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'create_listing', rel_create)))
    renew_sql = renew_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'create_listing', rel_create)))
    inquiry_status_sql = inquiry_status_tmpl.replace('{{authorityArm}}', arm('l.seller_user_id', grant_sql('l.horse_id', 'manage_inquiries', rel_manage)))
    create_sql = create_tmpl.replace('{{grantPredicate}}', grant_sql('h.id', 'create_listing', rel_create))
    receipts_sql = receipt_sql()

    def status(next_status, marker, listing_id, expected_version, current, staff, user, grant_binds):
        return {"sql": status_sql, "args": [next_status, NOW_TEXT, marker, listing_id, expected_version,
                                            current, user, user, *grant_binds]}

    def receipt(key, user, command, target, digest, response, marker):
        return {"sql": receipts_sql, "args": [key, user, command, target, digest, 200, response, target, marker]}

    seed = [
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller','seller@example.invalid','SELLER','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('admin','admin@example.invalid','ADMIN','unused','admin')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('orgmate','orgmate@example.invalid','ORGMATE','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('buyer','buyer@example.invalid','BUYER','unused','user')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(1,'LIVE')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(3,'DRAFT-HORSE')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(4,'EXPIRED-HORSE')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(5,'ORG-HORSE')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                "VALUES('g-seller',1,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                "VALUES('g-seller-3',3,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                "VALUES('g-seller-4',4,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO organizations(id,slug,name_latin) VALUES(1,'demo','DEMO')", "args": []},
        {"sql": "INSERT INTO organization_memberships(id,organization_id,user_id,valid_from) VALUES(1,1,'orgmate','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,relationship,actions,valid_from) "
                "VALUES('g-org',1,NULL,1,'seller','create_listing,manage_inquiries','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,relationship,actions,valid_from) "
                "VALUES('g-org-5',5,NULL,1,'seller','create_listing','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                "VALUES('listing-1',1,'seller','SELLER','active','user')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,expires_at,provenance) "
                "VALUES('listing-2',4,'seller','SELLER','expired','2026-09-01 00:00:00','user')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,expires_at,provenance) "
                "VALUES('listing-2b',1,'seller','SELLER','expired','2026-09-01 00:00:00','user')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                "VALUES('listing-3',3,'seller','SELLER','draft','user')", "args": []},
        {"sql": "INSERT INTO sales_inquiries(id,listing_id,buyer_user_id,buyer_name,buyer_contact,status) "
                "VALUES('inquiry-1','listing-1','buyer','BUYER','+98...','new')", "args": []},
    ]

    receipt_row = json.dumps({"id": "listing-1", "status": "pending_sale", "row_version": 2})

    # ------------------------------------------------------------------
    # R95-N11 service-request scenarios: the create transaction re-checks
    # self-lead, publication, block, open-quota and the CURRENT horse
    # mandate inside the receipt INSERT; the transition UPDATE carries the
    # actor authority arm; two real connections race the same receipt key
    # and the same CAS transition.
    # ------------------------------------------------------------------
    svc_receipt_tmpl = extract_template(services_src, 'SERVICE_RECEIPT_INSERT_SQL')
    svc_request_tmpl = extract_template(services_src, 'SERVICE_REQUEST_INSERT_SQL')
    svc_link_tmpl = extract_template(services_src, 'SERVICE_RECEIPT_LINK_SQL')
    svc_create_audit_tmpl = extract_template(services_src, 'SERVICE_CREATE_AUDIT_SQL')
    svc_create_outbox_tmpl = extract_template(services_src, 'SERVICE_CREATE_OUTBOX_SQL')
    svc_transition_tmpl = extract_template(services_src, 'SERVICE_TRANSITION_UPDATE_SQL')
    svc_transition_audit_tmpl = extract_template(services_src, 'SERVICE_TRANSITION_AUDIT_SQL')
    svc_transition_outbox_tmpl = extract_template(services_src, 'SERVICE_TRANSITION_OUTBOX_SQL')
    svc_transition_suppress_tmpl = extract_template(services_src, 'SERVICE_TRANSITION_SUPPRESS_SQL')
    person_mandate_tmpl = re.search(r'PERSON_MANDATE_AUTHORITY_SQL = "([^"]*)"', services_policy_src).group(1)
    horse_mandate_tmpl = extract_template(services_policy_src, 'HORSE_MANDATE_REFERENCE_SQL')

    self_lead_refusal = 'NOT EXISTS(' + person_mandate_tmpl.replace('{{personColumn}}', '?') + ')'
    svc_receipt_sql = (svc_receipt_tmpl.replace('{{selfLeadRefusal}}', self_lead_refusal)
                       .replace('${MAX_NEW_REQUESTS_PER_DAY}', max_daily)
                       .replace('${MAX_NEW_PER_CATEGORY_PER_DAY}', max_category)
                       .replace('{{horseMandate}}', horse_mandate_tmpl))
    svc_transition_sql = svc_transition_tmpl.replace(
        '{{personMandate}}', person_mandate_tmpl.replace('{{personColumn}}', 'service_requests.provider_person_id'))

    # R95-N12 privacy lifecycle templates (exact production SQL).
    consent_update_sql = extract_template(services_privacy_src, 'CONSENT_WITHDRAWAL_UPDATE_SQL')
    consent_suppress_sql = extract_template(services_privacy_src, 'CONSENT_WITHDRAWAL_SUPPRESS_SQL')
    consent_audit_sql = extract_template(services_privacy_src, 'CONSENT_WITHDRAWAL_AUDIT_SQL')
    provider_block_insert_sql = extract_template(services_privacy_src, 'PROVIDER_BLOCK_INSERT_SQL').replace('{{personMandate}}', person_mandate_tmpl.replace('{{personColumn}}', '?'))
    provider_block_suppress_sql = extract_template(services_privacy_src, 'PROVIDER_BLOCK_SUPPRESS_SQL')
    provider_block_audit_sql = extract_template(services_privacy_src, 'PROVIDER_BLOCK_AUDIT_SQL')
    retention_redact_sql = extract_template(services_privacy_src, 'RETENTION_REDACT_SQL')
    retention_suppress_sql = extract_template(services_privacy_src, 'RETENTION_SUPPRESS_SQL')
    retention_audit_sql = extract_template(services_privacy_src, 'RETENTION_AUDIT_SQL')

    # R95-N14 moderation templates (exact production SQL from src/moderation/
    # commands.ts; the {{activeAdminActor}} token resolves to the shared
    # ACTIVE_ADMIN_SQL predicate the same way the runtime does).
    moderation_src = (ROOT / 'src/moderation/commands.ts').read_text()
    active_admin_sql = re.search(r'ACTIVE_ADMIN_SQL =\s*\n?\s*"([^"]*)"', moderation_src).group(1)
    mod_report_insert = extract_template(moderation_src, 'REPORT_CASE_INSERT_SQL')
    mod_report_event = extract_template(moderation_src, 'REPORT_CASE_EVENT_SQL')
    mod_decide_update = extract_template(moderation_src, 'DECIDE_CASE_UPDATE_SQL').replace('{{activeAdminActor}}', active_admin_sql)
    mod_decide_event = extract_template(moderation_src, 'DECIDE_CASE_EVENT_SQL')
    mod_decide_suspension = extract_template(moderation_src, 'DECIDE_CASE_SUSPENSION_SQL')
    mod_appeal_insert = extract_template(moderation_src, 'APPEAL_CASE_INSERT_SQL')
    mod_appeal_event = extract_template(moderation_src, 'APPEAL_CASE_EVENT_SQL')
    mod_appeal_decide = extract_template(moderation_src, 'DECIDE_APPEAL_UPDATE_SQL').replace('{{activeAdminActor}}', active_admin_sql)
    mod_appeal_decide_event = extract_template(moderation_src, 'DECIDE_APPEAL_EVENT_SQL')
    mod_appeal_reinstate_case = extract_template(moderation_src, 'DECIDE_APPEAL_REINSTATE_CASE_SQL')
    mod_appeal_reinstate_susp = extract_template(moderation_src, 'DECIDE_APPEAL_REINSTATE_SUSPENSION_SQL')
    mod_standing_stamp = extract_template(moderation_src, 'STANDING_CASE_STAMP_SQL').replace('{{activeAdminActor}}', active_admin_sql)
    mod_standing_upsert = extract_template(moderation_src, 'STANDING_UPSERT_SQL')
    mod_standing_event = extract_template(moderation_src, 'STANDING_EVENT_SQL')
    def svc_create(key, actor, horse, op, digest, note='Parity lead note for the farrier.'):
        return [
            {"sql": "UPDATE users SET updated_at=updated_at WHERE id=? AND is_active=1", "args": [actor]},
            {"sql": svc_receipt_sql, "args": [key, actor, 41, digest, '{}', op,
                                              actor, 41, '%"farrier"%', actor, 41,
                                              actor, 41, 41, actor,
                                              actor,
                                              actor, 41,
                                              actor, NOW_ISO,
                                              actor, 'farrier', NOW_ISO,
                                              actor, 41, 'farrier', note, NOW_ISO,
                                              horse, horse, NOW_ISO, actor, actor, NOW_ISO, NOW_ISO]},
            {"sql": svc_request_tmpl, "args": [actor, 41, 'farrier', 'IR-08', 'Arak', horse,
                                              note, 1, op, op]},
            {"sql": svc_link_tmpl, "args": [op, op]},
            {"sql": svc_create_audit_tmpl, "args": [actor, '{"provider_person_id":41}', op]},
            {"sql": svc_create_outbox_tmpl, "args": [op]},
        ]

    def svc_transition(to_status, op, request_id, expected_version, current, actor_flag, actor_user):
        return [
            {"sql": svc_transition_sql, "args": [to_status, to_status, to_status, actor_user, op,
                                                 request_id, expected_version, current, actor_user,
                                                 actor_flag, actor_user, actor_flag, actor_user]},
            {"sql": svc_transition_audit_tmpl, "args": [actor_user, '{"status":"' + current + '"}',
                                                 '{"status":"' + to_status + '"}', op]},
            {"sql": svc_transition_outbox_tmpl, "args": [actor_user, actor_flag, actor_flag, op]},
        ]

    svc_seed = [
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('svc-req','svc-req@example.invalid','SVC-REQ','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('svc-prov','svc-prov@example.invalid','SVC-PROV','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('svc-blocked','svc-blocked@example.invalid','SVC-BLOCKED','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('svc-spam','svc-spam@example.invalid','SVC-SPAM','unused','user')", "args": []},
        {"sql": "INSERT INTO people(id,name_latin) VALUES(41,'Parity Farrier')", "args": []},
        {"sql": "INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(41,'[\"farrier\"]',1)", "args": []},
        {"sql": "INSERT INTO user_person_links(user_id,person_id,status) VALUES('svc-prov',41,'verified')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(7,'SVC-GRANTED')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(8,'SVC-NOGRANT')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(9,'SVC-REVOKED')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
                "VALUES('g-svc-7',7,'svc-req','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from,revoked_at) "
                "VALUES('g-svc-9',9,'svc-req','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00','2026-02-01 00:00:00')", "args": []},
        {"sql": "INSERT INTO service_request_blocks(blocker_user_id,blocked_person_id) VALUES('svc-blocked',41)", "args": []},
    ]
    n14_seed = [
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('mod-reporter','mod-reporter@example.invalid','MOD-REPORTER','unused','user')", "args": []},
        {"sql": "INSERT INTO users(id,email,display_name,password_hash,role) VALUES('mod-seller','mod-seller@example.invalid','MOD-SELLER','unused','user')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(10,'MOD-H1')", "args": []},
        {"sql": "INSERT INTO horses(id,name_latin) VALUES(11,'MOD-H2')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                "VALUES('mod-listing-1',10,'mod-seller','MOD-SELLER','active','user')", "args": []},
        {"sql": "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
                "VALUES('mod-listing-2',11,'mod-seller','MOD-SELLER','active','user')", "args": []},
    ]

    return {
        "now_text": NOW_TEXT,
        "seed": seed + svc_seed + n14_seed,
        "steps": [
            {"id": "status-success", "kind": "batch", "statements": [
                status("pending_sale", "op-1", "listing-1", 1, "active", 0, "seller", seller_grants),
                receipt("key-p1", "seller", "listing.status", "listing-1", "digest-p1", receipt_row, "op-1"),
            ], "expect": {"changes": [1, 1]}},
            {"id": "receipt-replay-lookup", "kind": "query",
             "sql": "SELECT id,command,target_id,status_code,request_digest FROM command_receipts WHERE id=?",
             "args": ["key-p1"], "expect_rows": 1},
            {"id": "receipt-conflict", "kind": "batch_expect_error", "statements": [
                receipt("key-p1", "seller", "listing.status", "listing-1", "digest-p1-OTHER",
                        json.dumps({"id": "listing-1", "conflict": True}), "op-1"),
            ], "expect": "unique_violation"},
            {"id": "status-stale-version", "kind": "batch", "statements": [
                status("sold", "op-4", "listing-1", 1, "pending_sale", 0, "seller", seller_grants),
                receipt("key-p4", "seller", "listing.status", "listing-1", "digest-p4",
                        json.dumps({"id": "listing-1"}), "op-4"),
            ], "expect": {"changes": [0, 0]}},
            {"id": "renew-reactivate", "kind": "batch", "statements": [
                {"sql": renew_sql, "args": ["2026-11-02 12:00:00", NOW_TEXT, "op-5", "listing-2", 1, "seller", "seller", *seller_grants]},
            ], "expect": {"changes": [1]}},
            {"id": "renew-sibling-unique-index", "kind": "batch_expect_error", "statements": [
                {"sql": renew_sql, "args": ["2026-11-02 12:00:00", NOW_TEXT, "op-6", "listing-2b", 1, "seller", "seller", *seller_grants]},
            ], "expect": "unique_violation"},
            {"id": "create-via-org-grant", "kind": "batch", "statements": [
                {"sql": create_sql, "args": ["listing-org", 5, "orgmate", "SELLER", None, None, "Tehran", 1000, 1, 0,
                                             None, None, NOW_TEXT, NOW_TEXT, 5, "orgmate", *orgmate_grants]},
            ], "expect": {"changes": [1]}},
            {"id": "inquiry-status-success", "kind": "batch", "statements": [
                {"sql": inquiry_status_sql, "args": ["contacted", "op-8", "inquiry-1", 1, "new", "seller", "seller", *seller_manage]},
            ], "expect": {"changes": [1]}},
            {"id": "p02-revoke-grant", "kind": "batch", "statements": [
                {"sql": revoke_grant_sql, "args": ["admin", "parity revocation", "op-9", "g-seller"]},
                {"sql": grant_audit_sql, "args": ["admin", "grant.revoke", "horse_access_grant", "g-seller",
                                                  json.dumps({"grant_id": "g-seller", "prior_state": "active",
                                                              "new_state": "revoked", "operation_id": "op-9"}),
                                                  "parity revocation", "g-seller", "op-9"]},
            ], "expect": {"changes": [1, 1]}},
            {"id": "status-after-revoke", "kind": "batch", "statements": [
                status("sold", "op-10", "listing-1", 2, "pending_sale", 0, "seller", seller_grants),
                receipt("key-p10", "seller", "listing.status", "listing-1", "digest-p10",
                        json.dumps({"id": "listing-1"}), "op-10"),
            ], "expect": {"changes": [0, 0]}},
            {"id": "staff-branch", "kind": "batch", "statements": [
                status("sold", "op-11", "listing-1", 2, "pending_sale", 1, "admin", seller_grants),
            ], "expect": {"changes": [1]}},
            {"id": "concurrent-receipt-claim", "kind": "concurrent", "statement":
                receipt("key-p12", "seller", "listing.status", "listing-1", "digest-p12",
                        json.dumps({"id": "listing-1"}), "op-11"),
             "expect": {"winners": 1, "unique_violation": 1}},
            {"id": "service-create-success", "kind": "batch", "statements":
                svc_create('svc-receipt-1', 'svc-req', 7, 'op-svc-1', 'svc-digest-1'),
             "expect": {"changes": [1, 1, 1, 1, 1, 1]}},
            {"id": "service-create-replay", "kind": "batch", "statements":
                svc_create('svc-receipt-1', 'svc-req', 7, 'op-svc-2', 'svc-digest-1'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-late-block", "kind": "batch", "statements":
                svc_create('svc-receipt-blocked', 'svc-blocked', None, 'op-svc-3', 'svc-digest-3'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-no-horse-mandate", "kind": "batch", "statements":
                svc_create('svc-receipt-nogrant', 'svc-req', 8, 'op-svc-4', 'svc-digest-4', 'Parity no-grant horse note.'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-revoked-mandate", "kind": "batch", "statements":
                svc_create('svc-receipt-revoked', 'svc-req', 9, 'op-svc-5', 'svc-digest-5', 'Parity revoked-grant horse note.'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-self-lead", "kind": "batch", "statements":
                svc_create('svc-receipt-self', 'svc-prov', None, 'op-svc-6', 'svc-digest-6'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-transition-acknowledge", "kind": "batch", "statements":
                svc_transition('acknowledged', 'op-svc-7', 1, 1, 'new', 'provider', 'svc-prov'),
             "expect": {"changes": [1, 1, 1]}},
            {"id": "service-transition-wrong-party", "kind": "batch", "statements":
                svc_transition('closed', 'op-svc-8', 1, 2, 'acknowledged', 'requester', 'svc-prov'),
             "expect": {"changes": [0, 0, 0]}},
            {"id": "service-transition-stale", "kind": "batch", "statements":
                svc_transition('closed', 'op-svc-9', 1, 99, 'acknowledged', 'provider', 'svc-prov'),
             "expect": {"changes": [0, 0, 0]}},
            {"id": "concurrent-service-receipt-claim", "kind": "concurrent", "statement":
                {"sql": svc_receipt_sql, "args": ['svc-receipt-race', 'svc-req', 41, 'svc-digest-race', '{}', 'op-svc-10',
                                                 'svc-req', 41, '%"farrier"%', 'svc-req', 41,
                                                 'svc-req', 41, 41, 'svc-req',
                                                 'svc-req',
                                                 'svc-req', 41,
                                                 'svc-req', NOW_ISO,
                                                 'svc-req', 'farrier', NOW_ISO,
                                                 'svc-req', 41, 'farrier', 'Parity race note for the farrier.', NOW_ISO,
                                                 7, 7, NOW_ISO, 'svc-req', 'svc-req', NOW_ISO, NOW_ISO]},
             "expect": {"winners": 1, "errors": []}},
            {"id": "concurrent-service-transition-cas", "kind": "concurrent", "statement":
                {"sql": svc_transition_sql, "args": ['discussing', 'discussing', 'discussing', 'svc-prov', 'op-svc-11',
                                                 1, 2, 'acknowledged', 'svc-prov',
                                                 'provider', 'svc-prov', 'provider', 'svc-prov']},
             "expect": {"winners": 1, "errors": []}},
            # --------------------------------------------------------------
            # R95-N12: consent withdrawal + anti-abuse lifecycle. Every bound
            # is re-checked inside the create transaction; the duplicate arm
            # refuses same provider+category+note inside 24h; withdrawal
            # suppresses pending optional notices; the retention sweep
            # minimizes old terminal leads (digest preserved).
            # --------------------------------------------------------------
            {"id": "service-create-duplicate", "kind": "batch", "statements":
                svc_create('svc-receipt-dup', 'svc-req', 7, 'op-svc-12', 'svc-digest-12'),
             "expect": {"changes": [1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-provider-blocked", "kind": "batch", "statements":
                [{"sql": "INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason) VALUES(41,'svc-spam','parity private reason')", "args": []}]
                + svc_create('svc-receipt-spam', 'svc-spam', None, 'op-svc-13', 'svc-digest-13', 'Parity blocked-sender note.'),
             "expect": {"changes": [1, 1, 0, 0, 0, 0, 0]}},
            {"id": "service-create-restricted-standing", "kind": "batch", "statements":
                [{"sql": "INSERT INTO service_abuse_standing(user_id,standing,reason) VALUES('svc-spam','restricted','parity standing')", "args": []}]
                + svc_create('svc-receipt-standing', 'svc-spam', None, 'op-svc-14', 'svc-digest-14', 'Parity restricted-account note.'),
             "expect": {"changes": [1, 1, 0, 0, 0, 0, 0]}},
            {"id": "service-consent-withdrawal", "kind": "batch", "statements": [
                {"sql": consent_update_sql, "args": ['op-svc-15', 1, 'svc-req']},
                {"sql": consent_suppress_sql, "args": ['op-svc-15', '1', 1, 'op-svc-15']},
                {"sql": consent_audit_sql, "args": ['svc-req', 1, 'op-svc-15']},
             ],
             "expect": {"changes": [1, 3, 1]}},
            {"id": "service-withdraw-transition-suppress", "kind": "batch", "statements": [
                {"sql": svc_transition_sql, "args": ['withdrawn', 'withdrawn', 'withdrawn', 'svc-req', 'op-svc-16',
                                                 1, 4, 'discussing', 'svc-req',
                                                 'requester', 'svc-req', 'requester', 'svc-req']},
                {"sql": svc_transition_audit_tmpl, "args": ['svc-req', '{"status":"discussing"}', '{"status":"withdrawn"}', 'op-svc-16']},
                {"sql": svc_transition_outbox_tmpl, "args": ['svc-req', 'requester', 'requester', 'op-svc-16']},
                {"sql": svc_transition_suppress_tmpl, "args": ['op-svc-16', '1', 1, 'op-svc-16']},
             ],
             "expect": {"changes": [1, 1, 1, 1]}},
            {"id": "service-provider-block", "kind": "batch", "statements": [
                {"sql": provider_block_insert_sql, "args": [41, 'svc-req', 'parity operator reason', 'svc-prov', 'op-block-17', 'svc-prov', 41, 41, 'svc-req', 'svc-prov', 'svc-req']},
                {"sql": provider_block_suppress_sql, "args": ['op-block-17']},
                {"sql": provider_block_audit_sql, "args": ['svc-prov', '{"reason_recorded": true}', 'op-block-17']},
             ],
             "expect": {"changes": [1, 0, 1]}},
            {"id": "service-retention-sweep", "kind": "batch", "statements": [
                {"sql": "INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,created_at,updated_at) "
                        "VALUES(50,'svc-req',41,'farrier','parity old closed note',1,'closed',2,'2024-01-01 00:00:00','2024-02-01 00:00:00')", "args": []},
                {"sql": "INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked) "
                        "VALUES('service-request:50:v5:svc-prov','email','service_request_notice',0,'svc-prov','provider account')", "args": []},
                {"sql": retention_redact_sql, "args": [__import__('hashlib').sha256(b'parity old closed note').hexdigest(), 'original_sha256', '2026-10-04 12:00:00', '2026-10-04 12:00:00', '2026-10-04 12:00:00', 'op-retain-50', 50, 2, 'parity old closed note', '2025-10-04 12:00:00']},
                {"sql": retention_suppress_sql, "args": [50, "op-retain-50"]},
                {"sql": retention_audit_sql, "args": ['{"retention_days":365}', "2026-10-04 12:00:00", 50, "op-retain-50"]},
             ],
             "expect": {"changes": [1, 1, 1, 1, 1]}},
            # ------------- R95-N14: moderation deduplication + standing -------------
            # Order discipline: every id-dependent INSERT (cases, appeals)
            # happens BEFORE the first expect-error step — a failed INSERT
            # still consumes a PG sequence number but not a SQLite rowid, so
            # hardcoding ids after a failure would diverge by engine.
            {"id": "mod-report-create", "kind": "batch", "statements": [
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-1', 'mod-reporter', 'spam', None, 'mod-op-1']},
                {"sql": mod_report_event, "args": ['mod-reporter', '{"reason": "spam"}', 'mod-reporter', 'sales_listings', 'mod-listing-1', 'mod-op-1']},
             ],
             "expect": {"changes": [1, 1]}},
            {"id": "mod-decide-hide", "kind": "batch", "statements": [
                {"sql": mod_decide_update, "args": ['resolved_hidden', 'Counterfeit documents verified on review.', 'mod-op-3', 1, 'new', 'sales_listings', 'mod-listing-1', 'admin']},
                {"sql": mod_decide_event, "args": ['admin', '{"decision": "hide"}', 1, 'mod-op-3']},
                {"sql": mod_decide_suspension, "args": ['admin', 'Counterfeit documents verified on review.', 1, 'mod-op-3']},
             ],
             "expect": {"changes": [1, 1, 1]}},
            {"id": "mod-second-incident-first-dismissal", "kind": "batch", "statements": [
                # The new incident can be filed while case 1 is CLOSED (closed
                # history is outside the partial index key).
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-1', 'mod-reporter', 'misrepresentation', None, 'mod-op-4']},
                {"sql": mod_report_event, "args": ['mod-reporter', '{"reason": "misrepresentation"}', 'mod-reporter', 'sales_listings', 'mod-listing-1', 'mod-op-4']},
                {"sql": mod_decide_update, "args": ['resolved_dismissed', 'Second incident reviewed; no action.', 'mod-op-5', 2, 'new', 'sales_listings', 'mod-listing-1', 'admin']},
                {"sql": mod_decide_event, "args": ['admin', '{"decision": "dismiss"}', 2, 'mod-op-5']},
             ],
             "expect": {"changes": [1, 1, 1, 1]}},
            {"id": "mod-appeal-create", "kind": "batch", "statements": [
                # The mandate (current seller of the listing) is re-checked
                # INSIDE the INSERT..SELECT.
                {"sql": mod_appeal_insert, "args": ['mod-seller', 'The documents are authentic; requesting review.', 'mod-op-6', 1, 'mod-seller']},
                {"sql": mod_appeal_event, "args": ['mod-seller', '{"statement": "The documents are authentic; requesting review."}', 1, 'mod-op-6', 'mod-seller']},
             ],
             "expect": {"changes": [1, 1]}},
            {"id": "mod-appeal-overturn-lifts-only-its-own-suspension", "kind": "batch", "statements": [
                {"sql": mod_appeal_decide, "args": ['overturned', 'admin', 'Documents verified against registry evidence.', 'mod-op-8', 1, 1, 'admin']},
                {"sql": mod_appeal_decide_event, "args": ['admin', '{"outcome": "overturned"}', 1, 'mod-op-8']},
                {"sql": mod_appeal_reinstate_case, "args": ['mod-op-8', 1, 1, 'mod-op-8']},
                {"sql": mod_appeal_reinstate_susp, "args": ['admin', 1, 1, 'mod-op-8']},
             ],
             "expect": {"changes": [1, 1, 1, 1]}},
            {"id": "mod-standing-lifecycle", "kind": "batch", "statements": [
                # Standing recorded against the RESOLVED case 2 (its affected
                # account is the owner of the reported artifact: the seller).
                {"sql": "UPDATE users SET updated_at=updated_at WHERE id=?", "args": ['mod-seller']},
                {"sql": mod_standing_stamp, "args": ['mod-op-9', 2, 'admin', 'mod-seller', 'normal', 'mod-seller', 'mod-seller', 'mod-seller']},
                {"sql": mod_standing_upsert, "args": ['mod-seller', 'restricted', 'Counterfeit documents confirmed; restricted pending review.', 2, 'mod-op-9']},
                {"sql": mod_standing_event, "args": ['admin', '{"standing": "restricted"}', 2, 'mod-op-9']},
             ],
             "expect": {"changes": [1, 1, 1, 1]}},
            {"id": "mod-third-incident-same-resolved-status", "kind": "batch", "statements": [
                # Case 3 dismissed to the SAME resolved status case 2 already
                # has — the exact operation the old 4-column UNIQUE refused
                # (F27). The partial index leaves closed history unlimited.
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-1', 'mod-reporter', 'spam', None, 'mod-op-10']},
                {"sql": mod_report_event, "args": ['mod-reporter', '{"reason": "spam"}', 'mod-reporter', 'sales_listings', 'mod-listing-1', 'mod-op-10']},
                {"sql": mod_decide_update, "args": ['resolved_dismissed', 'Third incident reviewed; no action again.', 'mod-op-11', 3, 'new', 'sales_listings', 'mod-listing-1', 'admin']},
                {"sql": mod_decide_event, "args": ['admin', '{"decision": "dismiss"}', 3, 'mod-op-11']},
             ],
             "expect": {"changes": [1, 1, 1, 1]}},
            {"id": "mod-fourth-report-other-target", "kind": "batch", "statements": [
                # Case 4 on the second listing; it STAYS ACTIVE (never decided).
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-2', 'mod-reporter', 'offensive_content', None, 'mod-op-12']},
                {"sql": mod_report_event, "args": ['mod-reporter', '{"reason": "offensive_content"}', 'mod-reporter', 'sales_listings', 'mod-listing-2', 'mod-op-12']},
             ],
             "expect": {"changes": [1, 1]}},
            {"id": "mod-standing-refused-on-active-case", "kind": "batch", "statements": [
                # The stamp's resolved predicate refuses an ACTIVE case: the
                # whole batch no-ops — the upsert is conditioned on the stamp
                # marker (INSERT..SELECT), so standing follows a resolution,
                # never an open case. Zero rows anywhere.
                {"sql": "UPDATE users SET updated_at=updated_at WHERE id=?", "args": ['mod-seller']},
                {"sql": mod_standing_stamp, "args": ['mod-op-13', 4, 'admin', 'mod-seller', 'restricted', 'mod-seller', 'mod-seller', 'mod-seller']},
                {"sql": mod_standing_upsert, "args": ['mod-seller', 'suspended', 'Should never land on an active case.', 4, 'mod-op-13']},
                {"sql": mod_standing_event, "args": ['admin', '{"standing": "suspended"}', 4, 'mod-op-13']},
             ],
             "expect": {"changes": [1, 0, 0, 0]}},
            {"id": "mod-fifth-report-hide-and-appeal", "kind": "batch", "statements": [
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-1', 'mod-reporter', 'animal_welfare', None, 'mod-op-14']},
                {"sql": mod_report_event, "args": ['mod-reporter', '{"reason": "animal_welfare"}', 'mod-reporter', 'sales_listings', 'mod-listing-1', 'mod-op-14']},
                {"sql": mod_decide_update, "args": ['resolved_hidden', 'Welfare concern verified on the second listing evidence.', 'mod-op-15', 5, 'new', 'sales_listings', 'mod-listing-1', 'admin']},
                {"sql": mod_decide_event, "args": ['admin', '{"decision": "hide"}', 5, 'mod-op-15']},
                {"sql": mod_decide_suspension, "args": ['admin', 'Welfare concern verified on the second listing evidence.', 5, 'mod-op-15']},
                {"sql": mod_appeal_insert, "args": ['mod-seller', 'The welfare report misidentifies the horse.', 'mod-op-16', 5, 'mod-seller']},
                {"sql": mod_appeal_event, "args": ['mod-seller', '{"statement": "The welfare report misidentifies the horse."}', 5, 'mod-op-16', 'mod-seller']},
             ],
             "expect": {"changes": [1, 1, 1, 1, 1, 1, 1]}},
            {"id": "mod-appeal-duplicate-open", "kind": "batch_expect_error", "statements": [
                # One OPEN appeal per case is structural (0061 partial index):
                # a racing second appeal for case 5 is refused by the engine.
                {"sql": mod_appeal_insert, "args": ['mod-seller', 'Racing a second open appeal.', 'mod-op-17', 5, 'mod-seller']},
             ],
             "expect": "unique_violation"},
            {"id": "mod-report-duplicate-active", "kind": "batch_expect_error", "statements": [
                # While case 4 is ACTIVE for (mod-reporter, mod-listing-2), a
                # duplicate report for the same target is refused — by the
                # partial index, under any active status.
                {"sql": mod_report_insert, "args": ['sales_listings', 'mod-listing-2', 'mod-reporter', 'spam', None, 'mod-op-18']},
             ],
             "expect": "unique_violation"},
        ],
        "snapshot": [
            "SELECT id,status,row_version FROM sales_listings ORDER BY id",
            "SELECT id,status,row_version FROM sales_inquiries ORDER BY id",
            "SELECT id,command,target_id,status_code,request_digest FROM command_receipts ORDER BY id",
            "SELECT id,revoked_at IS NOT NULL AS revoked FROM horse_access_grants ORDER BY id",
            "SELECT COUNT(*) AS n FROM audit_events WHERE action='grant.revoke'",
            "SELECT id,requester_user_id,provider_person_id,category,horse_id,status,row_version FROM service_requests ORDER BY id",
            "SELECT id,actor_user_id,request_id FROM service_request_receipts ORDER BY id",
            "SELECT COUNT(*) AS n FROM notification_outbox WHERE purpose='service_request_notice'",
            "SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('service_request.created','service_request.transitioned')",
            "SELECT id,share_contact,note_redacted_at IS NOT NULL AS redacted FROM service_requests ORDER BY id",
            "SELECT event_key,status,last_error FROM notification_outbox ORDER BY id",
            "SELECT id,target_table,target_id,reporter_user_id,reason,status,merged_into_case_id FROM moderation_cases ORDER BY id",
            "SELECT id,case_id,appellant_user_id,status FROM moderation_appeals ORDER BY id",
            "SELECT case_id,listing_id,reinstated_at IS NOT NULL AS reinstated FROM listing_suspensions ORDER BY id",
            "SELECT user_id,standing,reason FROM service_abuse_standing ORDER BY user_id",
            "SELECT case_id,event_type FROM moderation_case_events ORDER BY id",
        ],
    }


def _normalize_value(value):
    """Cross-engine value normalization: booleans -> 0/1, integer-looking
    strings (PG bigint counts) -> int. Timestamps never appear in snapshots
    (aliased expressions only) so no date normalization is needed."""
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value):
        return int(value)
    return value


def _normalize_rows(rows, columns):
    return [{col: _normalize_value(value) for col, value in zip(columns, row)} for row in rows]


def run_sqlite(sequence):
    """Execute the sequence on real SQLite with all migrations; return a
    normalized transcript {seed_ok, steps: [...], snapshot: {...}}."""
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    try:
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            db.executescript(path.read_text())
        for statement in sequence["seed"]:
            db.execute(statement["sql"], statement["args"])
        db.commit()

        transcript = {"steps": [], "snapshot": {}}
        for step in sequence["steps"]:
            kind = step["kind"]
            if kind == "batch":
                db.execute("BEGIN")
                changes = []
                try:
                    for statement in step["statements"]:
                        changes.append(db.execute(statement["sql"], statement["args"]).rowcount)
                    db.commit()
                    transcript["steps"].append({"id": step["id"], "ok": True, "changes": changes})
                except Exception as error:  # noqa: BLE001 - transcript records the class
                    db.rollback()
                    transcript["steps"].append({"id": step["id"], "ok": False, "error": classify_sqlite_error(error)})
            elif kind == "query":
                cursor = db.execute(step["sql"], step["args"])
                columns = [description[0] for description in cursor.description]
                transcript["steps"].append({"id": step["id"], "ok": True,
                                            "rows": _normalize_rows(cursor.fetchall(), columns)})
            elif kind == "batch_expect_error":
                db.execute("BEGIN")
                try:
                    for statement in step["statements"]:
                        db.execute(statement["sql"], statement["args"])
                    db.rollback()
                    transcript["steps"].append({"id": step["id"], "ok": False, "error": "expected_error_did_not_occur"})
                except Exception as error:  # noqa: BLE001
                    db.rollback()
                    transcript["steps"].append({"id": step["id"], "ok": True, "error": classify_sqlite_error(error)})
            elif kind == "concurrent":
                # SQLite reference: sequential execution of the same claim — the
                # second insert hits the receipt PK. PG races two connections.
                # A "winner" is a landed row (rowcount 1); a marker-gated no-op
                # (rowcount 0) is neither a winner nor an error.
                winners = 0
                errors = []
                for _ in range(2):
                    db.execute("BEGIN")
                    try:
                        rowcount = db.execute(step["statement"]["sql"], step["statement"]["args"]).rowcount
                        db.commit()
                        if rowcount == 1:
                            winners += 1
                    except Exception as error:  # noqa: BLE001
                        db.rollback()
                        errors.append(classify_sqlite_error(error))
                transcript["steps"].append({"id": step["id"], "ok": True, "winners": winners, "errors": errors})
            else:
                raise ValueError(f"unknown step kind {kind}")

        for query in sequence["snapshot"]:
            cursor = db.execute(query)
            columns = [description[0] for description in cursor.description]
            transcript["snapshot"][query] = _normalize_rows(cursor.fetchall(), columns)
        return transcript
    finally:
        db.close()


def write_artifacts(out_dir: Path):
    """Build the sequence, run the SQLite reference, write both artifacts.
    Returns (sequence, transcript)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sequence = build_sequence()
    transcript = run_sqlite(sequence)
    (out_dir / "sequence.json").write_text(json.dumps(sequence, indent=1))
    (out_dir / "sqlite-transcript.json").write_text(json.dumps(transcript, indent=1))
    return sequence, transcript
