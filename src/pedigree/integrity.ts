import { classifyBreedingSex } from "./breeding";

export type ParentAssignmentIssueCode =
  | "invalid_parent"
  | "same_parents"
  | "self_parent"
  | "parent_sex_role"
  | "pedigree_cycle"
  | "pedigree_validation_limit";

export interface ParentAssignmentIssue {
  code: ParentAssignmentIssueCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ParentAssignmentValidation {
  valid: boolean;
  issues: ParentAssignmentIssue[];
  visitedNodes: number;
}

/** Validate a proposed sire/dam assignment without mutating canonical data. */
export async function validateParentAssignment(
  db: D1Database,
  horseId: number | null,
  fatherId: number | null | undefined,
  motherId: number | null | undefined,
  maxNodes = 5000,
): Promise<ParentAssignmentValidation> {
  const father = typeof fatherId === "number" ? fatherId : null;
  const mother = typeof motherId === "number" ? motherId : null;
  const issues: ParentAssignmentIssue[] = [];
  if([fatherId,motherId].some(id=>id!=null && (!Number.isSafeInteger(id)||Number(id)<=0))) {
    return {valid:false,issues:[{code:'invalid_parent',message:'Parent IDs must be positive safe integers'}],visitedNodes:0};
  }

  if (father && mother && father === mother) {
    issues.push({ code: "same_parents", message: "Sire and dam cannot be the same horse" });
  }
  if (horseId && (father === horseId || mother === horseId)) {
    issues.push({ code: "self_parent", message: "A horse cannot be its own parent" });
  }

  const parentIds = [...new Set([father, mother].filter((id): id is number => typeof id === "number"))];
  if (parentIds.length) {
    const placeholders = parentIds.map(() => "?").join(",");
    const result = await db.prepare(
      `SELECT id,sex_desc FROM horses WHERE id IN (${placeholders}) AND deleted_at IS NULL AND is_active=1`,
    ).bind(...parentIds).all<{ id: number; sex_desc: string | null }>();
    const found = new Set(result.results.map((row) => row.id));
    const missing = parentIds.filter((id) => !found.has(id));
    if (missing.length) {
      issues.push({
        code: "invalid_parent",
        message: "One or more parent IDs do not exist",
        details: { missingParentIds: missing },
      });
    }
    // T07 step 5: sex-role policy runs on EVERY parent assignment (create,
    // update). R142-B09 (Master-AI): the role classifier is now the ONE shared
    // canonical vocabulary (classifyBreedingSex) instead of this file's local
    // substring lists — the local lists missed plain "female" (and other
    // labels the classifier already knows), which let a recorded "Female"
    // horse be assigned as a sire. Unknown historical values still pass
    // rather than guessing.
    const sexByParent = new Map(result.results.map((row) => [row.id, row.sex_desc]));
    const fatherSex = father === null ? null : sexByParent.get(father) ?? null;
    const motherSex = mother === null ? null : sexByParent.get(mother) ?? null;
    const fatherClass = classifyBreedingSex(fatherSex);
    const motherClass = classifyBreedingSex(motherSex);
    if(fatherClass==='ambiguous' || motherClass==='ambiguous') {
      issues.push({code:'parent_sex_role',message:'A conflicting recorded sex description needs review before parent assignment'});
    }
    if (father !== null && fatherClass === "female") {
      issues.push({ code: "parent_sex_role", message: "A female-role horse cannot be assigned as sire", details: { parent: "father", sex_desc: fatherSex } });
    }
    // Current castration status cannot disprove historical paternity: the
    // conception may predate castration, or stored semen may have been used.
    // Prospective breeding eligibility is a separate, conservative policy.
    if (mother !== null && (motherClass === "male" || motherClass === "gelding")) {
      issues.push({ code: "parent_sex_role", message: "A male-role horse cannot be assigned as dam", details: { parent: "mother", sex_desc: motherSex } });
    }
  }

  if (!horseId || !parentIds.length || issues.some((issue) => issue.code === "invalid_parent" || issue.code === "self_parent" || issue.code === "parent_sex_role")) {
    return { valid: issues.length === 0, issues, visitedNodes: 0 };
  }

  const cycleCheck = await ancestryContains(db, parentIds, horseId, maxNodes);
  if (cycleCheck.limitExceeded) {
    issues.push({
      code: "pedigree_validation_limit",
      message: "Pedigree is too large to validate safely in this request",
      details: { visitedNodes: cycleCheck.visitedNodes, maxNodes },
    });
  } else if (cycleCheck.foundTarget) {
    issues.push({ code: "pedigree_cycle", message: "This parent change would create a pedigree cycle" });
  }

  return { valid: issues.length === 0, issues, visitedNodes: cycleCheck.visitedNodes };
}

async function ancestryContains(
  db: D1Database,
  startIds: number[],
  targetId: number,
  maxNodes: number,
): Promise<{ foundTarget: boolean; limitExceeded: boolean; visitedNodes: number }> {
  const safeMaxNodes = Number.isFinite(maxNodes) ? Math.max(100, Math.min(Math.trunc(maxNodes), 20_000)) : 5000;
  let frontier = [...new Set(startIds)];
  const seen = new Set<number>();

  for (let generation = 0; frontier.length && generation < 64; generation += 1) {
    if (frontier.includes(targetId)) {
      return { foundTarget: true, limitExceeded: false, visitedNodes: seen.size };
    }
    const fresh = frontier.filter((id) => !seen.has(id));
    if (!fresh.length) break;
    if (seen.size + fresh.length > safeMaxNodes) {
      return { foundTarget: false, limitExceeded: true, visitedNodes: seen.size };
    }
    for (const id of fresh) seen.add(id);

    const next: number[] = [];
    for (let start = 0; start < fresh.length; start += 80) {
      const chunk = fresh.slice(start, start + 80);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await db.prepare(
        `SELECT father_id,mother_id FROM horses WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ).bind(...chunk).all<{ father_id: number | null; mother_id: number | null }>();
      for (const row of rows.results) {
        if (typeof row.father_id === "number" && !seen.has(row.father_id)) next.push(row.father_id);
        if (typeof row.mother_id === "number" && !seen.has(row.mother_id)) next.push(row.mother_id);
      }
    }
    frontier = [...new Set(next)];
  }

  return { foundTarget: false, limitExceeded: frontier.length > 0 || seen.size >= safeMaxNodes, visitedNodes: seen.size };
}
