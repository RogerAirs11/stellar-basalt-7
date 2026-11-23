import type { D1Database } from "@cloudflare/workers-types";
import { HttpError, json } from "../http";
import { requirePermission } from "../../auth/guards";

/**
 * R141 — duplicate-resolution workbench surfaces (read-only).
 *
 * The versioned merge/preview/unmerge commands existed since R117-19, but no
 * human could FIND the duplicates they resolve: Master AI's workflow-completeness
 * standard ("a backend endpoint is not done until the intended user can complete
 * the task through the interface") flags exactly this gap. These two read-only
 * endpoints feed the admin Duplicate Workbench UI:
 *
 *  1. adminDuplicateCandidates — the standing fuzzy similar-names miner. Groups
 *     live horses that likely describe the same animal (exact register number,
 *     exact microchip, normalized-name + birth-year proximity, same both
 *     parents). Purely derived from canonical tables on each call — no extra
 *     cron state, no cache to go stale, bounded output.
 *  2. adminMergeHistory — recent versioned merge receipts, newest first, so the
 *     operator can reach the guarded unmerge for any recent merge.
 *
 * Both gate on horse.edit (the same permission the merge commands require).
 * Neither writes anything canonical.
 */

const MEMBER_COLUMNS = "id,name_latin,name_native,register_no,microchip_no,birth_year,sex_desc,breed_desc,created_at";

export type DuplicateReason = "register_no_exact" | "microchip_exact" | "name_year_match" | "same_parents";

interface HorseMember {
  id: number;
  name_latin: string | null;
  name_native: string | null;
  register_no: string | null;
  microchip_no: string | null;
  birth_year: number | null;
  sex_desc: string | null;
  breed_desc: string | null;
  created_at: string | null;
}

interface CandidateGroup {
  reason: DuplicateReason;
  key: string;
  members: HorseMember[];
}

