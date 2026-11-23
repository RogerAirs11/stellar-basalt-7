"""Synthetic persona authority and review stories. Never used by live seeding."""
import json
import hashlib
import uuid

PERSONAS = [
    ("admin", "demo-admin-local", "admin", "DEMO Administrator", "Inspect simulated payments and delivery", "Cannot read Owner B's private workspace without a grant"),
    ("owner_a", "demo-owner-a", "owner", "DEMO Owner A", "Manage horse 900000017, a listing and the rehearsal workspace", "Cannot manage Owner B's horse or private workspace"),
    ("owner_b", "demo-owner-b", "owner", "DEMO Owner B", "Manage horse 900000018 and a separate private workspace", "Cannot manage Owner A's horse or private workspace"),
    ("reviewer", "demo-reviewer", "admin", "DEMO Reviewer", "Review pending fictional ownership claims", "Cannot read Owner A's private workspace without a grant"),
    ("provider", "demo-provider", "user", "DEMO Service Provider", "Manage the linked fictional directory profile", "Cannot approve claims or read a private owner workspace"),
    ("manager", "demo-manager", "owner", "DEMO Stable Manager", "Manage the fictional organization workspace", "Cannot manage an unrelated owner's personal workspace"),
    ("staff", "demo-staff", "user", "DEMO Stable Staff", "View and complete delegated tasks in Owner A's workspace", "Cannot invite staff, export, or manage workspace settings"),
]


def stable_id(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "horse-registry-demo-r111/" + key))


def seed_users(db, now, admin_id):
    db.execute("""CREATE TABLE local_demo_personas (
      persona_key TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      role TEXT NOT NULL, label TEXT NOT NULL, allowed_story TEXT NOT NULL, denied_story TEXT NOT NULL)""")
    for key, user_id, role, label, allowed, denied in PERSONAS:
        if user_id != admin_id:
            db.execute("INSERT INTO users(id,email,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,'demo-route-only',?,?,?)",
                       (user_id, user_id + "@local.invalid", label, role, now, now))
        db.execute("INSERT INTO local_demo_personas VALUES(?,?,?,?,?,?)", (key, user_id, role, label, allowed, denied))


