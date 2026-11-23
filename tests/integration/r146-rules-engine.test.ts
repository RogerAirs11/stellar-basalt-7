import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  adminCreateRegistryRule,
  adminRegistryRuleDetail,
  adminPatchRegistryRule,
  adminTransitionRegistryRule,
  adminPreviewRegistryRule,
  enforceRegistryRules,
} from "../../src/api/modules/registryRules";
import { evaluateRegistryRules, parseRuleSpec } from "../../src/registry/rulesEngine";
import workerDefault from "../../src/worker";
import { HttpError } from "../../src/api/http";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";


const worker = workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> };
const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

async function createHorseViaHttp(db: D1Database, session: AuthedSession, body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(authedRequest("/api/horses", body, { session }), makeEnv(db));
}

/**
 * R146-D04 (Master-AI plan) — the bounded, versioned rules service.
 *
 * Acceptance under test:
 *   - Typed rules only: an admin cannot submit executable policy — every
 *     spec must satisfy its per-rule-type zod schema (SQL/JS-looking specs
 *     are refused at create AND at patch).
 *   - Ordered states: draft -> report_only -> active -> retired; skips are
 *     refused; retired is terminal; edits are refused on active rules.
 *   - Preview evaluates a draft against existing records WITHOUT recording.
 *   - Only ACTIVE rules gate the write paths; zero active rules = no-op.
 *   - A 'blocker' failure refuses the create with an explainable 422 and
 *     can never be overridden; a 'warning' failure passes only with a
 *     recorded override (actor + reason in the outcome trail).
 *   - Chronology rules SKIP when either side is unknown (uncertainty is
 *     preserved, never invented).
 *   - Every write path evaluates the same engine: create (direct route),
 *     and the shared enforceRegistryRules used by reviewed applies and
 *     imports.
 */

const env = () => ({ SESSION_COOKIE_NAME: "hr_session" });

