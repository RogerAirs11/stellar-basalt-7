import { describe, expect, it } from "vitest";
import {
  activeGrantActions,
  authorizeHorseAction,
  CLAIM_GRANT_SQL,
  grantActions,
  grantValidity,
  HORSE_GRANT_ACTIONS,
  horseActionsForViewer,
  isEditorialRole,
  parseGrantActions,
  RELATIONSHIP_ACTION_SETS,
  revokeHorseGrant,
  revokeOrganizationMembership,
  slugifyOrganization,
  type GrantRow,
} from "../../src/access/horseAccess";
import { HttpError } from "../../src/api/http";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Master-Ai plan T10: horse-scoped grants. These fixtures pin the IDOR
 * boundary (Owner A cannot act on Horse B), the separation of legal ownership
 * from permission to manage, mandate-shaped action sets, validity windows,
 * immediate revocation, and the claim-approval -> grant mapping.
 */

const NOW = new Date("2026-10-03T12:00:00.000Z");

function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "g1",
    horse_id: 7,
    grantee_user_id: "user-a",
    grantee_organization_id: null,
    relationship: "owner",
    actions: RELATIONSHIP_ACTION_SETS.owner.join(","),
    basis: "claim_approval",
    basis_ref: "claim-1",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("grant vocabulary (T10)", () => {
  it("defines exactly the four grant actions, each distinct", () => {
    expect(HORSE_GRANT_ACTIONS).toEqual(["manage_profile", "upload_media", "create_listing", "manage_inquiries"]);
  });

  it("gives each relationship a mandate-shaped action set", () => {
    expect(RELATIONSHIP_ACTION_SETS.owner).toEqual(["manage_profile", "upload_media", "create_listing", "manage_inquiries"]);
    expect(RELATIONSHIP_ACTION_SETS.breeder).toEqual(["manage_profile", "upload_media"]);
    expect(RELATIONSHIP_ACTION_SETS.manager).toEqual(["manage_profile", "upload_media", "manage_inquiries"]);
    // A seller mandate can sell and answer inquiries but never edit the profile.
    expect(RELATIONSHIP_ACTION_SETS.seller).toEqual(["create_listing", "manage_inquiries"]);
    expect(RELATIONSHIP_ACTION_SETS.seller).not.toContain("manage_profile");
  });

  it("treats only editorial roles as staff", () => {
    expect(isEditorialRole("editor")).toBe(true);
    expect(isEditorialRole("admin")).toBe(true);
    expect(isEditorialRole("super_admin")).toBe(true);
    // The account role 'owner' is NOT a global edit permission (T10 doctrine).
    expect(isEditorialRole("owner")).toBe(false);
    expect(isEditorialRole("user")).toBe(false);
  });
});

