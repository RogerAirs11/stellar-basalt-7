import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Follow the native renderer -> public hook -> actual client calls. A shared
 * hook's existence alone cannot establish that a frontend exposes a workflow.
 * This static floor supplements the mounted and real-browser workflow tests. */
export function equidataWorkflowEvidence(root) {
  const read = path => readFileSync(join(root, path), "utf8");
  const prefix = "src/web/frontends/equidata-elite/";
  const pages = read(prefix + "pages.tsx"), entry = read(prefix + "entry.tsx");
  const forms = read(prefix + "HorseRequests.tsx"), reviews = read(prefix + "ReviewQueue.tsx");
  const governance = read(prefix + "governance.tsx");
  const domain = read("src/frontend-kit/domain/horseWorkflows.ts");
  const problems = [];
  const requireMarkers = (source, markers, surface) => {
    for (const marker of markers) if (!source.includes(marker)) problems.push(`EquiData ${surface} binding missing: ${marker}`);
  };
  requireMarkers(entry, ['local?.kind==="claims"', '<ClaimsPage view={view}'], "routed requests");
  requireMarkers(pages, ['from "./HorseRequests"', '<EliteHorseRequestsPage view={view}', '<EliteHorseClaimPanel view={view} horseId={id}'], "native request presentation");
  requireMarkers(forms, ['from "../../../frontend-kit"', 'useHorseWorkflows({', 'platform: view.platform', 'model.submitClaim()', 'model.saveCorrection(true)', 'model.claimDraft.evidence', 'model.claims', 'model.changes'], "shared command and list");
  requireMarkers(governance, ['from "./ReviewQueue"', '<EliteReviewQueue runtime={runtime} kind="claim"', '<EliteReviewQueue runtime={runtime} kind="change"'], "native reviewer presentation");
  requireMarkers(reviews, ['from "../../../frontend-kit"', 'useHorseReviewQueue({ platform: runtime.platform', 'flow.rows', 'row.evidence', 'flow.setNote(row.id', 'flow.review(row.id, "approved")', 'flow.review(row.id, "rejected")'], "review command, evidence and reason");
  requireMarkers(domain, ['platform.claims.mine(', 'platform.claims.create(', 'platform.changes.mine(', 'platform.changes.create(', 'platform.admin.claims(', 'platform.admin.reviewClaim(', 'platform.admin.changeRequests(', 'platform.admin.reviewChangeRequest('], "live domain operations");
  return { problems, source: problems.length ? "" : [forms, reviews, domain].join("\n") };
}
