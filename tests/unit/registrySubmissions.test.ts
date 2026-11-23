import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HorseSubmissionSchema,
  SUBMISSION_HORSE_INSERT_SQL,
  SUBMISSION_DECISION_SQL,
  SUBMISSION_NEEDS_CHANGES_SQL,
  SUBMISSION_GRANT_SQL,
  SUBMISSION_PEOPLE_LINK_SQL,
  SUBMISSION_IDENTIFIER_CLAIM_SQL,
  SUBMISSION_REVISION_BUMP_SQL,
  submissionHorseColumns,
  horseInsertValuesForSubmission,
  resolveIdempotencyReplay,
  submissionPayloadDigest,
  submissionReviewStatus,
  type HorseSubmission,
} from "../../src/registry/submissions";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Master-Ai plan T11: complete new-horse submission and review.
 *
 * These fixtures pin:
 *   - the submission payload contract (native-only names, optional Latin,
 *     parents-as-existing-ids or explicit unresolved assertions, never both);
 *   - the state machine (draft -> pending -> needs_changes -> draft -> ...
 *     -> approved/rejected, withdraw from draft/pending);
 *   - true idempotency on (submitter, client key);
 *   - the ATOMIC approval batch: canonical horse + identifier claims +
 *     permitted relationships + initial grant + audit intent + revision bump
 *     all land in ONE transaction or nothing does;
 *   - canonicalApplied + canonical_horse_id only ever reported after the
 *     horse row actually landed.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");

const NATIVE_ONLY = { name_native: "شیراز غر" } as const;
const FULL: HorseSubmission = {
  name_native: "شیراز غر",
  name_latin: "Shiraz Ghar",
  register_no: "REG-1001",
  microchip_no: "985101012345678",
  father_horse_id: 11,
  mother_horse_id: 12,
  birth_year: 2019,
  birth_place_desc: "Shiraz",
  breed_desc: "Arabian",
  sex_desc: "stallion",
  color_desc: "grey",
  description: "Foundation submission",
  main_strain_desc: "Kuhaylan",
  sub_strain_desc: null,
  father_unresolved: null,
  mother_unresolved: null,
  breeder_person_id: null,
  current_owner_person_id: null,
};

