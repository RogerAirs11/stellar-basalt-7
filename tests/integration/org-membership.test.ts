import { describe, expect, it } from "vitest";
import { myEntitlements, createOrder } from "../../src/api/modules/billing";
import { myWorkspaces, createWorkspace, workspaceDashboard, addWorkspaceHorse } from "../../src/api/modules/workspaces";
import { currentMembership, myOrganizationContexts, capabilitiesForRole, CURRENT_MEMBERSHIP_PREDICATE } from "../../src/organizations/membershipPolicy";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder as createPaidOrder, reserveAttempt, verifyOrder, countRows,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N07 evidence: organization membership and account discovery unified
 * through ONE policy (src/organizations/membershipPolicy.ts) on a real
 * database with every migration applied.
 *
 * Acceptance pinned:
 *  - an ex-member loses private views and mutations while the organization
 *    retains its paid service;
 *  - a FUTURE membership grants nothing early;
 *  - an ordinary member (no documented private mandate) is denied private
 *    workspace management and org-payer orders;
 *  - the original payer keeps PERSONAL payment evidence (their own orders)
 *    but not org workspaces they hold no current membership for;
 *  - discovery surfaces explicit holder types/ids + capability flags, never
 *    buyer-as-owner labels.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function seedOrg(db: D1Database, slug: string, status = "active"): Promise<number> {
  const result = await db.prepare("INSERT INTO organizations(slug,name_native,name_latin,kind,status) VALUES(?,?,?,?,?)")
    .bind(slug, `مزرعه ${slug}`, `Farm ${slug}`, "stable", status).run();
  return Number(result.meta.last_row_id ?? 0);
}

type MembershipSeed = {
  orgId: number; userId: string; role?: "owner" | "manager" | "member";
  status?: string; validFrom?: string; validUntil?: string | null; revokedAt?: string | null;
};

async function seedMembership(db: D1Database, seed: MembershipSeed): Promise<void> {
  await db.prepare(`
    INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from,valid_until,revoked_at)
    VALUES(?,?,?,?,?,?,?)
  `).bind(seed.orgId, seed.userId, seed.role ?? "member", seed.status ?? "active",
    seed.validFrom ?? "2020-01-01 00:00:00", seed.validUntil ?? null, seed.revokedAt ?? null).run();
}

/** A paid farm-workspace entitlement held by the ORGANIZATION. */
async function grantOrgEntitlement(db: D1Database, orgId: number, buyerUserId: string): Promise<void> {
  await seedBillingPrices(db);
  const order = await createPaidOrder(db, {
    buyer: buyerUserId,
    key: `org-order-${orgId}-${buyerUserId}`,
    organizationId: orgId,
    lines: [{ sku: "farm_workspace_monthly", price_id: 1, version: 1, title_en: "Farm", title_fa: "Farm", unit_minor: 19_000_000, quantity: 1, line_total_minor: 19_000_000, period_days: 30 }],
  });
  const { attemptId } = await reserveAttempt(db, order!.id, buyerUserId);
  await verifyOrder(db, order!, attemptId!);
}

