import { isModerationActiveStatus } from "./vocabulary";

/** Minimum case shape needed to authorize access to private moderation evidence. */
export interface ModerationEvidenceCase {
  id: number;
  status: string;
  assigned_operator_user_id: string | null;
}

export interface ModerationEvidenceViewer {
  id: string;
  role: string;
}

/**
 * Private evidence is narrower than general moderation UI access.
 *
 * - Resolved/merged/dismissed history never grants routine access.
 * - An administrator must be the current assignee for the active case.
 * - super_admin is the deliberately narrow supervisory exception so an
 *   incident can be audited/reassigned without first making the supervisor the
 *   assignee.
 * - Editors and every other broad role are intentionally excluded.
 */
export function canReadModerationEvidence(
  viewer: ModerationEvidenceViewer,
  caseRow: ModerationEvidenceCase,
): boolean {
  if (!isModerationActiveStatus(caseRow.status)) return false;
  if (viewer.role === "super_admin") return true;
  return viewer.role === "admin" && caseRow.assigned_operator_user_id === viewer.id;
}