async function expectHttpError<T>(promise: Promise<T>, status: number, code?: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected HttpError ${status}, but the call succeeded`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.status).toBe(status);
    if (code) expect(httpError.code).toBe(code);
  }
}

describe("R146-D04 — rule store: typed specs, no executable policy", () => {
  let db: D1Database;
  let admin: AuthedSession;
  let editor: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-admin", "admin");
    await seedUser(db, "r146-editor", "editor");
    admin = await makeSession(db, "r146-admin");
    editor = await makeSession(db, "r146-editor");
  });

  const create = (body: Record<string, unknown>, session: AuthedSession = admin) =>
    adminCreateRegistryRule(authedRequest("/api/admin/registry-rules", body, { session }), { DB: db, ...env() });

  it("creates a draft rule with a validated spec and version 1", async () => {
    const response = await create({
      id: "numbering.persian",
      rule_type: "registration_numbering",
      title: "Persian registrations carry the IR prefix and digit pattern",
      severity: "warning",
      applicability: { breeds: ["Persian"] },
      spec: { prefix: "IR", pattern: "^IR[0-9]{4,8}$", require_prefix_match: true, uniqueness_scope: "global", case_insensitive: true },
    });
    const body = await response.json() as { rule: { id: string; state: string; version: number; spec: Record<string, unknown> } };
    expect(body.rule.id).toBe("numbering.persian");
    expect(body.rule.state).toBe("draft");
    expect(body.rule.version).toBe(1);
    expect(body.rule.spec.prefix).toBe("IR");
  });

  it("refuses a spec that does not satisfy its typed schema (no executable policy)", async () => {
    await expectHttpError(create({
      id: "numbering.bad",
      rule_type: "registration_numbering",
      title: "Broken numbering spec",
      severity: "error",
      spec: { prefix: "IR", pattern: "^[a-z]+$", uniqueness_scope: "SOMETING-ELSE" },
    }), 422, "invalid_rule_spec");
    await expectHttpError(create({
      id: "numbering.bad2",
      rule_type: "chronology",
      title: "Broken chronology spec",
      severity: "error",
      spec: { require_birth_before_death: "yes-please" },
    }), 422, "invalid_rule_spec");
    // An invalid regex source is data-checked too — it can never compile at eval time.
    await expectHttpError(create({
      id: "numbering.bad3",
      rule_type: "registration_numbering",
      title: "Invalid regex",
      severity: "error",
      spec: { prefix: "IR", pattern: "^IR([0-9]+$", require_prefix_match: false },
    }), 422, "invalid_rule_spec");
  });

  it("refuses ids/titles that do not meet the slug/length contract and duplicate ids", async () => {
    await expectHttpError(create({
      id: "Bad Id With Spaces",
      rule_type: "chronology",
      title: "Bad id rule",
      severity: "info",
      spec: {},
    }), 400, "invalid_rule");
    await create({ id: "numbering.dup", rule_type: "chronology", title: "First duplicate", severity: "info", spec: {} });
    await expectHttpError(create({ id: "numbering.dup", rule_type: "chronology", title: "Second duplicate", severity: "info", spec: {} }), 409, "rule_exists");
  });

  it("gates the store on maintenance.run (editor is 403)", async () => {
    await expectHttpError(create({
      id: "numbering.editor",
      rule_type: "chronology",
      title: "Editor cannot create rules",
      severity: "info",
      spec: {},
    }, editor), 403);
  });
});

describe("R146-D04 — state machine: draft -> report_only -> active -> retired", () => {
  let db: D1Database;
  let admin: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-admin", "admin");
    admin = await makeSession(db, "r146-admin");
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by)
      VALUES('chronology.order','chronology','Death not before birth','error','{}','{"require_birth_before_death":true,"forbid_future_birth":false,"min_parent_age_gap_years":null}','draft',1,'r146-admin','r146-admin')`);
    await db.exec(`INSERT INTO registry_rule_versions(rule_id,version,state,title,severity,applicability_json,spec_json,changed_by,change_note)
      VALUES('chronology.order',1,'draft','Death not before birth','error','{}','{"require_birth_before_death":true}','r146-admin','created')`);
  });

  const transition = (state: string, session: AuthedSession = admin) =>
    adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 1, state }, { session }), { DB: db, ...env() }, "chronology.order");
  const detail = () => adminRegistryRuleDetail(authedRequest("/api/admin/registry-rules/chronology.order", undefined, { session: admin }), { DB: db, ...env() }, "chronology.order");

  it("walks the ordered path and refuses skips", async () => {
    await expectHttpError(transition("active"), 422, "invalid_rule_transition"); // draft -> active refused
    await transition("report_only");
    await adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 2, state: "active" }, { session: admin }), { DB: db, ...env() }, "chronology.order");
    await adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 3, state: "retired" }, { session: admin }), { DB: db, ...env() }, "chronology.order");
    const after = await detail();
    const body = await after.json() as { rule: { state: string; version: number }; versions: Array<{ version: number; state: string }> };
    expect(body.rule.state).toBe("retired");
    expect(body.versions.length).toBeGreaterThanOrEqual(4); // created + report_only + active + retired — history reconstructable
    expect(body.versions.map((version) => version.state)).toContain("active");
  });

  it("refuses stale expected_version and edits on active rules", async () => {
    await expectHttpError(adminTransitionRegistryRule(
      authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 99, state: "report_only" }, { session: admin }),
      { DB: db, ...env() }, "chronology.order",
    ), 409, "rule_version_conflict");
    await transition("report_only");
    // report_only stays editable.
    const patched = await adminPatchRegistryRule(
      authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 2, title: "Edited while report_only" }, { session: admin }),
      { DB: db, ...env() }, "chronology.order",
    );
    const patchedBody = await patched.json() as { rule: { title: string; version: number } };
    expect(patchedBody.rule.title).toBe("Edited while report_only");
    expect(patchedBody.rule.version).toBe(3);
    await db.prepare("UPDATE registry_rules SET version=4, state='active' WHERE id='chronology.order'").run();
    await expectHttpError(adminPatchRegistryRule(
      authedRequest("/api/admin/registry-rules/chronology.order", { expected_version: 4, title: "Edited while active" }, { session: admin }),
      { DB: db, ...env() }, "chronology.order",
    ), 409, "rule_immutable");
  });
});

