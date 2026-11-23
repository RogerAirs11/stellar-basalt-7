import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { currentMembership } from "../organizations/membershipPolicy";
import { assignmentGrants, parseStaffActions } from "./domain";
import { workspaceAuthority, workspaceWritableSql, type WorkspacePolicyOptions } from "./policy";
import type { AcceptedGrantScope } from "../commerce/entitlementScope";

type Reader = { userId: string; role: string };

/**
 * R96-N09 — the paid-plan expiry surface. An organization workspace whose
 * organization HAS a paid-plan history (a grant/renewal entitlement event for
 * its holder key) but NO currently active entitlement is READ-ONLY: existing
 * records stay readable and exportable, but management writes refuse with an
 * honest renewal pointer. An organization that never paid keeps the free-tier
 * path (caps apply); a personal workspace has no plan concept at all.
 * The check is evaluated LIVE at write time — renewal restores writes on the
 * next request, with no propagation delay.
 * R120: scope-aware (IMP-009 follow-on) — the isolated demo environment
 * gates on its own demo-scope plan; every other environment gates on
 * production scope only, so a demo/legacy grant neither keeps an expired
 * org writable nor locks a never-paid org read-only where it does not
 * belong. Defaults to production (fail-closed). */
export async function requireWorkspaceWritable(db: D1Database, collectionId: number, scope: AcceptedGrantScope = "production"): Promise<void> {
  const collection = await db.prepare(`SELECT CASE WHEN ${workspaceWritableSql(scope)} THEN 1 ELSE 0 END AS writable
    FROM workspace_collections wc WHERE wc.id=? AND wc.deleted_at IS NULL`).bind(collectionId).first<{writable:number}>();
  if (collection && Number(collection.writable) === 0) {
    throw new HttpError(403, "workspace_plan_expired",
      "This workspace's paid plan has expired. Existing records stay readable/exportable; renew before adding work. Protective revocation and archive remain available.");
  }
}

/** Is the reader the owner, an org manager, or an ACTIVE staff member with the action?
 * R95-N07: an ORGANIZATION workspace is the organization's context — even its
 * creator must hold a CURRENT workspace-manager membership. An expired,
 * revoked or future membership (or a generic registry staff role) grants
 * nothing; only an explicit action-scoped staff assignment remains.
 * R96-N09: write actions additionally pass the live plan-expiry gate. */
export async function authorizeWorkspace(
  db: D1Database,
  reader: Reader,
  collectionId: number,
  action: "view" | "tasks_manage" | "export" | "manage",
  options: WorkspacePolicyOptions = {},
): Promise<{ as: "owner" | "manager" | "staff"; actions: string[] }> {
  const collection = await db.prepare(
    "SELECT id, owner_user_id, organization_id FROM workspace_collections WHERE id=? AND deleted_at IS NULL",
  ).bind(collectionId).first<{ owner_user_id: string; organization_id: number | null }>();
  if (!collection) throw new HttpError(404, "not_found", "Workspace not found");
  // Check the actual principal and requested access BEFORE exposing plan state.
  const authority = workspaceAuthority(reader.userId, action, { allowExpiredProtection: true, grantScope: options.grantScope });
  const permitted = await db.prepare(`SELECT wc.id FROM workspace_collections wc WHERE wc.id=? AND wc.deleted_at IS NULL AND ${authority.sql}`)
    .bind(collectionId, ...authority.binds).first();
  if (!permitted) throw new HttpError(404, "not_found", "Workspace not found");
  if ((action === "tasks_manage" || action === "manage") && !options.allowExpiredProtection) await requireWorkspaceWritable(db, collectionId, options.grantScope ?? "production");
  if (collection.organization_id == null) {
    if (collection.owner_user_id === reader.userId) return { as: "owner", actions: ["view", "tasks_manage", "export", "manage"] };
  } else {
    // Private workspaces require explicit ownership/membership/assignment.
    // Registry staff roles do not grant blanket private-data access.
    const membership = await currentMembership(db, reader.userId, collection.organization_id);
    if (membership && membership.capabilities.includes("workspace_manager")) {
      return { as: collection.owner_user_id === reader.userId ? "owner" : "manager", actions: ["view", "tasks_manage", "export", "manage"] };
    }
  }
  if (action !== "manage") {
    const assignment = await db.prepare(
      "SELECT actions, status FROM workspace_staff_assignments WHERE collection_id=? AND user_id=?",
    ).bind(collectionId, reader.userId).first<{ actions: string; status: string }>();
    if (assignment && assignmentGrants(assignment, action)) {
      const parsed = parseStaffActions(assignment.actions);
      if (parsed.ok) return { as: "staff", actions: parsed.actions };
    }
  }
  throw new HttpError(404, "not_found", "Workspace not found");
}

