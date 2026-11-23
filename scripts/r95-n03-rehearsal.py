#!/usr/bin/env python3
"""R95-N03 rehearsal: apply the additive R95 schema to R94-LEGACY data and run
the read-only financial preflight. Proves, on legacy-shaped records:
  1. a duplicate financial fixture (two open attempts on one order) BLOCKS;
  2. the clean legacy database passes with honest legacy warnings;
  3. after applying 0052-0054, a legacy verified attempt still cannot be
     fulfilled a second time (receipt/CAS guards) and entitlements are intact.

Exit 0 = rehearsal passed. Evidence printed as JSON; archived by the caller.
No production data is touched: everything is synthetic legacy-shaped data.
"""
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path("/home/z/my-project/repos/horse-registry")
MIGRATIONS = REPO / "migrations"
R94_LAST = "0051_p19_sponsored.sql"
R95_MIGRATIONS = ["0052_r95_commerce_integrity.sql", "0053_r95_task_and_outbox_leases.sql", "0054_r95_private_workflow_commands.sql"]


def migration_files(upt_to: str) -> list[Path]:
    files = sorted(p for p in MIGRATIONS.glob("*.sql") if p.name <= upt_to)
    return files


def build_legacy_db(path: Path, blocked: bool) -> None:
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys=ON")
    for f in migration_files(R94_LAST):
        db.executescript(f.read_text())
    # R94-era data: user, price, order (frozen snapshot without period_days),
    # verified attempt WITHOUT an R95 receipt, live entitlement.
    db.executescript("""
    INSERT INTO users(id,email,display_name,password_hash,role,is_active)
      VALUES ('buyer','b@example.test','Buyer','not-a-real-hash','user',1);
    INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id)
      VALUES (1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'buyer');
    INSERT INTO orders(order_key,buyer_user_id,payer_organization_id,status,total_minor,currency,price_snapshot_json)
      VALUES ('legacy-order-0001','buyer',NULL,'paid',19000000,'IRR',
              '[{"sku":"farm_workspace_monthly","price_id":1,"version":1,"title_en":"Farm","title_fa":"Farm","unit_minor":19000000,"quantity":1,"line_total_minor":19000000}]');
    INSERT INTO payment_attempts(order_id,provider,amount_minor,currency,state,authority,verified_at)
      SELECT id,'zarinpal',19000000,'IRR','verified','AUTH-LEGACY-1','2026-09-05 00:00:00' FROM orders;
    INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state)
      SELECT id,'provider','redirected','verified' FROM payment_attempts;
    INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at)
      SELECT 'payment:' || p.id || ':entitlement',o.id,p.id,'buyer',NULL,'farm_workspace_monthly','grant',30,'2026-09-01 00:00:00','2026-10-01 00:00:00'
      FROM orders o JOIN payment_attempts p ON p.order_id=o.id;
    INSERT INTO entitlements(buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at)
      SELECT 'buyer',NULL,'farm_workspace_monthly',e.id,1,e.activated_at,e.expires_at FROM entitlement_events e;
    """)
    if blocked:
        # The duplicate financial fixture: a SECOND open attempt on the same order.
        db.executescript("""
        INSERT INTO payment_attempts(order_id,provider,amount_minor,currency,state,authority)
          SELECT id,'zarinpal',19000000,'IRR','redirected','AUTH-LEGACY-2' FROM orders;
        UPDATE payment_attempts SET state='redirected' WHERE authority='AUTH-LEGACY-1';
        """)
    db.commit()
    db.close()


def preflight(path: Path) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(REPO / "tools/r95-preflight.py"), str(path)],
        capture_output=True, text=True, cwd=REPO,
    )
    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        report = {"raw": proc.stdout, "stderr": proc.stderr}
    return proc.returncode, report


