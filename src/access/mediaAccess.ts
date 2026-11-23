import type { MediaViewer } from "../api/modules/mediaPolicy";
import { publicMediaPredicate } from "../api/modules/mediaPolicy";
import { professionalActionPredicate } from "./professionalAccess";
import { privateEvidenceSessionPredicate } from "./privateEvidence";

/** `m` is horse_media and `h` is its live subject in every caller. Public
 * photo consent remains sufficient; every private path needs the actual
 * current bearer and assurance, with current role/grant checked in SQL. */
export function mediaReadPredicate(viewer?: MediaViewer | null): { sql: string; bindings: Array<string | number> } {
  const live = privateEvidenceSessionPredicate(viewer);
  const professional = viewer ? professionalActionPredicate({ viewerUserId: viewer.user.id,
    horseId: { column: "m.horse_id" }, permission: "private_file_export", atTransactionTime: true }) : { sql: "0=1", bindings: [] };
  return { sql: `((h.is_active=1 AND (${publicMediaPredicate("m")})) OR ((${live.sql}) AND (
      m.uploaded_by_user_id=? OR EXISTS(SELECT 1 FROM users media_actor WHERE media_actor.id=? AND media_actor.is_active=1 AND media_actor.role IN ('admin','super_admin'))
      OR (m.media_type='document' AND m.role='veterinary' AND m.verification<>'rejected' AND m.quarantined_at IS NULL AND m.quarantine_reason IS NULL AND (${professional.sql}))
    )))`, bindings: [...live.bindings,viewer?.user.id ?? "",viewer?.user.id ?? "",...professional.bindings] };
}

export function mediaSubjectPredicate(viewer?: MediaViewer | null): { sql: string; bindings: Array<string | number> } {
  const live = privateEvidenceSessionPredicate(viewer);
  const professional = viewer ? professionalActionPredicate({ viewerUserId: viewer.user.id,
    horseId: { column: "h.id" }, permission: "private_file_export", atTransactionTime: true }) : { sql: "0=1", bindings: [] };
  return { sql: `(h.is_active=1 OR ((${live.sql}) AND (
      EXISTS(SELECT 1 FROM users media_actor WHERE media_actor.id=? AND media_actor.is_active=1 AND media_actor.role IN ('admin','super_admin'))
      OR EXISTS(SELECT 1 FROM horse_media own_media WHERE own_media.horse_id=h.id AND own_media.uploaded_by_user_id=?)
      OR (${professional.sql})
    )))`, bindings: [...live.bindings,viewer?.user.id ?? "",viewer?.user.id ?? "",...professional.bindings] };
}
