/** Unsaved registration contents never enter persistent browser storage.
 * A single current-account draft may survive SPA navigation in this tab.
 * Signing out, changing account, or reloading destroys it. Durable drafts
 * belong to the authenticated changes API. */
let principal: string | null = null;
let draft: { value: unknown; touchedAt: number } | null = null;
const MAX_AGE_MS = 30 * 60 * 1000;

export function setSubmissionDraftPrincipal(userId: string | null): void {
  if (userId !== principal) { principal = userId; draft = null; }
  // Discard the old unscoped draft rather than guessing which account owns it.
  try { sessionStorage.removeItem("heritage.submission.unsaved.v1"); } catch { /* Storage may be disabled. */ }
}

export function readSubmissionDraft<T>(userId: string | null): T | null {
  if (!userId || principal !== userId) return null;
  if (!draft || Date.now() - draft.touchedAt > MAX_AGE_MS) { draft = null; return null; }
  return draft.value as T;
}

export function rememberSubmissionDraft<T>(userId: string | null, value: T): void {
  if (!userId || principal !== userId) return;
  draft = { value, touchedAt: Date.now() };
}

export function forgetSubmissionDraft(userId: string | null): void {
  if (principal === userId) draft = null;
}