function member(row: Record<string, unknown>): HorseMember {
  return {
    id: Number(row.id),
    name_latin: (row.name_latin as string | null) ?? null,
    name_native: (row.name_native as string | null) ?? null,
    register_no: (row.register_no as string | null) ?? null,
    microchip_no: (row.microchip_no as string | null) ?? null,
    birth_year: row.birth_year == null ? null : Number(row.birth_year),
    sex_desc: (row.sex_desc as string | null) ?? null,
    breed_desc: (row.breed_desc as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
  };
}

function groupKey(reason: DuplicateReason, row: Record<string, unknown>): string {
  switch (reason) {
    case "register_no_exact":
      return `register_no:${String(row.register_no ?? "").trim()}`;
    case "microchip_exact":
      return `microchip:${String(row.microchip_no ?? "").trim()}`;
    case "name_year_match":
      return `name_year:${String(row.name_latin ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
    case "same_parents":
      return `parents:${Number(row.father_id)}:${Number(row.mother_id)}`;
  }
}

/** R141: standing duplicate-candidate miner feeding the admin workbench. */
export async function adminDuplicateCandidates(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME?: string }): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME ?? "hr_session", "horse.edit");
  const url = new URL(request.url);
  const reasonFilter = url.searchParams.get("reason");
  if (reasonFilter != null && !["register_no_exact", "microchip_exact", "name_year_match", "same_parents"].includes(reasonFilter)) {
    throw new HttpError(400, "invalid_reason_filter", "reason must be one of register_no_exact, microchip_exact, name_year_match, same_parents");
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
  const reasons: DuplicateReason[] = reasonFilter
    ? [reasonFilter as DuplicateReason]
    : ["register_no_exact", "microchip_exact", "name_year_match", "same_parents"];

  // Each probe is bounded (LIMIT) and only scans live horses.
  const probes: Array<{ reason: DuplicateReason; sql: string }> = [
    {
      reason: "register_no_exact",
      sql: `SELECT ${MEMBER_COLUMNS},register_no AS group_value FROM horses
            WHERE deleted_at IS NULL AND register_no IS NOT NULL AND TRIM(register_no)<>''
            AND register_no IN (SELECT register_no FROM (SELECT register_no FROM horses WHERE deleted_at IS NULL AND register_no IS NOT NULL AND TRIM(register_no)<>'' GROUP BY register_no HAVING COUNT(*)>1 LIMIT 200))
            ORDER BY register_no,id LIMIT 400`,
    },
    {
      reason: "microchip_exact",
      sql: `SELECT ${MEMBER_COLUMNS},microchip_no AS group_value FROM horses
            WHERE deleted_at IS NULL AND microchip_no IS NOT NULL AND TRIM(microchip_no)<>''
            AND microchip_no IN (SELECT microchip_no FROM (SELECT microchip_no FROM horses WHERE deleted_at IS NULL AND microchip_no IS NOT NULL AND TRIM(microchip_no)<>'' GROUP BY microchip_no HAVING COUNT(*)>1 LIMIT 200))
            ORDER BY microchip_no,id LIMIT 400`,
    },
    // name_year_match is mined in JS below (portable normalization, no SQL
    // row-value IN), so it has no SQL probe here.
    {
      reason: "same_parents",
      sql: `SELECT ${MEMBER_COLUMNS},father_id,mother_id FROM horses
            WHERE deleted_at IS NULL AND father_id IS NOT NULL AND mother_id IS NOT NULL
            AND (father_id,mother_id) IN (SELECT father_id,mother_id FROM (SELECT father_id,mother_id FROM horses WHERE deleted_at IS NULL AND father_id IS NOT NULL AND mother_id IS NOT NULL GROUP BY father_id,mother_id HAVING COUNT(*)>1 LIMIT 200))
            ORDER BY father_id,mother_id,id LIMIT 400`,
    },
  ];
  const groups: CandidateGroup[] = [];
  for (const probe of probes) {
    if (!reasons.includes(probe.reason)) continue;
    const rows = (await env.DB.prepare(probe.sql).all()).results as Array<Record<string, unknown>>;
    groups.push(...collectGroups(probe.reason, rows));
  }

  if (reasons.includes("name_year_match")) {
    const rows = (await env.DB.prepare(
      `SELECT ${MEMBER_COLUMNS} FROM horses
       WHERE deleted_at IS NULL AND TRIM(COALESCE(name_latin,''))<>''
         AND id IN (
           SELECT id FROM horses h2 WHERE h2.deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM horses h3
             WHERE h3.deleted_at IS NULL
               AND h3.id<>h2.id
               AND LOWER(REPLACE(TRIM(h3.name_latin),'  ',' ')) = LOWER(REPLACE(TRIM(h2.name_latin),'  ',' '))
               AND (h3.birth_year IS NULL OR h2.birth_year IS NULL OR ABS(h3.birth_year-h2.birth_year)<=1)
             LIMIT 1
           )
         )
       ORDER BY id LIMIT 400`
    ).all()).results as Array<Record<string, unknown>>;
    groups.push(...collectGroups("name_year_match", rows));
  }

  groups.sort((a, b) => b.members.length - a.members.length || a.reason.localeCompare(b.reason) || a.key.localeCompare(b.key));
  return json({
    generated: new Date().toISOString(),
    reasons: reasons,
    group_limit: limit,
    groups: groups.slice(0, limit),
    total_groups: groups.length,
    truncated: groups.length > limit,
    note: "Read-only candidate mining over live canonical rows. Review each group through the merge preview before any versioned merge; candidates are hints, not verdicts.",
  });
}

function collectGroups(reason: DuplicateReason, rows: Array<Record<string, unknown>>): CandidateGroup[] {
  const byKey = new Map<string, CandidateGroup>();
  for (const row of rows) {
    const key = groupKey(reason, row);
    const group = byKey.get(key) ?? { reason, key, members: [] };
    group.members.push(member(row));
    byKey.set(key, group);
  }
  return [...byKey.values()].filter((group) => group.members.length > 1);
}

/** R141: recent versioned merge receipts (the unmerge entry list). */
export async function adminMergeHistory(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME?: string }): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME ?? "hr_session", "horse.edit");
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const includeResolved = url.searchParams.get("include_resolved") === "1";
  const rows = (await env.DB.prepare(
    `SELECT m.id,m.kept_horse_id,m.merged_horse_id,m.reason,m.merged_at,m.unmerged_at,m.unmerge_operation_id,m.manifest_digest,m.policy_version,m.operation_id,
            kh.name_latin AS kept_name_latin, kh.name_native AS kept_name_native,
            mh.name_latin AS merged_name_latin, mh.name_native AS merged_name_native,
            u.display_name AS merged_by
     FROM horse_merges m
     LEFT JOIN horses kh ON kh.id=m.kept_horse_id
     LEFT JOIN horses mh ON mh.id=m.merged_horse_id
     LEFT JOIN users u ON u.id=m.merged_by_user_id
     ${includeResolved ? "" : "WHERE m.unmerged_at IS NULL"}
     ORDER BY m.id DESC LIMIT ?`
  ).bind(limit).all()).results as Array<Record<string, unknown>>;
  return json({
    merges: rows.map((row) => ({
      id: Number(row.id),
      kept_horse_id: Number(row.kept_horse_id),
      merged_horse_id: Number(row.merged_horse_id),
      kept_name_latin: (row.kept_name_latin as string | null) ?? null,
      kept_name_native: (row.kept_name_native as string | null) ?? null,
      merged_name_latin: (row.merged_name_latin as string | null) ?? null,
      merged_name_native: (row.merged_name_native as string | null) ?? null,
      reason: (row.reason as string) ?? "",
      merged_at: (row.merged_at as string) ?? null,
      unmerged_at: (row.unmerged_at as string | null) ?? null,
      unmerge_operation_id: (row.unmerge_operation_id as string | null) ?? null,
      manifest_digest: (row.manifest_digest as string | null) ?? null,
      policy_version: (row.policy_version as string | null) ?? null,
      operation_id: (row.operation_id as string) ?? null,
      merged_by: (row.merged_by as string | null) ?? null,
    })),
    limit,
    include_resolved: includeResolved,
    note: "Reversal always goes through the guarded unmerge command; the manifest is verified entry-by-entry before anything is restored.",
  });
}