describe("R146-D04 — evaluation semantics", () => {
  let db: D1Database;
  let admin: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-admin", "admin");
    admin = await makeSession(db, "r146-admin");
    await db.exec(`INSERT INTO horses(id,name_latin,breed_desc,sex_desc,register_no,birth_year,death_date_value,is_dead) VALUES
      (14601,'Rule Subject A','Persian','Mare',NULL,2015,NULL,0),
      (14602,'Rule Subject B','Persian','Stallion','IR4471',2010,NULL,0)`);
  });

  it("only evaluates rules in the requested states and matching applicability", async () => {
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by) VALUES
      ('numbering.only','registration_numbering','IR pattern','error','{"breeds":["Persian"]}','{"prefix":"IR","pattern":"^IR[0-9]{4,8}$","require_prefix_match":true,"uniqueness_scope":"global","case_insensitive":true}','active',1,'x','x'),
      ('chronology.draft','chronology','Draft rule','error','{}','{"require_birth_before_death":true,"forbid_future_birth":false,"min_parent_age_gap_years":null}','draft',1,'x','x')`);
    const outcome = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, breed_desc: "Persian", register_no: null },
    }, { states: ["active"] });
    expect(outcome.evaluatedRules.map((rule) => rule.rule_id)).toEqual(["numbering.only"]);
    // A horse outside the applicability breed is not evaluated at all.
    const other = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, breed_desc: "Thoroughbred", register_no: null },
    }, { states: ["active"] });
    expect(other.evaluatedRules).toEqual([]);
  });

  it("chronology skips unknown dates instead of failing them (uncertainty preserved)", async () => {
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by) VALUES
      ('chronology.strict','chronology','Birth before death + future guard','blocker','{}','{"require_birth_before_death":true,"forbid_future_birth":true,"min_parent_age_gap_years":null}','active',1,'x','x')`);
    const unknown = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, birth_year: null, death_date_value: null },
    }, { states: ["active"] });
    expect(unknown.failures).toEqual([]);
    expect(unknown.blocked).toEqual([]);
    // Known contradiction fails as a blocker.
    const contradictory = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, birth_year: 2015, death_date_value: "2010-05-01", death_date_precision: "day", death_date_calendar: "gregorian" },
    }, { states: ["active"] });
    expect(contradictory.blocked.length).toBe(1);
    expect(contradictory.blocked[0].requirement).toBe("death_not_before_birth");
  });

  it("parent age-gap evaluation uses resolved parent context and skips unknowns", async () => {
    await db.exec(`INSERT INTO horses(id,name_latin,birth_year,sex_desc) VALUES (14650,'Old Sire',1980,'Stallion')`);
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by) VALUES
      ('chronology.gap','chronology','Minimum parent age gap','error','{}','{"require_birth_before_death":false,"forbid_future_birth":false,"min_parent_age_gap_years":4}','active',1,'x','x')`);
    // Parent resolved through buildRuleSubject-equivalent inline context.
    const fail = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, birth_year: 2015, father_id: 14650, father_birth_year: 2013 },
    }, { states: ["active"] });
    expect(fail.failures.length).toBe(1);
    expect(fail.failures[0].requirement).toBe("parent_age_gap>=4");
    const unknownParent = await evaluateRegistryRules(db, {
      subjectType: "horse_update", subjectRef: 14601,
      record: { horse_id: 14601, birth_year: 2015, father_id: 14650, father_birth_year: null },
    }, { states: ["active"] });
    expect(unknownParent.failures).toEqual([]);
  });
});

describe("R146-D04 — preview against existing records", () => {
  let db: D1Database;
  let admin: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-admin", "admin");
    admin = await makeSession(db, "r146-admin");
    await db.exec(`INSERT INTO horses(id,name_latin,breed_desc,sex_desc,register_no,birth_year) VALUES
      (14661,'Preview A','Persian','Stallion','XX1',2012),
      (14662,'Preview B','Persian','Mare','IR9001',2014)`);
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by) VALUES
      ('numbering.preview','registration_numbering','IR pattern','error','{}','{"prefix":"IR","pattern":"^IR[0-9]{4,8}$","require_prefix_match":true,"uniqueness_scope":"global","case_insensitive":true}','draft',1,'r146-admin','r146-admin')`);
  });

  it("reports pass/fail counts and a bounded failure sample without recording outcomes", async () => {
    const response = await adminPreviewRegistryRule(
      authedRequest("/api/admin/registry-rules/numbering.preview", { limit: 50 }, { session: admin }),
      { DB: db, ...env() }, "numbering.preview",
    );
    const body = await response.json() as { previewed: number; pass: number; fail: number; sample: Array<{ horse_id: number }> };
    expect(body.previewed).toBe(2);
    expect(body.fail).toBe(1);
    expect(body.pass).toBe(1);
    expect(body.sample.length).toBe(1);
    expect(body.sample[0].horse_id).toBe(14661);
    const outcomes = await db.prepare("SELECT COUNT(*) AS n FROM registry_rule_outcomes WHERE rule_id='numbering.preview'").first<{ n: number }>();
    expect(Number(outcomes?.n ?? 0)).toBe(0); // preview records NOTHING
  });
});