describe("R95-N07 membership policy predicates", () => {
  it("capability mapping: owner/manager manage billing+workspaces; an ordinary member does not", () => {
    expect(capabilitiesForRole("owner")).toContain("workspace_manager");
    expect(capabilitiesForRole("manager")).toContain("billing_manager");
    expect(capabilitiesForRole("member")).toEqual(["ordinary_staff"]);
  });

  it("the predicate is ONE shared fragment (no drift between read and write paths)", () => {
    expect(CURRENT_MEMBERSHIP_PREDICATE).toContain("m.status='active'");
    expect(CURRENT_MEMBERSHIP_PREDICATE).toContain("m.revoked_at IS NULL");
    expect(CURRENT_MEMBERSHIP_PREDICATE).toContain("o.status='active'");
    expect(CURRENT_MEMBERSHIP_PREDICATE).toContain("datetime(m.valid_from)<=datetime('now')");
    expect(CURRENT_MEMBERSHIP_PREDICATE).toContain("datetime(m.valid_until)>datetime('now')");
  });

  it("self/current vs past vs future vs revoked vs suspended-org on the real schema", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "manager-1", "user");
    await seedUser(db, "member-1", "user");
    const orgA = await seedOrg(db, "org-a");
    const orgB = await seedOrg(db, "org-b");
    const orgSuspended = await seedOrg(db, "org-s", "suspended");

    await seedMembership(db, { orgId: orgA, userId: "manager-1", role: "manager" });
    await seedMembership(db, { orgId: orgA, userId: "member-1", role: "member" });
    await seedMembership(db, { orgId: orgB, userId: "member-1", role: "manager", validUntil: "2020-01-02 00:00:00" }); // past
    await seedMembership(db, { orgId: orgSuspended, userId: "member-1", role: "manager" }); // org suspended
    await seedUser(db, "future-1", "user");
    await seedMembership(db, { orgId: orgA, userId: "future-1", role: "manager", validFrom: "2030-01-01 00:00:00" }); // future
    await seedUser(db, "revoked-1", "user");
    await seedMembership(db, { orgId: orgA, userId: "revoked-1", role: "manager", revokedAt: "2024-01-01 00:00:00", status: "revoked" }); // revoked

    expect(await currentMembership(db, "manager-1", orgA)).not.toBeNull();
    expect((await currentMembership(db, "manager-1", orgA))!.capabilities).toContain("workspace_manager");
    expect(await currentMembership(db, "member-1", orgA)).not.toBeNull(); // ordinary member is CURRENT
    expect((await currentMembership(db, "member-1", orgA))!.capabilities).toEqual(["ordinary_staff"]);
    expect(await currentMembership(db, "member-1", orgB)).toBeNull(); // expired
    expect(await currentMembership(db, "member-1", orgSuspended)).toBeNull(); // org not active
    expect(await currentMembership(db, "future-1", orgA)).toBeNull(); // future grants nothing yet
    expect(await currentMembership(db, "revoked-1", orgA)).toBeNull(); // revoked grants nothing
    // Cross-org: manager-1 has no membership in orgB at all.
    expect(await currentMembership(db, "manager-1", orgB)).toBeNull();
    // Discovery lists exactly the current contexts.
    expect((await myOrganizationContexts(db, "member-1")).map((c) => c.organization_id)).toEqual([orgA]);
  });
});