def seed_scenarios(db, *, now, as_of, warning, admin_id, people, listings, workspace_id):
    # Verified links and grants are fixture permissions, never real ownership or credentials.
    for user, person in [("demo-owner-a", people["demo-person-1"]), ("demo-owner-b", people["demo-person-2"]), ("demo-provider", people["demo-person-3"])]:
        db.execute("INSERT INTO user_person_links(user_id,person_id,status,verification_method,verified_by_user_id,verified_at,created_at) VALUES(?,?,'verified','synthetic-fixture-only',?,?,?)", (user, person, admin_id, now, now))
    claims = []
    for key, horse, user, status in [("owner-a-approved",900000017,"demo-owner-a","approved"), ("owner-b-approved",900000018,"demo-owner-b","approved"), ("owner-a-pending",900000019,"demo-owner-a","pending"), ("owner-b-rejected",900000020,"demo-owner-b","rejected")]:
        claim_id = stable_id("claim/" + key)
        reviewed = status != "pending"
        db.execute("INSERT INTO horse_claims(id,horse_id,claimant_user_id,status,evidence_json,reviewed_by_user_id,review_note,created_at,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?)",
                   (claim_id, horse, user, status, json.dumps({"synthetic": True, "note": warning}), admin_id if reviewed else None, warning if reviewed else None, now, now if reviewed else None))
        claims.append({"id": claim_id, "horse_id": horse, "user_id": user, "status": status})
        if status == "approved":
            db.execute("""INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,basis_ref,granted_by_user_id,valid_from,created_at)
                        VALUES(?,?,?,'owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval',?,?,?,?)""",
                       (stable_id("grant/" + key), horse, user, claim_id, admin_id, "2000-01-01T00:00:00Z", now))
    # Fixture sellers have real, horse-scoped authorization. Legal owner rows stay unchanged.
    for index, listing in enumerate(listings):
        seller = "demo-owner-a" if index % 2 == 0 else "demo-owner-b"
        db.execute("UPDATE sales_listings SET seller_user_id=? WHERE id=?", (seller, listing["id"]))
        db.execute("""INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,basis_ref,granted_by_user_id,valid_from,created_at)
                     VALUES(?,?,?,'seller','create_listing,manage_inquiries','admin_grant',?,?,?,?)""",
                   (stable_id("grant/listing/" + listing["id"]), listing["horse_id"], seller, "SYNTHETIC DEMO SELLER MANDATE", admin_id, "2000-01-01T00:00:00Z", now))
        listing["seller_user_id"] = seller
    db.execute("UPDATE workspace_collections SET owner_user_id='demo-owner-a' WHERE id=?", (workspace_id,))
    db.execute("UPDATE workspace_tasks SET assigned_to_user_id='demo-owner-a' WHERE collection_id=? AND status='open'", (workspace_id,))
    db.execute("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,granted_at) VALUES(?,'demo-staff','view,tasks_manage','demo-owner-a',?)", (workspace_id, now))
    # Admin receives explicit task access for the existing rehearsal route, not an ambient private-data bypass.
    db.execute("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,granted_at) VALUES(?,?,'view,tasks_manage,export','demo-owner-a',?)", (workspace_id, admin_id, now))
    org_id = 970004001
    db.execute("INSERT INTO organizations(id,slug,name_latin,name_native,kind,created_at,updated_at) VALUES(?,'demo-fictional-stable','DEMO Fictional Stable','باشگاه نمایشی','stable',?,?)", (org_id, now, now))
    for user, role in [("demo-owner-a", "owner"), ("demo-manager", "manager")]:
        db.execute("INSERT INTO organization_memberships(organization_id,user_id,role,valid_from,created_at) VALUES(?,?,?,'2000-01-01T00:00:00Z',?)", (org_id, user, role, now))
    for collection, user, organization, name in [(970000002,"demo-owner-b",None,"DEMO Owner B Private Workspace"), (970000003,"demo-owner-a",org_id,"DEMO Organization Workspace")]:
        db.execute("INSERT INTO workspace_collections(id,name,description,owner_user_id,organization_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (collection,name,warning,user,organization,now,now))
        db.execute("INSERT INTO workspace_tasks(collection_id,title,category,due_date,status,created_by_user_id,assigned_to_user_id,occurrence_key,created_at,updated_at) VALUES(?,?,'other',?,'open',?,?,?, ?,?)",
                   (collection,"DEMO private task for " + user,as_of.isoformat(),user,user,"synthetic:r111:workspace:"+str(collection),now,now))
    for i, (sku, name, amount) in enumerate([("farm_workspace_monthly","DEMO Farm Workspace",1000000),("professional_tools_monthly","DEMO Professional Tools",500000),("sponsored_visibility_monthly","DEMO Sponsored Visibility",250000)],1):
        db.execute("INSERT INTO billing_prices(id,sku,name_en,name_fa,description,price_minor,currency,period_days,active,created_by_user_id,created_at) VALUES(?,?,?,?,?,?,'IRR',30,1,?,?)",
                   (970005000+i,sku,name,"طرح نمایشی",warning + " Fictional price; no real charge.",amount,admin_id,now))
    # Fictional lifecycle examples. These are fixture states, not API command
    # receipts or evidence that a real notice was delivered to anybody.
    provider_id = people["demo-person-3"]
    provider_profile = db.execute("SELECT service_categories,province_code,province_code_scheme FROM directory_profiles WHERE person_id=?", (provider_id,)).fetchone()
    category = json.loads(provider_profile[0])[0]
    service_stories = []
    for request_id, requester, status, share, redacted in [
        (980002001,"demo-owner-a","new",1,False),
        (980002002,"demo-owner-b","acknowledged",0,False),
        (980002003,"demo-owner-b","closed",0,True),
    ]:
        original_note = warning + " Fictional service request " + str(request_id) + ". Please discuss a routine introductory visit."
        note = "[SYNTHETIC NOTE REDACTED — fictional privacy example]" if redacted else original_note
        db.execute("""INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,province_code_scheme,city,note,share_contact,status,row_version,created_at,updated_at,first_response_at,closed_at,consent_updated_at,note_redacted_at,note_digest,note_digest_status,creation_operation_id)
          VALUES(?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?,?)""",
          (request_id,requester,provider_id,category,provider_profile[1],provider_profile[2],"DEMO fictional service area",note,share,status,
           3 if redacted else 2 if status=="acknowledged" else 1,now,now,now if status!="new" else None,now if status=="closed" else None,
           now if redacted else None,now if redacted else None,hashlib.sha256(original_note.encode()).hexdigest() if redacted else None,
           "original_sha256" if redacted else None,stable_id("service-fixture/"+str(request_id))))
        service_stories.append({"id":request_id,"requester_user_id":requester,"provider_person_id":provider_id,"status":status,
                                "contact_shared":bool(share),"note_redacted":redacted,"is_demo":True,"authority":"none"})
    stories = {
        "revision": "r113", "is_demo": True, "warning": warning,
        "personas": [{"key":key,"user_id":user,"role":role,"label":label,"allowed":allowed,"denied":denied} for key,user,role,label,allowed,denied in PERSONAS],
        "claims": claims, "listings": listings,
        "workspaces": {"owner_a": workspace_id, "owner_b":970000002,"organization":970000003},
        "organization_id": org_id,
        "provider_person_id": people["demo-person-3"],
        "service_requests": {"items":service_stories,"receipt_count":0,
            "note":"Fictional fixture states only. Use the native requester and provider forms to rehearse real local commands; no delivery is claimed.",
            "requester_persona":"owner_a","provider_persona":"provider","denied_persona":"staff"},
        "payments": {"catalog_seeded": True,"settled_in_baseline":False,"provider":"demo","origin":"http://127.0.0.1:3000"},
        "documents": "Workspace tracker records describe paper processes; downloadable synthetic bytes live in the media story.",
        "reviewer_note": "Reviewer uses the existing admin review capability; a narrower production reviewer role is not invented by the fixture.",
    }
    return stories


def seed_fictional_issuers(db, *, now, warning, admin_id):
    """R117-16 (Master AI R117 handoff D24): explicitly FICTIONAL issuers with
    NARROW approved scopes and recorded registration evidence. No row here
    implies real federation, ownership or laboratory approval — attestations
    are issued through the real API at demo time, never pre-seeded, so every
    credential story on the synthetic instance is a genuine command
    transcript (immutable snapshot, receipts and guards included)."""
    issuers = [
        # (stable key, slug, name, name_native, kind, scope record_kind, scope actions,
        #  registration evidence, memberships [(user_id, role)])
        ("demo-genetics-lab", "demo-fictional-genetics-lab",
         "DEMO Fictional Genetics Laboratory", "آزمایشگاه ژنتیک خیالی (نمایشی)", "laboratory",
         "genetic_test", ["attest", "supersede"],
         warning + " Fictional laboratory registration: no accreditation, no real tests, no identity. "
                   "Demonstrates a NARROW scope limited to reviewed genetic tests only.",
         [("demo-owner-a", "owner"), ("demo-staff", "attester")]),
        ("demo-breed-federation", "demo-fictional-breed-federation",
         "DEMO Fictional Breed Federation", "فدراسیون پرورش خیالی (نمایشی)", "federation",
         "horse_identity", ["attest", "supersede"],
         warning + " Fictional federation registration: no real authority over any breed. "
                   "Demonstrates a second, DIFFERENT narrow scope (identity statements only).",
         [("demo-manager", "attester")]),
    ]
    stories = []
    for key, slug, name, name_native, kind, record_kind, actions, evidence, memberships in issuers:
        issuer_id = stable_id("issuer/" + key)
        scope_id = stable_id("issuer-scope/" + key)
        db.execute("""INSERT INTO issuers(id,slug,name,name_native,kind,status,created_at,created_by_user_id,
                      registration_evidence,registration_reviewed_at,registration_reviewed_by_user_id)
                      VALUES(?,?,?,?,?,'active',?,?,?,?,?)""",
                   (issuer_id, slug, name, name_native, kind, now, admin_id, evidence, now, admin_id))
        # NARROW scope: exactly ONE record kind per issuer, explicitly approved,
        # open-ended validity, with the fictional evidence note recorded on the row.
        # Validity windows are anchored in the past like every other demo
        # fixture grant: the demo clock's "now" can still be in the future
        # relative to the live SQLite now, which would make memberships and
        # scopes "not yet valid" and refuse every issuance.
        anchored = "2000-01-01T00:00:00Z"
        db.execute("""INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,valid_until,
                      evidence_note,approved_by_user_id,approved_at,created_at)
                      VALUES(?,?,?,'approved',1,?,NULL,?,?,?,?)""",
                   (scope_id, issuer_id, record_kind, anchored,
                    warning + " Fictional scope evidence; narrow by construction.", admin_id, now, now))
        for action in actions:
            db.execute("INSERT INTO issuer_scope_actions(scope_id,action) VALUES(?,?)", (scope_id, action))
        for user_id, role in memberships:
            db.execute("""INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,created_at)
                          VALUES(?,?,?,?,'active',?,?)""",
                       (stable_id("issuer-membership/" + key + "/" + user_id), issuer_id, user_id, role, anchored, now))
        stories.append({"id": issuer_id, "slug": slug, "kind": kind, "scope_record_kind": record_kind,
                        "scope_actions": actions, "memberships": memberships, "is_demo": True, "authority": "none"})
    return {"issuers": stories,
            "note": "Fictional issuers with narrow scopes only. Attestations are issued live through the real API "
                    "(issue/verify/revoke/supersede) so snapshots and receipts are genuine; nothing here claims real "
                    "federation, ownership or laboratory approval.",
            "attester_persona": "staff", "owner_persona": "owner_a", "stranger_persona": "owner_b"}
