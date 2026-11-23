import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R88 agent plan P21 acceptance evidence (source-level locks):
 * - The new Heritage surfaces (directory / workspaces / service requests)
 *   ship the platform's honest language verbatim — a frontend may never
 *   soften the API's own honesty.
 * - They consume the canonical P20 primitives (no hand-rolled loading state).
 * - No visual import from another skin (frontend independence).
 * - Navigation exists for the production surfaces whose APIs exist.
 */
const read = (relative: string) => readFileSync(join(__dirname, relative), "utf8");

describe("P21 Heritage domain surfaces", () => {
  const directory = read("../../src/web/heritage/DirectoryPage.tsx");
  const workspaces = read("../../src/web/heritage/WorkspacesPage.tsx");
  const services = read("../../src/web/heritage/ServiceRequestsPage.tsx");
  const serviceAdapter = read("../../src/frontend-kit/useServiceWorkbench.ts");
  const serviceDomain = read("../../src/frontend-kit/domain/serviceWorkbench.ts");
  const main = read("../../src/web/main.tsx");

  it("directory distinguishes unavailable/forbidden/error from empty and never softens consent language", () => {
    expect(directory).toContain("useDomainResource");
    expect(directory).toContain('phase === "empty"');
    expect(directory).toContain('phase === "unavailable"');
    expect(directory).toContain('phase === "forbidden"');
    // An empty result is explicitly not a claim that no professionals exist.
    expect(directory).toContain("not a claim that no professionals exist");
    // Contact is mediated; the page never reads or renders a contact value
    // (the public DTO has no such field — the page must not invent one).
    expect(directory).not.toMatch(/contact_value[^ ]*\s*[:=]/);
    expect(directory).not.toMatch(/\{person\.contact_value\}/);
    // Credentials honesty: unverified stays unverified, expired stays history.
    // Credentials honesty (R98): the richer recorded_period_status states keep
    // undated credentials honestly undated — never inflated to "current".
    expect(directory).toContain("recorded_period_status");
    expect(directory).toContain("dates_not_recorded");
    expect(directory).toContain("unverified");
  });

  it("workspaces ship the working-set note and CAS-guarded completion", () => {
    expect(workspaces).toContain("useDomainResource");
    expect(workspaces).toContain("usePlatformCommand");
    expect(workspaces).toContain("expectedVersion");
    expect(workspaces).toContain("WORKSPACES.workingSet");
    expect(workspaces).toContain("veterinaryNotice");
    expect(workspaces).toContain("neverDeleted");
  });

  it("service requests ship the not-an-appointment warning and CAS transitions", () => {
    // Follow the actual native mount to its shared lifecycle. The page must
    // not duplicate version selection or the role-aware transition graph.
    expect(services).toContain("useServiceRequestWorkbench(platform, scope, !!user)");
    expect(serviceAdapter).toContain("new ServiceRequestWorkbench(platform.modules.serviceRequests");
    expect(serviceDomain).toContain("expectedVersion: row.row_version");
    expect(serviceDomain).toContain('serviceTransitionsFor(row.status, row.is_requester_view ? "requester" : "provider").includes(status)');
    expect(services).toContain("store.transition(request.id, status)");
    expect(services).toContain("state={snapshot.list}");
    expect(services).toContain("state={snapshot.detail}");
    expect(services).toContain("notAppointment");
    expect(services).toContain("contactNotShared");
    expect(services).toContain("notePrivate");
  });

  it("all three surfaces use bilingual locale packs from the shared domain kit", () => {
    expect(directory).toContain("DIRECTORY");
    expect(workspaces).toContain("WORKSPACES");
    expect(services).toContain("SERVICE_REQUESTS");
    for (const source of [directory, workspaces, services]) {
      // Each page localizes honestly through the shared locale authority
      // (R122: the bilingual L helper now routes through uiText, which also
      // serves the French/Arabic Core dictionary with English fallback).
      expect(source).toMatch(/const L[^=]*= \(en(?:: string)?, fa(?:: string)?\) => \(?uiText\(locale, en, fa\)\)?/);
    }
  });

  it("no visual import from another skin (Heritage pages stay Heritage-local)", () => {
    for (const source of [directory, workspaces, services]) {
      expect(source).not.toMatch(/from "[^"]*frontends\//);
      // Same-skin tokens/layouts are allowed; another renderer's stylesheet is not.
      const styles = [...source.matchAll(/import\s+["']([^"']+\.css)["']/g)].map(match => match[1]);
      expect(styles).toEqual(["../styles/heritage.workbenches.css"]);
    }
  });

  it("main.tsx wires production navigation for directory, workspaces and services", () => {
    expect(main).toContain('"/directory"');
    expect(main).toContain('"/workspaces"');
    expect(main).toContain('"/services"');
    expect(main).toMatch(/HeritageDirectoryPage/);
    expect(main).toMatch(/HeritageWorkspacesPage/);
    expect(main).toMatch(/HeritageServiceRequestsPage/);
    // The host keeps SPA page tagging for the new routes.
    expect(main).toContain('"/directory") ? "directory"');
  });

  it("keyboard-completable surfaces: interactive rows are buttons, scrollers are labeled regions", () => {
    for (const source of [directory, workspaces, services]) {
      expect(source).toMatch(/<button/);
    }
    // Directory tables scroll horizontally with a labeled region (360px-safe).
    expect(directory).toContain('role="region"');
    expect(directory).toContain("scrollable");
    expect(directory).toContain("aria-busy");
    expect(services).toContain("aria-pressed");
    expect(workspaces).toContain("aria-current");
  });
});