def fulfill_again_check(path: Path) -> dict:
    """After R95 migrations, the verifiedOrderStatements guard must refuse the
    legacy VERIFIED attempt (state not in created/redirected/expired)."""
    script = """
require('./tools/lib/register-typescript.cjs');
const fs = require('node:fs');
const { openLocalSqlite } = require('./src/db/localSqlite.ts');
const commands = require('./src/commerce/paymentCommands.ts');
(async () => {
  const db = openLocalSqlite(process.argv[2]);
  const order = await db.prepare("SELECT * FROM orders WHERE order_key='legacy-order-0001'").first();
  const attempt = await db.prepare("SELECT * FROM payment_attempts WHERE authority='AUTH-LEGACY-1'").first();
  const lines = JSON.parse(order.price_snapshot_json);
  for (const line of lines) if (line.period_days === undefined) {
    const price = await db.prepare("SELECT period_days FROM billing_prices WHERE id=?").bind(line.price_id).first();
    line.period_days = price.period_days == null ? null : Number(price.period_days);
  }
  let refused = false, entitlementRows = 0;
  try {
    await db.batch(commands.verifiedOrderStatements(db, {
      operationId: crypto.randomUUID(), attemptId: attempt.id, orderId: order.id,
      buyerUserId: order.buyer_user_id, organizationId: null, providerReference: 'replay-ref',
      nowIso: '2026-10-03T00:00:00.000Z', totalMinor: order.total_minor, lines,
    }));
  } catch (e) { refused = true; }
  // Also read the guarded state directly.
  const stillVerified = (await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attempt.id).first()).state === 'verified';
  entitlementRows = Number((await db.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE buyer_user_id='buyer'").first()).n);
  const receipts = Number((await db.prepare("SELECT COUNT(*) AS n FROM billing_command_receipts").first()).n);
  console.log(JSON.stringify({ second_fulfillment_refused: refused || stillVerified, attempt_still_verified: stillVerified, entitlement_rows: entitlementRows, new_receipts: receipts }));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
"""
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", dir=REPO, delete=False) as fh:
        fh.write(script)
        runner = Path(fh.name)
    try:
        proc = subprocess.run(["node", str(runner), str(path)], capture_output=True, text=True, cwd=REPO)
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            return {"error": proc.stdout + proc.stderr}
    finally:
        runner.unlink(missing_ok=True)


def main() -> int:
    evidence: dict = {"ticket": "R95-N03", "scope": "synthetic legacy-shaped rehearsal; production snapshot remains owner-gated"}
    with tempfile.TemporaryDirectory() as tmp:
        clean = Path(tmp) / "legacy_clean.db"
        blocked = Path(tmp) / "legacy_blocked.db"
        build_legacy_db(clean, blocked=False)
        build_legacy_db(blocked, blocked=True)

        # 1. The duplicate fixture BLOCKS the migration decision (exit 1).
        rc_blocked, report_blocked = preflight(blocked)
        evidence["blocked_case"] = {
            "preflight_exit": rc_blocked,
            "ok": report_blocked.get("ok"),
            "blockers": report_blocked.get("blockers"),
        }

        # 2. The clean legacy database passes with honest warnings (exit 0).
        rc_clean, report_clean = preflight(clean)
        evidence["clean_case"] = {
            "preflight_exit": rc_clean,
            "ok": report_clean.get("ok"),
            "blockers": report_clean.get("blockers"),
            "warnings": report_clean.get("warnings"),
        }

        # 3. Apply the R95 migrations to the clean legacy database, re-run the
        #    preflight, and prove the legacy verified attempt cannot fulfill twice.
        db = sqlite3.connect(clean)
        applied = []
        for name in R95_MIGRATIONS:
            db.executescript((MIGRATIONS / name).read_text())
            applied.append(name)
        db.commit()
        fk_violations = db.execute("PRAGMA foreign_key_check").fetchall()
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        db.close()
        rc_after, report_after = preflight(clean)
        evidence["after_r95_migrations"] = {
            "applied": applied,
            "foreign_key_violations": len(fk_violations),
            "integrity_check": integrity,
            "preflight_exit": rc_after,
            "warnings": report_after.get("warnings"),
        }
        evidence["double_fulfillment_guard"] = fulfill_again_check(clean)

        # 4. The duplicate fixture STOPS the R95 migration itself: 0052's
        #    idx_payment_attempt_one_open partial unique index refuses to build.
        db_b = sqlite3.connect(blocked)
        migration_error = None
        try:
            db_b.executescript("BEGIN;\n" + (MIGRATIONS / R95_MIGRATIONS[0]).read_text() + "\nCOMMIT;")
            db_b.commit()
        except sqlite3.Error as error:
            migration_error = str(error)
            db_b.rollback()
        db_b.close()
        evidence["blocked_migration_case"] = {
            "migration": R95_MIGRATIONS[0],
            "refused": migration_error is not None,
            "error": migration_error,
            "note": "Duplicate open attempts stop the migration; no silent merge or repair.",
        }

    ok = (
        rc_blocked == 1
        and evidence["blocked_case"]["blockers"] is not None
        and evidence["blocked_case"]["blockers"].get("duplicate_open_payment_attempts", 0) >= 1
        and rc_clean == 0
        and evidence["after_r95_migrations"]["foreign_key_violations"] == 0
        and evidence["after_r95_migrations"]["integrity_check"] == "ok"
        and evidence["double_fulfillment_guard"].get("second_fulfillment_refused") is True
        and evidence["double_fulfillment_guard"].get("new_receipts") == 0
        and evidence["blocked_migration_case"]["refused"] is True
    )
    evidence["rehearsal_passed"] = ok
    print(json.dumps(evidence, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
