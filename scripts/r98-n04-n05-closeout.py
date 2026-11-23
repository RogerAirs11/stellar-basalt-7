#!/usr/bin/env python3
"""R98-N04/N05 closeout: update AGENT_TASKS.json + REVIEW_HANDOFF.json statuses."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent

# --- AGENT_TASKS.json: mark N04/N05 done with evidence ---
tasks_path = root / "review-r98" / "AGENT_TASKS.json"
data = json.loads(tasks_path.read_text())
evidence = {
    "R98-N04": {
        "status": "done",
        "status_note": "Structured issuer scopes (issuer_scopes + issuer_scope_actions, versioned approval, effective intervals, suspension/revocation, one-live-scope partial unique index), registration-evidence gate (issuers.registration_evidence + review stamps; legacy issuers refused with 422 issuer_evidence_required), commit-time membership AND scope re-check inside the issuance INSERT (ACTIVE_ISSUER_SCOPE_SQL) with fail-fast 403 issuer_scope_required, issuer suspend/resume/retire commands with honest 403 on supersession, effectiveAttestationStatus now names issuer_suspended/issuer_retired in the public projection, private operator queue (GET /api/admin/trust/queue: expiring memberships/scopes, invalid dates, suspended issuers, unevidenced legacy issuers — non-private metadata only), public trust labels (GET /api/trust/labels, EN+FA, extracts-are-not-certificates note), documentation docs/trust/ISSUER-AUTHORITY.md (who may register, evidence classes, the three separated responsibilities). Evidence: tests/integration/r98-n04-issuer-scopes.test.ts (6 acceptance tests on the real migrated DB through real HTTP: out-of-scope/malformed/expired/future/revoked grants refuse; paid entitlement + generic staff refuse with no_membership; issuer suspension blocks commands and projects issuer_suspended without deleting history; versioned approval supersedes v1 keeping history; owner/editor cannot approve scopes; legacy evidence gate; operator queue; trust labels).",
    },
    "R98-N05": {
        "status": "done",
        "status_note": "Immutable server-derived evidence snapshots (attestation_snapshots, migration 0073): canonical versioned serializer with per-record-kind column allowlists (private free-text excluded everywhere), server reads the ACTUAL target + evidence rows and derives source_version (snap:<schema>:<digest16>) — caller-supplied source_version accepted for compatibility and ignored; attestation + snapshot written in ONE batch with the snapshot INSERT conditioned on the winning attestation row; per-column commit-time guards (COALESCE(CAST(col AS TEXT),'') equality on every allowlisted column of target and evidence rows) so a mid-flight source change writes zero rows (real interleaving reproduced with a trigger on the parent-row lock statement: 409, zero attestations/snapshots/events); public verification GET /api/attestations/:id/verify distinguishing current / source_changed (with changed/removed tables) / superseded / revoked / snapshot_tampered / unbound_legacy / issuer_suspended/retired/inactive + expiry states, exposing only digest + per-row version markers (canonical bytes, statement, scope and evidence identity stay private); private full-snapshot review GET /api/admin/attestations/:id/snapshot gated to platform content managers and the issuer's active owner; legacy attestations preserved as unbound_legacy with no fabricated backfill. Evidence: tests/integration/r98-n05-snapshots.test.ts (5 acceptance tests: same-boundary snapshot binding + server-derived marker; source change after issuance preserves the issued document byte-for-byte and reports source_changed; trigger-based concurrency refusal; lifecycle/tamper/legacy matrix; public-privacy + authority-gated review).",
    },
}
found = 0
for task in data["tasks"]:
    if task["id"] in evidence:
        task["status"] = "done"
        task["status_note"] = evidence[task["id"]]["status_note"]
        found += 1
assert found == 2, f"expected to update 2 tasks, updated {found}"
tasks_path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
print(f"AGENT_TASKS.json: N04/N05 -> done; open tasks remaining:",
      sum(1 for t in data["tasks"] if t["status"] == "open"))

# --- REVIEW_HANDOFF.json: record the behavioral changes ---
handoff_path = root / "REVIEW_HANDOFF.json"
handoff = json.loads(handoff_path.read_text())
handoff["application_version"] = "0.53.0"
handoff.setdefault("new_migrations", []).append("0073_r98_n04_n05_issuer_scopes_snapshots.sql")
behavioral = handoff.setdefault("behavioral_changes", [])
if isinstance(behavioral, dict):
    behavioral = []
changes = [
    "R98-N04: issuer registration now requires documentary evidence (registration_evidence + registration_reviewed_at/by); legacy issuers without it are refused scope approval with 422 issuer_evidence_required",
    "R98-N04: issuance requires BOTH a current issuer membership AND a currently approved structured scope for the record kind (issuer_scopes + issuer_scope_actions: versioned approval, effective intervals, suspension, revocation; one live scope per issuer+kind); fail-fast 403 issuer_scope_required, commit-time SQL predicate remains the enforcement",
    "R98-N04: issuer suspend/resume/retire commands (content-managed) take effect on issuance and supersession commands and on the public effective-status projection (issuer_suspended/issuer_retired named distinctly) without deleting history",
    "R98-N04: private operator queue GET /api/admin/trust/queue (expiring memberships/scopes within 30 days, malformed intervals, suspended issuers/scopes, unevidenced legacy issuers; non-private metadata only) and public trust labels GET /api/trust/labels (four levels EN+FA; issuer metadata does not certify every field; extracts are not certificates)",
    "R98-N05: every issuance writes an immutable server-derived evidence snapshot (attestation_snapshots) in the same consistency boundary, with per-column commit-time guards on the allowlisted target and evidence rows; attestations.source_version is always the server-derived snap:<schema>:<digest16> marker and a caller-supplied source_version is ignored",
    "R98-N05: public verification GET /api/attestations/:id/verify distinguishes current / source_changed / superseded / revoked / snapshot_tampered / unbound_legacy / issuer and expiry states, exposing only the content digest and per-row version markers; the canonical bytes are reviewable only by platform content managers and the issuer's active owner (GET /api/admin/attestations/:id/snapshot); legacy attestations remain unbound_legacy with no fabricated hashes",
]
behavioral.extend(changes)
handoff["behavioral_changes"] = behavioral
n04n05 = handoff.setdefault("n04_n05", {})
n04n05["R98-N04"] = "done — " + evidence["R98-N04"]["status_note"][:180]
n04n05["R98-N05"] = "done — " + evidence["R98-N05"]["status_note"][:180]
n04n05["gates"] = "vitest 1059/0 (was 1048; +6 N04 +5 N05 acceptance tests), tsc clean, python 215/215, sql-bindings 633 checked 0 problems, syntax 312 files, build+dist+asset validation green"
handoff_path.write_text(json.dumps(handoff, indent=1, ensure_ascii=False) + "\n")
print("REVIEW_HANDOFF.json updated: version 0.53.0, migration 0073, 6 behavioral changes, N04/N05 evidence recorded")
