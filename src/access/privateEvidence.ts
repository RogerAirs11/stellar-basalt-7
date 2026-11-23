import type { PrivacyViewer } from "../privacy/policy";
import { mfaAuthorizationPredicate } from "../auth/mfaGuard";

/** Shared private evidence read boundary, evaluated in the actual SELECT.
 * A session ID alone cannot inherit authority after its bearer is rotated. */
export function privateEvidenceSessionPredicate(viewer: PrivacyViewer | null | undefined): { sql: string; bindings: Array<string | number> } {
  if (!viewer?.user?.id || !viewer.sessionId || !viewer.sessionTokenHash) return { sql: "0=1", bindings: [] };
  const assurance = mfaAuthorizationPredicate(viewer);
  return { sql: `EXISTS(SELECT 1 FROM sessions pe_session JOIN users pe_user ON pe_user.id=pe_session.user_id
      WHERE pe_session.id=? AND pe_session.user_id=? AND pe_session.token_hash=?
        AND datetime(pe_session.expires_at)>CURRENT_TIMESTAMP AND pe_user.is_active=1)
      AND (${assurance.sql})`,
    bindings: [viewer.sessionId,viewer.user.id,viewer.sessionTokenHash,...assurance.bindings] };
}
