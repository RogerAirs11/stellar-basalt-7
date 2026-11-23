import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OrganizationEditorController,
  buildOrganizationSubmission,
  diffOrganizationDraft,
  draftFromOrganization,
  newOrganizationDraft,
  normalizeStaffRoster,
  orgConsentWithdrawnElsewhere,
  ORGANIZATION_ONBOARDING_EXPLAINER,
  type OrganizationEditorDraft,
  type StoredOrganization,
} from "../../src/frontend-kit/domain/organizationEditor";
import { PlatformClientError } from "../../src/frontend-kit/errors";

/**
 * R98-N07 acceptance — the ONE headless organization-editor controller shared
 * by all five frontends. The five forms are independent VISUALS over this
 * same controller, so pinning it here pins every form:
 *
 *  1. The stored row_version populates every update; FIRST CREATION submits
 *     without expected_version — the server's 428 gate is the proof.
 *  2. Editors without private-contact permission (curators, or staff whose
 *     membership was revoked mid-session) never see nor submit the private
 *     contact field.
 *  3. On 409 the controller fetches the current version, reports FIELD-LEVEL
 *     differences, retains the local draft and NEVER auto-resubmits a
 *     publication choice that was withdrawn on the server.
 *  4. The staff roster is normalized honestly (current vs former vs invite).
 *  5. The onboarding explainer keeps account/person/organization/official
 *     roles distinct, bilingual (EN+FA).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function storedOrganization(overrides: Partial<StoredOrganization> = {}): StoredOrganization {
  return {
    id: 12, slug: "azar-stables", name_latin: "Azar Stables", name_native: "اصطبل آذر", kind: "stable",
    status: "active", row_version: 4, description: "Endurance stable", service_categories: ["boarding"],
    specialties: ["endurance"], service_areas: ["IR-08"], accessibility_notes: "Ramp access",
    opening_hours: { sat: "09:00-13:00" }, province_code: "IR-08", province_code_raw: "IR-08",
    province_code_scheme: "IR-3166-2:2024", province_needs_review: false, city: "Tehran",
    contact_preference: "platform_message", contact_value: "+98 21 555 0000",
    publication_consent: true, published_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

const CURRENT_STAFF = { edit: true, initial_publication: true, private_contact: true };
const CURATOR = { edit: true, initial_publication: false, private_contact: false };

describe("N07 pure submission building — the five forms' shared core", () => {
  it("populates expected_version from the ACTUAL stored row_version on updates", () => {
    const submission = buildOrganizationSubmission(newOrganizationDraft(), storedOrganization({ row_version: 11 }), CURRENT_STAFF, "IR-3166-2:2024");
    expect(submission.expected_version).toBe(11);
  });

  it("first creation (no stored profile) submits WITHOUT expected_version — the 428 gate stays the proof", () => {
    const submission = buildOrganizationSubmission(newOrganizationDraft(), null, CURRENT_STAFF, "IR-3166-2:2024");
    expect("expected_version" in submission).toBe(false);
  });

  it("sends the explicit province scheme whenever a province is set", () => {
    const draft = { ...newOrganizationDraft(), province_code: "IR-08" };
    expect(buildOrganizationSubmission(draft, storedOrganization(), CURRENT_STAFF, "IR-3166-2:2024").province_code_scheme).toBe("IR-3166-2:2024");
    const noProvince = { ...newOrganizationDraft(), province_code: "" };
    expect(buildOrganizationSubmission(noProvince, storedOrganization(), CURRENT_STAFF, "IR-3166-2:2024").province_code_scheme).toBeUndefined();
  });

  it("an editor WITHOUT private-contact permission never submits the private contact field", () => {
    const draft: OrganizationEditorDraft = { ...newOrganizationDraft(), contact_value: "+98 900 111 2222" };
    const submission = buildOrganizationSubmission(draft, storedOrganization(), CURATOR, "IR-3166-2:2024");
    expect("contact_value" in submission).toBe(false);
    const staffSubmission = buildOrganizationSubmission(draft, storedOrganization(), CURRENT_STAFF, "IR-3166-2:2024");
    expect(staffSubmission.contact_value).toBe("+98 900 111 2222");
  });

  it("opening hours are serialized from the structured draft only", () => {
    const draft = { ...newOrganizationDraft(), opening_hours: { mon: "08:00-14:00", fri: "closed" } };
    const submission = buildOrganizationSubmission(draft, storedOrganization(), CURRENT_STAFF, "IR-3166-2:2024");
    expect(JSON.parse(String(submission.opening_hours))).toEqual({ mon: "08:00-14:00", fri: "closed" });
    const empty = buildOrganizationSubmission(newOrganizationDraft(), storedOrganization(), CURRENT_STAFF, "IR-3166-2:2024");
    expect(empty.opening_hours).toBeUndefined();
  });

  it("field-level differences on conflict cover the N07 business fields", () => {
    const draft = draftFromOrganization(storedOrganization(), CURRENT_STAFF);
    const server = storedOrganization({
      description: "Updated by another staff member", specialties: ["jumping"], service_areas: ["IR-23"], city: "Karaj",
      opening_hours: { sat: "10:00-16:00" }, publication_consent: false,
    });
    const differences = diffOrganizationDraft(draft, server);
    const fields = differences.map((d) => d.field);
    expect(fields).toContain("description");
    expect(fields).toContain("specialties");
    expect(fields).toContain("service_areas");
    expect(fields).toContain("city");
    expect(fields).toContain("opening_hours");
    expect(fields).toContain("publication_consent");
    expect(fields).not.toContain("service_categories"); // unchanged
  });

  it("withdrawn-elsewhere consent blocks resubmission until explicit re-consent", () => {
    const draft = { ...newOrganizationDraft(), publication_consent: true };
    expect(orgConsentWithdrawnElsewhere(draft, storedOrganization({ publication_consent: false }))).toBe(true);
    expect(orgConsentWithdrawnElsewhere(draft, storedOrganization({ publication_consent: true }))).toBe(false);
    expect(orgConsentWithdrawnElsewhere({ ...newOrganizationDraft(), publication_consent: false }, storedOrganization({ publication_consent: false }))).toBe(false);
  });
});

describe("N07 controller state machine", () => {
  function platform(views: { managed: unknown; upsert?: unknown }) {
    return {
      modules: {
        organizations: {
          managed: async () => views.managed as never,
          upsertProfile: async () => views.upsert as never,
        },
      },
    };
  }

  it("loads a stored organization into ready with a staff draft (private contact included only with permission)", async () => {
    const stored = storedOrganization();
    const controller = new OrganizationEditorController();
    await controller.load({ platform: platform({ managed: { organization: stored, permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } }), organizationId: 12 });
    const state = controller.getState();
    expect(state.phase).toBe("ready");
    if (state.phase === "ready") {
      expect(state.draft.contact_value).toBe("+98 21 555 0000");
      expect(state.draft.opening_hours).toEqual({ sat: "09:00-13:00" });
      expect(state.stored.row_version).toBe(4);
    }
    // A curator's draft excludes the private contact value entirely.
    const curatorController = new OrganizationEditorController();
    await curatorController.load({ platform: platform({ managed: { organization: stored, permissions: CURATOR, current_province_scheme: "IR-3166-2:2024" } }), organizationId: 12 });
    const curatorState = curatorController.getState();
    expect(curatorState.phase).toBe("ready");
    if (curatorState.phase === "ready") expect(curatorState.draft.contact_value).toBe("");
  });

  it("no stored row loads as empty (first creation)", async () => {
    const controller = new OrganizationEditorController();
    await controller.load({ platform: platform({ managed: { organization: storedOrganization({ row_version: 0 }), permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } }), organizationId: 12 });
    const state = controller.getState();
    expect(state.phase).toBe("empty");
    if (state.phase === "empty") expect(state.stored).toBeNull();
  });

  it("denied (403) and unavailable surfaces stay distinct", async () => {
    const denied = new OrganizationEditorController();
    await denied.load({
      platform: {
        modules: {
          organizations: {
            managed: async () => { throw new PlatformClientError(403, "organization_staff_required", "not staff"); },
            upsertProfile: async () => { throw new Error("unreachable"); },
          },
        },
      },
      organizationId: 12,
    });
    expect(denied.getState().phase).toBe("denied");
    const unavailable = new OrganizationEditorController();
    await unavailable.load({
      platform: {
        modules: {
          organizations: {
            managed: async () => { throw new PlatformClientError(503, "unavailable", "later"); },
            upsertProfile: async () => { throw new Error("unreachable"); },
          },
        },
      },
      organizationId: 12,
    });
    expect(unavailable.getState().phase).toBe("unavailable");
  });

  it("409 conflict fetches the current profile, reports differences, retains the draft and blocks re-consent", async () => {
    const stored = storedOrganization();
    let calls = 0;
    const current = storedOrganization({ row_version: 5, description: "Changed elsewhere", publication_consent: false });
    const conflictPlatform = {
      modules: {
        organizations: {
          managed: async () => (calls++ === 0
            ? { organization: stored, permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } as never
            : { organization: current, permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } as never),
          upsertProfile: async () => { throw new PlatformClientError(409, "profile_conflict", "stale version"); },
        },
      },
    };
    const controller = new OrganizationEditorController();
    await controller.load({ platform: conflictPlatform, organizationId: 12 });
    await controller.submit();
    const state = controller.getState();
    expect(state.phase).toBe("conflict");
    if (state.phase === "conflict") {
      expect(state.current.row_version).toBe(5);
      expect(state.differences.map((d) => d.field)).toContain("description");
      expect(state.differences.map((d) => d.field)).toContain("publication_consent");
      expect(state.reconsentRequired).toBe(true); // draft wants publish, server says withdrawn
      // A local edit keeps the conflict context; resubmission stays blocked.
      controller.updateDraft((draft) => ({ ...draft, city: "Qom" }));
      expect(controller.getState().phase).toBe("conflict");
      // Explicit re-consent unblocks.
      controller.reconsentPublication();
      const after = controller.getState();
      if (after.phase === "conflict") expect(after.reconsentRequired).toBe(false);
    }
  });

  it("a successful save reloads the authoritative view and reports the publication outcome", async () => {
    const stored = storedOrganization();
    // After the commit, the authoritative managed view serves row_version 5.
    let liveVersion = 4;
    const savePlatform = {
      modules: {
        organizations: {
          managed: async () => ({ organization: storedOrganization({ row_version: liveVersion }), permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" }) as never,
          upsertProfile: async () => { liveVersion = 5; return { organization: { ...stored, row_version: 5 }, publication: "published" }; },
        },
      },
    };
    const controller = new OrganizationEditorController();
    await controller.load({ platform: savePlatform, organizationId: 12 });
    await controller.submit();
    const state = controller.getState();
    expect(state.phase).toBe("saved");
    if (state.phase === "saved") {
      expect(state.publication).toBe("published");
      expect(state.stored?.row_version).toBe(5); // the reloaded authoritative version
    }
  });

  it("adoptServerValues takes the server's fields except publication consent (explicit only)", async () => {
    const stored = storedOrganization();
    const current = storedOrganization({ row_version: 5, description: "Server description", city: "Karaj", publication_consent: false });
    let calls = 0;
    const platform = {
      modules: {
        organizations: {
          managed: async () => (calls++ === 0
            ? { organization: stored, permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } as never
            : { organization: current, permissions: CURRENT_STAFF, current_province_scheme: "IR-3166-2:2024" } as never),
          upsertProfile: async () => { throw new PlatformClientError(409, "profile_conflict", "stale"); },
        },
      },
    };
    const controller = new OrganizationEditorController();
    await controller.load({ platform, organizationId: 12 });
    await controller.submit();
    expect(controller.getState().phase).toBe("conflict");
    controller.adoptServerValues(["description", "city", "publication_consent"]);
    const state = controller.getState();
    if (state.phase === "conflict") {
      expect(state.draft.description).toBe("Server description");
      expect(state.draft.city).toBe("Karaj");
      expect(state.draft.publication_consent).toBe(true); // NEVER adopted — consent stays explicit
    }
  });
});

describe("N07 staff roster + explainer honesty", () => {
  it("normalizes memberships and invites with current/ former / pending states", () => {
    const roster = normalizeStaffRoster([
      { kind: "membership", user_id: "u-1", email: "a@x.io", role: "owner", status: "active", is_current: 1 },
      { kind: "membership", user_id: "u-2", email: "b@x.io", role: "manager", status: "revoked", is_current: 0, revoked_at: "2026-01-01" },
      { kind: "invite", id: 9, email: "c@x.io", proposed_role: "member", status: "pending", expires_at: "2026-03-01" },
    ]);
    expect(roster[0]).toMatchObject({ kind: "membership", user_id: "u-1", role: "owner", is_current: true });
    expect(roster[1]).toMatchObject({ kind: "membership", user_id: "u-2", is_current: false, revoked_at: "2026-01-01" });
    expect(roster[2]).toMatchObject({ kind: "invite", role: "member", status: "pending" });
  });

  it("the explainer keeps account/person/organization/official roles distinct, EN+FA", () => {
    expect(ORGANIZATION_ONBOARDING_EXPLAINER.map((e) => e.concept)).toEqual(["account", "person", "organization", "official_role"]);
    for (const entry of ORGANIZATION_ONBOARDING_EXPLAINER) {
      expect(entry.en.length).toBeGreaterThan(40);
      expect(entry.fa.length).toBeGreaterThan(20);
      expect(entry.fa).toMatch(/[\u0600-\u06FF]/);
    }
    const organization = ORGANIZATION_ONBOARDING_EXPLAINER.find((e) => e.concept === "organization")!;
    expect(organization.en).toContain("CURRENT staff");
    const official = ORGANIZATION_ONBOARDING_EXPLAINER.find((e) => e.concept === "official_role")!;
    expect(official.en).toContain("never organization staff roles");
  });

  it("FIVE-FORM SOURCE PIN: all five independent frontends bind the ONE controller (no forked copies)", () => {
    const kit = readFileSync(join(ROOT, "src/frontend-kit/domain/organizationEditor.ts"), "utf8");
    expect(kit).toContain("the ONE headless organization editor");
    // The shared controller is exported from the kit root once.
    const domainIndex = readFileSync(join(ROOT, "src/frontend-kit/domain/index.ts"), "utf8");
    expect(domainIndex).toContain("OrganizationEditorController");
    expect(domainIndex).toContain("useOrganizationEditorController");
    // All five frontends bind the SAME controller hook — five independent
    // visuals, one state machine, no forked copies.
    const heritage = readFileSync(join(ROOT, "src/web/heritage/OrganizationWorkbench.tsx"), "utf8");
    expect(heritage).toContain("useOrganizationEditorController");
    for (const frontend of ["classic-registry", "equidata-elite", "fei-classic", "retro-astra"]) {
      const source = readFileSync(join(ROOT, `src/web/frontends/${frontend}/OrganizationEditor.tsx`), "utf8");
      expect(source).toContain("useOrganizationEditorController");
      expect(source).not.toContain("new OrganizationEditorController()"); // no forked instances
    }
    // The mock platform carries the same organizations surface (fail-closed writes).
    const mock = readFileSync(join(ROOT, "src/frontend-kit/mockPlatformClient.ts"), "utf8");
    expect(mock).toContain("organizations: {");
    expect(mock).toMatch(/organizations[\s\S]{0,400}feature_unavailable/);
  });
});
