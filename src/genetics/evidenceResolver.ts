/**
 * Conservative resolver shared by genetic summaries and pairing evidence.
 * Verified ambiguous rows are never discarded in favour of a reassuring row;
 * contradictory verified genotypes resolve to conflict; unverified rows are
 * retained separately and cannot override verified evidence.
 */
export type ConservativeEvidenceStatus = "missing" | "unverified" | "uninterpreted" | "conflict" | "resolved";

export interface ConservativeEvidenceRow {
  id: string;
  result: string;
  verified: boolean;
}

export interface ParsedEvidence<T> {
  /** Canonical genotype identity used only for conflict detection. */
  identity: string;
  value: T;
}

export interface ConservativeEvidenceResolution<T> {
  status: ConservativeEvidenceStatus;
  value: T | null;
  consideredEvidenceIds: string[];
  unverifiedEvidenceIds: string[];
}

export function resolveConservativeEvidence<T>(
  rows: readonly ConservativeEvidenceRow[],
  parse: (result: string) => ParsedEvidence<T> | null,
): ConservativeEvidenceResolution<T> {
  const verified = rows.filter((row) => row.verified);
  const base = {
    consideredEvidenceIds: verified.map((row) => row.id).sort(),
    unverifiedEvidenceIds: rows.filter((row) => !row.verified).map((row) => row.id).sort(),
  };
  if (!rows.length) return { ...base, status: "missing", value: null };
  if (!verified.length) return { ...base, status: "unverified", value: null };

  const parsed = verified.map((row) => parse(row.result));
  const identities = new Set(parsed.filter((row): row is ParsedEvidence<T> => row !== null).map((row) => row.identity));
  // A known contradiction is stronger than an additional uninterpretable row:
  // it requires curator resolution either way and must never look reassuring.
  if (identities.size > 1) return { ...base, status: "conflict", value: null };
  if (parsed.some((row) => row === null)) return { ...base, status: "uninterpreted", value: null };
  return { ...base, status: "resolved", value: parsed[0]!.value };
}
