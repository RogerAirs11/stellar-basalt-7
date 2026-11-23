/** Approval binds the clean checkout, not a caller-supplied CI label. */
export function validateReleaseRevision({head,ciSha,approvedSha,status}) {
  if(!/^[a-f0-9]{40}$/.test(head??'')) throw new Error('checkout_revision_unavailable');
  if(ciSha && ciSha!==head) throw new Error('ci_revision_does_not_match_checkout');
  if(approvedSha!==head) throw new Error('exact_checkout_approval_required');
  if(typeof status!=='string' || status.trim()!=='') throw new Error('dirty_checkout_not_approved');
  return head;
}
