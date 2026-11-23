import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R107 NEXT-06-elite source-level locks (same discipline as
 * heritageDomainSurfaces): the first alternate-skin native directory/service
 * journey must consume the canonical headless layer, ship the platform's
 * honest language verbatim, stay visually independent, and be reachable
 * natively (never by redirecting to Core/Heritage).
 */
const read = (relative: string) => readFileSync(join(__dirname, relative), "utf8");

describe("NEXT-06-elite EquiData Elite domain surfaces", () => {
  const directory = read("../../src/web/frontends/equidata-elite/DirectoryPage.tsx");
  const services = read("../../src/web/frontends/equidata-elite/ServiceRequestsPage.tsx");
  const entry = read("../../src/web/frontends/equidata-elite/entry.tsx");
  const navigation = read("../../src/frontend-kit/navigation.ts");
  const workbenchHook = read("../../src/frontend-kit/useServiceWorkbench.ts");
  const composerHook = read("../../src/frontend-kit/domain/useServiceComposer.ts");
  const workbench = read("../../src/frontend-kit/domain/serviceWorkbench.ts");
  const composer = read("../../src/frontend-kit/domain/serviceComposer.ts");

  it("directory consumes the canonical headless loader and keeps every state distinct", () => {
    expect(directory).toContain("useDomainResource");
    expect(directory).toContain('phase === "empty"');
    expect(directory).toContain('phase === "unavailable"');
    expect(directory).toContain('phase === "forbidden"');
    // An empty result is explicitly not a claim that no professionals exist.
    expect(directory).toContain("not a claim that no professionals exist");
    // The page never reads or renders a contact value (the public DTO has none).
    expect(directory).not.toMatch(/person\.contact_value/);
    // Credentials honesty: expired/undated/unverified states stay honest.
    expect(directory).toContain("recorded_period_status");
    expect(directory).toContain("dates_not_recorded");
    expect(directory).toContain("unverified");
    // Consent-gated discovery language ships on the listing.
    expect(directory).toContain("nothing publishes without consent");
  });

  it("service requests use the canonical command layer with CAS transitions and idempotent creation", () => {
    // R113 shares commands in a headless store. Pin the complete binding chain,
    // rather than requiring each native view to implement a second controller.
    expect(services).toContain("useServiceRequestWorkbench(view.platform, scope, Boolean(view.user))");
    expect(services).toContain("useServiceRequestComposer(view.platform, principal, personId, Boolean(view.user))");
    expect(workbenchHook).toContain("new ServiceRequestWorkbench(platform.modules.serviceRequests");
    expect(composerHook).toContain("new ServiceRequestComposer(platform.modules.serviceRequests");
    expect(workbench).toContain("this.api.setStatus(id, status, { expectedVersion: row.row_version })");
    expect(composer).toContain("this.api.create(payload, { idempotencyKey: record.key })");
    expect(services).toContain("store.retryExact()");
    expect(services).toContain("snapshot.canReplay");
    expect(composer).toContain("this.api.reconcileIntent(record.key)");
    expect(composer).toContain("this.dispatch(record)");
    expect(services).toContain("not a confirmed appointment");
    expect(services).toContain("Contact is not shared in this view.");
    expect(services).toContain("Private inquiry");
    expect(services).toContain("state.status === 409");
    expect(services).toContain("Reload this request");
    expect(services).toContain("store.reconcile(id)");
    expect(services).toContain("store.acknowledge(id)");
    expect(services).toContain('snapshot.detail.phase === "ready" && command.recovery === "ready"');
  });

  it("the composer requires explicit consent before a lead can be submitted", () => {
    expect(services).toContain("consent: false");
    expect(services).toContain("!draft.consent");
    expect(services).toContain("I consent to sending this note to this professional");
    expect(services).toContain("inquiry, not an appointment");
  });

  it("no visual import from another skin (Elite pages stay Elite-local)", () => {
    for (const source of [directory, services]) {
      expect(source).not.toMatch(/from "[^"]*\/heritage\//);
      expect(source).not.toMatch(/from "[^"]*frontends\/(fei-classic|retro-astra|classic-registry)/);
      expect(source).not.toMatch(/\.css/);
    }
  });

  it("routes are native and discoverable inside the skin (no Core redirect)", () => {
    expect(entry).toContain('path==="/directory"');
    expect(entry).toMatch(/\/directory\\\/\(\\d\+\)/);
    expect(entry).toContain('const service=path.match(/^\\/services(?:\\/(\\d+))?$/)');
    expect(entry).toContain("isRegistryId(Number(service[1]))");
    expect(entry).toContain("requestId={local.id}");
    expect(entry).toContain("EquiDataDirectoryPage");
    expect(entry).toContain("EquiDataDirectoryPersonPage");
    expect(entry).toContain("EquiDataServiceRequestsPage");
    // The sidebar navigation registry exposes the same local routes.
    expect(navigation).toContain('local("equidata-elite", "/directory")');
    expect(navigation).toContain('local("equidata-elite", "/services")');
    // Native pages render locally — never a redirect to Core or Heritage.
    expect(entry).not.toMatch(/horseDbRoutes\.frontend\("heritage"/);
  });

  it("bilingual surfaces: both EN and FA ship for the new journey", () => {
    expect(directory).toMatch(/edxText\(view\.locale/);
    expect(services).toMatch(/edxText\(view\.locale/);
    // FA copy is present (Persian strings on both surfaces).
    expect(directory).toContain("فهرست متخصصان");
    expect(services).toContain("درخواست‌های خدمت");
  });
});