describe("grant validity windows (T10)", () => {
  it("classifies active, revoked, expired and not-yet-valid grants", () => {
    expect(grantValidity(grant(), NOW)).toBe("active");
    expect(grantValidity(grant({ revoked_at: "2026-06-01T00:00:00.000Z" }), NOW)).toBe("revoked");
    expect(grantValidity(grant({ valid_until: "2026-09-01T00:00:00.000Z" }), NOW)).toBe("expired");
    expect(grantValidity(grant({ valid_from: "2026-11-01T00:00:00.000Z" }), NOW)).toBe("not_yet_valid");
  });

  it("revocation wins over every other state", () => {
    expect(grantValidity(grant({ revoked_at: "2026-06-01T00:00:00.000Z", valid_until: "2027-01-01T00:00:00.000Z" }), NOW)).toBe("revoked");
  });

  it("parses stored action lists defensively: dedupe, trim, vocabulary-filter", () => {
    expect(parseGrantActions("manage_profile, upload_media,,manage_profile")).toEqual(["manage_profile", "upload_media"]);
    expect(parseGrantActions("manage_profile,delete_database")).toEqual(["manage_profile"]);
    expect(parseGrantActions(null)).toEqual([]);
  });

  it("storage can only NARROW a relationship's action set, never widen it", () => {
    // A 'seller' row that claims manage_profile in storage still cannot manage.
    expect(grantActions(grant({ relationship: "seller", actions: "manage_profile,create_listing" }))).toEqual(["create_listing"]);
    expect(grantActions(grant({ relationship: "manager", actions: "create_listing,manage_inquiries" }))).toEqual(["manage_inquiries"]);
  });

  it("merges actions only from ACTIVE grants", () => {
    const merged = activeGrantActions(
      [
        grant({ relationship: "seller", grantee_user_id: "user-a" }),
        grant({ id: "g2", relationship: "breeder", grantee_user_id: "user-a" }),
        grant({ id: "g3", relationship: "owner", revoked_at: "2026-06-01T00:00:00.000Z" }),
        grant({ id: "g4", relationship: "owner", valid_until: "2026-09-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    // seller contributes create_listing + manage_inquiries, breeder adds
    // manage_profile + upload_media; the revoked and expired owner grants add nothing.
    expect(merged).toEqual(["create_listing", "manage_inquiries", "manage_profile", "upload_media"]);
  });
});

// ---------------------------------------------------------------------------
// Scripted D1 fake (trustAttestations pattern) for the viewer/authorization paths.

interface BoundStatement {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => BoundStatement;
  first: () => Promise<unknown>;
  all: () => Promise<{ results: unknown[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
}

interface Script {
  grants?: GrantRow[] | null;
  runResults?: Array<{ meta: { changes: number } }>;
}

function makeDb(script: Script): D1Database {
  const runResults = script.runResults ?? [];
  let runIndex = 0;
  const selectAll = (sql: string): unknown[] => {
    if (sql.includes("FROM horse_access_grants")) return script.grants === undefined ? [grant()] : script.grants ?? [];
    return [];
  };
  const makeBuilder = (sql: string, args: unknown[]): BoundStatement => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => undefined,
    all: async () => ({ results: selectAll(sql) }),
    run: async () => {
      const result = runResults[runIndex] ?? { meta: { changes: 1 } };
      runIndex += 1;
      return result;
    },
  });
  const written: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: BoundStatement[]) => {
      for (const statement of statements) written.push({ sql: statement.sql, args: statement.args });
      return statements.map((statement, index) => ({ meta: { changes: runResults[index]?.meta.changes ?? 1 } }));
    },
    __written: written,
  } as unknown as D1Database & { __written: typeof written };
  return db;
}

describe("horseActionsForViewer (T10 backend-computed actions)", () => {
  it("staff see staff actions without any grant", async () => {
    const snapshot = await horseActionsForViewer(makeDb({ grants: null }), { userId: "staff-1", role: "admin" }, 7, NOW);
    expect(snapshot.is_staff).toBe(true);
    expect(snapshot.actions).toEqual([...HORSE_GRANT_ACTIONS]);
  });

  it("a granted owner sees exactly the owner mandate on that horse", async () => {
    const snapshot = await horseActionsForViewer(makeDb({}), { userId: "user-a", role: "user" }, 7, NOW);
    expect(snapshot.is_staff).toBe(false);
    expect(snapshot.relationships).toEqual(["owner"]);
    expect(snapshot.actions).toEqual(["create_listing", "manage_inquiries", "manage_profile", "upload_media"]);
  });

  it("an unrelated viewer sees nothing (the IDOR boundary)", async () => {
    // Grant belongs to user-a; user-b asks about the same horse.
    const snapshot = await horseActionsForViewer(makeDb({ grants: [grant({ grantee_user_id: "user-a" })] }), { userId: "user-b", role: "user" }, 7, NOW);
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.relationships).toEqual([]);
    expect(snapshot.grants).toEqual([]);
  });

  it("co-ownership: each grantee only sees their own grant", async () => {
    const grants = [grant({ id: "g-a", grantee_user_id: "user-a" }), grant({ id: "g-b", grantee_user_id: "user-b", relationship: "manager", actions: RELATIONSHIP_ACTION_SETS.manager.join(",") })];
    const forA = await horseActionsForViewer(makeDb({ grants }), { userId: "user-a", role: "user" }, 7, NOW);
    const forB = await horseActionsForViewer(makeDb({ grants }), { userId: "user-b", role: "user" }, 7, NOW);
    expect(forA.relationships).toEqual(["owner"]);
    expect(forB.relationships).toEqual(["manager"]);
    expect(forB.actions).not.toContain("create_listing");
  });

  it("grants for a different horse never apply (per-horse scoping)", async () => {
    const snapshot = await horseActionsForViewer(makeDb({ grants: [grant({ horse_id: 99, grantee_user_id: "user-a" })] }), { userId: "user-a", role: "user" }, 7, NOW);
    expect(snapshot.actions).toEqual([]);
  });
});

describe("authorizeHorseAction (T10 route guard core)", () => {
  it("editorial staff pass via the editorial path", async () => {
    const decision = await authorizeHorseAction(makeDb({ grants: null }), { userId: "editor-1", role: "editor" }, 7, "upload_media", NOW);
    expect(decision).toMatchObject({ ok: true, via: "editorial" });
  });

  it("a granted owner passes via the grant path on the granted horse only", async () => {
    const db = makeDb({ grants: [grant({ horse_id: 7, grantee_user_id: "user-a" })] });
    const onGrantedHorse = await authorizeHorseAction(db, { userId: "user-a", role: "user" }, 7, "upload_media", NOW);
    expect(onGrantedHorse).toMatchObject({ ok: true, via: "grant" });
  });

  it("Owner A acting on Horse B is refused — the F05/T10 IDOR fix", async () => {
    const db = makeDb({ grants: [grant({ horse_id: 7, grantee_user_id: "user-a" })] });
    const decision = await authorizeHorseAction(db, { userId: "user-a", role: "user" }, 8, "upload_media", NOW);
    expect(decision).toEqual({ ok: false, reason: "horse_access_required" });
  });

  it("a delegated seller can list but cannot manage the profile", async () => {
    const db = makeDb({ grants: [grant({ relationship: "seller", actions: RELATIONSHIP_ACTION_SETS.seller.join(","), grantee_user_id: "user-c" })] });
    expect(await authorizeHorseAction(db, { userId: "user-c", role: "user" }, 7, "create_listing", NOW)).toMatchObject({ ok: true, via: "grant" });
    expect(await authorizeHorseAction(db, { userId: "user-c", role: "user" }, 7, "manage_profile", NOW)).toEqual({ ok: false, reason: "horse_access_required" });
  });

  it("an expired or revoked grant stops access immediately", async () => {
    const expired = makeDb({ grants: [grant({ valid_until: "2026-09-01T00:00:00.000Z" })] });
    expect(await authorizeHorseAction(expired, { userId: "user-a", role: "user" }, 7, "upload_media", NOW)).toEqual({ ok: false, reason: "horse_access_required" });
    const revoked = makeDb({ grants: [grant({ revoked_at: "2026-06-01T00:00:00.000Z" })] });
    expect(await authorizeHorseAction(revoked, { userId: "user-a", role: "user" }, 7, "upload_media", NOW)).toEqual({ ok: false, reason: "horse_access_required" });
  });

  it("requires authentication before anything else", async () => {
    const decision = await authorizeHorseAction(makeDb({}), { userId: "", role: "user" }, 7, "upload_media", NOW);
    expect(decision).toEqual({ ok: false, reason: "authentication_required" });
  });
});

describe("claim approval maps to an explicit grant (T10 step 2)", () => {
  it("the conditioned INSERT ships the full owner mandate with claim provenance", () => {
    expect(CLAIM_GRANT_SQL).toContain("INSERT INTO horse_access_grants");
    expect(CLAIM_GRANT_SQL).toContain("WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=? AND status='approved' AND reviewed_by_user_id=?)");
    expect(CLAIM_GRANT_SQL).toContain("'claim_approval'");
    expect(CLAIM_GRANT_SQL).toContain("'owner'");
    expect(CLAIM_GRANT_SQL).toContain("manage_profile,upload_media,create_listing,manage_inquiries");
  });
});

describe("revocation services (T10 step 4)", () => {
  it("revokeHorseGrant writes the CAS update plus an audit row in one batch", async () => {
    const db = makeDb({ runResults: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }] });
    const result = await revokeHorseGrant(db, { grantId: "g1", byUserId: "admin-1", reason: "owner requested transfer" });
    expect(result).toEqual({ id: "g1", revoked: true });
    const written = (db as unknown as { __written: Array<{ sql: string; args: unknown[] }> }).__written;
    expect(written[0].sql).toContain("UPDATE horse_access_grants");
    expect(written[0].sql).toContain("WHERE id=? AND revoked_at IS NULL");
    expect(written[0].sql).toContain("last_operation_id=?");
    expect(written[1].sql).toContain("INSERT INTO audit_events");
    expect(written[1].args).toContain("grant.revoke");
  });

  it("P02: the audit INSERT is conditional on THIS operation's marker — a no-op revoke can never mint an audit row", async () => {
    const db = makeDb({ runResults: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }] });
    await revokeHorseGrant(db, { grantId: "g1", byUserId: "admin-1", reason: "owner requested transfer" });
    const written = (db as unknown as { __written: Array<{ sql: string; args: unknown[] }> }).__written;
    expect(written[1].sql).toContain("SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP");
    expect(written[1].sql).toContain("WHERE g.id=? AND g.last_operation_id=? AND g.revoked_at IS NOT NULL");
    // The marker used by the UPDATE bind and the audit gate must be the SAME id.
    const updateMarker = written[0].args[2] as string;
    const auditGateMarker = written[1].args[written[1].args.length - 1] as string;
    expect(updateMarker).toEqual(auditGateMarker);
    // The audit payload records prior/new state and the operation id (P02).
    const payload = JSON.parse(String(written[1].args[4])) as Record<string, unknown>;
    expect(payload).toMatchObject({ grant_id: "g1", prior_state: "active", new_state: "revoked", operation_id: updateMarker });
  });

  it("double revoke is a clean 409 grant_not_active", async () => {
    const db = makeDb({ runResults: [{ meta: { changes: 0 } }, { meta: { changes: 1 } }] });
    await expect(revokeHorseGrant(db, { grantId: "g1", byUserId: "admin-1", reason: "already revoked" })).rejects.toMatchObject({ status: 409, code: "grant_not_active" });
  });

  it("a reason is mandatory (audit discipline)", async () => {
    await expect(revokeHorseGrant(makeDb({}), { grantId: "g1", byUserId: "admin-1", reason: "x" })).rejects.toBeInstanceOf(HttpError);
    await expect(revokeOrganizationMembership(makeDb({}), { membershipId: 3, byUserId: "admin-1", reason: "  " })).rejects.toMatchObject({ status: 422 });
  });

  it("revoking an organization membership flips status and revocation fields together", async () => {
    const db = makeDb({ runResults: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }] });
    const result = await revokeOrganizationMembership(db, { membershipId: 3, byUserId: "admin-1", reason: "left the stable" });
    expect(result).toEqual({ id: 3, revoked: true });
    const written = (db as unknown as { __written: Array<{ sql: string; args: unknown[] }> }).__written;
    const sql = written[0].sql;
    expect(sql).toContain("SET status='revoked', revoked_at=CURRENT_TIMESTAMP");
    expect(sql).toContain("WHERE id=? AND status='active'");
    expect(sql).toContain("last_operation_id=?");
    // P02: membership audit is marker-conditioned exactly like grant revoke.
    expect(written[1].sql).toContain("WHERE m.id=? AND m.last_operation_id=? AND m.status='revoked'");
    const updateMarker = written[0].args[2] as string;
    const auditGateMarker = written[1].args[written[1].args.length - 1] as string;
    expect(updateMarker).toEqual(auditGateMarker);
  });
});