describe("R95-N07 discovery + write-time enforcement", () => {
  it("myEntitlements: personal vs organization holders are explicit; ordinary staff see products, never money", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer-1", "user");
    await seedUser(db, "staff-1", "user");
    const org = await seedOrg(db, "org-e");
    await seedMembership(db, { orgId: org, userId: "buyer-1", role: "manager" });
    await seedMembership(db, { orgId: org, userId: "staff-1", role: "member" });
    await grantOrgEntitlement(db, org, "buyer-1"); // buyer paid; ORG holds the entitlement

    const buyerSession = await makeSession(db, "buyer-1");
    const staffSession = await makeSession(db, "staff-1");

    const buyerView = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session: buyerSession }), env(db));
    const buyerBody = await buyerView.json() as {
      entitlements: Array<{ holder_type: string; holder_id: string }>;
      organization_entitlements: Array<{ holder_type: string; sku: string; your_role: string; your_capabilities: string[] }>;
      organization_contexts: Array<{ organization_id: number }>;
    };
    // The org-payer purchase is NOT listed as a personal entitlement.
    expect(buyerBody.entitlements).toHaveLength(0);
    expect(buyerBody.organization_entitlements).toHaveLength(1);
    expect(buyerBody.organization_entitlements[0]?.holder_type).toBe("organization");
    expect(buyerBody.organization_entitlements[0]?.sku).toBe("farm_workspace_monthly");
    expect(buyerBody.organization_entitlements[0]?.your_role).toBe("manager");
    expect(buyerBody.organization_contexts).toHaveLength(1);

    // The ordinary staff member sees the org's active product (with role) —
    // and NO money fields exist in this projection.
    const staffView = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session: staffSession }), env(db));
    const staffBody = await staffView.json() as { entitlements: unknown[]; organization_entitlements: Array<{ sku: string; your_capabilities: string[]; total_minor?: number }> };
    expect(staffBody.entitlements).toHaveLength(0);
    expect(staffBody.organization_entitlements).toHaveLength(1);
    expect(staffBody.organization_entitlements[0]?.your_capabilities).toEqual(["ordinary_staff"]);
    expect(staffBody.organization_entitlements[0]?.total_minor).toBeUndefined();
  });

  it("myWorkspaces: org workspaces appear for current managers only — never for ordinary members", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "payer-1", "user");
    await seedUser(db, "staff-1", "user");
    const org = await seedOrg(db, "org-w");
    await seedMembership(db, { orgId: org, userId: "payer-1", role: "manager" });
    await seedMembership(db, { orgId: org, userId: "staff-1", role: "member" });

    const payerSession = await makeSession(db, "payer-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Org herd", organization_id: org }, { session: payerSession }), env(db));
    expect(created.status).toBe(201);
    const workspaceId = ((await created.json() as { workspace: { id: number } })).workspace.id;

    // The manager sees the org workspace under organization (with role).
    const managerView = await myWorkspaces(authedRequest("/api/workspaces", undefined, { method: "GET", session: payerSession }), env(db));
    const managerBody = await managerView.json() as { owned: unknown[]; organization: Array<{ id: number; your_role: string }> };
    expect(managerBody.owned).toHaveLength(1); // they created it (owned list)
    expect(managerBody.organization).toHaveLength(0); // owned by them, so not duplicated

    // The ordinary member does NOT see the private org workspace.
    const staffSession = await makeSession(db, "staff-1");
    const staffView = await myWorkspaces(authedRequest("/api/workspaces", undefined, { method: "GET", session: staffSession }), env(db));
    const staffBody = await staffView.json() as { owned: unknown[]; staff: unknown[]; organization: unknown[] };
    expect(staffBody.owned).toHaveLength(0);
    expect(staffBody.organization).toHaveLength(0);

    // Write-time enforcement: the ordinary member cannot manage horses there.
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: staffSession }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 }); // private workspace stays invisible
    // Even the dashboard view is denied (no assignment, no manager role).
    await expect(workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: staffSession }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
  });

  it("the ex-member (payer leaves): loses org discovery + mutations; the ORG keeps its paid service; personal payment evidence remains", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "payer-1", "user");
    const org = await seedOrg(db, "org-x");
    await seedMembership(db, { orgId: org, userId: "payer-1", role: "manager" });
    await grantOrgEntitlement(db, org, "payer-1");

    const payerSession = await makeSession(db, "payer-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Before leaving", organization_id: org }, { session: payerSession }), env(db));
    const workspaceId = ((await created.json() as { workspace: { id: number } })).workspace.id;

    // The payer leaves: membership expires now.
    await db.prepare("UPDATE organization_memberships SET valid_until=datetime('now','-1 second') WHERE organization_id=? AND user_id=?").bind(org, "payer-1").run();

    // 1. Org discovery is gone for the ex-member.
    const after = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session: payerSession }), env(db));
    const afterBody = await after.json() as { organization_entitlements: unknown[]; organization_contexts: unknown[] };
    expect(afterBody.organization_entitlements).toHaveLength(0);
    expect(afterBody.organization_contexts).toHaveLength(0);

    // 2. Private mutations are denied — even though they CREATED the workspace
    //    and PAID for the plan (an org workspace is the organization's context).
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: payerSession }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    await expect(createWorkspace(authedRequest("/api/workspaces", { name: "After leaving", organization_id: org }, { session: payerSession }), env(db)))
      .rejects.toMatchObject({ status: 403, code: "not_org_manager" });

    // 3. The ORGANIZATION keeps its paid service (the entitlement is org-held).
    expect(await countRows(db, "entitlements", "holder_key='org:" + org + "' AND active=1")).toBe(1);

    // 4. Personal payment evidence remains: the payer still sees their own order.
    const orders = await createOrder(authedRequest("/api/billing/orders", {
      order_key: "personal-after-leaving", items: [{ sku: "farm_workspace_monthly", quantity: 1 }],
    }, { session: payerSession }), env(db));
    expect(orders.status).toBe(201); // personal orders still work (no org context)
  });

  it("org-payer order creation is denied without a CURRENT billing-manager membership", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "member-1", "user");
    await seedUser(db, "stranger-1", "user");
    const org = await seedOrg(db, "org-o");
    await seedMembership(db, { orgId: org, userId: "member-1", role: "member" }); // ordinary member
    await seedBillingPrices(db);

    const memberSession = await makeSession(db, "member-1");
    // An ordinary member cannot buy on the organization's account.
    await expect(createOrder(authedRequest("/api/billing/orders", {
      order_key: "org-buy-attempt", items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: org,
    }, { session: memberSession }), env(db)))
      .rejects.toMatchObject({ status: 403, code: "not_org_manager" });
    expect(await countRows(db, "orders")).toBe(0);

    // A stranger with NO membership at all: same refusal.
    const strangerSession = await makeSession(db, "stranger-1");
    await expect(createOrder(authedRequest("/api/billing/orders", {
      order_key: "stranger-org-buy", items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: org,
    }, { session: strangerSession }), env(db)))
      .rejects.toMatchObject({ status: 403, code: "not_org_manager" });
    expect(await countRows(db, "orders")).toBe(0);
  });
});
