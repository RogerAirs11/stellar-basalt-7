import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { adminCreateRegistryRule, adminTransitionRegistryRule } from "../../src/api/modules/registryRules";
import { routeEquineCare } from "../../src/api/modules/equineCare";
import { HttpError, error } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";

/**
 * R149 Gate E — care commands evaluate the SAME versioned registry-rule
 * service as the canonical admission paths, capture the policy epoch, and
 * commit care mutation + private history + policy decision + operation
 * receipt in ONE transaction. Every command below runs the production care
 * dispatcher against every numbered migration on a real SQLite database.
 */

const command = () => ({ operation_id: crypto.randomUUID(), reason: "Documented fictional local review fixture" });
async function grant(db: D1Database, user: string, horse: number, permissions: string[], kind = "veterinarian") {
  await db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,valid_from) VALUES(?,?,?,?,?,?,?,'admin_grant','2020-01-01T00:00:00Z')`)
    .bind(crypto.randomUUID(), horse, user, kind, permissions.join(","), "fictional-authority", "fictional-assignment").run();
}
async function world() {
  const db = await openRealDatabase();
  for (const [id, role] of [["care-vet", "user"], ["rule-admin", "admin"]] as const) await seedUser(db, id, role);
  await db.exec(`INSERT INTO horses(id,name_latin,sex_desc,breed_desc,microchip_no) VALUES
    (14901,'Fictional genetic dam','Mare','Arabian','000123'),
    (14902,'Fictional recipient dam','Mare','Arabian','000456'),
    (14903,'Fictional non-Arabian dam','Mare','Part Bred','000999')`);
  for (const id of [14901, 14902, 14903]) await grant(db, "care-vet", id, ["clinical_write", "sample_submit", "private_file_export"]);
  return { db, vet: await makeSession(db, "care-vet"), admin: await makeSession(db, "rule-admin") };
}
async function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  const request = authedRequest(path, body, { session, method });
  try { return (await routeEquineCare(request, { DB: db, SESSION_COOKIE_NAME: "hr_session", APP_ENV: "test", EQUINE_CARE_MODE: "local_review" }, new URL(request.url)))!; }
  catch (cause) { if (cause instanceof HttpError) return error(cause.status, cause.code, cause.message, cause.details); throw cause; }
}
const base = (horse = 14901) => `/api/horses/${horse}/care`;
const ruleEnv = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });
async function installRule(db: D1Database, admin: AuthedSession, id: string, ruleType: string, spec: Record<string, unknown>, extra: { applicability?: Record<string, unknown>; severity?: string } = {}) {
  const { applicability, ...rest } = extra;
  const payload = { id, rule_type: ruleType, title: `Care policy fixture ${id}`, severity: "blocker", spec, applicability: { subject_types: [], ...(applicability ?? {}) }, ...rest };
  const created = await adminCreateRegistryRule(authedRequest("/api/admin/registry-rules", payload, { session: admin }), ruleEnv(db));
  expect(created.status, await created.clone().text()).toBe(201);
  for (const [expected_version, state] of [[1, "report_only"], [2, "active"]] as const) {
    expect((await adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/state", { expected_version, state }, { session: admin }), ruleEnv(db), id)).status).toBe(200);
  }
  return id;
}
const episode = (over: Record<string, unknown> = {}) => ({
  ...command(), method: "natural_cover", outcome: "planned", offspring: [], source_ref: "fictional-covering-record", ...over,
});
async function document(db: D1Database, horse = 14901) {
  const id = crypto.randomUUID(), bytes = new TextEncoder().encode("%PDF-1.4\nFictional local evidence fixture\n%%EOF");
  await db.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state) VALUES(?,?,'document','veterinary','fictional.pdf','application/pdf',?,'care-vet','private')`).bind(id, horse, bytes.length).run();
  await db.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)").bind(id, bytes).run();
  return id;
}
async function policyFacts(db: D1Database, operationId: string) {
  const row = await db.prepare("SELECT policy_revision,policy_evaluated_json FROM equine_care_operations WHERE operation_id=?").bind(operationId).first<{ policy_revision: number; policy_evaluated_json: string }>();
  return row;
}
const CARE_TABLES = ["equine_care_operations", "equine_care_history", "equine_reproductive_episodes", "registry_policy_receipts", "registry_rule_outcomes", "audit_events"];
async function state(db: D1Database) {
  return { counts: await Promise.all(CARE_TABLES.map(table => countRows(db, table))) };
}
function beforeBatch(db: D1Database, action: () => Promise<unknown>): D1Database {
  let injected = false;
  return { ...db, async batch(statements: Parameters<D1Database["batch"]>[0]) {
    if (!injected) { injected = true; await action(); }
    return db.batch(statements);
  } } as D1Database;
}

