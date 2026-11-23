import { z } from "zod";
import {
  CHANGE_REQUEST_APPLICABLE_FIELDS as SHARED_APPLICABLE_FIELDS,
  CHANGE_REQUEST_FIELD_SCHEMAS,
  parseHorseFieldValue,
} from "../registry/validation";

/**
 * Shared field validation for reviewed horse changes (REV-02).
 *
 * Direct edits validate through HorseCreateSchema; reviewed change requests
 * must not be a second, weaker validation path. Since T07 the per-field rules
 * live in ONE place — src/registry/validation.ts — and this module keeps the
 * REV-02 submission-time API on top of them.
 */

/** Applicable = whitelisted columns an update_horse review may canonically set. */
export const CHANGE_REQUEST_FIELD_VALUE_SCHEMAS: Record<string, z.ZodTypeAny> = CHANGE_REQUEST_FIELD_SCHEMAS;

export const CHANGE_REQUEST_APPLICABLE_FIELDS: ReadonlySet<string> = SHARED_APPLICABLE_FIELDS;

export interface ProposedChangeItem {
  field_name: string;
  old_value?: unknown;
  proposed_value?: unknown;
}

export interface ChangeItemIssue {
  field: string;
  code: "duplicate_field" | "unsupported_field" | "invalid_value";
  message: string;
}

/**
 * Validate proposed update_horse items the way the direct-edit path would.
 * Returns per-field issues; empty array = safe to apply canonically.
 */
export function validateProposedChangeItems(items: ProposedChangeItem[]): ChangeItemIssue[] {
  const issues: ChangeItemIssue[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const field = item.field_name;
    if (seen.has(field)) {
      issues.push({ field, code: "duplicate_field", message: `Field '${field}' appears more than once` });
      continue;
    }
    seen.add(field);
    const schema = CHANGE_REQUEST_FIELD_VALUE_SCHEMAS[field];
    if (!schema) {
      issues.push({
        field,
        code: "unsupported_field",
        message: `Field '${field}' cannot be applied through a change request review`,
      });
      continue;
    }
    // Missing proposed_value means "set NULL" for nullable fields; name_latin
    // is the only required field and rejects null through its own schema.
    const candidate = item.proposed_value === undefined ? null : item.proposed_value;
    const parsed = parseHorseFieldValue(field, candidate);
    if (!parsed.ok) {
      issues.push({
        field,
        code: "invalid_value",
        message: `Invalid value for '${field}'`,
      });
    }
  }
  return issues;
}