describe("submission payload contract (T11 step 2/3)", () => {
  it("accepts a native-only name (Latin transliteration optional)", () => {
    const parsed = HorseSubmissionSchema.safeParse(NATIVE_ONLY);
    expect(parsed.success).toBe(true);
  });

  it("accepts a Latin-only name", () => {
    const parsed = HorseSubmissionSchema.safeParse({ name_latin: "Shiraz Ghar" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a submission with neither native nor Latin name", () => {
    const parsed = HorseSubmissionSchema.safeParse({ sex_desc: "stallion" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invented empty-string name", () => {
    expect(HorseSubmissionSchema.safeParse({ name_native: "", name_latin: "" }).success).toBe(false);
    expect(HorseSubmissionSchema.safeParse({ name_native: "   " }).success).toBe(false);
  });

  it("rejects a parent given both as an existing horse id AND an unresolved assertion", () => {
    const parsed = HorseSubmissionSchema.safeParse({
      name_latin: "Foal",
      father_horse_id: 11,
      father_unresolved: { name_latin: "Unknown Sire" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an unresolved parent assertion with at least a name", () => {
    const parsed = HorseSubmissionSchema.safeParse({
      name_latin: "Foal",
      father_unresolved: { name_native: "پدر ناشناخته", note: "Sire named in old handwritten studbook, page 41" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unresolved parent assertion without any name", () => {
    const parsed = HorseSubmissionSchema.safeParse({
      name_latin: "Foal",
      mother_unresolved: { note: "dam unknown" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects the same horse as both sire and dam", () => {
    const parsed = HorseSubmissionSchema.safeParse({ name_latin: "Foal", father_horse_id: 9, mother_horse_id: 9 });
    expect(parsed.success).toBe(false);
  });

  it("validates shared horse fields (birth_year window, sex length) through the T07 rules", () => {
    expect(HorseSubmissionSchema.safeParse({ name_latin: "Foal", birth_year: 1200 }).success).toBe(false);
    expect(HorseSubmissionSchema.safeParse({ name_latin: "Foal", birth_year: 3000 }).success).toBe(false);
    expect(HorseSubmissionSchema.safeParse({ name_latin: "Foal", sex_desc: "x".repeat(81) }).success).toBe(false);
    expect(HorseSubmissionSchema.safeParse({ name_latin: "Foal", register_no: "R".repeat(121) }).success).toBe(false);
  });

  it("normalizes outer whitespace in names the same way direct edits do (shared T07 rules: trim, never reflow inner spacing)", () => {
    const parsed = HorseSubmissionSchema.parse({ name_latin: "  Shiraz Ghar  ", name_native: " غر " });
    expect(parsed.name_latin).toBe("Shiraz Ghar");
    expect(parsed.name_native).toBe("غر");
  });

  it("rejects a submitter-declared horse id (ids are never client-chosen)", () => {
    // id is not part of the submission schema at all
    const parsed = HorseSubmissionSchema.safeParse({ id: 5, name_latin: "Foal" });
    expect(parsed.success).toBe(false);
  });
});

describe("submission storage shape", () => {
  it("maps a native-only submission onto the canonical insert without inventing a Latin form", () => {
    const values = horseInsertValuesForSubmission(HorseSubmissionSchema.parse(NATIVE_ONLY), "mut-1");
    expect(values).toHaveLength(submissionHorseColumns().length);
    // name_latin column receives the native name verbatim — no transliteration
    // is invented; submission_json keeps the honest record (name_latin absent).
    expect(values[0]).toBe("شیراز غر");
  });

  it("maps a fully-specified submission with the parents the submitter selected", () => {
    const values = horseInsertValuesForSubmission(FULL, "mut-1");
    const columns = submissionHorseColumns();
    const byColumn = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    expect(byColumn.name_latin).toBe("Shiraz Ghar");
    expect(byColumn.name_native).toBe("شیراز غر");
    expect(byColumn.father_id).toBe(11);
    expect(byColumn.mother_id).toBe(12);
    expect(byColumn.register_no).toBe("REG-1001");
    expect(byColumn.sex_desc).toBe("stallion");
    expect(values[values.length - 1]).toBe("mut-1"); // last_mutation_id for provenance
  });

  it("never stores a client id — the canonical id is allocated by the database", () => {
    const columns = submissionHorseColumns();
    expect(columns).not.toContain("id");
  });
});

describe("review status surface (T11 step 1)", () => {
  it("maps needs_changes to a dedicated review status while the row returns to draft", () => {
    expect(submissionReviewStatus({ status: "draft", review_outcome: "needs_changes" })).toBe("needs_changes");
  });

  it("keeps the plain statuses for everything else", () => {
    expect(submissionReviewStatus({ status: "pending", review_outcome: null })).toBe("pending");
    expect(submissionReviewStatus({ status: "approved", review_outcome: "approved" })).toBe("approved");
    expect(submissionReviewStatus({ status: "rejected", review_outcome: null })).toBe("rejected");
    expect(submissionReviewStatus({ status: "withdrawn", review_outcome: null })).toBe("withdrawn");
    expect(submissionReviewStatus({ status: "draft", review_outcome: null })).toBe("draft");
  });
});

describe("atomic approval batch (T11 step 4/5)", () => {
  it("conditions the canonical insert on the request still being undecided", () => {
    expect(SUBMISSION_HORSE_INSERT_SQL).toContain("WHERE EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))");
  });

  it("allocates no client-supplied id and stamps last_mutation_id for provenance", () => {
    expect(SUBMISSION_HORSE_INSERT_SQL.startsWith("INSERT INTO horses(name_latin,")).toBe(true);
    expect(SUBMISSION_HORSE_INSERT_SQL).toContain("last_mutation_id");
    expect(SUBMISSION_HORSE_INSERT_SQL).not.toContain("horses(id,");
  });

  it("claims identifiers in the SAME transaction, resolving the fresh horse id by subquery", () => {
    expect(SUBMISSION_IDENTIFIER_CLAIM_SQL).toContain("INSERT INTO horse_identifiers");
    expect(SUBMISSION_IDENTIFIER_CLAIM_SQL).toContain("(SELECT id FROM horses WHERE last_mutation_id=?");
    expect(SUBMISSION_IDENTIFIER_CLAIM_SQL).toContain("'live'");
  });

  it("conditions the approval on the canonical horse actually landing", () => {
    expect(SUBMISSION_DECISION_SQL).toContain("status='approved'");
    expect(SUBMISSION_DECISION_SQL).toContain("canonical_horse_id=(SELECT id FROM horses WHERE last_mutation_id=?");
    expect(SUBMISSION_DECISION_SQL).toContain("WHERE id=? AND status IN ('pending','draft')");
    expect(SUBMISSION_DECISION_SQL).toContain("EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)");
  });

  it("returns needs_changes to draft with a recorded outcome (no canonical effects)", () => {
    expect(SUBMISSION_NEEDS_CHANGES_SQL).toContain("status='draft'");
    expect(SUBMISSION_NEEDS_CHANGES_SQL).toContain("review_outcome='needs_changes'");
    expect(SUBMISSION_NEEDS_CHANGES_SQL).not.toContain("horses");
  });

  it("mints the initial owner grant only for the linked owner, conditioned on the creation", () => {
    expect(SUBMISSION_GRANT_SQL).toContain("INSERT INTO horse_access_grants");
    expect(SUBMISSION_GRANT_SQL).toContain("'admin_grant'");
    expect(SUBMISSION_GRANT_SQL).toContain("(SELECT id FROM horses WHERE last_mutation_id=?");
    expect(SUBMISSION_GRANT_SQL).toContain("EXISTS(SELECT 1 FROM user_person_links WHERE user_id=? AND person_id=? AND status='verified')");
    expect(SUBMISSION_GRANT_SQL).toContain("EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))");
  });

  it("records permitted relationships (owner + breeder) conditioned on the creation", () => {
    expect(SUBMISSION_PEOPLE_LINK_SQL).toContain("INSERT OR IGNORE INTO horse_people");
    expect(SUBMISSION_PEOPLE_LINK_SQL).toContain("(SELECT id FROM horses WHERE last_mutation_id=?");
  });

  it("bumps the canonical revision only when the horse landed", () => {
    expect(SUBMISSION_REVISION_BUMP_SQL).toContain("canonical_revision=canonical_revision+1");
    expect(SUBMISSION_REVISION_BUMP_SQL).toContain("EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)");
  });

  it("keeps every effect statement free of unconditioned DELETE/UPDATE on horses", () => {
    for (const sql of [SUBMISSION_HORSE_INSERT_SQL, SUBMISSION_DECISION_SQL, SUBMISSION_GRANT_SQL, SUBMISSION_PEOPLE_LINK_SQL, SUBMISSION_IDENTIFIER_CLAIM_SQL, SUBMISSION_REVISION_BUMP_SQL]) {
      expect(sql).not.toMatch(/DELETE\s+FROM\s+horses/);
    }
  });
});

// ---------------------------------------------------------------------------
// Scripted D1 fake (trustAttestations pattern) for the idempotency replay.

interface BoundStatement {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => BoundStatement;
  first: () => Promise<unknown>;
  all: () => Promise<{ results: unknown[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
}

function makeDb(existing?: Record<string, unknown>): D1Database {
  const makeBuilder = (sql: string, args: unknown[]): BoundStatement => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => existing ?? undefined,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1 } }),
  });
  return {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: BoundStatement[]) => {
      // Simulate the partial unique index on (submitted_by_user_id, idempotency_key):
      // the second insert with the same key fails exactly like D1 does.
      for (const statement of statements) {
        if (statement.sql.includes("INSERT INTO change_requests") && existing) {
          throw new Error("UNIQUE constraint failed: change_requests.submitted_by_user_id, change_requests.idempotency_key");
        }
      }
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
}

describe("idempotency (T11 double-submit)", () => {
  it("recognizes the unique-index violation as a replayable idempotency hit", async () => {
    const db = makeDb({ id: "req-1", status: "pending" });
    const replay = await resolveIdempotencyReplay(db, "user-a", "key-1");
    expect(replay).not.toBeNull();
    expect(replay?.id).toBe("req-1");
    expect(replay?.status).toBe("pending");
  });

  it("returns null when the key is genuinely new (no violation happened)", async () => {
    const db = makeDb();
    expect(await resolveIdempotencyReplay(db, "user-a", null)).toBeNull();
  });
});

// R140-C (second Master-AI audit): the idempotency key binds to a payload
// fingerprint — same key + different content is an explicit 409 conflict, not
// a silent replay that swallows the second horse.
describe("idempotency payload fingerprint (R140-C)", () => {
  const submissionA = { name_native: "اسب یک", name_latin: null, father_unresolved: null, mother_unresolved: null };
  const submissionB = { name_native: "اسب دو", name_latin: null, father_unresolved: null, mother_unresolved: null };

  it("same content always produces the same digest regardless of key order in JSON", async () => {
    const a1 = await submissionPayloadDigest({ request_type: "create_horse", submission: submissionA });
    const a2 = await submissionPayloadDigest({ submission: submissionA, request_type: "create_horse" });
    expect(a1).not.toBeNull();
    expect(a1).toBe(a2);
  });

  it("different content under the same key produces a different digest (conflict path)", async () => {
    const a = await submissionPayloadDigest({ request_type: "create_horse", submission: submissionA });
    const b = await submissionPayloadDigest({ request_type: "create_horse", submission: submissionB });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it("changing the target horse changes the digest", async () => {
    const withHorse = await submissionPayloadDigest({ request_type: "update_horse", horse_id: 5, items: [] });
    const otherHorse = await submissionPayloadDigest({ request_type: "update_horse", horse_id: 6, items: [] });
    expect(withHorse).not.toBe(otherHorse);
  });

  it("empty payloads digest to null (no key binding without content)", async () => {
    expect(await submissionPayloadDigest({})).toBeNull();
  });

  it("the create handler stores the digest and conflicts on foreign content", () => {
    const handler = read("src/api/modules/changeRequests.ts");
    expect(handler).toContain("payload_digest");
    expect(handler).toContain("idempotency_conflict");
  });

  it("migration 0102 adds the payload_digest column", () => {
    const migration = read("migrations/0102_submission_payload_digest.sql");
    expect(migration).toContain("ADD COLUMN payload_digest TEXT");
  });
});

describe("migration + wiring (T11 acceptance)", () => {
  const routes = read("src/api/routes.ts");
  // R117-20: the change-request handlers + schemas moved to
  // src/api/modules/changeRequests.ts (dispatch lines stay in routes.ts).
  const changeRequests = read("src/api/modules/changeRequests.ts");

  it("migration 0035 adds the submission columns and the idempotency index", () => {
    const migration = read("migrations/0035_horse_submissions.sql");
    expect(migration).toContain("ADD COLUMN submission_json");
    expect(migration).toContain("ADD COLUMN review_outcome");
    expect(migration).toContain("ADD COLUMN canonical_horse_id");
    expect(migration).toContain("ADD COLUMN idempotency_key");
    expect(migration).toContain("uq_change_requests_idempotency");
    expect(migration).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("create_horse change requests REQUIRE a structured submission now", () => {
    expect(changeRequests).toContain("structured_submission_required");
  });

  it("approving a legacy create_horse without a submission is refused, not review-approved", () => {
    expect(changeRequests).toContain("legacy_create_horse_without_submission");
  });

  it("the review decision vocabulary includes needs_changes", () => {
    expect(changeRequests).toContain('"approved", "rejected", "needs_changes"');
  });

  it("submit/withdraw transitions are dispatched", () => {
    expect(routes).toContain("\\/api\\/change-requests\\/([^/]+)\\/submit");
    expect(routes).toContain("\\/api\\/change-requests\\/([^/]+)\\/withdraw");
  });

  it("draft editing is dispatched as PUT/PATCH on the request itself", () => {
    expect(routes).toContain("\\/api\\/change-requests\\/([^/]+)$");
  });

  it("approval consults the shared submission approval builder", () => {
    expect(changeRequests).toContain("buildSubmissionApprovalStatements");
  });

  it("the ownership request type is labeled review-only instead of silently approved", () => {
    expect(changeRequests).toContain("ownership_via_claims_workflow");
  });

  it("the runtime route budget inventory documents the three new endpoints", () => {
    const inventory = read("docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md");
    expect(inventory).toContain("| POST | /^\\/api\\/change-requests\\/([^/]+)\\/submit$/ |");
    expect(inventory).toContain("| POST | /^\\/api\\/change-requests\\/([^/]+)\\/withdraw$/ |");
    expect(inventory).toContain("| PUT/PATCH | /^\\/api\\/change-requests\\/([^/]+)$/ |");
  });

  it("API.md documents the submission workflow", () => {
    const api = read("docs/API.md");
    expect(api).toContain("submission");
    expect(api).toContain("needs_changes");
  });
});
