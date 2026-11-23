import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R107 NEXT-05 source-level locks (same discipline as heritageDomainSurfaces
 * and equidataEliteDomainSurfaces): every PRIVATE loader surface keys on the
 * principal (identity + permission epoch), and the host↔iframe session
 * channel exists end to end. A regression that drops the principal scope
 * from any pinned dependency array — reintroducing the "account A's data
 * renders under account B" leak — trips these locks.
 */
const read = (relative: string) => readFileSync(join(__dirname, relative), "utf8");

describe("NEXT-05 principal-scoped private surfaces", () => {
  const feiManagement = read("../../src/web/frontends/fei-classic/management.tsx");
  const feiContent = read("../../src/web/frontends/fei-classic/content.tsx");
  const eliteGovernance = read("../../src/web/frontends/equidata-elite/governance.tsx");
  const eliteNewsroom = read("../../src/web/frontends/equidata-elite/newsroom.tsx");
  const retroDesk = read("../../src/web/frontends/retro-astra/transplant/pages/GovernanceDesk.tsx");
  const retroDeskShell = read("../../src/web/frontends/retro-astra/transplant/pages/PlatformDesk.tsx");
  const retroNewsroom = read("../../src/web/frontends/retro-astra/transplant/pages/Newsroom.tsx");
  const retroProfile = read("../../src/web/frontends/retro-astra/transplant/pages/Profile.tsx");
  const retroProfileGovernance = read("../../src/web/frontends/retro-astra/transplant/pages/ProfileGovernance.tsx");

  it("FEI management: all five private admin loaders key on the principal scope", () => {
    expect(feiManagement).toContain("usePrincipalScope(view.user,view.permissions)");
    // Dashboard, audit and quality remain local; the two mounted review
    // queues now use the shared, principal-scoped workflow controller.
    const scoped = feiManagement.match(/\[view\.platform,(?:severity,)?principalScope,revision\]/g) ?? [];
    expect(scoped.length).toBe(3);
    expect(feiManagement).toContain('<FeiReviewQueue view={view} kind="claim"');
    expect(feiManagement).toContain('<FeiReviewQueue view={view} kind="change"');
    const queue = read("../../src/web/frontends/fei-classic/ReviewQueue.tsx");
    expect(queue).toContain("useHorseReviewQueue({ platform: view.platform, scope: usePrincipalScope(view.user, view.permissions), kind");
    const shared = read("../../src/frontend-kit/domain/horseWorkflows.ts");
    expect(shared).toContain('const scope = `${options.scope}|review:${kind}|enabled:${enabled}`');
    expect(shared).toContain('useDomainResource(`horse-${kind}-review`, scope');
    expect(shared).toContain('useScopedState<Record<string, string>>(scope');
    // The admin curation record + its draft (derived from a private read) are scoped.
    expect(feiManagement).toContain("useScopedState<AdminHorseRecord|null>(principalScope,null)");
    expect(feiManagement).toContain("useScopedState<Record<string,string>>(principalScope");
  });

  it("FEI content management: the private admin queue and its editor state key on the principal", () => {
    expect(feiContent).toContain("usePrincipalScope(view.user,view.permissions)");
    expect(feiContent).toContain("[view.platform,kind,status,principalScope,revision]");
    expect(feiContent).toContain("useScopedState<ContentPost|null>(principalScope,null)");
    expect(feiContent).toContain("useScopedState<ContentPostInput>(principalScope,()=>emptyPost())");
  });

  it("Elite governance console: principal scope in the load effect and render-time-masked state", () => {
    expect(eliteGovernance).toContain("usePrincipalScope(runtime.user,runtime.permissions)");
    expect(eliteGovernance).toContain("[runtime.user,runtime.platform,runtime.permissions,principalScope,revision,privileged]");
    expect(eliteGovernance).toContain("useScopedState<LoadState>(principalScope,EMPTY)");
    expect(eliteGovernance).toContain("useScopedState<AdminHorseRecord|null>(principalScope,null)");
  });

  it("Elite newsroom: the admin feed reloads on principal change and never renders the old manager's queue", () => {
    expect(eliteNewsroom).toContain("usePrincipalScope(view.user, view.permissions)");
    expect(eliteNewsroom).toContain("[canManage, principalScope]");
    expect(eliteNewsroom).toContain("useScopedState<ContentPost[]>(principalScope, [])");
    // Losing content.manage actively clears the admin feed.
    expect(eliteNewsroom).toContain("if (!canManage) { setAdminPosts([]); return; }");
  });

  it("Retro Astra governance desk: runtime-derived session, scoped queues, no stale local session copy", () => {
    expect(retroDeskShell).toContain("import { GovernanceDesk } from './GovernanceDesk'");
    expect(retroDeskShell).toContain("<GovernanceDesk/>");
    expect(retroDesk).toContain("const perms = runtime.permissions");
    expect(retroDesk).toContain("usePrincipalScope(runtime.user, perms)");
    // Each of the seven private resources carries the principal and an abort signal.
    expect(retroDesk.match(/useDomainResource\('retro-[^']+', (?:scope|`\$\{scope\}:\$\{severity\}`), signal/g)).toHaveLength(7);
    expect(retroDesk).toContain("useScopedState<AdminHorseRecord | null>(scope, null)");
    expect(retroDesk).toContain("usePlatformCommand(scope)");
    // The displayed account remains runtime-derived; no stale local session copy.
    expect(retroDesk).not.toContain("setSession");
    expect(retroDesk).toContain("runtime.user?.display_name || L('Public access'");
  });

  it("Retro Astra newsroom + profile: principal scope on the admin feed and my claims/changes", () => {
    expect(retroNewsroom).toContain("usePrincipalScope(runtime.user, runtime.permissions)");
    expect(retroNewsroom).toContain("[canManage, principalScope]");
    expect(retroNewsroom).toContain("if (!canManage) { setAdminPosts([]); return; }");
    expect(retroProfile).toContain("<ProfileGovernance horseId={horse.numericId??id}/>");
    expect(retroProfileGovernance).toContain("usePrincipalScope(runtime.user, runtime.permissions)");
    expect(retroProfileGovernance).toContain("const scope = `${principal}|horse:${horseId}`");
    expect(retroProfileGovernance).toContain("useDomainResource('retro-profile-claims', scope");
    expect(retroProfileGovernance).toContain("useDomainResource('retro-profile-changes', scope");
    expect(retroProfileGovernance).toContain("useScopedState(scope, '')");
    expect(retroProfileGovernance).toContain("usePlatformCommand(scope)");
  });

  it("the kit exposes the shared principal-scope helpers through the domain barrel", () => {
    const domainIndex = read("../../src/frontend-kit/domain/index.ts");
    expect(domainIndex).toContain("principalScopeKey");
    expect(domainIndex).toContain("usePrincipalScope");
    expect(domainIndex).toContain("useScopedState");
    const kitIndex = read("../../src/frontend-kit/index.ts");
    expect(kitIndex).toContain('export * from "./domain"');
  });

  it("the shared editor hooks accept the principal scope and the skins pass it", () => {
    const profileEditor = read("../../src/frontend-kit/domain/profileEditor.ts");
    expect(profileEditor).toMatch(/export function useProfileEditorController\(personId: number \| null, platform: ProfileEditorPlatform \| null, scope\?: string\)/);
    expect(profileEditor).toMatch(/export function useMyDirectoryClaims\(platform: ProfileEditorPlatform \| null, scope\?: string\)/);
    const organizationEditor = read("../../src/frontend-kit/domain/organizationEditor.ts");
    expect(organizationEditor).toMatch(/export function useOrganizationEditorController\(organizationId: number \| null, platform: OrganizationEditorPlatform \| null, scope\?: string\)/);
    for (const file of [
      "../../src/web/frontends/classic-registry/ProfileEditor.tsx",
      "../../src/web/frontends/classic-registry/OrganizationEditor.tsx",
      "../../src/web/frontends/equidata-elite/ProfileEditor.tsx",
      "../../src/web/frontends/equidata-elite/OrganizationEditor.tsx",
      "../../src/web/frontends/fei-classic/ProfileEditor.tsx",
      "../../src/web/frontends/fei-classic/OrganizationEditor.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("usePrincipalScope(user, null)");
    }
  });

  it("each skin's host entries pass the runtime user into the private editors", () => {
    expect(read("../../src/web/frontends/classic-registry/entry.tsx")).toContain("user={runtime.user}");
    expect(read("../../src/web/frontends/equidata-elite/entry.tsx")).toContain("user={view.user}");
    expect(read("../../src/web/frontends/fei-classic/entry.tsx")).toContain("user={view.user}");
  });

  it("the wrapper hooks re-export the principal-scope helpers for their skins", () => {
    expect(read("../../src/web/frontends/equidata-elite/hooks.ts")).toContain("export { usePrincipalScope, useScopedState };");
    expect(read("../../src/web/frontends/fei-classic/hooks.ts")).toContain("export { usePrincipalScope, useScopedState };");
  });

  it("the host↔Classic iframe session channel exists end to end", () => {
    const hostBridge = read("../../standalone-frontends/classic-v1.4/public/ui/hostBridge.js");
    expect(hostBridge).toContain('"horse-db-classic-session"');
    expect(hostBridge).toContain("handlers.session()");
    const core = read("../../standalone-frontends/classic-v1.4/public/ui/core.js");
    expect(core).toContain("export async function refreshAuth()");
    expect(core).toContain('state.auth = { user: null, csrfToken: null, permissions: [] };');
    const app = read("../../standalone-frontends/classic-v1.4/public/ui/app.js");
    expect(app).toContain("session: async () => {");
    // R108 F04 hardening: the in-memory authority is cleared SYNCHRONOUSLY at
    // session-change time (the old principal's data cannot survive the await
    // window), then the fresh /me read is awaited before re-render.
    expect(app).toContain("const pending = refreshAuth(); // clears in-memory authority synchronously");
    expect(app).toContain("if (!await pending) return;");
    const sessionHandler = app.slice(app.indexOf("session: async () => {"), app.indexOf("});\nawait bootstrapData"));
    const authorityRead = sessionHandler.indexOf("if (!await pending) return;");
    expect(authorityRead).toBeGreaterThan(0);
    for (const reset of ["resetAdminCaches();", "resetHorseRequests();", "resetDirectoryWorkbench();", "resetServiceWorkbench();", "closeModal();", "target.innerHTML = loading();"]) {
      const at = sessionHandler.indexOf(reset);
      expect(at, `${reset} clears old private state synchronously`).toBeGreaterThan(0);
      expect(at, `${reset} runs before the asynchronous authority read`).toBeLessThan(authorityRead);
    }
    const adminView = read("../../standalone-frontends/classic-v1.4/public/ui/views/admin.js");
    expect(adminView).toContain("export function resetAdminCaches()");
    const hostEntry = read("../../src/web/frontends/classic-registry/entry.tsx");
    expect(hostEntry).toContain('postMessage({type:"horse-db-classic-session"},location.origin)');
  });

  it("the pre-existing identity-keyed surfaces stay identity-keyed (no regression drift)", () => {
    // Heritage + Elite NEXT-06 surfaces already key on user id — they must stay that way.
    const heritageWorkspaces = read("../../src/web/heritage/WorkspacesPage.tsx");
    expect(heritageWorkspaces).toContain('useDomainResource("workspaces-mine", user?.id ?? "anonymous"');
    const eliteServices = read("../../src/web/frontends/equidata-elite/ServiceRequestsPage.tsx");
    // R108 F02/F12: private loaders key on the full principal scope (user id +
    // permission epoch via usePrincipalScope), not the bare user id — a
    // permission revocation re-keys the same user.
    expect(eliteServices).toContain("const scope = usePrincipalScope(view.user, view.permissions);");
    expect(eliteServices).toContain("useServiceRequestWorkbench(view.platform, scope, Boolean(view.user))");
    expect(eliteServices).toContain("const principal = usePrincipalScope(view.user, view.permissions);");
    expect(eliteServices).toContain("useServiceRequestComposer(view.platform, principal, personId, Boolean(view.user))");
    const workbench = read("../../src/frontend-kit/useServiceWorkbench.ts");
    const composer = read("../../src/frontend-kit/domain/useServiceComposer.ts");
    expect(workbench).toContain("[platform, principalScope, enabled]");
    expect(composer).toContain("[platform, principalScope, providerId, enabled]");
    for (const adapter of [workbench, composer]) {
      expect(adapter).toContain("enabled && current.current === identity");
      expect(adapter).toContain("store.dispose()");
    }
    const feiWorkflows = read("../../src/web/frontends/fei-classic/workflows.tsx");
    expect(feiWorkflows).toContain("const scope = usePrincipalScope(view.user, view.permissions);");
    expect(feiWorkflows).toContain("useHorseWorkflows({ platform: view.platform, scope, horseId");
    const horseWorkflows = read("../../src/frontend-kit/domain/horseWorkflows.ts");
    expect(horseWorkflows).toContain('const scope = `${options.scope}|horse:${horseId ?? "all"}`');
    expect(horseWorkflows).toContain('useDomainResource("horse-workflow-claims", scope');
    expect(horseWorkflows).toContain('useDomainResource("horse-workflow-changes", scope');
  });
});