describe("R149 Gate E: care intake evaluates the versioned registry policy", () => {
  it("refuses a reproductive method outside the studbook's approved list before any residue; an approved method commits with a policy receipt", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.method", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } },
      { applicability: { subject_types: ["care_reproduction"], breeds: ["Arabian"] } });
    const refused = await call(db, `${base()}/reproduction`, episode({ method: "embryo_transfer", recipient_dam_id: 14902 }), vet);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "registry_rule_violation" } });
    expect(await countRows(db, "equine_care_operations")).toBe(0);
    expect(await countRows(db, "registry_policy_receipts")).toBe(0);

    const accepted = await call(db, `${base()}/reproduction`, episode(), vet);
    expect(accepted.status, await accepted.clone().text()).toBe(201);
    const { receipt } = await accepted.json() as { receipt: { id: string; operation_id: string; policy: { revision: number; evaluated_rules: number } } };
    expect(receipt.policy.evaluated_rules).toBe(1);
    const facts = await policyFacts(db, receipt.operation_id);
    expect(Number(facts!.policy_revision)).toBeGreaterThan(0);
    expect(JSON.parse(facts!.policy_evaluated_json)).toEqual([{ rule_id: "policy.care.method", version: 3 }]);
    expect(await countRows(db, "registry_policy_receipts")).toBe(1);
    expect(await countRows(db, "registry_rule_outcomes")).toBe(0); // pass — outcomes record fails/overrides only
  });

  it("twins are a configurable operator decision, never a universal rule; recipient-dam requirements follow the method", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.offspring", "studbook_admission",
      { breed: "Arabian", care_reproduction: { max_offspring_per_episode: 1 } },
      { applicability: { subject_types: ["care_reproduction"] } });
    const twins = episode({ outcome: "foaled", outcome_on: "2025-03-01", offspring: [{ outcome: "live" }, { outcome: "live" }] });
    expect((await call(db, `${base()}/reproduction`, twins, vet)).status).toBe(422);
    // Same corpus, a different (fictional) studbook decision: twins allowed.
    await db.prepare("UPDATE registry_rules SET spec_json=? WHERE id='policy.care.offspring'").bind(JSON.stringify({ breed: "Arabian", care_reproduction: { max_offspring_per_episode: 2 } })).run();
    expect((await call(db, `${base()}/reproduction`, twins, vet)).status, "a policy LIMIT is configurable — no universal twins ban").toBe(201);

    await installRule(db, admin, "policy.care.recipient", "studbook_admission",
      { breed: "Arabian", care_reproduction: { require_recipient_dam_methods: ["embryo_transfer"], forbid_recipient_dam_methods: ["natural_cover"] } },
      { applicability: { subject_types: ["care_reproduction"] } });
    expect((await call(db, `${base()}/reproduction`, episode({ method: "embryo_transfer" }), vet)).status).toBe(422);
    // A natural_cover episode with a recipient dam is refused by the HARD
    // physical invariant before policy — exactly the separation Gate E
    // demands (configurable policy can never relax physical impossibility).
    const physical = await call(db, `${base()}/reproduction`, episode({ recipient_dam_id: 14902 }), vet);
    expect(physical.status).toBe(400);
    expect(await physical.json()).toMatchObject({ error: { code: "invalid_care_record" } });
    expect((await call(db, `${base()}/reproduction`, episode({ method: "embryo_transfer", recipient_dam_id: 14902 }), vet)).status).toBe(201);
  });

  it("care evidence minimums govern only the named care commands; report_only stays informational", async () => {
    const { db, vet, admin } = await world();
    await db.prepare("UPDATE registry_rules SET state='report_only' WHERE 1=0").run(); // no-op keeps intent explicit
    await installRule(db, admin, "policy.care.evidence", "required_evidence",
      { care_commands: ["reproduction.create"] }, { applicability: { subject_types: ["care_reproduction"] } });
    // Demote to report_only: evaluation stays visible but never refuses.
    await db.prepare("UPDATE registry_rules SET state='report_only' WHERE id='policy.care.evidence'").run();
    const info = await call(db, `${base()}/reproduction`, episode(), vet);
    expect(info.status).toBe(201);
    const infoOutcome = await db.prepare("SELECT outcome FROM registry_rule_outcomes ORDER BY id DESC LIMIT 1").first<{ outcome: string }>();
    expect(infoOutcome?.outcome).toBe("fail"); // recorded, informational
    await db.prepare("UPDATE registry_rules SET state='active' WHERE id='policy.care.evidence'").run();
    expect((await call(db, `${base()}/reproduction`, episode(), vet)).status).toBe(422);
    const withEvidence = await call(db, `${base()}/reproduction`, episode({ evidence_media_id: await document(db) }), vet);
    expect(withEvidence.status).toBe(201);
    // A clinical command is NOT in the rule's list — policy never reaches it.
    expect((await call(db, `${base()}/clinical`, { ...command(), event_type: "examination", occurred_on: "2024-01-02", title: "Fictional examination", findings: "Fictional findings", source_ref: "fictional-note" }, vet)).status).toBe(201);
  });

  it("warning failures need a documented override; blockers can never be overridden", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.warn", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } },
      { severity: "warning", applicability: { subject_types: ["care_reproduction"] } });
    expect((await call(db, `${base()}/reproduction`, episode({ method: "icsi" }), vet)).status).toBe(422);
    const overridden = await call(db, `${base()}/reproduction`, episode({ method: "icsi", rule_overrides: [{ rule_id: "policy.care.warn", reason: "Documented, authorized fictional exception" }] }), vet);
    expect(overridden.status).toBe(201);
    expect((await db.prepare("SELECT outcome FROM registry_rule_outcomes WHERE rule_id='policy.care.warn'").first<{ outcome: string }>())?.outcome).toBe("override");

    const { db: db2, vet: vet2, admin: admin2 } = await world();
    await installRule(db2, admin2, "policy.care.block", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } }, { applicability: { subject_types: ["care_reproduction"] } });
    const blocked = await call(db2, `${base()}/reproduction`, episode({ method: "icsi", rule_overrides: [{ rule_id: "policy.care.block", reason: "Even a documented reason cannot cross a blocker" }] }), vet2);
    expect(blocked.status).toBe(422);
    expect(await countRows(db2, "equine_care_operations")).toBe(0);
  });

  it("a first care-rule activation during an empty policy set races the batch: 409, no residue", async () => {
    const { db, vet, admin } = await world();
    const before = await state(db);
    const raced = beforeBatch(db, () => installRule(db, admin, "policy.care.race", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } }, { applicability: { subject_types: ["care_reproduction"] } }));
    const response = await call(raced, `${base()}/reproduction`, episode(), vet);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "registry_policy_context_changed" } });
    expect(await state(db)).toEqual(before);
  });

  it("retirement during the batch fails closed the same way", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.retire", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } }, { applicability: { subject_types: ["care_reproduction"] } });
    const before = await state(db);
    const raced = beforeBatch(db, async () => {
      await adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/state", { expected_version: 3, state: "retired" }, { session: admin }), ruleEnv(db), "policy.care.retire");
    });
    const response = await call(raced, `${base()}/reproduction`, episode(), vet);
    expect(response.status).toBe(409);
    expect(await state(db)).toEqual(before);
  });

  it("concurrent duplicate commands race on the receipt: exactly one episode, one history row, one policy receipt", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.concurrent", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } }, { applicability: { subject_types: ["care_reproduction"] } });
    const input = episode();
    const [first, second] = await Promise.allSettled([
      call(db, `${base()}/reproduction`, input, vet),
      call(db, `${base()}/reproduction`, input, vet),
    ]);
    const bodies = await Promise.all(([first, second] as PromiseSettledResult<Response>[]).map(async (r) => {
      if (r.status !== "fulfilled") return { status: 0 };
      const clone = r.value.clone();
      return { status: r.value.status, body: await clone.json() };
    }));
    expect(bodies.filter(b => b.status === 201).length).toBe(2); // the loser replays the winner's receipt (idempotent retry)
    expect(JSON.stringify(bodies[0]!.body)).toBe(JSON.stringify(bodies[1]!.body));
    expect(await countRows(db, "equine_reproductive_episodes")).toBe(1);
    expect(await countRows(db, "equine_care_history")).toBe(1);
    expect(await countRows(db, "registry_policy_receipts")).toBe(1);
  });

  it("a canonical participant correction during the batch forces the care command to retry", async () => {
    const { db, vet } = await world();
    const raced = beforeBatch(db, async () => {
      await db.prepare("UPDATE horses SET row_version=row_version+1 WHERE id=14902").run();
    });
    const response = await call(raced, `${base()}/reproduction`, episode({ method: "embryo_transfer", recipient_dam_id: 14902 }), vet);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "care_state_changed" } });
    expect(await countRows(db, "equine_reproductive_episodes")).toBe(0);
  });

  it("private care facts stay out of the policy receipt beyond the bounded server-built record", async () => {
    const { db, vet, admin } = await world();
    await installRule(db, admin, "policy.care.facts", "studbook_admission",
      { breed: "Arabian", care_reproduction: { allowed_methods: ["natural_cover"] } }, { applicability: { subject_types: ["care_reproduction"] } });
    const secret = "PRIVATE-CLINICAL-DETAIL-NEVER-IN-RECEIPT";
    expect((await call(db, `${base()}/reproduction`, episode({ notes: secret }), vet)).status).toBe(201);
    const receipt = await db.prepare("SELECT context_json FROM registry_policy_receipts").first<{ context_json: string }>();
    expect(receipt!.context_json).not.toContain(secret);
    expect(receipt!.context_json).toContain("care_command");
  });
});