describe("R146-D04 — the write paths enforce active rules consistently", () => {
  let db: D1Database;
  let admin: AuthedSession;
  let editor: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-admin", "admin");
    await seedUser(db, "r146-editor", "editor");
    admin = await makeSession(db, "r146-admin");
    editor = await makeSession(db, "r146-editor");
    await db.exec(`INSERT INTO horses(id,name_latin,breed_desc,sex_desc,register_no,birth_year) VALUES
      (14671,'Existing Persian','Persian','Mare','IR1001',2012)`);
    // An active numbering rule: blocker severity, Persian-only applicability.
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by) VALUES
      ('numbering.blocker','registration_numbering','Persian numbers carry IR','blocker','{"breeds":["Persian"]}','{"prefix":"IR","pattern":"^IR[0-9]{4,8}$","require_prefix_match":true,"uniqueness_scope":"global","case_insensitive":true}','active',1,'r146-admin','r146-admin')`);
  });

  it("a blocker refuses the create with an explainable 422; the horse is not written", async () => {
    const response = await createHorseViaHttp(db, editor, { name_latin: "Blocked Foal", breed_desc: "Persian", sex_desc: "Filly", register_no: "XX99" });
    expect(response.status).toBe(422);
    const body = await response.json() as { error: { code: string; details?: { blocked?: Array<{ rule_id: string }>; overridable?: unknown } } };
    expect(body.error.code).toBe("registry_rule_violation");
    expect(body.error.details?.blocked?.map((entry) => entry.rule_id)).toEqual(["numbering.blocker"]);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM horses WHERE name_latin='Blocked Foal'").first<{ n: number }>();
    expect(Number(count?.n ?? 0)).toBe(0);
    const outcomes = await db.prepare("SELECT COUNT(*) AS n FROM registry_rule_outcomes WHERE rule_id='numbering.blocker'").first<{ n: number }>();
    expect(Number(outcomes?.n ?? 0)).toBe(0); // blocked write records no override
  });

  it("a warning failure passes only with a recorded override (actor + reason in the trail)", async () => {
    await db.prepare("UPDATE registry_rules SET severity='warning' WHERE id='numbering.blocker'").run();
    // Without an override: refused.
    const refused = await createHorseViaHttp(db, editor, { name_latin: "Unoverridden Foal", breed_desc: "Persian", sex_desc: "Colt", register_no: "XX98" });
    expect(refused.status).toBe(422);
    // With an override: created, and the outcome trail records actor + reason.
    const response = await createHorseViaHttp(db, editor, {
      name_latin: "Overridden Foal", breed_desc: "Persian", sex_desc: "Colt", register_no: "XX97",
      rule_overrides: [{ rule_id: "numbering.blocker", reason: "Imported UK passport number; prefix conversion filed with the federation" }],
    });
    expect(response.status).toBe(201);
    const outcome = await db.prepare("SELECT outcome,override_by,override_reason FROM registry_rule_outcomes WHERE rule_id='numbering.blocker' ORDER BY id DESC LIMIT 1").first<{ outcome: string; override_by: string; override_reason: string }>();
    expect(outcome?.outcome).toBe("override");
    expect(outcome?.override_by).toBe("r146-editor");
    expect(outcome?.override_reason).toContain("federation");
  });

  it("an override supplied for a rule that did not fail is recorded as an honest no-op receipt", async () => {
    await db.prepare("UPDATE registry_rules SET severity='blocker' WHERE id='numbering.blocker'").run();
    const response = await createHorseViaHttp(db, editor, {
      name_latin: "Redundant Override Foal", breed_desc: "Persian", sex_desc: "Colt", register_no: "IR7701",
      rule_overrides: [{ rule_id: "numbering.blocker", reason: "Reviewer pre-cleared this number offline" }],
    });
    expect(response.status).toBe(201);
    const outcome = await db.prepare("SELECT outcome,override_reason FROM registry_rule_outcomes WHERE rule_id='numbering.blocker' ORDER BY id DESC LIMIT 1").first<{ outcome: string; override_reason: string }>();
    expect(outcome?.outcome).toBe("override");
    expect(outcome?.override_reason).toContain("pre-cleared");
  });

  it("enforceRegistryRules is the shared gate (reviewed applies and imports call the same engine)", async () => {
    const subject = {
      subjectType: "import" as const,
      subjectRef: "batch:1:row:1",
      viaImport: true,
      record: { name_latin: "Import Blocked", breed_desc: "Persian", register_no: "XX96" },
    };
    await expectHttpError(enforceRegistryRules(db, subject, null), 422, "registry_rule_violation");
    const ok = await enforceRegistryRules(db, { ...subject, record: { ...subject.record, register_no: "IR3301" } }, null);
    expect(ok.outcome.failures).toEqual([]);
    // Malformed override payloads are a deterministic 400.
    await expectHttpError(enforceRegistryRules(db, subject, [{ rule_id: "numbering.blocker" }]), 400, "invalid_rule_overrides");
  });
});

describe("R146-D04 — parseRuleSpec sanity", () => {
  it("applies defaults and refuses out-of-vocabulary rule types", () => {
    const ok = parseRuleSpec("studbook_admission", { breed: "Persian" });
    expect(ok.ok).toBe(true);
    const bad = parseRuleSpec("exec_sql" as never, { query: "DROP TABLE horses" });
    expect(bad.ok).toBe(false);
  });
});