describe("organization slugs (T10 minimal organization service)", () => {
  it("slugifies names, keeps Persian letters, rejects degenerate names", () => {
    expect(slugifyOrganization("Kooh-e Sabz Stables")).toBe("kooh-e-sabz-stables");
    expect(slugifyOrganization("اصطبل کوه سبز")).toBe("اصطبل-کوه-سبز");
    expect(() => slugifyOrganization("!!!---")).toThrow(HttpError);
    expect(() => slugifyOrganization("a")).toThrow(HttpError);
  });
});

// ---------------------------------------------------------------------------
// Source-anchored wiring checks: the write endpoints must actually route
// through the horse-scoped guard (regression protection against reverting to
// the old role-only `horse.edit` gate, which locked owners out entirely and
// would today silently re-open the IDOR door in the other direction).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");

describe("route wiring (T10 acceptance: every horse write endpoint is grant-scoped)", () => {
  const media = read("src/api/modules/media.ts");
  const marketplace = read("src/api/modules/marketplace.ts");
  const routes = read("src/api/routes.ts");

  it("media upload retains the horse grant and limits professional authority to private veterinary documents", () => {
    expect(media).toContain('await authorizeHorseAction(env.DB, { userId: auth.user.id, role: auth.user.role }, horseId, "upload_media", new Date())');
    expect(media).toContain('if (!ordinaryUpload.ok && !professionalUpload) throw new HttpError(403, "media_upload_permission_required"');
    expect(media).toContain('if (!ordinaryUpload.ok && (d.media_type !== "document" || d.role !== "veterinary"))');
    expect(media).toContain('professionalActionPredicate({ viewerUserId: auth.user.id, horseId, permission: "sample_submit" })');
    expect(media).toContain('professionalActionPredicate({ viewerUserId: auth.user.id, horseId, permission: "clinical_write" })');
    expect(media).toContain('d.media_type === "document" && d.role === "veterinary"');
    expect(media).toContain('actor.role IN (\'editor\',\'admin\',\'super_admin\') OR ${editorialGrant.sql}${professionalGuard}');
    // Actual denial, scoped upload, revocation and private-byte receipts are
    // exercised by backend-hardening.test.ts against migrated transactions.
    expect(media).not.toContain('requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit")\n  requireCsrf(request, auth);\n  const parsed = MediaUploadSchema');
  });

  it("listing creation authorizes via requireHorseAction(create_listing)", () => {
    expect(marketplace).toContain('await requireHorseAction(env.DB, auth, d.horse_id, "create_listing")');
  });

  it("claim approval mints the grant in the same reviewed batch", () => {
    // R117-20: the claims handlers moved to src/api/modules/claims.ts.
    const claims = read("src/api/modules/claims.ts");
    expect(claims).toContain("claimApprovalGrantStatement(env.DB, {");
    expect(claims).toContain("...(mintGrant ? [mintGrant] : []),");
  });

  it("change requests accept the grant path for non-owner accounts", () => {
    // R117-20: the change-request handlers moved to src/api/modules/changeRequests.ts.
    const changeRequests = read("src/api/modules/changeRequests.ts");
    expect(changeRequests).toContain('await requireHorseAction(env.DB, auth, payload.horse_id, "manage_profile")');
  });

  it("the per-horse actions endpoint is dispatched and inventory-documented", () => {
    expect(routes).toContain('horseModuleMatch[2] === "actions"');
    const inventory = read("docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md");
    expect(inventory).toContain("certificate\\.svg\\|certificate\\|actions\\|racing)");
    expect(inventory).toContain("| GET | /api/grants/mine |");
  });

  it("migration 0034 defines the four representation structures", () => {
    const migration = read("migrations/0034_representation_grants.sql");
    for (const table of ["user_person_links", "organizations", "organization_memberships", "horse_access_grants"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
