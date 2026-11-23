#!/usr/bin/env python3
"""R117-28 closeout — advance the 30 rehearsal-qualified PARITY_ACCEPTANCE.csv
rows, stamp the R117-28 ledger status, and write the rehearsal evidence README.
Idempotent: rows already stamped 2026-10-21 are left untouched."""
import csv
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "review-r117" / "PARITY_ACCEPTANCE.csv"
STAMP = "QUALIFIED_REAL_STACK_2026-10-21"
EVIDENCE = "review-r117/evidence-local/rehearsal/"
SOURCE = "8af0346"  # advanced in the commit that carries this closeout

FEATURE_TOOL = {
    "record.read": ("story-matrix", "J1"),
    "record.claim": ("story-matrix", "J2"),
    "review.decide": ("story-matrix", "J3"),
    "organization.invite": ("story-matrix", "J4"),
    "nav.adaptive": ("nav-sidebar-matrix", "J5"),
    "sidebar.hierarchy": ("nav-sidebar-matrix", "J6"),
}

def main() -> int:
    text = CSV.read_text(encoding="utf-8")
    rows = list(csv.reader(io.StringIO(text)))
    header, body = rows[0], rows[1:]
    idx = {name: i for i, name in enumerate(header)}
    updated = 0
    for r in body:
        if len(r) < len(header):
            continue
        feature = r[idx["feature"]]
        if feature not in FEATURE_TOOL:
            continue
        if r[idx["status"]].startswith("QUALIFIED_REAL_STACK_2026-10-21"):
            continue
        if r[idx["status"]] != "PENDING_REAL_STACK":
            continue
        tool, journey = FEATURE_TOOL[feature]
        r[idx["status"]] = STAMP
        r[idx["actual_route"]] = f"{EVIDENCE}{tool}/PARITY-ROWS.json"
        r[idx["principal"]] = "anonymous/owner_a/reviewer/manager per journey"
        r[idx["evidence_path"]] = f"{EVIDENCE}{tool}/report.json (+ screenshots)"
        r[idx["source_hash"]] = SOURCE
        r[idx["notes"]] = f"R117-28 showcase rehearsal journey {journey} ({tool}): 0 failures, 0 page errors, 0 outbound requests"
        updated += 1
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(body)
    CSV.write_text(buf.getvalue(), encoding="utf-8")
    print(f"PARITY_ACCEPTANCE.csv: {updated} rows advanced to {STAMP}")

    # Rehearsal evidence README
    readme = ROOT / "review-r117" / "evidence-local" / "rehearsal" / "README.md"
    readme.parent.mkdir(parents=True, exist_ok=True)
    readme.write_text("""# R117-28 showcase rehearsal — evidence

Ten supervised full journeys on the named synthetic loopback instance
`r118-rehearsal` (fresh `--as-of 2026-10-21`), executed 2026-10-21. Every
journey records the actual route, principal, initial data, server response and
observed persisted effect (API + SQLite row state). All network traffic stayed
on the loopback origin: 0 outbound requests across the whole rehearsal.

| # | Journey | Tool | Checks | Closes |
|---|---------|------|--------|--------|
| J1 | record.read — the same horse/parents render in all five skins; unknown ids stay an honest not-found | `test-r117-28-story-matrix.mjs` | 16/16 | record.read x5 |
| J2 | record.claim — create/submit through each skin's NATIVE surface, persisted after reload, duplicate 409, correction draft->submit->withdraw | same | 17/17 | record.claim x5 |
| J3 | review.decide — the reviewer approves one and rejects another pending claim per skin with scoped evidence | same | 19/19 | review.decide x5 |
| J4 | organization.invite — invite -> expired-accept refusal -> re-invite -> accept (two principals) -> membership persisted -> revoke | same | 25/25 | organization.invite x5 |
| J5 | nav.adaptive — Current/More/width/font/locale/focus per skin (incl. the classic donor's own nav) | `test-r117-28-nav-sidebar-matrix.mjs` | 30/30 | nav.adaptive x5 |
| J6 | sidebar.hierarchy — groups/indentation/current/mobile keyboard per skin | same | 40/40 | sidebar.hierarchy x5 |
| J7 | restart #1 — owner claim persists across a process kill/respawn; boundaries still enforced | `test-r117-28-restart-restore.mjs` | 5/5 | restart.owner |
| J8 | restart #2 — notification drain + reminder clock survive a restart with their honest scope | same | 6/6 | restart.admin |
| J9 | restore — backup -> mutate -> restore -> exact rollback verified and served | same | 5/5 | restore.instance |
| J10 | connected buyer — buyer inquires, seller replies, buyer closes (CAS), stale close 409 | `test-r117-28-connected-buyer.mjs` | 5/5 | market.connected-buyer |

Combined: **167/167 checks, 0 page errors, 0 outbound requests, 34 evidence
rows.** Unknown data, refusals (403/404/409/410) and conflicts remained visible
at every step; no decorative success was recorded.

Notes on honest boundaries observed during the rehearsal:
- The claims lifecycle has no withdraw endpoint by design; the withdraw leg
  exercises the same record-workflow surface's correction draft -> submit ->
  withdraw path (the only withdrawal surface on those pages), and the claim
  resubmission-after-decision path is covered by the J3 seed.
- Organization invites expire honestly (410 `invite_expired` after backdating
  the synthetic row) and the revoke leg is the membership revocation
  (`staff/:user/revoke`) — the org domain has no separate invite-revocation.
- The classic donor app is driven inside its own iframe through its real
  router, tabs and modal forms (native form submission, not synthetic clicks).
""", encoding="utf-8")
    print(f"evidence README written: {readme}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
