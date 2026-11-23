/** Pure projection context. HTTP callers provide only authenticated identity;
 * database readers resolve permissions in the same SQL statement as evidence.
 * A role, ownership claim or unscoped flag never grants genetic access. */
export interface PrivacyViewer {
  user: { id: string; role: string };
  sessionId?: string;
  sessionTokenHash?: string;
  mfaPolicy?: "disabled" | "optional" | "required";
  /** Internal, per-row authorization result; never read from request input. */
  geneticScope?: { horseId: number; evidenceRead: boolean; verifiedHealthRead: boolean };
  /** Internal result for a breeding row, after authorizing both parents. */
  breedingNotesScope?: { sireId: number; damId: number };
}

export function canViewPrivateGeneticEvidence(viewer?: PrivacyViewer | null, horseId?: number): boolean {
  return Number.isSafeInteger(horseId) && Number(horseId) > 0 && viewer?.geneticScope?.horseId === horseId && viewer?.geneticScope?.evidenceRead === true;
}

export function canViewVerifiedHealthResults(viewer: PrivacyViewer | null | undefined, horseId: number | undefined): boolean {
  return Number.isSafeInteger(horseId) && Number(horseId) > 0 && viewer?.geneticScope?.horseId === horseId && viewer?.geneticScope?.verifiedHealthRead === true;
}
