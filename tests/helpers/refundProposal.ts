import type { D1Database } from "@cloudflare/workers-types";
/** Read the exact persisted proposal identity used by the client review screen. */
export async function currentAllocationProposalId(db: D1Database, refundId: number): Promise<string> {
  const row = await db.prepare("SELECT proposal_operation_id FROM refund_allocations WHERE refund_request_id=?").bind(refundId).first<{proposal_operation_id:string|null}>();
  if (!row?.proposal_operation_id) throw new Error("Fixture has no proposal identity; do not invent approval evidence");
  return row.proposal_operation_id;
}
